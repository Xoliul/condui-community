import { getSupplyFeedDevicesForPanel } from '@/lib/feedTopology'
import {
  CIRCUIT_CONVERTER_MAX_CONNECTIONS,
  CIRCUIT_CONVERTER_MIN_CONNECTIONS,
  getCircuitConverterDcConnectionCount,
  getCircuitConverterPrimaryBranch,
  supportsCircuitConverterDcConnections,
} from '@/lib/layout/circuitConverterGeometry'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { getSupplyConverterDcConnectionIndex } from '@/lib/supplyAssembly/converterDcConnections'
import { useProjectStore } from '@/stores/projectStore'
import type { Circuit, Endpoint, TrunkDevice } from '@/types/schema'
import { generateId } from '@/utils'
import { endpointSupportsMultiplier } from '@/utils/endpointMultipliers'

export function clampConverterDcConnectionCount(count: number): number {
  return Math.max(
    CIRCUIT_CONVERTER_MIN_CONNECTIONS,
    Math.min(CIRCUIT_CONVERTER_MAX_CONNECTIONS, Math.round(count))
  )
}

function isDcBusConverterEndpoint(endpoint: Endpoint | undefined): endpoint is Endpoint {
  return endpoint?.symbol === 'dc_dc_converter' || endpoint?.symbol === 'inverter'
}

export function promoteDcBusConverterEndpoint(
  circuit: Circuit,
  endpointId: string,
  requestedCount = 1
): Circuit | null {
  const endpoint = circuit.endpoints.find((candidate) => candidate.id === endpointId)
  if (!isDcBusConverterEndpoint(endpoint)) return null
  const newCount = clampConverterDcConnectionCount(requestedCount)
  const owningBranch = (circuit.branches ?? []).find(
    (branch) => branch.dcBusId && branch.endpointIds.includes(endpoint.id)
  )
  if (!owningBranch) return null
  const converterIndex = owningBranch.endpointIds.indexOf(endpoint.id)
  if (converterIndex < 0) return null

  const downstreamIds = new Set(owningBranch.endpointIds.slice(converterIndex + 1))
  const converter: TrunkDevice = {
    id: endpoint.id,
    type: 'conversion',
    symbol: endpoint.symbol!,
    label: endpoint.label,
    notes: endpoint.notes,
    placements: endpoint.placements,
    trunkPosition: owningBranch.branchDevices?.length ?? 0,
    conversionProps: {
      ...(endpoint.energyConversionProps ?? {}),
      dcConnectionCount: newCount,
    },
    symbolLabelDisplay: endpoint.symbolLabelDisplay,
  }

  return {
    ...circuit,
    endpoints: circuit.endpoints
      .filter((candidate) => candidate.id !== endpoint.id)
      .map((candidate) =>
        newCount > 1 && downstreamIds.has(candidate.id)
          ? {
              ...candidate,
              converterDcConnection: { converterId: endpoint.id, connectionIndex: 0 },
            }
          : candidate
      ),
    branches: (circuit.branches ?? []).map((branch) =>
      branch.id === owningBranch.id
        ? {
            ...branch,
            endpointIds: branch.endpointIds.filter((endpointId) => endpointId !== endpoint.id),
            branchDevices: [...(branch.branchDevices ?? []), converter],
          }
        : branch
    ),
  }
}

/** PV/battery endpoints that render an "Nx" multiplier badge from their placement count. */
function isMergeableMultiplierPanel(endpoint: Endpoint): boolean {
  return (
    endpointSupportsMultiplier(endpoint) &&
    (endpoint.symbol === 'solar_panel' || endpoint.symbol === 'battery')
  )
}

/**
 * A widened ordinary-circuit converter adopts its first branch as DC output lane
 * zero, laying that branch's panel endpoints out in series with horizontal
 * links. When parallel branches exist those links misroute and break. Collapsing
 * the first branch's compatible panel endpoints into a single endpoint that
 * carries every placement (the "Nx" multiplier) removes the extra endpoints — and
 * therefore the broken inter-endpoint wires — while preserving the physical unit
 * count on the sitplan. Returns a new circuit, or null when nothing collapses.
 */
