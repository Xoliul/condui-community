import { normalizeNominalVoltageSystem } from '@/constants/nominalVoltage'
import type {
  AcLinePhase,
  AcPhase,
  Circuit,
  CircuitPhaseAssignment,
  Endpoint,
  Installation,
  Panel,
  ProtectionDevice,
  RootPanelFeedPath,
  TrunkDevice,
} from '@/types/schema'
import type { OffGridSupplyAssembly } from '@/types/supplyAssembly'
import { polesFromConfig } from '@/constants/poleConfig'
import { findParentCircuitInfo } from '@/lib/eendraad/findParentCircuitInfo'
import { getElectricalSnapshotIndex } from '@/lib/projectV2/electricalLookupIndex'
import { walkPanels } from '@/lib/panel/panelTree'
import { getMainBusOrder } from '@/lib/eendraad/mainBusOrder'
import { isImmutableMainBusPanel } from '@/lib/panel/mainBusOrder'
import { collectRootPanels, ensureInstallationFeedTopology } from '@/lib/feedTopology'
import {
  getCircuitBusSectionId,
  getPanelBusSectionPhaseOrder,
  getPrimaryPanelBusSectionId,
  getProtectionBusSectionId,
  hasExplicitPanelBusSections,
} from '@/lib/panel/panelBusSections'
import { deriveHandoffPhaseSupplyPaths } from '@/lib/supplyAssembly/phasePaths'
import { resolvePanelSupplyLinkForPanelInPanels } from '@/lib/eendraad/panelSupplyLink'
import { installationSupportsFeedVoltages, resolvePanelNominalVoltage } from '@/lib/electrical/feedNominalVoltage'

export type PhaseAssignmentOption = {
  value: string
  assignment?: CircuitPhaseAssignment
}

export interface PhaseAssignmentConstraint {
  allowedKinds?: CircuitPhaseAssignment['kind'][]
  /** Active conductors required by the upstream protection, excluding PE. */
  activeConductorCount?: number
  /** Every selected phase must be present in the upstream locked phase set. */
  allowedPhases?: AcPhase[]
  /** Concrete phase set inherited from the upstream circuit, if one exists. */
  inheritedAssignment?: CircuitPhaseAssignment
  /** A protection boundary cannot remain an unqualified all-phase wire. */
  requireExplicit?: boolean
}

export interface InheritedCircuitPhaseState {
  assignment?: CircuitPhaseAssignment
  showPhaseLabel?: boolean
}

export interface PanelIncomingPhaseState {
  /** Persisted user choice on this panel's private root feed. */
  configuredAssignment?: CircuitPhaseAssignment
  /** Effective assignment arriving at the panel busbar. */
  assignment?: CircuitPhaseAssignment
  showPhaseLabel?: boolean
  /** Root-feed protection that makes the assignment non-editable. */
  lockedByProtectionId?: string
  constraint?: PhaseAssignmentConstraint
}

type VoltageSystem = Installation['nominalVoltage']['system'] | string | undefined
const PHASE_ORDER: AcPhase[] = ['L1', 'L2', 'L3', 'N', 'PE']
const DEFAULT_BUSBAR_PHASE_ORDER: AcLinePhase[] = ['L1', 'L2', 'L3']

function sanitizeBusbarPhaseOrder(
  order: AcLinePhase[] | undefined,
  allowPartial = false
): AcLinePhase[] {
  if (!order?.length) return DEFAULT_BUSBAR_PHASE_ORDER
  const validPhases = order.every((phase) => DEFAULT_BUSBAR_PHASE_ORDER.includes(phase))
  if (
    validPhases &&
    (order.length === 3 ||
      (allowPartial && order.length < 3 && new Set(order).size === order.length))
  )
    return order
  return DEFAULT_BUSBAR_PHASE_ORDER
}

export function getBusbarPhaseOrder(
  panel: Panel,
  ownerId?: string,
  busSectionId?: string
): AcLinePhase[] {
  if (ownerId) {
    return sanitizeBusbarPhaseOrder(panel.busbarPhases?.secondary?.[ownerId])
  }
  return sanitizeBusbarPhaseOrder(
    getPanelBusSectionPhaseOrder(panel, busSectionId),
    hasExplicitPanelBusSections(panel)
  )
}

function getProtectionPoles(
  protection: Pick<ProtectionDevice, 'polesConfig' | 'poles'> | undefined
): number | undefined {
  return protection?.polesConfig ? polesFromConfig(protection.polesConfig) : protection?.poles
}

function assignmentForBusbarSlot(
  system: VoltageSystem,
  order: AcLinePhase[],
  slotIndex: number,
  poles = 2
): CircuitPhaseAssignment | undefined {
  const normalized = normalizeNominalVoltageSystem(system ?? '2~')
  if (!supportsExplicitPhaseSelection(normalized)) return undefined
  if (normalized === '3~' && poles >= 3) {
    return {
      kind: 'three_phase',
      phases: Array.from(
        { length: Math.min(poles, order.length) },
        (_, poleIndex) => order[(slotIndex + poleIndex) % order.length]!
      ),
      neutral: 'not_present',
      source: 'derived_from_busbar',
    }
  }
  if (normalized === '3N~' && poles === 3) {
    return {
      kind: 'three_phase',
      phases: ['L1', 'L2', 'L3'],
      neutral: 'not_present',
      source: 'derived_from_busbar',
    }
  }
  if (poles >= 3) {
    return getFullInstallationPhaseAssignment(normalized)
  }
  const phase = order[slotIndex % order.length]!
  if (normalized === '3N~') {
    return {
      kind: 'single_phase',
      phases: [phase, 'N'],
      neutral: 'used',
      source: 'derived_from_busbar',
    }
  }
  const nextPhase = order[(slotIndex + 1) % order.length]!
  return {
    kind: 'phase_to_phase',
    phases: [phase, nextPhase],
    neutral: 'not_present',
    source: 'derived_from_busbar',
  }
}

