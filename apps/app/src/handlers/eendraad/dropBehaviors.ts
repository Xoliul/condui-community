import { logger } from '@/lib/logger'
/**
 * Per-symbol drop behaviors registry
 *
 * Replaces the monolithic createDropHandler with focused, per-symbol handlers.
 * Each symbol type has its own small handler that knows what to create.
 */

import { useUIStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import {
  getNextTerminalStripLabel,
  getTerminalStripCreationProps,
  getTerminalStripTrunkConnectionProps,
  getTerminalStripTrunkCreationProps,
} from '@/lib/terminalStrip/labels'
import { getNextJunctionIdentity, isSharedJunctionSymbol } from '@/lib/junctionIdentity'
import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'
import {
  trackSymbolPlace,
  type EditorCanvasAnalytics,
  type SymbolPlacementMethod,
} from '@/lib/analytics/editorEventAnalytics'
import { ensureElectricalLayerOnFloor } from '@/lib/plan/floorLayers'
import {
  buildAutoSitplanPlacement,
  getViewportCenterPlanSpaceIfApplicable,
} from '@/lib/plan/autoSitplanPlacement'
import {
  resolveCircuitSitplanTargetFloorId,
  resolveSitplanTargetFloorId,
} from '@/lib/plan/sitplanTargetFloor'
import { ensureEarthingSitplanPlacement } from '@/lib/plan/ensureEarthingSitplanPlacement'
import { collectAllGroundTrunkDevices } from '@/lib/eendraad/panelGround'
import { canSymbolAppearOnSituationPlan } from '@/lib/plan/situationPlanSymbolEligibility'
import { isModularSocketLibraryId } from '@/lib/socket/modularSocket'
import { generateId, getEndpointTypeFromSymbol, getSymbolKeyFromSymbol } from '@/utils'
import { getNextAvailableCircuitCode, countPanels } from '@/utils/project'
import { applyLibraryPresetToEndpoint } from '@/utils/symbolMapping'
import { hideInlineConverterMetadataByDefault } from '@/lib/conversionLabels'
import { initializeBranchesIfNeeded, getCircuitBranches } from '@/lib/layout/endpointChains'
import {
  getVoltagePolesConfig,
  getDefaultProtectionProps,
  getDefaultTrunkDeviceProtectionProps,
  getProtectionCreationProps,
} from '@/lib/protectionDefaults'
import {
  PROTECTION_SYMBOL_ID_TO_TYPE,
  PROTECTION_SYMBOL_IDS,
  isCircuitTrunkAddOnProtectionType,
  resolveInitialProtectionBusLabel,
} from '@/lib/protectionKind'
import {
  getPortDomainsForSymbol,
  getSymbolById,
  resolveSymbolPortsForWire,
  symbolSupportsWireDomain,
} from '@/lib/symbols'
import {
  findOrdinaryCircuitDcBusForOutput,
  getCircuitConverterDcConnectionCount,
  getCircuitConverterPrimaryBranch,
  promoteOrdinaryCircuitBranchesToDcBus,
} from '@/lib/layout/circuitConverterGeometry'
import { DEFAULT_ELECTRICAL_DOMAIN } from '@/types/schema'
import {
  createDefaultAcCircuitCable,
  DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
} from '@/lib/wires/circuitWireDefaults'
import {
  domoticaChildRefForEndpoint,
  updateDomoticaChainHeadAfterInsert,
  getDomoticaEndpointInputDomain,
  resolveDomoticaConversionDropTarget,
  domoticaChildRefForBranchInsert,
  insertDomoticaChildEndpoint,
} from '@/lib/eendraad/domoticaOutputOrdering'
import {
  circuitAcceptsTrunkSwitch,
  createCircuitTrunkSwitchDevice,
  getCircuitTrunkSwitchPositionForDrop,
  isCircuitTrunkSwitchDropTarget,
  isCircuitTrunkSwitchSymbol,
} from '@/lib/eendraad/circuitTrunkSwitch'
import type { SymbolMetadata } from '@/lib/symbols'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import type {
  Endpoint,
  Floor,
  ProtectionDevice,
  Circuit,
  Panel,
  TrunkDevice,
  TrunkDeviceType,
  ProtectionType,
  Branch,
  Placement,
} from '@/types/schema'
import type { Point, Selection } from '@/types/ui'
import type { TFunction } from 'i18next'
import { getSupplyFeedDevicesForPanel } from '@/lib/feedTopology'
import { getSupplyConverterDcConnectionIndex } from '@/lib/supplyAssembly/converterDcConnections'
import {
  refreshBranchDropTargetAfterInsert,
  isEmptyBranchWireDrop,
  resolveLayoutBranchIndex,
  resolveSmartSwitchExpansion,
  shouldApplySmartSwitchExpansion,
} from '@/handlers/eendraad/smartSwitchDrop'
import {
  computeEndpointInsertAfter,
  shouldDefaultRelayToImpulse,
} from '@/lib/eendraad/endpointInsertAfter'
import { promoteDcBusConverterEndpoint } from '@/lib/eendraad/resizeConverterDcConnections'
import {
  selectProjectSupplyAssemblies,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import {
  DEFAULT_SECONDARY_PANEL_GRID_COLUMNS,
  DEFAULT_SECONDARY_PANEL_GRID_ROWS,
} from '@/lib/panel/panelGridDefaults'
import { clamp } from '@/lib/geometry'
import {
  selectProjectBuildingFloors,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import { findPanelById } from '@/lib/panel/panelTree'
import { getMainBusInsertionSectionId } from '@/lib/panel/panelBusSections'
import { getPanelFeedOrganization } from '@/lib/panel/panelFeedOrganization'
import { canCreateSupplyTopologyFromDrop } from '@/lib/supplyTopologyFeature'
import {
  attachDirectConverterBackupCircuit,
  attachBackupConverterToAssembly,
  buildDirectConverterSupplyAssembly,
  findAssemblyForDirectConverter,
  findAssemblyForChangeover,
  retargetDirectConverterBackupPanel,
  upgradeDirectConverterToChangeoverAssembly,
} from '@/lib/supplyAssembly/editorIntegration'
import type { OffGridSupplyAssembly } from '@/types/supplyAssembly'
import {
  getDefaultSupplyConverterAcPhaseAssignment,
  getSupplyConverterAcPhaseAssignment,
} from '@/lib/supplyAssembly/supplyConverterPhases'
import {
  directConverterBackupInlineDevicesToTrunkDevices,
  findDirectConverterBackupProtection,
  getDirectConverterOutputChainForChangeover,
  resolveDirectConverterChangeoverInsertIndex,
} from '@/lib/supplyAssembly/directConverterBackupUpgrade'

export type DropBehaviorProject = ProjectWithOptionalV2Building & ProjectWithOptionalV2Electrical

export interface DropBehavior {
  validTargets: Array<DropTarget['type']>
  execute: (
    target: DropTarget,
    project: DropBehaviorProject,
    symbol: SymbolMetadata,
    t: TFunction,
    callbacks: DropBehaviorCallbacks
  ) => void
}

export interface DropBehaviorCallbacks {
  addPanel: (panel: Panel, parentPanelId?: string) => void
  addProtection: (panelId: string, protection: ProtectionDevice) => void
  addCircuit: (panelId: string, circuit: Circuit, protectionId?: string) => void
  addCircuitToProtection: (panelId: string, protectionId: string, circuit: Circuit) => void
  addEndpoint: (
    circuitId: string,
    endpoint: Endpoint,
    insertAfterEndpointId?: string | null,
    branchOpts?: {
      branchId?: string | null
      branchInsertIndex?: number
      forceNewBranch?: boolean
    }
  ) => void
  addPlacement: (endpointId: string, placement: Placement) => void
  updateEndpoint: (endpointId: string, updates: Partial<Endpoint>) => void
  setSelection: (selection: Selection) => void
  /** Wire-canvas world position where the library symbol was dropped (e.g. for free-floating notes). */
  dropCanvasPosition?: Point
  getFloorById: (floorId: string) => {
    id: string
    layers?: string[]
    hiddenSitplanPlacementIds?: string[]
  } | null
  updateFloor: (floorId: string, updates: Partial<Floor>) => void
  getCircuitById: (circuitId: string) => Circuit | null
  getProtectionById: (protectionId: string) => ProtectionDevice | null
  addTrunkDevice: (circuitId: string, device: TrunkDevice) => void
  addSupplyTrunkDevice: (
    device: TrunkDevice,
    insertIndex?: number,
    target?: { panelId?: string; feedScope?: DropTarget['supplyFeedScope']; diagramId?: string; supplyPanelInput?: boolean; busSectionId?: string }
  ) => void
  updateSupplyTrunkDevice?: (deviceId: string, updates: Partial<TrunkDevice>) => void
  addGroundTrunkDevice: (device: TrunkDevice, insertIndex?: number, panelId?: string) => void
  ensureJunctionPanelPlacementForLabel: (label: string, floorId?: string) => void
  ensureSecondaryPanelEarthingStem?: (panelId: string) => void
  updateCircuit: (circuitId: string, updates: Partial<Circuit>) => void
  updateProtection: (protectionId: string, updates: Partial<ProtectionDevice>) => void
  updateInstallation: (
    updates: Partial<NonNullable<ReturnType<typeof projectInstallation>>>
  ) => void
  addSupplyAssembly: (assembly: OffGridSupplyAssembly) => void
  replaceSupplyAssembly: (id: string, assembly: OffGridSupplyAssembly) => void
  moveCircuitOnMainBus: (panelId: string, circuitId: string, direction: 'left' | 'right') => void
  moveCircuitToSecondaryBus: (
    panelId: string,
    parentCircuitId: string,
    circuitId: string,
    insertIndex: number
  ) => void
  deleteEndpoint: (endpointId: string) => void
  deleteProtection?: (protectionId: string) => void
  addEendraadNote: (note: {
    id: string
    text: string
    fontSize: number
    pos: Point
    panelId?: string
  }) => void
  /** Called when a drop is rejected (e.g. domain mismatch for conversion components) */
  onDropRejected?: (message: string) => void
}

function getOrderedTrunkDevices(circuit: Circuit): TrunkDevice[] {
  // Stable sort by trunkPosition; for equal positions keep array order.
  return [...(circuit.trunkDevices ?? [])].sort(
    (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
  )
}

function projectPanels(project: DropBehaviorProject): Panel[] {
  return project.disciplines?.electrical?.panels ?? []
}

function projectInstallation(project: DropBehaviorProject) {
  return project.disciplines?.electrical?.installation
}

/**
 * The one safe place where a DC source may create its own AC/DC converter:
 * directly on a protection whose sole circuit is still completely empty.
 * Intermediate circuit-wire drops must never infer this topology.
 */
export function isEmptyProtectionCircuitForDcDrop(protection: ProtectionDevice): boolean {
  if (
    protection.subPanelId ||
    protection.directPanelFeeder ||
    protection.directDcBusFeeder ||
    protection.circuits?.length !== 1
  ) {
    return false
  }

  const circuit = protection.circuits?.[0]
  if (!circuit) return false
  return (
    !circuit.dcBusSource &&
    !circuit.supplySource &&
    circuit.endpoints.length === 0 &&
    (circuit.branches?.length ?? 0) === 0 &&
    (circuit.trunkDevices?.length ?? 0) === 0 &&
    (circuit.subCircuitIds?.length ?? 0) === 0
  )
}

function getSupplyDevicesForDropTarget(
  target: DropTarget,
  project: DropBehaviorProject
): TrunkDevice[] {
  const panels = projectPanels(project)
  const installation = projectInstallation(project)
  const targetPanel = target.panelId ? findPanelById(panels, target.panelId) : null
  const panelSupplyCircuit = targetPanel?.circuits?.find((c) => c.code === 'PANEL')
  const panelSupply = [...(panelSupplyCircuit?.trunkDevices ?? [])].sort(
    (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
  )
  if (panelSupply.length > 0 || (targetPanel && !targetPanel.isMain)) {
    return panelSupply
  }
  if (targetPanel?.isMain && target.panelId) {
    if (!installation) return []
    return getSupplyFeedDevicesForPanel(
      installation,
      panels,
      target.panelId,
      target.supplyFeedScope ?? 'shared'
    )
  }
  return installation?.mainSupply?.supplyTrunkDevices ?? []
}

function getCircuitTrunkPositionForDrop(target: DropTarget, circuit: Circuit): number {
  if (target.insertAfterCircuitContent) {
    return Math.max(getCircuitBranches(circuit).length, ...(circuit.trunkDevices ?? []).map((device) => device.trunkPosition ?? 0))
  }
  // Per-segment drop target on vertical trunk wire takes priority.
  if (typeof target.circuitTrunkSegmentIndex === 'number') {
    const ordered = getOrderedTrunkDevices(circuit)
    const segmentIndex = target.circuitTrunkSegmentIndex
    if (segmentIndex <= 0 || ordered.length === 0) return 0
    const prevDevice = ordered[Math.min(segmentIndex - 1, ordered.length - 1)]
    return prevDevice?.trunkPosition ?? 0
  }

  // Fallback legacy behavior: infer by nearest branch endpoint.
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

/** Get the wire domain at a drop target. Used to validate conversion component placement. */
function getWireDomainAtDropTarget(
  target: DropTarget,
  project: DropBehaviorProject,
  callbacks: Pick<DropBehaviorCallbacks, 'getCircuitById'>
): typeof DEFAULT_ELECTRICAL_DOMAIN {
  if (target.wireDomain) {
    return target.wireDomain as typeof DEFAULT_ELECTRICAL_DOMAIN
  }
  const AC = 'AC' as const

  if (target.type === 'supplyWire') {
    const supply = getSupplyDevicesForDropTarget(target, project)
    const insertIndex = target.supplyDeviceInsertIndex ?? 0
    if (insertIndex === 0) return AC // Mains is AC
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

  // The right/top lanes leaving a supply converter are explicit DC branches.
  // They are not represented by the ordinary supply-wire trunk, so there is no
  // serial device list to infer the domain from at the drop point.
  if (target.type === 'supplyConverterDcWire') return 'DC'

  if (target.type === 'protection' && target.protectionId) {
    const protection = findProtectionInProject(projectPanels(project), target.protectionId)
    const circuitId = protection?.circuits?.[0]?.id
    if (circuitId) {
      const circuit = callbacks.getCircuitById(circuitId)
      if (circuit?.trunkDevices?.length) {
        const sorted = [...circuit.trunkDevices].sort(
          (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
        )
        let domain: typeof DEFAULT_ELECTRICAL_DOMAIN = AC
        for (const td of sorted) {
          const resolved = resolveSymbolPortsForWire(td.symbol, domain)
          if (resolved.matched && resolved.oppositePortDomain) {
            domain = resolved.oppositePortDomain
          }
        }
        return domain
      }
    }
    return AC // MCB output or empty circuit
  }
  if (target.type === 'mainBus' || target.type === 'rcd') return AC

  if (target.type === 'circuit' && target.circuitId && !target.branchEndpoints?.length) {
    const circuit = callbacks.getCircuitById(target.circuitId)
    if (!circuit) return AC
    const trunkDevices = getOrderedTrunkDevices(circuit)

    // Segment-aware domain check for per-segment vertical trunk hitboxes.
    if (typeof target.circuitTrunkSegmentIndex === 'number' && !target.insertAfterCircuitContent) {
      const segmentIndex = target.circuitTrunkSegmentIndex
      if (segmentIndex <= 0 || trunkDevices.length === 0) return AC
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

    const trunkPosition = getCircuitTrunkPositionForDrop(target, circuit)
    if (trunkPosition === 0) return AC // MCB output is AC
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
    const circuit = callbacks.getCircuitById(circuitId)
    if (!circuit) return AC

    // Only devices below this branch tap feed its endpoints.
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

    // If this drop is on a branch wire/endpoint, include upstream in-branch symbols
    // (e.g. rectifier placed on branch) up to the insertion point.
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
        // No explicit insertion cursor in branch: treat as append at end.
        upstreamIds = [...branchIds]
      }

      for (const endpointId of upstreamIds) {
        const endpoint = circuit.endpoints.find((ep: Endpoint) => ep.id === endpointId)
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

function addCircuitTrunkDeviceAtDrop(
  target: DropTarget,
  _circuit: Circuit,
  trunkDevice: TrunkDevice,
  callbacks: DropBehaviorCallbacks
): void {
  if (!target.circuitId) return
  callbacks.addTrunkDevice(target.circuitId, trunkDevice)
  const updatedCircuit = callbacks.getCircuitById(target.circuitId)
  const list = updatedCircuit?.trunkDevices ? [...updatedCircuit.trunkDevices] : null
  if (!list) return
  const currentIdx = list.findIndex((d) => d.id === trunkDevice.id)
  if (currentIdx === -1) return
  list.splice(currentIdx, 1)
  const segIndex =
    typeof target.circuitTrunkSegmentIndex === 'number' && !target.insertAfterCircuitContent
      ? target.circuitTrunkSegmentIndex
      : list.length
  const insertIdx = clamp(segIndex, 0, list.length)
  list.splice(insertIdx, 0, trunkDevice)
  callbacks.updateCircuit(target.circuitId, { trunkDevices: list })
}

function addCircuitDcPassiveDevice(
  target: DropTarget,
  project: DropBehaviorProject,
  symbol: SymbolMetadata,
  callbacks: DropBehaviorCallbacks
): TrunkDevice | null {
  if (!target.circuitId) return null
  const circuit = callbacks.getCircuitById(target.circuitId)
  if (!circuit) return null

  const protectionType = PROTECTION_SYMBOL_ID_TO_TYPE[symbol.id]
  const type: TrunkDeviceType = protectionType
    ? 'protection'
    : symbol.id === 'junction_panel'
      ? 'junction_panel'
      : symbol.id === 'junction_box'
        ? 'junction_box'
        : symbol.id === 'terminal_strip'
          ? 'terminal_strip'
          : symbol.id === 'energy_meter'
            ? 'energy_meter'
            : symbol.id === 'dc_bus'
              ? 'dc_bus'
              : 'protection'
  const label =
    symbol.id === 'junction_panel'
      ? (getFirstJunctionPanelLabel(project) ?? 'JP1')
      : symbol.id === 'terminal_strip'
        ? getNextTerminalStripLabel(project)
        : symbol.id === 'energy_meter'
          ? 'kWh'
          : symbol.id === 'dc_bus'
            ? 'DC'
            : ''
  if (symbol.id === 'junction_panel') callbacks.ensureJunctionPanelPlacementForLabel(label)

  const device: TrunkDevice = {
    id: generateId(),
    type,
    symbol: symbol.id as TrunkDevice['symbol'],
    label,
    ...(symbol.id === 'terminal_strip'
      ? getTerminalStripTrunkConnectionProps(project)
      : isSharedJunctionSymbol(symbol.id)
        ? { junctionIdentity: getNextJunctionIdentity(project, symbol.id) }
        : {}),
    trunkPosition: target.converterDcConnection
      ? 0
      : getCircuitTrunkPositionForDrop(target, circuit),
    ...(target.converterDcConnection
      ? { converterDcConnection: { ...target.converterDcConnection } }
      : {}),
    ...(type === 'dc_bus' ? { dcBusProps: {} } : {}),
    ...(protectionType
      ? {
          protectionType,
          ...getDefaultTrunkDeviceProtectionProps(protectionType, getVoltagePolesConfig(project)),
        }
      : {}),
  }
  if (protectionType === 'ROTATING_SWITCH') {
    const placement = buildVisibleTrunkSitplanPlacement(project, circuit.id)
    if (placement) device.placements = [placement]
  }
  if (target.converterDcConnection) callbacks.addTrunkDevice(circuit.id, device)
  else addCircuitTrunkDeviceAtDrop(target, circuit, device, callbacks)
  callbacks.setSelection({ type: 'trunkDevice', ids: [device.id] })
  return device
}

/** Add a protection in series on one ordinary DC-rail branch. */
function addDcBusBranchProtectionDevice(
  target: DropTarget,
  project: DropBehaviorProject,
  symbol: SymbolMetadata,
  callbacks: DropBehaviorCallbacks
): TrunkDevice | null {
  if (!target.circuitId || !target.dcBusId) return null
  const circuit = callbacks.getCircuitById(target.circuitId)
  if (!circuit) return null

  const branch = (circuit.branches ?? []).find(
    (candidate) =>
      candidate.dcBusId === target.dcBusId &&
      (candidate.id === target.branchId ||
        candidate.endpointIds.some((id) => target.branchEndpoints?.includes(id)))
  )
  if (!branch) return null

  const protectionType = PROTECTION_SYMBOL_ID_TO_TYPE[symbol.id]
  if (!protectionType) return null
  const device: TrunkDevice = {
    id: generateId(),
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
  callbacks.updateCircuit(target.circuitId, {
    branches: (circuit.branches ?? []).map((candidate) =>
      candidate.id === branch.id ? { ...candidate, branchDevices } : candidate
    ),
  })
  callbacks.setSelection({ type: 'trunkDevice', ids: [device.id] })
  return device
}

/** Returns true if the symbol is a conversion component that requires domain validation. */
function isConversionSymbol(symbol: SymbolMetadata): boolean {
  return ['transformer', 'rectifier', 'inverter', 'dc_dc_converter'].includes(symbol.id)
}

/** Returns true if domain at drop target matches symbol's required input domain; calls onDropRejected if not. */
function checkDomainForConversion(
  target: DropTarget,
  project: DropBehaviorProject,
  symbol: SymbolMetadata,
  t: TFunction,
  callbacks: DropBehaviorCallbacks
): boolean {
  if (!isConversionSymbol(symbol)) return true
  const requiredPorts = getPortDomainsForSymbol(symbol.id)
  const wireDomain = getWireDomainAtDropTarget(target, project, callbacks)
  const resolved = resolveSymbolPortsForWire(symbol.id, wireDomain)
  if (resolved.matched) return true
  const message = t('wires.domainMismatchDrop', {
    defaultValue:
      '{{component}} has no {{wireDomain}} compatible port (ports: {{portA}} / {{portB}}).',
    component: symbol.name,
    domain: requiredPorts[0],
    wireDomain,
    portA: requiredPorts[0],
    portB: requiredPorts[1],
  })
  callbacks.onDropRejected?.(message)
  return false
}

/** Selectable passive DC distribution point on a circuit or converter output. */
const dcBusBehavior: DropBehavior = {
  // Keep the legacy circuit target executable for existing converter data, but
  // collectDropZoneHints deliberately hides it: new rails are advertised only
  // on an ordinary supply wire or an unoccupied converter DC connection.
  validTargets: ['circuit', 'supplyWire', 'supplyConverterDcWire'],
  execute: (target, project, symbol, t, callbacks) => {
    if (!canDropDcBusOnTarget(target, project)) return

    if (target.type === 'supplyWire') {
      if (
        !target.panelId ||
        target.supplyFeedScope !== 'root' ||
        selectProjectSupplyAssemblies(project).length > 0
      ) {
        return
      }
      const supplyDevices = getSupplyDevicesForDropTarget(target, project)
      if (
        supplyDevices.some(
          (device) =>
            device.type === 'dc_bus' ||
            device.symbol === 'dc_bus' ||
            device.supplyPath === 'converter-branch'
        )
      ) {
        return
      }
      const inverter = addSupplyTrunkDevice(
        getSymbolById('inverter')!,
        target,
        project,
        callbacks,
        { supplyPath: 'converter-branch' }
      )
      if (!inverter) return
      callbacks.addSupplyAssembly(
        buildDirectConverterSupplyAssembly(project, target.panelId, inverter)
      )
      const bus = addSupplyTrunkDevice(
        getSymbolById('dc_bus')!,
        {
          ...target,
          supplyDeviceInsertIndex: inverter.trunkPosition + 1,
        },
        project,
        callbacks,
        {
          supplyPath: 'converter-dc',
          supplyConverterDcConnectionIndex: 0,
        }
      )
      callbacks.setSelection({ type: 'trunkDevice', ids: [bus?.id ?? inverter.id] })
      return
    }

    if (target.type === 'supplyConverterDcWire') {
      if (!isBareSupplyConverterDcWire(target, project)) return
      const device = addConverterDcBranchDevice(symbol, target, project, callbacks)
      if (device) callbacks.setSelection({ type: 'trunkDevice', ids: [device.id] })
      return
    }

    if (
      target.type !== 'circuit' ||
      target.dcBusId ||
      !isBareInverterCircuitDcConnection(target, project)
    ) {
      return
    }

    if (!target.circuitId) return
    const circuit = callbacks.getCircuitById(target.circuitId)
    if (!circuit || circuitFeedsSubPanel(project, circuit.id)) return
    const wireDomain = 'DC'
    if (wireDomain !== 'DC') {
      callbacks.onDropRejected?.(
        t('wires.domainMismatchDrop', {
          defaultValue:
            '{{component}} requires {{domain}} input, but the wire here is {{wireDomain}}.',
          component: symbol.name,
          domain: 'DC',
          wireDomain,
        })
      )
      return
    }

    const bus = addCircuitDcPassiveDevice(target, project, symbol, callbacks)
    if (!bus) return
    const updatedCircuit = callbacks.getCircuitById(circuit.id)
    if (!updatedCircuit) return
    callbacks.updateCircuit(updatedCircuit.id, {
      branches: promoteOrdinaryCircuitBranchesToDcBus(
        updatedCircuit,
        bus.id,
        target.converterDcConnection
      ),
    })
  },
}

function isBareInverterCircuitDcConnection(
  target: DropTarget,
  project: DropBehaviorProject
): boolean {
  const connection = target.converterDcConnection
  if (!target.circuitId) return false

  const circuit = findCircuitForDcBusTarget(project, target.circuitId)
  if (!circuit) return false
  const inverter = connection
    ? circuit.trunkDevices?.find((device) => device.id === connection.converterId)
    : [...(circuit.trunkDevices ?? [])]
        .sort((left, right) => (left.trunkPosition ?? 0) - (right.trunkPosition ?? 0))
        .at((target.circuitTrunkSegmentIndex ?? 0) - 1)
  if (!inverter || inverter.symbol !== 'inverter') return false

  if (!connection) {
    if (target.wireDomain !== 'DC' || getCircuitConverterDcConnectionCount(inverter) > 1) {
      return false
    }
    return !(circuit.trunkDevices ?? []).some((device) => device.type === 'dc_bus')
  }

  if (connection.connectionIndex !== getCircuitConverterDcConnectionCount(inverter) - 1) {
    return false
  }

  return !(circuit.trunkDevices ?? []).some(
    (device) =>
      device.type === 'dc_bus' &&
      device.converterDcConnection?.converterId === connection.converterId
  )
}

function findCircuitForDcBusTarget(
  project: DropBehaviorProject,
  circuitId: string
): Circuit | null {
  const stack = [...projectPanels(project)]
  while (stack.length > 0) {
    const panel = stack.pop()!
    const direct = panel.circuits?.find((circuit) => circuit.id === circuitId)
    if (direct) return direct
    for (const protection of panel.protections ?? []) {
      const nested = protection.circuits?.find((circuit) => circuit.id === circuitId)
      if (nested) return nested
    }
    stack.push(...(panel.subPanels ?? []))
  }
  return null
}

export function canDropDcBusOnTarget(target: DropTarget, project: DropBehaviorProject): boolean {
  if (target.type === 'supplyWire') {
    if (
      !target.panelId ||
      target.supplyFeedScope !== 'root' ||
      selectProjectSupplyAssemblies(project).length > 0
    ) {
      return false
    }
    const supplyDevices = getSupplyDevicesForDropTarget(target, project)
    return !supplyDevices.some(
      (device) =>
        device.type === 'dc_bus' ||
        device.symbol === 'dc_bus' ||
        device.supplyPath === 'converter-branch'
    )
  }

  if (target.type === 'supplyConverterDcWire') {
    return isBareSupplyConverterDcWire(target, project)
  }

  return (
    target.type === 'circuit' &&
    !target.dcBusId &&
    isBareInverterCircuitDcConnection(target, project)
  )
}

function isBareSupplyConverterDcWire(target: DropTarget, project: DropBehaviorProject): boolean {
  if (
    target.type !== 'supplyConverterDcWire' ||
    !target.panelId ||
    target.supplyFeedScope !== 'root' ||
    target.supplyDcBusId
  ) {
    return false
  }

  const connectionIndex =
    target.supplyConverterDcConnectionIndex ?? (target.supplyConverterDcBranch === 'top' ? 1 : 0)
  if (connectionIndex !== 0) return false

  const supplyDevices = getSupplyDevicesForDropTarget(
    { ...target, type: 'supplyWire', supplyFeedScope: 'root' },
    project
  )
  const hasConverter = supplyDevices.some(
    (device) => device.supplyPath === 'converter-branch' || device.supplyPath === 'backup'
  )
  return (
    hasConverter &&
    !supplyDevices.some((device) => device.type === 'dc_bus' || device.symbol === 'dc_bus')
  )
}

function addConverterDcBranchDevice(
  symbol: SymbolMetadata,
  target: DropTarget,
  project: DropBehaviorProject,
  callbacks: DropBehaviorCallbacks
): TrunkDevice | null {
  if (target.type !== 'supplyConverterDcWire' || !target.panelId) return null
  const supplyDevices = getSupplyDevicesForDropTarget(
    { ...target, type: 'supplyWire', supplyFeedScope: 'root' },
    project
  )
  const converter = supplyDevices.find(
    (device) => device.supplyPath === 'converter-branch' || device.supplyPath === 'backup'
  )
  if (!converter) return null
  const supplyPath = target.supplyConverterDcBranch === 'top' ? 'converter-dc-top' : 'converter-dc'
  const connectionIndex =
    target.supplyConverterDcConnectionIndex ?? (target.supplyConverterDcBranch === 'top' ? 1 : 0)
  const branchDevices = supplyDevices.filter(
    (device) =>
      device.supplyPath === supplyPath &&
      getSupplyConverterDcConnectionIndex(device) === connectionIndex &&
      (target.converterDcConnection
        ? device.converterDcConnection?.converterId === target.converterDcConnection.converterId &&
          device.converterDcConnection.connectionIndex ===
            target.converterDcConnection.connectionIndex
        : !device.converterDcConnection)
  )
  const lastBranchIndex = branchDevices.reduce(
    (lastIndex, device) => Math.max(lastIndex, supplyDevices.indexOf(device)),
    -1
  )
  return addSupplyTrunkDevice(
    symbol,
    {
      ...target,
      supplyFeedScope: 'root',
      supplyDeviceInsertIndex:
        target.supplyDeviceInsertIndex ??
        (lastBranchIndex >= 0 ? lastBranchIndex + 1 : Math.max(0, converter.trunkPosition + 1)),
    },
    project,
    callbacks,
    {
      supplyPath,
      supplyConverterDcConnectionIndex: connectionIndex,
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
  )
}

/** Place a plain switch or relay in series on an ordinary circuit trunk. */
function addCircuitTrunkSwitchAtDrop(
  symbol: SymbolMetadata,
  target: DropTarget,
  project: DropBehaviorProject,
  callbacks: DropBehaviorCallbacks
): boolean {
  if (!isCircuitTrunkSwitchSymbol(symbol.id) || !isCircuitTrunkSwitchDropTarget(target)) {
    return false
  }
  const circuitId = target.circuitId!
  if (circuitFeedsSubPanel(project, circuitId)) return false
  const circuit = callbacks.getCircuitById(circuitId)
  if (!circuit || !circuitAcceptsTrunkSwitch(circuit)) return false

  const device = createCircuitTrunkSwitchDevice(
    symbol.id,
    generateId(),
    getCircuitTrunkSwitchPositionForDrop(target, getCircuitTrunkPositionForDrop(target, circuit))
  )
  const placement = buildVisibleTrunkSitplanPlacement(project, circuitId)
  if (placement) device.placements = [placement]
  addCircuitTrunkDeviceAtDrop(target, circuit, device, callbacks)
  callbacks.setSelection({ type: 'trunkDevice', ids: [device.id] })
  return true
}

const SUPPLY_DC_SWITCH_SYMBOL_IDS = new Set([
  'switch',
  'switch_1p_twoway',
  'switch_2p_twoway',
  'switch_dimmer',
  'switch_1p_changeover',
  'switch_1p_pull',
  'contact',
  'switch_impulse',
  'switch_cross',
  'switch_single',
  'switch_double',
])

function isSupplyDcSwitchSymbol(symbolId: string): boolean {
  return SUPPLY_DC_SWITCH_SYMBOL_IDS.has(symbolId)
}

function addBackupLaneTrunkDevice(
  symbol: SymbolMetadata,
  target: DropTarget,
  project: DropBehaviorProject,
  callbacks: DropBehaviorCallbacks
): TrunkDevice | null {
  if (target.type !== 'supplyBackupWire' && target.type !== 'supplyBackupOutputWire') {
    return null
  }
  return addSupplyTrunkDevice(symbol, target, project, callbacks, {
    supplyPath: 'backup-output',
  })
}

function addChangeoverGridLaneDevice(
  symbol: SymbolMetadata,
  target: DropTarget,
  project: DropBehaviorProject,
  callbacks: DropBehaviorCallbacks
): TrunkDevice | null {
  if (target.type !== 'supplyChangeoverGridWire') return null
  return addSupplyTrunkDevice(symbol, target, project, callbacks, {
    supplyPath: 'changeover-grid',
    changeoverGridPlacement: target.changeoverGridPlacement,
  })
}

function addDirectConverterBackupCircuit(
  target: DropTarget,
  project: DropBehaviorProject,
  callbacks: DropBehaviorCallbacks,
  protectionType: ProtectionType
): boolean {
  if (target.type !== 'supplyConverterBackupWire' || !target.panelId) return false
  const panel = findPanelById(projectPanels(project), target.panelId)
  if (!panel) return false
  const supplyDevices = getSupplyDevicesForDropTarget(
    { ...target, type: 'supplyWire', supplyFeedScope: 'root' },
    project
  )
  const converter = supplyDevices.find((device) => device.supplyPath === 'converter-branch')
  if (!converter) return false
  const existingBackup = findDirectConverterBackupProtection(project, panel.id, converter.id)
  if (existingBackup) {
    const symbol =
      Object.entries(PROTECTION_SYMBOL_ID_TO_TYPE).find(
        ([, candidate]) => candidate === protectionType
      )?.[0] ?? 'mcb'
    const trunkDevice: TrunkDevice = {
      id: generateId(),
      type: 'protection',
      symbol: symbol as TrunkDevice['symbol'],
      label: '',
      trunkPosition: existingBackup.circuit.trunkDevices?.length ?? 0,
      protectionType,
      ...getDefaultTrunkDeviceProtectionProps(protectionType, getVoltagePolesConfig(project)),
    }
    callbacks.addTrunkDevice(existingBackup.circuit.id, trunkDevice)
    const updatedCircuit = callbacks.getCircuitById(existingBackup.circuit.id)
    const assembly = findAssemblyForDirectConverter(project, converter.id)
    if (updatedCircuit && assembly) {
      callbacks.replaceSupplyAssembly(
        assembly.id,
        attachDirectConverterBackupCircuit(
          assembly,
          converter,
          existingBackup.protection,
          updatedCircuit,
          panel.id
        )
      )
    }
    callbacks.setSelection({ type: 'trunkDevice', ids: [trunkDevice.id] })
    return true
  }

  const circuitId = generateId()
  const protectionId = generateId()
  // This branch lives on the inverter supply lane, not on the main bus. Its
  // protection and any downstream endpoints stay explicitly user-labelled.
  const code = ''
  const protection: ProtectionDevice = {
    id: protectionId,
    type: protectionType,
    label: code,
    circuits: [],
    ...getProtectionCreationProps(project, protectionType),
  }
  const system = project.disciplines?.electrical?.installation?.nominalVoltage.system ?? '1N~'
  const circuit: Circuit = {
    id: circuitId,
    code,
    kind: 'other',
    cable: createDefaultAcCircuitCable(),
    phaseAssignment: getSupplyConverterAcPhaseAssignment(converter, system),
    supplySource: { kind: 'converter-backup', converterId: converter.id },
    endpoints: [],
    ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
  }
  callbacks.addProtection(panel.id, protection)
  callbacks.addCircuit(panel.id, circuit, protection.id)

  const assembly = findAssemblyForDirectConverter(project, converter.id)
  if (assembly) {
    callbacks.replaceSupplyAssembly(
      assembly.id,
      attachDirectConverterBackupCircuit(assembly, converter, protection, circuit, panel.id)
    )
  }
  callbacks.setSelection({ type: 'protection', ids: [protection.id] })
  return true
}

/**
 * Generic protection behavior for MCB, FUSE, MAIN_SWITCH, and SPD
 * These all create a protection device + circuit in the same way,
 * just with different types and default properties.
 */
const protectionBehavior: DropBehavior = {
  validTargets: [
    'mainBus',
    'rcd',
    'circuit',
    'supplyWire',
    'supplyBackupWire',
    'supplyBackupOutputWire',
    'supplyChangeoverGridWire',
    'supplyConverterGridWire',
    'supplyConverterBackupWire',
    'supplyConverterDcWire',
  ],
  execute: (target, project, symbol, _t, callbacks) => {
    const requestedProtectionType = PROTECTION_SYMBOL_ID_TO_TYPE[symbol.id] ?? 'MCB'
    if (target.dcBusId) {
      addDcBusBranchProtectionDevice(target, project, symbol, callbacks)
      return
    }
    if (target.converterDcConnection && !target.dcBusId && target.circuitId) {
      addCircuitDcPassiveDevice(target, project, symbol, callbacks)
      return
    }
    if (
      !target.dcBusId &&
      target.type === 'circuit' &&
      target.circuitId &&
      !target.branchEndpoints?.length &&
      getWireDomainAtDropTarget(target, project, callbacks) === 'DC'
    ) {
      addCircuitDcPassiveDevice(target, project, symbol, callbacks)
      return
    }
    if (
      target.type === 'supplyConverterBackupWire' &&
      addDirectConverterBackupCircuit(target, project, callbacks, requestedProtectionType)
    ) {
      return
    }
    // If dropped on supply wire, add as a supply trunk device
    if (
      target.type === 'supplyWire' ||
      target.type === 'supplyBackupWire' ||
      target.type === 'supplyBackupOutputWire' ||
      target.type === 'supplyChangeoverGridWire' ||
      target.type === 'supplyConverterGridWire' ||
      target.type === 'supplyConverterDcWire'
    ) {
      if (target.type === 'supplyConverterDcWire') {
        addConverterDcBranchDevice(symbol, target, project, callbacks)
      } else if (target.type === 'supplyChangeoverGridWire') {
        addChangeoverGridLaneDevice(symbol, target, project, callbacks)
      } else if (target.type === 'supplyBackupWire' || target.type === 'supplyBackupOutputWire') {
        addBackupLaneTrunkDevice(symbol, target, project, callbacks)
      } else {
        addSupplyTrunkDevice(symbol, target, project, callbacks)
      }
      return
    }

    const panel = findPanelForTarget(project, target)
    if (!panel) return

    const protectionType = requestedProtectionType

    // A rotating switch or SPD placed on an outgoing circuit wire is an inline add-on, not a
    // downstream protective boundary. Represent it on the existing circuit trunk so the
    // owning protection keeps its automatic bus letter. Secondary-bus slots deliberately
    // remain protection-row targets because they do not identify a position on the trunk.
    if (
      isCircuitTrunkAddOnProtectionType(protectionType) &&
      target.type === 'circuit' &&
      target.circuitId &&
      typeof target.circuitTrunkSegmentIndex === 'number' &&
      !target.branchEndpoints?.length &&
      target.insertAfterCircuitContent !== true &&
      typeof target.secondaryBusInsertIndex !== 'number'
    ) {
      if (circuitFeedsSubPanel(project, target.circuitId)) return
      const circuit = callbacks.getCircuitById(target.circuitId)
      if (!circuit) return

      const deviceId = generateId()
      const trunkDevice: TrunkDevice = {
        id: deviceId,
        type: 'protection',
        protectionType,
        symbol: symbol.id as TrunkDevice['symbol'],
        label: '',
        trunkPosition: getCircuitTrunkPositionForDrop(target, circuit),
        ...getDefaultTrunkDeviceProtectionProps(protectionType, getVoltagePolesConfig(project)),
      }
      const placement = buildVisibleTrunkSitplanPlacement(project, target.circuitId)
      if (placement) trunkDevice.placements = [placement]
      addCircuitTrunkDeviceAtDrop(target, circuit, trunkDevice, callbacks)
      callbacks.setSelection({ type: 'trunkDevice', ids: [deviceId] })
      return
    }

    const autoCircuitCode = resolveInitialProtectionBusLabel(
      protectionType,
      getNextAvailableCircuitCode(project, panel.id)
    )
    const targetedCircuit =
      target.type === 'circuit' && target.circuitId
        ? callbacks.getCircuitById(target.circuitId)
        : null
    if (targetedCircuit?.supplySource?.kind === 'converter-backup') return
    const targetedProtection =
      targetedCircuit && target.circuitId
        ? findProtectionByCircuitIdInProject(projectPanels(project), target.circuitId)
        : null
    if (targetedCircuit && targetedProtection?.directPanelFeeder && targetedProtection.subPanelId) {
      callbacks.updateProtection(targetedProtection.id, {
        type: protectionType,
        label: autoCircuitCode,
        ...getProtectionCreationProps(project, protectionType),
        directPanelFeeder: undefined,
      })
      callbacks.updateCircuit(targetedCircuit.id, { code: autoCircuitCode })
      return
    }

    const circuitId = generateId()
    const protectionId = generateId()
    const defaults = getProtectionCreationProps(project, protectionType)
    const protection: ProtectionDevice = {
      id: protectionId,
      type: protectionType,
      label: autoCircuitCode,
      circuits: [],
      ...(target.type === 'mainBus'
        ? {
            busSectionId:
              target.busSectionId ?? getMainBusInsertionSectionId(panel, target.mainBusInsertIndex),
          }
        : {}),
      ...defaults,
    }

    callbacks.addProtection(panel.id, protection)

    const circuit: Circuit = {
      id: circuitId,
      code: autoCircuitCode,
      kind: 'other',
      cable: createDefaultAcCircuitCable(),
      endpoints: [],
      ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
    }

    // Add circuit to new protection (single source of truth)
    callbacks.addCircuit(panel.id, circuit, protectionId)

    if (target.type === 'rcd' && target.protectionId) {
      // Also register under the RCD for grouping (via store action, not direct mutation)
      callbacks.addCircuitToProtection(panel.id, target.protectionId, circuit)
    } else if (
      target.type === 'circuit' &&
      target.circuitId &&
      !(typeof target.secondaryBusInsertIndex === 'number' && target.secondaryBusInsertIndex >= 0)
    ) {
      // Record nested relationship — ID only, no duplicated object
      const parentCircuit = callbacks.getCircuitById(target.circuitId)
      if (parentCircuit) {
        const insertedBetween = target.insertBeforeNestedCircuitId
          ? insertProtectionBetweenNestedCircuits(
              parentCircuit,
              circuitId,
              target.insertBeforeNestedCircuitId,
              callbacks
            )
          : false
        if (!insertedBetween) {
          if (target.insertAfterCircuitContent) {
            callbacks.updateCircuit(parentCircuit.id, {
              subCircuitIds: [...(parentCircuit.subCircuitIds ?? []), circuitId],
            })
          } else {
            moveParentContentToSubCircuit(
              parentCircuit,
              target.circuitId,
              circuitId,
              protectionId,
              panel,
              callbacks
            )
          }
        }
      }
    }

    // When dropped on the main bus, reposition the new circuit/protection to
    // match the cursor segment between existing bus items.
    if (target.type === 'mainBus' && typeof target.mainBusInsertIndex === 'number') {
      const panelForReorder = findPanelForTarget(project, target)
      if (panelForReorder) {
        const beforeCount = target.mainBusItemCount ?? 0
        const totalAfter = beforeCount + 1
        const desiredIndex = clamp(target.mainBusInsertIndex, 0, totalAfter - 1)
        const currentIndex = totalAfter - 1 // Newly added item starts at the end
        const movesLeft = Math.max(0, currentIndex - desiredIndex)
        for (let i = 0; i < movesLeft; i++) {
          callbacks.moveCircuitOnMainBus(panelForReorder.id, circuitId, 'left')
        }
      }
    }

    // When dropped on a secondary bus (nested circuits), place the new
    // subcircuit directly at the resolved slot. This is more reliable than
    // appending and replaying left/right swaps when the bus has many children.
    if (
      target.type === 'circuit' &&
      target.circuitId &&
      typeof target.secondaryBusInsertIndex === 'number' &&
      target.secondaryBusInsertIndex >= 0
    ) {
      callbacks.moveCircuitToSecondaryBus(
        panel.id,
        target.circuitId,
        circuitId,
        target.secondaryBusInsertIndex
      )
    }
  },
}

// Alias for backwards compatibility — kept for drop behavior registry lookup by symbol id
export const mcbBehavior = protectionBehavior

/**
 * RCD/RCBO drop behavior — creates protection + circuit, just like MCB.
 * All protection devices share the same base flow: create protection, create circuit, link them.
 */
const rcdBehavior: DropBehavior = {
  validTargets: [
    'mainBus',
    'rcd',
    'circuit',
    'supplyWire',
    'supplyBackupWire',
    'supplyBackupOutputWire',
    'supplyChangeoverGridWire',
    'supplyConverterGridWire',
    'supplyConverterBackupWire',
    'supplyConverterDcWire',
  ],
  execute: (target, project, symbol, _t, callbacks) => {
    if (target.dcBusId) {
      addDcBusBranchProtectionDevice(target, project, symbol, callbacks)
      return
    }
    if (target.converterDcConnection && !target.dcBusId && target.circuitId) {
      addCircuitDcPassiveDevice(target, project, symbol, callbacks)
      return
    }
    if (
      !target.dcBusId &&
      target.type === 'circuit' &&
      target.circuitId &&
      !target.branchEndpoints?.length &&
      getWireDomainAtDropTarget(target, project, callbacks) === 'DC'
    ) {
      addCircuitDcPassiveDevice(target, project, symbol, callbacks)
      return
    }
    const isRcbo = symbol.id === 'rcbo'
    const protectionType = isRcbo ? 'RCBO' : 'RCD'
    if (
      target.type === 'supplyConverterBackupWire' &&
      addDirectConverterBackupCircuit(target, project, callbacks, protectionType)
    ) {
      return
    }
    // If dropped on supply wire, add as a supply trunk device
    if (
      target.type === 'supplyWire' ||
      target.type === 'supplyBackupWire' ||
      target.type === 'supplyBackupOutputWire' ||
      target.type === 'supplyChangeoverGridWire' ||
      target.type === 'supplyConverterGridWire' ||
      target.type === 'supplyConverterDcWire'
    ) {
      if (target.type === 'supplyConverterDcWire') {
        addConverterDcBranchDevice(symbol, target, project, callbacks)
      } else if (target.type === 'supplyChangeoverGridWire') {
        addChangeoverGridLaneDevice(symbol, target, project, callbacks)
      } else if (target.type === 'supplyBackupWire' || target.type === 'supplyBackupOutputWire') {
        addBackupLaneTrunkDevice(symbol, target, project, callbacks)
      } else {
        addSupplyTrunkDevice(symbol, target, project, callbacks)
      }
      return
    }

    const panel = findPanelForTarget(project, target)
    if (!panel) return
    if (
      target.type === 'circuit' &&
      target.circuitId &&
      callbacks.getCircuitById(target.circuitId)?.supplySource?.kind === 'converter-backup'
    ) {
      return
    }

    const autoCircuitCode = resolveInitialProtectionBusLabel(
      protectionType,
      getNextAvailableCircuitCode(project, panel.id)
    )

    const circuitId = generateId()
    const protectionId = generateId()
    const defaults = getProtectionCreationProps(project, protectionType)
    const protection: ProtectionDevice = {
      id: protectionId,
      type: protectionType,
      label: autoCircuitCode,
      circuits: [],
      ...(target.type === 'mainBus'
        ? {
            busSectionId:
              target.busSectionId ?? getMainBusInsertionSectionId(panel, target.mainBusInsertIndex),
          }
        : {}),
      ...defaults,
    }

    callbacks.addProtection(panel.id, protection)

    const circuit: Circuit = {
      id: circuitId,
      code: autoCircuitCode,
      kind: 'other',
      cable: createDefaultAcCircuitCable(),
      endpoints: [],
      ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
    }

    // Add circuit to new protection (single source of truth)
    callbacks.addCircuit(panel.id, circuit, protectionId)

    if (target.type === 'rcd' && target.protectionId) {
      // Also register under the existing RCD for grouping (via store action)
      callbacks.addCircuitToProtection(panel.id, target.protectionId, circuit)
    } else if (
      target.type === 'circuit' &&
      target.circuitId &&
      !(typeof target.secondaryBusInsertIndex === 'number' && target.secondaryBusInsertIndex >= 0)
    ) {
      // Record nested relationship — ID only, no duplicated object
      const parentCircuit = callbacks.getCircuitById(target.circuitId)
      if (parentCircuit) {
        const insertedBetween = target.insertBeforeNestedCircuitId
          ? insertProtectionBetweenNestedCircuits(
              parentCircuit,
              circuitId,
              target.insertBeforeNestedCircuitId,
              callbacks
            )
          : false
        if (!insertedBetween) {
          if (target.insertAfterCircuitContent) {
            callbacks.updateCircuit(parentCircuit.id, {
              subCircuitIds: [...(parentCircuit.subCircuitIds ?? []), circuitId],
            })
          } else {
            moveParentContentToSubCircuit(
              parentCircuit,
              target.circuitId,
              circuitId,
              protectionId,
              panel,
              callbacks
            )
          }
        }
      }
    }

    // When dropped on the main bus, reposition the new RCD/RCBO to the
    // correct segment along the bus based on cursor position.
    if (target.type === 'mainBus' && typeof target.mainBusInsertIndex === 'number') {
      const panelForReorder = findPanelForTarget(project, target)
      if (panelForReorder) {
        const beforeCount = target.mainBusItemCount ?? 0
        const totalAfter = beforeCount + 1
        const desiredIndex = clamp(target.mainBusInsertIndex, 0, totalAfter - 1)
        const currentIndex = totalAfter - 1
        const movesLeft = Math.max(0, currentIndex - desiredIndex)
        for (let i = 0; i < movesLeft; i++) {
          callbacks.moveCircuitOnMainBus(panelForReorder.id, circuitId, 'left')
        }
      }
    }

    // Same exact-slot placement as MCB/fuse drops for nested secondary buses.
    if (
      target.type === 'circuit' &&
      target.circuitId &&
      typeof target.secondaryBusInsertIndex === 'number' &&
      target.secondaryBusInsertIndex >= 0
    ) {
      callbacks.moveCircuitToSecondaryBus(
        panel.id,
        target.circuitId,
        circuitId,
        target.secondaryBusInsertIndex
      )
    }
  },
}

/**
 * When dropping a protection device onto an existing circuit's trunk,
 * move the parent circuit's endpoints, branches, and trunk devices
 * into the newly created subcircuit.
 *
 * Before: A { endpoints, branches }
 * After:  A { subCircuitIds: [B] }  →  B { endpoints, branches }
 *
 * Also handles sub-panel connections: if the parent's protection has
 * a subPanelId (feeds a secondary panel), that link is transferred
 * to the new child protection so the panel symbol follows the content.
 *
 * Without this, both parent and subcircuit would draw on top of each other.
 */
function moveParentContentToSubCircuit(
  parentCircuit: Circuit,
  parentCircuitId: string,
  newSubCircuitId: string,
  newProtectionId: string,
  panel: Panel,
  callbacks: DropBehaviorCallbacks
): void {
  const hasEndpoints = parentCircuit.endpoints.length > 0
  const hasBranches = (parentCircuit.branches?.length ?? 0) > 0
  const hasTrunkDevices = (parentCircuit.trunkDevices?.length ?? 0) > 0

  if (hasEndpoints || hasBranches || hasTrunkDevices) {
    // Move parent's content to the new subcircuit
    const updates: Partial<Circuit> = {}
    if (hasEndpoints) updates.endpoints = [...parentCircuit.endpoints]
    if (hasBranches) updates.branches = [...parentCircuit.branches!]
    if (hasTrunkDevices) updates.trunkDevices = [...parentCircuit.trunkDevices!]
    callbacks.updateCircuit(newSubCircuitId, updates)

    // Clear parent and register the new subcircuit
    callbacks.updateCircuit(parentCircuitId, {
      endpoints: [],
      branches: [],
      trunkDevices: [],
      subCircuitIds: [...(parentCircuit.subCircuitIds || []), newSubCircuitId],
    })
  } else {
    // No content to move — just register the subcircuit
    callbacks.updateCircuit(parentCircuitId, {
      subCircuitIds: [...(parentCircuit.subCircuitIds || []), newSubCircuitId],
    })
  }

  // Transfer subPanelId from parent's protection to new child protection.
  // If the parent MCB was feeding a secondary panel, the new MCB now sits
  // between them, so the new MCB should be the one linked to the sub-panel.
  const parentProtection = panel.protections.find((p) =>
    p.circuits?.some((c) => c.id === parentCircuitId)
  )
  if (parentProtection?.subPanelId) {
    const subPanelId = parentProtection.subPanelId
    // Remove from parent protection, assign to new child protection
    callbacks.updateProtection(parentProtection.id, { subPanelId: undefined })
    callbacks.updateProtection(newProtectionId, { subPanelId })
  }
}

function insertProtectionBetweenNestedCircuits(
  parentCircuit: Circuit,
  newCircuitId: string,
  existingChildCircuitId: string,
  callbacks: Pick<DropBehaviorCallbacks, 'updateCircuit'>
): boolean {
  const childIds = parentCircuit.subCircuitIds ?? []
  const childIndex = childIds.indexOf(existingChildCircuitId)
  if (childIndex < 0) return false

  const nextParentChildren = [...childIds]
  nextParentChildren.splice(childIndex, 1, newCircuitId)
  callbacks.updateCircuit(parentCircuit.id, { subCircuitIds: nextParentChildren })
  callbacks.updateCircuit(newCircuitId, { subCircuitIds: [existingChildCircuitId] })
  return true
}

/**
 * True if the given circuit feeds a sub-panel via its protection device.
 * When this is the case the circuit is terminal: no additional endpoints
 * or trunk devices should be added on that circuit.
 */
function circuitFeedsSubPanel(project: DropBehaviorProject, circuitId: string): boolean {
  const stack: Panel[] = [...projectPanels(project)]
  while (stack.length) {
    const panel = stack.pop()!
    for (const protection of panel.protections ?? []) {
      if (protection.subPanelId && protection.circuits?.some((c) => c.id === circuitId)) {
        return true
      }
    }
    if (panel.subPanels?.length) {
      stack.push(...panel.subPanels)
    }
  }
  return false
}

/**
 * Next unique label for a domotica output child: base.1, base.2, … (base = parent label, e.g. D1).
 * Uses a single sequence for all children of this parent (control and output wires), so the first
 * control switch is D1.1 and the first output light is D1.2, not both D1.1.
 */
function getNextDomoticaChildLabel(
  circuit: Circuit,
  parent: Endpoint,
  _group: 'endpoint' | 'control',
  outputIndex?: number
): string {
  const base = parent.label?.trim() || `${circuit.code}1`
  let rowLabelIndex = 1
  const scanRows = (ids: string[] | undefined, rowGroup: 'endpoint' | 'control'): string | null => {
    for (let index = 0; index < (ids?.length ?? 0); index++) {
      const id = ids?.[index]
      if (!id) continue
      const label = `${base}.${rowLabelIndex}`
      if (rowGroup === 'endpoint' && index === outputIndex) return label
      rowLabelIndex += 1
    }
    return null
  }
  return (
    scanRows(parent.domoticaProps?.endpointChildEndpointIds, 'endpoint') ??
    `${base}.${rowLabelIndex}`
  )
}

/**
 * Endpoint drop behavior (sockets, lights, static devices, and in-between devices).
 * - Actual endpoints: one per branch, always at the end; a static device may follow a socket.
 * - In-between (switches, relay, domotica, energy_meter): any number, always between trunk and endpoint.
 */
const endpointBehavior: DropBehavior = {
  validTargets: ['endpoint', 'circuit', 'protection', 'supplyConverterDcWire'],
  execute: (target, project, symbol, _t, callbacks) => {
    if (target.type === 'supplyConverterDcWire' && target.panelId) {
      const device = addConverterDcBranchDevice(symbol, target, project, callbacks)
      if (device) callbacks.setSelection({ type: 'trunkDevice', ids: [device.id] })
      return
    }
    if (target.converterDcConnection && !target.dcBusId && target.circuitId) {
      const targetCircuit = callbacks.getCircuitById(target.circuitId)
      const existingBus = targetCircuit
        ? findOrdinaryCircuitDcBusForOutput(targetCircuit, target.converterDcConnection)
        : undefined
      if (existingBus) {
        target = { ...target, dcBusId: existingBus.id, wireDomain: 'DC' }
      } else {
        addEndpointToCircuitConverterDcConnection(target, project, symbol, _t, callbacks)
        return
      }
    }
    let circuitId = target.circuitId
    if (!circuitId && target.type === 'protection' && target.protectionId) {
      const protection = callbacks.getProtectionById(target.protectionId)
      circuitId = protection?.circuits?.[0]?.id
    }
    if (!circuitId) return

    // Circuits that feed a secondary panel are terminal: the MCB output
    // goes exclusively to the sub‑panel, so no extra endpoints may be added.
    if (circuitFeedsSubPanel(project, circuitId)) {
      return
    }

    const circuit = callbacks.getCircuitById(circuitId)
    if (!circuit) return

    if (!target.dcBusId && symbolSupportsWireDomain(symbol.id, 'DC')) {
      const existingBus = findOrdinaryCircuitDcBusForOutput(circuit, target.converterDcConnection)
      if (existingBus) {
        target = { ...target, dcBusId: existingBus.id, wireDomain: 'DC' }
      }
    }
    const dcBusId = target.dcBusId

    if (
      dcBusId &&
      !(circuit.trunkDevices ?? []).some(
        (device) => device.id === dcBusId && device.type === 'dc_bus'
      )
    ) {
      return
    }

    initializeBranchesIfNeeded(circuit)

    const endpointId = generateId()
    const endpointType = getEndpointTypeFromSymbol(symbol)
    if (!endpointType) return
    const symbolKey = getSymbolKeyFromSymbol(symbol)
    const junctionIdentity = isSharedJunctionSymbol(symbol.id)
      ? getNextJunctionIdentity(project, symbol.id)
      : undefined

    const isDomoticaOutputDrop = !!target.domoticaOutput && !!target.endpointId
    const isDomoticaChildReplace =
      target.domoticaChildDropIntent === 'replace' && !!target.endpointId

    const endpoint: Endpoint = {
      id: endpointId,
      type: endpointType,
      label: '',
      symbol: symbolKey,
      placements: [],
      ...(junctionIdentity ? { junctionIdentity } : {}),
      ...(symbol.id === 'terminal_strip'
        ? { terminalStripPin: getTerminalStripCreationProps(project).terminalStripPin }
        : {}),
      ...(symbol.id === 'domotica'
        ? { domoticaProps: { endpointCount: 1, endpointChildEndpointIds: [] } }
        : {}),
    }
    if (isDomoticaOutputDrop) {
      const parent = circuit.endpoints.find((e: Endpoint) => e.id === target.endpointId)
      if (parent) {
        endpoint.label = getNextDomoticaChildLabel(
          circuit,
          parent,
          'endpoint',
          target.domoticaOutput!.index
        )
      }
      endpoint.domoticaChildProps = {
        parentEndpointId: target.endpointId!,
        outputGroup: 'endpoint',
        outputIndex: target.domoticaOutput!.index,
      }
    }

    // HVAC furnace presets: apply default hvacProps based on library preset ID.
    if (symbol.id === 'furnace_heatpump') {
      endpoint.hvacProps = {
        energySource: 'electricity',
        hvacType: 'heat_exchange',
        hvacFunction: 'heat_cool',
      }
    } else if (symbol.id === 'furnace_gas') {
      endpoint.hvacProps = {
        energySource: 'gas_atmospheric',
        hvacType: 'boiler',
        hvacFunction: 'heat',
      }
    } else if (symbol.id === 'furnace_oil') {
      endpoint.hvacProps = {
        energySource: 'liquid',
        hvacType: 'boiler',
        hvacFunction: 'heat',
      }
    } else if (symbol.id === 'furnace_pellets') {
      endpoint.hvacProps = {
        energySource: 'solid',
        hvacType: 'cogeneration',
        hvacFunction: 'heat',
      }
    }

    // DC generation/storage presets (plugIn synced from branch layout in projectStore)
    if (symbol.id === 'solar_panel') {
      endpoint.solarPanelProps = {
        wattageW: 1000,
      }
    } else if (symbol.id === 'battery') {
      endpoint.batteryProps = {
        voltageV: 48,
        capacityKWh: 5,
      }
    }

    applyLibraryPresetToEndpoint(symbol, endpoint)

    const hadAnyEndpointsBeforeAdd = (circuit.endpoints?.length ?? 0) > 0
    const computedInsert = computeEndpointInsertAfter(target, circuit, symbol)
    let { insertAfterEndpointId, createNewBranch } = computedInsert
    const existingDcBusBranch = dcBusId
      ? (circuit.branches ?? []).find(
          (branch) =>
            branch.dcBusId === dcBusId &&
            (branch.id === target.branchId ||
              branch.endpointIds.some((id) => target.branchEndpoints?.includes(id)))
        )
      : undefined
    if (dcBusId) {
      createNewBranch = !existingDcBusBranch
      if (!existingDcBusBranch) insertAfterEndpointId = undefined
    }
    if (circuit.supplySource?.kind === 'converter-backup' && circuit.endpoints.length > 0) {
      insertAfterEndpointId = circuit.endpoints.at(-1)?.id
      createNewBranch = false
    }
    if (shouldDefaultRelayToImpulse(circuit, symbol, insertAfterEndpointId)) {
      endpoint.relayProps = { ...endpoint.relayProps, control: 'impulse' }
    }

    if (!isDomoticaOutputDrop) {
      const chainRef = isDomoticaChildReplace || target.domoticaChildDropIntent === 'insertBefore'
        ? domoticaChildRefForEndpoint(circuit, target.endpointId)
        : domoticaChildRefForBranchInsert(circuit, insertAfterEndpointId, target.branchEndpoints)
      if (chainRef) {
        endpoint.domoticaChildProps = chainRef
        const parent = circuit.endpoints.find((e: Endpoint) => e.id === chainRef.parentEndpointId)
        if (parent) {
          endpoint.label = getNextDomoticaChildLabel(
            circuit,
            parent,
            chainRef.outputGroup,
            chainRef.outputIndex
          )
        }
      }
    }

    // Initialize branches if needed so the layout engine has structure.
    const branches = circuit.branches?.length
      ? circuit.branches
      : initializeBranchesIfNeeded(circuit)

    const downstreamIds = target.branchEndpoints?.slice(
      typeof insertAfterEndpointId === 'string' ? target.branchEndpoints.indexOf(insertAfterEndpointId) + 1 : 0
    )
    if (!createNewBranch && downstreamIds?.length) hideInlineConverterMetadataByDefault(endpoint)

    // Branch point labels are synced after addEndpoint / updateCircuit (sequential A1…n in branch order).
    callbacks.addEndpoint(circuitId, endpoint, insertAfterEndpointId)

    if (target.domoticaChildDropIntent === 'insertBefore') {
      const afterAdd = callbacks.getCircuitById(circuitId)
      if (afterAdd) callbacks.updateCircuit(circuitId, {
        endpoints: updateDomoticaChainHeadAfterInsert(afterAdd, endpointId, target.endpointId),
      })
    }

    if (isDomoticaChildReplace && target.endpointId && target.endpointId !== endpointId) {
      callbacks.deleteEndpoint(target.endpointId)
    }

    // Domotica output drop: insert a new root child at the chosen output row.
    // Existing occupants shift down; chained children stay with their root row.
    if (isDomoticaOutputDrop && target.endpointId) {
      const circuitAfterAdd = callbacks.getCircuitById(circuitId)
      if (circuitAfterAdd) {
        const nextCircuit = insertDomoticaChildEndpoint(
          circuitAfterAdd,
          endpointId,
          target.endpointId,
          'endpoint',
          target.domoticaOutput!.index
        )
        if (nextCircuit) {
          callbacks.updateCircuit(circuitId, {
            endpoints: nextCircuit.endpoints,
            branches: nextCircuit.branches,
          })
        }
      }
    }

    if (isDomoticaChildReplace) {
      // addEndpoint inserted the replacement next to the target; deleteEndpoint removed
      // the old target from endpoints, branches, and parent slot refs.
    } else if (isDomoticaOutputDrop) {
      // Domotica output insertion is fully handled above by insertDomoticaChildEndpoint.
      // Do not run generic branch bookkeeping with stale branch data.
    } else if (createNewBranch) {
      // Create a new branch with this endpoint at the hovered branch position.
      // `addEndpoint()` may already have inserted endpointId into an existing branch,
      // so strip it first and then insert a dedicated branch at the intended slot.
      const circuitAfterAdd = callbacks.getCircuitById(circuitId)
      const branchSource = circuitAfterAdd?.branches?.length ? circuitAfterAdd.branches : branches
      const branchesSansNewEndpoint = branchSource
        .map((b: Branch) => ({
          ...b,
          endpointIds: (b.endpointIds ?? []).filter((id: string) => id !== endpointId),
        }))
        .filter((b: Branch) => (b.endpointIds ?? []).length > 0)

      const branchIndexFromLayout = resolveLayoutBranchIndex(target.branchId, circuitId)
      const branchIndexFromEndpoints =
        target.branchEndpoints && target.branchEndpoints.length > 0
          ? branchesSansNewEndpoint.findIndex((b: Branch) =>
              b.endpointIds.some((id: string) => target.branchEndpoints!.includes(id))
            )
          : -1
      const anchorBranchIndex =
        branchIndexFromLayout !== null
          ? branchIndexFromLayout
          : branchIndexFromEndpoints >= 0
            ? branchIndexFromEndpoints
            : branchesSansNewEndpoint.length - 1
      const dcBusBranchIndexes = dcBusId
        ? branchesSansNewEndpoint.flatMap((branch, index) =>
            branch.dcBusId === dcBusId ? [index] : []
          )
        : []
      const requestedDcBusIndex = clamp(
        target.secondaryBusInsertIndex ?? dcBusBranchIndexes.length,
        0,
        dcBusBranchIndexes.length
      )
      const insertionIndex = dcBusId
        ? requestedDcBusIndex < dcBusBranchIndexes.length
          ? dcBusBranchIndexes[requestedDcBusIndex]!
          : (dcBusBranchIndexes.at(-1) ?? branchesSansNewEndpoint.length - 1) + 1
        : target.insertAfterEndpointId === null
          ? Math.max(0, anchorBranchIndex)
          : Math.max(0, anchorBranchIndex + 1)

      const nextBranches = [...branchesSansNewEndpoint]
      nextBranches.splice(clamp(insertionIndex, 0, nextBranches.length), 0, {
        id: generateId(),
        label: '',
        endpointIds: [endpointId],
        ...(dcBusId ? { dcBusId } : {}),
      })
      callbacks.updateCircuit(circuitId, { branches: nextBranches })
    } else if (
      target.branchEndpoints !== undefined &&
      target.branchEndpoints.length === 0 &&
      isEmptyBranchWireDrop(target, circuitId)
    ) {
      const branchIndex = resolveLayoutBranchIndex(target.branchId, circuitId)
      const storedBranches = branches.length ? branches : initializeBranchesIfNeeded(circuit)
      const targetBranch = branchIndex !== null ? storedBranches[branchIndex] : undefined
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
        const updatedBranches = storedBranches.map((b: Branch) =>
          b.id === targetBranch.id ? { ...b, endpointIds: updatedIds } : b
        )
        callbacks.updateCircuit(circuitId, { branches: updatedBranches })
      }
    } else if (target.branchEndpoints !== undefined && target.branchEndpoints.length > 0) {
      // Adding to an existing branch — find it in stored or inferred branches and update.
      // Always persist branches so multi-branch circuits keep correct assignment
      // (without stored branches, groupEndpointsIntoBranches re-infers linearly
      // and would assign in-between devices to the wrong branch).
      const targetBranch = branches.find((b: Branch) =>
        b.endpointIds.some((id: string) => target.branchEndpoints!.includes(id))
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
          // null or undefined = insert at start of branch
          updatedIds.unshift(endpointId)
        }
        const updatedBranches = branches.map((b: Branch) =>
          b.id === targetBranch.id ? { ...b, endpointIds: updatedIds } : b
        )
        callbacks.updateCircuit(circuitId, { branches: updatedBranches })
      }
    } else if (
      target.branchEndpoints === undefined ||
      (target.branchEndpoints.length === 0 && !isEmptyBranchWireDrop(target, circuitId))
    ) {
      // No branch wire context (trunk / MCB / protection) — create a new branch when needed
      // For the very first endpoint on a fresh circuit, `addEndpoint()` already creates
      // the canonical first branch and label (e.g. P1). Do not run a second naming pass.
      if (!hadAnyEndpointsBeforeAdd) {
        // Keep the branch + label assigned by addEndpoint as the single source of truth.
      } else {
        const circuitAfterAdd = callbacks.getCircuitById(circuitId)
        if (!circuitAfterAdd) {
          callbacks.updateCircuit(circuitId, {
            branches: [
              ...branches,
              { id: generateId(), label: endpoint.label, endpointIds: [endpointId] },
            ],
          })
        } else {
          // `store.addEndpoint()` keeps branch endpointIds in sync while inserting the new
          // endpoint. When this drop is intended to create a *new* branch, we must ensure
          // the new endpoint is not accidentally inserted into an existing branch first
          // (which would reuse the old branch label, e.g. 05 instead of 06).
          const branchesSansNewEndpoint = (circuitAfterAdd.branches ?? [])
            .map((b: Branch) => ({
              ...b,
              endpointIds: (b.endpointIds ?? []).filter((id: string) => id !== endpointId),
            }))
            .filter((b: Branch) => (b.endpointIds ?? []).length > 0)

          callbacks.updateCircuit(circuitId, {
            branches: [
              ...branchesSansNewEndpoint,
              { id: generateId(), label: '', endpointIds: [endpointId] },
            ],
          })
        }
      }
    }

    if (circuit.supplySource?.kind === 'converter-backup') {
      const circuitAfterAdd = callbacks.getCircuitById(circuitId)
      if (circuitAfterAdd) {
        const branch = circuitAfterAdd.branches?.[0] ?? {
          id: generateId(),
          label: '',
          endpointIds: [],
        }
        callbacks.updateCircuit(circuitId, {
          branches: [
            {
              ...branch,
              endpointIds: circuitAfterAdd.endpoints.map((item) => item.id),
            },
          ],
        })
      }
    }

    // Global selection (uiStore): eendraad, sitplan, panel, and inspectors all react to this.
    callbacks.setSelection({ type: 'endpoint', ids: [endpointId] })

    // Auto-place new sitplan symbol when it doesn't yet exist on the plan.
    // Layout rule:
    // - Start from a common origin.
    // - One horizontal row per circuit (grouped by circuit).
    // - New symbol in same circuit goes to the right of existing ones on that row.
    // - New circuit gets a new row "above" the existing rows.
    //
    // Floor + layer: match plan canvas drops (plan uses active floor + layers[0] ?? 'electrical').
    // Do not require floors[0].layers — many floors omit `layers` in data; skipping auto-place
    // left endpoints invisible on every sitplan floor (bug).
    // Do not create placements for one-line-only or explicitly excluded symbols.
    if (!canSymbolAppearOnSituationPlan(symbol.id) || isModularSocketLibraryId(symbol.id)) {
      return
    }

    const currentProject = project
    const activeFloorId = resolveCircuitSitplanTargetFloorId(
      currentProject,
      useUIStore.getState().activeFloorId,
      circuitId
    )

    if (activeFloorId && currentProject) {
      const floorEntity = selectProjectBuildingFloors(currentProject).find(
        (f) => f.id === activeFloorId
      )
      if (!floorEntity) return
      if ('layers' in floorEntity) ensureElectricalLayerOnFloor(floorEntity)
      const uiSnap = useUIStore.getState()
      const preferredPlanPos =
        getViewportCenterPlanSpaceIfApplicable(
          uiSnap.viewportLayout,
          uiSnap.planCanvasViewportPx,
          uiSnap.activeFloorId,
          activeFloorId,
          uiSnap.planView
        ) ?? undefined
      const placement = buildAutoSitplanPlacement(currentProject, {
        circuitId,
        floorId: activeFloorId,
        placementId: generateId(),
        ...(preferredPlanPos ? { preferredPlanPos } : {}),
      })
      if (placement) {
        callbacks.addPlacement(endpointId, placement)
      }
    }
  },
}

/**
 * Switch drop behavior — expands two-way / cross drops on switch-free branches.
 */
const switchBehavior: DropBehavior = {
  validTargets: [
    'endpoint',
    'circuit',
    'protection',
    'supplyBackupWire',
    'supplyBackupOutputWire',
    'supplyConverterDcWire',
  ],
  execute: (target, project, symbol, t, callbacks) => {
    if (target.dcBusId) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }
    if (target.converterDcConnection && target.circuitId) {
      addEndpointToCircuitConverterDcConnection(target, project, symbol, t, callbacks)
      return
    }
    if (target.type === 'supplyBackupWire' || target.type === 'supplyBackupOutputWire') {
      addBackupLaneTrunkDevice(symbol, target, project, callbacks)
      return
    }
    if (target.type === 'supplyConverterDcWire') {
      addConverterDcBranchDevice(symbol, target, project, callbacks)
      return
    }
    if (addCircuitTrunkSwitchAtDrop(symbol, target, project, callbacks)) return
    const expansion = resolveSmartSwitchExpansion(symbol)
    if (!expansion) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }

    let circuitId = target.circuitId
    if (!circuitId && target.type === 'protection' && target.protectionId) {
      const protection = callbacks.getProtectionById(target.protectionId)
      circuitId = protection?.circuits?.[0]?.id
    }
    if (!circuitId) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }

    const circuit = callbacks.getCircuitById(circuitId)
    if (!circuit || !shouldApplySmartSwitchExpansion(target, circuit, symbol)) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }

    let workingTarget = target
    let lastAddedEndpointId: string | undefined
    let primaryEndpointId: string | undefined

    for (let i = 0; i < expansion.symbols.length; i++) {
      const sym = expansion.symbols[i]!
      const trackingCallbacks: DropBehaviorCallbacks = {
        ...callbacks,
        addEndpoint: (cid, endpoint, insertAfter, branchOpts) => {
          lastAddedEndpointId = endpoint.id
          callbacks.addEndpoint(cid, endpoint, insertAfter, branchOpts)
        },
        setSelection: () => {},
      }

      endpointBehavior.execute(workingTarget, project, sym, t, trackingCallbacks)

      if (!lastAddedEndpointId) continue
      if (i === expansion.primaryIndex) {
        primaryEndpointId = lastAddedEndpointId
      }

      const circuitAfter = callbacks.getCircuitById(circuitId)
      if (!circuitAfter) break
      workingTarget = refreshBranchDropTargetAfterInsert(
        circuitAfter,
        workingTarget,
        lastAddedEndpointId
      )
    }

    if (primaryEndpointId) {
      callbacks.setSelection({ type: 'endpoint', ids: [primaryEndpointId] })
    }
  },
}

/** Relays are inline switching devices on both AC and DC supply paths. */
const relayBehavior: DropBehavior = {
  validTargets: [
    ...switchBehavior.validTargets,
    'supplyWire',
    'supplyConverterGridWire',
    'supplyChangeoverGridWire',
  ],
  execute: (target, project, symbol, t, callbacks) => {
    if (
      target.type === 'supplyWire' ||
      target.type === 'supplyConverterGridWire' ||
      target.type === 'supplyChangeoverGridWire'
    ) {
      const device =
        target.type === 'supplyChangeoverGridWire'
          ? addChangeoverGridLaneDevice(symbol, target, project, callbacks)
          : addSupplyTrunkDevice(symbol, target, project, callbacks)
      if (device) callbacks.setSelection({ type: 'trunkDevice', ids: [device.id] })
      return
    }
    switchBehavior.execute(target, project, symbol, t, callbacks)
  },
}

function buildVisibleTrunkSitplanPlacement(
  project: DropBehaviorProject,
  circuitId: string,
  preferredPlanPosOverride?: Point
): Placement | null {
  const activeFloorId = resolveCircuitSitplanTargetFloorId(
    project,
    useUIStore.getState().activeFloorId,
    circuitId
  )
  if (!activeFloorId) return null

  const uiSnap = useUIStore.getState()
  const preferredPlanPos =
    preferredPlanPosOverride ??
    getViewportCenterPlanSpaceIfApplicable(
      uiSnap.viewportLayout,
      uiSnap.planCanvasViewportPx,
      uiSnap.activeFloorId,
      activeFloorId,
      uiSnap.planView
    ) ??
    undefined
  return buildAutoSitplanPlacement(project, {
    circuitId,
    floorId: activeFloorId,
    placementId: generateId(),
    ...(preferredPlanPos ? { preferredPlanPos } : {}),
  })
}

function addEndpointToCircuitConverterDcConnection(
  target: DropTarget,
  project: DropBehaviorProject,
  symbol: SymbolMetadata,
  t: TFunction,
  callbacks: DropBehaviorCallbacks
): boolean {
  const connection = target.converterDcConnection
  if (!connection || !target.circuitId) return false
  const circuit = callbacks.getCircuitById(target.circuitId)
  if (!circuit) return false

  const existingBus = findOrdinaryCircuitDcBusForOutput(circuit, connection)
  if (!target.dcBusId && existingBus) {
    endpointBehavior.execute(
      { ...target, dcBusId: existingBus.id, wireDomain: 'DC' },
      project,
      symbol,
      t,
      callbacks
    )
    return true
  }

  const converter = [
    ...(circuit.trunkDevices ?? []),
    ...(circuit.branches ?? []).flatMap((branch) => branch.branchDevices ?? []),
  ].find((device) => device.id === connection.converterId)
  const owningConverterBranch = circuit.branches?.find((branch) =>
    branch.branchDevices?.some((device) => device.id === connection.converterId)
  )
  const primaryBranch =
    connection.connectionIndex === 0 && converter
      ? (owningConverterBranch ?? getCircuitConverterPrimaryBranch(circuit, converter))
      : undefined
  const primaryIds = new Set(primaryBranch?.endpointIds ?? [])
  const existing = circuit.endpoints.filter(
    (endpoint) =>
      primaryIds.has(endpoint.id) ||
      (endpoint.converterDcConnection?.converterId === connection.converterId &&
        endpoint.converterDcConnection.connectionIndex === connection.connectionIndex)
  )
  const existingIds = new Set(existing.map((endpoint) => endpoint.id))
  const existingBranch =
    primaryBranch ??
    circuit.branches?.find((branch) =>
      branch.endpointIds.some((endpointId) => existingIds.has(endpointId))
    )
  const lastEndpoint = existing.at(-1)
  const requestedInsertAfter =
    target.insertAfterEndpointId && existingIds.has(target.insertAfterEndpointId)
      ? target.insertAfterEndpointId
      : lastEndpoint?.id
  const normalizedTarget: DropTarget = lastEndpoint
    ? {
        type: 'endpoint',
        circuitId: circuit.id,
        endpointId: requestedInsertAfter ?? lastEndpoint.id,
        insertAfterEndpointId: requestedInsertAfter ?? lastEndpoint.id,
        branchId: existingBranch?.id,
        branchEndpoints: existing.map((endpoint) => endpoint.id),
        wireDomain: 'DC',
      }
    : {
        type: 'circuit',
        circuitId: circuit.id,
        branchId: owningConverterBranch?.id,
        dcBusId: owningConverterBranch?.dcBusId,
        branchEndpoints: [],
        wireDomain: 'DC',
      }

  const trackingCallbacks: DropBehaviorCallbacks = {
    ...callbacks,
    addEndpoint: (circuitId, endpoint, insertAfterEndpointId, branchOpts) => {
      callbacks.addEndpoint(
        circuitId,
        { ...endpoint, converterDcConnection: connection },
        insertAfterEndpointId,
        {
          ...branchOpts,
          branchId: existingBranch?.id ?? branchOpts?.branchId,
          forceNewBranch:
            existing.length === 0 && !owningConverterBranch ? true : branchOpts?.forceNewBranch,
          branchInsertIndex:
            existing.length === 0 ? connection.connectionIndex : branchOpts?.branchInsertIndex,
        }
      )
      const updated = callbacks.getCircuitById(circuitId)
      if (updated && (primaryIds.size > 0 || owningConverterBranch?.dcBusId)) {
        callbacks.updateCircuit(circuitId, {
          // Once output zero gains an explicit reference, promote every
          // endpoint on its legacy implicit branch in the same edit.
          endpoints: updated.endpoints.map((candidate) =>
            primaryIds.has(candidate.id) && !candidate.converterDcConnection
              ? { ...candidate, converterDcConnection: connection }
              : candidate
          ),
          // A new string branch below a branch-local converter remains part
          // of the outer DC bus so deleting or moving that bus keeps the
          // complete nested converter topology together.
          branches: owningConverterBranch?.dcBusId
            ? (updated.branches ?? [])
                .map((branch) =>
                  branch.id === owningConverterBranch.id
                    ? {
                        ...branch,
                        endpointIds: branch.endpointIds.includes(endpoint.id)
                          ? branch.endpointIds
                          : [...branch.endpointIds, endpoint.id],
                      }
                    : {
                        ...branch,
                        endpointIds: branch.endpointIds.filter(
                          (endpointId) => endpointId !== endpoint.id
                        ),
                      }
                )
                .filter(
                  (branch) =>
                    branch.endpointIds.length > 0 || (branch.branchDevices?.length ?? 0) > 0
                )
            : updated.branches,
        })
      }
    },
  }
  endpointBehavior.execute(normalizedTarget, project, symbol, t, trackingCallbacks)
  return true
}

/**
 * Energy conversion drop behavior — circuit trunk, source-changeover backup
 * lane, or a direct converter's DC branch.
 */
const energyConversionBehavior: DropBehavior = {
  validTargets: [
    'endpoint',
    'circuit',
    'protection',
    'supplyWire',
    'supplyBackupWire',
    'supplyConverterDcWire',
  ],
  execute: (target, project, symbol, t, callbacks) => {
    const targetCircuit = target.circuitId ? callbacks.getCircuitById(target.circuitId) : null
    if (targetCircuit) target = resolveDomoticaConversionDropTarget(targetCircuit, target)
    if (target.dcBusId) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }
    if (target.converterDcConnection && target.circuitId) {
      if (
        !checkDomainForConversion({ ...target, wireDomain: 'DC' }, project, symbol, t, callbacks)
      ) {
        return
      }
      addEndpointToCircuitConverterDcConnection(target, project, symbol, t, callbacks)
      return
    }
    if (
      target.type === 'supplyWire' &&
      target.panelId &&
      target.supplyFeedScope === 'root' &&
      isConversionSymbol(symbol)
    ) {
      const supplyDevices = getSupplyDevicesForDropTarget(target, project)
      if (
        supplyDevices.some(
          (device) =>
            device.symbol === 'source_changeover' || device.supplyPath === 'converter-branch'
        )
      ) {
        return
      }
      const converter = addSupplyTrunkDevice(symbol, target, project, callbacks, {
        supplyPath: 'converter-branch',
      })
      if (!converter) return
      callbacks.addSupplyAssembly(
        buildDirectConverterSupplyAssembly(project, target.panelId, converter)
      )
      callbacks.setSelection({ type: 'trunkDevice', ids: [converter.id] })
      return
    }

    if (target.type === 'supplyBackupWire' && target.panelId) {
      const supplyDevices = getSupplyDevicesForDropTarget(
        { ...target, type: 'supplyWire', supplyFeedScope: 'root' },
        project
      )
      const changeover = supplyDevices.find((device) => device.symbol === 'source_changeover')
      if (!changeover || supplyDevices.some((device) => device.type === 'conversion')) return

      const converter = addSupplyTrunkDevice(
        symbol,
        {
          ...target,
          supplyFeedScope: 'root',
          supplyDeviceInsertIndex:
            target.supplyDeviceInsertIndex ?? Math.max(0, changeover.trunkPosition + 1),
        },
        project,
        callbacks
      )
      if (!converter) return

      const assembly = attachBackupConverterToAssembly(
        project,
        target.panelId,
        changeover,
        converter
      )
      const existing = findAssemblyForChangeover(project, changeover.id)
      if (existing) callbacks.replaceSupplyAssembly(existing.id, assembly)
      else callbacks.addSupplyAssembly(assembly)
      callbacks.setSelection({ type: 'trunkDevice', ids: [converter.id] })
      return
    }

    // A converter's right/top DC lane is a real serial branch.  Keep the
    // dropped device on that lane so the supply-assembly reconciler can wire
    // it after the existing battery/PV devices instead of treating it as a
    // new AC supply entry point.
    if (target.type === 'supplyConverterDcWire' && target.panelId) {
      if (!checkDomainForConversion(target, project, symbol, t, callbacks)) return
      const device = addConverterDcBranchDevice(symbol, target, project, callbacks)
      if (device) callbacks.setSelection({ type: 'trunkDevice', ids: [device.id] })
      return
    }

    if (!checkDomainForConversion(target, project, symbol, t, callbacks)) return

    if (target.type === 'circuit' && target.circuitId && !target.branchEndpoints?.length) {
      if (circuitFeedsSubPanel(project, target.circuitId)) {
        return
      }
      const circuit = callbacks.getCircuitById(target.circuitId)
      if (!circuit) return
      const trunkPosition = getCircuitTrunkPositionForDrop(target, circuit)
      const deviceId = generateId()
      const trunkDevice: TrunkDevice = {
        id: deviceId,
        type: 'conversion',
        symbol: symbol.id as TrunkDevice['symbol'],
        label: '',
        trunkPosition,
      }
      const placement = buildVisibleTrunkSitplanPlacement(project, target.circuitId)
      if (placement) trunkDevice.placements = [placement]
      addCircuitTrunkDeviceAtDrop(target, circuit, trunkDevice, callbacks)
      callbacks.setSelection({ type: 'trunkDevice', ids: [deviceId] })
      return
    }
    endpointBehavior.execute(target, project, symbol, t, callbacks)
  },
}

/** DC-only endpoint drop behavior (solar panel, battery). */
const dcEndpointBehavior: DropBehavior = {
  validTargets: ['endpoint', 'circuit', 'protection', 'supplyConverterDcWire'],
  execute: (target, project, symbol, t, callbacks) => {
    if (target.endpointId && target.circuitId) {
      const circuit = callbacks.getCircuitById(target.circuitId)
      const targetEndpoint = circuit?.endpoints.find(
        (endpoint) => endpoint.id === target.endpointId
      )
      const owningBranch = circuit?.branches?.find(
        (branch) => branch.dcBusId && branch.endpointIds.includes(target.endpointId!)
      )
      if (
        circuit &&
        owningBranch &&
        (targetEndpoint?.symbol === 'dc_dc_converter' || targetEndpoint?.symbol === 'inverter')
      ) {
        const promoted = promoteDcBusConverterEndpoint(circuit, targetEndpoint.id)
        if (!promoted) return
        callbacks.updateCircuit(circuit.id, {
          endpoints: promoted.endpoints,
          branches: promoted.branches,
        })
        addEndpointToCircuitConverterDcConnection(
          {
            type: 'circuit',
            circuitId: circuit.id,
            branchId: owningBranch.id,
            dcBusId: owningBranch.dcBusId,
            branchEndpoints: [],
            wireDomain: 'DC',
            converterDcConnection: {
              converterId: targetEndpoint.id,
              connectionIndex: 0,
            },
          },
          project,
          symbol,
          t,
          callbacks
        )
        return
      }
    }
    if (target.converterDcConnection && target.circuitId) {
      const circuit = callbacks.getCircuitById(target.circuitId)
      const isNestedDcBusConverter = circuit?.branches?.some((branch) =>
        branch.branchDevices?.some(
          (device) => device.id === target.converterDcConnection?.converterId
        )
      )
      if (
        isNestedDcBusConverter &&
        addEndpointToCircuitConverterDcConnection(target, project, symbol, t, callbacks)
      ) {
        return
      }
    }
    if (target.dcBusId) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }
    if (
      target.converterDcConnection &&
      addEndpointToCircuitConverterDcConnection(target, project, symbol, t, callbacks)
    ) {
      return
    }
    if (target.type === 'supplyConverterDcWire' && target.panelId) {
      const device = addConverterDcBranchDevice(symbol, target, project, callbacks)
      if (device) callbacks.setSelection({ type: 'trunkDevice', ids: [device.id] })
      return
    }

    // Resolve circuit from target or protection (same as endpointBehavior)
    let circuitId = target.circuitId
    if (!circuitId && target.type === 'protection' && target.protectionId) {
      const protection = callbacks.getProtectionById(target.protectionId)
      circuitId = protection?.circuits?.[0]?.id
    }
    if (!circuitId) return

    const circuit = callbacks.getCircuitById(circuitId)
    if (!circuit) return

    const targetProtection =
      target.type === 'protection' && target.protectionId
        ? callbacks.getProtectionById(target.protectionId)
        : target.type === 'circuit' &&
            target.circuitId &&
            !target.branchEndpoints?.length &&
            (target.circuitTrunkSegmentIndex === 0 || target.insertAfterCircuitContent === true)
          ? findProtectionByCircuitIdInProject(projectPanels(project), target.circuitId)
          : null
    if (targetProtection && isEmptyProtectionCircuitForDcDrop(targetProtection)) {
      const inverterMeta = getSymbolById('inverter')
      if (!inverterMeta) return

      const inverterId = generateId()
      const inverter: TrunkDevice = {
        id: inverterId,
        type: 'conversion',
        symbol: 'inverter',
        label: '',
        trunkPosition: 0,
      }
      callbacks.addTrunkDevice(circuitId, inverter)

      let addedEndpointId: string | undefined
      const trackingCallbacks: DropBehaviorCallbacks = {
        ...callbacks,
        addEndpoint: (targetCircuitId, endpoint, insertAfterEndpointId, branchOpts) => {
          addedEndpointId = endpoint.id
          callbacks.addEndpoint(targetCircuitId, endpoint, insertAfterEndpointId, branchOpts)
        },
      }
      endpointBehavior.execute(target, project, symbol, t, trackingCallbacks)

      const updatedCircuit = callbacks.getCircuitById(circuitId)
      const addedEndpoint = updatedCircuit?.endpoints.find(
        (endpoint) => endpoint.id === addedEndpointId
      )
      const endpointPlacement = addedEndpoint?.placements[0]
      const inverterPlacement = buildVisibleTrunkSitplanPlacement(
        project,
        circuitId,
        endpointPlacement
          ? { x: endpointPlacement.pos.x - 80, y: endpointPlacement.pos.y }
          : undefined
      )
      if (updatedCircuit && inverterPlacement) {
        callbacks.updateCircuit(circuitId, {
          trunkDevices: (updatedCircuit.trunkDevices ?? []).map((device) =>
            device.id === inverterId ? { ...device, placements: [inverterPlacement] } : device
          ),
        })
      }
      return
    }

    const wireDomain = getWireDomainAtDropTarget(target, project, callbacks)

    if (wireDomain === 'DC') {
      // Already on a DC wire – behave like a standard endpoint.
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }

    // DC-only sources require an explicit DC-producing component everywhere else.
    const message = t('wires.domainMismatchDrop', {
      defaultValue: '{{component}} requires {{domain}} input, but the wire here is {{wireDomain}}.',
      component: symbol.name,
      domain: 'DC',
      wireDomain,
    })
    callbacks.onDropRejected?.(message)
  },
}

/**
 * Energy meter drop behavior — special dual-mode:
 * - On endpoint/protection targets: acts as in-between device on branches (like a switch)
 * - On circuit targets (vertical trunk wire): adds as a trunk device
 *
 * When dropped on the vertical trunk, the energy meter is placed BEFORE all branches
 * by default (trunkPosition 0). The trunkPosition can be refined based on where on
 * the trunk the cursor was (computed from insertAfterEndpointId).
 */
const energyMeterBehavior: DropBehavior = {
  validTargets: [
    'endpoint',
    'circuit',
    'protection',
    'supplyWire',
    'supplyBackupWire',
    'supplyBackupOutputWire',
    'supplyChangeoverGridWire',
    'supplyConverterGridWire',
    'supplyConverterDcWire',
  ],
  execute: (target, project, symbol, t, callbacks) => {
    if (target.dcBusId) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }
    if (target.converterDcConnection && target.circuitId) {
      addCircuitDcPassiveDevice(target, project, symbol, callbacks)
      return
    }
    if (
      target.type === 'supplyWire' ||
      target.type === 'supplyChangeoverGridWire' ||
      target.type === 'supplyConverterGridWire'
    ) {
      addSupplyTrunkDevice(symbol, target, project, callbacks)
      return
    }
    if (target.type === 'supplyConverterDcWire') {
      addConverterDcBranchDevice(symbol, target, project, callbacks)
      return
    }
    if (target.type === 'supplyBackupWire' || target.type === 'supplyBackupOutputWire') {
      addBackupLaneTrunkDevice(symbol, target, project, callbacks)
      return
    }

    // Circuit trunk targets have no branch context. An empty branch still has
    // branch context and should receive an endpoint rather than a trunk device.
    if (target.type === 'circuit' && target.circuitId && target.branchEndpoints === undefined) {
      if (circuitFeedsSubPanel(project, target.circuitId)) {
        return
      }
      const circuit = callbacks.getCircuitById(target.circuitId)
      if (!circuit) return

      // Compute trunkPosition from explicit circuit trunk segment metadata when available.
      const trunkPosition = getCircuitTrunkPositionForDrop(target, circuit)

      const deviceId = generateId()
      const trunkDevice: TrunkDevice = {
        id: deviceId,
        type: 'energy_meter',
        symbol: 'energy_meter',
        label: `kWh`,
        trunkPosition,
      }

      addCircuitTrunkDeviceAtDrop(target, circuit, trunkDevice, callbacks)
      return
    }

    // Otherwise, use the standard endpoint behavior (in-between device on branch)
    endpointBehavior.execute(target, project, symbol, t, callbacks)
  },
}

/**
 * Panel drop behavior
 */
const panelBehavior: DropBehavior = {
  validTargets: [null, 'mainBus', 'circuit', 'endpoint', 'protection', 'rcd'],
  execute: (target, project, _symbol, t, callbacks) => {
    const panels = projectPanels(project)
    const totalPanelCount = countPanels(panels)
    const panelNumber = totalPanelCount + 1

    const createPanel = (isMain: boolean): Panel => ({
      id: generateId(),
      name:
        totalPanelCount === 0
          ? t('panels.mainPanel', { defaultValue: 'Main Panel' })
          : t('panels.secondaryPanel', {
              number: panelNumber,
              defaultValue: `Panel ${panelNumber}`,
            }),
      symbol: 'panel_distribution',
      isMain,
      protections: [],
      circuits: [],
      subPanels: [],
      ...(!isMain
        ? {
            gridView: {
              rows: DEFAULT_SECONDARY_PANEL_GRID_ROWS,
              columns: DEFAULT_SECONDARY_PANEL_GRID_COLUMNS,
              feedFromTop: false,
              slots: [],
            },
          }
        : {}),
    })

    // If no panels exist, create the first main panel.
    if (panels.length === 0) {
      const newMainPanel = createPanel(true)

      // addPanel already calls ensurePanelPlacement internally and creates
      // a PANEL circuit with the endpoint — no need to duplicate that here.
      callbacks.addPanel(newMainPanel)

      callbacks.setSelection({ type: 'panel', ids: [newMainPanel.id] })
      return
    }

    // A drop outside any panel frame / wire becomes a new root/main panel.
    if (target.type === null && !target.panelId) {
      const newRootPanel = createPanel(true)
      callbacks.addPanel(newRootPanel)
      callbacks.setSelection({ type: 'panel', ids: [newRootPanel.id] })
      return
    }

    // An empty area inside an existing panel frame is still an explicit place
    // to add another parallel/main panel.  Do not silently turn this into a
    // nested secondary panel (or discard the drop); nesting remains reserved
    // for the main-bus/circuit targets below.
    if (target.type === null && target.panelId) {
      const newRootPanel = createPanel(true)
      callbacks.addPanel(newRootPanel)
      callbacks.setSelection({ type: 'panel', ids: [newRootPanel.id] })
      return
    }

    // Determine which panel to nest the new secondary board under, then add feeder MCB/circuit.
    // Use the target panel if available, otherwise fall back to main panel
    let parentPanel: Panel | null = null
    if (target.panelId) {
      parentPanel = findPanelForTarget(project, target)
    }
    if (!parentPanel) {
      parentPanel = panels.find((p) => p.isMain) ?? panels[0] ?? null
    }
    if (!parentPanel) return

    const newPanel = createPanel(false)
    const newPanelId = newPanel.id
    const converterBackupCircuit = target.circuitId
      ? callbacks.getCircuitById(target.circuitId)
      : null
    const isConverterBackupPanel = converterBackupCircuit?.supplySource?.kind === 'converter-backup'

    if (isConverterBackupPanel && converterBackupCircuit?.supplySource) {
      const feederProtection = findProtectionByCircuitIdInProject(panels, converterBackupCircuit.id)
      if (!feederProtection) return

      // This is an existing horizontal backup circuit. Turn its own protection into
      // the panel feeder; never create a second protection on the main bus.
      callbacks.addPanel(newPanel)
      callbacks.updateProtection(feederProtection.id, { subPanelId: newPanelId })

      const panelEndpointId = generateId()
      callbacks.addEndpoint(converterBackupCircuit.id, {
        id: panelEndpointId,
        type: 'fixed_appliance',
        label: newPanel.name,
        symbol: 'panel_distribution',
        panelId: newPanelId,
        placements: [],
      })
      const circuitWithPanel = callbacks.getCircuitById(converterBackupCircuit.id)
      if (circuitWithPanel) {
        const branch = circuitWithPanel.branches?.[0] ?? {
          id: generateId(),
          label: '',
          endpointIds: [],
        }
        callbacks.updateCircuit(converterBackupCircuit.id, {
          branches: [
            {
              ...branch,
              endpointIds: circuitWithPanel.endpoints.map((endpoint) => endpoint.id),
            },
          ],
        })
      }

      const assembly = findAssemblyForDirectConverter(
        project,
        converterBackupCircuit.supplySource.converterId
      )
      if (assembly) {
        callbacks.replaceSupplyAssembly(
          assembly.id,
          retargetDirectConverterBackupPanel(assembly, converterBackupCircuit.id, newPanelId)
        )
      }

      callbacks.setSelection({ type: 'panel', ids: [newPanelId] })
      return
    }

    // Ordinary secondary boards remain structurally nested under their source panel.
    callbacks.addPanel(newPanel, parentPanel.id)

    // Prefer reusing an explicitly targeted empty feeder (protection/circuit)
    // so dropping onto an empty slot does not create an extra feeder circuit.
    let feederProtection: ProtectionDevice | null = null
    if (target.type === 'protection' && target.protectionId) {
      feederProtection = callbacks.getProtectionById(target.protectionId)
    } else if ((target.type === 'circuit' || target.type === 'endpoint') && target.circuitId) {
      feederProtection = findProtectionByCircuitIdInProject(panels, target.circuitId)
    }
    const feederCircuit = feederProtection?.circuits?.[0]
    const canAttachToTargetFeeder =
      !!feederProtection &&
      !!feederCircuit &&
      !feederProtection.subPanelId &&
      typeof target.secondaryBusInsertIndex !== 'number' &&
      target.type !== 'rcd'

    if (canAttachToTargetFeeder && feederProtection) {
      callbacks.updateProtection(feederProtection.id, { subPanelId: newPanelId })
    } else {
      // Create MCB protection on the parent panel that feeds this sub-panel.
      // The MCB's subPanelId links it so the layout engine can render the
      // parent MCB on the sub-panel's supply wire as a mirrored reference.
      const protectionId = generateId()
      const circuitId = generateId()
      const voltagePoles = getVoltagePolesConfig(project)
      const mcbDefaults = getDefaultProtectionProps('MCB', voltagePoles)
      const feederCode = getNextAvailableCircuitCode(project, parentPanel.id)
      const mcbProtection: ProtectionDevice = {
        id: protectionId,
        type: 'MCB',
        label: feederCode,
        circuits: [],
        subPanelId: newPanelId,
        ...mcbDefaults,
      }

      callbacks.addProtection(parentPanel.id, mcbProtection)

      const mcbCircuit: Circuit = {
        id: circuitId,
        code: feederCode,
        kind: 'other',
        cable: createDefaultAcCircuitCable({ sectionMm2: 6 }),
        endpoints: [],
        ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
      }

      callbacks.addCircuit(parentPanel.id, mcbCircuit, protectionId)

      if (target.type === 'rcd' && target.protectionId) {
        callbacks.addCircuitToProtection(parentPanel.id, target.protectionId, mcbCircuit)
        if (typeof target.secondaryBusInsertIndex === 'number') {
          const targetRcd = callbacks.getProtectionById(target.protectionId)
          if (targetRcd?.circuits) {
            const ordered = targetRcd.circuits.filter((circuit) => circuit.id !== mcbCircuit.id)
            ordered.splice(clamp(target.secondaryBusInsertIndex, 0, ordered.length), 0, mcbCircuit)
            callbacks.updateProtection(targetRcd.id, { circuits: ordered })
          }
        }
      } else if (
        target.type === 'circuit' &&
        target.circuitId &&
        typeof target.secondaryBusInsertIndex === 'number'
      ) {
        callbacks.moveCircuitToSecondaryBus(
          parentPanel.id,
          target.circuitId,
          mcbCircuit.id,
          target.secondaryBusInsertIndex
        )
      } else if (target.type === 'mainBus' && typeof target.mainBusInsertIndex === 'number') {
        const beforeCount = target.mainBusItemCount ?? 0
        const desiredIndex = clamp(target.mainBusInsertIndex, 0, beforeCount)
        for (let index = beforeCount; index > desiredIndex; index -= 1) {
          callbacks.moveCircuitOnMainBus(parentPanel.id, mcbCircuit.id, 'left')
        }
      }
    }

    callbacks.setSelection({ type: 'panel', ids: [newPanelId] })
  },
}

/**
 * Ground drop behavior
 */
const groundBehavior: DropBehavior = {
  validTargets: ['mainBus'],
  execute: (target, project, _symbol, _t, callbacks) => {
    const panel = findPanelForTarget(project, target)
    if (!panel) return

    if (panel.isMain === false) {
      const ensureStem =
        callbacks.ensureSecondaryPanelEarthingStem ??
        useProjectStore.getState().ensureSecondaryPanelEarthingStem
      ensureStem(panel.id)
    } else if (projectInstallation(project)) {
      callbacks.updateInstallation({ hasGround: true })
    } else {
      return
    }

    const activeFloorId = resolveSitplanTargetFloorId(project, useUIStore.getState().activeFloorId)
    if (activeFloorId) {
      const uiSnap = useUIStore.getState()
      const preferredPlanPos =
        getViewportCenterPlanSpaceIfApplicable(
          uiSnap.viewportLayout,
          uiSnap.planCanvasViewportPx,
          uiSnap.activeFloorId,
          activeFloorId,
          uiSnap.planView
        ) ?? undefined
      ensureEarthingSitplanPlacement(activeFloorId, preferredPlanPos)
    }
  },
}

/**
 * Earthing separator drop behavior
 */
const earthingSeparatorBehavior: DropBehavior = {
  validTargets: ['groundWire', 'mainBus'],
  execute: (target, project, symbol, _t, callbacks) => {
    const panel = findPanelForTarget(project, target)
    if (!panel) return

    if (panel.isMain === false && target.type === 'mainBus') {
      const ensureStem =
        callbacks.ensureSecondaryPanelEarthingStem ??
        useProjectStore.getState().ensureSecondaryPanelEarthingStem
      ensureStem(panel.id)
      const activeFloorId = resolveSitplanTargetFloorId(project, useUIStore.getState().activeFloorId)
      if (activeFloorId) {
        const uiSnap = useUIStore.getState()
        const preferredPlanPos =
          getViewportCenterPlanSpaceIfApplicable(
            uiSnap.viewportLayout,
            uiSnap.planCanvasViewportPx,
            uiSnap.activeFloorId,
            activeFloorId,
            uiSnap.planView
          ) ?? undefined
        ensureEarthingSitplanPlacement(activeFloorId, preferredPlanPos)
      }
      return
    }

    if (target.type === 'groundWire') {
      addGroundTrunkDevice(symbol, target, project, callbacks)
    }
  },
}

/**
 * Junction box/terminal strip: supply wire, ground wire, circuit trunk, or endpoint branch.
 * Branch-positioned boxes also receive a situation-plan placement. No label.
 */
const junctionBoxBehavior: DropBehavior = {
  validTargets: [
    'supplyWire',
    'supplyBackupWire',
    'supplyBackupOutputWire',
    'supplyConverterDcWire',
    'groundWire',
    'circuit',
    'endpoint',
    'protection',
  ],
  execute: (target, project, symbol, t, callbacks) => {
    if (target.dcBusId) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }
    if (target.converterDcConnection && target.circuitId) {
      addCircuitDcPassiveDevice(target, project, symbol, callbacks)
      return
    }
    const panel = findPanelForTarget(project, target)
    if (target.type === 'supplyWire') {
      addSupplyTrunkDevice(symbol, target, project, callbacks)
      return
    }
    if (target.type === 'supplyConverterDcWire') {
      addConverterDcBranchDevice(symbol, target, project, callbacks)
      return
    }
    if (target.type === 'supplyBackupWire' || target.type === 'supplyBackupOutputWire') {
      addBackupLaneTrunkDevice(symbol, target, project, callbacks)
      return
    }
    if (target.type === 'groundWire') {
      if (!panel?.isMain) return
      addGroundTrunkDevice(symbol, target, project, callbacks)
      return
    }
    // On endpoint or protection (branch): add as in-between device on branch, like energy meter
    if (
      target.type === 'endpoint' ||
      target.type === 'protection' ||
      (target.type === 'circuit' && target.branchEndpoints?.length)
    ) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }
    if (target.type === 'circuit' && target.circuitId && !target.branchEndpoints?.length) {
      if (circuitFeedsSubPanel(project, target.circuitId)) {
        return
      }
      const circuit = callbacks.getCircuitById(target.circuitId)
      if (!circuit) return
      const trunkPosition = getCircuitTrunkPositionForDrop(target, circuit)
      const deviceId = generateId()
      const isTerminalStrip = symbol.id === 'terminal_strip'
      const trunkDevice: TrunkDevice = {
        id: deviceId,
        type: isTerminalStrip ? 'terminal_strip' : 'junction_box',
        symbol: isTerminalStrip ? 'terminal_strip' : 'junction_box',
        ...(isTerminalStrip
          ? getTerminalStripTrunkCreationProps(project)
          : { label: '', junctionIdentity: getNextJunctionIdentity(project, symbol.id) }),
        trunkPosition,
      }
      const activeFloorId = resolveCircuitSitplanTargetFloorId(
        project,
        useUIStore.getState().activeFloorId,
        target.circuitId
      )
      if (activeFloorId) {
        const uiSnap = useUIStore.getState()
        const preferredPlanPos =
          getViewportCenterPlanSpaceIfApplicable(
            uiSnap.viewportLayout,
            uiSnap.planCanvasViewportPx,
            uiSnap.activeFloorId,
            activeFloorId,
            uiSnap.planView
          ) ?? undefined
        const placement = buildAutoSitplanPlacement(project, {
          circuitId: target.circuitId,
          floorId: activeFloorId,
          placementId: generateId(),
          ...(preferredPlanPos ? { preferredPlanPos } : {}),
        })
        if (placement) trunkDevice.placements = [placement]
      }
      addCircuitTrunkDeviceAtDrop(target, circuit, trunkDevice, callbacks)
      callbacks.setSelection({ type: 'trunkDevice', ids: [deviceId] })
    }
  },
}

/**
 * Junction panel: same as junction box but with label; appears on sitplan (one per label).
 * Can be placed on trunks or on endpoint branches (like energy meter).
 */
const junctionPanelBehavior: DropBehavior = {
  validTargets: [
    'supplyWire',
    'supplyBackupWire',
    'supplyBackupOutputWire',
    'supplyConverterDcWire',
    'groundWire',
    'circuit',
    'endpoint',
    'protection',
  ],
  execute: (target, project, symbol, t, callbacks) => {
    if (target.dcBusId) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }
    if (target.converterDcConnection && target.circuitId) {
      addCircuitDcPassiveDevice(target, project, symbol, callbacks)
      return
    }
    const panel = findPanelForTarget(project, target)
    if (target.type === 'supplyWire') {
      addSupplyTrunkDevice(symbol, target, project, callbacks)
      return
    }
    if (target.type === 'supplyConverterDcWire') {
      addConverterDcBranchDevice(symbol, target, project, callbacks)
      return
    }
    if (target.type === 'supplyBackupWire' || target.type === 'supplyBackupOutputWire') {
      addBackupLaneTrunkDevice(symbol, target, project, callbacks)
      return
    }
    if (target.type === 'groundWire') {
      if (!panel?.isMain) return
      addGroundTrunkDevice(symbol, target, project, callbacks)
      return
    }
    // On endpoint or protection (branch): add as in-between device on branch, like energy meter
    if (
      target.type === 'endpoint' ||
      target.type === 'protection' ||
      (target.type === 'circuit' && target.branchEndpoints?.length)
    ) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }
    if (target.type === 'circuit' && target.circuitId && !target.branchEndpoints?.length) {
      if (circuitFeedsSubPanel(project, target.circuitId)) {
        return
      }
      const circuit = callbacks.getCircuitById(target.circuitId)
      if (!circuit) return
      const label = getFirstJunctionPanelLabel(project) ?? 'JP1'
      callbacks.ensureJunctionPanelPlacementForLabel(label)
      const trunkPosition = getCircuitTrunkPositionForDrop(target, circuit)
      const deviceId = generateId()
      const trunkDevice: TrunkDevice = {
        id: deviceId,
        type: 'junction_panel',
        symbol: 'junction_panel',
        label,
        junctionIdentity: getNextJunctionIdentity(project, symbol.id),
        trunkPosition,
      }
      addCircuitTrunkDeviceAtDrop(target, circuit, trunkDevice, callbacks)
    }
  },
}

