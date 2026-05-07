#!/usr/bin/env python3
"""
OCR benchmark – runs the full pipeline on test videos and scores against
known ground truth.

Run inside the Docker container:
    docker exec video-ai-backend-1 python test_ocr.py
    docker exec video-ai-backend-1 python test_ocr.py --mode fast
    docker exec video-ai-backend-1 python test_ocr.py --debug
    docker exec video-ai-backend-1 python test_ocr.py /test/test1.mp4 --debug
"""

import argparse
import sys
import tempfile
import time
from difflib import SequenceMatcher
from pathlib import Path

# ── gold standards ────────────────────────────────────────────────────────────
# Every entry is the canonical text that MUST appear in the pipeline output
# (or be matched with similarity >= MATCH_THRESHOLD).

GOLD: dict[str, list[str]] = {
    "test1.mp4": [
        "EXECUTIVE PRODUCERS",
        "ANDREW RONA",
        "STEVE RICHARDS",
        "SARAH AUBREY",
        "STUART BESSER",
    ],
    "test2.mp4": [
        "DIRECTOR OF PHOTOGRAPHY",
        "SCOTT KEVAN",
    ],
}

DEFAULT_VIDEOS = ["/test/test1.mp4", "/test/test2.mp4"]
MATCH_THRESHOLD = 0.60   # SequenceMatcher ratio to count a detection as a hit


# ── text matching ─────────────────────────────────────────────────────────────

def _sim(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def _find_best(needle: str, candidates: list[str]) -> tuple[str | None, float]:
    """Return (best_match, score) or (None, best_score) if below threshold."""
    best, best_score = None, 0.0
    for c in candidates:
        s = _sim(needle, c)
        if s > best_score:
            best_score, best = s, c
    return (best, best_score) if best_score >= MATCH_THRESHOLD else (None, best_score)


# ── pipeline helpers (mirrors pipeline.py without job-dict overhead) ──────────

def _extract_and_ocr(video_path: str, tmpdir: str, mode: str, debug: bool) -> list[tuple[float, list[dict]]]:
    from extractor import extract_frames, extract_frames_window, get_video_fps
    from recognizer import recognize_frame, _merge_collinear

    def ocr(frames: list[str], base_ts: float = 0.0, fps: float = 1.0,
            label: str = "") -> list[tuple[float, list[dict]]]:
        out = []
        for i, f in enumerate(frames):
            ts = base_ts + i / fps
            # single OCR call; merger runs on the already-returned raw list
            pre  = recognize_frame(f, skip_merge=True)   # EasyOCR output
            dets = _merge_collinear(pre)                  # our post-process
            if debug and pre:
                pre_texts = [d["text"] for d in pre]
                mrg_texts = [d["text"] for d in dets]
                print(f"    [{label}t={ts:.2f}s]  raw={pre_texts}")
                if mrg_texts != pre_texts:
                    print(f"    [{label}t={ts:.2f}s]  merged ={mrg_texts}")
            out.append((ts, dets))
        return out

    if mode == "fast":
        print("  Extracting frames at 1 fps …")
        frames = extract_frames(video_path, f"{tmpdir}/f", fps=1.0)
        print(f"  {len(frames)} frames  →  OCR …")
        return ocr(frames, fps=1.0, label="")

    # accurate / max → two-pass
    detail_fps = 8.0 if mode == "accurate" else get_video_fps(video_path)

    print("  Pass 1: extract at 1 fps …")
    frames1 = extract_frames(video_path, f"{tmpdir}/p1", fps=1.0)
    print(f"  {len(frames1)} frames  →  OCR …")
    pass1 = ocr(frames1, fps=1.0, label="P1 ")

    positive = [ts for ts, dets in pass1 if dets]
    if not positive:
        print("  Pass 1 found nothing.")
        return pass1

    # build windows: positive timestamps ±1 s, merged
    video_end = float(len(frames1))
    intervals = [(max(0.0, t - 1.0), min(video_end, t + 1.0)) for t in positive]
    intervals.sort()
    merged: list[list[float]] = [list(intervals[0])]
    for s, e in intervals[1:]:
        if s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e])
    windows = [(s, e) for s, e in merged]
    print(f"  {len(windows)} text window(s) → Pass 2 at {detail_fps} fps …")

    pass2: list[tuple[float, list]] = []
    for wi, (wstart, wend) in enumerate(windows):
        wframes = extract_frames_window(
            video_path, f"{tmpdir}/p2w{wi}",
            wstart, wend - wstart, fps=detail_fps,
        )
        wts = [wstart + i / detail_fps for i in range(len(wframes))]
        for f, ts in zip(wframes, wts):
            dets = recognize_frame(f)
            if debug and dets:
                print(f"    [P2 t={ts:.2f}s] {[d['text'] for d in dets]}")
            pass2.append((ts, dets))

    def _in_window(ts: float) -> bool:
        return any(ws <= ts <= we for ws, we in windows)

    combined = [(ts, d) for ts, d in pass1 if not _in_window(ts)]
    combined.extend(pass2)
    combined.sort(key=lambda x: x[0])
    return combined


