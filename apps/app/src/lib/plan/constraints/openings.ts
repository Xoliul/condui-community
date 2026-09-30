import type { Point2 } from '@/types/schema'
import type { Door, Window } from '@/types/schema'
import { computeOpeningGeometry, getWallTotalLength } from '@/handlers/plan/wallDrawing'
import { getSegmentInfos } from './segmentGeometry'
import type { OpeningOnSegment, OpeningPositionsResult, OpeningMoveInput } from './types'
import { MIN_OPENING_WIDTH, DISTANCE_EPS } from './constants'
import { clamp } from '@/lib/geometry'

/**
 * Index of the non-degenerate segment that contains `dist` (boundary assigned to the lower
 * segment). Zero-length segments (duplicate consecutive points) are never selected.
 */
export function findSegmentIndexAtDist(
  segInfos: Array<{ startDist: number; endDist: number; length: number }>,
  dist: number
): number {
  let lastValid = -1
  for (let i = 0; i < segInfos.length; i++) {
    const seg = segInfos[i]!
    if (seg.length < DISTANCE_EPS) continue
    lastValid = i
    if (dist <= seg.endDist + 1e-8) return i
  }
  return lastValid >= 0 ? lastValid : 0
}

/**
 * Drop consecutive duplicate points (zero-length segments). Keeps at least 2 points;
 * if every point is identical the input is returned unchanged.
 */
export function removeDuplicateConsecutivePoints(points: Point2[], eps = 1e-6): Point2[] {
  if (points.length < 2) return points
  const out: Point2[] = [points[0]!]
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    const prev = out[out.length - 1]!
    if (Math.abs(p.x - prev.x) <= eps && Math.abs(p.y - prev.y) <= eps) continue
    out.push(p)
  }
  return out.length >= 2 ? out : points
}

/**
 * Collect all openings on a wall with segment-local geometry.
 */
export function getOpeningsBySegment(
  points: Point2[],
  doors: Door[],
  windows: Window[]
): Map<number, OpeningOnSegment[]> {
  const bySegment = new Map<number, OpeningOnSegment[]>()
  const totalLength = getWallTotalLength(points)
  if (totalLength < DISTANCE_EPS) return bySegment

  const segInfos = getSegmentInfos(points)

  const all: Array<{
    id: string
    kind: 'door' | 'window'
    width: number
    position: number
    segmentIndex?: number
    centerAlongSegment?: number
  }> = [
    ...doors.map((d) => ({
      id: d.id,
      kind: 'door' as const,
      width: d.width,
      position: d.position,
      segmentIndex: d.segmentIndex,
      centerAlongSegment: d.centerAlongSegment,
    })),
    ...windows.map((w) => ({
      id: w.id,
      kind: 'window' as const,
      width: w.width,
      position: w.position,
      segmentIndex: w.segmentIndex,
      centerAlongSegment: w.centerAlongSegment,
    })),
  ]

  for (const o of all) {
    if (o.width < MIN_OPENING_WIDTH) continue

    let segmentIndex = o.segmentIndex
    let centerAlongSegment = o.centerAlongSegment
    let centerDist: number | null = null

    if (
      segmentIndex != null &&
      centerAlongSegment != null &&
      segmentIndex >= 0 &&
      segmentIndex < segInfos.length
    ) {
      const seg = segInfos[segmentIndex]
      if (seg && seg.length >= DISTANCE_EPS) {
        centerDist = seg.startDist + centerAlongSegment
      }
    }

    if (centerDist == null) {
      const g = computeOpeningGeometry(points, o.position)
      if (!g) continue
      segmentIndex = g.segmentIndex
      centerDist = g.centerDist
      centerAlongSegment = g.centerDist - g.segmentStartDist
    }

    const item: OpeningOnSegment = {
      id: o.id,
      kind: o.kind,
      width: o.width,
      centerDist,
      centerAlongSegment: centerAlongSegment!,
    }
    let list = bySegment.get(segmentIndex!)
    if (!list) {
      list = []
      bySegment.set(segmentIndex!, list)
    }
    list.push(item)
  }

  for (const list of bySegment.values()) {
    list.sort((a, b) => a.centerAlongSegment - b.centerAlongSegment)
  }
  return bySegment
}

