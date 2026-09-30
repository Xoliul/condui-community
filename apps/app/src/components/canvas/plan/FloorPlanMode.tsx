import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Group, Line, Rect, Circle, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { snapToGrid } from '@/utils/plan/gridSnap'
import {
  handleDrawWall,
  handleDrawWallRect,
  handleInsertDoor,
  handleInsertWindow,
  validateOpeningPlacement,
  resolveWindowInsertWidthPx,
  computeOpeningGeometry,
} from '@/handlers/plan/wallDrawing'
import {
  openingWallNormalDeadzoneCanvas,
  resolveDoorPlacementOrientation,
} from '@/lib/plan/doorSwingFromPointer'
import {
  computeOpeningDragPlacement,
  fitOpeningPlacementForPreview,
  openingWidthCentimeters,
  snapOpeningWidthToWholeCentimeters,
} from '@/lib/plan/openingPlacementDrag'
import type { ToolMode } from '../../plan/PlanImageTools'
import type { Floor, Point2, Wall, Stair } from '@/types/schema'
import {
  createQuarterCircleWallCurve,
  getCurvedWallToolHoverFeedback,
  getCurveRenderMaxSegmentLength,
  getWallPathPoints,
  isCurvedWall,
} from '@/lib/plan/wallCurve'
import type { PlanView } from '@/stores/uiStore'
import { readLegacyCompatibilityFloors } from '@/lib/projectV2/buildingFloors'
import { resolvePlanCanvasPxPerMeter } from '@/hooks/plan'
import { useCanvasFontFamily, useSetSelectionStore } from '@/editions/community/communityHooks'
import {
  DRAW_TOOL_DASH_PX,
  DRAW_TOOL_PROJECTION_SNAP_ZONE_PX,
  DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MAX,
  DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MIN,
  DRAW_TOOL_LINE_SNAP_ZONE_PX,
  DRAW_TOOL_LINE_SNAP_ZONE_PX_MAX,
  DRAW_TOOL_LINE_SNAP_ZONE_PX_MIN,
  OPENING_SPAN_CENTER_SNAP_ZONE_PX,
  OPENING_SPAN_CENTER_SNAP_ZONE_PX_MAX,
  OPENING_SPAN_CENTER_SNAP_ZONE_PX_MIN,
  DRAW_TOOL_HANDLE_RADIUS_PX,
  DRAW_TOOL_HANDLE_RADIUS_PX_MAX,
  DRAW_TOOL_HANDLE_RADIUS_PX_MIN,
  DRAW_TOOL_POINT_RADIUS_PX,
  DRAW_TOOL_POINT_RADIUS_PX_MAX,
  DRAW_TOOL_POINT_RADIUS_PX_MIN,
  DRAW_TOOL_STROKE_PX,
  DRAW_TOOL_STROKE_PX_MAX,
  DRAW_TOOL_STROKE_PX_MIN,
  screenPxToCanvasUnits,
} from '@/constants/canvasConstants'
import { resolveOpeningPositionSnap } from '@/lib/plan/openingPositionSnap'
import {
  PLAN_STAIR_DEFAULT_STEP_DEPTH_CM,
  PLAN_STAIR_SPIRAL_POLE_DIAMETER_CM,
  PLAN_STAIR_DEFAULT_WIDTH_CM,
} from '@/constants/planConstants'
import { buildStairGeometry } from '@/components/canvas/plan/StairRenderer'
import { getStairRenderMetrics } from '@/lib/plan/stairPlanScale'
import { PlanGraphicElementShape } from '@/components/canvas/plan/PlanGraphicElementRenderer'
import { planFloorDrawingConsumesTabRef } from '@/lib/plan/planFloorDrawingKeyboardGate'
import { resolveFloorPlanToolContextMenuAction } from '@/lib/plan/floorPlanToolContextMenu'
import {
  snapNearbyLineToGrid,
  snapPointToNearbyLine,
  type LineSnapSegment,
} from '@/lib/plan/lineSnap'
import {
  cloneFloorPlanDrawingSnapshot,
  isFloorPlanDrawingInProgress,
  MAX_FLOOR_PLAN_DRAWING_UNDO_ENTRIES,
  planFloorDrawingUndoRef,
  type FloorPlanDrawingUndoSnapshot,
} from '@/lib/plan/planFloorDrawingUndo'
import {
  createPlanGraphicElementDraft,
  getPlanGraphicElementAsset,
} from '@/lib/plan/graphicElements'
import {
  clearFloorPlanDrawDimensionEditor,
  setFloorPlanDrawDimensionEditor,
  type FloorPlanDrawDimensionEditor,
} from './floorPlanDrawDimensionEditorStore'

/** Second pointer-down / click inside this window and distance is treated as double-click. */
const FLOOR_PLAN_DRAW_DOUBLE_CLICK_MS = 400
const FLOOR_PLAN_DRAW_DOUBLE_CLICK_DISTANCE_PX = 8

type FloorPlanInputEvent = KonvaEventObject<MouseEvent | TouchEvent | PointerEvent | DragEvent>

interface FloorPlanModeProps {
  activeFloorId: string | null
  activeFloor: Floor | null | undefined
  currentProject: ProjectState['currentProject']
  planView: PlanView
  gridSize: number
  /** While redefining floor scale, matches the temporary grid px-per-meter from PlanCanvas. */
  tempPxPerMeter?: number | null
  /** Base floor scale px-per-meter used by wall/opening preview in PlanCanvas. */
  previewPxPerMeter?: number | null
  activeTool: ToolMode
  setActiveTool: (tool: ToolMode) => void
  onExitDrawMode: () => void
  selectedGraphicAssetId: string
  /** Report wall under cursor for hover highlight/trim preview; geometry is rendered by PlanCanvas. */
  onWallHover?: (wallId: string | null, pointer: Point2 | null) => void
  /** Report projected snap guides so parent can render them in a top overlay layer. */
  onProjectedSnapGuidesChange?: (
    guides: Array<{ from: Point2; to: Point2; hideDistanceLabel?: boolean }>
  ) => void
  /** Notifies parent when a door/window placement is successfully inserted. */
  onOpeningInserted?: (kind: 'door' | 'window') => void
  /** Overrides the parent ghost opening preview while drag-sizing insertion. */
  onOpeningPreviewOverrideChange?: (
    preview: {
      wallId: string
      position: number
      width: number
      kind: 'door' | 'window'
      valid: boolean
      doorSwing?: 'left' | 'right'
      doorDirection?: 'in' | 'out'
    } | null
  ) => void
}

/**
 * Floor Plan Drawing Mode Component
 * Handles all floor plan drawing functionality (walls, doors, windows)
 */
