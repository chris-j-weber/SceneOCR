import { Job, TextOccurrence } from './types'

export async function uploadVideo(file: File, mode: string): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  form.append('mode', mode)
  const res = await fetch('/api/jobs', { method: 'POST', body: form })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()).job_id
}

export async function pollJob(jobId: string): Promise<Job> {
  const res = await fetch(`/api/jobs/${jobId}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function fetchResults(jobId: string): Promise<TextOccurrence[]> {
  const res = await fetch(`/api/jobs/${jobId}/results`)
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()).results
}
