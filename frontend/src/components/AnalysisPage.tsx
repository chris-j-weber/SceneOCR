import { Job } from '../types'

interface Props {
  job: Job | null
}

const STATUS_LABELS: Record<string, string> = {
  queued: 'In Warteschlange…',
  extracting_frames: 'Frames werden extrahiert…',
  analyzing: 'OCR läuft…',
  grouping: 'Texte werden zusammengefasst…',
  done: 'Fertig',
  error: 'Fehler',
}

export default function AnalysisPage({ job }: Props) {
  const progress = job?.progress ?? 0
  const label = job ? STATUS_LABELS[job.status] ?? job.status : 'Wird gestartet…'
  const message = job?.message ?? ''
  const isError = job?.status === 'error'

  return (
    <div className="page center-page">
      <div className="analysis-card">
        <h2 className="analysis-title">Analyse läuft</h2>

        {!isError && (
          <div className="spinner-wrap">
            <div className="spinner" />
          </div>
        )}

        <div className="progress-bar-outer">
          <div
            className={`progress-bar-inner${isError ? ' error' : ''}`}
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="progress-percent">{progress}%</div>
        <div className={`analysis-status${isError ? ' error' : ''}`}>{label}</div>
        {message && <div className="analysis-message">{message}</div>}
        {isError && job?.error && (
          <div className="error-detail">{job.error}</div>
        )}
      </div>
    </div>
  )
}
