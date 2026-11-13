import { nanoid } from 'nanoid'
import { isSavedForkMove, simulateSavedForkMove } from './simulateSavedForkMove'
import { hideInlineConverterMetadataByDefault } from '@/lib/conversionLabels'
import type {
  Panel,
  Circuit,
  Endpoint,
  TrunkDevice,
  ProtectionDevice,
  Branch,
} from '@/types/schema'
import {
  canDropDcBusOnTarget,
  canDropSymbolOnSupplyConverterDcWire,
  dropBehaviors,
  isEmptyProtectionCircuitForDcDrop,
} from '@/lib/eendraad/dropBehaviors'
import { symbolSupportsWireDomain, type SymbolMetadata } from '@/lib/symbols'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import {
  circuitAcceptsTrunkSwitch,
  isCircuitTrunkSwitchDropTarget,
  isCircuitTrunkSwitchSymbol,
} from '@/lib/eendraad/circuitTrunkSwitch'
import { initializeBranchesIfNeeded } from '@/lib/layout/endpointChains'
import { getEndpointTypeFromSymbol, getSymbolKeyFromSymbol } from '@/utils'
import {
  computeEndpointInsertAfter,
  isDcOnlyEndpointSymbol,
  normalizeDomoticaChildDropIntent,
  shouldDefaultRelayToImpulse,
} from '@/lib/eendraad/endpointInsertAfter'
import { resolveSymbolPortsForWire } from '@/lib/symbols'
import { getNextAvailableCircuitCode } from '@/utils/project'
import {
  getDefaultProtectionProps,
  getDefaultTrunkDeviceProtectionProps,
  getProtectionCreationProps,
  getVoltagePolesConfig,
} from '@/lib/protectionDefaults'
import {
  PROTECTION_SYMBOL_ID_TO_TYPE,
  isCircuitTrunkAddOnProtectionType,
  resolveInitialProtectionBusLabel,
} from '@/lib/protectionKind'
import { generateId } from '@/utils'
import { getTerminalStripTrunkConnectionProps } from '@/lib/terminalStrip/labels'
import {
  circuitContainsJunctionPanelIdentity,
  getJunctionIdentity,
  getNextJunctionIdentity,
  isSharedJunctionSymbol,
} from '@/lib/junctionIdentity'
import {
  createDefaultAcCircuitCable,
  DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
} from '@/lib/wires/circuitWireDefaults'
import { getSupplyFeedDevicesForPanel } from '@/lib/feedTopology'
import {
  domoticaChildRefForEndpoint,
  updateDomoticaChainHeadAfterInsert,
  resolveDomoticaConversionDropTarget,
  domoticaChildRefForBranchInsert,
  insertDomoticaChildEndpoint,
} from '@/lib/eendraad/domoticaOutputOrdering'
import { syncSequentialEndpointBranchLabelsToCircuit } from '@/lib/eendraad/automaticEndpointBranchNaming'
import { getAllCircuits } from '@/lib/eendraad/projectElectricalDomain'
import { getMainBusItemsWithIndices } from '@/lib/eendraad/mainBusOrder'
import {
  isEndpointBranchDropTarget,
  refreshBranchDropTargetAfterInsert,
  resolveSmartSwitchExpansion,
  shouldApplySmartSwitchExpansion,
} from '@/lib/eendraad/smartSwitchDrop'
import { clamp } from '@/lib/geometry'
import {
  findOrdinaryCircuitDcBusForOutput,
  getCircuitConverterPrimaryBranch,
} from './circuitConverterGeometry'
import {
  liftCircuitContentAboveOwnProtection,
  moveCircuitToCircuitContentPosition,
} from '@/lib/eendraad/circuitContentInsertion'
import { getEditableProjectElectricalInstallation } from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'
import { getMainBusInsertionSectionId } from '@/lib/panel/panelBusSections'
import { getPanelFeedOrganization } from '@/lib/panel/panelFeedOrganization'
import { canCreateSupplyTopologyFromDrop } from '@/lib/supplyTopologyFeature'
import {
  moveEndpointSelectionBetweenCircuits,
  moveEndpointSelectionOnCircuit,
} from '@/lib/eendraad/moveEndpointSelection'
import {
  movePanelAttachmentOnRcdBus,
  movePanelAttachmentOnSecondaryBus,
  movePanelAttachmentToMainBus,
} from '@/lib/eendraad/panelAttachmentMove'
import {
  panelHasPopulatedDirectConverterBackup,
  resolveDirectConverterChangeoverInsertIndex,
} from '@/lib/supplyAssembly/directConverterBackupUpgrade'
import {
  moveCircuitTrunkDeviceToSupplyDcBus,
  moveSupplyTrunkDeviceAtDropTarget,
} from '@/lib/eendraad/supplyTrunkDeviceMove'
import { reconcileDirectConverterDcDevices } from '@/lib/supplyAssembly/editorIntegration'
import { promoteDcBusConverterEndpoint } from '@/lib/eendraad/resizeConverterDcConnections'
import { isProjectV2 } from '@/lib/projectV2/migration'
import { electricalPlaceSymbol } from '@/lib/commands/project/commands/electricalPlaceSymbol'
import { ProjectCommandRegistry } from '@/lib/commands/project/registry'
import { applyCommandBatch } from '@/lib/commands/project/transaction'
import { CommandError } from '@/lib/commands/project/types'
import type { ElectricalEnclosureRef } from '@/types/supplyAssembly'

import {
  circuitIsTerminalPanelFeederSim,
  countPanelsSim,
  findCircuitInProject,
  findPanelForCircuit,
  findProtectionByCircuitIdInProject,
  findProtectionByIdInProject,
  mutableProjectInstallation,
  mutableProjectPanels,
  projectPanels,
  type EendraadPreviewChangeSet,
  type PreviewProject,
} from './eendraadPreviewModel'
import { getCircuitTrunkPositionForDropSim, getWireDomainAtDropTargetSim } from './eendraadPreviewWireDomain'
import {
  simulateEarthingStemDrop,
  simulateGroundTrunkDevice,
  simulateSupplyTrunkDevice,
  simulateTrunkDeviceOnCircuit,
} from './eendraadPreviewTrunkPlacement'

export type { EendraadPreviewChangeSet } from './eendraadPreviewModel'

let outputPlacementRegistry: ProjectCommandRegistry | undefined

/** Structural preview copy. */
function cloneProject<T extends PreviewProject>(project: T): T {
  return JSON.parse(JSON.stringify(project)) as T
}

function removeEndpointFromPreviewCircuit(circuit: Circuit, endpointId: string): void {
  circuit.endpoints = circuit.endpoints.filter((endpoint) => endpoint.id !== endpointId)
  if (circuit.branches) {
    circuit.branches = circuit.branches
      .map((branch) => ({
        ...branch,
        endpointIds: branch.endpointIds.filter((id) => id !== endpointId),
      }))
      .filter((branch) => branch.endpointIds.length > 0)
  }

  for (const parent of circuit.endpoints) {
    if (!parent.domoticaProps) continue
    parent.domoticaProps = {
      ...parent.domoticaProps,
      endpointChildEndpointIds: (parent.domoticaProps.endpointChildEndpointIds ?? []).map((id) =>
        id === endpointId ? '' : id
      ),
      controlChildEndpointIds: (parent.domoticaProps.controlChildEndpointIds ?? []).map((id) =>
        id === endpointId ? '' : id
      ),
    }
  }
}

/**
 * Simulate dropping an endpoint or in-between device on a circuit/endpoint/protection.
 * This covers sockets, lights, switches, relays, domotica, fixed appliances, etc.
 */
