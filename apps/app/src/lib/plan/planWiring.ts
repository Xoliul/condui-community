import { getThemeColor } from '@/lib/theme/colors'
import type { ThemeMode } from '@/lib/theme/types'
import {
  selectProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import {
  selectProjectBuildingFloors,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import {
  clearPlanWiringForProject,
  selectProjectPlanWireRoutes,
  selectProjectPlanWiringProjection,
  replacePlanWireRoutesForProject,
  replacePlanWiringVisibilityForProject,
  type ProjectWithOptionalV2PlanWiring,
} from '@/lib/projectV2/planWiring'
import type {
  Circuit,
  Endpoint,
  Panel,
  Placement,
  PlanWireKind,
  PlanWireRoute,
  PlanWireRouteStyle,
  PlanWiringModel,
  PlanWiringVisibility,
} from '@/types/schema'
import { getAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { findMainPanel } from '@/lib/panel/panelTree'
import { isCableRoutesEnabled } from '@/lib/cableRouting/availability'
import { deriveCablePlanWireRoutes } from '@/lib/cableRouting/cableRoutePlanWires'
import { isProjectV2 } from '@/lib/projectV2/migration'
import { planWireVisualMetrics } from './planWireVisualMetrics'

type PlanWiringProject = ProjectWithOptionalV2Electrical &
  ProjectWithOptionalV2Building &
  ProjectWithOptionalV2PlanWiring

/** Base wire width at the default plan calibration. */
export const PLAN_WIRE_STROKE_WIDTH = 1

/**
 * Wire width follows physical calibration, keeping a two-pixel screen minimum in the editor.
 * Omitting zoom uses physical plan units for export.
 */
export function planWireStrokeWidth(zoom: number | undefined, pxPerMeter?: number | null): number {
  return planWireVisualMetrics(zoom, pxPerMeter).strokeWidth
}
export const PLAN_WIRE_DASH: [number, number] = [4, 4]
/** Invisible hit target width in plan space. */
export const PLAN_WIRE_HIT_STROKE_WIDTH = 10
export const PLAN_WIRE_STATIC_OPACITY = 0.55
export const PLAN_WIRE_STATIC_HOVER_OPACITY = 0.75
export const PLAN_WIRE_ACTIVE_OPACITY = 0.85
/** Selection colour for a wire selected elsewhere (cable list, one-wire, structure view). */
export const PLAN_WIRE_SELECTED_STROKE = '#eab308'

export function planWireStaticStroke(theme: ThemeMode): string {
  return getThemeColor(theme, theme === 'dark' ? 'gray500' : 'gray400')
}

export function planWireActiveStroke(theme: ThemeMode): string {
  return getThemeColor(theme, 'hoverColor')
}

type EndpointPlacement = {
  endpoint: Endpoint
  placement: Placement
}

const LIGHT_SYMBOLS = new Set<string>([
  'light_point',
  'light_spot',
  'light_led',
  'light_fluorescent',
])

const SWITCH_SYMBOLS = new Set<string>([
  'switch',
  'switch_1p_twoway',
  'switch_2p_twoway',
  'switch_dimmer',
  'switch_1p_changeover',
  'switch_1p_pull',
  'switch_impulse',
  'switch_cross',
  'motion_detector',
  'smoke_detector',
  'relay',
  'switch_single',
  'switch_double',
])

const SOCKET_SYMBOLS = new Set<string>(['socket', 'socket_gnd', 'socket_child', 'socket_gnd_child'])

function endpointSymbol(endpoint: Endpoint): string | undefined {
  return endpoint.symbol
}

function endpointIsLightOrSwitch(endpoint: Endpoint): boolean {
  const symbol = endpointSymbol(endpoint)
  return Boolean(symbol && (LIGHT_SYMBOLS.has(symbol) || SWITCH_SYMBOLS.has(symbol)))
}

function endpointIsSocket(endpoint: Endpoint): boolean {
  const symbol = endpointSymbol(endpoint)
  return Boolean(symbol && SOCKET_SYMBOLS.has(symbol))
}

function endpointIsSwitch(endpoint: Endpoint): boolean {
  const symbol = endpointSymbol(endpoint)
  return Boolean(symbol && SWITCH_SYMBOLS.has(symbol))
}

function endpointIsLight(endpoint: Endpoint): boolean {
  const symbol = endpointSymbol(endpoint)
  return Boolean(symbol && LIGHT_SYMBOLS.has(symbol))
}

export function endpointCanStartPlanWire(endpoint: Endpoint | null | undefined): boolean {
  return Boolean(endpoint)
}

export function getPlanWireKind(from: Endpoint, to: Endpoint): PlanWireKind {
  const fromSymbol = endpointSymbol(from)
  const toSymbol = endpointSymbol(to)
  const fromIsSwitch = Boolean(fromSymbol && SWITCH_SYMBOLS.has(fromSymbol))
  const toIsSwitch = Boolean(toSymbol && SWITCH_SYMBOLS.has(toSymbol))
  const fromIsLight = Boolean(fromSymbol && LIGHT_SYMBOLS.has(fromSymbol))
  const toIsLight = Boolean(toSymbol && LIGHT_SYMBOLS.has(toSymbol))
  if (
    (fromIsSwitch && toIsSwitch) ||
    (fromIsSwitch && toIsLight) ||
    (fromIsLight && toIsSwitch) ||
    (fromIsLight && toIsLight)
  ) {
    return 'lighting-control'
  }
  if (fromSymbol && toSymbol && SOCKET_SYMBOLS.has(fromSymbol) && SOCKET_SYMBOLS.has(toSymbol)) {
    return 'sockets'
  }
  return 'other'
}

function placementsOnFloor(endpoint: Endpoint, floorId: string): Placement[] {
  return endpoint.placements.filter((placement) => placement.floorId === floorId)
}

function placementsInEndpointOrder(endpoint: Endpoint): EndpointPlacement[] {
  return endpoint.placements.map((placement) => ({ endpoint, placement }))
}

function placementsShareFloor(floorId: string, from: EndpointPlacement, to: EndpointPlacement) {
  return from.placement.floorId === floorId && to.placement.floorId === floorId
}

function routeIdFor(
  circuitId: string,
  branchId: string | undefined,
  from: EndpointPlacement,
  to: EndpointPlacement
) {
  return [
    'planwire',
    circuitId,
    branchId ?? 'sequence',
    from.endpoint.id,
    from.placement.id,
    to.endpoint.id,
    to.placement.id,
  ].join('_')
}

function routeFromPair(
  panel: Panel,
  circuit: Circuit,
  branchId: string | undefined,
  floorId: string,
  from: EndpointPlacement,
  to: EndpointPlacement,
  source: PlanWireRoute['source'] = 'auto'
): PlanWireRoute {
  return {
    id: routeIdFor(circuit.id, branchId, from, to),
    kind: getPlanWireKind(from.endpoint, to.endpoint),
    source,
    circuitId: circuit.id,
    panelId: panel.id,
    branchId,
    floorId,
    from: { endpointId: from.endpoint.id, placementId: from.placement.id },
    to: { endpointId: to.endpoint.id, placementId: to.placement.id },
  }
}

function buildRoutesForCircuit(
  panel: Panel,
  circuit: Circuit,
  floorId: string,
  includeKinds: Set<PlanWireKind>
): PlanWireRoute[] {
  const endpointById = new Map(circuit.endpoints.map((endpoint) => [endpoint.id, endpoint]))
  if (includeKinds.has('sockets')) {
    const placedSockets = circuit.endpoints
      .filter(endpointIsSocket)
      .flatMap(placementsInEndpointOrder)
      .filter((item) => item.placement.floorId === floorId)

    const routes: PlanWireRoute[] = []
    for (let index = 0; index < placedSockets.length - 1; index += 1) {
      const from = placedSockets[index]
      const to = placedSockets[index + 1]
      if (!from || !to) continue
      routes.push(routeFromPair(panel, circuit, undefined, floorId, from, to))
    }
    if (includeKinds.size === 1) return routes

    const nonSocketKinds = new Set(includeKinds)
    nonSocketKinds.delete('sockets')
    return [...routes, ...buildRoutesForCircuit(panel, circuit, floorId, nonSocketKinds)]
  }

  const sequences =
    circuit.branches && circuit.branches.length > 0
      ? circuit.branches.map((branch) => ({ branchId: branch.id, endpointIds: branch.endpointIds }))
      : [{ branchId: undefined, endpointIds: circuit.endpoints.map((endpoint) => endpoint.id) }]

  const routes: PlanWireRoute[] = []
  for (const sequence of sequences) {
    const placed: EndpointPlacement[] = []
    for (const endpointId of sequence.endpointIds) {
      const endpoint = endpointById.get(endpointId)
      if (!endpoint) continue
      placed.push(...placementsInEndpointOrder(endpoint))
    }

    for (let index = 0; index < placed.length - 1; index += 1) {
      const from = placed[index]
      const to = placed[index + 1]
      if (!from || !to) continue
      if (!placementsShareFloor(floorId, from, to)) continue
      const kind = getPlanWireKind(from.endpoint, to.endpoint)
      // Lighting and socket spans are the only default plan wiring. Every other
      // electrical connection is an explicit user-drawn trace.
      if (kind === 'sockets' || kind === 'other') continue
      if (!includeKinds.has(kind)) continue
      routes.push(routeFromPair(panel, circuit, sequence.branchId, floorId, from, to))
    }
  }

  return routes
}

function findCircuitSequenceForPlacements(
  panels: Panel[],
  floorId: string,
  sourcePlacementId: string,
  targetPlacementId: string
): {
  panel: Panel
  circuit: Circuit
  branchId: string | undefined
  sequence: EndpointPlacement[]
} | null {
  for (const panel of panels) {
    const circuits = [
      ...panel.circuits,
      ...panel.protections.flatMap((protection) => protection.circuits ?? []),
    ]
    for (const circuit of circuits) {
      const endpointById = new Map(circuit.endpoints.map((endpoint) => [endpoint.id, endpoint]))
      const sequences =
        circuit.branches && circuit.branches.length > 0
          ? circuit.branches.map((branch) => ({
              branchId: branch.id,
              endpointIds: branch.endpointIds,
            }))
          : [{ branchId: undefined, endpointIds: circuit.endpoints.map((endpoint) => endpoint.id) }]
      for (const branch of sequences) {
        const sequence: EndpointPlacement[] = []
        for (const endpointId of branch.endpointIds) {
          const endpoint = endpointById.get(endpointId)
          if (!endpoint) continue
          sequence.push(...placementsInEndpointOrder(endpoint))
        }
        const source = sequence.find((item) => item.placement.id === sourcePlacementId)
        const target = sequence.find((item) => item.placement.id === targetPlacementId)
        if (source?.placement.floorId === floorId && target?.placement.floorId === floorId) {
          return { panel, circuit, branchId: branch.branchId, sequence }
        }
      }
    }
    const nested = findCircuitSequenceForPlacements(
      panel.subPanels ?? [],
      floorId,
      sourcePlacementId,
      targetPlacementId
    )
    if (nested) return nested
  }
  return null
}

function findCircuitForPlacements(
  panels: Panel[],
  floorId: string,
  sourcePlacementId: string,
  targetPlacementId: string
): {
  panel: Panel
  circuit: Circuit
  source: EndpointPlacement
  target: EndpointPlacement
  sequence: EndpointPlacement[]
} | null {
  for (const panel of panels) {
    const circuits = [
      ...panel.circuits,
      ...panel.protections.flatMap((protection) => protection.circuits ?? []),
    ]
    for (const circuit of circuits) {
      const sequence = circuit.endpoints.flatMap((endpoint) =>
        placementsOnFloor(endpoint, floorId).map((placement) => ({ endpoint, placement }))
      )
      const source = sequence.find((item) => item.placement.id === sourcePlacementId)
      const target = sequence.find((item) => item.placement.id === targetPlacementId)
      if (source && target) return { panel, circuit, source, target, sequence }
    }
    const nested = findCircuitForPlacements(
      panel.subPanels ?? [],
      floorId,
      sourcePlacementId,
      targetPlacementId
    )
    if (nested) return nested
  }
  return null
}

type PlacementCircuitMatch = {
  panel: Panel
  circuit: Circuit
  branchId: string | undefined
  endpoint: EndpointPlacement
  trunkDeviceId?: string
  isSupplyDevice?: boolean
}

function findCircuitMatchForPlacement(
  project: PlanWiringProject,
  panels: Panel[],
  floorId: string,
  placementId: string
): PlacementCircuitMatch | null {
  for (const panel of panels) {
    const circuits = [
      ...panel.circuits,
      ...panel.protections.flatMap((protection) => protection.circuits ?? []),
    ]
    for (const circuit of circuits) {
      for (const endpoint of circuit.endpoints) {
        const placement = placementsOnFloor(endpoint, floorId).find(
          (candidate) => candidate.id === placementId
        )
        if (!placement) continue
        const branch = circuit.branches?.find((candidate) =>
          candidate.endpointIds.includes(endpoint.id)
        )
        return { panel, circuit, branchId: branch?.id, endpoint: { endpoint, placement } }
      }
    }
    const nested = findCircuitMatchForPlacement(
      project,
      panel.subPanels ?? [],
      floorId,
      placementId
    )
    if (nested) return nested
  }
  const mainPanel = findMainPanel(panels)
  if (!mainPanel) return null
  for (const device of getAllSupplyTrunkDevices(project)) {
    const placement = device.placements?.find(
      (candidate) => candidate.floorId === floorId && candidate.id === placementId
    )
    if (!placement) continue
    return {
      panel: mainPanel,
      circuit: {
        id: `supply:${mainPanel.id}`,
        code: 'SUPPLY',
        kind: 'other',
        cable: { kind: 'XVB', conductors: 2, sectionMm2: 1 },
        endpoints: [],
      },
      branchId: undefined,
      endpoint: {
        endpoint: {
          id: device.id,
          type: 'fixed_appliance',
          label: device.label,
          symbol: device.symbol,
          placements: device.placements ?? [],
        },
        placement,
      },
      trunkDeviceId: device.id,
      isSupplyDevice: true,
    }
  }
  return null
}

function panelHasElectricalPathTo(
  panels: Panel[],
  sourcePanelId: string,
  targetPanelId: string
): boolean {
  const findPanel = (candidates: Panel[]): Panel | undefined => {
    for (const panel of candidates) {
      if (panel.id === sourcePanelId) return panel
      const nested = findPanel(panel.subPanels ?? [])
      if (nested) return nested
    }
    return undefined
  }
  const source = findPanel(panels)
  if (!source) return false
  if (source.id === targetPanelId) return true

  const visit = (panel: Panel): boolean => {
    for (const child of panel.subPanels ?? []) {
      const isFedByThisPanel = panel.protections.some(
        (protection) => protection.subPanelId === child.id
      )
      if (!isFedByThisPanel) continue
      if (child.id === targetPanelId || visit(child)) return true
    }
    return false
  }

  return visit(source)
}

function isCircuitEntryEndpoint(match: PlacementCircuitMatch): boolean {
  const endpointIds =
    match.circuit.branches && match.circuit.branches.length > 0
      ? match.circuit.branches.map((branch) => branch.endpointIds[0]).filter(Boolean)
      : [match.circuit.endpoints[0]?.id]
  return endpointIds.includes(match.endpoint.endpoint.id)
}

function isImmediateCircuitSuccessor(
  source: PlacementCircuitMatch,
  target: PlacementCircuitMatch
): boolean {
  if (source.circuit.id !== target.circuit.id) return false
  const endpointIds =
    source.circuit.branches && source.circuit.branches.length > 0
      ? source.circuit.branches.find((branch) => branch.id === source.branchId)?.endpointIds
      : source.circuit.endpoints.map((endpoint) => endpoint.id)
  if (!endpointIds) return false
  const sourceIndex = endpointIds.indexOf(source.endpoint.endpoint.id)
  return sourceIndex >= 0 && endpointIds[sourceIndex + 1] === target.endpoint.endpoint.id
}

/**
 * Build an explicit situation-plan wire for non-default connections. Plan wires are
 * undirected: either end may be dragged first. A panel is electrically adjacent to
 * immediate circuit-entry endpoints in its own or a downstream board. Protection
 * devices remain part of that path even when they have no plan placement; a later
 * endpoint in a branch is not directly connected to the panel.
 */
export function buildManualOtherPlanWireRoute(
  project: PlanWiringProject,
  floorId: string,
  sourcePlacementId: string,
  targetPlacementId: string
): PlanWireRoute | null {
  if (sourcePlacementId === targetPlacementId) return null
  const panels = selectProjectElectricalPanels(project)
  const source = findCircuitMatchForPlacement(project, panels, floorId, sourcePlacementId)
  const target = findCircuitMatchForPlacement(project, panels, floorId, targetPlacementId)
  if (!source || !target) return null
  if (getPlanWireKind(source.endpoint.endpoint, target.endpoint.endpoint) !== 'other') return null

  const isDirectPanelConnection = (
    panelSide: PlacementCircuitMatch,
    otherSide: PlacementCircuitMatch
  ) => {
    const panelId =
      panelSide.endpoint.endpoint.symbol === 'panel_distribution'
        ? (panelSide.endpoint.endpoint.panelId ?? panelSide.panel.id)
        : null
    return Boolean(
      panelId &&
      panelHasElectricalPathTo(panels, panelId, otherSide.panel.id) &&
      isCircuitEntryEndpoint(otherSide)
    )
  }
  const hasElectricalPath =
    isDirectPanelConnection(source, target) ||
    isDirectPanelConnection(target, source) ||
    isImmediateCircuitSuccessor(source, target) ||
    isImmediateCircuitSuccessor(target, source) ||
    (source.isSupplyDevice === true && target.isSupplyDevice === true) ||
    (source.isSupplyDevice === true && target.endpoint.endpoint.symbol === 'panel_distribution') ||
    (target.isSupplyDevice === true && source.endpoint.endpoint.symbol === 'panel_distribution')
  if (!hasElectricalPath) return null

  const route: PlanWireRoute = {
    ...routeFromPair(
      target.panel,
      target.circuit,
      target.branchId,
      floorId,
      source.endpoint,
      target.endpoint,
      'manual'
    ),
    kind: 'other',
  }
  if (source.trunkDeviceId) route.from.trunkDeviceId = source.trunkDeviceId
  if (target.trunkDeviceId) route.to.trunkDeviceId = target.trunkDeviceId
  return route
}

function collectIncomingFeederCounts(routes: PlanWireRoute[]): Map<string, number> {
  const incoming = new Map<string, number>()
  for (const route of routes) {
    const toId = route.to.placementId
    if (!toId) continue
    incoming.set(toId, (incoming.get(toId) ?? 0) + 1)
  }
  return incoming
}

/** True when adding `fromId → toId` would close a directed cycle. */
function wouldCreateFeederCycle(routes: PlanWireRoute[], fromId: string, toId: string): boolean {
  const adjacency = new Map<string, string[]>()
  for (const route of routes) {
    const routeFrom = route.from.placementId
    const routeTo = route.to.placementId
    if (!routeFrom || !routeTo) continue
    adjacency.set(routeFrom, [...(adjacency.get(routeFrom) ?? []), routeTo])
  }
  const stack = [toId]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || seen.has(current)) continue
    if (current === fromId) return true
    seen.add(current)
    stack.push(...(adjacency.get(current) ?? []))
  }
  return false
}

function hasFeederCycle(routes: PlanWireRoute[]): boolean {
  const adjacency = new Map<string, string[]>()
  for (const route of routes) {
    const fromId = route.from.placementId
    const toId = route.to.placementId
    if (!fromId || !toId) continue
    adjacency.set(fromId, [...(adjacency.get(fromId) ?? []), toId])
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true
    if (visited.has(node)) return false
    visiting.add(node)
    for (const next of adjacency.get(node) ?? []) {
      if (visit(next)) return true
    }
    visiting.delete(node)
    visited.add(node)
    return false
  }
  for (const node of adjacency.keys()) {
    if (visit(node)) return true
  }
  return false
}

/** Each load may have at most one feeder; no directed cycles. */
export function isValidPlanWireFeederTopology(
  routes: PlanWireRoute[],
  switchPlacementIds: ReadonlySet<string> = new Set()
): boolean {
  if (hasFeederCycle(routes)) return false
  for (const [placementId, count] of collectIncomingFeederCounts(routes)) {
    if (switchPlacementIds.has(placementId)) continue
    if (count > 1) return false
  }
  return true
}

export function buildManualPlanWireRoutesForPlacementMove(
  project: PlanWiringProject,
  floorId: string,
  sourcePlacementId: string,
  targetPlacementId: string,
  options: {
    /**
     * Store only the drawn wire and let automatic wiring fill in the rest of the branch (cable
     * routing builds its own tree around drawn wires). Without it, the first drawn lighting wire
     * copies the whole branch, in placement order, into manual wires.
     */
    keepAutoSpans?: boolean
  } = {}
): PlanWireRoute[] | null {
  if (sourcePlacementId === targetPlacementId) return null
  const panels = selectProjectElectricalPanels(project)
  const sameBranch = findCircuitSequenceForPlacements(
    panels,
    floorId,
    sourcePlacementId,
    targetPlacementId
  )
  const circuitMatch =
    sameBranch ??
    (() => {
      const found = findCircuitForPlacements(panels, floorId, sourcePlacementId, targetPlacementId)
      return found
        ? {
            panel: found.panel,
            circuit: found.circuit,
            branchId: undefined,
            sequence: found.sequence,
          }
        : null
    })()
  if (!circuitMatch) return null
  const sourceIndex = circuitMatch.sequence.findIndex(
    (item) => item.placement.id === sourcePlacementId
  )
  const targetIndex = circuitMatch.sequence.findIndex(
    (item) => item.placement.id === targetPlacementId
  )
  if (sourceIndex < 0 || targetIndex < 0) return null
  let source = circuitMatch.sequence[sourceIndex]
  let target = circuitMatch.sequence[targetIndex]
  if (!source || !target) return null
  const initialRouteKind = getPlanWireKind(source.endpoint, target.endpoint)
  if (endpointIsSwitch(source.endpoint) && endpointIsSwitch(target.endpoint)) return null
  if (
    ((initialRouteKind === 'lighting-control' && sameBranch) || initialRouteKind === 'sockets') &&
    source.endpoint.id !== target.endpoint.id &&
    sourceIndex > targetIndex
  ) {
    source = circuitMatch.sequence[targetIndex]
    target = circuitMatch.sequence[sourceIndex]
  }
  if (!source || !target) return null
  const routeKind = getPlanWireKind(source.endpoint, target.endpoint)
  const normalizedSourcePlacementId = source.placement.id
  const normalizedTargetPlacementId = target.placement.id
  if (
    (endpointIsSocket(source.endpoint) && endpointIsLightOrSwitch(target.endpoint)) ||
    (endpointIsSocket(target.endpoint) && endpointIsLightOrSwitch(source.endpoint))
  ) {
    return null
  }
  if (routeKind === 'lighting-control' && !sameBranch) return null
  if (
    routeKind === 'lighting-control' &&
    sameBranch &&
    endpointIsSwitch(source.endpoint) &&
    endpointIsLight(target.endpoint) &&
    circuitMatch.sequence
      .slice(Math.min(sourceIndex, targetIndex) + 1, Math.max(sourceIndex, targetIndex))
      .some((item) => endpointIsSwitch(item.endpoint))
  ) {
    return null
  }
  if (routeKind !== 'lighting-control' && routeKind !== 'sockets') return null
  const branchId = routeKind === 'sockets' ? undefined : circuitMatch.branchId
  const groupKey = planWireSpanSetKey({
    floorId,
    circuitId: circuitMatch.circuit.id,
    branchId,
    kind: routeKind,
  })
  const existingGroup = selectProjectPlanWireRoutes(project).filter(
    (route) => planWireSpanSetKey(route) === groupKey
  )
  const baseRoutes =
    existingGroup && existingGroup.length > 0
      ? existingGroup
      : routeKind === 'sockets' || options.keepAutoSpans
        ? []
        : circuitMatch.sequence
            .slice(0, -1)
            .map((from, index) => {
              const to = circuitMatch.sequence[index + 1]
              if (!to) return null
              if (!placementsShareFloor(floorId, from, to)) return null
              return routeFromPair(
                circuitMatch.panel,
                circuitMatch.circuit,
                branchId,
                floorId,
                from,
                to
              )
            })
            .filter((route): route is PlanWireRoute => Boolean(route))
            .filter((route) => route.kind === routeKind)

  const nextRoutes = baseRoutes.filter(
    (route) =>
      route.to.placementId !== normalizedTargetPlacementId &&
      !(
        route.from.placementId === normalizedSourcePlacementId &&
        route.to.placementId === normalizedTargetPlacementId
      ) &&
      !(
        route.from.placementId === normalizedTargetPlacementId &&
        route.to.placementId === normalizedSourcePlacementId
      )
  )
  if (
    wouldCreateFeederCycle(nextRoutes, normalizedSourcePlacementId, normalizedTargetPlacementId)
  ) {
    return null
  }

  nextRoutes.push(
    routeFromPair(
      circuitMatch.panel,
      circuitMatch.circuit,
      branchId,
      floorId,
      source,
      target,
      'manual'
    )
  )

  const switchPlacementIds = new Set(
    circuitMatch.sequence
      .filter((item) => {
        const symbol = endpointSymbol(item.endpoint)
        return Boolean(symbol && SWITCH_SYMBOLS.has(symbol))
      })
      .map((item) => item.placement.id)
  )

  if (!isValidPlanWireFeederTopology(nextRoutes, switchPlacementIds)) {
    return null
  }

  return nextRoutes.map((route) => ({ ...route, source: 'manual' }))
}

function collectRoutesForPanels(
  panels: Panel[],
  floorId: string,
  includeKinds: Set<PlanWireKind>
): PlanWireRoute[] {
  const routes: PlanWireRoute[] = []
  for (const panel of panels) {
    for (const circuit of panel.circuits) {
      routes.push(...buildRoutesForCircuit(panel, circuit, floorId, includeKinds))
    }
    for (const protection of panel.protections) {
      for (const circuit of protection.circuits ?? []) {
        routes.push(...buildRoutesForCircuit(panel, circuit, floorId, includeKinds))
      }
    }
    routes.push(...collectRoutesForPanels(panel.subPanels ?? [], floorId, includeKinds))
  }
  return routes
}

export function deriveAutoPlanWireRoutes(
  project: ProjectWithOptionalV2Electrical | null | undefined,
  floorId: string | null | undefined,
  includeKinds: Iterable<PlanWireKind>
): PlanWireRoute[] {
  if (!project || !floorId) return []
  // Cable routing owns the plan wiring when enabled: one trace per physical cable link.
  if (isCableRoutesEnabled() && isProjectV2(project)) {
    return deriveCablePlanWireRoutes(project, floorId, new Set(includeKinds))
  }
  return collectRoutesForPanels(
    selectProjectElectricalPanels(project),
    floorId,
    new Set(includeKinds)
  )
}

/** Match a manual override to its auto-routed equivalent (same id or same symbol pair). */
export function findMatchingAutoPlanWireRoute(
  project: PlanWiringProject,
  route: PlanWireRoute
): PlanWireRoute | undefined {
  const autoRoutes = deriveAutoPlanWireRoutes(project, route.floorId, [route.kind])
  return autoRoutes.find(
    (candidate) =>
      candidate.id === route.id ||
      (candidate.from.placementId === route.from.placementId &&
        candidate.to.placementId === route.to.placementId)
  )
}

/**
 * Remove one manual waypoint. The route stays: drop the manual override when an auto
 * route exists for the same connection, otherwise keep a direct endpoint-to-endpoint wire.
 */
export function removePlanWireRouteWaypoint(
  project: PlanWiringProject,
  route: PlanWireRoute,
  waypointIndex: number
): boolean {
  const routes = selectProjectPlanWireRoutes(project)
  const existingIndex = routes.findIndex((candidate) => candidate.id === route.id)
  if (existingIndex < 0) return false
  const existing = routes[existingIndex]
  if (!existing) return false

  const waypoints = [...(existing.waypoints ?? [])]
  if (waypointIndex < 0 || waypointIndex >= waypoints.length) return false
  waypoints.splice(waypointIndex, 1)

  if (waypoints.length === 0) {
    // A manual copy that moved its riser stays, even without waypoints.
    if (!existing.riser?.pos && findMatchingAutoPlanWireRoute(project, route)) {
      routes.splice(existingIndex, 1)
    } else {
      existing.waypoints = []
      existing.source = 'manual'
    }
  } else {
    existing.waypoints = waypoints
    existing.source = 'manual'
  }
  replacePlanWireRoutesForProject(project, routes)
  return true
}

export function hidePlanSocketWireRouteForPlacementDrop(
  project: PlanWiringProject,
  floorId: string,
  placementId: string
): boolean {
  const autoRoutes = deriveAutoPlanWireRoutes(project, floorId, ['sockets'])
  const manualRoutes = selectProjectPlanWireRoutes(project).filter(
    (route) => route.floorId === floorId && route.kind === 'sockets'
  )
  const mergedRoutes = mergePlanWireRoutes(autoRoutes, manualRoutes)
  const routes = mergedRoutes.filter(
    (candidate) => candidate.kind === 'sockets' && candidate.from.placementId === placementId
  )
  if (routes.length === 0) return false

  const storedRoutes = selectProjectPlanWireRoutes(project)
  const hiddenRoutes: PlanWireRoute[] = routes.map((route) => ({
    ...route,
    source: 'manual',
    hidden: true,
    waypoints: undefined,
  }))
  const hiddenRouteIds = new Set(hiddenRoutes.map((route) => route.id))
  replacePlanWireRoutesForProject(project, [
    ...storedRoutes.filter((candidate) => !hiddenRouteIds.has(candidate.id)),
    ...hiddenRoutes,
  ])
  return true
}

/** Routes in the same lighting/socket sequence on one floor — orthogonal avoidance applies only within this group. */
export function planWireSpanSetKey(
  route: Pick<PlanWireRoute, 'floorId' | 'circuitId' | 'branchId' | 'kind'>
): string {
  return `${route.floorId}|${route.circuitId}|${route.branchId ?? 'sequence'}|${route.kind}`
}

function resolveEndpointPanelId(panels: Panel[], endpointId: string): string | null {
  for (const panel of panels) {
    const circuits = [
      ...panel.circuits,
      ...panel.protections.flatMap((protection) => protection.circuits ?? []),
    ]
    for (const circuit of circuits) {
      if (circuit.endpoints.some((endpoint) => endpoint.id === endpointId)) {
        return panel.id
      }
    }
    const nested = resolveEndpointPanelId(panel.subPanels ?? [], endpointId)
    if (nested) return nested
  }
  return null
}

/**
 * Keep plan wires scoped to the active sitplan panel filter.
 * Matches symbol filtering: when a panel has no placements on the floor, no wires are shown.
 */
export function filterPlanWireRoutesForPanel(
  routes: PlanWireRoute[],
  panelId: string | null | undefined,
  options?: {
    allowedPlacementIds?: ReadonlySet<string>
    project?: ProjectWithOptionalV2Electrical | null
  }
): PlanWireRoute[] {
  if (!panelId) return routes

  const allowedPlacementIds = options?.allowedPlacementIds
  if (allowedPlacementIds && allowedPlacementIds.size === 0) {
    return []
  }

  const project = options?.project
  return routes.filter((route) => {
    const fromPlacementId = route.from.placementId
    const toPlacementId = route.to.placementId
    // A departure run ends at a riser: only its source symbol is on this floor.
    if (route.riserExit && fromPlacementId && allowedPlacementIds) {
      return allowedPlacementIds.has(fromPlacementId)
    }
    if (fromPlacementId && toPlacementId && allowedPlacementIds) {
      return (
        (route.riser != null || allowedPlacementIds.has(fromPlacementId)) &&
        allowedPlacementIds.has(toPlacementId)
      )
    }
    if (route.panelId === panelId) return true
    if (!project) return false
    const panels = selectProjectElectricalPanels(project)
    const fromPanel = route.from.endpointId
      ? resolveEndpointPanelId(panels, route.from.endpointId)
      : null
    const toPanel = route.to.endpointId ? resolveEndpointPanelId(panels, route.to.endpointId) : null
    return fromPanel === panelId && toPanel === panelId
  })
}

/**
 * Keep plan wires attached to symbols that are currently visible on the
 * situation plan. A route with an explicit placement id must match that
 * placement; legacy routes without placement ids fall back to endpoint or
 * trunk-device visibility.
 */
export function filterPlanWireRoutesForSymbolVisibility(
  routes: PlanWireRoute[],
  options: {
    visiblePlacementIds: ReadonlySet<string>
    visibleEndpointIds: ReadonlySet<string>
    visibleTrunkDeviceIds: ReadonlySet<string>
  }
): PlanWireRoute[] {
  const isVisible = (endpoint: PlanWireRoute['from']): boolean => {
    if (endpoint.placementId) return options.visiblePlacementIds.has(endpoint.placementId)
    if (endpoint.trunkDeviceId && options.visibleTrunkDeviceIds.has(endpoint.trunkDeviceId)) {
      return true
    }
    return options.visibleEndpointIds.has(endpoint.endpointId)
  }

  // A trace arriving from another floor starts at a riser; its source symbol is elsewhere. A
  // departure run ends at that riser; its target symbol is elsewhere.
  return routes.filter(
    (route) => (route.riser || isVisible(route.from)) && (route.riserExit || isVisible(route.to))
  )
}

export function mergePlanWireRoutes(
  autoRoutes: PlanWireRoute[],
  manualRoutes: PlanWireRoute[] | undefined
): PlanWireRoute[] {
  const manual = manualRoutes ?? []
  if (manual.length === 0) {
    return [...autoRoutes]
  }

  const manualTargetsBySpan = new Map<string, Set<string>>()
  for (const route of manual) {
    const toId = route.to.placementId
    if (!toId) continue
    const spanKey = planWireSpanSetKey(route)
    const targets = manualTargetsBySpan.get(spanKey) ?? new Set<string>()
    targets.add(toId)
    manualTargetsBySpan.set(spanKey, targets)
  }

  // One cable wire reaches each placement: a wire drawn into the same placement replaces the
  // cable-derived trace, whatever branch it was drawn under, and draws that cable.
  const cableTargetKey = (route: PlanWireRoute) =>
    `${route.floorId}|${route.circuitId}|${route.to.placementId}`
  const manualByCableTarget = new Map<string, PlanWireRoute>()
  for (const route of manual) {
    if (route.to.placementId && !route.riserExit)
      manualByCableTarget.set(cableTargetKey(route), route)
  }
  const adoptedCable = new Map<string, PlanWireRoute>()

  const byId = new Map<string, PlanWireRoute>()
  for (const route of autoRoutes) {
    const spanKey = planWireSpanSetKey(route)
    const manualTargets = manualTargetsBySpan.get(spanKey)
    const drawn =
      route.wireAnchor && route.to.placementId
        ? manualByCableTarget.get(cableTargetKey(route))
        : undefined
    if (drawn) {
      if (!drawn.wireAnchor || drawn.wireAnchor === route.wireAnchor)
        adoptedCable.set(drawn.id, route)
      continue
    }
    if (route.to.placementId && manualTargets?.has(route.to.placementId)) {
      continue
    }
    byId.set(route.id, route)
  }
  for (const route of manual) {
    if (route.hidden) continue
    const cable = adoptedCable.get(route.id)
    byId.set(
      route.id,
      cable
        ? {
            ...route,
            kind: cable.kind,
            wireAnchor: cable.wireAnchor,
            ...(cable.riser && !route.riser ? { riser: cable.riser } : {}),
          }
        : route
    )
  }
  return Array.from(byId.values())
}

/**
 * Cable-routing toggles stay optional, so plain projects keep their stored shape. Absent means
 * off, except `supplyVisible`, which is on until turned off.
 */
type CableRoutingWireToggles =
  | 'homeRunsVisible'
  | 'branchFeedsVisible'
  | 'supplyVisible'
  | 'colorCoded'
  | 'wireToolWiresVisible'
  | 'wireToolCategoriesVisible'
  | 'cableRouteSettings'
export type ResolvedPlanWiringVisibility = Required<
  Omit<PlanWiringVisibility, CableRoutingWireToggles>
> &
  Pick<PlanWiringVisibility, CableRoutingWireToggles>

export const DEFAULT_PLAN_WIRING_VISIBILITY: ResolvedPlanWiringVisibility = {
  wiresVisible: true,
  lightingVisible: true,
  socketsVisible: false,
  otherVisible: false,
  defaultStyle: 'spline',
}

export function resolvePlanWiringVisibility(
  model?: PlanWiringModel | null
): ResolvedPlanWiringVisibility {
  const visibility = model?.visibility
  const defaultStyle =
    visibility?.defaultStyle === 'orthogonal' || visibility?.defaultStyle === 'straight'
      ? visibility.defaultStyle
      : DEFAULT_PLAN_WIRING_VISIBILITY.defaultStyle
  return {
    wiresVisible: visibility?.wiresVisible ?? DEFAULT_PLAN_WIRING_VISIBILITY.wiresVisible,
    lightingVisible: visibility?.lightingVisible ?? DEFAULT_PLAN_WIRING_VISIBILITY.lightingVisible,
    socketsVisible: visibility?.socketsVisible ?? DEFAULT_PLAN_WIRING_VISIBILITY.socketsVisible,
    otherVisible: visibility?.otherVisible ?? DEFAULT_PLAN_WIRING_VISIBILITY.otherVisible,
    ...(visibility?.homeRunsVisible !== undefined
      ? { homeRunsVisible: visibility.homeRunsVisible }
      : {}),
    ...(visibility?.branchFeedsVisible !== undefined
      ? { branchFeedsVisible: visibility.branchFeedsVisible }
      : {}),
    ...(visibility?.supplyVisible !== undefined ? { supplyVisible: visibility.supplyVisible } : {}),
    ...(visibility?.colorCoded !== undefined ? { colorCoded: visibility.colorCoded } : {}),
    ...(visibility?.wireToolWiresVisible !== undefined
      ? { wireToolWiresVisible: visibility.wireToolWiresVisible }
      : {}),
    ...(visibility?.wireToolCategoriesVisible
      ? { wireToolCategoriesVisible: { ...visibility.wireToolCategoriesVisible } }
      : {}),
    ...(visibility?.cableRouteSettings
      ? { cableRouteSettings: { ...visibility.cableRouteSettings } }
      : {}),
    defaultStyle,
  }
}

export function planWireKindsForVisibility(
  visibility: ResolvedPlanWiringVisibility
): PlanWireKind[] {
  if (!visibility.wiresVisible) return []
  const kinds: PlanWireKind[] = []
  if (visibility.lightingVisible) kinds.push('lighting-control')
  if (visibility.socketsVisible) kinds.push('sockets')
  if (visibility.otherVisible) kinds.push('other')
  return kinds
}

type PlanWiringIndex = {
  floorIds: Set<string>
  endpointIds: Set<string>
  circuitIds: Set<string>
  panelIds: Set<string>
  placementById: Map<string, { endpointId: string; floorId: string }>
}

function collectPlanWiringIndex(panels: Panel[]): PlanWiringIndex {
  const floorIds = new Set<string>()
  const endpointIds = new Set<string>()
  const circuitIds = new Set<string>()
  const panelIds = new Set<string>()
  const placementById = new Map<string, { endpointId: string; floorId: string }>()

  const visitPanel = (panel: Panel) => {
    panelIds.add(panel.id)
    const visitCircuit = (circuit: Circuit) => {
      circuitIds.add(circuit.id)
      for (const endpoint of circuit.endpoints) {
        endpointIds.add(endpoint.id)
        for (const placement of endpoint.placements) {
          placementById.set(placement.id, {
            endpointId: endpoint.id,
            floorId: placement.floorId,
          })
          floorIds.add(placement.floorId)
        }
      }
    }
    for (const circuit of panel.circuits) visitCircuit(circuit)
    for (const protection of panel.protections) {
      for (const circuit of protection.circuits ?? []) visitCircuit(circuit)
    }
    for (const subPanel of panel.subPanels ?? []) visitPanel(subPanel)
  }

  for (const panel of panels) visitPanel(panel)
  return { floorIds, endpointIds, circuitIds, panelIds, placementById }
}

function normalizePlanWireEndpointRef(
  ref: PlanWireRoute['from'],
  floorId: string,
  index: PlanWiringIndex
): PlanWireRoute['from'] | null {
  // Supply assemblies keep their physical devices outside circuit endpoints.
  // The device id plus placement id is the stable anchor for these manual traces.
  if (ref.trunkDeviceId) return { ...ref, endpointId: ref.trunkDeviceId }
  if (!index.endpointIds.has(ref.endpointId)) return null
  if (!ref.placementId) return { endpointId: ref.endpointId }
  const placement = index.placementById.get(ref.placementId)
  if (!placement || placement.endpointId !== ref.endpointId || placement.floorId !== floorId) {
    return null
  }
  return ref
}

function dedupePlanWireRoutes(routes: PlanWireRoute[]): PlanWireRoute[] {
  const byId = new Map<string, PlanWireRoute>()
  for (const route of routes) {
    const existing = byId.get(route.id)
    if (!existing) {
      byId.set(route.id, route)
      continue
    }
    const preferRoute =
      (route.source === 'manual' && existing.source !== 'manual') ||
      (route.waypoints?.length ?? 0) > (existing.waypoints?.length ?? 0)
    if (preferRoute) byId.set(route.id, route)
  }
  return Array.from(byId.values())
}

function normalizePlanWireRoute(
  route: PlanWireRoute,
  index: PlanWiringIndex
): PlanWireRoute | null {
  if (!index.floorIds.has(route.floorId)) return null
  if (!index.circuitIds.has(route.circuitId)) return null

  const from = normalizePlanWireEndpointRef(route.from, route.floorId, index)
  const to = normalizePlanWireEndpointRef(route.to, route.floorId, index)
  if (!from || !to) return null

  const kind: PlanWireKind =
    route.kind === 'lighting-control' || route.kind === 'sockets' || route.kind === 'other'
      ? route.kind
      : 'other'
  const source: PlanWireRoute['source'] = route.source === 'manual' ? 'manual' : 'auto'
  const style: PlanWireRouteStyle | undefined =
    route.style === 'orthogonal' || route.style === 'spline' || route.style === 'straight'
      ? route.style
      : undefined

  return {
    ...route,
    kind,
    source,
    style,
    hidden: route.hidden === true ? true : undefined,
    from,
    to,
    panelId: route.panelId && index.panelIds.has(route.panelId) ? route.panelId : undefined,
    waypoints: Array.isArray(route.waypoints)
      ? route.waypoints.filter(
          (point) =>
            typeof point?.x === 'number' &&
            Number.isFinite(point.x) &&
            typeof point?.y === 'number' &&
            Number.isFinite(point.y)
        )
      : undefined,
  }
}

function manualPlanWireRouteIsStillLegal(
  project: PlanWiringProject,
  route: PlanWireRoute
): boolean {
  const fromPlacementId = route.from.placementId
  const toPlacementId = route.to.placementId
  if (!fromPlacementId || !toPlacementId) return true
  if (route.kind === 'other') {
    return Boolean(
      buildManualOtherPlanWireRoute(project, route.floorId, fromPlacementId, toPlacementId)
    )
  }
  if (route.kind !== 'lighting-control') return true
  const rebuilt = buildManualPlanWireRoutesForPlacementMove(
    project,
    route.floorId,
    fromPlacementId,
    toPlacementId
  )
  return Boolean(
    rebuilt?.some(
      (candidate) =>
        candidate.from.placementId === route.from.placementId &&
        candidate.to.placementId === route.to.placementId
    )
  )
}

/**
 * Normalize and repair persisted plan wiring (routes + visibility).
 * Returns true when the project document was mutated.
 */
export function healPlanWiring(project: PlanWiringProject): boolean {
  let changed = false
  const projectFloorIds = new Set(selectProjectBuildingFloors(project).map((floor) => floor.id))
  const index = collectPlanWiringIndex(selectProjectElectricalPanels(project))

  const raw = selectProjectPlanWiringProjection(project)
  if (raw.routes.length === 0 && Object.keys(raw.visibility ?? {}).length === 0) {
    return false
  }

  if (raw.version !== 1) {
    changed = true
  }

  const routesInput = Array.isArray(raw.routes) ? raw.routes : []
  if (!Array.isArray(raw.routes)) {
    changed = true
  }

  const healedRoutes = dedupePlanWireRoutes(
    routesInput
      .map((route) => normalizePlanWireRoute(route, { ...index, floorIds: projectFloorIds }))
      .filter((route): route is PlanWireRoute => route != null)
      .filter((route) => manualPlanWireRouteIsStillLegal(project, route))
  )
  if (
    healedRoutes.length !== routesInput.length ||
    JSON.stringify(healedRoutes) !== JSON.stringify(routesInput)
  ) {
    replacePlanWireRoutesForProject(project, healedRoutes)
    changed = true
  }

  const hadStoredVisibility = raw.visibility != null
  const resolvedVisibility = resolvePlanWiringVisibility(raw)
  const nextVisibility: PlanWiringVisibility = { ...resolvedVisibility }
  if (JSON.stringify(raw.visibility ?? null) !== JSON.stringify(nextVisibility)) {
    replacePlanWiringVisibilityForProject(project, nextVisibility)
    changed = true
  }

  if (healedRoutes.length === 0 && !hadStoredVisibility) {
    clearPlanWiringForProject(project)
    changed = true
  }

  return changed
}
