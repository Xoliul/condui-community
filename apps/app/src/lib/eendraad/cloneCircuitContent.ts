import {
  clonePlacementsForDuplicate,
  clonePlacementsOptionsForEndpoint,
} from '@/lib/eendraad/duplicateSitplanHelpers'
import { migrateEndpointLabelsAfterCircuitCodeChange } from '@/lib/eendraad/circuitEndpointLabels'
import type { Branch, Circuit, Endpoint, TrunkDevice } from '@/types/schema'
import { generateId } from '@/utils'
import { clearDuplicatedControlChannel } from '@/lib/controlLink/duplicateAddress'

export type CircuitCloneIdMaps = {
  endpoint: Map<string, string>
  trunkDevice: Map<string, string>
  circuit: Map<string, string>
}

function cloneEndpointContent(source: Endpoint, id: string, preserveDependencies: boolean, newId: () => string): Endpoint {
  const clone: Endpoint = JSON.parse(JSON.stringify(source))
  clone.id = id
  clone.placements =
    source.placements?.length > 0
      ? clonePlacementsForDuplicate(source.placements, clonePlacementsOptionsForEndpoint(source), newId)
      : []
  if (!preserveDependencies) {
    clone.controlledEndpointIds = undefined
    if (clone.domoticaProps) {
      clone.domoticaProps = {
        ...clone.domoticaProps,
        endpointChildEndpointIds: undefined,
        controlChildEndpointIds: undefined,
      }
    }
    clone.domoticaChildProps = undefined
  }
  return clone
}

function cloneTrunkDeviceContent(source: TrunkDevice, id: string, newId: () => string): TrunkDevice {
  return {
    ...JSON.parse(JSON.stringify(source)),
    id,
    placements: source.placements?.length
      ? clonePlacementsForDuplicate(source.placements, { symbolType: source.symbol }, newId)
      : source.placements,
  }
}

function remapDeviceConverterConnections(
  devices: TrunkDevice[],
  maps: CircuitCloneIdMaps,
): void {
  for (const device of devices) {
    if (!device.converterDcConnection) continue
    const converterId = maps.trunkDevice.get(device.converterDcConnection.converterId)
    if (converterId) device.converterDcConnection.converterId = converterId
    else delete device.converterDcConnection
  }
}

/**
 * Deep-clone a circuit's consumers (endpoints, branches, trunk devices).
 * `subCircuitIds` are cleared; wire them after all circuits in a subtree are mapped.
 */
export function cloneCircuitContent(
  source: Circuit,
  maps: CircuitCloneIdMaps,
  newCircuitId: string,
  newCode: string,
  newId: () => string = generateId,
  preserveEndpointDependencies = false
): Circuit {
  maps.circuit.set(source.id, newCircuitId)

  const endpointIdMap = maps.endpoint
  const newEndpoints: Endpoint[] = []
  for (const ep of source.endpoints) {
    const newEpId = newId()
    endpointIdMap.set(ep.id, newEpId)
    newEndpoints.push(cloneEndpointContent(ep, newEpId, preserveEndpointDependencies, newId))
  }

  const newTrunkDevices: TrunkDevice[] | undefined = source.trunkDevices?.map((td) => {
    const newTdId = newId()
    maps.trunkDevice.set(td.id, newTdId)
    return cloneTrunkDeviceContent(td, newTdId, newId)
  })
  for (const endpoint of newEndpoints) {
    if (!endpoint.converterDcConnection) continue
    const converterId = maps.trunkDevice.get(endpoint.converterDcConnection.converterId)
    if (converterId) endpoint.converterDcConnection.converterId = converterId
    else delete endpoint.converterDcConnection
  }

  const branchDeviceLists = new Map<string, TrunkDevice[]>()
  for (const branch of source.branches ?? []) {
    const clonedDevices = (branch.branchDevices ?? []).map((device) => {
      const newDeviceId = newId()
      maps.trunkDevice.set(device.id, newDeviceId)
      return cloneTrunkDeviceContent(device, newDeviceId, newId)
    })
    branchDeviceLists.set(branch.id, clonedDevices)
  }
  remapDeviceConverterConnections(
    [...(newTrunkDevices ?? []), ...Array.from(branchDeviceLists.values()).flat()],
    maps,
  )

  let newBranches: Branch[] | undefined
  if (source.branches?.length) {
    newBranches = source.branches.map((branch) => {
      const dcBusId = branch.dcBusId ? maps.trunkDevice.get(branch.dcBusId) : undefined
      const branchDevices = branchDeviceLists.get(branch.id)
      return {
      id: newId(),
        label: branch.label,
        ...(branch.keepEmpty ? { keepEmpty: true as const } : {}),
        ...(branch.stem ? { stem: branch.stem } : {}),
        ...(branch.forkFrom ? { forkFrom: { afterEndpointId: endpointIdMap.get(branch.forkFrom.afterEndpointId) ?? branch.forkFrom.afterEndpointId } } : {}),
        endpointIds: branch.endpointIds
          .map((eid) => endpointIdMap.get(eid))
          .filter((id): id is string => !!id),
        ...(dcBusId ? { dcBusId } : {}),
        ...(branchDevices?.length ? { branchDevices } : {}),
      }
    })
  }

  const clone: Circuit = {
    ...JSON.parse(JSON.stringify(source)),
    id: newCircuitId,
    code: newCode,
    endpoints: newEndpoints,
    branches: newBranches,
    trunkDevices: newTrunkDevices,
    subCircuitIds: undefined,
  }

  remapSectionWireOverrides(clone, maps)
  relabelClonedCircuit(source, clone, newCode)
  return clone
}

