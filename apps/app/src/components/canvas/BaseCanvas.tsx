import { logger } from '@/lib/logger'
import ArmedSymbolCanvasBanner from '@/components/library/ArmedSymbolCanvasBanner'
import {
  useRef,
  useId,
  useEffect,
  useState,
  useCallback,
  useImperativeHandle,
  useMemo,
  forwardRef,
} from 'react'
import type { ForwardedRef } from 'react'
import { Stage, Layer, Line, Rect } from 'react-konva'
import Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { CanvasDropMeta, CanvasSize, Point, Selection } from '@/types/ui'
import { ZOOM_MIN, ZOOM_MAX, ZOOM_100 } from '@/constants/canvasConstants'
import { useSettingsStore } from '@/stores/settingsStore'
import { useThemeColors } from '@/lib/theme/hooks'
import { useUIStore } from '@/stores/uiStore'

import type { CanvasType } from '@/types/ui'
import { selectMultiple } from '@/utils/selection'
import { useCommitClearSelection, useCommitSelection } from '@/editions/community/communityHooks'
import { dismissCanvasOverlays } from '@/lib/ui/canvasOverlayDismiss'
import {
  blurActiveElementForCanvasPointerDown,
  blurFocusStealingActiveElement,
} from '@/lib/ui/blurFocusStealingActiveElement'
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
import { resolveKonvaElementId } from './baseCanvasElementId'
import { clamp } from '@/lib/geometry'
import { mirrorLayerCameraTransform } from '@/lib/canvas/layerCameraTransform'
import { hasCanvasPrimaryAction, resolveCanvasCursor } from '@/lib/canvas/canvasCursor'
import {
  isPotentialSecondTap,
  longPressTargetIsSelectionBackground,
  shouldActivateSingleFingerPan,
  shouldIgnoreCanvasTouchForContextMenu,
  shouldScheduleTouchLongPress,
} from '@/lib/canvas/touchGestureIntent'
import {
  TRACKPAD_EVIDENCE_EVENTS,
  WHEEL_GESTURE_RESET_MS,
  isDiagonalPixelScroll,
  resolveWheelAction,
} from './wheelGesture'
import { useWheelBehaviorHintStore } from '@/stores/wheelBehaviorHintStore'

type KonvaSceneContextWithNativeCanvas = {
  _context?: CanvasRenderingContext2D
}

type KonvaImagePrototypeWithSceneFunc = typeof Konva.Image.prototype & {
  _sceneFunc?: (this: Konva.Image, ctx: KonvaSceneContextWithNativeCanvas) => void
  __hqPatched?: boolean
}

type WindowWithEendraTapSuppression = Window & {
  __eendraSuppressNextElementTap?: boolean
}

