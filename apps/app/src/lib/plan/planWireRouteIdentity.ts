import type { PlanWireEndpointRef, PlanWireRoute, Point2 } from '@/types/schema'

function samePoint(a: Point2, b: Point2): boolean {
  return a === b || (a.x === b.x && a.y === b.y)
}

function sameEndpointRef(a: PlanWireEndpointRef, b: PlanWireEndpointRef): boolean {
  return (
    a === b ||
    (a.endpointId === b.endpointId &&
      a.trunkDeviceId === b.trunkDeviceId &&
      a.placementId === b.placementId)
  )
}

function sameWaypoints(a: Point2[] | undefined, b: Point2[] | undefined): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((point, index) => samePoint(point, b[index]!))
}

function sameOptionalPoint(a: Point2 | undefined, b: Point2 | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined && samePoint(a, b))
}

/** Floor passages: a moved riser must reach the plan, on the arrival and the departure floor. */
function samePassage(a: PlanWireRoute, b: PlanWireRoute): boolean {
  const riser =
    a.riser === b.riser ||
    (a.riser !== undefined &&
      b.riser !== undefined &&
      a.riser.fromFloorId === b.riser.fromFloorId &&
      sameOptionalPoint(a.riser.pos, b.riser.pos))
  const exit =
    a.riserExit === b.riserExit ||
    (a.riserExit !== undefined &&
      b.riserExit !== undefined &&
      a.riserExit.toFloorId === b.riserExit.toFloorId &&
      a.riserExit.arrivalRouteId === b.riserExit.arrivalRouteId &&
      sameEndpointRef(a.riserExit.arrivalTo, b.riserExit.arrivalTo) &&
      sameOptionalPoint(a.riserExit.pos, b.riserExit.pos))
  return riser && exit
}

function sameRoute(a: PlanWireRoute, b: PlanWireRoute): boolean {
  return (
    a === b ||
    (a.id === b.id &&
      a.kind === b.kind &&
      a.source === b.source &&
      a.circuitId === b.circuitId &&
      a.panelId === b.panelId &&
      a.branchId === b.branchId &&
      a.floorId === b.floorId &&
      sameEndpointRef(a.from, b.from) &&
      sameEndpointRef(a.to, b.to) &&
      sameWaypoints(a.waypoints, b.waypoints) &&
      a.style === b.style &&
      a.hidden === b.hidden &&
      a.locked === b.locked &&
      a.notes === b.notes &&
      a.wireAnchor === b.wireAnchor &&
      samePassage(a, b))
  )
}

/** Preserve route identities when a broad project revision derives the same plan-wire geometry. */
export function reusePlanWireRoutes(
  previous: PlanWireRoute[],
  next: PlanWireRoute[]
): PlanWireRoute[] {
  if (previous.length === 0) return next
  const previousById = new Map(previous.map((route) => [route.id, route]))
  const reused = next.map((route) => {
    const prior = previousById.get(route.id)
    return prior && sameRoute(prior, route) ? prior : route
  })
  return reused.length === previous.length && reused.every((route, index) => route === previous[index])
    ? previous
    : reused
}