/**
 * Compute minimum segment length required to fit the given openings:
 * segment length must be at least the sum of all opening widths (per requirement doc).
 * The "center at least halfWidth from each end" is enforced when fitting; the minimum
 * length to fit all openings without overlap is sum of widths.
 */
export function minSegmentLengthForOpenings(openings: OpeningOnSegment[]): number {
  if (openings.length === 0) return 0
  return openings.reduce((s, o) => s + o.width, 0)
}

/**
 * Reposition openings on a segment so they fit in [0, segmentLength] without overlap
 * (train-of-carts). Preserves order. Returns new center positions along the segment.
 */
export function fitOpeningsInSegment(
  segmentLength: number,
  openings: OpeningOnSegment[]
): OpeningPositionsResult {
  const positionsByOpeningId = new Map<string, number>()
  if (openings.length === 0 || segmentLength < DISTANCE_EPS) {
    return { positionsByOpeningId, wasAdjusted: false }
  }

  const sumWidths = openings.reduce((s, o) => s + o.width, 0)
  if (sumWidths > segmentLength + DISTANCE_EPS) {
    let pos = segmentLength / 2 - sumWidths / 2
    for (const o of openings) {
      pos = clamp(pos, o.width / 2, segmentLength - o.width / 2)
      positionsByOpeningId.set(o.id, pos)
      pos += o.width
    }
    return { positionsByOpeningId, wasAdjusted: true }
  }

  const widths = openings.map((o) => o.width)
  const preferredStarts = openings.map((o) => o.centerAlongSegment - o.width / 2)

  // Forward pass (push to the right): enforce left boundary + non-overlap.
  const starts = new Array<number>(openings.length).fill(0)
  let prevEnd = 0
  for (let i = 0; i < openings.length; i++) {
    const width = widths[i]!
    const preferred = preferredStarts[i]!
    const start = Math.max(preferred, prevEnd)
    starts[i] = start
    prevEnd = start + width
  }

  // Backward pass (push to the left): enforce right boundary without breaking order.
  starts[starts.length - 1] = Math.min(
    starts[starts.length - 1]!,
    segmentLength - widths[widths.length - 1]!
  )
  for (let i = starts.length - 2; i >= 0; i--) {
    const maxStart = starts[i + 1]! - widths[i]!
    if (starts[i]! > maxStart) {
      starts[i] = maxStart
    }
  }

  // Feasible data guarantees this, but keep defensive guards for float jitter.
  if (starts[0]! < 0) {
    const underflow = -starts[0]!
    for (let i = 0; i < starts.length; i++) {
      starts[i] = starts[i]! + underflow
    }
  }
  const lastOverflow = starts[starts.length - 1]! + widths[widths.length - 1]! - segmentLength
  if (lastOverflow > DISTANCE_EPS) {
    for (let i = 0; i < starts.length; i++) {
      starts[i] = starts[i]! - lastOverflow
    }
  }

  let wasAdjusted = false
  for (let i = 0; i < openings.length; i++) {
    const center = starts[i]! + widths[i]! / 2
    positionsByOpeningId.set(openings[i]!.id, center)
    if (Math.abs(center - openings[i]!.centerAlongSegment) > DISTANCE_EPS) {
      wasAdjusted = true
    }
  }

  return { positionsByOpeningId, wasAdjusted }
}

/**
 * Sanitize all opening positions on a wall so they fit on their segments (no overlap,
 * no crossing vertices). Returns position updates to apply to doors and windows.
 */
export function sanitizeWallOpeningPositions(
  points: Point2[],
  doors: Door[],
  windows: Window[]
): {
  doorUpdates: Array<{ id: string; position: number }>
  windowUpdates: Array<{ id: string; position: number }>
} {
  const doorUpdates: Array<{ id: string; position: number }> = []
  const windowUpdates: Array<{ id: string; position: number }> = []
  const totalLength = getWallTotalLength(points)
  if (totalLength < DISTANCE_EPS) return { doorUpdates, windowUpdates }

  const bySegment = getOpeningsBySegment(points, doors, windows)
  const segInfos = getSegmentInfos(points)
  for (const [segIndex, openings] of bySegment) {
    if (openings.length === 0) continue
    const seg = segInfos[segIndex]
    if (!seg || seg.length < DISTANCE_EPS) continue
    const fit = fitOpeningsInSegment(seg.length, openings)
    if (!fit.wasAdjusted) continue
    for (const o of openings) {
      const newCenterAlongSegment = fit.positionsByOpeningId.get(o.id)
      if (newCenterAlongSegment == null) continue
      const newCenterDist = seg.startDist + newCenterAlongSegment
      const newPosition = newCenterDist / totalLength
      if (o.kind === 'door') {
        doorUpdates.push({ id: o.id, position: newPosition })
      } else {
        windowUpdates.push({ id: o.id, position: newPosition })
      }
    }
  }
  return { doorUpdates, windowUpdates }
}

