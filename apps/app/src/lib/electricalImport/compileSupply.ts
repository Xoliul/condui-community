import type { ProjectV2 } from '@/types/projectV2'
import type { TrunkDevice, SymbolKey } from '@/types/schema'
import { generateId } from '@/utils/project'
import { collectRootPanels, ensureInstallationFeedTopology } from '@/lib/feedTopology'
import {
  editProjectSupplyAssemblies,
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectSupplyAssemblies,
} from '@/lib/projectV2/electrical'
import { buildAutoSitplanPlacement } from '@/lib/plan/autoSitplanPlacement'
import { markAwaitingPlanPlacement } from '@/lib/plan/customPlacement'
import {
  attachBackupConverterToAssembly,
  buildDirectConverterSupplyAssembly,
  initializeDirectConverterPanelBranches,
  reconcileDirectConverterDcDevices,
  reconcileDirectConverterGridProtections,
  reconcileInverterUnitMultiplier,
  reconcileSupplyAssemblyAcConductorFlow,
  reconcileSupplyAssemblyBranchProtections,
} from '@/lib/supplyAssembly/editorIntegration'
import { disconnectSupplyInverterGridInputInProject } from '@/lib/supplyAssembly/disconnectInverterGridInput'
import {
  getDefaultSupplyConverterAcPhaseAssignment,
  getDefaultSupplyInverterUnitPhaseAssignments,
} from '@/lib/supplyAssembly/supplyConverterPhases'
import { validateOffGridSupplyAssembly } from '@/lib/supplyAssembly/validation'
import { resolveAssemblyPanelInput } from '@/lib/supplyAssembly/electricalTopology'
import type { OffGridSupplyAssembly } from '@/types/supplyAssembly'
import type { ElectricalImportProtection } from './types'
import type { ElectricalImportSupplySystem } from './supplyTypes'

export interface CompiledElectricalImportSupply {
  warnings: string[]
  /** Physical units, including multiplied inverters and batteries. */
  deviceCount: number
  connectionCount: number
}

function hasDirectedAcPath(assembly: OffGridSupplyAssembly, from: string, to: string): boolean {
  const visited = new Set<string>()
  const pending = [from]
  while (pending.length) {
    const current = pending.pop()!
    if (current === to) return true
    if (visited.has(current)) continue
    visited.add(current)
    for (const connection of assembly.connections) {
      if (connection.domain === 'AC' && connection.endpoints[0].nodeId === current)
        pending.push(connection.endpoints[1].nodeId)
    }
  }
  return false
}

function protectionDevice(
  source: ElectricalImportProtection,
  path: TrunkDevice['supplyPath'],
  fallbackLabel: string
): TrunkDevice {
  return {
    id: generateId(),
    type: 'protection',
    symbol: source.type.toLowerCase() as Extract<
      SymbolKey,
      'mcb' | 'rcd' | 'rcbo' | 'fuse' | 'main_switch'
    >,
    label: source.label ?? fallbackLabel,
    protectionType: source.type,
    ratingA: source.ratingA ?? undefined,
    curve: source.curve ?? undefined,
    sensitivityMa: source.sensitivityMa ?? undefined,
    residualCurrentType: source.residualCurrentType ?? undefined,
    polesConfig: source.poles ?? undefined,
    poles: source.poles ? Number.parseInt(source.poles, 10) : undefined,
    breakingCapacityKa: source.breakingCapacityKa ?? undefined,
    trunkPosition: 0,
    supplyPath: path,
  }
}

/**
 * Creation-only adapter shared by AI proposals, scans, and semantic JSON imports.
 * The caller validates the semantic document and supplies a NEW local candidate.
 * Native supply builders own graph IDs, ports, conductor flow, and handoffs.
 * Never run this against an existing custom supply graph or a live editor store.
 */