export function collapsePrimaryBranchIntoMultiplier(
  circuit: Circuit,
  converterId: string,
  requestedCount: number
): Circuit | null {
  if (clampConverterDcConnectionCount(requestedCount) <= 1) return null
  const device = (circuit.trunkDevices ?? []).find((candidate) => candidate.id === converterId)
  if (!device || !supportsCircuitConverterDcConnections(device)) return null
  // The persisted dcConnectionCount is only bumped at the end of the resize, so
  // evaluate the primary-branch selection against the incoming count.
  const deviceWithNewCount: TrunkDevice = {
    ...device,
    conversionProps: {
      ...(device.conversionProps ?? {}),
      dcConnectionCount: clampConverterDcConnectionCount(requestedCount),
    },
  }
  const primaryBranch = getCircuitConverterPrimaryBranch(circuit, deviceWithNewCount)
  if (!primaryBranch) return null

  const endpointById = new Map(circuit.endpoints.map((endpoint) => [endpoint.id, endpoint]))
  const branchEndpoints = primaryBranch.endpointIds
    .map((endpointId) => endpointById.get(endpointId))
    .filter((endpoint): endpoint is Endpoint => endpoint !== undefined)
  const keeper = branchEndpoints.find(isMergeableMultiplierPanel)
  if (!keeper) return null
  const absorbIds = new Set(
    branchEndpoints
      .filter(
        (endpoint) =>
          endpoint.id !== keeper.id &&
          isMergeableMultiplierPanel(endpoint) &&
          endpoint.type === keeper.type &&
          endpoint.symbol === keeper.symbol
      )
      .map((endpoint) => endpoint.id)
  )
  if (absorbIds.size === 0) return null

  const usedPlacementIds = new Set(keeper.placements.map((placement) => placement.id))
  const mergedPlacements = [...keeper.placements]
  for (const endpoint of branchEndpoints) {
    if (!absorbIds.has(endpoint.id)) continue
    for (const placement of endpoint.placements) {
      const placementId = usedPlacementIds.has(placement.id) ? generateId() : placement.id
      usedPlacementIds.add(placementId)
      mergedPlacements.push({ ...placement, id: placementId })
    }
  }

  return {
    ...circuit,
    endpoints: circuit.endpoints
      .filter((endpoint) => !absorbIds.has(endpoint.id))
      .map((endpoint) =>
        endpoint.id === keeper.id ? { ...endpoint, placements: mergedPlacements } : endpoint
      ),
    branches: (circuit.branches ?? []).map((branch) => ({
      ...branch,
      endpointIds: branch.endpointIds.filter((endpointId) => !absorbIds.has(endpointId)),
    })),
  }
}

export function getOrdinaryConverterResizeEndpointIds(
  circuit: Circuit,
  converterId: string,
  newCount: number
): string[] {
  const count = clampConverterDcConnectionCount(newCount)
  return circuit.endpoints.flatMap((endpoint) => {
    const connection = endpoint.converterDcConnection
    return connection?.converterId === converterId && connection.connectionIndex >= count
      ? [endpoint.id]
      : []
  })
}

export function getOrdinaryConverterResizeTrunkDeviceIds(
  circuit: Circuit,
  converterId: string,
  newCount: number
): string[] {
  const count = clampConverterDcConnectionCount(newCount)
  return [
    ...(circuit.trunkDevices ?? []),
    ...(circuit.branches ?? []).flatMap((branch) => branch.branchDevices ?? []),
  ].flatMap((device) => {
    const connection = device.converterDcConnection
    return connection?.converterId === converterId && connection.connectionIndex >= count
      ? [device.id]
      : []
  })
}

function resizeNestedOrdinaryConverterOwnership(
  circuit: Circuit,
  converterId: string,
  newCount: number
): Circuit {
  const owningBranch = (circuit.branches ?? []).find((branch) =>
    branch.branchDevices?.some((device) => device.id === converterId)
  )
  if (!owningBranch?.branchDevices) return circuit

  const converterIndex = owningBranch.branchDevices.findIndex((device) => device.id === converterId)
  if (converterIndex < 0) return circuit

  const downstreamDeviceIds = new Set(
    owningBranch.branchDevices.slice(converterIndex + 1).map((device) => device.id)
  )
  const downstreamEndpointIds = new Set(owningBranch.endpointIds)
  const resizeConnection = <
    T extends { converterDcConnection?: TrunkDevice['converterDcConnection'] },
  >(
    item: T
  ): T => {
    const connection = item.converterDcConnection
    if (
      newCount === 1 &&
      connection?.converterId === converterId &&
      connection.connectionIndex === 0
    ) {
      const { converterDcConnection: _removed, ...rest } = item
      return rest as T
    }
    if (newCount > 1 && !connection) {
      return {
        ...item,
        converterDcConnection: { converterId, connectionIndex: 0 },
      }
    }
    return item
  }

  return {
    ...circuit,
    endpoints: circuit.endpoints.map((endpoint) =>
      downstreamEndpointIds.has(endpoint.id) ? resizeConnection(endpoint) : endpoint
    ),
    branches: (circuit.branches ?? []).map((branch) => ({
      ...branch,
      ...(branch.branchDevices
        ? {
            branchDevices: branch.branchDevices.map((device) =>
              downstreamDeviceIds.has(device.id) ? resizeConnection(device) : device
            ),
          }
        : {}),
    })),
  }
}

