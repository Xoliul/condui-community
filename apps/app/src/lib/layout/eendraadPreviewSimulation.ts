import { isSupplyBranchDevice } from '@/lib/supplyAssembly/electricalTopology'
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
} from '@/handlers/eendraad/dropBehaviors'
import { symbolSupportsWireDomain, type SymbolMetadata } from '@/lib/symbols'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import {
  circuitAcceptsTrunkSwitch,
  isCircuitTrunkSwitchDropTarget,
  isCircuitTrunkSwitchSymbol,
} from '@/lib/eendraad/circuitTrunkSwitch'
import { initializeBranchesIfNeeded, getCircuitBranches } from '@/lib/layout/endpointChains'
import { getEndpointTypeFromSymbol, getSymbolKeyFromSymbol } from '@/utils'
import {
  isFixedApplianceSymbol,
  isActualEndpointSymbol,
  isInBetweenDevice,
  isActualEndpoint,
} from '@/utils/symbolMapping'
import {
  isDcOnlyEndpointSymbol,
  isEnergyConversionEndpointSymbol,
} from '@/lib/eendraad/endpointInsertAfter'
import { DEFAULT_ELECTRICAL_DOMAIN } from '@/types/schema'
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
  PROTECTION_SYMBOL_IDS,
  isCircuitTrunkAddOnProtectionType,
  resolveInitialProtectionBusLabel,
} from '@/lib/protectionKind'
import { generateId } from '@/utils'
import {
  getNextTerminalStripLabel,
  getTerminalStripTrunkConnectionProps,
} from '@/lib/terminalStrip/labels'
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
import { ensureRootFeedForBusSection, getSupplyFeedDevicesForPanel } from '@/lib/feedTopology'
import {
  domoticaChildRefForEndpoint,
  updateDomoticaChainHeadAfterInsert,
  getDomoticaEndpointInputDomain,
  resolveDomoticaConversionDropTarget,
  domoticaChildRefForBranchInsert,
  insertDomoticaChildEndpoint,
} from '@/lib/eendraad/domoticaOutputOrdering'
import { syncSequentialEndpointBranchLabelsToCircuit } from '@/lib/eendraad/automaticEndpointBranchNaming'
import { getAllCircuits } from '@/lib/eendraad/projectElectricalDomain'
import { getMainBusItemsWithIndices } from '@/lib/eendraad/mainBusOrder'
import { resolvePanelSupplyLinksForSourcePanel } from '@/lib/eendraad/panelSupplyLink'
import {
  isEndpointBranchDropTarget,
  refreshBranchDropTargetAfterInsert,
  resolveSmartSwitchExpansion,
  shouldApplySmartSwitchExpansion,
} from '@/handlers/eendraad/smartSwitchDrop'
import { clamp } from '@/lib/geometry'
import {
  findOrdinaryCircuitDcBusForOutput,
  getCircuitConverterPrimaryBranch,
  promoteOrdinaryCircuitBranchesToDcBus,
} from './circuitConverterGeometry'
import {
  liftCircuitContentAboveOwnProtection,
  moveCircuitToCircuitContentPosition,
} from '@/lib/eendraad/circuitContentInsertion'
import {
  getProjectElectricalInstallation,
  getEditableProjectElectricalInstallation,
  getEditableProjectElectricalPanels,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'
import { applySecondaryPanelEarthingStem } from '@/lib/eendraad/panelGround'
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
  directConverterBackupInlineDevicesToTrunkDevices,
  findDirectConverterBackupProtection,
  getDirectConverterOutputChainForChangeover,
  panelHasPopulatedDirectConverterBackup,
  resolveDirectConverterChangeoverInsertIndex,
} from '@/lib/supplyAssembly/directConverterBackupUpgrade'
import {
  moveCircuitTrunkDeviceToSupplyDcBus,
  moveSupplyTrunkDeviceAtDropTarget,
} from '@/lib/eendraad/supplyTrunkDeviceMove'
import { reconcileDirectConverterDcDevices } from '@/lib/supplyAssembly/editorIntegration'
import { promoteDcBusConverterEndpoint } from '@/lib/eendraad/resizeConverterDcConnections'
import type { ElectricalEnclosureRef } from '@/types/supplyAssembly'

type PreviewProject = ProjectWithOptionalV2Electrical

export interface EendraadPreviewChangeSet {
  project: PreviewProject
  /** Panels whose layout is affected by this simulated drop. */
  affectedPanelIds: string[]
  /** Circuits that were created or structurally changed (endpoints/branches/trunkDevices). */
  affectedCircuitIds: string[]
  /** Endpoints that were created by this drop. */
  createdEndpointIds: string[]
  /** Protections that were created (e.g. new MCB for nested circuit). */
  createdProtectionIds: string[]
  /** Trunk devices that were created on a circuit or supply. */
  createdTrunkDeviceIds: string[]
  /** Existing circuit trunk devices repositioned in this preview (same id). */
  movedTrunkDeviceIds: string[]
  /** Supply trunk devices created on installation.mainSupply.supplyTrunkDevices. */
  createdSupplyTrunkDeviceIds: string[]
  /** Ground trunk devices created on installation.groundTrunkDevices. */
  createdGroundTrunkDeviceIds: string[]
}

