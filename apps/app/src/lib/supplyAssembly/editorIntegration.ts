import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  editProjectSupplyAssemblies,
  selectProjectSupplyAssemblies,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { collectRootPanels, ensureInstallationFeedTopology } from '@/lib/feedTopology'
import { getInstallationPhases } from '@/lib/wires/phaseAssignment'
import { getSymbolById } from '@/lib/symbols'
import type { AcPhase, Circuit, ProtectionDevice, TrunkDevice } from '@/types/schema'
import type {
  BackupSourceCapabilities,
  OffGridSupplyAssembly,
  SupplyConnection,
  SupplyConductor,
  SupplyNode,
  SupplyPort,
  SupplyProtectionProperties,
} from '@/types/supplyAssembly'
import {
  getSupplyConverterAcConductors,
  getSupplyInverterUnitPhaseAssignments,
} from './supplyConverterPhases'
import { logger } from '@/lib/logger'
import { supplyNodeReferencesDevice } from './deviceReferences'
import { enableDirectInverterPanelBackup } from './directInverterPanelBackup'
import { DOMOTICA_MAX_ENDPOINT_OUTPUTS } from '@/lib/domoticaLayout'
import { supportsCircuitConverterDcConnections } from '@/lib/layout/circuitConverterGeometry'
import {
  getSupplyNodePhysicalDeviceId,
  isGeneratedCommonPanelHandoff,
  resolveAssemblyPanelInput,
} from './electricalTopology'
import { getSupplyConverterDcConnectionIndex } from './converterDcConnections'

/** Pull extra trunk devices into the assembly graph for this reconcile pass only. */
export type SupplyAssemblyReconcileOptions = {
  absorbDeviceIds?: Iterable<string>
  absorbNewSerialDevices?: boolean
}

function assemblyOwnedPhysicalDeviceIds(
  assembly: OffGridSupplyAssembly,
  extraIds?: Iterable<string>
): Set<string> {
  const ids = new Set<string>()
  for (const node of assembly.nodes) {
    const deviceId = getSupplyNodePhysicalDeviceId(node)
    if (deviceId) ids.add(deviceId)
  }
  if (extraIds) {
    for (const id of extraIds) ids.add(id)
  }
  return ids
}

function selectSerialLoadDevicesForAssembly(
  devices: TrunkDevice[],
  afterIndex: number,
  ownedDeviceIds: Set<string>,
  options?: SupplyAssemblyReconcileOptions
): TrunkDevice[] {
  const serial = devices.filter((device, index) => {
    if (index <= afterIndex || device.supplyPanelInput) return false
    return device.supplyPath == null || device.supplyPath === 'serial'
  })
  if (options?.absorbNewSerialDevices) return serial
  const absorb = new Set(options?.absorbDeviceIds ?? [])
  const lastOwned = serial.findLastIndex((device) => ownedDeviceIds.has(device.id))
  return serial.filter((device, index) => {
    if (ownedDeviceIds.has(device.id) || absorb.has(device.id)) return true
    // Historical common-path devices omitted from the graph sit before the current
    // tail. Continuation-rail devices are appended after that tail and must stay
    // on the panel-only feed.
    return lastOwned === -1 || index < lastOwned
  })
}

const BACKUP_CONVERSION_SYMBOLS = new Set([
  'transformer',
  'rectifier',
  'inverter',
  'dc_dc_converter',
])

const SUPPLY_ASSEMBLY_BRANCH_PATHS = new Set<TrunkDevice['supplyPath']>([
  'backup',
  'backup-output',
  'changeover-grid',
  'converter-grid',
  'converter-branch',
  'converter-dc',
  'converter-dc-top',
])

function isInverterUnitNode(
  node: SupplyNode
): node is Extract<SupplyNode, { kind: 'inverter-unit' }> {
  return node.kind === 'inverter-unit'
}

function isAssemblyOnlySupplyDevice(device: TrunkDevice): boolean {
  return (
    device.symbol === 'source_changeover' || SUPPLY_ASSEMBLY_BRANCH_PATHS.has(device.supplyPath)
  )
}

function acConductors(project: ProjectWithOptionalV2Electrical): AcPhase[] {
  const system = getProjectElectricalInstallation(project)?.nominalVoltage.system
  const phases = getInstallationPhases(system ?? '1N~')
  return phases.length > 0 ? phases : ['L1', 'N']
}

function port(
  id: string,
  role: SupplyPort['role'],
  conductors: AcPhase[],
  behavior: SupplyPort['behavior'],
  maxConnections: number | 'many' = 1
): SupplyPort {
  return { id, role, domain: 'AC', behavior, conductors: [...conductors], maxConnections }
}

function connection(
  id: string,
  first: [string, string],
  second: [string, string],
  pathRole: SupplyConnection['pathRole'],
  conductors: AcPhase[]
): SupplyConnection {
  return {
    id,
    endpoints: [
      { nodeId: first[0], portId: first[1] },
      { nodeId: second[0], portId: second[1] },
    ],
    domain: 'AC',
    conductors: [...conductors],
    pathRole,
  }
}

function dcPort(
  id: string,
  role: Extract<SupplyPort['role'], 'battery-dc' | 'dc-bus' | 'solar-dc'>,
  behavior: SupplyPort['behavior'],
  maxConnections: number | 'many' = 1
): SupplyPort {
  return {
    id,
    role,
    domain: 'DC',
    behavior,
    conductors: ['DC+', 'DC-'],
    maxConnections,
  }
}

function domoticaOutputPorts(device: TrunkDevice): SupplyPort[] {
  // A domotica module mounted on a supply DC bus is a DC device, not a
  // regular-panel trunk parent. It therefore has no child endpoint ports.
  if (device.symbol !== 'domotica' || device.supplyDcBusId != null) return []
  const count = Math.max(
    1,
    Math.min(DOMOTICA_MAX_ENDPOINT_OUTPUTS, Math.trunc(device.domoticaProps?.endpointCount ?? 1))
  )
  return Array.from({ length: count }, (_, index) => dcPort(`output-${index}`, 'dc-bus', 'sink', 1))
}

function dcConnection(
  id: string,
  first: [string, string],
  second: [string, string],
  pathRole: Extract<SupplyConnection['pathRole'], 'battery-dc' | 'solar-dc' | 'dc-bus'>
): SupplyConnection {
  return {
    id,
    endpoints: [
      { nodeId: first[0], portId: first[1] },
      { nodeId: second[0], portId: second[1] },
    ],
    domain: 'DC',
    conductors: ['DC+', 'DC-'],
    pathRole,
  }
}

function assemblyIds(changeoverId: string) {
  return {
    assembly: `supply-assembly-${changeoverId}`,
    utility: `utility-${changeoverId}`,
    handoff: `handoff-${changeoverId}`,
    handoffRecord: `handoff-record-${changeoverId}`,
    gridToChangeover: `grid-to-${changeoverId}`,
    changeoverToHandoff: `${changeoverId}-to-handoff`,
  }
}

/**
 * Canonical graph counterpart for the modular switch shown in the ordinary one-wire supply path.
 * Trunk devices remain the editor's placeable symbols; this graph records their electrical roles.
 */
export function buildChangeoverSupplyAssembly(
  project: ProjectWithOptionalV2Electrical,
  panelId: string,
  changeover: TrunkDevice
): OffGridSupplyAssembly {
  const conductors = acConductors(project)
  const liveConductors = conductors.filter((conductor) => conductor !== 'N' && conductor !== 'PE')
  const switchedConductors = conductors.filter((conductor) => conductor !== 'PE')
  const ids = assemblyIds(changeover.id)
  const neutralPresent = conductors.includes('N')
  const nodes: SupplyNode[] = [
    {
      id: ids.utility,
      kind: 'utility-source',
      symbol: 'mains',
      label: 'Grid',
      properties: { origin: 'grid' },
      ports: [port('out', 'utility-ac', conductors, 'source', 'many')],
    },
    {
      id: changeover.id,
      deviceId: changeover.id,
      kind: 'changeover-switch',
      symbol: 'source_changeover',
      label: changeover.label,
      properties: {
        switchingMode: 'manual',
        transition: 'break-before-make',
        poles: Math.min(4, Math.max(1, switchedConductors.length)) as 1 | 2 | 3 | 4,
        switchedConductors,
        neutralTreatment: neutralPresent ? 'switched' : 'not-present',
        port1Label: changeover.changeoverProps?.port1Label ?? '1',
        port2Label: changeover.changeoverProps?.port2Label ?? '2',
      },
      ports: [
        port('grid', 'source-grid-ac', conductors, 'sink'),
        port('backup', 'source-backup-ac', conductors, 'sink'),
        // A supply assembly can feed more than one parallel main panel. Each
        // panel gets its own handoff from this common switched load output.
        port('load', 'load-ac', conductors, 'source', 'many'),
      ],
    },
    {
      id: ids.handoff,
      kind: 'panel-handoff',
      symbol: 'panel_distribution',
      label: 'Main panel',
      properties: {},
      ports: [port('in', 'panel-handoff', conductors, 'sink')],
    },
  ]

  return {
    id: ids.assembly,
    graphVersion: 1,
    presetIntent: liveConductors.length >= 3 ? 'custom_phase_mapping' : 'single_phase_installation',
    incomingAttachment: { kind: 'panel-input', panelId },
    loadHandoffs: [
      {
        id: ids.handoffRecord,
        handoffNodeId: ids.handoff,
        target: { kind: 'panel-input', panelId },
        conductors: [...conductors],
      },
    ],
    nodes,
    connections: [
      connection(
        ids.gridToChangeover,
        [ids.utility, 'out'],
        [changeover.id, 'grid'],
        'grid-ac',
        conductors
      ),
      connection(
        ids.changeoverToHandoff,
        [changeover.id, 'load'],
        [ids.handoff, 'in'],
        'load-ac',
        conductors
      ),
    ],
    inverterGroups: [],
  }
}

export function findAssemblyForChangeover(
  project: ProjectWithOptionalV2Electrical,
  changeoverId: string
): OffGridSupplyAssembly | undefined {
  return selectProjectSupplyAssemblies(project).find((assembly) =>
    assembly.nodes.some(
      (node) => node.kind === 'changeover-switch' && supplyNodeReferencesDevice(node, changeoverId)
    )
  )
}

function changeoverConductors(device: TrunkDevice, available: AcPhase[]): AcPhase[] {
  const config = device.polesConfig
  if (!config && device.poles == null) return [...available]
  const linePhases = available.filter(
    (phase): phase is Extract<AcPhase, 'L1' | 'L2' | 'L3'> =>
      phase === 'L1' || phase === 'L2' || phase === 'L3'
  )
  const hasNeutral = available.includes('N')
  if (config === '1P') return linePhases.slice(0, 1)
  if (config === '1P+N' || (config === '2P' && hasNeutral)) {
    return [...linePhases.slice(0, 1), ...(hasNeutral ? (['N'] as const) : [])]
  }
  if (config === '2P') return linePhases.slice(0, 2)
  if (config === '3P') return linePhases.slice(0, 3)
  if (config === '3P+N' || config === '4P') return [...available]
  const poles = Math.max(1, Math.min(4, device.poles ?? available.length))
  if (hasNeutral && poles === 2) return [...linePhases.slice(0, 1), 'N']
  if (hasNeutral && poles >= 4) return [...available]
  return linePhases.slice(0, poles)
}

const AC_CONDUCTOR_ORDER: AcPhase[] = ['L1', 'L2', 'L3', 'N', 'PE']

function orderedAcConductors(conductors: Iterable<SupplyConductor>): AcPhase[] {
  return Array.from(
    new Set(
      Array.from(conductors).filter(
        (conductor): conductor is AcPhase => conductor !== 'DC+' && conductor !== 'DC-'
      )
    )
  ).sort((left, right) => AC_CONDUCTOR_ORDER.indexOf(left) - AC_CONDUCTOR_ORDER.indexOf(right))
}

function intersectAcConductors(available: AcPhase[], capability: AcPhase[]): AcPhase[] {
  const intersection = available.filter((conductor) => capability.includes(conductor))
  // A neutral on its own is not an energized AC path.
  return intersection.some(
    (conductor) => conductor === 'L1' || conductor === 'L2' || conductor === 'L3'
  )
    ? orderedAcConductors(intersection)
    : []
}

function applyProtectionConductorLimit(
  available: AcPhase[],
  protection: Pick<TrunkDevice, 'polesConfig' | 'poles'>
): AcPhase[] {
  return changeoverConductors(protection as TrunkDevice, available)
}

function getAssemblyPanelId(
  assembly: OffGridSupplyAssembly,
  project?: ProjectWithOptionalV2Electrical
): string | undefined {
  if (project) {
    const input = resolveAssemblyPanelInput(project, assembly.incomingAttachment)
    if (input) return input.panelId
  }
  if (
    assembly.incomingAttachment.kind === 'panel-input' ||
    assembly.incomingAttachment.kind === 'panel-bus-input'
  ) {
    return assembly.incomingAttachment.panelId
  }
  const panelHandoff = assembly.loadHandoffs.find(
    (handoff) => handoff.target.kind === 'panel-input' || handoff.target.kind === 'panel-bus-input'
  )
  return panelHandoff?.target.kind === 'panel-input' ||
    panelHandoff?.target.kind === 'panel-bus-input'
    ? panelHandoff.target.panelId
    : undefined
}

/**
 * Conductors available at the utility node after every serial shared/root protection.
 * Branch protections are deliberately excluded: they narrow only their own path below.
 */
