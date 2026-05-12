import { useEffect, useRef } from 'react'

interface Props {
  logs: string[]
  error?: string | null
}

export default function LoadingPage({ logs, error }: Props) {
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  return (
    <div className="page center-page">
      <div className="loading-card">
        <h2 className="analysis-title">Starting SceneOCR…</h2>

        {!error && (
          <div className="spinner-wrap">
            <div className="spinner" />
          </div>
        )}

        <div className="log-output" ref={logRef}>
          {logs.length === 0 && !error && (
            <span className="log-line muted">Initializing Python runtime…</span>
          )}
          {logs.map((line, i) => (
            <div key={i} className="log-line">{line}</div>
          ))}
        </div>

        {error && (
          <div className="error-detail" style={{ width: '100%', textAlign: 'left', whiteSpace: 'pre-wrap' }}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
