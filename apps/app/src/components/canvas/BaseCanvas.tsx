import { useBaseCanvasViewportSize } from './useBaseCanvasViewportSize'
import { useBaseCanvasMouseSelection } from './useBaseCanvasMouseSelection'
import { suppressNextCanvasElementTap } from '@/lib/canvas/syntheticElementTap'
import { useBaseCanvasTouchGestures } from './useBaseCanvasTouchGestures'
import { useBaseCanvasGrid } from './useBaseCanvasGrid'
import { DEFERRED_MOUSE_PAN_THRESHOLD_PX } from './baseCanvasGestureTiming'
import { useBaseCanvasLibraryPlacement } from './useBaseCanvasLibraryPlacement'
import { useBaseCanvasFitToView } from './useBaseCanvasFitToView'
import {
  LONG_PRESS_DELAY_MS,
  LONG_PRESS_FILL_MS,
  LONG_PRESS_READY_MS,
  debugTouchLog,
} from './baseCanvasGestureTiming'
import type { BaseCanvasProps, BaseCanvasHandle } from './baseCanvasModel'
export type { BaseCanvasHandle } from './baseCanvasModel'
import { useCanvasWindow } from '@/components/viewport/ViewportContext'
import { useViewportUIStore as useCanvasUIStore, useViewportUIApi } from '@/components/viewport/ViewportUIStore'

import { logger } from '@/lib/logger'
import ArmedSymbolCanvasBanner from '@/components/library/ArmedSymbolCanvasBanner'
import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useImperativeHandle,
  useMemo,
  forwardRef,
} from 'react'
import type { ForwardedRef } from 'react'
import {
  Stage,
  Layer,
  Rect,
} from 'react-konva'
import Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type {
  CanvasSize,
  Point,
  Selection,
} from '@/types/ui'
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_100,
} from '@/constants/canvasConstants'
import { useSettingsStore } from '@/stores/settingsStore'
import { useThemeColors } from '@/lib/theme/hooks'



import { useCommitClearSelection, useCommitSelection } from '@/editions/community/communityHooks'

import { blurActiveElementForCanvasPointerDown, blurFocusStealingActiveElement } from '@/lib/ui/blurFocusStealingActiveElement'
import { isAppDialogOpen } from '@/lib/ui/appModalInteraction'
import { selectIsAppDialogOpen, useDialogStore } from '@/stores/dialogStore'
import ContextMenuPortal from './ContextMenuPortal'
import type { ContextMenuItem } from '@/components/common/ContextMenu'
import {
  SelectionPreviewProvider,
  createSelectionPreviewStore,
  type PreviewElement,
} from '@/contexts/SelectionPreviewContext'
import { useViewportResizePreviewActive } from '@/components/layout/ViewportResizePreviewContext'
import { useInitialCanvasSize } from '@/components/layout/initialCanvasSize'
import { resolveKonvaElementId } from './baseCanvasElementId'

import { mirrorLayerCameraTransform } from '@/lib/canvas/layerCameraTransform'
import { hasCanvasPrimaryAction, resolveCanvasCursor } from '@/lib/canvas/canvasCursor'
import { longPressTargetIsSelectionBackground, shouldIgnoreCanvasTouchForContextMenu } from '@/lib/canvas/touchGestureIntent'
import {
  WHEEL_GESTURE_RESET_MS,
  resolveWheelAction,
  updateWheelBehaviorEvidence,
  type WheelBehaviorEvidenceState,
} from './wheelGesture'
import { useWheelBehaviorHintStore } from '@/stores/wheelBehaviorHintStore'
import { PROJECT_DOCUMENT_DRAG_TYPE } from '@/lib/documents/projectDocuments'

type KonvaSceneContextWithNativeCanvas = {
  _context?: CanvasRenderingContext2D
}

type KonvaImagePrototypeWithSceneFunc = typeof Konva.Image.prototype & {
  _sceneFunc?: (this: Konva.Image, ctx: KonvaSceneContextWithNativeCanvas) => void
  __hqPatched?: boolean
}





// Patch Konva.Image to use medium-quality image smoothing.
// Setting the property on the Layer canvas context via useEffect gets lost
// when Konva resets context state (canvas resize triggers full state reset).
// This patch applies the property right before each drawImage call.
const imagePrototype = Konva.Image.prototype as KonvaImagePrototypeWithSceneFunc
const _origImageScene = imagePrototype._sceneFunc
if (_origImageScene && !imagePrototype.__hqPatched) {
  imagePrototype.__hqPatched = true
  imagePrototype._sceneFunc = function (this: Konva.Image, ctx: KonvaSceneContextWithNativeCanvas) {
    const native = ctx._context
    if (native) {
      native.imageSmoothingEnabled = true
      native.imageSmoothingQuality = 'medium'
    }
    _origImageScene.call(this, ctx)
  }
}




const LONG_PRESS_RING_FADE_MS = 160
const LONG_PRESS_CANCEL_THRESHOLD_EMPTY = 18
const LONG_PRESS_COMPLETE_THRESHOLD_EMPTY = 24
/** Cancel pending long-press when the finger moves this far (regular drag on symbols). */
const LONG_PRESS_CANCEL_THRESHOLD_DRAGGABLE = 8
/** Allow long-press to complete if the finger is still within this radius (hold tremor). */
const LONG_PRESS_COMPLETE_THRESHOLD_DRAGGABLE = 14
const LP_RING_CIRCUMFERENCE = 2 * Math.PI * 34
/** Trailing debounce: reset on each scheduleCameraSync call so bursts coalesce. */
const CAMERA_SYNC_TRAIL_MS = 120
const EMPTY_PREVIEW_ELEMENTS: PreviewElement[] = []
const CAMERA_MOVE_THRESHOLD_PX = 4
const CAMERA_ZOOM_THRESHOLD = 0.01
/** Ignore tiny focus/trackpad pointer jitter before treating a right-click as a pan. */

/** Hide grid entirely when zoomed out past this (reduces Line count + overdraw). */

/** When a grid cell is smaller than this in screen px, skip drawing (too dense). */





/** Stable signature for rect-select preview lists — skip context updates when the set of hits is unchanged. */
function previewSelectionSignature(elements: Array<{ id: string; type: string }>): string {
  if (elements.length === 0) return ''
  return [...elements]
    .sort((a, b) => (a.type + '\0' + a.id).localeCompare(b.type + '\0' + b.id))
    .map((e) => `${e.type}:${e.id}`)
    .join('|')
}








