import type { Point2, Wall, Door, Window } from '@/types/schema'
import { snapToGrid } from '@/utils/plan/gridSnap'
import { getOpeningsBySegment, getSegmentInfos } from '@/lib/plan/constraints'
import { detectAttachment } from '@/lib/plan/pointAttachment'
import { findLineIntersection } from '@/lib/plan/intersectionDetection'
import { clamp, distance, lerp, projectPointToSegment } from '@/lib/geometry'
import { getWallPathPoints, isCurvedWall } from '@/lib/plan/wallCurve'

type WallPointAttachment = NonNullable<ReturnType<typeof detectAttachment>>

export interface WallDrawingState {
  mode: 'drawWall' | 'drawWallRect' | 'movePoint' | 'insertDoor' | 'insertWindow' | 'clipWall' | 'insertPoint' | null
  currentWall: Wall | null
  currentPoints: Point2[]
  isDrawing: boolean
  startPoint: Point2 | null
  selectedPointIndex: number | null
  selectedWallId: string | null
}

/**
 * Handle drawing a wall with the pencil tool (freehand).
 * Tracks mouse clicks and creates points, finishes on double-click/ESC.
 */
export function handleDrawWall(
  point: Point2,
  state: WallDrawingState,
  gridSize: number,
  snapEnabled: boolean,
  allWalls: Wall[]
): Partial<WallDrawingState> {
  const snappedPoint = snapToGrid(point, gridSize, snapEnabled)

  if (!state.isDrawing) {
    // Start new wall
    return {
      isDrawing: true,
      currentPoints: [snappedPoint],
      startPoint: snappedPoint,
    }
  } else {
    // Add point to current wall
    const newPoints = [...state.currentPoints, snappedPoint]

    // Check for attachment to existing walls
    const lastPoint = newPoints[newPoints.length - 2]
    if (lastPoint) {
      for (const wall of allWalls) {
        const attachment = detectAttachment(snappedPoint, wall)
        if (attachment) {
          // Point should attach to this wall
          // This will be handled when the wall is created
        }
      }
    }

    return {
      currentPoints: newPoints,
    }
  }
}

/**
 * Handle drawing a wall with the rectangle tool.
 * Drag to create rectangular wall segments.
 */
export function handleDrawWallRect(
  startPoint: Point2,
  endPoint: Point2,
  gridSize: number,
  snapEnabled: boolean
): Point2[] {
  const snappedStart = snapToGrid(startPoint, gridSize, snapEnabled)
  const snappedEnd = snapToGrid(endPoint, gridSize, snapEnabled)

  // Create rectangle: 4 points forming a rectangle
  return [
    snappedStart,
    { x: snappedEnd.x, y: snappedStart.y },
    snappedEnd,
    { x: snappedStart.x, y: snappedEnd.y },
    snappedStart, // Close the rectangle
  ]
}

/**
 * Handle moving a point with attachment handling.
 */
export function handleMovePoint(
  pointIndex: number,
  newPosition: Point2,
  wall: Wall,
  gridSize: number,
  snapEnabled: boolean,
  allWalls: Wall[]
): { points: Point2[]; attachments: Array<{ wallId: string; pointIndex: number; attachment: WallPointAttachment }> } {
  const snappedPoint = snapToGrid(newPosition, gridSize, snapEnabled)
  const newPoints = [...wall.points]
  newPoints[pointIndex] = snappedPoint

  // Check for new attachments
  const attachments: Array<{ wallId: string; pointIndex: number; attachment: WallPointAttachment }> = []

  for (const otherWall of allWalls) {
    if (otherWall.id === wall.id) continue

    const attachment = detectAttachment(snappedPoint, otherWall)
    if (attachment) {
      attachments.push({
        wallId: otherWall.id,
        pointIndex,
        attachment,
      })
    }
  }

  return { points: newPoints, attachments }
}

/**
 * Find the index of the wall segment (0-based) closest to the given point.
 * Used for insert-point tool to choose which segment to split.
 */