function assignmentForLimitedBusbar(
  system: VoltageSystem,
  order: AcLinePhase[]
): CircuitPhaseAssignment | undefined {
  if (order.length === 0 || order.length >= 3) return undefined
  const normalized = normalizeNominalVoltageSystem(system ?? '2~')
  if (normalized === '3N~') {
    return {
      kind: order.length === 1 ? 'single_phase' : 'phase_to_phase',
      phases: [...order, 'N'],
      neutral: 'used',
      source: 'derived_from_busbar',
    }
  }
  if (normalized === '3~' && order.length === 2) {
    return {
      kind: 'phase_to_phase',
      phases: [...order],
      neutral: 'not_present',
      source: 'derived_from_busbar',
    }
  }
  return undefined
}

function findCircuitContext(
  circuitId: string,
  panels: Panel[]
): { panel: Panel; protection?: ProtectionDevice } | undefined {
  const index = getElectricalSnapshotIndex(panels)
  if (index) return index.circuitContextsById.get(circuitId)
  for (const panel of walkPanels(panels)) {
    if (panel.circuits.some((circuit) => circuit.id === circuitId)) return { panel }
    const protection = panel.protections.find((candidate) =>
      candidate.circuits?.some((circuit) => circuit.id === circuitId)
    )
    if (protection) return { panel, protection }
  }
  return undefined
}

function getBusbarPhaseAdvance(
  protection: ProtectionDevice | undefined,
  system: VoltageSystem
): number {
  if (!protection) return 0
  const poles = getProtectionPoles(protection) ?? 2
  const normalized = normalizeNominalVoltageSystem(system ?? '2~')
  if (normalized !== '3~' && normalized !== '3N~') return 0
  if (normalized === '3~') return Math.max(1, poles)
  return poles <= 2 ? 1 : 0
}

type MainBusPhaseSlots = {
  circuits: Map<string, number>
  protections: Map<string, number>
  totalsBySection: Map<string, number>
  circuitSections: Map<string, string>
  protectionSections: Map<string, string>
  primarySectionId: string
}

const mainBusPhaseSlotsByPanel = new WeakMap<Panel, Map<string, MainBusPhaseSlots>>()

function getMainBusPhaseSlots(panel: Panel, system: VoltageSystem): MainBusPhaseSlots {
  const normalized = normalizeNominalVoltageSystem(system ?? '2~')
  const cacheable = isImmutableMainBusPanel(panel)
  const cached = cacheable ? mainBusPhaseSlotsByPanel.get(panel)?.get(normalized) : undefined
  if (cached) return cached

  // Array.find historically chose the first owner for a duplicate ID. Retain
  // that order while avoiding a fresh linear owner search for every bus item.
  const protections = new Map<string, ProtectionDevice>()
  const circuits = new Map<string, Circuit>()
  for (const protection of panel.protections) {
    if (!protections.has(protection.id)) protections.set(protection.id, protection)
  }
  for (const circuit of panel.circuits) {
    if (!circuits.has(circuit.id)) circuits.set(circuit.id, circuit)
  }
  const primarySectionId = getPrimaryPanelBusSectionId(panel)
  const slots: MainBusPhaseSlots = {
    circuits: new Map(),
    protections: new Map(),
    totalsBySection: new Map(),
    circuitSections: new Map(),
    protectionSections: new Map(),
    primarySectionId,
  }
  for (const [id, circuit] of circuits) {
    slots.circuitSections.set(id, circuit.busSectionId ?? primarySectionId)
  }
  for (const [id, protection] of protections) {
    slots.protectionSections.set(id, protection.busSectionId ?? primarySectionId)
  }
  for (const candidate of getMainBusOrder(panel)) {
    const protection = candidate.type === 'protection' ? protections.get(candidate.id) : undefined
    const sectionId = protection
      ? slots.protectionSections.get(candidate.id)!
      : (slots.circuitSections.get(candidate.id) ?? primarySectionId)
    const slot = slots.totalsBySection.get(sectionId) ?? 0
    const targetSlots = candidate.type === 'protection' ? slots.protections : slots.circuits
    if (!targetSlots.has(candidate.id)) targetSlots.set(candidate.id, slot)
    slots.totalsBySection.set(sectionId, slot + getBusbarPhaseAdvance(protection, normalized))
  }
  if (cacheable) {
    let bySystem = mainBusPhaseSlotsByPanel.get(panel)
    if (!bySystem) {
      bySystem = new Map()
      mainBusPhaseSlotsByPanel.set(panel, bySystem)
    }
    bySystem.set(normalized, slots)
  }
  return slots
}

function getMainBusSlotIndex(
  panel: Panel,
  item: { type: 'circuit' | 'protection'; id: string },
  system: VoltageSystem
): number {
  const slots = getMainBusPhaseSlots(panel, system)
  const targetSlots = item.type === 'protection' ? slots.protections : slots.circuits
  const slot = targetSlots.get(item.id)
  if (slot !== undefined) return slot
  const sections = item.type === 'protection' ? slots.protectionSections : slots.circuitSections
  const targetSectionId = sections.get(item.id) ?? slots.primarySectionId
  return slots.totalsBySection.get(targetSectionId) ?? 0
}

