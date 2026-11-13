import { INTERACTIVE_OVERLAY_EXPORT_NAME } from '@/lib/export/interactiveOverlayExport'
import { useWallVolumeComponents } from './useWallVolumeComponents'
import React from 'react'
import { Group, Line, Circle, Rect, Arc } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Wall, Door, Window, Point2 } from '@/types/schema'
import { getThemeColor } from '@/lib/theme/colors'
import { pointInPolygon, clamp } from '@/lib/geometry'
import { WALL_POINT_HANDLE_KONVA_NAME } from '@/constants/planConstants'
import type { ThemeWallColors } from '@/types/ui'
import { getRoomPolygonsFromWalls } from '@/lib/plan/roomPolygons'
import {
  DRAW_TOOL_POINT_RADIUS_PX,
  DRAW_TOOL_POINT_RADIUS_PX_MAX,
  DRAW_TOOL_POINT_RADIUS_PX_MIN,
  DRAW_TOOL_STROKE_PX,
  DRAW_TOOL_STROKE_PX_MAX,
  DRAW_TOOL_STROKE_PX_MIN,
  SELECTION_OUTLINE_STROKE_PX,
  SELECTION_OUTLINE_STROKE_PX_MAX,
  SELECTION_OUTLINE_STROKE_PX_MIN,
  screenPxToCanvasUnits,
} from '@/constants/canvasConstants'
import { getTouchPointHitRadiusCanvas } from '@/lib/canvas/touchHitZones'
import { useTouchPrimaryDevice } from '@/hooks/useTouchPrimaryDevice'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useUIStore } from '@/stores/uiStore'
import { indexedPointMapsEqual, parseWallPointIds } from '@/lib/plan/wallPointSelection'
import {
  getCurvedWallToolHoverFeedback,
  getCurveRenderMaxSegmentLength,
  isCurvedWall,
  wallWithDerivedPath,
} from '@/lib/plan/wallCurve'
const INTERACTIVE_HIT_FILL = 'rgba(0,0,0,0.001)'
import { getWallTotalLength, getWallPathBetweenDistances } from '@/handlers/plan/wallDrawing'
import {
  buildSimpleWallFallbackPaths,
  buildOpeningCornerFusions,
  extendSimpleWallPathEnds,
  isOpeningFrameCenterFused,
  resolveWallThicknessPx,
} from '@/lib/plan/wallVolumeGeometry'
import type { DistanceMeasurementInterval } from '@/lib/plan/segmentMeasurements'
import { SegmentMeasurementOverlay } from './SegmentMeasurementOverlay'
import { MergedWallVolumeShape } from './MergedWallVolumeShape'
import { getOpeningRenderMetrics } from '@/lib/plan/openingPlanScale'
import { getWallOutlineStrokeWidth } from '@/lib/plan/wallPlanScale'
import type { DimensionDragModifiers } from '@/lib/plan/dimensionDragGesture'

type WallPointerEvent = KonvaEventObject<MouseEvent | TouchEvent>
type WallMouseEvent = KonvaEventObject<MouseEvent>
type WallDragEvent = KonvaEventObject<DragEvent>

interface WallRendererProps {
  walls: Wall[]
  doors: Door[]
  windows: Window[]
  masterWallThickness: number
  /** Pixels per meter based on floor scale; used to convert cm → px. */
  pxPerMeter?: number | null
  /** Current plan interaction tool; used to refresh handlers when tool behavior changes. */
  interactionMode?: string
  /** Current canvas zoom; used to keep draw handles readable in screen space. */
  zoom?: number
  selectedWallIds?: string[]
  selectedPointIndices?: Map<string, number[]>
  selectedSegmentIndices?: Map<string, number[]>
  /** Draw CAD-like length guides on selected wall segments. */
  showSegmentMeasurements?: boolean
  hoveredWallId?: string | null
  hoveredDoorId?: string | null
  hoveredWindowId?: string | null
  selectedDoorIds?: string[]
  selectedWindowIds?: string[]
  onWallClick?: (wallId: string, event: WallPointerEvent) => void
  onWallMouseMove?: (wallId: string, event: WallMouseEvent) => void
  onWallMouseLeave?: (event: WallMouseEvent) => void
  onWallDragStart?: (wallId: string, event: WallDragEvent) => void
  onWallDragMove?: (wallId: string, event: WallDragEvent) => void
  onWallDragEnd?: (wallId: string, event: WallDragEvent) => void
  onPointClick?: (wallId: string, pointIndex: number, event: WallPointerEvent) => void
  onPointDragStart?: (wallId: string, pointIndex: number, event: WallDragEvent) => void
  onPointDragMove?: (
    wallId: string,
    pointIndex: number,
    newPos: Point2,
    event: WallDragEvent
  ) => Point2 | void
  onPointDragEnd?: (wallId: string, pointIndex: number, newPos: Point2) => void
  onDoorClick?: (doorId: string, event: WallPointerEvent) => void
  onDoorMouseEnter?: (doorId: string) => void
  onDoorMouseLeave?: () => void
  onWindowClick?: (windowId: string, event: WallPointerEvent) => void
  onWindowMouseEnter?: (windowId: string) => void
  onWindowMouseLeave?: () => void
  /** When false, door shapes do not receive pointer events. */
  doorsListening?: boolean
  /** When false, window shapes do not receive pointer events. */
  windowsListening?: boolean
  showPointHandles?: boolean
  /** When true, point handles are draggable (e.g. movePoint tool). */
  pointHandlesDraggable?: boolean
  /** When true, selected walls can be dragged as a group. */
  draggableSelectedWalls?: boolean
  theme?: 'light' | 'dark'
  /** When false, walls/points do not receive pointer events (e.g. when not in floor plan edit mode). */
  listening?: boolean
  /** When false, wall paths/points do not receive pointer events. */
  wallsListening?: boolean
  /** Ghost door/window preview when insert tool is active and placement is valid. */
  previewOpening?: {
    wallId: string
    position: number
    width: number
    kind: 'door' | 'window'
    doorSwing?: 'left' | 'right'
    doorDirection?: 'in' | 'out'
  } | null
  /** Wall colour overrides from settings — pass from a DOM ancestor (required under react-konva). */
  customWallColors?: ThemeWallColors
  onSegmentLengthCommit?: (wallId: string, segmentIndex: number, lengthCm: number) => void
  onOpeningDistanceCommit?: (
    wallId: string,
    openingId: string,
    side: 'start' | 'end',
    lengthCm: number
  ) => void
  onSegmentDimensionDrag?: (
    wallId: string,
    segmentIndex: number,
    delta: Point2,
    phase: 'start' | 'preview' | 'commit' | 'cancel',
    modifiers: DimensionDragModifiers
  ) => void
}

/**
 * Render walls, doors, and windows on the canvas.
 */