function simulateEndpointDrop(
  project: PreviewProject,
  target: DropTarget,
  symbol: SymbolMetadata,
  changeSet: EendraadPreviewChangeSet
): void {
  let circuitId = target.circuitId

  if (!circuitId && target.type === 'protection' && target.protectionId) {
    // Resolve circuit via protection relationship inside the simulated project.
    const panels: Panel[] = []
    const stack = [...projectPanels(project)]
    while (stack.length) {
      const p = stack.pop()!
      panels.push(p)
      if (p.subPanels?.length) stack.push(...p.subPanels)
    }
    for (const panel of panels) {
      const prot = panel.protections?.find((p) => p.id === target.protectionId)
      if (prot && prot.circuits?.length) {
        circuitId = prot.circuits[0]!.id
        break
      }
    }
  }

  if (!circuitId) return

  // Dedicated board feeders stay terminal; mixed consumer branches remain editable.
  if (circuitIsTerminalPanelFeederSim(project, circuitId)) {
    return
  }

  const circuit = findCircuitInProject(project, circuitId)
  if (!circuit) return

  if (isDcOnlyEndpointSymbol(symbol) && target.endpointId) {
    const targetEndpoint = circuit.endpoints.find((endpoint) => endpoint.id === target.endpointId)
    const owningBranch = circuit.branches?.find(
      (branch) => branch.dcBusId && branch.endpointIds.includes(target.endpointId!)
    )
    if (
      owningBranch &&
      (targetEndpoint?.symbol === 'dc_dc_converter' || targetEndpoint?.symbol === 'inverter')
    ) {
      const promoted = promoteDcBusConverterEndpoint(circuit, targetEndpoint.id)
      if (!promoted) return
      circuit.endpoints = promoted.endpoints
      circuit.branches = promoted.branches
      target = {
        ...target,
        type: 'circuit',
        endpointId: undefined,
        insertAfterEndpointId: undefined,
        branchId: owningBranch.id,
        branchEndpoints: [],
        dcBusId: owningBranch.dcBusId,
        wireDomain: 'DC',
        converterDcConnection: {
          converterId: targetEndpoint.id,
          connectionIndex: 0,
        },
      }
    }
  }

  if (!target.dcBusId && symbolSupportsWireDomain(symbol.id, 'DC')) {
    const existingBus = findOrdinaryCircuitDcBusForOutput(circuit, target.converterDcConnection)
    if (existingBus) target = { ...target, dcBusId: existingBus.id, wireDomain: 'DC' }
  }

  if (
    target.dcBusId &&
    !circuit.trunkDevices?.some(
      (device) => device.id === target.dcBusId && device.type === 'dc_bus'
    )
  ) {
    return
  }

  initializeBranchesIfNeeded(circuit)

  const endpointId = generateId()
  const endpointType = getEndpointTypeFromSymbol(symbol)
  const symbolKey = getSymbolKeyFromSymbol(symbol)

  const isDomoticaOutputDrop = !!target.domoticaOutput && !!target.endpointId
  const isDomoticaChildReplace = target.domoticaChildDropIntent === 'replace' && !!target.endpointId

  const endpoint: Endpoint = {
    id: endpointId,
    type: endpointType,
    label: '',
    symbol: symbolKey,
    placements: [],
    ...(symbol.id === 'terminal_strip'
      ? getTerminalStripTrunkConnectionProps(project, undefined, target.circuitId)
      : isSharedJunctionSymbol(symbol.id)
        ? { junctionIdentity: getNextJunctionIdentity(project, symbol.id) }
        : {}),
  } as Endpoint

  // Labeling rules, branch selection: mirror endpointBehavior as closely as possible but purely.
  const branches: Branch[] = circuit.branches?.length
    ? circuit.branches
    : initializeBranchesIfNeeded(circuit)

  let branchEndpointIds = target.branchEndpoints?.length ? target.branchEndpoints : null
  let { insertAfterEndpointId, createNewBranch } = computeEndpointInsertAfter(target, circuit, symbol)

  if (isDomoticaOutputDrop && target.domoticaOutput && target.endpointId) {
    endpoint.domoticaChildProps = {
      parentEndpointId: target.endpointId,
      outputGroup: 'endpoint',
      outputIndex: target.domoticaOutput.index,
    }
  }

  // A converter's direct backup output is intentionally one simple circuit.
  // Keep every endpoint on its single branch, matching the live drop behavior.
  if (circuit.supplySource?.kind === 'converter-backup' && circuit.endpoints.length > 0) {
    insertAfterEndpointId = circuit.endpoints.at(-1)?.id
    createNewBranch = false
  }
  if (shouldDefaultRelayToImpulse(circuit, symbol, insertAfterEndpointId)) {
    endpoint.relayProps = { ...endpoint.relayProps, control: 'impulse' }
  }

  const nestedConverterBranch = target.converterDcConnection
    ? circuit.branches?.find((branch) =>
        branch.branchDevices?.some(
          (device) => device.id === target.converterDcConnection?.converterId
        )
      )
    : undefined
  const existingDcBusBranch =
    target.dcBusId && !nestedConverterBranch
      ? (circuit.branches ?? []).find(
          (branch) =>
            branch.dcBusId === target.dcBusId &&
            (branch.id === target.branchId ||
              branch.endpointIds.some((id) => target.branchEndpoints?.includes(id)))
        )
      : undefined
  if (target.dcBusId && !nestedConverterBranch) {
    branchEndpointIds = existingDcBusBranch?.endpointIds ?? null
    createNewBranch = !existingDcBusBranch
    if (!existingDcBusBranch) insertAfterEndpointId = undefined
  }

  if (target.converterDcConnection && (!target.dcBusId || nestedConverterBranch)) {
    const connection = target.converterDcConnection
    const converter = [
      ...(circuit.trunkDevices ?? []),
      ...(circuit.branches ?? []).flatMap((branch) => branch.branchDevices ?? []),
    ].find((device) => device.id === connection.converterId)
    const primaryBranch =
      connection.connectionIndex === 0 && converter
        ? (nestedConverterBranch ?? getCircuitConverterPrimaryBranch(circuit, converter))
        : undefined
    const primaryIds = new Set(primaryBranch?.endpointIds ?? [])
    if (connection.connectionIndex === 0 && primaryIds.size > 0) {
      circuit.endpoints = circuit.endpoints.map((candidate) =>
        primaryIds.has(candidate.id) && !candidate.converterDcConnection
          ? { ...candidate, converterDcConnection: { ...connection } }
          : candidate
      )
    }
    endpoint.converterDcConnection = { ...connection }
    const existingOutputEndpoints = circuit.endpoints.filter(
      (candidate) =>
        (candidate.converterDcConnection?.converterId === connection.converterId &&
          candidate.converterDcConnection.connectionIndex === connection.connectionIndex) ||
        (connection.connectionIndex === 0 &&
          primaryIds.has(candidate.id) &&
          !candidate.converterDcConnection)
    )
    const existingIds = new Set(existingOutputEndpoints.map((candidate) => candidate.id))
    branchEndpointIds =
      existingOutputEndpoints.length > 0
        ? existingOutputEndpoints.map((candidate) => candidate.id)
        : (nestedConverterBranch?.endpointIds ?? [])
    insertAfterEndpointId =
      typeof target.insertAfterEndpointId === 'string' &&
      existingIds.has(target.insertAfterEndpointId)
        ? target.insertAfterEndpointId
        : existingOutputEndpoints.at(-1)?.id
    createNewBranch = existingOutputEndpoints.length === 0 && !nestedConverterBranch
  }

  // Label assignment (simplified but aligned with endpointBehavior).
  if (!isDomoticaOutputDrop && !endpoint.domoticaChildProps) {
    const chainRef = isDomoticaChildReplace || target.domoticaChildDropIntent === 'insertBefore'
      ? domoticaChildRefForEndpoint(circuit, target.endpointId)
      : domoticaChildRefForBranchInsert(circuit, insertAfterEndpointId, target.branchEndpoints)
    if (chainRef) {
      endpoint.domoticaChildProps = chainRef
    }
  }

  const downstreamIds = target.branchEndpoints?.slice(
    typeof insertAfterEndpointId === 'string' ? target.branchEndpoints.indexOf(insertAfterEndpointId) + 1 : 0
  )
  if (!createNewBranch && downstreamIds?.length) hideInlineConverterMetadataByDefault(endpoint)

  // Insert endpoint into circuit.endpoints list.
  const endpoints = [...circuit.endpoints]
  if (typeof insertAfterEndpointId === 'string') {
    const idx = endpoints.findIndex((e) => e.id === insertAfterEndpointId)
    if (idx >= 0) {
      endpoints.splice(idx + 1, 0, endpoint)
    } else {
      endpoints.push(endpoint)
    }
  } else if (insertAfterEndpointId === null) {
    endpoints.unshift(endpoint)
  } else {
    endpoints.push(endpoint)
  }
  circuit.endpoints = endpoints

  if (target.domoticaChildDropIntent === 'insertBefore') {
    circuit.endpoints = updateDomoticaChainHeadAfterInsert(circuit, endpointId, target.endpointId)
  }

  if (isDomoticaChildReplace && target.endpointId && target.endpointId !== endpointId) {
    removeEndpointFromPreviewCircuit(circuit, target.endpointId)
  }

  // Domotica output drop: wire the new root endpoint into the parent's output row.
  if (isDomoticaOutputDrop && target.domoticaOutput && target.endpointId) {
    const nextCircuit = insertDomoticaChildEndpoint(
      circuit,
      endpointId,
      target.endpointId,
      'endpoint',
      target.domoticaOutput.index
    )
    if (nextCircuit) {
      circuit.endpoints = nextCircuit.endpoints
      circuit.branches = nextCircuit.branches
    }
  }

  // Branch bookkeeping.
  if (isDomoticaChildReplace) {
    // Endpoint insertion plus target removal already produced the replacement branch state.
  } else if (isDomoticaOutputDrop) {
    // Domotica output insertion is fully handled above by insertDomoticaChildEndpoint.
    // Do not run generic branch bookkeeping with stale branch data.
  } else if (circuit.supplySource?.kind === 'converter-backup') {
    const branch = branches[0] ?? { id: generateId(), label: '', endpointIds: [] }
    circuit.branches = [{ ...branch, endpointIds: circuit.endpoints.map((item) => item.id) }]
  } else if (createNewBranch) {
    const branchesSansNewEndpoint = branches
      .map((b) => ({
        ...b,
        endpointIds: (b.endpointIds ?? []).filter((id) => id !== endpointId),
      }))
      .filter((b) => (b.endpointIds ?? []).length > 0 || (b.branchDevices?.length ?? 0) > 0)
    const branchIndexFromEndpoints =
      branchEndpointIds && branchEndpointIds.length > 0
        ? branchesSansNewEndpoint.findIndex((b) =>
            b.endpointIds.some((id) => branchEndpointIds.includes(id))
          )
        : -1
    const anchorBranchIndex =
      branchIndexFromEndpoints >= 0 ? branchIndexFromEndpoints : branchesSansNewEndpoint.length - 1
    const dcBusBranchIndexes = target.dcBusId
      ? branchesSansNewEndpoint.flatMap((branch, index) =>
          branch.dcBusId === target.dcBusId ? [index] : []
        )
      : []
    const requestedDcBusIndex = clamp(
      target.secondaryBusInsertIndex ?? dcBusBranchIndexes.length,
      0,
      dcBusBranchIndexes.length
    )
    const insertionIndex = typeof target.branchInsertIndex === 'number'
      ? clamp(target.branchInsertIndex, 0, branchesSansNewEndpoint.length)
      : target.dcBusId
      ? requestedDcBusIndex < dcBusBranchIndexes.length
        ? dcBusBranchIndexes[requestedDcBusIndex]!
        : (dcBusBranchIndexes.at(-1) ?? branchesSansNewEndpoint.length - 1) + 1
      : insertAfterEndpointId === null
        ? Math.max(0, anchorBranchIndex)
        : Math.max(0, anchorBranchIndex + 1)
    const nextBranches = [...branchesSansNewEndpoint]
    nextBranches.splice(clamp(insertionIndex, 0, nextBranches.length), 0, {
      id: generateId(),
      label: '',
      endpointIds: [endpointId],
      ...(target.dcBusId ? { dcBusId: target.dcBusId } : {}),
    })
    circuit.branches = nextBranches
  } else if (branchEndpointIds?.length) {
    const targetBranch = branches.find((b) =>
      b.endpointIds.some((id) => branchEndpointIds.includes(id))
    )
    if (targetBranch && !targetBranch.endpointIds.includes(endpointId)) {
      const updatedIds = [...targetBranch.endpointIds]
      if (typeof insertAfterEndpointId === 'string') {
        const idx = updatedIds.indexOf(insertAfterEndpointId)
        if (idx >= 0) {
          updatedIds.splice(idx + 1, 0, endpointId)
        } else {
          updatedIds.push(endpointId)
        }
      } else {
        updatedIds.unshift(endpointId)
      }
      circuit.branches = branches.map((b) =>
        b.id === targetBranch.id ? { ...b, endpointIds: updatedIds } : b
      )
    }
  } else {
    circuit.branches = [
      ...branches,
      {
        id: generateId(),
        label: '',
        endpointIds: [endpointId],
        ...(target.dcBusId ? { dcBusId: target.dcBusId } : {}),
      },
    ]
  }

  if (nestedConverterBranch) {
    circuit.branches = (circuit.branches ?? [])
      .map((branch) =>
        branch.id === nestedConverterBranch.id
          ? {
              ...branch,
              endpointIds: branch.endpointIds.includes(endpointId)
                ? branch.endpointIds
                : [...branch.endpointIds, endpointId],
            }
          : {
              ...branch,
              endpointIds: branch.endpointIds.filter((id) => id !== endpointId),
            }
      )
      .filter((branch) => branch.endpointIds.length > 0 || (branch.branchDevices?.length ?? 0) > 0)
  }

  syncSequentialEndpointBranchLabelsToCircuit(circuit)

  changeSet.affectedCircuitIds.push(circuitId)
  const owningPanel = findPanelForCircuit(project, circuitId)
  if (owningPanel && !changeSet.affectedPanelIds.includes(owningPanel.id)) {
    changeSet.affectedPanelIds.push(owningPanel.id)
  }
  changeSet.createdEndpointIds.push(endpointId)
}