function getAssemblyUtilityConductors(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): AcPhase[] {
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return acConductors(project)
  const topology = ensureInstallationFeedTopology(installation, getProjectElectricalPanels(project))
  const root = topology.rootFeeds.find((feed) => feed.panelId === panelId)
  const upstreamDevices = [
    ...(topology.sharedFeed.trunkDevices ?? []),
    ...(root?.trunkDevices ?? []),
  ]
  const owningAssembly = selectProjectSupplyAssemblies(project).find(
    (assembly) => getAssemblyPanelId(assembly, project) === panelId
  )
  const boundary = upstreamDevices.findIndex((device) =>
    owningAssembly?.nodes.some((node) => getSupplyNodePhysicalDeviceId(node) === device.id)
  )
  // A switched assembly's serial load protections are part of the common load
  // path and must remain visible to the phase projection. A direct converter's
  // post-split protections belong only to its panel fan-out and must not narrow
  // the converter's grid branch.
  const phaseSourceDevices = owningAssembly?.nodes.some((node) => node.kind === 'changeover-switch')
    ? upstreamDevices
    : boundary < 0
      ? upstreamDevices
      : upstreamDevices.slice(0, boundary)
  const serialProtections = phaseSourceDevices.filter(
    (device) =>
      device.type === 'protection' &&
      device.symbol !== 'relay' &&
      (device.supplyPath == null || device.supplyPath === 'serial')
  )
  return serialProtections.reduce(
    (available, device) => applyProtectionConductorLimit(available, device),
    acConductors(project)
  )
}

/**
 * Recompute every AC connection from its real upstream source. This is intentionally a
 * monotonic flow pass: a later wider protection can never restore phases removed earlier.
 * Grid and backup inputs remain independent until the changeover load port combines them.
 */
export function reconcileSupplyAssemblyAcConductorFlow(
  project: ProjectWithOptionalV2Electrical,
  panelId?: string
): boolean {
  const assemblies = editProjectSupplyAssemblies(project).filter(
    (assembly) => !panelId || getAssemblyPanelId(assembly, project) === panelId
  )
  if (assemblies.length === 0) return false
  const installation = getProjectElectricalInstallation(project)
  const topology = installation
    ? ensureInstallationFeedTopology(installation, getProjectElectricalPanels(project))
    : undefined
  let changed = false

  for (const assembly of assemblies) {
    const ownerPanelId = getAssemblyPanelId(assembly, project)
    if (!ownerPanelId) continue
    const previous = JSON.stringify(assembly)
    const nodesById = new Map(assembly.nodes.map((node) => [node.id, node]))
    const state = new Map<string, AcPhase[]>()
    const key = (nodeId: string, portId: string) => `${nodeId}\u0000${portId}`
    const endpointFlowScore = (
      endpoint: SupplyConnection['endpoints'][number],
      pathRole: SupplyConnection['pathRole']
    ): number => {
      const node = nodesById.get(endpoint.nodeId)
      const candidate = node?.ports.find((portCandidate) => portCandidate.id === endpoint.portId)
      if (!node || !candidate) return 0
      if (pathRole === 'inverter-backup-ac' && candidate.role === 'inverter-backup-ac') return 20
      if (pathRole === 'load-ac' && candidate.role === 'load-ac') return 20
      if (
        (pathRole === 'grid-ac' || pathRole === 'inverter-grid-ac') &&
        candidate.role === 'utility-ac'
      ) {
        return 20
      }
      if (candidate.role === 'serial-load-side') return 10
      if (candidate.role === 'serial-source-side') return -10
      if (
        candidate.role === 'source-grid-ac' ||
        candidate.role === 'source-backup-ac' ||
        candidate.role === 'panel-handoff' ||
        candidate.role === 'inverter-grid-ac'
      ) {
        return -20
      }
      return candidate.behavior === 'source' ? 5 : candidate.behavior === 'sink' ? -5 : 0
    }
    const setState = (nodeId: string, portId: string, conductors: AcPhase[]): boolean => {
      const stateKey = key(nodeId, portId)
      const next = orderedAcConductors([...(state.get(stateKey) ?? []), ...conductors])
      const current = state.get(stateKey) ?? []
      if (next.join('|') === current.join('|')) return false
      state.set(stateKey, next)
      return true
    }

    const inverterCapabilities = new Map<string, AcPhase[]>()
    for (const group of assembly.inverterGroups) {
      const baseNode = assembly.nodes.find((node) => node.id === group.unitNodeIds[0])
      const deviceId = baseNode?.deviceId ?? baseNode?.id
      const converter = topology?.rootFeeds
        .flatMap((feed) => feed.trunkDevices ?? [])
        .find((device) => device.id === deviceId)
      if (!converter) continue
      const assignments = getSupplyInverterUnitPhaseAssignments(
        converter,
        installation?.nominalVoltage.system ?? '1N~',
        group.unitNodeIds.length
      )
      group.unitNodeIds.forEach((nodeId, index) => {
        inverterCapabilities.set(nodeId, orderedAcConductors(assignments[index]?.phases ?? []))
      })
    }

    const utilityConductors = getAssemblyUtilityConductors(project, ownerPanelId)
    for (const utility of assembly.nodes.filter((node) => node.kind === 'utility-source')) {
      for (const utilityPort of utility.ports.filter((candidate) => candidate.domain === 'AC')) {
        utilityPort.conductors = [...utilityConductors]
        setState(utility.id, utilityPort.id, utilityConductors)
      }
    }
    for (const inverter of assembly.nodes.filter(isInverterUnitNode)) {
      const capability = inverterCapabilities.get(inverter.id)
      if (!capability) continue
      const backupPort = inverter.ports.find((candidate) => candidate.role === 'inverter-backup-ac')
      if (backupPort) {
        backupPort.conductors = [...capability]
        setState(inverter.id, backupPort.id, capability)
      }
    }

    // Connections are persisted in source-to-load order. Iterate to a fixed point so
    // parallel inverter units can merge before a shared protection narrows their union.
    for (
      let iteration = 0;
      iteration < assembly.nodes.length + assembly.connections.length + 4;
      iteration++
    ) {
      let progressed = false

      for (const node of assembly.nodes) {
        if (node.kind === 'protection') {
          const sourcePort = node.ports.find((candidate) => candidate.id === 'source')
          const loadPort = node.ports.find((candidate) => candidate.id === 'load')
          const incoming = sourcePort ? state.get(key(node.id, sourcePort.id)) : undefined
          if (!sourcePort || !loadPort || !incoming?.length) continue
          sourcePort.conductors = [...incoming]
          const outgoing = applyProtectionConductorLimit(incoming, node.properties)
          loadPort.conductors = [...outgoing]
          progressed = setState(node.id, loadPort.id, outgoing) || progressed
        } else if (node.kind === 'ac-distribution') {
          // Serial branch devices (meters, junctions, and legacy protection snapshots)
          // are often persisted with `passive` behavior on both ports. Their roles are
          // the authoritative direction in that case: source-side receives the feed and
          // load-side passes it onward. Without this fallback, a stale empty load port
          // breaks the entire backup route and makes the feed organization appear
          // unavailable after reload.
          const inputPorts = node.ports.filter(
            (candidate) =>
              candidate.domain === 'AC' &&
              (candidate.behavior === 'sink' || candidate.role === 'serial-source-side')
          )
          const outputPorts = node.ports.filter(
            (candidate) =>
              candidate.domain === 'AC' &&
              candidate.role !== 'serial-source-side' &&
              (candidate.role === 'serial-load-side' || candidate.behavior !== 'sink')
          )
          const incoming = orderedAcConductors(
            inputPorts.flatMap((candidate) => state.get(key(node.id, candidate.id)) ?? [])
          )
          for (const outputPort of outputPorts) {
            outputPort.conductors = [...incoming]
            progressed = setState(node.id, outputPort.id, incoming) || progressed
          }
        } else if (node.kind === 'changeover-switch') {
          const gridPort = node.ports.find((candidate) => candidate.id === 'grid')
          const backupPort = node.ports.find((candidate) => candidate.id === 'backup')
          const loadPort = node.ports.find((candidate) => candidate.id === 'load')
          if (!loadPort) continue
          const switched = orderedAcConductors(node.properties.switchedConductors)
          const available = orderedAcConductors([
            ...(gridPort ? (state.get(key(node.id, gridPort.id)) ?? []) : []),
            ...(backupPort ? (state.get(key(node.id, backupPort.id)) ?? []) : []),
          ])
          const outgoing = intersectAcConductors(available, switched)
          loadPort.conductors = [...outgoing]
          progressed = setState(node.id, loadPort.id, outgoing) || progressed
        }
      }

      for (const candidate of assembly.connections.filter(
        (connection) => connection.domain === 'AC'
      )) {
        const [first, second] = candidate.endpoints
        const [from, to] =
          endpointFlowScore(first, candidate.pathRole) >=
          endpointFlowScore(second, candidate.pathRole)
            ? [first, second]
            : [second, first]
        const available = state.get(key(from.nodeId, from.portId))
        if (!available?.length) continue
        const targetNode = nodesById.get(to.nodeId)
        let delivered = available
        if (targetNode?.kind === 'inverter-unit') {
          const capability = inverterCapabilities.get(targetNode.id)
          if (capability) delivered = intersectAcConductors(available, capability)
        } else if (targetNode?.kind === 'changeover-switch') {
          delivered = intersectAcConductors(
            available,
            orderedAcConductors(targetNode.properties.switchedConductors)
          )
        }
        candidate.conductors = [...delivered]
        progressed = setState(to.nodeId, to.portId, delivered) || progressed
      }
      if (!progressed) break
    }

    for (const node of assembly.nodes) {
      for (const candidate of node.ports.filter((portCandidate) => portCandidate.domain === 'AC')) {
        const resolved = state.get(key(node.id, candidate.id))
        candidate.conductors = resolved ? [...resolved] : orderedAcConductors(candidate.conductors)
      }
    }
    for (const handoff of assembly.loadHandoffs) {
      const handoffNode = nodesById.get(handoff.handoffNodeId)
      const conductors = orderedAcConductors(
        handoffNode?.ports
          .filter((candidate) => candidate.domain === 'AC')
          .flatMap((candidate) => state.get(key(handoffNode.id, candidate.id)) ?? []) ?? []
      )
      if (conductors.length > 0) handoff.conductors = conductors
    }
    changed ||= JSON.stringify(assembly) !== previous
  }
  return changed
}

/** Keep a persisted modular-switch graph aligned with its live voltage system and pole setting. */
export function reconcileChangeoverSupplyAssembly(
  project: ProjectWithOptionalV2Electrical,
  changeover: TrunkDevice
): boolean {
  if (changeover.symbol !== 'source_changeover') return false
  const assembly = findAssemblyForChangeover(project, changeover.id)
  const node = assembly?.nodes.find(
    (candidate): candidate is Extract<SupplyNode, { kind: 'changeover-switch' }> =>
      candidate.kind === 'changeover-switch' && supplyNodeReferencesDevice(candidate, changeover.id)
  )
  if (!assembly || !node) return false
  const previous = JSON.stringify(assembly)
  const available = acConductors(project)
  const switched = changeoverConductors(changeover, available)
  node.label = changeover.label
  node.properties = {
    ...node.properties,
    poles: Math.min(4, Math.max(1, switched.length)) as 1 | 2 | 3 | 4,
    switchedConductors: [...switched],
    neutralTreatment: switched.includes('N') ? 'switched' : 'not-present',
    port1Label: changeover.changeoverProps?.port1Label ?? node.properties.port1Label,
    port2Label: changeover.changeoverProps?.port2Label ?? node.properties.port2Label,
  }
  const loadPort = node.ports.find((candidate) => candidate.id === 'load')
  if (loadPort) loadPort.maxConnections = 'many'
  for (const candidate of node.ports) candidate.conductors = [...switched]
  for (const handoff of assembly.loadHandoffs) {
    handoff.conductors = [...switched]
    const handoffNode = assembly.nodes.find((candidate) => candidate.id === handoff.handoffNodeId)
    for (const handoffPort of handoffNode?.ports.filter((candidate) => candidate.domain === 'AC') ??
      []) {
      handoffPort.conductors = [...switched]
    }
  }
  for (const candidate of assembly.connections.filter(
    (connection) => connection.domain === 'AC' && connection.pathRole === 'load-ac'
  )) {
    candidate.conductors = [...switched]
  }
  reconcileSupplyAssemblyAcConductorFlow(project, getAssemblyPanelId(assembly, project))
  return JSON.stringify(assembly) !== previous
}

