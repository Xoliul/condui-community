import type { Point2 } from '@/types/schema'
import type { Selection } from '@/types/ui'
import type { CableRouteEstimate } from './estimateCableRoutes'

/** Anchors of the routes the app-wide selection refers to: a wire, a circuit, or a point. */
export function selectedCableRouteAnchors(
  selection: Selection,
  routes: readonly CableRouteEstimate[]
): Set<string> {
  const anchors = new Set<string>()
  if (selection.wireAnchor) anchors.add(selection.wireAnchor)
  for (const meta of selection.wireMetadata ?? []) {
    for (const anchor of meta.wireAnchors ?? (meta.wireAnchor ? [meta.wireAnchor] : [])) {
      anchors.add(anchor)
    }
  }
  if (selection.type === 'circuit') {
    const ids = new Set(selection.ids)
    for (const route of routes) if (ids.has(route.circuitId)) anchors.add(route.anchor)
  }
  if (selection.type === 'endpoint') {
    const nodes = new Set(selection.ids.map((id) => `endpoint:${id}`))
    for (const route of routes) if (nodes.has(route.toNodeId)) anchors.add(route.anchor)
  }
  return anchors
}

/**
 * Plan extent of the selected wires on one floor, for focusing the view on them: their runs,
 * wall drops, floor passages, and the symbols they join. Circuit and point selections keep
 * their own framing, so only an explicit wire selection counts here.
 */
export function selectedCableBounds(
  selection: Selection,
  routes: readonly CableRouteEstimate[],
  floorId: string
): { x: number; y: number; width: number; height: number } | null {
  const anchors = selectedCableRouteAnchors({ ...selection, type: 'structuralConnection' }, [])
  if (anchors.size === 0) return null
  const points: Point2[] = []
  for (const route of routes) {
    if (!anchors.has(route.anchor)) continue
    for (const leg of route.legs) {
      if (leg.kind === 'horizontal' && leg.floorId === floorId) points.push(...leg.points)
      else if (leg.kind === 'vertical' && leg.floorId === floorId) points.push(leg.pos)
      else if (leg.kind === 'riser' && (leg.fromFloorId === floorId || leg.toFloorId === floorId))
        points.push(leg.pos)
    }
    const ends = [route.from, route.to, ...(route.hops ?? []).flatMap((hop) => [hop.from, hop.to])]
    for (const end of ends) if (end?.floorId === floorId) points.push(end.pos)
  }
  if (points.length === 0) return null
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  // A short wire still gets some surroundings instead of an extreme zoom.
  const span = (min: number, max: number) => {
    const grow = Math.max(0, MIN_FOCUS_EXTENT - (max - min)) / 2
    return [min - grow, max + grow] as const
  }
  const [x0, x1] = span(Math.min(...xs), Math.max(...xs))
  const [y0, y1] = span(Math.min(...ys), Math.max(...ys))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** Smallest focus frame, in plan units (about 2 m at the editor scale). */
const MIN_FOCUS_EXTENT = 200

/** Metres with one decimal in the user's locale. */
export function formatCableMetres(value: number): string {
  return (Math.round(value * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })
}

/** Stored length first (≈ when accepted from the plan); otherwise the estimate range. */
export function cableRouteLengthText(route: CableRouteEstimate): string | undefined {
  if (route.enteredLengthM != null) {
    return `${route.enteredLengthEstimated ? '≈ ' : ''}${formatCableMetres(route.enteredLengthM)} m`
  }
  if (route.highM <= 0) return undefined
  return `≈ ${formatCableMetres(route.lowM)}–${formatCableMetres(route.highM)} m`
}

/** The floor a route mostly lives on: where it arrives, else where it leaves. */
export function cableRouteFloorId(route: CableRouteEstimate): string | undefined {
  return route.to?.floorId ?? route.from?.floorId
}

/** Point halfway along a polyline. */
export function polylineMidpoint(points: readonly Point2[]): Point2 {
  const lengths = points.slice(1).map((point, index) => {
    const previous = points[index]!
    return Math.hypot(point.x - previous.x, point.y - previous.y)
  })
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!
    if (remaining <= length && length > 0) {
      const a = points[index]!
      const b = points[index + 1]!
      const t = remaining / length
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    remaining -= length
  }
  return points[points.length - 1] ?? { x: 0, y: 0 }
}