/**
 * Simulate dropping a protection device (MCB, RCD, RCBO) on a main bus / RCD / circuit trunk,
 * including nested circuit creation. We approximate the behavior of protectionBehavior/rcdBehavior
 * for preview.
 */
function simulateProtectionDrop(
  project: PreviewProject,
  target: DropTarget,
  symbol: SymbolMetadata,
  changeSet: EendraadPreviewChangeSet
): void {
  const panel =
    (target.panelId && findPanelById(projectPanels(project), target.panelId)) ||
    (projectPanels(project).find((p) => p.isMain) ?? projectPanels(project)[0])
  if (!panel) return

  // Map symbol.id → ProtectionType used by runtime dropBehaviors.
  const protectionType = PROTECTION_SYMBOL_ID_TO_TYPE[symbol.id] ?? 'MCB'
  if (target.dcBusId) {
    if (!target.circuitId) return
    const circuit = findCircuitInProject(project, target.circuitId)
    if (!circuit) return
    const branch = (circuit.branches ?? []).find(
      (candidate) =>
        candidate.dcBusId === target.dcBusId &&
        (candidate.id === target.branchId ||
          candidate.endpointIds.some((id) => target.branchEndpoints?.includes(id)))
    )
    if (!branch) return
    const deviceId = generateId()
    const device: TrunkDevice = {
      id: deviceId,
      type: 'protection',
      symbol: symbol.id as TrunkDevice['symbol'],
      label: '',
      trunkPosition: 0,
      protectionType,
      ...getDefaultTrunkDeviceProtectionProps(protectionType, getVoltagePolesConfig(project)),
    }
    const branchDevices = [...(branch.branchDevices ?? [])]
    const insertIndex = clamp(
      target.branchDeviceInsertIndex ?? branchDevices.length,
      0,
      branchDevices.length
    )
    branchDevices.splice(insertIndex, 0, device)
    branch.branchDevices = branchDevices
    if (!changeSet.affectedCircuitIds.includes(circuit.id)) {
      changeSet.affectedCircuitIds.push(circuit.id)
    }
    changeSet.createdTrunkDeviceIds.push(deviceId)
    return
  }
  const isInlineCircuitProtectionDrop =
    isCircuitTrunkAddOnProtectionType(protectionType) &&
    target.type === 'circuit' &&
    !!target.circuitId &&
    typeof target.circuitTrunkSegmentIndex === 'number' &&
    !target.branchEndpoints?.length &&
    target.insertAfterCircuitContent !== true &&
    typeof target.secondaryBusInsertIndex !== 'number'
  if (isInlineCircuitProtectionDrop && target.circuitId) {
    if (circuitIsTerminalPanelFeederSim(project, target.circuitId)) return
    const circuit = findCircuitInProject(project, target.circuitId)
    if (!circuit) return
    const segmentIndex = target.circuitTrunkSegmentIndex
    if (typeof segmentIndex !== 'number') return

    const trunkDeviceId = generateId()
    const trunkDevice: TrunkDevice = {
      id: trunkDeviceId,
      type: 'protection',
      protectionType,
      symbol: symbol.id as TrunkDevice['symbol'],
      label: '',
      trunkPosition: getCircuitTrunkPositionForDropSim(target, circuit),
      ...getDefaultTrunkDeviceProtectionProps(protectionType, getVoltagePolesConfig(project)),
    }
    const list = [...(circuit.trunkDevices ?? []), trunkDevice]
    list.sort((a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0))
    const currentIndex = list.findIndex((device) => device.id === trunkDeviceId)
    if (currentIndex >= 0) {
      list.splice(currentIndex, 1)
      list.splice(Math.max(0, Math.min(segmentIndex, list.length)), 0, trunkDevice)
    }
    circuit.trunkDevices = list
    if (!changeSet.affectedPanelIds.includes(panel.id)) changeSet.affectedPanelIds.push(panel.id)
    if (!changeSet.affectedCircuitIds.includes(circuit.id)) {
      changeSet.affectedCircuitIds.push(circuit.id)
    }
    changeSet.createdTrunkDeviceIds.push(trunkDeviceId)
    return
  }
  const defaults = getProtectionCreationProps(project, protectionType)
  const targetedCircuit =
    target.type === 'circuit' && target.circuitId
      ? findCircuitInProject(project, target.circuitId)
      : null
  const targetedProtection =
    target.type === 'circuit' && target.circuitId
      ? findProtectionByCircuitIdInProject(project, target.circuitId)
      : null
  if (targetedCircuit && targetedProtection?.directPanelFeeder && targetedProtection.subPanelId) {
    const circuitCode = resolveInitialProtectionBusLabel(
      protectionType,
      getNextAvailableCircuitCode(project, panel.id)
    )
    Object.assign(targetedProtection, {
      type: protectionType,
      label: circuitCode,
      ...defaults,
      directPanelFeeder: undefined,
    })
    targetedCircuit.code = circuitCode
    changeSet.affectedPanelIds.push(panel.id)
    changeSet.affectedCircuitIds.push(targetedCircuit.id)
    changeSet.createdProtectionIds.push(targetedProtection.id)
    return
  }

  const circuitId = generateId()
  const circuitCode = resolveInitialProtectionBusLabel(
    protectionType,
    getNextAvailableCircuitCode(project, panel.id)
  )
  const protectionId = generateId()

  const protection = {
    id: protectionId,
    type: protectionType,
    label: circuitCode,
    circuits: [] as Circuit[],
    ...(target.type === 'mainBus'
      ? {
          busSectionId:
            target.busSectionId ?? getMainBusInsertionSectionId(panel, target.mainBusInsertIndex),
        }
      : {}),
    ...defaults,
  }

  const circuit: Circuit = {
    id: circuitId,
    code: circuitCode,
    kind: 'other',
    cable: createDefaultAcCircuitCable(),
    endpoints: [],
    ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
  }
  if (target.type === 'supplyConverterBackupWire') {
    const installation = getEditableProjectElectricalInstallation(project)
    const converter = installation
      ? getSupplyFeedDevicesForPanel(installation, projectPanels(project), panel.id, 'root').find(
          (device) => device.supplyPath === 'converter-branch'
        )
      : undefined
    if (!converter) return
    circuit.supplySource = { kind: 'converter-backup', converterId: converter.id }
    circuit.phaseAssignment = converter.conversionProps?.acPhaseAssignment
  }

  panel.protections = [...(panel.protections ?? []), protection]
  // In the live behavior, addCircuit with a protectionId only appends the
  // circuit to protection.circuits, not to panel.circuits. Mirror that here
  // so main-bus ordering matches the real layout.
  protection.circuits.push(circuit)

  const isSecondaryBusSlot =
    target.type === 'circuit' &&
    !!target.circuitId &&
    typeof target.secondaryBusInsertIndex === 'number' &&
    target.secondaryBusInsertIndex >= 0

  // Nested circuit: when dropping on an existing circuit trunk (not a secondary-bus slot).
  if (target.type === 'circuit' && target.circuitId && !isSecondaryBusSlot) {
    const parentCircuit = findCircuitInProject(project, target.circuitId)
    if (parentCircuit) {
      const insertBeforeId = target.insertBeforeNestedCircuitId
      const insertBeforeIndex = insertBeforeId
        ? (parentCircuit.subCircuitIds ?? []).indexOf(insertBeforeId)
        : -1
      if (insertBeforeId && insertBeforeIndex >= 0) {
        const nextParentChildren = [...(parentCircuit.subCircuitIds ?? [])]
        nextParentChildren.splice(insertBeforeIndex, 1, circuitId)
        parentCircuit.subCircuitIds = nextParentChildren
        circuit.subCircuitIds = [insertBeforeId]
      } else if (target.insertAfterCircuitContent) {
        parentCircuit.subCircuitIds = [...(parentCircuit.subCircuitIds ?? []), circuitId]
        if (!changeSet.affectedCircuitIds.includes(target.circuitId)) {
          changeSet.affectedCircuitIds.push(target.circuitId)
        }
      } else {
        const hasEndpoints = parentCircuit.endpoints.length > 0
        const hasBranches = (parentCircuit.branches?.length ?? 0) > 0
        const hasTrunkDevices = (parentCircuit.trunkDevices?.length ?? 0) > 0

        if (hasEndpoints || hasBranches || hasTrunkDevices) {
          circuit.endpoints = [...parentCircuit.endpoints]
          if (parentCircuit.branches) {
            circuit.branches = [...parentCircuit.branches]
          }
          if (parentCircuit.trunkDevices) {
            circuit.trunkDevices = [...parentCircuit.trunkDevices]
          }
          parentCircuit.endpoints = []
          parentCircuit.branches = []
          parentCircuit.trunkDevices = []
          parentCircuit.subCircuitIds = [...(parentCircuit.subCircuitIds ?? []), circuitId]
        } else {
          parentCircuit.subCircuitIds = [...(parentCircuit.subCircuitIds ?? []), circuitId]
        }
        // Include parent so preview wires (e.g. secondary bus bar) for that circuit are drawn
        if (!changeSet.affectedCircuitIds.includes(target.circuitId)) {
          changeSet.affectedCircuitIds.push(target.circuitId)
        }

        const parentProtection = findProtectionByCircuitIdInProject(project, target.circuitId)
        if (parentProtection?.subPanelId) {
          protection.subPanelId = parentProtection.subPanelId
          parentProtection.subPanelId = undefined
        }
      }
    }
  }

  changeSet.affectedPanelIds.push(panel.id)
  changeSet.affectedCircuitIds.push(circuitId)
  changeSet.createdProtectionIds.push(protectionId)

  // When dropped on the main bus, reposition the new MCB to match the
  // cursor segment between existing main-bus items, mirroring the
  // live moveCircuitOnMainBus behavior.
  if (target.type === 'mainBus' && typeof target.mainBusInsertIndex === 'number') {
    const beforeCount = target.mainBusItemCount ?? 0
    const totalAfter = beforeCount + 1
    const desiredIndex = clamp(target.mainBusInsertIndex, 0, totalAfter - 1)
    const currentIndex = totalAfter - 1
    const movesLeft = Math.max(0, currentIndex - desiredIndex)
    for (let i = 0; i < movesLeft; i++) {
      simulateMoveCircuitOnMainBus(panel, circuitId, 'left')
    }
  }

  // When dropped on a secondary bus (nested circuits), place the new
  // subcircuit directly at the resolved slot, matching live drop behavior.
  if (
    target.type === 'circuit' &&
    target.circuitId &&
    typeof target.secondaryBusInsertIndex === 'number' &&
    target.secondaryBusInsertIndex >= 0
  ) {
    simulateMoveCircuitToSecondaryBus(
      project,
      target.circuitId,
      circuitId,
      target.secondaryBusInsertIndex
    )
  }
}

