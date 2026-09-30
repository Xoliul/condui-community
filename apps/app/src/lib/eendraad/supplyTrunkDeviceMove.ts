import { clamp } from '@/lib/geometry'
import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import { canDropSymbolOnSupplyConverterDcWire } from '@/handlers/eendraad/dropBehaviors'
import { generateId } from '@/utils'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { Circuit, Endpoint, Panel, TrunkDevice, WireSegment } from '@/types/schema'
import type { Point } from '@/types/ui'
import type { ElectricalEnclosureRef } from '@/types/supplyAssembly'
import type { BottomUpPanelLayout } from '@/lib/layout/bottomUpLayout'
import { getPanelDiagramId } from '@/lib/layout/bottomUpLayout'
import { getSupplyEnclosureBoundaryCenter } from '@/lib/layout/supplyEnclosureBoundaryGeometry'
import {
  getSupplyConverterDcConnectionIndex,
  getSupplyConverterDcPath,
} from '@/lib/supplyAssembly/converterDcConnections'
import {
  moveSupplyDeviceToEnclosureAutomatically,
  resolveSupplyDeviceMounting,
} from '@/lib/panel/auxiliarySupplyEnclosures'
import { findCircuitById, removeEndpointIdsFromCircuit } from '@/lib/eendraad/projectElectricalDomain'
import { PROTECTION_SYMBOL_IDS } from '@/lib/protectionKind'
import type { TrunkDeviceType } from '@/types/schema'

const SUPPLY_PROTECTION_TARGETS = new Set<DropTarget['type']>([
  'supplyWire',
  'supplyBackupWire',
  'supplyBackupOutputWire',
  'supplyChangeoverGridWire',
  'supplyConverterGridWire',
  'supplyConverterDcWire',
])

const SUPPLY_METER_TARGETS = SUPPLY_PROTECTION_TARGETS

