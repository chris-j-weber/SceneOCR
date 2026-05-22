import { Job, TextOccurrence } from './types'

// In Electron, window.electronAPI.backendPort() returns the backend port.
// In the browser (Docker / Vite dev), BASE is empty and /api/... goes via the Vite proxy.
function _base(): string {
  const w = window as Window & { electronAPI?: { backendPort: () => number } }
  return w.electronAPI ? `http://localhost:${w.electronAPI.backendPort()}` : ''
}

export function apiUrl(path: string): string {
  return _base() + path
}

export async function uploadVideo(
  file: File,
  mode: string,
  startTime?: number,
  endTime?: number,
): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  form.append('mode', mode)
  if (startTime !== undefined) form.append('start_time', String(startTime))
  if (endTime   !== undefined) form.append('end_time',   String(endTime))
  const res = await fetch(apiUrl('/api/jobs'), { method: 'POST', body: form })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()).job_id
}

export async function pollJob(jobId: string): Promise<Job> {
  const res = await fetch(apiUrl(`/api/jobs/${jobId}`))
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function fetchResults(jobId: string): Promise<TextOccurrence[]> {
  const res = await fetch(apiUrl(`/api/jobs/${jobId}/results`))
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()).results
}
