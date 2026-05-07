import { DragEvent, useRef, useState } from 'react'

interface Props {
  onUpload: (file: File, mode: string) => void
  onBack?: () => void
}

const MODES = [
  {
    value: 'fast',
    label: 'Schnell',
    detail: '1fps — jede Sekunde wird geprüft',
  },
  {
    value: 'accurate',
    label: 'Genau',
    detail: '1fps Übersicht + 8fps Feincheck in Textbereichen (±1s)',
  },
  {
    value: 'max',
    label: 'Maximum',
    detail: '1fps Übersicht + framegenauer Feincheck in Textbereichen',
  },
]

export default function UploadPage({ onUpload, onBack }: Props) {
  const [file,     setFile]     = useState<File | null>(null)
  const [mode,     setMode]     = useState('accurate')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function pickFile(f: File) {
    if (f.type.startsWith('video/') || /\.(mp4|mov|avi|mkv|webm)$/i.test(f.name)) {
      setFile(f)
    }
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

  return (
    <div className="page center-page">
      <div className="upload-card">
        <div className="upload-header">
          {onBack && (
            <button type="button" className="btn-back" onClick={onBack} title="Zurück">
              ←
            </button>
          )}
          <h1 className="app-title">Neues Projekt</h1>
        </div>
        <p className="app-subtitle">Erkennt Texte in Videos lokal — ohne Cloud, ohne API.</p>

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
            aria-label="Videodatei auswählen"
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
              <div>Video hier ablegen oder klicken</div>
              <div className="drop-formats">MP4 · MOV · AVI · MKV · WebM</div>
            </div>
          )}
        </div>

        <div className="fps-section">
          <label className="fps-label">Analysemodus</label>
          <div className="fps-options">
            {MODES.map(m => (
              <label key={m.value} className={`fps-option${mode === m.value ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="mode"
                  value={m.value}
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
          onClick={() => file && onUpload(file, mode)}
        >
          Analyse starten
        </button>
      </div>
    </div>
  )
}