export function buildDirectConverterSupplyAssembly(
  project: ProjectWithOptionalV2Electrical,
  panelId: string,
  converter: TrunkDevice
): OffGridSupplyAssembly {
  const conductors = acConductors(project)
  const system = getProjectElectricalInstallation(project)?.nominalVoltage.system ?? '1N~'
  const converterConductors = getSupplyConverterAcConductors(converter, system)
  const utilityId = `utility-${converter.id}`
  const capabilities: BackupSourceCapabilities = {
    supportsBackupSupply: false,
    supportsIslandMode: false,
    hasBidirectionalGridPort: converter.symbol === 'inverter',
    hasBatteryDcPort: true,
    hasIntegratedSolarDcInput: true,
    evidence: { source: 'manual' },
  }
  const gridInputConnected = converter.converterGridInputConnected !== false
  return {
    id: `supply-assembly-${converter.id}`,
    graphVersion: 1,
    presetIntent: 'grid_connected_storage_branch',
    incomingAttachment: { kind: 'panel-input', panelId },
    loadHandoffs: [],
    nodes: [
      {
        id: utilityId,
        kind: 'utility-source',
        symbol: 'mains',
        label: 'Grid',
        properties: { origin: 'grid' },
        ports: [port('out', 'utility-ac', conductors, 'source', 'many')],
      },
      {
        id: converter.id,
        deviceId: converter.id,
        kind: 'inverter-unit',
        symbol: converter.symbol,
        label: converter.label,
        properties: {
          serialNumber: converter.conversionProps?.serialNumber,
          acConnection: converter.converterAcConnection,
          ...(gridInputConnected ? {} : { gridInputConnected: false }),
        },
        ports: [
          port(
            'grid',
            'inverter-grid-ac',
            converterConductors,
            converter.symbol === 'rectifier' ? 'sink' : 'bidirectional'
          ),
          dcPort(
            'dc',
            'dc-bus',
            converter.symbol === 'rectifier' ? 'source' : 'bidirectional',
            'many'
          ),
        ],
      },
    ],
    connections: gridInputConnected
      ? [
          connection(
            `${utilityId}-to-${converter.id}`,
            [utilityId, 'out'],
            [converter.id, 'grid'],
            'inverter-grid-ac',
            converterConductors
          ),
        ]
      : [],
    inverterGroups: [
      {
        id: `grid-storage-group-${converter.id}`,
        shared: {
          brand: converter.conversionProps?.brand,
          model: converter.conversionProps?.model,
          capabilities,
        },
        use: { enabledForBackup: false, enabledForIslandMode: false },
        coordination: 'native-multiphase',
        unitNodeIds: [converter.id],
      },
    ],
  }
}

export function findAssemblyForDirectConverter(
  project: ProjectWithOptionalV2Electrical,
  converterId: string
): OffGridSupplyAssembly | undefined {
  return selectProjectSupplyAssemblies(project).find(
    (assembly) =>
      assembly.presetIntent === 'grid_connected_storage_branch' &&
      assembly.nodes.some(
        (node) => node.kind === 'inverter-unit' && supplyNodeReferencesDevice(node, converterId)
      )
  )
}

/** Adds the one optional protected load circuit fed by a standalone converter's backup AC port. */
export function attachDirectConverterBackupCircuit(
  assembly: OffGridSupplyAssembly,
  converter: TrunkDevice,
  protection: ProtectionDevice,
  circuit: Circuit,
  panelId: string
): OffGridSupplyAssembly {
  const converterNode = assembly.nodes.find(
    (node) => node.id === converter.id && node.kind === 'inverter-unit'
  )
  if (!converterNode) return assembly
  const gridPort = converterNode.ports.find((candidate) => candidate.domain === 'AC')
  const conductors = (gridPort?.conductors ?? ['L1', 'N']).filter(
    (candidate): candidate is AcPhase => candidate !== 'DC+' && candidate !== 'DC-'
  )
  const protectionNodeId = `converter-backup-protection-${protection.id}`
  const handoffNodeId = `converter-backup-handoff-${circuit.id}`
  const trunkDevices = [...(circuit.trunkDevices ?? [])].sort(
    (left, right) => left.trunkPosition - right.trunkPosition
  )
  const serialNodeIds = [protectionNodeId, ...trunkDevices.map((device) => device.id)]
  const nextNodes = assembly.nodes
    .filter((node) => !serialNodeIds.includes(node.id) && node.id !== handoffNodeId)
    .map((node) => ({
      ...node,
      properties: { ...node.properties },
      ports: node.ports.map((candidate) => ({
        ...candidate,
        conductors: [...candidate.conductors],
      })),
    })) as SupplyNode[]
  nextNodes.push(
    {
      id: protectionNodeId,
      kind: 'protection',
      symbol: protection.type === 'FUSE' ? 'fuse' : 'mcb',
      label: protection.label,
      properties: {
        type: protection.type,
        ratingA: protection.ratingA,
        curve: protection.curve,
        sensitivityMa: protection.sensitivityMa,
        residualCurrentType: protection.residualCurrentType,
        breakingCapacityKa: protection.breakingCapacityKa,
        breakingCapacityOption: protection.breakingCapacityOption,
        surgeProtectionKind: protection.surgeProtectionKind,
        polesConfig: protection.polesConfig,
        poles: protection.poles,
        notes: protection.notes,
      },
      ports: [
        port('source', 'serial-source-side', conductors, 'passive'),
        port('load', 'serial-load-side', conductors, 'passive'),
      ],
    },
    ...trunkDevices.map((device) => supplyAcBranchNode(device, conductors)),
    {
      id: handoffNodeId,
      kind: 'panel-handoff',
      symbol: 'panel_distribution',
      label: circuit.code,
      properties: {},
      ports: [port('in', 'panel-handoff', conductors, 'sink')],
    }
  )
  const nextConverterNode = nextNodes.find((node) => node.id === converter.id)
  if (
    nextConverterNode &&
    !nextConverterNode.ports.some((candidate) => candidate.id === 'backup')
  ) {
    nextConverterNode.ports.push(port('backup', 'inverter-backup-ac', conductors, 'source'))
  }
  const connectionIds = new Set<string>()
  let previousNodeId = converter.id
  let previousPortId = 'backup'
  for (const nodeId of serialNodeIds) {
    connectionIds.add(`${previousNodeId}-to-${nodeId}`)
    previousNodeId = nodeId
    previousPortId = 'load'
  }
  connectionIds.add(`${previousNodeId}-to-${handoffNodeId}`)
  const serialChainNodeIds = new Set([...serialNodeIds, handoffNodeId])
  const nextConnections = assembly.connections.filter(
    (candidate) =>
      !connectionIds.has(candidate.id) &&
      !candidate.endpoints.some((endpoint) => serialChainNodeIds.has(endpoint.nodeId))
  )
  previousNodeId = converter.id
  previousPortId = 'backup'
  serialNodeIds.forEach((nodeId, index) => {
    nextConnections.push(
      connection(
        `${previousNodeId}-to-${nodeId}`,
        [previousNodeId, previousPortId],
        [nodeId, 'source'],
        index === 0 ? 'inverter-backup-ac' : 'load-ac',
        conductors
      )
    )
    previousNodeId = nodeId
    previousPortId = 'load'
  })
  nextConnections.push(
    connection(
      `${previousNodeId}-to-${handoffNodeId}`,
      [previousNodeId, previousPortId],
      [handoffNodeId, 'in'],
      'load-ac',
      conductors
    )
  )
  return {
    ...assembly,
    nodes: nextNodes,
    connections: nextConnections,
    loadHandoffs: [
      ...assembly.loadHandoffs.filter((candidate) => candidate.handoffNodeId !== handoffNodeId),
      {
        id: `converter-backup-load-${circuit.id}`,
        handoffNodeId,
        target: { kind: 'circuit-input', panelId, circuitId: circuit.id },
        conductors,
      },
    ],
    inverterGroups: assembly.inverterGroups.map((group) =>
      group.unitNodeIds.includes(converter.id)
        ? {
            ...group,
            shared: {
              ...group.shared,
              capabilities: {
                ...group.shared.capabilities,
                supportsBackupSupply: true,
                hasDedicatedBackupAcOutput: true,
              },
            },
            use: { ...group.use, enabledForBackup: true },
          }
        : group
    ),
  }
}

export function retargetDirectConverterBackupPanel(
  assembly: OffGridSupplyAssembly,
  circuitId: string,
  panelId: string
): OffGridSupplyAssembly {
  return {
    ...assembly,
    loadHandoffs: assembly.loadHandoffs.map((candidate) =>
      candidate.target.kind === 'circuit-input' && candidate.target.circuitId === circuitId
        ? { ...candidate, target: { kind: 'panel-input' as const, panelId } }
        : candidate
    ),
  }
}

function preserveConnectionWireProperties(
  previous: SupplyConnection[],
  next: SupplyConnection[]
): SupplyConnection[] {
  const endpointKey = (candidate: SupplyConnection) =>
    `${candidate.pathRole}:${candidate.endpoints
      .map(({ nodeId, portId }) => `${nodeId}:${portId}`)
      .sort()
      .join('|')}`
  const byId = new Map(previous.map((candidate) => [candidate.id, candidate]))
  const byEndpoints = new Map(previous.map((candidate) => [endpointKey(candidate), candidate]))
  return next.map((candidate) => {
    const source = byId.get(candidate.id) ?? byEndpoints.get(endpointKey(candidate))
    if (!source?.wireProperties) return candidate
    return {
      ...candidate,
      wireProperties: {
        ...source.wireProperties,
        cable: { ...source.wireProperties.cable },
      },
    }
  })
}

/** Mirrors one multiplied trunk inverter into distinct physical inverter-unit graph nodes. */
export function reconcileInverterUnitMultiplier(
  project: ProjectWithOptionalV2Electrical,
  converter: TrunkDevice
): boolean {
  if (converter.symbol !== 'inverter') return false
  const assembly = editProjectSupplyAssemblies(project).find((candidate) =>
    candidate.inverterGroups.some((group) => group.unitNodeIds.includes(converter.id))
  )
  if (!assembly) return false
  const group = assembly.inverterGroups.find((candidate) =>
    candidate.unitNodeIds.includes(converter.id)
  )
  const baseNode = assembly.nodes.find(
    (node) => node.id === converter.id && node.kind === 'inverter-unit'
  )
  if (!group || !baseNode || baseNode.kind !== 'inverter-unit') return false
  const previousAssemblyState = JSON.stringify(assembly)

  const desiredCount = Math.min(
    3,
    Math.max(
      1,
      converter.placements?.length ?? 0,
      converter.conversionProps?.serialNumbers?.length ?? 0
    )
  )
  const previousUnitIds = new Set(group.unitNodeIds.filter((id) => id !== converter.id))
  assembly.nodes = assembly.nodes.filter((node) => !previousUnitIds.has(node.id))
  assembly.connections = assembly.connections.filter(
    (candidate) => !candidate.endpoints.some((endpoint) => previousUnitIds.has(endpoint.nodeId))
  )
  baseNode.deviceId = converter.id

  const baseConnections = assembly.connections.filter((candidate) =>
    candidate.endpoints.some((endpoint) => endpoint.nodeId === converter.id)
  )
  const system = getProjectElectricalInstallation(project)?.nominalVoltage.system ?? '1N~'
  const unitAssignments = getSupplyInverterUnitPhaseAssignments(converter, system, desiredCount)
  const conductorsForUnit = (conductors: SupplyConductor[], index: number): SupplyConductor[] =>
    conductors.some((conductor) => conductor === 'L1' || conductor === 'L2' || conductor === 'L3')
      ? ((unitAssignments[index]?.phases.filter((phase) => phase !== 'PE') as
          SupplyConductor[] | undefined) ?? [...conductors])
      : [...conductors]

  baseNode.ports = baseNode.ports.map((candidate) =>
    candidate.domain === 'AC'
      ? { ...candidate, conductors: conductorsForUnit(candidate.conductors, 0) }
      : candidate
  )
  for (const template of baseConnections) {
    if (template.domain === 'AC') {
      template.conductors = conductorsForUnit(template.conductors, 0)
    }
  }
  const unitNodeIds = [converter.id]
  for (let index = 1; index < desiredCount; index++) {
    const unitId = `${converter.id}-unit-${index + 1}`
    unitNodeIds.push(unitId)
    const clonedNode: Extract<SupplyNode, { kind: 'inverter-unit' }> = {
      ...baseNode,
      id: unitId,
      deviceId: converter.id,
      label: converter.label ? `${converter.label} ${index + 1}` : `Inverter ${index + 1}`,
      properties: { ...baseNode.properties },
      ports: baseNode.ports.map((candidate) => ({
        ...candidate,
        conductors: [...candidate.conductors],
      })),
      mounting: baseNode.mounting ? { enclosure: { ...baseNode.mounting.enclosure } } : undefined,
    }
    clonedNode.ports = clonedNode.ports.map((candidate) =>
      candidate.domain === 'AC'
        ? { ...candidate, conductors: conductorsForUnit(candidate.conductors, index) }
        : candidate
    )
    assembly.nodes.push(clonedNode)
    for (const template of baseConnections) {
      const endpoints = template.endpoints.map((endpoint) =>
        endpoint.nodeId === converter.id ? { ...endpoint, nodeId: unitId } : endpoint
      ) as SupplyConnection['endpoints']
      const clonedConductors = conductorsForUnit(template.conductors, index)
      assembly.connections.push({
        ...template,
        id: `${template.id}-unit-${index + 1}`,
        endpoints,
        conductors: clonedConductors,
        wireProperties: template.wireProperties
          ? {
              ...template.wireProperties,
              cable: { ...template.wireProperties.cable },
            }
          : undefined,
        physicalRoute: template.physicalRoute?.map((enclosure) => ({ ...enclosure })),
      })
      const externalEndpoint = endpoints.find((endpoint) => endpoint.nodeId !== unitId)
      const externalNode = externalEndpoint
        ? assembly.nodes.find((node) => node.id === externalEndpoint.nodeId)
        : undefined
      const externalPort = externalNode?.ports.find(
        (portCandidate) => portCandidate.id === externalEndpoint?.portId
      )
      if (externalPort) {
        externalPort.maxConnections = 'many'
        externalPort.conductors = Array.from(
          new Set([...externalPort.conductors, ...clonedConductors])
        )
      }
    }
  }
  group.unitNodeIds = unitNodeIds
  group.coordination = desiredCount > 1 ? 'independent-per-phase' : 'native-multiphase'
  for (const handoff of assembly.loadHandoffs) {
    const connectedConductors = assembly.connections
      .filter(
        (connection) =>
          connection.domain === 'AC' &&
          connection.endpoints.some((endpoint) => endpoint.nodeId === handoff.handoffNodeId)
      )
      .flatMap((connection) => connection.conductors)
      .filter((conductor): conductor is AcPhase => conductor !== 'DC+' && conductor !== 'DC-')
    if (connectedConductors.length === 0) continue
    const conductorOrder: AcPhase[] = ['L1', 'L2', 'L3', 'N', 'PE']
    handoff.conductors = Array.from(new Set(connectedConductors)).sort(
      (left, right) => conductorOrder.indexOf(left) - conductorOrder.indexOf(right)
    )
  }
  return JSON.stringify(assembly) !== previousAssemblyState
}

