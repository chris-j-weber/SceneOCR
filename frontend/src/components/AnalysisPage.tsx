import { Job } from '../types'

interface Props {
  job: Job | null
  uploadError?: string | null
}

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued…',
  extracting_frames: 'Extracting frames…',
  analyzing: 'Running OCR…',
  grouping: 'Grouping text tracks…',
  done: 'Done',
  error: 'Error',
}

export default function AnalysisPage({ job, uploadError }: Props) {
  const progress = job?.progress ?? 0
  const isError = job?.status === 'error' || !!uploadError
  const label = uploadError
    ? 'Upload failed'
    : job
    ? STATUS_LABELS[job.status] ?? job.status
    : 'Uploading video…'
  const message = job?.message ?? ''
  const errorDetail = uploadError ?? job?.error

  return (
    <div className="page center-page">
      <div className="analysis-card">
        <h2 className="analysis-title">Analyzing…</h2>

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
        {isError && errorDetail && (
          <div className="error-detail">{errorDetail}</div>
        )}
      </div>
    </div>
  )
}
