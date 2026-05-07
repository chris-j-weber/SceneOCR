import subprocess
from pathlib import Path


def extract_frames(video_path: str, output_dir: str, fps: float = 1.0) -> list[str]:
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-i", video_path,
        "-vf", f"fps={fps}",
        "-q:v", "2", "-f", "image2",
        f"{output_dir}/frame_%08d.jpg", "-y",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg error: {result.stderr}")
    return sorted(str(p) for p in Path(output_dir).glob("frame_*.jpg"))


def extract_frames_window(
    video_path: str,
    output_dir: str,
    start_sec: float,
    duration_sec: float,
    fps: float,
) -> list[str]:
    """Extract frames from a specific time window at the given fps."""
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-i", video_path,
        "-ss", f"{start_sec:.3f}",
        "-t",  f"{duration_sec:.3f}",
        "-vf", f"fps={fps}",
        "-q:v", "2", "-f", "image2",
        f"{output_dir}/frame_%08d.jpg", "-y",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg window error: {result.stderr}")
    return sorted(str(p) for p in Path(output_dir).glob("frame_*.jpg"))


def get_video_fps(video_path: str) -> float:
    """Return native fps of the video (capped at 60)."""
    cmd = [
        "ffprobe", "-v", "quiet",
        "-select_streams", "v:0",
        "-show_entries", "stream=r_frame_rate",
        "-of", "csv=p=0",
        video_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    try:
        num, den = result.stdout.strip().split("/")
        fps = float(num) / float(den)
        return min(fps, 60.0)
    except Exception:
        return 24.0


def get_video_duration(video_path: str) -> float:
    cmd = [
        "ffprobe", "-v", "quiet",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        video_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 0.0