/** Synchronizes both placeable converter DC branches into serial graph paths. */
export function reconcileDirectConverterDcDevices(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): boolean {
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return false
  const rootDevices =
    ensureInstallationFeedTopology(
      installation,
      getProjectElectricalPanels(project)
    ).rootFeeds.find((feed) => feed.panelId === panelId)?.trunkDevices ?? []
  const converter = rootDevices.find(
    (device) => device.supplyPath === 'converter-branch' || device.supplyPath === 'backup'
  )
  if (!converter) return false
  const assembly =
    findAssemblyForDirectConverter(project, converter.id) ??
    selectProjectSupplyAssemblies(project).find((candidate) =>
      candidate.nodes.some((node) => node.id === converter.id && node.kind === 'inverter-unit')
    )
  if (!assembly) return false
  const previousAssembly = JSON.stringify(assembly)
  const dcDevices = rootDevices.filter(
    (device) => device.supplyPath === 'converter-dc' || device.supplyPath === 'converter-dc-top'
  )
  const previousDcNodeIds = new Set(
    assembly.connections
      .filter(
        (candidate) =>
          candidate.pathRole === 'battery-dc' ||
          candidate.pathRole === 'solar-dc' ||
          candidate.pathRole === 'dc-bus'
      )
      .flatMap((candidate) => candidate.endpoints.map((endpoint) => endpoint.nodeId))
      .filter((nodeId) => nodeId !== converter.id)
  )
  assembly.nodes = [
    ...assembly.nodes.filter((node) => !previousDcNodeIds.has(node.id)),
    ...dcDevices.map<SupplyNode>((device) => {
      if (device.symbol === 'solar_panel') {
        return {
          id: device.id,
          deviceId: device.id,
          kind: 'solar-source',
          symbol: 'solar_panel',
          label: device.label,
          properties: device.solarPanelProps ?? { wattageW: 1000 },
          ports: [dcPort('dc', 'dc-bus', 'bidirectional', 2)],
        }
      }
      if (device.symbol === 'battery') {
        return {
          id: device.id,
          deviceId: device.id,
          kind: 'battery',
          symbol: 'battery',
          label: device.label,
          properties: device.batteryProps ?? { voltageV: 48, capacityKWh: 5 },
          ports: [dcPort('dc', 'dc-bus', 'bidirectional', 2)],
        }
      }
      if (device.type === 'protection' && device.symbol !== 'relay') {
        return {
          id: device.id,
          deviceId: device.id,
          kind: 'protection',
          symbol: device.symbol,
          label: device.label,
          properties: protectionProperties(device),
          ports: [dcPort('dc', 'dc-bus', 'bidirectional', 2)],
        }
      }
      return {
        id: device.id,
        deviceId: device.id,
        kind: 'dc-bus',
        symbol: device.symbol,
        label: device.label,
        properties:
          device.type === 'dc_bus'
            ? {
                ratedCurrentA: device.dcBusProps?.ratedCurrentA,
                ratedVoltageV: device.dcBusProps?.ratedVoltageV,
              }
            : device.type === 'domotica'
              ? { domoticaProps: device.domoticaProps ?? { endpointCount: 1 } }
              : {},
        ports: [
          dcPort(
            'dc',
            'dc-bus',
            'bidirectional',
            device.type === 'dc_bus' || supportsCircuitConverterDcConnections(device) ? 'many' : 2
          ),
          ...domoticaOutputPorts(device),
        ],
      }
    }),
  ]
  const dcConnections: SupplyConnection[] = []
  for (const supplyPath of ['converter-dc', 'converter-dc-top'] as const) {
    const previousByOutput = new Map<number, [string, string]>()
    const laneDevices = dcDevices.filter((device) => device.supplyPath === supplyPath)
    const serialDevices = laneDevices.filter((device) => !device.supplyDcBusId)
    serialDevices.forEach((device, index) => {
      const output = getSupplyConverterDcConnectionIndex(device) ?? 0
      const previous: [string, string] = previousByOutput.get(output) ?? [converter.id, 'dc']
      const pathRole =
        device.symbol === 'solar_panel'
          ? 'solar-dc'
          : device.symbol === 'battery'
            ? 'battery-dc'
            : 'dc-bus'
      dcConnections.push(
        dcConnection(
          `${converter.id}-${supplyPath}-${index}-${device.id}`,
          [device.id, 'dc'],
          previous,
          pathRole
        )
      )
      previousByOutput.set(output, [device.id, 'dc'])
    })
    for (const bus of serialDevices.filter((device) => device.type === 'dc_bus')) {
      const busBranchGroups = new Map<string, TrunkDevice[]>()
      laneDevices
        .filter((device) => device.supplyDcBusId === bus.id)
        .forEach((device) => {
          const branchId = device.supplyDcBusBranchId ?? device.id
          const group = busBranchGroups.get(branchId) ?? []
          group.push(device)
          busBranchGroups.set(branchId, group)
        })
      const branchEntries = [...busBranchGroups.entries()]
      branchEntries.forEach(([branchId, devices]) => {
        let branchPrevious: [string, string] = [bus.id, 'dc']
        const directDevices = devices.filter((device) => !device.converterDcConnection)
        directDevices.forEach((device, index) => {
          const pathRole =
            device.symbol === 'solar_panel'
              ? 'solar-dc'
              : device.symbol === 'battery'
                ? 'battery-dc'
                : 'dc-bus'
          dcConnections.push(
            dcConnection(
              `${converter.id}-${supplyPath}-bus-${bus.id}-${branchId}-${index}-${device.id}`,
              [device.id, 'dc'],
              branchPrevious,
              pathRole
            )
          )
          branchPrevious = [device.id, 'dc']
        })
        for (const nestedConverter of directDevices.filter((device) =>
          supportsCircuitConverterDcConnections(device)
        )) {
          const outputDevices = devices.filter(
            (device) => device.converterDcConnection?.converterId === nestedConverter.id
          )
          const connectionIndexes = new Set(
            outputDevices.map((device) => device.converterDcConnection!.connectionIndex)
          )
          for (const connectionIndex of connectionIndexes) {
            let outputPrevious: [string, string] = [nestedConverter.id, 'dc']
            outputDevices
              .filter((device) => device.converterDcConnection?.connectionIndex === connectionIndex)
              .forEach((device, index) => {
                const pathRole =
                  device.symbol === 'solar_panel'
                    ? 'solar-dc'
                    : device.symbol === 'battery'
                      ? 'battery-dc'
                      : 'dc-bus'
                dcConnections.push(
                  dcConnection(
                    `${converter.id}-${supplyPath}-bus-${bus.id}-${branchId}-${nestedConverter.id}-${connectionIndex}-${index}-${device.id}`,
                    [device.id, 'dc'],
                    outputPrevious,
                    pathRole
                  )
                )
                outputPrevious = [device.id, 'dc']
              })
          }
        }
      })
    }
  }
  const previousDcConnections = assembly.connections
  assembly.connections = preserveConnectionWireProperties(previousDcConnections, [
    ...previousDcConnections.filter(
      (candidate) =>
        candidate.pathRole !== 'battery-dc' &&
        candidate.pathRole !== 'solar-dc' &&
        candidate.pathRole !== 'dc-bus'
    ),
    ...dcConnections,
  ])
  const converterNode = assembly.nodes.find((node) => node.id === converter.id)
  const converterDcPort = converterNode?.ports.find((candidate) => candidate.id === 'dc')
  if (converterDcPort) converterDcPort.maxConnections = 'many'
  reconcileInverterUnitMultiplier(project, converter)
  reconcileSupplyAssemblyAcConductorFlow(project, panelId)
  return JSON.stringify(assembly) !== previousAssembly
}

/** Repair older files that chained distinct converter DC outputs in the assembly graph. */
export function repairCrossOutputSupplyConverterDcConnections(
  project: ProjectWithOptionalV2Electrical
): boolean {
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return false
  let changed = false
  for (const feed of ensureInstallationFeedTopology(
    installation, getProjectElectricalPanels(project)
  ).rootFeeds) {
    const converter = feed.trunkDevices?.find((device) =>
      device.supplyPath === 'converter-branch' || device.supplyPath === 'backup')
    if (!converter) continue
    const outputByDeviceId = new Map((feed.trunkDevices ?? [])
      .filter((device) => !device.supplyDcBusId &&
        getSupplyConverterDcConnectionIndex(device) != null)
      .map((device) => [device.id, getSupplyConverterDcConnectionIndex(device)!]))
    if (new Set(outputByDeviceId.values()).size < 2) continue
    const assembly = selectProjectSupplyAssemblies(project).find((candidate) =>
      candidate.nodes.some((node) => node.id === converter.id && node.kind === 'inverter-unit'))
    if (!assembly?.connections.some((connection) =>
      connection.domain === 'DC' &&
      connection.endpoints.every((endpoint) => outputByDeviceId.has(endpoint.nodeId)) &&
      outputByDeviceId.get(connection.endpoints[0]!.nodeId) !==
        outputByDeviceId.get(connection.endpoints[1]!.nodeId))) continue
    changed = reconcileDirectConverterDcDevices(project, feed.panelId) || changed
  }
  return changed
}

/** Adds the selected converter to both sides of the source loop and enables backup use. */
export function attachBackupConverterToAssembly(
  project: ProjectWithOptionalV2Electrical,
  panelId: string,
  changeover: TrunkDevice,
  converter: TrunkDevice,
  backupDevicesOverride?: TrunkDevice[],
  changeoverGridDevicesOverride?: TrunkDevice[]
): OffGridSupplyAssembly {
  const existing = findAssemblyForChangeover(project, changeover.id)
  const assembly = structuredClone(
    existing ?? buildChangeoverSupplyAssembly(project, panelId, changeover)
  )
  const conductors = acConductors(project)
  const system = getProjectElectricalInstallation(project)?.nominalVoltage.system ?? '1N~'
  const converterConductors = getSupplyConverterAcConductors(converter, system)
  const utility = assembly.nodes.find((node) => node.kind === 'utility-source')!
  const backupDevices =
    backupDevicesOverride ??
    ensureInstallationFeedTopology(
      getProjectElectricalInstallation(project)!,
      getProjectElectricalPanels(project)
    )
      .rootFeeds.find((feed) => feed.panelId === panelId)
      ?.trunkDevices?.filter((device) => device.supplyPath === 'backup-output') ??
    []
  const changeoverGridDevices =
    changeoverGridDevicesOverride ??
    ensureInstallationFeedTopology(
      getProjectElectricalInstallation(project)!,
      getProjectElectricalPanels(project)
    )
      .rootFeeds.find((feed) => feed.panelId === panelId)
      ?.trunkDevices?.filter((device) => device.supplyPath === 'changeover-grid') ??
    []
  const capabilities: BackupSourceCapabilities = {
    supportsBackupSupply: true,
    supportsIslandMode: true,
    hasBidirectionalGridPort: true,
    hasDedicatedBackupAcOutput: true,
    requiresExternalChangeover: true,
    evidence: { source: 'manual' },
  }
  const previousConverterNode = assembly.nodes
    .filter(isInverterUnitNode)
    .find((node) => node.id === converter.id)
  const gridInputConnected =
    converter.converterGridInputConnected !== false &&
    previousConverterNode?.properties.gridInputConnected !== false

  const converterNode: SupplyNode = {
    id: converter.id,
    deviceId: converter.id,
    kind: 'inverter-unit',
    symbol: converter.symbol,
    label: converter.label,
    properties: {
      serialNumber: converter.conversionProps?.serialNumber,
      ...(gridInputConnected ? {} : { gridInputConnected: false }),
    },
    ports: [
      port('grid', 'inverter-grid-ac', converterConductors, 'bidirectional'),
      port('backup', 'inverter-backup-ac', converterConductors, 'source'),
      dcPort('dc', 'dc-bus', 'bidirectional', 'many'),
    ],
  }
  assembly.nodes = [
    ...assembly.nodes.filter(
      (node) =>
        node.id !== converter.id &&
        !backupDevices.some((device) => device.id === node.id) &&
        !changeoverGridDevices.some((device) => device.id === node.id) &&
        !(node.kind === 'inverter-unit' && BACKUP_CONVERSION_SYMBOLS.has(node.symbol))
    ),
    converterNode,
    ...backupDevices.map((device) => supplyAcBranchNode(device, converterConductors)),
    ...changeoverGridDevices.map((device) => supplyAcBranchNode(device, conductors)),
  ]
  const backupConnections: SupplyConnection[] = []
  let previousBackupEndpoint: [string, string] = [converter.id, 'backup']
  const backupDevicesFromConverter = [...backupDevices]
    .sort((a, b) => a.trunkPosition - b.trunkPosition || a.id.localeCompare(b.id))
    .reverse()
  backupDevicesFromConverter.forEach((device, index) => {
    backupConnections.push(
      connection(
        `${converter.id}-to-${changeover.id}-${index}-in`,
        previousBackupEndpoint,
        [device.id, 'source'],
        'inverter-backup-ac',
        converterConductors
      )
    )
    previousBackupEndpoint = [device.id, 'load']
  })
  backupConnections.push(
    connection(
      `${converter.id}-to-${changeover.id}-out`,
      previousBackupEndpoint,
      [changeover.id, 'backup'],
      'inverter-backup-ac',
      converterConductors
    )
  )
  const changeoverGridConnections: SupplyConnection[] = []
  let previousChangeoverGridEndpoint: [string, string] = [utility.id, 'out']
  changeoverGridDevices.forEach((device, index) => {
    changeoverGridConnections.push(
      connection(
        `${utility.id}-to-${changeover.id}-grid-${index}-in`,
        previousChangeoverGridEndpoint,
        [device.id, 'source'],
        'grid-ac',
        conductors
      )
    )
    previousChangeoverGridEndpoint = [device.id, 'load']
  })
  changeoverGridConnections.push(
    connection(
      `${utility.id}-to-${changeover.id}-grid-out`,
      previousChangeoverGridEndpoint,
      [changeover.id, 'grid'],
      'grid-ac',
      conductors
    )
  )
  const previousAcConnections = assembly.connections
  assembly.connections = preserveConnectionWireProperties(previousAcConnections, [
    ...previousAcConnections.filter(
      (candidate) =>
        candidate.pathRole !== 'grid-ac' &&
        candidate.pathRole !== 'inverter-grid-ac' &&
        candidate.pathRole !== 'inverter-backup-ac'
    ),
    ...changeoverGridConnections,
    ...(gridInputConnected
      ? [
          connection(
            `${utility.id}-to-${converter.id}`,
            [utility.id, 'out'],
            [converter.id, 'grid'],
            'inverter-grid-ac',
            converterConductors
          ),
        ]
      : []),
    ...backupConnections,
  ])
  const changeoverNode = assembly.nodes.find((node) => node.id === changeover.id)
  const backupPort = changeoverNode?.ports.find((candidate) => candidate.id === 'backup')
  if (backupPort) backupPort.conductors = [...converterConductors]
  assembly.inverterGroups = [
    {
      id: `backup-group-${converter.id}`,
      shared: {
        brand: converter.conversionProps?.brand,
        model: converter.conversionProps?.model,
        capabilities,
      },
      use: { enabledForBackup: true, enabledForIslandMode: true },
      coordination: 'native-multiphase',
      unitNodeIds: [converter.id],
    },
  ]
  return assembly
}

