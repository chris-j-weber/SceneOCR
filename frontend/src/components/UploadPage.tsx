import { DragEvent, useEffect, useRef, useState } from 'react'

interface Props {
  onUpload: (file: File, mode: string, startTime?: number, endTime?: number) => void
  onBack?: () => void
}

const MODES = [
  { value: 'fast',     label: 'Fast',     detail: '1 fps — one frame per second' },
  { value: 'accurate', label: 'Accurate', detail: '1 fps scan + 8 fps detail pass in text regions (±1 s)' },
  { value: 'max',      label: 'Maximum',  detail: '1 fps scan + native fps detail pass in text regions' },
]

function formatTime(s: number): string {
  const h   = Math.floor(s / 3600)
  const m   = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export default function UploadPage({ onUpload, onBack }: Props) {
  const [file,         setFile]         = useState<File | null>(null)
  const [mode,         setMode]         = useState('accurate')
  const [dragging,     setDragging]     = useState(false)
  const [duration,      setDuration]      = useState(0)
  const [useRange,      setUseRange]      = useState(false)
  const [rangeStart,    setRangeStart]    = useState(0)
  const [rangeEnd,      setRangeEnd]      = useState(0)
  const [previewStart,  setPreviewStart]  = useState('')
  const [previewEnd,    setPreviewEnd]    = useState('')
  const [activeHandle,  setActiveHandle]  = useState<'start' | 'end'>('start')

  const inputRef    = useRef<HTMLInputElement>(null)
  const videoRef    = useRef<HTMLVideoElement>(null)
  const blobRef     = useRef('')
  const dualRangeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = dualRangeRef.current
    if (!el || duration === 0) return
    el.style.setProperty('--start-pct', `${(rangeStart / duration) * 100}%`)
    el.style.setProperty('--end-pct',   `${(rangeEnd   / duration) * 100}%`)
  }, [rangeStart, rangeEnd, duration])

  function captureFrame(time: number, set: (url: string) => void) {
    const vid = videoRef.current
    if (!vid || !vid.src) return
    vid.addEventListener('seeked', () => {
      const c = document.createElement('canvas')
      c.width = 160; c.height = 90
      c.getContext('2d')?.drawImage(vid, 0, 0, 160, 90)
      set(c.toDataURL('image/jpeg', 0.8))
    }, { once: true })
    vid.currentTime = Math.min(Math.max(time, 0), vid.duration || 0)
  }

  function pickFile(f: File) {
    if (!f.type.startsWith('video/') && !/\.(mp4|mov|avi|mkv|webm)$/i.test(f.name)) return
    setFile(f)
    setUseRange(false)
    setPreviewStart('')
    setPreviewEnd('')
    if (blobRef.current) URL.revokeObjectURL(blobRef.current)
    const url = URL.createObjectURL(f)
    blobRef.current = url
    const vid = videoRef.current!
    vid.src = url
    vid.addEventListener('loadedmetadata', () => {
      const dur = vid.duration
      setDuration(dur)
      setRangeStart(0)
      setRangeEnd(dur)
      captureFrame(0, setPreviewStart)
      captureFrame(Math.max(dur - 0.1, 0), setPreviewEnd)
    }, { once: true })
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) pickFile(f)
  }

  function formatSize(bytes: number) {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  function handleStart() {
    if (!file) return
    onUpload(file, mode, useRange ? rangeStart : undefined, useRange ? rangeEnd : undefined)
  }

  return (
    <div className="page center-page">
      <div className="upload-card">
        <div className="upload-header">
          {onBack && (
            <button type="button" className="btn-back" onClick={onBack} title="Back">←</button>
          )}
          <h1 className="app-title">New Project</h1>
        </div>
        <p className="app-subtitle">Detects on-screen text locally — no cloud, no API.</p>

        <div
          className={`drop-zone${dragging ? ' dragging' : ''}${file ? ' has-file' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/*,.mkv"
            aria-label="Select video file"
            className="hidden-file-input"
            onChange={e => e.target.files?.[0] && pickFile(e.target.files[0])}
          />
          {file ? (
            <div className="file-info">
              <div className="file-icon">🎬</div>
              <div className="file-name">{file.name}</div>
              <div className="file-size">{formatSize(file.size)}</div>
            </div>
          ) : (
            <div className="drop-hint">
              <div className="drop-icon">📁</div>
              <div>Drop video here or click to browse</div>
              <div className="drop-formats">MP4 · MOV · AVI · MKV · WebM</div>
            </div>
          )}
        </div>

        {file && duration > 0 && (
          <div className="fps-section">
            <label className="fps-label">Time range</label>
            <label className="time-range-toggle">
              <input
                type="checkbox"
                checked={useRange}
                onChange={e => setUseRange(e.target.checked)}
              />
              Restrict to custom range
            </label>

            {useRange && (
              <div className="time-range-controls">
                <div className="range-dual" ref={dualRangeRef}>
                  <div className="range-dual-track" />
                  <input
                    type="range" min={0} max={duration} step={1}
                    value={rangeStart}
                    aria-label="Start time"
                    className={activeHandle === 'start' ? 'range-front' : ''}
                    onMouseDown={() => setActiveHandle('start')}
                    onTouchStart={() => setActiveHandle('start')}
                    onChange={e => {
                      const v = Math.min(Number(e.target.value), rangeEnd - 1)
                      setRangeStart(v)
                      captureFrame(v, setPreviewStart)
                    }}
                  />
                  <input
                    type="range" min={0} max={duration} step={1}
                    value={rangeEnd}
                    aria-label="End time"
                    className={activeHandle === 'end' ? 'range-front' : ''}
                    onMouseDown={() => setActiveHandle('end')}
                    onTouchStart={() => setActiveHandle('end')}
                    onChange={e => {
                      const v = Math.max(Number(e.target.value), rangeStart + 1)
                      setRangeEnd(v)
                      captureFrame(v, setPreviewEnd)
                    }}
                  />
                </div>

                <div className="time-range-times">
                  <span>{formatTime(rangeStart)}</span>
                  <span>{formatTime(rangeEnd)}</span>
                </div>

                {(previewStart || previewEnd) && (
                  <div>
                    <div className="frame-preview">
                      <img
                        src={activeHandle === 'start' ? previewStart : previewEnd}
                        alt="Frame preview"
                      />
                    </div>
                    <div className="frame-preview-label">
                      {activeHandle === 'start'
                        ? `Start — ${formatTime(rangeStart)}`
                        : `End — ${formatTime(rangeEnd)}`}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="fps-section">
          <label className="fps-label">Analysis mode</label>
          <div className="fps-options">
            {MODES.map(m => (
              <label key={m.value} className={`fps-option${mode === m.value ? ' selected' : ''}`}>
                <input
                  type="radio" name="mode" value={m.value}
                  checked={mode === m.value}
                  onChange={() => setMode(m.value)}
                />
                <span className="mode-label">{m.label}</span>
                <span className="mode-detail">{m.detail}</span>
              </label>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="btn-primary"
          disabled={!file}
          onClick={handleStart}
        >
          Start analysis
        </button>
      </div>

      <video ref={videoRef} className="hidden-video" muted playsInline />
    </div>
  )
}