export function remapClonedEndpointDependencies(endpoints: Endpoint[], maps: CircuitCloneIdMaps): void {
  for (const endpoint of endpoints) {
    if (endpoint.controlledEndpointIds) {
      endpoint.controlledEndpointIds = endpoint.controlledEndpointIds
        .map((id) => maps.endpoint.get(id))
        .filter((id): id is string => !!id)
    }
    if (endpoint.domoticaProps) {
      endpoint.domoticaProps.endpointChildEndpointIds = endpoint.domoticaProps.endpointChildEndpointIds
        ?.map((id) => maps.endpoint.get(id))
        .filter((id): id is string => !!id)
      endpoint.domoticaProps.controlChildEndpointIds = endpoint.domoticaProps.controlChildEndpointIds
        ?.map((id) => maps.endpoint.get(id))
        .filter((id): id is string => !!id)
    }
    if (endpoint.domoticaChildProps) {
      const parentId = maps.endpoint.get(endpoint.domoticaChildProps.parentEndpointId)
      if (parentId) endpoint.domoticaChildProps.parentEndpointId = parentId
      else delete endpoint.domoticaChildProps
    }
    if (endpoint.controlLink) {
      const clonedDeviceId = maps.endpoint.get(endpoint.controlLink.deviceId)
      if (clonedDeviceId) endpoint.controlLink.deviceId = clonedDeviceId
      else delete endpoint.controlLink
    }
    clearDuplicatedControlChannel(endpoint)
  }
}

/** Rename branch + endpoint labels from source circuit code to the new circuit code. */
export function relabelClonedCircuit(source: Circuit, clone: Circuit, newCode: string): void {
  const oldCode = (source.code ?? '').trim()
  const newTrim = newCode.trim()
  migrateEndpointLabelsAfterCircuitCodeChange(clone, oldCode, newTrim)
  clone.code = newTrim
  syncBranchLabelsFromEndpoints(clone)
}

function syncBranchLabelsFromEndpoints(circuit: Circuit): void {
  for (const branch of circuit.branches ?? []) {
    const firstId = branch.endpointIds[0]
    if (!firstId) continue
    const ep = circuit.endpoints.find((e) => e.id === firstId)
    const label = ep?.label?.trim()
    if (label) branch.label = label
  }
}

function remapSectionWireOverrides(circuit: Circuit, maps: CircuitCloneIdMaps): void {
  if (!circuit.sectionWireOverrides?.length) return
  for (const section of circuit.sectionWireOverrides) {
    if (section.fromElementId) {
      section.fromElementId =
        maps.endpoint.get(section.fromElementId) ??
        maps.trunkDevice.get(section.fromElementId) ??
        section.fromElementId
    }
    if (section.toElementId) {
      section.toElementId =
        maps.endpoint.get(section.toElementId) ??
        maps.trunkDevice.get(section.toElementId) ??
        section.toElementId
    }
  }
}

export function wireClonedSubCircuitIds(
  source: Circuit,
  clone: Circuit,
  maps: CircuitCloneIdMaps
): void {
  if (!source.subCircuitIds?.length) {
    delete clone.subCircuitIds
  } else {
    const next = source.subCircuitIds
      .map((id) => maps.circuit.get(id))
      .filter((id): id is string => !!id)
    clone.subCircuitIds = next.length > 0 ? next : undefined
  }
  if (clone.dcBusSource) {
    const busId = maps.trunkDevice.get(clone.dcBusSource.busId)
    if (busId) clone.dcBusSource.busId = busId
    else delete clone.dcBusSource
  }
  for (const device of clone.trunkDevices ?? []) {
    if (!device.dcBusProps?.branchCircuitIds) continue
    device.dcBusProps.branchCircuitIds = device.dcBusProps.branchCircuitIds
      .map((id) => maps.circuit.get(id))
      .filter((id): id is string => !!id)
  }
}

export function findCircuitOnPanel(
  panel: { circuits: Circuit[]; protections: { circuits?: Circuit[] }[] },
  circuitId: string
): Circuit | undefined {
  for (const c of panel.circuits) {
    if (c.id === circuitId) return c
  }
  for (const p of panel.protections) {
    const hit = p.circuits?.find((c) => c.id === circuitId)
    if (hit) return hit
  }
  return undefined
}
