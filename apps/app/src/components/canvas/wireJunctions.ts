import type { Point2, WireSegment } from '@/types/schema'

/** Radius of an explicit supply T-junction dot; previews draw theirs at the same size. */
export const SUPPLY_JUNCTION_DOT_RADIUS = 3

export interface WireJunction {
  point: Point2
  /** Half the drawn size: dot radius, or half the side of a square seam filler. */
  radius: number
  /** Explicit supply T junctions are marked with a dot; corner seams are filled square. */
  shape: 'dot' | 'square'
}

interface JunctionOccurrence {
  segment: WireSegment
  direction: Point2
}

function pointKey(point: Point2): string {
  return `${Math.round(point.x * 1000)},${Math.round(point.y * 1000)}`
}

function directionBetween(from: Point2, to: Point2): Point2 | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  return length > 1e-6 ? { x: dx / length, y: dy / length } : null
}

function isNonCollinear(a: Point2, b: Point2): boolean {
  return Math.abs(a.x * b.y - a.y * b.x) > 1e-3
}

/**
 * Find circuit branch corners where separately rendered wire segments meet.
 * A square exactly as wide as the widest wire fills the butt-cap notch without
 * bulging past the wires, and adds no markers to device endpoints or the main bus.
 */
export function getCircuitWireJunctions(wireSegments: WireSegment[]): WireJunction[] {
  const occurrencesByPoint = new Map<
    string,
    { point: Point2; occurrences: JunctionOccurrence[] }
  >()

  for (const segment of wireSegments) {
    if (!segment.circuitId || segment.type === 'mainBus' || segment.type === 'secondaryBus') continue

    const startDirection = directionBetween(segment.startPoint, segment.endPoint)
    const endDirection = directionBetween(segment.endPoint, segment.startPoint)
    if (startDirection) {
      const key = pointKey(segment.startPoint)
      const entry = occurrencesByPoint.get(key) ?? { point: segment.startPoint, occurrences: [] }
      entry.occurrences.push({ segment, direction: startDirection })
      occurrencesByPoint.set(key, entry)
    }
    if (endDirection) {
      const key = pointKey(segment.endPoint)
      const entry = occurrencesByPoint.get(key) ?? { point: segment.endPoint, occurrences: [] }
      entry.occurrences.push({ segment, direction: endDirection })
      occurrencesByPoint.set(key, entry)
    }
  }

  const junctions: WireJunction[] = []
  // Supply T junctions are explicit: their wires carry no circuit and meet collinear runs.
  const explicitKeys = new Set<string>()
  for (const segment of wireSegments) {
    if (!segment.junctionPoint) continue
    const key = pointKey(segment.junctionPoint)
    if (explicitKeys.has(key)) continue
    explicitKeys.add(key)
    junctions.push({ point: segment.junctionPoint, radius: SUPPLY_JUNCTION_DOT_RADIUS, shape: 'dot' })
  }
  for (const { point, occurrences } of occurrencesByPoint.values()) {
    if (explicitKeys.has(pointKey(point))) continue
    const uniqueOccurrences = occurrences.filter(
      (occurrence, index) =>
        occurrences.findIndex((candidate) => candidate.segment.id === occurrence.segment.id) === index
    )
    const hasCorner = uniqueOccurrences.some((occurrence, index) =>
      uniqueOccurrences
        .slice(index + 1)
        .some((other) => isNonCollinear(occurrence.direction, other.direction))
    )
    if (!hasCorner) continue

    junctions.push({
      point,
      // Half of WireSegment's line width: 6 for trunk runs, 2 for other circuit wires.
      radius: Math.max(...uniqueOccurrences.map(({ segment }) => (segment.type === 'trunk' ? 3 : 1))),
      shape: 'square',
    })
  }

  return junctions
}
