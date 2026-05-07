import threading
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from pipeline import UPLOAD_DIR, create_job, get_job, run_pipeline

app = FastAPI(title="Video Text Analyzer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

VALID_MODES = {"fast", "accurate", "max"}


@app.post("/api/jobs")
async def upload_video(
    file: UploadFile = File(...),
    mode: str = Form("accurate"),
):
    if not file.filename:
        raise HTTPException(400, "No filename provided.")
    if mode not in VALID_MODES:
        raise HTTPException(400, f"mode must be one of {VALID_MODES}.")

    video_path = UPLOAD_DIR / Path(file.filename).name
    chunk_size = 1024 * 1024
    with open(video_path, "wb") as f:
        while chunk := await file.read(chunk_size):
            f.write(chunk)

    job_id = create_job(str(video_path), mode=mode)
    threading.Thread(target=run_pipeline, args=(job_id,), daemon=True).start()
    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found.")
    return {k: job[k] for k in ("id", "status", "progress", "message", "error")}


@app.get("/api/jobs/{job_id}/results")
def job_results(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found.")
    if job["status"] != "done":
        raise HTTPException(400, f"Job not finished (status: {job['status']}).")
    return {"results": job["results"]}


@app.get("/api/video/{filename}")
def serve_video(filename: str):
    path = UPLOAD_DIR / Path(filename).name
    if not path.exists():
        raise HTTPException(404, "File not found.")
    return FileResponse(str(path), media_type="video/mp4")
