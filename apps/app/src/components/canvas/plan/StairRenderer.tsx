import { INTERACTIVE_OVERLAY_EXPORT_NAME } from '@/lib/export/interactiveOverlayExport'
/* eslint-disable react-refresh/only-export-components */
import { useRef } from 'react'
import { Circle, Group, Line } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { ToolMode } from '@/components/plan/PlanImageTools'
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
import { getThemeColor } from '@/lib/theme/colors'
import type { Point2, Stair, StairCornerMode } from '@/types/schema'
import { clamp } from '@/lib/geometry'
import { getStairRenderMetrics, isSpiralStair } from '@/lib/plan/stairPlanScale'
import {
  getPlanHandleSize,
  getPlanHandleStrokeWidth,
  getPlanRotationHandleDistance,
  normalizePlanRotationDeg,
  PLAN_ROTATION_HANDLE_FILL,
  PLAN_ROTATION_HANDLE_STROKE,
  rotationDegFromPlanPointer,
  snapPlanRotationAngle,
} from '@/lib/plan/planRotationHandle'
import { isPrimaryPlanActivationEvent } from '@/lib/canvas/planPointerEvent'

type StairDragEvent = KonvaEventObject<MouseEvent | TouchEvent | PointerEvent | DragEvent>

interface StairRendererProps {
  stairs: Stair[]
  activeTool: ToolMode
  themeMode: 'light' | 'dark'
  zoom: number
  pxPerMeter: number
  renderMode?: 'all' | 'geometry' | 'points' | 'handles'
  selectedStairId: string | null
  hoveredStairId: string | null
  selectedPointIndices: Map<string, number[]>
  onStairSelect: (stairId: string, event?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void
  onStairHover: (stairId: string | null) => void
  onStairDragStart: (stairId: string, e: StairDragEvent) => void
  onStairDragMove: (stairId: string, e: StairDragEvent) => void
  onStairDragEnd: (stairId: string, e: StairDragEvent) => void
  onStairPointSelect: (
    stairId: string,
    pointIndex: number,
    event?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
  ) => void
  onStairPointDragStart?: (stairId: string, pointIndex: number) => void
  onStairPointMove: (stairId: string, pointIndex: number, x: number, y: number) => void
  onStairPointDragEnd: (stairId: string, pointIndex: number, x: number, y: number) => void
  getCanvasPointFromEvent?: (event: StairDragEvent) => Point2 | null
  spiralRotationPreview?: { stairId: string; rotationDeg: number } | null
  onSpiralRotationPreviewChange?: (preview: { stairId: string; rotationDeg: number } | null) => void
  onSpiralRotationChange?: (stairId: string, rotationDeg: number) => void
}

type ModifierEvent = { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }

interface SegmentData {
  a: Point2
  b: Point2
  dir: Point2
  leftNormal: Point2
  length: number
}

interface CornerData {
  pointIndex: number
  vertex: Point2
  turnAngle: number
  innerSide: 1 | -1
  innerCorner: Point2
  outerCorner: Point2
  outerPrevTangent: Point2
  outerNextTangent: Point2
}

interface StairGeometry {
  outlinePolygon: Point2[]
  outlinePoints: number[]
  stepLines: Array<[Point2, Point2]>
  upArrowLines: Array<[Point2, Point2]>
  /** Circular up-arrow path for spiral stairs (polyline with arrowhead on the last segment). */
  upArrowPath?: Point2[]
  /** When true, the spiral up-arrow head is drawn at the path start instead of the end. */
  upArrowHeadAtStart?: boolean
  stepLineColors?: string[]
  spiralHitRadius?: number
  spiralPoleRadius?: number
  spiralCenter?: Point2
}

const SPIRAL_SWEEP_DEGREES_MIN = 90
const SPIRAL_SWEEP_DEGREES_MAX = 360
const SPIRAL_START_ANGLE = -Math.PI / 2

function resolveSpiralSweepRadians(stair: Stair): number {
  const degrees = stair.spiralSweepDegrees ?? SPIRAL_SWEEP_DEGREES_MAX
  const clamped = clamp(degrees, SPIRAL_SWEEP_DEGREES_MIN, SPIRAL_SWEEP_DEGREES_MAX)
  return (clamped / 180) * Math.PI
}

function resolveSpiralStartAngle(stair: Stair): number {
  const rotationDeg = stair.spiralRotationDeg ?? 0
  return SPIRAL_START_ANGLE + (rotationDeg / 180) * Math.PI
}

/** Spiral stairs default to inverted up-arrow so the head matches the step tone gradient. */
function resolveSpiralInvertUpArrow(stair: Stair): boolean {
  return stair.invertUpArrow ?? true
}

function spiralStepToneColor(baseColor: string, t: number, invertUpArrow: boolean): string {
  const toneT = invertUpArrow ? t : 1 - t
  // Dark at the low end of travel, brighter toward the top.
  return adjustHexColor(baseColor, 0.15 - toneT * 0.3)
}

interface StraightRunData {
  segment: SegmentData
  start: number
  end: number
}

function normalize(dx: number, dy: number): Point2 {
  const len = Math.hypot(dx, dy)
  if (len <= 1e-6) return { x: 0, y: 0 }
  return { x: dx / len, y: dy / len }
}

function add(a: Point2, b: Point2): Point2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

function sub(a: Point2, b: Point2): Point2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

function scale(point: Point2, factor: number): Point2 {
  return { x: point.x * factor, y: point.y * factor }
}

function dot(a: Point2, b: Point2): number {
  return a.x * b.x + a.y * b.y
}

function cross(a: Point2, b: Point2): number {
  return a.x * b.y - a.y * b.x
}

function angleOf(vector: Point2): number {
  return Math.atan2(vector.y, vector.x)
}

function angleDelta(from: number, to: number): number {
  let delta = to - from
  while (delta <= -Math.PI) delta += Math.PI * 2
  while (delta > Math.PI) delta -= Math.PI * 2
  return delta
}

function pointsClose(a: Point2 | null, b: Point2 | null): boolean {
  if (!a || !b) return false
  return Math.hypot(a.x - b.x, a.y - b.y) <= 1e-3
}

function lineIntersection(a1: Point2, a2: Point2, b1: Point2, b2: Point2): Point2 | null {
  const dax = a2.x - a1.x
  const day = a2.y - a1.y
  const dbx = b2.x - b1.x
  const dby = b2.y - b1.y
  const denom = dax * dby - day * dbx
  if (Math.abs(denom) <= 1e-6) return null
  const u = ((b1.x - a1.x) * dby - (b1.y - a1.y) * dbx) / denom
  return {
    x: a1.x + dax * u,
    y: a1.y + day * u,
  }
}

function segmentIntersection(lineA: Point2, lineB: Point2, segA: Point2, segB: Point2): Point2 | null {
  const dax = lineB.x - lineA.x
  const day = lineB.y - lineA.y
  const dbx = segB.x - segA.x
  const dby = segB.y - segA.y
  const denom = dax * dby - day * dbx
  if (Math.abs(denom) <= 1e-6) return null
  const u = ((segA.x - lineA.x) * dby - (segA.y - lineA.y) * dbx) / denom
  const v = ((segA.x - lineA.x) * day - (segA.y - lineA.y) * dax) / denom
  if (v < -1e-6 || v > 1 + 1e-6) return null
  return {
    x: lineA.x + dax * u,
    y: lineA.y + day * u,
  }
}

function projectPointOntoLine(point: Point2, linePoint: Point2, dir: Point2): Point2 {
  return add(linePoint, scale(dir, dot(sub(point, linePoint), dir)))
}

function buildSegments(points: Point2[]): SegmentData[] {
  const segments: SegmentData[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const dir = normalize(b.x - a.x, b.y - a.y)
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length <= 1e-6) continue
    segments.push({
      a,
      b,
      dir,
      leftNormal: { x: -dir.y, y: dir.x },
      length,
    })
  }
  return segments
}