export function getMainBusProtectionPhaseAssignment(
  panel: Panel,
  protection: ProtectionDevice,
  system: VoltageSystem
): CircuitPhaseAssignment | undefined {
  const poles = getProtectionPoles(protection) ?? 2
  const slot = getMainBusSlotIndex(panel, { type: 'protection', id: protection.id }, system)
  const phaseOrder = getBusbarPhaseOrder(
    panel,
    undefined,
    getProtectionBusSectionId(panel, protection)
  )
  const limitedBusAssignment = assignmentForLimitedBusbar(system, phaseOrder)
  if (limitedBusAssignment) return limitedBusAssignment
  if (poles > 2 && normalizeNominalVoltageSystem(system ?? '2~') !== '3~') {
    return getFullInstallationPhaseAssignment(system)
  }
  return assignmentForBusbarSlot(system, phaseOrder, slot, poles)
}

/** Automatic phase set supplied by the circuit's own busbar attachment. */
export function getAutomaticBusbarPhaseAssignment(
  circuit: Circuit,
  panels: Panel[],
  system: VoltageSystem
): CircuitPhaseAssignment | undefined {
  if (!supportsExplicitPhaseSelection(system)) return undefined
  const context = findCircuitContext(circuit.id, panels)
  if (!context) return undefined
  const { panel, protection } = context
  const busSectionId = getCircuitBusSectionId(panel, circuit, protection)
  const parent = findParentCircuitInfo(circuit.id, panels)
  if (parent) {
    let index = 0
    for (const siblingId of parent.parentCircuit.subCircuitIds ?? []) {
      if (siblingId === circuit.id) break
      index += getBusbarPhaseAdvance(findCircuitContext(siblingId, panels)?.protection, system)
    }
    return assignmentForBusbarSlot(
      system,
      getBusbarPhaseOrder(panel, parent.parentCircuit.id),
      index,
      getProtectionPoles(protection) ?? 2
    )
  }

  const isGroupedRcd =
    !!protection &&
    (protection.type === 'RCD' || protection.type === 'RCBO') &&
    (protection.circuits?.length ?? 0) > 1
  if (isGroupedRcd) {
    const incoming = getMainBusProtectionPhaseAssignment(panel, protection, system)
    if (incoming && phaseAssignmentDiffersFromInstallation(incoming, system)) return incoming
    const circuitIndex = Math.max(
      0,
      protection.circuits?.findIndex((item) => item.id === circuit.id) ?? 0
    )
    const index =
      normalizeNominalVoltageSystem(system ?? '2~') === '3~' ? circuitIndex * 2 : circuitIndex
    return assignmentForBusbarSlot(system, getBusbarPhaseOrder(panel, protection.id), index, 2)
  }

  if (protection) return getMainBusProtectionPhaseAssignment(panel, protection, system)
  const slot = getMainBusSlotIndex(panel, { type: 'circuit', id: circuit.id }, system)
  return assignmentForBusbarSlot(system, getBusbarPhaseOrder(panel, undefined, busSectionId), slot)
}

function manualAssignment(
  kind: CircuitPhaseAssignment['kind'],
  phases: AcPhase[],
  neutral?: CircuitPhaseAssignment['neutral']
): CircuitPhaseAssignment {
  return { kind, phases, neutral, source: 'manual' }
}

function option(
  value: string,
  kind: CircuitPhaseAssignment['kind'],
  phases: AcPhase[],
  neutral?: CircuitPhaseAssignment['neutral']
): PhaseAssignmentOption {
  return { value, assignment: manualAssignment(kind, phases, neutral) }
}

/** Active AC conductors available from the installation voltage system, excluding PE. */
export function getInstallationPhases(system: VoltageSystem): AcPhase[] {
  switch (normalizeNominalVoltageSystem(system ?? '2~')) {
    case '3N~':
      return ['L1', 'L2', 'L3', 'N']
    case '3~':
      return ['L1', 'L2', 'L3']
    case '1N~':
      return ['L1', 'N']
    case '2~':
      return ['L1', 'L2']
    case 'DC':
    case '1~':
    default:
      return []
  }
}

export function supportsExplicitPhaseSelection(system: VoltageSystem): boolean {
  const normalized = normalizeNominalVoltageSystem(system ?? '2~')
  return normalized === '3~' || normalized === '3N~'
}

