import os
import shutil
import traceback
import uuid
from pathlib import Path

from extractor import extract_frames, extract_frames_window, get_video_fps
from grouper import group_text_tracks
from recognizer import get_reader, recognize_frame

def _default_data_dir() -> Path:
    # Docker: /app exists → keep old layout. Standalone: user data from env or home.
    if Path("/app").exists():
        return Path("/app")
    return Path.home() / ".sceneocr"

_data = Path(os.environ.get("SCENEOCR_DATA_DIR", str(_default_data_dir())))
UPLOAD_DIR = Path(os.environ.get("SCENEOCR_UPLOADS_DIR", str(_data / "uploads")))
JOBS_DIR   = Path(os.environ.get("SCENEOCR_JOBS_DIR",   str(_data / "jobs")))

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
JOBS_DIR.mkdir(parents=True, exist_ok=True)

jobs: dict[str, dict] = {}

# fps used for the detailed second pass
_DETAIL_FPS: dict[str, float | None] = {
    "fast":     None,   # no second pass
    "accurate": 8.0,    # every ~3rd frame at 24fps
    "max":      None,   # native fps (resolved at runtime)
}


def create_job(video_path: str, mode: str) -> str:
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "id": job_id,
        "status": "queued",
        "progress": 0,
        "message": "Waiting to start…",
        "results": None,
        "error": None,
        "video_path": video_path,
        "mode": mode,
    }
    return job_id


def get_job(job_id: str) -> dict | None:
    return jobs.get(job_id)


# ── helpers ──────────────────────────────────────────────────────────────────

def _ocr_frames(paths: list[str], timestamps: list[float], job: dict,
                progress_start: int, progress_end: int, label: str
                ) -> list[tuple[float, list[dict]]]:
    results = []
    total = len(paths)
    for i, (path, ts) in enumerate(zip(paths, timestamps)):
        results.append((ts, recognize_frame(path)))
        job["progress"] = progress_start + int((i + 1) / total * (progress_end - progress_start))
        job["message"] = f"{label}: frame {i + 1} / {total}…"
    return results


def _find_text_windows(
    pass1: list[tuple[float, list]],
    video_end: float,
    padding: float = 1.0,
) -> list[tuple[float, float]]:
    """
    Return merged time intervals around every second where text was detected.
    Each positive timestamp is expanded by ±padding seconds.
    """
    positive = [ts for ts, dets in pass1 if dets]
    if not positive:
        return []

    intervals = [(max(0.0, t - padding), min(video_end, t + padding)) for t in positive]
    intervals.sort()

    merged: list[list[float]] = [list(intervals[0])]
    for start, end in intervals[1:]:
        if start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])

    return [(s, e) for s, e in merged]


# ── pipeline modes ────────────────────────────────────────────────────────────

def _run_single_pass(job: dict, video_path: str, frames_dir: str, fps: float) -> None:
    job.update(status="extracting_frames", progress=5,
               message=f"Extracting frames at {fps} fps…")

    frames = extract_frames(video_path, frames_dir, fps=fps)
    total  = len(frames)
    if total == 0:
        raise RuntimeError("No frames extracted from video.")

    job.update(status="analyzing", progress=15,
               message="Loading OCR engine…")
    get_reader()
    job["message"] = f"Extracted {total} frames. Starting OCR…"

    timestamps = [i / fps for i in range(total)]
    timed = _ocr_frames(frames, timestamps, job, 15, 88, "Analysing")

    job.update(status="grouping", progress=90, message="Grouping text occurrences…")
    results = group_text_tracks([d for _, d in timed], [ts for ts, _ in timed])

    job.update(status="done", progress=100,
               message=f"Done — {len(results)} text occurrence(s) found.",
               results=results)


def _run_two_pass(job: dict, video_path: str, frames_dir: str, detail_fps: float) -> None:
    # ── Pass 1 : coarse 1 fps scan ────────────────────────────────────────
    dir1 = frames_dir + "_p1"
    job.update(status="extracting_frames", progress=3,
               message="Pass 1: scanning at 1 fps…")

    frames1 = extract_frames(video_path, dir1, fps=1.0)
    total1  = len(frames1)
    if total1 == 0:
        raise RuntimeError("No frames extracted from video.")

    job.update(status="analyzing", progress=8,
               message="Loading OCR engine…")
    get_reader()
    job["message"] = f"Pass 1: analysing {total1} frames…"

    ts1 = [float(i) for i in range(total1)]
    pass1 = _ocr_frames(frames1, ts1, job, 8, 35, "Pass 1")
    shutil.rmtree(dir1, ignore_errors=True)

    # ── Find refinement windows ───────────────────────────────────────────
    video_end = float(total1)
    windows   = _find_text_windows(pass1, video_end)

    job.update(progress=37,
               message=f"Found {len(windows)} text region(s). Starting detail scan…")

    if not windows:
        # no text found in pass 1 — nothing to refine
        job.update(status="done", progress=100,
                   message="Done — no text found.", results=[])
        return

    # ── Pass 2 : fine scan inside each window ────────────────────────────
    pass2: list[tuple[float, list]] = []
    total_windows = len(windows)

    for wi, (wstart, wend) in enumerate(windows):
        dir2 = frames_dir + f"_p2w{wi}"
        duration = wend - wstart

        window_frames = extract_frames_window(
            video_path, dir2, wstart, duration, fps=detail_fps
        )
        wts = [wstart + i / detail_fps for i in range(len(window_frames))]
        pass2.extend(_ocr_frames(
            window_frames, wts, job,
            37 + int(wi / total_windows * 48),
            37 + int((wi + 1) / total_windows * 48),
            f"Pass 2 region {wi + 1}/{total_windows}",
        ))
        shutil.rmtree(dir2, ignore_errors=True)

    # ── Merge: replace pass-1 frames inside windows with pass-2 frames ───
    window_set = windows  # list of (start, end)

    def _in_any_window(ts: float) -> bool:
        return any(ws <= ts <= we for ws, we in window_set)

    combined = [(ts, d) for ts, d in pass1 if not _in_any_window(ts)]
    combined.extend(pass2)
    combined.sort(key=lambda x: x[0])

    # ── Grouping ──────────────────────────────────────────────────────────
    job.update(status="grouping", progress=90, message="Grouping text occurrences…")
    results = group_text_tracks(
        [d for _, d in combined],
        [ts for ts, _ in combined],
    )

    job.update(status="done", progress=100,
               message=f"Done — {len(results)} text occurrence(s) found.",
               results=results)


# ── entry point ───────────────────────────────────────────────────────────────

def run_pipeline(job_id: str) -> None:
    job        = jobs.get(job_id)
    if not job:
        return

    video_path = job["video_path"]
    mode       = job.get("mode", "accurate")
    frames_dir = str(JOBS_DIR / job_id / "frames")

    try:
        if mode == "fast":
            _run_single_pass(job, video_path, frames_dir, fps=1.0)
        elif mode == "accurate":
            _run_two_pass(job, video_path, frames_dir, detail_fps=8.0)
        else:  # max
            native_fps = get_video_fps(video_path)
            _run_two_pass(job, video_path, frames_dir, detail_fps=native_fps)

    except Exception as exc:
        print(f"[pipeline] ERROR:\n{traceback.format_exc()}", flush=True)
        job.update(status="error", error=str(exc), message=f"Error: {exc}")
    finally:
        shutil.rmtree(frames_dir, ignore_errors=True)