export function getNearestSegmentIndex(wall: Wall, point: Point2): number {
  let bestIndex = 0
  let minDistSq = Infinity
  for (let i = 0; i < wall.points.length - 1; i++) {
    const p1 = wall.points[i]!
    const p2 = wall.points[i + 1]!
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const lengthSq = dx * dx + dy * dy
    if (lengthSq < 1e-10) continue
    const t = clamp(((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lengthSq, 0, 1)
    const projX = p1.x + t * dx
    const projY = p1.y + t * dy
    const d = (point.x - projX) ** 2 + (point.y - projY) ** 2
    if (d < minDistSq) {
      minDistSq = d
      bestIndex = i
    }
  }
  return bestIndex
}

/**
 * Handle inserting a point into a wall segment.
 */
export function handleInsertPoint(
  wall: Wall,
  segmentIndex: number,
  position: Point2,
  gridSize: number,
  snapEnabled: boolean
): Point2[] {
  // Insert-point should preserve geometry on the clicked segment.
  // Do not grid-snap here; project onto the segment so existing aligned walls
  // cannot jump to another grid row/column when adding a control point.
  const safeSegmentIndex = clamp(segmentIndex, 0, wall.points.length - 2)
  const p1 = wall.points[safeSegmentIndex]
  const p2 = wall.points[safeSegmentIndex + 1]
  let insertedPoint = position
  if (p1 && p2) {
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const lengthSq = dx * dx + dy * dy
    if (lengthSq > 1e-10) {
      const t = clamp(((position.x - p1.x) * dx + (position.y - p1.y) * dy) / lengthSq, 0, 1)
      insertedPoint = {
        x: p1.x + t * dx,
        y: p1.y + t * dy,
      }
    } else {
      insertedPoint = p1
    }
  }
  void gridSize
  void snapEnabled
  const newPoints = [...wall.points]

  // Insert point after segmentIndex
  newPoints.splice(safeSegmentIndex + 1, 0, insertedPoint)

  return newPoints
}

function interpolate(a: Point2, b: Point2, t: number): Point2 {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
  }
}

function cumulativeLengths(points: Point2[]): number[] {
  const out = new Array<number>(points.length).fill(0)
  for (let i = 1; i < points.length; i++) {
    out[i] = (out[i - 1] ?? 0) + distance(points[i - 1]!, points[i]!)
  }
  return out
}

function pointAtDistance(points: Point2[], lengths: number[], targetDistance: number): Point2 {
  const totalLength = lengths[lengths.length - 1] ?? 0
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1 || totalLength < 1e-10) return points[0]!

  const d = clamp(targetDistance, 0, totalLength)
  for (let i = 0; i < points.length - 1; i++) {
    const startDist = lengths[i] ?? 0
    const endDist = lengths[i + 1] ?? 0
    const segLen = endDist - startDist
    if (d <= endDist + 1e-8) {
      if (segLen < 1e-10) return points[i]!
      const t = (d - startDist) / segLen
      return interpolate(points[i]!, points[i + 1]!, clamp(t, 0, 1))
    }
  }
  return points[points.length - 1]!
}

export function projectPointToWall(points: Point2[], point: Point2): { t: number; distanceSq: number } {
  if (points.length < 2) return { t: 0, distanceSq: Infinity }
  const lengths = cumulativeLengths(points)
  const totalLength = lengths[lengths.length - 1] ?? 0
  if (totalLength < 1e-10) return { t: 0, distanceSq: Infinity }

  let bestDistSq = Infinity
  let bestDistanceAlong = 0
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const segLengthSq = dx * dx + dy * dy
    if (segLengthSq < 1e-10) continue
    const proj = projectPointToSegment(point, p1, p2)
    const segT = proj.t
    const dSq = proj.distanceSq
    if (dSq < bestDistSq) {
      bestDistSq = dSq
      const segLength = Math.sqrt(segLengthSq)
      bestDistanceAlong = (lengths[i] ?? 0) + segLength * segT
    }
  }

  return { t: bestDistanceAlong / totalLength, distanceSq: bestDistSq }
}