/**
 * Resize one opening without pushing neighboring openings.
 * Growth is one-sided toward whichever side currently has more free space.
 * If there is not enough room, width is clamped so we never overlap neighbors
 * or cross segment vertices.
 */
export function resizeOpeningTowardFreeSpace(
  points: Point2[],
  doors: Door[],
  windows: Window[],
  openingId: string,
  kind: 'door' | 'window',
  requestedWidth: number
): { position: number; width: number } | null {
  const totalLength = getWallTotalLength(points)
  if (totalLength < DISTANCE_EPS) return null
  const bySegment = getOpeningsBySegment(points, doors, windows)
  const segInfos = getSegmentInfos(points)
  const safeRequestedWidth = Math.max(MIN_OPENING_WIDTH, requestedWidth)

  for (const [segmentIndex, openings] of bySegment.entries()) {
    const seg = segInfos[segmentIndex]
    if (!seg || seg.length < DISTANCE_EPS) continue
    const targetIndex = openings.findIndex((o) => o.id === openingId && o.kind === kind)
    if (targetIndex < 0) continue

    const target = openings[targetIndex]!
    const prev = targetIndex > 0 ? openings[targetIndex - 1]! : null
    const next = targetIndex < openings.length - 1 ? openings[targetIndex + 1]! : null

    const oldHalf = target.width / 2
    const oldLeft = target.centerAlongSegment - oldHalf
    const oldRight = target.centerAlongSegment + oldHalf
    const leftLimit = prev ? prev.centerAlongSegment + prev.width / 2 : 0
    const rightLimit = next ? next.centerAlongSegment - next.width / 2 : seg.length

    // Available room outside current opening bounds on each side.
    const freeLeft = Math.max(0, oldLeft - leftLimit)
    const freeRight = Math.max(0, oldRight <= rightLimit ? rightLimit - oldRight : 0)
    const growTowardRight = freeRight >= freeLeft

    let newLeft = oldLeft
    let newRight = oldRight
    if (growTowardRight) {
      newRight = Math.min(rightLimit, oldLeft + safeRequestedWidth)
    } else {
      newLeft = Math.max(leftLimit, oldRight - safeRequestedWidth)
    }

    // Defensive clamp to valid interval.
    if (newRight < newLeft) {
      const mid = (newLeft + newRight) / 2
      newLeft = mid
      newRight = mid
    }

    const newWidth = Math.max(MIN_OPENING_WIDTH, newRight - newLeft)
    const newCenterAlongSegment = (newLeft + newRight) / 2
    const newPosition = (seg.startDist + newCenterAlongSegment) / totalLength
    return {
      position: clamp(newPosition, 0, 1),
      width: newWidth,
    }
  }

  return null
}

/**
 * Preserve segment-local position for openings when wall points change.
 * Use when updating wall points so openings on unaffected segments don't slide.
 * For each opening (optionally excluding those already updated), recomputes
 * normalized position from (segment index + centerAlongSegment in old geometry)
 * to new geometry. Does not run fit/sanitize.
 */