/** Options intentionally omit PE: PE is a continuity conductor, not a switched phase. */
export function getPhaseAssignmentOptions(
  system: VoltageSystem,
  constraint?: PhaseAssignmentConstraint
): PhaseAssignmentOption[] {
  const normalized = normalizeNominalVoltageSystem(system ?? '2~')
  if (!supportsExplicitPhaseSelection(normalized)) return []

  const options: PhaseAssignmentOption[] = [{ value: 'inherit' }]
  if (normalized === '3N~') {
    options.push(
      option('single:L1+N', 'single_phase', ['L1', 'N'], 'used'),
      option('single:L2+N', 'single_phase', ['L2', 'N'], 'used'),
      option('single:L3+N', 'single_phase', ['L3', 'N'], 'used'),
      option('pair:L1-L2', 'phase_to_phase', ['L1', 'L2'], 'not_present'),
      option('pair:L2-L3', 'phase_to_phase', ['L2', 'L3'], 'not_present'),
      option('pair:L3-L1', 'phase_to_phase', ['L3', 'L1'], 'not_present'),
      option('three:L1+L2+L3', 'three_phase', ['L1', 'L2', 'L3'], 'not_present'),
      option('three:L1+L2+L3+N', 'three_phase', ['L1', 'L2', 'L3', 'N'], 'used')
    )
  } else {
    options.push(
      option('pair:L1-L2', 'phase_to_phase', ['L1', 'L2'], 'not_present'),
      option('pair:L2-L3', 'phase_to_phase', ['L2', 'L3'], 'not_present'),
      option('pair:L3-L1', 'phase_to_phase', ['L3', 'L1'], 'not_present'),
      option('three:L1+L2+L3', 'three_phase', ['L1', 'L2', 'L3'], 'not_used')
    )
  }
  if (!constraint) return options
  return options.filter((candidate) => {
    if (!candidate.assignment) return constraint.requireExplicit !== true
    if (constraint.allowedKinds && !constraint.allowedKinds.includes(candidate.assignment.kind)) {
      return false
    }
    if (
      constraint.activeConductorCount != null &&
      getActiveConductorCount(candidate.assignment) !== constraint.activeConductorCount
    ) {
      return false
    }
    if (
      constraint.allowedPhases &&
      !candidate.assignment.phases.every((phase) => constraint.allowedPhases!.includes(phase))
    ) {
      return false
    }
    return true
  })
}

function assignmentKey(assignment: CircuitPhaseAssignment | undefined): string {
  if (!assignment || assignment.kind === 'inherit') return 'inherit'
  const phases = [...assignment.phases].sort(
    (left, right) => PHASE_ORDER.indexOf(left) - PHASE_ORDER.indexOf(right)
  )
  return `${assignment.kind}:${phases.join('+')}:${assignment.neutral ?? ''}`
}

export function getPhaseAssignmentOptionValue(
  assignment: CircuitPhaseAssignment | undefined,
  system: VoltageSystem,
  constraint?: PhaseAssignmentConstraint
): string {
  const key = assignmentKey(assignment)
  const options = getPhaseAssignmentOptions(system, constraint)
  return (
    options.find((candidate) => assignmentKey(candidate.assignment) === key)?.value ??
    (options.some((option) => option.value === 'inherit') ? 'inherit' : '')
  )
}

export function getPhaseAssignmentForOptionValue(
  value: string,
  system: VoltageSystem,
  constraint?: PhaseAssignmentConstraint
): CircuitPhaseAssignment | undefined {
  return getPhaseAssignmentOptions(system, constraint).find(
    (candidate) => candidate.value === value
  )?.assignment
}

/**
 * Infer the phase shape that a protection permits without guessing which physical
 * phase (L1/L2/L3) the installer chose. Missing/legacy circuit assignments remain
 * inherited, but the wire editor is still constrained to this shape.
 */
export function getProtectionPhaseConstraint(
  protection: Pick<ProtectionDevice, 'polesConfig' | 'poles'> | undefined,
  system: VoltageSystem,
  upstreamAssignment?: CircuitPhaseAssignment
): PhaseAssignmentConstraint | undefined {
  if (!protection || !supportsExplicitPhaseSelection(system)) return undefined
  const poles = protection.polesConfig ? polesFromConfig(protection.polesConfig) : protection.poles
  if (poles == null) return undefined

  const normalized = normalizeNominalVoltageSystem(system ?? '2~')
  let constraint: PhaseAssignmentConstraint
  if (normalized === '3N~') {
    if (poles === 1) {
      constraint = { allowedKinds: ['single_phase'], activeConductorCount: 2 }
    } else if (poles === 2) {
      constraint = {
        allowedKinds: ['single_phase'],
        activeConductorCount: 2,
      }
    } else if (poles === 3) {
      constraint = { allowedKinds: ['three_phase'], activeConductorCount: 3 }
    } else {
      constraint = { allowedKinds: ['three_phase'], activeConductorCount: 4 }
    }
  } else {
    if (poles <= 2) {
      constraint = { allowedKinds: ['phase_to_phase'], activeConductorCount: 2 }
    } else {
      constraint = { allowedKinds: ['three_phase'], activeConductorCount: 3 }
    }
  }

  const inherited =
    isConcretePhaseAssignment(upstreamAssignment) &&
    upstreamAssignment.source !== 'derived_from_busbar'
      ? upstreamAssignment
      : undefined
  return {
    ...constraint,
    ...(inherited
      ? { allowedPhases: inherited.phases, inheritedAssignment: inherited }
      : upstreamAssignment?.source === 'derived_from_busbar'
        ? { inheritedAssignment: upstreamAssignment }
        : { requireExplicit: true }),
  }
}

/**
 * Resolve the exact conductors downstream of one serial protection. The result is
 * monotonic: a wider downstream device never restores a conductor already removed.
 */
