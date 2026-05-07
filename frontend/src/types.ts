export type Poly = [[number, number], [number, number], [number, number], [number, number]]

export interface PolyAtTime {
  time: number
  poly: Poly
}

export interface TextOccurrence {
  text: string
  start_time: number
  end_time: number
  poly: Poly
  polys?: PolyAtTime[]
  confidence: number
}

export type EditableOccurrence = TextOccurrence & { id: string }

export type JobStatus =
  | 'queued'
  | 'extracting_frames'
  | 'analyzing'
  | 'grouping'
  | 'done'
  | 'error'

export interface Job {
  id: string
  status: JobStatus
  progress: number
  message: string
  error?: string
}

export interface SavedProject {
  id: string
  title: string
  createdAt: number
  videoFilename: string
  results: TextOccurrence[]
  thumbnail: string
}
