import { buildElectricalStructureSnapshot } from '@/lib/electricalStructure'
import type { ElectricalStructureSnapshot } from '@/lib/electricalStructure'
import { distance, projectPointToSegment } from '@/lib/geometry'
import { getAwaitingSituationPlanPlacements } from '@/lib/plan/hiddenSituationPlanPlacements'
import { getSituationPlanPlacementIdsHiddenByPanel } from '@/lib/plan/panelPlanPlacementVisibility'
import { collectSharedJunctions, sharedJunctionKey } from '@/lib/plan/sharedJunctionPlacements'
import { symbolCanAppearInPanelGrid } from '@/lib/panel/panelGridSymbolEligibility'
import {
  readLegacyCompatibilityFloors,
  selectProjectBuildingFloors,
  selectProjectFloorPlan,
  selectProjectPlanScale,
} from '@/lib/projectV2/buildingFloors'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectAuxiliaryElectricalEnclosures,
  selectProjectSupplyAssemblies,
} from '@/lib/projectV2/electrical'
import { getAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { findMainPanel } from '@/lib/panel/panelTree'
import { resolveAssemblyPanelInput } from '@/lib/supplyAssembly/electricalTopology'
import type { SupplyNode } from '@/types/supplyAssembly'
import {
  selectProjectPlanWireRoutes,
  selectProjectPlanWiringVisibility,
} from '@/lib/projectV2/planWiring'
import {
  collectCircuitCableEdges,
  type CircuitCableEdge,
} from '@/lib/shortCircuit/circuitCablePaths'
import type { ProjectV2 } from '@/types/projectV2'
import { getDerivedCircuitKind } from '@/lib/circuitKind'
import { resolvePlanPxPerMeter } from '@/lib/plan/planScale'
import { findWireRunForAnchor, selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
import type {
  CableSpec,
  Circuit,
  CircuitKind,
  Endpoint,
  Floor,
  Panel,
  Placement,
  PlanWireRoute,
  Point2,
  TrunkDevice,
} from '@/types/schema'

/**
 * Physical cable-route estimates derived from the situation plan.
 *
 * The one-wire diagram says which points a circuit feeds, not how the cable is laid. This
 * module rebuilds a plausible physical chain per circuit and then routes each link in 3D:
 *
 * - **Feed tree.** Lighting branches (with switches or lights) keep their one-wire order and
 *   are entered at their first point. Every other point is its own stop. Each stop or branch is
 *   fed from the nearest live point: the board, any free point (socket, appliance), or the
 *   first point of an already-connected lighting branch. Lights carry switched wires and never
 *   feed anything.
 * - **Floor first, walls for vertical.** Runs between wall-mounted devices go straight through
 *   the floor and may pass under walls; cable rises or drops in the wall at each device. A link
 *   with a ceiling device stays in the ceiling: the wall-mounted end (a switch, the board)
 *   rises in its own wall and the cable crosses the ceiling directly.
 * - **Off-plan points.** A point whose symbols are hidden, or still waiting to be placed, sits
 *   next to its neighbour in the branch (e.g. a LED driver beside its light) and adds no route.
 * - **Risers** sit where the cable leaves: runs from a board to another floor share one riser
 *   at the board and spread out on the target floor, keeping slab passages to a minimum.
 * - **Junction boxes and panels** are one physical object per identity, however often the
 *   one-wire draws them. A circuit with junctions on its feed runs from the board through each
 *   of them in one-wire order, and its points are fed from the last one.
 *
 * Each one-wire edge into a point gets the physical link that reaches that point, so lengths
 * stay keyed by the same wire anchor as `WireRun.segmentLengths`. Estimates are a range:
 * `lowM` uses straight runs, `highM` adds a detour factor. A manual plan trace for the same
 * placement pair replaces the floor run.
 *
 * Derived only; nothing here is persisted. Design: apps/app/docs/context/future/
 * short-circuit-breaking-capacity.md, section 6.
 */

export interface CableRouteSettings {
  /** Floor-to-floor height, also the ceiling level, when a floor has no height. */
  floorHeightM: number
  socketHeightM: number
  switchHeightM: number
  wallLightHeightM: number
  panelHeightM: number
  applianceHeightM: number
  domoticaHeightM: number
  /** Extra cable at each termination. */
  terminationSlackM: number
  /** High estimate for straight floor and ceiling runs: straight length × this factor. */
  horizontalDetourFactor: number
  /**
   * High estimate for runs routed with the wire tool: the drawn route × this factor. Cable
   * never lies exactly on a drawn line (bends, fixings, going around obstacles).
   */
  drawnDetourFactor: number
  /** A device closer than this to a wall centreline is treated as wall-mounted. */
  wallProximityM: number
}

export const DEFAULT_CABLE_ROUTE_SETTINGS: CableRouteSettings = {
  floorHeightM: 2.7,
  socketHeightM: 0.3,
  switchHeightM: 1.1,
  wallLightHeightM: 2.0,
  panelHeightM: 1.5,
  applianceHeightM: 0.6,
  domoticaHeightM: 1.5,
  terminationSlackM: 0.3,
  horizontalDetourFactor: 1.2,
  drawnDetourFactor: 1.1,
  wallProximityM: 0.35,
}

/** The project's own mounting heights (cable list settings) over the defaults. */
export function resolveCableRouteSettings(project: ProjectV2): CableRouteSettings {
  const stored = selectProjectPlanWiringVisibility(project).cableRouteSettings ?? {}
  const settings = { ...DEFAULT_CABLE_ROUTE_SETTINGS }
  for (const key of ['floorHeightM', 'socketHeightM', 'switchHeightM', 'panelHeightM'] as const) {
    const value = stored[key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) settings[key] = value
  }
  return settings
}

export type RouteLevel = 'ceiling' | 'floor'
export type HorizontalBasis = 'drawn-trace' | 'straight-estimate'

/** A mounted device or board on the plan. */
export interface RouteLocation {
  floorId: string
  pos: Point2
  /** Mounting height above the floor's finished level. */
  heightM: number
  /** Mounted at the ceiling rather than on a wall. */
  ceiling: boolean
  placementId?: string
  /** Endpoint owning `placementId` (for a board: its `panel_distribution` endpoint). */
  endpointId?: string
  /** Trunk device owning `placementId`, for a junction box or panel on a circuit's feed. */
  trunkDeviceId?: string
  /**
   * A device mounted in the board (a relay, timer, contactor) and not on the plan: it sits at
   * the board, so the plan location and `placementId` are the board's.
   */
  inBoard?: boolean
  /** Supply enclosure (virtual panel) owning `placementId`. */
  enclosureId?: string
  /** Node type and symbol, for insetting drawn wires to the symbol edge. */
  nodeType: string
  symbolId?: string
  /** Short user-facing code: the point label (e.g. `C1`) or the board name. */
  code: string
  label: string
}

/** How a link sits in the physical feed tree. */
export type CableRouteRole =
  /** From the board to the first point it feeds. */
  | 'home-run'
  /** From one branch's live point to the start of another lighting branch. */
  | 'branch-feed'
  /** Within a branch (switch → light) or along a chain of free points (socket → socket). */
  | 'wire'
  /** From a protection on one board to another board. */
  | 'board-feeder'
  /** On the supply side: from the board to an inverter, and on to its solar panels and batteries. */
  | 'supply'
  /** From a main board to its earth electrode. */
  | 'earthing'

/** Circuit groups used to colour wires. */
export type CableRouteCategory =
  | 'lighting'
  | 'sockets'
  | 'devices'
  | 'feeders'
  | 'supply'
  | 'dc'
  | 'earthing'
  | 'other'

/** A route end as shown to users: its code and symbol. */
export interface CableRoutePoint {
  code: string
  symbolId?: string
  nodeType?: string
}

export type CableRouteLeg =
  | {
      kind: 'vertical'
      floorId: string
      pos: Point2
      fromHeightM: number
      toHeightM: number
      lengthM: number
    }
  | {
      kind: 'horizontal'
      floorId: string
      points: Point2[]
      level: RouteLevel
      basis: HorizontalBasis
      lowM: number
      highM: number
    }
  | {
      kind: 'riser'
      pos: Point2
      fromFloorId: string
      toFloorId: string
      lengthM: number
    }

export type CableRouteGapCode = 'unplaced-endpoint' | 'unplaced-panel'

export interface CableRouteGap {
  code: CableRouteGapCode
  nodeId: string
  /** Where to draw the marker, when a location is known. */
  at?: { floorId: string; pos: Point2 }
}

export interface CableRouteEstimate {
  /** One-wire wire anchor of the edge into `toNodeId`. */
  anchor: string
  /** Other anchors of the same physical cable, so selecting any of them selects this route. */
  aliasAnchors?: string[]
  circuitId: string
  circuitCode?: string
  /** Board the cable leaves from. */
  boardName?: string
  /** Cable specification of the wire, when known. */
  cable?: CableSpec
  /** Position of this link in the circuit's physical chain, starting at 1. */
  order: number
  role: CableRouteRole
  category: CableRouteCategory
  /** One-wire source of the edge; the physical source is `fromLabel`. */
  fromNodeId: string
  /** Source node of the physical feed tree, retaining the circuit occurrence of shared devices. */
  physicalFromNodeId?: string
  toNodeId: string
  fromLabel: string
  toLabel: string
  /** Readable ends: the physical source (feeder) and the point reached. */
  fromPoint?: CableRoutePoint
  toPoint?: CableRoutePoint
  from?: RouteLocation
  to?: RouteLocation
  legs: CableRouteLeg[]
  /**
   * A point placed more than once: the further wires of the same cable, besides `from` → `to`.
   * Together they form the least-wire tree from the feeder through every placement.
   */
  hops?: Array<{ from: RouteLocation; to: RouteLocation }>
  horizontalLowM: number
  horizontalHighM: number
  verticalM: number
  riserM: number
  slackM: number
  lowM: number
  highM: number
  /** Cable length from the board to this point along the physical chain. */
  fromBoardLowM: number
  fromBoardHighM: number
  /** `drawn-trace` only when every horizontal leg follows a manual plan trace. */
  basis: HorizontalBasis
  /** Set for off-plan points: the neighbour they are assumed to sit next to. */
  besideLabel?: string
  gaps: CableRouteGap[]
  /** Length stored on the wire, for comparison. */
  enteredLengthM?: number
  /** True when `enteredLengthM` is an accepted plan estimate rather than typed. */
  enteredLengthEstimated?: boolean
  /** False until every imported floor touched by this route has a known scale. */
  scaleCalibrated?: boolean
  estimateNeedsReview?: boolean
}

export type CableRouteAssumption =
  | 'floor-elevation-from-order'
  | 'floor-height-default'
  | 'plan-scale-assumed'

export interface CableRouteEstimation {
  routes: CableRouteEstimate[]
  assumptions: CableRouteAssumption[]
}

interface FloorInfo {
  elevationM: number
  heightM: number
}

interface ModelIndex {
  panelById: Map<string, Panel>
  circuitById: Map<string, Circuit>
  endpointById: Map<string, Endpoint>
  panelByCircuitId: Map<string, Panel>
  panelLocationByPanelId: Map<string, Placement>
  /** The `panel_distribution` endpoint that places each board on the plan. */
  panelEndpointIdByPanelId: Map<string, string>
}

function ownCircuits(panel: Panel): Circuit[] {
  const circuits = [...panel.circuits]
  for (const protection of panel.protections) circuits.push(...(protection.circuits ?? []))
  return circuits
}

function indexModel(panels: readonly Panel[]): ModelIndex {
  const panelById = new Map<string, Panel>()
  const circuitById = new Map<string, Circuit>()
  const endpointById = new Map<string, Endpoint>()
  const panelByCircuitId = new Map<string, Panel>()
  const distributionEndpoints: Endpoint[] = []
  const allPanels: Panel[] = []
  const visit = (panel: Panel) => {
    allPanels.push(panel)
    panelById.set(panel.id, panel)
    for (const circuit of ownCircuits(panel)) {
      circuitById.set(circuit.id, circuit)
      panelByCircuitId.set(circuit.id, panel)
      for (const endpoint of circuit.endpoints) {
        endpointById.set(endpoint.id, endpoint)
        if (endpoint.symbol === 'panel_distribution') distributionEndpoints.push(endpoint)
      }
    }
    for (const subPanel of panel.subPanels) visit(subPanel)
  }
  for (const panel of panels) visit(panel)

  const panelLocationByPanelId = new Map<string, Placement>()
  const panelEndpointIdByPanelId = new Map<string, string>()
  for (const panel of allPanels) {
    const endpoint =
      distributionEndpoints.find((candidate) => candidate.panelId === panel.id) ??
      distributionEndpoints.find(
        (candidate) => !candidate.panelId && candidate.label === panel.name
      )
    const placement = endpoint?.placements[0]
    if (placement && endpoint) {
      panelLocationByPanelId.set(panel.id, placement)
      panelEndpointIdByPanelId.set(panel.id, endpoint.id)
    }
  }
  return {
    panelById,
    circuitById,
    endpointById,
    panelByCircuitId,
    panelLocationByPanelId,
    panelEndpointIdByPanelId,
  }
}

function isCeilingSymbol(endpoint: Endpoint): boolean {
  return endpoint.symbol === 'smoke_detector' || endpoint.symbol === 'motion_detector'
}

/** Switches and lights are wired in their one-wire order. */
function isLightingSide(endpoint: Endpoint): boolean {
  return endpoint.type === 'light_point' || endpoint.type === 'switch'
}

interface WallSegment {
  a: Point2
  b: Point2
}

class PlanGeometry {
  private readonly wallsByFloor = new Map<string, WallSegment[]>()

  constructor(
    private readonly project: ProjectV2,
    private readonly metersPerUnit: number,
    private readonly settings: CableRouteSettings
  ) {}

  private walls(floorId: string): WallSegment[] {
    let walls = this.wallsByFloor.get(floorId)
    if (!walls) {
      walls = []
      for (const wall of selectProjectFloorPlan(this.project, floorId)?.walls ?? []) {
        for (let index = 0; index < wall.points.length - 1; index += 1) {
          walls.push({ a: wall.points[index]!, b: wall.points[index + 1]! })
        }
      }
      this.wallsByFloor.set(floorId, walls)
    }
    return walls
  }

  nearestWallPoint(floorId: string, pos: Point2): { point: Point2; distanceM: number } | undefined {
    let best: { point: Point2; distanceSq: number } | undefined
    for (const wall of this.walls(floorId)) {
      const projected = projectPointToSegment(pos, wall.a, wall.b)
      if (!best || projected.distanceSq < best.distanceSq) {
        best = { point: projected.point, distanceSq: projected.distanceSq }
      }
    }
    return best && { point: best.point, distanceM: Math.sqrt(best.distanceSq) * this.metersPerUnit }
  }

  isNearWall(floorId: string, pos: Point2): boolean {
    const nearest = this.nearestWallPoint(floorId, pos)
    return nearest != null && nearest.distanceM <= this.settings.wallProximityM
  }
}

function polylineLength(points: readonly Point2[]): number {
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1]!, points[index]!)
  }
  return total
}