export function getDownstreamProtectionPhaseAssignment(
  protection: Pick<ProtectionDevice, 'polesConfig' | 'poles'>,
  system: VoltageSystem,
  upstreamAssignment?: CircuitPhaseAssignment
): CircuitPhaseAssignment | undefined {
  const upstream = isConcretePhaseAssignment(upstreamAssignment)
    ? upstreamAssignment
    : getFullInstallationPhaseAssignment(system)
  if (!isConcretePhaseAssignment(upstream)) return upstreamAssignment
  const poles = getProtectionPoles(protection)
  if (poles == null) return upstream
  const availableLines = upstream.phases.filter(
    (phase): phase is AcLinePhase => phase === 'L1' || phase === 'L2' || phase === 'L3'
  )
  const hasNeutral = upstream.phases.includes('N')
  const normalized = normalizeNominalVoltageSystem(system ?? '2~')
  let phases: AcPhase[]
  if (normalized === '3N~') {
    if (poles <= 2 && hasNeutral) phases = [...availableLines.slice(0, 1), 'N']
    else if (poles <= 2) phases = availableLines.slice(0, poles)
    else if (poles === 3) phases = availableLines.slice(0, 3)
    else phases = [...availableLines, ...(hasNeutral ? (['N'] as const) : [])]
  } else {
    phases = availableLines.slice(0, Math.min(poles, availableLines.length))
  }
  if (phases.length >= upstream.phases.length) return upstream
  const lineCount = phases.filter(
    (phase) => phase === 'L1' || phase === 'L2' || phase === 'L3'
  ).length
  return {
    kind: lineCount >= 3 ? 'three_phase' : lineCount === 2 ? 'phase_to_phase' : 'single_phase',
    phases,
    neutral: phases.includes('N') ? 'used' : 'not_present',
    source: 'derived_from_busbar',
  }
}

function getRootFeedForPanel(
  installation: Installation,
  panels: Panel[],
  panel: Panel,
  busSectionId?: string
): RootPanelFeedPath | undefined {
  const targetBusSectionId = busSectionId ?? getPrimaryPanelBusSectionId(panel)
  return ensureInstallationFeedTopology(installation, panels).rootFeeds.find(
    (feed) =>
      feed.panelId === panel.id &&
      (feed.busSectionId ?? getPrimaryPanelBusSectionId(panel)) === targetBusSectionId
  )
}

function getAssemblyBusSectionAssignment(
  assemblies: readonly OffGridSupplyAssembly[],
  panel: Panel,
  busSectionId: string,
  system: VoltageSystem
): CircuitPhaseAssignment | undefined {
  const legacyPanelInputSectionId = hasExplicitPanelBusSections(panel)
    ? (panel.busSections?.find((section) => section.role === 'backup')?.id ??
      getPrimaryPanelBusSectionId(panel))
    : getPrimaryPanelBusSectionId(panel)
  const match = assemblies
    .flatMap((assembly) => assembly.loadHandoffs.map((handoff) => ({ assembly, handoff })))
    .find(({ handoff }) =>
      handoff.target.kind === 'panel-bus-input'
        ? handoff.target.panelId === panel.id && handoff.target.busSectionId === busSectionId
        : handoff.target.kind === 'panel-input' &&
          handoff.target.panelId === panel.id &&
          legacyPanelInputSectionId === busSectionId
    )
  if (!match) return undefined

  const installationLinePhases = getInstallationPhases(system).filter(
    (phase): phase is AcLinePhase => phase === 'L1' || phase === 'L2' || phase === 'L3'
  )
  const handoffPaths = deriveHandoffPhaseSupplyPaths(match.assembly, installationLinePhases).filter(
    (path) => path.handoffId === match.handoff.id
  )
  const linePhases = handoffPaths
    .filter((path) => path.backupConnectionIds.length > 0)
    .map((path) => path.phase)
  if (linePhases.length === 0) return undefined

  const neutralPresent =
    match.handoff.conductors.includes('N') &&
    match.assembly.nodes.some(
      (node) =>
        node.kind === 'inverter-unit' &&
        node.ports.some(
          (port) => port.role === 'inverter-backup-ac' && port.conductors.includes('N')
        )
    )
  const phases: AcPhase[] = neutralPresent ? [...linePhases, 'N'] : linePhases
  return {
    kind:
      linePhases.length >= 3
        ? 'three_phase'
        : linePhases.length === 2
          ? 'phase_to_phase'
          : 'single_phase',
    phases,
    neutral: neutralPresent ? 'used' : 'not_present',
    source: 'derived_from_busbar',
  }
}

function getFirstNarrowingRootProtection(
  feed: RootPanelFeedPath | undefined,
  system: VoltageSystem
): TrunkDevice | undefined {
  const fullCount = getActiveConductorCount(getFullInstallationPhaseAssignment(system))
  if (fullCount == null) return undefined
  return feed?.trunkDevices?.find((device) => {
    if (device.type !== 'protection') return false
    // Branch protections do not sit between the utility and this panel bus. In
    // particular, a 1P DC fuse on the inverter battery/PV branch must never be
    // mistaken for the panel's incoming AC narrowing protection.
    if (device.supplyPath && device.supplyPath !== 'serial') return false
    const constraint = getProtectionPhaseConstraint(device, system)
    return constraint?.activeConductorCount != null && constraint.activeConductorCount < fullCount
  })
}

function assignmentMatchesConstraint(
  assignment: CircuitPhaseAssignment | undefined,
  constraint: PhaseAssignmentConstraint | undefined
): assignment is CircuitPhaseAssignment {
  if (!isConcretePhaseAssignment(assignment) || !constraint) return false
  if (constraint.allowedKinds && !constraint.allowedKinds.includes(assignment.kind)) return false
  if (
    constraint.activeConductorCount != null &&
    getActiveConductorCount(assignment) !== constraint.activeConductorCount
  ) {
    return false
  }
  return true
}

