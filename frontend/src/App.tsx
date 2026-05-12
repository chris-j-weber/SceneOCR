import { useEffect, useRef, useState } from 'react'
import { apiUrl, fetchResults, pollJob, uploadVideo } from './api'
import AnalysisPage from './components/AnalysisPage'
import HomePage from './components/HomePage'
import LoadingPage from './components/LoadingPage'
import ResultsPage from './components/ResultsPage'
import UploadPage from './components/UploadPage'
import { saveProject } from './db'
import { Job, SavedProject, TextOccurrence } from './types'

type View = 'loading' | 'home' | 'upload' | 'analyzing' | 'results'

const isElectron = typeof window !== 'undefined' && !!(window as Window & { electronAPI?: unknown }).electronAPI

export default function App() {
  const [view,            setView]            = useState<View>(isElectron ? 'loading' : 'home')
  const [backendLogs,     setBackendLogs]     = useState<string[]>([])
  const [backendError,    setBackendError]    = useState<string | null>(null)
  const [job,             setJob]             = useState<Job | null>(null)
  const [uploadError,     setUploadError]     = useState<string | null>(null)
  const [results,         setResults]         = useState<TextOccurrence[]>([])
  const [videoUrl,        setVideoUrl]        = useState<string>('')
  const [videoFilename,   setVideoFilename]   = useState<string>('')
  const [currentProject,  setCurrentProject]  = useState<SavedProject | null>(null)
  const pendingProjectRef = useRef<SavedProject | null>(null)

  useEffect(() => {
    if (!isElectron) return
    const api = (window as unknown as { electronAPI: {
      getBackendStatus: () => { ready: boolean; logs: string[] }
      onBackendLog:   (cb: (l: string) => void) => void
      onBackendReady: (cb: () => void) => void
      onBackendError: (cb: (m: string) => void) => void
      offBackendLog:  () => void
    } }).electronAPI

    const status = api.getBackendStatus()
    if (status.ready) { setView('home'); return }
    if (status.logs.length) setBackendLogs(status.logs)

    api.onBackendLog(line => setBackendLogs(prev => [...prev, line]))
    api.onBackendReady(() => setView('home'))
    api.onBackendError(msg => setBackendError(msg))
    return () => api.offBackendLog()
  }, [])

  async function handleUpload(file: File, mode: string) {
    setUploadError(null)
    const blobUrl = URL.createObjectURL(file)
    setVideoUrl(blobUrl)
    setVideoFilename(file.name)
    setView('analyzing')

    let jobId: string
    try {
      jobId = await uploadVideo(file, mode)
    } catch (err) {
      setUploadError(String(err))
      return
    }

    const poll = setInterval(async () => {
      let updated: Job
      try {
        updated = await pollJob(jobId)
      } catch {
        return
      }
      setJob(updated)
      if (updated.status === 'done') {
        clearInterval(poll)
        const data = await fetchResults(jobId)
        setResults(data)

        // Create project skeleton — thumbnail filled in by ResultsPage later
        const project: SavedProject = {
          id:            crypto.randomUUID(),
          title:         file.name.replace(/\.[^.]+$/, ''),
          createdAt:     Date.now(),
          videoFilename: file.name,
          results:       data,
          thumbnail:     '',
        }
        pendingProjectRef.current = project
        setCurrentProject(project)
        saveProject(project)
        setView('results')
      } else if (updated.status === 'error') {
        clearInterval(poll)
      }
    }, 1500)
  }

  function handleThumbnailCapture(base64: string) {
    const proj = pendingProjectRef.current ?? currentProject
    if (!proj) return
    const updated = { ...proj, thumbnail: base64 }
    pendingProjectRef.current = null
    setCurrentProject(updated)
    saveProject(updated)
  }

  function handleResultsChange(updatedResults: TextOccurrence[]) {
    if (!currentProject) return
    const updated = { ...currentProject, results: updatedResults }
    setCurrentProject(updated)
    saveProject(updated)
  }

  function handleOpenProject(project: SavedProject) {
    setCurrentProject(project)
    setResults(project.results)
    // Serve the video from the backend (persisted in the uploads volume)
    setVideoUrl(apiUrl(`/api/video/${encodeURIComponent(project.videoFilename)}`))
    setVideoFilename(project.videoFilename)
    setView('results')
  }

  function handleReset() {
    setView('home')
    setJob(null)
    setUploadError(null)
    setResults([])
    if (videoUrl.startsWith('blob:')) URL.revokeObjectURL(videoUrl)
    setVideoUrl('')
    setVideoFilename('')
    setCurrentProject(null)
    pendingProjectRef.current = null
  }

  if (view === 'loading') return <LoadingPage logs={backendLogs} error={backendError} />
  if (view === 'analyzing' && job) return <AnalysisPage job={job} uploadError={uploadError} />
  if (view === 'analyzing') return <AnalysisPage job={null} uploadError={uploadError} />
  if (view === 'upload') return (
    <UploadPage
      onUpload={(file, mode) => handleUpload(file, mode)}
      onBack={() => setView('home')}
    />
  )
  if (view === 'results') return (
    <ResultsPage
      results={results}
      videoUrl={videoUrl}
      onReset={handleReset}
      onThumbnailCapture={handleThumbnailCapture}
      onResultsChange={handleResultsChange}
    />
  )
  return (
    <HomePage
      onNewProject={() => setView('upload')}
      onOpenProject={handleOpenProject}
    />
  )
}
