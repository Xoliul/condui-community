import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Trash2 } from 'lucide-react'
import { ExportPdfIcon } from '@/components/icons/UiIcons'
import { useDialog } from '@/hooks/useDialog'
import { logger } from '@/lib/logger'
import {
  canExportProjectDocument,
  getExportedDocumentPages,
  toggleProjectDocumentExportPage,
  type ProjectDocument,
} from '@/lib/documents/projectDocuments'
import {
  deleteProjectDocumentPage,
  deleteProjectDocumentPages,
  updateProjectDocument,
} from '@/stores/projectDocumentsStore'
import { loadPdfDocument } from './pdfDocuments'
import { PageDeleteGrid } from './PageDeleteGrid'
import { PdfPageCanvas } from './PdfPageCanvas'

/** Viewer zoom is relative to fitting the page width: 1 fits, 5 is 500 %. */
export const DOCUMENT_VIEWER_MIN_ZOOM = 0.25
export const DOCUMENT_VIEWER_MAX_ZOOM = 5

const GUTTER_PX = 24
const PAGE_GAP_PX = 16
/** Room left of each page for its export and delete buttons. */
const PAGE_CONTROLS_PX = 64
const MAX_FIT_WIDTH_PX = 1100
/** Documents longer than this get the bulk page-delete overview. */
const BULK_DELETE_MIN_PAGES = 5
const SCROLLBAR_MIN_THUMB_PX = 32

type Point = { x: number; y: number }

function clampZoom(zoom: number): number {
  return Math.min(DOCUMENT_VIEWER_MAX_ZOOM, Math.max(DOCUMENT_VIEWER_MIN_ZOOM, zoom))
}

/** Pans freely until the document's edge reaches the middle of the view. */
function clampAxis(offset: number, content: number, view: number): number {
  return Math.min(view / 2, Math.max(view / 2 - content, offset))
}