/**
 * Helper: add an earthing separator to the ground trunk wire (ground symbol → main bus).
 */
function addGroundTrunkDevice(
  symbol: SymbolMetadata,
  target: DropTarget,
  project: DropBehaviorProject,
  callbacks: DropBehaviorCallbacks
): void {
  const deviceId = generateId()
  const insertIndex = target.groundDeviceInsertIndex ?? 0

  if (symbol.id === 'junction_box' || symbol.id === 'terminal_strip') {
    const isTerminalStrip = symbol.id === 'terminal_strip'
    const trunkDevice: TrunkDevice = {
      id: deviceId,
      type: isTerminalStrip ? 'terminal_strip' : 'junction_box',
      symbol: isTerminalStrip ? 'terminal_strip' : 'junction_box',
      ...(isTerminalStrip
        ? getTerminalStripTrunkCreationProps(project)
        : { label: '', junctionIdentity: getNextJunctionIdentity(project, symbol.id) }),
      trunkPosition: insertIndex,
    }
    callbacks.addGroundTrunkDevice(trunkDevice, insertIndex, panelIdForGroundDevice(project, target))
    return
  }
  if (symbol.id === 'junction_panel') {
    const label = getFirstJunctionPanelLabel(project) ?? 'JP1'
    callbacks.ensureJunctionPanelPlacementForLabel(label)
    const trunkDevice: TrunkDevice = {
      id: deviceId,
      type: 'junction_panel',
      symbol: 'junction_panel',
      label,
      trunkPosition: insertIndex,
    }
    callbacks.addGroundTrunkDevice(trunkDevice, insertIndex, panelIdForGroundDevice(project, target))
    return
  }

  const pairId = generateId()
  ;[0, 1].forEach((offset) => {
    callbacks.addGroundTrunkDevice(
      {
        id: offset === 0 ? deviceId : generateId(),
        type: 'earthing_separator',
        symbol: 'earthing_separator',
        label: 'Aardingsonderbreker',
        trunkPosition: insertIndex + offset,
        earthingSeparatorPairId: pairId,
      },
      insertIndex + offset,
      panelIdForGroundDevice(project, target)
    )
  })
}