const BaseCanvas = forwardRef(function BaseCanvasImpl(
  {
    zoom,
    pan: panProp,
    showGrid,
    gridSize,
    onZoomChange,
    onPanChange,
    onViewTransformCommit,
    onPrepareFitToView,
    onDrop,
    onDocumentDrop,
    onFilesDrop,
    children,
    backgroundColor: _backgroundColor = '#ffffff',
    gridInTransformedLayer = false,
    gridOpacity = 1,
    onFindElementsInRectangle,
    onCaptureRectangle,
    onGetContextMenuItems,
    onGetSelectionBounds,
    onDragOver,
    onMultiFingerSwipe,
    enableSingleFingerPan = true,
    prioritizeNavigation = false,
    enableLongPressContextMenu = true,
    longPressDuplicateDrag,
    longPressDragSelectFromContent = false,
    onViewportPanStateChange,
    cursor: cursorProp,
    pointerFollower,
    onCanvasPrimaryClick,
    disableContentHitGraph = false,
    overlayChildren,
    enableIsolatedDragLayer = false,
    onViewportPixelSizeChange,
    selectionFitMaxZoom,
    minZoom: minZoomProp = ZOOM_MIN,
    gestureZoomCanvas,
  }: BaseCanvasProps,
  ref: ForwardedRef<BaseCanvasHandle>
) {
  const window = useCanvasWindow()
  const viewportUI = useViewportUIApi()
  const boundWindowRef = useRef(window)
  useEffect(() => {
    if (boundWindowRef.current === window) return
    boundWindowRef.current = window
    const stage = stageRef.current
    // Konva binds native drag listeners to its container's document. Rebind after
    // adopting the existing DOM into a popup, keeping the same stage and artwork.
    if (stage) stage.setContainer(stage.container())
  }, [window])
  // Defensive: Safari iPad can pass undefined/NaN for pan or zoom (timing, touch, or persisted state).
  const pan = useMemo(() => panProp ?? { x: 0, y: 0 }, [panProp])
  const fin = useCallback(
    (n: number, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? n : fallback),
    [],
  )
  const minZoom = Number.isFinite(minZoomProp) && minZoomProp > 0
    ? Math.min(ZOOM_MAX, minZoomProp)
    : ZOOM_MIN
  const minZoomRef = useRef(minZoom)
  minZoomRef.current = minZoom
  const safePan = useMemo(() => ({ x: fin(pan.x, 0), y: fin(pan.y, 0) }), [fin, pan.x, pan.y])
  const safeZoom = useMemo(
    () => Math.max(minZoom, Math.min(ZOOM_MAX, fin(zoom, ZOOM_100))),
    [fin, minZoom, zoom],
  )
  const themeMode = useSettingsStore((state) => state.theme.mode)
  const leftDragPansCanvas = useSettingsStore((state) => state.leftDragPansCanvas)
  const wheelBehavior = useSettingsStore((state) => state.wheelBehavior)
  const isDark = themeMode === 'dark'
  const viewportResizePreviewActive = useViewportResizePreviewActive()
  const appDialogOpen = useDialogStore(selectIsAppDialogOpen)
  const setSelection = useCommitSelection()
  const clearSelection = useCommitClearSelection()
  const libraryDragSymbol = useCanvasUIStore((state) => state.libraryDragSymbol)
  const armedLibrarySymbol = useCanvasUIStore((state) => state.armedLibrarySymbol)
  const armedPlacementActive = !!armedLibrarySymbol && !!onDrop
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const contentLayerRef = useRef<Konva.Layer>(null)
  const overlayLayerRef = useRef<Konva.Layer>(null)
  const syncAndDrawTransformedLayers = useCallback(() => {
    const contentLayer = contentLayerRef.current
    if (!contentLayer) return
    const overlayLayer = overlayLayerRef.current
    mirrorLayerCameraTransform(contentLayer, overlayLayer)
    // Konva's shared batch queue uses the opener's animation frame, which can stop
    // while that window is minimized. Detached gestures already run on their own frame.
    if (window !== globalThis.window) {
      contentLayer.draw()
      overlayLayer?.draw()
    } else {
      contentLayer.batchDraw()
      overlayLayer?.batchDraw()
    }
  }, [window])
  const initialViewportSize = useInitialCanvasSize()
  const [size, setSize] = useState<CanvasSize>(() => initialViewportSize ?? { width: 800, height: 600 })
  const deferredViewportSizeRef = useRef<CanvasSize | null>(null)
  const scheduledViewportSizeRef = useRef<CanvasSize | null>(null)
  const scheduledViewportRafRef = useRef<number | null>(null)
  const scheduledViewportTimeoutRef = useRef<number | null>(null)
  /** Deferred from pan start (rAF) so the first pan frame does not trigger React + grid rebuild. */
  const [isPanningForUI, setIsPanningForUI] = useState(false)
  /** True after single-finger touch pan exceeds drag threshold (disables layer listening like mouse pan UI). */
  const [touchFingerPanForUI, setTouchFingerPanForUI] = useState(false)
  const lastPanPointRef = useRef<Point>({ x: 0, y: 0 })
  const [isDragOver, setIsDragOver] = useState(false)
  // Immediate ref avoids a stale React state value swallowing the first context-menu event.
  const rightClickDragOccurredRef = useRef(false)
  // Button that owns the current deferred/active mouse pan; only a right-button drag may
  // suppress the next context menu (a left-drag pan must not eat the following right-click).
  const mousePanButtonRef = useRef<number | null>(null)
  // Track if any drag occurred (to prevent selection after drag)
  const [dragOccurred, setDragOccurred] = useState(false)
  const [pointerFollowerPosition, setPointerFollowerPosition] = useState<Point | null>(null)
  const canvasHoverRef = useRef(false)

  // Selection rectangle state (in screen coordinates)
  const [selectionRect, setSelectionRect] = useState<{
    startX: number
    startY: number
    endX: number
    endY: number
  } | null>(null)
  const [isSelecting, setIsSelecting] = useState(false)
  /** True from empty-stage mousedown until mouseup; avoids React commits on click-only deselect. */
  const rectSelectActiveRef = useRef(false)
  // Track elements that would be selected during drag (for preview highlighting)
  const previewSelectionStoreRef = useRef(createSelectionPreviewStore(EMPTY_PREVIEW_ELEMENTS))
  const previewSelectedElementsRef = useRef<PreviewElement[]>(EMPTY_PREVIEW_ELEMENTS)
  const setPreviewSelectedElements = useCallback((next: PreviewElement[]) => {
    previewSelectedElementsRef.current = next
    previewSelectionStoreRef.current.setSnapshot(next)
  }, [])
  const setSelectionPreviewActive = useCallback((active: boolean) => {
    previewSelectionStoreRef.current.setActive(active)
  }, [])
  // Live rect + rAF coalescing: mousemove can fire far faster than display refresh; updating React every event
  // forces full canvas re-renders and (in Firefox) heavy incremental CC on large graphs.
  const selectionRectLiveRef = useRef<{
    startX: number
    startY: number
    endX: number
    endY: number
  } | null>(null)
  const selectionDragRafRef = useRef<number | null>(null)
  const previewSelectionSignatureRef = useRef<string>('')
  const onFindElementsInRectangleRef = useRef(onFindElementsInRectangle)
  onFindElementsInRectangleRef.current = onFindElementsInRectangle
  const onCaptureRectangleRef = useRef(onCaptureRectangle)
  onCaptureRectangleRef.current = onCaptureRectangle

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    position: { x: number; y: number }
    items: ContextMenuItem[]
  } | null>(null)

  // Touch gesture state
  const [touchStartDistance, setTouchStartDistance] = useState<number | null>(null)
  const [touchStartZoom, setTouchStartZoom] = useState<number>(1)
  const [touchStartPan, setTouchStartPan] = useState<Point>({ x: 0, y: 0 })
  const [touchStartCenter, setTouchStartCenter] = useState<Point | null>(null)
  // Single-finger pan state
  const [touchPanStart, setTouchPanStart] = useState<Point | null>(null)
  const [touchPanInitialCanvasPan, setTouchPanInitialCanvasPan] = useState<Point | null>(null)
  const touchPanStartRef = useRef<Point | null>(null)
  const touchPanInitialCanvasPanRef = useRef<Point | null>(null)
  const [touchHasMoved, setTouchHasMoved] = useState(false)
  // Use ref for immediate drag detection (state might lag)
  const dragOccurredRef = useRef(false)
  /** Right/middle-button mouse pan active (Konva-driven; not React state). */
  const isPanningRef = useRef(false)
  const touchSingleFingerPanActiveRef = useRef(false)
  const panDisabledListeningRef = useRef(false)
  const mousePanWindowCleanupRef = useRef<(() => void) | null>(null)
  const touchPanWindowCleanupRef = useRef<(() => void) | null>(null)
  const panUiRafRef = useRef<number | null>(null)
  const mousePanDrawRafRef = useRef<number | null>(null)
  const handleMouseUpRef = useRef<(e?: KonvaEventObject<MouseEvent>) => void>(() => {})
  const handleTouchMoveRef = useRef<(e: React.TouchEvent<HTMLDivElement> | TouchEvent) => void>(
    () => {}
  )
  const handleTouchEndRef = useRef<(e?: React.TouchEvent<HTMLDivElement> | TouchEvent) => void>(
    () => {}
  )
  const wheelPanAccumRef = useRef({ dx: 0, dy: 0 })
  const wheelRafRef = useRef<number | null>(null)
  const wheelZoomRafRef = useRef<number | null>(null)
  const wheelZoomAccumFactorRef = useRef(1)
  const wheelZoomPointerRef = useRef<Point | null>(null)
  const wheelGestureResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastWheelEventAtRef = useRef(0)
  const wheelBehaviorEvidenceRef = useRef<WheelBehaviorEvidenceState>({ behavior: wheelBehavior, evidenceInput: null, eventCount: 0 })
  const suppressTouchContextMenuUntilRef = useRef(0)
  /** True while wheel-zoom updates the Konva layer imperatively; suppresses React prop sync so stale store zoom cannot overwrite the layer. */
  const wheelZoomGestureActiveRef = useRef(false)
  /** Mouse button down, waiting for movement before pan activates (context-menu click stays cheap). */
  const pendingMouseButtonPanRef = useRef<{
    startX: number
    startY: number
    button: number
    shiftKey: boolean
    altKey: boolean
  } | null>(null)
  const suppressNextContextMenuRef = useRef(false)

  const hoveredCursorNodeRef = useRef<Konva.Node | null>(null)
  const cursorShiftKeyRef = useRef(false)
  const idleCanvasCursor = resolveCanvasCursor({
    panning: isPanningForUI,
    toolCursor: cursorProp ?? (pointerFollower || armedPlacementActive ? 'crosshair' : undefined),
    primaryAction: false,
    emptyBackground: true,
    leftDragPansCanvas,
    primaryClickTool: !!onCanvasPrimaryClick,
  })
  const updateCanvasCursor = useCallback((preserveResize = false) => {
    const stage = stageRef.current
    if (!stage) return
    const container = stage.container()
    // Child hover handlers and Konva Transformer own their directional resize cursors.
    if (preserveResize && !isPanningForUI && container.style.cursor.endsWith('-resize')) return
    const node = hoveredCursorNodeRef.current
    container.style.cursor = resolveCanvasCursor({
      panning: isPanningForUI,
      toolCursor: cursorProp ?? (pointerFollower || armedPlacementActive ? 'crosshair' : undefined),
      primaryAction: !!node && hasCanvasPrimaryAction(node, stage),
      emptyBackground: !node || node === stage,
      leftDragPansCanvas,
      shiftKey: cursorShiftKeyRef.current,
      primaryClickTool: !!onCanvasPrimaryClick,
    })
  }, [
    isPanningForUI,
    cursorProp,
    pointerFollower,
    armedPlacementActive,
    leftDragPansCanvas,
    onCanvasPrimaryClick,
  ])
  const updateCanvasCursorRef = useRef(updateCanvasCursor)
  updateCanvasCursorRef.current = updateCanvasCursor

  useEffect(() => {
    updateCanvasCursor(true)
  }, [updateCanvasCursor])

  useEffect(() => {
    const handleModifiers = (event: KeyboardEvent) => {
      cursorShiftKeyRef.current = event.shiftKey
      if (canvasHoverRef.current) updateCanvasCursor(true)
    }
    window.addEventListener('keydown', handleModifiers)
    window.addEventListener('keyup', handleModifiers)
    return () => {
      window.removeEventListener('keydown', handleModifiers)
      window.removeEventListener('keyup', handleModifiers)
    }
  }, [updateCanvasCursor, window])

  

  // 3/4-finger swipe: ref so we can read last position in touchEnd when touches may be empty
  const multiFingerSwipeRef = useRef<{
    active: boolean
    fingerCount: number
    startCenter: Point
    lastCenter: Point
  } | null>(null)
  // When true, next stage tap must not clear selection (used after 3/4-finger swipe so lift-off doesn't clear)
  const ignoreNextTapClearRef = useRef(false)
  // While true, we're handling a camera gesture (multi-touch pan/zoom/swipe) and should avoid hit-testing.
  const cameraGestureActiveRef = useRef(false)
  const cameraGestureDisabledListeningRef = useRef(false)
  const cssCameraTransformRef = useRef<{
    active: boolean
    startPan: Point
    startZoom: number
    livePan: Point
    liveZoom: number
  }>({
    active: false,
    startPan: { x: 0, y: 0 },
    startZoom: ZOOM_100,
    livePan: { x: 0, y: 0 },
    liveZoom: ZOOM_100,
  })
  // Single-finger touch started on a draggable (e.g. panel module): don't steal gesture for canvas pan.
  const touchStartedOnDraggableRef = useRef(false)
  const touchStartElementIdRef = useRef<string | null>(null)
  const touchStartedOnContentRef = useRef(false)

  // Double-tap tracking (touch devices): last tap time/position/element id for second-tap detection
  const lastTapRef = useRef<{
    time: number
    clientX: number
    clientY: number
    elementId: string | null
  } | null>(null)
  const pendingTouchSelectionClearRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastProcessedTouchEndRef = useRef<{
    identifier: number
    clientX: number
    clientY: number
    timeStamp: number
  } | null>(null)
  /** Ignore Konva mouse events until this time (ms) — blocks iOS/Android synthetic mouse after touch. */
  const suppressSyntheticMouseUntilRef = useRef(0)

  // Long-press gesture state (touch devices)
  const longPress = useRef({
    phase: 'idle' as 'idle' | 'filling' | 'ready',
    action: 'idle' as 'idle' | 'duplicate-drag' | 'drag-select',
    origin: null as Point | null,
    screenPos: null as Point | null,
    elementId: null as string | null,
    elementType: null as Selection['type'] | null,
    startedOnDraggable: false,
    startedAt: 0,
    delayTimer: null as ReturnType<typeof setTimeout> | null,
    readyTimer: null as ReturnType<typeof setTimeout> | null,
  })
  const lastSingleTouchRef = useRef<Point | null>(null)
  const longPressTouchWatchCleanupRef = useRef<(() => void) | null>(null)
  const [longPressIndicator, setLongPressIndicator] = useState<{
    phase: 'filling' | 'dismissing'
    position: Point
  } | null>(null)
  const longPressIndicatorFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Get theme-aware colors
  const colors = useThemeColors()
  const actualBackgroundColor = colors.background
  const gridColor = colors.grid

  const stopLongPressTouchWatch = useCallback(() => {
    longPressTouchWatchCleanupRef.current?.()
    longPressTouchWatchCleanupRef.current = null
  }, [])

  const longPressCancelThresholdPx = useCallback(() => {
    return longPress.current.startedOnDraggable &&
      (longPressDuplicateDragRef.current || longPressDragSelectFromContentRef.current)
      ? LONG_PRESS_CANCEL_THRESHOLD_DRAGGABLE
      : LONG_PRESS_CANCEL_THRESHOLD_EMPTY
  }, [])

  const longPressCompleteThresholdPx = useCallback(() => {
    return longPress.current.startedOnDraggable &&
      (longPressDuplicateDragRef.current || longPressDragSelectFromContentRef.current)
      ? LONG_PRESS_COMPLETE_THRESHOLD_DRAGGABLE
      : LONG_PRESS_COMPLETE_THRESHOLD_EMPTY
  }, [])

  const isLongPressFingerAtOrigin = useCallback(
    (clientX?: number, clientY?: number, forComplete = false): boolean => {
      const origin = longPress.current.origin
      if (!origin) return false
      const last = lastSingleTouchRef.current
      const x = clientX ?? last?.x
      const y = clientY ?? last?.y
      if (x == null || y == null) return false
      const dx = x - origin.x
      const dy = y - origin.y
      const limit = forComplete ? longPressCompleteThresholdPx() : longPressCancelThresholdPx()
      return Math.hypot(dx, dy) <= limit
    },
    [longPressCancelThresholdPx, longPressCompleteThresholdPx],
  )

  const clearLongPressIndicator = useCallback(() => {
    if (longPressIndicatorFadeTimerRef.current) {
      clearTimeout(longPressIndicatorFadeTimerRef.current)
      longPressIndicatorFadeTimerRef.current = null
    }
    setLongPressIndicator(null)
  }, [])

  const dismissLongPressIndicator = useCallback(
    (position?: Point) => {
      if (longPressIndicatorFadeTimerRef.current) {
        clearTimeout(longPressIndicatorFadeTimerRef.current)
      }
      setLongPressIndicator((prev) => {
        const pos = position ?? prev?.position
        if (!pos) return null
        return { phase: 'dismissing', position: pos }
      })
      longPressIndicatorFadeTimerRef.current = setTimeout(() => {
        longPressIndicatorFadeTimerRef.current = null
        setLongPressIndicator(null)
      }, LONG_PRESS_RING_FADE_MS)
    },
    [],
  )

  const cancelLongPress = useCallback(() => {
    debugTouchLog('cancelLongPress', {
      phase: longPress.current.phase,
      origin: longPress.current.origin,
      screenPos: longPress.current.screenPos,
      elementId: longPress.current.elementId,
      elementType: longPress.current.elementType,
      elapsedMs: longPress.current.startedAt
        ? Math.round(performance.now() - longPress.current.startedAt)
        : null,
      hasDelayTimer: longPress.current.delayTimer != null,
      hasReadyTimer: longPress.current.readyTimer != null,
    })
    stopLongPressTouchWatch()
    if (longPress.current.delayTimer) clearTimeout(longPress.current.delayTimer)
    if (longPress.current.readyTimer) clearTimeout(longPress.current.readyTimer)
    longPress.current.phase = 'idle'
    longPress.current.action = 'idle'
    longPress.current.origin = null
    longPress.current.screenPos = null
    longPress.current.elementId = null
    longPress.current.elementType = null
    longPress.current.startedOnDraggable = false
    longPress.current.startedAt = 0
    longPress.current.delayTimer = null
    longPress.current.readyTimer = null
    clearLongPressIndicator()
  }, [clearLongPressIndicator, stopLongPressTouchWatch])

  const maybeCancelLongPressForMovement = useCallback(
    (clientX: number, clientY: number) => {
      if (longPress.current.action === 'duplicate-drag') return
      if (!longPress.current.origin) return
      const pending =
        longPress.current.delayTimer != null ||
        longPress.current.readyTimer != null ||
        longPress.current.phase === 'filling'
      if (!pending && longPress.current.phase !== 'ready') return
      if (longPress.current.phase === 'ready') return
      if (isLongPressFingerAtOrigin(clientX, clientY, false)) return
      debugTouchLog('cancelLongPress due to finger movement', {
        clientX,
        clientY,
        origin: longPress.current.origin,
        threshold: longPressCancelThresholdPx(),
        startedOnDraggable: longPress.current.startedOnDraggable,
      })
      cancelLongPress()
    },
    [cancelLongPress, isLongPressFingerAtOrigin, longPressCancelThresholdPx],
  )

  const shouldLongPressBlockSingleFingerPan = useCallback(() => {
    return (
      longPress.current.phase === 'filling' ||
      longPress.current.phase === 'ready' ||
      longPress.current.delayTimer != null ||
      longPress.current.readyTimer != null
    )
  }, [])

  const startLongPressTouchWatch = useCallback(() => {
    stopLongPressTouchWatch()
    const onWatchMove = (evt: TouchEvent) => {
      if (evt.touches.length !== 1) return
      const t = evt.touches[0]
      if (!t) return
      lastSingleTouchRef.current = { x: t.clientX, y: t.clientY }
      maybeCancelLongPressForMovement(t.clientX, t.clientY)
    }
    window.addEventListener('touchmove', onWatchMove, { capture: true, passive: true })
    longPressTouchWatchCleanupRef.current = () => {
      window.removeEventListener('touchmove', onWatchMove, true)
    }
  }, [maybeCancelLongPressForMovement, stopLongPressTouchWatch, window])

  const suppressSyntheticMouseAfterTouch = useCallback((durationMs = 500) => {
    suppressSyntheticMouseUntilRef.current = Math.max(
      suppressSyntheticMouseUntilRef.current,
      Date.now() + durationMs
    )
  }, [])

  const shouldIgnoreSyntheticMouseEvent = useCallback(() => {
    return Date.now() < suppressSyntheticMouseUntilRef.current
  }, [])

  const cancelPendingTouchSelectionClear = useCallback(() => {
    if (pendingTouchSelectionClearRef.current) {
      clearTimeout(pendingTouchSelectionClearRef.current)
      pendingTouchSelectionClearRef.current = null
    }
  }, [])

  const schedulePendingTouchSelectionClear = useCallback(() => {
    cancelPendingTouchSelectionClear()
    clearSelection()
  }, [cancelPendingTouchSelectionClear, clearSelection])

  const getCssCameraCanvases = useCallback((): HTMLCanvasElement[] => {
    const canvases: HTMLCanvasElement[] = []
    const contentCanvas = contentLayerRef.current?.getNativeCanvasElement()
    if (contentCanvas) canvases.push(contentCanvas)
    const overlayCanvas = overlayLayerRef.current?.getNativeCanvasElement()
    if (overlayCanvas) canvases.push(overlayCanvas)
    return canvases
  }, [])

  const applyCssCameraTransform = useCallback(
    (nextPan: Point, nextZoom: number) => {
      const state = cssCameraTransformRef.current
      if (!state.active) return false
      state.livePan = nextPan
      state.liveZoom = nextZoom

      const startZoom = Math.max(minZoomRef.current, Math.min(ZOOM_MAX, fin(state.startZoom, ZOOM_100)))
      const scale = Math.max(minZoomRef.current, Math.min(ZOOM_MAX, fin(nextZoom, startZoom))) / startZoom
      const translateX = nextPan.x - state.startPan.x * scale
      const translateY = nextPan.y - state.startPan.y * scale
      const transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`

      getCssCameraCanvases().forEach((canvas) => {
        canvas.style.transformOrigin = '0 0'
        canvas.style.transform = transform
        canvas.style.willChange = 'transform'
        canvas.style.backfaceVisibility = 'hidden'
      })
      return true
    },
    [fin, getCssCameraCanvases]
  )

  const beginCssCameraTransform = useCallback(
    (startPan: Point, startZoom: number) => {
      cssCameraTransformRef.current = {
        active: true,
        startPan,
        startZoom,
        livePan: startPan,
        liveZoom: startZoom,
      }
      getCssCameraCanvases().forEach((canvas) => {
        canvas.style.transformOrigin = '0 0'
        canvas.style.willChange = 'transform'
        canvas.style.backfaceVisibility = 'hidden'
      })
    },
    [getCssCameraCanvases]
  )

  const finishCssCameraTransform = useCallback(
    (commitLiveTransform: boolean) => {
      const state = cssCameraTransformRef.current
      if (!state.active) return

      const nextPan = state.livePan
      const nextZoom = Math.max(minZoomRef.current, Math.min(ZOOM_MAX, fin(state.liveZoom, state.startZoom)))
      cssCameraTransformRef.current = {
        active: false,
        startPan: nextPan,
        startZoom: nextZoom,
        livePan: nextPan,
        liveZoom: nextZoom,
      }

      const contentLayer = contentLayerRef.current
      const overlayLayer = overlayLayerRef.current

      if (commitLiveTransform && contentLayer) {
        contentLayer.x(nextPan.x)
        contentLayer.y(nextPan.y)
        contentLayer.scale({ x: nextZoom, y: nextZoom })
        if (overlayLayer) {
          overlayLayer.x(nextPan.x)
          overlayLayer.y(nextPan.y)
          overlayLayer.scale({ x: nextZoom, y: nextZoom })
        }
        panRef.current = nextPan
        zoomRef.current = nextZoom
      }

      getCssCameraCanvases().forEach((canvas) => {
        canvas.style.transform = ''
        canvas.style.transformOrigin = ''
        canvas.style.willChange = ''
        canvas.style.backfaceVisibility = ''
      })

      if (commitLiveTransform) {
        contentLayer?.batchDraw()
        overlayLayer?.batchDraw()
      }
    },
    [fin, getCssCameraCanvases]
  )

  const clearPreviewSelection = useCallback(() => {
    const hasPreview =
      previewSelectionSignatureRef.current !== '' || previewSelectedElementsRef.current.length > 0
    previewSelectionSignatureRef.current = ''
    if (hasPreview) {
      setPreviewSelectedElements(EMPTY_PREVIEW_ELEMENTS)
    }
    setSelectionPreviewActive(false)
  }, [setPreviewSelectedElements, setSelectionPreviewActive])

  const resetCanvasTouchGestureForContextMenu = useCallback(() => {
    cancelLongPress()
    cancelPendingTouchSelectionClear()
    if (selectionDragRafRef.current != null) {
      window.cancelAnimationFrame(selectionDragRafRef.current)
      selectionDragRafRef.current = null
    }
    touchPanWindowCleanupRef.current?.()
    touchPanWindowCleanupRef.current = null
    rectSelectActiveRef.current = false
    selectionRectLiveRef.current = null
    lastTapRef.current = null
    touchStartElementIdRef.current = null
    touchStartedOnContentRef.current = false
    touchStartedOnDraggableRef.current = false
    touchPanStartRef.current = null
    touchPanInitialCanvasPanRef.current = null
    dragOccurredRef.current = false
    clearPreviewSelection()
    setIsSelecting(false)
    setSelectionRect(null)
    setTouchPanStart(null)
    setTouchPanInitialCanvasPan(null)
    setTouchHasMoved(false)
    setDragOccurred(false)
    setTouchFingerPanForUI(false)
  }, [cancelLongPress, cancelPendingTouchSelectionClear, clearPreviewSelection, window])

  const setCameraGestureHitTestingDisabled = useCallback((disabled: boolean) => {
    const stage = stageRef.current
    if (!stage) return
    if (disabled) {
      cameraGestureActiveRef.current = true
      if (stage.listening()) {
        stage.listening(false)
      }
      cameraGestureDisabledListeningRef.current = true
      return
    }
    cameraGestureActiveRef.current = false
    if (cameraGestureDisabledListeningRef.current) {
      stage.listening(true)
      cameraGestureDisabledListeningRef.current = false
    }
  }, [])

  // Update canvas size on resize and preserve the center point so layouts
  // don't make the view jump when panels change dimensions.
  const prevSizeRef = useRef<CanvasSize | null>(null)
  const panRef = useRef(pan)
  const zoomRef = useRef(zoom)
  // The store receives mouse pan only on release. Pan UI state and unrelated
  // renders must not replace the live camera with those stale props mid-drag.
  if (
    !isPanningRef.current &&
    !pendingMouseButtonPanRef.current &&
    !touchSingleFingerPanActiveRef.current &&
    !cssCameraTransformRef.current.active &&
    !wheelZoomGestureActiveRef.current
  ) {
    panRef.current = pan
    zoomRef.current = zoom
  }

  const scheduleSelectionDragFrame = useCallback(() => {
    if (selectionDragRafRef.current != null) return
    selectionDragRafRef.current = window.requestAnimationFrame(() => {
      selectionDragRafRef.current = null
      if (!rectSelectActiveRef.current) return
      const live = selectionRectLiveRef.current
      if (!live) return

      const stageRectW = Math.abs(live.endX - live.startX)
      const stageRectH = Math.abs(live.endY - live.startY)
      if (stageRectW <= 5 && stageRectH <= 5) return

      setIsSelecting(true)
      setSelectionPreviewActive(true)
      setSelectionRect({ ...live })

      const onFind = onFindElementsInRectangleRef.current
      if (!onFind) return

      const p = panRef.current
      const z = Math.max(minZoomRef.current, Math.min(ZOOM_MAX, fin(zoomRef.current, ZOOM_100)))

      const startCanvasX = (live.startX - p.x) / z
      const startCanvasY = (live.startY - p.y) / z
      const endCanvasX = (live.endX - p.x) / z
      const endCanvasY = (live.endY - p.y) / z

      const rectX = Math.min(startCanvasX, endCanvasX)
      const rectY = Math.min(startCanvasY, endCanvasY)
      const rectWidth = Math.abs(endCanvasX - startCanvasX)
      const rectHeight = Math.abs(endCanvasY - startCanvasY)

      if (rectWidth > 5 && rectHeight > 5) {
        const elements = onFind({
          x: rectX,
          y: rectY,
          width: rectWidth,
          height: rectHeight,
        })
        const filteredElements = elements.filter((el) => el.type !== 'wire') as PreviewElement[]
        const sig = previewSelectionSignature(filteredElements)
        if (sig !== previewSelectionSignatureRef.current) {
          previewSelectionSignatureRef.current = sig
          setPreviewSelectedElements(
            filteredElements.length > 0 ? filteredElements : EMPTY_PREVIEW_ELEMENTS
          )
        }
      } else {
        if (
          previewSelectionSignatureRef.current !== '' ||
          previewSelectedElementsRef.current.length > 0
        ) {
          previewSelectionSignatureRef.current = ''
          setPreviewSelectedElements(EMPTY_PREVIEW_ELEMENTS)
        }
      }
    })
  }, [fin, setPreviewSelectedElements, setSelectionPreviewActive, window])

  const onGetContextMenuItemsRef = useRef(onGetContextMenuItems)
  onGetContextMenuItemsRef.current = onGetContextMenuItems
  const setContextMenuRef = useRef(setContextMenu)
  setContextMenuRef.current = setContextMenu
  const enableLongPressContextMenuRef = useRef(enableLongPressContextMenu)
  enableLongPressContextMenuRef.current = enableLongPressContextMenu
  const longPressDuplicateDragRef = useRef(longPressDuplicateDrag)
  longPressDuplicateDragRef.current = longPressDuplicateDrag
  const longPressDragSelectFromContentRef = useRef(longPressDragSelectFromContent)
  longPressDragSelectFromContentRef.current = longPressDragSelectFromContent
  const onPanChangeRef = useRef(onPanChange)
  onPanChangeRef.current = onPanChange
  const onZoomChangeRef = useRef(onZoomChange)
  onZoomChangeRef.current = onZoomChange
  const onViewTransformCommitRef = useRef(onViewTransformCommit)
  onViewTransformCommitRef.current = onViewTransformCommit
  const onCanvasPrimaryClickRef = useRef(onCanvasPrimaryClick)
  onCanvasPrimaryClickRef.current = onCanvasPrimaryClick

  const emitViewTransformPatch = useCallback((patch: { pan?: Point; zoom?: number }) => {
    const hasZoom = typeof patch.zoom === 'number'
    const hasPan = patch.pan !== undefined
    if (!hasZoom && !hasPan) return
    const batch = onViewTransformCommitRef.current
    if (batch) {
      batch(patch)
      return
    }
    if (hasZoom) onZoomChangeRef.current(patch.zoom as number)
    if (hasPan && patch.pan) onPanChangeRef.current(patch.pan)
  }, [])
  const onViewportPanStateChangeRef = useRef(onViewportPanStateChange)
  onViewportPanStateChangeRef.current = onViewportPanStateChange
  const pendingViewRef = useRef<{ pan: Point | null; zoom: number | null }>({
    pan: null,
    zoom: null,
  })
  const viewRafRef = useRef<number | null>(null)
  const cameraSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const postPaintCameraCommitRafRef = useRef<number | null>(null)
  const postPaintCameraCommitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSyncedViewRef = useRef<{ pan: Point | null; zoom: number | null }>({
    pan: null,
    zoom: null,
  })
  const ignoreNextBackdropClickRef = useRef(false)

  const getLiveViewTransform = useCallback((): { pan: Point; zoom: number } => {
    const cssCamera = cssCameraTransformRef.current
    if (cssCamera.active) {
      return {
        pan: cssCamera.livePan,
        zoom: cssCamera.liveZoom,
      }
    }
    const layer = contentLayerRef.current
    if (layer) {
      const layerZoom = layer.scaleX() || 1
      return {
        pan: { x: layer.x(), y: layer.y() },
        zoom: layerZoom,
      }
    }
    debugTouchLog('getLiveViewTransform fallback', { pan: panRef.current, zoom: zoomRef.current })
    return {
      pan: panRef.current,
      zoom: zoomRef.current,
    }
  }, [])

  const clientToStageAndCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return null

      const stageX = clientX - rect.left
      const stageY = clientY - rect.top
      const { pan: livePan, zoom: liveZoom } = getLiveViewTransform()

      debugTouchLog('clientToStageAndCanvas', {
        clientX,
        clientY,
        stageX,
        stageY,
        pan: livePan,
        zoom: liveZoom,
      })

      return {
        stage: { x: stageX, y: stageY },
        canvas: {
          x: (stageX - livePan.x) / liveZoom,
          y: (stageY - livePan.y) / liveZoom,
        },
      }
    },
    [getLiveViewTransform]
  )

  const getElementIdAtClientPoint = useCallback(
    (clientX: number, clientY: number): string | null => {
      const stage = stageRef.current
      const rect = containerRef.current?.getBoundingClientRect()
      if (!stage || !rect) return null
      const node = stage.getIntersection({
        x: clientX - rect.left,
        y: clientY - rect.top,
      })
      const id = node ? resolveKonvaElementId(node, stage) : null
      debugTouchLog('getElementIdAtClientPoint', { clientX, clientY, id, hasNode: !!node })
      return id
    },
    []
  )

  const openContextMenuAtClientPoint = useCallback(
    (clientX: number, clientY: number): boolean => {
      const pos = clientToStageAndCanvas(clientX, clientY)
      const getItems = onGetContextMenuItemsRef.current
      const setMenu = setContextMenuRef.current
      if (!pos || !getItems || !setMenu) return false
      const elementId = getElementIdAtClientPoint(clientX, clientY)
      const items = getItems(pos.canvas, elementId)
      debugTouchLog('openContextMenuAtClientPoint', {
        clientX,
        clientY,
        canvas: pos.canvas,
        elementId,
        itemCount: items.length,
      })
      if (items.length === 0) return false
      setMenu({
        position: { x: clientX, y: clientY },
        items,
      })
      ignoreNextBackdropClickRef.current = true
      return true
    },
    [clientToStageAndCanvas, getElementIdAtClientPoint]
  )

  const startLongPressDragSelection = useCallback(
    (screenPos: Point): boolean => {
      if (!onFindElementsInRectangle) return false
      const coord = clientToStageAndCanvas(screenPos.x, screenPos.y)
      if (!coord) return false
      const r = {
        startX: coord.stage.x,
        startY: coord.stage.y,
        endX: coord.stage.x,
        endY: coord.stage.y,
      }
      longPress.current.action = 'drag-select'
      selectionRectLiveRef.current = r
      rectSelectActiveRef.current = true
      clearPreviewSelection()
      suppressNextCanvasElementTap(window)
      debugTouchLog('longPress ready -> start drag-rect', {
        stage: coord.stage,
        startedOnElement: longPress.current.elementId != null,
      })
      return true
    },
    [clearPreviewSelection, clientToStageAndCanvas, onFindElementsInRectangle, window]
  )

  const activateLongPressReady = useCallback(
    (clientX?: number, clientY?: number): boolean => {
      if (!longPress.current.origin || longPress.current.startedAt <= 0) return false
      if (longPress.current.phase === 'ready') return true
      if (longPress.current.action === 'duplicate-drag') return true

      const elapsedMs = performance.now() - longPress.current.startedAt
      if (elapsedMs < LONG_PRESS_READY_MS) return false
      if (!isLongPressFingerAtOrigin(clientX, clientY, true)) {
        debugTouchLog('longPress elapsed-ready cancelling: finger moved', {
          elapsedMs: Math.round(elapsedMs),
          origin: longPress.current.origin,
          last: lastSingleTouchRef.current,
        })
        cancelLongPress()
        return false
      }

      if (longPress.current.delayTimer) {
        clearTimeout(longPress.current.delayTimer)
        longPress.current.delayTimer = null
      }
      if (longPress.current.readyTimer) {
        clearTimeout(longPress.current.readyTimer)
        longPress.current.readyTimer = null
      }

      const readyAt = {
        x: clientX ?? lastSingleTouchRef.current?.x ?? longPress.current.origin.x,
        y: clientY ?? lastSingleTouchRef.current?.y ?? longPress.current.origin.y,
      }
      longPress.current.phase = 'ready'
      longPress.current.screenPos = readyAt
      dismissLongPressIndicator(readyAt)

      const stage = stageRef.current
      const rect = containerRef.current?.getBoundingClientRect()
      if (stage && rect) {
        const node = stage.getIntersection({
          x: longPress.current.origin.x - rect.left,
          y: longPress.current.origin.y - rect.top,
        })
        if (node) {
          const id = resolveKonvaElementId(node, stage)
          longPress.current.elementId = id
          const resolveTypeFromNode = (n: Konva.Node): Selection['type'] | null => {
            const name = n.name()
            if (!name) return null
            if (name.startsWith('endpoint-')) return 'endpoint'
            if (name.startsWith('protection-')) return 'protection'
            if (name.startsWith('panel-')) return 'panel'
            if (name.startsWith('supplyPanel-')) return 'supplyPanel'
            if (name.startsWith('trunkDevice-') || name.startsWith('panelModule-'))
              return 'trunkDevice'
            if (name === 'ground-ground') return 'ground'
            return null
          }
          let t = resolveTypeFromNode(node)
          let parent = node.getParent()
          let depth = 0
          while (!t && parent && parent !== stage && depth < 10) {
            t = resolveTypeFromNode(parent)
            parent = parent.getParent()
            depth++
          }
          if (longPressTargetIsSelectionBackground(t, longPressDragSelectFromContentRef.current)) {
            longPress.current.elementId = null
            longPress.current.elementType = null
          } else {
            longPress.current.elementType = t
          }
        } else {
          longPress.current.elementId = null
          longPress.current.elementType = null
        }
      }

      debugTouchLog('longPress elapsed -> ready', {
        screenPos: readyAt,
        elementId: longPress.current.elementId,
        elementType: longPress.current.elementType,
        elapsedMs: Math.round(elapsedMs),
      })

      const duplicateDrag = longPressDuplicateDragRef.current
      const lpElementId = longPress.current.elementId
      const lpElementType = longPress.current.elementType
      if (
        duplicateDrag &&
        lpElementId &&
        lpElementType &&
        duplicateDrag.elementTypes.includes(lpElementType)
      ) {
        longPress.current.action = 'duplicate-drag'
        stopLongPressTouchWatch()
        duplicateDrag.onStart({
          elementId: lpElementId,
          elementType: lpElementType,
          clientX: readyAt.x,
          clientY: readyAt.y,
        })
        suppressNextCanvasElementTap(window)
        debugTouchLog('longPress elapsed-ready -> duplicate-drag', {
          elementId: lpElementId,
          elementType: lpElementType,
        })
        return true
      }

      if (
        longPressDragSelectFromContentRef.current ||
        !longPress.current.elementId
      ) {
        startLongPressDragSelection(readyAt)
      }
      return true
    },
    [
      cancelLongPress,
      dismissLongPressIndicator,
      isLongPressFingerAtOrigin,
      startLongPressDragSelection,
      stopLongPressTouchWatch,
      window,
    ]
  )
  const scheduleViewChange = useCallback(
    (next: { pan?: Point; zoom?: number }) => {
      if (next.pan) {
        panRef.current = next.pan
        pendingViewRef.current.pan = next.pan
      }
      if (typeof next.zoom === 'number') {
        zoomRef.current = next.zoom
        pendingViewRef.current.zoom = next.zoom
      }
      if (viewRafRef.current != null) return
      viewRafRef.current = window.requestAnimationFrame(() => {
        viewRafRef.current = null
        const pending = pendingViewRef.current
        pendingViewRef.current = { pan: null, zoom: null }
        const patch: { pan?: Point; zoom?: number } = {}
        if (typeof pending.zoom === 'number') patch.zoom = pending.zoom
        if (pending.pan) patch.pan = pending.pan
        emitViewTransformPatch(patch)
      })
    },
    [emitViewTransformPatch, window]
  )
  const scheduleCameraSync = useCallback(() => {
    const layer = contentLayerRef.current
    if (!layer) return

    if (cameraSyncTimeoutRef.current != null) {
      clearTimeout(cameraSyncTimeoutRef.current)
      cameraSyncTimeoutRef.current = null
    }

    cameraSyncTimeoutRef.current = setTimeout(() => {
      cameraSyncTimeoutRef.current = null
      const currentLayer = contentLayerRef.current
      if (!currentLayer) return

      const cssCamera = cssCameraTransformRef.current
      const nextPan: Point = cssCamera.active
        ? cssCamera.livePan
        : {
            x: currentLayer.x(),
            y: currentLayer.y(),
          }
      const nextZoom = cssCamera.active ? cssCamera.liveZoom : currentLayer.scaleX()

      const prev = lastSyncedViewRef.current
      const zoomClamped = Math.max(minZoomRef.current, Math.min(ZOOM_MAX, fin(nextZoom, safeZoom)))

      const movedEnough =
        !prev.pan ||
        Math.hypot(nextPan.x - prev.pan.x, nextPan.y - prev.pan.y) >= CAMERA_MOVE_THRESHOLD_PX
      const zoomChangedEnough =
        prev.zoom == null || Math.abs(zoomClamped - prev.zoom) >= CAMERA_ZOOM_THRESHOLD

      if (!movedEnough && !zoomChangedEnough) {
        return
      }

      lastSyncedViewRef.current = { pan: nextPan, zoom: zoomClamped }

      scheduleViewChange({
        pan: nextPan,
        zoom: zoomClamped,
      })
    }, CAMERA_SYNC_TRAIL_MS)
  }, [scheduleViewChange, safeZoom, fin])

  /** Push Konva layer transform into the view store (used at gesture end; optional force skips thresholds). */
  const pushLiveCameraToStore = useCallback(
    (force: boolean) => {
      const currentLayer = contentLayerRef.current
      if (!currentLayer) return

      const nextPan: Point = {
        x: currentLayer.x(),
        y: currentLayer.y(),
      }
      const nextZoom = currentLayer.scaleX()
      const zoomClamped = Math.max(minZoomRef.current, Math.min(ZOOM_MAX, fin(nextZoom, safeZoom)))
      const prev = lastSyncedViewRef.current

      const movedEnough =
        force ||
        !prev.pan ||
        Math.hypot(nextPan.x - prev.pan.x, nextPan.y - prev.pan.y) >= CAMERA_MOVE_THRESHOLD_PX
      const zoomChangedEnough =
        force || prev.zoom == null || Math.abs(zoomClamped - prev.zoom) >= CAMERA_ZOOM_THRESHOLD

      if (!movedEnough && !zoomChangedEnough) {
        return
      }

      lastSyncedViewRef.current = { pan: nextPan, zoom: zoomClamped }
      scheduleViewChange({
        pan: nextPan,
        zoom: zoomClamped,
      })
    },
    [scheduleViewChange, safeZoom, fin]
  )

  const schedulePostPaintCameraCommit = useCallback(() => {
    if (postPaintCameraCommitRafRef.current != null) {
      window.cancelAnimationFrame(postPaintCameraCommitRafRef.current)
      postPaintCameraCommitRafRef.current = null
    }
    if (postPaintCameraCommitTimeoutRef.current != null) {
      clearTimeout(postPaintCameraCommitTimeoutRef.current)
      postPaintCameraCommitTimeoutRef.current = null
    }

    postPaintCameraCommitRafRef.current = window.requestAnimationFrame(() => {
      postPaintCameraCommitRafRef.current = null
      postPaintCameraCommitTimeoutRef.current = setTimeout(() => {
        postPaintCameraCommitTimeoutRef.current = null
        if (isPanningRef.current || pendingMouseButtonPanRef.current) return
        pushLiveCameraToStore(true)
      }, 0)
    })
  }, [pushLiveCameraToStore, window])

  const flushWheelPanFrame = useCallback(() => {
    wheelRafRef.current = null
    const lyr = contentLayerRef.current
    if (!lyr) return
    const { dx, dy } = wheelPanAccumRef.current
    wheelPanAccumRef.current = { dx: 0, dy: 0 }
    if (dx === 0 && dy === 0) return
    lyr.x(fin(lyr.x() + dx, safePan.x))
    lyr.y(fin(lyr.y() + dy, safePan.y))
    syncAndDrawTransformedLayers()
    panRef.current = { x: lyr.x(), y: lyr.y() }
    // Do not call scheduleViewChange every frame — that re-renders the full canvas React tree
    // (e.g. PlanCanvas) on each wheel pan tick. Match wheel zoom: debounced scheduleCameraSync
    // plus pushLiveCameraToStore(true) when the gesture ends.
    scheduleCameraSync()
  }, [fin, safePan, scheduleCameraSync, syncAndDrawTransformedLayers])

  const scheduleWheelPanCoalesced = useCallback(() => {
    if (wheelRafRef.current != null) return
    wheelRafRef.current = window.requestAnimationFrame(flushWheelPanFrame)
  }, [flushWheelPanFrame, window])

  const flushWheelZoomFrame = useCallback(() => {
    wheelZoomRafRef.current = null
    const stage = stageRef.current
    const layer = contentLayerRef.current
    if (!stage || !layer) return
    const mult = wheelZoomAccumFactorRef.current
    wheelZoomAccumFactorRef.current = 1
    if (!Number.isFinite(mult) || Math.abs(mult - 1) < 1e-9) return
    const pointer = wheelZoomPointerRef.current ?? stage.getPointerPosition()
    wheelZoomPointerRef.current = null
    if (!pointer) return
    wheelZoomGestureActiveRef.current = true
    const oldScale = layer.scaleX() || safeZoom
    const newScale = Math.max(minZoomRef.current, Math.min(ZOOM_MAX, fin(oldScale * mult, safeZoom)))
    const currentPan: Point = {
      x: layer.x(),
      y: layer.y(),
    }
    const mousePointTo = {
      x: (pointer.x - currentPan.x) / oldScale,
      y: (pointer.y - currentPan.y) / oldScale,
    }
    const newPan = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    }
    const clampedPan = { x: fin(newPan.x, safePan.x), y: fin(newPan.y, safePan.y) }
    layer.x(clampedPan.x)
    layer.y(clampedPan.y)
    layer.scale({ x: newScale, y: newScale })
    syncAndDrawTransformedLayers()
    panRef.current = clampedPan
    zoomRef.current = newScale
    // Avoid setState/setEendraadView every frame: that re-renders the whole schematic React tree (~100s of nodes).
    // Match touch pinch zoom: trailing scheduleCameraSync publishes zoom/pan at most every CAMERA_SYNC_TRAIL_MS,
    // plus pushLiveCameraToStore(true) when the gesture-reset timer fires.
    scheduleCameraSync()
  }, [fin, safePan, safeZoom, scheduleCameraSync, syncAndDrawTransformedLayers])

  const scheduleWheelZoomCoalesced = useCallback(() => {
    if (wheelZoomRafRef.current != null) return
    wheelZoomRafRef.current = window.requestAnimationFrame(flushWheelZoomFrame)
  }, [flushWheelZoomFrame, window])

  const scheduleWheelGestureReset = useCallback(() => {
    if (wheelGestureResetTimerRef.current != null) {
      clearTimeout(wheelGestureResetTimerRef.current)
    }
    wheelGestureResetTimerRef.current = setTimeout(() => {
      wheelGestureResetTimerRef.current = null
      pushLiveCameraToStore(true)
    }, WHEEL_GESTURE_RESET_MS)
  }, [pushLiveCameraToStore])

  const scheduleMousePanDraw = useCallback(() => {
    if (mousePanDrawRafRef.current != null) return
    mousePanDrawRafRef.current = window.requestAnimationFrame(() => {
      mousePanDrawRafRef.current = null
      syncAndDrawTransformedLayers()
    })
  }, [syncAndDrawTransformedLayers, window])

  useEffect(() => {
    return () => {
      if (viewRafRef.current != null) window.cancelAnimationFrame(viewRafRef.current)
      viewRafRef.current = null
      pendingViewRef.current = { pan: null, zoom: null }
      if (cameraSyncTimeoutRef.current != null) {
        clearTimeout(cameraSyncTimeoutRef.current)
        cameraSyncTimeoutRef.current = null
      }
      if (postPaintCameraCommitRafRef.current != null) {
        window.cancelAnimationFrame(postPaintCameraCommitRafRef.current)
        postPaintCameraCommitRafRef.current = null
      }
      if (postPaintCameraCommitTimeoutRef.current != null) {
        clearTimeout(postPaintCameraCommitTimeoutRef.current)
        postPaintCameraCommitTimeoutRef.current = null
      }
      if (wheelGestureResetTimerRef.current != null) {
        clearTimeout(wheelGestureResetTimerRef.current)
        wheelGestureResetTimerRef.current = null
      }
      mousePanWindowCleanupRef.current?.()
      mousePanWindowCleanupRef.current = null
      touchPanWindowCleanupRef.current?.()
      touchPanWindowCleanupRef.current = null
      if (wheelRafRef.current != null) {
        window.cancelAnimationFrame(wheelRafRef.current)
        wheelRafRef.current = null
      }
      if (wheelZoomRafRef.current != null) {
        window.cancelAnimationFrame(wheelZoomRafRef.current)
        wheelZoomRafRef.current = null
      }
      if (mousePanDrawRafRef.current != null) {
        window.cancelAnimationFrame(mousePanDrawRafRef.current)
        mousePanDrawRafRef.current = null
      }
      if (panUiRafRef.current != null) {
        window.cancelAnimationFrame(panUiRafRef.current)
        panUiRafRef.current = null
      }
    }
  }, [window])
  // Clear live gesture zoom once the view store matches the Konva layer (wheel or pinch).
  useEffect(() => {
    const layer = contentLayerRef.current
    if (!layer) return
    const lz = layer.scaleX()
    const lx = layer.x()
    const ly = layer.y()
    if (
      Math.abs(lz - safeZoom) < 1e-4 &&
      Math.abs(lx - safePan.x) < 0.5 &&
      Math.abs(ly - safePan.y) < 0.5
    ) {
      wheelZoomGestureActiveRef.current = false
      viewportUI.getState().setCanvasGestureZoom(gestureZoomCanvas, null)
    }
  }, [safeZoom, safePan.x, safePan.y, gestureZoomCanvas, viewportUI])

  // Snap Konva layer to store-driven pan/zoom when not in a live gesture (avoids fighting wheel zoom / pan).
  useEffect(() => {
    if (
      isPanningRef.current ||
      pendingMouseButtonPanRef.current ||
      touchSingleFingerPanActiveRef.current ||
      cssCameraTransformRef.current.active ||
      wheelZoomGestureActiveRef.current
    ) {
      return
    }
    const layer = contentLayerRef.current
    if (!layer) return
    layer.x(safePan.x)
    layer.y(safePan.y)
    layer.scale({ x: safeZoom, y: safeZoom })
    syncAndDrawTransformedLayers()
  }, [safePan.x, safePan.y, safeZoom, syncAndDrawTransformedLayers])

  useBaseCanvasViewportSize({
    containerRef,
    deferredViewportSizeRef,
    emitViewTransformPatch,
    onViewportPixelSizeChange,
    panRef,
    prevSizeRef,
    scheduledViewportRafRef,
    scheduledViewportSizeRef,
    scheduledViewportTimeoutRef,
    setSize,
    viewportResizePreviewActive,
    window,
  })

  // Handle wheel zoom
  const handleWheel = useCallback(
    (e: KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault()

      const stage = e.target.getStage()
      if (!stage) return
      const layer = contentLayerRef.current
      if (!layer) return

      const evt = e.evt
      const now = performance.now()
      const msSincePreviousWheel = now - lastWheelEventAtRef.current
      lastWheelEventAtRef.current = now
      const wheelInput = {
        deltaMode: evt.deltaMode,
        deltaX: evt.deltaX,
        deltaY: evt.deltaY,
        ctrlKey: evt.ctrlKey,
        metaKey: evt.metaKey,
        shiftKey: evt.shiftKey,
        msSincePreviousWheel,
        pageHeightPx: stage.height(),
      }

      const hintStore = useWheelBehaviorHintStore.getState()
      const evidenceUpdate = updateWheelBehaviorEvidence(
        wheelBehaviorEvidenceRef.current,
        wheelBehavior,
        wheelInput,
        hintStore.dismissedInput
      )
      wheelBehaviorEvidenceRef.current = evidenceUpdate.state
      if (evidenceUpdate.clearDismissal) hintStore.clearDismissal()
      if (evidenceUpdate.suggestedBehavior) hintStore.show(evidenceUpdate.suggestedBehavior)

      const action = resolveWheelAction(wheelInput, wheelBehavior)
      if (action.kind === 'pan') {
        wheelPanAccumRef.current.dx += action.dx
        wheelPanAccumRef.current.dy += action.dy
        scheduleWheelPanCoalesced()
      } else if (action.kind === 'zoom') {
        // Coalesced to one draw per frame.
        const pointer = stage.getPointerPosition()
        if (!pointer) return
        wheelZoomPointerRef.current = pointer
        wheelZoomAccumFactorRef.current *= action.factor
        scheduleWheelZoomCoalesced()
      } else {
        return
      }
      scheduleWheelGestureReset()
    },
    [
      scheduleWheelGestureReset,
      scheduleWheelPanCoalesced,
      scheduleWheelZoomCoalesced,
      wheelBehavior,
    ]
  )

  const activateMouseButtonPan = useCallback(
    (clientX: number, clientY: number) => {
      isPanningRef.current = true
      lastPanPointRef.current = { x: clientX, y: clientY }
      rightClickDragOccurredRef.current = false
      setDragOccurred(false)

      if (panUiRafRef.current != null) {
        window.cancelAnimationFrame(panUiRafRef.current)
      }
      panUiRafRef.current = window.requestAnimationFrame(() => {
        panUiRafRef.current = null
        setIsPanningForUI(true)
        onViewportPanStateChangeRef.current?.(true)
      })
    },
    [window]
  )

  const beginDeferredMousePan = useCallback(
    (
      clientX: number,
      clientY: number,
      button: number,
      modifiers?: { shiftKey?: boolean; altKey?: boolean }
    ) => {
      if (mousePanWindowCleanupRef.current) {
        mousePanWindowCleanupRef.current()
        mousePanWindowCleanupRef.current = null
      }
      mousePanButtonRef.current = button
      // A fresh right press starts a new gesture; never inherit a flag from an earlier pan.
      if (button === 2) rightClickDragOccurredRef.current = false
      pendingMouseButtonPanRef.current = {
        startX: clientX,
        startY: clientY,
        button,
        shiftKey: modifiers?.shiftKey ?? false,
        altKey: modifiers?.altKey ?? false,
      }

      const handleWindowMouseMove = (evt: MouseEvent) => {
        const pending = pendingMouseButtonPanRef.current
        if (pending) {
          const dx = evt.clientX - pending.startX
          const dy = evt.clientY - pending.startY
          if (
            Math.abs(dx) <= DEFERRED_MOUSE_PAN_THRESHOLD_PX &&
            Math.abs(dy) <= DEFERRED_MOUSE_PAN_THRESHOLD_PX
          ) {
            return
          }
          pendingMouseButtonPanRef.current = null
          activateMouseButtonPan(pending.startX, pending.startY)
        }
        if (!isPanningRef.current) return

        const dx = evt.clientX - lastPanPointRef.current.x
        const dy = evt.clientY - lastPanPointRef.current.y

        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          if (mousePanButtonRef.current === 2) rightClickDragOccurredRef.current = true
          if (!dragOccurredRef.current) {
            setDragOccurred(true)
          }
          dragOccurredRef.current = true
        }

        const nextPan = {
          x: fin(panRef.current.x + dx, safePan.x),
          y: fin(panRef.current.y + dy, safePan.y),
        }
        panRef.current = nextPan
        if (contentLayerRef.current) {
          contentLayerRef.current.x(nextPan.x)
          contentLayerRef.current.y(nextPan.y)
          scheduleMousePanDraw()
        }

        lastPanPointRef.current = { x: evt.clientX, y: evt.clientY }
      }

      const handleWindowMouseUp = () => {
        if (isAppDialogOpen()) {
          pendingMouseButtonPanRef.current = null
          if (mousePanWindowCleanupRef.current) {
            mousePanWindowCleanupRef.current()
            mousePanWindowCleanupRef.current = null
          }
          return
        }
        const pending = pendingMouseButtonPanRef.current
        if (pending) {
          pendingMouseButtonPanRef.current = null
          if (
            pending.button === 0 &&
            leftDragPansCanvas &&
            !pending.shiftKey &&
            !pending.altKey
          ) {
            clearSelection()
          }
          if (mousePanWindowCleanupRef.current) {
            mousePanWindowCleanupRef.current()
            mousePanWindowCleanupRef.current = null
          }
          return
        }
        if (!isPanningRef.current) return
        handleMouseUpRef.current()
      }

      window.addEventListener('mousemove', handleWindowMouseMove, true)
      window.addEventListener('mouseup', handleWindowMouseUp, true)
      mousePanWindowCleanupRef.current = () => {
        window.removeEventListener('mousemove', handleWindowMouseMove, true)
        window.removeEventListener('mouseup', handleWindowMouseUp, true)
        pendingMouseButtonPanRef.current = null
      }
    },
    [
      activateMouseButtonPan,
      clearSelection,
      fin,
      leftDragPansCanvas,
      safePan,
      scheduleMousePanDraw,
      window,
    ]
  )

  const startMousePan = useCallback(
    (clientX: number, clientY: number) => {
      beginDeferredMousePan(clientX, clientY, 0)
      pendingMouseButtonPanRef.current = null
      activateMouseButtonPan(clientX, clientY)
      dragOccurredRef.current = true
    },
    [activateMouseButtonPan, beginDeferredMousePan]
  )

  const { handleMouseDown, handleMouseMove, handleMouseUp } = useBaseCanvasMouseSelection({
    
    beginDeferredMousePan,
    cameraGestureActiveRef,
    cameraSyncTimeoutRef,
    clearPreviewSelection,
    clearSelection,
    cursorShiftKeyRef,
    dragOccurred,
    dragOccurredRef,
    fin,
    handleMouseUpRef,
    hoveredCursorNodeRef,
    ignoreNextTapClearRef,
    isPanningRef,
    isSelecting,
    lastPanPointRef,
    leftDragPansCanvas,
    minZoomRef,
    mousePanWindowCleanupRef,
    onCanvasPrimaryClickRef,
    onCaptureRectangleRef,
    onFindElementsInRectangle,
    onViewportPanStateChangeRef,
    pan,
    panDisabledListeningRef,
    panUiRafRef,
    pendingMouseButtonPanRef,
    pointerFollower,
    prioritizeNavigation,
    pushLiveCameraToStore,
    rectSelectActiveRef,
    schedulePostPaintCameraCommit,
    scheduleSelectionDragFrame,
    selectionDragRafRef,
    selectionRect,
    selectionRectLiveRef,
    setDragOccurred,
    setIsPanningForUI,
    setIsSelecting,
    setPointerFollowerPosition,
    setSelection,
    setSelectionRect,
    shouldIgnoreSyntheticMouseEvent,
    stageRef,
    suppressNextContextMenuRef,
    updateCanvasCursor,
    viewportUI,
    window,
    zoom,
  })

  // Handle drag and drop
  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      if (Array.from(e.dataTransfer.types).includes(PROJECT_DOCUMENT_DRAG_TYPE)) {
        // Documents are dragged as a move; any other effect would refuse the drop.
        e.dataTransfer.dropEffect = onDocumentDrop ? 'move' : 'none'
        setIsDragOver(Boolean(onDocumentDrop))
        return
      }
      const isFileDrag = Array.from(e.dataTransfer.types).includes('Files')
      if (isFileDrag && !onFilesDrop) {
        e.dataTransfer.dropEffect = 'none'
        setIsDragOver(false)
        return
      }
      e.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)

      // Call onDragOver callback for preview visuals
      if (onDragOver) {
        const rect = containerRef.current?.getBoundingClientRect()
        if (rect) {
          const x = e.clientX - rect.left
          const y = e.clientY - rect.top
          const canvasX = (x - pan.x) / zoom
          const canvasY = (y - pan.y) / zoom

          // Try to get symbol data (may not be available during dragover)
          let symbolData: unknown | null = null
          try {
            // Note: getData may not work in dragover, but we try anyway
            const symbolDataStr =
              e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain')
            if (symbolDataStr) {
              symbolData = JSON.parse(symbolDataStr)
            }
          } catch {
            // Ignore errors - symbol data may not be available during dragover
          }
          if (!symbolData && libraryDragSymbol) {
            symbolData = libraryDragSymbol
          }

          onDragOver({ x: canvasX, y: canvasY }, symbolData)
        }
      }
    },
    [libraryDragSymbol, onDocumentDrop, onDragOver, onFilesDrop, zoom, pan]
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      // Only set drag over to false if we're leaving the container itself
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        setIsDragOver(false)
        // Clear preview when leaving
        if (onDragOver) {
          onDragOver({ x: -Infinity, y: -Infinity }, null)
        }
      }
    },
    [onDragOver]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)

      // Clear drag preview when drop happens
      if (onDragOver) {
        onDragOver({ x: -Infinity, y: -Infinity }, null)
      }

      const documentId = e.dataTransfer.getData(PROJECT_DOCUMENT_DRAG_TYPE)
      if (documentId) {
        const rect = containerRef.current?.getBoundingClientRect()
        if (rect && onDocumentDrop) {
          onDocumentDrop(
            { x: (e.clientX - rect.left - pan.x) / zoom, y: (e.clientY - rect.top - pan.y) / zoom },
            documentId
          )
        }
        return
      }

      const droppedFiles = Array.from(e.dataTransfer.files)
      if (droppedFiles.length > 0) {
        onFilesDrop?.(droppedFiles)
        return
      }

      if (!onDrop) {
        logger.warn('BaseCanvas: onDrop handler not provided')
        return
      }

      // Get the drop position relative to the container
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) {
        logger.warn('BaseCanvas: Could not get container bounds')
        return
      }

      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      // Convert screen coordinates to canvas coordinates
      // Account for zoom and pan
      const canvasX = (x - pan.x) / zoom
      const canvasY = (y - pan.y) / zoom

      // Try to get symbol data from the drag event
      // Note: getData only works in drop event, not in dragover
      // Try multiple MIME types as fallback
      let symbolDataStr = ''
      try {
        symbolDataStr = e.dataTransfer.getData('application/json')
        // Fallback to text/plain if application/json is empty
        if (!symbolDataStr) {
          symbolDataStr = e.dataTransfer.getData('text/plain')
        }
      } catch (err) {
        logger.warn('BaseCanvas: Could not get dataTransfer data:', err)
      }

      try {
        const symbolData = symbolDataStr ? JSON.parse(symbolDataStr) : libraryDragSymbol
        if (!symbolData || !symbolData.id) {
          logger.warn(
            'BaseCanvas: No valid symbol data found in drop event. Available types:',
            e.dataTransfer.types,
            'Fallback symbol:',
            libraryDragSymbol?.id ?? null
          )
          return
        }
        logger.info('BaseCanvas: Dropping symbol:', symbolData.id, 'at position:', {
          x: canvasX,
          y: canvasY,
        })
        onDrop({ x: canvasX, y: canvasY }, symbolData, {
          clientX: e.clientX,
          clientY: e.clientY,
        })
      } catch (error) {
        logger.error('BaseCanvas: Failed to parse drop data:', error, 'Raw data:', symbolDataStr)
      }
    },
    [libraryDragSymbol, onDocumentDrop, onDrop, onDragOver, onFilesDrop, zoom, pan]
  )

  const { handleFitToView } = useBaseCanvasFitToView({
    containerRef,
    emitViewTransformPatch,
    fin,
    gridInTransformedLayer,
    minZoomRef,
    onGetSelectionBounds,
    onPrepareFitToView,
    safePan,
    safeZoom,
    selectionFitMaxZoom,
    size,
    stageRef,
    viewportUI,
  })

  // Expose handleFitToView and startSelectionRect to parent via ref
  const startSelectionRectImpl = useCallback((pointer: { x: number; y: number }) => {
    const r = {
      startX: pointer.x,
      startY: pointer.y,
      endX: pointer.x,
      endY: pointer.y,
    }
    selectionRectLiveRef.current = r
    rectSelectActiveRef.current = true
    clearPreviewSelection()
  }, [clearPreviewSelection])
  useImperativeHandle(
    ref,
    () => ({
      fitToView: handleFitToView,
      getStage: () => stageRef.current,
      getLiveViewTransform,
      startSelectionRect: startSelectionRectImpl,
      beginDeferredMousePan: (clientX, clientY, modifiers) =>
        beginDeferredMousePan(clientX, clientY, 0, modifiers),
      startMousePan,
    }),
    [
      handleFitToView,
      getLiveViewTransform,
      startSelectionRectImpl,
      beginDeferredMousePan,
      startMousePan,
    ]
  )

  // Handle mouse up globally to catch mouse release outside canvas (rect-select). Mouse-button pan uses capture listeners on mousedown.
  useEffect(() => {
    const handleGlobalMouseUp = (_e: MouseEvent) => {
      if (isAppDialogOpen()) return
      if (rectSelectActiveRef.current || isSelecting) {
        handleMouseUp()
      }
    }

    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp)
  }, [isSelecting, handleMouseUp, window])

  const { handleTouchStart, handleTouchMove, handleTouchEnd } = useBaseCanvasTouchGestures({
    activateLongPressReady,
    applyCssCameraTransform,
    beginCssCameraTransform,
    cameraGestureActiveRef,
    cameraSyncTimeoutRef,
    cancelLongPress,
    cancelPendingTouchSelectionClear,
    clearPreviewSelection,
    containerRef,
    contentLayerRef,
    contextMenu,
    cssCameraTransformRef,
    dismissLongPressIndicator,
    dragOccurred,
    dragOccurredRef,
    enableLongPressContextMenu,
    enableLongPressContextMenuRef,
    enableSingleFingerPan,
    fin,
    finishCssCameraTransform,
    getElementIdAtClientPoint,
    handleMouseUp,
    handleTouchEndRef,
    handleTouchMoveRef,
    ignoreNextTapClearRef,
    isLongPressFingerAtOrigin,
    isSelecting,
    lastProcessedTouchEndRef,
    lastSingleTouchRef,
    lastTapRef,
    longPressRef: longPress,
    longPressDragSelectFromContentRef,
    longPressDuplicateDragRef,
    maybeCancelLongPressForMovement,
    minZoomRef,
    multiFingerSwipeRef,
    onFindElementsInRectangle,
    onMultiFingerSwipe,
    openContextMenuAtClientPoint,
    pan,
    panRef,
    prioritizeNavigation,
    pushLiveCameraToStore,
    rectSelectActiveRef,
    resetCanvasTouchGestureForContextMenu,
    safePan,
    safeZoom,
    scheduleCameraSync,
    scheduleMousePanDraw,
    schedulePendingTouchSelectionClear,
    scheduleSelectionDragFrame,
    selectionDragRafRef,
    selectionRect,
    selectionRectLiveRef,
    setCameraGestureHitTestingDisabled,
    setContextMenu,
    setDragOccurred,
    setIsSelecting,
    setLongPressIndicator,
    setSelection,
    setSelectionRect,
    setTouchFingerPanForUI,
    setTouchHasMoved,
    setTouchPanInitialCanvasPan,
    setTouchPanStart,
    setTouchStartCenter,
    setTouchStartDistance,
    setTouchStartPan,
    setTouchStartZoom,
    shouldLongPressBlockSingleFingerPan,
    stageRef,
    startLongPressDragSelection,
    startLongPressTouchWatch,
    stopLongPressTouchWatch,
    suppressSyntheticMouseAfterTouch,
    suppressTouchContextMenuUntilRef,
    touchHasMoved,
    touchPanInitialCanvasPan,
    touchPanInitialCanvasPanRef,
    touchPanStart,
    touchPanStartRef,
    touchPanWindowCleanupRef,
    touchSingleFingerPanActiveRef,
    touchStartCenter,
    touchStartDistance,
    touchStartElementIdRef,
    touchStartPan,
    touchStartZoom,
    touchStartedOnContentRef,
    touchStartedOnDraggableRef,
    viewportUI,
    zoom,
    zoomRef,
  })

  const { armedLibraryCanvasId, armedCanvasInstanceId } = useBaseCanvasLibraryPlacement({
    armedLibrarySymbol,
    armedPlacementActive,
    beginDeferredMousePan,
    containerRef,
    getLiveViewTransform,
    onDragOver,
    onDrop,
    stageRef,
    suppressNextContextMenuRef,
    updateCanvasCursorRef,
    viewportUI,
    window,
  })

  // Cleanup long-press timers on unmount
  useEffect(() => {
    const lp = longPress.current
    const stage = stageRef.current
    return () => {
      stopLongPressTouchWatch()
      finishCssCameraTransform(false)
      if (longPressIndicatorFadeTimerRef.current) {
        clearTimeout(longPressIndicatorFadeTimerRef.current)
        longPressIndicatorFadeTimerRef.current = null
      }
      if (lp.delayTimer) clearTimeout(lp.delayTimer)
      if (lp.readyTimer) clearTimeout(lp.readyTimer)
      if (pendingTouchSelectionClearRef.current) {
        clearTimeout(pendingTouchSelectionClearRef.current)
        pendingTouchSelectionClearRef.current = null
      }
      if (cameraGestureDisabledListeningRef.current && stage) {
        stage.listening(true)
      }
      if (selectionDragRafRef.current != null) {
        window.cancelAnimationFrame(selectionDragRafRef.current)
        selectionDragRafRef.current = null
      }
    }
  }, [stopLongPressTouchWatch, finishCssCameraTransform, window])

  const { gridElements } = useBaseCanvasGrid({
    actualBackgroundColor,
    gridColor,
    gridInTransformedLayer,
    gridOpacity,
    gridSize,
    safePan,
    safeZoom,
    showGrid,
    size,
  })

  // Tap on empty space should clear selection (for touch - mouse uses handleMouseUp)
  const handleStageTap = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (isAppDialogOpen()) return
      const nativeEvt = e.evt as PointerEvent & Partial<MouseEvent> & TouchEvent
      const isTouchLike =
        nativeEvt.pointerType === 'touch' ||
        nativeEvt.type.startsWith('touch') ||
        typeof nativeEvt.changedTouches !== 'undefined'
      if (!isTouchLike && nativeEvt.button != null && nativeEvt.button !== 0) return
      if (e.target === e.target.getStage()) {
        if (ignoreNextTapClearRef.current) {
          ignoreNextTapClearRef.current = false
          return
        }
        if (isTouchLike) {
          return
        }
        clearSelection()
      }
    },
    [clearSelection]
  )

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{
        backgroundColor: actualBackgroundColor,
        cursor: idleCanvasCursor,
        outline: isDragOver ? '2px dashed #0284c7' : 'none',
        outlineOffset: '-2px',
        touchAction: 'none', // Disable browser touch gestures
        WebkitUserSelect: 'none', // Disable text selection on iOS
        userSelect: 'none',
        pointerEvents: appDialogOpen ? 'none' : undefined,
        WebkitTouchCallout: 'none',
      }}
      onPointerEnter={() => {
        canvasHoverRef.current = true
        blurFocusStealingActiveElement()
      }}
      onPointerDown={(event) => {
        blurActiveElementForCanvasPointerDown(event.target)
      }}
      onPointerMove={(event) => {
        if (pointerFollower) {
          setPointerFollowerPosition({ x: event.clientX, y: event.clientY })
        }
      }}
      onPointerLeave={() => {
        canvasHoverRef.current = false
        hoveredCursorNodeRef.current = null
        setPointerFollowerPosition(null)
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEndCapture={(ev) => {
        const target = ev.target
        const isInsideContextMenu =
          target instanceof Element && target.closest('[data-canvas-context-menu="true"]')
        if (shouldIgnoreCanvasTouchForContextMenu(!!contextMenu, !!isInsideContextMenu)) {
          resetCanvasTouchGestureForContextMenu()
          return
        }
        handleTouchEnd(ev)
      }}
      onTouchCancel={(ev) => {
        cancelLongPress()
        cancelPendingTouchSelectionClear()
        handleTouchEnd(ev)
      }}
    >
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseOver={(event) => {
          hoveredCursorNodeRef.current = event.target
          cursorShiftKeyRef.current = event.evt.shiftKey
          updateCanvasCursor()
        }}
        onMouseUp={handleMouseUp}
        onTap={(e) => handleStageTap(e as unknown as KonvaEventObject<PointerEvent>)}
        onContextMenu={(e) => {
          e.evt.preventDefault()
          if (
            enableLongPressContextMenuRef.current &&
            Date.now() < suppressTouchContextMenuUntilRef.current
          ) {
            suppressTouchContextMenuUntilRef.current = Date.now() + 500
            return
          }
          if (suppressNextContextMenuRef.current) {
            suppressNextContextMenuRef.current = false
            return
          }
          debugTouchLog('Stage onContextMenu', {
            clientX: e.evt.clientX,
            clientY: e.evt.clientY,
            button: (e.evt as MouseEvent).button,
          })

          // Don't show context menu if right-click drag occurred (panning)
          if (rightClickDragOccurredRef.current) {
            rightClickDragOccurredRef.current = false
            return
          }

          if (!onGetContextMenuItems) return

          const stage = e.target.getStage()
          if (!stage) return

          const viewportX = e.evt.clientX
          const viewportY = e.evt.clientY

          const pointer = stage.getPointerPosition()
          if (!pointer) return

          const canvasX = (pointer.x - pan.x) / zoom
          const canvasY = (pointer.y - pan.y) / zoom

          const elementId = resolveKonvaElementId(e.target, stage)
          const { selection } = viewportUI.getState()

          // Right-click must not change selection; pass hit id when present, else multi-select menu.
          const isMultiSelection =
            (selection.type === 'endpoint' && selection.ids.length > 1) ||
            (selection.type === 'protection' && selection.ids.length > 1) ||
            (selection.type === 'panel' && selection.ids.length > 1) ||
            (selection.type === 'trunkDevice' && selection.ids.length > 1) ||
            (selection.type === 'placement' && selection.ids.length > 1)

          const finalElementId = isMultiSelection && !elementId ? null : elementId

          const items = onGetContextMenuItems({ x: canvasX, y: canvasY }, finalElementId)
          if (items.length > 0) {
            setContextMenu({
              position: { x: viewportX, y: viewportY },
              items,
            })
          }
        }}
      >
        {/* Background layer - only for static grid (Eendraad) */}
        {!gridInTransformedLayer && <Layer>{gridElements}</Layer>}

        {/* Main content layer */}
        <Layer
          ref={contentLayerRef}
          x={safePan.x}
          y={safePan.y}
          scaleX={safeZoom}
          scaleY={safeZoom}
          // Touch pan can otherwise hit-test under the finger on every move.
          // Mouse-button pan uses window capture listeners, so avoid toggling
          // the dense content hit graph at gesture start. Konva 10's deprecated
          // hitGraphEnabled only wrote listening, so both conditions live here.
          listening={!touchFingerPanForUI && !disableContentHitGraph}
        >
          {/* Grid in transformed layer (Plan canvas) */}
          {gridInTransformedLayer && gridElements}
          <SelectionPreviewProvider value={previewSelectionStoreRef.current}>
            {children}
          </SelectionPreviewProvider>
        </Layer>

        {/* Draggable symbols can temporarily move here so Konva redraws only
            this tiny layer instead of repainting the complete project scene. */}
        {enableIsolatedDragLayer && (
          <Layer
            name="canvas-drag-layer"
            x={safePan.x}
            y={safePan.y}
            scaleX={safeZoom}
            scaleY={safeZoom}
            listening={false}
          />
        )}

        {/* Optional transformed interaction overlay. Kept separate so heavy content
            can have hit graph disabled while tool overlay remains interactive. */}
        {overlayChildren && (
          <Layer
            ref={overlayLayerRef}
            x={safePan.x}
            y={safePan.y}
            scaleX={safeZoom}
            scaleY={safeZoom}
            listening={!touchFingerPanForUI}
          >
            {overlayChildren}
          </Layer>
        )}

        {/* UI layer: selection rect (listening=false); multi-select frame on top, listens when draggable */}
        <Layer listening={false}>
          {/* Selection rectangle (drag-select) */}
          {selectionRect && (
            <Rect
              x={Math.min(selectionRect.startX, selectionRect.endX)}
              y={Math.min(selectionRect.startY, selectionRect.endY)}
              width={Math.abs(selectionRect.endX - selectionRect.startX)}
              height={Math.abs(selectionRect.endY - selectionRect.startY)}
              fill={isDark ? 'rgba(59, 130, 246, 0.1)' : 'rgba(59, 130, 246, 0.1)'}
              stroke={colors.hoverColor}
              strokeWidth={1}
              dash={[5, 5]}
              listening={false}
            />
          )}
        </Layer>
      </Stage>

      {/* Long-press context menu indicator (touch devices) */}
      {longPressIndicator && (
        <>
          <style>{`
            @keyframes lp-appear { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }
            @keyframes lp-fill { from { stroke-dashoffset: ${LP_RING_CIRCUMFERENCE}; } to { stroke-dashoffset: 0; } }
            @keyframes lp-fade-out { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.88); } }
          `}</style>
          <div
            style={{
              position: 'fixed',
              left: longPressIndicator.position.x - 40,
              top: longPressIndicator.position.y - 40,
              width: 80,
              height: 80,
              pointerEvents: 'none',
              zIndex: 35,
              animation:
                longPressIndicator.phase === 'dismissing'
                  ? `lp-fade-out ${LONG_PRESS_RING_FADE_MS}ms ease-out forwards`
                  : `lp-appear 150ms ease-out ${LONG_PRESS_DELAY_MS}ms both`,
            }}
          >
            <svg width="80" height="80" viewBox="0 0 80 80">
              <circle
                cx="40"
                cy="40"
                r="34"
                stroke={isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'}
                strokeWidth="6"
                fill="none"
              />
              <circle
                cx="40"
                cy="40"
                r="34"
                stroke="#0284c7"
                strokeWidth="6"
                fill="none"
                strokeDasharray={LP_RING_CIRCUMFERENCE}
                strokeLinecap="round"
                transform="rotate(90, 40, 40)"
                style={{
                  animation: `lp-fill ${LONG_PRESS_FILL_MS}ms linear ${LONG_PRESS_DELAY_MS}ms both`,
                }}
              />
            </svg>
          </div>
        </>
      )}

      {/* Context menu (rendered outside Konva, positioned relative to viewport) */}
      {contextMenu && (
        <>
          {/* Backdrop to close menu */}
          <div role="presentation"
            className="fixed inset-0 z-40"
            onClick={(e) => {
              debugTouchLog('backdrop click', {
                type: e.type,
                ignoreNext: ignoreNextBackdropClickRef.current,
              })
              if (ignoreNextBackdropClickRef.current) {
                ignoreNextBackdropClickRef.current = false
                return
              }
              setContextMenu(null)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              setContextMenu(null)
            }}
          />
          {/* Context menu */}
          <ContextMenuPortal
            position={contextMenu.position}
            items={contextMenu.items}
            onClose={() => {
              resetCanvasTouchGestureForContextMenu()
              setContextMenu(null)
            }}
          />
        </>
      )}
      {pointerFollower && pointerFollowerPosition ? (
        <div
          className="pointer-events-none fixed z-[160]"
          style={{
            left: pointerFollowerPosition.x + 10,
            top: pointerFollowerPosition.y + 10,
          }}
        >
          {pointerFollower}
        </div>
      ) : null}
      {armedPlacementActive && armedLibrarySymbol && armedLibraryCanvasId === armedCanvasInstanceId ? (
        <ArmedSymbolCanvasBanner symbol={armedLibrarySymbol} />
      ) : null}
    </div>
  )
})

BaseCanvas.displayName = 'BaseCanvas'

export default BaseCanvas