/**
 * Simulate moveCircuitOnMainBus for preview-only project mutations.
 * Reorders panel.circuits / panel.protections to move the given circuit's
 * protection/circuit one slot left or right among main-bus items.
 */
function simulateMoveCircuitOnMainBus(
  panel: Panel,
  circuitId: string,
  direction: 'left' | 'right'
): void {
  // Find circuit in panel.circuits or in a protection's circuits.
  let circuit: Circuit | undefined
  let protection: ProtectionDevice | undefined
  let array: Circuit[] | undefined
  let index = -1

  circuit = panel.circuits.find((c) => c.id === circuitId)
  if (circuit) {
    array = panel.circuits
    index = panel.circuits.indexOf(circuit)
  } else if (panel.protections) {
    for (const prot of panel.protections) {
      if (prot.circuits) {
        const found = prot.circuits.find((c) => c.id === circuitId)
        if (found) {
          circuit = found
          protection = prot
          array = prot.circuits
          index = prot.circuits.indexOf(found)
          break
        }
      }
    }
  }

  if (!circuit || !array || index === -1) {
    return
  }

  const mainBusItems = getMainBusItemsWithIndices(panel)

  const currentItem = mainBusItems.find(
    (item) =>
      (item.type === 'circuit' && item.id === circuitId) ||
      (item.type === 'protection' && protection && item.id === protection.id)
  )
  if (!currentItem) return

  const currentPos = mainBusItems.indexOf(currentItem)
  if (direction === 'left' && currentPos > 0) {
    const prevItem = mainBusItems[currentPos - 1]
    if (!prevItem) return
    if (currentItem.type === 'circuit' && prevItem.type === 'circuit') {
      const a = panel.circuits[currentItem.index]
      const b = panel.circuits[prevItem.index]
      if (a === undefined || b === undefined) return
      panel.circuits[currentItem.index] = b
      panel.circuits[prevItem.index] = a
    } else if (
      currentItem.type === 'protection' &&
      prevItem.type === 'protection' &&
      panel.protections
    ) {
      const a = panel.protections[currentItem.index]
      const b = panel.protections[prevItem.index]
      if (a === undefined || b === undefined) return
      panel.protections[currentItem.index] = b
      panel.protections[prevItem.index] = a
    }
  } else if (direction === 'right' && currentPos < mainBusItems.length - 1) {
    const nextItem = mainBusItems[currentPos + 1]
    if (!nextItem) return
    if (currentItem.type === 'circuit' && nextItem.type === 'circuit') {
      const a = panel.circuits[currentItem.index]
      const b = panel.circuits[nextItem.index]
      if (a === undefined || b === undefined) return
      panel.circuits[currentItem.index] = b
      panel.circuits[nextItem.index] = a
    } else if (
      currentItem.type === 'protection' &&
      nextItem.type === 'protection' &&
      panel.protections
    ) {
      const a = panel.protections[currentItem.index]
      const b = panel.protections[nextItem.index]
      if (a === undefined || b === undefined) return
      panel.protections[currentItem.index] = b
      panel.protections[nextItem.index] = a
    }
  }
}

/**
 * Simulate moveCircuitToSecondaryBus: ensure circuitId is registered under
 * parentCircuitId at an exact insertion index.
 */
function simulateMoveCircuitToSecondaryBus(
  project: PreviewProject,
  parentCircuitId: string,
  circuitId: string,
  insertIndex: number
): void {
  for (const panel of projectPanels(project)) {
    const stack = [panel]
    while (stack.length > 0) {
      const candidate = stack.pop()!
      if (moveCircuitToCircuitContentPosition(candidate, parentCircuitId, circuitId, insertIndex)) {
        return
      }
      stack.push(...(candidate.subPanels ?? []))
    }
  }
}

/** Preview reparenting an existing protection circuit before or after target circuit content. */
export function simulateProtectionRelocationOnProject(
  project: PreviewProject,
  moving: { protectionId: string; circuitId: string },
  target: DropTarget
): EendraadPreviewChangeSet | null {
  if (target.type !== 'circuit' || !target.circuitId || !target.panelId) return null
  const cloned = cloneProject(project)
  const panel = findPanelById(mutableProjectPanels(cloned), target.panelId)
  if (!panel) return null

  const parentCircuit = findCircuitInProject(cloned, target.circuitId)
  if (!parentCircuit) return null

  if (target.circuitId === moving.circuitId && target.insertAfterCircuitContent === true) {
    const changed = liftCircuitContentAboveOwnProtection(panel, moving.circuitId)
    if (!changed) return null
    const parentId = [
      ...(panel.circuits ?? []),
      ...(panel.protections ?? []).flatMap((protection) => protection.circuits ?? []),
    ].find((circuit) => circuit.subCircuitIds?.includes(moving.circuitId))?.id
    return {
      project: cloned,
      affectedPanelIds: [panel.id],
      affectedCircuitIds: parentId ? [parentId, moving.circuitId] : [moving.circuitId],
      createdEndpointIds: [],
      createdProtectionIds: [],
      createdTrunkDeviceIds: [],
      movedTrunkDeviceIds: [],
      createdSupplyTrunkDeviceIds: [],
      createdGroundTrunkDeviceIds: [],
    }
  }

  const insertIndex =
    typeof target.secondaryBusInsertIndex === 'number'
      ? target.secondaryBusInsertIndex
      : (parentCircuit.subCircuitIds?.length ?? 0)
  const insertBeforeCircuitContent =
    target.insertAfterCircuitContent !== true && typeof target.circuitTrunkSegmentIndex === 'number'
  const changed = moveCircuitToCircuitContentPosition(
    panel,
    target.circuitId,
    moving.circuitId,
    insertIndex,
    { insertBeforeCircuitContent }
  )
  if (!changed) return null

  return {
    project: cloned,
    affectedPanelIds: [panel.id],
    affectedCircuitIds: [target.circuitId, moving.circuitId],
    createdEndpointIds: [],
    createdProtectionIds: [],
    createdTrunkDeviceIds: [],
    movedTrunkDeviceIds: [],
    createdSupplyTrunkDeviceIds: [],
    createdGroundTrunkDeviceIds: [],
  }
}