/** Resolve the phase set on one main panel's private supply section. */
export function getPanelIncomingPhaseState(
  installation: Installation | undefined,
  panels: Panel[],
  panel: Panel,
  busSectionId?: string,
  supplyAssemblies: readonly OffGridSupplyAssembly[] = []
): PanelIncomingPhaseState {
  const system = installation
    ? resolvePanelNominalVoltage(installation, panels, panel.id).system
    : undefined
  if (!installation || !supportsExplicitPhaseSelection(system)) return {}
  if (panel.isMain === false) {
    const panelFeed = findPanelFeed(panel.id, panels)
    if (!panelFeed) return {}
    const inherited = getEffectiveCircuitPhaseState(
      panelFeed.feederCircuit,
      panels,
      system,
      installation
    )
    const output = getPanelFeedOutputPhaseState(panelFeed)
    return {
      assignment: output.assignment ?? inherited.assignment,
      showPhaseLabel: output.showPhaseLabel ?? inherited.showPhaseLabel,
      constraint: getInheritedPhaseConstraint(output.assignment ?? inherited.assignment),
    }
  }

  const rootFeed = getRootFeedForPanel(installation, panels, panel, busSectionId)
  const targetBusSectionId = busSectionId ?? getPrimaryPanelBusSectionId(panel)
  const assemblyAssignment = getAssemblyBusSectionAssignment(
    supplyAssemblies,
    panel,
    targetBusSectionId,
    system
  )
  const sectionOrder = getPanelBusSectionPhaseOrder(panel, busSectionId)
  const panelHasSupplyAssembly = supplyAssemblies.some(
    (assembly) =>
      ((assembly.incomingAttachment.kind === 'panel-input' ||
        assembly.incomingAttachment.kind === 'panel-bus-input') &&
        assembly.incomingAttachment.panelId === panel.id) ||
      assembly.loadHandoffs.some(
        (handoff) =>
          (handoff.target.kind === 'panel-input' ||
            handoff.target.kind === 'panel-bus-input' ||
            handoff.target.kind === 'circuit-input') &&
          handoff.target.panelId === panel.id
      )
  )
  const normalizedSystem = normalizeNominalVoltageSystem(system ?? '2~')
  const sectionAssignment: CircuitPhaseAssignment | undefined =
    sectionOrder && sectionOrder.length > 0 && sectionOrder.length < 3
      ? normalizedSystem === '3N~' && sectionOrder.length === 1
        ? {
            kind: 'single_phase',
            phases: [sectionOrder[0]!, 'N'],
            neutral: 'used',
            source: 'derived_from_busbar',
          }
        : normalizedSystem === '3~' && sectionOrder.length === 2
          ? {
              kind: 'phase_to_phase',
              phases: [...sectionOrder],
              neutral: 'not_present',
              source: 'derived_from_busbar',
            }
          : undefined
      : undefined
  // A split panel's source graph is authoritative. Persisted per-feed/section hints can
  // outlive an earlier 1x/2x inverter setup and must not keep narrowing a now-full 3x
  // assembly after every physical protection has been expanded to the installation width.
  const configuredAssignment = panelHasSupplyAssembly
    ? assemblyAssignment
    : isConcretePhaseAssignment(rootFeed?.phaseAssignment)
      ? rootFeed.phaseAssignment
      : sectionAssignment
  const narrowingProtection = getFirstNarrowingRootProtection(rootFeed, system)
  if (!narrowingProtection) {
    return {
      configuredAssignment,
      assignment: configuredAssignment ?? getFullInstallationPhaseAssignment(system),
      showPhaseLabel: rootFeed?.showPhaseLabel,
    }
  }

  const shapeConstraint = getProtectionPhaseConstraint(narrowingProtection, system)
  const rootPanelIndex = Math.max(
    0,
    collectRootPanels(panels).findIndex((candidate) => candidate.id === panel.id)
  )
  const poles = getProtectionPoles(narrowingProtection) ?? 2
  const normalized = normalizeNominalVoltageSystem(system ?? '2~')
  const slotIndex = normalized === '3~' ? rootPanelIndex * Math.max(1, poles) : rootPanelIndex
  const automaticAssignment = assignmentForBusbarSlot(
    system,
    DEFAULT_BUSBAR_PHASE_ORDER,
    slotIndex,
    poles
  )
  const assignment = assignmentMatchesConstraint(configuredAssignment, shapeConstraint)
    ? configuredAssignment
    : automaticAssignment

  return {
    configuredAssignment,
    assignment,
    showPhaseLabel: rootFeed?.showPhaseLabel,
    lockedByProtectionId: narrowingProtection.id,
    constraint: getInheritedPhaseConstraint(assignment),
  }
}

function isConcretePhaseAssignment(
  assignment: CircuitPhaseAssignment | undefined
): assignment is CircuitPhaseAssignment {
  return !!assignment && assignment.kind !== 'inherit' && assignment.kind !== 'dc'
}

type PanelFeedInfo = {
  feederCircuit: Circuit
  sourcePanelEndpoint?: Endpoint
}

