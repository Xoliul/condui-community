import { useEffect, useRef, useState } from 'react'
import type { ProjectDocument } from '@/lib/documents/projectDocuments'
import { loadPdfDocument } from './pdfDocuments'

interface PdfPageCanvasProps {
  document: ProjectDocument
  pageNumber: number
  /** CSS pixel width of the rendered page. */
  width: number
  /** Height / width of the page when known; the canvas keeps this box while rendering. */
  aspect?: number
  className?: string
  onError?: () => void
}

/** Browsers reject or blank canvases beyond ~16.7M pixels (Safari's limit is the lowest). */
const MAX_CANVAS_PIXELS = 16_000_000
/** Re-render only after zooming pauses; the current bitmap stretches meanwhile. */
const RENDER_SETTLE_MS = 150

/**
 * Renders one PDF page while it is near the viewport and frees the bitmap when it scrolls away,
 * so long documents stay light at high zoom.
 */
export function PdfPageCanvas({
  document,
  pageNumber,
  width,
  aspect: knownAspect,
  className,
  onError,
}: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const [loadedAspect, setLoadedAspect] = useState(1.414)
  const [renderWidth, setRenderWidth] = useState(width)
  // Metadata edits (name, export flag) replace the document object; only its source matters here.
  const documentRef = useRef(document)
  documentRef.current = document
  const sourceKey = `${document.id}|${document.url}`
  const aspect = knownAspect ?? loadedAspect

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: '400px' }
    )
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (renderWidth === width) return
    const timer = window.setTimeout(() => setRenderWidth(width), RENDER_SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [renderWidth, width])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!visible) {
      // Release the bitmap of pages far from view.
      if (canvas) {
        canvas.width = 0
        canvas.height = 0
      }
      return
    }
    if (renderWidth <= 0) return
    let cancelled = false
    let renderTask: { cancel?: () => void } | null = null
    void (async () => {
      try {
        const pdf = await loadPdfDocument(documentRef.current)
        const page = await pdf.getPage(pageNumber)
        if (cancelled) return
        const base = page.getViewport({ scale: 1 })
        setLoadedAspect(base.height / base.width)
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
        const scale = Math.min(
          (renderWidth / base.width) * pixelRatio,
          Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height))
        )
        const viewport = page.getViewport({ scale })
        const context = canvas?.getContext('2d')
        if (!canvas || !context) return
        canvas.width = Math.round(viewport.width)
        canvas.height = Math.round(viewport.height)
        const task = page.render({ canvasContext: context, viewport, background: 'white' })
        renderTask = task as { cancel?: () => void }
        await task.promise
      } catch {
        if (!cancelled) onError?.()
      }
    })()
    return () => {
      cancelled = true
      renderTask?.cancel?.()
    }
  }, [sourceKey, onError, pageNumber, visible, renderWidth])

  return (
    <canvas
      ref={canvasRef}
      className={`block bg-white ${className ?? ''}`}
      style={{ width, height: Math.round(width * aspect) }}
    />
  )
}