export function FloorPlanMode({
  activeFloorId,
  activeFloor,
  currentProject,
  planView,
  gridSize,
  tempPxPerMeter = null,
  previewPxPerMeter = null,
  activeTool,
  setActiveTool,
  onExitDrawMode,
  selectedGraphicAssetId,
  onWallHover,
  onProjectedSnapGuidesChange,
  onOpeningInserted,
  onOpeningPreviewOverrideChange,
}: FloorPlanModeProps) {
  const selection = useUIStore((s) => s.selection)
  const setSelection = useSetSelectionStore()
  const getWallsByFloor = useProjectStore((s: ProjectState) => s.getWallsByFloor)
  const addWall = useProjectStore((s: ProjectState) => s.addWall)
  const wallDrawingThicknessCm = useUIStore((s) => s.planWallDrawingThicknessCm)
  const addDoor = useProjectStore((s: ProjectState) => s.addDoor)
  const addWindow = useProjectStore((s: ProjectState) => s.addWindow)
  const addStair = useProjectStore((s: ProjectState) => s.addStair)
  const addPlanGraphicElement = useProjectStore((s: ProjectState) => s.addPlanGraphicElement)
  const withSingleUndoEntry = useProjectStore((s: ProjectState) => s.withSingleUndoEntry)
  const theme = useSettingsStore((s) => s.theme)
  const canvasPxPerMeter = useMemo(
    () =>
      resolvePlanCanvasPxPerMeter(activeFloor ?? null, planView.gridSize, gridSize, tempPxPerMeter),
    [activeFloor, planView.gridSize, gridSize, tempPxPerMeter]
  )
  const fontFamily = useCanvasFontFamily()

  // Floor plan drawing state
  const [wallDrawingState, setWallDrawingState] = useState<{
    currentPoints: Point2[]
    isDrawing: boolean
    startPoint: Point2 | null
    rectStartPoint: Point2 | null
    pendingCurve?: boolean
  }>({
    currentPoints: [],
    isDrawing: false,
    startPoint: null,
    rectStartPoint: null,
    pendingCurve: false,
  })
  const [currentMousePosition, setCurrentMousePosition] = useState<Point2 | null>(null)
  const [stairDrawingPoints, setStairDrawingPoints] = useState<Point2[]>([])
  const [openingPointerState, setOpeningPointerState] = useState<{
    kind: 'door' | 'window'
    wall: Wall
    anchor: Point2
    current: Point2
    dragSizingLatched: boolean
  } | null>(null)
  const [graphicPointerState, setGraphicPointerState] = useState<{
    start: Point2
    current: Point2
  } | null>(null)
  const [projectedSnapGuides, setProjectedSnapGuides] = useState<
    Array<{ from: Point2; to: Point2; hideDistanceLabel?: boolean }>
  >([])
  const [activeGeometrySnap, setActiveGeometrySnap] = useState<{
    point: Point2
    kind: 'endpoint' | 'line'
  } | null>(null)
  const previousToolRef = useRef<ToolMode>(activeTool)
  const isFinalizingPenRef = useRef(false)
  const suppressAutoCommitRef = useRef(false)
  const suppressStairAutoCommitRef = useRef(false)
  const suppressNextClickRef = useRef(false)
  const isShiftPressedRef = useRef(false)
  const penPointerDownRef = useRef<Point2 | null>(null)
  const penPointerCaptureTargetRef = useRef<HTMLElement | null>(null)
  const penPointerCaptureIdRef = useRef<number | null>(null)
  const penDidDragRef = useRef(false)
  const penCurveGestureRef = useRef(false)
  const penLastPointerDownTimeRef = useRef(0)
  const penLastPointerDownPointRef = useRef<Point2 | null>(null)
  const penDoubleClickDetectedRef = useRef(false)
  const stairLastClickTimeRef = useRef(0)
  const rectPointerDownRef = useRef<Point2 | null>(null)
  const rectDidDragRef = useRef(false)
  const stairPointerDownRef = useRef<Point2 | null>(null)
  const stairDidDragRef = useRef(false)
  const graphicDidDragRef = useRef(false)
  const draftPointDragRef = useRef<{ tool: 'drawWall' | 'drawStair'; index: number } | null>(null)
  const draftPointDidDragRef = useRef(false)
  const suppressDraftPointTapUntilRef = useRef(0)
  /** Mirrors rect pointer down so we can hide the first-corner snap dot while dragging (refs don't re-render). */
  const [rectPointerActive, setRectPointerActive] = useState(false)
  const mousePreviewPositionRef = useRef<Point2 | null>(null)
  const pendingMousePreviewPositionRef = useRef<Point2 | null>(null)
  const mousePreviewRafRef = useRef<number | null>(null)
  /** Stage-space pointer from last move; used to re-snap previews when zoom/pan changes without a move event. */
  const lastStagePointerRef = useRef<{ x: number; y: number } | null>(null)
  const didClearWallHoverRef = useRef(false)
  const doorPlacementOpenSideRef = useRef<'left' | 'right'>('right')
  const stageContainerRef = useRef<HTMLElement | null>(null)
  const penAutoLockTimeoutRef = useRef<number | null>(null)
  const rectXAutoLockTimeoutRef = useRef<number | null>(null)
  const rectYAutoLockTimeoutRef = useRef<number | null>(null)
  const [penDimensionText, setPenDimensionText] = useState('')
  const [penLockedLengthMeters, setPenLockedLengthMeters] = useState<number | null>(null)
  const [rectDimensionTextX, setRectDimensionTextX] = useState('')
  const [rectDimensionTextY, setRectDimensionTextY] = useState('')
  const [rectLockedXMeters, setRectLockedXMeters] = useState<number | null>(null)
  const [rectLockedYMeters, setRectLockedYMeters] = useState<number | null>(null)
  const [rectActiveAxis, setRectActiveAxis] = useState<'x' | 'y'>('x')

  const drawingUndoStackRef = useRef<FloorPlanDrawingUndoSnapshot[]>([])
  const drawingRedoStackRef = useRef<FloorPlanDrawingUndoSnapshot[]>([])
  const wallDrawingStateRef = useRef(wallDrawingState)
  wallDrawingStateRef.current = wallDrawingState
  const stairDrawingPointsRef = useRef(stairDrawingPoints)
  stairDrawingPointsRef.current = stairDrawingPoints

  const captureDrawingSnapshot = useCallback((): FloorPlanDrawingUndoSnapshot => {
    return cloneFloorPlanDrawingSnapshot(wallDrawingStateRef.current, stairDrawingPointsRef.current)
  }, [])

  const clearDrawingUndoStacks = useCallback(() => {
    drawingUndoStackRef.current = []
    drawingRedoStackRef.current = []
  }, [])

  const pointsAlmostEqual = useCallback((a: Point2 | null, b: Point2 | null, epsilon = 1e-4) => {
    if (!a && !b) return true
    if (!a || !b) return false
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= epsilon
  }, [])

  const scheduleMousePreviewPosition = useCallback(
    (next: Point2 | null) => {
      pendingMousePreviewPositionRef.current = next
      if (mousePreviewRafRef.current != null) return
      mousePreviewRafRef.current = requestAnimationFrame(() => {
        mousePreviewRafRef.current = null
        const pending = pendingMousePreviewPositionRef.current
        pendingMousePreviewPositionRef.current = null
        if (pointsAlmostEqual(mousePreviewPositionRef.current, pending)) return
        mousePreviewPositionRef.current = pending
        setCurrentMousePosition(pending)
      })
    },
    [pointsAlmostEqual]
  )

  const resetDrawingState = useCallback(() => {
    pendingMousePreviewPositionRef.current = null
    mousePreviewPositionRef.current = null
    setWallDrawingState({
      currentPoints: [],
      isDrawing: false,
      startPoint: null,
      rectStartPoint: null,
      pendingCurve: false,
    })
    setCurrentMousePosition(null)
    setProjectedSnapGuides([])
    setActiveGeometrySnap(null)
    if (penAutoLockTimeoutRef.current != null) {
      clearTimeout(penAutoLockTimeoutRef.current)
      penAutoLockTimeoutRef.current = null
    }
    if (rectXAutoLockTimeoutRef.current != null) {
      clearTimeout(rectXAutoLockTimeoutRef.current)
      rectXAutoLockTimeoutRef.current = null
    }
    if (rectYAutoLockTimeoutRef.current != null) {
      clearTimeout(rectYAutoLockTimeoutRef.current)
      rectYAutoLockTimeoutRef.current = null
    }
    setPenDimensionText('')
    setPenLockedLengthMeters(null)
    setRectDimensionTextX('')
    setRectDimensionTextY('')
    setRectLockedXMeters(null)
    setRectLockedYMeters(null)
    setRectActiveAxis('x')
    setRectPointerActive(false)
    setOpeningPointerState(null)
    doorPlacementOpenSideRef.current = 'right'
    setGraphicPointerState(null)
    rectPointerDownRef.current = null
    rectDidDragRef.current = false
    stairPointerDownRef.current = null
    stairDidDragRef.current = false
    graphicDidDragRef.current = false
    draftPointDragRef.current = null
    draftPointDidDragRef.current = false
    suppressDraftPointTapUntilRef.current = 0
    penLastPointerDownTimeRef.current = 0
    penLastPointerDownPointRef.current = null
    penDoubleClickDetectedRef.current = false
    lastStagePointerRef.current = null
    clearDrawingUndoStacks()
  }, [clearDrawingUndoStacks])

  const clearPenConstraints = useCallback(() => {
    if (penAutoLockTimeoutRef.current != null) {
      clearTimeout(penAutoLockTimeoutRef.current)
      penAutoLockTimeoutRef.current = null
    }
    setPenDimensionText('')
    setPenLockedLengthMeters(null)
  }, [])

  const clearRectConstraints = useCallback(() => {
    if (rectXAutoLockTimeoutRef.current != null) {
      clearTimeout(rectXAutoLockTimeoutRef.current)
      rectXAutoLockTimeoutRef.current = null
    }
    if (rectYAutoLockTimeoutRef.current != null) {
      clearTimeout(rectYAutoLockTimeoutRef.current)
      rectYAutoLockTimeoutRef.current = null
    }
    setRectDimensionTextX('')
    setRectDimensionTextY('')
    setRectLockedXMeters(null)
    setRectLockedYMeters(null)
    setRectActiveAxis('x')
  }, [])

  const applyDrawingSnapshot = useCallback(
    (snapshot: FloorPlanDrawingUndoSnapshot) => {
      setWallDrawingState({
        ...snapshot.wallDrawingState,
        currentPoints: [...snapshot.wallDrawingState.currentPoints],
      })
      setStairDrawingPoints([...snapshot.stairDrawingPoints])
      clearPenConstraints()
      clearRectConstraints()
      scheduleMousePreviewPosition(null)
      setProjectedSnapGuides([])
    },
    [clearPenConstraints, clearRectConstraints, scheduleMousePreviewPosition]
  )

  const pushDrawingUndoBeforeMutation = useCallback(() => {
    const next = captureDrawingSnapshot()
    drawingUndoStackRef.current.push(next)
    if (drawingUndoStackRef.current.length > MAX_FLOOR_PLAN_DRAWING_UNDO_ENTRIES) {
      drawingUndoStackRef.current.shift()
    }
    drawingRedoStackRef.current = []
  }, [captureDrawingSnapshot])

  const tryUndoDrawing = useCallback((): boolean => {
    if (
      !isFloorPlanDrawingInProgress(
        activeTool,
        wallDrawingStateRef.current,
        stairDrawingPointsRef.current
      )
    ) {
      return false
    }
    if (drawingUndoStackRef.current.length === 0) return false
    const current = captureDrawingSnapshot()
    const previous = drawingUndoStackRef.current.pop()
    if (!previous) return false
    drawingRedoStackRef.current.push(current)
    applyDrawingSnapshot(previous)
    return true
  }, [activeTool, applyDrawingSnapshot, captureDrawingSnapshot])

  const tryRedoDrawing = useCallback((): boolean => {
    if (
      !isFloorPlanDrawingInProgress(
        activeTool,
        wallDrawingStateRef.current,
        stairDrawingPointsRef.current
      )
    ) {
      return false
    }
    if (drawingRedoStackRef.current.length === 0) return false
    const current = captureDrawingSnapshot()
    const next = drawingRedoStackRef.current.pop()
    if (!next) return false
    drawingUndoStackRef.current.push(current)
    applyDrawingSnapshot(next)
    return true
  }, [activeTool, applyDrawingSnapshot, captureDrawingSnapshot])

  const commitWallWithUndo = useCallback(
    (floorId: string, points: Point2[], curve?: Wall['curve']) => {
      withSingleUndoEntry(
        () => {
          addWall(floorId, { floorId, points, curve, thickness: wallDrawingThicknessCm })
          return true
        },
        { sessionLabel: 'add wall' }
      )
      clearDrawingUndoStacks()
    },
    [addWall, clearDrawingUndoStacks, wallDrawingThicknessCm, withSingleUndoEntry]
  )

  const commitStairWithUndo = useCallback(
    (floorId: string, stair: Omit<Stair, 'id'>) => {
      withSingleUndoEntry(
        () => {
          addStair(floorId, stair)
          return true
        },
        { sessionLabel: 'add stair' }
      )
      clearDrawingUndoStacks()
    },
    [addStair, clearDrawingUndoStacks, withSingleUndoEntry]
  )

  const commitCurrentPenDrawing = useCallback(() => {
    if (isFinalizingPenRef.current) return false
    if (!activeFloorId) return false
    if (
      !wallDrawingState.isDrawing ||
      wallDrawingState.pendingCurve ||
      wallDrawingState.currentPoints.length < 2
    )
      return false
    isFinalizingPenRef.current = true
    commitWallWithUndo(activeFloorId, wallDrawingState.currentPoints)
    resetDrawingState()
    requestAnimationFrame(() => {
      isFinalizingPenRef.current = false
    })
    return true
  }, [
    activeFloorId,
    wallDrawingState.isDrawing,
    wallDrawingState.pendingCurve,
    wallDrawingState.currentPoints,
    commitWallWithUndo,
    resetDrawingState,
  ])

  useEffect(() => {
    if (
      !activeFloorId ||
      !wallDrawingState.pendingCurve ||
      wallDrawingState.currentPoints.length < 3
    )
      return
    commitWallWithUndo(
      activeFloorId,
      wallDrawingState.currentPoints.slice(0, 3),
      createQuarterCircleWallCurve()
    )
    resetDrawingState()
  }, [
    activeFloorId,
    commitWallWithUndo,
    resetDrawingState,
    wallDrawingState.currentPoints,
    wallDrawingState.pendingCurve,
  ])

  const commitCurrentRectangleDrawing = useCallback(() => {
    const start = wallDrawingState.rectStartPoint
    const end = mousePreviewPositionRef.current
    if (!activeFloorId || !start || !end) return false
    const points = handleDrawWallRect(start, end, gridSize, false)
    if (points.length < 2) return false
    commitWallWithUndo(activeFloorId, points)
    resetDrawingState()
    return true
  }, [
    activeFloorId,
    commitWallWithUndo,
    gridSize,
    resetDrawingState,
    wallDrawingState.rectStartPoint,
  ])

  const commitCurrentStairDrawing = useCallback(() => {
    if (!activeFloorId || stairDrawingPoints.length < 1) return false
    const stair: Omit<Stair, 'id'> = {
      floorId: activeFloorId,
      points: stairDrawingPoints.length === 1 ? [stairDrawingPoints[0]!] : stairDrawingPoints,
      width: (PLAN_STAIR_DEFAULT_WIDTH_CM / 100) * canvasPxPerMeter,
      stepDepth: (PLAN_STAIR_DEFAULT_STEP_DEPTH_CM / 100) * canvasPxPerMeter,
      spiralPoleDiameter: (PLAN_STAIR_SPIRAL_POLE_DIAMETER_CM / 100) * canvasPxPerMeter,
      cornerStyle: 'round',
      cornerMode: 'turn',
      showUpArrow: false,
      invertUpArrow: true,
      spiralRotationDeg: 0,
    }
    commitStairWithUndo(activeFloorId, stair)
    setStairDrawingPoints([])
    scheduleMousePreviewPosition(null)
    return true
  }, [
    activeFloorId,
    stairDrawingPoints,
    canvasPxPerMeter,
    commitStairWithUndo,
    scheduleMousePreviewPosition,
  ])

  const commitGraphicElement = useCallback(
    (start: Point2, end: Point2, useDraggedSize: boolean) => {
      if (!activeFloorId || !selectedGraphicAssetId || canvasPxPerMeter <= 0) return
      const asset = getPlanGraphicElementAsset(selectedGraphicAssetId)
      if (!asset) return

      const left = Math.min(start.x, end.x)
      const right = Math.max(start.x, end.x)
      const top = Math.min(start.y, end.y)
      const bottom = Math.max(start.y, end.y)
      const draggedWidth = right - left
      const draggedHeight = bottom - top
      const draggedLargeEnough = draggedWidth >= 4 && draggedHeight >= 4

      if (useDraggedSize && draggedLargeEnough && !asset.sizeLocked) {
        addPlanGraphicElement(activeFloorId, {
          floorId: activeFloorId,
          kind: asset.kind,
          assetId: asset.id,
          pos: { x: left + draggedWidth / 2, y: top + draggedHeight / 2 },
          width: draggedWidth,
          height: draggedHeight,
          rotationDeg: 0,
          sizeLocked: asset.sizeLocked,
          layer: 'floor-plan-graphics',
        })
        return
      }

      const defaultPos =
        useDraggedSize && draggedLargeEnough
          ? { x: left + draggedWidth / 2, y: top + draggedHeight / 2 }
          : end
      const draft = createPlanGraphicElementDraft(
        activeFloorId,
        asset.id,
        defaultPos,
        canvasPxPerMeter
      )
      if (draft) addPlanGraphicElement(activeFloorId, draft)
    },
    [activeFloorId, addPlanGraphicElement, canvasPxPerMeter, selectedGraphicAssetId]
  )

  const rememberStageContainer = useCallback((e: FloorPlanInputEvent) => {
    const container = e.target?.getStage?.()?.container?.()
    if (container) stageContainerRef.current = container
  }, [])

  const capturePenPointer = useCallback((e: FloorPlanInputEvent) => {
    const nativeEvent = e.evt as PointerEvent
    const target = nativeEvent.target
    if (
      typeof nativeEvent.pointerId !== 'number' ||
      !(target instanceof HTMLElement) ||
      typeof target.setPointerCapture !== 'function'
    ) {
      return
    }

    try {
      target.setPointerCapture(nativeEvent.pointerId)
      penPointerCaptureTargetRef.current = target
      penPointerCaptureIdRef.current = nativeEvent.pointerId
    } catch {
      // Pointer capture is a best-effort guard for HTML overlays crossing the canvas.
    }
  }, [])

  const releasePenPointer = useCallback(() => {
    const target = penPointerCaptureTargetRef.current
    const pointerId = penPointerCaptureIdRef.current
    penPointerCaptureTargetRef.current = null
    penPointerCaptureIdRef.current = null
    if (!target || pointerId == null || !target.hasPointerCapture(pointerId)) return
    try {
      target.releasePointerCapture(pointerId)
    } catch {
      // The browser may already have released capture after a cancelled gesture.
    }
  }, [])

  const clientCoordsToCanvasPoint = useCallback(
    (clientX: number, clientY: number): Point2 | null => {
      const container = stageContainerRef.current
      if (!container) return null
      const rect = container.getBoundingClientRect()
      const stageX = clientX - rect.left
      const stageY = clientY - rect.top
      return {
        x: (stageX - planView.pan.x) / planView.zoom,
        y: (stageY - planView.pan.y) / planView.zoom,
      }
    },
    [planView.pan.x, planView.pan.y, planView.zoom]
  )

  const getCanvasPointFromEvent = useCallback(
    (e: FloorPlanInputEvent): Point2 | null => {
      const stage = e.target?.getStage?.()
      if (!stage) return null

      const pointer = stage.getPointerPosition()
      if (pointer) {
        return {
          x: (pointer.x - planView.pan.x) / planView.zoom,
          y: (pointer.y - planView.pan.y) / planView.zoom,
        }
      }

      // iPad/Safari fallback: pointer can be null on initial touch events.
      const nativeEvt = e.evt as TouchEvent | PointerEvent | MouseEvent | undefined
      const stageContainer = stage.container?.()
      if (!nativeEvt || !stageContainer) return null
      const rect = stageContainer.getBoundingClientRect()
      const touch =
        (nativeEvt as TouchEvent).touches?.[0] || (nativeEvt as TouchEvent).changedTouches?.[0]
      const clientX = touch?.clientX ?? (nativeEvt as PointerEvent).clientX
      const clientY = touch?.clientY ?? (nativeEvt as PointerEvent).clientY
      if (typeof clientX !== 'number' || typeof clientY !== 'number') return null

      const stageX = clientX - rect.left
      const stageY = clientY - rect.top
      return {
        x: (stageX - planView.pan.x) / planView.zoom,
        y: (stageY - planView.pan.y) / planView.zoom,
      }
    },
    [planView]
  )

  const snapPointToPenAngle = useCallback((start: Point2, target: Point2): Point2 => {
    const dx = target.x - start.x
    const dy = target.y - start.y
    const length = Math.sqrt(dx * dx + dy * dy)
    if (length <= 1e-6) return target
    const angle = Math.atan2(dy, dx)
    const step = Math.PI / 4
    const snappedAngle = Math.round(angle / step) * step
    return {
      x: start.x + Math.cos(snappedAngle) * length,
      y: start.y + Math.sin(snappedAngle) * length,
    }
  }, [])

  const pointsMatch = useCallback((a: Point2, b: Point2, epsilon = 1e-4) => {
    return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon
  }, [])

  const findClosestWallForOpening = useCallback((point: Point2, walls: Wall[]): Wall | null => {
    let closestWall: Wall | null = null
    let minDistance = Infinity
    for (const wall of walls) {
      if (isCurvedWall(wall)) continue
      for (let i = 0; i < wall.points.length - 1; i++) {
        const p1 = wall.points[i]
        const p2 = wall.points[i + 1]
        if (!p1 || !p2) continue
        const dx = p2.x - p1.x
        const dy = p2.y - p1.y
        const lengthSq = dx * dx + dy * dy
        if (lengthSq < 1e-10) continue
        const t = Math.max(
          0,
          Math.min(1, ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lengthSq)
        )
        const projX = p1.x + t * dx
        const projY = p1.y + t * dy
        const dist = Math.hypot(point.x - projX, point.y - projY)
        if (dist < minDistance && dist < 20) {
          minDistance = dist
          closestWall = wall
        }
      }
    }
    return closestWall
  }, [])

  const resolveOpeningAnchor = useCallback(
    (wall: Wall, pointer: Point2): Point2 =>
      resolveOpeningPositionSnap({
        wall,
        walls: activeFloorId ? getWallsByFloor(activeFloorId) : [wall],
        pointer,
        spanCenterRadius: screenPxToCanvasUnits(
          planView.zoom,
          OPENING_SPAN_CENTER_SNAP_ZONE_PX,
          OPENING_SPAN_CENTER_SNAP_ZONE_PX_MIN,
          OPENING_SPAN_CENTER_SNAP_ZONE_PX_MAX
        ),
        snapToGrid: planView.snapToGrid,
        gridSize,
      }).point,
    [activeFloorId, getWallsByFloor, gridSize, planView.snapToGrid, planView.zoom]
  )

  const getDefaultOpeningWidth = useCallback(
    (kind: 'door' | 'window') => {
      const doorWidthPx = snapOpeningWidthToWholeCentimeters(
        0.83 * canvasPxPerMeter,
        canvasPxPerMeter
      )
      const clickWindowWidthPx = 0.5 * canvasPxPerMeter
      const previewWindowWidthPx = previewPxPerMeter != null ? 0.5 * previewPxPerMeter : 100
      const windowWidthPx = snapOpeningWidthToWholeCentimeters(
        resolveWindowInsertWidthPx(clickWindowWidthPx, previewWindowWidthPx),
        canvasPxPerMeter
      )
      return kind === 'door' ? doorWidthPx : windowWidthPx
    },
    [canvasPxPerMeter, previewPxPerMeter]
  )

  const getOpeningPlacementOptions = useCallback(
    (kind: 'door' | 'window') => ({
      snapWidthToCm: true as const,
      canvasPxPerMeter,
      dragActivationThresholdPx: kind === 'door' ? 10 : 8,
      minimumWidthPx: kind === 'door' ? 0.5 * canvasPxPerMeter : 0.15 * canvasPxPerMeter,
    }),
    [canvasPxPerMeter]
  )

  const resolvePlacementDoorOrientation = useCallback(
    (
      wall: Wall,
      position: number,
      pointer: Point2,
      hingeSwing: 'left' | 'right' | null,
      options?: { useOpenSideDeadzone?: boolean }
    ) => {
      const geom = computeOpeningGeometry(wall.points, position)
      if (!geom || !activeFloorId) return null
      const floorPlan = activeFloor?.floorPlan
      if (!floorPlan) return null
      return resolveDoorPlacementOrientation({
        hingeSwing,
        center: geom.center,
        tangent: geom.tangent,
        pointer,
        walls: getWallsByFloor(activeFloorId),
        wall,
        masterWallThickness: floorPlan.masterWallThickness,
        pxPerMeter: canvasPxPerMeter,
        deadzonePx: openingWallNormalDeadzoneCanvas(planView.zoom),
        useOpenSideDeadzone: options?.useOpenSideDeadzone,
        lastOpenSide: doorPlacementOpenSideRef.current,
      })
    },
    [activeFloor, activeFloorId, canvasPxPerMeter, getWallsByFloor, planView.zoom]
  )

  const commitOpeningInsert = useCallback(
    (
      kind: 'door' | 'window',
      wall: Wall,
      anchor: Point2,
      current: Point2,
      defaultWidth: number,
      dragSizingLatched = false
    ) => {
      if (!activeFloorId) return
      const floorPlan = (
        currentProject ? readLegacyCompatibilityFloors(currentProject) : []
      ).find((f: { id: string }) => f.id === activeFloorId)?.floorPlan
      const doors = floorPlan?.doors ?? []
      const windows = floorPlan?.windows ?? []
      const placement = computeOpeningDragPlacement(
        wall,
        anchor,
        current,
        defaultWidth,
        6,
        {
          ...getOpeningPlacementOptions(kind),
          forceDragSizing: dragSizingLatched,
        }
      )
      const fitted = fitOpeningPlacementForPreview(wall, placement, doors, windows)
      const validation = validateOpeningPlacement(
        wall,
        placement.centerPoint,
        fitted.width,
        doors,
        windows
      )
      if (!validation.valid) return

      if (kind === 'door') {
        const result = handleInsertDoor(wall, placement.centerPoint, fitted.width)
        const orientation = resolvePlacementDoorOrientation(
          wall,
          fitted.position,
          current,
          placement.doorSwing,
          { useOpenSideDeadzone: false }
        )
        if (orientation) {
          doorPlacementOpenSideRef.current = orientation.openSide
        }
        addDoor(activeFloorId, {
          ...result.door,
          position: fitted.position,
          ...(orientation ? { swing: orientation.swing, direction: orientation.direction } : {}),
        })
        onOpeningInserted?.('door')
        const latestDoors =
          useProjectStore.getState().getFloorById(activeFloorId)?.floorPlan?.doors ?? []
        const insertedDoor = latestDoors[latestDoors.length - 1]
        if (insertedDoor) setSelection({ type: 'door', ids: [insertedDoor.id] })
        return
      }

      const result = handleInsertWindow(wall, placement.centerPoint, fitted.width)
      addWindow(activeFloorId, { ...result.window, position: fitted.position })
      onOpeningInserted?.('window')
      const latestWindows =
        useProjectStore.getState().getFloorById(activeFloorId)?.floorPlan?.windows ?? []
      const insertedWindow = latestWindows[latestWindows.length - 1]
      if (insertedWindow) setSelection({ type: 'window', ids: [insertedWindow.id] })
    },
    [
      activeFloorId,
      currentProject,
      addDoor,
      addWindow,
      setSelection,
      onOpeningInserted,
      resolvePlacementDoorOrientation,
      getOpeningPlacementOptions,
    ]
  )

  const segmentIntersectionPoint = useCallback(
    (a: Point2, b: Point2, c: Point2, d: Point2): Point2 | null => {
      const r = { x: b.x - a.x, y: b.y - a.y }
      const s = { x: d.x - c.x, y: d.y - c.y }
      const rxs = r.x * s.y - r.y * s.x
      const cma = { x: c.x - a.x, y: c.y - a.y }
      const qpxr = cma.x * r.y - cma.y * r.x
      const epsilon = 1e-8
      if (Math.abs(rxs) <= epsilon) return null
      const t = (cma.x * s.y - cma.y * s.x) / rxs
      const u = qpxr / rxs
      if (t < -epsilon || t > 1 + epsilon || u < -epsilon || u > 1 + epsilon) return null
      return {
        x: a.x + t * r.x,
        y: a.y + t * r.y,
      }
    },
    []
  )

  const isProjectionPathObstructed = useCallback(
    (from: Point2, to: Point2, segments: Array<{ a: Point2; b: Point2 }>) => {
      for (const seg of segments) {
        const hit = segmentIntersectionPoint(from, to, seg.a, seg.b)
        if (!hit) continue
        // Endpoint touches are allowed: snapping exactly onto anchors / current point.
        if (pointsMatch(hit, from) || pointsMatch(hit, to)) continue
        return true
      }
      return false
    },
    [segmentIntersectionPoint, pointsMatch]
  )

  const resolveNearbyLineSnap = useCallback(
    (
      point: Point2,
      options?: {
        excludeCurrentTail?: 'drawWall' | 'drawStair'
        excludeDraftPoint?: { tool: 'drawWall' | 'drawStair'; index: number }
      }
    ) => {
      const radius = screenPxToCanvasUnits(
        planView.zoom,
        DRAW_TOOL_LINE_SNAP_ZONE_PX,
        DRAW_TOOL_LINE_SNAP_ZONE_PX_MIN,
        DRAW_TOOL_LINE_SNAP_ZONE_PX_MAX
      )
      const segments: LineSnapSegment[] = []
      const appendSegments = (points: Point2[], tool?: 'drawWall' | 'drawStair') => {
        for (let index = 0; index < points.length - 1; index += 1) {
          if (tool && options?.excludeCurrentTail === tool && index === points.length - 2) {
            continue
          }
          const excludedDraftPoint = options?.excludeDraftPoint
          if (
            tool &&
            excludedDraftPoint?.tool === tool &&
            (index === excludedDraftPoint.index || index + 1 === excludedDraftPoint.index)
          ) {
            continue
          }
          const a = points[index]
          const b = points[index + 1]
          if (a && b) segments.push({ a, b })
        }
      }

      for (const wall of activeFloor?.floorPlan?.walls ?? [])
        appendSegments(getWallPathPoints(wall))
      for (const stair of activeFloor?.floorPlan?.stairs ?? []) appendSegments(stair.points)
      appendSegments(wallDrawingState.currentPoints, 'drawWall')
      appendSegments(stairDrawingPoints, 'drawStair')

      const nearbyLine = snapPointToNearbyLine(point, segments, radius)
      return nearbyLine ? snapNearbyLineToGrid(nearbyLine, gridSize, planView.snapToGrid) : null
    },
    [
      activeFloor?.floorPlan?.walls,
      activeFloor?.floorPlan?.stairs,
      gridSize,
      planView.snapToGrid,
      planView.zoom,
      stairDrawingPoints,
      wallDrawingState.currentPoints,
    ]
  )

  const resolveProjectedPenSnap = useCallback(
    (point: Point2, walls: Wall[]) => {
      const projectionSnapZone = screenPxToCanvasUnits(
        planView.zoom,
        DRAW_TOOL_PROJECTION_SNAP_ZONE_PX,
        DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MIN,
        DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MAX
      )
      const anchors: Point2[] = []
      for (const p of wallDrawingState.currentPoints) anchors.push(p)
      for (const wall of walls) {
        wall.points.forEach((p, index) => {
          if (!isCurvedWall(wall) || index !== 1) anchors.push(p)
        })
      }

      const segments: Array<{ a: Point2; b: Point2 }> = []
      for (const wall of walls) {
        const pathPoints = getWallPathPoints(wall)
        for (let i = 0; i < pathPoints.length - 1; i++) {
          const a = pathPoints[i]
          const b = pathPoints[i + 1]
          if (!a || !b) continue
          segments.push({ a, b })
        }
      }
      for (let i = 0; i < wallDrawingState.currentPoints.length - 1; i++) {
        const a = wallDrawingState.currentPoints[i]
        const b = wallDrawingState.currentPoints[i + 1]
        if (!a || !b) continue
        segments.push({ a, b })
      }

      let bestVertical: {
        offset: number
        distanceToAnchor: number
        anchor: Point2
      } | null = null
      let bestHorizontal: {
        offset: number
        distanceToAnchor: number
        anchor: Point2
      } | null = null

      for (const anchor of anchors) {
        if (pointsMatch(anchor, point)) continue
        const dx = Math.abs(point.x - anchor.x)
        const dy = Math.abs(point.y - anchor.y)
        if (dx <= projectionSnapZone) {
          const snapped = { x: anchor.x, y: point.y }
          if (!isProjectionPathObstructed(snapped, anchor, segments)) {
            const distanceToAnchor = Math.hypot(snapped.x - anchor.x, snapped.y - anchor.y)
            const isBetter =
              !bestVertical ||
              dx < bestVertical.offset ||
              (Math.abs(dx - bestVertical.offset) <= 1e-6 &&
                distanceToAnchor < bestVertical.distanceToAnchor)
            if (isBetter) {
              bestVertical = { offset: dx, distanceToAnchor, anchor }
            }
          }
        }
        if (dy <= projectionSnapZone) {
          const snapped = { x: point.x, y: anchor.y }
          if (!isProjectionPathObstructed(snapped, anchor, segments)) {
            const distanceToAnchor = Math.hypot(snapped.x - anchor.x, snapped.y - anchor.y)
            const isBetter =
              !bestHorizontal ||
              dy < bestHorizontal.offset ||
              (Math.abs(dy - bestHorizontal.offset) <= 1e-6 &&
                distanceToAnchor < bestHorizontal.distanceToAnchor)
            if (isBetter) {
              bestHorizontal = { offset: dy, distanceToAnchor, anchor }
            }
          }
        }
      }
      if (!bestVertical && !bestHorizontal) return null

      const snappedPoint: Point2 = {
        x: bestVertical ? bestVertical.anchor.x : point.x,
        y: bestHorizontal ? bestHorizontal.anchor.y : point.y,
      }

      const results: Array<{ snappedPoint: Point2; guideFrom: Point2; guideTo: Point2 }> = []
      if (bestVertical) {
        results.push({
          snappedPoint,
          guideFrom: bestVertical.anchor,
          guideTo: { x: bestVertical.anchor.x, y: snappedPoint.y },
        })
      }
      if (bestHorizontal) {
        results.push({
          snappedPoint,
          guideFrom: bestHorizontal.anchor,
          guideTo: { x: snappedPoint.x, y: bestHorizontal.anchor.y },
        })
      }
      return results.slice(0, 2)
    },
    [wallDrawingState.currentPoints, planView.zoom, pointsMatch, isProjectionPathObstructed]
  )

  const isFloorPlanHitTarget = useCallback((e: FloorPlanInputEvent) => {
    const targetType = e.target.getType?.()
    const targetName = e.target.name?.()
    const isTransparentRect =
      (targetType === 'Rect' || targetType === 'Shape') && targetName === 'floor-plan-hit-area'
    const isGroup = e.target === e.currentTarget
    const isDraftPoint = targetName === 'floor-plan-draft-point'
    if (isDraftPoint) return false
    return isTransparentRect || isGroup
  }, [])

  const appendPenPoint = useCallback(
    (
      rawPoint: Point2,
      options?: {
        snapTo45Degrees?: boolean
        lockedLengthMeters?: number | null
        commitSegment?: boolean
      }
    ) => {
      if (!activeFloorId) return
      pushDrawingUndoBeforeMutation()

      const walls = getWallsByFloor(activeFloorId)
      const nearbyLine = resolveNearbyLineSnap(rawPoint, { excludeCurrentTail: 'drawWall' })
      let pointToUse = nearbyLine?.point ?? rawPoint
      const shouldSnapTo45Degrees = options?.snapTo45Degrees === true
      const effectiveLockedLengthMeters =
        options && 'lockedLengthMeters' in options
          ? options.lockedLengthMeters
          : penLockedLengthMeters

      if (
        !nearbyLine &&
        shouldSnapTo45Degrees &&
        wallDrawingState.isDrawing &&
        wallDrawingState.currentPoints.length > 0
      ) {
        const start = wallDrawingState.currentPoints[wallDrawingState.currentPoints.length - 1]!
        pointToUse = snapPointToPenAngle(start, pointToUse)
      } else if (!nearbyLine) {
        const projected =
          planView.snapToProjection !== false ? resolveProjectedPenSnap(pointToUse, walls) : null
        if (projected && projected.length > 0) {
          pointToUse = projected[0]!.snappedPoint
          if (projected.length > 1) {
            pointToUse = projected[1]!.snappedPoint
          }
        }
      }

      if (
        wallDrawingState.isDrawing &&
        wallDrawingState.currentPoints.length > 0 &&
        effectiveLockedLengthMeters &&
        canvasPxPerMeter
      ) {
        const start = wallDrawingState.currentPoints[wallDrawingState.currentPoints.length - 1]!
        const dx = rawPoint.x - start.x
        const dy = rawPoint.y - start.y
        const len = Math.sqrt(dx * dx + dy * dy)
        const targetPx = effectiveLockedLengthMeters * canvasPxPerMeter
        if (len > 1e-6 && targetPx > 0) {
          const scale = targetPx / len
          pointToUse = {
            x: start.x + dx * scale,
            y: start.y + dy * scale,
          }
        }
      }

      const result = handleDrawWall(
        pointToUse,
        {
          mode: 'drawWall',
          currentWall: null,
          currentPoints: wallDrawingState.currentPoints,
          isDrawing: wallDrawingState.isDrawing,
          startPoint: wallDrawingState.startPoint,
          selectedPointIndex: null,
          selectedWallId: null,
        },
        gridSize,
        !nearbyLine &&
          !(effectiveLockedLengthMeters && canvasPxPerMeter) &&
          planView.snapToGrid &&
          !shouldSnapTo45Degrees,
        walls
      )

      const nextState = {
        ...wallDrawingState,
        isDrawing: result.isDrawing ?? wallDrawingState.isDrawing,
        currentPoints: result.currentPoints ?? wallDrawingState.currentPoints,
        startPoint: result.startPoint ?? wallDrawingState.startPoint,
      }

      // If the new point closes the loop (near the first point), snap and commit a closed wall immediately.
      if (
        !wallDrawingState.pendingCurve &&
        nextState.isDrawing &&
        nextState.currentPoints.length >= 3
      ) {
        const first = nextState.currentPoints[0]!
        const lastIndex = nextState.currentPoints.length - 1
        const last = nextState.currentPoints[lastIndex]!
        const dx = last.x - first.x
        const dy = last.y - first.y
        const distSq = dx * dx + dy * dy
        const CLOSE_EPSILON_SQ = 10 * 10 // ~10 px in canvas space

        if (distSq <= CLOSE_EPSILON_SQ) {
          const normalizedPoints = [...nextState.currentPoints]
          // Snap the last point exactly onto the first so we don't get
          // nearly-duplicate vertices that produce spiky joins.
          normalizedPoints[lastIndex] = first

          commitWallWithUndo(activeFloorId, normalizedPoints)

          // Fully reset drawing state and clear constraints.
          resetDrawingState()
          setWallDrawingState({
            currentPoints: [],
            isDrawing: false,
            startPoint: null,
            rectStartPoint: null,
            pendingCurve: false,
          })
          setActiveTool('drawWall')
          return
        }
      }

      if (options?.commitSegment && nextState.currentPoints.length >= 2) {
        commitWallWithUndo(activeFloorId, nextState.currentPoints)
        resetDrawingState()
        setActiveTool('drawWall')
        return
      }

      // After committing this vertex (i.e. after finishing the current segment),
      // dimension constraints are ephemeral and must be reset so the next
      // segment starts "fresh".
      clearPenConstraints()
      setProjectedSnapGuides([])
      setActiveGeometrySnap(null)
      setWallDrawingState(nextState)
    },
    [
      activeFloorId,
      getWallsByFloor,
      gridSize,
      planView.snapToGrid,
      planView.snapToProjection,
      penLockedLengthMeters,
      canvasPxPerMeter,
      clearPenConstraints,
      wallDrawingState,
      commitWallWithUndo,
      pushDrawingUndoBeforeMutation,
      resetDrawingState,
      setActiveTool,
      snapPointToPenAngle,
      resolveProjectedPenSnap,
      resolveNearbyLineSnap,
    ]
  )

  const resolveStairDrawingSnap = useCallback(
    (rawPoint: Point2) => {
      const nearbyLine = resolveNearbyLineSnap(rawPoint, { excludeCurrentTail: 'drawStair' })
      if (nearbyLine) return { point: nearbyLine.point, guides: [] }
      let point = rawPoint
      const walls = activeFloorId ? getWallsByFloor(activeFloorId) : []
      const projected =
        planView.snapToProjection !== false ? resolveProjectedPenSnap(point, walls) : null

      if (projected && projected.length > 0) {
        point = projected[projected.length - 1]!.snappedPoint
      }
      point = snapToGrid(point, gridSize, planView.snapToGrid)

      const guides = (projected ?? []).map((projection) => {
        const isVerticalGuide = Math.abs(projection.guideFrom.x - projection.guideTo.x) <= 1e-6
        return {
          from: projection.guideFrom,
          to: isVerticalGuide
            ? { x: projection.guideFrom.x, y: point.y }
            : { x: point.x, y: projection.guideFrom.y },
        }
      })

      return { point, guides }
    },
    [
      activeFloorId,
      getWallsByFloor,
      gridSize,
      planView.snapToGrid,
      planView.snapToProjection,
      resolveProjectedPenSnap,
      resolveNearbyLineSnap,
    ]
  )

  // Auto-lock pen dimension shortly after typing
  useEffect(() => {
    if (!wallDrawingState.isDrawing || !penDimensionText.trim()) {
      setPenLockedLengthMeters(null)
      if (penAutoLockTimeoutRef.current != null) {
        clearTimeout(penAutoLockTimeoutRef.current)
        penAutoLockTimeoutRef.current = null
      }
      return
    }
    if (penAutoLockTimeoutRef.current != null) {
      clearTimeout(penAutoLockTimeoutRef.current)
    }
    penAutoLockTimeoutRef.current = window.setTimeout(() => {
      const raw = penDimensionText.trim().replace(',', '.')
      const v = parseFloat(raw)
      if (Number.isFinite(v) && v > 0) {
        setPenLockedLengthMeters(v / 100)
        // Immediately update preview at current mouse position (no mouse move needed)
        if (mousePreviewPositionRef.current && wallDrawingState.currentPoints.length > 0) {
          const start = wallDrawingState.currentPoints[wallDrawingState.currentPoints.length - 1]!
          const dx = mousePreviewPositionRef.current.x - start.x
          const dy = mousePreviewPositionRef.current.y - start.y
          const lenPx = Math.sqrt(dx * dx + dy * dy)
          const targetPx = v * canvasPxPerMeter
          if (lenPx > 1e-6 && targetPx > 0) {
            const scale = targetPx / lenPx
            const constrained = {
              x: start.x + dx * scale,
              y: start.y + dy * scale,
            }
            scheduleMousePreviewPosition(constrained)
          }
        }
      } else {
        setPenLockedLengthMeters(null)
      }
    }, 250)
    return () => {
      if (penAutoLockTimeoutRef.current != null) {
        clearTimeout(penAutoLockTimeoutRef.current)
        penAutoLockTimeoutRef.current = null
      }
    }
  }, [
    penDimensionText,
    wallDrawingState.isDrawing,
    canvasPxPerMeter,
    scheduleMousePreviewPosition,
    wallDrawingState.currentPoints,
  ])

  // Auto-lock rectangle X dimension
  useEffect(() => {
    if (!wallDrawingState.rectStartPoint) {
      clearRectConstraints()
      return
    }
    if (!rectDimensionTextX.trim()) {
      setRectLockedXMeters(null)
      return
    }
    if (rectXAutoLockTimeoutRef.current != null) {
      clearTimeout(rectXAutoLockTimeoutRef.current)
    }
    rectXAutoLockTimeoutRef.current = window.setTimeout(() => {
      const raw = rectDimensionTextX.trim().replace(',', '.')
      const v = parseFloat(raw)
      if (Number.isFinite(v) && v > 0) {
        setRectLockedXMeters(v / 100)
        // Immediately update X dimension preview at current mouse position
        if (mousePreviewPositionRef.current && wallDrawingState.rectStartPoint) {
          const start = wallDrawingState.rectStartPoint
          const end0 = mousePreviewPositionRef.current
          const dx = end0.x - start.x
          const signX = dx >= 0 ? 1 : -1
          const constrained = {
            ...end0,
            x: start.x + signX * v * canvasPxPerMeter,
          }
          scheduleMousePreviewPosition(constrained)
        }
      } else {
        setRectLockedXMeters(null)
      }
    }, 250)
    return () => {
      if (rectXAutoLockTimeoutRef.current != null) {
        clearTimeout(rectXAutoLockTimeoutRef.current)
        rectXAutoLockTimeoutRef.current = null
      }
    }
  }, [
    rectDimensionTextX,
    wallDrawingState.rectStartPoint,
    canvasPxPerMeter,
    clearRectConstraints,
    scheduleMousePreviewPosition,
  ])

  // Auto-lock rectangle Y dimension
  useEffect(() => {
    if (!wallDrawingState.rectStartPoint) {
      clearRectConstraints()
      return
    }
    if (!rectDimensionTextY.trim()) {
      setRectLockedYMeters(null)
      return
    }
    if (rectYAutoLockTimeoutRef.current != null) {
      clearTimeout(rectYAutoLockTimeoutRef.current)
    }
    rectYAutoLockTimeoutRef.current = window.setTimeout(() => {
      const raw = rectDimensionTextY.trim().replace(',', '.')
      const v = parseFloat(raw)
      if (Number.isFinite(v) && v > 0) {
        setRectLockedYMeters(v / 100)
        // Immediately update Y dimension preview at current mouse position
        if (mousePreviewPositionRef.current && wallDrawingState.rectStartPoint) {
          const start = wallDrawingState.rectStartPoint
          const end0 = mousePreviewPositionRef.current
          const dy = end0.y - start.y
          const signY = dy >= 0 ? 1 : -1
          const constrained = {
            ...end0,
            y: start.y + signY * v * canvasPxPerMeter,
          }
          scheduleMousePreviewPosition(constrained)
        }
      } else {
        setRectLockedYMeters(null)
      }
    }, 250)
    return () => {
      if (rectYAutoLockTimeoutRef.current != null) {
        clearTimeout(rectYAutoLockTimeoutRef.current)
        rectYAutoLockTimeoutRef.current = null
      }
    }
  }, [
    rectDimensionTextY,
    wallDrawingState.rectStartPoint,
    canvasPxPerMeter,
    clearRectConstraints,
    scheduleMousePreviewPosition,
  ])

  // Track Shift globally so pointer/touch handlers can reliably read modifier state.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        isShiftPressedRef.current = true
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') {
        isShiftPressedRef.current = false
      }
    }
    const handleWindowBlur = () => {
      isShiftPressedRef.current = false
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [])

  useEffect(() => {
    planFloorDrawingUndoRef.current = {
      tryUndo: tryUndoDrawing,
      tryRedo: tryRedoDrawing,
      pushBeforeMutation: pushDrawingUndoBeforeMutation,
      clearStacks: clearDrawingUndoStacks,
    }
    return () => {
      planFloorDrawingUndoRef.current = null
    }
  }, [tryUndoDrawing, tryRedoDrawing, pushDrawingUndoBeforeMutation, clearDrawingUndoStacks])

  const commitPenDimensionInput = useCallback(() => {
    if (activeTool !== 'drawWall' || !wallDrawingState.isDrawing) return
    const previewPoint = mousePreviewPositionRef.current

    // A curved gesture needs its third point to be added first; the existing
    // pending-curve effect then commits the curve. Straight pen input should
    // finish the current segment immediately instead of adding another point.
    if (wallDrawingState.pendingCurve) {
      if (!previewPoint) return
      appendPenPoint(previewPoint)
      return
    }

    const typedCentimeters = Number.parseFloat(penDimensionText.trim().replace(',', '.'))
    const hasTypedLength = Number.isFinite(typedCentimeters) && typedCentimeters > 0

    // Without a typed length, Enter finishes the polyline as drawn. A typed length
    // always adds that segment first, also after earlier segments were clicked.
    if (
      wallDrawingState.currentPoints.length >= 2 &&
      activeFloorId &&
      !(hasTypedLength && previewPoint)
    ) {
      commitWallWithUndo(activeFloorId, wallDrawingState.currentPoints)
      resetDrawingState()
      setActiveTool('drawWall')
      return
    }

    if (!previewPoint) return

    appendPenPoint(previewPoint, {
      lockedLengthMeters: hasTypedLength ? typedCentimeters / 100 : penLockedLengthMeters,
      commitSegment: true,
    })
  }, [
    activeTool,
    wallDrawingState.isDrawing,
    wallDrawingState.pendingCurve,
    wallDrawingState.currentPoints,
    activeFloorId,
    commitWallWithUndo,
    resetDrawingState,
    setActiveTool,
    penDimensionText,
    appendPenPoint,
    penLockedLengthMeters,
  ])

  const drawDimensionEditor = useMemo<FloorPlanDrawDimensionEditor | null>(() => {
    if (!currentMousePosition) return null

    if (
      activeTool === 'drawWall' &&
      wallDrawingState.isDrawing &&
      wallDrawingState.currentPoints.length > 0
    ) {
      const start = wallDrawingState.currentPoints[wallDrawingState.currentPoints.length - 1]!
      const dx = currentMousePosition.x - start.x
      const dy = currentMousePosition.y - start.y
      const centimeters = (Math.sqrt(dx * dx + dy * dy) / canvasPxPerMeter) * 100
      return {
        ownerId: 'draw-tool',
        fields: [
          {
            id: 'length',
            anchor: {
              x: (start.x + currentMousePosition.x) / 2,
              y: (start.y + currentMousePosition.y) / 2,
            },
            placement: 'center',
            value: penDimensionText || centimeters.toFixed(1),
            live: !penDimensionText,
            active: true,
          },
        ],
        onActivate: () => undefined,
        onChange: (_id, value) => setPenDimensionText(value),
        onEnter: commitPenDimensionInput,
        onTab: () => undefined,
        onEscape: () => undefined,
      }
    }

    if (activeTool === 'drawWallRect' && wallDrawingState.rectStartPoint) {
      const start = wallDrawingState.rectStartPoint
      let end = snapToGrid(currentMousePosition, gridSize, planView.snapToGrid)
      if (rectLockedXMeters != null) {
        end = {
          ...end,
          x: start.x + (end.x >= start.x ? 1 : -1) * rectLockedXMeters * canvasPxPerMeter,
        }
      }
      if (rectLockedYMeters != null) {
        end = {
          ...end,
          y: start.y + (end.y >= start.y ? 1 : -1) * rectLockedYMeters * canvasPxPerMeter,
        }
      }

      const widthPx = Math.abs(end.x - start.x)
      const heightPx = Math.abs(end.y - start.y)
      const fields: FloorPlanDrawDimensionEditor['fields'] = []
      if (widthPx > 1e-3) {
        fields.push({
          id: 'x',
          anchor: { x: (start.x + end.x) / 2, y: start.y },
          placement: 'above',
          value: rectDimensionTextX || ((widthPx / canvasPxPerMeter) * 100).toFixed(1),
          live: !rectDimensionTextX,
          active: rectActiveAxis === 'x',
        })
      }
      if (heightPx > 1e-3) {
        fields.push({
          id: 'y',
          anchor: { x: end.x, y: (start.y + end.y) / 2 },
          placement: 'right',
          value: rectDimensionTextY || ((heightPx / canvasPxPerMeter) * 100).toFixed(1),
          live: !rectDimensionTextY,
          active: rectActiveAxis === 'y',
        })
      }
      if (fields.length === 0) return null

      return {
        ownerId: 'draw-tool',
        fields,
        onActivate: (id) => {
          if (id === 'x' || id === 'y') setRectActiveAxis(id)
        },
        onChange: (id, value) => {
          if (id === 'x') setRectDimensionTextX(value)
          if (id === 'y') setRectDimensionTextY(value)
        },
        onEnter: () => undefined,
        onTab: () => setRectActiveAxis((axis) => (axis === 'x' ? 'y' : 'x')),
        onEscape: () => undefined,
      }
    }

    return null
  }, [
    activeTool,
    currentMousePosition,
    wallDrawingState.isDrawing,
    wallDrawingState.currentPoints,
    wallDrawingState.rectStartPoint,
    canvasPxPerMeter,
    penDimensionText,
    commitPenDimensionInput,
    gridSize,
    planView.snapToGrid,
    rectLockedXMeters,
    rectLockedYMeters,
    rectDimensionTextX,
    rectDimensionTextY,
    rectActiveAxis,
  ])

  useEffect(() => {
    if (drawDimensionEditor) setFloorPlanDrawDimensionEditor(drawDimensionEditor)
    else clearFloorPlanDrawDimensionEditor('draw-tool')
  }, [drawDimensionEditor])

  useEffect(() => () => clearFloorPlanDrawDimensionEditor('draw-tool'), [])

  // Expose drawing mode so global Tab (dock collapse) can defer to dimension typing.
  useEffect(() => {
    const isPenTool = activeTool === 'drawWall'
    const isRectTool = activeTool === 'drawWallRect'
    const isStairTool = activeTool === 'drawStair'
    const isPenDrawing = isPenTool && wallDrawingState.isDrawing
    const isRectDrawing = isRectTool && !!wallDrawingState.rectStartPoint
    const isStairDrawing = isStairTool && stairDrawingPoints.length > 0
    planFloorDrawingConsumesTabRef.current = isPenDrawing || isRectDrawing || isStairDrawing
    return () => {
      planFloorDrawingConsumesTabRef.current = false
    }
  }, [activeTool, wallDrawingState.isDrawing, wallDrawingState.rectStartPoint, stairDrawingPoints])

  // Handle keyboard events for floor plan mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target
      const isNativeDimensionInput =
        target instanceof HTMLElement && target.dataset.floorPlanDimensionInput === 'true'
      if (isNativeDimensionInput && e.key !== 'Escape') return

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setOpeningPointerState(null)
        onOpeningPreviewOverrideChange?.(null)
        onWallHover?.(null, null)
        // Cancel current drawing operation for both pen and rectangle tools
        if (wallDrawingState.isDrawing || wallDrawingState.rectStartPoint) {
          resetDrawingState()
        }
        // Clear selection or exit tool back to the implicit select+move tool
        if (activeTool === 'drawWall') {
          // Exit pen tool without committing the current polyline
          suppressAutoCommitRef.current = true
        }
        if (activeTool === 'drawStair') {
          // Escape cancels the draft; leaving through the toolbar still commits it.
          suppressStairAutoCommitRef.current = true
          setStairDrawingPoints([])
          stairLastClickTimeRef.current = 0
          resetDrawingState()
        }
        if (activeTool !== 'select') {
          setActiveTool('select')
        } else {
          onExitDrawMode()
        }
        return
      }

      const isPenTool = activeTool === 'drawWall'
      const isRectTool = activeTool === 'drawWallRect'
      const isStairTool = activeTool === 'drawStair'
      const isPenDrawing = isPenTool && wallDrawingState.isDrawing
      const isRectDrawing = isRectTool && !!wallDrawingState.rectStartPoint
      const isStairDrawing = isStairTool && stairDrawingPoints.length > 0

      if (!isPenDrawing && !isRectDrawing && !isStairDrawing) {
        // Non-drawing deletion is handled centrally in usePlanKeyboard.
        return
      }

      if (e.key === 'Tab') {
        if (e.repeat) return
        e.preventDefault()
        e.stopPropagation()
        if (isRectDrawing) {
          setRectActiveAxis((prev) => (prev === 'x' ? 'y' : 'x'))
        }
        return
      }

      if (e.key === 'Enter') {
        if (e.repeat) return
        e.preventDefault()
        e.stopPropagation()
        if (isPenDrawing) {
          commitPenDimensionInput()
        } else if (isStairDrawing) {
          commitCurrentStairDrawing()
        }
        return
      }

      if (e.key === 'Backspace') {
        e.preventDefault()
        e.stopPropagation()
        if (isPenDrawing) {
          setPenDimensionText((prev) => prev.slice(0, -1))
        } else if (isRectDrawing) {
          if (rectActiveAxis === 'x') {
            setRectDimensionTextX((prev) => prev.slice(0, -1))
          } else {
            setRectDimensionTextY((prev) => prev.slice(0, -1))
          }
        }
        return
      }

      if (e.key.length === 1 && /[0-9.,]/.test(e.key)) {
        e.preventDefault()
        e.stopPropagation()
        if (isPenDrawing) {
          setPenDimensionText((prev) => prev + e.key)
        } else if (isRectDrawing) {
          if (rectActiveAxis === 'x') {
            setRectDimensionTextX((prev) => prev + e.key)
          } else {
            setRectDimensionTextY((prev) => prev + e.key)
          }
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    wallDrawingState.isDrawing,
    wallDrawingState.currentPoints,
    wallDrawingState.rectStartPoint,
    stairDrawingPoints,
    activeTool,
    selection,
    setSelection,
    setActiveTool,
    resetDrawingState,
    activeFloorId,
    commitWallWithUndo,
    commitCurrentStairDrawing,
    commitPenDimensionInput,
    appendPenPoint,
    penDimensionText,
    penLockedLengthMeters,
    rectActiveAxis,
    onOpeningPreviewOverrideChange,
    onWallHover,
    onExitDrawMode,
  ])

  useEffect(() => {
    onProjectedSnapGuidesChange?.(projectedSnapGuides)
  }, [projectedSnapGuides, onProjectedSnapGuidesChange])

  useEffect(() => {
    return () => {
      onProjectedSnapGuidesChange?.([])
    }
  }, [onProjectedSnapGuidesChange])

  useEffect(() => {
    return () => {
      if (mousePreviewRafRef.current != null) {
        cancelAnimationFrame(mousePreviewRafRef.current)
        mousePreviewRafRef.current = null
      }
      pendingMousePreviewPositionRef.current = null
      mousePreviewPositionRef.current = null
    }
  }, [])

  // When user leaves drawing tools (toolbar toggle / tool switch)
  useEffect(() => {
    const previousTool = previousToolRef.current
    if (
      previousTool === 'drawWall' &&
      activeTool !== 'drawWall' &&
      !isFinalizingPenRef.current &&
      !suppressAutoCommitRef.current
    ) {
      commitCurrentPenDrawing()
      setPenDimensionText('')
      setPenLockedLengthMeters(null)
    }
    // Always clear any partial rectangle when leaving the rectangle tool
    if (previousTool === 'drawWallRect' && activeTool !== 'drawWallRect') {
      resetDrawingState()
    }
    if (previousTool === 'drawStair' && activeTool !== 'drawStair') {
      if (!suppressStairAutoCommitRef.current) {
        commitCurrentStairDrawing()
      }
      setStairDrawingPoints([])
      suppressStairAutoCommitRef.current = false
    }
    if (previousTool === 'drawGraphicElement' && activeTool !== 'drawGraphicElement') {
      setGraphicPointerState(null)
      graphicDidDragRef.current = false
    }
    if (suppressAutoCommitRef.current && previousTool === 'drawWall' && activeTool !== 'drawWall') {
      // One-shot suppression after ESC / explicit cancel
      suppressAutoCommitRef.current = false
    }
    previousToolRef.current = activeTool
  }, [activeTool, commitCurrentPenDrawing, commitCurrentStairDrawing, resetDrawingState])

  // Handle floor plan tool clicks
  const handleFloorPlanClick = useCallback(
    (e: FloorPlanInputEvent) => {
      if ('button' in e.evt && e.evt.button != null && e.evt.button !== 0) {
        return
      }
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false
        return
      }
      // Only handle clicks on empty space
      if (!isFloorPlanHitTarget(e)) {
        return
      }

      // Only process if clicking on empty space
      e.cancelBubble = true

      if (!activeFloorId) {
        return
      }
      const canvasPoint = getCanvasPointFromEvent(e)
      if (!canvasPoint) {
        return
      }

      if (activeTool === 'drawWall') {
        // If we're already drawing and the user clicks near the first point,
        // close the loop and commit the wall instead of adding another vertex.
        if (
          !wallDrawingState.pendingCurve &&
          wallDrawingState.isDrawing &&
          wallDrawingState.currentPoints.length >= 3
        ) {
          const first = wallDrawingState.currentPoints[0]!
          const dx = canvasPoint.x - first.x
          const dy = canvasPoint.y - first.y
          const distSq = dx * dx + dy * dy
          const CLOSE_EPSILON_SQ = 10 * 10 // ~10 px in canvas space
          if (distSq <= CLOSE_EPSILON_SQ) {
            const closedPoints = [...wallDrawingState.currentPoints, first]
            commitWallWithUndo(activeFloorId, closedPoints)
            resetDrawingState()
            setActiveTool('drawWall')
            return
          }
        }

        appendPenPoint(canvasPoint, {
          snapTo45Degrees: !!e?.evt?.shiftKey || isShiftPressedRef.current,
        })
      } else if (activeTool === 'drawWallRect') {
        // Rectangle tool - start on first click, finish on second click
        if (!wallDrawingState.rectStartPoint) {
          // Start rectangle
          const snappedPoint =
            resolveNearbyLineSnap(canvasPoint)?.point ??
            snapToGrid(canvasPoint, gridSize, planView.snapToGrid)
          pushDrawingUndoBeforeMutation()
          setWallDrawingState((prev) => ({
            ...prev,
            rectStartPoint: snappedPoint,
          }))
          scheduleMousePreviewPosition(snappedPoint)
        } else {
          // Finish rectangle - create wall using the same end point as the preview,
          // so commit always matches what the user sees.
          const start = wallDrawingState.rectStartPoint!
          const previewEnd = mousePreviewPositionRef.current

          if (previewEnd) {
            const points = handleDrawWallRect(start, previewEnd, gridSize, false)
            if (activeFloorId && points.length >= 2) {
              commitWallWithUndo(activeFloorId, points)
              setWallDrawingState({
                currentPoints: [],
                isDrawing: false,
                startPoint: null,
                rectStartPoint: null,
                pendingCurve: false,
              })
              scheduleMousePreviewPosition(null)
              clearRectConstraints()
            }
          } else {
            // Fallback: no preview yet, use snapped click position without constraints.
            const snappedPoint =
              resolveNearbyLineSnap(canvasPoint)?.point ??
              snapToGrid(canvasPoint, gridSize, planView.snapToGrid)
            const points = handleDrawWallRect(start, snappedPoint, gridSize, planView.snapToGrid)
            if (activeFloorId && points.length >= 2) {
              commitWallWithUndo(activeFloorId, points)
              setWallDrawingState({
                currentPoints: [],
                isDrawing: false,
                startPoint: null,
                rectStartPoint: null,
                pendingCurve: false,
              })
              scheduleMousePreviewPosition(null)
              clearRectConstraints()
            }
          }
        }
      } else if (activeTool === 'drawStair') {
        const now = Date.now()
        if (now - stairLastClickTimeRef.current < FLOOR_PLAN_DRAW_DOUBLE_CLICK_MS) {
          stairLastClickTimeRef.current = now
          return
        }
        stairLastClickTimeRef.current = now
        const { point: snapped } = resolveStairDrawingSnap(canvasPoint)
        pushDrawingUndoBeforeMutation()
        setStairDrawingPoints((prev) => [...prev, snapped])
        setProjectedSnapGuides([])
      }
    },
    [
      activeTool,
      activeFloorId,
      planView,
      gridSize,
      wallDrawingState,
      clearRectConstraints,
      commitWallWithUndo,
      isFloorPlanHitTarget,
      getCanvasPointFromEvent,
      appendPenPoint,
      pushDrawingUndoBeforeMutation,
      scheduleMousePreviewPosition,
      resetDrawingState,
      setActiveTool,
      resolveStairDrawingSnap,
      resolveNearbyLineSnap,
    ]
  )

  // Handle floor plan tool taps (for touch devices)
  const handleFloorPlanTap = useCallback(
    (e: FloorPlanInputEvent) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false
        return
      }
      // Only handle taps on empty space
      if (!isFloorPlanHitTarget(e)) {
        return
      }

      e.cancelBubble = true

      if (!activeFloorId) return
      const canvasPoint = getCanvasPointFromEvent(e)
      if (!canvasPoint) return

      // Handle same as onClick
      if (activeTool === 'drawWall') {
        appendPenPoint(canvasPoint)
      } else if (activeTool === 'drawStair') {
        const now = Date.now()
        if (now - stairLastClickTimeRef.current < FLOOR_PLAN_DRAW_DOUBLE_CLICK_MS) {
          stairLastClickTimeRef.current = now
          return
        }
        stairLastClickTimeRef.current = now
        const { point: snapped } = resolveStairDrawingSnap(canvasPoint)
        pushDrawingUndoBeforeMutation()
        setStairDrawingPoints((prev) => [...prev, snapped])
        setProjectedSnapGuides([])
      }
    },
    [
      activeTool,
      activeFloorId,
      isFloorPlanHitTarget,
      getCanvasPointFromEvent,
      appendPenPoint,
      pushDrawingUndoBeforeMutation,
      resolveStairDrawingSnap,
    ]
  )

  const updateDraftPoint = useCallback(
    (tool: 'drawWall' | 'drawStair', index: number, rawPoint: Point2) => {
      const nearbyLine = resolveNearbyLineSnap(rawPoint, {
        excludeDraftPoint: { tool, index },
      })
      const nextPoint = nearbyLine?.point ?? snapToGrid(rawPoint, gridSize, planView.snapToGrid)
      if (tool === 'drawWall') {
        setWallDrawingState((prev) => {
          if (!prev.isDrawing || index < 0 || index >= prev.currentPoints.length) return prev
          const nextPoints = [...prev.currentPoints]
          nextPoints[index] = nextPoint
          return { ...prev, currentPoints: nextPoints }
        })
      } else {
        setStairDrawingPoints((prev) => {
          if (index < 0 || index >= prev.length) return prev
          const nextPoints = [...prev]
          nextPoints[index] = nextPoint
          return nextPoints
        })
      }
      scheduleMousePreviewPosition(nextPoint)
    },
    [gridSize, planView.snapToGrid, resolveNearbyLineSnap, scheduleMousePreviewPosition]
  )

  const beginDraftPointDrag = useCallback(
    (tool: 'drawWall' | 'drawStair', index: number, e: FloorPlanInputEvent) => {
      pushDrawingUndoBeforeMutation()
      draftPointDragRef.current = { tool, index }
      draftPointDidDragRef.current = false
      e.cancelBubble = true
    },
    [pushDrawingUndoBeforeMutation]
  )

  const moveDraftPointDrag = useCallback(
    (tool: 'drawWall' | 'drawStair', index: number, e: FloorPlanInputEvent) => {
      const point = getCanvasPointFromEvent(e) ?? { x: e.target.x(), y: e.target.y() }
      draftPointDragRef.current = { tool, index }
      draftPointDidDragRef.current = true
      updateDraftPoint(tool, index, point)
      e.cancelBubble = true
    },
    [getCanvasPointFromEvent, updateDraftPoint]
  )

  const endDraftPointDrag = useCallback(
    (tool: 'drawWall' | 'drawStair', index: number, e: FloorPlanInputEvent) => {
      const point = getCanvasPointFromEvent(e) ?? { x: e.target.x(), y: e.target.y() }
      updateDraftPoint(tool, index, point)
      draftPointDragRef.current = null
      if (draftPointDidDragRef.current) {
        suppressNextClickRef.current = true
        suppressDraftPointTapUntilRef.current = Date.now() + 500
        scheduleMousePreviewPosition(null)
      }
      draftPointDidDragRef.current = false
      e.cancelBubble = true
    },
    [getCanvasPointFromEvent, scheduleMousePreviewPosition, updateDraftPoint]
  )

  // Handle double-click to finish wall drawing
  const handleFloorPlanDblClick = useCallback(
    (e: FloorPlanInputEvent) => {
      if (activeTool !== 'drawWall' && activeTool !== 'drawStair') {
        return
      }

      e.cancelBubble = true

      if (activeTool === 'drawWall') {
        const isDoubleClick = penDoubleClickDetectedRef.current
        penDoubleClickDetectedRef.current = false
        if (!isDoubleClick) return
        commitCurrentPenDrawing()
        setActiveTool('drawWall')
        return
      }
      commitCurrentStairDrawing()
    },
    [activeTool, commitCurrentPenDrawing, commitCurrentStairDrawing, setActiveTool]
  )

  const syncDrawToolPreviewFromCanvasPoint = useCallback(
    (canvasPoint: Point2, shiftHeld: boolean) => {
      if (activeTool === 'drawWall') {
        const nearbyLine = resolveNearbyLineSnap(canvasPoint, { excludeCurrentTail: 'drawWall' })
        let next = nearbyLine?.point ?? canvasPoint
        const shouldSnapTo45Degrees = shiftHeld
        let nextGuides: Array<{ from: Point2; to: Point2; hideDistanceLabel?: boolean }> = []
        if (
          !nearbyLine &&
          shouldSnapTo45Degrees &&
          wallDrawingState.currentPoints.length > 0 &&
          wallDrawingState.isDrawing
        ) {
          const start = wallDrawingState.currentPoints[wallDrawingState.currentPoints.length - 1]!
          next = snapPointToPenAngle(start, next)
        } else if (!nearbyLine) {
          const walls = getWallsByFloor(activeFloorId!)
          const projected =
            planView.snapToProjection !== false ? resolveProjectedPenSnap(next, walls) : null
          if (projected && projected.length > 0) {
            next = projected[0]!.snappedPoint
            if (projected.length > 1) {
              next = projected[1]!.snappedPoint
            }
            const segmentStart =
              wallDrawingState.currentPoints[wallDrawingState.currentPoints.length - 1] ?? null
            nextGuides = projected.map((p) => ({
              from: p.guideFrom,
              to: p.guideTo,
              // When projection snaps against the just-placed pen vertex, the pen tool
              // already shows the segment distance label; suppress duplicate projected label.
              hideDistanceLabel: !!segmentStart && pointsMatch(p.guideFrom, segmentStart),
            }))
          }
        }
        if (
          wallDrawingState.isDrawing &&
          penLockedLengthMeters &&
          wallDrawingState.currentPoints.length > 0 &&
          canvasPxPerMeter
        ) {
          const start = wallDrawingState.currentPoints[wallDrawingState.currentPoints.length - 1]!
          const dx = next.x - start.x
          const dy = next.y - start.y
          const lenPx = Math.sqrt(dx * dx + dy * dy)
          const targetPx = penLockedLengthMeters * canvasPxPerMeter
          if (lenPx > 1e-6 && targetPx > 0) {
            const scale = targetPx / lenPx
            next = {
              x: start.x + dx * scale,
              y: start.y + dy * scale,
            }
          }
        } else if (wallDrawingState.isDrawing && !shouldSnapTo45Degrees && !nearbyLine) {
          // During pen drawing, apply grid snap after projection snap so both
          // enabled rules can cooperate instead of projection bypassing grid.
          next = snapToGrid(next, gridSize, planView.snapToGrid)
        }
        if (!wallDrawingState.isDrawing && !nearbyLine) {
          next = snapToGrid(next, gridSize, planView.snapToGrid)
        }
        if (nextGuides.length > 0) {
          // Keep projected guides tied to the final preview point that will be placed
          // (after optional angle, lock-length, and grid adjustments).
          nextGuides = nextGuides.map((guide) => {
            const isVerticalGuide = Math.abs(guide.from.x - guide.to.x) <= 1e-6
            if (isVerticalGuide) {
              return {
                from: guide.from,
                to: { x: guide.from.x, y: next.y },
                hideDistanceLabel: guide.hideDistanceLabel,
              }
            }
            return {
              from: guide.from,
              to: { x: next.x, y: guide.from.y },
              hideDistanceLabel: guide.hideDistanceLabel,
            }
          })
        }
        setActiveGeometrySnap(
          nearbyLine && pointsMatch(next, nearbyLine.point)
            ? { point: nearbyLine.point, kind: nearbyLine.kind }
            : null
        )
        scheduleMousePreviewPosition(next)
        setProjectedSnapGuides(nextGuides)
      } else if (activeTool === 'drawWallRect') {
        setActiveGeometrySnap(null)
        if (!wallDrawingState.rectStartPoint && !rectPointerDownRef.current) {
          const nearbyLine = resolveNearbyLineSnap(canvasPoint)
          scheduleMousePreviewPosition(
            nearbyLine?.point ?? snapToGrid(canvasPoint, gridSize, planView.snapToGrid)
          )
          setProjectedSnapGuides((prev) => (prev.length > 0 ? [] : prev))
        } else {
          let next = canvasPoint
          const startForPreview = wallDrawingState.rectStartPoint ?? rectPointerDownRef.current
          if (startForPreview) {
            const nearbyLine = resolveNearbyLineSnap(canvasPoint)
            let end = nearbyLine?.point ?? snapToGrid(canvasPoint, gridSize, planView.snapToGrid)
            if (rectLockedXMeters != null) {
              const dx = end.x - startForPreview.x
              const signX = dx >= 0 ? 1 : -1
              const targetPxX = rectLockedXMeters * canvasPxPerMeter
              end = {
                ...end,
                x: startForPreview.x + signX * targetPxX,
              }
            }
            if (rectLockedYMeters != null) {
              const dy = end.y - startForPreview.y
              const signY = dy >= 0 ? 1 : -1
              const targetPxY = rectLockedYMeters * canvasPxPerMeter
              end = {
                ...end,
                y: startForPreview.y + signY * targetPxY,
              }
            }
            next = end
          }
          scheduleMousePreviewPosition(next)
        }
      } else if (activeTool === 'drawStair') {
        setActiveGeometrySnap(null)
        const snapped = resolveStairDrawingSnap(canvasPoint)
        scheduleMousePreviewPosition(snapped.point)
        setProjectedSnapGuides(snapped.guides)
      }
    },
    [
      activeFloorId,
      activeTool,
      canvasPxPerMeter,
      getWallsByFloor,
      gridSize,
      penLockedLengthMeters,
      planView.snapToGrid,
      planView.snapToProjection,
      rectLockedXMeters,
      rectLockedYMeters,
      resolveProjectedPenSnap,
      resolveNearbyLineSnap,
      resolveStairDrawingSnap,
      scheduleMousePreviewPosition,
      snapPointToPenAngle,
      pointsMatch,
      wallDrawingState.currentPoints,
      wallDrawingState.isDrawing,
      wallDrawingState.rectStartPoint,
    ]
  )

  useEffect(() => {
    if (!activeFloorId) return
    if (activeTool !== 'drawWall' && activeTool !== 'drawWallRect' && activeTool !== 'drawStair')
      return
    const sp = lastStagePointerRef.current
    if (!sp) return
    const canvasPoint: Point2 = {
      x: (sp.x - planView.pan.x) / planView.zoom,
      y: (sp.y - planView.pan.y) / planView.zoom,
    }
    syncDrawToolPreviewFromCanvasPoint(canvasPoint, isShiftPressedRef.current)
  }, [
    activeFloorId,
    activeTool,
    planView.pan.x,
    planView.pan.y,
    planView.zoom,
    syncDrawToolPreviewFromCanvasPoint,
  ])

  // Handle mouse move for rectangle preview and wall hover
  const handleFloorPlanMouseMove = useCallback(
    (e: FloorPlanInputEvent) => {
      if (!activeFloorId) return
      const buttons = 'buttons' in e.evt && typeof e.evt.buttons === 'number' ? e.evt.buttons : 0
      const isViewportPanGesture = (buttons & 2) !== 0 || (buttons & 4) !== 0
      if (isViewportPanGesture) {
        lastStagePointerRef.current = null
        scheduleMousePreviewPosition(null)
        if (!didClearWallHoverRef.current) {
          onWallHover?.(null, null)
          didClearWallHoverRef.current = true
        }
        return
      }
      const stage = e.target.getStage()
      if (!stage) return
      const pointer = stage.getPointerPosition()
      if (!pointer) return

      lastStagePointerRef.current = { x: pointer.x, y: pointer.y }

      const canvasPoint: Point2 = {
        x: (pointer.x - planView.pan.x) / planView.zoom,
        y: (pointer.y - planView.pan.y) / planView.zoom,
      }

      const shiftHeld = !!e?.evt?.shiftKey || isShiftPressedRef.current

      const draftPointDrag = draftPointDragRef.current
      if (draftPointDrag) {
        draftPointDidDragRef.current = true
        updateDraftPoint(draftPointDrag.tool, draftPointDrag.index, canvasPoint)
        e.cancelBubble = true
        return
      }

      const pointerDragThresholdCanvas = screenPxToCanvasUnits(planView.zoom, 12, 8, 20)
      const pointerDragThresholdSq = pointerDragThresholdCanvas * pointerDragThresholdCanvas

      if (activeTool === 'drawWall') {
        syncDrawToolPreviewFromCanvasPoint(canvasPoint, shiftHeld)
        if (penPointerDownRef.current) {
          const dx = canvasPoint.x - penPointerDownRef.current.x
          const dy = canvasPoint.y - penPointerDownRef.current.y
          if (dx * dx + dy * dy > pointerDragThresholdSq) penDidDragRef.current = true
        }
      } else if (activeTool === 'drawWallRect') {
        syncDrawToolPreviewFromCanvasPoint(canvasPoint, shiftHeld)
        if (rectPointerDownRef.current) {
          const dx = canvasPoint.x - rectPointerDownRef.current.x
          const dy = canvasPoint.y - rectPointerDownRef.current.y
          if (dx * dx + dy * dy > pointerDragThresholdSq) {
            rectDidDragRef.current = true
            if (!wallDrawingState.rectStartPoint) {
              setWallDrawingState((prev) => ({
                ...prev,
                rectStartPoint: rectPointerDownRef.current,
              }))
            }
          }
        }
      } else if (activeTool === 'drawStair') {
        syncDrawToolPreviewFromCanvasPoint(canvasPoint, shiftHeld)
        if (stairPointerDownRef.current) {
          const dx = canvasPoint.x - stairPointerDownRef.current.x
          const dy = canvasPoint.y - stairPointerDownRef.current.y
          if (dx * dx + dy * dy > pointerDragThresholdSq) stairDidDragRef.current = true
        }
      } else if (activeTool === 'drawGraphicElement') {
        const nextPoint = snapToGrid(canvasPoint, gridSize, planView.snapToGrid)
        scheduleMousePreviewPosition(nextPoint)
        if (graphicPointerState) {
          const dx = nextPoint.x - graphicPointerState.start.x
          const dy = nextPoint.y - graphicPointerState.start.y
          if (dx * dx + dy * dy > pointerDragThresholdSq) graphicDidDragRef.current = true
          setGraphicPointerState((prev) => (prev ? { ...prev, current: nextPoint } : prev))
        }
      } else {
        scheduleMousePreviewPosition(null)
        setProjectedSnapGuides((prev) => (prev.length > 0 ? [] : prev))
      }

      if ((activeTool === 'insertDoor' || activeTool === 'insertWindow') && openingPointerState) {
        setOpeningPointerState((prev) => {
          if (!prev) return prev
          const next = { ...prev, current: canvasPoint }
          if (prev.dragSizingLatched) return next
          const placement = computeOpeningDragPlacement(
            prev.wall,
            prev.anchor,
            canvasPoint,
            getDefaultOpeningWidth(prev.kind),
            6,
            getOpeningPlacementOptions(prev.kind)
          )
          return placement.isDraggingAlongWall ? { ...next, dragSizingLatched: true } : next
        })
      }

      const shouldTrackWallHover =
        activeTool === 'insertDoor' ||
        activeTool === 'insertWindow' ||
        activeTool === 'clipWall' ||
        activeTool === 'insertPoint' ||
        activeTool === 'drawStair' ||
        activeTool === 'drawGraphicElement' ||
        activeTool === 'select'
      if (!shouldTrackWallHover) {
        if (!didClearWallHoverRef.current) {
          onWallHover?.(null, null)
          didClearWallHoverRef.current = true
        }
        return
      }
      didClearWallHoverRef.current = false

      if ((activeTool === 'insertDoor' || activeTool === 'insertWindow') && openingPointerState)
        return

      // Update hover state for walls
      const walls = getWallsByFloor(activeFloorId)
      let hovered: string | null = null

      for (const wall of walls) {
        if (
          isCurvedWall(wall) &&
          getCurvedWallToolHoverFeedback(activeTool) === 'suppressed'
        ) {
          continue
        }
        const pathPoints = getWallPathPoints(wall)
        for (let i = 0; i < pathPoints.length - 1; i++) {
          const p1 = pathPoints[i]
          const p2 = pathPoints[i + 1]
          if (!p1 || !p2) continue
          const dx = p2.x - p1.x
          const dy = p2.y - p1.y
          const lengthSq = dx * dx + dy * dy
          if (lengthSq < 1e-10) continue

          const t = Math.max(
            0,
            Math.min(1, ((canvasPoint.x - p1.x) * dx + (canvasPoint.y - p1.y) * dy) / lengthSq)
          )
          const projX = p1.x + t * dx
          const projY = p1.y + t * dy
          const dist = Math.sqrt(
            Math.pow(canvasPoint.x - projX, 2) + Math.pow(canvasPoint.y - projY, 2)
          )

          if (dist < 10) {
            hovered = wall.id
            break
          }
        }
        if (hovered) break
      }

      onWallHover?.(hovered, canvasPoint)
    },
    [
      activeFloorId,
      activeTool,
      planView,
      wallDrawingState,
      getWallsByFloor,
      gridSize,
      onWallHover,
      scheduleMousePreviewPosition,
      syncDrawToolPreviewFromCanvasPoint,
      openingPointerState,
      graphicPointerState,
      updateDraftPoint,
      getDefaultOpeningWidth,
      getOpeningPlacementOptions,
    ]
  )

  const handleFloorPlanPointerDown = useCallback(
    (e: FloorPlanInputEvent) => {
      if ('button' in e.evt && e.evt.button != null && e.evt.button !== 0) return
      if (!isFloorPlanHitTarget(e) || !activeFloorId) return
      const canvasPoint = getCanvasPointFromEvent(e)
      if (!canvasPoint) return

      if (activeTool === 'drawWall') {
        e.cancelBubble = true
        capturePenPointer(e)
        const now = Date.now()
        const previousPointerDown = penLastPointerDownPointRef.current
        const doubleClickDistance = screenPxToCanvasUnits(
          planView.zoom,
          FLOOR_PLAN_DRAW_DOUBLE_CLICK_DISTANCE_PX,
          4,
          12
        )
        const distanceFromPrevious = previousPointerDown
          ? Math.hypot(
              canvasPoint.x - previousPointerDown.x,
              canvasPoint.y - previousPointerDown.y
            )
          : Number.POSITIVE_INFINITY
        const isDoubleDown =
          now - penLastPointerDownTimeRef.current < FLOOR_PLAN_DRAW_DOUBLE_CLICK_MS &&
          distanceFromPrevious <= doubleClickDistance
        penLastPointerDownTimeRef.current = now
        penLastPointerDownPointRef.current = canvasPoint
        penDoubleClickDetectedRef.current = isDoubleDown
        penPointerDownRef.current = canvasPoint
        penDidDragRef.current = false
        penCurveGestureRef.current = !wallDrawingState.isDrawing
        suppressNextClickRef.current = true
        if (!isDoubleDown || wallDrawingState.pendingCurve) {
          appendPenPoint(canvasPoint, {
            snapTo45Degrees: ('shiftKey' in e.evt && !!e.evt.shiftKey) || isShiftPressedRef.current,
          })
        }
      } else if (activeTool === 'drawWallRect') {
        rectPointerDownRef.current =
          resolveNearbyLineSnap(canvasPoint)?.point ??
          snapToGrid(canvasPoint, gridSize, planView.snapToGrid)
        rectDidDragRef.current = false
        setRectPointerActive(true)
      } else if (activeTool === 'insertDoor' || activeTool === 'insertWindow') {
        e.cancelBubble = true
        rememberStageContainer(e)
        const kind: 'door' | 'window' = activeTool === 'insertDoor' ? 'door' : 'window'
        const closestWall = findClosestWallForOpening(canvasPoint, getWallsByFloor(activeFloorId))
        if (!closestWall) {
          setOpeningPointerState(null)
          return
        }
        doorPlacementOpenSideRef.current = 'right'
        const anchor = resolveOpeningAnchor(closestWall, canvasPoint)
        setOpeningPointerState({
          kind,
          wall: closestWall,
          anchor,
          current: canvasPoint,
          dragSizingLatched: false,
        })
      } else if (activeTool === 'drawGraphicElement') {
        const point = snapToGrid(canvasPoint, gridSize, planView.snapToGrid)
        setGraphicPointerState({ start: point, current: point })
        graphicDidDragRef.current = false
        e.cancelBubble = true
      } else if (activeTool === 'drawStair') {
        const { point } = resolveStairDrawingSnap(canvasPoint)
        stairPointerDownRef.current = point
        stairDidDragRef.current = false
        e.cancelBubble = true
      }
    },
    [
      activeTool,
      activeFloorId,
      isFloorPlanHitTarget,
      getCanvasPointFromEvent,
      capturePenPointer,
      appendPenPoint,
      findClosestWallForOpening,
      getWallsByFloor,
      gridSize,
      planView.snapToGrid,
      planView.zoom,
      rememberStageContainer,
      resolveStairDrawingSnap,
      resolveNearbyLineSnap,
      resolveOpeningAnchor,
      wallDrawingState.isDrawing,
      wallDrawingState.pendingCurve,
    ]
  )

  const handleFloorPlanPointerUp = useCallback(
    (e: FloorPlanInputEvent) => {
      if ('button' in e.evt && e.evt.button != null && e.evt.button !== 0) return
      if (!activeFloorId) return

      if ((activeTool === 'insertDoor' || activeTool === 'insertWindow') && openingPointerState) {
        e.cancelBubble = true
        const baseWidth = getDefaultOpeningWidth(openingPointerState.kind)
        commitOpeningInsert(
          openingPointerState.kind,
          openingPointerState.wall,
          openingPointerState.anchor,
          openingPointerState.current,
          baseWidth,
          openingPointerState.dragSizingLatched
        )
        setOpeningPointerState(null)
        suppressNextClickRef.current = true
        return
      }

      const canvasPoint = getCanvasPointFromEvent(e)
      if (!canvasPoint) return

      if (draftPointDragRef.current) {
        const draftPointDrag = draftPointDragRef.current
        updateDraftPoint(draftPointDrag.tool, draftPointDrag.index, canvasPoint)
        draftPointDragRef.current = null
        if (draftPointDidDragRef.current) {
          suppressNextClickRef.current = true
          suppressDraftPointTapUntilRef.current = Date.now() + 500
          scheduleMousePreviewPosition(null)
        }
        draftPointDidDragRef.current = false
        e.cancelBubble = true
        return
      }

      if (activeTool === 'drawWall') {
        releasePenPointer()
        if (penPointerDownRef.current && penDidDragRef.current) {
          appendPenPoint(canvasPoint, {
            snapTo45Degrees: !!e?.evt?.shiftKey || isShiftPressedRef.current,
          })
          if (penCurveGestureRef.current) {
            setWallDrawingState((prev) => ({ ...prev, pendingCurve: true }))
          }
        }
        const startedCurve = penCurveGestureRef.current && penDidDragRef.current
        penPointerDownRef.current = null
        penDidDragRef.current = false
        penCurveGestureRef.current = false
        if (!startedCurve) scheduleMousePreviewPosition(null)
        suppressNextClickRef.current = true
      } else if (activeTool === 'drawWallRect') {
        if (rectPointerDownRef.current && rectDidDragRef.current) {
          const start = rectPointerDownRef.current
          const previewEnd = mousePreviewPositionRef.current
          const end = previewEnd ?? canvasPoint
          // When we have a preview end, it's already snapped/constrained, so skip extra snapping.
          const snapEnabled = !previewEnd && planView.snapToGrid
          const points = handleDrawWallRect(start, end, gridSize, snapEnabled)
          if (points.length >= 2) {
            commitWallWithUndo(activeFloorId, points)
          }
          // Ephemeral constraints: clear after each committed rectangle.
          clearRectConstraints()
          setWallDrawingState((prev) => ({
            ...prev,
            currentPoints: [],
            isDrawing: false,
            startPoint: null,
            rectStartPoint: null,
          }))
          suppressNextClickRef.current = true
        }
        rectPointerDownRef.current = null
        rectDidDragRef.current = false
        setRectPointerActive(false)
      } else if (activeTool === 'drawStair') {
        if (stairPointerDownRef.current && stairDidDragRef.current) {
          const start = stairPointerDownRef.current
          const { point: end } = resolveStairDrawingSnap(canvasPoint)
          pushDrawingUndoBeforeMutation()
          setStairDrawingPoints((prev) => [...prev, start, end])
          scheduleMousePreviewPosition(null)
          setProjectedSnapGuides([])
          suppressNextClickRef.current = true
        }
        stairPointerDownRef.current = null
        stairDidDragRef.current = false
      } else if (activeTool === 'drawGraphicElement' && graphicPointerState) {
        const end = snapToGrid(canvasPoint, gridSize, planView.snapToGrid)
        commitGraphicElement(graphicPointerState.start, end, graphicDidDragRef.current)
        setGraphicPointerState(null)
        graphicDidDragRef.current = false
        suppressNextClickRef.current = true
      }
    },
    [
      activeTool,
      activeFloorId,
      getCanvasPointFromEvent,
      updateDraftPoint,
      releasePenPointer,
      appendPenPoint,
      gridSize,
      planView.snapToGrid,
      commitWallWithUndo,
      pushDrawingUndoBeforeMutation,
      scheduleMousePreviewPosition,
      clearRectConstraints,
      openingPointerState,
      getDefaultOpeningWidth,
      commitOpeningInsert,
      graphicPointerState,
      commitGraphicElement,
      resolveStairDrawingSnap,
    ]
  )

  // Check if a floor plan drawing tool is active.
  // The implicit select+move tool has no overlay group of its own.
  const isFloorPlanToolActive =
    activeTool === 'drawWall' ||
    activeTool === 'drawWallRect' ||
    activeTool === 'drawStair' ||
    activeTool === 'insertDoor' ||
    activeTool === 'insertWindow' ||
    activeTool === 'insertPoint' ||
    activeTool === 'drawGraphicElement' ||
    activeTool === 'clipWall'

  const drawStrokeCanvas = screenPxToCanvasUnits(
    planView.zoom,
    DRAW_TOOL_STROKE_PX,
    DRAW_TOOL_STROKE_PX_MIN,
    DRAW_TOOL_STROKE_PX_MAX
  )
  const drawPointRadiusCanvas = screenPxToCanvasUnits(
    planView.zoom,
    DRAW_TOOL_POINT_RADIUS_PX,
    DRAW_TOOL_POINT_RADIUS_PX_MIN,
    DRAW_TOOL_POINT_RADIUS_PX_MAX
  )
  const drawHandleRadiusCanvas = screenPxToCanvasUnits(
    planView.zoom,
    DRAW_TOOL_HANDLE_RADIUS_PX,
    DRAW_TOOL_HANDLE_RADIUS_PX_MIN,
    DRAW_TOOL_HANDLE_RADIUS_PX_MAX
  )
  const drawDashCanvas = screenPxToCanvasUnits(planView.zoom, DRAW_TOOL_DASH_PX, 2, 10)
  const stairPreviewColor = theme.mode === 'dark' ? '#9ca3af' : '#64748b'
  const stairPreviewMetrics = getStairRenderMetrics(canvasPxPerMeter)
  const stairSpiralPreviewSnapRadius = screenPxToCanvasUnits(planView.zoom, 18, 10, 24)
  const stairPreviewRawPoints =
    activeTool === 'drawStair'
      ? [
          ...stairDrawingPoints,
          ...(stairDrawingPoints.length > 0 && currentMousePosition ? [currentMousePosition] : []),
        ]
      : []
  const stairSpiralPreviewActive =
    activeTool === 'drawStair' &&
    stairDrawingPoints.length === 1 &&
    !!currentMousePosition &&
    Math.hypot(
      currentMousePosition.x - stairDrawingPoints[0]!.x,
      currentMousePosition.y - stairDrawingPoints[0]!.y
    ) <= stairSpiralPreviewSnapRadius
  const stairPreviewStair: Stair | null =
    activeTool === 'drawStair' && stairDrawingPoints.length > 0
      ? {
          id: '__preview-stair__',
          floorId: activeFloorId ?? '__preview-floor__',
          points:
            stairDrawingPoints.length === 1
              ? [stairDrawingPoints[0]!]
              : stairPreviewRawPoints.length >= 2
                ? stairPreviewRawPoints
                : stairDrawingPoints,
          width: (PLAN_STAIR_DEFAULT_WIDTH_CM / 100) * canvasPxPerMeter,
          stepDepth: (PLAN_STAIR_DEFAULT_STEP_DEPTH_CM / 100) * canvasPxPerMeter,
          spiralPoleDiameter: (PLAN_STAIR_SPIRAL_POLE_DIAMETER_CM / 100) * canvasPxPerMeter,
          cornerStyle: 'round',
          cornerMode: 'turn',
          showUpArrow: false,
          invertUpArrow: true,
          spiralRotationDeg: 0,
        }
      : null
  const stairPreviewGeometry = stairPreviewStair ? buildStairGeometry(stairPreviewStair) : null
  const firstClickSnapPreviewRadiusCanvas = Math.max(
    2 / planView.zoom,
    drawPointRadiusCanvas * 0.85
  )
  const showFirstClickSnapPreview =
    !!currentMousePosition &&
    ((activeTool === 'drawWall' && !wallDrawingState.isDrawing) ||
      (activeTool === 'drawWallRect' && !wallDrawingState.rectStartPoint && !rectPointerActive) ||
      (activeTool === 'drawGraphicElement' && !graphicPointerState))
  const openingDragFitted = useMemo(() => {
    if (!openingPointerState || !activeFloor?.floorPlan) return null
    const baseWidth = getDefaultOpeningWidth(openingPointerState.kind)
    const placement = computeOpeningDragPlacement(
      openingPointerState.wall,
      openingPointerState.anchor,
      openingPointerState.current,
      baseWidth,
      6,
      {
        ...getOpeningPlacementOptions(openingPointerState.kind),
        forceDragSizing: openingPointerState.dragSizingLatched,
      }
    )
    const fitted = fitOpeningPlacementForPreview(
      openingPointerState.wall,
      placement,
      activeFloor.floorPlan.doors ?? [],
      activeFloor.floorPlan.windows ?? []
    )
    return {
      kind: openingPointerState.kind,
      wall: openingPointerState.wall,
      current: openingPointerState.current,
      placement,
      fitted,
    }
  }, [
    openingPointerState,
    activeFloor?.floorPlan,
    getDefaultOpeningWidth,
    getOpeningPlacementOptions,
  ])

  const openingDragPreview = (() => {
    if (!openingDragFitted) return null

    const geom = computeOpeningGeometry(
      openingDragFitted.wall.points,
      openingDragFitted.fitted.position
    )
    if (!geom) return null

    const half = openingDragFitted.fitted.width / 2
    const start = {
      x: geom.center.x - geom.tangent.x * half,
      y: geom.center.y - geom.tangent.y * half,
    }
    const end = {
      x: geom.center.x + geom.tangent.x * half,
      y: geom.center.y + geom.tangent.y * half,
    }
    return { start, end }
  })()

  const openingDragDimension = openingDragFitted
    ? {
        cursor: openingDragFitted.current,
        widthCm: openingWidthCentimeters(openingDragFitted.fitted.width, canvasPxPerMeter),
      }
    : null

  useEffect(() => {
    if (!openingPointerState) return

    const handleWindowTouchMove = (evt: TouchEvent) => {
      const touch = evt.touches[0]
      if (!touch) return
      const canvasPoint = clientCoordsToCanvasPoint(touch.clientX, touch.clientY)
      if (!canvasPoint) return
      setOpeningPointerState((prev) => {
        if (!prev) return prev
        const next = { ...prev, current: canvasPoint }
        if (prev.dragSizingLatched) return next
        const placement = computeOpeningDragPlacement(
          prev.wall,
          prev.anchor,
          canvasPoint,
          getDefaultOpeningWidth(prev.kind),
          6,
          getOpeningPlacementOptions(prev.kind)
        )
        return placement.isDraggingAlongWall ? { ...next, dragSizingLatched: true } : next
      })
      evt.preventDefault()
    }

    window.addEventListener('touchmove', handleWindowTouchMove, { capture: true, passive: false })
    return () => window.removeEventListener('touchmove', handleWindowTouchMove, true)
  }, [openingPointerState, clientCoordsToCanvasPoint, getDefaultOpeningWidth, getOpeningPlacementOptions])

  useEffect(() => {
    if (!onOpeningPreviewOverrideChange) return
    if (!openingDragFitted) {
      onOpeningPreviewOverrideChange(null)
      return
    }

    const doorOrientation =
      openingDragFitted.kind === 'door'
        ? resolvePlacementDoorOrientation(
            openingDragFitted.wall,
            openingDragFitted.fitted.position,
            openingDragFitted.current,
            openingDragFitted.placement.doorSwing,
            { useOpenSideDeadzone: false }
          )
        : null
    if (doorOrientation) {
      doorPlacementOpenSideRef.current = doorOrientation.openSide
    }

    onOpeningPreviewOverrideChange({
      wallId: openingDragFitted.wall.id,
      position: openingDragFitted.fitted.position,
      width: openingDragFitted.fitted.width,
      kind: openingDragFitted.kind,
      valid: true,
      ...(doorOrientation
        ? {
            doorSwing: doorOrientation.swing,
            doorDirection: doorOrientation.direction,
          }
        : {}),
    })
  }, [openingDragFitted, onOpeningPreviewOverrideChange, resolvePlacementDoorOrientation])

  useEffect(() => {
    return () => {
      onOpeningPreviewOverrideChange?.(null)
    }
  }, [onOpeningPreviewOverrideChange])

  if (!activeFloor) {
    return null
  }

  return (
    <>
      {/* Floor Plan Drawing Layer - render BEFORE placements so it can receive clicks when symbols have listening=false */}
      {isFloorPlanToolActive && (
        <Group
          listening={true}
          onPointerDown={handleFloorPlanPointerDown}
          onPointerUp={handleFloorPlanPointerUp}
          onPointerCancel={handleFloorPlanPointerUp}
          onPointerMove={handleFloorPlanMouseMove}
          onTouchStart={handleFloorPlanPointerDown}
          onTouchMove={handleFloorPlanMouseMove}
          onTouchEnd={handleFloorPlanPointerUp}
          onTouchCancel={handleFloorPlanPointerUp}
          onClick={handleFloorPlanClick}
          onTap={handleFloorPlanTap}
          onDblClick={handleFloorPlanDblClick}
          onContextMenu={(e) => {
            const action = resolveFloorPlanToolContextMenuAction(
              activeTool,
              wallDrawingState.isDrawing,
              wallDrawingState.currentPoints.length
            )
            if (action === 'ignore') return
            e.evt.preventDefault()
            e.cancelBubble = true
            if (action === 'commitPenAndDropTool') {
              commitCurrentPenDrawing()
            } else if (action === 'dropTool') {
              if (activeTool === 'drawWall') {
                suppressAutoCommitRef.current = true
                resetDrawingState()
              }
              if (activeTool === 'drawWallRect') commitCurrentRectangleDrawing()
              if (activeTool === 'drawStair') commitCurrentStairDrawing()
              if (activeTool === 'drawGraphicElement' && graphicPointerState) {
                commitGraphicElement(
                  graphicPointerState.start,
                  graphicPointerState.current,
                  graphicDidDragRef.current
                )
              }
              if (
                (activeTool === 'insertDoor' || activeTool === 'insertWindow') &&
                openingPointerState
              ) {
                commitOpeningInsert(
                  openingPointerState.kind,
                  openingPointerState.wall,
                  openingPointerState.anchor,
                  openingPointerState.current,
                  getDefaultOpeningWidth(openingPointerState.kind),
                  openingPointerState.dragSizingLatched
                )
              }
              setOpeningPointerState(null)
              onOpeningPreviewOverrideChange?.(null)
              onWallHover?.(null, null)
            }
            setActiveTool('select')
          }}
        >
          {/* Preview line while drawing */}
          {activeTool === 'drawWall' &&
            wallDrawingState.isDrawing &&
            wallDrawingState.currentPoints.length > 0 && (
              <>
                <Line
                  points={(() => {
                    if (
                      wallDrawingState.pendingCurve &&
                      wallDrawingState.currentPoints.length === 2 &&
                      currentMousePosition
                    ) {
                      return getWallPathPoints(
                        {
                          points: [...wallDrawingState.currentPoints, currentMousePosition],
                          curve: createQuarterCircleWallCurve(),
                        },
                        getCurveRenderMaxSegmentLength(planView.zoom)
                      ).flatMap((point) => [point.x, point.y])
                    }
                    return [
                      ...wallDrawingState.currentPoints.flatMap((point) => [point.x, point.y]),
                      ...(currentMousePosition
                        ? [currentMousePosition.x, currentMousePosition.y]
                        : []),
                    ]
                  })()}
                  stroke="#0284c7"
                  strokeWidth={drawStrokeCanvas}
                  dash={[drawDashCanvas, drawDashCanvas]}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
                {wallDrawingState.pendingCurve &&
                  wallDrawingState.currentPoints.length === 2 &&
                  currentMousePosition && (
                    <Line
                      points={[
                        wallDrawingState.currentPoints[0]!.x,
                        wallDrawingState.currentPoints[0]!.y,
                        wallDrawingState.currentPoints[1]!.x,
                        wallDrawingState.currentPoints[1]!.y,
                        currentMousePosition.x,
                        currentMousePosition.y,
                      ]}
                      stroke="#0284c7"
                      strokeWidth={drawStrokeCanvas * 0.75}
                      dash={[drawDashCanvas * 0.5, drawDashCanvas * 0.5]}
                      opacity={0.55}
                      listening={false}
                    />
                  )}
              </>
            )}

          {/* Stair preview path while drawing */}
          {activeTool === 'drawStair' && stairDrawingPoints.length > 0 && (
            <>
              {stairPreviewGeometry && stairPreviewGeometry.outlinePoints.length >= 6 && (
                <>
                  <Line
                    points={stairPreviewGeometry.outlinePoints}
                    closed
                    stroke={stairPreviewColor}
                    strokeWidth={stairPreviewMetrics.outlineStroke}
                    lineCap="round"
                    lineJoin="round"
                    listening={false}
                  />
                  {stairPreviewGeometry.spiralPoleRadius && stairPreviewGeometry.spiralCenter && (
                    <Circle
                      x={stairPreviewGeometry.spiralCenter.x}
                      y={stairPreviewGeometry.spiralCenter.y}
                      radius={stairPreviewGeometry.spiralPoleRadius}
                      stroke={stairPreviewColor}
                      strokeWidth={stairPreviewMetrics.outlineStroke}
                      fill="rgba(0,0,0,0.001)"
                      listening={false}
                    />
                  )}
                  {stairPreviewGeometry.stepLines.map(([start, end], index) => (
                    <Line
                      key={`stair-preview-step-${index}`}
                      points={[start.x, start.y, end.x, end.y]}
                      stroke={stairPreviewGeometry.stepLineColors?.[index] ?? stairPreviewColor}
                      strokeWidth={stairPreviewMetrics.stepStroke}
                      lineCap="round"
                      listening={false}
                    />
                  ))}
                </>
              )}
              {stairDrawingPoints.length > 1 && (
                <Line
                  points={stairDrawingPoints.flatMap((p) => [p.x, p.y])}
                  stroke="#0284c7"
                  strokeWidth={stairPreviewMetrics.arrowStroke}
                  dash={[drawDashCanvas, drawDashCanvas]}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
              )}
              {stairDrawingPoints.map((point, index) => (
                <Circle
                  key={`stair-preview-point-${index}`}
                  name="floor-plan-draft-point"
                  x={point.x}
                  y={point.y}
                  radius={drawPointRadiusCanvas * 0.9}
                  fill={index === 0 && stairSpiralPreviewActive ? '#0284c7' : '#334155'}
                  stroke="#ffffff"
                  strokeWidth={drawStrokeCanvas}
                  listening={true}
                  draggable
                  onDragStart={(e) => beginDraftPointDrag('drawStair', index, e)}
                  onDragMove={(e) => moveDraftPointDrag('drawStair', index, e)}
                  onDragEnd={(e) => endDraftPointDrag('drawStair', index, e)}
                  onTap={(e) => {
                    if (Date.now() < suppressDraftPointTapUntilRef.current) {
                      e.cancelBubble = true
                      return
                    }
                    // Spiral stair: tap the sole center point to finish.
                    if (index === 0 && stairDrawingPoints.length === 1) {
                      e.cancelBubble = true
                      commitCurrentStairDrawing()
                    }
                  }}
                  onClick={(e) => {
                    if (Date.now() < suppressDraftPointTapUntilRef.current) {
                      e.cancelBubble = true
                      return
                    }
                    if (index === 0 && stairDrawingPoints.length === 1) {
                      e.cancelBubble = true
                      commitCurrentStairDrawing()
                    }
                  }}
                />
              ))}
            </>
          )}

          {/* Always show the exact snapped position of the next stair point. */}
          {activeTool === 'drawStair' && currentMousePosition && (
            <Circle
              x={currentMousePosition.x}
              y={currentMousePosition.y}
              radius={drawPointRadiusCanvas * 0.9}
              fill="#334155"
              stroke="#ffffff"
              strokeWidth={drawStrokeCanvas}
              listening={false}
            />
          )}

          {activeTool === 'drawWall' && activeGeometrySnap && (
            <Circle
              x={activeGeometrySnap.point.x}
              y={activeGeometrySnap.point.y}
              radius={drawPointRadiusCanvas * (activeGeometrySnap.kind === 'endpoint' ? 1.2 : 0.9)}
              fill={activeGeometrySnap.kind === 'endpoint' ? '#22c55e' : '#ffffff'}
              stroke="#22c55e"
              strokeWidth={drawStrokeCanvas * 1.5}
              listening={false}
            />
          )}

          {/* Where the first drawing point will snap (grid + projected snap guides) */}
          {showFirstClickSnapPreview && currentMousePosition && (
            <Circle
              x={currentMousePosition.x}
              y={currentMousePosition.y}
              radius={firstClickSnapPreviewRadiusCanvas}
              fill="#0284c7"
              stroke="#ffffff"
              strokeWidth={drawStrokeCanvas}
              listening={false}
            />
          )}

          {/* Preview points while drawing */}
          {activeTool === 'drawWall' &&
            wallDrawingState.isDrawing &&
            wallDrawingState.currentPoints.map((point, index) => (
              <Circle
                key={`preview-point-${index}`}
                name="floor-plan-draft-point"
                x={point.x}
                y={point.y}
                radius={drawPointRadiusCanvas}
                fill="#0284c7"
                stroke="#ffffff"
                strokeWidth={drawStrokeCanvas}
                listening={true}
                draggable
                onDragStart={(e) => beginDraftPointDrag('drawWall', index, e)}
                onDragMove={(e) => moveDraftPointDrag('drawWall', index, e)}
                onDragEnd={(e) => endDraftPointDrag('drawWall', index, e)}
                onClick={(e) => {
                  if (Date.now() < suppressDraftPointTapUntilRef.current) {
                    e.cancelBubble = true
                    return
                  }
                  if (activeTool !== 'drawWall') return
                  if (!activeFloorId) return
                  // Only special-case the very first point: clicking it closes and commits.
                  if (index === 0 && wallDrawingState.currentPoints.length >= 3) {
                    e.cancelBubble = true
                    const first = wallDrawingState.currentPoints[0]!
                    const closedPoints = [...wallDrawingState.currentPoints, first]
                    commitWallWithUndo(activeFloorId, closedPoints)
                    resetDrawingState()
                    setActiveTool('drawWall')
                    return
                  }
                }}
                onTap={(e) => {
                  if (Date.now() < suppressDraftPointTapUntilRef.current) {
                    e.cancelBubble = true
                    return
                  }
                  if (activeTool !== 'drawWall') return
                  if (!activeFloorId) return
                  if (index === 0 && wallDrawingState.currentPoints.length >= 3) {
                    e.cancelBubble = true
                    const first = wallDrawingState.currentPoints[0]!
                    const closedPoints = [...wallDrawingState.currentPoints, first]
                    commitWallWithUndo(activeFloorId, closedPoints)
                    resetDrawingState()
                    setActiveTool('drawWall')
                    return
                  }
                }}
              />
            ))}

          {/* Drag-preview for door/window insertion: appears from pointer-down, commits on release */}
          {openingDragPreview && (
            <Line
              points={[
                openingDragPreview.start.x,
                openingDragPreview.start.y,
                openingDragPreview.end.x,
                openingDragPreview.end.y,
              ]}
              stroke="#0284c7"
              strokeWidth={drawStrokeCanvas}
              dash={[drawDashCanvas, drawDashCanvas]}
              lineCap="round"
              listening={false}
            />
          )}

          {openingDragDimension &&
            (() => {
              const label = `${openingDragDimension.widthCm} cm`
              const fontSize = 13 / planView.zoom
              const paddingX = 8 / planView.zoom
              const paddingY = 4 / planView.zoom
              const approxCharWidth = fontSize * 0.6
              const textWidth = Math.max(24 / planView.zoom, label.length * approxCharWidth)
              const boxWidth = textWidth + paddingX * 2
              const boxHeight = fontSize + paddingY * 2
              const cursorGap = 8 / planView.zoom
              const boxX = openingDragDimension.cursor.x + cursorGap
              const boxY = openingDragDimension.cursor.y - cursorGap - boxHeight

              return (
                <>
                  <Rect
                    x={boxX}
                    y={boxY}
                    width={boxWidth}
                    height={boxHeight}
                    fill={theme.mode === 'dark' ? 'rgba(17,24,39,0.9)' : 'rgba(243,244,246,0.95)'}
                    stroke={theme.mode === 'dark' ? '#e5e7eb' : '#111827'}
                    strokeWidth={drawStrokeCanvas}
                    cornerRadius={drawHandleRadiusCanvas * 0.5}
                    listening={false}
                  />
                  <Text
                    x={boxX}
                    y={boxY}
                    width={boxWidth}
                    height={boxHeight}
                    align="center"
                    verticalAlign="middle"
                    text={label}
                    fontSize={fontSize}
                    fontFamily={fontFamily}
                    fill={theme.mode === 'dark' ? '#f9fafb' : '#111827'}
                    listening={false}
                  />
                </>
              )
            })()}

          {/* Rectangle preview while drawing */}
          {activeTool === 'drawWallRect' &&
            wallDrawingState.rectStartPoint &&
            currentMousePosition &&
            (() => {
              const start = wallDrawingState.rectStartPoint
              let end = snapToGrid(currentMousePosition, gridSize, planView.snapToGrid)
              if (rectLockedXMeters != null) {
                const dx = end.x - start.x
                const signX = dx >= 0 ? 1 : -1
                const targetPxX = rectLockedXMeters * canvasPxPerMeter
                end = {
                  ...end,
                  x: start.x + signX * targetPxX,
                }
              }
              if (rectLockedYMeters != null) {
                const dy = end.y - start.y
                const signY = dy >= 0 ? 1 : -1
                const targetPxY = rectLockedYMeters * canvasPxPerMeter
                end = {
                  ...end,
                  y: start.y + signY * targetPxY,
                }
              }
              const points = handleDrawWallRect(start, end, gridSize, planView.snapToGrid)
              if (points.length < 2) return null
              return (
                <Line
                  points={points.flatMap((p) => [p.x, p.y])}
                  stroke="#0284c7"
                  strokeWidth={drawStrokeCanvas}
                  dash={[drawDashCanvas, drawDashCanvas]}
                  lineCap="round"
                  lineJoin="round"
                  closed={true}
                  listening={false}
                />
              )
            })()}

          {activeTool === 'drawGraphicElement' &&
            graphicPointerState &&
            graphicDidDragRef.current &&
            (() => {
              const asset = getPlanGraphicElementAsset(selectedGraphicAssetId)
              if (!asset) return null
              const left = Math.min(graphicPointerState.start.x, graphicPointerState.current.x)
              const top = Math.min(graphicPointerState.start.y, graphicPointerState.current.y)
              const width = Math.abs(graphicPointerState.current.x - graphicPointerState.start.x)
              const height = Math.abs(graphicPointerState.current.y - graphicPointerState.start.y)
              if (width <= 1 || height <= 1) return null
              const previewWidth = asset.sizeLocked
                ? asset.defaultWidthMeters * canvasPxPerMeter
                : width
              const previewHeight = asset.sizeLocked
                ? asset.defaultHeightMeters * canvasPxPerMeter
                : height
              return (
                <Group x={left + width / 2} y={top + height / 2} opacity={0.9} listening={false}>
                  <PlanGraphicElementShape
                    element={{
                      kind: asset.kind,
                      width: previewWidth,
                      height: previewHeight,
                    }}
                    themeMode={theme.mode}
                    strokeColor="#0284c7"
                  />
                </Group>
              )
            })()}

          {/* Transparent hit area to capture clicks on empty space */}
          <Rect
            name="floor-plan-hit-area"
            x={-10000}
            y={-10000}
            width={20000}
            height={20000}
            fill="transparent"
            listening={true}
            perfectDrawEnabled={false}
          />
        </Group>
      )}
    </>
  )
}