/** First junction_panel label in the project (supply, ground, or any circuit), for prefilling a second panel. */
function getFirstJunctionPanelLabel(project: DropBehaviorProject): string | undefined {
  const installation = projectInstallation(project)
  const supply = installation?.mainSupply?.supplyTrunkDevices ?? []
  const firstSupply = supply.find((d) => d.type === 'junction_panel')
  if (firstSupply?.label) return firstSupply.label
  const firstGround = collectAllGroundTrunkDevices(projectPanels(project), installation).find(
    (d) => d.type === 'junction_panel'
  )
  if (firstGround?.label) return firstGround.label
  const collectFromPanel = (panels: Panel[]): string | undefined => {
    for (const panel of panels) {
      const circuits = [
        ...(panel.circuits ?? []),
        ...(panel.protections?.flatMap((pr) => pr.circuits ?? []) ?? []),
      ]
      for (const circuit of circuits) {
        const first = circuit.trunkDevices?.find((d) => d.type === 'junction_panel')
        if (first?.label) return first.label
      }
      const fromSub = collectFromPanel(panel.subPanels ?? [])
      if (fromSub) return fromSub
    }
    return undefined
  }
  return collectFromPanel(projectPanels(project))
}

/**
 * Helper: add a device to the supply trunk wire (main panel supply → main bus).
 * Works for junction boxes/panels and protection devices (MCB, RCD, RCBO, FUSE, MAIN_SWITCH, SPD).
 */