/** The nearest concrete module output narrows the board's actual incoming feed. */
function getPanelFeedOutputPhaseState(feed: PanelFeedInfo): InheritedCircuitPhaseState {
  let endpoint = feed.sourcePanelEndpoint
  const visited = new Set<string>()
  let showPhaseLabel: boolean | undefined
  while (endpoint?.domoticaChildProps && !visited.has(endpoint.id)) {
    visited.add(endpoint.id)
    const ref = endpoint.domoticaChildProps
    const parent = feed.feederCircuit.endpoints.find((candidate) => candidate.id === ref.parentEndpointId)
    const output = parent?.domoticaProps?.endpointOutputWires?.[ref.outputIndex]
    showPhaseLabel ??= output?.showPhaseLabel
    if (isConcretePhaseAssignment(output?.phaseAssignment)) return { assignment: output.phaseAssignment, showPhaseLabel }
    endpoint = parent
  }
  return { showPhaseLabel }
}

function findPanelForCircuit(circuitId: string, panels: Panel[]): Panel | undefined {
  return findCircuitContext(circuitId, panels)?.panel
}

/** Find the circuit carrying a panel's incoming feeder from its parent panel. */
/** Circuits behind a board with its own transformer output use that board's system. */
function resolveCircuitSystem(
  circuit: Circuit,
  panels: Panel[],
  system: VoltageSystem,
  installation: Installation | undefined
): VoltageSystem {
  if (!installation || system !== installation.nominalVoltage.system ||
    !installationSupportsFeedVoltages(installation)) return system
  const panel = findPanelForCircuit(circuit.id, panels)
  return panel ? resolvePanelNominalVoltage(installation, panels, panel.id).system : system
}

function findPanelFeed(panelId: string, panels: Panel[]): PanelFeedInfo | undefined {
  const index = getElectricalSnapshotIndex(panels)
  if (index) return index.panelFeedersByPanelId.get(panelId)
  const link = resolvePanelSupplyLinkForPanelInPanels(panels, panelId)
  return link?.feederCircuit ? { feederCircuit: link.feederCircuit, sourcePanelEndpoint: link.sourcePanelEndpoint } : undefined
}

function getInheritedCircuitPhaseStateInternal(
  circuit: Circuit,
  panels: Panel[],
  visitedCircuits: Set<string>,
  visitedPanels: Set<string>,
  system?: VoltageSystem,
  installation?: Installation
): InheritedCircuitPhaseState {
  system = resolveCircuitSystem(circuit, panels, system, installation)
  if (visitedCircuits.has(circuit.id)) return {}
  const nextVisitedCircuits = new Set(visitedCircuits).add(circuit.id)

  // A panel feed is the outermost electrical boundary. Its lock dominates any
  // local circuit assignment, because every circuit in the child panel receives
  // the same incoming phase set.
  const panel = findPanelForCircuit(circuit.id, panels)
  const panelFeed = panel ? findPanelFeed(panel.id, panels) : undefined
  const upstreamPanelState =
    panel && panelFeed && !visitedPanels.has(panel.id)
      ? getEffectiveCircuitPhaseStateInternal(
          panelFeed.feederCircuit,
          panels,
          nextVisitedCircuits,
          new Set(visitedPanels).add(panel.id),
          system,
          installation
        )
      : panel?.isMain
        ? { assignment: getPanelIncomingPhaseState(installation, panels, panel).assignment }
        : {}
  const outputState = panelFeed ? getPanelFeedOutputPhaseState(panelFeed) : {}
  const panelState = {
    assignment: outputState.assignment ?? upstreamPanelState.assignment,
    showPhaseLabel: outputState.showPhaseLabel ?? upstreamPanelState.showPhaseLabel,
  }

  const parent = findParentCircuitInfo(circuit.id, panels)
  const parentState = parent
    ? getEffectiveCircuitPhaseStateInternal(
        parent.parentCircuit,
        panels,
        nextVisitedCircuits,
        visitedPanels,
        system,
        installation
      )
    : {}

  const context = system ? findCircuitContext(circuit.id, panels) : undefined
  const groupedProtection = context?.protection
  const protectionState =
    system &&
    context &&
    groupedProtection &&
    (groupedProtection.type === 'RCD' || groupedProtection.type === 'RCBO') &&
    (groupedProtection.circuits?.length ?? 0) > 1
      ? getMainBusProtectionPhaseAssignment(context.panel, groupedProtection, system)
      : undefined

  return {
    assignment: [panelState.assignment, parentState.assignment, protectionState].find(
      (assignment) =>
        assignment && (!system || phaseAssignmentDiffersFromInstallation(assignment, system))
    ),
    showPhaseLabel: parentState.showPhaseLabel ?? panelState.showPhaseLabel,
  }
}

function getEffectiveCircuitPhaseStateInternal(
  circuit: Circuit,
  panels: Panel[],
  visitedCircuits: Set<string>,
  visitedPanels: Set<string>,
  system?: VoltageSystem,
  installation?: Installation
): InheritedCircuitPhaseState {
  system = resolveCircuitSystem(circuit, panels, system, installation)
  if (visitedCircuits.has(circuit.id)) return {}
  const inherited = getInheritedCircuitPhaseStateInternal(
    circuit,
    panels,
    visitedCircuits,
    visitedPanels,
    system,
    installation
  )
  return {
    assignment:
      inherited.assignment ??
      (isConcretePhaseAssignment(circuit.phaseAssignment)
        ? circuit.phaseAssignment
        : system
          ? getAutomaticBusbarPhaseAssignment(circuit, panels, system)
          : undefined),
    showPhaseLabel: circuit.showPhaseLabel ?? inherited.showPhaseLabel,
  }
}