interface ManualTrace {
  /** Waypoints in travel order from `from` to `to`. */
  waypoints: Point2[]
  /** Moved riser position, for traces arriving from another floor. */
  riserPos?: Point2
}

/**
 * The manual plan wire trace drawn for this placement pair, if any. Traces live on the floor
 * where the cable arrives; a same-floor trace may be stored in either direction.
 */
function manualTraceFor(
  traces: readonly PlanWireRoute[],
  from: RouteLocation,
  to: RouteLocation
): ManualTrace | undefined {
  if (!from.placementId || !to.placementId) return undefined
  for (const trace of traces) {
    if (trace.source !== 'manual' || trace.hidden || trace.floorId !== to.floorId) continue
    const a = trace.from.placementId
    const b = trace.to.placementId
    if (a === from.placementId && b === to.placementId) {
      return { waypoints: trace.waypoints ?? [], riserPos: trace.riser?.pos }
    }
    if (from.floorId === to.floorId && a === to.placementId && b === from.placementId) {
      return { waypoints: [...(trace.waypoints ?? [])].reverse() }
    }
  }
  return undefined
}

/**
 * A floor passage is shared: every cable leaving `from` for `toFloorId` rises at the same spot,
 * wherever one of their traces moved it.
 */
function sharedRiserPos(
  traces: readonly PlanWireRoute[],
  from: RouteLocation,
  toFloorId: string
): Point2 | undefined {
  if (!from.placementId) return undefined
  for (const trace of traces) {
    if (trace.source !== 'manual' || trace.floorId !== toFloorId || !trace.riser?.pos) continue
    if (trace.from.placementId === from.placementId && trace.riser.fromFloorId === from.floorId) {
      return trace.riser.pos
    }
  }
  return undefined
}

interface RouteContext {
  settings: CableRouteSettings
  metersPerUnit: number
  floors: Map<string, FloorInfo>
  traces: readonly PlanWireRoute[]
}

/** Accumulates legs for one link, following the floor-first, walls-only-vertical rules. */
class RouteBuilder {
  readonly legs: CableRouteLeg[] = []
  horizontalLowM = 0
  horizontalHighM = 0
  verticalM = 0
  riserM = 0
  terminations = 0
  allDrawn = true

  constructor(private readonly context: RouteContext) {}

  private vertical(floorId: string, pos: Point2, fromHeightM: number, toHeightM: number) {
    const lengthM = Math.abs(toHeightM - fromHeightM)
    if (lengthM < 1e-6) return
    this.verticalM += lengthM
    this.legs.push({ kind: 'vertical', floorId, pos, fromHeightM, toHeightM, lengthM })
  }

  /**
   * A run is measured along its route (symbol, routing points, symbol), never along the curve
   * or elbows the plan draws: the drawing depends on the wire style and on neighbouring wires,
   * the route does not. The range covers how far real cable strays from that route.
   */
  private horizontal(floorId: string, points: Point2[], level: RouteLevel, drawn: boolean) {
    const units = polylineLength(points)
    if (units < 1e-6) return
    const { settings } = this.context
    const lowM = units * this.context.metersPerUnit
    const highM = lowM * (drawn ? settings.drawnDetourFactor : settings.horizontalDetourFactor)
    if (!drawn) this.allDrawn = false
    this.horizontalLowM += lowM
    this.horizontalHighM += highM
    this.legs.push({
      kind: 'horizontal',
      floorId,
      points,
      level,
      basis: drawn ? 'drawn-trace' : 'straight-estimate',
      lowM,
      highM,
    })
  }