/** Restore a missing backup branch from unambiguous persisted root-feed devices.
 * Leave complete/custom inverter graphs alone; their port wiring is authoritative.
 */
export function healMissingChangeoverBackupBranch(project: ProjectWithOptionalV2Electrical): boolean {
  let changed = false
  const installation = getProjectElectricalInstallation(project)
  for (const feed of installation?.feedTopology?.rootFeeds ?? []) {
    const devices = feed.trunkDevices ?? []
    const switches = devices.filter((device) => device.symbol === 'source_changeover')
    const converters = devices.filter((device) => device.supplyPath === 'backup' && device.type === 'conversion')
    if (switches.length !== 1 || converters.length !== 1) continue
    const changeover = switches[0]!
    const converter = converters[0]!
    const assembly = findAssemblyForChangeover(project, changeover.id)
    if (!assembly || !assembly.nodes.some((node) => node.kind === 'utility-source') ||
      assembly.nodes.some((node) => node.kind === 'inverter-unit') ||
      selectProjectSupplyAssemblies(project).some((candidate) =>
        candidate.nodes.some((node) => supplyNodeReferencesDevice(node, converter.id)))) continue
    Object.assign(assembly, attachBackupConverterToAssembly(project, feed.panelId, changeover, converter))
    reconcileSupplyAssemblyBranchProtections(project, feed.panelId)
    reconcileDirectConverterDcDevices(project, feed.panelId)
    changed = true
  }
  return changed
}

/** Converts an existing direct converter graph into the switched four-port topology. */
export function upgradeDirectConverterToChangeoverAssembly(
  project: ProjectWithOptionalV2Electrical,
  panelId: string,
  changeover: TrunkDevice,
  converter: TrunkDevice,
  backupDevicesOverride?: TrunkDevice[],
  changeoverGridDevicesOverride?: TrunkDevice[]
): OffGridSupplyAssembly {
  const directAssembly = findAssemblyForDirectConverter(project, converter.id)
  const upgraded = attachBackupConverterToAssembly(
    project,
    panelId,
    changeover,
    {
      ...converter,
      supplyPath: 'backup',
    },
    backupDevicesOverride,
    changeoverGridDevicesOverride
  )
  if (!directAssembly) return upgraded

  for (const handoff of directAssembly.loadHandoffs) {
    const input = resolveAssemblyPanelInput(project, handoff.target)
    if (input?.panelId === panelId) continue
    const incoming = directAssembly.connections.filter((edge) => edge.endpoints[1].nodeId === handoff.handoffNodeId)
    const generated = isGeneratedCommonPanelHandoff(directAssembly, handoff) &&
      (incoming.length === 0 || (incoming.length === 1 && incoming[0]!.id === `${directAssembly.id}-to-${handoff.handoffNodeId}`))
    const copiedHandoff = structuredClone(handoff)
    if (generated && input) {
      copiedHandoff.id = `${upgraded.id}-panel-load-${input.panelId}`
      copiedHandoff.handoffNodeId = `${upgraded.id}-panel-handoff-${input.panelId}`
    }
    const handoffNode = directAssembly.nodes.find((node) => node.id === handoff.handoffNodeId)
    if (!handoffNode) continue
    upgraded.loadHandoffs.push(copiedHandoff)
    upgraded.nodes.push({ ...structuredClone(handoffNode), id: copiedHandoff.handoffNodeId })
    // Generated root inputs are rewired to the completed switched load path by
    // reconciliation. Private branches retain their explicit upstream graph.
    if (generated) continue
    const visited = new Set<string>()
    const copyIncoming = (nodeId: string) => {
      if (visited.has(nodeId)) return
      visited.add(nodeId)
      for (const edge of directAssembly.connections.filter((candidate) => candidate.endpoints[1].nodeId === nodeId)) {
        const copied = structuredClone(edge)
        const source = directAssembly.nodes.find((node) => node.id === copied.endpoints[0].nodeId)
        if (source?.kind === 'utility-source') {
          copied.endpoints[0].nodeId = upgraded.nodes.find((node) => node.kind === 'utility-source')!.id
        } else if (source && !upgraded.nodes.some((node) => node.id === source.id)) {
          upgraded.nodes.push(structuredClone(source))
          copyIncoming(source.id)
        }
        if (!upgraded.connections.some((candidate) => candidate.id === copied.id)) upgraded.connections.push(copied)
      }
    }
    copyIncoming(handoff.handoffNodeId)
  }

  const dcConnections = directAssembly.connections.filter(
    ({ pathRole }) => pathRole === 'battery-dc' || pathRole === 'solar-dc' || pathRole === 'dc-bus'
  )
  const dcNodeIds = new Set(
    dcConnections
      .flatMap(({ endpoints }) => endpoints.map(({ nodeId }) => nodeId))
      .filter((nodeId) => nodeId !== converter.id)
  )
  upgraded.nodes.push(
    ...directAssembly.nodes
      .filter(({ id }) => dcNodeIds.has(id))
      .map((node) => structuredClone(node))
  )
  upgraded.connections.push(...dcConnections.map((candidate) => structuredClone(candidate)))

  const previousGridConnections = directAssembly.connections.filter(
    ({ pathRole }) => pathRole === 'inverter-grid-ac'
  )
  const previousConverterNode = directAssembly.nodes
    .filter(isInverterUnitNode)
    .find((node) => node.id === converter.id)
  const upgradedConverterNode = upgraded.nodes
    .filter(isInverterUnitNode)
    .find((node) => node.id === converter.id)
  if (previousConverterNode?.properties.gridInputConnected === false && upgradedConverterNode) {
    upgradedConverterNode.properties.gridInputConnected = false
    upgraded.connections = upgraded.connections.filter(
      ({ pathRole }) => pathRole !== 'inverter-grid-ac'
    )
  }
  const upgradedGridConnections = upgraded.connections.filter(
    ({ pathRole }) => pathRole === 'inverter-grid-ac'
  )
  upgradedGridConnections.forEach((candidate, index) => {
    const wireProperties = previousGridConnections[index]?.wireProperties
    if (!wireProperties) return
    candidate.wireProperties = {
      ...wireProperties,
      cable: { ...wireProperties.cable },
    }
  })
  return upgraded
}

/**
 * Removes an external changeover from a switched assembly while retaining the inverter,
 * its DC graph and the panel's dedicated backup handoff.
 */
export function downgradeChangeoverToDirectConverterAssembly(
  project: ProjectWithOptionalV2Electrical,
  panelId: string,
  changeoverId: string,
  converter: TrunkDevice
): OffGridSupplyAssembly | undefined {
  const switched = findAssemblyForChangeover(project, changeoverId)
  if (!switched || converter.symbol !== 'inverter') return undefined

  const direct = buildDirectConverterSupplyAssembly(project, panelId, {
    ...converter,
    supplyPath: 'converter-branch',
    converterGridInputConnected:
      switched.nodes.filter(isInverterUnitNode).find((node) => node.id === converter.id)?.properties
        .gridInputConnected !== false,
  })
  direct.id = switched.id

  const dcConnections = switched.connections.filter(
    ({ pathRole }) => pathRole === 'battery-dc' || pathRole === 'solar-dc' || pathRole === 'dc-bus'
  )
  const dcNodeIds = new Set(
    dcConnections
      .flatMap(({ endpoints }) => endpoints.map(({ nodeId }) => nodeId))
      .filter((nodeId) => nodeId !== converter.id)
  )
  direct.nodes.push(
    ...switched.nodes
      .filter(({ id }) => dcNodeIds.has(id))
      .map<SupplyNode>(
        (node) =>
          ({
            ...node,
            properties: { ...node.properties },
            ports: node.ports.map((candidate) => ({
              ...candidate,
              conductors: [...candidate.conductors],
            })),
            mounting: node.mounting ? { enclosure: { ...node.mounting.enclosure } } : undefined,
          }) as SupplyNode
      )
  )
  direct.connections.push(
    ...dcConnections.map<SupplyConnection>((candidate) => ({
      ...candidate,
      endpoints: candidate.endpoints.map((endpoint) => ({
        ...endpoint,
      })) as SupplyConnection['endpoints'],
      conductors: [...candidate.conductors],
      wireProperties: candidate.wireProperties
        ? {
            ...candidate.wireProperties,
            cable: { ...candidate.wireProperties.cable },
          }
        : undefined,
      physicalRoute: candidate.physicalRoute?.map((enclosure) => ({ ...enclosure })),
    }))
  )

  const previousGridConnections = switched.connections.filter(
    ({ pathRole }) => pathRole === 'inverter-grid-ac'
  )
  direct.connections = preserveConnectionWireProperties(previousGridConnections, direct.connections)

  const previousHandoff = switched.loadHandoffs.find(
    ({ target }) =>
      (target.kind === 'panel-input' || target.kind === 'panel-bus-input') &&
      target.panelId === panelId
  )
  if (!enableDirectInverterPanelBackup(direct, panelId)) return undefined
  if (previousHandoff) {
    const generatedHandoff = direct.loadHandoffs.find(
      ({ target }) =>
        (target.kind === 'panel-input' || target.kind === 'panel-bus-input') &&
        target.panelId === panelId
    )
    if (generatedHandoff) generatedHandoff.target = { ...previousHandoff.target }
  }
  return direct
}

function protectionProperties(device: TrunkDevice): SupplyProtectionProperties {
  return {
    type: device.protectionType ?? 'MCB',
    ratingA: device.ratingA,
    curve: device.curve,
    sensitivityMa: device.sensitivityMa,
    residualCurrentType: device.residualCurrentType,
    breakingCapacityKa: device.breakingCapacityKa,
    breakingCapacityOption: device.breakingCapacityOption,
    surgeProtectionKind: device.surgeProtectionKind,
    polesConfig: device.polesConfig,
    poles: device.poles,
    notes: device.notes,
  }
}

function supplyAcBranchNode(device: TrunkDevice, conductors: AcPhase[]): SupplyNode {
  const ports = [
    port('source', 'serial-source-side', conductors, 'passive'),
    port('load', 'serial-load-side', conductors, 'passive'),
  ]
  if (
    device.type === 'protection' &&
    device.symbol !== 'relay' &&
    getSymbolById(device.symbol)?.category !== 'switches'
  ) {
    return {
      id: device.id,
      deviceId: device.id,
      kind: 'protection',
      symbol: device.symbol,
      label: device.label,
      properties: protectionProperties(device),
      ports,
    }
  }
  return {
    id: device.id,
    deviceId: device.id,
    kind: 'ac-distribution',
    symbol: device.symbol,
    label: device.label,
    properties: {},
    ports,
  }
}

/**
 * The grid-connected converter branches off the common supply; it is not its end.
 * Materialize the serial continuation and its panel fan-out in the same graph.
 * Only our recognizable generated paths are rebuilt; custom routing is preserved.
 */