/** Framed position: centered when smaller than the view, else aligned to its start. */
function fitAxis(content: number, view: number): number {
  return content <= view ? (view - content) / 2 : 0
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setSize({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, size] as const
}

/** Height / width of every page, read once per file. */
function usePageAspects(document: ProjectDocument, onError: () => void): number[] | null {
  const [aspects, setAspects] = useState<number[] | null>(null)
  const documentRef = useRef(document)
  documentRef.current = document
  const sourceKey = `${document.id}|${document.url}`

  useEffect(() => {
    setAspects(null)
    let cancelled = false
    const current = documentRef.current
    if (current.kind === 'image') {
      const image = new Image()
      image.onload = () => {
        if (!cancelled) setAspects([image.naturalHeight / Math.max(1, image.naturalWidth)])
      }
      image.onerror = () => !cancelled && onError()
      image.src = current.url
    } else {
      loadPdfDocument(current)
        .then(async (pdf) => {
          const pages = await Promise.all(
            Array.from({ length: pdf.numPages }, (_, index) => pdf.getPage(index + 1))
          )
          if (cancelled) return
          setAspects(
            pages.map((page) => {
              const viewport = page.getViewport({ scale: 1 })
              return viewport.height / viewport.width
            })
          )
        })
        .catch(() => !cancelled && onError())
    }
    return () => {
      cancelled = true
    }
  }, [sourceKey, onError])

  return aspects
}

function PageControls({
  document,
  pageNumber,
  pageCount,
  included,
}: {
  document: ProjectDocument
  pageNumber: number
  pageCount: number
  included: boolean
}) {
  const { t } = useTranslation()
  const dialog = useDialog()
  const [deleting, setDeleting] = useState(false)
  const canDelete = document.origin === 'upload' && pageCount > 1
  const exportable = canExportProjectDocument(document)
  const buttonClassName =
    'flex h-10 w-10 items-center justify-center rounded-md border shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500'

  return (
    <div
      className="absolute top-0 flex flex-col gap-2"
      style={{ right: `calc(100% + 12px)` }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {exportable && (
        <button
          type="button"
          data-testid="document-page-export-toggle"
          aria-pressed={included}
          aria-label={t('projectDocuments.includePage')}
          title={t('projectDocuments.includePage')}
          onClick={() =>
            updateProjectDocument(
              document.id,
              toggleProjectDocumentExportPage(document, pageNumber, pageCount)
            )
          }
          className={`${buttonClassName} ${
            included
              ? 'border-sky-500 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-400 dark:bg-sky-900/40 dark:text-sky-300'
              : 'border-gray-300 bg-white text-gray-400 hover:border-sky-400 hover:bg-sky-50 hover:text-sky-600 dark:border-gray-600 dark:bg-gray-700 dark:hover:bg-gray-600'
          }`}
        >
          <ExportPdfIcon className="h-6 w-6" />
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          data-testid="document-page-delete"
          aria-label={t('projectDocuments.deletePage')}
          title={t('projectDocuments.deletePage')}
          disabled={deleting}
          onClick={() =>
            dialog.confirm({
              title: t('projectDocuments.deletePageConfirmTitle'),
              message: t('projectDocuments.deletePageConfirmMessage', {
                page: pageNumber,
                name: document.name,
              }),
              variant: 'danger',
              confirmLabel: t('projectDocuments.deletePage'),
              onConfirm: () => {
                setDeleting(true)
                deleteProjectDocumentPage(document.id, pageNumber)
                  .catch((error) => {
                    logger.warn('[documents] page delete failed:', error)
                    dialog.info({
                      title: t('projectDocuments.deletePage'),
                      message: t('projectDocuments.deletePageFailed'),
                      variant: 'error',
                    })
                  })
                  .finally(() => setDeleting(false))
              },
            })
          }
          className={`${buttonClassName} border-gray-300 bg-white text-gray-400 hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-700 dark:hover:bg-red-950/40`}
        >
          {deleting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" />}
        </button>
      )}
    </div>
  )
}

/** Vertical scrollbar for the panned page stack: drag the thumb, or click the track to page. */
function DocumentScrollbar({
  scrollTop,
  maxScroll,
  viewHeight,
  onScrollTo,
}: {
  scrollTop: number
  maxScroll: number
  viewHeight: number
  onScrollTo: (scrollTop: number) => void
}) {
  const drag = useRef<{ startY: number; startScroll: number } | null>(null)
  if (maxScroll <= 0 || viewHeight <= 0) return null
  const contentHeight = viewHeight + maxScroll
  const thumbHeight = Math.max(SCROLLBAR_MIN_THUMB_PX, (viewHeight / contentHeight) * viewHeight)
  const travel = Math.max(1, viewHeight - thumbHeight)
  const clamped = Math.min(maxScroll, Math.max(0, scrollTop))
  const thumbTop = (clamped / maxScroll) * travel

  return (
    <div
      className="absolute bottom-0 right-0 top-0 z-10 w-3 bg-gray-200/40 dark:bg-gray-700/30"
      data-testid="document-scrollbar"
      onPointerDown={(event) => {
        event.stopPropagation()
        if (event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        const clickedTop = event.clientY - rect.top
        onScrollTo(clamped + (clickedTop < thumbTop ? -viewHeight : viewHeight) * 0.9)
      }}
    >
      <div
        className="absolute left-0.5 right-0.5 cursor-default rounded-full bg-gray-400/70 hover:bg-gray-500/80 dark:bg-gray-500/70 dark:hover:bg-gray-400/80"
        style={{ top: thumbTop, height: thumbHeight }}
        onPointerDown={(event) => {
          event.stopPropagation()
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { startY: event.clientY, startScroll: clamped }
        }}
        onPointerMove={(event) => {
          if (!drag.current) return
          onScrollTo(
            drag.current.startScroll + ((event.clientY - drag.current.startY) / travel) * maxScroll
          )
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      />
    </div>
  )
}

/**
 * Pannable, zoomable document view clipped to its own box. Single pages zoom with the wheel;
 * multi-page PDFs scroll with it. Pinch (touch or touchpad) and Ctrl+wheel always zoom, and
 * dragging pans. Multi-page PDFs get per-page export and delete buttons.
 */
export function DocumentViewer({
  document,
  zoom,
  onZoomChange,
  fitKey,
}: {
  document: ProjectDocument
  zoom: number
  onZoomChange: (zoom: number) => void
  /** Changes when the view should return to fitting the page width. */
  fitKey: number
}) {
  const { t } = useTranslation()
  const [viewportRef, viewport] = useElementSize<HTMLDivElement>()
  const [failed, setFailed] = useState(false)
  const handleError = useCallback(() => setFailed(true), [])
  const aspects = usePageAspects(document, handleError)
  const pageCount = aspects?.length ?? 0
  const multiPage = document.kind === 'pdf' && pageCount > 1
  const pageSelectable = multiPage && canExportProjectDocument(document)
  const canBulkDelete =
    document.origin === 'upload' && document.kind === 'pdf' && pageCount > BULK_DELETE_MIN_PAGES
  const [selectingPages, setSelectingPages] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const dialog = useDialog()
  const exportedPages = new Set(getExportedDocumentPages(document, pageCount))

  const leftSpace = multiPage ? PAGE_CONTROLS_PX : GUTTER_PX
  const fitWidth = Math.max(120, Math.min(viewport.width - leftSpace - GUTTER_PX, MAX_FIT_WIDTH_PX))
  const pageWidth = Math.round(fitWidth * zoom)
  const pageGap = Math.round(PAGE_GAP_PX * zoom)
  const contentWidth = leftSpace + pageWidth + GUTTER_PX
  const contentHeight =
    2 * GUTTER_PX +
    (aspects ?? []).reduce((total, aspect) => total + Math.round(pageWidth * aspect), 0) +
    pageGap * Math.max(0, pageCount - 1)

  // Null while framed, so the document stays framed as the view or pages resize.
  const [rawPan, setRawPan] = useState<Point | null>(null)
  const clampPan = useCallback(
    (pan: Point): Point => ({
      x: clampAxis(pan.x, contentWidth, viewport.width),
      y: clampAxis(pan.y, contentHeight, viewport.height),
    }),
    [contentHeight, contentWidth, viewport.height, viewport.width]
  )
  const pan = rawPan
    ? clampPan(rawPan)
    : { x: fitAxis(contentWidth, viewport.width), y: fitAxis(contentHeight, viewport.height) }
  const panRef = useRef(pan)
  panRef.current = pan

  // Zoom around an anchor (cursor or pinch center); toolbar zoom anchors on the view center.
  const zoomRef = useRef(zoom)
  const zoomTargetRef = useRef(zoom)
  const anchorRef = useRef<Point | null>(null)
  useLayoutEffect(() => {
    const previous = zoomRef.current
    zoomRef.current = zoom
    zoomTargetRef.current = zoom
    if (previous === zoom) return
    const ratio = zoom / previous
    const anchor = anchorRef.current ?? { x: viewport.width / 2, y: viewport.height / 2 }
    anchorRef.current = null
    const current = panRef.current
    setRawPan({
      x: anchor.x - (anchor.x - current.x - leftSpace) * ratio - leftSpace,
      y: anchor.y - (anchor.y - current.y - GUTTER_PX) * ratio - GUTTER_PX,
    })
  }, [leftSpace, viewport.height, viewport.width, zoom])

  useEffect(() => {
    setRawPan(null)
  }, [fitKey, document.id])

  useEffect(() => {
    setFailed(false)
  }, [document.id, document.url])

  useEffect(() => {
    setSelectingPages(false)
  }, [document.id])

  const zoomAt = useCallback(
    (factor: number, anchor: Point) => {
      const next = clampZoom(zoomTargetRef.current * factor)
      if (next === zoomTargetRef.current) return
      zoomTargetRef.current = next
      anchorRef.current = anchor
      onZoomChange(next)
    },
    [onZoomChange]
  )

  const panBy = useCallback(
    (dx: number, dy: number) => {
      const current = panRef.current
      setRawPan(clampPan({ x: current.x + dx, y: current.y + dy }))
    },
    [clampPan]
  )

  const maxScroll = Math.max(0, contentHeight - viewport.height)
  const scrollTo = useCallback(
    (scrollTop: number) => {
      setRawPan(clampPan({ x: panRef.current.x, y: -scrollTop }))
    },
    [clampPan]
  )

  const confirmBulkDelete = (pages: number[]) => {
    setBulkDeleting(true)
    deleteProjectDocumentPages(document.id, pages)
      .then(() => setSelectingPages(false))
      .catch((error) => {
        logger.warn('[documents] bulk page delete failed:', error)
        dialog.info({
          title: t('projectDocuments.deletePages'),
          message: t('projectDocuments.deletePageFailed'),
          variant: 'error',
        })
      })
      .finally(() => setBulkDeleting(false))
  }

  // Wheel needs a non-passive listener to keep the page from scrolling or browser-zooming.
  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      const lineScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1
      const deltaX = event.deltaX * lineScale
      const deltaY = event.deltaY * lineScale
      // A mouse notch is ~100; cap each step so one notch zooms like a toolbar step.
      const step = Math.max(-25, Math.min(25, deltaY))
      if (event.ctrlKey || event.metaKey) {
        // Touchpad pinch arrives as Ctrl+wheel with small deltas.
        zoomAt(Math.exp(-step * 0.01), anchor)
      } else if (!multiPage) {
        zoomAt(Math.exp(-step * 0.009), anchor)
      } else if (event.shiftKey && deltaX === 0) {
        panBy(-deltaY, 0)
      } else {
        panBy(-deltaX, -deltaY)
      }
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [multiPage, panBy, viewportRef, zoomAt])

  // Drag to pan with any pointer; two touch points pinch-zoom around their center.
  const pointers = useRef(new Map<number, Point>())
  const pinchDistance = useRef<number | null>(null)
  const localPoint = (event: React.PointerEvent): Point => {
    const rect = viewportRef.current!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const [dragging, setDragging] = useState(false)

  const pointerHandlers = {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0 && event.button !== 1) return
      if (event.button === 1) event.preventDefault()
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Capture is a nicety for drags leaving the view; panning works without it.
      }
      pointers.current.set(event.pointerId, localPoint(event))
      pinchDistance.current = null
      setDragging(true)
    },
    onPointerMove: (event: React.PointerEvent) => {
      const previous = pointers.current.get(event.pointerId)
      if (!previous) return
      const point = localPoint(event)
      if (pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.entries()].map(([id, p]) =>
          id === event.pointerId ? point : p
        )
        const previousCenter = [...pointers.current.values()].reduce(
          (sum, p) => ({
            x: sum.x + p.x / pointers.current.size,
            y: sum.y + p.y / pointers.current.size,
          }),
          { x: 0, y: 0 }
        )
        const distance = Math.hypot(a!.x - b!.x, a!.y - b!.y)
        const center = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 }
        if (pinchDistance.current) zoomAt(distance / pinchDistance.current, center)
        else panBy(center.x - previousCenter.x, center.y - previousCenter.y)
        pinchDistance.current = distance
      } else {
        panBy(point.x - previous.x, point.y - previous.y)
      }
      pointers.current.set(event.pointerId, point)
    },
    onPointerUp: (event: React.PointerEvent) => {
      pointers.current.delete(event.pointerId)
      pinchDistance.current = null
      if (pointers.current.size === 0) setDragging(false)
    },
  }

  let pageTop = GUTTER_PX

  return (
    <div className="relative h-full w-full">
      <div
        ref={viewportRef}
        className={`relative h-full w-full touch-none select-none overflow-hidden ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        data-testid="project-document-viewer"
        {...pointerHandlers}
        onPointerCancel={pointerHandlers.onPointerUp}
        onMouseDown={(event) => {
          // Middle-click would otherwise start the browser's autoscroll.
          if (event.button === 1) event.preventDefault()
        }}
      >
        {failed ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">
            {t('projectDocuments.loadFailed')}
          </div>
        ) : (
          aspects &&
          viewport.width > 0 && (
            <div
              className="absolute left-0 top-0"
              style={{
                width: contentWidth,
                height: contentHeight,
                transform: `translate(${pan.x}px, ${pan.y}px)`,
              }}
            >
              {aspects.map((aspect, index) => {
                const pageNumber = index + 1
                const top = pageTop
                const height = Math.round(pageWidth * aspect)
                pageTop += height + pageGap
                const included = exportedPages.has(pageNumber)
                return (
                  <div
                    key={pageNumber}
                    className={`absolute ${
                      // Images keep the thumbnail's themed backdrop, so transparent images (such
                      // as SVG drawings) look the same in the card and here; PDF pages are paper.
                      document.kind === 'image' ? 'bg-gray-100 dark:bg-gray-800' : 'shadow'
                    } ${pageSelectable && included ? 'outline outline-2 outline-offset-2 outline-sky-500' : ''}`}
                    style={{ left: leftSpace, top, width: pageWidth, height }}
                    data-testid="project-document-page"
                  >
                    {multiPage && (
                      <PageControls
                        document={document}
                        pageNumber={pageNumber}
                        pageCount={pageCount}
                        included={included}
                      />
                    )}
                    {document.kind === 'image' ? (
                      <img
                        src={document.url}
                        alt={document.name}
                        draggable={false}
                        style={{ width: pageWidth, height }}
                        className="block"
                        onError={handleError}
                      />
                    ) : (
                      <PdfPageCanvas
                        document={document}
                        pageNumber={pageNumber}
                        width={pageWidth}
                        aspect={aspect}
                        onError={handleError}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>
      {!failed && multiPage && (
        <DocumentScrollbar
          scrollTop={-pan.y}
          maxScroll={maxScroll}
          viewHeight={viewport.height}
          onScrollTo={scrollTo}
        />
      )}
      {canBulkDelete && !failed && (
        <button
          type="button"
          data-testid="document-bulk-delete-toggle"
          aria-label={t('projectDocuments.deletePages')}
          title={t('projectDocuments.deletePages')}
          onClick={() => setSelectingPages(true)}
          className="absolute left-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-500 shadow-md transition-colors hover:border-sky-400 hover:bg-sky-50 hover:text-sky-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      )}
      {selectingPages && canBulkDelete && aspects && (
        <PageDeleteGrid
          document={document}
          aspects={aspects}
          busy={bulkDeleting}
          onCancel={() => setSelectingPages(false)}
          onConfirm={confirmBulkDelete}
          onError={handleError}
        />
      )}
    </div>
  )
}
