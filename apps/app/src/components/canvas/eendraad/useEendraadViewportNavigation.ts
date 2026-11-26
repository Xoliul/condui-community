import type { useCanvasWindow } from '@/components/viewport/ViewportContext'
import type { useViewportUIApi } from '@/components/viewport/ViewportUIStore'

import {
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
} from 'react'

import type Konva from 'konva'

import type { ProjectState } from '@/stores/projectStore'

import type { CanvasSize, Point } from '@/types/ui'

import type { BaseCanvasHandle } from '../BaseCanvas'

import {
  type useEendraadLayout,
  type useEendraadWireSegments,
  type useLayoutTree,
  useEendraadCircuitLetterHotkeys,
} from '@/hooks/eendraad'

import { findClosestLayoutNodeAnchor, getPanPreservingWorldAnchor } from '@/lib/canvas/viewportAnchor'
import { resizeConverterDcConnections } from '@/handlers/eendraad/resizeConverterDcConnections'

import type { RefObject } from 'react'

type ViewportUIState = ReturnType<ReturnType<typeof useViewportUIApi>['getState']>
interface EendraadViewportNavigationOptions {
  canvasRef: RefObject<BaseCanvasHandle | null>
  currentProject: ProjectState['currentProject']
  eendraadView: ViewportUIState['eendraadView']
  eendraadViewRef: RefObject<ViewportUIState['eendraadView']>
  layout: ReturnType<typeof useEendraadLayout>
  layoutTree: ReturnType<typeof useLayoutTree>
  pendingConverterResizeAnchorRef: RefObject<{
    deviceId: string; previousAnchor: Point; previousView: { pan: Point; zoom: number }
  } | null>
  pointerOverEendraadRef: RefObject<boolean>
  setEendraadView: ViewportUIState['setEendraadView']
  viewportHitNeedsRemeasureRef: RefObject<boolean>
  viewportHitRefreshTimerRef: RefObject<number | null>
  viewportHitViewRef: RefObject<{ pan: Point; zoom: number; viewport: CanvasSize }>
  viewportPixelSize: CanvasSize
  viewportUI: ReturnType<typeof useViewportUIApi>
  window: ReturnType<typeof useCanvasWindow>
  wireSegments: ReturnType<typeof useEendraadWireSegments>
}

type ViewportHitBounds = { left: number; top: number; right: number; bottom: number }

const VIEWPORT_HIT_CULLABLE_SELECTOR = '.eendraad-hit-cullable'

const VIEWPORT_HIT_BOUNDS_ATTRIBUTE = 'eendraadViewportHitBounds'

const VIEWPORT_HIT_OVERSCAN_PX = 160

function boundsIntersect(left: ViewportHitBounds, right: ViewportHitBounds): boolean {
  return !(
    left.right < right.left ||
    left.left > right.right ||
    left.bottom < right.top ||
    left.top > right.bottom
  )
}

type KonvaPointerEventLike = {
  target?: {
    getStage?: () => {
      getPointerPosition?: () => Point | null
    } | null
  }
}

