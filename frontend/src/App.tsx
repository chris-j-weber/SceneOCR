import { useRef, useState } from 'react'
import { fetchResults, pollJob, uploadVideo } from './api'
import AnalysisPage from './components/AnalysisPage'
import HomePage from './components/HomePage'
import ResultsPage from './components/ResultsPage'
import UploadPage from './components/UploadPage'
import { saveProject } from './db'
import { Job, SavedProject, TextOccurrence } from './types'

type View = 'home' | 'upload' | 'analyzing' | 'results'

export default function App() {
  const [view,            setView]            = useState<View>('home')
  const [job,             setJob]             = useState<Job | null>(null)
  const [results,         setResults]         = useState<TextOccurrence[]>([])
  const [videoUrl,        setVideoUrl]        = useState<string>('')
  const [videoFilename,   setVideoFilename]   = useState<string>('')
  const [currentProject,  setCurrentProject]  = useState<SavedProject | null>(null)
  const pendingProjectRef = useRef<SavedProject | null>(null)

  async function handleUpload(file: File, mode: string) {
    const blobUrl = URL.createObjectURL(file)
    setVideoUrl(blobUrl)
    setVideoFilename(file.name)
    setView('analyzing')

    const jobId = await uploadVideo(file, mode)

    const poll = setInterval(async () => {
      const updated = await pollJob(jobId)
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
    setVideoUrl(`/api/video/${encodeURIComponent(project.videoFilename)}`)
    setVideoFilename(project.videoFilename)
    setView('results')
  }

  function handleReset() {
    setView('home')
    setJob(null)
    setResults([])
    if (videoUrl.startsWith('blob:')) URL.revokeObjectURL(videoUrl)
    setVideoUrl('')
    setVideoFilename('')
    setCurrentProject(null)
    pendingProjectRef.current = null
  }

  if (view === 'analyzing' && job) return <AnalysisPage job={job} />
  if (view === 'analyzing') return <AnalysisPage job={null} />
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
