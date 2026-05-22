const { app, BrowserWindow, ipcMain } = require('electron')
const path   = require('path')
const { spawn } = require('child_process')
const net    = require('net')
const fs     = require('fs')

let backendProcess = null
let backendPort    = 8000
let backendReady   = false
let backendOutput  = ''
let logLines       = []
let mainWindow     = null

// ── helpers ──────────────────────────────────────────────────────────────────

function forwardLog(text) {
  const line = text.trim()
  if (!line) return
  logLines.push(line)
  backendOutput += text
  mainWindow?.webContents.send('backend-log', line)
}

function findFreePort(start = 8000) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(start, '127.0.0.1', () => {
      const p = srv.address().port
      srv.close(() => resolve(p))
    })
    srv.on('error', () =>
      start < 9000
        ? findFreePort(start + 1).then(resolve).catch(reject)
        : reject(new Error('No free port found in range 8000-9000'))
    )
  })
}

function waitForBackend(port, attempts = 0) {
  return new Promise((resolve, reject) => {
    if (backendProcess && backendProcess.exitCode !== null) {
      return reject(new Error(
        `Backend process exited with code ${backendProcess.exitCode}\n\n${backendOutput || '(no output)'}`
      ))
    }
    const sock = net.createConnection(port, '127.0.0.1')
    sock.on('connect', () => { sock.destroy(); resolve() })
    sock.on('error', () => {
      if (attempts >= 240) return reject(new Error(
        `Backend did not start within 2 minutes\n\n${backendOutput || '(no output)'}`
      ))
      setTimeout(() => waitForBackend(port, attempts + 1).then(resolve).catch(reject), 500)
    })
  })
}

// ── backend startup ───────────────────────────────────────────────────────────

async function startBackend() {
  backendPort = await findFreePort()

  const userDataPath = app.getPath('userData')
  const uploadsDir   = path.join(userDataPath, 'uploads')
  const jobsDir      = path.join(userDataPath, 'jobs')
  fs.mkdirSync(uploadsDir, { recursive: true })
  fs.mkdirSync(jobsDir,    { recursive: true })

  const env = {
    ...process.env,
    SCENEOCR_PORT:        String(backendPort),
    SCENEOCR_UPLOADS_DIR: uploadsDir,
    SCENEOCR_JOBS_DIR:    jobsDir,
  }

  if (app.isPackaged) {
    const pythonExe     = path.join(process.resourcesPath, 'python', 'python.exe')
    const backendScript = path.join(process.resourcesPath, 'backend-src', 'backend_main.py')
    const binDir        = path.join(process.resourcesPath, 'bin')

    backendProcess = spawn(pythonExe, [backendScript], {
      env: {
        ...env,
        FFMPEG_PATH:  path.join(binDir, 'ffmpeg.exe'),
        FFPROBE_PATH: path.join(binDir, 'ffprobe.exe'),
      },
      windowsHide: true,
    })
  } else {
    const backendDir = path.join(__dirname, '..', 'backend')
    backendProcess = spawn(
      'python',
      ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(backendPort)],
      { cwd: backendDir, env }
    )
  }

  backendProcess.stdout?.on('data', d => forwardLog(d.toString()))
  backendProcess.stderr?.on('data', d => forwardLog(d.toString()))

  await waitForBackend(backendPort)
  forwardLog(`[electron] Backend ready on port ${backendPort}`)
}

// ── window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 800,
    title:  'SceneOCR',
    icon:   path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  })

  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.key === 'F12') mainWindow.webContents.toggleDevTools()
  })

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, 'frontend-dist', 'index.html'))
  } else {
    mainWindow.loadURL('http://localhost:5173')
  }
}

// ── IPC ───────────────────────────────────────────────────────────────────────

ipcMain.on('get-backend-port',   event => { event.returnValue = backendPort })
ipcMain.on('get-backend-status', event => {
  event.returnValue = { ready: backendReady, logs: logLines }
})

// ── lifecycle ─────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow()  // open immediately — shows loading screen while backend starts

  startBackend()
    .then(() => {
      backendReady = true
      mainWindow?.webContents.send('backend-ready')
    })
    .catch(err => {
      console.error('[electron] Backend failed:', err.message)
      mainWindow?.webContents.send('backend-error', err.message)
    })
})

app.on('window-all-closed', () => {
  if (backendProcess) backendProcess.kill()
  app.quit()
})
