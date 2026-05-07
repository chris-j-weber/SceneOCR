import { SavedProject } from './types'

const STORAGE_KEY = 'sceneocr_projects'

export function loadProjects(): SavedProject[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

export function saveProject(project: SavedProject): void {
  const projects = loadProjects()
  const idx = projects.findIndex(p => p.id === project.id)
  if (idx >= 0) projects[idx] = project
  else projects.unshift(project)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
}

export function deleteProject(id: string): void {
  const projects = loadProjects().filter(p => p.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
}

export function updateProject(id: string, patch: Partial<SavedProject>): void {
  const projects = loadProjects()
  const idx = projects.findIndex(p => p.id === id)
  if (idx >= 0) {
    projects[idx] = { ...projects[idx], ...patch }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects))
  }
}