export function preserveOpeningPositionsAfterPointChange(
  oldPoints: Point2[],
  newPoints: Point2[],
  doors: Door[],
  windows: Window[],
  excludeOpeningIds: Set<string> = new Set()
): {
  doorUpdates: Array<{ id: string; position: number }>
  windowUpdates: Array<{ id: string; position: number }>
} {
  const doorUpdates: Array<{ id: string; position: number }> = []
  const windowUpdates: Array<{ id: string; position: number }> = []
  const oldTotal = getWallTotalLength(oldPoints)
  const newTotal = getWallTotalLength(newPoints)
  if (oldTotal < DISTANCE_EPS || newTotal < DISTANCE_EPS) return { doorUpdates, windowUpdates }
  const oldSegInfos = getSegmentInfos(oldPoints)
  const newSegInfos = getSegmentInfos(newPoints)

  const process = (id: string, kind: 'door' | 'window', position: number) => {
    if (excludeOpeningIds.has(id)) return
    const centerDist = position * oldTotal
    const segIndex = findSegmentIndexAtDist(oldSegInfos, centerDist)
    const oldSeg = oldSegInfos[segIndex]
    const newSeg = newSegInfos[segIndex]
    if (!oldSeg || !newSeg) return
    // Stay on the same segment: never let the opening slip past the new segment's end.
    const centerAlongSegment = Math.min(Math.max(0, centerDist - oldSeg.startDist), newSeg.length)
    const newCenterDist = newSeg.startDist + centerAlongSegment
    const newPosition = clamp(newCenterDist / newTotal, 0, 1)
    if (kind === 'door') {
      doorUpdates.push({ id, position: newPosition })
    } else {
      windowUpdates.push({ id, position: newPosition })
    }
  }

  for (const d of doors) {
    process(d.id, 'door', d.position)
  }
  for (const w of windows) {
    process(w.id, 'window', w.position)
  }
  return { doorUpdates, windowUpdates }
}

/**
 * World-position-preserving variant of preserveOpeningPositionsAfterPointChange, used when a
 * wall's points change without explicit opening updates (endpoint/junction drag, merge, ...).
 *
 * Per opening segment:
 * - segment length unchanged (pure translation/rotation of the segment): keep the
 *   segment-local offset, so the opening travels with the wall;
 * - segment stretched/shortened/bent: project the opening's old world centre onto the new
 *   segment so it stays where it was instead of sliding proportionally. Result is clamped to
 *   the segment; callers should run sanitizeWallOpeningPositions afterwards to fit widths.
 */
export function preserveOpeningWorldPositionsAfterPointChange(
  oldPoints: Point2[],
  newPoints: Point2[],
  doors: Door[],
  windows: Window[],
  excludeOpeningIds: Set<string> = new Set()
): {
  doorUpdates: Array<{ id: string; position: number }>
  windowUpdates: Array<{ id: string; position: number }>
} {
  const doorUpdates: Array<{ id: string; position: number }> = []
  const windowUpdates: Array<{ id: string; position: number }> = []
  const oldTotal = getWallTotalLength(oldPoints)
  const newTotal = getWallTotalLength(newPoints)
  if (oldTotal < DISTANCE_EPS || newTotal < DISTANCE_EPS) return { doorUpdates, windowUpdates }
  const oldSegInfos = getSegmentInfos(oldPoints)
  const newSegInfos = getSegmentInfos(newPoints)

  const process = (id: string, kind: 'door' | 'window', position: number) => {
    if (excludeOpeningIds.has(id)) return
    const centerDist = position * oldTotal
    const segIndex = findSegmentIndexAtDist(oldSegInfos, centerDist)
    const oldSeg = oldSegInfos[segIndex]
    const newSeg = newSegInfos[segIndex]
    const a0 = oldPoints[segIndex]
    const b0 = oldPoints[segIndex + 1]
    const a1 = newPoints[segIndex]
    const b1 = newPoints[segIndex + 1]
    if (!oldSeg || !newSeg || !a0 || !b0 || !a1 || !b1) return
    const along = Math.min(Math.max(0, centerDist - oldSeg.startDist), oldSeg.length)
    let newAlong: number
    if (Math.abs(newSeg.length - oldSeg.length) <= 1e-6 || newSeg.length < DISTANCE_EPS) {
      newAlong = Math.min(along, newSeg.length)
    } else {
      const u = along / oldSeg.length
      const cx = a0.x + (b0.x - a0.x) * u
      const cy = a0.y + (b0.y - a0.y) * u
      const dx = (b1.x - a1.x) / newSeg.length
      const dy = (b1.y - a1.y) / newSeg.length
      newAlong = clamp((cx - a1.x) * dx + (cy - a1.y) * dy, 0, newSeg.length)
    }
    const newPosition = clamp((newSeg.startDist + newAlong) / newTotal, 0, 1)
    if (kind === 'door') doorUpdates.push({ id, position: newPosition })
    else windowUpdates.push({ id, position: newPosition })
  }

  for (const d of doors) process(d.id, 'door', d.position)
  for (const w of windows) process(w.id, 'window', w.position)
  return { doorUpdates, windowUpdates }
}

