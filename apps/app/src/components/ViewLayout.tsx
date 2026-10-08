import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import { EendraadCanvas, PlanCanvas, PanelCanvas } from '@/components/canvas'
import { CanvasSwitcher } from '@/components/viewport/CanvasSwitcher'
import { ResizableDivider } from '@/components/layout/ResizableDivider'
import { ViewportResizePreviewProvider } from '@/components/layout/ViewportResizePreviewContext'
import { VIEWPORT_RATIO_MAX, VIEWPORT_RATIO_MIN } from '@/constants/layoutConstants'
import type { CanvasType } from '@/types/ui'
import type { EditorCapabilities } from '@/lib/viewerMode'
import { clamp } from '@/lib/geometry'
import {
  getViewportDividerSpecs,
  getViewportPanelZones,
} from '@/components/layout/viewportGeometry'
/* @project-documents-strip-start */
import { isProjectDocumentsEnabled } from '@/lib/documents/availability'
/* @project-documents-strip-end */
import { JunctionEditorHost } from '@/components/junctionEditor/junctionEditorHostedFeatures'

const StructuralCanvas =
  
  null

const DocumentsCanvas =
  /* @project-documents-strip-start */
  isProjectDocumentsEnabled()
    ? lazy(() => import('@/components/documents/DocumentsCanvas')) :
  /* @project-documents-strip-end */
  null

type MultiFingerSwipeHandler = (
  direction: 'left' | 'right' | 'up' | 'down',
  fingerCount: number,
  startClientX: number
) => void

function CanvasForType({
  type,
  onMultiFingerSwipe,
  capabilities,
}: {
  type: CanvasType
  onMultiFingerSwipe?: MultiFingerSwipeHandler
  capabilities?: EditorCapabilities
}) {
  switch (type) {
    case 'eendraad':
      return <EendraadCanvas onMultiFingerSwipe={onMultiFingerSwipe} capabilities={capabilities} />
    case 'plan':
      return <PlanCanvas onMultiFingerSwipe={onMultiFingerSwipe} capabilities={capabilities} />
    case 'panel':
      return <PanelCanvas onMultiFingerSwipe={onMultiFingerSwipe} capabilities={capabilities} />
    case 'structure':
      return StructuralCanvas ? (
        <Suspense fallback={null}>
          <StructuralCanvas onMultiFingerSwipe={onMultiFingerSwipe} />
        </Suspense>
      ) : null
    case 'documents':
      return DocumentsCanvas ? (
        <Suspense fallback={null}>
          <DocumentsCanvas />
        </Suspense>
      ) : null
  }
}

const ViewportCanvasSurface = memo(function ViewportCanvasSurface({
  panelIndex,
  type,
  capabilities,
  onCompactAuxPanelVisibilityChange,
}: {
  panelIndex: number
  type: CanvasType
  capabilities?: EditorCapabilities
  onCompactAuxPanelVisibilityChange?: (visible: boolean) => void
}) {
  const onMultiFingerSwipe = useCallback<MultiFingerSwipeHandler>(
    (direction, fingerCount, startClientX) => {
      if (fingerCount !== 3) return

      if (direction === 'up' || direction === 'down') {
        if (onCompactAuxPanelVisibilityChange) {
          onCompactAuxPanelVisibilityChange(direction === 'up')
          return
        }
        useUIStore.getState().toggleViewportPanelFocus(panelIndex)
        return
      }

      const { panels, leftDockCollapsed, setLeftDockCollapsed, togglePanel } = useUIStore.getState()
      const leftHalf = startClientX < window.innerWidth / 2
      if (leftHalf) {
        if (direction === 'left' && !leftDockCollapsed) setLeftDockCollapsed(true)
        if (direction === 'right' && leftDockCollapsed) setLeftDockCollapsed(false)
        return
      }

      if (direction === 'right' && panels.properties.visible) togglePanel('properties')
      if (direction === 'left' && !panels.properties.visible) togglePanel('properties')
    },
    [onCompactAuxPanelVisibilityChange, panelIndex]
  )

  return (
    <CanvasForType
      type={type}
      onMultiFingerSwipe={onMultiFingerSwipe}
      capabilities={capabilities}
    />
  )
})