function getNestedSupplyConverterBranchDevices(
  devices: TrunkDevice[],
  converter: TrunkDevice
): TrunkDevice[] {
  const branchId = converter.supplyDcBusBranchId ?? converter.id
  return devices.filter(
    (device) =>
      device.supplyDcBusId === converter.supplyDcBusId &&
      (device.supplyDcBusBranchId ?? device.id) === branchId
  )
}

export function getSupplyConverterResizeDeviceIds(
  devices: TrunkDevice[],
  converterId: string,
  newCount: number
): string[] {
  const count = clampConverterDcConnectionCount(newCount)
  let activeConverterId: string | undefined
  const result: string[] = []
  for (const device of devices) {
    if (device.supplyPath === 'converter-branch' || device.supplyPath === 'backup') {
      activeConverterId = device.id
      continue
    }
    if (activeConverterId !== converterId) continue
    const connectionIndex = getSupplyConverterDcConnectionIndex(device)
    if (connectionIndex != null && connectionIndex > count) result.push(device.id)
  }
  return result
}

/**
 * Keep ordinary converter DC busbars on the terminal (last) output when the
 * destination still contains their current port. A bus on a removed port is
 * deliberately left in place so the normal resize cleanup deletes it and its
 * dependent branch content as one destructive resize operation.
 */
export function moveOrdinaryConverterDcBusesToLastOutput(
  circuit: Circuit,
  converterId: string,
  previousCount: number,
  newCount: number
): Circuit {
  const oldCount = clampConverterDcConnectionCount(previousCount)
  const count = clampConverterDcConnectionCount(newCount)
  const lastConnectionIndex = count - 1
  let moved = false
  let migratedImplicitBus = false
  const trunkDevices = (circuit.trunkDevices ?? []).map((device) => {
    if (device.type !== 'dc_bus') {
      return device
    }
    const connection = device.converterDcConnection
    if (!connection) {
      // A one-port converter bus created through the generic DC trunk path has
      // no explicit converter connection. Treat it as port 1 and migrate it
      // when the converter grows so it follows the terminal output.
      if (oldCount !== 1 || count <= oldCount || migratedImplicitBus) return device
      migratedImplicitBus = true
      moved = true
      return {
        ...device,
        converterDcConnection: {
          converterId,
          connectionIndex: lastConnectionIndex,
        },
      }
    }
    if (connection.converterId !== converterId) return device
    const connectionIndex = connection.connectionIndex
    // A rail beyond the new terminal is intentionally retained for cleanup.
    if (connectionIndex >= count) return device
    // Widening moves a rail to the newly-created terminal. If legacy data has
    // a rail on an earlier surviving port, normalize it to the terminal too.
    if (connectionIndex === lastConnectionIndex) {
      return device
    }
    moved = true
    return {
      ...device,
      converterDcConnection: {
        converterId: connection.converterId,
        connectionIndex: lastConnectionIndex,
      },
    }
  })
  return moved ? { ...circuit, trunkDevices } : circuit
}

