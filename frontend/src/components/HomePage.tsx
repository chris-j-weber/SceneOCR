import { useEffect, useRef, useState } from 'react'
import { apiUrl } from '../api'
import { deleteProject, loadProjects, updateProject } from '../db'
import { SavedProject } from '../types'

interface Props {
  onNewProject: () => void
  onOpenProject: (project: SavedProject) => void
}

interface ProviderInfo { provider: string | null; ready: boolean }

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function HomePage({ onNewProject, onOpenProject }: Props) {
  const [projects, setProjects] = useState<SavedProject[]>(() => loadProjects())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [providerInfo, setProviderInfo] = useState<ProviderInfo | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef(false)

  useEffect(() => {
    if (editingId && inputRef.current) inputRef.current.select()
  }, [editingId])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    async function poll() {
      try {
        const data: ProviderInfo = await fetch(apiUrl('/api/info')).then(r => r.json())
        setProviderInfo(data)
        if (!data.ready) timer = setTimeout(poll, 2000)
      } catch { /* backend not yet reachable */ }
    }
    poll()
    return () => { if (timer) clearTimeout(timer) }
  }, [])

  function startRename(p: SavedProject, e: React.MouseEvent) {
    e.stopPropagation()
    setEditingId(p.id)
    setEditTitle(p.title)
  }

  function commitRename() {
    if (!editingId) return
    if (cancelRef.current) { cancelRef.current = false; setEditingId(null); return }
    const title = editTitle.trim() || 'Untitled Project'
    updateProject(editingId, { title })
    setProjects(prev => prev.map(p => p.id === editingId ? { ...p, title } : p))
    setEditingId(null)
  }

  function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('Delete project?')) return
    deleteProject(id)
    setProjects(prev => prev.filter(p => p.id !== id))
  }

  const isGpu = !!providerInfo?.provider?.includes('GPU')

  return (
    <div className="home-page">
      <div className="home-inner">
        <header className="home-header">
          <div className="home-brand">
            <h1 className="home-wordmark-wrap">
              <img className="home-wordmark" src="/logo.png" alt="SceneOCR" />
            </h1>
            <p className="app-subtitle">On-screen text recognition — local, no cloud</p>
          </div>
          {providerInfo && (
            <div
              className={`provider-badge${providerInfo.ready ? (isGpu ? ' gpu' : '') : ' loading'}`}
              title={providerInfo.ready ? (providerInfo.provider ?? 'CPU') : 'OCR engine loading…'}
            >
              <span className="provider-badge-icon">
                {!providerInfo.ready ? '···' : isGpu ? '⚡' : '▣'}
              </span>
              <span className="provider-badge-label">
                {!providerInfo.ready ? 'Loading' : isGpu ? 'GPU' : 'CPU'}
              </span>
            </div>
          )}
        </header>

        <div className="home-toolbar">
          <h2 className="home-section-title">Projects</h2>
          {projects.length > 0 && (
            <span className="home-count">{projects.length} project{projects.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        <div className="project-grid">
          <button type="button" className="project-card new-card" onClick={onNewProject}>
            <div className="new-card-icon">+</div>
            <div className="new-card-label">New Project</div>
            <div className="new-card-hint">Analyze a video</div>
          </button>

          {projects.map(p => (
            <div
              key={p.id}
              className="project-card"
              role="button"
              tabIndex={0}
              onClick={() => onOpenProject(p)}
              onKeyDown={e => {
                if (editingId === p.id) return
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenProject(p) }
              }}
              title={p.videoFilename}
            >
              <div className="project-thumb">
                {p.thumbnail
                  ? <img src={p.thumbnail} alt="" />
                  : <div className="project-thumb-placeholder" aria-hidden="true">🎬</div>
                }
              </div>
              <div className="project-info">
                {editingId === p.id ? (
                  <input
                    ref={inputRef}
                    className="project-title-input"
                    aria-label="Project title"
                    placeholder="Project title"
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') { cancelRef.current = true; setEditingId(null) }
                    }}
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <div className="project-title">{p.title}</div>
                )}
                <div className="project-meta">
                  <span className="project-date">{formatDate(p.createdAt)}</span>
                  <span className="project-occurrences">
                    {p.results.length} occurrence{p.results.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="project-filename">{p.videoFilename}</div>
              </div>
              <div className="project-actions">
                <button
                  type="button"
                  className="project-rename-btn"
                  title="Rename"
                  aria-label="Rename project"
                  onClick={e => startRename(p, e)}
                >
                  ✎
                </button>
                <button
                  type="button"
                  className="project-delete-btn"
                  title="Delete"
                  aria-label="Delete project"
                  onClick={e => handleDelete(p.id, e)}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>

        {projects.length === 0 && (
          <p className="home-empty">No projects yet — create a new one to get started.</p>
        )}
      </div>
    </div>
  )
}
