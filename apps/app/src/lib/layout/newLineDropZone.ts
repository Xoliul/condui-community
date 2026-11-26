/**
 * Dashed boxes for the two drops that start a new line off an existing one: a fork on a row and a new riser.
 * The drawn box is exactly the area that triggers the drop, and it wins over every wire and row under it. Only an
 * insert ring drawn over a box keeps its own circle.
 * Sizes are layout units, with a floor in screen pixels so the boxes stay easy to hit when zoomed out. They may
 * cover a cable caption, never the trunk's own drop zone or the rows either side.
 */
import type { Point } from '@/types/ui'

export interface DropZoneRect { left: number; right: number; top: number; bottom: number }

/** Rows are 50 apart and symbols reach 15 either side, so the middle of the gap above a row is its free band. */
const FORK_RISE = 25
/** Clear of the trunk's wire drop zone (10 either side). */
const RISER_GAP = 11
/** Space kept under the first row: its symbols' own drop padding reaches 29 down. */
const RISER_ROW_CLEARANCE = 30

/** Hit radius (screen px) an insert ring keeps inside a box: about the circle as drawn. */
const RING_RADIUS_PX = 7

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Above the wire at the tap point of a fork. */
export function getForkDropZone(tap: Point, zoom: number): DropZoneRect {
  const halfWidth = clamp(14 / zoom, 18, 22), halfHeight = clamp(9 / zoom, 12, 14)
  return { left: tap.x - halfWidth, right: tap.x + halfWidth, top: tap.y - FORK_RISE - halfHeight, bottom: tap.y - FORK_RISE + halfHeight }
}

/** Right of the last riser (or the trunk) at the split, up towards the first row. */
export function getRiserDropZone(split: Point, firstRowY: number, zoom: number): DropZoneRect {
  const left = split.x + RISER_GAP
  return { left, right: left + clamp(26 / zoom, 38, 46), top: Math.min(split.y - 20, Math.max(split.y - 70, firstRowY + RISER_ROW_CLEARANCE)), bottom: split.y + 12 }
}

export const getDropZoneCentre = (zone: DropZoneRect): Point => ({ x: (zone.left + zone.right) / 2, y: (zone.top + zone.bottom) / 2 })

const contains = (zone: DropZoneRect, point: Point, margin = 0): boolean =>
  point.x >= zone.left - margin && point.x <= zone.right + margin && point.y >= zone.top - margin && point.y <= zone.bottom + margin

/** The pointer is on the circle of an insert ring. */
function isOnRing(rings: readonly { point: Point; zone?: DropZoneRect }[], position: Point, zoom: number): boolean {
  return rings.some((ring) => !ring.zone &&
    Math.hypot(ring.point.x - position.x, ring.point.y - position.y) * zoom <= RING_RADIUS_PX)
}

/** The box under the pointer (nearest centre when two touch); the previous box holds on for 3 screen pixels. */
export function resolveNewLineDropZone<T extends { id: string; point: Point; zone?: DropZoneRect }>(
  intents: readonly T[], position: Point, zoom: number, previousId?: string | null,
): T | null {
  if (isOnRing(intents, position, zoom)) return null
  let best: T | null = null, bestDistance = Infinity, held: T | null = null
  for (const intent of intents) {
    if (!intent.zone) continue
    if (intent.id === previousId && contains(intent.zone, position, 3 / zoom)) held = intent
    if (!contains(intent.zone, position)) continue
    const centre = getDropZoneCentre(intent.zone)
    const distance = Math.hypot(centre.x - position.x, centre.y - position.y)
    if (distance < bestDistance) { best = intent; bestDistance = distance }
  }
  return best ?? held
}
