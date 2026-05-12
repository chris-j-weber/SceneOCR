"""
Entry point used by both the PyInstaller bundle and the embedded-Python distribution.
Reads SCENEOCR_PORT from the environment (set by Electron) and starts uvicorn.
"""
import os
import sys
from pathlib import Path

# When run as "python backend_main.py" (embedded-Python mode), Python adds the
# script directory to sys.path, but uvicorn.run("main:app") needs it too.
_here = str(Path(__file__).parent)
if _here not in sys.path:
    sys.path.insert(0, _here)

import uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("SCENEOCR_PORT", "8000"))
    print(f"[backend] Starting on port {port}…", flush=True)
    uvicorn.run("main:app", host="127.0.0.1", port=port, log_level="warning")
    print("[backend] Stopped.", flush=True)
