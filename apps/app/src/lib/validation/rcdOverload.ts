import { findVirtualPanelOwner, isVirtualPanel } from '@/lib/supplyTaps/virtualPanel'
import type { AcLinePhase, CircuitPhaseAssignment, EnergyConversionDeviceProps, TrunkDevice } from '@/types/schema'
import { getProjectElectricalInstallation, getProjectElectricalPanels, selectProjectSupplyAssemblies } from '@/lib/projectV2/electrical'
import { getEffectiveCircuitPhaseState } from '@/lib/wires/phaseAssignment'
import { getCircuitBranches } from '@/lib/layout/endpointChains'
import { resolvePanelSupplyLinkForPanelInPanels } from '@/lib/eendraad/panelSupplyLink'
import { isOvercurrentProtectionType } from '@/lib/protectionKind'
import { getPrimaryPanelBusSectionId } from '@/lib/panel/panelBusSections'
import { isPanelPlacementCarrierCircuit } from './core/primitives/common'
import type { CheckContext, Offender } from './core/types'
import { circuitUpstreamProtections, type UpstreamProtection } from './upstreamProtection'

export interface RcdOverloadAssessment {
  id: string
  boardId: string
  offender: Offender
  status: 'passed' | 'overload' | 'missing-information' | 'unavailable'
  ratingA?: number
  maximumCurrentA?: number
  reason?: string
}

// These are coordination/design bounds, not predictions of actual consumption.
// Unknown inverter power participates in the safety bound, never in credible excess.
type Values = [upperSources: number, confirmedSources: number, confirmedPv: number, upperSinks: number, confirmedSinks: number]
type Node = { name: string; values: Values; edges: number[] }
type Edge = { a: number; b: number; capacity: number; confirmedCapacity: number; rcdId?: string }
const zero = (): Values => [0, 0, 0, 0, 0]
const finitePositive = (value: number | undefined): value is number => value != null && Number.isFinite(value) && value > 0
const assessments = new WeakMap<object, RcdOverloadAssessment[]>()

/** Radial AC protection paths only. A pure RCCB contributes no current-limiting edge.
 * The two components on either side of each RCCB are assessed independently, so PV
 * behind it does not get added to its forward grid-current bound. Schneider RCCB
 * coordination guidance distinguishes withstand rating from overcurrent protection.
 */
