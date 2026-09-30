import type { PlanWireRoute, Point2 } from '@/types/schema'

/** Gap between parallel wires of one bundle, in plan units (about 8 cm at the editor scale). */
export const PLAN_WIRE_PARALLEL_SPACING = 8

/**
 * Wires between the same two symbols along the same path form a bundle: several cables
 * (e.g. two circuits from the board to one junction panel) drawn side by side instead of on top
 * of each other. Direction does not matter; the waypoints do.
 */
export function planWireBundleKey(
  route: PlanWireRoute,
  basePoints: readonly Point2[]
): { key: string; reversed: boolean } | undefined {
  const from = route.from.placementId
  const to = route.to.placementId
  if (!from || !to || route.riserExit) return undefined
  const reversed = from > to
  const ordered = reversed ? [...basePoints].reverse() : basePoints
  const path = ordered.map((point) => `${Math.round(point.x)},${Math.round(point.y)}`).join(';')
  return { key: `${route.floorId}|${reversed ? `${to}|${from}` : `${from}|${to}`}|${path}`, reversed }
}

/** Evenly spread offsets around the shared centre line for a bundle of `count` wires. */
export function planWireBundleOffsets(count: number, spacing = PLAN_WIRE_PARALLEL_SPACING): number[] {
  return Array.from({ length: count }, (_, index) => (index - (count - 1) / 2) * spacing)
}

/** The polyline shifted sideways by `offset` (left of the travel direction when positive). */
export function offsetPolyline(points: readonly Point2[], offset: number): Point2[] {
  if (offset === 0 || points.length < 2) return [...points]
  const normalOf = (a: Point2, b: Point2): Point2 | undefined => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const length = Math.hypot(dx, dy)
    return length < 1e-9 ? undefined : { x: -dy / length, y: dx / length }
  }
  return points.map((point, index) => {
    const before = index > 0 ? normalOf(points[index - 1]!, point) : undefined
    const after = index < points.length - 1 ? normalOf(point, points[index + 1]!) : undefined
    const sum = { x: (before?.x ?? 0) + (after?.x ?? 0), y: (before?.y ?? 0) + (after?.y ?? 0) }
    const length = Math.hypot(sum.x, sum.y)
    if (length < 1e-9) return { ...point }
    const normal = { x: sum.x / length, y: sum.y / length }
    // Keep the spacing at corners: the miter grows as the path turns.
    const reference = before ?? after!
    const cos = Math.max(0.25, normal.x * reference.x + normal.y * reference.y)
    return { x: point.x + (normal.x * offset) / cos, y: point.y + (normal.y * offset) / cos }
  })
}