function getCornerMode(stair: Stair, pointIndex: number): StairCornerMode {
  return stair.cornerModeOverrides?.[String(pointIndex)] ?? stair.cornerMode
}

function appendPoint(path: Point2[], point: Point2) {
  const last = path[path.length - 1] ?? null
  if (!pointsClose(last, point)) {
    path.push(point)
  }
}

function appendArc(path: Point2[], center: Point2, radius: number, startAngle: number, endAngle: number) {
  const sweep = angleDelta(startAngle, endAngle)
  const steps = Math.max(6, Math.ceil(Math.abs(sweep) / (Math.PI / 24)))
  for (let i = 1; i <= steps; i++) {
    const angle = startAngle + (sweep * i) / steps
    appendPoint(path, {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    })
  }
}

function getOffsetLine(segment: SegmentData, side: 1 | -1, halfWidth: number): [Point2, Point2] {
  const offset = scale(segment.leftNormal, halfWidth * side)
  return [add(segment.a, offset), add(segment.b, offset)]
}

function buildCornerData(stair: Stair, segments: SegmentData[], halfWidth: number): Map<number, CornerData> {
  const corners = new Map<number, CornerData>()

  for (let pointIndex = 1; pointIndex < stair.points.length - 1; pointIndex++) {
    const prev = segments[pointIndex - 1]
    const next = segments[pointIndex]
    if (!prev || !next) continue

    const turnAngle = angleDelta(angleOf(prev.dir), angleOf(next.dir))
    if (Math.abs(turnAngle) <= 1e-4) continue

    const innerSide: 1 | -1 = cross(prev.dir, next.dir) >= 0 ? 1 : -1
    const outerSide: 1 | -1 = innerSide === 1 ? -1 : 1
    const vertex = stair.points[pointIndex]!
    const [prevInnerA, prevInnerB] = getOffsetLine(prev, innerSide, halfWidth)
    const [nextInnerA, nextInnerB] = getOffsetLine(next, innerSide, halfWidth)
    const [prevOuterA, prevOuterB] = getOffsetLine(prev, outerSide, halfWidth)
    const [nextOuterA, nextOuterB] = getOffsetLine(next, outerSide, halfWidth)

    const innerCorner =
      lineIntersection(prevInnerA, prevInnerB, nextInnerA, nextInnerB) ??
      add(vertex, scale(prev.leftNormal, halfWidth * innerSide))
    const outerCorner =
      lineIntersection(prevOuterA, prevOuterB, nextOuterA, nextOuterB) ??
      add(vertex, scale(prev.leftNormal, halfWidth * outerSide))
    const outerPrevTangent = projectPointOntoLine(innerCorner, prevOuterA, prev.dir)
    const outerNextTangent = projectPointOntoLine(innerCorner, nextOuterA, next.dir)

    corners.set(pointIndex, {
      pointIndex,
      vertex,
      turnAngle,
      innerSide,
      innerCorner,
      outerCorner,
      outerPrevTangent,
      outerNextTangent,
    })
  }

  return corners
}