export function reconcileDirectConverterCommonLoadPath(
  project: ProjectWithOptionalV2Electrical,
  panelId: string,
  options?: SupplyAssemblyReconcileOptions
): boolean {
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return false
  const panels = getProjectElectricalPanels(project)
  const panel = panels.find((candidate) => candidate.id === panelId)
  if (!panel || panel.isMain === false) return false
  const devices =
    ensureInstallationFeedTopology(installation, panels).rootFeeds.find(
      (feed) => feed.panelId === panelId
    )?.trunkDevices ?? []
  const converterIndex = devices.findIndex((device) => device.supplyPath === 'converter-branch')
  const converter = devices[converterIndex]
  if (!converter) return false
  const assembly = findAssemblyForDirectConverter(project, converter.id)
  if (assembly?.loadHandoffs.some((handoff) => handoff.id === `${assembly.id}-root-input-${panelId}`)) {
    return initializeDirectConverterPanelBranches(project, assembly, options)
  }
  const utility = assembly?.nodes.find((node) => node.kind === 'utility-source')
  const inverter = assembly?.nodes.find((node) => node.id === converter.id && node.kind === 'inverter-unit')
  const separate = converter.symbol === 'inverter' && converter.converterAcConnection === 'separate'
  if (
    !assembly ||
    !utility ||
    (!separate && !assembly.connections.some(
      (edge) => edge.pathRole === 'inverter-grid-ac' && edge.endpoints[1].nodeId === converter.id
    ))
  )
    return false
  const serial = selectSerialLoadDevicesForAssembly(
    devices,
    converterIndex,
    assemblyOwnedPhysicalDeviceIds(assembly, options?.absorbDeviceIds),
    options
  )
  const generated = assembly.loadHandoffs.filter((handoff) =>
    isGeneratedCommonPanelHandoff(assembly, handoff)
  )
  const generatedNodeIds = new Set(generated.map((handoff) => handoff.handoffNodeId))
  if (
    generated.some(
      (handoff) =>
        !assembly.nodes.some(
          (node) =>
            node.id === handoff.handoffNodeId &&
            node.kind === 'panel-handoff' &&
            node.ports.some((candidate) => candidate.id === 'in' && candidate.domain === 'AC')
        )
    )
  )
    return false
  const pathPrefix = `${assembly.id}-common-load-`
  const inverterIds = new Set(assembly.nodes.filter(isInverterUnitNode).map((node) => node.id))
  const oldPath = assembly.connections.filter(
    (edge) => edge.id.startsWith(pathPrefix) && (edge.pathRole === 'grid-only-bypass-ac' || edge.pathRole === 'load-ac')
  )
  const oldNodeIds = new Set(
    oldPath
      .flatMap((edge) => edge.endpoints.map((end) => end.nodeId))
      .filter((id) => id !== utility.id && !inverterIds.has(id) && !generatedNodeIds.has(id))
  )
  const generatedEdges = assembly.connections.filter(
    (edge) =>
      generatedNodeIds.has(edge.endpoints[1].nodeId) &&
      (edge.id === `${assembly.id}-to-${edge.endpoints[1].nodeId}` ||
        edge.id.startsWith(`${assembly.id}-to-${edge.endpoints[1].nodeId}-unit-`)) &&
      (edge.pathRole === 'grid-only-bypass-ac' || edge.pathRole === 'load-ac') &&
      (edge.endpoints[0].nodeId === utility.id || inverterIds.has(edge.endpoints[0].nodeId) || oldNodeIds.has(edge.endpoints[0].nodeId))
  )
  const ownedEdges = new Set([...oldPath, ...generatedEdges])
  // An unknown incoming handoff, or private routing through one of the generated
  // serial nodes, cannot be reconstructed from a flat editor list losslessly.
  if (
    assembly.connections.some(
      (edge) =>
        !ownedEdges.has(edge) &&
        (generatedNodeIds.has(edge.endpoints[1].nodeId) ||
          edge.endpoints.some((end) => oldNodeIds.has(end.nodeId)))
    ) ||
    serial.some((device) =>
      assembly.nodes.some(
        (node) => getSupplyNodePhysicalDeviceId(node) === device.id && !oldNodeIds.has(node.id)
      )
    )
  )
    return false

  const previous = JSON.stringify(assembly)
  const previousConnections = assembly.connections
  const conductors = acConductors(project)
  if (inverter?.kind === 'inverter-unit') {
    inverter.properties.acConnection = converter.converterAcConnection
    if (separate && !inverter.ports.some((candidate) => candidate.role === 'inverter-backup-ac')) {
      inverter.ports.push(port('backup', 'inverter-backup-ac', getSupplyConverterAcConductors(converter, installation.nominalVoltage.system), 'source', 'many'))
    }
    for (const group of assembly.inverterGroups.filter((candidate) => candidate.unitNodeIds.includes(inverter.id))) {
      if (separate) {
        group.shared.capabilities.supportsBackupSupply = true
        group.shared.capabilities.hasDedicatedBackupAcOutput = true
        group.use.enabledForBackup = true
      }
    }
  }
  assembly.connections = assembly.connections.filter((edge) => !ownedEdges.has(edge))
  assembly.nodes = assembly.nodes.filter((node) => !oldNodeIds.has(node.id))
  const commonRole = separate ? 'load-ac' : 'grid-only-bypass-ac'
  let tail: [string, string] = separate ? [converter.id, 'backup'] : [utility.id, 'out']
  for (const device of serial) {
    assembly.connections.push(
      connection(
        `${pathPrefix}${device.id}`,
        tail,
        [device.id, 'source'],
        commonRole,
        conductors
      )
    )
    tail = [device.id, 'load']
  }

  const normalSection = panel.busSections?.find((section) => section.role === 'normal')
  const ownerHasCommonInput = assembly.loadHandoffs.some((handoff) => {
    const input = resolveAssemblyPanelInput(project, handoff.target)
    return (
      input?.panelId === panelId &&
      (normalSection ? input.busSectionId === normalSection.id : !input.busSectionId)
    )
  })
  const rootAssemblies = selectProjectSupplyAssemblies(project).filter((candidate) => {
    const input = resolveAssemblyPanelInput(project, candidate.incomingAttachment)
    return panels.some((root) => root.isMain !== false && root.id === input?.panelId)
  })
  const panelsWithoutInput =
    rootAssemblies.length === 1
      ? panels.filter(
          (candidate) =>
            candidate.id !== panelId &&
            candidate.isMain !== false &&
            !selectProjectSupplyAssemblies(project).some((owner) =>
              owner.loadHandoffs.some(
                (handoff) =>
                  resolveAssemblyPanelInput(project, handoff.target)?.panelId === candidate.id
              )
            )
        )
      : []
  for (const targetPanel of [...(ownerHasCommonInput ? [] : [panel]), ...panelsWithoutInput]) {
    const handoffNodeId = `${assembly.id}-panel-handoff-${targetPanel.id}`
    // A custom handoff using this identity is retained rather than overwritten.
    if (!assembly.nodes.some((node) => node.id === handoffNodeId)) {
      assembly.nodes.push({
        id: handoffNodeId,
        kind: 'panel-handoff',
        symbol: 'panel_distribution',
        label: targetPanel.name,
        properties: {},
        ports: [port('in', 'panel-handoff', conductors, 'sink')],
      })
      assembly.loadHandoffs.push({
        id: `${assembly.id}-panel-load-${targetPanel.id}`,
        handoffNodeId,
        target:
          targetPanel.id === panelId && normalSection
            ? { kind: 'panel-bus-input', panelId, busSectionId: normalSection.id }
            : { kind: 'panel-input', panelId: targetPanel.id },
        conductors: [...conductors],
      })
    }
  }
  assembly.nodes.push(...serial.map((device) => supplyAcBranchNode(device, conductors)))
  const tailPort = assembly.nodes
    .find((node) => node.id === tail[0])
    ?.ports.find((candidate) => candidate.id === tail[1])
  if (tailPort) tailPort.maxConnections = 'many'
  for (const handoff of assembly.loadHandoffs.filter((candidate) =>
    isGeneratedCommonPanelHandoff(assembly, candidate)
  )) {
    assembly.connections.push(
      connection(
        `${assembly.id}-to-${handoff.handoffNodeId}`,
        tail,
        [handoff.handoffNodeId, 'in'],
        commonRole,
        conductors
      )
    )
  }
  assembly.connections = preserveConnectionWireProperties(previousConnections, assembly.connections)
  reconcileInverterUnitMultiplier(project, converter)
  reconcileSupplyAssemblyAcConductorFlow(project, panelId)
  return JSON.stringify(assembly) !== previous
}

/** Upgrade the shared diagram without promoting a root panel's devices to shared ownership. */
export function initializeDirectConverterPanelBranches(
  project: ProjectWithOptionalV2Electrical,
  assembly: OffGridSupplyAssembly,
  options?: SupplyAssemblyReconcileOptions
): boolean {
  if (assembly.presetIntent !== 'grid_connected_storage_branch') return false
  const panelId = getAssemblyPanelId(assembly, project)
  const installation = getProjectElectricalInstallation(project)
  if (!panelId || !installation) return false
  const panels = getProjectElectricalPanels(project)
  const topology = ensureInstallationFeedTopology(installation, panels)
  const feed = topology.rootFeeds.find((candidate) => candidate.panelId === panelId)
  const devices = feed?.trunkDevices ?? []
  const converterIndex = devices.findIndex((device) => device.supplyPath === 'converter-branch')
  const converter = devices[converterIndex]
  const utility = assembly.nodes.find((node) => node.kind === 'utility-source')
  const ownerHandoffId = `${assembly.id}-root-input-${panelId}`
  const initialized = assembly.loadHandoffs.some((handoff) => handoff.id === ownerHandoffId)
  // Only a newly created, bare direct graph can acquire this ownership mode.
  // Existing common-output and custom handoffs retain their original meaning.
  if (!feed || !converter || !utility || (!initialized && assembly.loadHandoffs.length > 0)) return false
  if (!initialized && !assembly.connections.some((edge) => edge.pathRole === 'inverter-grid-ac' && edge.endpoints[1].nodeId === converter.id)) return false
  if (!initialized && assembly.connections.some((edge) => edge.pathRole !== 'inverter-grid-ac' && edge.domain !== 'DC')) return false
  const before = JSON.stringify(assembly)
  const prefix = `${assembly.id}-root-chain-`
  const separate = converter.symbol === 'inverter' && converter.converterAcConnection === 'separate'
  const inverter = assembly.nodes.find((node) => node.id === converter.id && node.kind === 'inverter-unit')
  if (inverter?.kind === 'inverter-unit') {
    inverter.properties.acConnection = converter.converterAcConnection
    if (separate && !inverter.ports.some((candidate) => candidate.role === 'inverter-backup-ac')) {
      inverter.ports.push(port('backup', 'inverter-backup-ac', getSupplyConverterAcConductors(converter, installation.nominalVoltage.system), 'source', 'many'))
    }
    for (const group of assembly.inverterGroups.filter((candidate) => candidate.unitNodeIds.includes(inverter.id))) {
      if (separate) {
        group.shared.capabilities.supportsBackupSupply = true
        group.shared.capabilities.hasDedicatedBackupAcOutput = true
        group.use.enabledForBackup = true
      }
    }
  }
  const previousEdges = assembly.connections
  const inverterIds = new Set(assembly.nodes.filter(isInverterUnitNode).map((node) => node.id))
  const ownedIds = new Set(assembly.connections.filter((edge) => edge.id.startsWith(prefix))
    .flatMap((edge) => edge.endpoints.map((endpoint) => endpoint.nodeId))
    .filter((id) => id !== utility.id && !inverterIds.has(id) && id !== `${ownerHandoffId}-node`))
  const serial = !initialized
    ? devices.filter((device) => device.supplyPath == null || device.supplyPath === 'serial')
    : selectSerialLoadDevicesForAssembly(
        devices,
        -1,
        assemblyOwnedPhysicalDeviceIds(assembly, options?.absorbDeviceIds),
        options
      )
  assembly.nodes = assembly.nodes.filter((node) => !ownedIds.has(node.id))
  assembly.connections = assembly.connections.filter((edge) => !edge.id.startsWith(prefix))
  const conductors = acConductors(project)
  let tail: [string, string] = [utility.id, 'out']
  let converterTap: [string, string] = tail
  let onBackup = false
  for (const device of serial) {
    if (separate && !onBackup && devices.indexOf(device) > converterIndex) {
      tail = [converter.id, 'backup']
      onBackup = true
    }
    if (!assembly.nodes.some((node) => node.id === device.id)) assembly.nodes.push(supplyAcBranchNode(device, conductors))
    assembly.connections.push(connection(`${prefix}${device.id}`, tail, [device.id, 'source'], onBackup ? 'load-ac' : 'grid-ac', conductors))
    tail = [device.id, 'load']
    if (devices.indexOf(device) < converterIndex) converterTap = tail
  }
  if (separate && !onBackup) tail = [converter.id, 'backup']
  // The converter branches off this root's own feed, while other roots still
  // branch from the common utility output before these local protections.
  const gridHeads = assembly.connections.filter((edge) => edge.pathRole === 'inverter-grid-ac' &&
    !assembly.connections.some((other) => other.pathRole === 'inverter-grid-ac' && other.endpoints[1].nodeId === edge.endpoints[0].nodeId))
  for (const gridHead of gridHeads) gridHead.endpoints[0] = { nodeId: converterTap[0], portId: converterTap[1] }
  const targets = initialized ? [] : panels.filter((panel) => panel.isMain !== false &&
    !selectProjectSupplyAssemblies(project).some((candidate) => candidate !== assembly && (
      resolveAssemblyPanelInput(project, candidate.incomingAttachment)?.panelId === panel.id ||
      candidate.loadHandoffs.some((handoff) => resolveAssemblyPanelInput(project, handoff.target)?.panelId === panel.id))))
  for (const panel of targets) {
    const owner = panel.id === panelId
    const id = owner ? ownerHandoffId : `${assembly.id}-panel-load-${panel.id}`
    const nodeId = owner ? `${id}-node` : `${assembly.id}-panel-handoff-${panel.id}`
    assembly.nodes.push({ id: nodeId, kind: 'panel-handoff', symbol: 'panel_distribution', label: panel.name, properties: {}, ports: [port('in', 'panel-handoff', conductors, 'sink')] })
    assembly.loadHandoffs.push({ id, handoffNodeId: nodeId, target: owner ? { kind: 'root-feed', rootFeedId: feed.id } : { kind: 'panel-input', panelId: panel.id }, conductors: [...conductors] })
    if (!owner) assembly.connections.push(connection(`${assembly.id}-to-${nodeId}`, [utility.id, 'out'], [nodeId, 'in'], 'grid-only-bypass-ac', conductors))
  }
  assembly.connections.push(connection(`${prefix}handoff`, tail, [`${ownerHandoffId}-node`, 'in'], 'load-ac', conductors))
  for (const node of assembly.nodes) for (const candidate of node.ports) {
    if (assembly.connections.filter((edge) => edge.endpoints[0].nodeId === node.id && edge.endpoints[0].portId === candidate.id).length > 1) candidate.maxConnections = 'many'
  }
  assembly.connections = preserveConnectionWireProperties(previousEdges, assembly.connections)
  reconcileInverterUnitMultiplier(project, converter)
  reconcileSupplyAssemblyAcConductorFlow(project, panelId)
  return before !== JSON.stringify(assembly)
}