export interface WallOpeningGeometry {
  center: Point2
  tangent: Point2
  totalLength: number
  segmentIndex: number
  segmentStartDist: number
  segmentEndDist: number
  centerDist: number
}

export function computeOpeningGeometry(points: Point2[], position: number): WallOpeningGeometry | null {
  if (points.length < 2) return null
  const lengths = cumulativeLengths(points)
  const totalLength = lengths[lengths.length - 1] ?? 0
  if (totalLength < 1e-10) return null

  const clampedPos = Number.isFinite(position) ? clamp(position, 0, 1) : 0
  const targetDist = clampedPos * totalLength

  // Find segment that contains targetDist. Use strict upper bound so openings at the
  // segment boundary stay in the lower segment (avoid float assigning them to the next).
  // Skip zero-length segments (duplicate consecutive points): they cannot host an opening.
  let segmentIndex = 0
  let lastValid = -1
  let found = false
  for (let i = 0; i < points.length - 1; i++) {
    const start = lengths[i] ?? 0
    const end = lengths[i + 1] ?? 0
    if (end - start < 1e-10) continue
    lastValid = i
    if (targetDist < end + 1e-10) {
      segmentIndex = i
      found = true
      break
    }
  }
  if (!found && lastValid >= 0) segmentIndex = lastValid

  const segmentStartDist = lengths[segmentIndex] ?? 0
  const segmentEndDist = lengths[segmentIndex + 1] ?? totalLength
  const center = pointAtDistance(points, lengths, targetDist)
  const p1 = points[segmentIndex]!
  const p2 = points[segmentIndex + 1]!
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const tangent = { x: dx / len, y: dy / len }

  return {
    center,
    tangent,
    totalLength,
    segmentIndex,
    segmentStartDist,
    segmentEndDist,
    centerDist: targetDist,
  }
}

function pathBetweenDistancesOpen(
  points: Point2[],
  lengths: number[],
  startDistance: number,
  endDistance: number
): Point2[] {
  const totalLength = lengths[lengths.length - 1] ?? 0
  if (points.length < 2 || totalLength < 1e-10) return []
  const start = clamp(startDistance, 0, totalLength)
  const end = clamp(endDistance, 0, totalLength)
  if (end - start < 1e-8) return []

  const out: Point2[] = [pointAtDistance(points, lengths, start)]
  for (let i = 1; i < points.length; i++) {
    const d = lengths[i] ?? 0
    if (d > start + 1e-8 && d < end - 1e-8) out.push(points[i]!)
  }
  const endPoint = pointAtDistance(points, lengths, end)
  if (distance(out[out.length - 1]!, endPoint) > 1e-6) out.push(endPoint)
  return out
}

/**
 * Total length of the wall polyline (user control vertices only).
 * Used to build gap intervals and solid segments for visual wall rendering.
 */
export function getWallTotalLength(points: Point2[]): number {
  if (points.length < 2) return 0
  const lengths = cumulativeLengths(points)
  return lengths[lengths.length - 1] ?? 0
}

/**
 * Returns the polyline from startDist to endDist along the wall (distance in same units as getWallTotalLength).
 * Used to draw "solid" wall segments between openings; terminator positions are on the line between user vertices.
 */
export function getWallPathBetweenDistances(
  points: Point2[],
  startDist: number,
  endDist: number
): Point2[] {
  if (points.length < 2) return []
  const lengths = cumulativeLengths(points)
  return pathBetweenDistancesOpen(points, lengths, startDist, endDist)
}

function isUsablePath(points: Point2[]): boolean {
  if (points.length < 2) return false
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    total += distance(points[i]!, points[i + 1]!)
  }
  return total > 1e-6
}

function pushUniquePoint(points: Point2[], point: Point2, epsilon = 1e-6): void {
  const last = points[points.length - 1]
  if (!last || distance(last, point) > epsilon) {
    points.push(point)
  }
}