function addSupplyTrunkDevice(
  symbol: SymbolMetadata,
  target: DropTarget,
  project: DropBehaviorProject,
  callbacks: DropBehaviorCallbacks,
  options?: {
    supplyPath?: TrunkDevice['supplyPath']
    changeoverGridPlacement?: TrunkDevice['changeoverGridPlacement']
    supplyConverterDcConnectionIndex?: number
    supplyDcBusId?: string
    supplyDcBusBranchId?: string
    converterDcConnection?: TrunkDevice['converterDcConnection']
  }
): TrunkDevice | null {
  const deviceId = generateId()

  // Determine trunk device type and properties based on symbol
  let deviceType: TrunkDeviceType = 'junction_box'
  let protectionType: ProtectionType | undefined
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
    label = getFirstJunctionPanelLabel(project) ?? 'JP1'
    callbacks.ensureJunctionPanelPlacementForLabel(label)
  } else if (symbol.id === 'source_changeover') {
    deviceType = 'changeover'
    label = ''
  } else if (['transformer', 'rectifier', 'inverter', 'dc_dc_converter'].includes(symbol.id)) {
    deviceType = 'conversion'
    label = ''
  } else if (symbol.id === 'battery') {
    deviceType = 'storage'
    label = ''
  } else if (symbol.id === 'solar_panel') {
    deviceType = 'generation'
    label = ''
  } else if (symbol.id === 'dc_bus') {
    deviceType = 'dc_bus'
    label = 'DC'
  } else if (symbol.id === 'domotica') {
    deviceType = 'domotica'
    label = ''
  } else if (PROTECTION_SYMBOL_IDS.includes(symbol.id as (typeof PROTECTION_SYMBOL_IDS)[number])) {
    deviceType = 'protection'
    protectionType = PROTECTION_SYMBOL_ID_TO_TYPE[symbol.id] ?? 'OTHER'
    label = ''
  } else if (isSupplyDcSwitchSymbol(symbol.id)) {
    deviceType = 'protection'
    label = ''
  }

  const insertIndex = target.supplyDeviceInsertIndex
  const voltagePoles = getVoltagePolesConfig(project)
  const converterAcPhaseAssignment =
    deviceType === 'conversion'
      ? getDefaultSupplyConverterAcPhaseAssignment(
          project.disciplines?.electrical?.installation?.nominalVoltage.system ?? '1N~'
        )
      : undefined
  const trunkDevice: TrunkDevice = {
    id: deviceId,
    type: deviceType,
    symbol: symbol.id as TrunkDevice['symbol'],
    label,
    ...(symbol.id === 'terminal_strip'
      ? getTerminalStripTrunkConnectionProps(project)
      : isSharedJunctionSymbol(symbol.id)
        ? { junctionIdentity: getNextJunctionIdentity(project, symbol.id) }
        : {}),
    trunkPosition: insertIndex ?? 0,
    ...(options?.supplyPath
      ? {
          supplyPath: options.supplyPath,
          ...(options.supplyPath === 'changeover-grid' && options.changeoverGridPlacement
            ? { changeoverGridPlacement: options.changeoverGridPlacement }
            : {}),
        }
      : target.type === 'supplyBackupWire'
        ? { supplyPath: 'backup' as const }
        : target.type === 'supplyBackupOutputWire'
          ? { supplyPath: 'backup-output' as const }
          : target.type === 'supplyConverterGridWire'
            ? {
                supplyPath: 'converter-grid' as const,
                ...(target.converterGridPlacement
                  ? { converterGridPlacement: target.converterGridPlacement }
                  : {}),
              }
            : target.type === 'supplyChangeoverGridWire'
              ? {
                  supplyPath: 'changeover-grid' as const,
                  ...(target.changeoverGridPlacement
                    ? { changeoverGridPlacement: target.changeoverGridPlacement }
                    : {}),
                }
              : {}),
    ...(typeof options?.supplyConverterDcConnectionIndex === 'number'
      ? { supplyConverterDcConnectionIndex: options.supplyConverterDcConnectionIndex }
      : {}),
    ...(options?.supplyDcBusId ? { supplyDcBusId: options.supplyDcBusId } : {}),
    ...(options?.supplyDcBusBranchId ? { supplyDcBusBranchId: options.supplyDcBusBranchId } : {}),
    ...(options?.converterDcConnection
      ? { converterDcConnection: options.converterDcConnection }
      : {}),
    ...(symbol.id === 'battery' ? { batteryProps: { voltageV: 48, capacityKWh: 5 } } : {}),
    ...(symbol.id === 'solar_panel' ? { solarPanelProps: { wattageW: 1000 } } : {}),
    ...(symbol.id === 'dc_bus' ? { dcBusProps: {} } : {}),
    ...(symbol.id === 'domotica'
      ? { domoticaProps: { endpointCount: 1, endpointChildEndpointIds: [] } }
      : {}),
    ...(converterAcPhaseAssignment
      ? { conversionProps: { acPhaseAssignment: converterAcPhaseAssignment } }
      : {}),
    ...(symbol.id === 'source_changeover'
      ? { changeoverProps: { port1Label: '1', port2Label: '2' } }
      : {}),
    ...(protectionType ? { protectionType } : {}),
    ...(protectionType ? getDefaultTrunkDeviceProtectionProps(protectionType, voltagePoles) : {}),
    ...(!protectionType && isSupplyDcSwitchSymbol(symbol.id)
      ? getDefaultTrunkDeviceProtectionProps('OTHER', voltagePoles)
      : {}),
  }
  const targetPanel = target.panelId ? findPanelById(projectPanels(project), target.panelId) : null
  const panelSupplyCircuit = targetPanel?.circuits?.find((c) => c.code === 'PANEL')

  const needsPhysicalPlanPlacement =
    deviceType === 'relay' ||
    protectionType === 'ROTATING_SWITCH' ||
    isSupplyDcSwitchSymbol(symbol.id) ||
    deviceType === 'conversion' ||
    deviceType === 'storage' ||
    deviceType === 'generation' ||
    deviceType === 'energy_meter'
  if (needsPhysicalPlanPlacement) {
    const activeFloorId = resolveSitplanTargetFloorId(project, useUIStore.getState().activeFloorId)
    if (activeFloorId) {
      const uiSnap = useUIStore.getState()
      const preferredPlanPos =
        getViewportCenterPlanSpaceIfApplicable(
          uiSnap.viewportLayout,
          uiSnap.planCanvasViewportPx,
          uiSnap.activeFloorId,
          activeFloorId,
          uiSnap.planView
        ) ?? undefined
      const placement = buildAutoSitplanPlacement(project, {
        circuitId: panelSupplyCircuit?.id ?? `panel-supply:${target.panelId ?? 'main'}`,
        floorId: activeFloorId,
        placementId: generateId(),
        ...(preferredPlanPos ? { preferredPlanPos } : {}),
      })
      if (placement) {
        trunkDevice.placements = [placement]
        if (deviceType === 'energy_meter') {
          const floor = callbacks.getFloorById(activeFloorId)
          const hiddenPlacementIds = floor?.hiddenSitplanPlacementIds ?? []
          callbacks.updateFloor(activeFloorId, {
            hiddenSitplanPlacementIds: hiddenPlacementIds.includes(placement.id)
              ? hiddenPlacementIds
              : [...hiddenPlacementIds, placement.id],
          })
        }
      }
    }
  }

  if (targetPanel && !targetPanel.isMain && panelSupplyCircuit) {
    // Sub-panel incoming wire allows only one local protection device.
    if (deviceType === 'protection') {
      const hasProtectionAlready = (panelSupplyCircuit.trunkDevices ?? []).some(
        (d) => d.type === 'protection'
      )
      if (hasProtectionAlready) return null
    }
    callbacks.addTrunkDevice(panelSupplyCircuit.id, trunkDevice)
    const updatedPanelCircuit = callbacks.getCircuitById(panelSupplyCircuit.id)
    if (updatedPanelCircuit?.trunkDevices) {
      const list = updatedPanelCircuit.trunkDevices.map((d: TrunkDevice) => ({ ...d }))
      const currentIdx = list.findIndex((d: TrunkDevice) => d.id === trunkDevice.id)
      if (currentIdx !== -1) {
        list.splice(currentIdx, 1)
        const idx = clamp(insertIndex ?? list.length, 0, list.length)
        // Important: do NOT re-insert the original `trunkDevice` object reference,
        // because after `addTrunkDevice` it may be frozen by store immutability.
        list.splice(idx, 0, { ...trunkDevice })
        const reindexed = list.map((d: TrunkDevice, i: number) => ({ ...d, trunkPosition: i }))
        callbacks.updateCircuit(panelSupplyCircuit.id, { trunkDevices: reindexed })
      }
    }
    return trunkDevice
  }

  callbacks.addSupplyTrunkDevice(trunkDevice, insertIndex, {
    panelId: target.panelId,
    feedScope: target.supplyFeedScope,
    diagramId: target.diagramId,
    supplyPanelInput: target.supplyPanelInput,
    busSectionId: target.busSectionId,
  })
  return trunkDevice
}

