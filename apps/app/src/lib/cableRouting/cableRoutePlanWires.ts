import type { ProjectV2 } from '@/types/projectV2'
import type { PlanWireKind, PlanWireRoute, Point2 } from '@/types/schema'
import type { Selection } from '@/types/ui'
import {
  estimateCableRoutes,
  type CableRouteCategory,
  type CableRouteRole,
  type CableRouteEstimate,
  type CableRouteEstimation,
  type CableRoutePoint,
  type RouteLocation,
} from './estimateCableRoutes'

const estimationCache = new WeakMap<object, CableRouteEstimation>()

/** Cable route estimation, cached per project snapshot. */
export function estimateCableRoutesCached(project: ProjectV2): CableRouteEstimation {
  let estimation = estimationCache.get(project)
  if (!estimation) {
    estimation = estimateCableRoutes(project)
    estimationCache.set(project, estimation)
  }
  return estimation
}

const LIGHTING_TYPES = new Set(['light_point', 'switch'])

/** A trace's kind follows the point it reaches, so the existing wire visibility toggles apply. */
function kindFor(point: CableRoutePoint | undefined): PlanWireKind {
  if (point?.nodeType && LIGHTING_TYPES.has(point.nodeType)) return 'lighting-control'
  if (point?.nodeType === 'socket') return 'sockets'
  return 'other'
}

/** Stable, element-safe trace id for a cable anchor (and placement hop within one point). */
export function cablePlanWireRouteId(anchor: string, hop = 0): string {
  const safe = anchor.replace(/[^A-Za-z0-9-]+/g, '_')
  return hop === 0 ? `cable_${safe}` : `cable_${safe}_${hop}`
}

type Hop = { from?: RouteLocation; to?: RouteLocation }

/** The wires of one cable: the feeder's own wire, then the hops through further placements. */
function cableHops(route: CableRouteEstimate): Hop[] {
  return [{ from: route.from, to: route.to }, ...(route.hops ?? [])]
}

/** The riser of the hop crossing floors at this placement pair, as the estimate placed it. */
function riserPos(route: CableRouteEstimate, hop: Hop): Point2 | undefined {
  const leg = route.legs.find(
    (candidate) =>
      candidate.kind === 'riser' &&
      candidate.fromFloorId === hop.from?.floorId &&
      candidate.toFloorId === hop.to?.floorId
  )
  return leg?.kind === 'riser' ? leg.pos : undefined
}

/** A trace end on a placed symbol: an endpoint, or a junction box or panel on a feed. */
function endRef(location: RouteLocation): PlanWireRoute['from'] {
  return {
    endpointId: location.endpointId!,
    placementId: location.placementId,
    ...(location.trunkDeviceId ? { trunkDeviceId: location.trunkDeviceId } : {}),
  }
}

function traceForHop(
  route: CableRouteEstimate,
  hop: Hop,
  id: string,
  floorId: string
): PlanWireRoute | undefined {
  const { from, to } = hop
  if (!from?.placementId || !from.endpointId || !to?.placementId || !to.endpointId) return undefined
  if (to.floorId !== floorId) return undefined
  // Inside one board (e.g. to a relay in it): nothing to draw on the plan.
  if (from.placementId === to.placementId) return undefined
  // The riser sits where the estimate put it, so a moved shared passage shows on every cable.
  const pos = from.floorId !== floorId ? riserPos(route, hop) : undefined
  return {
    id,
    kind: kindFor(route.toPoint),
    source: 'auto',
    circuitId: route.circuitId,
    floorId,
    from: endRef(from),
    to: endRef(to),
    wireAnchor: route.anchor,
    ...(route.aliasAnchors ? { wireAnchorAliases: route.aliasAnchors } : {}),
    ...(from.floorId !== floorId
      ? { riser: { fromFloorId: from.floorId, ...(pos ? { pos } : {}) } }
      : {}),
  }
}

/**
 * The source-floor part of a wire leaving for another floor: from its symbol to the riser,
 * which sits at the same plan position as the ring on the arrival floor. The passage is
 * moved through the arrival trace; this trace only mirrors it.
 */
function riserExitForHop(
  route: CableRouteEstimate,
  hop: Hop,
  arrivalRouteId: string,
  floorId: string
): PlanWireRoute | undefined {
  const { from, to } = hop
  if (!from?.placementId || !from.endpointId || !to?.placementId || !to.endpointId) return undefined
  if (from.floorId !== floorId || to.floorId === floorId) return undefined
  const pos = riserPos(route, hop)
  return {
    id: `${arrivalRouteId}_exit`,
    kind: kindFor(route.toPoint),
    source: 'auto',
    circuitId: route.circuitId,
    floorId,
    from: endRef(from),
    // No target placement: the trace ends at the riser, not at a symbol.
    to: { endpointId: from.endpointId },
    wireAnchor: route.anchor,
    ...(route.aliasAnchors ? { wireAnchorAliases: route.aliasAnchors } : {}),
    riserExit: {
      toFloorId: to.floorId,
      arrivalRouteId,
      arrivalTo: endRef(to),
      ...(pos ? { pos } : {}),
    },
  }
}

