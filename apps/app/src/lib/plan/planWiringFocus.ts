import { getElectricalLookupIndex } from '@/lib/projectV2/electricalLookupIndex'
import type { Panel, PlanWireRoute } from '@/types/schema'

/**
 * Wire mode starts with every wire drawn in full. Once a branch is focused, it and its feed
 * back to the board stay in full, other wires fade, and a hovered branch is previewed brighter.
 */
export const PLAN_WIRE_FOCUS_OPACITY = 1
export const PLAN_WIRE_FOCUS_PREVIEW_OPACITY = 0.35
export const PLAN_WIRE_FOCUS_DIMMED_OPACITY = 0.15

/** Opacity of a wire in wire mode (`focusMode`), or undefined outside it. */
export function planWireFocusOpacity(
  route: Pick<PlanWireRoute, 'id'>,
  focusMode: boolean,
  focusRouteIds: ReadonlySet<string> | null | undefined,
  previewRouteIds: ReadonlySet<string> | null | undefined
): number | undefined {
  if (!focusMode) return undefined
  if (focusRouteIds == null) return PLAN_WIRE_FOCUS_OPACITY
  if (focusRouteIds?.has(route.id)) return PLAN_WIRE_FOCUS_OPACITY
  if (previewRouteIds?.has(route.id)) return PLAN_WIRE_FOCUS_PREVIEW_OPACITY
  return PLAN_WIRE_FOCUS_DIMMED_OPACITY
}

/** Cable role of a wire (e.g. `home-run`, `branch-feed`, `wire`), when cable routing knows it. */
export type PlanWireRoleOf = (route: PlanWireRoute) => string | undefined

/**
 * The part of a circuit a wire-mode edit is about: one branch (a switch and its lights, or a
 * chain of free points) and the feed from its start back to the board. Sibling branches fed from
 * the same board or box are left out.
 */
export interface PlanWireFocusScope {
  circuitId: string
  /** The branch's symbols; null when the whole circuit is in focus. */
  placementIds: Set<string> | null
  /** Wires drawn in full: the branch's own and its feed path. */
  routeIds: Set<string>
}

/** A home run or branch feed into another point starts a new branch. */
function startsBranch(route: PlanWireRoute, roleOf: PlanWireRoleOf): boolean {
  const role = roleOf(route)
  return (
    (role === 'home-run' || role === 'branch-feed') && route.from.endpointId !== route.to.endpointId
  )
}

export function planWireFocusScope(
  routes: readonly PlanWireRoute[],
  circuitId: string,
  placementId: string | null | undefined,
  roleOf: PlanWireRoleOf
): PlanWireFocusScope {
  const own = routes.filter((route) => route.circuitId === circuitId)
  const wholeCircuit = {
    circuitId,
    placementIds: null,
    routeIds: new Set(own.map((route) => route.id)),
  }
  if (!placementId) return wholeCircuit
  const incoming = new Map<string, PlanWireRoute>()
  const outgoing = new Map<string, PlanWireRoute[]>()
  for (const route of own) {
    const from = route.from.placementId
    const to = route.to.placementId
    if (!from || !to || route.riserExit) continue
    if (!incoming.has(to)) incoming.set(to, route)
    outgoing.set(from, [...(outgoing.get(from) ?? []), route])
  }
  if (!incoming.has(placementId) && !outgoing.has(placementId)) return wholeCircuit

  // Up through plain wires to where the branch starts.
  let root = placementId
  const climbed = new Set([root])
  for (;;) {
    const feed = incoming.get(root)
    const from = feed?.from.placementId
    if (!feed || !from || startsBranch(feed, roleOf) || climbed.has(from)) break
    climbed.add(from)
    root = from
  }

  // The branch: everything below its start, up to where another branch is fed.
  const placementIds = new Set([root])
  const routeIds = new Set<string>()
  const queue = [root]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const route of outgoing.get(current) ?? []) {
      const to = route.to.placementId!
      if (startsBranch(route, roleOf) || placementIds.has(to)) continue
      routeIds.add(route.id)
      placementIds.add(to)
      queue.push(to)
    }
  }

  // Its feed, back to the board.
  let current = root
  const fed = new Set([root])
  for (;;) {
    const feed = incoming.get(current)
    const from = feed?.from.placementId
    if (!feed) break
    routeIds.add(feed.id)
    if (!from || fed.has(from)) break
    fed.add(from)
    current = from
  }
  // Wires arriving from another floor have no source symbol here; keep them with their target.
  for (const route of own) {
    if (route.riser && route.to.placementId && placementIds.has(route.to.placementId)) {
      routeIds.add(route.id)
    }
  }
  return { circuitId, placementIds, routeIds }
}