export function compileElectricalImportSupply(
  project: ProjectV2,
  panelId: string,
  spec: ElectricalImportSupplySystem
): CompiledElectricalImportSupply {
  const installation = getProjectElectricalInstallation(project)
  const panels = getProjectElectricalPanels(project)
  const roots = collectRootPanels(panels)
  const panel = roots.find((candidate) => candidate.id === panelId)
  if (!installation || !panel || roots.length !== 1)
    throw new Error('Supply creation requires exactly one main panel.')
  if (selectProjectSupplyAssemblies(project).length)
    throw new Error('Supply creation cannot replace an existing supply assembly.')
  if ((panel.busSections?.length ?? 0) > 1)
    throw new Error('Supply creation cannot choose loads for existing split busbars.')
  const system = installation.nominalVoltage.system
  if (system !== '1N~' && system !== '3N~')
    throw new Error('Supply creation requires explicit 1N~ or 3N~ voltage.')
  if (spec.inverter.unitCount === 3 && system !== '3N~')
    throw new Error('Three inverter units require a three-phase installation.')
  if (
    spec.topology === 'manual_changeover' &&
    (!spec.changeover ||
      spec.changeover.neutralTreatment !== 'switched' ||
      spec.changeover.poles !== (system === '3N~' ? '4P' : '2P'))
  ) {
    throw new Error('Manual changeover requires explicit matching poles and switched neutral.')
  }
  if (spec.topology === 'direct_backup' && spec.changeover)
    throw new Error('A direct backup supply cannot include an external changeover.')
  if (!spec.gridInputConnected && spec.acProtections?.grid)
    throw new Error('A disconnected inverter grid input cannot have a grid-input protection.')
  if ((spec.branches.length > 1 || spec.inverter.unitCount > 1) && !spec.dcBus)
    throw new Error('Multiple sources or inverter units require an explicit shared DC bus.')
  const floorId = project.building.floors[0]?.id
  if (!floorId)
    throw new Error('Supply creation requires a floor for deferred physical placements.')
  const oldRootDevices =
    installation.feedTopology?.rootFeeds.flatMap((feed) => feed.trunkDevices ?? []) ?? []
  const preexistingDevices = [
    ...(installation.mainSupply.supplyTrunkDevices ?? []),
    ...oldRootDevices,
  ]
  if (
    preexistingDevices.some(
      (device) =>
        !['energy_meter', 'protection'].includes(device.type) ||
        (device.supplyPath && device.supplyPath !== 'serial')
    )
  ) {
    throw new Error('Supply creation accepts only the initial imported meters and protections.')
  }

  const topology = ensureInstallationFeedTopology(installation, panels)
  const rootFeed = topology.rootFeeds.find((feed) => feed.panelId === panelId)
  if (!rootFeed) throw new Error('The main panel has no root supply feed.')
  const devices = rootFeed.trunkDevices ?? (rootFeed.trunkDevices = [])
  const added: TrunkDevice[] = []
  const warnings: string[] = []
  const supplyCircuitId = panel.circuits.find((circuit) => circuit.code === 'PANEL')?.id ?? panel.id
  const append = (device: TrunkDevice, count = 0) => {
    device.trunkPosition = devices.length
    devices.push(device)
    added.push(device)
    if (count > 0) {
      device.placements = []
      for (let index = 0; index < count; index++) {
        const placement = buildAutoSitplanPlacement(project, {
          circuitId: supplyCircuitId,
          floorId,
          placementId: generateId(),
          ignoreManualPlacementPreference: true,
        })
        if (!placement) throw new Error('Could not create a deferred supply-device placement.')
        device.placements.push(markAwaitingPlanPlacement(placement))
      }
    }
    return device
  }

  const changeover =
    spec.topology === 'manual_changeover'
      ? append({
          id: generateId(),
          type: 'changeover',
          symbol: 'source_changeover',
          label: spec.changeover?.label ?? spec.label ?? 'Changeover',
          trunkPosition: 0,
          polesConfig: spec.changeover!.poles,
          poles: Number.parseInt(spec.changeover!.poles, 10),
          changeoverProps: { port1Label: '1', port2Label: '2' },
        })
      : null
  const inverter = append(
    {
      id: generateId(),
      type: 'conversion',
      symbol: 'inverter',
      label: spec.inverter.label ?? (changeover ? 'Inverter' : (spec.label ?? 'Inverter')),
      trunkPosition: 0,
      supplyPath: changeover ? 'backup' : 'converter-branch',
      // Initialize a connected graph first so native direct-panel handoff creation runs.
      // An explicit disconnect is applied after that handoff exists.
      converterGridInputConnected: true,
      ...(changeover ? {} : { converterAcConnection: 'separate' as const }),
      conversionProps: {
        brand: spec.inverter.brand,
        model: spec.inverter.model,
        power: spec.inverter.powerW === undefined ? undefined : `${spec.inverter.powerW} W`,
        serialNumbers: Array.from({ length: spec.inverter.unitCount }, () => ''),
        acPhaseAssignment: getDefaultSupplyConverterAcPhaseAssignment(system),
        acPhaseAssignments:
          spec.inverter.unitCount === 3
            ? getDefaultSupplyInverterUnitPhaseAssignments(system, 3)
            : undefined,
        dcConnectionCount: 1,
      },
    },
    spec.inverter.unitCount
  )
  // The native assembly has no display-name field; retain a distinct system title as a note.
  if (spec.label && spec.label !== inverter.label) inverter.notes = spec.label
  if (spec.acProtections?.grid)
    append(protectionDevice(spec.acProtections.grid, 'converter-grid', 'Inverter input'))
  if (spec.acProtections?.backup) {
    // A direct separate-AC converter's ordinary post-converter chain is its backup output.
    append(
      protectionDevice(
        spec.acProtections.backup,
        changeover ? 'backup-output' : 'serial',
        'Inverter output'
      )
    )
  }

  const bus = spec.dcBus
    ? append({
        id: generateId(),
        type: 'dc_bus',
        symbol: 'dc_bus',
        label: spec.dcBus.label ?? 'DC bus',
        trunkPosition: 0,
        supplyPath: 'converter-dc',
        supplyConverterDcConnectionIndex: 0,
        dcBusProps: { ratedVoltageV: spec.dcBus.voltageV, ratedCurrentA: spec.dcBus.ratedCurrentA },
      })
    : null
  for (const branch of spec.branches) {
    const branchId = generateId()
    const ownership = {
      supplyPath: 'converter-dc' as const,
      supplyConverterDcConnectionIndex: 0,
      ...(bus ? { supplyDcBusId: bus.id, supplyDcBusBranchId: branchId } : {}),
    }
    if (branch.protection)
      append({
        ...protectionDevice(branch.protection, 'converter-dc', branch.label ?? 'DC protection'),
        ...ownership,
      })
    const source = branch.source
    if (source.type === 'battery') {
      append(
        {
          id: generateId(),
          type: 'storage',
          symbol: 'battery',
          label: source.label ?? branch.label ?? 'Battery',
          notes: branch.label,
          trunkPosition: 0,
          ...ownership,
          batteryProps: {
            voltageV: source.voltageV,
            capacityKWh: source.capacityKWh,
            brand: source.brand,
            model: source.model,
            serialNumbers: Array.from({ length: source.count }, () => ''),
          },
        },
        source.count
      )
    } else {
      append(
        {
          id: generateId(),
          type: 'generation',
          symbol: 'solar_panel',
          label: source.label ?? branch.label ?? 'PV',
          notes: branch.label,
          trunkPosition: 0,
          ...ownership,
          solarPanelProps: { wattageW: source.wattageW, voltageV: source.voltageV },
        },
        1
      )
    }
  }

  const assembly = changeover
    ? attachBackupConverterToAssembly(project, panelId, changeover, inverter)
    : buildDirectConverterSupplyAssembly(project, panelId, inverter)
  if (changeover && spec.changeover) {
    const node = assembly.nodes.find((candidate) => candidate.id === changeover.id)
    if (!node || node.kind !== 'changeover-switch')
      throw new Error('The manual changeover node is missing.')
    node.properties.poles = spec.changeover.poles === '4P' ? 4 : 2
    node.properties.neutralTreatment = spec.changeover.neutralTreatment
  }
  editProjectSupplyAssemblies(project).push(assembly)
  const absorb = { absorbDeviceIds: added.map((device) => device.id) }
  if (changeover) reconcileSupplyAssemblyBranchProtections(project, panelId, absorb)
  else {
    if (!initializeDirectConverterPanelBranches(project, assembly, absorb))
      throw new Error('The inverter backup output could not be connected to the main panel.')
    reconcileDirectConverterGridProtections(project, panelId)
  }
  reconcileDirectConverterDcDevices(project, panelId)
  reconcileInverterUnitMultiplier(project, inverter)
  if (!spec.gridInputConnected) {
    if (!disconnectSupplyInverterGridInputInProject(project, assembly.id, panelId))
      throw new Error('The inverter grid input could not be disconnected.')
    if (changeover)
      warnings.push(
        'The inverter grid input is disconnected; the manual changeover retains its utility bypass.'
      )
  }
  reconcileSupplyAssemblyAcConductorFlow(project, panelId)

  // Helpers may normalize native arrays; inspect the final canonical assembly, not a stale copy.
  const finalAssembly = selectProjectSupplyAssemblies(project).find(
    (candidate) => candidate.id === assembly.id
  )
  if (!finalAssembly) throw new Error('The compiled supply assembly is missing.')
  const inverterNodes = finalAssembly.nodes.filter((node) => node.kind === 'inverter-unit')
  if (!changeover && !spec.gridInputConnected) {
    const inverterNodeIds = new Set(inverterNodes.map((node) => node.id))
    for (const group of finalAssembly.inverterGroups) {
      if (!group.unitNodeIds.some((id) => inverterNodeIds.has(id))) continue
      // This records the explicitly requested isolated operating mode, not verified product data.
      group.shared.capabilities.supportsIslandMode = true
      group.shared.capabilities.evidence = { source: 'manual' }
      group.use.enabledForIslandMode = true
    }
  }
  const handoff = finalAssembly.loadHandoffs[0]
  if (
    inverterNodes.length !== spec.inverter.unitCount ||
    finalAssembly.loadHandoffs.length !== 1 ||
    !handoff ||
    resolveAssemblyPanelInput(project, handoff.target)?.panelId !== panelId
  ) {
    throw new Error(
      'The compiled supply does not match the requested inverter units and main-panel output.'
    )
  }
  if (
    !spec.gridInputConnected &&
    finalAssembly.connections.some((edge) => edge.pathRole === 'inverter-grid-ac')
  ) {
    throw new Error('The disconnected inverter grid input still has a graph connection.')
  }
  if (
    !changeover &&
    (!inverterNodes.every((node) =>
      finalAssembly.connections.some(
        (edge) =>
          edge.domain === 'AC' &&
          edge.endpoints[0].nodeId === node.id &&
          node.ports.some(
            (port) => port.id === edge.endpoints[0].portId && port.role === 'inverter-backup-ac'
          ) &&
          hasDirectedAcPath(finalAssembly, edge.endpoints[1].nodeId, handoff.handoffNodeId)
      )
    ) ||
      (!spec.gridInputConnected &&
        finalAssembly.nodes
          .filter((node) => node.kind === 'utility-source')
          .some((node) => hasDirectedAcPath(finalAssembly, node.id, handoff.handoffNodeId))))
  ) {
    throw new Error(
      'The main-panel output is not supplied by the requested direct inverter backup path.'
    )
  }
  const validation = validateOffGridSupplyAssembly(finalAssembly)
  if (validation.status !== 'valid')
    throw new Error(
      `Compiled supply topology failed validation: ${validation.issues.map((issue) => issue.code).join(', ')}`
    )
  warnings.push(...validation.issues.map((issue) => issue.message))
  warnings.push(
    'Supply equipment and protection values are imported as specified; electrical compliance has not been verified.'
  )
  return {
    warnings,
    deviceCount:
      added.length +
      spec.inverter.unitCount -
      1 +
      spec.branches.reduce(
        (sum, branch) => sum + (branch.source.type === 'battery' ? branch.source.count - 1 : 0),
        0
      ),
    connectionCount: finalAssembly.connections.length,
  }
}