/** Free-floating note on the wire canvas (same data as context menu “Add note”). */
const noteBehavior: DropBehavior = {
  validTargets: [null],
  execute: (_target, _project, _symbol, _t, callbacks) => {
    const pos = callbacks.dropCanvasPosition ?? { x: 0, y: 0 }
    const noteId = `note-${Date.now()}`
    callbacks.addEendraadNote({
      id: noteId,
      text: 'New note',
      fontSize: 14,
      pos,
      panelId: undefined,
    })
    callbacks.setSelection({ type: 'note', ids: [noteId] })
    trackGoogleAnalyticsEvent('note_place', {
      canvas: 'eendraad',
      source: 'symbol_drop',
    })
  },
}

/** The source selector is a slotted supply-path device, never a free canvas symbol. */
const sourceChangeoverBehavior: DropBehavior = {
  validTargets: ['supplyWire', 'supplyConverterBackupWire'],
  execute: (target, project, symbol, _t, callbacks) => {
    if (target.supplyFeedScope !== 'root') return
    const supplyDevices = getSupplyDevicesForDropTarget(target, project)
    if (supplyDevices.some((device) => device.symbol === 'source_changeover')) return
    const directConverter = supplyDevices.find((device) => device.supplyPath === 'converter-branch')
    if (!directConverter) {
      addSupplyTrunkDevice(symbol, target, project, callbacks)
      return
    }
    const targetPanel = target.panelId
      ? findPanelById(project.disciplines?.electrical?.panels ?? [], target.panelId)
      : undefined
    const acceptsAnyGridFeedSegment = Boolean(
      targetPanel && getPanelFeedOrganization(project, targetPanel) === 'split-backup'
    )
    const deviceAtRequestedSlot = supplyDevices.find(
      (device) => device.trunkPosition === target.supplyDeviceInsertIndex
    )
    if (
      !acceptsAnyGridFeedSegment &&
      (deviceAtRequestedSlot?.supplyPath === 'converter-dc' ||
        deviceAtRequestedSlot?.supplyPath === 'converter-dc-top') &&
      !target.supplyConverterChangeoverSlot
    )
      return
    const normalizedInsertIndex = resolveDirectConverterChangeoverInsertIndex(
      supplyDevices,
      target.supplyDeviceInsertIndex,
      acceptsAnyGridFeedSegment
    )
    const converterOutputChain = getDirectConverterOutputChainForChangeover(
      supplyDevices,
      normalizedInsertIndex ?? undefined
    )
    if (!converterOutputChain || !target.panelId || !callbacks.updateSupplyTrunkDevice) return

    const directBackup = findDirectConverterBackupProtection(
      project,
      target.panelId,
      directConverter.id
    )
    // A terminal load cannot be represented by the switched supply branch without changing
    // ownership. Keep the existing standalone topology intact instead of partially upgrading it.
    if (directBackup?.circuit.endpoints.length) return
    if (directBackup && !callbacks.deleteProtection) return

    const directAssembly = findAssemblyForDirectConverter(project, directConverter.id)
    const changeover = addSupplyTrunkDevice(
      symbol,
      { ...target, supplyDeviceInsertIndex: normalizedInsertIndex ?? undefined },
      project,
      callbacks
    )
    if (!changeover) return
    callbacks.updateSupplyTrunkDevice(directConverter.id, { supplyPath: 'backup' })
    const migratedOutputDevices = acceptsAnyGridFeedSegment
      ? []
      : converterOutputChain.map((device) => ({
          ...device,
          supplyPath: 'backup-output' as const,
        }))
    const migratedGridDevices = acceptsAnyGridFeedSegment
      ? converterOutputChain.map((device) => ({
          ...device,
          supplyPath: 'changeover-grid' as const,
        }))
      : []
    migratedOutputDevices.forEach((device) => {
      callbacks.updateSupplyTrunkDevice!(device.id, { supplyPath: 'backup-output' })
    })
    migratedGridDevices.forEach((device) => {
      callbacks.updateSupplyTrunkDevice!(device.id, { supplyPath: 'changeover-grid' })
    })
    const migratedBackupDevices = directBackup
      ? directConverterBackupInlineDevicesToTrunkDevices(directBackup)
      : []
    if (directBackup) {
      callbacks.deleteProtection?.(directBackup.protection.id)
      migratedBackupDevices.forEach((device) => {
        callbacks.addSupplyTrunkDevice(device, undefined, {
          panelId: target.panelId,
          feedScope: 'root',
        })
      })
    }
    const upgraded = upgradeDirectConverterToChangeoverAssembly(
      project,
      target.panelId,
      changeover,
      directConverter,
      migratedOutputDevices.length > 0 || migratedBackupDevices.length > 0
        ? [
            ...supplyDevices.filter((device) => device.supplyPath === 'backup-output'),
            ...migratedOutputDevices,
            ...migratedBackupDevices,
          ]
        : undefined,
      migratedGridDevices.length > 0 ? migratedGridDevices : undefined
    )
    if (directAssembly) callbacks.replaceSupplyAssembly(directAssembly.id, upgraded)
    else callbacks.addSupplyAssembly(upgraded)
    callbacks.setSelection({ type: 'trunkDevice', ids: [changeover.id] })
  },
}