/** The circuit a plan symbol belongs to; a board's own symbol (the PANEL circuit) has none. */
export function circuitIdForPlanEndpoint(
  panels: Panel[],
  endpointId: string | null | undefined
): string | null {
  if (!endpointId) return null
  const match = getElectricalLookupIndex(panels).endpointsById.get(endpointId)
  if (!match || match.circuit.code === 'PANEL') return null
  return match.circuit.id
}

/**
 * Automatic wires of one circuit, held still while the user edits it so the rest of the circuit
 * does not re-solve under the cursor. `manualRouteIds` are the circuit's drawn wires when it
 * froze; once one of them is gone (undo, removal) the snapshot no longer applies.
 */
export interface FrozenPlanWireCircuit {
  circuitId: string
  floorId: string
  autoRoutes: PlanWireRoute[]
  manualRouteIds: string[]
}

export function freezePlanWireCircuit(
  routes: PlanWireRoute[],
  circuitId: string,
  floorId: string
): FrozenPlanWireCircuit {
  const own = routes.filter((route) => route.circuitId === circuitId && route.floorId === floorId)
  return {
    circuitId,
    floorId,
    autoRoutes: own.filter((route) => route.source !== 'manual'),
    manualRouteIds: own.filter((route) => route.source === 'manual').map((route) => route.id),
  }
}

/** A branch being redrawn: its symbols when the redraw started. */
export interface PlanWireRedraw {
  circuitId: string
  placementIds: ReadonlySet<string>
}

/**
 * Applies the wire-mode editing state to the merged routes of a floor:
 * - while a branch is being redrawn, the automatic wires into its symbols are hidden (drawn ones
 *   stay);
 * - while a circuit is frozen, its automatic wires stay as they were, except where a drawn wire
 *   now reaches the same symbol.
 */
export function applyPlanWireEditingState(
  routes: PlanWireRoute[],
  options: {
    floorId: string | null | undefined
    redraw?: PlanWireRedraw | null
    frozen?: FrozenPlanWireCircuit | null
  }
): PlanWireRoute[] {
  const { floorId, redraw } = options
  let result = routes
  if (redraw) {
    result = result.filter(
      (route) =>
        route.circuitId !== redraw.circuitId ||
        route.source === 'manual' ||
        !route.to.placementId ||
        !redraw.placementIds.has(route.to.placementId)
    )
  }
  const frozen = options.frozen
  if (!frozen || frozen.floorId !== floorId || frozen.circuitId === redraw?.circuitId) return result
  const manual = result.filter(
    (route) => route.circuitId === frozen.circuitId && route.source === 'manual'
  )
  const manualIds = new Set(manual.map((route) => route.id))
  if (frozen.manualRouteIds.some((id) => !manualIds.has(id))) return result
  const drawnTargets = new Set(
    manual.flatMap((route) => (route.to.placementId ? [route.to.placementId] : []))
  )
  const keptAuto = frozen.autoRoutes.filter(
    (route) => !route.to.placementId || !drawnTargets.has(route.to.placementId)
  )
  return [
    ...result.filter((route) => route.circuitId !== frozen.circuitId || route.source === 'manual'),
    ...keptAuto,
  ]
}

/**
 * Progress of a redraw: which of the branch's symbols on this floor a drawn wire reaches.
 */
export function planWireRedrawProgress(
  routes: PlanWireRoute[],
  circuitId: string,
  placementIds: Iterable<string>
): { connected: number; total: number; openPlacementIds: Set<string> } {
  const reached = new Set<string>()
  for (const route of routes) {
    if (route.circuitId !== circuitId || route.source !== 'manual') continue
    if (route.from.placementId) reached.add(route.from.placementId)
    if (route.to.placementId) reached.add(route.to.placementId)
  }
  const all = [...placementIds]
  const openPlacementIds = new Set(all.filter((id) => !reached.has(id)))
  return {
    connected: all.length - openPlacementIds.size,
    total: all.length,
    openPlacementIds,
  }
}