export interface SupplyTrunkDeviceMoveResult {
  device: TrunkDevice
  sourcePanelId?: string
  targetPanelId?: string
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

function supplyTrunkDeviceTypeForEndpoint(endpoint: Endpoint): TrunkDeviceType {
  if (endpoint.symbol === 'relay') return 'relay'
  if (endpoint.symbol === 'energy_meter') return 'energy_meter'
  if (endpoint.symbol === 'junction_box') return 'junction_box'
  if (endpoint.symbol === 'terminal_strip') return 'terminal_strip'
  if (endpoint.symbol === 'junction_panel') return 'junction_panel'
  if (endpoint.symbol === 'dc_bus') return 'dc_bus'
  if (endpoint.symbol === 'domotica') return 'domotica'
  if (endpoint.symbol === 'battery') return 'storage'
  if (endpoint.symbol === 'solar_panel') return 'generation'
  if (
    endpoint.symbol &&
    (PROTECTION_SYMBOL_IDS.includes(endpoint.symbol as (typeof PROTECTION_SYMBOL_IDS)[number]) ||
      SUPPLY_DC_SWITCH_SYMBOL_IDS.has(endpoint.symbol))
  ) {
    return 'protection'
  }
  if (
    endpoint.symbol === 'transformer' ||
    endpoint.symbol === 'rectifier' ||
    endpoint.symbol === 'inverter' ||
    endpoint.symbol === 'dc_dc_converter'
  ) {
    return 'conversion'
  }
  return 'junction_box'
}

function convertEndpointToSupplyTrunkDevice(
  endpoint: Endpoint,
  trunkPosition: number
): TrunkDevice {
  const type = supplyTrunkDeviceTypeForEndpoint(endpoint)
  return {
    id: endpoint.id,
    type,
    symbol: endpoint.symbol as TrunkDevice['symbol'],
    label: endpoint.label,
    trunkPosition,
    ...(endpoint.placements ? { placements: endpoint.placements } : {}),
    ...(endpoint.notes !== undefined ? { notes: endpoint.notes } : {}),
    ...(endpoint.labelNotes !== undefined ? { labelNotes: endpoint.labelNotes } : {}),
    ...(endpoint.panelLabel ? { panelLabel: endpoint.panelLabel } : {}),
    ...(endpoint.energyMeterProps ? { energyMeterProps: endpoint.energyMeterProps } : {}),
    ...(endpoint.relayProps ? { relayProps: endpoint.relayProps } : {}),
    ...(endpoint.batteryProps ? { batteryProps: endpoint.batteryProps } : {}),
    ...(endpoint.solarPanelProps ? { solarPanelProps: endpoint.solarPanelProps } : {}),
    ...(endpoint.domoticaProps ? { domoticaProps: endpoint.domoticaProps } : {}),
    ...(endpoint.energyConversionProps
      ? { conversionProps: endpoint.energyConversionProps }
      : {}),
    ...(endpoint.installationDate !== undefined
      ? { installationDate: endpoint.installationDate }
      : {}),
    ...(endpoint.installationDateSuppressed !== undefined
      ? { installationDateSuppressed: endpoint.installationDateSuppressed }
      : {}),
    ...(endpoint.rulesetDateOverride !== undefined
      ? { rulesetDateOverride: endpoint.rulesetDateOverride }
      : {}),
    ...(endpoint.symbolLabelDisplay ? { symbolLabelDisplay: endpoint.symbolLabelDisplay } : {}),
  }
}

function getSupplyTargetDevices(
  project: ProjectWithOptionalV2Electrical,
  target: DropTarget
): TrunkDevice[] | null {
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return null
  const panels = getProjectElectricalPanels(project)
  const scope = target.supplyFeedScope ?? 'shared'
  if (scope === 'shared') {
    return (installation.mainSupply.supplyTrunkDevices ??=
      [])
  }
  if (!target.panelId) return null
  const topology = ensureInstallationFeedTopology(installation, panels)
  const rootFeed = topology.rootFeeds.find((feed) => feed.panelId === target.panelId)
  if (!rootFeed) return null
  return (rootFeed.trunkDevices ??= [])
}

function applySupplyDcTarget(
  device: TrunkDevice,
  target: DropTarget,
  trunkPosition: number
): void {
  const connectionIndex =
    target.supplyConverterDcConnectionIndex ?? (target.supplyConverterDcBranch === 'top' ? 1 : 0)
  device.trunkPosition = trunkPosition
  device.supplyPath = getSupplyConverterDcPath(connectionIndex)
  device.supplyConverterDcConnectionIndex = connectionIndex
  delete device.converterDcConnection
  if (target.supplyDcBusId) {
    device.supplyDcBusId = target.supplyDcBusId
    device.supplyDcBusBranchId = target.supplyDcBusBranchId ?? generateId()
  } else {
    delete device.supplyDcBusId
    delete device.supplyDcBusBranchId
  }
}

function findCircuitOwner(
  project: ProjectWithOptionalV2Electrical,
  circuitId: string
): { panel: Panel; circuit: Circuit } | null {
  for (const panel of getProjectElectricalPanels(project)) {
    const result = findCircuitById(panel, circuitId)
    if (result) return { panel, circuit: result.circuit }
  }
  return null
}

export function moveCircuitTrunkDeviceToSupplyDcBus(
  project: ProjectWithOptionalV2Electrical,
  deviceId: string,
  sourceCircuitId: string,
  target: DropTarget
): SupplyTrunkDeviceMoveResult | null {
  if (target.type !== 'supplyConverterDcWire') return null
  const owner = findCircuitOwner(project, sourceCircuitId)
  const sourceDevices = owner?.circuit.trunkDevices
  const sourceIndex = sourceDevices?.findIndex((device) => device.id === deviceId) ?? -1
  const device = sourceIndex >= 0 ? sourceDevices?.[sourceIndex] : undefined
  if (!owner || !sourceDevices || !device) return null
  if (
    device.type === 'dc_bus' &&
    (target.supplyConverterDcConnectionIndex ??
      (target.supplyConverterDcBranch === 'top' ? 1 : 0)) !== 0
  ) {
    return null
  }
  if (!canDropSymbolOnSupplyConverterDcWire(device.symbol, target.supplyDcBusId != null)) {
    return null
  }
  const targetDevices = getSupplyTargetDevices(project, target)
  if (!targetDevices) return null

  sourceDevices.splice(sourceIndex, 1)
  applySupplyDcTarget(
    device,
    target,
    clamp(target.supplyDeviceInsertIndex ?? targetDevices.length, 0, targetDevices.length)
  )
  targetDevices.splice(device.trunkPosition, 0, device)
  targetDevices.forEach((item, index) => {
    item.trunkPosition = index
  })
  return { device, sourcePanelId: owner.panel.id, targetPanelId: target.panelId }
}

export function moveEndpointToSupplyDcBus(
  project: ProjectWithOptionalV2Electrical,
  endpointId: string,
  sourceCircuitId: string,
  target: DropTarget
): SupplyTrunkDeviceMoveResult | null {
  if (target.type !== 'supplyConverterDcWire') return null
  const owner = findCircuitOwner(project, sourceCircuitId)
  const endpoint = owner?.circuit.endpoints.find((item) => item.id === endpointId)
  if (!owner || !endpoint?.symbol) return null
  if (
    endpoint.symbol === 'dc_bus' &&
    (target.supplyConverterDcConnectionIndex ??
      (target.supplyConverterDcBranch === 'top' ? 1 : 0)) !== 0
  ) {
    return null
  }
  if (!canDropSymbolOnSupplyConverterDcWire(endpoint.symbol, target.supplyDcBusId != null)) {
    return null
  }
  const targetDevices = getSupplyTargetDevices(project, target)
  if (!targetDevices) return null

  removeEndpointIdsFromCircuit(owner.circuit, new Set([endpointId]))
  const device = convertEndpointToSupplyTrunkDevice(endpoint, 0)
  applySupplyDcTarget(
    device,
    target,
    clamp(target.supplyDeviceInsertIndex ?? targetDevices.length, 0, targetDevices.length)
  )
  targetDevices.splice(device.trunkPosition, 0, device)
  targetDevices.forEach((item, index) => {
    item.trunkPosition = index
  })
  return { device, sourcePanelId: owner.panel.id, targetPanelId: target.panelId }
}

function supplyDeviceMatchesTargetLane(device: TrunkDevice, target: DropTarget): boolean {
  const path = device.supplyPath
  if (target.type === 'supplyConverterDcWire') {
    const targetConnectionIndex =
      target.supplyConverterDcConnectionIndex ?? (target.supplyConverterDcBranch === 'top' ? 1 : 0)
    return (
      path === getSupplyConverterDcPath(targetConnectionIndex) &&
      getSupplyConverterDcConnectionIndex(device) === targetConnectionIndex
    )
  }
  if (target.type === 'supplyConverterGridWire') {
    return path === 'converter-grid' || path === 'backup' || path === 'converter-branch'
  }
  if (target.type === 'supplyBackupWire' || target.type === 'supplyBackupOutputWire') {
    return path === 'backup-output' || path === 'backup'
  }
  if (target.type === 'supplyChangeoverGridWire') {
    return path === 'changeover-grid' || device.symbol === 'source_changeover'
  }
  return path == null || path === 'serial' || device.symbol === 'source_changeover'
}

/** Infer the enclosure region under a one-wire drop from nearby mounted devices. */
export function resolveSupplyDropMounting(
  project: ProjectWithOptionalV2Electrical,
  panelLayout: BottomUpPanelLayout,
  target: DropTarget,
  position: Point,
  wireSegments: WireSegment[] = []
): ElectricalEnclosureRef {
  const ownerPanelId = panelLayout.ownerPanelId ?? panelLayout.panel.id
  const candidates: Array<{
    mounting: ElectricalEnclosureRef
    distance: number
    x: number
    y: number
  }> = (panelLayout.supplyDevices ?? [])
    .filter(({ device }) => supplyDeviceMatchesTargetLane(device, target))
    .map(({ device, x, y }) => ({
      mounting: resolveSupplyDeviceMounting(project, device.id),
      distance: Math.hypot(position.x - x, position.y - y),
      x,
      y,
    }))
    .filter(
      (
        candidate
      ): candidate is {
        mounting: ElectricalEnclosureRef
        distance: number
        x: number
        y: number
      } => candidate.mounting != null
    )

  if (target.type === 'supplyWire') {
    if (target.supplyFeedScope === 'shared') {
      candidates.push({
        mounting: { kind: 'grid' },
        distance: Math.hypot(position.x - panelLayout.supply.x, position.y - panelLayout.supply.y),
        x: panelLayout.supply.x,
        y: panelLayout.supply.y,
      })
    } else {
      candidates.push({
        mounting: { kind: 'panel', panelId: ownerPanelId },
        distance: Math.hypot(
          position.x - panelLayout.mainBus.x,
          position.y - panelLayout.mainBus.y
        ),
        x: panelLayout.mainBus.x,
        y: panelLayout.mainBus.y,
      })
    }
  }

  const diagramId = getPanelDiagramId(panelLayout)
  const nearbyBoundary = wireSegments
    .filter(
      (segment) => segment.diagramId === diagramId && segment.supplyEnclosureBoundary === true
    )
    .map((segment) => {
      const center = getSupplyEnclosureBoundaryCenter(segment)
      const horizontalWire =
        Math.abs(segment.endPoint.x - segment.startPoint.x) >=
        Math.abs(segment.endPoint.y - segment.startPoint.y)
      const perpendicularDistance = horizontalWire
        ? Math.abs(position.y - center.y)
        : Math.abs(position.x - center.x)
      const axisDistance = horizontalWire
        ? Math.abs(position.x - center.x)
        : Math.abs(position.y - center.y)
      return { center, horizontalWire, perpendicularDistance, axisDistance }
    })
    .filter((boundary) => boundary.perpendicularDistance <= 24)
    .sort(
      (left, right) =>
        left.perpendicularDistance - right.perpendicularDistance ||
        left.axisDistance - right.axisDistance
    )[0]

  if (nearbyBoundary) {
    const boundaryAxis = nearbyBoundary.horizontalWire
      ? nearbyBoundary.center.x
      : nearbyBoundary.center.y
    const pointerAxis = nearbyBoundary.horizontalWire ? position.x : position.y
    const sameLane = candidates.filter((candidate) =>
      nearbyBoundary.horizontalWire
        ? Math.abs(candidate.y - nearbyBoundary.center.y) <= 50
        : Math.abs(candidate.x - nearbyBoundary.center.x) <= 50
    )
    const sideCandidates = sameLane.filter((candidate) => {
      const candidateAxis = nearbyBoundary.horizontalWire ? candidate.x : candidate.y
      return pointerAxis <= boundaryAxis
        ? candidateAxis <= boundaryAxis
        : candidateAxis >= boundaryAxis
    })
    sideCandidates.sort((left, right) => left.distance - right.distance)
    if (sideCandidates[0]) return sideCandidates[0].mounting
  }

  candidates.sort((left, right) => left.distance - right.distance)
  return (
    candidates[0]?.mounting ??
    (target.supplyFeedScope === 'shared'
      ? { kind: 'grid' }
      : { kind: 'panel', panelId: ownerPanelId })
  )
}

export function isSupplyTrunkDeviceDropTarget(device: TrunkDevice, target: DropTarget): boolean {
  const isDcBranchDevice =
    device.supplyPath === 'converter-dc' || device.supplyPath === 'converter-dc-top'
  const canUseDcBranchTarget =
    target.type === 'supplyConverterDcWire' &&
    canDropSymbolOnSupplyConverterDcWire(device.symbol, target.supplyDcBusId != null)
  const validTarget =
    target.type === 'supplyConverterDcWire'
      ? canUseDcBranchTarget
      : (!isDcBranchDevice &&
          device.type === 'protection' &&
          SUPPLY_PROTECTION_TARGETS.has(target.type)) ||
        (!isDcBranchDevice &&
          device.type === 'energy_meter' &&
          SUPPLY_METER_TARGETS.has(target.type)) ||
        (!isDcBranchDevice && device.type !== 'protection' && target.type === 'supplyWire')
  if (
    !validTarget ||
    device.supplyPath === 'backup' ||
    (device.type === 'dc_bus' && !!target.supplyDcBusId) ||
    (device.type === 'dc_bus' &&
      target.type === 'supplyConverterDcWire' &&
      (target.supplyConverterDcConnectionIndex ??
        (target.supplyConverterDcBranch === 'top' ? 1 : 0)) !== 0)
  ) {
    return false
  }

  const targetScope = target.supplyFeedScope ?? 'shared'
  if (targetScope === 'root' && !target.panelId) return false
  return !(
    (device.symbol === 'source_changeover' || device.supplyPath === 'converter-branch') &&
    targetScope !== 'root'
  )
}

function getSupplyContainers(project: ProjectWithOptionalV2Electrical) {
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return null
  const topology = ensureInstallationFeedTopology(
    installation,
    getProjectElectricalPanels(project)
  )
  return { installation, topology }
}

/**
 * Move an existing supply-frame device through the same feed lanes and insertion
 * slots used by library drops. The project is mutated only after the complete
 * source/target move has been validated.
 */
export function moveSupplyTrunkDeviceAtDropTarget(
  project: ProjectWithOptionalV2Electrical,
  deviceId: string,
  target: DropTarget,
  targetMounting?: ElectricalEnclosureRef
): SupplyTrunkDeviceMoveResult | null {
  const containers = getSupplyContainers(project)
  if (!containers) return null
  const sharedDevices =
    containers.installation.mainSupply.supplyTrunkDevices ??
    (containers.installation.mainSupply.supplyTrunkDevices = [])
  const rootFeed = containers.topology.rootFeeds.find((feed) =>
    (feed.trunkDevices ?? []).some((device) => device.id === deviceId)
  )
  const source = sharedDevices.some((device) => device.id === deviceId)
    ? { devices: sharedDevices, scope: 'shared' as const, panelId: undefined }
    : rootFeed
      ? { devices: rootFeed.trunkDevices ?? [], scope: 'root' as const, panelId: rootFeed.panelId }
      : null
  const sourceIndex = source?.devices.findIndex((device) => device.id === deviceId) ?? -1
  const device = sourceIndex >= 0 ? source?.devices[sourceIndex] : undefined
  if (!source || !device) return null

  if (!isSupplyTrunkDeviceDropTarget(device, target)) return null
  if (device.type === 'dc_bus' && source.panelId !== target.panelId) return null

  const targetScope = target.supplyFeedScope ?? 'shared'

  const targetRootFeed =
    targetScope === 'root'
      ? containers.topology.rootFeeds.find((feed) => feed.panelId === target.panelId)
      : undefined
  if (targetScope === 'root' && !targetRootFeed) return null
  const targetDevices =
    targetScope === 'shared'
      ? sharedDevices
      : (targetRootFeed!.trunkDevices ?? (targetRootFeed!.trunkDevices = []))
  const sameContainer = source.devices === targetDevices
  const sourceBranchKey =
    device.supplyDcBusId != null ? (device.supplyDcBusBranchId ?? device.id) : undefined
  const sourceBranchEntries = sourceBranchKey
    ? source.devices.filter(
        (item) =>
          item.supplyDcBusId === device.supplyDcBusId &&
          (item.supplyDcBusBranchId ?? item.id) === sourceBranchKey
      )
    : []
  const movesWholeDcBranch =
    device.type === 'conversion' && sourceBranchEntries[0]?.id === device.id
  // A DC-rail branch is represented by one or more trunk devices (for example,
  // an inverter followed by its solar panel). Relocating only the selected head
  // leaves the descendants behind and lets the next layout pass re-form the
  // branch at the wrong insertion slot.
  const movingEntries = source.devices
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) =>
        item.id === device.id ||
        (device.type === 'dc_bus' && item.supplyDcBusId === device.id) ||
        (movesWholeDcBranch &&
          sourceBranchKey != null &&
          item.supplyDcBusId === device.supplyDcBusId &&
          (item.supplyDcBusBranchId ?? item.id) === sourceBranchKey)
    )
  const movingDevices = movingEntries.map(({ item }) => item)
  const targetDcBusId =
    target.type === 'supplyConverterDcWire' ? target.supplyDcBusId : undefined
  const targetDcBusBranchId =
    target.type === 'supplyConverterDcWire' && targetDcBusId
      ? target.supplyDcBusBranchId
      : undefined
  const targetBranchIdForDevice =
    targetDcBusId != null
      ? (targetDcBusBranchId ?? (movesWholeDcBranch ? sourceBranchKey : generateId()))
      : undefined
  const dcBusMembershipChanges =
    targetDcBusId !== device.supplyDcBusId ||
    (targetDcBusId != null &&
      targetBranchIdForDevice !==
        (device.supplyDcBusBranchId ??
          (device.supplyDcBusId != null ? device.id : undefined)))
  const targetSupplyPath: TrunkDevice['supplyPath'] =
    target.type === 'supplyConverterDcWire'
      ? getSupplyConverterDcPath(
          target.supplyConverterDcConnectionIndex ??
            (target.supplyConverterDcBranch === 'top' ? 1 : 0)
        )
      : device.type === 'protection' || device.type === 'energy_meter'
        ? target.type === 'supplyBackupOutputWire' || target.type === 'supplyBackupWire'
          ? 'backup-output'
          : target.type === 'supplyChangeoverGridWire'
            ? 'changeover-grid'
            : target.type === 'supplyConverterGridWire'
              ? 'converter-grid'
              : 'serial'
        : device.supplyPath
  const requestedInsertIndex = clamp(
    target.supplyDeviceInsertIndex ?? targetDevices.length,
    0,
    targetDevices.length
  )
  let insertIndex = requestedInsertIndex
  if (sameContainer) {
    insertIndex -= movingEntries.filter(({ index }) => index < requestedInsertIndex).length
  }
  const originalGroupIndex = movingEntries[0]?.index ?? sourceIndex
  if (
    sameContainer &&
    insertIndex === originalGroupIndex &&
    Boolean(device.supplyPanelInput) === Boolean(target.supplyPanelInput) &&
    (device.supplyPath ?? 'serial') === (targetSupplyPath ?? 'serial') &&
    (target.type !== 'supplyConverterDcWire' ||
      getSupplyConverterDcConnectionIndex(device) ===
        (target.supplyConverterDcConnectionIndex ??
          (target.supplyConverterDcBranch === 'top' ? 1 : 0))) &&
    (targetSupplyPath !== 'converter-grid' ||
      (device.converterGridPlacement ?? 'inline') === (target.converterGridPlacement ?? 'inline')) &&
    (targetSupplyPath !== 'changeover-grid' ||
      (device.changeoverGridPlacement ?? 'inline') ===
        (target.changeoverGridPlacement ?? 'inline')) &&
    !dcBusMembershipChanges
  ) {
    if (
      targetMounting &&
      !moveSupplyDeviceToEnclosureAutomatically(
        project,
        deviceId,
        targetMounting,
        target.panelId ?? source.panelId ?? ''
      )
    ) {
      return null
    }
    return { device, sourcePanelId: source.panelId, targetPanelId: target.panelId }
  }

  for (const { index } of [...movingEntries].sort((a, b) => b.index - a.index)) {
    source.devices.splice(index, 1)
  }
  for (const movingDevice of movingDevices) {
    movingDevice.supplyPath = targetSupplyPath
    if (target.supplyPanelInput) movingDevice.supplyPanelInput = true
    else delete movingDevice.supplyPanelInput
    if (target.type === 'supplyConverterDcWire') {
      movingDevice.supplyConverterDcConnectionIndex =
        target.supplyConverterDcConnectionIndex ??
        (target.supplyConverterDcBranch === 'top' ? 1 : 0)
    } else {
      delete movingDevice.supplyConverterDcConnectionIndex
    }
    if (targetSupplyPath === 'converter-grid') {
      movingDevice.converterGridPlacement = target.converterGridPlacement ?? 'inline'
    } else {
      delete movingDevice.converterGridPlacement
    }
    if (targetSupplyPath === 'changeover-grid') {
      movingDevice.changeoverGridPlacement = target.changeoverGridPlacement ?? 'inline'
    } else {
      delete movingDevice.changeoverGridPlacement
    }
    if (targetDcBusId != null) {
      movingDevice.supplyDcBusId = targetDcBusId
      movingDevice.supplyDcBusBranchId = targetBranchIdForDevice
    } else if (device.type !== 'dc_bus') {
      delete movingDevice.supplyDcBusId
      delete movingDevice.supplyDcBusBranchId
    }
  }

  const safeInsertIndex = clamp(insertIndex, 0, targetDevices.length)
  targetDevices.splice(safeInsertIndex, 0, ...movingDevices)
  source.devices.forEach((item, index) => {
    item.trunkPosition = index
  })
  if (!sameContainer) {
    targetDevices.forEach((item, index) => {
      item.trunkPosition = index
    })
  }

  if (
    targetMounting &&
    !moveSupplyDeviceToEnclosureAutomatically(
      project,
      deviceId,
      targetMounting,
      target.panelId ?? source.panelId ?? ''
    )
  ) {
    return null
  }

  return { device, sourcePanelId: source.panelId, targetPanelId: target.panelId }
}