/**
 * Drop behaviors registry
 */
export const dropBehaviors: Record<string, DropBehavior> = {
  mcb: protectionBehavior,
  rcd: rcdBehavior,
  rcbo: rcdBehavior,
  fuse: protectionBehavior, // Fuse uses generic protection behavior
  main_switch: protectionBehavior, // Main switch uses generic protection behavior
  spd: protectionBehavior, // SPD uses generic protection behavior
  rotating_switch: protectionBehavior,
  source_changeover: sourceChangeoverBehavior,
  socket: endpointBehavior,
  socket_gnd: endpointBehavior,
  socket_child: endpointBehavior,
  socket_gnd_child: endpointBehavior,
  double_socket_child: endpointBehavior,
  double_socket_gnd_child: endpointBehavior,
  modular_socket: endpointBehavior,
  light_point: endpointBehavior,
  light_spot: endpointBehavior,
  light_led: endpointBehavior,
  light_fluorescent: endpointBehavior,
  fixed_appliance_generic: endpointBehavior,
  oven: endpointBehavior,
  washer: endpointBehavior,
  dryer: endpointBehavior,
  dishwasher: endpointBehavior,
  boiler: endpointBehavior,
  ev: endpointBehavior,
  freezer: endpointBehavior,
  fridge: endpointBehavior,
  microwave: endpointBehavior,
  motor: endpointBehavior,
  stove: endpointBehavior,
  furnace: endpointBehavior,
  furnace_heatpump: endpointBehavior,
  furnace_gas: endpointBehavior,
  furnace_oil: endpointBehavior,
  furnace_pellets: endpointBehavior,
  heating: endpointBehavior,
  ventilation: endpointBehavior,
  door_lock: endpointBehavior,
  buzzer: endpointBehavior,
  bell: endpointBehavior,
  horn: endpointBehavior,
  siren: endpointBehavior,
  switch: switchBehavior,
  switch_1p_twoway: switchBehavior,
  switch_2p_twoway: switchBehavior,
  switch_dimmer: switchBehavior,
  switch_1p_changeover: switchBehavior,
  switch_1p_pull: switchBehavior,
  contact: switchBehavior,
  switch_impulse: switchBehavior,
  switch_cross: switchBehavior,
  motion_detector: switchBehavior,
  smoke_detector: switchBehavior,
  relay: relayBehavior,
  switch_single: switchBehavior,
  switch_double: switchBehavior,
  domotica: endpointBehavior,
  energy_meter: energyMeterBehavior,
  transformer: energyConversionBehavior,
  rectifier: energyConversionBehavior,
  inverter: energyConversionBehavior,
  dc_dc_converter: energyConversionBehavior,
  solar_panel: dcEndpointBehavior,
  battery: dcEndpointBehavior,
  dc_bus: dcBusBehavior,
  panel_distribution: panelBehavior,
  earthing: groundBehavior,
  earthing_separator: earthingSeparatorBehavior,
  junction_box: junctionBoxBehavior,
  terminal_strip: junctionBoxBehavior,
  junction_panel: junctionPanelBehavior,
  note: noteBehavior,
}