export function reconcileDirectConverterGridProtections(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): boolean {
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return false
  const rootDevices =
    ensureInstallationFeedTopology(
      installation,
      getProjectElectricalPanels(project)
    ).rootFeeds.find((feed) => feed.panelId === panelId)?.trunkDevices ?? []
  const converter = rootDevices.find((device) => device.supplyPath === 'converter-branch')
  if (!converter) return false
  const assembly = findAssemblyForDirectConverter(project, converter.id)
  const utility = assembly?.nodes.find((node) => node.kind === 'utility-source')
  if (!assembly || !utility) return false
  const converterConductors = getSupplyConverterAcConductors(
    converter,
    installation.nominalVoltage.system
  )
  const converterNode = assembly.nodes
    .filter(isInverterUnitNode)
    .find((node) => node.id === converter.id)
  const gridInputConnected =
    converter.converterGridInputConnected !== false &&
    converterNode?.properties.gridInputConnected !== false
  converterNode?.ports
    .filter((candidate) => candidate.domain === 'AC')
    .forEach((candidate) => {
      candidate.conductors = [...converterConductors]
    })
  const protections = rootDevices.filter(
    (device) => gridInputConnected && device.supplyPath === 'converter-grid'
  )
  const previousProtectionIds = new Set(
    assembly.nodes
      .filter(
        (node) =>
          (node.kind === 'protection' || (node.kind === 'ac-distribution' && !!node.deviceId)) &&
          assembly.connections.some(
            (candidate) =>
              candidate.pathRole === 'inverter-grid-ac' &&
              candidate.endpoints.some((endpoint) => endpoint.nodeId === node.id)
          )
      )
      .map((node) => node.id)
  )
  assembly.nodes = [
    ...assembly.nodes.filter((node) => !previousProtectionIds.has(node.id)),
    ...protections.map((device) => supplyAcBranchNode(device, converterConductors)),
  ]
  const previousGridConnections = assembly.connections
  assembly.connections = assembly.connections.filter(
    (candidate) => candidate.pathRole !== 'inverter-grid-ac'
  )
  let previous: [string, string] = [utility.id, 'out']
  protections.forEach((device, index) => {
    assembly.connections.push(
      connection(
        `${utility.id}-grid-protection-${index}`,
        previous,
        [device.id, 'source'],
        'inverter-grid-ac',
        converterConductors
      )
    )
    previous = [device.id, 'load']
  })
  if (gridInputConnected) {
    assembly.connections.push(
      connection(
        `${utility.id}-to-${converter.id}`,
        previous,
        [converter.id, 'grid'],
        'inverter-grid-ac',
        converterConductors
      )
    )
  }
  assembly.connections = preserveConnectionWireProperties(
    previousGridConnections,
    assembly.connections
  )
  reconcileInverterUnitMultiplier(project, converter)
  reconcileDirectConverterCommonLoadPath(project, panelId)
  reconcileSupplyAssemblyAcConductorFlow(project, panelId)
  return true
}