  /** One link from device `a` to device `b`. */
  connect(a: RouteLocation, b: RouteLocation) {
    const { floors, traces } = this.context
    const floorA = floors.get(a.floorId)!
    const floorB = floors.get(b.floorId)!
    this.terminations += 2
    const trace = manualTraceFor(traces, a, b)
    const drawn = trace != null && trace.waypoints.length > 0
    const via = trace?.waypoints ?? []

    // Any link to or from a ceiling device on the same floor stays in the ceiling: a
    // wall-mounted end (switch, board) rises or drops in its own wall.
    if ((a.ceiling || b.ceiling) && a.floorId === b.floorId) {
      if (!a.ceiling) this.vertical(a.floorId, a.pos, a.heightM, floorA.heightM)
      this.horizontal(a.floorId, [a.pos, ...via, b.pos], 'ceiling', drawn)
      if (!b.ceiling) this.vertical(b.floorId, b.pos, floorB.heightM, b.heightM)
      return
    }

    // Another floor: rise (or drop) where the cable leaves, so everything leaving a board for
    // the same floor shares one riser. A moved riser is reached through the floor first. Then
    // spread out on the target floor: through its floor, or its ceiling for a ceiling device.
    if (a.floorId !== b.floorId) {
      const riserPos = trace?.riserPos ?? sharedRiserPos(traces, a, b.floorId) ?? a.pos
      const moved = distance(riserPos, a.pos) > 1e-6
      if (moved) {
        this.vertical(a.floorId, a.pos, a.heightM, 0)
        this.horizontal(a.floorId, [a.pos, riserPos], 'floor', true)
      }
      const startHeightM = moved ? 0 : a.heightM
      const levelB = b.ceiling ? floorB.heightM : 0
      const lengthM = Math.abs(floorB.elevationM + levelB - (floorA.elevationM + startHeightM))
      this.riserM += lengthM
      this.legs.push({
        kind: 'riser',
        pos: riserPos,
        fromFloorId: a.floorId,
        toFloorId: b.floorId,
        lengthM,
      })
      this.horizontal(b.floorId, [riserPos, ...via, b.pos], b.ceiling ? 'ceiling' : 'floor', drawn)
      if (!b.ceiling) this.vertical(b.floorId, b.pos, 0, b.heightM)
      return
    }

    // Two wall-mounted devices: down the wall, straight through the floor (unless a manual
    // trace says otherwise), up the wall.
    this.vertical(a.floorId, a.pos, a.heightM, 0)
    this.horizontal(a.floorId, [a.pos, ...via, b.pos], 'floor', drawn)
    this.vertical(b.floorId, b.pos, 0, b.heightM)
  }
}

/** Plan units per metre the editor draws with before any calibration. */
const EDITOR_PX_PER_METER = 100

/**
 * Extra cost, in metres, of each wire beyond a box's incoming and outgoing one. It only steers
 * the shape of a placement tree (chain unless a branch clearly saves cable), never a length.
 */
const BRANCH_PENALTY_M = 1.5

/** Same resolution as the editor's scale indicator: explicit value, else the ruler. */
function calibratedPxPerMeter(scale: Floor['scale'] | undefined): number | undefined {
  return resolvePlanPxPerMeter(scale) ?? undefined
}

function resolveFloors(project: ProjectV2, settings: CableRouteSettings) {
  const floors = new Map<string, FloorInfo>()
  const assumptions = new Set<CableRouteAssumption>()
  let hasImportedPlan = false
  let elevationM = 0
  for (const floor of selectProjectBuildingFloors(project)) {
    const heightMm = 'heightMm' in floor ? floor.heightMm : undefined
    const elevationMm = 'elevationMm' in floor ? floor.elevationMm : undefined
    if (
      ('planAssetId' in floor && floor.planAssetId) ||
      ('planAsset' in floor && floor.planAsset) ||
      ('planImportAsset' in floor && floor.planImportAsset)
    ) {
      hasImportedPlan = true
    }
    const heightM = heightMm && heightMm > 0 ? heightMm / 1000 : settings.floorHeightM
    if (!(heightMm && heightMm > 0)) assumptions.add('floor-height-default')
    if (elevationMm != null) elevationM = elevationMm / 1000
    else if (floors.size > 0) assumptions.add('floor-elevation-from-order')
    floors.set(floor.id, { elevationM, heightM })
    elevationM += heightM
  }
  return { floors, assumptions, hasImportedPlan }
}

const DEVICE_KINDS = new Set<CircuitKind>([
  'fixed_appliance',
  'stove',
  'solar',
  'battery',
  'hvac',
  'boiler',
  'heating',
  'ev',
])

/** The colour group of a circuit's wires. */
function categoryFor(circuit: Circuit): CableRouteCategory {
  const derived = getDerivedCircuitKind(circuit)
  // Symbol-less points derive nothing; the stored circuit kind still says what it feeds.
  const kind = derived === 'empty' || derived === 'other' ? (circuit.kind ?? derived) : derived
  if (kind === 'lighting') return 'lighting'
  if (kind === 'sockets') return 'sockets'
  if (kind === 'subpanel') return 'feeders'
  if (DEVICE_KINDS.has(kind)) return 'devices'
  return 'other'
}

/** Colour the cable reaching this device, rather than every cable by its final load. */
function segmentCategory(
  circuit: Circuit,
  edge: CircuitCableEdge,
  target: Pick<Endpoint | TrunkDevice, 'type' | 'symbol'>
): CableRouteCategory {
  if (edge.domain === 'DC') return 'dc'
  if (['junction_box', 'junction_panel', 'terminal_strip', 'dc_bus'].includes(target.symbol ?? ''))
    return 'other'
  if (target.symbol === 'panel_distribution') return 'feeders'
  if (target.type === 'earthing_separator') return 'earthing'
  if (target.type === 'protection' || target.type === 'changeover') return 'other'
  if (target.type === 'switch' || target.type === 'light_point') return 'lighting'
  if (target.type === 'socket') return 'sockets'
  if (
    [
      'fixed_appliance',
      'conversion',
      'storage',
      'generation',
      'domotica',
      'relay',
      'energy_meter',
    ].includes(target.type)
  )
    return 'devices'
  return categoryFor(circuit)
}

function routePoint(location: RouteLocation): CableRoutePoint {
  return { code: location.code, symbolId: location.symbolId, nodeType: location.nodeType }
}

interface ChainStop {
  endpoint: Endpoint
  edge: CircuitCableEdge
  locations: RouteLocation[]
  /** Hidden or not yet placed: positioned next to a neighbour before chaining. */
  offPlan?: boolean
  besideLabel?: string
}