function WallRendererInner({
  walls,
  doors,
  windows,
  masterWallThickness,
  pxPerMeter = null,
  interactionMode = 'none',
  zoom = 1,
  selectedWallIds = [],
  selectedPointIndices = new Map(),
  selectedSegmentIndices = new Map(),
  showSegmentMeasurements = false,
  hoveredWallId = null,
  hoveredDoorId = null,
  hoveredWindowId = null,
  onWallClick,
  onWallMouseMove,
  onWallMouseLeave,
  onWallDragStart,
  onWallDragMove,
  onWallDragEnd,
  onPointClick,
  onPointDragStart,
  onPointDragMove,
  onPointDragEnd,
  selectedDoorIds = [],
  selectedWindowIds = [],
  onDoorClick,
  onDoorMouseEnter,
  onDoorMouseLeave,
  onWindowClick,
  onWindowMouseEnter,
  onWindowMouseLeave,
  doorsListening = true,
  windowsListening = true,
  showPointHandles = false,
  pointHandlesDraggable = false,
  draggableSelectedWalls = false,
  theme = 'light',
  listening = true,
  wallsListening = listening,
  previewOpening = null,
  customWallColors,
  onSegmentLengthCommit,
  onOpeningDistanceCommit,
  onSegmentDimensionDrag,
}: WallRendererProps) {
  const touchPrimary = useTouchPrimaryDevice()
  const wallPointSelectionFromStore = useStoreWithEqualityFn(
    useUIStore,
    (s) => (s.selection.type === 'wallPoint' ? parseWallPointIds(s.selection.ids) : null),
    (a, b) =>
      a === b || (a != null && b != null && indexedPointMapsEqual(a, b)) || (a == null && b == null)
  )
  const pointIndicesForRender = wallPointSelectionFromStore ?? selectedPointIndices
  const trackPointerHover = interactionMode !== 'select'
  const selectionColor = getThemeColor(theme, 'selectionColor')
  const selectionPathDimmedColor = getThemeColor(theme, 'selectionPathDimmedColor')
  const invalidWallToolHoverColor = '#ef4444'
  const pointHandleBaseColor = '#ffffff'
  const pointHandleStrokeColor = '#0284c7'
  const windowColor = theme === 'dark' ? '#0284c7' : '#0284c7'

  const { wallVolumeComponents, wallVolumeFallbackActive } = useWallVolumeComponents(
    walls, doors, windows, masterWallThickness, pxPerMeter
  )

  const simpleWallFallbackPaths = React.useMemo(
    () => buildSimpleWallFallbackPaths(walls, doors, windows, masterWallThickness, pxPerMeter),
    [doors, masterWallThickness, pxPerMeter, walls, windows]
  )
  const simpleWallFallbackPathByWallId = React.useMemo(() => {
    const paths = new Map<string, (typeof simpleWallFallbackPaths)[number]>()
    for (const path of simpleWallFallbackPaths) {
      for (const wallId of path.wallIds) paths.set(wallId, path)
    }
    return paths
  }, [simpleWallFallbackPaths])

  // Group doors and windows by wall ID for efficient lookup
  const doorsByWall = new Map<string, Door[]>()
  const windowsByWall = new Map<string, Window[]>()

  doors.forEach((door) => {
    const existing = doorsByWall.get(door.wallId) || []
    existing.push(door)
    doorsByWall.set(door.wallId, existing)
  })

  windows.forEach((window) => {
    const existing = windowsByWall.get(window.wallId) || []
    existing.push(window)
    windowsByWall.set(window.wallId, existing)
  })

  const roomPolygons = React.useMemo(() => getRoomPolygonsFromWalls(walls), [walls])

  const isInsideAnyRoom = (p: Point2): boolean =>
    roomPolygons.some((poly) => pointInPolygon(p, poly))

  /**
   * Derive solid wall segments (distance intervals) by subtracting door/window openings.
   * With butt lineCap, openings use the exact door/window width (no extra inset).
   */
  const getWallSolidIntervals = (
    points: Point2[],
    wallDoors: Door[],
    wallWindows: Window[],
    _thickness: number
  ): [number, number][] => {
    const totalLength = getWallTotalLength(points)
    if (totalLength < 1e-10) return [[0, totalLength]]

    const gaps: [number, number][] = []
    for (const door of wallDoors) {
      const centerDist = door.position * totalLength
      const start = Math.max(0, centerDist - door.width / 2)
      const end = Math.min(totalLength, centerDist + door.width / 2)
      if (end > start + 1e-8) gaps.push([start, end])
    }
    for (const win of wallWindows) {
      const centerDist = win.position * totalLength
      const start = Math.max(0, centerDist - win.width / 2)
      const end = Math.min(totalLength, centerDist + win.width / 2)
      if (end > start + 1e-8) gaps.push([start, end])
    }
    if (gaps.length === 0) return [[0, totalLength]]

    gaps.sort((a, b) => a[0] - b[0])
    const merged: [number, number][] = [gaps[0]!]
    for (let i = 1; i < gaps.length; i++) {
      const [s, e] = gaps[i]!
      const last = merged[merged.length - 1]!
      if (s <= last[1] + 1e-8) {
        last[1] = Math.max(last[1], e)
      } else {
        merged.push([s, e])
      }
    }
    const solids: [number, number][] = []
    let prevEnd = 0
    for (const [gs, ge] of merged) {
      if (gs > prevEnd + 1e-8) solids.push([prevEnd, gs])
      prevEnd = Math.max(prevEnd, ge)
    }
    if (totalLength > prevEnd + 1e-8) solids.push([prevEnd, totalLength])
    return solids
  }

  // Flatten Point2[] to Konva Line points [x1,y1,x2,y2,...]
  const pointsToLinePoints = (pts: Point2[]): number[] => {
    const out: number[] = []
    for (const p of pts) out.push(p.x, p.y)
    return out
  }

  /** Unit tangent at path start (into the wall) or end (out of the wall). */
  const getPathEndTangent = (points: Point2[], atStart: boolean): Point2 | null => {
    if (points.length < 2) return null
    const p1 = atStart ? points[0]! : points[points.length - 2]!
    const p2 = atStart ? points[1]! : points[points.length - 1]!
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 1e-10) return null
    return atStart ? { x: dx / len, y: dy / len } : { x: dx / len, y: dy / len }
  }

  // Get wall thickness
  const getWallThickness = React.useCallback(
    (wall: Wall): number => resolveWallThicknessPx(wall, masterWallThickness, pxPerMeter),
    [masterWallThickness, pxPerMeter]
  )

  const openingCornerFusions = React.useMemo(
    () => buildOpeningCornerFusions(walls, doors, windows, masterWallThickness, pxPerMeter),
    [doors, masterWallThickness, pxPerMeter, walls, windows]
  )

  const selectedDoorIdSet = React.useMemo(() => new Set(selectedDoorIds), [selectedDoorIds])
  const selectedWindowIdSet = React.useMemo(() => new Set(selectedWindowIds), [selectedWindowIds])
  const modeKey = theme // 'light' | 'dark'
  const customForMode = customWallColors ? customWallColors[modeKey] : undefined
  const baseFillColor =
    customForMode?.stroke ??
    (theme === 'dark' ? getThemeColor(theme, 'grid') : getThemeColor(theme, 'gray200'))
  const baseBorderColor = customForMode?.fill ?? getThemeColor(theme, 'wallColor')
  const openingFrameColor = customForMode?.fill ?? getThemeColor(theme, 'wallColor')
  const wallOutlineStrokeWidth = getWallOutlineStrokeWidth(pxPerMeter)
  const wallVolumeStyleByWallId = React.useMemo(() => {
    const styleByWallId = new Map<string, { fillColor: string; borderColor: string }>()
    if (!wallVolumeComponents) return styleByWallId

    for (const component of wallVolumeComponents) {
      for (const wallId of component.wallIds) {
        styleByWallId.set(wallId, {
          fillColor: baseFillColor,
          borderColor: baseBorderColor,
        })
      }
    }

    return styleByWallId
  }, [baseBorderColor, baseFillColor, wallVolumeComponents])
  const orderedWalls = React.useMemo(() => {
    if (selectedWallIds.length === 0) return walls
    const selectedSet = new Set(selectedWallIds)
    const unselected: Wall[] = []
    const selected: Wall[] = []
    for (const wall of walls) {
      if (selectedSet.has(wall.id)) {
        selected.push(wall)
      } else {
        unselected.push(wall)
      }
    }
    // Draw selected/scoped walls last so their handles are top-most in overlap cases.
    return [...unselected, ...selected]
  }, [walls, selectedWallIds])

  // Render a door on a wall
  const renderDoor = (door: Door, wall: Wall, wallFillColor: string) => {
    if (wall.points.length < 2) return null

    // Calculate position along wall (center and tangent)
    let totalLength = 0
    const segmentLengths: number[] = []
    for (let i = 0; i < wall.points.length - 1; i++) {
      const p1 = wall.points[i]!
      const p2 = wall.points[i + 1]!
      const segLen = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2))
      segmentLengths.push(segLen)
      totalLength += segLen
    }

    const targetLength = door.position * totalLength
    let accumulatedLength = 0
    let center: Point2 | null = null
    let wallDirection: Point2 | null = null

    for (let i = 0; i < wall.points.length - 1; i++) {
      const segLen = segmentLengths[i] ?? 0
      if (accumulatedLength + segLen >= targetLength) {
        const p1 = wall.points[i]!
        const p2 = wall.points[i + 1]!
        const t = segLen > 0 ? (targetLength - accumulatedLength) / segLen : 0
        center = {
          x: p1.x + t * (p2.x - p1.x),
          y: p1.y + t * (p2.y - p1.y),
        }

        const dx = p2.x - p1.x
        const dy = p2.y - p1.y
        const length = Math.sqrt(dx * dx + dy * dy)
        if (length > 0) {
          wallDirection = { x: dx / length, y: dy / length }
        }
        break
      }
      accumulatedLength += segLen
    }

    if (!center || !wallDirection) return null

    const thickness = getWallThickness(wall)
    const isSelected = selectedDoorIds.includes(door.id)
    const isHovered = hoveredDoorId === door.id
    const openingMetrics = getOpeningRenderMetrics(pxPerMeter)
    const openingStrokeWidth = openingMetrics.strokeWidth
    const baseFrameColor = wallFillColor
    const baseSwingColor = getThemeColor(theme, 'doorColor')
    const frameStrokeColor = isSelected ? selectionColor : baseFrameColor
    const swingStrokeColor = isSelected ? selectionColor : baseSwingColor
    const angleDeg = (Math.atan2(wallDirection.y, wallDirection.x) * 180) / Math.PI

    // Split the opening into three parts along the wall:
    // - two frame blocks at the ends
    // - one central leaf (door) between them
    const frameLen = openingMetrics.frameLength
    const middleLen = Math.max(door.width - 2 * frameLen, thickness * 0.5)
    const dirX = wallDirection.x
    const dirY = wallDirection.y
    const frameCenterOffset = door.width / 2 - frameLen / 2
    const frameHeight = thickness * 0.9
    const leafHeight = openingMetrics.doorLeafHeight

    const leftCenter = {
      x: center.x - dirX * frameCenterOffset,
      y: center.y - dirY * frameCenterOffset,
    }
    const rightCenter = {
      x: center.x + dirX * frameCenterOffset,
      y: center.y + dirY * frameCenterOffset,
    }
    const fuseStartFrame = isOpeningFrameCenterFused(
      openingCornerFusions,
      'door',
      door.id,
      leftCenter,
      rightCenter
    )
    const fuseEndFrame = isOpeningFrameCenterFused(
      openingCornerFusions,
      'door',
      door.id,
      rightCenter,
      leftCenter
    )

    // Door swing properties
    const swingMode: 'left' | 'right' | 'none' | 'double' = door.swing ?? 'right'
    const logicalDirection: 'in' | 'out' = door.direction ?? 'out'
    const activeSides: Array<'left' | 'right'> =
      swingMode === 'double' ? ['left', 'right'] : swingMode === 'none' ? [] : [swingMode]
    const angleOffsetDeg = Number.isFinite(door.swingAngleDeg ?? NaN)
      ? clamp(door.swingAngleDeg as number, 1, 100)
      : 35
    const leftNormal = { x: -dirY, y: dirX }
    const probeOffset = Math.max(openingMetrics.roomProbeMinimum, thickness * 0.75)
    const leftProbe = {
      x: center.x + leftNormal.x * probeOffset,
      y: center.y + leftNormal.y * probeOffset,
    }
    const rightProbe = {
      x: center.x - leftNormal.x * probeOffset,
      y: center.y - leftNormal.y * probeOffset,
    }
    const leftInside = isInsideAnyRoom(leftProbe)
    const rightInside = isInsideAnyRoom(rightProbe)
    const interiorSide: 'left' | 'right' | null =
      leftInside && !rightInside ? 'left' : rightInside && !leftInside ? 'right' : null

    const swingLength = swingMode === 'double' ? middleLen / 2 : middleLen
    const swingGeometries = activeSides.map((side) => {
      // Hinge sits on the inner edge of each frame block (towards the opening).
      const rawHingeBase = side === 'left' ? leftCenter : rightCenter
      const hingeOffsetAlongWall = side === 'left' ? frameLen / 2 : -frameLen / 2
      const hingePoint = {
        x: rawHingeBase.x + dirX * hingeOffsetAlongWall,
        y: rawHingeBase.y + dirY * hingeOffsetAlongWall,
      }
      const closedAngleDeg = side === 'left' ? angleDeg : angleDeg + 180
      const pickOpenSign = (): 1 | -1 => {
        if (!interiorSide) {
          // Fallback for ambiguous geometry: preserve legacy visual behavior.
          const fallbackDirection: 'in' | 'out' =
            side === 'left' ? (logicalDirection === 'in' ? 'out' : 'in') : logicalDirection
          return fallbackDirection === 'in' ? 1 : -1
        }

        const desiredSide =
          logicalDirection === 'in' ? interiorSide : interiorSide === 'left' ? 'right' : 'left'

        const candidate = (sign: 1 | -1): 'left' | 'right' => {
          const openAngleDeg = closedAngleDeg + sign * angleOffsetDeg
          const openRad = (openAngleDeg * Math.PI) / 180
          const vx = swingLength * Math.cos(openRad)
          const vy = swingLength * Math.sin(openRad)
          const d = vx * leftNormal.x + vy * leftNormal.y
          return d >= 0 ? 'left' : 'right'
        }

        return candidate(1) === desiredSide ? 1 : -1
      }

      const openSign = pickOpenSign()
      const openAngleDeg = closedAngleDeg + openSign * angleOffsetDeg
      const openRad = (openAngleDeg * Math.PI) / 180
      const doorTip = {
        x: hingePoint.x + swingLength * Math.cos(openRad),
        y: hingePoint.y + swingLength * Math.sin(openRad),
      }

      // Arc from closed toward open position (less accented color)
      let startAngle = closedAngleDeg
      let endAngle = openAngleDeg
      let sweep = endAngle - startAngle
      if (sweep < 0) {
        const tmp = startAngle
        startAngle = endAngle
        endAngle = tmp
        sweep = -sweep
      }

      return { side, hingePoint, doorTip, startAngle, sweep }
    })

    return (
      <Group
        key={`door-${door.id}`}
        listening={doorsListening}
        onClick={(e) => onDoorClick?.(door.id, e)}
        onTap={(e) => onDoorClick?.(door.id, e)}
        onMouseEnter={() => onDoorMouseEnter?.(door.id)}
        onMouseLeave={() => onDoorMouseLeave?.()}
      >
        {/* Invisible full-size hit rect for interaction / hover outline alignment */}
        <Rect
          x={center.x}
          y={center.y}
          width={door.width}
          height={thickness}
          offsetX={door.width / 2}
          offsetY={thickness / 2}
          rotation={angleDeg}
          strokeWidth={0}
          name={INTERACTIVE_OVERLAY_EXPORT_NAME} fill="rgba(0,0,0,0.001)"
        />
        {/* Door leaf in the middle */}
        <Rect
          x={center.x}
          y={center.y}
          width={middleLen}
          height={leafHeight}
          offsetX={middleLen / 2}
          offsetY={leafHeight / 2}
          rotation={angleDeg}
          stroke={frameStrokeColor}
          strokeWidth={openingStrokeWidth}
          listening={false}
        />

        {/* Left frame block */}
        {!fuseStartFrame && (
          <Rect
            x={leftCenter.x}
            y={leftCenter.y}
            width={frameLen}
            height={frameHeight}
            offsetX={frameLen / 2}
            offsetY={frameHeight / 2}
            rotation={angleDeg}
            stroke={frameStrokeColor}
            strokeWidth={openingStrokeWidth}
            listening={false}
          />
        )}

        {/* Right frame block */}
        {!fuseEndFrame && (
          <Rect
            x={rightCenter.x}
            y={rightCenter.y}
            width={frameLen}
            height={frameHeight}
            offsetX={frameLen / 2}
            offsetY={frameHeight / 2}
            rotation={angleDeg}
            stroke={frameStrokeColor}
            strokeWidth={openingStrokeWidth}
            listening={false}
          />
        )}

        {swingGeometries.map(({ side, hingePoint, doorTip, startAngle, sweep }) => (
          <Group key={`${door.id}-swing-${side}`}>
            {/* Door leaf (swing) */}
            <Line
              points={[hingePoint.x, hingePoint.y, doorTip.x, doorTip.y]}
              stroke={swingStrokeColor}
              strokeWidth={openingStrokeWidth}
              listening={false}
            />

            {/* Door swing arc */}
            <Arc
              x={hingePoint.x}
              y={hingePoint.y}
              innerRadius={swingLength}
              outerRadius={swingLength}
              angle={sweep}
              rotation={startAngle}
              stroke={swingStrokeColor}
              strokeWidth={openingMetrics.swingArcStrokeWidth}
              listening={false}
            />
          </Group>
        ))}

        {isHovered && (
          <Rect
            x={center.x}
            y={center.y}
            width={door.width}
            height={thickness}
            offsetX={door.width / 2}
            offsetY={thickness / 2}
            rotation={angleDeg}
            stroke="#eab308"
            strokeWidth={screenPxToCanvasUnits(
              zoom,
              SELECTION_OUTLINE_STROKE_PX,
              SELECTION_OUTLINE_STROKE_PX_MIN,
              SELECTION_OUTLINE_STROKE_PX_MAX
            )}
            dash={[screenPxToCanvasUnits(zoom, 6, 3, 12), screenPxToCanvasUnits(zoom, 4, 2, 8)]}
            listening={false}
          />
        )}
      </Group>
    )
  }

  // Render a window on a wall
  const renderWindow = (window: Window, wall: Wall, wallFillColor: string) => {
    if (wall.points.length < 2) return null

    // Similar calculation to door
    let totalLength = 0
    const segmentLengths: number[] = []
    for (let i = 0; i < wall.points.length - 1; i++) {
      const p1 = wall.points[i]!
      const p2 = wall.points[i + 1]!
      const segLen = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2))
      segmentLengths.push(segLen)
      totalLength += segLen
    }

    const targetLength = window.position * totalLength
    let accumulatedLength = 0
    let windowCenter: Point2 | null = null
    let wallDirection: Point2 | null = null

    for (let i = 0; i < wall.points.length - 1; i++) {
      const segLen = segmentLengths[i] ?? 0
      if (accumulatedLength + segLen >= targetLength) {
        const p1 = wall.points[i]!
        const p2 = wall.points[i + 1]!
        const t = segLen > 0 ? (targetLength - accumulatedLength) / segLen : 0
        windowCenter = {
          x: p1.x + t * (p2.x - p1.x),
          y: p1.y + t * (p2.y - p1.y),
        }

        const dx = p2.x - p1.x
        const dy = p2.y - p1.y
        const length = Math.sqrt(dx * dx + dy * dy)
        if (length > 0) {
          wallDirection = { x: dx / length, y: dy / length }
        }
        break
      }
      accumulatedLength += segLen
    }

    if (!windowCenter || !wallDirection) return null

    const thickness = getWallThickness(wall)
    const isSelected = selectedWindowIds.includes(window.id)
    const isHovered = hoveredWindowId === window.id
    const openingMetrics = getOpeningRenderMetrics(pxPerMeter)
    const openingStrokeWidth = openingMetrics.strokeWidth
    const frameStrokeColor = isSelected ? selectionColor : wallFillColor
    const glassStrokeColor = isSelected ? selectionColor : windowColor
    const angleDeg = (Math.atan2(wallDirection.y, wallDirection.x) * 180) / Math.PI

    // Similar three-part layout as doors, but with blue glass in the middle.
    const frameLen = openingMetrics.frameLength
    const middleLen = Math.max(window.width - 2 * frameLen, thickness * 0.5)
    const dirX = wallDirection.x
    const dirY = wallDirection.y
    const frameCenterOffset = window.width / 2 - frameLen / 2
    const frameHeight = thickness * 0.9
    const glassHeight = thickness * 0.2

    const leftCenter = {
      x: windowCenter.x - dirX * frameCenterOffset,
      y: windowCenter.y - dirY * frameCenterOffset,
    }
    const rightCenter = {
      x: windowCenter.x + dirX * frameCenterOffset,
      y: windowCenter.y + dirY * frameCenterOffset,
    }
    const fuseStartFrame = isOpeningFrameCenterFused(
      openingCornerFusions,
      'window',
      window.id,
      leftCenter,
      rightCenter
    )
    const fuseEndFrame = isOpeningFrameCenterFused(
      openingCornerFusions,
      'window',
      window.id,
      rightCenter,
      leftCenter
    )

    return (
      <Group
        key={`window-${window.id}`}
        listening={windowsListening}
        onClick={(e) => onWindowClick?.(window.id, e)}
        onTap={(e) => onWindowClick?.(window.id, e)}
        onMouseEnter={() => onWindowMouseEnter?.(window.id)}
        onMouseLeave={() => onWindowMouseLeave?.()}
      >
        {/* Invisible full-size hit rect for interaction / hover outline alignment */}
        <Rect
          x={windowCenter.x}
          y={windowCenter.y}
          width={window.width}
          height={thickness}
          offsetX={window.width / 2}
          offsetY={thickness / 2}
          rotation={angleDeg}
          strokeWidth={0}
          name={INTERACTIVE_OVERLAY_EXPORT_NAME} fill="rgba(0,0,0,0.001)"
        />

        {/* Glass in the middle */}
        <Rect
          x={windowCenter.x}
          y={windowCenter.y}
          width={middleLen}
          height={glassHeight}
          offsetX={middleLen / 2}
          offsetY={glassHeight / 2}
          rotation={angleDeg}
          stroke={glassStrokeColor}
          strokeWidth={openingStrokeWidth}
          listening={false}
        />

        {/* Left frame block */}
        {!fuseStartFrame && (
          <Rect
            x={leftCenter.x}
            y={leftCenter.y}
            width={frameLen}
            height={frameHeight}
            offsetX={frameLen / 2}
            offsetY={frameHeight / 2}
            rotation={angleDeg}
            stroke={frameStrokeColor}
            strokeWidth={openingStrokeWidth}
            listening={false}
          />
        )}

        {/* Right frame block */}
        {!fuseEndFrame && (
          <Rect
            x={rightCenter.x}
            y={rightCenter.y}
            width={frameLen}
            height={frameHeight}
            offsetX={frameLen / 2}
            offsetY={frameHeight / 2}
            rotation={angleDeg}
            stroke={frameStrokeColor}
            strokeWidth={openingStrokeWidth}
            listening={false}
          />
        )}

        {isHovered && (
          <Rect
            x={windowCenter.x}
            y={windowCenter.y}
            width={window.width}
            height={thickness}
            offsetX={window.width / 2}
            offsetY={thickness / 2}
            rotation={angleDeg}
            stroke="#eab308"
            strokeWidth={screenPxToCanvasUnits(
              zoom,
              SELECTION_OUTLINE_STROKE_PX,
              SELECTION_OUTLINE_STROKE_PX_MIN,
              SELECTION_OUTLINE_STROKE_PX_MAX
            )}
            dash={[screenPxToCanvasUnits(zoom, 6, 3, 12), screenPxToCanvasUnits(zoom, 4, 2, 8)]}
            listening={false}
          />
        )}
      </Group>
    )
  }

  const renderWallPointHandles = (wall: Wall) => {
    if (!showPointHandles) return null
    const selectedPointCount = pointIndicesForRender.get(wall.id)?.length ?? 0
    const hasVertexSubselection =
      (selectedSegmentIndices.get(wall.id)?.length ?? 0) > 0 ||
      (selectedPointCount > 0 && selectedPointCount !== wall.points.length)

    return wall.points.map((point, index) => {
      const isPointSelected = pointIndicesForRender.get(wall.id)?.includes(index) ?? false
      const showPointAsSelected = hasVertexSubselection && isPointSelected
      const pointRadius = screenPxToCanvasUnits(
        zoom,
        showPointAsSelected ? DRAW_TOOL_POINT_RADIUS_PX + 2 : DRAW_TOOL_POINT_RADIUS_PX,
        DRAW_TOOL_POINT_RADIUS_PX_MIN,
        DRAW_TOOL_POINT_RADIUS_PX_MAX + 2
      )
      const pointStroke = screenPxToCanvasUnits(
        zoom,
        (showPointAsSelected ? DRAW_TOOL_STROKE_PX + 1 : DRAW_TOOL_STROKE_PX) * 0.75,
        DRAW_TOOL_STROKE_PX_MIN,
        DRAW_TOOL_STROKE_PX_MAX + 1
      )
      const pointHitRadius = touchPrimary
        ? getTouchPointHitRadiusCanvas(zoom, pointRadius)
        : pointRadius
      const pointListening = wallsListening && !touchPrimary
      const pointDraggable = pointHandlesDraggable
      const bindPointPointer = {
        onDragStart: (event: WallDragEvent) => {
          onPointDragStart?.(wall.id, index, event)
        },
        onDragMove: (event: WallDragEvent) => {
          const node = event.target
          const clamped = onPointDragMove?.(wall.id, index, { x: node.x(), y: node.y() }, event)
          if (clamped != null) node.position(clamped)
        },
        onDragEnd: (event: WallDragEvent) => {
          const node = event.target
          onPointDragEnd?.(wall.id, index, { x: node.x(), y: node.y() })
        },
        onClick: (event: WallPointerEvent) => {
          event.cancelBubble = true
          onPointClick?.(wall.id, index, event)
        },
        onTap: (event: WallPointerEvent) => {
          event.cancelBubble = true
          onPointClick?.(wall.id, index, event)
        },
      }

      return (
        <Group key={`point-${wall.id}-${index}`}>
          <Circle
            name={WALL_POINT_HANDLE_KONVA_NAME}
            x={point.x}
            y={point.y}
            radius={pointRadius}
            fill={pointHandleBaseColor}
            stroke={pointHandleStrokeColor}
            strokeWidth={pointStroke}
            listening={pointListening}
            draggable={pointDraggable}
            {...bindPointPointer}
          />
          {touchPrimary && (
            <Circle
              x={point.x}
              y={point.y}
              radius={pointHitRadius}
              name={INTERACTIVE_OVERLAY_EXPORT_NAME} fill={INTERACTIVE_HIT_FILL}
              listening={wallsListening}
              draggable={pointDraggable}
              {...bindPointPointer}
            />
          )}
        </Group>
      )
    })
  }

  const renderCurveControlGuide = (wall: Wall) => {
    if (!showPointHandles || !isCurvedWall(wall)) return null
    const [start, control, end] = wall.points
    if (!start || !control || !end) return null
    const guideStrokeWidth = screenPxToCanvasUnits(zoom, 1, 0.75, 1.5)
    const guideDash = screenPxToCanvasUnits(zoom, 4, 2, 7)

    return (
      <Line
        key={`curve-control-guide-${wall.id}`}
        points={[start.x, start.y, control.x, control.y, end.x, end.y]}
        stroke={theme === 'dark' ? '#cbd5e1' : '#64748b'}
        strokeWidth={guideStrokeWidth}
        dash={[guideDash, guideDash]}
        lineCap="round"
        lineJoin="round"
        opacity={0.65}
        listening={false}
        perfectDrawEnabled={false}
      />
    )
  }

  return (
    <Group listening={listening}>
      {wallVolumeFallbackActive &&
        simpleWallFallbackPaths.map((path) => {
          const hasSelectedWall = path.wallIds.some((wallId) => selectedWallIds.includes(wallId))
          const hasHoveredWall = path.wallIds.includes(hoveredWallId ?? '')
          const pathBorderColor = hasSelectedWall
            ? selectionColor
            : hasHoveredWall
              ? selectionPathDimmedColor
              : baseBorderColor
          const outerPoints = path.closed
            ? path.points
            : extendSimpleWallPathEnds(path.points, wallOutlineStrokeWidth)
          return (
            <Group key={`simple-wall-fallback-${path.id}`} listening={false}>
              <Line
                points={pointsToLinePoints(outerPoints)}
                stroke={pathBorderColor}
                strokeWidth={path.thickness + wallOutlineStrokeWidth * 2}
                lineCap="butt"
                lineJoin="miter"
                closed={path.closed}
                perfectDrawEnabled={false}
              />
              <Line
                points={pointsToLinePoints(path.points)}
                stroke={baseFillColor}
                strokeWidth={path.thickness}
                lineCap="butt"
                lineJoin="miter"
                closed={path.closed}
                perfectDrawEnabled={false}
              />
            </Group>
          )
        })}
      {wallVolumeComponents?.map((component) => {
        const style = wallVolumeStyleByWallId.get(component.wallIds[0] ?? '')
        if (!style) return null
        return (
          <Group key={`merged-wall-volume-${component.id}`} listening={false}>
            <MergedWallVolumeShape
              paths={component.fillPaths}
              outlinePaths={component.outlinePaths}
              fill={style.fillColor}
              stroke={style.borderColor}
              strokeWidth={wallOutlineStrokeWidth}
            />
          </Group>
        )
      })}

      {/* Render walls */}
      {orderedWalls.map((sourceWall) => {
        const curved = isCurvedWall(sourceWall)
        const wall = wallWithDerivedPath(sourceWall, getCurveRenderMaxSegmentLength(zoom))
        const isSelected = selectedWallIds.includes(wall.id)
        const selectedSegments = curved ? [] : (selectedSegmentIndices.get(wall.id) ?? [])
        const selectedPointCount = pointIndicesForRender.get(wall.id)?.length ?? 0
        const hasSelectedVertices = selectedPointCount > 0
        const allPointsSelected = selectedPointCount === sourceWall.points.length
        const hasSelectedSegments = selectedSegments.length > 0
        const hasVertexSubselection =
          hasSelectedSegments || (hasSelectedVertices && !allPointsSelected)
        const isHovered = hoveredWallId === wall.id
        const isInvalidToolHover =
          curved && isHovered && getCurvedWallToolHoverFeedback(interactionMode) === 'invalid'
        const thickness = getWallThickness(wall)
        const defaultBorderColor = isInvalidToolHover
          ? invalidWallToolHoverColor
          : hasVertexSubselection
            ? selectionPathDimmedColor
            : isSelected
              ? selectionColor
              : isHovered
                ? selectionPathDimmedColor
                : baseBorderColor
        const mergedStyle = wallVolumeStyleByWallId.get(wall.id)
        const hasMergedWallVolume = mergedStyle != null
        const hasGroupedSimpleFallback =
          wallVolumeFallbackActive && simpleWallFallbackPathByWallId.has(wall.id)
        const fillColor = mergedStyle?.fillColor ?? baseFillColor
        const fillThickness = thickness
        const borderThickness = wallOutlineStrokeWidth
        const highlightThickness = screenPxToCanvasUnits(
          zoom,
          SELECTION_OUTLINE_STROKE_PX,
          SELECTION_OUTLINE_STROKE_PX_MIN,
          SELECTION_OUTLINE_STROKE_PX_MAX
        )
        const borderColor = mergedStyle?.borderColor ?? defaultBorderColor

        if (curved && !hasMergedWallVolume) {
          const linePts = pointsToLinePoints(wall.points)
          const capPoints = (atStart: boolean): number[] => {
            const tangent = getPathEndTangent(wall.points, atStart)
            if (!tangent) return []
            const point = atStart ? wall.points[0]! : wall.points[wall.points.length - 1]!
            const normal = { x: -tangent.y, y: tangent.x }
            const halfWidth = fillThickness / 2 + wallOutlineStrokeWidth
            return [
              point.x - normal.x * halfWidth,
              point.y - normal.y * halfWidth,
              point.x + normal.x * halfWidth,
              point.y + normal.y * halfWidth,
            ]
          }
          const bindCurvedWallPointer = {
            onDragStart: (event: WallDragEvent) => {
              if (!isSelected) return
              event.target.x(0)
              event.target.y(0)
              onWallDragStart?.(wall.id, event)
            },
            onDragMove: (event: WallDragEvent) => {
              if (!isSelected) return
              event.target.x(0)
              event.target.y(0)
              onWallDragMove?.(wall.id, event)
            },
            onDragEnd: (event: WallDragEvent) => {
              if (!isSelected) return
              event.target.x(0)
              event.target.y(0)
              onWallDragEnd?.(wall.id, event)
            },
            onClick: (event: WallPointerEvent) => onWallClick?.(wall.id, event),
            onTap: (event: WallPointerEvent) => onWallClick?.(wall.id, event),
            onMouseMove: trackPointerHover
              ? (event: WallMouseEvent) => onWallMouseMove?.(wall.id, event)
              : undefined,
            onMouseEnter: (event: WallMouseEvent) => onWallMouseMove?.(wall.id, event),
            onMouseLeave: (event: WallMouseEvent) => onWallMouseLeave?.(event),
          }

          return (
            <Group key={`wall-${wall.id}`}>
              <Line
                points={linePts}
                stroke={borderColor}
                strokeWidth={fillThickness + wallOutlineStrokeWidth * 2}
                lineCap="butt"
                lineJoin="round"
                listening={false}
                perfectDrawEnabled={false}
              />
              <Line
                points={linePts}
                stroke={fillColor}
                strokeWidth={fillThickness}
                lineCap="butt"
                lineJoin="round"
                listening={false}
                perfectDrawEnabled={false}
              />
              {[true, false].map((atStart) => (
                <Line
                  key={atStart ? 'curve-cap-start' : 'curve-cap-end'}
                  points={capPoints(atStart)}
                  stroke={borderColor}
                  strokeWidth={wallOutlineStrokeWidth}
                  lineCap="butt"
                  listening={false}
                  perfectDrawEnabled={false}
                />
              ))}
              <Line
                points={linePts}
                name={INTERACTIVE_OVERLAY_EXPORT_NAME} stroke="rgba(0,0,0,0.001)"
                strokeWidth={fillThickness + wallOutlineStrokeWidth * 2}
                lineCap="butt"
                lineJoin="round"
                listening={wallsListening}
                draggable={draggableSelectedWalls && isSelected}
                {...bindCurvedWallPointer}
              />
            </Group>
          )
        }

        // Detect geometrically closed walls (first and last points coincide).
        const isClosed =
          wall.points.length > 2 &&
          (() => {
            const first = wall.points[0]
            const last = wall.points[wall.points.length - 1]
            if (!first || !last) return false
            const dx = first.x - last.x
            const dy = first.y - last.y
            return dx * dx + dy * dy < 1e-4
          })()

        const wallDoors = doorsByWall.get(wall.id) ?? []
        const wallWindows = windowsByWall.get(wall.id) ?? []
        const selectedPoints = pointIndicesForRender.get(wall.id) ?? []
        const hasSelectedOpeningsOnWall =
          wallDoors.some((door) => selectedDoorIdSet.has(door.id)) ||
          wallWindows.some((window) => selectedWindowIdSet.has(window.id))
        const shouldMeasureWall =
          !curved && showSegmentMeasurements && (isSelected || selectedPoints.length > 0)
        const shouldMeasureOpenings = showSegmentMeasurements && hasSelectedOpeningsOnWall
        const segmentCount = Math.max(0, wall.points.length - 1)
        const measurementSegmentIndices = (() => {
          if (!shouldMeasureWall || segmentCount === 0) return []
          if (selectedPoints.length === 0 || selectedPoints.length >= wall.points.length) {
            return Array.from({ length: segmentCount }, (_unused, idx) => idx)
          }
          const indices = new Set<number>()
          for (const pointIndex of selectedPoints) {
            if (pointIndex > 0) indices.add(pointIndex - 1)
            if (pointIndex < segmentCount) indices.add(pointIndex)
          }
          return Array.from(indices).sort((a, b) => a - b)
        })()
        const editableMeasurementSegmentIndices = (() => {
          if (selectedSegments.length === 1) {
            const selectedSegment = selectedSegments[0]!
            return measurementSegmentIndices.includes(selectedSegment) ? [selectedSegment] : []
          }
          // Every visible measurement on a selected wall is an editing entry point.
          // Master can represent whole-wall selection with multiple selected segments; do not
          // let that representation silently turn every visible dimension back to read-only.
          if (isSelected) {
            return measurementSegmentIndices
          }
          return []
        })()
        const solidIntervals = getWallSolidIntervals(wall.points, wallDoors, wallWindows, thickness)
        const totalLength = getWallTotalLength(wall.points)
        const brightSelectedSegmentIndices = (() => {
          const indices = new Set<number>()
          if (!hasSelectedSegments || segmentCount === 0) return indices
          for (const idx of selectedSegments) {
            if (idx >= 0 && idx < segmentCount) indices.add(idx)
          }
          return indices
        })()
        const segmentDistanceStarts: number[] = []
        const segmentLengths: number[] = []
        {
          let accumulated = 0
          for (let i = 0; i < segmentCount; i++) {
            const p1 = wall.points[i]
            const p2 = wall.points[i + 1]
            const segLen = p1 && p2 ? Math.hypot(p2.x - p1.x, p2.y - p1.y) : 0
            segmentDistanceStarts.push(accumulated)
            segmentLengths.push(segLen)
            accumulated += segLen
          }
        }
        const sourceSegmentBounds = segmentDistanceStarts.map((start, idx) => ({
          index: idx,
          start,
          end: start + (segmentLengths[idx] ?? 0),
        }))
        const renderIntervals = solidIntervals.flatMap(([solidStart, solidEnd]) => {
          const pieces: Array<{ start: number; end: number; sourceSegmentIndex: number }> = []
          for (const seg of sourceSegmentBounds) {
            const start = Math.max(solidStart, seg.start)
            const end = Math.min(solidEnd, seg.end)
            if (end > start + 1e-8) {
              pieces.push({ start, end, sourceSegmentIndex: seg.index })
            }
          }
          return pieces
        })
        const openingMeasurementIntervals: DistanceMeasurementInterval[] = (() => {
          if (!shouldMeasureOpenings || totalLength <= 1e-6) return []

          const openingBounds = [
            ...wallDoors.map((door) => {
              const centerDist = door.position * totalLength
              const start = Math.max(0, centerDist - door.width / 2)
              const end = Math.min(totalLength, centerDist + door.width / 2)
              return { id: door.id, start, end, selected: selectedDoorIdSet.has(door.id) }
            }),
            ...wallWindows.map((window) => {
              const centerDist = window.position * totalLength
              const start = Math.max(0, centerDist - window.width / 2)
              const end = Math.min(totalLength, centerDist + window.width / 2)
              return { id: window.id, start, end, selected: selectedWindowIdSet.has(window.id) }
            }),
          ].filter((bound) => bound.end > bound.start + 1e-6)

          if (openingBounds.length === 0) return []

          const vertexDistances = sourceSegmentBounds.flatMap((segment) => [
            segment.start,
            segment.end,
          ])
          const landmarkDistances = Array.from(
            new Set(
              [...vertexDistances, ...openingBounds.flatMap((bound) => [bound.start, bound.end])]
                .map((distance) => clamp(totalLength, 0, distance))
                .map((distance) => Number(distance.toFixed(6)))
            )
          ).sort((a, b) => a - b)

          const epsilon = 1e-6
          const intervals: DistanceMeasurementInterval[] = []
          const seen = new Set<string>()

          for (const bound of openingBounds) {
            if (!bound.selected) continue
            const leftNeighbor = [...landmarkDistances]
              .reverse()
              .find((distance) => distance < bound.start - epsilon)
            const rightNeighbor = landmarkDistances.find(
              (distance) => distance > bound.end + epsilon
            )

            if (leftNeighbor != null && bound.start - leftNeighbor > epsilon) {
              const key = `${leftNeighbor.toFixed(6)}:${bound.start.toFixed(6)}`
              if (!seen.has(key)) {
                seen.add(key)
                intervals.push({
                  startDistance: leftNeighbor,
                  endDistance: bound.start,
                  openingId: bound.id,
                  openingSide: 'start',
                })
              }
            }
            if (rightNeighbor != null && rightNeighbor - bound.end > epsilon) {
              const key = `${bound.end.toFixed(6)}:${rightNeighbor.toFixed(6)}`
              if (!seen.has(key)) {
                seen.add(key)
                intervals.push({
                  startDistance: bound.end,
                  endDistance: rightNeighbor,
                  openingId: bound.id,
                  openingSide: 'end',
                })
              }
            }
          }

          return intervals
        })()

        return (
          <Group key={`wall-${wall.id}`}>
            {/* Wall segments: only solid parts between openings (terminator vertices on the line) */}
            {renderIntervals.map(
              ({ start: startDist, end: endDist, sourceSegmentIndex }, segIdx) => {
                const segmentPoints = getWallPathBetweenDistances(wall.points, startDist, endDist)
                const linePts = pointsToLinePoints(segmentPoints)
                const isFullWall = startDist <= 1e-8 && endDist >= totalLength - 1e-8
                const segmentIsBrightSelected =
                  hasVertexSubselection && brightSelectedSegmentIndices.has(sourceSegmentIndex)
                const segmentBorderColor = isInvalidToolHover
                  ? invalidWallToolHoverColor
                  : segmentIsBrightSelected
                    ? selectionColor
                    : hasVertexSubselection
                      ? selectionPathDimmedColor
                      : isSelected
                        ? selectionColor
                        : isHovered
                          ? selectionPathDimmedColor
                          : borderColor

                return (
                  <React.Fragment key={`seg-${segIdx}`}>
                    {hasGroupedSimpleFallback && (
                      <Line
                        points={linePts}
                        name={INTERACTIVE_OVERLAY_EXPORT_NAME} stroke={INTERACTIVE_HIT_FILL}
                        strokeWidth={fillThickness + borderThickness * 2}
                        lineCap="butt"
                        lineJoin="miter"
                        closed={isClosed && isFullWall}
                        listening={wallsListening}
                        fillEnabled={false}
                        hitStrokeWidth={fillThickness + borderThickness * 2}
                        draggable={draggableSelectedWalls && isSelected}
                        onDragStart={(e) => {
                          if (!isSelected) return
                          e.target.x(0)
                          e.target.y(0)
                          onWallDragStart?.(wall.id, e)
                        }}
                        onDragMove={(e) => {
                          if (!isSelected) return
                          e.target.x(0)
                          e.target.y(0)
                          onWallDragMove?.(wall.id, e)
                        }}
                        onDragEnd={(e) => {
                          if (!isSelected) return
                          e.target.x(0)
                          e.target.y(0)
                          onWallDragEnd?.(wall.id, e)
                        }}
                        onClick={(e) => onWallClick?.(wall.id, e)}
                        onTap={(e) => onWallClick?.(wall.id, e)}
                        onMouseMove={
                          trackPointerHover ? (e) => onWallMouseMove?.(wall.id, e) : undefined
                        }
                        onMouseEnter={(e) => onWallMouseMove?.(wall.id, e)}
                        onMouseLeave={(e) => onWallMouseLeave?.(e)}
                      />
                    )}
                    {!hasMergedWallVolume && !hasGroupedSimpleFallback && (
                      <>
                        <Line
                          points={linePts}
                          stroke={segmentBorderColor}
                          strokeWidth={fillThickness + borderThickness * 2}
                          lineCap={'butt'}
                          lineJoin={'miter'}
                          closed={isClosed && isFullWall}
                          listening={false}
                        />
                        <Line
                          points={linePts}
                          stroke={fillColor}
                          strokeWidth={fillThickness}
                          lineCap={'butt'}
                          lineJoin={'miter'}
                          closed={isClosed && isFullWall}
                          fillEnabled={false}
                          hitStrokeWidth={fillThickness + borderThickness * 2}
                          listening={wallsListening}
                          draggable={draggableSelectedWalls && isSelected}
                          onDragStart={(e) => {
                            if (!isSelected) return
                            e.target.x(0)
                            e.target.y(0)
                            onWallDragStart?.(wall.id, e)
                          }}
                          onDragMove={(e) => {
                            if (!isSelected) return
                            e.target.x(0)
                            e.target.y(0)
                            onWallDragMove?.(wall.id, e)
                          }}
                          onDragEnd={(e) => {
                            if (!isSelected) return
                            e.target.x(0)
                            e.target.y(0)
                            onWallDragEnd?.(wall.id, e)
                          }}
                          onClick={(e) => onWallClick?.(wall.id, e)}
                          onTap={(e) => onWallClick?.(wall.id, e)}
                          onMouseMove={
                            trackPointerHover ? (e) => onWallMouseMove?.(wall.id, e) : undefined
                          }
                          onMouseEnter={(e) => onWallMouseMove?.(wall.id, e)}
                          onMouseLeave={(e) => onWallMouseLeave?.(e)}
                        />
                      </>
                    )}
                    {hasMergedWallVolume && (
                      <Line
                        points={linePts}
                        name={INTERACTIVE_OVERLAY_EXPORT_NAME} stroke="rgba(0,0,0,0.001)"
                        strokeWidth={fillThickness}
                        lineCap={'butt'}
                        lineJoin={'miter'}
                        closed={isClosed && isFullWall}
                        listening={wallsListening}
                        fillEnabled={false}
                        hitStrokeWidth={fillThickness}
                        draggable={draggableSelectedWalls && isSelected}
                        onDragStart={(e) => {
                          if (!isSelected) return
                          e.target.x(0)
                          e.target.y(0)
                          onWallDragStart?.(wall.id, e)
                        }}
                        onDragMove={(e) => {
                          if (!isSelected) return
                          e.target.x(0)
                          e.target.y(0)
                          onWallDragMove?.(wall.id, e)
                        }}
                        onDragEnd={(e) => {
                          if (!isSelected) return
                          e.target.x(0)
                          e.target.y(0)
                          onWallDragEnd?.(wall.id, e)
                        }}
                        onClick={(e) => onWallClick?.(wall.id, e)}
                        onTap={(e) => onWallClick?.(wall.id, e)}
                        onMouseMove={
                          trackPointerHover ? (e) => onWallMouseMove?.(wall.id, e) : undefined
                        }
                        onMouseEnter={(e) => onWallMouseMove?.(wall.id, e)}
                        onMouseLeave={(e) => onWallMouseLeave?.(e)}
                      />
                    )}
                    {hasMergedWallVolume && defaultBorderColor !== baseBorderColor && (
                      <Line
                        points={linePts}
                        stroke={segmentBorderColor}
                        strokeWidth={highlightThickness}
                        lineCap={'butt'}
                        lineJoin={'miter'}
                        closed={isClosed && isFullWall}
                        listening={false}
                      />
                    )}
                  </React.Fragment>
                )
              }
            )}

            {/* Hybrid butt/square cap: outer-stroke-only bar centered under the user vertex */}
            {!hasMergedWallVolume &&
              !hasGroupedSimpleFallback &&
              !isClosed &&
              wall.points.length >= 2 &&
              (() => {
                const firstSeg = solidIntervals[0]
                const lastSeg = solidIntervals[solidIntervals.length - 1]
                const hasStartEnd = firstSeg && firstSeg[0] <= 1e-8
                const hasEndEnd = lastSeg && lastSeg[1] >= totalLength - 1e-8
                if (!hasStartEnd && !hasEndEnd) return null

                const caps: React.ReactNode[] = []
                const addCap = (atStart: boolean) => {
                  const tangent = getPathEndTangent(wall.points, atStart)
                  if (!tangent) return
                  const pt = atStart ? wall.points[0]! : wall.points[wall.points.length - 1]!
                  const angleDeg = (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI
                  // Single rect: outer-stroke look only (border color). Width = stroke width along line, height = wall thickness. Centered under vertex.
                  caps.push(
                    <Rect
                      key={atStart ? 'cap-start' : 'cap-end'}
                      x={pt.x}
                      y={pt.y}
                      width={borderThickness / 2}
                      height={thickness}
                      offsetX={borderThickness / 4}
                      offsetY={thickness / 2}
                      rotation={angleDeg}
                      fill={fillColor}
                      listening={false}
                    />
                  )
                }
                if (hasStartEnd) addCap(true)
                if (hasEndEnd) addCap(false)
                return caps
              })()}
            {/* Render doors on this wall */}
            {doorsByWall.get(wall.id)?.map((door) => renderDoor(door, wall, openingFrameColor))}

            {/* Render windows on this wall */}
            {windowsByWall
              .get(wall.id)
              ?.map((window) => renderWindow(window, wall, openingFrameColor))}

            {/* Ghost door/window preview when insert tool hover is valid */}
            {previewOpening?.wallId === wall.id && previewOpening && (
              <Group opacity={0.5} listening={false}>
                {previewOpening.kind === 'door'
                  ? renderDoor(
                      {
                        id: '__preview__',
                        floorId: wall.floorId,
                        wallId: wall.id,
                        position: previewOpening.position,
                        width: previewOpening.width,
                        swing: previewOpening.doorSwing ?? 'right',
                        direction: previewOpening.doorDirection ?? 'out',
                        isOpening: false,
                      },
                      wall,
                      openingFrameColor
                    )
                  : renderWindow(
                      {
                        id: '__preview__',
                        floorId: wall.floorId,
                        wallId: wall.id,
                        position: previewOpening.position,
                        width: previewOpening.width,
                      },
                      wall,
                      openingFrameColor
                    )}
              </Group>
            )}

            {/* Selection measurements are rendered last as an explicit top-pass overlay. */}
            {(shouldMeasureWall || shouldMeasureOpenings) &&
              (measurementSegmentIndices.length > 0 || openingMeasurementIntervals.length > 0) &&
              pxPerMeter != null &&
              pxPerMeter > 0 && (
                <SegmentMeasurementOverlay
                  wall={wall}
                  segmentIndices={measurementSegmentIndices}
                  distanceIntervals={openingMeasurementIntervals}
                  pxPerMeter={pxPerMeter}
                  zoom={zoom}
                  textColor={theme === 'dark' ? '#ffffff' : '#000000'}
                  editableLabelFill={
                    theme === 'dark' ? 'rgba(17,24,39,0.95)' : 'rgba(255,255,255,0.95)'
                  }
                  editableSegmentIndices={editableMeasurementSegmentIndices}
                  onSegmentLengthCommit={
                    onSegmentLengthCommit
                      ? (segmentIndex, lengthCm) =>
                          onSegmentLengthCommit(wall.id, segmentIndex, lengthCm)
                      : undefined
                  }
                  onOpeningDistanceCommit={
                    onOpeningDistanceCommit
                      ? (interval, lengthCm) => {
                          if (interval.openingId && interval.openingSide) {
                            onOpeningDistanceCommit(
                              wall.id,
                              interval.openingId,
                              interval.openingSide,
                              lengthCm
                            )
                          }
                        }
                      : undefined
                  }
                  onSegmentDimensionDrag={
                    onSegmentDimensionDrag
                      ? (segmentIndex, delta, phase, precise) =>
                          onSegmentDimensionDrag(wall.id, segmentIndex, delta, phase, precise)
                      : undefined
                  }
                />
              )}
          </Group>
        )
      })}

      {openingCornerFusions.map((fusion) => {
        const selected = fusion.members.some((member) =>
          member.kind === 'window'
            ? selectedWindowIdSet.has(member.id)
            : selectedDoorIdSet.has(member.id)
        )
        return (
          <Line
            key={fusion.id}
            points={pointsToLinePoints(fusion.renderPolygon)}
            closed
            stroke={selected ? selectionColor : openingFrameColor}
            strokeWidth={getOpeningRenderMetrics(pxPerMeter).strokeWidth}
            lineJoin="miter"
            listening={false}
          />
        )
      })}

      {/* Curve construction guides identify the otherwise detached control handles. */}
      {orderedWalls.map((wall) => renderCurveControlGuide(wall))}

      {/* Vertices are the final visual and hit-test pass so openings can never cover them. */}
      {orderedWalls.map((wall) => renderWallPointHandles(wall))}
    </Group>
  )
}

