import { KeyboardEvent, useEffect, useRef, useState } from 'react'
import { EditableOccurrence, Poly, TextOccurrence } from '../types'

interface Props {
  results: TextOccurrence[]
  videoUrl: string
  onReset: () => void
  onThumbnailCapture?: (base64: string) => void
  onResultsChange?: (results: TextOccurrence[]) => void
}

const TRACK_COLORS = [
  '#4a9eff', '#ff6b6b', '#ffd93d', '#6bcb77', '#c77dff',
  '#ff9f43', '#48dbfb', '#ff9ff3', '#54a0ff', '#5f27cd',
]

function fmt(s: number) {
  const m = Math.floor(s / 60)
  const sec = (s % 60).toFixed(1).padStart(4, '0')
  return `${m}:${sec}`
}

function parseFmt(s: string): number | null {
  const clean = s.trim()
  const m = clean.match(/^(\d+):(\d{1,2}(?:\.\d)?)$/)
  if (!m) return null
  const sec = parseFloat(m[2])
  if (sec >= 60) return null
  return parseInt(m[1], 10) * 60 + sec
}

function pointInPoly(pt: [number, number], poly: [number, number][]): boolean {
  const [x, y] = pt
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

function getPolyAt(item: EditableOccurrence, time: number): Poly {
  if (!item.polys || item.polys.length === 0) return item.poly
  let closest = item.polys[0]
  let minDiff = Math.abs(time - closest.time)
  for (const p of item.polys) {
    const diff = Math.abs(time - p.time)
    if (diff < minDiff) { minDiff = diff; closest = p }
  }
  return closest.poly as Poly
}

interface TimeEdit { id: string; start: string; end: string }

export default function ResultsPage({
  results, videoUrl, onReset, onThumbnailCapture, onResultsChange,
}: Props) {
  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const listRef   = useRef<HTMLDivElement>(null)
  const itemRefs  = useRef<Map<string, HTMLDivElement>>(new Map())
  const thumbnailDone = useRef(false)

  // ── video state ─────────────────────────────────────────────────────────
  const [duration,    setDuration]    = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 })
  const [overlayOn,   setOverlayOn]   = useState(true)

  // ── editable items ───────────────────────────────────────────────────────
  const [items, setItems] = useState<EditableOccurrence[]>(() =>
    results.map(r => ({ ...r, id: crypto.randomUUID() }))
  )
  const [selectedIds,     setSelectedIds]     = useState<Set<string>>(new Set())
  const [editingId,       setEditingId]       = useState<string | null>(null)
  const [editText,        setEditText]        = useState('')
  const [timeEdit,        setTimeEdit]        = useState<TimeEdit | null>(null)
  const [search,          setSearch]          = useState('')
  const [mergeOpen,       setMergeOpen]       = useState(false)
  const [mergeText,       setMergeText]       = useState('')
  const [mergeSelectedId, setMergeSelectedId] = useState<string | null>(null)
  const [undoStack,       setUndoStack]       = useState<EditableOccurrence[][]>([])

  // Propagate edits upstream so App can save the project
  useEffect(() => {
    onResultsChange?.(items.map(({ id: _id, ...rest }) => rest as TextOccurrence))
  }, [items])

  // Ctrl+Z undo
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !mergeOpen) {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undoStack, mergeOpen])

  // ── undo ─────────────────────────────────────────────────────────────────
  function pushUndo() {
    setUndoStack(prev => [...prev.slice(-19), [...items]])
  }

  function undo() {
    if (undoStack.length === 0) return
    const snapshot = undoStack[undoStack.length - 1]
    setUndoStack(prev => prev.slice(0, -1))
    setItems(snapshot)
    setSelectedIds(new Set())
    setEditingId(null)
    setTimeEdit(null)
  }

  // ── color helpers ────────────────────────────────────────────────────────
  function colorFor(id: string) {
    return TRACK_COLORS[items.findIndex(i => i.id === id) % TRACK_COLORS.length]
  }

  // ── selection ────────────────────────────────────────────────────────────
  function selectItem(id: string, multi: boolean) {
    if (editingId && editingId !== id) commitEdit()
    setSelectedIds(prev => {
      if (multi) {
        const next = new Set(prev)
        next.has(id) ? next.delete(id) : next.add(id)
        return next
      }
      return prev.has(id) && prev.size === 1 ? new Set() : new Set([id])
    })
  }

  function scrollToItem(id: string) {
    itemRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  // ── text editing ─────────────────────────────────────────────────────────
  function startEdit(id: string) {
    const item = items.find(i => i.id === id)
    if (!item) return
    setEditingId(id)
    setEditText(item.text)
    setSelectedIds(new Set([id]))
  }

  function commitEdit() {
    if (editingId && editText.trim()) {
      pushUndo()
      setItems(prev => prev.map(i => i.id === editingId ? { ...i, text: editText.trim() } : i))
    }
    setEditingId(null)
  }

  function onEditKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit() }
    if (e.key === 'Escape') setEditingId(null)
  }

  // ── time editing ─────────────────────────────────────────────────────────
  function openTimeEdit(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    const item = items.find(i => i.id === id)
    if (!item) return
    setTimeEdit({ id, start: fmt(item.start_time), end: fmt(item.end_time) })
  }

  function commitTimeEdit() {
    if (!timeEdit) return
    const start = parseFmt(timeEdit.start)
    const end   = parseFmt(timeEdit.end)
    if (start !== null && end !== null && end >= start) {
      pushUndo()
      setItems(prev => prev.map(i =>
        i.id === timeEdit.id ? { ...i, start_time: start, end_time: end } : i
      ))
    }
    setTimeEdit(null)
  }

  function onTimeEditKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') commitTimeEdit()
    if (e.key === 'Escape') setTimeEdit(null)
  }

  // ── delete ───────────────────────────────────────────────────────────────
  function deleteItem(id: string) {
    pushUndo()
    setItems(prev => prev.filter(i => i.id !== id))
    setSelectedIds(prev => { const s = new Set(prev); s.delete(id); return s })
    if (editingId === id) setEditingId(null)
  }

  // ── merge ────────────────────────────────────────────────────────────────
  function openMerge() {
    if (editingId) commitEdit()
    const sel     = items.filter(i => selectedIds.has(i.id))
    const longest = sel.reduce((b, c) => c.text.length > b.text.length ? c : b)
    setMergeSelectedId(longest.id)
    setMergeText(longest.text)
    setMergeOpen(true)
  }

  function confirmMerge() {
    if (!mergeText.trim()) return
    const ids  = new Set(selectedIds)
    const text = mergeText.trim()
    pushUndo()
    setItems(prev => {
      const sel = prev.filter(i => ids.has(i.id)).sort((a, b) => a.start_time - b.start_time)
      if (sel.length === 0) return prev
      const merged: EditableOccurrence = {
        id:         crypto.randomUUID(),
        text,
        start_time: sel[0].start_time,
        end_time:   sel[sel.length - 1].end_time,
        poly:       sel[0].poly,
        polys:      sel.flatMap(i => i.polys ?? []),
        confidence: sel.reduce((s, i) => s + i.confidence, 0) / sel.length,
      }
      const firstIdx = prev.findIndex(i => ids.has(i.id))
      const filtered = prev.filter(i => !ids.has(i.id))
      if (firstIdx >= 0) filtered.splice(firstIdx, 0, merged)
      else filtered.push(merged)
      return filtered
    })
    setSelectedIds(new Set())
    setMergeOpen(false)
  }

  // ── CSV export ───────────────────────────────────────────────────────────
  function exportCSV() {
    const header = 'Text,Start (s),End (s),Duration (s),Confidence\n'
    const rows = items.map(r =>
      [
        `"${r.text.replace(/"/g, '""')}"`,
        r.start_time.toFixed(3),
        r.end_time.toFixed(3),
        (r.end_time - r.start_time).toFixed(3),
        (Math.round(r.confidence * 100) + '%'),
      ].join(',')
    ).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = 'sceneocr-export.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── canvas overlay ───────────────────────────────────────────────────────
  function onLoadedMetadata(e: React.SyntheticEvent<HTMLVideoElement>) {
    const v = e.target as HTMLVideoElement
    setDuration(v.duration)
    setNaturalSize({ w: v.videoWidth, h: v.videoHeight })
  }

  // Capture thumbnail from the middle of the video (once, after metadata is ready).
  // Detects and removes black bars (letterbox / pillarbox), then center-crops to 16:9.
  useEffect(() => {
    if (thumbnailDone.current || naturalSize.w === 0 || duration === 0 || !videoRef.current) return
    const video = videoRef.current

    const capture = () => {
      video.removeEventListener('seeked', capture)

      // Draw at a working resolution (wide enough for accurate bar detection)
      const workW = 640
      const workH = Math.round(640 * naturalSize.h / naturalSize.w)
      const work  = document.createElement('canvas')
      work.width  = workW
      work.height = workH
      const ctx   = work.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(video, 0, 0, workW, workH)

      // Average brightness of a full row (sample every 4th pixel for speed)
      function rowBrightness(y: number): number {
        const d = ctx!.getImageData(0, y, workW, 1).data
        let sum = 0, n = 0
        for (let i = 0; i < d.length; i += 16, n++) sum += (d[i] + d[i+1] + d[i+2]) / 3
        return n ? sum / n : 0
      }
      // Average brightness of a full column
      function colBrightness(x: number): number {
        const d = ctx!.getImageData(x, 0, 1, workH).data
        let sum = 0, n = 0
        for (let i = 0; i < d.length; i += 16, n++) sum += (d[i] + d[i+1] + d[i+2]) / 3
        return n ? sum / n : 0
      }

      const BLACK      = 8    // brightness threshold for "black bar"
      const MAX_CROP   = 0.3  // don't crop more than 30% from any side
      const maxTopScan = Math.floor(workH * MAX_CROP)
      const maxBotScan = workH - 1 - maxTopScan
      const maxLftScan = Math.floor(workW * MAX_CROP)
      const maxRgtScan = workW - 1 - maxLftScan

      let top = 0, bot = workH - 1, lft = 0, rgt = workW - 1
      while (top < maxTopScan && rowBrightness(top) < BLACK) top++
      while (bot > maxBotScan && rowBrightness(bot) < BLACK) bot--
      while (lft < maxLftScan && colBrightness(lft) < BLACK) lft++
      while (rgt > maxRgtScan && colBrightness(rgt) < BLACK) rgt--

      let cx = lft, cy = top
      let cw = rgt - lft + 1
      let ch = bot - top + 1

      // Fallback: if nothing was detected just use the full frame
      if (cw <= 0 || ch <= 0) { cx = 0; cy = 0; cw = workW; ch = workH }

      // Center-crop content area to 16:9
      const AR = 16 / 9
      if (cw / ch > AR) {
        const nw = Math.round(ch * AR)
        cx += Math.round((cw - nw) / 2)
        cw  = nw
      } else if (cw / ch < AR) {
        const nh = Math.round(cw / AR)
        cy += Math.round((ch - nh) / 2)
        ch  = nh
      }

      // Render final 320×180 thumbnail
      const out    = document.createElement('canvas')
      out.width    = 320
      out.height   = 180
      const outCtx = out.getContext('2d')
      if (!outCtx) return
      outCtx.drawImage(work, cx, cy, cw, ch, 0, 0, 320, 180)

      const dataUrl = out.toDataURL('image/jpeg', 0.75)
      if (dataUrl.length > 1000) {
        thumbnailDone.current = true
        onThumbnailCapture?.(dataUrl)
        // Reset playback to the start after capturing the thumbnail
        video.currentTime = 0
      }
    }

    video.addEventListener('seeked', capture)
    video.currentTime = duration / 2
  }, [naturalSize, duration])

  function getScaleOffset() {
    const video = videoRef.current
    if (!video || naturalSize.w === 0) return null
    const rect  = video.getBoundingClientRect()
    const scale = Math.min(rect.width / naturalSize.w, rect.height / naturalSize.h)
    return {
      scale,
      ox: (rect.width  - naturalSize.w * scale) / 2,
      oy: (rect.height - naturalSize.h * scale) / 2,
      w:  rect.width,
      h:  rect.height,
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const so = getScaleOffset()
    if (!so) return

    canvas.width  = so.w
    canvas.height = so.h
    ctx.clearRect(0, 0, so.w, so.h)
    if (!overlayOn) return

    const active = items.filter(r =>
      currentTime >= r.start_time - 0.1 && currentTime <= r.end_time + 0.1
    )

    ctx.font = 'bold 12px -apple-system, sans-serif'
    ctx.lineWidth = 2

    active.forEach(r => {
      const color    = colorFor(r.id)
      const isSelect = selectedIds.has(r.id)
      // Use the time-varying poly for the current playback position
      const poly     = getPolyAt(r, currentTime)
      const pts      = poly.map(([px, py]) =>
        [px * so.scale + so.ox, py * so.scale + so.oy] as [number, number]
      )

      ctx.strokeStyle = isSelect ? '#fff' : color
      ctx.lineWidth   = isSelect ? 3 : 2
      ctx.beginPath()
      ctx.moveTo(pts[0][0], pts[0][1])
      pts.slice(1).forEach(([x, y]) => ctx.lineTo(x, y))
      ctx.closePath()
      ctx.stroke()

      const label = r.text.length > 40 ? r.text.slice(0, 38) + '…' : r.text
      const tw    = ctx.measureText(label).width
      const [lx, ly] = pts[0]
      const py2   = ly > 22 ? ly - 20 : ly + 22
      ctx.fillStyle = color + 'dd'
      ctx.beginPath()
      ctx.roundRect(lx, py2 - 14, tw + 10, 18, 4)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.fillText(label, lx + 5, py2)
    })
  }, [currentTime, overlayOn, items, selectedIds, naturalSize])

  // Click capture on video-wrap: handle bbox clicks before video handles play/pause.
  // Only intercept clicks that land inside the actual rendered video frame area —
  // clicks in the native controls strip at the bottom always fall through.
  function handleVideoWrapCapture(e: React.MouseEvent<HTMLDivElement>) {
    if (!overlayOn || naturalSize.w === 0) return
    const video = videoRef.current
    if (!video) return

    const so = getScaleOffset()
    if (!so) return

    const rect = video.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top

    // Reject clicks below the rendered video frame (native controls area)
    const frameBottom = so.oy + naturalSize.h * so.scale
    if (cy > frameBottom) return

    const active = items.filter(r =>
      currentTime >= r.start_time - 0.1 && currentTime <= r.end_time + 0.1
    )

    for (const item of active) {
      const poly = getPolyAt(item, currentTime)
      const pts  = poly.map(([px, py]) =>
        [px * so.scale + so.ox, py * so.scale + so.oy] as [number, number]
      )
      if (pointInPoly([cx, cy], pts)) {
        e.stopPropagation()
        selectItem(item.id, e.ctrlKey || e.metaKey)
        startEdit(item.id)
        scrollToItem(item.id)
        return
      }
    }
  }

  function seekTo(time: number, id: string) {
    const video = videoRef.current
    if (video) {
      video.currentTime = time
      video.play().catch(() => {})
    }
    setCurrentTime(time)   // update overlay immediately, don't wait for onTimeUpdate
    selectItem(id, false)
  }

  const filtered = items.filter(r =>
    r.text.toLowerCase().includes(search.toLowerCase())
  )
  const selCount = selectedIds.size

  return (
    <div className="results-page">
      <header className="results-header">
        <div className="results-header-left">
          <button type="button" className="btn-back" onClick={onReset} title="Back to projects">
            ←
          </button>
          <span className="results-count">{items.length} text occurrence{items.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="results-header-right">
          <button
            type="button"
            className="btn-secondary"
            onClick={undo}
            disabled={undoStack.length === 0}
            title="Undo (Ctrl+Z)"
          >
            Undo
          </button>
          {selCount >= 2 && (
            <button type="button" className="btn-merge" onClick={openMerge}>
              Merge ({selCount})
            </button>
          )}
          {selCount > 0 && (
            <button type="button" className="btn-secondary" onClick={() => setSelectedIds(new Set())}>
              Deselect
            </button>
          )}
          <input
            className="search-input"
            type="text"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button type="button" className="btn-secondary" onClick={exportCSV}>
            Export CSV
          </button>
        </div>
      </header>

      <div className="results-body">
        <div className="video-pane">
          <div
            className={`video-wrap${overlayOn ? ' overlay-active' : ''}`}
            onClickCapture={handleVideoWrapCapture}
          >
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              className="video-player"
              onLoadedMetadata={onLoadedMetadata}
              onTimeUpdate={e => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
            />
            <canvas
              ref={canvasRef}
              className={`video-overlay${overlayOn ? ' visible' : ''}`}
            />
            <button
              type="button"
              className={`overlay-toggle${overlayOn ? ' active' : ''}`}
              onClick={() => setOverlayOn(!overlayOn)}
              title="Show text positions (click box to select)"
            >
              {overlayOn ? '⊠ Overlay on' : '⊡ Overlay'}
            </button>
          </div>

          {duration > 0 && (
            <div className="timeline">
              <div className="timeline-label">Timeline</div>
              <div className="timeline-bar">
                {items.map((r, i) => (
                  <div
                    key={r.id}
                    className="timeline-segment"
                    title={`${r.text}  (${fmt(r.start_time)} – ${fmt(r.end_time)})`}
                    style={{
                      '--seg-left':  `${(r.start_time / duration) * 100}%`,
                      '--seg-width': `${Math.max(0.3, (r.end_time - r.start_time) / duration * 100)}%`,
                      '--seg-color': TRACK_COLORS[i % TRACK_COLORS.length],
                      '--seg-top':   `${(i % 8) * 5 + 2}px`,
                    } as React.CSSProperties}
                    onClick={() => seekTo(r.start_time, r.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="text-list-pane" ref={listRef}>
          {filtered.length === 0 && (
            <div className="empty-state">No results{search ? ` for "${search}"` : ''}</div>
          )}
          {filtered.map(r => (
            <div
              key={r.id}
              ref={el => el ? itemRefs.current.set(r.id, el) : itemRefs.current.delete(r.id)}
              className={[
                'text-item',
                selectedIds.has(r.id) ? 'selected' : '',
                editingId === r.id    ? 'editing'  : '',
              ].join(' ').trim()}
              onClick={e => {
                if (editingId !== r.id && timeEdit?.id !== r.id) {
                  if (e.ctrlKey || e.metaKey) selectItem(r.id, true)
                  else seekTo(r.start_time, r.id)
                }
              }}
              onDoubleClick={() => startEdit(r.id)}
            >
              <div
                className="text-item-bar"
                style={{ '--bar-color': colorFor(r.id) } as React.CSSProperties}
              />
              <div className="text-item-body">
                {editingId === r.id ? (
                  <input
                    className="text-item-input"
                    aria-label="Edit text"
                    placeholder="Enter text…"
                    autoFocus
                    value={editText}
                    onChange={e => setEditText(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={onEditKey}
                    onClick={e => e.stopPropagation()}
                  />
                ) : (
                  <div
                    className="text-item-text"
                    title="Double-click to edit"
                  >
                    {r.text}
                  </div>
                )}
                <div className="text-item-meta">
                  {timeEdit?.id === r.id ? (
                    <span className="time-edit-row" onClick={e => e.stopPropagation()}>
                      <input
                        className="time-edit-input"
                        aria-label="Start time"
                        value={timeEdit.start}
                        onChange={e => setTimeEdit(prev => prev ? { ...prev, start: e.target.value } : null)}
                        onBlur={commitTimeEdit}
                        onKeyDown={onTimeEditKey}
                        autoFocus
                      />
                      <span className="time-edit-sep">–</span>
                      <input
                        className="time-edit-input"
                        aria-label="End time"
                        value={timeEdit.end}
                        onChange={e => setTimeEdit(prev => prev ? { ...prev, end: e.target.value } : null)}
                        onBlur={commitTimeEdit}
                        onKeyDown={onTimeEditKey}
                      />
                    </span>
                  ) : (
                    <span
                      className="time-badge editable"
                      title="Click to edit times"
                      onClick={e => openTimeEdit(r.id, e)}
                    >
                      {fmt(r.start_time)} – {fmt(r.end_time)}
                    </span>
                  )}
                  <span className="duration-badge">{(r.end_time - r.start_time).toFixed(1)} s</span>
                  <span className="confidence-badge">{Math.round(r.confidence * 100)}%</span>
                </div>
              </div>
              <button
                type="button"
                className="item-delete"
                title="Delete"
                onClick={e => { e.stopPropagation(); deleteItem(r.id) }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {mergeOpen && (
        <div className="merge-overlay" onClick={() => setMergeOpen(false)}>
          <div className="merge-dialog" onClick={e => e.stopPropagation()}>
            <h3 className="merge-title">
              Merge {selCount} items
            </h3>
            <div className="merge-info">
              {(() => {
                const sel = items.filter(i => selectedIds.has(i.id)).sort((a, b) => a.start_time - b.start_time)
                return `Time range: ${fmt(sel[0]?.start_time ?? 0)} – ${fmt(sel[sel.length - 1]?.end_time ?? 0)}`
              })()}
            </div>
            <label className="merge-label">Text to keep</label>
            <div className="merge-radio-list">
              {items
                .filter(i => selectedIds.has(i.id))
                .sort((a, b) => a.start_time - b.start_time)
                .map(item => (
                  <label
                    key={item.id}
                    className={`merge-radio-option${mergeSelectedId === item.id ? ' selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="merge-text"
                      value={item.id}
                      checked={mergeSelectedId === item.id}
                      onChange={() => {
                        setMergeSelectedId(item.id)
                        setMergeText(item.text)
                      }}
                    />
                    <span className="merge-radio-text">{item.text}</span>
                    <span className="merge-radio-time">{fmt(item.start_time)}–{fmt(item.end_time)}</span>
                  </label>
                ))
              }
            </div>
            <label className="merge-label">Canonical text</label>
            <input
              className="merge-input"
              aria-label="Canonical text for merge"
              placeholder="Enter text…"
              value={mergeText}
              onChange={e => { setMergeText(e.target.value); setMergeSelectedId(null) }}
              onKeyDown={e => { if (e.key === 'Enter') confirmMerge(); if (e.key === 'Escape') setMergeOpen(false) }}
            />
            <div className="merge-actions">
              <button type="button" className="btn-primary" onClick={confirmMerge}>Merge</button>
              <button type="button" className="btn-secondary" onClick={() => setMergeOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