function isConversionTrunkSymbolId(symbolId: string): boolean {
  return ['transformer', 'rectifier', 'inverter', 'dc_dc_converter'].includes(symbolId)
}

function canPlaceTrunkConversionAtTargetSim(
  symbol: SymbolMetadata,
  target: DropTarget,
  project: PreviewProject
): boolean {
  if (!isConversionTrunkSymbolId(symbol.id)) return true
  const wireDomain = getWireDomainAtDropTargetSim(target, project)
  const resolved = resolveSymbolPortsForWire(symbol.id, wireDomain)
  return resolved.matched
}

function adjustTrunkSegmentInsertIndex(params: {
  segmentIndex: number
  fromIndexInOrderedFull: number
  sameCircuit: boolean
  lengthAfterRemoval: number
}): number {
  const { segmentIndex, fromIndexInOrderedFull, sameCircuit, lengthAfterRemoval } = params
  let insertIdx = segmentIndex
  if (sameCircuit) {
    insertIdx = segmentIndex > fromIndexInOrderedFull ? segmentIndex - 1 : segmentIndex
  }
  return clamp(insertIdx, 0, lengthAfterRemoval)
}

/**
 * Move an existing circuit trunk device in-place (single logical edit).
 * Returns false if the drop is invalid. Safe for Immer drafts and plain objects.
 */
