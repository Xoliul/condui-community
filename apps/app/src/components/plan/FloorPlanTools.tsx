import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { FloatingControl } from '../canvas/FloatingControls'
import CanvasFloatingControlRail from '../canvas/CanvasFloatingControlRail'
import { useCanvasOverlayScale } from '@/contexts/CanvasOverlayScaleContext'
import { CANVAS_OVERLAY_DISMISS_EVENT } from '@/lib/ui/canvasOverlayDismiss'
import { preventCanvasToolbarMouseFocus } from '@/lib/ui/preventCanvasToolbarMouseFocus'
import {
  ExitDrawModeIcon,
  DrawPencilIcon,
  DrawRectIcon,
  DrawStairsIcon,
  InsertDoorIcon,
  InsertWindowIcon,
  ClipWallIcon,
  InsertPointIcon,
} from '@/components/icons/UiIcons'
import type { ToolMode } from './PlanImageTools'
import { PLAN_GRAPHIC_ELEMENT_ASSETS } from '@/lib/plan/graphicElements'

interface FloorPlanToolsProps {
  onToolChange: (mode: ToolMode) => void
  activeTool: ToolMode
  onToggleDrawMode?: () => void
  selectedGraphicAssetId: string
  onGraphicAssetChange: (assetId: string) => void
}