/**
 * Recompute canonical segment-local coordinates for all openings on a wall
 * from their current normalised positions. This is intended to be called at
 * store level after wall geometry or opening positions change, so that
 * Door/Window.segmentIndex and .centerAlongSegment remain the single
 * source of truth for future constraint calculations.
 */
export function recomputeOpeningLocalFromNormalized(
  points: Point2[],
  doors: Door[],
  windows: Window[]
): void {
  const totalLength = getWallTotalLength(points)
  if (totalLength < DISTANCE_EPS) return
  const segInfos = getSegmentInfos(points)

  const recomputeOne = (position: number) => {
    const centerDist = position * totalLength
    const segIndex = findSegmentIndexAtDist(segInfos, centerDist)
    const seg = segInfos[segIndex]
    if (!seg) {
      return {
        segmentIndex: undefined as number | undefined,
        centerAlongSegment: undefined as number | undefined,
      }
    }
    const centerAlongSegment = centerDist - seg.startDist
    return { segmentIndex: segIndex, centerAlongSegment }
  }

  for (const d of doors) {
    const { segmentIndex, centerAlongSegment } = recomputeOne(d.position)
    d.segmentIndex = segmentIndex
    d.centerAlongSegment = centerAlongSegment
  }
  for (const w of windows) {
    const { segmentIndex, centerAlongSegment } = recomputeOne(w.position)
    w.segmentIndex = segmentIndex
    w.centerAlongSegment = centerAlongSegment
  }
}

/**
 * Apply opening move on a single segment with train-of-carts: compute new positions
 * for all openings on that segment from the desired center of the moved opening.
 */
export function applyOpeningMoveOnSegment(input: OpeningMoveInput): OpeningPositionsResult {
  const { segmentOpenings, segmentLength, desiredCenterAlongSegment, width, openingId } = input

  const halfWidth = width / 2
  const desiredCenter = clamp(segmentLength - halfWidth, halfWidth, desiredCenterAlongSegment)

  const movingIndex = segmentOpenings.findIndex((o) => o.id === openingId)
  if (movingIndex === -1) {
    return { positionsByOpeningId: new Map(), wasAdjusted: false }
  }

  const adjustedOpenings = segmentOpenings.map((o, i) =>
    i === movingIndex ? { ...o, centerAlongSegment: desiredCenter } : o
  )
  const fit = fitOpeningsInSegment(segmentLength, adjustedOpenings)

  let wasAdjusted = false
  for (const o of segmentOpenings) {
    const center = fit.positionsByOpeningId.get(o.id)
    if (center == null) continue
    if (Math.abs(center - o.centerAlongSegment) > DISTANCE_EPS) {
      wasAdjusted = true
      break
    }
  }
  return { positionsByOpeningId: fit.positionsByOpeningId, wasAdjusted }
}

/**
 * Move an opening by editing the clear distance on one side of it.
 * Values outside the available segment are intentionally passed through the
 * normal opening-move clamp, so an oversized distance parks the opening
 * against the opposite boundary instead of producing invalid geometry.
 */
export function applyOpeningDistanceOnSegment(input: {
  openingId: string
  kind: 'door' | 'window'
  width: number
  segmentIndex: number
  segmentStartDist: number
  segmentEndDist: number
  segmentLength: number
  segmentOpenings: OpeningOnSegment[]
  side: 'start' | 'end'
  distance: number
}): OpeningPositionsResult {
  const distance = Math.max(0, input.distance)
  const desiredCenterAlongSegment =
    input.side === 'start'
      ? distance + input.width / 2
      : input.segmentLength - distance - input.width / 2

  return applyOpeningMoveOnSegment({
    openingId: input.openingId,
    kind: input.kind,
    width: input.width,
    segmentIndex: input.segmentIndex,
    segmentStartDist: input.segmentStartDist,
    segmentEndDist: input.segmentEndDist,
    segmentLength: input.segmentLength,
    segmentOpenings: input.segmentOpenings,
    desiredCenterAlongSegment,
  })
}