function dedupeSortedTs(values: number[], epsilon = 1e-5): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const out: number[] = []
  for (const value of sorted) {
    const last = out[out.length - 1]
    if (last === undefined || Math.abs(value - last) > epsilon) {
      out.push(value)
    }
  }
  return out
}

/**
 * Handle clipping a wall at intersections.
 * Trims only the clicked segment, bounded by segment endpoints/intersections/T-junctions.
 */
export function handleClipWall(
  wall: Wall,
  allWalls: Wall[],
  clickPoint?: Point2
): { walls: Wall[]; trimmedSegment?: Point2[] } {
  if (wall.points.length < 2) return { walls: [wall] }
  if (isCurvedWall(wall)) return { walls: [wall] }
  const isClosed =
    wall.points.length >= 4 &&
    distance(wall.points[0]!, wall.points[wall.points.length - 1]!) < 1e-6

  // 1) Find clicked segment
  const click = clickPoint ?? wall.points[0]!
  let clickedSegmentIndex = 0
  let clickedSegmentT = 0.5
  let bestDistanceSq = Infinity
  for (let i = 0; i < wall.points.length - 1; i++) {
    const a = wall.points[i]!
    const b = wall.points[i + 1]!
    const proj = projectPointToSegment(click, a, b)
    if (proj.distanceSq < bestDistanceSq) {
      bestDistanceSq = proj.distanceSq
      clickedSegmentIndex = i
      clickedSegmentT = proj.t
    }
  }

  const segStart = wall.points[clickedSegmentIndex]!
  const segEnd = wall.points[clickedSegmentIndex + 1]!

  // 2) Terminators on that single segment: endpoints + crossings + T-junction endpoints
  const terminatorTs: number[] = [0, 1]
  const tJunctionThresholdSq = 25 // 5 px
  for (const otherWall of allWalls) {
    if (otherWall.id === wall.id) continue

    // Curves store start/control/end, but only their derived centerline is wall geometry.
    // Never let the two visual control-guide legs become clipping terminators.
    const otherWallPath = getWallPathPoints(otherWall)

    // crossings against every actual wall-path segment
    for (let j = 0; j < otherWallPath.length - 1; j++) {
      const iPoint = findLineIntersection(
        segStart,
        segEnd,
        otherWallPath[j]!,
        otherWallPath[j + 1]!
      )
      if (iPoint) {
        const proj = projectPointToSegment(iPoint, segStart, segEnd)
        if (proj.t > 1e-6 && proj.t < 1 - 1e-6) terminatorTs.push(proj.t)
      }
    }

    // T-junction endpoints lying on this segment
    const endpoints = [otherWall.points[0], otherWall.points[otherWall.points.length - 1]]
    for (const endpoint of endpoints) {
      if (!endpoint) continue
      const proj = projectPointToSegment(endpoint, segStart, segEnd)
      if (proj.distanceSq <= tJunctionThresholdSq && proj.t > 1e-6 && proj.t < 1 - 1e-6) {
        terminatorTs.push(proj.t)
      }
    }
  }

  const ts = dedupeSortedTs(terminatorTs)
  const leftT = [...ts].reverse().find((t) => t < clickedSegmentT - 1e-6) ?? 0
  const rightT = ts.find((t) => t > clickedSegmentT + 1e-6) ?? 1
  if (rightT - leftT < 1e-6) return { walls: [wall] }

  const leftPoint = interpolate(segStart, segEnd, leftT)
  const rightPoint = interpolate(segStart, segEnd, rightT)
  const trimmedSegment = [leftPoint, rightPoint]

  // 3) Build kept geometry
  const newWalls: Wall[] = []
  if (isClosed) {
    // Closed loops become a single open loop after trimming one bounded piece on clicked segment
    const unique = wall.points.slice(0, -1)
    const n = unique.length
    const startVertex = (clickedSegmentIndex + 1) % n
    const endVertex = clickedSegmentIndex % n
    const kept: Point2[] = []
    pushUniquePoint(kept, rightPoint)
    let v = startVertex
    for (;;) {
      pushUniquePoint(kept, unique[v]!)
      if (v === endVertex) break
      v = (v + 1) % n
    }
    pushUniquePoint(kept, leftPoint)
    if (isUsablePath(kept)) {
      newWalls.push({
        ...wall,
        id: `${wall.id}_trim_0`,
        points: kept,
      })
    }
  } else {
    // Open polyline: trimming one bounded segment yields up to 2 walls
    const leftPath: Point2[] = [...wall.points.slice(0, clickedSegmentIndex + 1)]
    if (leftT > 1e-6) pushUniquePoint(leftPath, leftPoint)

    const rightPath: Point2[] = []
    if (rightT < 1 - 1e-6) pushUniquePoint(rightPath, rightPoint)
    for (const point of wall.points.slice(clickedSegmentIndex + 1)) {
      pushUniquePoint(rightPath, point!)
    }

    if (isUsablePath(leftPath)) {
      newWalls.push({
        ...wall,
        id: `${wall.id}_trim_0`,
        points: leftPath,
      })
    }
    if (isUsablePath(rightPath)) {
      newWalls.push({
        ...wall,
        id: `${wall.id}_trim_1`,
        points: rightPath,
      })
    }
  }

  // If no usable leftovers, this operation deletes the whole wall (valid for single-segment walls)
  return { walls: newWalls, trimmedSegment }
}