function GraphicElementsIcon({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="1.5" strokeWidth={2} />
      <ellipse cx="12" cy="13" rx="5.5" ry="3.75" strokeWidth={1.75} />
      <circle cx="12" cy="13" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

const GRAPHIC_PICKER_MAX_HEIGHT_PX = 440
const GRAPHIC_PICKER_EDGE_INSET_PX = 12
const GRAPHIC_PICKER_GAP_PX = 12
const GRAPHIC_PICKER_WIDTH_PX = 176

interface GraphicPickerPosition {
  bottom: number
  left: number
  maxHeight: number
}

function FloorPlanTools({
  onToolChange,
  activeTool,
  onToggleDrawMode,
  selectedGraphicAssetId,
  onGraphicAssetChange,
}: FloorPlanToolsProps) {
  const { t } = useTranslation()
  const { height: overlayHeight } = useCanvasOverlayScale()
  const graphicToolRef = useRef<HTMLDivElement>(null)
  const graphicHoverCloseTimerRef = useRef<number | null>(null)
  const [graphicPickerOpen, setGraphicPickerOpen] = useState(false)
  const [graphicShelfHovered, setGraphicShelfHovered] = useState(false)
  const [coarsePointer, setCoarsePointer] = useState(false)
  const [graphicPickerPosition, setGraphicPickerPosition] =
    useState<GraphicPickerPosition | null>(null)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(pointer: coarse)')
    const syncPointer = () => setCoarsePointer(mediaQuery.matches)
    syncPointer()
    mediaQuery.addEventListener('change', syncPointer)
    return () => mediaQuery.removeEventListener('change', syncPointer)
  }, [])

  useEffect(() => {
    if (!graphicPickerOpen) return
    const handleDismiss = () => setGraphicPickerOpen(false)
    window.addEventListener(CANVAS_OVERLAY_DISMISS_EVENT, handleDismiss)
    return () => window.removeEventListener(CANVAS_OVERLAY_DISMISS_EVENT, handleDismiss)
  }, [graphicPickerOpen])

  useEffect(() => {
    if (activeTool !== 'drawGraphicElement') {
      setGraphicPickerOpen(false)
    }
  }, [activeTool])

  useEffect(
    () => () => {
      if (graphicHoverCloseTimerRef.current !== null) {
        window.clearTimeout(graphicHoverCloseTimerRef.current)
      }
    },
    []
  )

  const cancelGraphicHoverClose = useCallback(() => {
    if (graphicHoverCloseTimerRef.current === null) return
    window.clearTimeout(graphicHoverCloseTimerRef.current)
    graphicHoverCloseTimerRef.current = null
  }, [])

  const scheduleGraphicHoverClose = useCallback(() => {
    if (coarsePointer) return
    cancelGraphicHoverClose()
    graphicHoverCloseTimerRef.current = window.setTimeout(() => {
      setGraphicShelfHovered(false)
      graphicHoverCloseTimerRef.current = null
    }, 120)
  }, [cancelGraphicHoverClose, coarsePointer])

  const closeGraphicPicker = useCallback(() => {
    cancelGraphicHoverClose()
    setGraphicPickerOpen(false)
    setGraphicShelfHovered(false)
    graphicToolRef.current?.querySelector('button')?.blur()
  }, [cancelGraphicHoverClose])

  const showGraphicPicker = graphicPickerOpen || (!coarsePointer && graphicShelfHovered)

  const updateGraphicPickerPosition = useCallback(() => {
    const wrapper = graphicToolRef.current
    const trigger = wrapper?.querySelector('button')
    const canvasRoot = wrapper?.closest('[data-canvas-overlay-root]')
    if (!(trigger instanceof HTMLElement) || !(canvasRoot instanceof HTMLElement)) return

    const triggerRect = trigger.getBoundingClientRect()
    const canvasRect = canvasRoot.getBoundingClientRect()
    const topLimit = Math.max(
      GRAPHIC_PICKER_EDGE_INSET_PX,
      canvasRect.top + GRAPHIC_PICKER_EDGE_INSET_PX
    )
    const bottomLimit = Math.min(
      window.innerHeight - GRAPHIC_PICKER_EDGE_INSET_PX,
      canvasRect.bottom - GRAPHIC_PICKER_EDGE_INSET_PX
    )
    const anchoredBottom = Math.min(triggerRect.bottom, bottomLimit)
    const maxHeight = Math.min(
      GRAPHIC_PICKER_MAX_HEIGHT_PX,
      Math.max(120, anchoredBottom - topLimit)
    )
    const preferredLeft = triggerRect.right
    const rightmostLeft =
      window.innerWidth -
      GRAPHIC_PICKER_WIDTH_PX -
      GRAPHIC_PICKER_GAP_PX -
      GRAPHIC_PICKER_EDGE_INSET_PX

    setGraphicPickerPosition({
      bottom: Math.max(GRAPHIC_PICKER_EDGE_INSET_PX, window.innerHeight - anchoredBottom),
      left: Math.max(
        GRAPHIC_PICKER_EDGE_INSET_PX,
        Math.min(preferredLeft, rightmostLeft)
      ),
      maxHeight: Math.min(maxHeight, Math.max(120, overlayHeight - 24)),
    })
  }, [overlayHeight])

  useLayoutEffect(() => {
    if (!showGraphicPicker) {
      setGraphicPickerPosition(null)
      return
    }

    updateGraphicPickerPosition()
    const canvasRoot = graphicToolRef.current?.closest('[data-canvas-overlay-root]')
    const resizeObserver =
      canvasRoot instanceof HTMLElement ? new ResizeObserver(updateGraphicPickerPosition) : null
    if (canvasRoot instanceof HTMLElement) resizeObserver?.observe(canvasRoot)
    window.addEventListener('resize', updateGraphicPickerPosition)
    document.addEventListener('scroll', updateGraphicPickerPosition, true)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateGraphicPickerPosition)
      document.removeEventListener('scroll', updateGraphicPickerPosition, true)
    }
  }, [showGraphicPicker, updateGraphicPickerPosition])

  // Visible floor plan tools; the default select+move tool is implicit and has no bubble.
  const tools: Array<{
    mode: ToolMode
    icon: React.ReactNode
    title: string
    description?: string
  }> = [
    {
      mode: 'drawWall',
      icon: <DrawPencilIcon className="w-6 h-6" />,
      title: t('floorPlanTools.drawWall'),
      description: t('floorPlanTools.drawWallHint'),
    },
    {
      mode: 'drawWallRect',
      icon: <DrawRectIcon className="w-6 h-6" />,
      title: t('floorPlanTools.drawWallRect'),
    },
    {
      mode: 'clipWall',
      icon: <ClipWallIcon className="w-6 h-6" />,
      title: t('floorPlanTools.clipWall'),
    },
    {
      mode: 'insertPoint',
      icon: <InsertPointIcon className="w-6 h-6" />,
      title: t('floorPlanTools.insertPoint'),
    },
    {
      mode: 'insertDoor',
      icon: <InsertDoorIcon className="w-6 h-6" />,
      title: t('floorPlanTools.insertDoor'),
    },
    {
      mode: 'insertWindow',
      icon: <InsertWindowIcon className="w-6 h-6" />,
      title: t('floorPlanTools.insertWindow'),
    },
    {
      mode: 'drawStair',
      icon: <DrawStairsIcon className="w-6 h-6" />,
      title: t('floorPlanTools.drawStair'),
    },
  ]
  const allControls = [
    {
      key: 'exit-draw-mode',
      icon: <ExitDrawModeIcon className="w-6 h-6" />,
      label: t('floorPlanTools.exitDrawMode'),
      active: true,
      primary: false,
      onClick: onToggleDrawMode,
    },
    ...tools.map((tool) => ({
      key: tool.mode,
      icon: tool.icon,
      label: tool.title,
      description: tool.description,
      active: activeTool === tool.mode,
      primary: true,
      onClick: () => {
        // Toggling an active tool falls back to the implicit select+move tool
        onToolChange(activeTool === tool.mode ? 'select' : tool.mode)
      },
    })),
  ]
  const selectedGraphicAsset =
    PLAN_GRAPHIC_ELEMENT_ASSETS.find((asset) => asset.id === selectedGraphicAssetId) ??
    PLAN_GRAPHIC_ELEMENT_ASSETS[0]

  const graphicPickerShelf =
    selectedGraphicAsset &&
    showGraphicPicker &&
    graphicPickerPosition &&
    typeof document !== 'undefined'
      ? createPortal(
          <div
            data-testid="floor-plan-graphic-picker"
            className="fixed z-[70] origin-bottom-left transition-all duration-150 ease-out"
            style={{
              bottom: graphicPickerPosition.bottom,
              left: graphicPickerPosition.left,
              paddingLeft: GRAPHIC_PICKER_GAP_PX,
            }}
            onMouseEnter={() => {
              cancelGraphicHoverClose()
              setGraphicShelfHovered(true)
            }}
            onMouseLeave={scheduleGraphicHoverClose}
            onFocusCapture={() => {
              cancelGraphicHoverClose()
              setGraphicShelfHovered(true)
            }}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                scheduleGraphicHoverClose()
              }
            }}
          >
            <div
              className="flex w-44 touch-pan-y flex-col gap-1 overflow-y-auto overscroll-y-contain rounded-lg border border-gray-200 bg-white p-1 shadow-lg [-webkit-overflow-scrolling:touch] dark:border-gray-700 dark:bg-gray-800"
              style={{ maxHeight: graphicPickerPosition.maxHeight }}
            >
              {PLAN_GRAPHIC_ELEMENT_ASSETS.map((asset) => {
                const selected = asset.id === selectedGraphicAsset.id
                return (
                  <button
                    key={asset.id}
                    type="button"
                    className={`flex w-full shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                      selected
                        ? 'bg-sky-100 text-sky-900 dark:bg-sky-900/60 dark:text-sky-50'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                    onPointerDown={(event) => preventCanvasToolbarMouseFocus(event)}
                    onClick={() => {
                      onGraphicAssetChange(asset.id)
                      onToolChange('drawGraphicElement')
                      closeGraphicPicker()
                    }}
                  >
                    <img
                      src={asset.svgPath}
                      alt=""
                      className="h-7 w-7 shrink-0 object-contain dark:invert"
                    />
                    <span
                      className={`truncate text-[0.95rem] font-medium ${
                        selected
                          ? 'text-sky-900 dark:text-sky-50'
                          : 'text-gray-900 dark:text-white'
                      }`}
                    >
                      {t(asset.labelKey, asset.label)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <>
      <CanvasFloatingControlRail
        side="left"
        verticalAlign="center"
        topOverlayInsetPx={68}
        zIndex={45}
        dataCanvasOverlayAnchor="left"
      >
        <>
          {allControls.map((control) => (
            <FloatingControl
              key={control.key}
              icon={control.icon}
              label={control.label}
              tooltipDescription={'description' in control ? control.description : undefined}
              variant="tool"
              side="left"
              active={control.active}
              primary={control.primary}
              danger={control.key === 'exit-draw-mode'}
              triggerTestId={
                control.key === 'exit-draw-mode' ? 'e2e-plan-exit-draw-mode' : undefined
              }
              onClick={control.onClick}
            />
          ))}
          {selectedGraphicAsset && (
            <div
              ref={graphicToolRef}
              className="relative flex items-center"
              onMouseEnter={() => {
                cancelGraphicHoverClose()
                setGraphicShelfHovered(true)
              }}
              onMouseLeave={scheduleGraphicHoverClose}
              onFocusCapture={() => {
                cancelGraphicHoverClose()
                setGraphicShelfHovered(true)
              }}
              onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  scheduleGraphicHoverClose()
                }
              }}
            >
              <FloatingControl
                icon={<GraphicElementsIcon className="w-6 h-6" />}
                label={t('floorPlanTools.graphicElements')}
                variant="tool"
                side="left"
                active={activeTool === 'drawGraphicElement'}
                primary={true}
                suppressTooltip
                onClick={() => {
                  if (coarsePointer) {
                    if (graphicPickerOpen) {
                      closeGraphicPicker()
                      if (activeTool === 'drawGraphicElement') {
                        onToolChange('select')
                      }
                      return
                    }
                    setGraphicPickerOpen(true)
                    if (activeTool !== 'drawGraphicElement') {
                      onToolChange('drawGraphicElement')
                    }
                    return
                  }
                  onToolChange(
                    activeTool === 'drawGraphicElement' ? 'select' : 'drawGraphicElement'
                  )
                }}
              />
            </div>
          )}
        </>
      </CanvasFloatingControlRail>
      {graphicPickerShelf}
    </>
  )
}

export default FloorPlanTools