type KonvaNodeCollectionLike = Konva.Node[] | {
  each: (callback: (node: Konva.Node) => void) => void
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

const LONG_PRESS_DELAY_MS = 450
const LONG_PRESS_FILL_MS = 300
const LONG_PRESS_READY_MS = LONG_PRESS_DELAY_MS + LONG_PRESS_FILL_MS
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
const DEFERRED_MOUSE_PAN_THRESHOLD_PX = 6
/** Hide grid entirely when zoomed out past this (reduces Line count + overdraw). */
const GRID_HIDE_ZOOM_BELOW = 0.06
/** When a grid cell is smaller than this in screen px, skip drawing (too dense). */
const GRID_MIN_CELL_SCREEN_PX = 12
const DOUBLE_TAP_MS = 350
const DOUBLE_TAP_SLOP_PX = 32
const debugTouchLog =
  process.env.NODE_ENV !== 'production'
    ? (...args: unknown[]) => {
        if (typeof window === 'undefined') return
        if (window.localStorage.getItem('eendraTouchDebug') !== '1') return
        logger.debug('[BaseCanvas touch]', ...args)
      }
    : (..._args: unknown[]) => {}

/** Stable signature for rect-select preview lists — skip context updates when the set of hits is unchanged. */
function previewSelectionSignature(elements: Array<{ id: string; type: string }>): string {
  if (elements.length === 0) return ''
  return [...elements]
    .sort((a, b) => (a.type + '\0' + a.id).localeCompare(b.type + '\0' + b.id))
    .map((e) => `${e.type}:${e.id}`)
    .join('|')
}

/** True if this node (or a parent) is a selected symbol — don't steal single-finger touch for canvas pan.
 * - endpoint-*: selected when endpoint or placement in selection
 * - panel-*: selected when panel in selection (panel_distribution wrapper)
 * - placement-*: selected plan placement on touch
 * - protection-/trunkDevice-/note-/frame-/ground-/supply-*: selected one-wire draggable items
 * - panelModule-* (eendraad): always draggable on touch
 */
function isNodeDraggableForTouch(
  node: Konva.Node,
  stage: Konva.Stage,
  selection: { type: Selection['type']; ids: string[] } | null
): boolean {
  if (node === stage || !selection) return false
  let n: Konva.Node | null = node
  let depth = 0
  while (n && n !== stage && depth < 10) {
    const name = n.name()
    if (typeof n.draggable === 'function' && n.draggable()) return true
    // Measurement labels own their single-finger drag gesture. Treat them like
    // draggable canvas content so the camera pan recognizer does not steal it.
    if (name?.startsWith('planDimension-')) return true
    if (name?.startsWith('panelModule-')) return true
    if (name?.startsWith('protection-')) {
      const id = name.slice('protection-'.length)
      if (selection.type === 'protection' && selection.ids.includes(id)) return true
    }
    if (name?.startsWith('trunkDevice-')) {
      const id = name.slice('trunkDevice-'.length)
      if (selection.type === 'trunkDevice' && selection.ids.includes(id)) return true
    }
    if (name?.startsWith('note-')) {
      const id = name.slice('note-'.length)
      if (selection.type === 'note' && selection.ids.includes(id)) return true
    }
    if (name?.startsWith('frame-')) {
      const id = name.slice('frame-'.length)
      if (selection.type === 'frame' && selection.ids.includes(id)) return true
    }
    if (name?.startsWith('ground-')) {
      const id = name.slice('ground-'.length)
      if (selection.type === 'ground' && selection.ids.includes(id)) return true
    }
    if (name === 'supply-supply') {
      if (selection.type === 'supply' && selection.ids.includes('supply')) return true
    }
    if (name?.startsWith('placement-')) {
      const id = name.slice('placement-'.length)
      if (selection.type === 'placement' && selection.ids.includes(id)) return true
    }
    if (name?.startsWith('endpoint-')) {
      const id = name.slice('endpoint-'.length)
      if (
        (selection.type === 'endpoint' || selection.type === 'placement') &&
        selection.ids.includes(id)
      )
        return true
      // Continue to parent: panel_distribution has panel-* wrapper, panel selection uses panel ids
    }
    if (name?.startsWith('panel-')) {
      const id = name.slice('panel-'.length)
      if (selection.type === 'panel' && selection.ids.includes(id)) return true
    }
    n = n.getParent()
    depth++
  }
  return false
}

function isCommentNode(node: Konva.Node, stage: Konva.Stage): boolean {
  let current: Konva.Node | null = node
  let depth = 0
  while (current && current !== stage && depth < 10) {
    
    current = current.getParent()
    depth++
  }
  return false
}

interface BaseCanvasProps {
  zoom: number
  pan: Point
  showGrid: boolean
  gridSize: number
  onZoomChange: (zoom: number) => void
  onPanChange: (pan: Point) => void
  /** When set, pan/zoom emitted in the same frame are applied in one call (avoids double Zustand/React updates). */
  onViewTransformCommit?: (patch: { pan?: Point; zoom?: number }) => void
  /** Run immediately before fit-to-view when there is a selection (e.g. plan canvas switches floor). */
  onPrepareFitToView?: () => void
  onDrop?: (position: Point, symbolData: unknown, meta?: CanvasDropMeta) => void
  /** Receives files dropped directly on this canvas. Only canvases that opt in accept file drops. */
  onFilesDrop?: (files: File[]) => void
  children?: React.ReactNode
  backgroundColor?: string
  gridInTransformedLayer?: boolean // If true, grid moves with pan/zoom (for Plan canvas)
  gridOpacity?: number // Grid opacity (0-1), default 1
  /**
   * Lets a canvas take over a finished drag rectangle (canvas coordinates) before it becomes an
   * app selection, e.g. to select things the app selection has no type for. Returning true
   * skips the default selection handling.
   */
  onCaptureRectangle?: (
    rect: { x: number; y: number; width: number; height: number },
    modifiers: { shiftKey: boolean; altKey: boolean }
  ) => boolean
  // Callback to find selectable elements that intersect with a rectangle (in canvas coordinates)
  // Returns array of { id: string, type: Selection['type'] }
  onFindElementsInRectangle?: (rect: {
    x: number
    y: number
    width: number
    height: number
  }) => Array<{
    id: string
    type: string
  }>
  // Callback to get context menu items for a right-click
  // position is in canvas coordinates, elementId is null if clicking empty space
  onGetContextMenuItems?: (position: Point, elementId: string | null) => ContextMenuItem[]
  // Callback to get bounding box for selected elements (for multi-select visual feedback)
  // Returns bounding box in canvas coordinates, or null if no selection
  onGetSelectionBounds?: () => { x: number; y: number; width: number; height: number } | null
  /** Precomputed selection bounds (canvas coords); when provided, used instead of onGetSelectionBounds() so frame updates correctly with zoom/pan. */
  selectionBounds?: { x: number; y: number; width: number; height: number } | null
  // When provided, the selection frame is draggable; delta is in canvas coordinates
  onSelectionFrameDragStart?: () => void
  onSelectionFrameDragMove?: (delta: Point) => void
  onSelectionFrameDragEnd?: () => void
  // Callback for drag over events (for preview visuals)
  // position is in canvas coordinates, symbolData may be null if not available during drag
  onDragOver?: (position: Point, symbolData: unknown | null) => void
  // Optional: 3- or 4-finger swipe (e.g. for view switching on iPad). startClientX is gesture start X in client coords (for left/right half).
  onMultiFingerSwipe?: (
    direction: 'left' | 'right' | 'up' | 'down',
    fingerCount: number,
    startClientX: number
  ) => void
  // Allow single-finger touch panning (disable for tool-heavy touch modes like floor-plan drawing)
  enableSingleFingerPan?: boolean
  // Enable long-press context menu behavior on touch devices
  enableLongPressContextMenu?: boolean
  /**
   * On touch: when long-press completes on these element types, call `onStart` and track finger
   * moves until release (instead of toggling selection). Used for alt-drag-style duplicate on iPad.
   */
  longPressDuplicateDrag?: {
    elementTypes: Selection['type'][]
    onStart: (params: {
      elementId: string
      elementType: Selection['type']
      clientX: number
      clientY: number
    }) => void
  }
  /** Let long-press marquee selection start on canvas content, including draggable modules. */
  longPressDragSelectFromContent?: boolean
  // Optional callback for viewport pan gesture state (right/middle mouse pan).
  onViewportPanStateChange?: (isPanning: boolean) => void
  /** Optional cursor when not panning (e.g. 'crosshair' for draw tools). */
  cursor?: string
  /** Optional visual that follows the pointer while a placement tool is armed. */
  pointerFollower?: React.ReactNode
  /** Handles a simple primary click in canvas coordinates before selection logic. */
  onCanvasPrimaryClick?: (position: Point, meta: { clientX: number; clientY: number }) => void
  /** Disable expensive Konva hit graph lookups on the main content layer. */
  disableContentHitGraph?: boolean
  /** Optional transformed overlay rendered in its own top layer. */
  overlayChildren?: React.ReactNode
  /** Add a tiny transformed layer for isolating high-frequency draggable nodes. */
  enableIsolatedDragLayer?: boolean
  /** Fired when the canvas container is measured (CSS px); used e.g. for plan viewport–centered placement. */
  onViewportPixelSizeChange?: (size: CanvasSize) => void
  /** Optional max zoom used when fitting an active selection (e.g. keep plan fit at 100%). */
  selectionFitMaxZoom?: number
  /** Which view store receives live gesture zoom (keeps side-by-side canvases isolated). */
  gestureZoomCanvas: CanvasType
}

export interface BaseCanvasHandle {
  fitToView: (options?: { ignoreSelection?: boolean }) => boolean
  getStage: () => Konva.Stage | null
  /** Current camera transform, including an in-progress gesture before React state commits. */
  getLiveViewTransform: () => { pan: Point; zoom: number }
  /** Start a selection rectangle at the given pointer position (stage/screen coords). Used when shift/alt+click on content so rect-select works inside the canvas. */
  startSelectionRect: (pointer: { x: number; y: number }) => void
  /** Begin a deferred mouse-button pan (used for middle/right click and optional left-drag pan). */
  beginDeferredMousePan: (
    clientX: number,
    clientY: number,
    modifiers?: { shiftKey?: boolean; altKey?: boolean }
  ) => void
  /** Start a left-button pan immediately (e.g. after drag threshold on interactive content). */
  startMousePan: (clientX: number, clientY: number) => void
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
    gestureZoomCanvas,
  }: BaseCanvasProps,
  ref: ForwardedRef<BaseCanvasHandle>
) {
  // Defensive: Safari iPad can pass undefined/NaN for pan or zoom (timing, touch, or persisted state).
  const pan = useMemo(() => panProp ?? { x: 0, y: 0 }, [panProp])
  const fin = useCallback(
    (n: number, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? n : fallback),
    [],
  )
  const safePan = useMemo(() => ({ x: fin(pan.x, 0), y: fin(pan.y, 0) }), [fin, pan.x, pan.y])
  const safeZoom = useMemo(
    () => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fin(zoom, ZOOM_100))),
    [fin, zoom],
  )
  const themeMode = useSettingsStore((state) => state.theme.mode)
  const leftDragPansCanvas = useSettingsStore((state) => state.leftDragPansCanvas)
  const wheelBehavior = useSettingsStore((state) => state.wheelBehavior)
  const wheelBehaviorHintDone = useSettingsStore((state) => state.wheelBehaviorHintDone)
  const isDark = themeMode === 'dark'
  const viewportResizePreviewActive = useViewportResizePreviewActive()
  const appDialogOpen = useDialogStore(selectIsAppDialogOpen)
  const setSelection = useCommitSelection()
  const clearSelection = useCommitClearSelection()
  const libraryDragSymbol = useUIStore((state) => state.libraryDragSymbol)
  const armedLibrarySymbol = useUIStore((state) => state.armedLibrarySymbol)
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
    contentLayer.batchDraw()
    overlayLayer?.batchDraw()
  }, [])
  const [size, setSize] = useState<CanvasSize>({ width: 800, height: 600 })
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
  const trackpadEvidenceCountRef = useRef(0)
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
  }, [updateCanvasCursor])

  

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
  }, [maybeCancelLongPressForMovement, stopLongPressTouchWatch])

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

      const startZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fin(state.startZoom, ZOOM_100)))
      const scale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fin(nextZoom, startZoom))) / startZoom
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
      const nextZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fin(state.liveZoom, state.startZoom)))
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
      cancelAnimationFrame(selectionDragRafRef.current)
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
  }, [cancelLongPress, cancelPendingTouchSelectionClear, clearPreviewSelection])

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
  if (!wheelZoomGestureActiveRef.current) {
    panRef.current = pan
    zoomRef.current = zoom
  }

  const scheduleSelectionDragFrame = useCallback(() => {
    if (selectionDragRafRef.current != null) return
    selectionDragRafRef.current = requestAnimationFrame(() => {
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
      const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fin(zoomRef.current, ZOOM_100)))

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
  }, [fin, setPreviewSelectedElements, setSelectionPreviewActive])

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
      ;(window as WindowWithEendraTapSuppression).__eendraSuppressNextElementTap = true
      debugTouchLog('longPress ready -> start drag-rect', {
        stage: coord.stage,
        startedOnElement: longPress.current.elementId != null,
      })
      return true
    },
    [clearPreviewSelection, clientToStageAndCanvas, onFindElementsInRectangle]
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
        ;(window as unknown as { __eendraSuppressNextElementTap?: boolean })
          .__eendraSuppressNextElementTap = true
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
      viewRafRef.current = requestAnimationFrame(() => {
        viewRafRef.current = null
        const pending = pendingViewRef.current
        pendingViewRef.current = { pan: null, zoom: null }
        const patch: { pan?: Point; zoom?: number } = {}
        if (typeof pending.zoom === 'number') patch.zoom = pending.zoom
        if (pending.pan) patch.pan = pending.pan
        emitViewTransformPatch(patch)
      })
    },
    [emitViewTransformPatch]
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
      const zoomClamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fin(nextZoom, safeZoom)))

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
      const zoomClamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fin(nextZoom, safeZoom)))
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
      cancelAnimationFrame(postPaintCameraCommitRafRef.current)
      postPaintCameraCommitRafRef.current = null
    }
    if (postPaintCameraCommitTimeoutRef.current != null) {
      clearTimeout(postPaintCameraCommitTimeoutRef.current)
      postPaintCameraCommitTimeoutRef.current = null
    }

    postPaintCameraCommitRafRef.current = requestAnimationFrame(() => {
      postPaintCameraCommitRafRef.current = null
      postPaintCameraCommitTimeoutRef.current = setTimeout(() => {
        postPaintCameraCommitTimeoutRef.current = null
        if (isPanningRef.current || pendingMouseButtonPanRef.current) return
        pushLiveCameraToStore(true)
      }, 0)
    })
  }, [pushLiveCameraToStore])

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
    wheelRafRef.current = requestAnimationFrame(flushWheelPanFrame)
  }, [flushWheelPanFrame])

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
    const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fin(oldScale * mult, safeZoom)))
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
    wheelZoomRafRef.current = requestAnimationFrame(flushWheelZoomFrame)
  }, [flushWheelZoomFrame])

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
    mousePanDrawRafRef.current = requestAnimationFrame(() => {
      mousePanDrawRafRef.current = null
      syncAndDrawTransformedLayers()
    })
  }, [syncAndDrawTransformedLayers])

  useEffect(() => {
    return () => {
      if (viewRafRef.current != null) cancelAnimationFrame(viewRafRef.current)
      viewRafRef.current = null
      pendingViewRef.current = { pan: null, zoom: null }
      if (cameraSyncTimeoutRef.current != null) {
        clearTimeout(cameraSyncTimeoutRef.current)
        cameraSyncTimeoutRef.current = null
      }
      if (postPaintCameraCommitRafRef.current != null) {
        cancelAnimationFrame(postPaintCameraCommitRafRef.current)
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
        cancelAnimationFrame(wheelRafRef.current)
        wheelRafRef.current = null
      }
      if (wheelZoomRafRef.current != null) {
        cancelAnimationFrame(wheelZoomRafRef.current)
        wheelZoomRafRef.current = null
      }
      if (mousePanDrawRafRef.current != null) {
        cancelAnimationFrame(mousePanDrawRafRef.current)
        mousePanDrawRafRef.current = null
      }
      if (panUiRafRef.current != null) {
        cancelAnimationFrame(panUiRafRef.current)
        panUiRafRef.current = null
      }
    }
  }, [])
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
      useUIStore.getState().setCanvasGestureZoom(gestureZoomCanvas, null)
    }
  }, [safeZoom, safePan.x, safePan.y, gestureZoomCanvas])

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

  const commitViewportSize = useCallback(
    (next: CanvasSize, allowPanRecenter: boolean) => {
      const prev = prevSizeRef.current
      if (
        allowPanRecenter &&
        prev &&
        prev.width > 0 &&
        prev.height > 0 &&
        (prev.width !== next.width || prev.height !== next.height)
      ) {
        const dx = (next.width - prev.width) / 2
        const dy = (next.height - prev.height) / 2
        const newPan = { x: panRef.current.x + dx, y: panRef.current.y + dy }
        panRef.current = newPan
        emitViewTransformPatch({ pan: newPan })
      }
      prevSizeRef.current = next
      setSize((current) =>
        current.width === next.width && current.height === next.height ? current : next
      )
      onViewportPixelSizeChange?.(next)
    },
    [emitViewTransformPatch, onViewportPixelSizeChange]
  )

  const cancelScheduledViewportSizeCommit = useCallback(() => {
    if (scheduledViewportRafRef.current != null) {
      window.cancelAnimationFrame(scheduledViewportRafRef.current)
      scheduledViewportRafRef.current = null
    }
    if (scheduledViewportTimeoutRef.current != null) {
      window.clearTimeout(scheduledViewportTimeoutRef.current)
      scheduledViewportTimeoutRef.current = null
    }
  }, [])

  const scheduleViewportSizeCommit = useCallback(
    (next: CanvasSize, allowPanRecenter: boolean) => {
      scheduledViewportSizeRef.current = next
      if (scheduledViewportRafRef.current != null || scheduledViewportTimeoutRef.current != null)
        return

      scheduledViewportRafRef.current = window.requestAnimationFrame(() => {
        scheduledViewportRafRef.current = null
        scheduledViewportTimeoutRef.current = window.setTimeout(() => {
          scheduledViewportTimeoutRef.current = null
          const scheduled = scheduledViewportSizeRef.current
          scheduledViewportSizeRef.current = null
          if (scheduled) commitViewportSize(scheduled, allowPanRecenter)
        }, 0)
      })
    },
    [commitViewportSize]
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newW = Math.round(entry.contentRect.width)
        const newH = Math.round(entry.contentRect.height)
        if (newW === 0 || newH === 0) continue
        const next = { width: newW, height: newH }
        if (viewportResizePreviewActive) {
          cancelScheduledViewportSizeCommit()
          deferredViewportSizeRef.current = next
          continue
        }
        deferredViewportSizeRef.current = null
        if (prevSizeRef.current) {
          scheduleViewportSizeCommit(next, true)
        } else {
          commitViewportSize(next, true)
        }
      }
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      cancelScheduledViewportSizeCommit()
    }
  }, [
    cancelScheduledViewportSizeCommit,
    commitViewportSize,
    scheduleViewportSizeCommit,
    viewportResizePreviewActive,
  ])

  useEffect(() => {
    if (viewportResizePreviewActive) return
    const deferred = deferredViewportSizeRef.current
    if (deferred) {
      deferredViewportSizeRef.current = null
      scheduleViewportSizeCommit(deferred, true)
      return
    }
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const width = Math.round(rect.width)
    const height = Math.round(rect.height)
    if (width === 0 || height === 0) return
    commitViewportSize({ width, height }, true)
  }, [commitViewportSize, scheduleViewportSizeCommit, viewportResizePreviewActive])

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

      // Offer pan mode once when a trackpad is evidently scrolling in zoom mode.
      if (wheelBehavior === 'zoom' && !wheelBehaviorHintDone) {
        if (isDiagonalPixelScroll(wheelInput)) {
          trackpadEvidenceCountRef.current += 1
          if (trackpadEvidenceCountRef.current >= TRACKPAD_EVIDENCE_EVENTS) {
            useWheelBehaviorHintStore.getState().show()
          }
        } else if (msSincePreviousWheel > WHEEL_GESTURE_RESET_MS) {
          trackpadEvidenceCountRef.current = 0
        }
      }

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
      wheelBehaviorHintDone,
    ]
  )

  const activateMouseButtonPan = useCallback(
    (clientX: number, clientY: number) => {
      isPanningRef.current = true
      lastPanPointRef.current = { x: clientX, y: clientY }
      rightClickDragOccurredRef.current = false
      setDragOccurred(false)

      if (panUiRafRef.current != null) {
        cancelAnimationFrame(panUiRafRef.current)
      }
      panUiRafRef.current = requestAnimationFrame(() => {
        panUiRafRef.current = null
        setIsPanningForUI(true)
        onViewportPanStateChangeRef.current?.(true)
      })
    },
    []
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

  // Handle mouse down (start panning or selection rectangle)
  const handleMouseDown = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      if (isAppDialogOpen()) return
      const stage = e.target.getStage()
      if (!stage) return
      if (e.evt.button === 0) {
        dismissCanvasOverlays()
      }

      

      // Right/middle click: defer pan until the pointer moves — a stationary right-click is
      // for the context menu and must not run pan teardown (pushLiveCameraToStore, pan UI).
      if (e.evt.button === 2 || e.evt.button === 1) {
        beginDeferredMousePan(e.evt.clientX, e.evt.clientY, e.evt.button)
        e.evt.preventDefault()
        return
      }

      // Left click on empty space - pan (optional) or start selection rectangle / clear selection
      if (e.evt.button === 0 && e.target === e.target.getStage()) {
        // Touch devices fire synthetic mouse events after touchend; marquee select
        // and floor-plan drawing are handled via touch handlers instead.
        if (shouldIgnoreSyntheticMouseEvent()) return

        if (onCanvasPrimaryClickRef.current) {
          e.evt.preventDefault()
          return
        }

        if (leftDragPansCanvas && !e.evt.shiftKey) {
          beginDeferredMousePan(e.evt.clientX, e.evt.clientY, 0, {
            shiftKey: e.evt.shiftKey,
            altKey: e.evt.altKey,
          })
          e.evt.preventDefault()
          return
        }

        const pointer = stage.getPointerPosition()
        if (!pointer) return

        // Start selection rectangle
        const r = {
          startX: pointer.x,
          startY: pointer.y,
          endX: pointer.x,
          endY: pointer.y,
        }
        selectionRectLiveRef.current = r
        rectSelectActiveRef.current = true
        clearPreviewSelection()
        e.evt.preventDefault()
      }
    },
    [
      beginDeferredMousePan,
      clearPreviewSelection,
      leftDragPansCanvas,
      shouldIgnoreSyntheticMouseEvent,
    ]
  )

  // Handle mouse move (pan or update selection rectangle)
  const handleMouseMove = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage()
      if (!stage) return

      hoveredCursorNodeRef.current = e.target
      cursorShiftKeyRef.current = e.evt.shiftKey
      updateCanvasCursor(true)

      // Update selection rectangle (coalesced to rAF in scheduleSelectionDragFrame)
      if (rectSelectActiveRef.current && selectionRectLiveRef.current) {
        const pointer = stage.getPointerPosition()
        if (pointer) {
          const base = selectionRectLiveRef.current
          selectionRectLiveRef.current = {
            ...base,
            endX: pointer.x,
            endY: pointer.y,
          }
          scheduleSelectionDragFrame()
        }
        return
      }

      if (pointerFollower) {
        setPointerFollowerPosition({ x: e.evt.clientX, y: e.evt.clientY })
      }

      // Handle panning
      if (isPanningRef.current) {
        return
      }
    },
    [pointerFollower, scheduleSelectionDragFrame, updateCanvasCursor]
  )

  // Handle mouse up (stop panning or finalize selection)
  const handleMouseUp = useCallback(
    (e?: KonvaEventObject<MouseEvent>) => {
      if (isAppDialogOpen()) return
      const button = e?.evt?.button
      const rectSelectActive = rectSelectActiveRef.current
      const shouldDeferMouseButtonCameraCommit =
        isPanningRef.current && mousePanWindowCleanupRef.current != null && !rectSelectActive
      if (
        button != null &&
        button !== 0 &&
        !isPanningRef.current &&
        !isSelecting &&
        !rectSelectActive &&
        !pendingMouseButtonPanRef.current
      ) {
        return
      }

      const selection = useUIStore.getState().selection

      if (
        button === 0 &&
        onCanvasPrimaryClickRef.current &&
        !dragOccurred &&
        !dragOccurredRef.current &&
        !isPanningRef.current
      ) {
        const stage = stageRef.current
        const pointer = stage?.getPointerPosition()
        if (stage && e && isCommentNode(e.target, stage)) return
        if (pointer && e?.evt) {
          const zCommit = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fin(zoom, ZOOM_100)))
          onCanvasPrimaryClickRef.current(
            {
              x: (pointer.x - pan.x) / zCommit,
              y: (pointer.y - pan.y) / zCommit,
            },
            { clientX: e.evt.clientX, clientY: e.evt.clientY }
          )
          return
        }
      }

      if (rectSelectActive || isSelecting) {
        if (selectionDragRafRef.current != null) {
          cancelAnimationFrame(selectionDragRafRef.current)
          selectionDragRafRef.current = null
        }
        const stageEarly = stageRef.current
        const pointerCommit = stageEarly?.getPointerPosition()
        const liveEarly = selectionRectLiveRef.current ?? selectionRect
        if (pointerCommit && liveEarly) {
          selectionRectLiveRef.current = {
            ...liveEarly,
            endX: pointerCommit.x,
            endY: pointerCommit.y,
          }
        }
      }

      const rectForCommit = selectionRectLiveRef.current ?? selectionRect

      // Finalize selection rectangle
      if (rectSelectActive && rectForCommit && !onFindElementsInRectangle) {
        // Canvas without rect-select (e.g. PanelCanvas) — treat any stage click as a deselect
        if (!e?.evt.shiftKey && !e?.evt.altKey) {
          clearSelection()
        }
      } else if (rectSelectActive && rectForCommit && onFindElementsInRectangle) {
        const stage = stageRef.current
        if (stage) {
          const zCommit = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fin(zoom, ZOOM_100)))
          // Convert screen coordinates to canvas coordinates
          const startCanvasX = (rectForCommit.startX - pan.x) / zCommit
          const startCanvasY = (rectForCommit.startY - pan.y) / zCommit
          const endCanvasX = (rectForCommit.endX - pan.x) / zCommit
          const endCanvasY = (rectForCommit.endY - pan.y) / zCommit

          // Calculate rectangle bounds
          const rectX = Math.min(startCanvasX, endCanvasX)
          const rectY = Math.min(startCanvasY, endCanvasY)
          const rectWidth = Math.abs(endCanvasX - startCanvasX)
          const rectHeight = Math.abs(endCanvasY - startCanvasY)

          const captured = onCaptureRectangleRef.current?.(
            { x: rectX, y: rectY, width: rectWidth, height: rectHeight },
            { shiftKey: e?.evt.shiftKey || false, altKey: e?.evt.altKey || false }
          )
          if (captured) {
            // The canvas handled it; keep the synthetic tap from clearing the selection.
            ignoreNextTapClearRef.current = true
          } else if (rectWidth > 5 && rectHeight > 5) {
            // Only select if rectangle is large enough (avoid accidental clicks)
            // Find elements in rectangle
            const elements = onFindElementsInRectangle({
              x: rectX,
              y: rectY,
              width: rectWidth,
              height: rectHeight,
            })

            debugTouchLog('handleMouseUp drag-rect computed', {
              selectionRect: rectForCommit,
              canvasRect: { x: rectX, y: rectY, width: rectWidth, height: rectHeight },
              elementCount: elements.length,
              selectionBefore: selection,
            })

            // Handle modifiers (defined here so they're available in both branches)
            const shiftKey = e?.evt.shiftKey || false
            const altKey = e?.evt.altKey || false

            if (elements.length > 0) {
              // Select ALL elements regardless of type
              // Use the most common type for the selection.type (for compatibility)
              // but include ALL IDs so all elements are selected
              const elementsByType = new Map<string, Array<{ id: string; type: string }>>()
              elements.forEach((el) => {
                const type = el.type
                if (!elementsByType.has(type)) {
                  elementsByType.set(type, [])
                }
                elementsByType.get(type)!.push(el)
              })

              // Find the most common type (for selection.type compatibility)
              let mostCommonType: string | null = null
              let maxCount = 0
              for (const [type, typeElements] of elementsByType.entries()) {
                if (typeElements.length > maxCount) {
                  maxCount = typeElements.length
                  mostCommonType = type
                }
              }

              // If tied, prioritize: protection > endpoint > circuit > panel
              if (maxCount > 0) {
                const typePriority: Record<string, number> = {
                  protection: 100,
                  endpoint: 50,
                  circuit: 25,
                  panel: 10,
                }
                let highestPriority = -1
                for (const [type, typeElements] of elementsByType.entries()) {
                  if (typeElements.length === maxCount) {
                    const priority = typePriority[type] || 0
                    if (priority > highestPriority) {
                      highestPriority = priority
                      mostCommonType = type
                    }
                  }
                }
              }

              // Get ALL IDs from ALL types
              const allElementIds = elements.map((el) => el.id)

              if (altKey) {
                // Remove from selection
                const newIds = selection.ids.filter((id) => !allElementIds.includes(id))
                if (newIds.length === 0) {
                  clearSelection()
                } else {
                  setSelection({ ...selection, ids: newIds })
                }
              } else if (shiftKey) {
                // Add to selection - include all IDs regardless of type
                const existingIds = selection.ids
                const newIds = [...new Set([...existingIds, ...allElementIds])]
                setSelection(selectMultiple(mostCommonType as Selection['type'], newIds))
              } else {
                // Replace selection - include ALL elements
                setSelection(selectMultiple(mostCommonType as Selection['type'], allElementIds))
              }

              // Prevent the synthetic tap that Konva emits after touch-end
              // from immediately clearing this new selection on empty stage.
              ignoreNextTapClearRef.current = true

              debugTouchLog('handleMouseUp drag-rect applied selection', {
                mostCommonType,
                allElementIds,
                shiftKey,
                altKey,
                selectionAfter: useUIStore.getState().selection,
              })
            } else if (!shiftKey && !altKey) {
              // No elements found and no modifiers - clear selection
              clearSelection()
              debugTouchLog('handleMouseUp drag-rect found no elements; cleared selection')
            }
          } else {
            // Small rectangle - treat as click, clear selection if no modifiers
            if (!e?.evt.shiftKey && !e?.evt.altKey) {
              clearSelection()
              debugTouchLog(
                'handleMouseUp drag-rect too small; treated as click -> cleared selection'
              )
            }
          }
        }
      }

      if (mousePanWindowCleanupRef.current) {
        mousePanWindowCleanupRef.current()
        mousePanWindowCleanupRef.current = null
      }
      if (isPanningRef.current) {
        isPanningRef.current = false
        if (panUiRafRef.current != null) {
          cancelAnimationFrame(panUiRafRef.current)
          panUiRafRef.current = null
        }
        setIsPanningForUI(false)
        onViewportPanStateChangeRef.current?.(false)
        if (cameraSyncTimeoutRef.current != null) {
          clearTimeout(cameraSyncTimeoutRef.current)
          cameraSyncTimeoutRef.current = null
        }
        if (dragOccurredRef.current) {
          if (shouldDeferMouseButtonCameraCommit) {
            schedulePostPaintCameraCommit()
          } else {
            pushLiveCameraToStore(true)
          }
        }
      }
      if (panDisabledListeningRef.current && stageRef.current && !cameraGestureActiveRef.current) {
        stageRef.current.listening(true)
      }
      panDisabledListeningRef.current = false
      lastPanPointRef.current = { x: 0, y: 0 }
      if (rectSelectActive || isSelecting) {
        rectSelectActiveRef.current = false
        setIsSelecting(false)
        selectionRectLiveRef.current = null
        clearPreviewSelection()
        setSelectionRect(null)
      }

      if (dragOccurred || dragOccurredRef.current) {
        setTimeout(() => {
          setDragOccurred(false)
          dragOccurredRef.current = false
        }, 100)
      }
    },
    [
      clearPreviewSelection,
      isSelecting,
      selectionRect,
      onFindElementsInRectangle,
      zoom,
      pan,
      setSelection,
      clearSelection,
      dragOccurred,
      fin,
      pushLiveCameraToStore,
      schedulePostPaintCameraCommit,
    ]
  )

  useEffect(() => {
    handleMouseUpRef.current = handleMouseUp
  }, [handleMouseUp])

  // Handle drag and drop
  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
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
          } catch (err) {
            // Ignore errors - symbol data may not be available during dragover
          }
          if (!symbolData && libraryDragSymbol) {
            symbolData = libraryDragSymbol
          }

          onDragOver({ x: canvasX, y: canvasY }, symbolData)
        }
      }
    },
    [libraryDragSymbol, onDragOver, onFilesDrop, zoom, pan]
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
    [libraryDragSymbol, onDrop, onDragOver, onFilesDrop, zoom, pan]
  )

  // Helper function to recursively get bounds of a node and all its children
  const getNodeBounds = useCallback(
    (
      node: Konva.Node,
      parentX: number = 0,
      parentY: number = 0
    ): { minX: number; minY: number; maxX: number; maxY: number } | null => {
      const nodeX = node.x() + parentX
      const nodeY = node.y() + parentY

      // For Groups, we need to check all children recursively
      if (node.getType() === 'Group') {
        const group = node as Konva.Group
        const children = group.getChildren()

        if (children.length === 0) {
          return null
        }

        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        let hasValidBounds = false

        children.forEach((child) => {
          const childBounds = getNodeBounds(child, nodeX, nodeY)
          if (childBounds) {
            minX = Math.min(minX, childBounds.minX)
            minY = Math.min(minY, childBounds.minY)
            maxX = Math.max(maxX, childBounds.maxX)
            maxY = Math.max(maxY, childBounds.maxY)
            hasValidBounds = true
          }
        })

        if (hasValidBounds) {
          return { minX, minY, maxX, maxY }
        }
        return null
      }

      // For Images, use width() and height() directly as getClientRect can be unreliable
      if (node.getType() === 'Image') {
        const image = node as Konva.Image
        let width = image.width()
        let height = image.height()

        // Fallback: if width/height are 0, try to get from the image element itself
        if ((width === 0 || height === 0) && image.image()) {
          const imgElement = image.image() as HTMLImageElement
          if (imgElement) {
            if (width === 0) width = imgElement.naturalWidth || imgElement.width || 0
            if (height === 0) height = imgElement.naturalHeight || imgElement.height || 0
          }
        }

        if (width > 0 && height > 0) {
          // Account for offset if set
          const offsetX = image.offsetX() || 0
          const offsetY = image.offsetY() || 0

          return {
            minX: nodeX - offsetX,
            minY: nodeY - offsetY,
            maxX: nodeX - offsetX + width,
            maxY: nodeY - offsetY + height,
          }
        }
        return null
      }

      // For Lines, calculate bounds from points
      if (node.getType() === 'Line') {
        const line = node as Konva.Line
        const points = line.points()
        if (points.length >= 2) {
          let minX = Infinity
          let minY = Infinity
          let maxX = -Infinity
          let maxY = -Infinity

          for (let i = 0; i < points.length; i += 2) {
            const x = points[i] ?? 0
            const y = points[i + 1] ?? 0
            if (isFinite(x) && isFinite(y)) {
              minX = Math.min(minX, nodeX + x)
              minY = Math.min(minY, nodeY + y)
              maxX = Math.max(maxX, nodeX + x)
              maxY = Math.max(maxY, nodeY + y)
            }
          }

          if (
            isFinite(minX) &&
            isFinite(minY) &&
            isFinite(maxX) &&
            isFinite(maxY) &&
            maxX > minX &&
            maxY > minY
          ) {
            return { minX, minY, maxX, maxY }
          }
        }
        return null
      }

      // For other node types (Rect, Circle, Text, etc.), get their bounds
      const box = node.getClientRect({ skipTransform: true })

      if (box && isFinite(box.width) && isFinite(box.height) && box.width > 0 && box.height > 0) {
        return {
          minX: nodeX + box.x,
          minY: nodeY + box.y,
          maxX: nodeX + box.x + box.width,
          maxY: nodeY + box.y + box.height,
        }
      }

      return null
    },
    []
  )

  // Compute bounds for the current selection within this canvas, if any.
  // Uses Konva node names (endpoint-*, protection-*, panel-*, etc.) resolved via resolveKonvaElementId
  // so it naturally respects whatever elements this particular canvas renders.
  const getSelectionBounds = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return null
    const selection = useUIStore.getState().selection
    if (!selection.ids || selection.ids.length === 0) return null

    // When gridInTransformedLayer is true, the content layer is at index 0.
    // Otherwise, the background grid layer is at index 0 and content at index 1.
    const contentLayerIndex = gridInTransformedLayer ? 0 : 1
    const contentLayer = stage.children?.[contentLayerIndex]
    if (!contentLayer) return null

    // Walk all descendant nodes of the content layer and aggregate bounds
    const allNodes = (contentLayer as Konva.Container).find('*') as unknown as KonvaNodeCollectionLike

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let hasValidBounds = false

    const visitNode = (node: Konva.Node) => {
      const elementId = resolveKonvaElementId(node, stage)
      if (!elementId) return
      if (!selection.ids.includes(elementId)) return

      const bounds = getNodeBounds(node, 0, 0)
      if (!bounds) return

      minX = Math.min(minX, bounds.minX)
      minY = Math.min(minY, bounds.minY)
      maxX = Math.max(maxX, bounds.maxX)
      maxY = Math.max(maxY, bounds.maxY)
      hasValidBounds = true
    }

    if (Array.isArray(allNodes)) {
      allNodes.forEach((n: Konva.Node) => visitNode(n))
    } else if (allNodes && typeof allNodes.each === 'function') {
      allNodes.each((n: Konva.Node) => visitNode(n))
    }

    if (
      !hasValidBounds ||
      !isFinite(minX) ||
      !isFinite(minY) ||
      !isFinite(maxX) ||
      !isFinite(maxY)
    ) {
      return null
    }

    return { minX, minY, maxX, maxY }
  }, [gridInTransformedLayer, getNodeBounds])

  // Handle fit to view — returns true when content bounds were found and applied.
  const handleFitToView = useCallback((options?: { ignoreSelection?: boolean }): boolean => {
    const stage = stageRef.current
    if (!stage) return false
    const liveRect = containerRef.current?.getBoundingClientRect()
    const viewportWidth = Math.max(1, Math.round(liveRect?.width ?? size.width))
    const viewportHeight = Math.max(1, Math.round(liveRect?.height ?? size.height))
    const viewportCenterX = viewportWidth / 2
    const viewportCenterY = viewportHeight / 2

    const contentLayerIndex = gridInTransformedLayer ? 0 : 1
    const contentLayer = stage.children?.[contentLayerIndex]
    if (!contentLayer) {
      emitViewTransformPatch({
        zoom: fin(1, safeZoom),
        pan: { x: fin(viewportCenterX, 0), y: fin(viewportCenterY, 0) },
      })
      return false
    }

    let boundsForFit: { minX: number; minY: number; maxX: number; maxY: number } | null = null
    const selection = useUIStore.getState().selection

    if (!options?.ignoreSelection && selection.ids && selection.ids.length > 0) {
      onPrepareFitToView?.()
      const cbBounds = onGetSelectionBounds?.()
      if (cbBounds) {
        boundsForFit = {
          minX: cbBounds.x,
          minY: cbBounds.y,
          maxX: cbBounds.x + cbBounds.width,
          maxY: cbBounds.y + cbBounds.height,
        }
      } else {
        boundsForFit = getSelectionBounds()
      }
    }

    if (!boundsForFit) {
      const children = contentLayer.getChildren()
      if (children.length === 0) {
        emitViewTransformPatch({
          zoom: fin(1, safeZoom),
          pan: { x: fin(viewportCenterX, 0), y: fin(viewportCenterY, 0) },
        })
        return false
      }

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      let hasValidBounds = false

      children.forEach((child) => {
        if (child.getClassName() === 'Line' && !child.isListening()) return
        const bounds = getNodeBounds(child, 0, 0)
        if (bounds) {
          minX = Math.min(minX, bounds.minX)
          minY = Math.min(minY, bounds.minY)
          maxX = Math.max(maxX, bounds.maxX)
          maxY = Math.max(maxY, bounds.maxY)
          hasValidBounds = true
        }
      })

      if (!hasValidBounds) {
        emitViewTransformPatch({
          zoom: fin(1, safeZoom),
          pan: { x: fin(viewportCenterX, 0), y: fin(viewportCenterY, 0) },
        })
        return false
      }

      boundsForFit = { minX, minY, maxX, maxY }
    }

    const contentWidth = boundsForFit.maxX - boundsForFit.minX
    const contentHeight = boundsForFit.maxY - boundsForFit.minY

    // If no valid content, center at origin
    if (
      !isFinite(contentWidth) ||
      !isFinite(contentHeight) ||
      contentWidth === 0 ||
      contentHeight === 0
    ) {
      emitViewTransformPatch({
        zoom: fin(1, safeZoom),
        pan: { x: fin(viewportCenterX, 0), y: fin(viewportCenterY, 0) },
      })
      return false
    }

    const padding = Math.min(viewportWidth, viewportHeight) * 0.1

    const scaleX = (viewportWidth - padding * 2) / contentWidth
    const scaleY = (viewportHeight - padding * 2) / contentHeight
    const fitMaxZoom =
      selection.ids && selection.ids.length > 0 && selectionFitMaxZoom != null
        ? selectionFitMaxZoom
        : ZOOM_MAX
    const newScale = Math.min(scaleX, scaleY, fitMaxZoom)

    const clampedScale = Math.max(ZOOM_MIN, newScale)

    const contentCenterX = boundsForFit.minX + contentWidth / 2
    const contentCenterY = boundsForFit.minY + contentHeight / 2

    const newPan = {
      x: viewportCenterX - contentCenterX * clampedScale,
      y: viewportCenterY - contentCenterY * clampedScale,
    }

    emitViewTransformPatch({
      zoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fin(clampedScale, safeZoom))),
      pan: { x: fin(newPan.x, safePan.x), y: fin(newPan.y, safePan.y) },
    })
    return true
  }, [
    size,
    onPrepareFitToView,
    getNodeBounds,
    gridInTransformedLayer,
    fin,
    safePan,
    safeZoom,
    selectionFitMaxZoom,
    onGetSelectionBounds,
    getSelectionBounds,
    emitViewTransformPatch,
  ])

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
  }, [isSelecting, handleMouseUp])

  // Helper to calculate distance between two touch points
  const getTouchDistance = useCallback((touch1: React.Touch, touch2: React.Touch) => {
    const dx = touch1.clientX - touch2.clientX
    const dy = touch1.clientY - touch2.clientY
    return Math.sqrt(dx * dx + dy * dy)
  }, [])

  // Helper to calculate center point between two touches
  const getTouchCenter = useCallback((touch1: React.Touch, touch2: React.Touch) => {
    return {
      x: (touch1.clientX + touch2.clientX) / 2,
      y: (touch1.clientY + touch2.clientY) / 2,
    }
  }, [])

  // Centroid of N touches (for 3/4-finger swipe)
  const getTouchCentroid = useCallback((touches: React.TouchList | TouchList): Point => {
    let x = 0
    let y = 0
    const n = touches.length
    for (let i = 0; i < n; i++) {
      const t = touches[i]
      if (t) {
        x += t.clientX
        y += t.clientY
      }
    }
    return { x: n ? x / n : 0, y: n ? y / n : 0 }
  }, [])

  const MULTI_FINGER_SWIPE_THRESHOLD = 50

  // Handle touch start
  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (isAppDialogOpen()) return
      if (contextMenu) {
        const target = e.target
        const isInsideContextMenu =
          target instanceof Element && target.closest('[data-canvas-context-menu="true"]')
        if (shouldIgnoreCanvasTouchForContextMenu(true, !!isInsideContextMenu)) {
          resetCanvasTouchGestureForContextMenu()
          return
        }
        if (!isInsideContextMenu) {
          setContextMenu(null)
          resetCanvasTouchGestureForContextMenu()
          ignoreNextTapClearRef.current = true
          return
        }
      }
      debugTouchLog('handleTouchStart', {
        touches: e.touches.length,
        changedTouches: e.changedTouches.length,
      })
      if (e.touches.length >= 3) {
        // 3- or 4-finger gesture - track for swipe (e.g. view switch on iPad)
        e.preventDefault()
        e.stopPropagation()
        lastTapRef.current = null
        touchStartElementIdRef.current = null
        touchStartedOnContentRef.current = false
        cancelLongPress()
        setCameraGestureHitTestingDisabled(true)
        setTouchPanStart(null)
        setTouchPanInitialCanvasPan(null)
        touchPanStartRef.current = null
        touchPanInitialCanvasPanRef.current = null
        setTouchStartDistance(null)
        setTouchStartCenter(null)
        const center = getTouchCentroid(e.touches)
        multiFingerSwipeRef.current = {
          active: true,
          fingerCount: e.touches.length,
          startCenter: center,
          lastCenter: center,
        }
      } else if (e.touches.length === 2) {
        // Two-finger gesture - prepare for pinch zoom or pan
        e.preventDefault()
        e.stopPropagation()
        lastTapRef.current = null
        touchStartElementIdRef.current = null
        touchStartedOnContentRef.current = false
        cancelLongPress()
        setCameraGestureHitTestingDisabled(true)
        const touch1 = e.touches[0]
        const touch2 = e.touches[1]
        if (!touch1 || !touch2 || !containerRef.current) return

        // Cancel any single-finger pan
        setTouchPanStart(null)
        setTouchPanInitialCanvasPan(null)
        touchPanStartRef.current = null
        touchPanInitialCanvasPanRef.current = null
        setTouchHasMoved(false)

        // Get container offset to convert viewport coords to container-relative coords
        const rect = containerRef.current.getBoundingClientRect()

        const touchDistance = getTouchDistance(touch1, touch2)
        const viewportCenter = getTouchCenter(touch1, touch2)

        // Convert viewport coordinates to container-relative coordinates
        const center = {
          x: viewportCenter.x - rect.left,
          y: viewportCenter.y - rect.top,
        }

        setTouchStartDistance(touchDistance)
        const layer = contentLayerRef.current
        const startZoom = layer ? layer.scaleX() || safeZoom : zoom
        const startPan: Point = layer ? { x: layer.x(), y: layer.y() } : { x: pan.x, y: pan.y }
        setTouchStartZoom(startZoom)
        setTouchStartPan(startPan)
        setTouchStartCenter(center)
        beginCssCameraTransform(startPan, startZoom)
      } else if (e.touches.length === 1) {
        suppressTouchContextMenuUntilRef.current = Date.now() + 2000
        // Single-finger touch - might become pan, tap, or node drag (e.g. panel module)
        const touch = e.touches[0]
        if (!touch) return
        suppressSyntheticMouseAfterTouch()
        // Drop marquee left over from synthetic mouse (e.g. wall draw on iOS) before touch handlers run.
        if (
          rectSelectActiveRef.current &&
          longPress.current.phase !== 'ready' &&
          longPress.current.action !== 'duplicate-drag'
        ) {
          if (selectionDragRafRef.current != null) {
            cancelAnimationFrame(selectionDragRafRef.current)
            selectionDragRafRef.current = null
          }
          rectSelectActiveRef.current = false
          setIsSelecting(false)
          selectionRectLiveRef.current = null
          clearPreviewSelection()
          setSelectionRect(null)
        }
        dismissCanvasOverlays()
        debugTouchLog('handleTouchStart one-finger', {
          clientX: touch.clientX,
          clientY: touch.clientY,
        })

        // Hit-test: if touch started on a draggable (e.g. panel module), don't use this gesture for canvas pan
        touchStartedOnDraggableRef.current = false
        touchStartedOnContentRef.current = false
        const rect = containerRef.current?.getBoundingClientRect()
        const stage = stageRef.current
        if (rect && stage) {
          const node = stage.getIntersection({
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top,
          })
          touchStartElementIdRef.current = node ? resolveKonvaElementId(node, stage) : null
          touchStartedOnContentRef.current = !!node
          if (node && isNodeDraggableForTouch(node, stage, useUIStore.getState().selection)) {
            touchStartedOnDraggableRef.current = true
          }
        } else {
          touchStartElementIdRef.current = null
          touchStartedOnContentRef.current = false
        }

        // Store initial touch position and canvas state (if single-finger pan is enabled and not on draggable)
        if (enableSingleFingerPan && !touchStartedOnDraggableRef.current) {
          if (touchPanWindowCleanupRef.current) {
            touchPanWindowCleanupRef.current()
            touchPanWindowCleanupRef.current = null
          }
          touchSingleFingerPanActiveRef.current = false
          setTouchFingerPanForUI(false)
          const startTouch = { x: touch.clientX, y: touch.clientY }
          setTouchPanStart(startTouch)
          touchPanStartRef.current = startTouch
          const layer = contentLayerRef.current
          const startPan: Point = layer ? { x: layer.x(), y: layer.y() } : { x: pan.x, y: pan.y }
          setTouchPanInitialCanvasPan(startPan)
          touchPanInitialCanvasPanRef.current = startPan
          setTouchHasMoved(false)

          const handleWindowTouchMove = (evt: TouchEvent) => {
            handleTouchMoveRef.current(evt)
          }
          const handleWindowTouchEnd = (evt: TouchEvent) => {
            handleTouchEndRef.current(evt)
          }
          window.addEventListener('touchmove', handleWindowTouchMove, {
            capture: true,
            passive: false,
          })
          window.addEventListener('touchend', handleWindowTouchEnd, true)
          window.addEventListener('touchcancel', handleWindowTouchEnd, true)
          touchPanWindowCleanupRef.current = () => {
            window.removeEventListener('touchmove', handleWindowTouchMove, true)
            window.removeEventListener('touchend', handleWindowTouchEnd, true)
            window.removeEventListener('touchcancel', handleWindowTouchEnd, true)
          }
        } else {
          setTouchPanStart(null)
          setTouchPanInitialCanvasPan(null)
          touchPanStartRef.current = null
          touchPanInitialCanvasPanRef.current = null
          setTouchHasMoved(false)
        }

        const duplicateDragOnTouch = longPressDuplicateDragRef.current
        const potentialSecondTap = isPotentialSecondTap(
          lastTapRef.current,
          {
            time: performance.now(),
            clientX: touch.clientX,
            clientY: touch.clientY,
            elementId: touchStartElementIdRef.current,
          },
          DOUBLE_TAP_MS,
          DOUBLE_TAP_SLOP_PX
        )
        const shouldScheduleLongPress = shouldScheduleTouchLongPress({
          enabled: enableLongPressContextMenuRef.current,
          startedOnDraggable: touchStartedOnDraggableRef.current,
          hasDuplicateDrag: !!duplicateDragOnTouch,
          dragSelectFromContent: longPressDragSelectFromContentRef.current,
          potentialSecondTap,
        })

        if (shouldScheduleLongPress) {
          cancelLongPress()
          lastSingleTouchRef.current = { x: touch.clientX, y: touch.clientY }
          longPress.current.origin = { x: touch.clientX, y: touch.clientY }
          longPress.current.phase = 'filling'
          longPress.current.screenPos = { x: touch.clientX, y: touch.clientY }
          longPress.current.startedOnDraggable = touchStartedOnDraggableRef.current
          longPress.current.startedAt = performance.now()
          setLongPressIndicator({
            phase: 'filling',
            position: { x: touch.clientX, y: touch.clientY },
          })
          startLongPressTouchWatch()
          const touchX = touch.clientX
          const touchY = touch.clientY
          debugTouchLog('longPress schedule delayTimer', {
            touchX,
            touchY,
            delayMs: LONG_PRESS_DELAY_MS,
            readyAfterMs: LONG_PRESS_READY_MS,
          })
          longPress.current.delayTimer = setTimeout(() => {
            longPress.current.delayTimer = null
            if (cameraGestureActiveRef.current) {
              debugTouchLog('longPress delayTimer ignored: camera gesture active', {
                elapsedMs: Math.round(performance.now() - longPress.current.startedAt),
              })
              return
            }
            if (!isLongPressFingerAtOrigin(undefined, undefined, true)) {
              debugTouchLog('longPress delayTimer cancelling: finger moved', {
                elapsedMs: Math.round(performance.now() - longPress.current.startedAt),
                origin: longPress.current.origin,
                last: lastSingleTouchRef.current,
              })
              cancelLongPress()
              return
            }
            const pos = longPress.current.screenPos ?? { x: touchX, y: touchY }
            debugTouchLog('longPress delayTimer fired -> filling', {
              pos,
              elapsedMs: Math.round(performance.now() - longPress.current.startedAt),
            })

            // Resolve element while Konva is still listening (for selection)
            const rect = containerRef.current?.getBoundingClientRect()
            const stage = stageRef.current
            if (rect && stage) {
              const node = stage.getIntersection({
                x: touchX - rect.left,
                y: touchY - rect.top,
              })
              if (node) {
                const id = resolveKonvaElementId(node, stage)
                longPress.current.elementId = id
                // Infer selection type from node name prefixes
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
                if (
                  longPressTargetIsSelectionBackground(
                    t,
                    longPressDragSelectFromContentRef.current
                  )
                ) {
                  longPress.current.elementId = null
                  longPress.current.elementType = null
                } else {
                  longPress.current.elementType = t
                }
                debugTouchLog('longPress resolved element', {
                  elementId: id,
                  elementType: t,
                })
              } else {
                longPress.current.elementId = null
                longPress.current.elementType = null
                debugTouchLog('longPress no element under finger')
              }
            }

            // Do NOT disable listening here: keep Konva listening so a quick release
            // still fires tap/selection. We only disable when the ring has filled ('ready').

            longPress.current.readyTimer = setTimeout(() => {
              longPress.current.readyTimer = null
              if (cameraGestureActiveRef.current) {
                debugTouchLog('longPress readyTimer ignored: camera gesture active', {
                  elapsedMs: Math.round(performance.now() - longPress.current.startedAt),
                })
                return
              }
              if (!isLongPressFingerAtOrigin(undefined, undefined, true)) {
                debugTouchLog('longPress readyTimer cancelling: finger moved', {
                  elapsedMs: Math.round(performance.now() - longPress.current.startedAt),
                  origin: longPress.current.origin,
                  last: lastSingleTouchRef.current,
                })
                cancelLongPress()
                return
              }
              const readyAt = lastSingleTouchRef.current ?? pos
              longPress.current.phase = 'ready'
              longPress.current.screenPos = readyAt
              dismissLongPressIndicator(readyAt)
              debugTouchLog('longPress readyTimer fired -> ready', {
                screenPos: readyAt,
                elementId: longPress.current.elementId,
                elementType: longPress.current.elementType,
                elapsedMs: Math.round(performance.now() - longPress.current.startedAt),
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
                ;(window as unknown as { __eendraSuppressNextElementTap?: boolean })
                  .__eendraSuppressNextElementTap = true
                debugTouchLog('longPress ready -> duplicate-drag', {
                  elementId: lpElementId,
                  elementType: lpElementType,
                })
                return
              }

              if (
                longPress.current.screenPos &&
                (longPressDragSelectFromContentRef.current ||
                  !longPress.current.elementId)
              ) {
                startLongPressDragSelection(longPress.current.screenPos)
              }
            }, LONG_PRESS_FILL_MS)
          }, LONG_PRESS_DELAY_MS)
        }
      }
    },
    [
      zoom,
      pan,
      getTouchDistance,
      getTouchCenter,
      getTouchCentroid,
      cancelLongPress,
      clearPreviewSelection,
      enableSingleFingerPan,
      isLongPressFingerAtOrigin,
      setCameraGestureHitTestingDisabled,
      safeZoom,
      contextMenu,
      resetCanvasTouchGestureForContextMenu,
      startLongPressTouchWatch,
      stopLongPressTouchWatch,
      dismissLongPressIndicator,
      suppressSyntheticMouseAfterTouch,
      beginCssCameraTransform,
      startLongPressDragSelection,
    ]
  )

  // Handle touch move
  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement> | TouchEvent) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0]
        if (touch) {
          lastSingleTouchRef.current = { x: touch.clientX, y: touch.clientY }
          maybeCancelLongPressForMovement(touch.clientX, touch.clientY)
          activateLongPressReady(touch.clientX, touch.clientY)
        }
      }

      if (e.touches.length >= 2 && !cameraGestureActiveRef.current) {
        setCameraGestureHitTestingDisabled(true)
      }
      if (e.touches.length >= 3 && multiFingerSwipeRef.current?.active) {
        e.preventDefault()
        e.stopPropagation()
        multiFingerSwipeRef.current.lastCenter = getTouchCentroid(e.touches)
      } else if (
        e.touches.length === 2 &&
        touchStartDistance !== null &&
        touchStartCenter !== null
      ) {
        // Two-finger gesture - pinch zoom and pan
        e.preventDefault()
        e.stopPropagation()
        const touch1 = e.touches[0]
        const touch2 = e.touches[1]
        if (!touch1 || !touch2 || !containerRef.current) return

        // Get container offset to convert viewport coords to container-relative coords
        const rect = containerRef.current.getBoundingClientRect()

        const currentDistance = getTouchDistance(touch1, touch2)
        const viewportCenter = getTouchCenter(touch1, touch2)

        // Convert viewport coordinates to container-relative coordinates
        const currentCenter = {
          x: viewportCenter.x - rect.left,
          y: viewportCenter.y - rect.top,
        }

        // Calculate zoom based on pinch distance change
        const scale = currentDistance / touchStartDistance

        // Add damping to reduce shakiness - only zoom if change is significant
        const zoomThreshold = 0.03 // 5% change threshold
        if (Math.abs(scale - 1.0) < zoomThreshold) {
          // Distance change is too small, just do pan without zoom
          const deltaX = currentCenter.x - touchStartCenter.x
          const deltaY = currentCenter.y - touchStartCenter.y

          const layer = contentLayerRef.current
          if (layer) {
            const nextPan: Point = {
              x: fin(touchStartPan.x + deltaX, safePan.x),
              y: fin(touchStartPan.y + deltaY, safePan.y),
            }
            if (!applyCssCameraTransform(nextPan, touchStartZoom)) {
              layer.x(nextPan.x)
              layer.y(nextPan.y)
              scheduleMousePanDraw()
            }
            panRef.current = nextPan
            if (!cssCameraTransformRef.current.active) scheduleCameraSync()
          }
          return
        }

        const newZoom = clamp(touchStartZoom * scale, ZOOM_MIN, ZOOM_MAX)

        // Zoom towards the INITIAL gesture center point (more natural feeling)
        // Convert initial touch center to world coordinates
        const worldPointX = (touchStartCenter.x - touchStartPan.x) / touchStartZoom
        const worldPointY = (touchStartCenter.y - touchStartPan.y) / touchStartZoom

        // Calculate new pan to keep that world point under the CURRENT gesture center
        // This allows both zooming and panning simultaneously
        const newPan = {
          x: currentCenter.x - worldPointX * newZoom,
          y: currentCenter.y - worldPointY * newZoom,
        }

        const layer = contentLayerRef.current
        if (layer) {
          const clampedZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fin(newZoom, safeZoom)))
          const clampedPan: Point = {
            x: fin(newPan.x, safePan.x),
            y: fin(newPan.y, safePan.y),
          }
          if (!applyCssCameraTransform(clampedPan, clampedZoom)) {
            layer.x(clampedPan.x)
            layer.y(clampedPan.y)
            layer.scale({
              x: clampedZoom,
              y: clampedZoom,
            })
            scheduleMousePanDraw()
          }
          panRef.current = clampedPan
          zoomRef.current = clampedZoom
          if (!cssCameraTransformRef.current.active) scheduleCameraSync()
        }
      } else if (
        rectSelectActiveRef.current &&
        selectionRectLiveRef.current &&
        e.touches.length === 1 &&
        onFindElementsInRectangle
      ) {
        // Update selection rectangle for touch-based drag-select (started via long-press on empty space)
        const touch = e.touches[0]
        if (!touch) return
        const rect = containerRef.current?.getBoundingClientRect()
        const stage = stageRef.current
        if (!rect || !stage) return
        const pointerStageX = touch.clientX - rect.left
        const pointerStageY = touch.clientY - rect.top
        const base = selectionRectLiveRef.current
        selectionRectLiveRef.current = {
          ...base,
          endX: pointerStageX,
          endY: pointerStageY,
        }
        const w = Math.abs(selectionRectLiveRef.current.endX - selectionRectLiveRef.current.startX)
        const h = Math.abs(selectionRectLiveRef.current.endY - selectionRectLiveRef.current.startY)
        if (w > 5 || h > 5) {
          dragOccurredRef.current = true
        }
        scheduleSelectionDragFrame()
      } else if (
        enableSingleFingerPan &&
        e.touches.length === 1 &&
        (touchPanStartRef.current ?? touchPanStart) &&
        (touchPanInitialCanvasPanRef.current ?? touchPanInitialCanvasPan) &&
        !touchStartedOnDraggableRef.current &&
        !shouldLongPressBlockSingleFingerPan()
      ) {
        // Single-finger touch - check if it's a drag (moved beyond threshold). Skip when touch started on a draggable (e.g. panel module).
        const touch = e.touches[0]
        if (!touch) return

        const panStart = touchPanStartRef.current ?? touchPanStart
        const initialPan = touchPanInitialCanvasPanRef.current ?? touchPanInitialCanvasPan
        if (!panStart || !initialPan) return
        const dx = touch.clientX - panStart.x
        const dy = touch.clientY - panStart.y
        const tapDistance = Math.sqrt(dx * dx + dy * dy)

        // Threshold for distinguishing tap from drag (10px)
        const dragThreshold = 10

        if (tapDistance > dragThreshold) {
          // This is a drag, not a tap
          e.preventDefault()
          e.stopPropagation()

          if (!dragOccurredRef.current) {
            dragOccurredRef.current = true
            if (stageRef.current) {
              stageRef.current.listening(false)
            }
          }
          const layer = contentLayerRef.current
          if (
            shouldActivateSingleFingerPan(
              tapDistance,
              dragThreshold,
              touchSingleFingerPanActiveRef.current
            )
          ) {
            touchSingleFingerPanActiveRef.current = true
            if (layer) {
              beginCssCameraTransform(initialPan, layer.scaleX() || safeZoom)
            }
          }

          // Move the existing canvas bitmap via the compositor. The Konva camera is
          // committed once on touch end instead of redrawing the scene every move.
          if (layer) {
            const nextPan: Point = {
              x: fin(initialPan.x + dx, safePan.x),
              y: fin(initialPan.y + dy, safePan.y),
            }
            if (!applyCssCameraTransform(nextPan, layer.scaleX() || safeZoom)) {
              layer.x(nextPan.x)
              layer.y(nextPan.y)
              scheduleMousePanDraw()
            }
            panRef.current = nextPan
            if (!cssCameraTransformRef.current.active) scheduleCameraSync()
          }
          debugTouchLog('handleTouchMove single-finger pan', {
            dx,
            dy,
            distance: tapDistance,
          })
        }
      }
    },
    [
      touchStartDistance,
      touchStartZoom,
      touchStartPan,
      touchStartCenter,
      touchPanStart,
      touchPanInitialCanvasPan,
      getTouchDistance,
      getTouchCenter,
      getTouchCentroid,
      activateLongPressReady,
      maybeCancelLongPressForMovement,
      safePan,
      safeZoom,
      enableSingleFingerPan,
      setCameraGestureHitTestingDisabled,
      scheduleCameraSync,
      scheduleSelectionDragFrame,
      scheduleMousePanDraw,
      fin,
      onFindElementsInRectangle,
      applyCssCameraTransform,
      beginCssCameraTransform,
      shouldLongPressBlockSingleFingerPan,
    ]
  )

  // Handle touch end
  const handleTouchEnd = useCallback(
    (e?: React.TouchEvent<HTMLDivElement> | TouchEvent) => {
      suppressSyntheticMouseAfterTouch()
      debugTouchLog('handleTouchEnd start', {
        hasEvent: !!e,
        changedTouches: e?.changedTouches.length,
        touches: e?.touches.length,
        dragOccurred,
        touchHasMoved,
        dragOccurredRef: dragOccurredRef.current,
        longPressPhase: longPress.current.phase,
        longPressScreenPos: longPress.current.screenPos,
        longPressElementId: longPress.current.elementId,
        longPressElementType: longPress.current.elementType,
        longPressElapsedMs: longPress.current.startedAt
          ? Math.round(performance.now() - longPress.current.startedAt)
          : null,
        hasLongPressDelayTimer: longPress.current.delayTimer != null,
        hasLongPressReadyTimer: longPress.current.readyTimer != null,
        isSelecting,
        hasSelectionRect: !!selectionRect,
      })
      // 3/4-finger swipe: resolve direction and notify (touches may be empty here)
      const mf = multiFingerSwipeRef.current
      if (mf?.active && onMultiFingerSwipe) {
        const dx = mf.lastCenter.x - mf.startCenter.x
        const dy = mf.lastCenter.y - mf.startCenter.y
        const adx = Math.abs(dx)
        const ady = Math.abs(dy)
        if (adx >= MULTI_FINGER_SWIPE_THRESHOLD || ady >= MULTI_FINGER_SWIPE_THRESHOLD) {
          const direction: 'left' | 'right' | 'up' | 'down' =
            adx >= ady ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
          onMultiFingerSwipe(direction, mf.fingerCount, mf.startCenter.x)
        }
      }
      if (mf?.active) {
        multiFingerSwipeRef.current = null
        ignoreNextTapClearRef.current = true
      }
      if (touchPanWindowCleanupRef.current) {
        touchPanWindowCleanupRef.current()
        touchPanWindowCleanupRef.current = null
      }

      if (cameraGestureActiveRef.current) {
        cancelPendingTouchSelectionClear()
        ignoreNextTapClearRef.current = true
        cancelLongPress()
        touchStartedOnDraggableRef.current = false
        touchStartElementIdRef.current = null
        touchStartedOnContentRef.current = false
        if (cameraSyncTimeoutRef.current != null) {
          clearTimeout(cameraSyncTimeoutRef.current)
          cameraSyncTimeoutRef.current = null
        }
        finishCssCameraTransform(true)
        pushLiveCameraToStore(true)
        setTouchStartDistance(null)
        setTouchStartCenter(null)
        setTouchPanStart(null)
        setTouchPanInitialCanvasPan(null)
        touchPanStartRef.current = null
        touchPanInitialCanvasPanRef.current = null
        setTouchHasMoved(false)
        setDragOccurred(false)
        dragOccurredRef.current = false
        touchSingleFingerPanActiveRef.current = false
        setTouchFingerPanForUI(false)
        setTimeout(() => {
          setCameraGestureHitTestingDisabled(false)
        }, 50)
        debugTouchLog('handleTouchEnd early return: cameraGestureActive')
        return
      }

      if (
        longPress.current.action === 'duplicate-drag' &&
        longPress.current.phase === 'ready'
      ) {
        debugTouchLog('handleTouchEnd long-press duplicate-drag complete')
        cancelLongPress()
        cancelPendingTouchSelectionClear()
        touchStartedOnDraggableRef.current = false
        touchStartElementIdRef.current = null
        touchStartedOnContentRef.current = false
        setTouchStartDistance(null)
        setTouchStartCenter(null)
        setTouchPanStart(null)
        setTouchPanInitialCanvasPan(null)
        touchPanStartRef.current = null
        touchPanInitialCanvasPanRef.current = null
        setTouchHasMoved(false)
        return
      }

      // Long-press behavior: if the ring filled completely on an element, toggle selection for that element.
      // Empty-space long-press starts drag-rect in the ready timer and is finalized by the generic drag-rect branch below.
      if (
        enableLongPressContextMenu &&
        longPress.current.phase === 'ready' &&
        longPress.current.action !== 'drag-select' &&
        longPress.current.screenPos &&
        longPress.current.elementId &&
        longPress.current.elementType
      ) {
        const elementId = longPress.current.elementId
        const elementType = longPress.current.elementType

        // Toggle element in selection
        const currentSel = useUIStore.getState().selection
        const isSameType = currentSel.type === elementType
        const alreadySelected = isSameType && currentSel.ids.includes(elementId)

        if (alreadySelected) {
          const remainingIds = currentSel.ids.filter((id) => id !== elementId)
          if (remainingIds.length === 0) {
            useUIStore.getState().clearSelection()
          } else {
            setSelection({ ...currentSel, ids: remainingIds })
          }
        } else {
          const nextIds = isSameType ? [...currentSel.ids, elementId] : [elementId]
          setSelection(selectMultiple(elementType, nextIds))
        }
        debugTouchLog('handleTouchEnd long-press toggle selection', {
          elementId,
          elementType,
          selectionBefore: currentSel,
          selectionAfter: useUIStore.getState().selection,
        })

        // Suppress the synthetic element tap/click that Konva emits after touchend,
        // so it doesn't immediately overwrite this long-press-driven selection.
        ;(window as WindowWithEendraTapSuppression).__eendraSuppressNextElementTap = true

        cancelLongPress()
        cancelPendingTouchSelectionClear()
        touchStartedOnDraggableRef.current = false
        touchStartElementIdRef.current = null
        touchStartedOnContentRef.current = false

        setTouchStartDistance(null)
        setTouchStartCenter(null)
        setTouchPanStart(null)
        setTouchPanInitialCanvasPan(null)
        touchPanStartRef.current = null
        touchPanInitialCanvasPanRef.current = null
        setTouchHasMoved(false)
        return
      }
      cancelLongPress()
      touchStartedOnDraggableRef.current = false
      const touchStartElementId = touchStartElementIdRef.current
      const touchStartedOnContent = touchStartedOnContentRef.current
      touchStartElementIdRef.current = null
      touchStartedOnContentRef.current = false

      if (touchSingleFingerPanActiveRef.current) {
        touchSingleFingerPanActiveRef.current = false
        if (cameraSyncTimeoutRef.current != null) {
          clearTimeout(cameraSyncTimeoutRef.current)
          cameraSyncTimeoutRef.current = null
        }
        finishCssCameraTransform(true)
        pushLiveCameraToStore(true)
      }

      setTouchStartDistance(null)
      setTouchStartCenter(null)
      setTouchPanStart(null)
      setTouchPanInitialCanvasPan(null)
      touchPanStartRef.current = null
      touchPanInitialCanvasPanRef.current = null

      // If a touch-based drag-rect is active, finalize selection using the existing mouse-up logic.
      if (
        rectSelectActiveRef.current &&
        (selectionRectLiveRef.current ?? selectionRect) &&
        onFindElementsInRectangle
      ) {
        debugTouchLog('handleTouchEnd finalize drag-rect selection', {
          selectionRect: selectionRectLiveRef.current ?? selectionRect,
        })
        cancelPendingTouchSelectionClear()
        dragOccurredRef.current = true
        handleMouseUp()
        return
      }

      const gestureWasDragOrPan =
        dragOccurred || touchHasMoved || dragOccurredRef.current

      if (gestureWasDragOrPan) {
        // Drag or pan consumed this gesture – don't treat as tap/double-tap.
        setTimeout(() => {
          setDragOccurred(false)
          setTouchHasMoved(false)
          dragOccurredRef.current = false
          if (stageRef.current) {
            stageRef.current.listening(true)
          }
        }, 100)
      } else {
        setTouchHasMoved(false)

        // Double-tap / single-tap detection (only when gesture was not a drag/pan/long-press).
        if (e?.changedTouches && e.changedTouches.length === 1 && !cameraGestureActiveRef.current) {
          const t = e.changedTouches[0]
          if (t) {
            const touchTimeStamp =
              typeof e.timeStamp === 'number' && Number.isFinite(e.timeStamp) ? e.timeStamp : 0
            const prevProcessedTouchEnd = lastProcessedTouchEndRef.current
            const isDuplicateTouchEnd =
              !!prevProcessedTouchEnd &&
              prevProcessedTouchEnd.identifier === t.identifier &&
              Math.abs(prevProcessedTouchEnd.timeStamp - touchTimeStamp) < 1 &&
              prevProcessedTouchEnd.clientX === t.clientX &&
              prevProcessedTouchEnd.clientY === t.clientY

            if (isDuplicateTouchEnd) {
              debugTouchLog('handleTouchEnd ignored duplicate touchend', {
                identifier: t.identifier,
                clientX: t.clientX,
                clientY: t.clientY,
                timeStamp: touchTimeStamp,
              })
              return
            }

            lastProcessedTouchEndRef.current = {
              identifier: t.identifier,
              clientX: t.clientX,
              clientY: t.clientY,
              timeStamp: touchTimeStamp,
            }
            // Konva can emit a synthetic stage tap after touchend on empty space.
            // For touch, selection clearing is handled here so the stage tap does not
            // run a second clear after the touch gesture has already been classified.
            ignoreNextTapClearRef.current = true

            const endClient = { x: t.clientX, y: t.clientY }
            const now = performance.now()
            const prev = lastTapRef.current
            const elementId =
              getElementIdAtClientPoint(endClient.x, endClient.y) ?? touchStartElementId

            const isDoubleTap =
              !!prev &&
              now - prev.time <= DOUBLE_TAP_MS &&
              prev.elementId === elementId &&
              Math.hypot(endClient.x - prev.clientX, endClient.y - prev.clientY) <= DOUBLE_TAP_SLOP_PX

            debugTouchLog('handleTouchEnd tap evaluation', {
              endClient,
              now,
              prev,
              dt: prev ? now - prev.time : null,
              isDoubleTap,
            })

            if (isDoubleTap) {
              lastTapRef.current = null
              cancelPendingTouchSelectionClear()
              ;(window as WindowWithEendraTapSuppression).__eendraSuppressNextElementTap = true
              const opened = openContextMenuAtClientPoint(endClient.x, endClient.y)
              if (opened) {
                ignoreNextTapClearRef.current = true
                debugTouchLog('handleTouchEnd double-tap -> menu opened')
              } else {
                debugTouchLog('handleTouchEnd double-tap but no menu items')
              }
            } else {
              if (elementId == null && !touchStartedOnContent) {
                schedulePendingTouchSelectionClear()
              } else {
                cancelPendingTouchSelectionClear()
              }
              lastTapRef.current = {
                time: now,
                clientX: endClient.x,
                clientY: endClient.y,
                elementId,
              }
              debugTouchLog('handleTouchEnd stored single tap', {
                tap: lastTapRef.current,
              })
            }
          }
        }
      }
    },
    [
      dragOccurred,
      touchHasMoved,
      cancelLongPress,
      cancelPendingTouchSelectionClear,
      enableLongPressContextMenu,
      getElementIdAtClientPoint,
      onMultiFingerSwipe,
      openContextMenuAtClientPoint,
      setSelection,
      setCameraGestureHitTestingDisabled,
      isSelecting,
      selectionRect,
      onFindElementsInRectangle,
      handleMouseUp,
      pushLiveCameraToStore,
      schedulePendingTouchSelectionClear,
      suppressSyntheticMouseAfterTouch,
      finishCssCameraTransform,
    ]
  )

  useEffect(() => {
    handleTouchMoveRef.current = handleTouchMove
  }, [handleTouchMove])
  useEffect(() => {
    handleTouchEndRef.current = handleTouchEnd
  }, [handleTouchEnd])

  // Handle touch drag from symbol library (custom events)
  useEffect(() => {
    const handleTouchDragMove = (e: Event) => {
      const customEvent = e as CustomEvent<{ symbol: unknown; x: number; y: number }>
      if (!containerRef.current || !onDragOver) return

      const rect = containerRef.current.getBoundingClientRect()
      const x = customEvent.detail.x - rect.left
      const y = customEvent.detail.y - rect.top
      const { pan: livePan, zoom: liveZoom } = getLiveViewTransform()
      const canvasX = (x - livePan.x) / liveZoom
      const canvasY = (y - livePan.y) / liveZoom

      onDragOver({ x: canvasX, y: canvasY }, customEvent.detail.symbol)
    }

    const handleTouchDragEnd = (e: Event) => {
      const customEvent = e as CustomEvent<{ symbol: unknown; x: number; y: number }>
      if (!containerRef.current || !onDrop) return

      const rect = containerRef.current.getBoundingClientRect()
      const x = customEvent.detail.x - rect.left
      const y = customEvent.detail.y - rect.top

      // Check if drop is within canvas bounds
      if (x >= 0 && x <= rect.width && y >= 0 && y <= rect.height) {
        const { pan: livePan, zoom: liveZoom } = getLiveViewTransform()
        const canvasX = (x - livePan.x) / liveZoom
        const canvasY = (y - livePan.y) / liveZoom

        onDrop({ x: canvasX, y: canvasY }, customEvent.detail.symbol, {
          clientX: customEvent.detail.x,
          clientY: customEvent.detail.y,
        })
      }

      // Clear preview
      if (onDragOver) {
        onDragOver({ x: -Infinity, y: -Infinity }, null)
      }
    }

    window.addEventListener('touchdragmove', handleTouchDragMove)
    window.addEventListener('touchdragend', handleTouchDragEnd)

    return () => {
      window.removeEventListener('touchdragmove', handleTouchDragMove)
      window.removeEventListener('touchdragend', handleTouchDragEnd)
    }
  }, [onDrop, onDragOver, getLiveViewTransform])

  // Armed library symbol: hover previews through onDragOver and each left click drops a
  // copy through onDrop, exactly like a library drag. Left/right button events on the stage
  // are swallowed in the capture phase so Konva selection, marquee and element drags never
  // start. A left press that moves becomes a pan (like the middle button); a still one places.
  const armedLibraryCanvasId = useUIStore((state) => state.armedLibraryCanvasId)
  const armedCanvasInstanceId = useId()
  const armedPlacementRef = useRef({ symbol: armedLibrarySymbol, onDrop, onDragOver })
  armedPlacementRef.current = { symbol: armedLibrarySymbol, onDrop, onDragOver }
  const armedPointerClientRef = useRef<{ x: number; y: number } | null>(null)
  const beginDeferredMousePanRef = useRef(beginDeferredMousePan)
  beginDeferredMousePanRef.current = beginDeferredMousePan

  useEffect(() => {
    const container = containerRef.current
    if (!armedPlacementActive || !container) return

    let previewFrame: number | null = null
    let swallowPointerSequence = false
    let pendingRightClickDisarm = false
    let leftPress: { x: number; y: number } | null = null

    const getStageContainer = () => stageRef.current?.container() ?? null
    const isOnStage = (target: EventTarget | null) => {
      const stageContainer = getStageContainer()
      return !!stageContainer && target instanceof Node && stageContainer.contains(target)
    }
    const toCanvasPoint = (clientX: number, clientY: number): Point => {
      const rect = container.getBoundingClientRect()
      const { pan: livePan, zoom: liveZoom } = getLiveViewTransform()
      return {
        x: (clientX - rect.left - livePan.x) / liveZoom,
        y: (clientY - rect.top - livePan.y) / liveZoom,
      }
    }
    const clearPreview = () => {
      armedPlacementRef.current.onDragOver?.({ x: -Infinity, y: -Infinity }, null)
    }
    const renderPreview = () => {
      previewFrame = null
      const client = armedPointerClientRef.current
      const { symbol, onDragOver: preview } = armedPlacementRef.current
      if (!client || !symbol || !preview) return
      preview(toCanvasPoint(client.x, client.y), symbol)
    }
    const schedulePreview = () => {
      if (previewFrame == null) previewFrame = requestAnimationFrame(renderPreview)
    }

    const hidePreview = () => {
      if (previewFrame != null) {
        cancelAnimationFrame(previewFrame)
        previewFrame = null
      }
      if (armedPointerClientRef.current) {
        armedPointerClientRef.current = null
        clearPreview()
      }
    }
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      // A held button means a pan is running: drop-target previews are expensive on the
      // one-wire and panel canvases, so hide the ghost until the button is released.
      if (event.buttons !== 0 || !isOnStage(event.target)) {
        hidePreview()
        return
      }
      armedPointerClientRef.current = { x: event.clientX, y: event.clientY }
      const stageContainer = getStageContainer()
      if (stageContainer) stageContainer.style.cursor = 'crosshair'
      const ui = useUIStore.getState()
      if (ui.armedLibraryCanvasId !== armedCanvasInstanceId) {
        ui.setArmedLibraryCanvasId(armedCanvasInstanceId)
      }
      schedulePreview()
      // Keep Konva hover effects quiet while armed.
      event.stopPropagation()
    }
    const handleMouseMove = (event: MouseEvent) => {
      if (event.buttons === 0 && isOnStage(event.target)) event.stopPropagation()
    }
    const handlePointerLeave = () => {
      armedPointerClientRef.current = null
      clearPreview()
    }
    const handlePointerDown = (event: PointerEvent) => {
      // A pan can end off-canvas without a click; never let that sequence swallow later UI clicks.
      swallowPointerSequence = false
      leftPress = null
      if (event.pointerType === 'touch' || !isOnStage(event.target)) return
      if (event.button !== 0 && event.button !== 2) return
      event.stopPropagation()
      swallowPointerSequence = true
      if (event.button === 2) {
        event.preventDefault()
        // Disarm once the menu event is swallowed; on platforms that fire contextmenu
        // after pointerup (Windows), the stage's own suppression flag catches it instead.
        pendingRightClickDisarm = true
        suppressNextContextMenuRef.current = true
        return
      }
      // Not preventDefault: the deferred pan listens to the compatibility mouse events.
      // Button 1 semantics: a press that never moves must not clear the selection.
      leftPress = { x: event.clientX, y: event.clientY }
      beginDeferredMousePanRef.current(event.clientX, event.clientY, 1)
    }
    const placeAt = (clientX: number, clientY: number) => {
      const { symbol, onDrop: drop } = armedPlacementRef.current
      if (!symbol || !drop) return
      armedPointerClientRef.current = { x: clientX, y: clientY }
      drop(toCanvasPoint(clientX, clientY), symbol, { clientX, clientY })
      useUIStore.getState().noteArmedPlacement()
      // Drops clear the canvas preview; bring the ghost back for the next placement.
      schedulePreview()
    }
    const handleLeftPointerUp = (event: PointerEvent) => {
      if (event.button !== 0 || !leftPress) return
      const press = leftPress
      leftPress = null
      const moved =
        Math.abs(event.clientX - press.x) > DEFERRED_MOUSE_PAN_THRESHOLD_PX ||
        Math.abs(event.clientY - press.y) > DEFERRED_MOUSE_PAN_THRESHOLD_PX
      if (!moved) placeAt(press.x, press.y)
    }
    const disarm = () => {
      pendingRightClickDisarm = false
      useUIStore.getState().setArmedLibrarySymbol(null)
    }
    const swallowButtonEvent = (event: MouseEvent) => {
      if (event.button !== 0 && event.button !== 2) return
      if (!swallowPointerSequence && !isOnStage(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.type === 'click' || event.type === 'contextmenu') swallowPointerSequence = false
      if (event.type === 'contextmenu' && pendingRightClickDisarm) {
        suppressNextContextMenuRef.current = false
        disarm()
      } else if (event.type === 'pointerup' && event.button === 0) {
        handleLeftPointerUp(event as PointerEvent)
      } else if (event.type === 'pointerup' && pendingRightClickDisarm) {
        window.setTimeout(() => {
          if (pendingRightClickDisarm) disarm()
        }, 0)
      }
    }
    const handleWheel = () => {
      if (armedPointerClientRef.current) schedulePreview()
    }

    const captureOptions = { capture: true }
    const passiveCaptureOptions = { capture: true, passive: true }
    container.addEventListener('pointermove', handlePointerMove, captureOptions)
    container.addEventListener('mousemove', handleMouseMove, captureOptions)
    container.addEventListener('pointerleave', handlePointerLeave)
    container.addEventListener('pointerdown', handlePointerDown, captureOptions)
    container.addEventListener('mousedown', swallowButtonEvent, captureOptions)
    container.addEventListener('pointerup', swallowButtonEvent, captureOptions)
    container.addEventListener('mouseup', swallowButtonEvent, captureOptions)
    container.addEventListener('click', swallowButtonEvent, captureOptions)
    container.addEventListener('dblclick', swallowButtonEvent, captureOptions)
    container.addEventListener('contextmenu', swallowButtonEvent, captureOptions)
    container.addEventListener('wheel', handleWheel, passiveCaptureOptions)

    // A canvas remount while the pointer rests on it (e.g. after a drop) keeps the ghost.
    schedulePreview()

    return () => {
      if (previewFrame != null) cancelAnimationFrame(previewFrame)
      container.removeEventListener('pointermove', handlePointerMove, captureOptions)
      container.removeEventListener('mousemove', handleMouseMove, captureOptions)
      container.removeEventListener('pointerleave', handlePointerLeave)
      container.removeEventListener('pointerdown', handlePointerDown, captureOptions)
      container.removeEventListener('mousedown', swallowButtonEvent, captureOptions)
      container.removeEventListener('pointerup', swallowButtonEvent, captureOptions)
      container.removeEventListener('mouseup', swallowButtonEvent, captureOptions)
      container.removeEventListener('click', swallowButtonEvent, captureOptions)
      container.removeEventListener('dblclick', swallowButtonEvent, captureOptions)
      container.removeEventListener('contextmenu', swallowButtonEvent, captureOptions)
      container.removeEventListener('wheel', handleWheel, passiveCaptureOptions)
      const stageContainer = getStageContainer()
      if (stageContainer) updateCanvasCursorRef.current()
    }
  }, [armedPlacementActive, armedCanvasInstanceId, getLiveViewTransform])

  // Disarming (Esc, right click, another tool) removes the ghost from this canvas.
  useEffect(() => {
    if (armedPlacementActive) return
    if (!armedPointerClientRef.current) return
    armedPointerClientRef.current = null
    onDragOver?.({ x: -Infinity, y: -Infinity }, null)
  }, [armedPlacementActive, onDragOver])

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
        cancelAnimationFrame(selectionDragRafRef.current)
        selectionDragRafRef.current = null
      }
    }
  }, [stopLongPressTouchWatch, finishCssCameraTransform])

  // Generate grid lines
  const generateGrid = useCallback(() => {
    if (!showGrid) return []
    if (safeZoom < GRID_HIDE_ZOOM_BELOW) return []

    // Interpret gridOpacity as a theme-aware intensity parameter rather than real alpha.
    // Clamp to 0–0.75 in practice; 0.75 is treated as “full strength” in the UI.
    const clamped = clamp(gridOpacity, 0, 0.75)
    const t = clamped <= 0 ? 0 : clamped / 0.75 // 0–1

    // Lerp grid stroke between background and theme grid color.
    // At low intensity it's close to background; at high intensity it's close to colors.grid.
    const lerpColor = (a: string, b: string, amount: number): string => {
      const parse = (hex: string) => {
        const m = hex.trim().match(/^#?([0-9a-f]{6})$/i)
        if (!m) return [0, 0, 0] as const
        const int = parseInt(m[1]!, 16)
        return [(int >> 16) & 255, (int >> 8) & 255, int & 255] as const
      }
      const [r1, g1, b1] = parse(a)
      const [r2, g2, b2] = parse(b)
      const mix = (c1: number, c2: number) => Math.round(c1 + (c2 - c1) * amount)
      const r = mix(r1, r2)
      const g = mix(g1, g2)
      const blue = mix(b1, b2)
      return `rgb(${r}, ${g}, ${blue})`
    }

    const strokeColor = lerpColor(actualBackgroundColor, gridColor, 0.3 + 0.7 * t)

    const lines: React.JSX.Element[] = []

    if (gridInTransformedLayer) {
      // Grid moves with canvas (for Plan canvas)
      // Calculate visible area in world coordinates (use safe values to avoid NaN on Safari)
      const worldLeft = -safePan.x / safeZoom
      const worldTop = -safePan.y / safeZoom
      const worldRight = (size.width - safePan.x) / safeZoom
      const worldBottom = (size.height - safePan.y) / safeZoom

      // Keep the visible grid from collapsing into blurry overdraw when zoomed out.
      // When a cell gets too small in screen-space, draw every 2nd/4th/... line.
      const screenCellSizePx = gridSize * safeZoom
      if (screenCellSizePx < GRID_MIN_CELL_SCREEN_PX / 64) {
        return []
      }
      const minVisibleCellPx = GRID_MIN_CELL_SCREEN_PX
      const lodFactor =
        screenCellSizePx >= minVisibleCellPx
          ? 1
          : Math.pow(2, Math.ceil(Math.log2(minVisibleCellPx / Math.max(screenCellSizePx, 0.0001))))
      const effectiveGridSize = gridSize * lodFactor

      // Add modest overscan for panning without drawing multiple hidden viewports during resize.
      const padding = Math.min(240, Math.max(size.width, size.height) * 0.25) / safeZoom
      const startX = Math.floor((worldLeft - padding) / effectiveGridSize) * effectiveGridSize
      const endX = Math.ceil((worldRight + padding) / effectiveGridSize) * effectiveGridSize
      const startY = Math.floor((worldTop - padding) / effectiveGridSize) * effectiveGridSize
      const endY = Math.ceil((worldBottom + padding) / effectiveGridSize) * effectiveGridSize
      const verticalLineCount = Math.floor((endX - startX) / effectiveGridSize) + 1
      const horizontalLineCount = Math.floor((endY - startY) / effectiveGridSize) + 1
      if (verticalLineCount + horizontalLineCount > 700) return []

      // Vertical lines
      for (let x = startX; x <= endX; x += effectiveGridSize) {
        lines.push(
          <Line
            key={`v-${x}`}
            points={[x, startY, x, endY]}
            stroke={strokeColor}
            strokeWidth={1}
            strokeScaleEnabled={false}
            opacity={1}
            listening={false}
          />
        )
      }

      // Horizontal lines
      for (let y = startY; y <= endY; y += effectiveGridSize) {
        lines.push(
          <Line
            key={`h-${y}`}
            points={[startX, y, endX, y]}
            stroke={strokeColor}
            strokeWidth={1}
            strokeScaleEnabled={false}
            opacity={1}
            listening={false}
          />
        )
      }
    } else {
      // Static grid in background layer (for Eendraad - very faint or disabled)
      const padding = 1000
      const startX = Math.floor((-safePan.x - padding) / (gridSize * safeZoom)) * gridSize
      const endX = Math.ceil((size.width - safePan.x + padding) / (gridSize * safeZoom)) * gridSize
      const startY = Math.floor((-safePan.y - padding) / (gridSize * safeZoom)) * gridSize
      const endY = Math.ceil((size.height - safePan.y + padding) / (gridSize * safeZoom)) * gridSize

      // Vertical lines
      for (let x = startX; x <= endX; x += gridSize) {
        lines.push(
          <Line
            key={`v-${x}`}
            points={[x, startY, x, endY]}
            stroke={strokeColor}
            strokeWidth={1 / safeZoom}
            opacity={1}
            listening={false}
          />
        )
      }

      // Horizontal lines
      for (let y = startY; y <= endY; y += gridSize) {
        lines.push(
          <Line
            key={`h-${y}`}
            points={[startX, y, endX, y]}
            stroke={strokeColor}
            strokeWidth={1 / safeZoom}
            opacity={1}
            listening={false}
          />
        )
      }
    }

    return lines
  }, [
    showGrid,
    gridSize,
    safeZoom,
    safePan,
    size,
    gridColor,
    actualBackgroundColor,
    gridInTransformedLayer,
    gridOpacity,
  ])

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
          const { selection } = useUIStore.getState()

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
        {!gridInTransformedLayer && <Layer>{generateGrid()}</Layer>}

        {/* Main content layer */}
        <Layer
          ref={contentLayerRef}
          x={safePan.x}
          y={safePan.y}
          scaleX={safeZoom}
          scaleY={safeZoom}
          // Touch pan can otherwise hit-test under the finger on every move.
          // Mouse-button pan uses window capture listeners, so avoid toggling
          // the dense content hit graph at gesture start.
          listening={!touchFingerPanForUI}
          hitGraphEnabled={!disableContentHitGraph}
        >
          {/* Grid in transformed layer (Plan canvas) */}
          {gridInTransformedLayer && generateGrid()}
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
          <div
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