function buildSidePath(
  stair: Stair,
  segments: SegmentData[],
  corners: Map<number, CornerData>,
  side: 1 | -1,
  halfWidth: number,
): Point2[] {
  if (segments.length === 0) return []
  const path: Point2[] = []
  appendPoint(path, add(segments[0]!.a, scale(segments[0]!.leftNormal, halfWidth * side)))

  for (let pointIndex = 1; pointIndex < stair.points.length - 1; pointIndex++) {
    const corner = corners.get(pointIndex)
    if (!corner) continue

    if (side === corner.innerSide) {
      appendPoint(path, corner.innerCorner)
      continue
    }

    if (stair.cornerStyle === 'round') {
      appendPoint(path, corner.outerPrevTangent)
      appendArc(
        path,
        corner.innerCorner,
        stair.width,
        angleOf(sub(corner.outerPrevTangent, corner.innerCorner)),
        angleOf(sub(corner.outerNextTangent, corner.innerCorner)),
      )
      appendPoint(path, corner.outerNextTangent)
    } else {
      appendPoint(path, corner.outerCorner)
    }
  }

  const last = segments[segments.length - 1]!
  appendPoint(path, add(last.b, scale(last.leftNormal, halfWidth * side)))
  return path
}

function buildStairOutlinePolygon(stair: Stair): Point2[] {
  if (!Array.isArray(stair.points) || stair.points.length < 2) return []
  const segments = buildSegments(stair.points)
  if (segments.length === 0) return []
  const halfWidth = Math.max(4, stair.width / 2)
  const corners = buildCornerData(stair, segments, halfWidth)
  const left = buildSidePath(stair, segments, corners, 1, halfWidth)
  const right = buildSidePath(stair, segments, corners, -1, halfWidth).reverse()
  return [...left, ...right]
}

function getStepSpacing(length: number, desiredStepDepth: number): { count: number; spacing: number } {
  const count = Math.max(1, Math.round(length / Math.max(4, desiredStepDepth)))
  return {
    count,
    spacing: length / count,
  }
}

function isPlatformBoundaryPoint(
  stair: Stair,
  pointIndex: number,
  corners: Map<number, CornerData>,
): boolean {
  if (pointIndex < 0 || pointIndex >= stair.points.length) return false
  if (getCornerMode(stair, pointIndex) !== 'platform') return false
  if (pointIndex === 0 || pointIndex === stair.points.length - 1) return true

  return (
    pointIndex > 0 &&
    pointIndex < stair.points.length - 1 &&
    !corners.has(pointIndex)
  )
}

function intersectLineWithPolygon(center: Point2, direction: Point2, polygon: Point2[]): [Point2, Point2] | null {
  if (polygon.length < 3) return null
  const far = 100000
  const lineStart = add(center, scale(direction, -far))
  const lineEnd = add(center, scale(direction, far))
  const intersections: Array<{ point: Point2; t: number }> = []

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    const hit = segmentIntersection(lineStart, lineEnd, a, b)
    if (!hit) continue
    if (intersections.some((entry) => pointsClose(entry.point, hit))) continue
    intersections.push({
      point: hit,
      t: dot(sub(hit, center), direction),
    })
  }

  if (intersections.length < 2) return null
  intersections.sort((a, b) => a.t - b.t)

  // For concave/self-overlapping cases, use the intersection pair that brackets the
  // query center instead of the outermost pair. This prevents treads from jumping
  // across the opposite side of the stair on acute turns.
  let negative: { point: Point2; t: number } | null = null
  let positive: { point: Point2; t: number } | null = null

  for (const hit of intersections) {
    if (hit.t <= 1e-6) negative = hit
    if (hit.t >= -1e-6) {
      positive = hit
      break
    }
  }

  if (negative && positive && !pointsClose(negative.point, positive.point)) {
    return [negative.point, positive.point]
  }

  for (let i = 0; i < intersections.length - 1; i++) {
    const a = intersections[i]!
    const b = intersections[i + 1]!
    if (a.t <= 1e-6 && b.t >= -1e-6 && !pointsClose(a.point, b.point)) {
      return [a.point, b.point]
    }
  }

  return [intersections[0]!.point, intersections[intersections.length - 1]!.point]
}

function getInnerOffsetDistance(segment: SegmentData, halfWidth: number, innerSide: 1 | -1, corner: Point2): number {
  const linePoint = add(segment.a, scale(segment.leftNormal, halfWidth * innerSide))
  return clamp(dot(sub(corner, linePoint), segment.dir), 0, segment.length)
}

function buildStraightRuns(
  stair: Stair,
  segments: SegmentData[],
  corners: Map<number, CornerData>,
  halfWidth: number,
): StraightRunData[] {
  const runs: StraightRunData[] = []

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex]!
    const startCorner = corners.get(segmentIndex)
    const endCorner = corners.get(segmentIndex + 1)
    const startsAtPlatformPoint = isPlatformBoundaryPoint(stair, segmentIndex, corners)
    const endsAtPlatformPoint = isPlatformBoundaryPoint(stair, segmentIndex + 1, corners)
    const isPlatformSegment =
      getCornerMode(stair, segmentIndex) === 'platform' &&
      getCornerMode(stair, segmentIndex + 1) === 'platform'

    if (startsAtPlatformPoint || endsAtPlatformPoint || isPlatformSegment) {
      continue
    }

    const start =
      startCorner
        ? getInnerOffsetDistance(segment, halfWidth, startCorner.innerSide, startCorner.innerCorner)
        : 0
    const end =
      endCorner
        ? getInnerOffsetDistance(segment, halfWidth, endCorner.innerSide, endCorner.innerCorner)
        : segment.length

    if (end - start <= 1e-3) continue
    runs.push({ segment, start, end })
  }

  return runs
}

