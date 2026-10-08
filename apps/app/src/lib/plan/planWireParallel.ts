import type { PlanWireRoute, Point2 } from '@/types/schema'

/** Gap between parallel wires of one bundle, in plan units (about 8 cm at the editor scale). */
export const PLAN_WIRE_PARALLEL_SPACING = 8
export const PLAN_WIRE_MAX_LANES = 4

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
  return {
    key: `${route.floorId}|${reversed ? `${to}|${from}` : `${from}|${to}`}|${path}`,
    reversed,
  }
}

/** Three and four wires share the same maximum width; two keep their normal gap. */
export function planWireBundleOffsets(
  count: number,
  spacing = PLAN_WIRE_PARALLEL_SPACING
): number[] {
  const gap = count > 1 ? Math.min(spacing, (spacing * 2) / (count - 1)) : spacing
  return Array.from({ length: count }, (_, index) => (index - (count - 1) / 2) * gap)
}

/** Keep all logical cables; crowded bundles share lanes by colour and expose their counts. */
export function planWireBundleLanes(
  members: readonly { index: number; color: string; priority: number }[]
): {
  indices: number[]
  representative: number
  lane: number
  count?: number
  dashSlot: number
  dashSlots: number
}[] {
  if (members.length <= PLAN_WIRE_MAX_LANES)
    return members.map((member, lane) => ({
      indices: [member.index],
      representative: member.index,
      lane,
      dashSlot: 0,
      dashSlots: 1,
    }))
  const byColor = new Map<string, (typeof members)[number][]>()
  for (const member of members) {
    const group = byColor.get(member.color) ?? []
    group.push(member)
    byColor.set(member.color, group)
  }
  const groups = [...byColor.values()]
  return groups.map((group, index) => {
    const lane = index % PLAN_WIRE_MAX_LANES
    const representative = [...group].sort((a, b) => b.priority - a.priority)[0]!
    return {
      indices: group.map((member) => member.index),
      representative: representative.index,
      lane,
      count: group.length,
      dashSlot: Math.floor(index / PLAN_WIRE_MAX_LANES),
      dashSlots: Math.ceil((groups.length - lane) / PLAN_WIRE_MAX_LANES),
    }
  })
}

/** Position by travelled distance, so bundle counts sit on the path even around bends. */
export function planWireBundleLabel(points: readonly Point2[], fraction = 0.5): Point2 {
  const lengths = points
    .slice(1)
    .map((point, index) => Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y))
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * fraction
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index]!
    if (length > 0 && remaining <= length) {
      const from = points[index]!,
        to = points[index + 1]!
      return {
        x: from.x + ((to.x - from.x) * remaining) / length,
        y: from.y + ((to.y - from.y) * remaining) / length,
      }
    }
    remaining -= length
  }
  return points[0] ?? { x: 0, y: 0 }
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

/** Parallel cables share their anchors and fan out over a short distance at both ends. */
export function fanOutBundlePolyline(points: readonly Point2[], offset: number): Point2[] {
  if (offset === 0 || points.length < 2) return [...points]
  const distances = [0]
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!,
      to = points[index]!
    distances.push(distances[index - 1]! + Math.hypot(to.x - from.x, to.y - from.y))
  }
  const total = distances.at(-1)!
  if (total < 1e-6) return [...points]
  // Short routes still have a parallel middle; long routes spread within 32 plan units.
  const fanLength = Math.min(32, total / 3)
  const stemLength = Math.min(4, fanLength / 4)
  const transition = Array.from(
    { length: 7 },
    (_, index) => stemLength + ((fanLength - stemLength) * index) / 6
  )
  const samples = [
    ...new Set([...distances, ...transition, ...transition.map((distance) => total - distance)]),
  ].sort((a, b) => a - b)
  let segment = 0
  const centre = samples.map((distance) => {
    while (segment < points.length - 2 && distances[segment + 1]! <= distance) segment++
    const from = points[segment]!,
      to = points[segment + 1]!
    const length = distances[segment + 1]! - distances[segment]!
    const fraction = length > 1e-6 ? (distance - distances[segment]!) / length : 0
    return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction }
  })
  const compactOffset = Math.sign(offset) * Math.min(Math.abs(offset), fanLength / 2)
  const shifted = offsetPolyline(centre, compactOffset)
  return centre.map((point, index) => {
    const distance = Math.min(samples[index]!, total - samples[index]!)
    const progress = Math.max(0, Math.min(1, (distance - stemLength) / (fanLength - stemLength)))
    const spread = progress * progress * (3 - 2 * progress)
    return {
      x: point.x + (shifted[index]!.x - point.x) * spread,
      y: point.y + (shifted[index]!.y - point.y) * spread,
    }
  })
}