/** Whether a symbol can be dropped on blank one-wire canvas (outside any panel or wire). */
export function canDropSymbolOnEmptyCanvas(symbolId: string): boolean {
  return dropBehaviors[symbolId]?.validTargets.includes(null) ?? false
}

/**
 * Keep existing supply-device moves on the same DC-rail permission surface as
 * library drops. A direct converter-to-bus lead is an inline-device lane, not a
 * second converter/device branch: only protections, junction boxes, terminal
 * strips, energy meters, and direct solar sources may be inserted before the
 * DC bus. Batteries are terminal DC devices and are valid on this lead as
 * well; the full symbol registry is available once a real bus branch is
 * targeted.
 */
export function canDropSymbolOnSupplyConverterDcWire(
  symbolId: string,
  hasDcBusBranch: boolean
): boolean {
  const behavior = dropBehaviors[symbolId]
  if (!behavior?.validTargets.includes('supplyConverterDcWire')) return false

  const isProtectionSymbol = PROTECTION_SYMBOL_IDS.includes(
    symbolId as (typeof PROTECTION_SYMBOL_IDS)[number]
  )
  if (!hasDcBusBranch) {
    return (
      isProtectionSymbol ||
      [
        'battery',
        'dc_bus',
        'junction_box',
        'terminal_strip',
        'energy_meter',
        'relay',
        'solar_panel',
      ].includes(symbolId)
    )
  }
  return true
}