function ViewLayout({
  leftInsetPx = 0,
  rightInsetPx = 0,
  bottomInsetPx = 0,
  resizePreviewActive = false,
  capabilities,
  compact = false,
  compactOrientation = 'portrait',
  onCompactAuxPanelVisibilityChange,
}: {
  leftInsetPx?: number
  rightInsetPx?: number
  bottomInsetPx?: number
  resizePreviewActive?: boolean
  capabilities?: EditorCapabilities
  compact?: boolean
  compactOrientation?: 'portrait' | 'landscape'
  onCompactAuxPanelVisibilityChange?: (visible: boolean) => void
}) {
  const layout = useUIStore((s) => s.viewportLayout)
  const setLayoutPrimaryRatio = useUIStore((s) => s.setLayoutPrimaryRatio)
  const setLayoutSecondaryRatio = useUIStore((s) => s.setLayoutSecondaryRatio)
  const setLastInteractedCanvas = useUIStore((s) => s.setLastInteractedCanvas)
  const setRenderedCanvases = useUIStore((s) => s.setRenderedCanvases)
  const projectId = useProjectStore((s) => s.currentProject?.project.id ?? null)

  useEffect(() => {
    setLastInteractedCanvas(null)
  }, [projectId, setLastInteractedCanvas])

  const [previewRatios, setPreviewRatios] = useState<{ primary: number; secondary: number } | null>(
    null
  )
  const primaryRatio = previewRatios?.primary ?? layout.primaryRatio
  const secondaryRatio = previewRatios?.secondary ?? layout.secondaryRatio
  const layoutForRender = useMemo(() => {
    const sizedLayout = {
      ...layout,
      primaryRatio,
      secondaryRatio,
    }
    if (!compact) return sizedLayout
    const compactPresetAllowed =
      compactOrientation === 'portrait'
        ? sizedLayout.preset === 'stacked' && sizedLayout.panels.length >= 2
        : sizedLayout.preset === 'sideBySide' && sizedLayout.panels.length >= 2
    if (compactPresetAllowed) return sizedLayout
    return {
      preset: 'single' as const,
      panels: [sizedLayout.panels[0] ?? { canvas: 'eendraad' as const }],
      primaryRatio: 1,
      secondaryRatio: 0.5,
      focusReturnLayout: null,
    }
  }, [compact, compactOrientation, layout, primaryRatio, secondaryRatio])
  const panelZones = useMemo(() => getViewportPanelZones(layoutForRender), [layoutForRender])
  const dividerSpecs = useMemo(() => getViewportDividerSpecs(layoutForRender), [layoutForRender])

  useEffect(() => {
    setRenderedCanvases(layoutForRender.panels.map((panel) => panel.canvas))
  }, [layoutForRender.panels, setRenderedCanvases])

  useEffect(() => () => setRenderedCanvases(null), [setRenderedCanvases])

  useEffect(() => {
    setPreviewRatios(null)
  }, [layout.preset, layout.panels, layout.primaryRatio, layout.secondaryRatio])

  const viewportResizePreviewActive = previewRatios != null || resizePreviewActive

  return (
    <ViewportResizePreviewProvider active={viewportResizePreviewActive}>
      <div className="flex flex-col h-full">
        <div className="relative flex-1 overflow-hidden">
          <div
            className="absolute inset-y-0"
            data-viewport-content
            style={{
              left: `${leftInsetPx}px`,
              right: `${rightInsetPx}px`,
              bottom: `${bottomInsetPx}px`,
            }}
          >
            {panelZones.map((slot) => {
              const r = slot.rect
              return (
                <div
                  key={slot.type}
                  className="absolute overflow-hidden"
                  style={{
                    left: `${r.left * 100}%`,
                    top: `${r.top * 100}%`,
                    width: `${r.width * 100}%`,
                    height: `${r.height * 100}%`,
                  }}
                  data-viewport-panel={slot.panelIndex}
                  data-viewport-canvas={slot.type}
                >
                  <div className="relative h-full w-full">
                    <div className="absolute left-3 top-3 z-[60] pointer-events-auto">
                      <CanvasSwitcher
                        panelIndex={slot.panelIndex}
                        currentCanvas={layoutForRender.panels[slot.panelIndex]?.canvas ?? slot.type}
                        compact={compact}
                        compactOrientation={compactOrientation}
                      />
                    </div>
                    <div
                      className="relative h-full w-full"
                      data-canvas-surface={slot.type}
                      onPointerDownCapture={() => setLastInteractedCanvas(slot.type)}
                      onFocusCapture={() => setLastInteractedCanvas(slot.type)}
                      onWheelCapture={() => setLastInteractedCanvas(slot.type)}
                    >
                      <ViewportCanvasSurface
                        panelIndex={slot.panelIndex}
                        type={slot.type}
                        capabilities={capabilities}
                        onCompactAuxPanelVisibilityChange={onCompactAuxPanelVisibilityChange}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
            <JunctionEditorHost />
            <div className="pointer-events-none absolute inset-0" style={{ zIndex: 41 }}>
              {dividerSpecs.map((spec, i) => (
                <ResizableDivider
                  key={`${spec.ratioKey}-${spec.direction}-${i}`}
                  direction={spec.direction}
                  startRatio={spec.ratioKey === 'primary' ? primaryRatio : secondaryRatio}
                  onDragStart={() => {
                    setPreviewRatios({
                      primary: layout.primaryRatio,
                      secondary: layout.secondaryRatio,
                    })
                  }}
                  onRatioChange={(nextRatio) => {
                    setPreviewRatios((current) => {
                      const base = current ?? {
                        primary: layout.primaryRatio,
                        secondary: layout.secondaryRatio,
                      }
                      if (spec.ratioKey === 'primary') {
                        return {
                          ...base,
                          primary: clamp(nextRatio, VIEWPORT_RATIO_MIN, VIEWPORT_RATIO_MAX),
                        }
                      }
                      return {
                        ...base,
                        secondary: Math.max(
                          VIEWPORT_RATIO_MIN,
                          Math.min(VIEWPORT_RATIO_MAX, nextRatio)
                        ),
                      }
                    })
                  }}
                  onDragEnd={(nextRatio) => {
                    if (spec.ratioKey === 'primary') {
                      setLayoutPrimaryRatio(nextRatio)
                    } else {
                      setLayoutSecondaryRatio(nextRatio)
                    }
                    setPreviewRatios(null)
                  }}
                  ratio={spec.ratio}
                  heightFraction={spec.heightFraction}
                  topFraction={spec.topFraction}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </ViewportResizePreviewProvider>
  )
}

export default ViewLayout