function isKonvaPointerEventLike(value: unknown): value is KonvaPointerEventLike {
  if (!value || typeof value !== 'object') return false
  const target = (value as { target?: unknown }).target
  return !!target && typeof target === 'object' && 'getStage' in target
}
export function useEendraadViewportNavigation({
  canvasRef,
  currentProject,
  eendraadView,
  eendraadViewRef,
  layout,
  layoutTree,
  pendingConverterResizeAnchorRef,
  pointerOverEendraadRef,
  setEendraadView,
  viewportHitNeedsRemeasureRef,
  viewportHitRefreshTimerRef,
  viewportHitViewRef,
  viewportPixelSize,
  viewportUI,
  window,
  wireSegments,
}: EendraadViewportNavigationOptions) {
  const resizeConverterWithViewportAnchor = useCallback(
    (deviceId: string, connectionCount: number, previousAnchor: Point): boolean => {
      const previousView = viewportUI.getState().eendraadView
      pendingConverterResizeAnchorRef.current = {
        deviceId,
        previousAnchor,
        previousView: { pan: { ...previousView.pan }, zoom: previousView.zoom },
      }
      const resized = resizeConverterDcConnections(deviceId, connectionCount)
      if (!resized) pendingConverterResizeAnchorRef.current = null
      return resized
    },
    [viewportUI, pendingConverterResizeAnchorRef]
  )

  useLayoutEffect(() => {
    const pending = pendingConverterResizeAnchorRef.current
    if (!pending || !layoutTree) return
    const nextAnchor = findClosestLayoutNodeAnchor(
      layoutTree.panels,
      pending.deviceId,
      pending.previousAnchor
    )
    pendingConverterResizeAnchorRef.current = null
    if (!nextAnchor) return
    setEendraadView({
      zoom: pending.previousView.zoom,
      pan: getPanPreservingWorldAnchor(
        pending.previousView.pan,
        pending.previousView.zoom,
        pending.previousAnchor,
        nextAnchor
      ),
    })
  }, [layoutTree, setEendraadView, pendingConverterResizeAnchorRef])

  const refreshViewportHitGraph = useCallback((remeasure: boolean) => {
    const stage = canvasRef.current?.getStage()
    const contentGroup = stage?.findOne('.canvas-content')
    if (!stage || !contentGroup) return

    const { pan, zoom, viewport } = viewportHitViewRef.current
    if (viewport.width <= 0 || viewport.height <= 0 || !Number.isFinite(zoom) || zoom <= 0) {
      return
    }

    const overscan = VIEWPORT_HIT_OVERSCAN_PX / zoom
    const visibleBounds: ViewportHitBounds = {
      left: -pan.x / zoom - overscan,
      top: -pan.y / zoom - overscan,
      right: (viewport.width - pan.x) / zoom + overscan,
      bottom: (viewport.height - pan.y) / zoom + overscan,
    }
    let changed = false

    stage.find(VIEWPORT_HIT_CULLABLE_SELECTOR).forEach((node) => {
      let hitBounds = remeasure
        ? undefined
        : (node.getAttr(VIEWPORT_HIT_BOUNDS_ATTRIBUTE) as ViewportHitBounds | undefined)
      if (!hitBounds) {
        const rect = node.getClientRect({ relativeTo: contentGroup as Konva.Container })
        if (
          !Number.isFinite(rect.x) ||
          !Number.isFinite(rect.y) ||
          !Number.isFinite(rect.width) ||
          !Number.isFinite(rect.height)
        ) {
          return
        }
        hitBounds = {
          left: rect.x,
          top: rect.y,
          right: rect.x + rect.width,
          bottom: rect.y + rect.height,
        }
        // Cache metadata only: Node.setAttr would queue a repaint of the whole visible layer.
        node.attrs[VIEWPORT_HIT_BOUNDS_ATTRIBUTE] = hitBounds
      }

      const shouldListen = boundsIntersect(hitBounds, visibleBounds)
      if (node.listening() === shouldListen) return
      node.listening(shouldListen)
      changed = true
    })

    // Only the pixel hit canvas changed; avoid repainting the visible scene.
    if (changed) contentGroup.getLayer()?.drawHit()
  }, [canvasRef, viewportHitViewRef])

  const scheduleViewportHitGraphRefresh = useCallback(
    (remeasure: boolean) => {
      viewportHitNeedsRemeasureRef.current ||= remeasure
      if (viewportHitRefreshTimerRef.current != null) {
        window.clearTimeout(viewportHitRefreshTimerRef.current)
      }
      viewportHitRefreshTimerRef.current = window.setTimeout(() => {
        viewportHitRefreshTimerRef.current = null
        const needsRemeasure = viewportHitNeedsRemeasureRef.current
        viewportHitNeedsRemeasureRef.current = false
        refreshViewportHitGraph(needsRemeasure)
      }, 100)
    },
    [refreshViewportHitGraph, window, viewportHitNeedsRemeasureRef, viewportHitRefreshTimerRef]
  )

  useEffect(() => {
    scheduleViewportHitGraphRefresh(true)
  }, [layoutTree, scheduleViewportHitGraphRefresh, wireSegments])

  useEffect(() => {
    scheduleViewportHitGraphRefresh(false)
  }, [eendraadView.pan.x, eendraadView.pan.y, eendraadView.zoom, scheduleViewportHitGraphRefresh, viewportPixelSize.height, viewportPixelSize.width])

  useEffect(
    () => () => {
      if (viewportHitRefreshTimerRef.current != null) {
        window.clearTimeout(viewportHitRefreshTimerRef.current)
      }
    },
    [window, viewportHitRefreshTimerRef]
  )

  // Ensure the main panel is visible on first render when no saved view exists.
  // This runs from layout data alone — no Konva dependency — so it fires
  // immediately without waiting for the canvas scene graph to populate.
  const hasSetInitialView = useRef(false)
  useEffect(() => {
    if (hasSetInitialView.current || !layout || layout.panels.length === 0) return
    const view = viewportUI.getState().eendraadView
    if (view.pan.x !== 0 || view.pan.y !== 0) {
      hasSetInitialView.current = true
      return
    }
    hasSetInitialView.current = true
    const frame = layout.panels[0]!.frame
    const contentCenterX = frame.x + frame.width / 2
    const contentCenterY = frame.y + frame.height / 2
    const el = canvasRef.current?.getStage()?.container()
    const rect = el?.getBoundingClientRect()
    const vpW = rect?.width ?? 800
    const vpH = rect?.height ?? 600
    const padding = Math.min(vpW, vpH) * 0.1
    const fitZoom = Math.min(
      (vpW - padding * 2) / frame.width,
      (vpH - padding * 2) / frame.height,
      2
    )
    const zoom = Math.max(0.1, fitZoom)
    setEendraadView({
      zoom,
      pan: {
        x: vpW / 2 - contentCenterX * zoom,
        y: vpH / 2 - contentCenterY * zoom,
      },
    })
  }, [layout, setEendraadView, viewportUI, canvasRef])

  useEendraadCircuitLetterHotkeys(currentProject, pointerOverEendraadRef)

  // Convert pointer position from a Konva drag event to canvas/layout coordinates (for correct drop target).
  // Uses cursor position so drop target matches where the user released, not where the dragged symbol is.
  const getCanvasPositionFromEvent = useCallback((e: unknown) => {
    if (!isKonvaPointerEventLike(e)) return null
    const stage = e.target?.getStage?.()
    const pointer = stage?.getPointerPosition?.()
    if (!pointer) return null
    const view = canvasRef.current?.getLiveViewTransform() ?? eendraadViewRef.current
    return {
      x: (pointer.x - view.pan.x) / view.zoom,
      y: (pointer.y - view.pan.y) / view.zoom,
    }
  }, [canvasRef, eendraadViewRef])

  return { resizeConverterWithViewportAnchor, getCanvasPositionFromEvent }
}
