# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for the SceneOCR backend.

Before running:
  pip install pyinstaller
  # ffmpeg.exe and ffprobe.exe must be present in this directory (backend/).
  # build.ps1 downloads them automatically.

Run from the backend/ directory:
  pyinstaller sceneocr_backend.spec --noconfirm
"""

from PyInstaller.utils.hooks import collect_data_files, collect_all

rapidocr_datas,    rapidocr_bins,    rapidocr_hidden    = collect_all('rapidocr_onnxruntime')
onnxruntime_datas, onnxruntime_bins, onnxruntime_hidden = collect_all('onnxruntime')
spellchecker_datas = collect_data_files('spellchecker')

a = Analysis(
    ['backend_main.py'],
    pathex=['.'],
    binaries=[
        ('ffmpeg.exe',  '.'),
        ('ffprobe.exe', '.'),
        *rapidocr_bins,
        *onnxruntime_bins,
    ],
    datas=[
        *rapidocr_datas,
        *onnxruntime_datas,
        *spellchecker_datas,
    ],
    hiddenimports=[
        *rapidocr_hidden,
        *onnxruntime_hidden,
        # uvicorn
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        # fastapi / starlette
        'fastapi',
        'starlette',
        'starlette.routing',
        'starlette.middleware',
        'starlette.middleware.cors',
        'starlette.responses',
        'starlette.staticfiles',
        # async
        'anyio',
        'anyio._backends._asyncio',
        # file upload
        'python_multipart',
        'multipart',
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='sceneocr_backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,   # keep console so Electron can capture stdout/stderr
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='sceneocr_backend',
)
