import { clamp } from '@/lib/geometry'
import type { PlanWireRoute } from '@/types/schema'
import { planWireSpanSetKey } from './planWiring'

/**
 * A derived trace's riser position mirrors the shared floor passage; a manual copy only pins it
 * once the riser itself is moved, so a later move of the source symbol still carries it along.
 */
function withoutDerivedRiserPos(route: PlanWireRoute): PlanWireRoute {
  if (route.source === 'manual' || !route.riser?.pos) return route
  return { ...route, riser: { fromFloorId: route.riser.fromFloorId } }
}

function routeWithManualWaypoints(
  route: PlanWireRoute,
  existing: PlanWireRoute | undefined,
  waypoints: NonNullable<PlanWireRoute['waypoints']>,
): PlanWireRoute {
  return {
    ...withoutDerivedRiserPos(route),
    ...existing,
    source: 'manual',
    waypoints,
  }
}

export function upsertPlanWireRouteWaypoint(
  routes: PlanWireRoute[],
  route: PlanWireRoute,
  point: { x: number; y: number },
  waypointIndex: number,
): PlanWireRoute[] {
  const routeIndex = routes.findIndex((candidate) => candidate.id === route.id)
  const existing = routeIndex >= 0 ? routes[routeIndex] : undefined
  const waypoints = [...(existing?.waypoints ?? route.waypoints ?? [])]
  const insertAt = clamp(waypointIndex, 0, waypoints.length)
  waypoints.splice(insertAt, 0, point)
  const nextRoute = routeWithManualWaypoints(route, existing, waypoints)
  if (routeIndex < 0) return [...routes, nextRoute]
  return routes.map((candidate, index) => (index === routeIndex ? nextRoute : candidate))
}

export function movePlanWireRouteWaypoint(
  routes: PlanWireRoute[],
  route: PlanWireRoute,
  waypointIndex: number,
  point: { x: number; y: number },
): PlanWireRoute[] | null {
  const routeIndex = routes.findIndex((candidate) => candidate.id === route.id)
  const existing = routeIndex >= 0 ? routes[routeIndex] : undefined
  const waypoints = [...((existing ?? route).waypoints ?? [])]
  if (waypointIndex < 0 || waypointIndex >= waypoints.length) return null
  waypoints[waypointIndex] = point
  const nextRoute = routeWithManualWaypoints(route, existing, waypoints)
  if (routeIndex < 0) return [...routes, nextRoute]
  return routes.map((candidate, index) => (index === routeIndex ? nextRoute : candidate))
}

export function replacePlanWireSpanRoutes(
  routes: PlanWireRoute[],
  replacementRoutes: PlanWireRoute[],
): PlanWireRoute[] {
  const first = replacementRoutes[0]
  if (!first) return routes
  const groupKey = planWireSpanSetKey(first)
  return [
    ...routes.filter((route) => planWireSpanSetKey(route) !== groupKey),
    ...replacementRoutes,
  ]
}

/** The route of the passage's arrival side: the trace itself, or the one a departure mirrors. */
function arrivalRouteFor(route: PlanWireRoute): PlanWireRoute | undefined {
  if (route.riser) return route
  const exit = route.riserExit
  if (!exit) return undefined
  return {
    id: exit.arrivalRouteId,
    kind: route.kind,
    source: 'auto',
    circuitId: route.circuitId,
    floorId: exit.toFloorId,
    from: route.from,
    to: exit.arrivalTo,
    ...(route.wireAnchor ? { wireAnchor: route.wireAnchor } : {}),
    riser: { fromFloorId: route.floorId },
  }
}

/**
 * Moves a floor passage, from either floor. The passage is one physical spot shared by every
 * cable leaving the same symbol for the same floor: the dragged cable becomes a manual copy
 * with the moved riser, and every other manual trace through that passage moves with it. The
 * cable estimate applies the position to the remaining derived traces.
 */
export function movePlanWireRouteRiser(
  routes: PlanWireRoute[],
  route: PlanWireRoute,
  point: { x: number; y: number },
): PlanWireRoute[] | null {
  const arrival = arrivalRouteFor(route)
  if (!arrival?.riser) return null
  const pos = { x: point.x, y: point.y }
  const fromFloorId = arrival.riser.fromFloorId
  const sharesPassage = (candidate: PlanWireRoute) =>
    candidate.source === 'manual' &&
    candidate.floorId === arrival.floorId &&
    candidate.riser?.fromFloorId === fromFloorId &&
    candidate.from.placementId !== undefined &&
    candidate.from.placementId === arrival.from.placementId
  const moved = routes.map((candidate) =>
    candidate.id !== arrival.id && sharesPassage(candidate)
      ? { ...candidate, riser: { fromFloorId, pos } }
      : candidate,
  )
  const routeIndex = moved.findIndex((candidate) => candidate.id === arrival.id)
  const existing = routeIndex >= 0 ? moved[routeIndex] : undefined
  const nextRoute: PlanWireRoute = {
    ...arrival,
    ...existing,
    source: 'manual',
    waypoints: [...((existing ?? arrival).waypoints ?? [])],
    riser: { fromFloorId, pos },
  }
  delete nextRoute.riserExit
  if (routeIndex < 0) return [...moved, nextRoute]
  return moved.map((candidate, index) => (index === routeIndex ? nextRoute : candidate))
}

/**
 * One floor passage, the same on both floors: everything leaving a symbol for another floor
 * rises at one spot. Arrival and departure traces of that passage share this key.
 */
export function planWireRiserPassageKey(route: PlanWireRoute): string | undefined {
  const source = route.from.placementId
  if (!source) return undefined
  if (route.riser) return `${source}|${route.riser.fromFloorId}|${route.floorId}`
  if (route.riserExit) return `${source}|${route.floorId}|${route.riserExit.toFloorId}`
  return undefined
}

/** Where a trace's floor passage sits on the plan, when it has one. */
export function planWireRiserPoint(route: PlanWireRoute): { x: number; y: number } | undefined {
  return route.riser?.pos ?? route.riserExit?.pos
}

/** Traces whose floor passage lies inside the rectangle (plan coordinates). */
export function planWireRiserRouteIdsInRect(
  routes: readonly PlanWireRoute[],
  rect: { x: number; y: number; width: number; height: number }
): string[] {
  return routes
    .filter((route) => {
      const point = planWireRiserPoint(route)
      return (
        point != null &&
        point.x >= rect.x &&
        point.x <= rect.x + rect.width &&
        point.y >= rect.y &&
        point.y <= rect.y + rect.height
      )
    })
    .map((route) => route.id)
}

/** Moves several floor passages at once; each passage moves once, however many cables use it. */
export function movePlanWireRouteRisers(
  routes: PlanWireRoute[],
  moves: ReadonlyArray<{ route: PlanWireRoute; point: { x: number; y: number } }>
): PlanWireRoute[] | null {
  const seen = new Set<string>()
  let next: PlanWireRoute[] | null = null
  for (const { route, point } of moves) {
    const key = planWireRiserPassageKey(route) ?? route.id
    if (seen.has(key)) continue
    seen.add(key)
    next = movePlanWireRouteRiser(next ?? routes, route, point) ?? next
  }
  return next
}