/** Resolve the phase lock inherited from parent circuits and panel feeders. */
export function getInheritedCircuitPhaseState(
  circuit: Circuit,
  panels: Panel[],
  system?: VoltageSystem,
  installation?: Installation
): InheritedCircuitPhaseState {
  return getInheritedCircuitPhaseStateInternal(
    circuit,
    panels,
    new Set(),
    new Set(),
    system,
    installation
  )
}

export function getEffectiveCircuitPhaseState(
  circuit: Circuit,
  panels: Panel[],
  system?: VoltageSystem,
  installation?: Installation
): InheritedCircuitPhaseState {
  return getEffectiveCircuitPhaseStateInternal(
    circuit,
    panels,
    new Set(),
    new Set(),
    system,
    installation
  )
}

export function getFullInstallationPhaseAssignment(
  system: VoltageSystem
): CircuitPhaseAssignment | undefined {
  // Phase selection is intentionally a three-phase-only feature. In particular,
  // 2×230 V has two active conductors but no user-facing phase identity.
  if (!supportsExplicitPhaseSelection(system)) return undefined
  const phases = getInstallationPhases(system)
  if (phases.length === 0) return undefined
  const active = phases.filter((phase) => phase !== 'N' && phase !== 'PE')
  const kind =
    active.length === 1 ? 'single_phase' : active.length === 2 ? 'phase_to_phase' : 'three_phase'
  return {
    kind,
    phases,
    neutral: phases.includes('N') ? 'used' : 'not_present',
    source: 'derived_from_voltage',
  }
}

export function getActiveConductorCount(
  assignment: CircuitPhaseAssignment | undefined
): number | undefined {
  if (!assignment || assignment.kind === 'inherit' || assignment.kind === 'dc') return undefined
  return assignment.phases.filter(
    (phase) => phase === 'L1' || phase === 'L2' || phase === 'L3' || phase === 'N'
  ).length
}

/** Hard-gate a downstream wire to the exact phase shape inherited from upstream. */
export function getInheritedPhaseConstraint(
  assignment: CircuitPhaseAssignment | undefined
): PhaseAssignmentConstraint | undefined {
  if (!isConcretePhaseAssignment(assignment)) return undefined
  return {
    allowedKinds: [assignment.kind],
    activeConductorCount: getActiveConductorCount(assignment),
    allowedPhases: assignment.phases,
    inheritedAssignment: assignment,
  }
}

function samePhaseSet(left: AcPhase[], right: AcPhase[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((phase) => rightSet.has(phase))
}

/** Returns false for inherited/full-installation assignments so normal diagrams stay quiet. */
export function phaseAssignmentDiffersFromInstallation(
  assignment: CircuitPhaseAssignment | undefined,
  system: VoltageSystem
): boolean {
  if (
    !supportsExplicitPhaseSelection(system) ||
    !assignment ||
    assignment.kind === 'inherit' ||
    assignment.kind === 'dc'
  ) {
    return false
  }
  return !samePhaseSet(
    assignment.phases.filter((phase) => phase !== 'PE'),
    getInstallationPhases(system).filter((phase) => phase !== 'PE')
  )
}

export function formatPhaseAssignment(assignment: CircuitPhaseAssignment | undefined): string {
  if (!assignment || assignment.kind === 'inherit') return ''
  const phases = assignment.phases.filter((phase) => phase !== 'PE')
  if (phases.length === 0) return ''
  return phases.join('-')
}

export function getPhaseAssignmentLabel(
  assignment: CircuitPhaseAssignment | undefined,
  system: VoltageSystem
): string | undefined {
  if (
    !supportsExplicitPhaseSelection(system) ||
    !assignment ||
    assignment.kind === 'inherit' ||
    assignment.kind === 'dc'
  ) {
    return undefined
  }
  return formatPhaseAssignment(assignment) || undefined
}

/**
 * Narrowed phase sets are labelled by default. An explicit false remains a
 * user override, while true can also expose the complete installation set.
 */
export function isPhaseAssignmentLabelVisible(
  assignment: CircuitPhaseAssignment | undefined,
  system: VoltageSystem,
  configuredVisibility?: boolean
): boolean {
  if (!getPhaseAssignmentLabel(assignment, system)) return false
  if (configuredVisibility != null) return configuredVisibility
  return phaseAssignmentDiffersFromInstallation(assignment, system)
}

/** Resolve the phase label using the default/explicit visibility contract. */
export function getVisiblePhaseAssignmentLabel(
  assignment: CircuitPhaseAssignment | undefined,
  system: VoltageSystem,
  configuredVisibility?: boolean
): string | undefined {
  return isPhaseAssignmentLabelVisible(assignment, system, configuredVisibility)
    ? getPhaseAssignmentLabel(assignment, system)
    : undefined
}

/** Resolve the phase annotation shown beside a protection. */
export function getProtectionPhaseLabel(
  protection: ProtectionDevice,
  system: VoltageSystem,
  panels: Panel[] = [],
  installation?: Installation
): string | undefined {
  const candidates = (protection.circuits ?? []).map((circuit) => {
    const inherited = getInheritedCircuitPhaseState(circuit, panels, system, installation)
    const effective = getEffectiveCircuitPhaseState(circuit, panels, system, installation)
    return getVisiblePhaseAssignmentLabel(
      effective.assignment,
      system,
      circuit.showPhaseLabel ?? inherited.showPhaseLabel
    )
  })
  return candidates.find((label): label is string => label != null)
}