function buildStepLines(stair: Stair, polygon: Point2[], halfWidth: number): Array<[Point2, Point2]> {
  const segments = buildSegments(stair.points)
  const corners = buildCornerData(stair, segments, halfWidth)
  const lines: Array<[Point2, Point2]> = []
  if (segments.length === 0) return lines

  for (const run of buildStraightRuns(stair, segments, corners, halfWidth)) {
    const runLength = Math.max(0, run.end - run.start)
    if (runLength <= 1e-3) continue

    const { count, spacing } = getStepSpacing(runLength, stair.stepDepth)
    // Keep the boundary-adjacent straight treads even for turning corners.
    // The corner fan is clipped locally now, so a little overlap is preferable
    // to visible gaps between the fan and the straight runs.
    const startIndex = 0
    const endIndex = count

    for (let stepIndex = startIndex; stepIndex <= endIndex; stepIndex++) {
      const center = add(run.segment.a, scale(run.segment.dir, run.start + spacing * stepIndex))
      const hit = intersectLineWithPolygon(center, run.segment.leftNormal, polygon)
      if (hit) lines.push(hit)
    }
  }

  for (let pointIndex = 1; pointIndex < stair.points.length - 1; pointIndex++) {
    if (getCornerMode(stair, pointIndex) !== 'turn') continue
    const corner = corners.get(pointIndex)
    const prev = segments[pointIndex - 1]
    const next = segments[pointIndex]
    if (!corner || !prev || !next) continue

    const startAngle = angleOf(sub(corner.outerPrevTangent, corner.innerCorner))
    const endAngle = angleOf(sub(corner.outerNextTangent, corner.innerCorner))
    const sweep = angleDelta(startAngle, endAngle)
    const desiredSpacing = Math.max(4, stair.stepDepth)
    const outerBoundaryLength =
      stair.cornerStyle === 'round'
        ? stair.width * Math.abs(sweep)
        : Math.hypot(
            corner.outerCorner.x - corner.outerPrevTangent.x,
            corner.outerCorner.y - corner.outerPrevTangent.y,
          ) +
          Math.hypot(
            corner.outerNextTangent.x - corner.outerCorner.x,
            corner.outerNextTangent.y - corner.outerCorner.y,
          )
    const intervalCount = Math.max(1, Math.round(outerBoundaryLength / desiredSpacing))

    for (let stepIndex = 0; stepIndex <= intervalCount; stepIndex++) {
      const angle = startAngle + (sweep * stepIndex) / intervalCount
      const direction = { x: Math.cos(angle), y: Math.sin(angle) }
      if (stair.cornerStyle === 'round') {
        lines.push([
          corner.innerCorner,
          add(corner.innerCorner, scale(direction, stair.width)),
        ])
        continue
      }

      const hit = intersectLineWithPolygon(corner.innerCorner, direction, polygon)
      if (!hit) continue
      const outwardHit =
        dot(sub(hit[0], corner.innerCorner), direction) > dot(sub(hit[1], corner.innerCorner), direction)
          ? hit[0]
          : hit[1]
      lines.push([corner.innerCorner, outwardHit])
    }
  }

  return lines
}

function buildUpArrowLines(stair: Stair, halfWidth: number): Array<[Point2, Point2]> {
  if (!stair.showUpArrow) return []

  const segments = buildSegments(stair.points)
  const corners = buildCornerData(stair, segments, halfWidth)
  const lines: Array<[Point2, Point2]> = []

  for (const run of buildStraightRuns(stair, segments, corners, halfWidth)) {
    const runLength = run.end - run.start
    if (runLength <= 12) continue

    const bodyStartDistance = run.start + clamp(stair.stepDepth * 0.35, 6, runLength * 0.12)
    const bodyEndDistance = run.start + runLength * 0.8
    if (bodyEndDistance - bodyStartDistance <= 6) continue

    const forwardStart = add(run.segment.a, scale(run.segment.dir, bodyStartDistance))
    const forwardEnd = add(run.segment.a, scale(run.segment.dir, bodyEndDistance))
    lines.push(stair.invertUpArrow ? [forwardEnd, forwardStart] : [forwardStart, forwardEnd])
  }

  return lines
}

function buildArrowHeadGeometry(
  start: Point2,
  end: Point2,
  pointerLength: number,
  pointerWidth: number,
): { shaftEnd: Point2; headPoints: number[] } | null {
  const dir = normalize(end.x - start.x, end.y - start.y)
  if (dir.x === 0 && dir.y === 0) return null

  const tip = end
  const baseCenter = add(tip, scale(dir, -pointerLength))
  const perp = { x: -dir.y, y: dir.x }
  const halfWidth = pointerWidth / 2
  const baseLeft = add(baseCenter, scale(perp, halfWidth))
  const baseRight = add(baseCenter, scale(perp, -halfWidth))

  return {
    shaftEnd: baseCenter,
    headPoints: [tip.x, tip.y, baseLeft.x, baseLeft.y, baseRight.x, baseRight.y],
  }
}

function adjustHexColor(hex: string, amount: number): string {
  const sanitized = hex.replace('#', '')
  if (sanitized.length !== 6) return hex
  const asInt = parseInt(sanitized, 16)
  if (!Number.isFinite(asInt)) return hex
  const r = clamp((asInt >> 16) & 0xff, 0, 255)
  const g = clamp((asInt >> 8) & 0xff, 0, 255)
  const b = clamp(asInt & 0xff, 0, 255)
  const next = (channel: number) => clamp(Math.round(channel + 255 * amount), 0, 255)
  const toHex = (value: number) => value.toString(16).padStart(2, '0')
  return `#${toHex(next(r))}${toHex(next(g))}${toHex(next(b))}`
}