/** Resize a converter and remove everything owned by lanes that disappear. */
export function resizeConverterDcConnections(deviceId: string, requestedCount: number): boolean {
  const store = useProjectStore.getState()
  const found = store.getTrunkDeviceById(deviceId)
  const device = found?.device
  const newCount = clampConverterDcConnectionCount(requestedCount)

  if (!found || !device || !supportsCircuitConverterDcConnections(device)) {
    const endpoint = store.getEndpointById(deviceId)
    const endpointOwner = endpoint ? store.findCircuitForEndpoint(deviceId) : undefined
    if (!isDcBusConverterEndpoint(endpoint) || !endpointOwner || newCount <= 1) return false
    const migrated = promoteDcBusConverterEndpoint(endpointOwner.circuit, endpoint.id, newCount)
    if (!migrated) return false
    return store.withSingleUndoEntry(() => {
      store.updateCircuit(endpointOwner.circuit.id, {
        endpoints: migrated.endpoints,
        branches: migrated.branches,
      })
      return true
    })
  }

  const previousCount = getCircuitConverterDcConnectionCount(device)
  if (newCount === previousCount) return false
  return store.withSingleUndoEntry(() => {
    const conversionProps = { ...(device.conversionProps ?? {}), dcConnectionCount: newCount }

    if (found.circuit) {
      const isNestedDcBusConverter = (found.circuit.branches ?? []).some((branch) =>
        branch.branchDevices?.some((candidate) => candidate.id === deviceId)
      )
      const resizedCircuit = isNestedDcBusConverter
        ? resizeNestedOrdinaryConverterOwnership(found.circuit, deviceId, newCount)
        : moveOrdinaryConverterDcBusesToLastOutput(found.circuit, deviceId, previousCount, newCount)
      // Only the main-bus (non-nested) converter renders its first branch as an
      // in-line lane-zero chain, so that is the only case that grows the broken
      // horizontal wires when parallel branches are present.
      const collapsedCircuit = isNestedDcBusConverter
        ? resizedCircuit
        : (collapsePrimaryBranchIntoMultiplier(resizedCircuit, deviceId, newCount) ?? resizedCircuit)
      if (collapsedCircuit !== found.circuit) {
        store.updateCircuit(found.circuit.id, {
          trunkDevices: collapsedCircuit.trunkDevices,
          endpoints: collapsedCircuit.endpoints,
          branches: collapsedCircuit.branches,
        })
      }
      const endpointIds = getOrdinaryConverterResizeEndpointIds(collapsedCircuit, deviceId, newCount)
      if (endpointIds.length > 0) store.deleteEndpoints(endpointIds)
      const trunkDeviceIds = getOrdinaryConverterResizeTrunkDeviceIds(
        collapsedCircuit,
        deviceId,
        newCount
      )
      trunkDeviceIds.forEach((trunkDeviceId) =>
        useProjectStore.getState().deleteTrunkDevice(found.circuit!.id, trunkDeviceId)
      )
      store.updateTrunkDevice(found.circuit.id, deviceId, { conversionProps })
      return true
    }

    if (found.isSupplyDevice && store.currentProject) {
      const installation = getProjectElectricalInstallation(store.currentProject)
      const panels = getProjectElectricalPanels(store.currentProject)
      if (!installation) return false
      const devices = getSupplyFeedDevicesForPanel(
        installation,
        panels,
        found.supplyPanelId ?? panels[0]?.id ?? '',
        found.supplyFeedScope ?? 'root'
      )
      if (device.supplyDcBusId) {
        const branchDevices = getNestedSupplyConverterBranchDevices(devices, device)
        const converterIndex = branchDevices.findIndex((candidate) => candidate.id === deviceId)
        const downstream = branchDevices.slice(converterIndex + 1)
        for (const candidate of downstream) {
          const connection = candidate.converterDcConnection
          if (connection?.converterId === deviceId && connection.connectionIndex >= newCount) {
            useProjectStore.getState().deleteSupplyTrunkDevice(candidate.id)
          } else if (newCount === 1 && connection?.converterId === deviceId) {
            useProjectStore.getState().updateSupplyTrunkDevice(candidate.id, {
              converterDcConnection: undefined,
            })
          } else if (newCount > 1 && !connection) {
            useProjectStore.getState().updateSupplyTrunkDevice(candidate.id, {
              converterDcConnection: { converterId: deviceId, connectionIndex: 0 },
            })
          }
        }
        useProjectStore.getState().updateSupplyTrunkDevice(deviceId, { conversionProps })
        return true
      }
      const removedDeviceIds = getSupplyConverterResizeDeviceIds(devices, deviceId, newCount)
      removedDeviceIds.forEach((removedDeviceId) =>
        useProjectStore.getState().deleteSupplyTrunkDevice(removedDeviceId)
      )
      useProjectStore.getState().updateSupplyTrunkDevice(deviceId, { conversionProps })
      return true
    }

    return false
  })
}