export function assessRcdOverload(context: CheckContext): RcdOverloadAssessment[] {
  const cached = assessments.get(context.query)
  if (cached) return cached
  const { query, project } = context
  const installation = getProjectElectricalInstallation(project)
  const panels = getProjectElectricalPanels(project)
  const boards = query.getBoards()
  const firstMain = boards.find((board) => board.isMain)?.id
  const owner = new Map<string, string>()
  const section = new Map<string, string>()
  for (const board of boards) {
    for (const protection of board.protections) {
      owner.set(protection.id, board.id)
      section.set(protection.id, `${board.id}:${protection.busSectionId ?? getPrimaryPanelBusSectionId(board)}`)
    }
    for (const circuit of query.getCircuits(board.id)) {
      owner.set(circuit.id, board.id)
      // A tap circuit shares its owner's supply section, so an owner supply that stays opaque to this
      // analysis keeps the taps' upstream devices opaque too.
      const sectionBoard = (isVirtualPanel(board) ? findVirtualPanelOwner(panels, board.id) : undefined) ?? board
      const key = `${sectionBoard.id}:${query.getProtectionForCircuit(circuit.id)?.busSectionId ?? circuit.busSectionId ?? getPrimaryPanelBusSectionId(sectionBoard)}`
      section.set(circuit.id, key)
      for (const device of circuit.trunkDevices ?? []) {
        owner.set(device.id, board.id)
        section.set(device.id, key)
      }
    }
  }
  for (const feed of installation?.feedTopology?.rootFeeds ?? []) {
    for (const device of feed.trunkDevices ?? []) {
      owner.set(device.id, feed.panelId)
      const board = query.getPanelById(feed.panelId)
      if (board) section.set(device.id, `${board.id}:${feed.busSectionId ?? getPrimaryPanelBusSectionId(board)}`)
    }
  }
  const targets = new Map<string, RcdOverloadAssessment>()
  const nodes: Node[] = []
  const edges: Edge[] = []
  const nodeIds = new Map<string, number>()
  const connections = new Set<string>()
  const node = (name: string) => {
    let id = nodeIds.get(name)
    if (id == null) {
      id = nodes.length
      nodes.push({ name, values: zero(), edges: [] })
      nodeIds.set(name, id)
    }
    return id
  }
  const connect = (a: number, b: number, capacity = Infinity, rcdId?: string, confirmedCapacity = capacity) => {
    if (a === b) return
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`
    if (connections.has(key)) return
    connections.add(key)
    const id = edges.length
    edges.push({ a, b, capacity, confirmedCapacity, rcdId })
    nodes[a]!.edges.push(id)
    nodes[b]!.edges.push(id)
  }
  const assemblies = selectProjectSupplyAssemblies(project)
  const complexSections = new Set<string>()
  const complexCircuits = new Set<string>()
  for (const assembly of assemblies) for (const { target } of assembly.loadHandoffs) {
    if (target.kind === 'circuit-input') complexCircuits.add(target.circuitId)
    else {
      const feed = target.kind === 'root-feed' ? installation?.feedTopology?.rootFeeds.find(({ id }) => id === target.rootFeedId) : undefined
      const board = query.getPanelById(target.kind === 'root-feed' ? feed?.panelId ?? '' : target.panelId)
      if (board) complexSections.add(`${board.id}:${target.kind === 'panel-bus-input' ? target.busSectionId : feed?.busSectionId ?? getPrimaryPanelBusSectionId(board)}`)
    }
  }
  const complexDevice = (device: TrunkDevice) => device.type === 'conversion' || device.type === 'changeover' ||
    (device.supplyPath != null && device.supplyPath !== 'serial')
  const opaqueSharedSupply = installation?.mainSupply.supplyTrunkDevices?.some(complexDevice) ?? false
  for (const feed of installation?.feedTopology?.rootFeeds ?? []) {
    if (!feed.trunkDevices?.some(complexDevice)) continue
    const board = query.getPanelById(feed.panelId)
    if (board) complexSections.add(`${board.id}:${feed.busSectionId ?? getPrimaryPanelBusSectionId(board)}`)
  }
  const unavailableDevices = new Set<string>()
  const opaquePathDevices = new Set<string>()
  const system = installation?.nominalVoltage.system
  const phases: AcLinePhase[] = system === '3~' || system === '3N~' ? ['L1', 'L2', 'L3'] : ['L1']
  for (const phase of phases) {
    const grid = node(`grid:${phase}`)
    const bus = node(`grid-bus:${phase}`)
    // The connection current is per phase, before any shared/root-feed split.
    connect(grid, bus, finitePositive(installation?.connectionCurrentA) ? installation.connectionCurrentA : Infinity)
    nodes[grid]!.values = [Infinity, Infinity, 0, Infinity, Infinity]
  }
  const addDevice = (device: UpstreamProtection, phase: AcLinePhase, boardId: string) => {
    const input = node(`${device.id}:in:${phase}`)
    const output = node(`${device.id}:out:${phase}`)
    const overcurrent = isOvercurrentProtectionType(device.type)
    const capacity = overcurrent && finitePositive(device.ratingA) ? device.ratingA : Infinity
    // Missing OC markings may conceal a smaller real limiter. They permit an
    // upper safety bound, but cannot substantiate excess through either side.
    const confirmedCapacity = overcurrent && !finitePositive(device.ratingA) ? 0 : capacity
    connect(input, output, capacity, device.type === 'RCD' ? device.id : undefined, confirmedCapacity)
    if (device.type === 'RCD' && !targets.has(device.id)) {
      targets.set(device.id, {
        id: device.id, boardId: owner.get(device.id) ?? firstMain ?? boardId,
        offender: { kind: device.offenderKind, id: device.id, viewHint: 'eendraad' },
        ratingA: device.ratingA, status: 'passed', maximumCurrentA: 0,
      })
    }
    return { input, output }
  }
  const addSource = (at: number, currentA: number | undefined, knownPhase: boolean) => {
    const values = nodes[at]!.values
    const known = finitePositive(currentA) && knownPhase ? currentA : 0
    values[0] += finitePositive(currentA) ? currentA : Infinity
    values[1] += known
    values[2] += known
  }
  for (const circuit of query.getCircuits()) {
    const boardId = owner.get(circuit.id)!
    const board = query.getPanelById(boardId)
    if (!board || circuit.dcBusSource || isPanelPlacementCarrierCircuit(query, circuit.id)) continue
    const phaseState = getEffectiveCircuitPhaseState(circuit, panels, system, installation)
    const assignment = phaseState.assignment
    if (assignment?.kind === 'dc') continue
    const circuitPhases = linePhases(assignment, phases)
    const ownTrunkIds = new Set(circuit.trunkDevices?.map(({ id }) => id))
    const upstream = circuitUpstreamProtections(context, circuit.id).filter((device) => !ownTrunkIds.has(device.id)).reverse()
    const directOpaque = opaqueSharedSupply || complexSections.has(section.get(circuit.id) ?? '') || complexCircuits.has(circuit.id)
    if (directOpaque) {
      // Mark devices downstream of an opaque supply handoff, not an unrelated
      // ordinary departure merely sharing this project or the grid source.
      for (const device of upstream) {
        if (device.type === 'RCD' && (opaqueSharedSupply || complexSections.has(section.get(device.id) ?? '') || !device.supply)) opaquePathDevices.add(device.id)
      }
      for (const device of circuit.trunkDevices ?? []) if (device.protectionType === 'RCD') opaquePathDevices.add(device.id)
    }
    const trunk = [...(circuit.trunkDevices ?? [])].sort((a, b) => a.trunkPosition - b.trunkPosition)
    // Domain-changing circuit trunks need their AC-port topology, not a guessed
    // serial connection. Keep these paths diagnostic until that topology is supported.
    const unsupported = circuit.supplySource ||
      (!board.isMain && !isVirtualPanel(board) && !resolvePanelSupplyLinkForPanelInPanels(panels, board.id)) ||
      trunk.some((device) => (device.type === 'conversion' && device.symbol !== 'inverter') || device.type === 'changeover')
    if (unsupported) {
      for (const device of upstream) if (device.type === 'RCD') unavailableDevices.add(device.id)
      for (const device of trunk) if (device.protectionType === 'RCD') unavailableDevices.add(device.id)
    }
    const branches = getCircuitBranches(circuit)
    for (const phase of circuitPhases) {
      let at = node(`grid-bus:${phase}`)
      for (const device of upstream) {
        const split = addDevice(device, phase, boardId)
        connect(at, split.input)
        at = split.output
      }
      let nextDevice = 0
      let dcSide = false
      for (let branchIndex = 0; branchIndex < Math.max(1, branches.length); branchIndex += 1) {
        if (dcSide) break
        while (nextDevice < trunk.length && trunk[nextDevice]!.trunkPosition <= branchIndex) {
          const device = trunk[nextDevice++]!
          if (device.type === 'conversion' && device.symbol === 'inverter') {
            const acAssignment = resolveAcAssignment(device.conversionProps?.acPhaseAssignment, assignment)
            const sourcePhases = linePhases(acAssignment, circuitPhases)
            if (sourcePhases.includes(phase)) {
              const knownPhase = phases.length === 1 || (acAssignment != null && acAssignment.kind !== 'inherit' && acAssignment.phases.length > 0)
              addSource(at, inverterCurrent(device.conversionProps, sourcePhases.length, installation?.nominalVoltage), knownPhase)
            }
            // The ordinary inverter's AC feed is below the converter. Its
            // array/battery exits and following trunk devices are DC-side data.
            dcSide = true
            break
          }
          if (device.type === 'conversion' || device.type === 'changeover') {
            addSource(at, undefined, false)
            dcSide = true
            break
          }
          if (device.type !== 'protection' || !device.protectionType || device.converterDcConnection) continue
          const split = addDevice({ ...device, type: device.protectionType, offenderKind: 'device' }, phase, boardId)
          connect(at, split.input)
          at = split.output
        }
        if (dcSide) break
        for (const endpoint of branches[branchIndex] ?? []) {
          if (endpoint.converterDcConnection || endpoint.panelId || endpoint.symbol === 'solar_panel' || endpoint.symbol === 'battery') continue
          if (endpoint.symbol === 'inverter') {
            const acAssignment = resolveAcAssignment(endpoint.energyConversionProps?.acPhaseAssignment, assignment)
            const sourcePhases = linePhases(acAssignment, circuitPhases)
            if (!sourcePhases.includes(phase)) continue
            const knownPhase = phases.length === 1 || (acAssignment != null && acAssignment.kind !== 'inherit' && acAssignment.phases.length > 0)
            addSource(at, inverterCurrent(endpoint.energyConversionProps, sourcePhases.length, installation?.nominalVoltage), knownPhase)
          } else if (!['domotica', 'junction_box', 'junction_panel', 'terminal_strip', 'contact', 'switch_impulse'].includes(endpoint.symbol ?? '') && endpoint.type !== 'switch') {
            nodes[at]!.values[3] = Infinity
            nodes[at]!.values[4] = Infinity
          }
        }
      }
    }
  }
  evaluateForest(nodes, edges, targets)
  for (const target of targets.values()) {
    if (opaquePathDevices.has(target.id) ||
      system === 'DC' || unavailableDevices.has(target.id)) {
      target.status = 'unavailable'
      target.reason = 'complex-or-unconnected-ac-supply-path'
    }
  }
  const result = [...targets.values()]
  assessments.set(query, result)
  return result
}

function linePhases(assignment: CircuitPhaseAssignment | undefined, fallback: AcLinePhase[]): AcLinePhase[] {
  const active = assignment?.phases.filter((phase): phase is AcLinePhase => phase === 'L1' || phase === 'L2' || phase === 'L3')
  return assignment?.kind !== 'inherit' && active?.length ? active : fallback
}

function resolveAcAssignment(override: CircuitPhaseAssignment | undefined, inherited: CircuitPhaseAssignment | undefined) {
  return override == null || override.kind === 'inherit' ? inherited : override
}

/** Only the inverter's entered AC rating is used; DC array Wp and battery energy
 * never stand in for AC output. Bare/ambiguous catalog text remains unknown. */
function inverterCurrent(props: EnergyConversionDeviceProps | undefined, phaseCount: number,
  voltage: { uLineToNeutral: number; uLineToLine: number } | undefined): number | undefined {
  const secondary = props?.pMaxSecondaryW?.trim().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(?:w)?$/i)
  const match = props?.power?.trim().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(k?w|k?va)$/i)
  if ((!secondary && !match) || !voltage) return undefined
  const watts = secondary ? Number(secondary[1]) : Number(match![1]) * (match![2]!.toLowerCase().startsWith('k') ? 1000 : 1)
  const volts = phaseCount === 3 ? Math.sqrt(3) * voltage.uLineToLine
    : phaseCount === 2 ? voltage.uLineToLine : voltage.uLineToNeutral || voltage.uLineToLine
  return finitePositive(watts) && finitePositive(volts) ? watts / volts : undefined
}

// Linear rerooting: every directed edge gets the bounded source/sink contribution
// from its side. A second pass evaluates both directions through each pure RCD.
function evaluateForest(nodes: Node[], edges: Edge[], targets: Map<string, RcdOverloadAssessment>) {
  const visited = new Set<number>()
  const incoming: Values[][] = edges.map(() => [zero(), zero()])
  const totals: Array<{ finite: Values; infinite: Values }> = []
  const side = (edge: Edge, at: number) => edge.a === at ? 0 : 1
  const bounded = (values: Values, edge: Edge) => values.map((value, index) =>
    Math.min(value, index === 0 || index === 3 ? edge.capacity : edge.confirmedCapacity)
  ) as Values
  const sum = (at: number, exclude?: number): Values => {
    const aggregate = totals[at]!
    const excluded = exclude == null ? zero() : incoming[exclude]![side(edges[exclude]!, at)]!
    return aggregate.finite.map((value, index) =>
      aggregate.infinite[index]! - (excluded[index] === Infinity ? 1 : 0) > 0
        ? Infinity : value - (excluded[index] === Infinity ? 0 : excluded[index]!)
    ) as Values
  }
  const aggregate = (at: number) => {
    const values = [nodes[at]!.values, ...nodes[at]!.edges.map((id) => incoming[id]![side(edges[id]!, at)]!)]
    totals[at] = { finite: zero(), infinite: zero() }
    for (const value of values) for (let index = 0; index < 5; index += 1) {
      if (value[index] === Infinity) totals[at]!.infinite[index]! += 1
      else totals[at]!.finite[index]! += value[index]!
    }
  }
  for (let start = 0; start < nodes.length; start += 1) {
    if (visited.has(start)) continue
    const order: number[] = [start]
    const parent = new Map<number, number>()
    visited.add(start)
    let cyclic = false
    for (let cursor = 0; cursor < order.length; cursor += 1) {
      const at = order[cursor]!
      for (const edgeId of nodes[at]!.edges) {
        if (parent.get(at) === edgeId) continue
        const edge = edges[edgeId]!
        const next = edge.a === at ? edge.b : edge.a
        if (visited.has(next)) { cyclic = true; continue }
        visited.add(next)
        parent.set(next, edgeId)
        order.push(next)
      }
    }
    if (cyclic) {
      for (const at of order) for (const id of nodes[at]!.edges) {
        const target = targets.get(edges[id]!.rcdId ?? '')
        if (target) { target.status = 'unavailable'; target.reason = 'non-radial-protection-topology' }
      }
      continue
    }
    for (const at of [...order].reverse()) {
      aggregate(at)
      const id = parent.get(at)
      if (id == null) continue
      const edge = edges[id]!
      incoming[id]![1 - side(edge, at)] = bounded(sum(at, id), edge)
    }
    for (const at of order) {
      aggregate(at)
      for (const id of nodes[at]!.edges) {
        const edge = edges[id]!
        const next = edge.a === at ? edge.b : edge.a
        if (parent.get(next) !== id) continue
        incoming[id]![side(edge, next)] = bounded(sum(at, id), edge)
      }
    }
  }
  for (const [id, edge] of edges.entries()) {
    const target = targets.get(edge.rcdId ?? '')
    if (!target || target.status === 'unavailable') continue
    if (!finitePositive(target.ratingA)) {
      target.status = 'missing-information'; target.reason = 'rcd-current-rating-not-entered'; continue
    }
    const left = sum(edge.a, id)
    const right = sum(edge.b, id)
    const maximum = Math.max(Math.min(left[0], right[3]), Math.min(right[0], left[3]))
    const credible = (sources: Values, sinks: Values) => Math.min(Number.isFinite(sources[1]) ? sources[1] : sources[2], sinks[4])
    const confirmed = Math.max(credible(left, right), credible(right, left))
    if (confirmed > target.ratingA + 1e-7) {
      target.status = 'overload'
      target.maximumCurrentA = Math.max(target.maximumCurrentA ?? 0, confirmed)
    } else if (maximum > target.ratingA + 1e-7 && target.status !== 'overload') {
      target.status = 'missing-information'; target.reason = 'source-ac-current-or-phase-not-confirmed'
    } else if (target.status === 'passed') target.maximumCurrentA = Math.max(target.maximumCurrentA ?? 0, maximum)
  }
}