function appendDirectedArc(
  path: Point2[],
  center: Point2,
  radius: number,
  startAngle: number,
  sweepRadians: number,
) {
  if (Math.abs(sweepRadians) <= 1e-6) return
  const steps = Math.max(6, Math.ceil(Math.abs(sweepRadians) / (Math.PI / 24)))
  for (let i = 1; i <= steps; i++) {
    const angle = startAngle + (sweepRadians * i) / steps
    appendPoint(path, {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    })
  }
}

function buildSpiralOutlinePolygon(
  center: Point2,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  sweepRadians: number,
  directedSweep: number,
): Point2[] {
  if (sweepRadians >= Math.PI * 2 - 1e-4) {
    const outlineSteps = 72
    const outlinePolygon: Point2[] = []
    for (let i = 0; i < outlineSteps; i++) {
      const angle = (i / outlineSteps) * Math.PI * 2
      outlinePolygon.push({
        x: center.x + Math.cos(angle) * outerRadius,
        y: center.y + Math.sin(angle) * outerRadius,
      })
    }
    return outlinePolygon
  }

  const endAngle = startAngle + directedSweep
  const outlinePolygon: Point2[] = []
  appendPoint(outlinePolygon, {
    x: center.x + Math.cos(startAngle) * innerRadius,
    y: center.y + Math.sin(startAngle) * innerRadius,
  })
  appendPoint(outlinePolygon, {
    x: center.x + Math.cos(startAngle) * outerRadius,
    y: center.y + Math.sin(startAngle) * outerRadius,
  })
  appendDirectedArc(outlinePolygon, center, outerRadius, startAngle, directedSweep)
  appendPoint(outlinePolygon, {
    x: center.x + Math.cos(endAngle) * innerRadius,
    y: center.y + Math.sin(endAngle) * innerRadius,
  })
  appendDirectedArc(outlinePolygon, center, innerRadius, endAngle, -directedSweep)
  return outlinePolygon
}

function buildSpiralUpArrowPath(
  center: Point2,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  directedSweep: number,
): Point2[] {
  const midRadius = (innerRadius + outerRadius) / 2
  const arrowStart = startAngle + directedSweep * 0.12
  const arrowEnd = startAngle + directedSweep * 0.82
  const arcSweep = arrowEnd - arrowStart
  if (Math.abs(arcSweep) <= 1e-4) return []

  const steps = Math.max(8, Math.ceil(Math.abs(arcSweep) / (Math.PI / 24)))
  const path: Point2[] = []
  for (let i = 0; i <= steps; i++) {
    const angle = arrowStart + (arcSweep * i) / steps
    path.push({
      x: center.x + Math.cos(angle) * midRadius,
      y: center.y + Math.sin(angle) * midRadius,
    })
  }
  return path
}

function buildSpiralStairGeometry(stair: Stair): StairGeometry {
  const center = stair.points[0]
  if (!center) return { outlinePolygon: [], outlinePoints: [], stepLines: [], upArrowLines: [] }
  const poleDiameter = stair.spiralPoleDiameter ?? stair.width * 0.2
  const outerRadius = Math.max(8, (stair.width + poleDiameter) / 2)
  const poleRadius = Math.max(2, poleDiameter / 2)
  const innerRadius = poleRadius
  const sweepRadians = resolveSpiralSweepRadians(stair)
  const directedSweep = sweepRadians
  const startAngle = resolveSpiralStartAngle(stair)
  const outerArcLength = outerRadius * sweepRadians
  const stepCount = Math.max(2, Math.round(outerArcLength / Math.max(4, stair.stepDepth)))
  const outlinePolygon = buildSpiralOutlinePolygon(
    center,
    innerRadius,
    outerRadius,
    startAngle,
    sweepRadians,
    directedSweep,
  )
  const stepLines: Array<[Point2, Point2]> = []
  const stepLineColors: string[] = []
  const baseColor = '#64748b'
  const invertUpArrow = resolveSpiralInvertUpArrow(stair)
  const fullTurn = sweepRadians >= Math.PI * 2 - 1e-4
  if (fullTurn) {
    for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
      const t = stepCount <= 0 ? 0 : stepIndex / stepCount
      const angle = startAngle + directedSweep * t
      stepLines.push([
        { x: center.x + Math.cos(angle) * innerRadius, y: center.y + Math.sin(angle) * innerRadius },
        { x: center.x + Math.cos(angle) * outerRadius, y: center.y + Math.sin(angle) * outerRadius },
      ])
      stepLineColors.push(spiralStepToneColor(baseColor, t, invertUpArrow))
    }
  } else {
    for (let stepIndex = 1; stepIndex < stepCount; stepIndex++) {
      const t = stepIndex / stepCount
      const angle = startAngle + directedSweep * t
      stepLines.push([
        { x: center.x + Math.cos(angle) * innerRadius, y: center.y + Math.sin(angle) * innerRadius },
        { x: center.x + Math.cos(angle) * outerRadius, y: center.y + Math.sin(angle) * outerRadius },
      ])
      stepLineColors.push(spiralStepToneColor(baseColor, t, invertUpArrow))
    }
  }
  return {
    outlinePolygon,
    outlinePoints: outlinePolygon.flatMap((point) => [point.x, point.y]),
    stepLines,
    stepLineColors,
    upArrowLines: [],
    upArrowPath: stair.showUpArrow
      ? buildSpiralUpArrowPath(center, innerRadius, outerRadius, startAngle, directedSweep)
      : undefined,
    upArrowHeadAtStart: stair.showUpArrow ? invertUpArrow : undefined,
    spiralHitRadius: outerRadius,
    spiralPoleRadius: poleRadius,
    spiralCenter: center,
  }
}