# ── evaluation ────────────────────────────────────────────────────────────────

def _evaluate(results: list[dict], gold: list[str]) -> dict:
    found_texts = [r["text"] for r in results]
    hits, misses = [], []
    for expected in gold:
        match, score = _find_best(expected, found_texts)
        if match:
            hits.append((expected, match, score))
        else:
            # keep the closest miss for diagnostics
            best, best_score = None, 0.0
            for t in found_texts:
                s = _sim(expected, t)
                if s > best_score:
                    best_score, best = s, t
            misses.append((expected, best, best_score))
    return {
        "hits": hits,
        "misses": misses,
        "recall": len(hits) / len(gold) if gold else 1.0,
        "found_texts": found_texts,
    }


def _print_results(ev: dict, name: str, elapsed: float) -> None:
    sep = "─" * 56
    print(f"\n  {sep}")
    print(f"  RESULTS  {name}  ({elapsed:.0f}s)")
    print(f"  {sep}")

    print(f"\n  All detections ({len(ev['found_texts'])}):")
    for t in ev["found_texts"]:
        print(f"    • \"{t}\"")

    print()
    if ev["hits"]:
        for expected, matched, score in ev["hits"]:
            exact = expected.lower() == matched.lower()
            tag = "✓ EXACT " if exact else f"✓ ~{score:.0%}"
            print(f"    {tag}   \"{expected}\"  ←  \"{matched}\"")
    if ev["misses"]:
        for expected, closest, score in ev["misses"]:
            hint = f"  (closest: \"{closest}\"  sim={score:.0%})" if closest else ""
            print(f"    ✗ MISSED  \"{expected}\"{hint}")

    pct = int(ev["recall"] * 100)
    bar = "█" * (pct // 5) + "░" * (20 - pct // 5)
    total = len(ev["hits"]) + len(ev["misses"])
    print(f"\n  Recall  {bar}  {pct}%  ({len(ev['hits'])}/{total})")


# ── per-video runner ──────────────────────────────────────────────────────────

def run_video(video_path: str, mode: str, debug: bool, save_frames: str = "") -> bool:
    name = Path(video_path).name
    gold = GOLD.get(name)
    if not gold:
        print(f'\n[WARN] No gold standard for "{name}" – skipping evaluation.')
        return True

    print(f"\n{'═'*60}")
    print(f"  {name}  |  mode={mode}  |  expected: {gold}")
    print(f"{'═'*60}")

    from grouper import group_text_tracks

    t0 = time.time()
    frame_outdir = ""
    if save_frames:
        frame_outdir = Path(save_frames) / Path(video_path).stem
        frame_outdir.mkdir(parents=True, exist_ok=True)
        frame_outdir = str(frame_outdir)

    with tempfile.TemporaryDirectory() as tmpdir:
        if frame_outdir:
            # copy extracted frames to persistent dir for inspection
            import shutil
            from extractor import extract_frames
            frames = extract_frames(video_path, frame_outdir, fps=8.0)
            print(f"  Saved {len(frames)} frames to {frame_outdir}")
        timed = _extract_and_ocr(video_path, tmpdir, mode, debug)

    print("  Grouping …")
    results = group_text_tracks(
        [d for _, d in timed],
        [ts for ts, _ in timed],
    )

    ev = _evaluate(results, gold)
    _print_results(ev, name, time.time() - t0)
    return ev["recall"] == 1.0


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description="OCR benchmark against gold-standard transcripts")
    ap.add_argument("videos", nargs="*", default=DEFAULT_VIDEOS, metavar="VIDEO",
                    help="paths to video files (default: /test/test1.mp4 + test2.mp4)")
    ap.add_argument("--mode", choices=["fast", "accurate", "max"], default="accurate",
                    help="pipeline mode (default: accurate)")
    ap.add_argument("--debug", action="store_true",
                    help="print every frame's raw OCR detections")
    ap.add_argument("--save-frames", default="", metavar="DIR",
                    help="save extracted frames to DIR for manual inspection (e.g. /app/test_frames)")
    args = ap.parse_args()

    all_pass = True
    for video in args.videos:
        if not Path(video).exists():
            print(f"\n[ERROR] File not found: {video}")
            all_pass = False
            continue
        ok = run_video(video, args.mode, args.debug, args.save_frames)
        if not ok:
            all_pass = False

    print(f"\n{'═'*60}")
    print(f"  Overall: {'ALL PASS ✓' if all_pass else 'SOME MISSED ✗'}")
    print(f"{'═'*60}\n")
    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