/**
 * The situation plan's automatic wire traces, derived from cable routing: one trace per cable
 * link that arrives on `floorId` (home runs, board feeders, chains), plus the wires through the
 * further placements of a point placed more than once. Editing a trace with the wire tool
 * stores a manual copy, which the cable estimate then follows.
 */
export function deriveCablePlanWireRoutes(
  project: ProjectV2,
  floorId: string,
  includeKinds: ReadonlySet<PlanWireKind>
): PlanWireRoute[] {
  const traces: PlanWireRoute[] = []
  for (const route of estimateCableRoutesCached(project).routes) {
    // Supply and earthing cables have their own toggle (see `isCableTraceShown`).
    const ownToggle = route.role === 'supply' || route.role === 'earthing'
    if (!ownToggle && !includeKinds.has(kindFor(route.toPoint))) continue
    cableHops(route).forEach((hop, index) => {
      const id = cablePlanWireRouteId(route.anchor, index)
      const exit = riserExitForHop(route, hop, id, floorId)
      if (exit) traces.push(exit)
      const trace = traceForHop(route, hop, id, floorId)
      if (trace) traces.push(trace)
    })
  }
  return traces
}

/**
 * Whether a plan wire trace draws the cable the app-wide selection refers to: the selected
 * wire, a trace of a selected circuit, or the trace reaching a selected point.
 */
export function planWireRouteMatchesSelection(route: PlanWireRoute, selection: Selection): boolean {
  if (!route.wireAnchor) return false
  const routeAnchors = [route.wireAnchor, ...(route.wireAnchorAliases ?? [])]
  if (selection.wireAnchor && routeAnchors.includes(selection.wireAnchor)) return true
  if (
    selection.wireMetadata?.some((meta) =>
      (meta.wireAnchors ?? (meta.wireAnchor ? [meta.wireAnchor] : [])).some((anchor) =>
        routeAnchors.includes(anchor)
      )
    )
  ) {
    return true
  }
  if (selection.type === 'circuit') return selection.ids.includes(route.circuitId)
  if (selection.type === 'endpoint') {
    return selection.ids.includes(route.riserExit?.arrivalTo.endpointId ?? route.to.endpointId)
  }
  return false
}

/** Wire colours per circuit group in wire mode (selection stays yellow). */
export const CABLE_CATEGORY_COLORS: Record<CableRouteCategory, string> = {
  lighting: '#f97316',
  sockets: '#2563eb',
  // Yellow ochre, so green stays free for earthing (as on the Structural canvas).
  devices: '#c29a2e',
  feeders: '#db2777',
  supply: '#7c3aed',
  // DC and earthing match the Structural canvas.
  dc: '#c54843',
  earthing: '#3d9568',
  other: '#64748b',
}

export interface CableTraceInfo {
  role: CableRouteRole
  category: CableRouteCategory
}

/** Role and colour group of every cable, by wire anchor. */
export function cableTraceInfoByAnchor(project: ProjectV2): Map<string, CableTraceInfo> {
  return new Map(
    estimateCableRoutesCached(project).routes.map((route) => [
      route.anchor,
      { role: route.role, category: route.category },
    ])
  )
}

/** Wire colour of a trace: its cable's group, else its circuit's (a drawn wire off the chain). */
export function cableTraceColor(
  route: PlanWireRoute,
  info: ReadonlyMap<string, CableTraceInfo>,
  categoryByCircuit: ReadonlyMap<string, CableRouteCategory>
): string | undefined {
  const category =
    (route.wireAnchor ? info.get(route.wireAnchor)?.category : undefined) ??
    categoryByCircuit.get(route.circuitId)
  return category ? CABLE_CATEGORY_COLORS[category] : undefined
}

/** Colour group per circuit, from its cables. */
export function cableCategoryByCircuit(project: ProjectV2): Map<string, CableRouteCategory> {
  return new Map(
    estimateCableRoutesCached(project).routes.map((route) => [route.circuitId, route.category])
  )
}

/** Supply and earthing cables follow their own toggle, not the wire-kind toggles. */
export function hasOwnCableToggle(
  route: Pick<PlanWireRoute, 'wireAnchor'>,
  info: ReadonlyMap<string, CableTraceInfo>
): boolean {
  const role = route.wireAnchor ? info.get(route.wireAnchor)?.role : undefined
  return role === 'supply' || role === 'earthing'
}

/**
 * Whether a trace shows outside wire mode. Home runs and links between lighting branches are
 * off by default, like a classic situation plan that draws switch-to-light wiring only. Supply
 * and earthing cables show the installation's web of connections until hidden.
 */
export function isCableTraceShown(
  route: PlanWireRoute,
  info: ReadonlyMap<string, CableTraceInfo>,
  visibility: { homeRunsVisible?: boolean; branchFeedsVisible?: boolean; supplyVisible?: boolean }
): boolean {
  const role = route.wireAnchor ? info.get(route.wireAnchor)?.role : undefined
  if (role === 'home-run') return visibility.homeRunsVisible === true
  if (role === 'branch-feed') return visibility.branchFeedsVisible === true
  if (role === 'supply' || role === 'earthing') return visibility.supplyVisible !== false
  return true
}