/**
 * Shallow clone helper for preview projects.
 * For preview we only need structural copies; JSON clone is sufficient and cheap at this scale.
 */
function cloneProject<T extends PreviewProject>(project: T): T {
  return JSON.parse(JSON.stringify(project)) as T
}

function projectPanels(project: PreviewProject): Panel[] {
  return getProjectElectricalPanels(project)
}

function mutableProjectPanels(project: PreviewProject): Panel[] {
  return getEditableProjectElectricalPanels(project)
}

function projectInstallation(project: PreviewProject) {
  return getProjectElectricalInstallation(project)
}

function mutableProjectInstallation(project: PreviewProject) {
  return getEditableProjectElectricalInstallation(project)
}

function findPanelForCircuit(project: PreviewProject, circuitId: string): Panel | null {
  const stack = [...projectPanels(project)]
  while (stack.length) {
    const p = stack.pop()!
    if (p.circuits.some((c) => c.id === circuitId)) return p
    if (p.protections) {
      for (const prot of p.protections) {
        if (prot.circuits?.some((c) => c.id === circuitId)) return p
      }
    }
    if (p.subPanels?.length) stack.push(...p.subPanels)
  }
  return null
}

function findCircuitInProject(project: PreviewProject, circuitId: string): Circuit | null {
  const panels: Panel[] = []
  const stack = [...projectPanels(project)]
  while (stack.length) {
    const p = stack.pop()!
    panels.push(p)
    if (p.subPanels?.length) stack.push(...p.subPanels)
  }
  for (const panel of panels) {
    const direct = panel.circuits.find((c) => c.id === circuitId)
    if (direct) return direct
    if (panel.protections) {
      for (const prot of panel.protections) {
        const fromProt = prot.circuits?.find((c) => c.id === circuitId)
        if (fromProt) return fromProt
      }
    }
  }
  return null
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

function findProtectionByIdInProject(
  project: PreviewProject,
  protectionId: string
): ProtectionDevice | null {
  const stack = [...projectPanels(project)]
  while (stack.length) {
    const panel = stack.pop()!
    const protection = panel.protections?.find((p) => p.id === protectionId) ?? null
    if (protection) return protection
    if (panel.subPanels?.length) stack.push(...panel.subPanels)
  }
  return null
}

function findProtectionByCircuitIdInProject(
  project: PreviewProject,
  circuitId: string
): ProtectionDevice | null {
  const stack = [...projectPanels(project)]
  while (stack.length) {
    const panel = stack.pop()!
    for (const protection of panel.protections ?? []) {
      if (protection.circuits?.some((c) => c.id === circuitId)) {
        return protection
      }
    }
    if (panel.subPanels?.length) stack.push(...panel.subPanels)
  }
  return null
}

function countPanelsSim(panels: Panel[]): number {
  let count = 0
  const stack = [...panels]
  while (stack.length) {
    const panel = stack.pop()!
    count++
    if (panel.subPanels?.length) stack.push(...panel.subPanels)
  }
  return count
}

/**
 * True if the given circuit feeds a sub-panel via its protection device.
 * When this is the case the circuit is terminal: no additional endpoints
 * or trunk devices should be previewed on that circuit.
 */
function circuitFeedsSubPanelSim(project: PreviewProject, circuitId: string): boolean {
  const stack: Panel[] = [...projectPanels(project)]
  while (stack.length) {
    const p = stack.pop()!
    for (const link of resolvePanelSupplyLinksForSourcePanel(project, p)) {
      if (link.feederCircuit?.id === circuitId) return true
    }
    if (p.subPanels?.length) stack.push(...p.subPanels)
  }
  return false
}

/**
 * Compute trunk position similarly to existing getCircuitTrunkPositionForDrop, but purely on Circuit.
 */
function getCircuitTrunkPositionForDropSim(target: DropTarget, circuit: Circuit): number {
  if (target.insertAfterCircuitContent) {
    return Math.max(getCircuitBranches(circuit).length, ...(circuit.trunkDevices ?? []).map((device) => device.trunkPosition ?? 0))
  }
  const trunkDevices = [...(circuit.trunkDevices ?? [])].sort(
    (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
  )

  if (typeof target.circuitTrunkSegmentIndex === 'number') {
    const segmentIndex = target.circuitTrunkSegmentIndex
    if (segmentIndex <= 0 || trunkDevices.length === 0) return 0
    const prevDevice = trunkDevices[Math.min(segmentIndex - 1, trunkDevices.length - 1)]
    return prevDevice?.trunkPosition ?? 0
  }

  if (target.insertAfterEndpointId) {
    const branches = getCircuitBranches(circuit)
    for (let i = 0; i < branches.length; i++) {
      const branch = branches[i]
      if (branch?.some((ep) => ep.id === target.insertAfterEndpointId)) {
        return i + 1
      }
    }
  }

  return 0
}

/**
 * Determine the electrical domain on a circuit trunk based purely on the simulated project.
 */
function getWireDomainAtDropTargetSim(
  target: DropTarget,
  project: PreviewProject
): typeof DEFAULT_ELECTRICAL_DOMAIN {
  if (target.wireDomain) {
    return target.wireDomain as typeof DEFAULT_ELECTRICAL_DOMAIN
  }
  const AC = 'AC' as const

  if (target.type === 'supplyWire') {
    const installation = projectInstallation(project)
    const targetPanel = target.panelId
      ? findPanelById(projectPanels(project), target.panelId)
      : null
    const panelSupplyCircuit = targetPanel?.circuits?.find((c) => c.code === 'PANEL')
    const panelSupply = [...(panelSupplyCircuit?.trunkDevices ?? [])].sort(
      (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
    )
    const supply =
      panelSupply.length > 0 || (targetPanel && !targetPanel.isMain)
        ? panelSupply
        : targetPanel?.isMain && target.panelId && installation
          ? getSupplyFeedDevicesForPanel(
              installation,
              projectPanels(project),
              target.panelId,
              target.supplyFeedScope ?? 'shared'
            )
          : (installation?.mainSupply?.supplyTrunkDevices ?? [])
    const insertIndex = target.supplyDeviceInsertIndex ?? 0
    if (insertIndex === 0) return AC
    let domain: typeof DEFAULT_ELECTRICAL_DOMAIN = AC
    for (let i = 0; i < insertIndex; i++) {
      const prevDevice = supply[i]
      if (!prevDevice) continue
      const resolved = resolveSymbolPortsForWire(prevDevice.symbol, domain)
      if (resolved.matched && resolved.oppositePortDomain) {
        domain = resolved.oppositePortDomain
      }
    }
    return domain
  }

  // Direct-converter right/top insertion slots are explicit DC lanes; there
  // is no ordinary serial supply prefix to walk for domain inference here.
  if (target.type === 'supplyConverterDcWire') return 'DC'

  if (target.type === 'circuit' && target.circuitId && !target.branchEndpoints?.length) {
    const circuit = findCircuitInProject(project, target.circuitId)
    if (!circuit) return AC
    const trunkDevices = [...(circuit.trunkDevices ?? [])].sort(
      (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
    )
    if (!trunkDevices.length) return AC

    if (typeof target.circuitTrunkSegmentIndex === 'number' && !target.insertAfterCircuitContent) {
      const segmentIndex = target.circuitTrunkSegmentIndex
      if (segmentIndex <= 0) return AC
      let domain: typeof DEFAULT_ELECTRICAL_DOMAIN = AC
      const endExclusive = Math.min(segmentIndex, trunkDevices.length)
      for (let i = 0; i < endExclusive; i++) {
        const prevDevice = trunkDevices[i]
        if (!prevDevice) continue
        const resolved = resolveSymbolPortsForWire(prevDevice.symbol, domain)
        if (resolved.matched && resolved.oppositePortDomain) {
          domain = resolved.oppositePortDomain
        }
      }
      return domain
    }

    const trunkPosition = getCircuitTrunkPositionForDropSim(target, circuit)
    if (trunkPosition === 0) return AC
    const prevDevices = target.insertAfterCircuitContent
      ? trunkDevices
      : trunkDevices.filter((d) => (d.trunkPosition ?? 0) < trunkPosition)
    let domain: typeof DEFAULT_ELECTRICAL_DOMAIN = AC
    for (const prevDevice of prevDevices) {
      const resolved = resolveSymbolPortsForWire(prevDevice.symbol, domain)
      if (resolved.matched && resolved.oppositePortDomain) {
        domain = resolved.oppositePortDomain
      }
    }
    return domain
  }

  if (target.type === 'endpoint' || (target.type === 'circuit' && target.branchEndpoints?.length)) {
    const circuitId = target.circuitId
    if (!circuitId) return AC
    const circuit = findCircuitInProject(project, circuitId)
    if (!circuit) return AC
    const branchIndex = getCircuitBranches(circuit).findIndex((branch) =>
      branch.some((endpoint) => endpoint.id === target.endpointId || target.branchEndpoints?.includes(endpoint.id)))
    const trunkDevices = (circuit.trunkDevices ?? []).filter((device) =>
      branchIndex < 0 || (device.trunkPosition ?? 0) <= branchIndex)
    const sorted = [...trunkDevices].sort((a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0))
    let domain: typeof DEFAULT_ELECTRICAL_DOMAIN = AC
    for (const td of sorted) {
      const resolved = resolveSymbolPortsForWire(td.symbol, domain)
      if (resolved.matched && resolved.oppositePortDomain) {
        domain = resolved.oppositePortDomain
      }
    }

    // Branch drops must account for upstream in-branch conversion symbols.
    const targetEndpoint = circuit.endpoints.find((endpoint) => endpoint.id === target.endpointId)
    if (targetEndpoint && (targetEndpoint.domoticaChildProps || target.domoticaOutput)) {
      const input = getDomoticaEndpointInputDomain(circuit, targetEndpoint.id, domain)
      if (target.domoticaOutput || target.domoticaChildDropIntent === 'insertBefore') return input
      if (!targetEndpoint.symbol) return input
      const resolved = resolveSymbolPortsForWire(targetEndpoint.symbol, input)
      return resolved.matched ? (resolved.oppositePortDomain ?? input) : input
    }
    const branchIds = target.branchEndpoints ?? []
    if (branchIds.length > 0) {
      let upstreamIds: string[] = []
      if (target.insertAfterEndpointId === null) {
        upstreamIds = []
      } else if (typeof target.insertAfterEndpointId === 'string') {
        const idx = branchIds.indexOf(target.insertAfterEndpointId)
        upstreamIds = idx >= 0 ? branchIds.slice(0, idx + 1) : []
      } else {
        upstreamIds = [...branchIds]
      }

      for (const endpointId of upstreamIds) {
        const endpoint = circuit.endpoints.find((ep) => ep.id === endpointId)
        if (!endpoint?.symbol) continue
        const resolved = resolveSymbolPortsForWire(endpoint.symbol, domain)
        if (resolved.matched && resolved.oppositePortDomain) {
          domain = resolved.oppositePortDomain
        }
      }
    }
    return domain
  }

  return AC
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

  // Circuits that feed a secondary panel are terminal: the MCB output
  // goes exclusively to the sub‑panel, so no extra endpoints should be previewed.
  if (circuitFeedsSubPanelSim(project, circuitId)) {
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
      ? getTerminalStripTrunkConnectionProps(project)
      : isSharedJunctionSymbol(symbol.id)
        ? { junctionIdentity: getNextJunctionIdentity(project, symbol.id) }
        : {}),
  } as Endpoint

  // Labeling rules, branch selection: mirror endpointBehavior as closely as possible but purely.
  const branches: Branch[] = circuit.branches?.length
    ? circuit.branches
    : initializeBranchesIfNeeded(circuit)

  let branchEndpointIds = target.branchEndpoints?.length ? target.branchEndpoints : null
  const inBetween = isInBetweenDevice(symbol)
  const actualEndpoint = isActualEndpointSymbol(symbol)

  let insertAfterEndpointId: string | null | undefined = target.insertAfterEndpointId
  let createNewBranch = false

  // Domotica body or output wire drop: treat as adding to that output (first output when dropping on body).
  if (isDomoticaOutputDrop && target.domoticaOutput && target.endpointId) {
    insertAfterEndpointId = target.endpointId
    endpoint.domoticaChildProps = {
      parentEndpointId: target.endpointId,
      outputGroup: 'endpoint',
      outputIndex: target.domoticaOutput.index,
    }
  }

  if (target.domoticaChildDropIntent === 'insertBefore' && branchEndpointIds?.length) {
    createNewBranch = false
  }

  if (target.domoticaChildDropIntent === 'insertBefore' && branchEndpointIds?.length) {
    // Keep the preview on the existing Domotica chain using the preceding endpoint.
  } else if (inBetween) {
    if (branchEndpointIds?.length) {
      // Clamp in-between devices so they never end up after an actual endpoint.
      if (typeof insertAfterEndpointId === 'string') {
        const idx = branchEndpointIds.indexOf(insertAfterEndpointId)
        if (idx >= 0) {
          const ep = circuit.endpoints.find((e) => e.id === insertAfterEndpointId)
          const isDomoticaAfterConversion = symbol.id === 'domotica' && isEnergyConversionEndpointSymbol(ep?.symbol)
          if (ep && isActualEndpoint(ep) && !isDomoticaAfterConversion) {
            insertAfterEndpointId = idx > 0 ? branchEndpointIds[idx - 1] : null
          }
        }
      }
    }
  } else if (actualEndpoint) {
    const insertAfterEp =
      typeof insertAfterEndpointId === 'string'
        ? circuit.endpoints.find((e) => e.id === insertAfterEndpointId)
        : undefined

    if (branchEndpointIds?.length && insertAfterEp?.domoticaChildProps) {
      createNewBranch = false
    } else {
      const isFixed = isFixedApplianceSymbol(symbol)

      // Static devices are the actual endpoints that may legally be inserted
      // *after* a socket on the same branch. This includes branch-local energy
      // conversion devices; mirror the runtime computeInsertAfter behaviour.
      const isFixedAfterSocket =
        !!branchEndpointIds?.length && isFixed && insertAfterEp?.type === 'socket'
      const isDcAfterConversion =
        !!branchEndpointIds?.length &&
        isDcOnlyEndpointSymbol(symbol) &&
        isEnergyConversionEndpointSymbol(insertAfterEp?.symbol)

      if (isFixedAfterSocket || isDcAfterConversion) {
        // insertAfterEndpointId already points to the socket; createNewBranch
        // (or converter) stays false so the static device is appended on the same branch.
      } else if (branchEndpointIds?.length) {
        // General rule for actual endpoints:
        // - If the branch already has a terminal (socket/light), a new terminal
        //   must start a new branch.
        // - Otherwise append at the end of the current branch.
        const hasTerminalAlready = branchEndpointIds.some((id) => {
          const ep = circuit.endpoints.find((e) => e.id === id)
          return ep && (ep.type === 'socket' || ep.type === 'light_point')
        })
        if (hasTerminalAlready) {
          // Keep hovered-position intent for unchainable endpoint drops:
          // before lead-in wire => before hovered branch, otherwise after.
          if (insertAfterEndpointId !== null) {
            const lastId = branchEndpointIds[branchEndpointIds.length - 1]
            insertAfterEndpointId = lastId
          }
          createNewBranch = true
        } else {
          const lastId = branchEndpointIds[branchEndpointIds.length - 1]
          insertAfterEndpointId = lastId
          createNewBranch = false
        }
      }
    }
  }

  // A converter's direct backup output is intentionally one simple circuit.
  // Keep every endpoint on its single branch, matching the live drop behavior.
  if (circuit.supplySource?.kind === 'converter-backup' && circuit.endpoints.length > 0) {
    insertAfterEndpointId = circuit.endpoints.at(-1)?.id
    createNewBranch = false
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
      .filter((b) => (b.endpointIds ?? []).length > 0)
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
    const insertionIndex = target.dcBusId
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
    if (circuitFeedsSubPanelSim(project, target.circuitId)) return
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

/**
 * Simulate dropping an energy meter or other trunk device on a circuit trunk.
 */
function simulateTrunkDeviceOnCircuit(
  project: PreviewProject,
  target: DropTarget,
  symbol: SymbolMetadata,
  type: TrunkDevice['type'],
  changeSet: EendraadPreviewChangeSet
): void {
  if (!target.circuitId) return
  const circuit = findCircuitInProject(project, target.circuitId)
  if (!circuit) return

  // Do not preview additional trunk devices on circuits that feed a sub-panel.
  if (circuitFeedsSubPanelSim(project, circuit.id)) {
    return
  }

  const trunkPosition = getCircuitTrunkPositionForDropSim(target, circuit)
  const deviceId = generateId()
  const trunkDevice: TrunkDevice = {
    id: deviceId,
    type,
    symbol: symbol.id as TrunkDevice['symbol'],
    label:
      symbol.id === 'terminal_strip'
        ? getNextTerminalStripLabel(project)
        : type === 'conversion' || type === 'switch' || type === 'relay'
          ? ''
          : (symbol.name ?? ''),
    trunkPosition,
    ...(type === 'switch' ? { poles: 1, polesConfig: '1P' as const } : {}),
    ...(target.converterDcConnection
      ? { converterDcConnection: { ...target.converterDcConnection } }
      : {}),
    ...(type === 'dc_bus' ? { dcBusProps: {} } : {}),
    ...(symbol.id === 'terminal_strip'
      ? getTerminalStripTrunkConnectionProps(project)
      : isSharedJunctionSymbol(symbol.id)
        ? { junctionIdentity: getNextJunctionIdentity(project, symbol.id) }
        : {}),
  }

  const list = [...(circuit.trunkDevices ?? []), trunkDevice]
  // Order according to segment index if available
  if (typeof target.circuitTrunkSegmentIndex === 'number' && !target.insertAfterCircuitContent) {
    const segIndex = target.circuitTrunkSegmentIndex
    list.sort((a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0))
    const currentIdx = list.findIndex((d) => d.id === deviceId)
    if (currentIdx !== -1) {
      list.splice(currentIdx, 1)
      const insertIdx = clamp(segIndex, 0, list.length)
      list.splice(insertIdx, 0, trunkDevice)
    }
  }

  circuit.trunkDevices = list
  if (type === 'dc_bus') {
    circuit.branches = promoteOrdinaryCircuitBranchesToDcBus(
      circuit,
      deviceId,
      target.converterDcConnection
    )
  }

  changeSet.affectedCircuitIds.push(circuit.id)
  const owningPanel = findPanelForCircuit(project, circuit.id)
  if (owningPanel && !changeSet.affectedPanelIds.includes(owningPanel.id)) {
    changeSet.affectedPanelIds.push(owningPanel.id)
  }
  changeSet.createdTrunkDeviceIds.push(deviceId)
}

/**
 * Simulate adding a device to the supply trunk wire (installation.mainSupply.supplyTrunkDevices).
 * Mirrors addSupplyTrunkDevice in dropBehaviors for preview.
 */
function simulateSupplyTrunkDevice(
  project: PreviewProject,
  target: DropTarget,
  symbol: SymbolMetadata,
  changeSet: EendraadPreviewChangeSet
): void {
  if (symbol.id === 'energy_meter') {
    return
  }

  const targetPanel = target.panelId ? findPanelById(projectPanels(project), target.panelId) : null
  const panelSupplyCircuit = targetPanel?.circuits?.find((c) => c.code === 'PANEL')
  if (targetPanel && !targetPanel.isMain && panelSupplyCircuit) {
    const list = [...(panelSupplyCircuit.trunkDevices ?? [])]
    const deviceId = generateId()
    const insertIndex = target.supplyDeviceInsertIndex ?? list.length
    let deviceType: TrunkDevice['type'] = 'energy_meter'
    let label = ''
    if (symbol.id === 'energy_meter') {
      deviceType = 'energy_meter'
      label = 'kWh'
    } else if (symbol.id === 'relay') {
      deviceType = 'relay'
    } else if (symbol.id === 'junction_box') {
      deviceType = 'junction_box'
      label = ''
    } else if (symbol.id === 'terminal_strip') {
      deviceType = 'terminal_strip'
      label = getNextTerminalStripLabel(project)
    } else if (symbol.id === 'junction_panel') {
      deviceType = 'junction_panel'
      label = 'JP1'
    } else if (symbol.id === 'source_changeover') {
      deviceType = 'changeover'
      label = ''
    } else if (symbol.id === 'domotica') {
      deviceType = 'domotica'
      label = ''
    } else if (['transformer', 'rectifier', 'inverter', 'dc_dc_converter'].includes(symbol.id)) {
      deviceType = 'conversion'
      label = symbol.name ?? ''
    } else if (
      ['mcb', 'rcd', 'rcbo', 'fuse', 'main_switch', 'spd', 'rotating_switch'].includes(symbol.id)
    ) {
      deviceType = 'protection'
      const protectionType = PROTECTION_SYMBOL_ID_TO_TYPE[symbol.id]
      label = protectionType === 'ROTATING_SWITCH' ? '' : symbol.id.toUpperCase()
    }
    const trunkDevice: TrunkDevice = {
      id: deviceId,
      type: deviceType,
      symbol: symbol.id as TrunkDevice['symbol'],
      label,
      ...(symbol.id === 'terminal_strip' ? getTerminalStripTrunkConnectionProps(project) : {}),
      trunkPosition: 0,
      ...(symbol.id === 'domotica'
        ? { domoticaProps: { endpointCount: 1, endpointChildEndpointIds: [] } }
        : {}),
    }
    const idx = clamp(insertIndex, 0, list.length)
    list.splice(idx, 0, trunkDevice)
    list.forEach((d, i) => {
      d.trunkPosition = i
    })
    panelSupplyCircuit.trunkDevices = list
    changeSet.createdTrunkDeviceIds.push(deviceId)
    if (!changeSet.affectedPanelIds.includes(targetPanel.id)) {
      changeSet.affectedPanelIds.push(targetPanel.id)
    }
    changeSet.affectedCircuitIds.push(panelSupplyCircuit.id)
    return
  }

  const installation = mutableProjectInstallation(project)
  if (!installation) return
  if (!installation.mainSupply) {
    installation.mainSupply = {
      cable: { kind: 'XVB', conductors: 3, sectionMm2: 6, hasPE: true },
      origin: 'grid',
    }
  }
  const mainTargetPanel = target.panelId
    ? findPanelById(projectPanels(project), target.panelId)
    : null
  const supplyDevices: TrunkDevice[] =
    mainTargetPanel?.isMain && target.panelId
      ? [
          ...getSupplyFeedDevicesForPanel(
            installation,
            projectPanels(project),
            target.panelId,
            target.supplyFeedScope ?? 'shared',
            target.busSectionId,
          ),
        ]
      : installation.mainSupply.supplyTrunkDevices
        ? [...installation.mainSupply.supplyTrunkDevices]
        : []

  const deviceId = generateId()
  let insertIndex = target.supplyDeviceInsertIndex ?? supplyDevices.length

  if (symbol.id === 'source_changeover') {
    const directConverter = supplyDevices.find((device) => device.supplyPath === 'converter-branch')
    if (directConverter) {
      const normalizedInsertIndex = resolveDirectConverterChangeoverInsertIndex(
        supplyDevices,
        insertIndex,
        Boolean(
          mainTargetPanel && getPanelFeedOrganization(project, mainTargetPanel) === 'split-backup'
        )
      )
      const converterOutputChain = getDirectConverterOutputChainForChangeover(
        supplyDevices,
        normalizedInsertIndex ?? undefined
      )
      if (!converterOutputChain) return
      insertIndex = normalizedInsertIndex!
      const directBackup = target.panelId
        ? findDirectConverterBackupProtection(project, target.panelId, directConverter.id)
        : null
      directConverter.supplyPath = 'backup'
      converterOutputChain.forEach((device) => {
        device.supplyPath =
          mainTargetPanel && getPanelFeedOrganization(project, mainTargetPanel) === 'split-backup'
            ? 'changeover-grid'
            : 'backup-output'
      })
      if (directBackup) {
        const owningPanel = findPanelById(projectPanels(project), target.panelId!)
        if (owningPanel) {
          owningPanel.protections = owningPanel.protections.filter(
            (protection) => protection.id !== directBackup.protection.id
          )
        }
        supplyDevices.push(...directConverterBackupInlineDevicesToTrunkDevices(directBackup))
      }
    }
  }

  let deviceType: TrunkDevice['type'] = 'energy_meter'
  let label = ''

  if (symbol.id === 'energy_meter') {
    deviceType = 'energy_meter'
    label = 'kWh'
  } else if (symbol.id === 'relay') {
    deviceType = 'relay'
  } else if (symbol.id === 'junction_box') {
    deviceType = 'junction_box'
    label = ''
  } else if (symbol.id === 'terminal_strip') {
    deviceType = 'terminal_strip'
    label = getNextTerminalStripLabel(project)
  } else if (symbol.id === 'junction_panel') {
    deviceType = 'junction_panel'
    label = 'JP1'
  } else if (symbol.id === 'source_changeover') {
    deviceType = 'changeover'
    label = ''
  } else if (
    symbol.id === 'transformer' ||
    symbol.id === 'rectifier' ||
    symbol.id === 'inverter' ||
    symbol.id === 'dc_dc_converter'
  ) {
    deviceType = 'conversion'
    label = symbol.name ?? ''
  } else if (symbol.id === 'battery') {
    deviceType = 'storage'
  } else if (symbol.id === 'solar_panel') {
    deviceType = 'generation'
  } else if (symbol.id === 'dc_bus') {
    deviceType = 'dc_bus'
    label = 'DC'
  } else if (symbol.id === 'domotica') {
    deviceType = 'domotica'
    label = ''
  } else if (
    PROTECTION_SYMBOL_IDS.includes(symbol.id as (typeof PROTECTION_SYMBOL_IDS)[number]) ||
    symbol.category === 'switches'
  ) {
    deviceType = 'protection'
    const protectionType = PROTECTION_SYMBOL_ID_TO_TYPE[symbol.id]
    label = protectionType && protectionType !== 'ROTATING_SWITCH' ? symbol.id.toUpperCase() : ''
  }

  const voltagePoles = getVoltagePolesConfig(project)
  const protectionType = PROTECTION_SYMBOL_ID_TO_TYPE[symbol.id]
  const protectionDefaults =
    deviceType === 'protection'
      ? getDefaultTrunkDeviceProtectionProps(protectionType ?? 'OTHER', voltagePoles)
      : {}

  const trunkDevice: TrunkDevice = {
    id: deviceId,
    type: deviceType,
    symbol: symbol.id as TrunkDevice['symbol'],
    label,
    ...(symbol.id === 'terminal_strip' ? getTerminalStripTrunkConnectionProps(project) : {}),
    trunkPosition: insertIndex,
    ...(target.type === 'supplyWire' &&
    target.supplyFeedScope === 'root' &&
    ['transformer', 'rectifier', 'inverter', 'dc_dc_converter'].includes(symbol.id)
      ? { supplyPath: 'converter-branch' as const }
      : target.type === 'supplyBackupWire'
        ? {
            supplyPath: ['transformer', 'rectifier', 'inverter', 'dc_dc_converter'].includes(
              symbol.id
            )
              ? ('backup' as const)
              : ('backup-output' as const),
          }
        : target.type === 'supplyBackupOutputWire'
          ? { supplyPath: 'backup-output' as const }
          : target.type === 'supplyChangeoverGridWire'
            ? {
                supplyPath: 'changeover-grid' as const,
                ...(target.changeoverGridPlacement
                  ? { changeoverGridPlacement: target.changeoverGridPlacement }
                  : {}),
              }
            : target.type === 'supplyConverterGridWire'
              ? {
                  supplyPath: 'converter-grid' as const,
                  ...(target.converterGridPlacement
                    ? { converterGridPlacement: target.converterGridPlacement }
                    : {}),
                }
              : target.type === 'supplyConverterDcWire'
                ? {
                    supplyPath:
                      target.supplyConverterDcBranch === 'top'
                        ? ('converter-dc-top' as const)
                        : ('converter-dc' as const),
                    supplyConverterDcConnectionIndex:
                      target.supplyConverterDcConnectionIndex ??
                      (target.supplyConverterDcBranch === 'top' ? 1 : 0),
                    ...(target.supplyDcBusId
                      ? {
                          supplyDcBusId: target.supplyDcBusId,
                          supplyDcBusBranchId: target.supplyDcBusBranchId ?? generateId(),
                        }
                      : {}),
                    ...(target.converterDcConnection
                      ? { converterDcConnection: { ...target.converterDcConnection } }
                      : {}),
                  }
                : {}),
    ...(symbol.id === 'battery' ? { batteryProps: { voltageV: 48, capacityKWh: 5 } } : {}),
    ...(symbol.id === 'solar_panel' ? { solarPanelProps: { wattageW: 1000 } } : {}),
    ...(symbol.id === 'dc_bus' ? { dcBusProps: {} } : {}),
    ...(symbol.id === 'domotica'
      ? { domoticaProps: { endpointCount: 1, endpointChildEndpointIds: [] } }
      : {}),
    ...(symbol.id === 'source_changeover'
      ? { changeoverProps: { port1Label: '1', port2Label: '2' } }
      : {}),
    ...(deviceType === 'protection' && protectionType
      ? { protectionType, ...protectionDefaults }
      : deviceType === 'protection'
        ? protectionDefaults
        : {}),
  }

  if (target.supplyPanelInput && !isSupplyBranchDevice(trunkDevice)) trunkDevice.supplyPanelInput = true
  if (insertIndex >= 0 && insertIndex <= supplyDevices.length) {
    supplyDevices.splice(insertIndex, 0, trunkDevice)
  } else {
    supplyDevices.push(trunkDevice)
  }
  supplyDevices.forEach((device, index) => {
    device.trunkPosition = index
  })

  if (mainTargetPanel?.isMain && target.panelId) {
    const topology = installation.feedTopology
    if (target.supplyFeedScope === 'root') {
      const rootFeed = target.busSectionId
        ? ensureRootFeedForBusSection(
            installation, projectPanels(project), target.panelId, target.busSectionId
          )
        : topology?.rootFeeds.find((feed) => feed.panelId === target.panelId)
      if (rootFeed) rootFeed.trunkDevices = supplyDevices
    } else {
      // Shared feed topology is derived from mainSupply by ensureInstallationFeedTopology().
      // Store the preview ghost in the same source of truth so relayout can render it.
      installation.mainSupply.supplyTrunkDevices = supplyDevices
    }
  } else {
    installation.mainSupply.supplyTrunkDevices = supplyDevices
  }
  changeSet.createdSupplyTrunkDeviceIds.push(deviceId)
  changeSet.createdTrunkDeviceIds.push(deviceId)

  // Mark main panel as affected so preview overlay runs for its wires.
  const mainPanel = projectPanels(project).find((p) => p.isMain) ?? projectPanels(project)[0]
  if (mainPanel && !changeSet.affectedPanelIds.includes(mainPanel.id)) {
    changeSet.affectedPanelIds.push(mainPanel.id)
  }
}

/**
 * Simulate adding a device to the ground trunk wire (installation.groundTrunkDevices).
 * Mirrors addGroundTrunkDevice in dropBehaviors for preview.
 */
function simulateGroundTrunkDevice(
  project: PreviewProject,
  target: DropTarget,
  symbol: SymbolMetadata,
  changeSet: EendraadPreviewChangeSet
): void {
  const panel = target.panelId ? findPanelById(projectPanels(project), target.panelId) : undefined
  const installation = mutableProjectInstallation(project)
  const usePanelStem = panel?.isMain === false
  if (!usePanelStem && !installation) return
  const groundDevices: TrunkDevice[] = usePanelStem
    ? [...(panel.groundTrunkDevices ?? [])]
    : [...(installation?.groundTrunkDevices ?? [])]
  const deviceId = generateId()
  const insertIndex = target.groundDeviceInsertIndex ?? groundDevices.length

  let deviceType: TrunkDevice['type'] = 'earthing_separator'
  let label = 'Aardingsonderbreker'

  if (symbol.id === 'junction_box') {
    deviceType = 'junction_box'
    label = ''
  } else if (symbol.id === 'terminal_strip') {
    deviceType = 'terminal_strip'
    label = getNextTerminalStripLabel(project)
  } else if (symbol.id === 'junction_panel') {
    deviceType = 'junction_panel'
    label = 'JP1'
  }

  const trunkDevice: TrunkDevice = {
    id: deviceId,
    type: deviceType,
    symbol:
      deviceType === 'earthing_separator'
        ? ('earthing_separator' as TrunkDevice['symbol'])
        : (symbol.id as TrunkDevice['symbol']),
    label,
    ...(symbol.id === 'terminal_strip' ? getTerminalStripTrunkConnectionProps(project) : {}),
    trunkPosition: insertIndex,
  }

  if (insertIndex >= 0 && insertIndex <= groundDevices.length) {
    groundDevices.splice(insertIndex, 0, trunkDevice)
  } else {
    groundDevices.push(trunkDevice)
  }

  if (usePanelStem && panel) {
    panel.groundTrunkDevices = groundDevices
    panel.hasGround = true
    if (!changeSet.affectedPanelIds.includes(panel.id)) changeSet.affectedPanelIds.push(panel.id)
  } else if (installation) {
    installation.groundTrunkDevices = groundDevices
    const mainPanel = projectPanels(project).find((p) => p.isMain) ?? projectPanels(project)[0]
    if (mainPanel && !changeSet.affectedPanelIds.includes(mainPanel.id)) {
      changeSet.affectedPanelIds.push(mainPanel.id)
    }
  }
  changeSet.createdGroundTrunkDeviceIds.push(deviceId)
  changeSet.createdTrunkDeviceIds.push(deviceId)
}

function simulateEarthingStemDrop(
  project: PreviewProject,
  target: DropTarget,
  changeSet: EendraadPreviewChangeSet
): void {
  const panel = target.panelId ? findPanelById(projectPanels(project), target.panelId) : undefined
  if (panel?.isMain === false) {
    applySecondaryPanelEarthingStem(panel)
    if (!changeSet.affectedPanelIds.includes(panel.id)) changeSet.affectedPanelIds.push(panel.id)
    return
  }
  const installation = mutableProjectInstallation(project)
  if (installation) installation.hasGround = true
  const mainPanel = projectPanels(project).find((p) => p.isMain) ?? projectPanels(project)[0]
  if (mainPanel && !changeSet.affectedPanelIds.includes(mainPanel.id)) {
    changeSet.affectedPanelIds.push(mainPanel.id)
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
  symbol: SymbolMetadata
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
      target
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
  if (circuitFeedsSubPanelSim(project, target.circuitId)) {
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
  if (!canCreateSupplyTopologyFromDrop(symbol, target.type)) return null
  if (symbol.id === 'dc_bus' && !canDropDcBusOnTarget(target, project)) return null
  if (
    target.type === 'supplyConverterDcWire' &&
    !target.supplyDcBusId &&
    !canDropSymbolOnSupplyConverterDcWire(symbol.id, false)
  ) {
    return null
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
          !circuitFeedsSubPanelSim(project, circuitId!)
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