export function estimateCableRoutes(
  project: ProjectV2,
  settings: CableRouteSettings = resolveCableRouteSettings(project),
  snapshot: ElectricalStructureSnapshot = buildElectricalStructureSnapshot(project)
): CableRouteEstimation {
  const { floors, assumptions, hasImportedPlan } = resolveFloors(project, settings)
  const calibrated = calibratedPxPerMeter(selectProjectPlanScale(project))
  // Plans drawn with the editor's own tools are at the editor scale; imported plans are not.
  if (!calibrated && hasImportedPlan) assumptions.add('plan-scale-assumed')
  const metersPerUnit = 1 / (calibrated ?? EDITOR_PX_PER_METER)

  const model = indexModel(getProjectElectricalPanels(project))
  const geometry = new PlanGeometry(project, metersPerUnit, settings)
  const context: RouteContext = {
    settings,
    metersPerUnit,
    floors,
    traces: selectProjectPlanWireRoutes(project),
  }

  // Hidden symbols and symbols still waiting at a default spot are not routing points.
  // The floors' own hidden lists are read directly: the plan helpers skip symbols they
  // consider ineligible for the plan, which would let those pull routes to stale positions.
  // Placements hidden because their device is shown as a module in a board: it is in the board.
  const inBoardPlacementIds = getSituationPlanPlacementIdsHiddenByPanel(project)
  const offPlanPlacementIds = new Set([
    ...readLegacyCompatibilityFloors(project).flatMap(
      (floor) => floor.hiddenSitplanPlacementIds ?? []
    ),
    ...inBoardPlacementIds,
    ...getAwaitingSituationPlanPlacements(project).map((placement) => placement.placementId),
  ])

  // A junction box drawn again on the one-wire sits where its first placed occurrence is.
  const junctions = collectSharedJunctions(project)
  const junctionOf = (entity: Endpoint | TrunkDevice) => {
    const key = sharedJunctionKey(entity)
    return key ? junctions.get(key) : undefined
  }
  const onPlan = (placement: Placement) =>
    floors.has(placement.floorId) && !offPlanPlacementIds.has(placement.id)

  /** A placed circuit device, with shared junction occurrences resolving to their owner. */
  const circuitDeviceLocation = (device: TrunkDevice): RouteLocation | undefined => {
    const junction = junctionOf(device)
    if (!junction && device.symbol !== 'junction_box') return supplyDeviceLocation(device)
    const placement = (junction?.placements ?? device.placements ?? []).find(onPlan)
    if (!placement) return undefined
    const owner = junction?.symbol === 'junction_box' ? junction.owner : undefined
    const ownerId = owner?.entity.id ?? device.id
    const panel = junction?.symbol === 'junction_panel'
    const identity = (device.junctionIdentity ?? device.label ?? '').trim()
    return {
      floorId: placement.floorId,
      pos: placement.pos,
      // A junction panel hangs like a board; a junction box sits in the ceiling.
      heightM: panel ? settings.panelHeightM : floors.get(placement.floorId)!.heightM,
      ceiling: !panel,
      placementId: placement.id,
      endpointId: ownerId,
      ...(owner?.kind === 'endpoint' ? {} : { trunkDeviceId: ownerId }),
      nodeType: device.type,
      symbolId: device.symbol,
      code: identity,
      label: identity || device.symbol,
    }
  }

  const endpointLocations = (endpoint: Endpoint): RouteLocation[] => {
    // A repeated junction box routes to the placements of the occurrence that holds them.
    const owner = junctionOf(endpoint)?.owner
    const holder = owner && owner.entity.id !== endpoint.id ? owner : undefined
    const placements = holder ? (holder.entity.placements ?? []) : endpoint.placements
    return placements.filter(onPlan).map((placement) => {
      const ceilingHeightM = floors.get(placement.floorId)!.heightM
      const ceiling =
        isCeilingSymbol(endpoint) ||
        (endpoint.type === 'light_point' && !geometry.isNearWall(placement.floorId, placement.pos))
      const heightM = ceiling ? ceilingHeightM : wallMountedHeightM(endpoint)
      return {
        floorId: placement.floorId,
        pos: placement.pos,
        heightM,
        ceiling,
        placementId: placement.id,
        label: `${endpoint.label} (${endpoint.symbol ?? endpoint.type})`,
        nodeType: endpoint.type,
        symbolId: endpoint.symbol,
        code: endpoint.label,
        endpointId: holder?.entity.id ?? endpoint.id,
        ...(holder?.kind === 'trunkDevice' ? { trunkDeviceId: holder.entity.id } : {}),
      }
    })
  }

  const wallMountedHeightM = (endpoint: Endpoint): number => {
    if (endpoint.symbol === 'panel_distribution') return settings.panelHeightM
    switch (endpoint.type) {
      case 'socket':
        return settings.socketHeightM
      case 'switch':
        return settings.switchHeightM
      case 'light_point':
        return settings.wallLightHeightM
      case 'domotica':
        return settings.domoticaHeightM
      default:
        return settings.applianceHeightM
    }
  }

  const boardLocationForPanel = (panel: Panel | undefined): RouteLocation | undefined => {
    const placement = panel ? model.panelLocationByPanelId.get(panel.id) : undefined
    if (!panel || !placement || !floors.has(placement.floorId)) return undefined
    return {
      floorId: placement.floorId,
      pos: placement.pos,
      heightM: settings.panelHeightM,
      ceiling: false,
      nodeType: 'panel',
      symbolId: 'panel_distribution',
      code: panel.name,
      endpointId: model.panelEndpointIdByPanelId.get(panel.id),
      placementId: placement.id,
      label: panel.name,
    }
  }

  const boardLocation = (circuitId: string) =>
    boardLocationForPanel(model.panelByCircuitId.get(circuitId))

  /** Plan distance plus any riser; only used to pick the nearest feed point. */
  const linkCostM = (from: RouteLocation, to: RouteLocation): number => {
    const riser =
      from.floorId === to.floorId
        ? 0
        : Math.abs(floors.get(to.floorId)!.elevationM - floors.get(from.floorId)!.elevationM)
    return distance(from.pos, to.pos) * metersPerUnit + riser
  }

  const routes: CableRouteEstimate[] = []
  for (const [circuitId, edges] of collectCircuitCableEdges(snapshot)) {
    const circuit = model.circuitById.get(circuitId)
    // The PANEL circuit only carries a board's plan symbol; it is not a cable run.
    if (!circuit || circuit.code === 'PANEL') continue
    routes.push(...estimateCircuit(circuit, edges))
  }
  routes.push(...estimateBoardFeeders())
  routes.push(...estimateSupplyCables())
  routes.push(...estimateEarthingCables())
  const uncalibratedFloors = new Set(
    selectProjectBuildingFloors(project)
      .filter(
        (floor) =>
          floor.planScaleNeedsCalibration === true ||
          (!calibrated &&
            (('planAssetId' in floor && !!floor.planAssetId) ||
              ('planAsset' in floor && !!floor.planAsset) ||
              ('planImportAsset' in floor && !!floor.planImportAsset)))
      )
      .map((floor) => floor.id)
  )
  if (uncalibratedFloors.size) assumptions.add('plan-scale-assumed')
  const wireRuns = selectProjectWireRuns(project)
  for (const route of routes) {
    const touched = [
      route.from?.floorId,
      route.to?.floorId,
      ...route.legs.flatMap((leg) =>
        leg.kind === 'riser' ? [leg.fromFloorId, leg.toFloorId] : [leg.floorId]
      ),
    ]
    route.scaleCalibrated = !touched.some((id) => id && uncalibratedFloors.has(id))
    route.estimateNeedsReview = [route.anchor, ...(route.aliasAnchors ?? [])].some(
      (anchor) =>
        findWireRunForAnchor(wireRuns, anchor)?.segmentLengthSources?.[anchor] === 'estimated-stale'
    )
  }
  return { routes, assumptions: [...assumptions] }

  /** A finished link between two known locations, measured like any other cable. */
  function measuredLink(
    source: RouteLocation,
    target: RouteLocation
  ): Pick<
    CableRouteEstimate,
    | 'legs'
    | 'horizontalLowM'
    | 'horizontalHighM'
    | 'verticalM'
    | 'riserM'
    | 'slackM'
    | 'lowM'
    | 'highM'
    | 'basis'
  > {
    const builder = new RouteBuilder(context)
    builder.connect(source, target)
    const slackM = builder.terminations * settings.terminationSlackM
    const fixedM = builder.verticalM + builder.riserM + slackM
    return {
      legs: builder.legs,
      horizontalLowM: builder.horizontalLowM,
      horizontalHighM: builder.horizontalHighM,
      verticalM: builder.verticalM,
      riserM: builder.riserM,
      slackM,
      lowM: builder.horizontalLowM + fixedM,
      highM: builder.horizontalHighM + fixedM,
      basis:
        builder.allDrawn && builder.legs.some((leg) => leg.kind === 'horizontal')
          ? 'drawn-trace'
          : 'straight-estimate',
    }
  }

  function storedWire(properties: Record<string, unknown> | undefined) {
    const wire = properties?.wire as
      | { cable?: CableSpec; lengthM?: number; lengthEstimated?: boolean }
      | undefined
    return {
      cable: wire?.cable,
      enteredLengthM:
        typeof wire?.lengthM === 'number' && wire.lengthM > 0 ? wire.lengthM : undefined,
      ...(wire?.lengthEstimated ? { enteredLengthEstimated: true } : {}),
    }
  }

  /** Where a supply enclosure (virtual panel) hangs on the plan; undefined when hidden or unplaced. */
  function enclosureLocation(enclosureId: string): RouteLocation | undefined {
    const enclosure = selectProjectAuxiliaryElectricalEnclosures(project).find(
      (candidate) => candidate.id === enclosureId
    )
    const placement = enclosure?.placements?.find(onPlan)
    if (!enclosure || !placement) return undefined
    return {
      floorId: placement.floorId,
      pos: placement.pos,
      heightM: settings.panelHeightM,
      ceiling: false,
      placementId: placement.id,
      endpointId: enclosure.id,
      enclosureId: enclosure.id,
      nodeType: 'auxiliary_enclosure',
      symbolId: 'panel_distribution',
      code: enclosure.name,
      label: enclosure.name,
    }
  }

  /** A supply device with its own symbol on the plan (inverter, solar panels, battery, ...). */
  function supplyDeviceLocation(device: TrunkDevice): RouteLocation | undefined {
    const placement = device.placements?.find(onPlan)
    if (!placement) return undefined
    // Solar panels lie on the roof, above this floor's ceiling; batteries stand low.
    const roof = device.symbol === 'solar_panel'
    const heightM = roof
      ? floors.get(placement.floorId)!.heightM
      : device.symbol === 'battery'
        ? settings.applianceHeightM
        : settings.panelHeightM
    const code = (device.label ?? '').trim()
    return {
      floorId: placement.floorId,
      pos: placement.pos,
      heightM,
      ceiling: roof,
      placementId: placement.id,
      endpointId: device.id,
      trunkDeviceId: device.id,
      nodeType: device.type,
      symbolId: device.symbol,
      code,
      label: code || device.symbol,
    }
  }

  /**
   * Cables of the supply assemblies: from the board where the supply side leaves it to an
   * inverter, and on to its solar panels and batteries (DC). A node sits at its own plan symbol,
   * else in its enclosure (a board, or a supply enclosure placed on the plan); the grid and the
   * handoffs sit at their board. Nodes without a place sit next to the node feeding them, so a
   * device inside a board adds no cable of its own. Nodes in a hidden or unplaced supply
   * enclosure are left out, with the cables ending at them.
   */
  function estimateSupplyCables(): CableRouteEstimate[] {
    const assemblies = selectProjectSupplyAssemblies(project)
    if (assemblies.length === 0) return []
    const deviceById = new Map(
      getAllSupplyTrunkDevices(project).map((device) => [device.id, device])
    )
    const mainPanel = findMainPanel(getProjectElectricalPanels(project))
    const panelNameById = (panelId: string | undefined) =>
      panelId ? model.panelById.get(panelId)?.name : undefined

    // Snapshot relationships carry each connection's wire anchor and stored cable.
    const entityIdBySnapshotNode = new Map(
      snapshot.nodes.map((node) => [node.id, node.source.entityId])
    )
    const relationshipByConnection = new Map<string, (typeof snapshot.relationships)[number]>()
    for (const relationship of snapshot.relationships) {
      if (relationship.kind !== 'supply-assembly-connection') continue
      const fromEntity = entityIdBySnapshotNode.get(relationship.from)
      if (fromEntity && relationship.source.relationshipId) {
        relationshipByConnection.set(
          `${fromEntity}|${relationship.source.relationshipId}`,
          relationship
        )
      }
    }

    const results: CableRouteEstimate[] = []
    for (const assembly of assemblies) {
      const attachmentPanelId =
        resolveAssemblyPanelInput(project, assembly.incomingAttachment)?.panelId ??
        (assembly.incomingAttachment.kind === 'circuit-input'
          ? assembly.incomingAttachment.panelId
          : mainPanel?.id)
      const handoffPanelId = new Map(
        assembly.loadHandoffs.map((handoff) => [
          handoff.handoffNodeId,
          resolveAssemblyPanelInput(project, handoff.target)?.panelId ??
            (handoff.target.kind === 'circuit-input' ? handoff.target.panelId : undefined),
        ])
      )
      const supplyNodeLocation = (node: SupplyNode): RouteLocation | 'blocked' | undefined => {
        const device = deviceById.get(node.deviceId ?? node.id)
        const placed = device ? supplyDeviceLocation(device) : undefined
        if (placed) return placed
        const enclosure = node.mounting?.enclosure ?? device?.panelMounting
        if (enclosure?.kind === 'panel') {
          return boardLocationForPanel(model.panelById.get(enclosure.panelId))
        }
        if (enclosure?.kind === 'auxiliary') {
          return enclosureLocation(enclosure.enclosureId) ?? 'blocked'
        }
        if (node.kind === 'utility-source') {
          return boardLocationForPanel(
            attachmentPanelId ? model.panelById.get(attachmentPanelId) : undefined
          )
        }
        if (node.kind === 'panel-handoff') {
          const panelId = handoffPanelId.get(node.id)
          return boardLocationForPanel(panelId ? model.panelById.get(panelId) : undefined)
        }
        return undefined
      }
      const blocked = new Set<string>()
      const own = new Map<string, RouteLocation>()
      for (const node of assembly.nodes) {
        const location = supplyNodeLocation(node)
        if (location === 'blocked') blocked.add(node.id)
        else if (location) own.set(node.id, location)
      }

      // Orient the graph from where the supply enters: the grid and the handoffs at their board.
      const neighbours = new Map<string, string[]>()
      for (const connection of assembly.connections) {
        const [a, b] = connection.endpoints.map((endpoint) => endpoint.nodeId)
        neighbours.set(a!, [...(neighbours.get(a!) ?? []), b!])
        neighbours.set(b!, [...(neighbours.get(b!) ?? []), a!])
      }
      const depth = new Map<string, number>()
      const resolved = new Map<string, RouteLocation | undefined>()
      const queue: string[] = []
      const visit = (nodeId: string, parent?: string) => {
        depth.set(nodeId, parent === undefined ? 0 : depth.get(parent)! + 1)
        resolved.set(
          nodeId,
          blocked.has(nodeId)
            ? undefined
            : (own.get(nodeId) ?? (parent !== undefined ? resolved.get(parent) : undefined))
        )
        queue.push(nodeId)
      }
      const roots = assembly.nodes.filter(
        (node) => node.kind === 'utility-source' || node.kind === 'panel-handoff'
      )
      for (const node of [...roots, ...assembly.nodes]) {
        if (depth.has(node.id)) continue
        visit(node.id)
        while (queue.length > 0) {
          const current = queue.shift()!
          for (const next of neighbours.get(current) ?? []) {
            if (!depth.has(next)) visit(next, current)
          }
        }
      }

      const inverter = assembly.nodes.find((node) => node.kind === 'inverter-unit')
      const inverterLabel = (
        deviceById.get(inverter?.deviceId ?? inverter?.id ?? '')?.label ??
        inverter?.label ??
        ''
      ).trim()
      let order = 0
      for (const connection of assembly.connections) {
        const [first, second] = connection.endpoints.map((endpoint) => endpoint.nodeId) as [
          string,
          string,
        ]
        const [fromId, toId] =
          (depth.get(first) ?? 0) <= (depth.get(second) ?? 0) ? [first, second] : [second, first]
        if (blocked.has(fromId) || blocked.has(toId)) continue
        const source = resolved.get(fromId)
        const target = resolved.get(toId)
        if (!source || !target) continue
        // Both ends in the same board or at the same symbol: wiring inside, not a cable.
        const samePlace =
          (source.placementId != null && source.placementId === target.placementId) ||
          (source.floorId === target.floorId && distance(source.pos, target.pos) < 1e-6)
        if (samePlace) continue
        const relationship = relationshipByConnection.get(
          `${assembly.id}:${connection.endpoints[0].nodeId}|${connection.id}`
        )
        const anchor = relationship?.properties?.wireAnchor
        if (typeof anchor !== 'string') continue
        const link = measuredLink(source, target)
        order += 1
        results.push({
          anchor,
          circuitId: `supply:${assembly.id}`,
          circuitCode: inverterLabel,
          boardName: panelNameById(attachmentPanelId),
          ...storedWire(relationship?.properties),
          order,
          role: 'supply',
          category:
            connection.domain === 'DC' ? 'dc' : connection.domain === 'PE' ? 'earthing' : 'supply',
          fromNodeId: relationship!.from,
          toNodeId: relationship!.to,
          fromLabel: source.label,
          toLabel: target.label,
          fromPoint: routePoint(source),
          toPoint: routePoint(target),
          from: source,
          to: target,
          ...link,
          fromBoardLowM: link.lowM,
          fromBoardHighM: link.highM,
          gaps: [],
        })
      }
    }
    return results
  }

  /**
   * The earthing conductor from each grounded main board to the nearest earth electrode symbol
   * (same floor first). Earthing separators on the way sit in or next to the board.
   */
  function estimateEarthingCables(): CableRouteEstimate[] {
    const installation = getProjectElectricalInstallation(project)
    const electrodes: RouteLocation[] = (installation?.earthingPlacements ?? [])
      .filter(
        (placement) => floors.has(placement.floorId) && !offPlanPlacementIds.has(placement.id)
      )
      .map((placement) => ({
        floorId: placement.floorId,
        pos: placement.pos,
        heightM: 0,
        ceiling: false,
        placementId: placement.id,
        endpointId: placement.id,
        nodeType: 'earthing',
        symbolId: 'earthing',
        code: '',
        label: 'earthing',
      }))
    if (electrodes.length === 0) return []
    const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]))
    const results: CableRouteEstimate[] = []
    for (const relationship of snapshot.relationships) {
      if (relationship.kind !== 'grounds') continue
      const anchor = relationship.properties?.wireAnchor
      const target = nodeById.get(relationship.to)
      if (typeof anchor !== 'string' || target?.kind !== 'panel') continue
      const panel = target.source.entityId ? model.panelById.get(target.source.entityId) : undefined
      const board = boardLocationForPanel(panel)
      if (!panel || !board) continue
      const sameFloor = electrodes.filter((electrode) => electrode.floorId === board.floorId)
      const electrode = (sameFloor.length > 0 ? sameFloor : electrodes).reduce((best, candidate) =>
        linkCostM(board, candidate) < linkCostM(board, best) ? candidate : best
      )
      const link = measuredLink(board, electrode)
      results.push({
        anchor,
        circuitId: `earthing:${panel.id}`,
        circuitCode: '',
        boardName: panel.name,
        ...storedWire(relationship.properties),
        order: 1,
        role: 'earthing',
        category: 'earthing',
        fromNodeId: relationship.to,
        toNodeId: relationship.from,
        fromLabel: board.label,
        toLabel: electrode.label,
        fromPoint: routePoint(board),
        toPoint: routePoint(electrode),
        from: board,
        to: electrode,
        ...link,
        fromBoardLowM: link.lowM,
        fromBoardHighM: link.highM,
        gaps: [],
      })
    }
    return results
  }

  /** Cables from a protection on one board to another board (`panel-feed` edges). */
  function estimateBoardFeeders(): CableRouteEstimate[] {
    const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]))
    const feeders: CableRouteEstimate[] = []
    for (const relationship of snapshot.relationships) {
      if (relationship.kind !== 'panel-feed') continue
      const anchor = relationship.properties?.wireAnchor
      const from = nodeById.get(relationship.from)
      const to = nodeById.get(relationship.to)
      if (typeof anchor !== 'string' || from?.kind !== 'protection' || !to) continue
      const parent = from.panelId ? model.panelById.get(from.panelId) : undefined
      const childId = to.kind === 'panel' ? to.source.entityId : to.panelId
      const child = childId ? model.panelById.get(childId) : undefined
      if (!parent || !child || parent.id === child.id) continue

      const source = boardLocationForPanel(parent)
      const target = boardLocationForPanel(child)
      const builder = new RouteBuilder(context)
      const gaps: CableRouteGap[] = []
      if (!source) gaps.push({ code: 'unplaced-panel', nodeId: relationship.from, at: target })
      if (!target) gaps.push({ code: 'unplaced-panel', nodeId: relationship.to, at: source })
      if (source && target) builder.connect(source, target)
      const complete = gaps.length === 0
      const slackM = builder.terminations * settings.terminationSlackM
      const fixedM = builder.verticalM + builder.riserM + slackM
      const lowM = complete ? builder.horizontalLowM + fixedM : 0
      const highM = complete ? builder.horizontalHighM + fixedM : 0
      const wire = relationship.properties?.wire as { lengthM?: number } | undefined
      // The wire on the source board that leads into this cable is the same physical run.
      const aliasAnchors = snapshot.relationships.flatMap((edge) =>
        edge.kind === 'ordered-before' &&
        edge.from === relationship.from &&
        typeof edge.properties?.wireAnchor === 'string' &&
        edge.properties.wireAnchor !== anchor
          ? [edge.properties.wireAnchor]
          : []
      )
      feeders.push({
        anchor,
        ...(aliasAnchors.length > 0 ? { aliasAnchors } : {}),
        circuitId: relationship.from,
        circuitCode: from.label || child.name,
        boardName: parent.name,
        role: 'board-feeder',
        category: 'feeders',
        cable: (relationship.properties?.wire as { cable?: CableSpec } | undefined)?.cable,
        order: 1,
        fromNodeId: relationship.from,
        toNodeId: relationship.to,
        fromLabel: parent.name,
        toLabel: child.name,
        fromPoint: { code: parent.name, symbolId: 'panel_distribution', nodeType: 'panel' },
        toPoint: { code: child.name, symbolId: 'panel_distribution', nodeType: 'panel' },
        from: source,
        to: target,
        legs: builder.legs,
        horizontalLowM: builder.horizontalLowM,
        horizontalHighM: builder.horizontalHighM,
        verticalM: builder.verticalM,
        riserM: builder.riserM,
        slackM,
        lowM,
        highM,
        fromBoardLowM: lowM,
        fromBoardHighM: highM,
        basis: 'straight-estimate',
        gaps,
        enteredLengthM:
          typeof wire?.lengthM === 'number' && wire.lengthM > 0 ? wire.lengthM : undefined,
        ...((wire as { lengthEstimated?: boolean } | undefined)?.lengthEstimated
          ? { enteredLengthEstimated: true }
          : {}),
      })
    }
    return feeders
  }

  /**
   * Placed devices on the circuit feed, following their actual electrical predecessors.
   * Unplaced devices are passed over; converter outputs remain separate feed paths.
   */
  function feedDeviceRoutes(
    circuit: Circuit,
    edges: CircuitCableEdge[],
    board: RouteLocation | undefined
  ): CableRouteEstimate[] {
    const edgeByDeviceId = new Map(
      edges
        .filter((edge) => edge.toNodeId.startsWith('trunk-device:'))
        .map((edge) => [edge.toNodeId.slice('trunk-device:'.length), edge] as const)
    )
    const devices = [
      ...(circuit.trunkDevices ?? []),
      ...(circuit.branches ?? []).flatMap((branch) => branch.branchDevices ?? []),
    ].sort((a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0))
    const routes: CableRouteEstimate[] = []
    const deviceById = new Map(devices.map((device) => [device.id, device]))
    const incoming = new Map(edges.map((edge) => [edge.toNodeId, edge]))
    const reached = new Map<string, CableRouteEstimate>()
    const visiting = new Set<string>()
    const visit = (device: TrunkDevice): CableRouteEstimate | undefined => {
      const cached = reached.get(`trunk-device:${device.id}`)
      if (cached) return cached
      if (visiting.has(device.id)) return undefined
      visiting.add(device.id)
      const edge = edgeByDeviceId.get(device.id)
      const location = edge ? circuitDeviceLocation(device) : undefined
      if (!edge || !location) {
        visiting.delete(device.id)
        return undefined
      }
      let source = edge.fromNodeId
      let upstream: CableRouteEstimate | undefined
      const seen = new Set<string>()
      while (source.startsWith('trunk-device:') && !seen.has(source)) {
        seen.add(source)
        const parent = deviceById.get(source.slice('trunk-device:'.length))
        upstream = parent ? visit(parent) : undefined
        if (upstream) break
        source = incoming.get(source)?.fromNodeId ?? ''
      }
      const sourceEndpoint = source.startsWith('endpoint:')
        ? model.endpointById.get(source.slice('endpoint:'.length))
        : undefined
      const sourceInBoard =
        sourceEndpoint &&
        symbolCanAppearInPanelGrid(sourceEndpoint.symbol) &&
        (sourceEndpoint.placements.length === 0 ||
          sourceEndpoint.placements.every((placement) => inBoardPlacementIds.has(placement.id)))
      const previous =
        upstream?.to ??
        (sourceEndpoint
          ? (endpointLocations(sourceEndpoint).at(-1) ?? (sourceInBoard ? board : undefined))
          : board)
      const builder = new RouteBuilder(context)
      const gaps: CableRouteGap[] = []
      if (previous) builder.connect(previous, location)
      else gaps.push({ code: 'unplaced-panel', nodeId: edge.fromNodeId, at: location })
      const slackM = builder.terminations * settings.terminationSlackM
      const fixedM = builder.verticalM + builder.riserM + slackM
      const lowM = previous ? builder.horizontalLowM + fixedM : 0
      const highM = previous ? builder.horizontalHighM + fixedM : 0
      const fromBoard = {
        lowM: (upstream?.fromBoardLowM ?? 0) + lowM,
        highM: (upstream?.fromBoardHighM ?? 0) + highM,
      }
      const route: CableRouteEstimate = {
        anchor: edge.anchor,
        circuitId: circuit.id,
        circuitCode: circuit.code,
        boardName: model.panelByCircuitId.get(circuit.id)?.name,
        cable: edge.cable,
        order: routes.length + 1,
        role: upstream || sourceEndpoint ? 'wire' : 'home-run',
        category: segmentCategory(circuit, edge, device),
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        fromLabel: previous?.label ?? '?',
        toLabel: location.label,
        ...(previous ? { fromPoint: routePoint(previous) } : {}),
        toPoint: routePoint(location),
        from: previous,
        to: location,
        legs: builder.legs,
        horizontalLowM: builder.horizontalLowM,
        horizontalHighM: builder.horizontalHighM,
        verticalM: builder.verticalM,
        riserM: builder.riserM,
        slackM,
        lowM,
        highM,
        fromBoardLowM: fromBoard.lowM,
        fromBoardHighM: fromBoard.highM,
        basis:
          builder.allDrawn && builder.legs.some((leg) => leg.kind === 'horizontal')
            ? 'drawn-trace'
            : 'straight-estimate',
        gaps,
        enteredLengthM: edge.lengthM,
        ...(edge.lengthEstimated ? { enteredLengthEstimated: true } : {}),
      }
      routes.push(route)
      reached.set(edge.toNodeId, route)
      visiting.delete(device.id)
      return route
    }
    devices.forEach(visit)
    return routes
  }

  /** Target placement → source placement of wires the user drew for this circuit. */
  function drawnFeeders(circuitId: string): Map<string, string> {
    const feeders = new Map<string, string>()
    for (const trace of context.traces) {
      if (trace.source !== 'manual' || trace.hidden || trace.circuitId !== circuitId) continue
      if (trace.from.placementId && trace.to.placementId) {
        feeders.set(trace.to.placementId, trace.from.placementId)
      }
    }
    return feeders
  }

  /**
   * An appliance after a socket in the one-wire (a washing machine on its socket) is plugged
   * in: its cord is not part of the installation, so it is neither a cable nor a routing point.
   */
  function isPluggedIn(endpoint: Endpoint, edge: CircuitCableEdge, circuit: Circuit): boolean {
    if (endpoint.type !== 'fixed_appliance') return false
    const isSocket = (id: string | undefined) =>
      id != null && model.endpointById.get(id)?.type === 'socket'
    if (edge.fromNodeId.startsWith('endpoint:')) {
      if (isSocket(edge.fromNodeId.slice('endpoint:'.length))) return true
    }
    // Drawn as the next point after a socket in its branch.
    return (circuit.branches ?? []).some((branch) => {
      const index = branch.endpointIds.indexOf(endpoint.id)
      return index > 0 && isSocket(branch.endpointIds[index - 1])
    })
  }

  function estimateCircuit(circuit: Circuit, edges: CircuitCableEdge[]): CableRouteEstimate[] {
    // Every point is reached by exactly one one-wire edge; points off the plan cannot be chained.
    const edgeByEndpointId = new Map<string, CircuitCableEdge>()
    for (const edge of edges) {
      if (!edge.toNodeId.startsWith('endpoint:')) continue
      const endpointId = edge.toNodeId.slice('endpoint:'.length)
      const endpoint = model.endpointById.get(endpointId)
      if (!endpoint || isPluggedIn(endpoint, edge, circuit)) continue
      edgeByEndpointId.set(endpointId, edge)
    }

    const results: CableRouteEstimate[] = []
    const stopFor = (endpoint: Endpoint): ChainStop | undefined => {
      const edge = edgeByEndpointId.get(endpoint.id)
      if (!edge) return undefined
      const locations = endpointLocations(endpoint)
      if (locations.length > 0) return { endpoint, edge, locations }
      const inBoard =
        endpoint.placements.length > 0 &&
        endpoint.placements.every((placement) => inBoardPlacementIds.has(placement.id))
      if (endpoint.placements.length > 0 && !inBoard) {
        return { endpoint, edge, locations: [], offPlan: true }
      }
      // A relay, timer, or contactor in the board: its cable starts and ends inside the board.
      const board = symbolCanAppearInPanelGrid(endpoint.symbol)
        ? boardLocation(circuit.id)
        : undefined
      if (board) {
        return {
          endpoint,
          edge,
          locations: [
            {
              ...board,
              inBoard: true,
              label: `${endpoint.label} (${endpoint.symbol ?? endpoint.type})`,
              code: endpoint.label,
              nodeType: endpoint.type,
              symbolId: endpoint.symbol,
            },
          ],
        }
      }
      results.push(unplacedEstimate(circuit, edge, endpoint))
      return undefined
    }

    const visibleLocationOfNode = (nodeId: string): RouteLocation | undefined => {
      if (nodeId.startsWith('trunk-device:')) {
        const id = nodeId.slice('trunk-device:'.length)
        const device = [
          ...(circuit.trunkDevices ?? []),
          ...(circuit.branches ?? []).flatMap((branch) => branch.branchDevices ?? []),
        ].find((candidate) => candidate.id === id)
        return device ? circuitDeviceLocation(device) : undefined
      }
      if (!nodeId.startsWith('endpoint:')) return undefined
      const endpoint = model.endpointById.get(nodeId.slice('endpoint:'.length))
      return endpoint ? endpointLocations(endpoint).at(-1) : undefined
    }

    /**
     * Off-plan points sit next to the following point in their branch, else the previous one;
     * a lone off-plan point sits next to its one-wire source or the board.
     */
    const positionOffPlanStops = (stops: ChainStop[]): ChainStop[] =>
      stops.filter((stop, index) => {
        if (!stop.offPlan) return true
        const neighbour =
          stops.slice(index + 1).find((candidate) => !candidate.offPlan)?.locations[0] ??
          [...stops.slice(0, index)]
            .reverse()
            .find((candidate) => !candidate.offPlan)
            ?.locations.at(-1) ??
          visibleLocationOfNode(stop.edge.fromNodeId) ??
          boardLocation(circuit.id)
        if (!neighbour) {
          results.push(unplacedEstimate(circuit, stop.edge, stop.endpoint))
          return false
        }
        stop.locations = [
          {
            ...neighbour,
            placementId: undefined,
            label: `${stop.endpoint.label} (${stop.endpoint.symbol ?? stop.endpoint.type})`,
            code: stop.endpoint.label,
            endpointId: stop.endpoint.id,
            symbolId: stop.endpoint.symbol,
            nodeType: stop.endpoint.type,
          },
        ]
        stop.besideLabel = neighbour.label
        return true
      })

    const board = boardLocation(circuit.id)
    const deviceRoutes = feedDeviceRoutes(circuit, edges, board)
    results.push(...deviceRoutes)
    const deviceRouteByNode = new Map(
      deviceRoutes.map((route, index) => [route.toNodeId, { route, link: -index - 2 }])
    )
    // Points whose cable starts at the circuit itself hang off the last placed device on the
    // circuit trunk (board -> junction box -> points), as on the one-wire.
    const trunkDeviceIds = new Set((circuit.trunkDevices ?? []).map((device) => device.id))
    const trunkTailIndex = deviceRoutes.reduce(
      (tail, route, index) =>
        trunkDeviceIds.has(route.toNodeId.slice('trunk-device:'.length)) ? index : tail,
      -1
    )
    const deviceNodeByLink = new Map(
      deviceRoutes.map((route, index) => [-index - 2, route.toNodeId])
    )
    const incoming = new Map(edges.map((edge) => [edge.toNodeId, edge]))
    const controllerRoots = new Map<number, string>()
    const rootFor = (stop: ChainStop) => {
      let edge: CircuitCableEdge | undefined = stop.edge
      const visited = new Set<string>()
      const connection = edge.converterDcConnection
      const port = connection ? `:${connection.converterId}:${connection.connectionIndex}` : ''
      while (edge && !visited.has(edge.fromNodeId)) {
        visited.add(edge.fromNodeId)
        if (edge.outputKey && edge.fromNodeId.startsWith('endpoint:')) {
          const parentId = edge.fromNodeId.slice('endpoint:'.length)
          const parent = model.endpointById.get(parentId)
          const location = parent ? endpointLocations(parent).at(-1) : undefined
          const inBoard =
            parent &&
            symbolCanAppearInPanelGrid(parent.symbol) &&
            (parent.placements.length === 0 ||
              parent.placements.every((placement) => inBoardPlacementIds.has(placement.id)))
          if (location || (inBoard && board)) {
            const link =
              -deviceRoutes.length -
              circuit.endpoints.findIndex((endpoint) => endpoint.id === parentId) -
              2
            controllerRoots.set(link, parentId)
            return { location: location ?? board, link, group: `${parentId}:${edge.outputKey}` }
          }
        }
        const device = deviceRouteByNode.get(edge.fromNodeId)
        if (device)
          return { location: device.route.to, link: device.link, group: `${device.link}${port}` }
        edge = incoming.get(edge.fromNodeId)
      }
      const tail = trunkTailIndex >= 0 ? deviceRoutes[trunkTailIndex] : undefined
      if (tail?.to && !port)
        return { location: tail.to, link: -trunkTailIndex - 2, group: `${-trunkTailIndex - 2}` }
      return { location: board, link: -1, group: `board${port}` }
    }

    // Units: an ordered lighting branch, or a single free point. Different converter ports
    // and branch taps cannot be chained together just because they are close on the plan.
    const units: ChainStop[][] = []
    const seen = new Set<string>()
    const sequences = circuit.branches?.length
      ? circuit.branches.map((branch) => branch.endpointIds)
      : [circuit.endpoints.map((endpoint) => endpoint.id)]
    for (const endpointIds of [...sequences, circuit.endpoints.map((endpoint) => endpoint.id)]) {
      const endpoints = endpointIds
        .filter((id) => !seen.has(id) && edgeByEndpointId.has(id))
        .map((id) => model.endpointById.get(id)!)
      endpoints.forEach((endpoint) => seen.add(endpoint.id))
      const stops = positionOffPlanStops(
        endpoints.map(stopFor).filter((stop): stop is ChainStop => stop != null)
      )
      if (stops.length === 0) continue
      if (endpoints.some(isLightingSide)) {
        for (const stop of stops) {
          const previous = units.at(-1)
          if (
            previous &&
            rootFor(previous[0]!).group === rootFor(stop).group &&
            stops.includes(previous[0]!)
          )
            previous.push(stop)
          else units.push([stop])
        }
      } else units.push(...stops.map((stop) => [stop]))
    }

    // Pass 1, the feed tree. Live points a new unit may be fed from: the board, every free point,
    // and the first point of each lighting branch. Lights (and later switches) carry switched
    // wires and feed nothing. `feeder` is the index of the feeding link, or -1 for the board.
    //
    // Wires drawn on the plan decide the physical chain: a drawn wire into a unit's first point
    // makes its start that unit's feeder, as soon as that start is reached. Other units are
    // attached nearest-first, with the same branch penalty as a placement tree at every live
    // point but the root, which takes any number of cables.
    interface Link {
      stop: ChainStop
      feeder?: number
      from?: RouteLocation
      role: CableRouteRole
    }
    type Reached = { location: RouteLocation; link: number; group: string }
    const live: Reached[] = []
    const reachedByPlacement = new Map<string, Reached>()
    const wiresAtLive = new Map<Reached, number>()
    for (const unit of units) {
      const root = rootFor(unit[0]!)
      if (!root.location || live.some((point) => point.group === root.group)) continue
      const point = { ...root, location: root.location }
      live.push(point)
      wiresAtLive.set(point, 1)
      if (point.location.placementId)
        reachedByPlacement.set(`${point.group}:${point.location.placementId}`, point)
    }
    const drawnFeederOf = drawnFeeders(circuit.id)
    const links: Link[] = []
    const pending = [...units]
    while (pending.length > 0) {
      let unitIndex = 0
      let feeder: Reached | undefined
      let best = Infinity
      pending.forEach((unit, candidate) => {
        const entry = unit[0]!.locations[0]!
        const group = rootFor(unit[0]!).group
        const drawn = entry.placementId ? drawnFeederOf.get(entry.placementId) : undefined
        const drawnFeeder = drawn ? reachedByPlacement.get(`${group}:${drawn}`) : undefined
        if (drawnFeeder && best > -Infinity) {
          best = -Infinity
          unitIndex = candidate
          feeder = drawnFeeder
          return
        }
        for (const point of live) {
          if (point.group !== group) continue
          const wires = wiresAtLive.get(point)
          const penaltyM = wires == null ? 0 : Math.max(0, wires - 1) * BRANCH_PENALTY_M
          const cost = linkCostM(point.location, entry) + penaltyM
          if (cost < best) {
            best = cost
            unitIndex = candidate
            feeder = point
          }
        }
      })
      const [unit] = pending.splice(unitIndex, 1)
      const group = rootFor(unit![0]!).group
      // Only cables between units count; a switch's own wire to its lights is not a branch.
      if (feeder && wiresAtLive.has(feeder)) wiresAtLive.set(feeder, wiresAtLive.get(feeder)! + 1)
      const lightingUnit = unit!.some((stop) => isLightingSide(stop.endpoint))
      let previous = feeder
      unit!.forEach((stop, position) => {
        const index = links.length
        const role: CableRouteRole =
          position > 0
            ? 'wire'
            : previous?.link === -1
              ? 'home-run'
              : lightingUnit
                ? 'branch-feed'
                : 'wire'
        links.push({ stop, feeder: previous?.link, from: previous?.location, role })
        const point = { location: stop.locations[stop.locations.length - 1]!, link: index, group }
        if (!lightingUnit || position === 0) {
          live.push(point)
          wiresAtLive.set(point, 1)
        }
        for (const location of stop.locations) {
          // A device in the board shares the board's placement; drawn wires there mean the board.
          if (location.placementId && !location.inBoard) {
            reachedByPlacement.set(`${group}:${location.placementId}`, point)
          }
        }
        previous = point
      })
    }

    // Pass 2, each link's route.
    // A point placed more than once is reached through the least wire: a tree from the feeder
    // that joins each placement to the cheapest reached spot, chaining unless a branch clearly
    // saves cable. Wires drawn between them are kept.
    const trees = links.map((link) => placementTree(link.from, link.stop.locations, drawnFeederOf))

    const cumulative = new Map<number, { lowM: number; highM: number } | undefined>([
      [-1, { lowM: 0, highM: 0 }],
      ...deviceRoutes.map(
        (route, index) =>
          [-index - 2, { lowM: route.fromBoardLowM, highM: route.fromBoardHighM }] as const
      ),
    ])
    links.forEach((link, index) => {
      const { stop } = link
      const { first, hops } = trees[index]!
      // Inside one board (a relay next to its breaker) no cable leaves the board: no row, and
      // what it feeds is measured from the board.
      if (first.inBoard && link.from?.placementId === first.placementId && hops.length === 0) {
        cumulative.set(index, link.feeder != null ? cumulative.get(link.feeder) : undefined)
        return
      }
      const builder = new RouteBuilder(context)
      const gaps: CableRouteGap[] = []
      // Points at the same spot (an off-plan point beside its neighbour) share one box.
      const besidePrevious =
        link.from != null &&
        link.from.floorId === first.floorId &&
        distance(link.from.pos, first.pos) < 1e-6
      if (besidePrevious) builder.terminations += 1
      else if (link.from) builder.connect(link.from, first)
      else gaps.push({ code: 'unplaced-panel', nodeId: stop.edge.fromNodeId, at: first })
      for (const hop of hops) builder.connect(hop.from, hop.to)
      const slackM = builder.terminations * settings.terminationSlackM
      const fixedM = builder.verticalM + builder.riserM + slackM
      const linked = link.from != null
      const lowM = linked ? builder.horizontalLowM + fixedM : 0
      const highM = linked ? builder.horizontalHighM + fixedM : 0
      const upstream = link.feeder != null ? cumulative.get(link.feeder) : undefined
      const fromBoard = upstream
        ? { lowM: upstream.lowM + lowM, highM: upstream.highM + highM }
        : undefined
      cumulative.set(index, fromBoard)
      results.push({
        anchor: stop.edge.anchor,
        circuitId: circuit.id,
        circuitCode: circuit.code,
        boardName: model.panelByCircuitId.get(circuit.id)?.name,
        cable: stop.edge.cable,
        order: index + 1 + deviceRoutes.length,
        role: link.role,
        category: segmentCategory(circuit, stop.edge, stop.endpoint),
        fromNodeId: stop.edge.fromNodeId,
        physicalFromNodeId:
          link.feeder != null && link.feeder >= 0
            ? links[link.feeder]!.stop.edge.toNodeId
            : link.feeder != null && controllerRoots.has(link.feeder)
              ? `endpoint:${controllerRoots.get(link.feeder)!}`
              : deviceNodeByLink.get(link.feeder ?? -1) ??
                stop.edge.fromNodeId,
        toNodeId: stop.edge.toNodeId,
        fromLabel: link.from?.label ?? '?',
        toLabel: first.label,
        ...(link.from ? { fromPoint: routePoint(link.from) } : {}),
        toPoint: routePoint(first),
        from: link.from,
        to: first,
        legs: builder.legs,
        ...(hops.length > 0 ? { hops } : {}),
        horizontalLowM: builder.horizontalLowM,
        horizontalHighM: builder.horizontalHighM,
        verticalM: builder.verticalM,
        riserM: builder.riserM,
        slackM,
        lowM,
        highM,
        fromBoardLowM: fromBoard?.lowM ?? 0,
        fromBoardHighM: fromBoard?.highM ?? 0,
        basis:
          builder.allDrawn && builder.legs.some((leg) => leg.kind === 'horizontal')
            ? 'drawn-trace'
            : 'straight-estimate',
        besideLabel: stop.besideLabel,
        gaps,
        enteredLengthM: stop.edge.lengthM,
        ...(stop.edge.lengthEstimated ? { enteredLengthEstimated: true } : {}),
      })
    })
    // Controller outputs and branch devices may be reached before their input in the
    // nearest-first traversal. Resolve totals afterwards to include every upstream cable.
    const routeByAnchor = new Map(results.map((route) => [route.anchor, route]))
    const linkByEndpoint = new Map(links.map((link, index) => [link.stop.endpoint.id, index]))
    const totals = new Map<number, { lowM: number; highM: number } | undefined>()
    const visitingTotals = new Set<number>()
    const totalFor = (index: number): { lowM: number; highM: number } | undefined => {
      if (totals.has(index)) return totals.get(index)
      if (visitingTotals.has(index)) return undefined
      visitingTotals.add(index)
      const controller = controllerRoots.get(index)
      const deviceRoute = index < -1 && !controller ? deviceRoutes[-index - 2] : undefined
      let source = deviceRoute?.fromNodeId
      let deviceFeeder: number | undefined
      const visitedSources = new Set<string>()
      while (source && !visitedSources.has(source)) {
        visitedSources.add(source)
        deviceFeeder = source.startsWith('endpoint:')
          ? linkByEndpoint.get(source.slice('endpoint:'.length))
          : deviceRouteByNode.get(source)?.link
        if (deviceFeeder != null) break
        source = incoming.get(source)?.fromNodeId
      }
      const parentLink = controller ? linkByEndpoint.get(controller) : deviceFeeder
      const link = links[index]
      const route = deviceRoute ?? (link ? routeByAnchor.get(link.stop.edge.anchor) : undefined)
      const upstream =
        parentLink != null
          ? totalFor(parentLink)
          : link?.feeder != null
            ? totalFor(link.feeder)
            : undefined
      const total =
        index < 0 && !controller && parentLink == null
          ? cumulative.get(index)
          : upstream
            ? {
                lowM: upstream.lowM + (route?.lowM ?? 0),
                highM: upstream.highM + (route?.highM ?? 0),
              }
            : undefined
      totals.set(index, total)
      visitingTotals.delete(index)
      return total
    }
    links.forEach((link, index) => {
      const route = routeByAnchor.get(link.stop.edge.anchor)
      const total = totalFor(index)
      if (route && total) {
        route.fromBoardLowM = total.lowM
        route.fromBoardHighM = total.highM
      }
    })
    deviceRoutes.forEach((route, index) => {
      const total = totalFor(-index - 2)
      if (total) {
        route.fromBoardLowM = total.lowM
        route.fromBoardHighM = total.highM
      }
    })
    return results
  }

  /**
   * Least-wire tree through a point's placements, grown from its feeder (Prim): a placement
   * with a drawn wire from a reached spot joins there first, otherwise the cheapest pair joins.
   * A box takes its incoming and one outgoing wire for free; every further wire there costs
   * `BRANCH_PENALTY_M` more, so placements chain unless branching saves real cable.
   * `first` is the placement the feeder's own wire reaches; `hops` are the further wires.
   */
  function placementTree(
    from: RouteLocation | undefined,
    locations: RouteLocation[],
    drawnFeederOf: ReadonlyMap<string, string>
  ): { first: RouteLocation; hops: Array<{ from: RouteLocation; to: RouteLocation }> } {
    const reached: RouteLocation[] = from ? [from] : [locations[0]!]
    const remaining = from ? [...locations] : locations.slice(1)
    const edges: Array<{ from: RouteLocation; to: RouteLocation }> = []
    // Wires already at each reached box; the feeder and a first placement arrive on one.
    const wiresAt = new Map<RouteLocation, number>([[reached[0]!, 1]])
    const branchPenaltyM = (spot: RouteLocation) =>
      Math.max(0, (wiresAt.get(spot) ?? 1) - 1) * BRANCH_PENALTY_M
    while (remaining.length > 0) {
      let pick: { from: RouteLocation; index: number } | undefined
      remaining.some((location, index) => {
        const drawn = location.placementId ? drawnFeederOf.get(location.placementId) : undefined
        const source = drawn ? reached.find((spot) => spot.placementId === drawn) : undefined
        if (source) pick = { from: source, index }
        return source != null
      })
      if (!pick) {
        let best = Infinity
        remaining.forEach((location, index) => {
          for (const spot of reached) {
            const cost = linkCostM(spot, location) + branchPenaltyM(spot)
            if (cost < best) {
              best = cost
              pick = { from: spot, index }
            }
          }
        })
      }
      const [to] = remaining.splice(pick!.index, 1)
      edges.push({ from: pick!.from, to: to! })
      wiresAt.set(pick!.from, (wiresAt.get(pick!.from) ?? 1) + 1)
      wiresAt.set(to!, 1)
      reached.push(to!)
    }
    if (!from) return { first: locations[0]!, hops: edges }
    const [primary, ...hops] = edges
    return { first: primary!.to, hops }
  }

  function unplacedEstimate(
    circuit: Circuit,
    edge: CircuitCableEdge,
    endpoint: Endpoint
  ): CableRouteEstimate {
    return {
      anchor: edge.anchor,
      circuitId: circuit.id,
      circuitCode: circuit.code,
      boardName: model.panelByCircuitId.get(circuit.id)?.name,
      cable: edge.cable,
      order: 0,
      role: 'wire',
      category: segmentCategory(circuit, edge, endpoint),
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      fromLabel: '?',
      toLabel: `${endpoint.label} (${endpoint.symbol ?? endpoint.type})`,
      toPoint: { code: endpoint.label, symbolId: endpoint.symbol, nodeType: endpoint.type },
      legs: [],
      horizontalLowM: 0,
      horizontalHighM: 0,
      verticalM: 0,
      riserM: 0,
      slackM: 0,
      lowM: 0,
      highM: 0,
      fromBoardLowM: 0,
      fromBoardHighM: 0,
      basis: 'straight-estimate',
      gaps: [{ code: 'unplaced-endpoint', nodeId: edge.toNodeId }],
      enteredLengthM: edge.lengthM,
      ...(edge.lengthEstimated ? { enteredLengthEstimated: true } : {}),
    }
  }
}