export function buildStairGeometry(stair: Stair): StairGeometry {
  if (isSpiralStair(stair)) {
    return buildSpiralStairGeometry(stair)
  }
  const outlinePolygon = buildStairOutlinePolygon(stair)
  const halfWidth = Math.max(4, stair.width / 2)
  return {
    outlinePolygon,
    outlinePoints: outlinePolygon.flatMap((point) => [point.x, point.y]),
    stepLines: buildStepLines(stair, outlinePolygon, halfWidth),
    upArrowLines: buildUpArrowLines(stair, halfWidth),
  }
}

export function getStairBounds(stair: Stair): { x: number; y: number; width: number; height: number } | null {
  const outline = buildStairGeometry(stair).outlinePolygon
  if (outline.length === 0) return null

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of outline) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

export function StairRenderer({
  stairs,
  activeTool,
  themeMode,
  zoom,
  pxPerMeter,
  renderMode = 'all',
  selectedStairId,
  hoveredStairId,
  selectedPointIndices,
  onStairSelect,
  onStairHover,
  onStairDragStart,
  onStairDragMove,
  onStairDragEnd,
  onStairPointSelect,
  onStairPointDragStart,
  onStairPointMove,
  onStairPointDragEnd,
  getCanvasPointFromEvent,
  spiralRotationPreview = null,
  onSpiralRotationPreviewChange,
  onSpiralRotationChange,
}: StairRendererProps) {
  const interactive = activeTool === 'select'
  const spiralRotationBaseRef = useRef<number | null>(null)
  const selectionColor = getThemeColor(themeMode, 'selectionColor')
  const hoverColor = '#eab308'
  const stairColor = themeMode === 'dark' ? '#9ca3af' : '#64748b'
  const pointBaseColor = themeMode === 'dark' ? '#f9fafb' : '#111827'
  const pointStrokeColor = themeMode === 'dark' ? '#111827' : '#ffffff'
  const pointRadius = screenPxToCanvasUnits(
    zoom,
    DRAW_TOOL_POINT_RADIUS_PX,
    DRAW_TOOL_POINT_RADIUS_PX_MIN,
    DRAW_TOOL_POINT_RADIUS_PX_MAX,
  )
  const pointSelectedRadius = screenPxToCanvasUnits(
    zoom,
    DRAW_TOOL_POINT_RADIUS_PX + 2,
    DRAW_TOOL_POINT_RADIUS_PX_MIN,
    DRAW_TOOL_POINT_RADIUS_PX_MAX + 2,
  )
  const pointStroke = screenPxToCanvasUnits(
    zoom,
    DRAW_TOOL_STROKE_PX * 0.75,
    DRAW_TOOL_STROKE_PX_MIN,
    DRAW_TOOL_STROKE_PX_MAX,
  )
  const renderMetrics = getStairRenderMetrics(pxPerMeter)
  const highlightStroke = screenPxToCanvasUnits(
    zoom,
    SELECTION_OUTLINE_STROKE_PX,
    SELECTION_OUTLINE_STROKE_PX_MIN,
    SELECTION_OUTLINE_STROKE_PX_MAX,
  )
  const hoverDash = [
    screenPxToCanvasUnits(zoom, 4, 2, 8),
    screenPxToCanvasUnits(zoom, 4, 2, 8),
  ]
  const showGeometry = renderMode !== 'points' && renderMode !== 'handles'
  const showHandles = renderMode === 'handles'
  const handleSize = getPlanHandleSize(zoom)
  const handleStrokeWidth = getPlanHandleStrokeWidth(zoom)

  const getRenderStair = (stair: Stair): Stair => {
    if (spiralRotationPreview?.stairId !== stair.id) return stair
    return { ...stair, spiralRotationDeg: spiralRotationPreview.rotationDeg }
  }

  const updateSpiralRotationFromPointer = (
    stair: Stair,
    event: StairDragEvent,
  ): number | null => {
    if (!getCanvasPointFromEvent || !onSpiralRotationPreviewChange) return null
    const center = stair.points[0]
    const pointer = getCanvasPointFromEvent(event)
    if (!center || !pointer) return null
    const rotationDeg = normalizePlanRotationDeg(
      snapPlanRotationAngle(rotationDegFromPlanPointer(pointer, center), event.evt as ModifierEvent),
    )
    onSpiralRotationPreviewChange({ stairId: stair.id, rotationDeg })
    return rotationDeg
  }

  return (
    <Group listening>
      {!showHandles &&
        stairs.map((stair) => {
        if (!Array.isArray(stair.points) || stair.points.length < 1) return null
        const renderStair = getRenderStair(stair)
        const geometry = showGeometry ? buildStairGeometry(renderStair) : null
        if (showGeometry && (!geometry || geometry.outlinePoints.length < 6)) return null

        const selectedIndices = selectedPointIndices.get(stair.id) ?? []
        const isSelected = selectedStairId === stair.id || selectedIndices.length > 0
        const isHovered = hoveredStairId === stair.id

        return (
          <Group key={stair.id}>
            {showGeometry && geometry && (
              <>
                <Line
                  points={geometry.outlinePoints}
                  closed
                  name={INTERACTIVE_OVERLAY_EXPORT_NAME} fill="rgba(0,0,0,0.001)"
                  strokeWidth={0}
                  draggable={interactive && isSelected}
                  onClick={(e) => {
                    if (!isPrimaryPlanActivationEvent(e.evt)) return
                    e.cancelBubble = true
                    if (interactive) onStairSelect(stair.id, e.evt as ModifierEvent)
                  }}
                  onTap={(e) => {
                    e.cancelBubble = true
                    if (interactive) onStairSelect(stair.id, e.evt as ModifierEvent)
                  }}
                  onMouseEnter={() => interactive && onStairHover(stair.id)}
                  onMouseLeave={() => onStairHover(null)}
                  onDragStart={(e) => {
                    if (!interactive) return
                    onStairSelect(stair.id)
                    onStairDragStart(stair.id, e)
                    e.target.x(0)
                    e.target.y(0)
                  }}
                  onDragMove={(e) => {
                    if (!interactive || !isSelected) return
                    onStairDragMove(stair.id, e)
                    e.target.x(0)
                    e.target.y(0)
                  }}
                  onDragEnd={(e) => {
                    if (!interactive || !isSelected) return
                    onStairDragEnd(stair.id, e)
                    e.target.x(0)
                    e.target.y(0)
                  }}
                />
                {geometry.spiralHitRadius && stair.points[0] && (
                  <Circle
                    x={stair.points[0].x}
                    y={stair.points[0].y}
                    radius={geometry.spiralHitRadius}
                    name={INTERACTIVE_OVERLAY_EXPORT_NAME} fill="rgba(0,0,0,0.001)"
                    strokeWidth={0}
                    draggable={interactive && isSelected}
                    onClick={(e) => {
                      if (!isPrimaryPlanActivationEvent(e.evt)) return
                      e.cancelBubble = true
                      if (interactive) onStairSelect(stair.id, e.evt as ModifierEvent)
                    }}
                    onTap={(e) => {
                      e.cancelBubble = true
                      if (interactive) onStairSelect(stair.id, e.evt as ModifierEvent)
                    }}
                    onMouseEnter={() => interactive && onStairHover(stair.id)}
                    onMouseLeave={() => onStairHover(null)}
                    onDragStart={(e) => {
                      if (!interactive) return
                      onStairSelect(stair.id)
                      onStairDragStart(stair.id, e)
                      e.target.x(0)
                      e.target.y(0)
                    }}
                    onDragMove={(e) => {
                      if (!interactive || !isSelected) return
                      onStairDragMove(stair.id, e)
                      e.target.x(0)
                      e.target.y(0)
                    }}
                    onDragEnd={(e) => {
                      if (!interactive || !isSelected) return
                      onStairDragEnd(stair.id, e)
                      e.target.x(0)
                      e.target.y(0)
                    }}
                  />
                )}
                <Line
                  points={geometry.outlinePoints}
                  closed
                  stroke={stairColor}
                  strokeWidth={renderMetrics.outlineStroke}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
                {geometry.spiralPoleRadius && geometry.spiralCenter && (
                  <Circle
                    x={geometry.spiralCenter.x}
                    y={geometry.spiralCenter.y}
                    radius={geometry.spiralPoleRadius}
                    stroke={stairColor}
                    strokeWidth={renderMetrics.outlineStroke}
                    fill="transparent"
                    listening={false}
                  />
                )}
                {geometry.stepLines.map(([start, end], index) => (
                  <Line
                    key={`${stair.id}-step-${index}`}
                    points={[start.x, start.y, end.x, end.y]}
                    stroke={geometry.stepLineColors?.[index] ?? stairColor}
                    strokeWidth={renderMetrics.stepStroke}
                    lineCap="round"
                    listening={false}
                  />
                ))}
                {geometry.upArrowPath && geometry.upArrowPath.length >= 2 && (() => {
                  const path = geometry.upArrowPath
                  const headAtStart = !!geometry.upArrowHeadAtStart
                  const shaftStart = headAtStart ? path[1]! : path[path.length - 2]!
                  const shaftEnd = headAtStart ? path[0]! : path[path.length - 1]!
                  const arrowHead = buildArrowHeadGeometry(
                    shaftStart,
                    shaftEnd,
                    renderMetrics.arrowHeadLength,
                    renderMetrics.arrowHeadWidth,
                  )
                  if (!arrowHead) return null
                  const shaftPoints = headAtStart
                    ? path.slice(1).flatMap((point) => [point.x, point.y])
                    : path.slice(0, -1).flatMap((point) => [point.x, point.y])

                  return (
                    <Group key={`${stair.id}-spiral-arrow`} listening={false}>
                      {path.length > 2 && (
                        <Line
                          points={shaftPoints}
                          stroke={stairColor}
                          strokeWidth={renderMetrics.arrowStroke}
                          lineCap="round"
                          lineJoin="round"
                          listening={false}
                        />
                      )}
                      <Line
                        points={[shaftStart.x, shaftStart.y, arrowHead.shaftEnd.x, arrowHead.shaftEnd.y]}
                        stroke={stairColor}
                        strokeWidth={renderMetrics.arrowStroke}
                        lineCap="round"
                        listening={false}
                      />
                      <Line
                        points={arrowHead.headPoints}
                        closed
                        stroke={stairColor}
                        fill={stairColor}
                        strokeWidth={renderMetrics.arrowStroke}
                        lineJoin="round"
                        listening={false}
                      />
                    </Group>
                  )
                })()}
                {geometry.upArrowLines.map(([start, end], index) => {
                  const arrowHead = buildArrowHeadGeometry(
                    start,
                    end,
                    renderMetrics.arrowHeadLength,
                    renderMetrics.arrowHeadWidth,
                  )
                  if (!arrowHead) return null

                  return (
                    <Group key={`${stair.id}-arrow-${index}`} listening={false}>
                      <Line
                        points={[start.x, start.y, arrowHead.shaftEnd.x, arrowHead.shaftEnd.y]}
                        stroke={stairColor}
                        strokeWidth={renderMetrics.arrowStroke}
                        lineCap="round"
                        listening={false}
                      />
                      <Line
                        points={arrowHead.headPoints}
                        closed
                        stroke={stairColor}
                        fill={stairColor}
                        strokeWidth={renderMetrics.arrowStroke}
                        lineJoin="round"
                        listening={false}
                      />
                    </Group>
                  )
                })}
                {(isSelected || isHovered) && (
                  <Line
                    points={geometry.outlinePoints}
                    closed
                    stroke={isSelected ? selectionColor : hoverColor}
                    strokeWidth={highlightStroke}
                    dash={isSelected ? undefined : hoverDash}
                    lineCap="round"
                    lineJoin="round"
                    listening={false}
                  />
                )}
              </>
            )}
          </Group>
        )
      })}
      {showHandles &&
        stairs.map((stair) => {
          if (!Array.isArray(stair.points) || stair.points.length < 1) return null
          const renderStair = getRenderStair(stair)
          const geometry = buildStairGeometry(renderStair)
          const selectedIndices = selectedPointIndices.get(stair.id) ?? []
          const isSelected = selectedStairId === stair.id || selectedIndices.length > 0
          if (!interactive || !isSelected) return null
          const center = geometry.spiralCenter
          const rotationDeg = renderStair.spiralRotationDeg ?? 0
          const handleDistance = getPlanRotationHandleDistance(geometry.spiralHitRadius ?? 0, zoom)
          const constrainRotationHandleLocal = (pos: { x: number; y: number }) => {
            const angle = Math.atan2(pos.x, -pos.y)
            return { x: Math.sin(angle) * handleDistance, y: -Math.cos(angle) * handleDistance }
          }

          return (
            <Group key={`${stair.id}-handles`}>
              {stair.points.map((point, index) => (
                <Circle
                  key={`${stair.id}-point-${index}`}
                  x={point.x}
                  y={point.y}
                  radius={selectedIndices.includes(index) ? pointSelectedRadius : pointRadius}
                  fill={selectedIndices.includes(index) ? selectionColor : pointBaseColor}
                  stroke={pointStrokeColor}
                  strokeWidth={pointStroke}
                  draggable={interactive}
                  onClick={(e) => {
                    if (!isPrimaryPlanActivationEvent(e.evt)) return
                    e.cancelBubble = true
                    if (interactive) onStairPointSelect(stair.id, index, e.evt as ModifierEvent)
                  }}
                  onTap={(e) => {
                    e.cancelBubble = true
                    if (interactive) onStairPointSelect(stair.id, index, e.evt as ModifierEvent)
                  }}
                  onDragStart={() => {
                    if (!interactive) return
                    onStairPointSelect(stair.id, index)
                    onStairPointDragStart?.(stair.id, index)
                  }}
                  onDragMove={(e) => onStairPointMove(stair.id, index, e.target.x(), e.target.y())}
                  onDragEnd={(e) => onStairPointDragEnd(stair.id, index, e.target.x(), e.target.y())}
                />
              ))}
              {isSpiralStair(stair) &&
                center &&
                geometry.spiralHitRadius &&
                getCanvasPointFromEvent &&
                onSpiralRotationChange && (
                  <Group
                    key={`${stair.id}-rotation-handle-group`}
                    x={center.x}
                    y={center.y}
                    rotation={rotationDeg}
                  >
                    <Circle
                      x={0}
                      y={-handleDistance}
                      radius={handleSize * 0.7}
                      fill={PLAN_ROTATION_HANDLE_FILL}
                      stroke={PLAN_ROTATION_HANDLE_STROKE}
                      strokeWidth={handleStrokeWidth}
                      listening
                      draggable
                      dragBoundFunc={constrainRotationHandleLocal}
                      onDragStart={() => {
                        spiralRotationBaseRef.current = renderStair.spiralRotationDeg ?? 0
                      }}
                      onPointerDown={(event) => {
                        if (!isPrimaryPlanActivationEvent(event.evt)) return
                        event.cancelBubble = true
                        onStairSelect(stair.id)
                      }}
                      onDragMove={(event) => {
                        event.cancelBubble = true
                        updateSpiralRotationFromPointer(stair, event)
                        event.target.position({ x: 0, y: -handleDistance })
                      }}
                      onDragEnd={(event) => {
                        event.cancelBubble = true
                        const nextRotation =
                          updateSpiralRotationFromPointer(stair, event) ??
                          spiralRotationPreview?.rotationDeg ??
                          spiralRotationBaseRef.current ??
                          renderStair.spiralRotationDeg ??
                          0
                        onSpiralRotationChange?.(stair.id, nextRotation)
                        onSpiralRotationPreviewChange?.(null)
                        spiralRotationBaseRef.current = null
                        event.target.position({ x: 0, y: -handleDistance })
                      }}
                    />
                  </Group>
                )}
            </Group>
          )
        })}
    </Group>
  )
}