/**
 * Window insert width used by both preview and final placement.
 * We intentionally average the preview baseline and click baseline, then
 * round up to a clean 10 px step so the value is stable and user-friendly.
 */
export function resolveWindowInsertWidthPx(
  clickBaselineWidthPx: number,
  previewBaselineWidthPx: number
): number {
  const safeClick = Number.isFinite(clickBaselineWidthPx) && clickBaselineWidthPx > 0
    ? clickBaselineWidthPx
    : 100
  const safePreview = Number.isFinite(previewBaselineWidthPx) && previewBaselineWidthPx > 0
    ? previewBaselineWidthPx
    : 100
  const averaged = (safeClick + safePreview) / 2
  return Math.max(10, Math.ceil(averaged / 10) * 10)
}

/**
 * Validate whether an opening of given width can be placed on the wall at the projected position.
 * Returns valid flag and the normalized position (0-1) for preview/insert.
 */
export function validateOpeningPlacement(
  wall: Wall,
  position: Point2,
  width: number,
  doors: Door[],
  windows: Window[]
): { valid: boolean; position: number; width: number } {
  const { door } = handleInsertDoor(wall, position, width)
  const pos = door.position
  const totalLength = getWallTotalLength(wall.points)
  if (totalLength < 1e-10) return { valid: false, position: pos, width }
  const segInfos = getSegmentInfos(wall.points)
  const centerDist = pos * totalLength
  let segmentIndex = 0
  for (let i = 0; i < segInfos.length; i++) {
    const seg = segInfos[i]!
    if (centerDist <= seg.endDist + 1e-8) {
      segmentIndex = i
      break
    }
  }
  const seg = segInfos[segmentIndex]
  if (!seg || seg.length < 1e-6) return { valid: false, position: pos, width }

  // Openings should always be placeable on a segment:
  // - width auto-shrinks to segment length when needed
  // - center auto-clamps and can shift to avoid vertices/other openings
  const desiredWidth = Number.isFinite(width) && width > 0 ? width : 1
  const fittedWidth = clamp(desiredWidth, 1, seg.length)
  const halfWidth = fittedWidth / 2
  const centerAlongSegmentRaw = centerDist - seg.startDist
  const clampedCenter = clamp(centerAlongSegmentRaw, halfWidth, seg.length - halfWidth)

  const wallDoors = doors
    .filter((d) => d.wallId === wall.id)
    .map((d) => ({ ...d, segmentIndex: undefined, centerAlongSegment: undefined }))
  const wallWindows = windows
    .filter((w) => w.wallId === wall.id)
    .map((w) => ({ ...w, segmentIndex: undefined, centerAlongSegment: undefined }))
  // For hover/preview collision checks, always derive geometry from normalized position.
  // This avoids stale segment-local cache values causing temporary visual overlap.
  const bySegment = getOpeningsBySegment(wall.points, wallDoors, wallWindows)
  const existing = bySegment.get(segmentIndex) ?? []

  // Existing openings are fixed obstacles while previewing/inserting a new one.
  // Compute legal center ranges where the new opening does not overlap.
  const minCenter = halfWidth
  const maxCenter = seg.length - halfWidth
  let allowedRanges: Array<{ start: number; end: number }> = [{ start: minCenter, end: maxCenter }]
  const EPS = 1e-6

  for (const o of existing) {
    const minGap = halfWidth + o.width / 2
    const blockedStart = o.centerAlongSegment - minGap
    const blockedEnd = o.centerAlongSegment + minGap
    if (blockedEnd <= minCenter + EPS || blockedStart >= maxCenter - EPS) continue

    const nextAllowed: Array<{ start: number; end: number }> = []
    for (const range of allowedRanges) {
      if (blockedEnd <= range.start + EPS || blockedStart >= range.end - EPS) {
        nextAllowed.push(range)
        continue
      }
      if (blockedStart > range.start + EPS) {
        nextAllowed.push({ start: range.start, end: Math.min(range.end, blockedStart) })
      }
      if (blockedEnd < range.end - EPS) {
        nextAllowed.push({ start: Math.max(range.start, blockedEnd), end: range.end })
      }
    }
    allowedRanges = nextAllowed
    if (allowedRanges.length === 0) {
      return { valid: false, position: pos, width: fittedWidth }
    }
  }

  let fittedCenterAlongSegment = clampedCenter
  const inAllowedRange = allowedRanges.find(
    (range) => clampedCenter >= range.start - EPS && clampedCenter <= range.end + EPS
  )
  if (!inAllowedRange) {
    let bestCenter: number | null = null
    let bestDist = Infinity
    for (const range of allowedRanges) {
      const candidates = [range.start, range.end]
      for (const candidate of candidates) {
        const dist = Math.abs(candidate - clampedCenter)
        if (dist < bestDist) {
          bestDist = dist
          bestCenter = candidate
        }
      }
    }
    if (bestCenter == null) {
      return { valid: false, position: pos, width: fittedWidth }
    }
    fittedCenterAlongSegment = bestCenter
  }

  const fittedCenterDist = seg.startDist + fittedCenterAlongSegment
  const fittedPosition = clamp(fittedCenterDist / totalLength, 0, 1)

  return { valid: true, position: fittedPosition, width: fittedWidth }
}

/**
 * Handle inserting a door into a wall.
 */
export function handleInsertDoor(
  wall: Wall,
  position: Point2,
  defaultWidth: number = 80
): { door: Omit<import('@/types/schema').Door, 'id'> } {
  const totalLength = getWallTotalLength(wall.points)
  const bestT =
    totalLength > 1e-10
      ? projectPointToWall(wall.points, position).t
      : 0

  return {
    door: {
      floorId: wall.floorId,
      wallId: wall.id,
      position: bestT,
      width: defaultWidth,
      swing: 'right',
      direction: 'out',
      isOpening: false,
    },
  }
}

/**
 * Handle inserting a window into a wall.
 */
export function handleInsertWindow(
  wall: Wall,
  position: Point2,
  defaultWidth: number = 100
): { window: Omit<import('@/types/schema').Window, 'id'> } {
  // Same logic as door insertion
  const doorResult = handleInsertDoor(wall, position, defaultWidth)
  return {
    window: {
      floorId: wall.floorId,
      wallId: wall.id,
      position: doorResult.door.position,
      width: defaultWidth,
    },
  }
}