export function mutateTrunkDeviceRelocation(
  project: PreviewProject,
  relocating: { id: string; sourceCircuitId: string },
  target: DropTarget,
  symbol: SymbolMetadata,
  newId: () => string = generateId
): boolean {
  if (!project) return false
  if (isConversionTrunkSymbolId(symbol.id) && target.circuitId) {
    const circuit = findCircuitInProject(project, target.circuitId)
    if (circuit) target = resolveDomoticaConversionDropTarget(circuit, target)
  }
  if (target.type === 'supplyConverterDcWire') {
    return !!moveCircuitTrunkDeviceToSupplyDcBus(
      project,
      relocating.id,
      relocating.sourceCircuitId,
      target,
      newId
    )
  }
  if (target.type === 'endpoint' && target.circuitId && target.endpointId &&
      (target.domoticaChildDropIntent === 'insertBefore' || target.domoticaChildDropIntent === 'insertAfter') &&
      isConversionTrunkSymbolId(symbol.id)) {
    const source = findCircuitInProject(project, relocating.sourceCircuitId)
    const destination = findCircuitInProject(project, target.circuitId)
    const device = source?.trunkDevices?.find((candidate) => candidate.id === relocating.id)
    const anchor = destination?.endpoints.find((endpoint) => endpoint.id === target.endpointId)
    const branch = destination?.branches?.find((candidate) => candidate.endpointIds.includes(target.endpointId!))
    if (!source || !destination || !device || !anchor || !branch) return false
    if (!anchor.domoticaChildProps &&
        !(anchor.symbol === 'domotica' && target.domoticaChildDropIntent === 'insertBefore')) return false
    // A converter with owned output lanes cannot move independently of its loads.
    if ((device.conversionProps?.dcConnectionCount ?? 1) > 1 ||
        source.endpoints.some((endpoint) => endpoint.converterDcConnection?.converterId === device.id) ||
        source.trunkDevices?.some((candidate) => candidate.converterDcConnection?.converterId === device.id) ||
        projectPanels(project).some((panel) => getAllCircuits(panel).some((circuit) =>
          circuit.supplySource?.kind === 'converter-backup' && circuit.supplySource.converterId === device.id))) return false
    if (!canPlaceTrunkConversionAtTargetSim(symbol, target, project)) return false
    const endpoint: Endpoint = {
      id: device.id, type: 'fixed_appliance', symbol: device.symbol,
      label: anchor.label, placements: device.placements ?? [],
      energyConversionProps: device.conversionProps,
      notes: device.notes, labelNotes: device.labelNotes, panelLabel: device.panelLabel,
      installationDate: device.installationDate,
      installationDateSuppressed: device.installationDateSuppressed,
      rulesetDateOverride: device.rulesetDateOverride, symbolLabelDisplay: device.symbolLabelDisplay,
      domoticaChildProps: anchor.domoticaChildProps ? { ...anchor.domoticaChildProps } : undefined,
    }
    const before = target.domoticaChildDropIntent === 'insertBefore'
    if (before) hideInlineConverterMetadataByDefault(endpoint)
    const endpointIndex = destination.endpoints.findIndex((candidate) => candidate.id === anchor.id)
    const branchIndex = branch.endpointIds.indexOf(anchor.id)
    source.trunkDevices = source.trunkDevices!.filter((candidate) => candidate.id !== device.id)
    destination.endpoints.splice(endpointIndex + (before ? 0 : 1), 0, endpoint)
    branch.endpointIds.splice(branchIndex + (before ? 0 : 1), 0, endpoint.id)
    if (before) destination.endpoints = updateDomoticaChainHeadAfterInsert(destination, endpoint.id, anchor.id)
    return true
  }
  if (target.type !== 'circuit' || !target.circuitId || target.branchEndpoints?.length) return false

  const sourceCircuit = findCircuitInProject(project, relocating.sourceCircuitId)
  const targetCircuit = findCircuitInProject(project, target.circuitId)
  if (!sourceCircuit || !targetCircuit) return false

  const orderedFull = [...(sourceCircuit.trunkDevices ?? [])].sort(
    (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
  )
  const fromIndex = orderedFull.findIndex((d) => d.id === relocating.id)
  if (fromIndex === -1) return false

  // Validate before mutating — never remove the device and then abort (would orphan/delete it).
  if (circuitIsTerminalPanelFeederSim(project, target.circuitId)) {
    return false
  }

  if (!canPlaceTrunkConversionAtTargetSim(symbol, target, project)) {
    return false
  }

  const afterContentPosition = target.insertAfterCircuitContent
    ? getCircuitTrunkPositionForDropSim(target, targetCircuit)
    : undefined

  const sourceList = sourceCircuit.trunkDevices ?? []
  const relocatingDevice = sourceList.find((device) => device.id === relocating.id)
  if (!relocatingDevice) return false
  if (
    relocatingDevice.symbol === 'junction_panel' &&
    circuitContainsJunctionPanelIdentity(
      targetCircuit,
      getJunctionIdentity(relocatingDevice),
      relocating.id,
    )
  ) return false
  if (
    relocatingDevice.type === 'dc_bus' &&
    relocatingDevice.converterDcConnection &&
    (!target.converterDcConnection || target.circuitId !== relocating.sourceCircuitId)
  ) {
    return false
  }
  const rm = sourceList.findIndex((d) => d.id === relocating.id)
  if (rm === -1) return false
  const device = sourceList.splice(rm, 1)[0]
  if (!device) return false
  if (target.converterDcConnection) {
    device.converterDcConnection = { ...target.converterDcConnection }
  } else if (device.converterDcConnection) {
    delete device.converterDcConnection
  }
  sourceCircuit.trunkDevices = sourceList.length ? sourceList : []

  const sameCircuit = relocating.sourceCircuitId === target.circuitId
  const orderedSans = [...(targetCircuit.trunkDevices ?? [])].sort(
    (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
  )

  let insertIdx: number
  if (typeof target.circuitTrunkSegmentIndex === 'number' && !target.insertAfterCircuitContent) {
    const seg = target.circuitTrunkSegmentIndex
    if (sameCircuit) {
      insertIdx = adjustTrunkSegmentInsertIndex({
        segmentIndex: seg,
        fromIndexInOrderedFull: fromIndex,
        sameCircuit: true,
        lengthAfterRemoval: orderedSans.length,
      })
    } else {
      insertIdx = clamp(seg, 0, orderedSans.length)
    }
  } else {
    insertIdx = orderedSans.length
  }

  if (
    isCircuitTrunkSwitchSymbol(device.symbol) &&
    typeof target.circuitTrunkBranchSlot === 'number' &&
    afterContentPosition === undefined
  ) {
    // A trunk switch moves to the branch gap under the pointer; the other devices keep
    // their slots (renumbering them by list index would shift them between branches).
    const slot = target.circuitTrunkBranchSlot
    device.trunkPosition = slot
    const after = orderedSans.findLastIndex((other) => (other.trunkPosition ?? 0) <= slot)
    const slotted = [...orderedSans]
    slotted.splice(after + 1, 0, device)
    targetCircuit.trunkDevices = slotted
    syncSequentialEndpointBranchLabelsToCircuit(sourceCircuit)
    if (!sameCircuit) syncSequentialEndpointBranchLabelsToCircuit(targetCircuit)
    return true
  }

  const newList = [...orderedSans]
  newList.splice(insertIdx, 0, device)

  // bottomUpLayout: trunkPosition 0 = stacked on the vertical wire above the MCB; order inside
  // circuit.trunkDevices among those with 0 sets bottom→top spacing. trunkPosition ≥ 1 means
  // “between branch (k-1) and branch k”. Renumbering 0..n-1 after insert wrongly maps stacked
  // devices into branch slots → overlapping Y and the newcomer at the “top” branch gap.
  const mcbStackOnly =
    orderedSans.length === 0 || orderedSans.every((d) => (d.trunkPosition ?? 0) === 0)

  if (afterContentPosition !== undefined) {
    device.trunkPosition = afterContentPosition
  } else if (mcbStackOnly) {
    newList.forEach((d) => {
      d.trunkPosition = 0
    })
  } else {
    newList.forEach((d, i) => {
      d.trunkPosition = i
    })
  }
  targetCircuit.trunkDevices = newList
  syncSequentialEndpointBranchLabelsToCircuit(sourceCircuit)
  if (!sameCircuit) syncSequentialEndpointBranchLabelsToCircuit(targetCircuit)

  return true
}

/**
 * Preview moving an existing circuit trunk device (cloned project + change set metadata).
 */
export function simulateTrunkDeviceRelocationOnProject(
  project: PreviewProject,
  relocating: { id: string; sourceCircuitId: string },
  symbol: SymbolMetadata,
  target: DropTarget
): EendraadPreviewChangeSet | null {
  if (!project) return null
  const cloned = cloneProject(project)
  if (!mutateTrunkDeviceRelocation(cloned, relocating, target, symbol)) return null

  const affectedCircuitIds =
    target.circuitId
      ? [relocating.sourceCircuitId, target.circuitId].filter((id, i, arr) => arr.indexOf(id) === i)
      : [relocating.sourceCircuitId]

  const changeSet: EendraadPreviewChangeSet = {
    project: cloned,
    affectedPanelIds: [],
    affectedCircuitIds,
    createdEndpointIds: target.type === 'endpoint' ? [relocating.id] : [],
    createdProtectionIds: [],
    createdTrunkDeviceIds: [],
    movedTrunkDeviceIds: target.type === 'endpoint' ? [] : [relocating.id],
    createdSupplyTrunkDeviceIds: [],
    createdGroundTrunkDeviceIds: [],
  }

  const panelA = findPanelForCircuit(cloned, relocating.sourceCircuitId)
  const panelB =
    target.circuitId
      ? findPanelForCircuit(cloned, target.circuitId)
      : target.panelId
        ? findPanelById(projectPanels(cloned), target.panelId)
        : undefined
  if (target.type === 'supplyConverterDcWire') {
    for (const panelId of new Set([panelA?.id, panelB?.id])) {
      if (panelId) reconcileDirectConverterDcDevices(cloned, panelId)
    }
  }
  if (panelA && !changeSet.affectedPanelIds.includes(panelA.id))
    changeSet.affectedPanelIds.push(panelA.id)
  if (panelB && !changeSet.affectedPanelIds.includes(panelB.id))
    changeSet.affectedPanelIds.push(panelB.id)

  return changeSet
}

/** Preview the exact pop-out/reinsert operation used for an existing supply-frame device. */
export function simulateSupplyTrunkDeviceRelocationOnProject(
  project: PreviewProject,
  relocating: { id: string; targetMounting?: ElectricalEnclosureRef },
  target: DropTarget
): EendraadPreviewChangeSet | null {
  if (!project) return null
  const cloned = cloneProject(project)
  const result = moveSupplyTrunkDeviceAtDropTarget(
    cloned,
    relocating.id,
    target,
    relocating.targetMounting
  )
  if (!result) return null
  for (const panelId of new Set([result.sourcePanelId, result.targetPanelId])) {
    if (panelId) reconcileDirectConverterDcDevices(cloned, panelId)
  }

  return {
    project: cloned,
    affectedPanelIds: [result.sourcePanelId, result.targetPanelId].filter(
      (id, index, ids): id is string => !!id && ids.indexOf(id) === index
    ),
    affectedCircuitIds: [],
    createdEndpointIds: [],
    createdProtectionIds: [],
    createdTrunkDeviceIds: [],
    movedTrunkDeviceIds: [relocating.id],
    createdSupplyTrunkDeviceIds: [],
    createdGroundTrunkDeviceIds: [],
  }
}

export function simulateEndpointSelectionMoveOnProject(
  project: PreviewProject,
  moving: { draggedEndpointId: string; sourceCircuitId: string; endpointIds: string[] },
  target: DropTarget
): EendraadPreviewChangeSet | null {
  if (!project || !target.circuitId) return null
  if (isProjectV2(project) && isSavedForkMove(project, moving.sourceCircuitId, target)) return simulateSavedForkMove(project, moving, target)
  const cloned = cloneProject(project)
  const sourceCircuit = findCircuitInProject(cloned, moving.sourceCircuitId)
  const targetCircuit = findCircuitInProject(cloned, target.circuitId)
  if (!sourceCircuit || !targetCircuit) return null

  let movedIds: string[] = []
  if (sourceCircuit.id === targetCircuit.id) {
    const result = moveEndpointSelectionOnCircuit(
      sourceCircuit,
      moving.draggedEndpointId,
      moving.endpointIds,
      target,
      { allowSingle: true }
    )
    if (!result) return null
    sourceCircuit.endpoints = result.endpoints
    sourceCircuit.branches = result.branches
    syncSequentialEndpointBranchLabelsToCircuit(sourceCircuit)
    movedIds = result.movedEndpointIds
  } else {
    const result = moveEndpointSelectionBetweenCircuits(
      sourceCircuit,
      targetCircuit,
      moving.draggedEndpointId,
      moving.endpointIds,
      target,
      { allowSingle: true }
    )
    if (!result) return null
    sourceCircuit.endpoints = result.source.endpoints
    sourceCircuit.branches = result.source.branches
    targetCircuit.endpoints = result.target.endpoints
    targetCircuit.branches = result.target.branches
    syncSequentialEndpointBranchLabelsToCircuit(sourceCircuit)
    syncSequentialEndpointBranchLabelsToCircuit(targetCircuit)
    movedIds = result.target.movedEndpointIds
  }

  const affectedCircuitIds = [sourceCircuit.id, targetCircuit.id].filter(
    (id, index, arr) => arr.indexOf(id) === index
  )
  const affectedPanelIds: string[] = []
  for (const circuitId of affectedCircuitIds) {
    const panel = findPanelForCircuit(cloned, circuitId)
    if (panel && !affectedPanelIds.includes(panel.id)) affectedPanelIds.push(panel.id)
  }

  return {
    project: cloned,
    affectedPanelIds,
    affectedCircuitIds,
    createdEndpointIds: movedIds,
    createdProtectionIds: [],
    createdTrunkDeviceIds: [],
    movedTrunkDeviceIds: [],
    createdSupplyTrunkDeviceIds: [],
    createdGroundTrunkDeviceIds: [],
  }
}

/**
 * Main entry point: simulate how the project would look after dropping a symbol on a drop target.
 * This is intentionally focused on endpoints, circuits (including nested), and trunk devices.
 */
export function simulateDropOnProject(
  project: PreviewProject,
  symbol: SymbolMetadata,
  target: DropTarget
): EendraadPreviewChangeSet | null {
  if (!project) return null
  if (isConversionTrunkSymbolId(symbol.id) && target.circuitId) {
    const circuit = findCircuitInProject(project, target.circuitId)
    if (circuit) target = resolveDomoticaConversionDropTarget(circuit, target)
  }
  if (target.circuitId) {
    const circuit = findCircuitInProject(project, target.circuitId)
    if (circuit) target = normalizeDomoticaChildDropIntent(circuit, target, symbol)
  }
  if (!canCreateSupplyTopologyFromDrop(symbol, target.type)) return null
  if (symbol.id === 'dc_bus' && !canDropDcBusOnTarget(target, project)) return null
  if (
    target.type === 'supplyConverterDcWire' &&
    !target.supplyDcBusId &&
    !canDropSymbolOnSupplyConverterDcWire(symbol.id, false)
  ) {
    return null
  }

  const outputCircuit = target.circuitId ? findCircuitInProject(project, target.circuitId) : null
  const outputRef = target.domoticaOutput && target.endpointId
    ? { parentEndpointId: target.endpointId, outputIndex: target.domoticaOutput.index, outputGroup: target.domoticaOutput.group }
    : outputCircuit
      ? domoticaChildRefForEndpoint(outputCircuit, target.endpointId) ??
        domoticaChildRefForBranchInsert(outputCircuit, target.insertAfterEndpointId, target.branchEndpoints)
      : null
  const rowFeedsBoard = !!outputRef && outputCircuit?.endpoints.some((endpoint) =>
    endpoint.symbol === 'panel_distribution' && endpoint.domoticaChildProps &&
    endpoint.domoticaChildProps.parentEndpointId === outputRef?.parentEndpointId &&
    endpoint.domoticaChildProps.outputIndex === outputRef.outputIndex &&
    endpoint.domoticaChildProps.outputGroup === outputRef.outputGroup)
  if (isProjectV2(project) && (target.forkAfterEndpointId || target.forkBranchId || symbol.searchPreset || (outputRef && (symbol.id === 'panel_distribution' || rowFeedsBoard)))) {
    // Forks and output-fed boards preview the real placement command.
    outputPlacementRegistry ??= new ProjectCommandRegistry().register(electricalPlaceSymbol)
    try {
      const placed = applyCommandBatch(project, outputPlacementRegistry.parse([
        { id: 'electrical.placeSymbol', input: { symbolId: symbol.id, searchPreset: symbol.searchPreset, target } },
      ]), { newId: () => nanoid(16), now: () => '2000-01-01T00:00:00.000Z', language: 'en' })
      if (placed.project === project) return null
      const created = placed.results.flatMap((result) => result.created)
      return {
        project: placed.project,
        affectedPanelIds: [...new Set([
          ...(target.panelId ? [target.panelId] : []),
          ...created.filter((ref) => ref.kind === 'panel').map((ref) => ref.id),
        ])],
        affectedCircuitIds: [...new Set([
          ...(target.circuitId ? [target.circuitId] : []),
          ...created.filter((ref) => ref.kind === 'circuit').map((ref) => ref.id),
        ])],
        createdEndpointIds: created.filter((ref) => ref.kind === 'endpoint').map((ref) => ref.id),
        createdProtectionIds: created.filter((ref) => ref.kind === 'protection').map((ref) => ref.id),
        createdTrunkDeviceIds: created.filter((ref) => ref.kind === 'trunkDevice').map((ref) => ref.id),
        movedTrunkDeviceIds: [],
        createdSupplyTrunkDeviceIds: [], createdGroundTrunkDeviceIds: [],
      }
    } catch (error) {
      if (error instanceof CommandError) return null
      throw error
    }
  }

  const cloned = cloneProject(project)

  const changeSet: EendraadPreviewChangeSet = {
    project: cloned,
    affectedPanelIds: [],
    affectedCircuitIds: [],
    createdEndpointIds: [],
    createdProtectionIds: [],
    createdTrunkDeviceIds: [],
    movedTrunkDeviceIds: [],
    createdSupplyTrunkDeviceIds: [],
    createdGroundTrunkDeviceIds: [],
  }

  const endpointType = getEndpointTypeFromSymbol(symbol)
  const isDcOnlyEndpoint = symbol.id === 'solar_panel' || symbol.id === 'battery'

  // Supply trunk devices (horizontal supply wire to main bus)
  if (
    target.type === 'supplyWire' ||
    target.type === 'supplyBackupWire' ||
    target.type === 'supplyBackupOutputWire' ||
    target.type === 'supplyChangeoverGridWire' ||
    target.type === 'supplyConverterGridWire' ||
    target.type === 'supplyConverterBackupWire' ||
    target.type === 'supplyConverterDcWire'
  ) {
    const behavior = dropBehaviors[symbol.id]
    if (!behavior?.validTargets.includes(target.type)) {
      return null
    }
    if (symbol.id === 'source_changeover' && target.supplyFeedScope !== 'root') {
      return null
    }
    if (
      symbol.id === 'source_changeover' &&
      target.panelId &&
      panelHasPopulatedDirectConverterBackup(cloned, target.panelId)
    ) {
      return null
    }
    if (
      symbol.id === 'source_changeover' &&
      (() => {
        const panelId = target.panelId ?? ''
        const devices = getSupplyFeedDevicesForPanel(
          mutableProjectInstallation(cloned)!,
          projectPanels(cloned),
          panelId,
          'root'
        )
        const panel = findPanelById(projectPanels(cloned), panelId)
        const acceptsAnyGridFeedSegment = Boolean(
          panel && getPanelFeedOrganization(cloned, panel) === 'split-backup'
        )
        const deviceAtRequestedSlot = devices.find(
          (device) => device.trunkPosition === target.supplyDeviceInsertIndex
        )
        const requiresDedicatedSlot =
          deviceAtRequestedSlot?.supplyPath === 'converter-dc' ||
          deviceAtRequestedSlot?.supplyPath === 'converter-dc-top'
        return (
          devices.some((device) => device.supplyPath === 'converter-branch') &&
          ((!acceptsAnyGridFeedSegment &&
            requiresDedicatedSlot &&
            !target.supplyConverterChangeoverSlot) ||
            resolveDirectConverterChangeoverInsertIndex(
              devices,
              target.supplyDeviceInsertIndex,
              acceptsAnyGridFeedSegment
            ) === null)
        )
      })()
    ) {
      return null
    }
    if (target.type === 'supplyConverterBackupWire' && symbol.id !== 'source_changeover') {
      simulateProtectionDrop(cloned, target, symbol, changeSet)
    } else {
      simulateSupplyTrunkDevice(cloned, target, symbol, changeSet)
    }
    return changeSet
  }

  // Ground trunk devices (vertical ground wire)
  if (target.type === 'groundWire') {
    simulateGroundTrunkDevice(cloned, target, symbol, changeSet)
    return changeSet
  }

  if (
    (symbol.id === 'earthing' || symbol.id === 'earthing_separator') &&
    target.type === 'mainBus'
  ) {
    simulateEarthingStemDrop(cloned, target, changeSet)
    return changeSet
  }

  if (
    isCircuitTrunkSwitchSymbol(symbol.id) &&
    isCircuitTrunkSwitchDropTarget(target) &&
    circuitAcceptsTrunkSwitch(findCircuitInProject(cloned, target.circuitId!) ?? undefined)
  ) {
    simulateTrunkDeviceOnCircuit(
      cloned,
      target,
      symbol,
      symbol.id === 'relay' ? 'relay' : 'switch',
      changeSet
    )
    return changeSet
  }

  if (symbol.id === 'dc_bus' && target.type === 'circuit' && target.converterDcConnection) {
    // Rails have no endpoint type. The ordinary converter input still needs a
    // simulated rail so its accepted drop has visible artwork, like supply rails.
    simulateTrunkDeviceOnCircuit(cloned, target, symbol, 'dc_bus', changeSet)
    return changeSet
  }

  if (endpointType) {
    // Some endpoint-typed symbols can also behave as trunk devices when dropped
    // on the circuit trunk (vertical wire). In those cases we preview as trunk
    // device instead of a branch endpoint.
    const isTrunkDrop =
      target.type === 'circuit' &&
      target.circuitId &&
      !target.dcBusId &&
      !target.branchEndpoints?.length
    const isTrunkCapable =
      symbol.id === 'energy_meter' ||
      symbol.id === 'junction_box' ||
      symbol.id === 'junction_panel' ||
      symbol.id === 'terminal_strip' ||
      symbol.id === 'transformer' ||
      symbol.id === 'rectifier' ||
      symbol.id === 'inverter' ||
      symbol.id === 'dc_dc_converter' ||
      symbol.id === 'dc_bus' ||
      symbol.id === 'domotica'

    if (isTrunkDrop && isTrunkCapable && target.circuitId) {
      // Determine trunk device type for this symbol.
      const trunkType: TrunkDevice['type'] =
        symbol.id === 'energy_meter'
          ? 'energy_meter'
          : symbol.id === 'junction_box'
            ? 'junction_box'
            : symbol.id === 'terminal_strip'
              ? 'terminal_strip'
              : symbol.id === 'junction_panel'
                ? 'junction_panel'
                : symbol.id === 'dc_bus'
                  ? 'dc_bus'
                  : symbol.id === 'domotica'
                    ? 'domotica'
                    : 'conversion'

      simulateTrunkDeviceOnCircuit(cloned, target, symbol, trunkType, changeSet)
      return changeSet
    }

    if (isDcOnlyEndpoint) {
      const protection =
        target.type === 'protection' && target.protectionId
          ? findProtectionByIdInProject(cloned, target.protectionId)
          : target.type === 'circuit' &&
              target.circuitId &&
              !target.branchEndpoints?.length &&
              (target.circuitTrunkSegmentIndex === 0 || target.insertAfterCircuitContent === true)
            ? findProtectionByCircuitIdInProject(cloned, target.circuitId)
            : null
      if (protection && isEmptyProtectionCircuitForDcDrop(protection)) {
        const circuitId = protection.circuits![0]!.id
        simulateTrunkDeviceOnCircuit(
          cloned,
          { ...target, circuitId },
          { ...symbol, id: 'inverter', name: 'Inverter' },
          'conversion',
          changeSet
        )
        simulateEndpointDrop(cloned, target, symbol, changeSet)
        return changeSet
      }

      const domain = getWireDomainAtDropTargetSim(target, cloned)
      if (domain === 'DC') {
        simulateEndpointDrop(cloned, target, symbol, changeSet)
      }
    } else {
      const expansion = resolveSmartSwitchExpansion(symbol)
      if (expansion && isEndpointBranchDropTarget(target)) {
        let circuitId = target.circuitId
        if (!circuitId && target.type === 'protection' && target.protectionId) {
          const prot = findProtectionByIdInProject(cloned, target.protectionId)
          circuitId = prot?.circuits?.[0]?.id
        }
        const circuit = circuitId ? findCircuitInProject(cloned, circuitId) : null
        if (
          circuit &&
          shouldApplySmartSwitchExpansion(target, circuit, symbol) &&
          !circuitIsTerminalPanelFeederSim(project, circuitId!)
        ) {
          let workingTarget = target
          let lastAddedId: string | undefined
          for (const sym of expansion.symbols) {
            const countBefore = changeSet.createdEndpointIds.length
            simulateEndpointDrop(cloned, workingTarget, sym, changeSet)
            if (changeSet.createdEndpointIds.length > countBefore) {
              lastAddedId = changeSet.createdEndpointIds[changeSet.createdEndpointIds.length - 1]
              const circuitAfter = findCircuitInProject(cloned, circuitId!)
              if (circuitAfter && lastAddedId) {
                workingTarget = refreshBranchDropTargetAfterInsert(
                  circuitAfter,
                  workingTarget,
                  lastAddedId
                )
              }
            }
          }
          return changeSet
        }
      }
      simulateEndpointDrop(cloned, target, symbol, changeSet)
    }
    return changeSet
  }

  if (
    symbol.id === 'mcb' ||
    symbol.id === 'rcd' ||
    symbol.id === 'rcbo' ||
    symbol.id === 'fuse' ||
    symbol.id === 'main_switch' ||
    symbol.id === 'spd' ||
    symbol.id === 'rotating_switch'
  ) {
    simulateProtectionDrop(cloned, target, symbol, changeSet)
    return changeSet
  }

  if (symbol.id === 'energy_meter') {
    if (target.type === 'circuit' && target.circuitId && !target.branchEndpoints?.length) {
      simulateTrunkDeviceOnCircuit(cloned, target, symbol, 'energy_meter', changeSet)
      return changeSet
    }
    // Otherwise behave like in-between endpoint on branch for preview.
    simulateEndpointDrop(cloned, target, symbol, changeSet)
    return changeSet
  }

  if (symbol.id === 'panel_distribution') {
    const clonedPanels = mutableProjectPanels(cloned)

    if (clonedPanels.length === 0) {
      const mainPanelId = generateId()
      const mainPanel: Panel = {
        id: mainPanelId,
        name: 'Main Panel',
        symbol: 'panel_distribution',
        isMain: true,
        protections: [],
        circuits: [],
        subPanels: [],
      }
      clonedPanels.push(mainPanel)
      changeSet.affectedPanelIds.push(mainPanelId)
      return changeSet
    }

    if (target.type === null && !target.panelId) {
      const newPanelId = generateId()
      const panelNumber = countPanelsSim(clonedPanels) + 1
      const newRootPanel: Panel = {
        id: newPanelId,
        name: `Panel ${panelNumber}`,
        symbol: 'panel_distribution',
        isMain: true,
        protections: [],
        circuits: [],
        subPanels: [],
      }
      clonedPanels.push(newRootPanel)
      changeSet.affectedPanelIds.push(newPanelId)
      return changeSet
    }

    const parentPanel =
      findPanelById(clonedPanels, target.panelId) ??
      clonedPanels.find((p) => p.isMain) ??
      clonedPanels[0] ??
      null
    if (!parentPanel) return null

    const newPanelId = generateId()
    const panelNumber = countPanelsSim(clonedPanels) + 1
    const newPanel: Panel = {
      id: newPanelId,
      name: `Panel ${panelNumber}`,
      symbol: 'panel_distribution',
      isMain: false,
      protections: [],
      circuits: [],
      subPanels: [],
    }
    const targetedCircuit = target.circuitId ? findCircuitInProject(cloned, target.circuitId) : null
    if (targetedCircuit?.supplySource?.kind === 'converter-backup') {
      clonedPanels.push(newPanel)
      const feederProtection = findProtectionByCircuitIdInProject(cloned, targetedCircuit.id)
      if (!feederProtection) return null

      feederProtection.subPanelId = newPanelId
      const panelEndpointId = generateId()
      targetedCircuit.endpoints = [
        ...targetedCircuit.endpoints,
        {
          id: panelEndpointId,
          type: 'fixed_appliance',
          label: newPanel.name,
          symbol: 'panel_distribution',
          panelId: newPanelId,
          placements: [],
        },
      ]
      const branch = targetedCircuit.branches?.[0] ?? {
        id: generateId(),
        label: '',
        endpointIds: [],
      }
      targetedCircuit.branches = [
        { ...branch, endpointIds: targetedCircuit.endpoints.map((endpoint) => endpoint.id) },
      ]
      changeSet.createdEndpointIds.push(panelEndpointId)
      changeSet.affectedCircuitIds.push(targetedCircuit.id)
      changeSet.affectedPanelIds.push(parentPanel.id, newPanelId)
      return changeSet
    } else {
      parentPanel.subPanels = [...(parentPanel.subPanels ?? []), newPanel]
    }
    changeSet.affectedPanelIds.push(parentPanel.id, newPanelId)

    let feederProtection: ProtectionDevice | null = null
    if (target.type === 'protection' && target.protectionId) {
      feederProtection = findProtectionByIdInProject(cloned, target.protectionId)
    } else if ((target.type === 'circuit' || target.type === 'endpoint') && target.circuitId) {
      feederProtection = findProtectionByCircuitIdInProject(cloned, target.circuitId)
    }
    const feederCircuit = feederProtection?.circuits?.[0]
    if (
      feederProtection &&
      feederCircuit &&
      !feederProtection.subPanelId &&
      typeof target.secondaryBusInsertIndex !== 'number' &&
      target.type !== 'rcd'
    ) {
      feederProtection.subPanelId = newPanelId
      changeSet.affectedCircuitIds.push(feederCircuit.id)
      return changeSet
    }

    const voltagePoles = getVoltagePolesConfig(cloned)
    const mcbDefaults = getDefaultProtectionProps('MCB', voltagePoles)
    const protectionId = generateId()
    const circuitId = generateId()
    const feederCode = getNextAvailableCircuitCode(cloned, parentPanel.id)
    const protection: ProtectionDevice = {
      id: protectionId,
      type: 'MCB',
      label: feederCode,
      circuits: [],
      subPanelId: newPanelId,
      ...(target.type === 'mainBus'
        ? {
            busSectionId:
              target.busSectionId ??
              getMainBusInsertionSectionId(parentPanel, target.mainBusInsertIndex),
          }
        : {}),
      ...mcbDefaults,
    }
    const circuit: Circuit = {
      id: circuitId,
      code: feederCode,
      kind: 'other',
      cable: createDefaultAcCircuitCable({ sectionMm2: 6 }),
      endpoints: [],
      ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
    }
    parentPanel.protections = [...(parentPanel.protections ?? []), protection]
    protection.circuits = [circuit]
    changeSet.createdProtectionIds.push(protectionId)
    changeSet.affectedCircuitIds.push(circuitId)

    if (target.type === 'rcd' && target.protectionId) {
      const targetRcd = findProtectionByIdInProject(cloned, target.protectionId)
      if (targetRcd) {
        const ordered = (targetRcd.circuits ?? []).filter(
          (candidate) => candidate.id !== circuit.id
        )
        ordered.splice(
          clamp(target.secondaryBusInsertIndex ?? ordered.length, 0, ordered.length),
          0,
          circuit
        )
        targetRcd.circuits = ordered
      }
    } else if (
      target.type === 'circuit' &&
      target.circuitId &&
      typeof target.secondaryBusInsertIndex === 'number'
    ) {
      simulateMoveCircuitToSecondaryBus(
        cloned,
        target.circuitId,
        circuit.id,
        target.secondaryBusInsertIndex
      )
    } else if (target.type === 'mainBus' && typeof target.mainBusInsertIndex === 'number') {
      const beforeCount = target.mainBusItemCount ?? 0
      const desiredIndex = clamp(target.mainBusInsertIndex, 0, beforeCount)
      for (let index = beforeCount; index > desiredIndex; index -= 1) {
        simulateMoveCircuitOnMainBus(parentPanel, circuit.id, 'left')
      }
    }
    return changeSet
  }

  // Fallback: for now we only simulate core behaviors; unsupported symbols return null.
  return null
}

export function simulatePanelAttachmentMoveOnProject(
  project: PreviewProject,
  moving: { panelId: string },
  target: DropTarget
): EendraadPreviewChangeSet | null {
  const cloned = cloneProject(project)
  const result =
    target.type === 'circuit' &&
    target.circuitId &&
    typeof target.secondaryBusInsertIndex === 'number'
      ? movePanelAttachmentOnSecondaryBus(
          mutableProjectPanels(cloned),
          moving.panelId,
          target.circuitId,
          target.secondaryBusInsertIndex
        )
      : target.type === 'rcd' &&
          target.protectionId &&
          typeof target.secondaryBusInsertIndex === 'number'
        ? movePanelAttachmentOnRcdBus(
            mutableProjectPanels(cloned),
            moving.panelId,
            target.protectionId,
            target.secondaryBusInsertIndex
          )
        : target.type === 'mainBus' &&
            target.panelId &&
            typeof target.mainBusInsertIndex === 'number'
          ? movePanelAttachmentToMainBus(
              mutableProjectPanels(cloned),
              moving.panelId,
              target.panelId,
              target.mainBusInsertIndex
            )
          : null
  if (!result) return null

  return {
    project: cloned,
    affectedPanelIds: [result.sourcePanelId],
    affectedCircuitIds: [result.parentCircuitId, result.feederCircuitId].filter(
      (id): id is string => !!id
    ),
    createdEndpointIds: [],
    createdProtectionIds: [],
    createdTrunkDeviceIds: [],
    movedTrunkDeviceIds: [],
    createdSupplyTrunkDeviceIds: [],
    createdGroundTrunkDeviceIds: [],
  }
}
