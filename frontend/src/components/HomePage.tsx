import { useEffect, useRef, useState } from 'react'
import { deleteProject, loadProjects, updateProject } from '../db'
import { SavedProject } from '../types'

interface Props {
  onNewProject: () => void
  onOpenProject: (project: SavedProject) => void
}

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
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId && inputRef.current) inputRef.current.focus()
  }, [editingId])

  function startRename(p: SavedProject, e: React.MouseEvent) {
    e.stopPropagation()
    setEditingId(p.id)
    setEditTitle(p.title)
  }

  function commitRename() {
    if (!editingId) return
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

  return (
    <div className="home-page">
      <header className="home-header">
        <h1 className="app-title">SceneOCR</h1>
        <p className="app-subtitle">On-screen text recognition — local, no cloud</p>
      </header>

      <div className="project-grid">
        <button type="button" className="project-card new-card" onClick={onNewProject}>
          <div className="new-card-icon">+</div>
          <div className="new-card-label">New Project</div>
        </button>

        {projects.map(p => (
          <div
            key={p.id}
            className="project-card"
            onClick={() => onOpenProject(p)}
            title={p.videoFilename}
          >
            <div className="project-thumb">
              {p.thumbnail
                ? <img src={p.thumbnail} alt="" />
                : <div className="project-thumb-placeholder">🎬</div>
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
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <div className="project-title" onDoubleClick={e => startRename(p, e)}>
                  {p.title}
                </div>
              )}
              <div className="project-meta">
                <span>{formatDate(p.createdAt)}</span>
                <span>{p.results.length} occurrence{p.results.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="project-filename">{p.videoFilename}</div>
            </div>
            <div className="project-actions">
              <button
                type="button"
                className="project-rename-btn"
                title="Rename"
                onClick={e => startRename(p, e)}
              >
                ✎
              </button>
              <button
                type="button"
                className="project-delete-btn"
                title="Delete"
                onClick={e => handleDelete(p.id, e)}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      {projects.length === 0 && (
        <p className="home-empty">No projects yet. Create a new one to get started.</p>
      )}
    </div>
  )
}