/** Rebuilds both converter AC paths from their ordered, placeable supply devices. */
export function reconcileSupplyAssemblyBranchProtections(
  project: ProjectWithOptionalV2Electrical,
  panelId: string,
  options?: SupplyAssemblyReconcileOptions
): boolean {
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return false
  const topology = ensureInstallationFeedTopology(installation, getProjectElectricalPanels(project))
  const rootDevices =
    topology.rootFeeds.find((feed) => feed.panelId === panelId)?.trunkDevices ?? []
  const changeover = rootDevices.find((device) => device.symbol === 'source_changeover')
  const converter = rootDevices.find((device) => device.supplyPath === 'backup')
  if (!changeover || !converter) return false
  const assembly = findAssemblyForChangeover(project, changeover.id)
  if (!assembly) return false
  const previousAssembly = JSON.stringify(assembly)
  const utility = assembly.nodes.find((node) => node.kind === 'utility-source')
  const converterNode = assembly.nodes
    .filter(isInverterUnitNode)
    .find((node) => node.id === converter.id)
  if (!utility || !converterNode) return false
  const gridInputConnected =
    converter.converterGridInputConnected !== false &&
    converterNode.properties.gridInputConnected !== false

  const inlineGridDevices = rootDevices.filter(
    (device) =>
      gridInputConnected &&
      device.supplyPath === 'converter-grid' &&
      device.converterGridPlacement !== 'input-leg'
  )
  const inverterInputDevices = rootDevices.filter(
    (device) =>
      gridInputConnected &&
      device.supplyPath === 'converter-grid' &&
      device.converterGridPlacement === 'input-leg'
  )
  const backupDevices = rootDevices.filter((device) => device.supplyPath === 'backup-output')
  const changeoverGridDevices = rootDevices.filter(
    (device) => device.supplyPath === 'changeover-grid'
  )
  const changeoverGridInlineDevices = changeoverGridDevices.filter(
    (device) => device.changeoverGridPlacement !== 'input-leg'
  )
  const changeoverGridInputLegDevices = changeoverGridDevices.filter(
    (device) => device.changeoverGridPlacement === 'input-leg'
  )
  const changeoverIndex = rootDevices.findIndex((device) => device.id === changeover.id)
  const loadDevices = selectSerialLoadDevicesForAssembly(
    rootDevices,
    changeoverIndex,
    assemblyOwnedPhysicalDeviceIds(assembly, options?.absorbDeviceIds),
    options
  )
  const gridDevices = [...inlineGridDevices, ...inverterInputDevices]
  const branchDeviceIds = new Set(
    [...gridDevices, ...backupDevices, ...changeoverGridDevices, ...loadDevices].map(
      (device) => device.id
    )
  )
  const gridDistributionId = `${assembly.id}-grid-distribution`
  const inverterGridSplitId = `${assembly.id}-inverter-grid-distribution`
  const normalHandoffId = `${assembly.id}-normal-handoff-record`
  const normalHandoffNodeId = `${assembly.id}-normal-handoff`
  const panel = getProjectElectricalPanels(project).find((candidate) => candidate.id === panelId)
  const normalSection = panel?.busSections?.find((section) => section.role === 'normal')
  const backupSection = panel?.busSections?.find((section) => section.role === 'backup')
  const primaryHandoff = assembly.loadHandoffs.find(({ target }) => {
    const input =
      target.kind === 'root-feed'
        ? topology.rootFeeds.find((feed) => feed.id === target.rootFeedId)
        : target.kind === 'panel-input' || target.kind === 'panel-bus-input'
          ? target
          : undefined
    return (
      input?.panelId === panelId &&
      (!('busSectionId' in input) ||
        !input.busSectionId ||
        input.busSectionId === backupSection?.id)
    )
  })
  const previousBranchConnections = assembly.connections
  const previousNodes = new Map(assembly.nodes.map((node) => [node.id, node]))
  const multipliedUnitIds = new Set(
    assembly.inverterGroups
      .filter((group) => group.unitNodeIds.includes(converter.id))
      .flatMap((group) => group.unitNodeIds.filter((id) => id !== converter.id))
  )
  // These parallel edges are derived from the base converter and rebuilt by
  // reconcileInverterUnitMultiplier below; they are not ambiguous private feeds.
  const multipliedConnections = new Set(
    previousBranchConnections.filter((candidate) =>
      candidate.endpoints.some((endpoint) => multipliedUnitIds.has(endpoint.nodeId))
    )
  )
  const fixedNodeIds = new Set([utility.id, converter.id, changeover.id, gridDistributionId, inverterGridSplitId])
  // A role labels an electrical path, not ownership. Follow each generated
  // terminal backwards so private branches with the same role survive intact.
  let unsafeGeneratedPath = false
  const tracePath = (nodeId: string, portId: string, role: SupplyConnection['pathRole']) => {
    const path: SupplyConnection[] = []
    const visited = new Set<string>()
    let cursor = { nodeId, portId }
    while (!visited.has(cursor.nodeId)) {
      visited.add(cursor.nodeId)
      const incoming = previousBranchConnections.filter(
        (candidate) =>
          !multipliedConnections.has(candidate) &&
          candidate.pathRole === role &&
          candidate.endpoints[1].nodeId === cursor.nodeId &&
          candidate.endpoints[1].portId === cursor.portId
      )
      if (incoming.length !== 1) {
        if (incoming.length > 1) unsafeGeneratedPath = true
        break
      }
      const edge = incoming[0]!
      path.push(edge)
      const source = edge.endpoints[0]
      if (fixedNodeIds.has(source.nodeId)) break
      if (visited.has(source.nodeId)) {
        unsafeGeneratedPath = true
        break
      }
      const input = previousNodes
        .get(source.nodeId)
        ?.ports.find((candidate) => candidate.role === 'serial-source-side')
      if (!input) {
        unsafeGeneratedPath = true
        break
      }
      cursor = { nodeId: source.nodeId, portId: input.id }
    }
    return path
  }
  const oldLoadPath = primaryHandoff ? tracePath(primaryHandoff.handoffNodeId, 'in', 'load-ac') : []
  const rebuiltConnections = new Set([
    ...tracePath(gridDistributionId, 'in', 'grid-ac'),
    ...tracePath(inverterGridSplitId, 'in', 'grid-ac'),
    ...tracePath(changeover.id, 'grid', 'grid-ac'),
    ...tracePath(converter.id, 'grid', 'inverter-grid-ac'),
    ...tracePath(changeover.id, 'backup', 'inverter-backup-ac'),
    ...tracePath(normalHandoffNodeId, 'in', 'grid-only-bypass-ac'),
    ...oldLoadPath,
  ])
  // Custom virtual routing and multiply-fed inputs cannot be regenerated from a
  // serial editor list losslessly. Preserve their graph for explicit editing or
  // validation; hydration must never add another feed or bypass unknown nodes.
  if (unsafeGeneratedPath) return false
  // Modular upgrades historically retained only the owner's handoff. Other
  // root inputs still belong to the shared switched supply, ahead of their
  // own local protection chains. Explicit panel feeds keep their ownership.
  const rootPanelIds = new Set(collectRootPanels(getProjectElectricalPanels(project)).map((candidate) => candidate.id))
  const rootAssemblies = selectProjectSupplyAssemblies(project).filter((candidate) => {
    const input = resolveAssemblyPanelInput(project, candidate.incomingAttachment)
    return input != null && rootPanelIds.has(input.panelId)
  })
  if (primaryHandoff && rootAssemblies.length === 1) {
    for (const rootPanel of collectRootPanels(getProjectElectricalPanels(project))) {
      if (rootPanel.id === panelId || selectProjectSupplyAssemblies(project).some((candidate) =>
        (candidate.id !== assembly.id && resolveAssemblyPanelInput(project, candidate.incomingAttachment)?.panelId === rootPanel.id) || candidate.loadHandoffs.some((handoff) =>
          resolveAssemblyPanelInput(project, handoff.target)?.panelId === rootPanel.id
        )
      )) continue
      const handoffNodeId = `${assembly.id}-panel-handoff-${rootPanel.id}`
      if (assembly.nodes.some((node) => node.id === handoffNodeId)) continue
      const conductors = acConductors(project)
      assembly.nodes.push({
        id: handoffNodeId, kind: 'panel-handoff', symbol: 'panel_distribution',
        label: rootPanel.name, properties: {},
        ports: [port('in', 'panel-handoff', conductors, 'sink')],
      })
      assembly.loadHandoffs.push({
        id: `${assembly.id}-panel-load-${rootPanel.id}`, handoffNodeId,
        target: { kind: 'panel-input', panelId: rootPanel.id }, conductors,
      })
    }
  }
  const previousBranchDeviceIds = new Set(
    [...rebuiltConnections]
      .flatMap((candidate) => candidate.endpoints.map(({ nodeId }) => nodeId))
      .filter(
        (nodeId) => !fixedNodeIds.has(nodeId) && previousNodes.get(nodeId)?.kind !== 'panel-handoff'
      )
  )
  const loadTail: [string, string] = [loadDevices.at(-1)?.id ?? changeover.id, 'load']
  const oldLoadNodeIds = new Set(
    oldLoadPath.flatMap((candidate) => candidate.endpoints.map(({ nodeId }) => nodeId))
  )
  const removedCommonNodeIds = new Set(
    [...previousBranchDeviceIds].filter((nodeId) => !branchDeviceIds.has(nodeId))
  )
  // Deleting a common serial device bypasses only that device. Private earlier
  // takeoffs keep their predecessor; they must not move to the final load tail.
  const survivingPredecessor = (
    nodeId: string
  ): SupplyConnection['endpoints'][number] | undefined => {
    const visited = new Set<string>()
    let cursor = nodeId
    while (removedCommonNodeIds.has(cursor) && !visited.has(cursor)) {
      visited.add(cursor)
      const incoming = [...rebuiltConnections].filter(
        (candidate) => candidate.endpoints[1].nodeId === cursor
      )
      if (incoming.length !== 1) return undefined
      const source = incoming[0]!.endpoints[0]
      if (!removedCommonNodeIds.has(source.nodeId)) return source
      cursor = source.nodeId
    }
    return undefined
  }
  const isGeneratedPanelHandoff = (handoff: OffGridSupplyAssembly['loadHandoffs'][number]) =>
    (handoff.target.kind === 'panel-input' || handoff.target.kind === 'panel-bus-input') &&
    handoff.id === `${assembly.id}-panel-load-${handoff.target.panelId}` &&
    handoff.handoffNodeId === `${assembly.id}-panel-handoff-${handoff.target.panelId}`
  const generatedFanoutNodes = new Set(
    assembly.loadHandoffs.filter(isGeneratedPanelHandoff).map(({ handoffNodeId }) => handoffNodeId)
  )
  const retainedConnections = previousBranchConnections
    .filter(
      (candidate) => !rebuiltConnections.has(candidate) && !multipliedConnections.has(candidate)
    )
    .map((candidate) => {
      const [source, target] = candidate.endpoints
      const generatedFanout =
        (candidate.pathRole === 'load-ac' || candidate.pathRole === 'grid-only-bypass-ac') &&
        generatedFanoutNodes.has(target.nodeId) &&
        candidate.id === `${assembly.id}-to-${target.nodeId}` &&
        (oldLoadNodeIds.has(source.nodeId) || source.nodeId === changeover.id || source.nodeId === utility.id)
      const replacement = generatedFanout
        ? { nodeId: loadTail[0], portId: loadTail[1] }
        : survivingPredecessor(source.nodeId)
      return replacement
        ? { ...candidate, ...(generatedFanout ? { pathRole: 'load-ac' as const } : {}), endpoints: [replacement, target] as SupplyConnection['endpoints'] }
        : candidate
    })
  // Ambiguous graph-only nodes remain available for validation instead of being
  // silently removed along with their private wiring.
  const retainedNodeIds = new Set(
    retainedConnections.flatMap((candidate) => candidate.endpoints.map(({ nodeId }) => nodeId))
  )
  const obsoleteNodeIds = new Set(
    [...previousBranchDeviceIds].filter(
      (nodeId) => !branchDeviceIds.has(nodeId) && !retainedNodeIds.has(nodeId)
    )
  )
  const conductors = acConductors(project)
  const converterConductors = getSupplyConverterAcConductors(
    converter,
    installation.nominalVoltage.system
  )
  const branchNodes = [
    ...gridDevices.map((device) => supplyAcBranchNode(device, converterConductors)),
    ...backupDevices.map((device) => supplyAcBranchNode(device, converterConductors)),
    ...changeoverGridDevices.map((device) => supplyAcBranchNode(device, conductors)),
    ...loadDevices.map((device) => supplyAcBranchNode(device, conductors)),
  ]
  for (const node of branchNodes) {
    for (const candidate of node.ports) {
      const previousPort = previousNodes
        .get(node.id)
        ?.ports.find((port) => port.id === candidate.id)
      if (previousPort) candidate.maxConnections = previousPort.maxConnections
    }
  }
  const gridDistribution: SupplyNode = {
    id: gridDistributionId,
    kind: 'ac-distribution',
    symbol: 'panel_distribution',
    label: 'Grid split',
    properties: {},
    ports: [
      port('in', 'grid-distribution-ac', conductors, 'sink'),
      port('out', 'grid-distribution-ac', conductors, 'source', 'many'),
    ],
  }
  // The inverter takes power at the first T junction. A normal/backup panel
  // needs a second junction farther downstream to divide the grid-only bus
  // from the changeover's grid input.
  const hasSecondGridSplit = Boolean(normalSection && gridInputConnected)
  const firstGridSplitId = hasSecondGridSplit ? inverterGridSplitId : gridDistributionId
  const inverterGridSplit: SupplyNode = {
    ...gridDistribution,
    id: inverterGridSplitId,
    ports: gridDistribution.ports.map((candidate) => ({
      ...candidate,
      conductors: [...candidate.conductors],
    })),
  }
  converterNode.ports
    .filter((candidate) => candidate.domain === 'AC')
    .forEach((candidate) => {
      candidate.conductors = [...converterConductors]
    })
  const changeoverNode = assembly.nodes.find((node) => node.id === changeover.id)
  const backupPort = changeoverNode?.ports.find((candidate) => candidate.id === 'backup')
  if (backupPort) backupPort.conductors = [...converterConductors]
  assembly.nodes = [
    ...assembly.nodes.filter(
      (node) =>
        node.id !== gridDistributionId &&
        node.id !== inverterGridSplitId &&
        node.id !== normalHandoffNodeId &&
        !obsoleteNodeIds.has(node.id) &&
        !branchDeviceIds.has(node.id)
    ),
    ...branchNodes,
    gridDistribution,
    ...(hasSecondGridSplit ? [inverterGridSplit] : []),
  ]
  assembly.connections = retainedConnections

  const appendSerialPath = (
    pathId: string,
    first: [string, string],
    devices: TrunkDevice[],
    last: [string, string],
    pathRole:
      'grid-ac' | 'grid-only-bypass-ac' | 'inverter-grid-ac' | 'inverter-backup-ac' | 'load-ac',
    pathConductors: AcPhase[]
  ) => {
    let previous = first
    devices.forEach((device, index) => {
      assembly.connections.push(
        connection(
          `${pathId}-${index}-in`,
          previous,
          [device.id, 'source'],
          pathRole,
          pathConductors
        )
      )
      previous = [device.id, 'load']
    })
    assembly.connections.push(connection(`${pathId}-out`, previous, last, pathRole, pathConductors))
  }
  appendSerialPath(
    `${utility.id}-to-grid-distribution`,
    [utility.id, 'out'],
    [],
    [firstGridSplitId, 'in'],
    'grid-ac',
    conductors
  )
  if (hasSecondGridSplit) {
    appendSerialPath(
      `${inverterGridSplitId}-to-${gridDistributionId}`,
      [inverterGridSplitId, 'out'],
      inlineGridDevices,
      [gridDistributionId, 'in'],
      'grid-ac',
      conductors
    )
  }
  // Without a separate normal bus, the lower grid lane continues to the switch.
  // With split buses, its inline devices belong only to the normal-bus bypass.
  const changeoverInputDevices = normalSection
    ? changeoverGridInputLegDevices
    : [...inlineGridDevices, ...changeoverGridInlineDevices, ...changeoverGridInputLegDevices]
  if (changeoverInputDevices.length > 0) {
    appendSerialPath(
      `${gridDistributionId}-to-${changeover.id}-grid`,
      [gridDistributionId, 'out'],
      changeoverInputDevices,
      [changeover.id, 'grid'],
      'grid-ac',
      conductors
    )
  } else {
    assembly.connections.push(
      connection(
        `${gridDistributionId}-to-${changeover.id}-grid`,
        [gridDistributionId, 'out'],
        [changeover.id, 'grid'],
        'grid-ac',
        conductors
      )
    )
  }
  if (gridInputConnected) {
    appendSerialPath(
      `${utility.id}-to-${converter.id}`,
      [firstGridSplitId, 'out'],
      inverterInputDevices,
      [converter.id, 'grid'],
      'inverter-grid-ac',
      converterConductors
    )
  }
  appendSerialPath(
    `${converter.id}-to-${changeover.id}`,
    [converter.id, 'backup'],
    [...backupDevices]
      .sort((a, b) => a.trunkPosition - b.trunkPosition || a.id.localeCompare(b.id))
      .reverse(),
    [changeover.id, 'backup'],
    'inverter-backup-ac',
    converterConductors
  )

  assembly.loadHandoffs = assembly.loadHandoffs.filter(
    (candidate) => candidate.id !== normalHandoffId
  )
  const backupHandoff = primaryHandoff
  if (backupHandoff) {
    if (backupSection) {
      backupHandoff.target = {
        kind: 'panel-bus-input',
        panelId,
        busSectionId: backupSection.id,
      }
    }
    appendSerialPath(
      `${changeover.id}-to-${backupHandoff.handoffNodeId}`,
      [changeover.id, 'load'],
      loadDevices,
      [backupHandoff.handoffNodeId, 'in'],
      'load-ac',
      conductors
    )
  }
  if (normalSection) {
    if (!assembly.nodes.some((node) => node.id === normalHandoffNodeId)) {
      assembly.nodes.push({
        id: normalHandoffNodeId,
        kind: 'panel-handoff',
        symbol: 'panel_distribution',
        label: normalSection.label,
        properties: {},
        ports: [port('in', 'panel-handoff', conductors, 'sink')],
      })
    }
    const normalHandoff = {
      id: normalHandoffId,
      handoffNodeId: normalHandoffNodeId,
      target: {
        kind: 'panel-bus-input' as const,
        panelId,
        busSectionId: normalSection.id,
      },
      conductors: [...conductors],
    }
    assembly.loadHandoffs = [
      ...assembly.loadHandoffs.filter((candidate) => candidate.id !== normalHandoffId),
      normalHandoff,
    ]
    appendSerialPath(
      `${gridDistributionId}-to-${normalHandoffNodeId}`,
      [gridDistributionId, 'out'],
      changeoverGridInlineDevices,
      [normalHandoffNodeId, 'in'],
      'grid-only-bypass-ac',
      conductors
    )
  }
  const loadTailPort = assembly.nodes
    .find((node) => node.id === loadTail[0])
    ?.ports.find((candidate) => candidate.id === loadTail[1])
  // Repair only the recognizable historical generated fan-out. Unknown orphan
  // handoffs remain disconnected and are reported by validation, never guessed.
  for (const handoff of assembly.loadHandoffs) {
    if (
      !isGeneratedPanelHandoff(handoff) ||
      !assembly.nodes.some(
        (node) =>
          node.id === handoff.handoffNodeId &&
          node.kind === 'panel-handoff' &&
          node.ports.some((candidate) => candidate.id === 'in' && candidate.domain === 'AC')
      ) ||
      assembly.connections.some(
        (candidate) => candidate.endpoints[1].nodeId === handoff.handoffNodeId
      )
    )
      continue
    assembly.connections.push(
      connection(
        `${assembly.id}-to-${handoff.handoffNodeId}`,
        loadTail,
        [handoff.handoffNodeId, 'in'],
        'load-ac',
        conductors
      )
    )
    if (loadTailPort) loadTailPort.maxConnections = 'many'
  }
  assembly.connections = preserveConnectionWireProperties(
    previousBranchConnections,
    assembly.connections
  )
  for (const node of assembly.nodes) {
    for (const candidate of node.ports) {
      if (
        assembly.connections.filter(
          (edge) =>
            edge.endpoints[0].nodeId === node.id && edge.endpoints[0].portId === candidate.id
        ).length > 1
      )
        candidate.maxConnections = 'many'
    }
  }
  reconcileInverterUnitMultiplier(project, converter)
  reconcileSupplyAssemblyAcConductorFlow(project, panelId)
  // Generated and preserved branches must settle into the same order on the
  // repair pass and every later hydration pass.
  assembly.connections.sort((left, right) => left.id.localeCompare(right.id))
  return JSON.stringify(assembly) !== previousAssembly
}

/**
 * Repairs the early prototype state where a changeover assembly could be stored on
 * the shared/supply-panel side. With one main panel it can be moved losslessly to that
 * panel's root feed. With multiple roots the ownership is ambiguous, so the records
 * are preserved for validation or manual repair rather than guessed or deleted.
 */
export function healSourceChangeoverFeedScope(project: ProjectWithOptionalV2Electrical): boolean {
  const installation = getProjectElectricalInstallation(project)
  const panels = getProjectElectricalPanels(project)
  if (!installation) return false
  const topology = ensureInstallationFeedTopology(installation, panels)
  const sharedDevices = topology.sharedFeed.trunkDevices ?? []
  const invalidDevices = sharedDevices.filter(isAssemblyOnlySupplyDevice)
  if (invalidDevices.length === 0) return false

  const roots = collectRootPanels(panels)
  if (roots.length !== 1) {
    logger.warn(
      '[SUPPLY-PERSIST] preserving ambiguous shared changeover topology during hydration',
      {
        rootPanelIds: roots.map((panel) => panel.id),
        deviceIds: invalidDevices.map((device) => device.id),
      }
    )
    return false
  }

  const invalidIds = new Set(invalidDevices.map((device) => device.id))
  const retainedShared = sharedDevices.filter((device) => !invalidIds.has(device.id))
  retainedShared.forEach((device, index) => {
    device.trunkPosition = index
  })
  topology.sharedFeed.trunkDevices = retainedShared
  installation.mainSupply.supplyTrunkDevices = [...retainedShared]

  const rootFeed = topology.rootFeeds.find((feed) => feed.panelId === roots[0]!.id)
  if (rootFeed) {
    const existingIds = new Set((rootFeed.trunkDevices ?? []).map((device) => device.id))
    rootFeed.trunkDevices = [
      ...(rootFeed.trunkDevices ?? []),
      ...invalidDevices.filter((device) => !existingIds.has(device.id)),
    ]
    rootFeed.trunkDevices.forEach((device, index) => {
      device.trunkPosition = index
    })
  }
  return true
}