/**
 * Execute drop behavior for a symbol
 */
export function executeDropBehavior(
  symbol: SymbolMetadata,
  target: DropTarget,
  project: DropBehaviorProject,
  t: TFunction,
  callbacks: DropBehaviorCallbacks,
  analytics:
    | false
    | {
        canvas: EditorCanvasAnalytics
        placementMethod: SymbolPlacementMethod
      } = { canvas: 'eendraad', placementMethod: 'library_drop' }
): void {
  const isProtectionSymbol = PROTECTION_SYMBOL_IDS.includes(
    symbol.id as (typeof PROTECTION_SYMBOL_IDS)[number]
  )
  if (
    target.type === 'supplyConverterDcWire' &&
    !target.supplyDcBusId &&
    !canDropSymbolOnSupplyConverterDcWire(symbol.id, false)
  ) {
    logger.warn(
      `[drop-diag] Direct converter DC lead only accepts inline devices: symbol=${symbol.id}`
    )
    return
  }
  const isDirectConverterDcTarget =
    target.converterDcConnection != null &&
    !target.dcBusId &&
    target.type !== 'supplyConverterDcWire'
  if (isProtectionSymbol && isDirectConverterDcTarget) {
    logger.warn(
      `[drop-diag] Protection requires a DC bus branch: symbol=${symbol.id}, targetType=${target.type}`
    )
    return
  }
  if (target.converterDcConnection && !symbolSupportsWireDomain(symbol.id, 'DC')) {
    const requiredPorts = getPortDomainsForSymbol(symbol.id)
    const message = t('wires.domainMismatchDrop', {
      defaultValue:
        '{{component}} has no {{wireDomain}} compatible port (ports: {{portA}} / {{portB}}).',
      component: symbol.name,
      domain: requiredPorts[0],
      wireDomain: 'DC',
      portA: requiredPorts[0],
      portB: requiredPorts[1],
    })
    callbacks.onDropRejected?.(message)
    return
  }
  if (
    target.converterDcConnection &&
    !target.dcBusId &&
    target.type !== 'supplyConverterDcWire' &&
    symbol.id === 'domotica'
  ) {
    addEndpointToCircuitConverterDcConnection(target, project, symbol, t, callbacks)
    if (analytics) {
      trackSymbolPlace({
        ...analytics,
        symbol,
        targetType: target.type ?? 'empty',
      })
    }
    return
  }

  if (!canCreateSupplyTopologyFromDrop(symbol, target.type)) {
    logger.warn(
      `[drop-diag] Blocked by supply topology gate: symbol=${symbol.id}, targetType=${target.type}`
    )
    return
  }

  const behavior = dropBehaviors[symbol.id]
  if (!behavior) {
    logger.warn(`[drop-diag] No drop behavior registered for symbol: ${symbol.id}`)
    return
  }

  if (!behavior.validTargets.includes(target.type)) {
    logger.warn(
      `[drop-diag] Invalid drop target "${target.type}" for symbol "${symbol.id}". Valid: ${behavior.validTargets.join(', ')}`
    )
    return
  }

  behavior.execute(target, project, symbol, t, callbacks)
  if (analytics) {
    trackSymbolPlace({
      ...analytics,
      symbol,
      targetType: target.type ?? 'empty',
    })
  }
}

/** Find protection by id in project (searches all panels and subPanels) */
function findProtectionInProject(panels: Panel[], id: string): ProtectionDevice | null {
  for (const p of panels) {
    const pr = p.protections?.find((pr) => pr.id === id)
    if (pr) return pr
    const found = findProtectionInProject(p.subPanels || [], id)
    if (found) return found
  }
  return null
}

/**
 * Helper to find panel for a drop target
 */
function findPanelForTarget(project: DropBehaviorProject, target: DropTarget): Panel | null {
  const panels = projectPanels(project)
  if (target.panelId) {
    return findPanelById(panels, target.panelId) ?? null
  }
  return panels.find((p) => p.isMain) || panels[0] || null
}

function panelIdForGroundDevice(project: DropBehaviorProject, target: DropTarget): string | undefined {
  const panel = findPanelForTarget(project, target)
  return panel?.isMain === false ? panel.id : undefined
}

function findProtectionByCircuitIdInProject(
  panels: Panel[],
  circuitId: string
): ProtectionDevice | null {
  for (const panel of panels) {
    for (const protection of panel.protections ?? []) {
      if (protection.circuits?.some((c) => c.id === circuitId)) {
        return protection
      }
    }
    const inSubPanels = findProtectionByCircuitIdInProject(panel.subPanels ?? [], circuitId)
    if (inSubPanels) return inSubPanels
  }
  return null
}