function areEqual(prev: WallRendererProps, next: WallRendererProps): boolean {
  return (
    prev.walls === next.walls &&
    prev.doors === next.doors &&
    prev.windows === next.windows &&
    prev.masterWallThickness === next.masterWallThickness &&
    prev.pxPerMeter === next.pxPerMeter &&
    prev.zoom === next.zoom &&
    prev.interactionMode === next.interactionMode &&
    prev.selectedWallIds === next.selectedWallIds &&
    prev.selectedPointIndices === next.selectedPointIndices &&
    prev.selectedSegmentIndices === next.selectedSegmentIndices &&
    prev.showSegmentMeasurements === next.showSegmentMeasurements &&
    prev.hoveredWallId === next.hoveredWallId &&
    prev.hoveredDoorId === next.hoveredDoorId &&
    prev.hoveredWindowId === next.hoveredWindowId &&
    prev.selectedDoorIds === next.selectedDoorIds &&
    prev.selectedWindowIds === next.selectedWindowIds &&
    prev.doorsListening === next.doorsListening &&
    prev.windowsListening === next.windowsListening &&
    prev.showPointHandles === next.showPointHandles &&
    prev.pointHandlesDraggable === next.pointHandlesDraggable &&
    prev.draggableSelectedWalls === next.draggableSelectedWalls &&
    prev.theme === next.theme &&
    prev.listening === next.listening &&
    prev.wallsListening === next.wallsListening &&
    prev.previewOpening === next.previewOpening &&
    prev.onSegmentLengthCommit === next.onSegmentLengthCommit &&
    prev.onOpeningDistanceCommit === next.onOpeningDistanceCommit &&
    prev.onSegmentDimensionDrag === next.onSegmentDimensionDrag
  )
}

export const WallRenderer = React.memo(WallRendererInner, areEqual)
