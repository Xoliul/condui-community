import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { CanvasType, Point } from '@/types/ui'
import { ZOOM_MIN, ZOOM_MAX, zoomToDisplayPercent } from '@/constants/canvasConstants'
import { preventCanvasToolbarMouseFocus } from '@/lib/ui/preventCanvasToolbarMouseFocus'
import { useCanvasOverlayScale } from '@/contexts/CanvasOverlayScaleContext'
import { useUIStore } from '@/stores/uiStore'
import { FindFocusIcon, MaximizeCanvasIcon, RestoreLayoutIcon } from '@/components/icons/UiIcons'

interface ViewNavigationToolbarProps {
  zoom: number
  onZoomChange: (zoom: number) => void
  onPanChange: (pan: Point) => void
  onFitToView: () => void
  onToggleMaximize?: () => void
  isMaximized?: boolean
  canvasType?: CanvasType
  position?: 'bottom-right' | 'top-right'
  /** Only the maximize/restore button, for views without zoom (e.g. a document overview). */
  maximizeOnly?: boolean
}

function ViewNavigationToolbar({
  zoom,
  onZoomChange,
  onFitToView,
  onToggleMaximize,
  isMaximized: isMaximizedProp,
  canvasType,
  position = 'bottom-right',
  maximizeOnly = false,
}: ViewNavigationToolbarProps) {
  const { t } = useTranslation()
  const { scale: overlayScale } = useCanvasOverlayScale()
  const canvasPanelIndex = useUIStore((s) =>
    canvasType && s.viewportLayout.panels.length > 1
      ? s.viewportLayout.panels.findIndex((panel) => panel.canvas === canvasType)
      : -1
  )
  const toolbarCanvasMaximized = useUIStore((s) => s.viewportLayout.panels.length === 1)
  const toggleViewportPanelFocus = useUIStore((s) => s.toggleViewportPanelFocus)

  // Detect tablet/mobile: primary pointer is coarse (finger) rather than fine (mouse)
  const isTouchDevice = useMemo(() => {
    return window.matchMedia('(pointer: coarse)').matches
  }, [])

  const handleZoomIn = useCallback(() => {
    const newZoom = Math.min(ZOOM_MAX, zoom * 1.25)
    onZoomChange(newZoom)
  }, [zoom, onZoomChange])

  const handleZoomOut = useCallback(() => {
    const newZoom = Math.max(ZOOM_MIN, zoom / 1.25)
    onZoomChange(newZoom)
  }, [zoom, onZoomChange])

  const handleToggleMaximize = useCallback(() => {
    if (onToggleMaximize) {
      onToggleMaximize()
      return
    }
    toggleViewportPanelFocus(canvasPanelIndex >= 0 ? canvasPanelIndex : null)
  }, [canvasPanelIndex, onToggleMaximize, toggleViewportPanelFocus])

  const zoomPercentage = zoomToDisplayPercent(zoom)

  const positionClasses = {
    'bottom-right': 'bottom-4 right-4',
    'top-right': 'top-4 right-4',
  }
  const transformOrigin = position === 'bottom-right' ? 'bottom right' : 'top right'
  const maximizeLabel = t('canvas.maximizeView', { defaultValue: 'Maximize canvas' })
  const restoreLabel = t('canvas.restoreView', { defaultValue: 'Restore layout' })
  const canToggleMaximize = Boolean(onToggleMaximize || canvasType)
  const isMaximized = isMaximizedProp ?? toolbarCanvasMaximized

  if (maximizeOnly && !isTouchDevice) {
    if (!canToggleMaximize) return null
    return (
      <div
        data-canvas-overlay-anchor="right"
        data-canvas-overlay-position={position}
        className={`absolute ${positionClasses[position]} z-10 flex items-center gap-1 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-md shadow-lg px-2 py-1 border border-gray-200 dark:border-gray-700`}
        style={{ transform: `scale(${overlayScale})`, transformOrigin }}
      >
        <button
          type="button"
          onPointerDown={preventCanvasToolbarMouseFocus}
          onClick={handleToggleMaximize}
          className="flex h-8 w-8 items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300"
          title={isMaximized ? restoreLabel : maximizeLabel}
          aria-label={isMaximized ? restoreLabel : maximizeLabel}
        >
          {isMaximized ? (
            <RestoreLayoutIcon className="h-5 w-5" />
          ) : (
            <MaximizeCanvasIcon className="h-5 w-5" />
          )}
        </button>
      </div>
    )
  }

  if (isTouchDevice) {
    return (
      <div
        data-canvas-overlay-anchor="right"
        data-canvas-overlay-position={position}
        className={`absolute ${positionClasses[position]} z-10 flex items-center gap-2`}
        style={{ transform: `scale(${overlayScale})`, transformOrigin }}
      >
        {!maximizeOnly && (
          <button
            type="button"
            onPointerDown={preventCanvasToolbarMouseFocus}
            onClick={onFitToView}
            className="flex h-12 w-12 items-center justify-center rounded-md border border-gray-300 bg-white/90 text-gray-700 shadow-lg backdrop-blur-sm transition-colors hover:bg-gray-100/90 dark:border-gray-500 dark:bg-gray-700/90 dark:text-gray-300 dark:hover:bg-gray-600/90"
            title={`${t('canvas.fitToView')} (F)`}
            aria-label={t('canvas.fitToView')}
          >
            <FindFocusIcon />
          </button>
        )}

        {canToggleMaximize && (
          <button
            type="button"
            onPointerDown={preventCanvasToolbarMouseFocus}
            onClick={handleToggleMaximize}
            className="flex h-12 w-12 items-center justify-center rounded-md border border-gray-300 bg-white/90 text-gray-700 shadow-lg backdrop-blur-sm transition-colors hover:bg-gray-100/90 dark:border-gray-500 dark:bg-gray-700/90 dark:text-gray-300 dark:hover:bg-gray-600/90"
            title={isMaximized ? restoreLabel : maximizeLabel}
            aria-label={isMaximized ? restoreLabel : maximizeLabel}
          >
            {isMaximized ? <RestoreLayoutIcon /> : <MaximizeCanvasIcon />}
          </button>
        )}
      </div>
    )
  }

  const findFocusIcon = <FindFocusIcon className="h-5 w-5" />

  return (
    <div
      data-canvas-overlay-anchor="right"
      data-canvas-overlay-position={position}
      className={`absolute ${positionClasses[position]} z-10 flex items-center gap-1 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-md shadow-lg px-2 py-1 border border-gray-200 dark:border-gray-700`}
      style={{ transform: `scale(${overlayScale})`, transformOrigin }}
    >
      <button
        type="button"
        onPointerDown={preventCanvasToolbarMouseFocus}
        onClick={handleZoomOut}
        disabled={zoom <= ZOOM_MIN}
        className="flex h-8 w-8 items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-gray-700 dark:text-gray-300"
        title={`${t('canvas.zoomOut')} (-)`}
        aria-label={t('canvas.zoomOut')}
      >
        <svg className="block h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7"
          />
        </svg>
      </button>

      <div className="flex h-8 min-w-[60px] items-center justify-center px-2 text-center text-sm font-medium text-gray-700 dark:text-gray-300">
        {zoomPercentage}%
      </div>

      <button
        type="button"
        onPointerDown={preventCanvasToolbarMouseFocus}
        onClick={handleZoomIn}
        disabled={zoom >= ZOOM_MAX}
        className="flex h-8 w-8 items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-gray-700 dark:text-gray-300"
        title={`${t('canvas.zoomIn')} (+)`}
        aria-label={t('canvas.zoomIn')}
      >
        <svg className="block h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7"
          />
        </svg>
      </button>

      <div className="mx-1 h-5 w-px bg-gray-300 dark:bg-gray-600" />

      <button
        type="button"
        onPointerDown={preventCanvasToolbarMouseFocus}
        onClick={onFitToView}
        className="flex h-8 w-8 items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300"
        title={`${t('canvas.fitToView')} (F)`}
        aria-label={t('canvas.fitToView')}
      >
        {findFocusIcon}
      </button>

      {canToggleMaximize && (
        <button
          type="button"
          onPointerDown={preventCanvasToolbarMouseFocus}
          onClick={handleToggleMaximize}
          className="flex h-8 w-8 items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300"
          title={isMaximized ? restoreLabel : maximizeLabel}
          aria-label={isMaximized ? restoreLabel : maximizeLabel}
        >
          {isMaximized ? (
            <RestoreLayoutIcon className="h-5 w-5" />
          ) : (
            <MaximizeCanvasIcon className="h-5 w-5" />
          )}
        </button>
      )}
    </div>
  )
}

export default ViewNavigationToolbar
