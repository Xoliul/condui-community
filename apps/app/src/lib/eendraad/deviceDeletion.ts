import type { ProjectV2 } from '@/types/projectV2'
import { syncSequentialEndpointBranchLabelsToCircuit } from '@/lib/eendraad/automaticEndpointBranchNaming'
import { pruneEendraadFrames } from '@/lib/eendraad/frameContent'
import { findGroundTrunkDeviceOwner } from '@/lib/eendraad/panelGround'
import {
  cleanupPanelGridSlotsForDevice,
  findCircuitById,
  findPanelOwningSupplyDevice,
  findSupplyDeviceContainer,
  getAllCircuits,
  pruneStaleElectricalEndpointRecords,
} from '@/lib/eendraad/projectElectricalDomain'
import { supportsCircuitConverterDcConnections } from '@/lib/layout/circuitConverterGeometry'
import {
  reconcileInvalidPanelFeedOrganizationsInProject,
  syncPanelBackupBusPhaseOrderInProject,
} from '@/lib/panel/panelFeedOrganization'
import { syncPanelAndSituationPlanDeviceVisibility } from '@/lib/plan/panelPlanPlacementVisibility'
import { healPlanWiring } from '@/lib/plan/planWiring'
import { pruneOrphanJunctionPanelPlacements } from '@/lib/plan/sharedJunctionPlacements'
import {
  editProjectSupplyAssemblies,
  getEditableProjectElectricalInstallation,
  getEditableProjectElectricalPanels,
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import {
  downgradeChangeoverToDirectConverterAssembly,
  reconcileDirectConverterCommonLoadPath,
  reconcileDirectConverterDcDevices,
  reconcileDirectConverterGridProtections,
  reconcileSupplyAssemblyBranchProtections,
} from '@/lib/supplyAssembly/editorIntegration'
import type { Panel, PanelGridModuleRef } from '@/types/schema'
import { getEarthingSeparatorPairIds } from '@/lib/eendraad/earthingSeparatorPairs'
import { retargetSupplyTapAnchors } from '@/lib/supplyTaps/healSupplyTaps'
function removeConverterBackupDependents(panels: Panel[], converterId: string): string[] {
  const removedIds: string[] = []
  const linkedPanelIds = new Set<string>()
  const visit = (panel: Panel) => {
    for (let index = panel.protections.length - 1; index >= 0; index--) {
      const protection = panel.protections[index]!
      const ownedCircuits = (protection.circuits ?? []).filter(
        (circuit) =>
          circuit.supplySource?.kind === 'converter-backup' &&
          circuit.supplySource.converterId === converterId
      )
      if (ownedCircuits.length === 0) continue
      removedIds.push(
        protection.id,
        ...ownedCircuits.flatMap((circuit) => [
          circuit.id,
          ...circuit.endpoints.map((endpoint) => endpoint.id),
          ...(circuit.trunkDevices ?? []).map((device) => device.id),
        ])
      )
      if (protection.subPanelId) linkedPanelIds.add(protection.subPanelId)
      panel.protections.splice(index, 1)
    }
    panel.subPanels.forEach(visit)
  }
  panels.forEach(visit)

  const removePanels = (panelList: Panel[]) => {
    for (let index = panelList.length - 1; index >= 0; index--) {
      const panel = panelList[index]!
      removePanels(panel.subPanels)
      if (!linkedPanelIds.has(panel.id)) continue
      removedIds.push(panel.id)
      panelList.splice(index, 1)
    }
  }
  removePanels(panels)
  return removedIds
}

function removeDcBusBranches(
  panels: Panel[],
  _busId: string,
  branchCircuitIds: string[]
): string[] {
  const removedCircuitIds = new Set<string>()
  const removedMemberIds = new Set<string>()
  const pending = [...branchCircuitIds]
  while (pending.length > 0) {
    const circuitId = pending.pop()!
    if (removedCircuitIds.has(circuitId)) continue
    removedCircuitIds.add(circuitId)
    for (const panel of panels) {
      const found = findCircuitById(panel, circuitId)
      if (!found) continue
      removedMemberIds.add(circuitId)
      found.circuit.endpoints.forEach((endpoint) => removedMemberIds.add(endpoint.id))
      found.circuit.trunkDevices?.forEach((device) => removedMemberIds.add(device.id))
      pending.push(...(found.circuit.subCircuitIds ?? []))
      break
    }
  }

  const visit = (panel: Panel) => {
    panel.circuits = panel.circuits.filter((circuit) => !removedCircuitIds.has(circuit.id))
    for (let index = panel.protections.length - 1; index >= 0; index--) {
      const protection = panel.protections[index]!
      const owned = protection.circuits ?? []
      const hasRemovedCircuit = owned.some((circuit) => removedCircuitIds.has(circuit.id))
      if (hasRemovedCircuit) {
        removedMemberIds.add(protection.id)
        panel.protections.splice(index, 1)
      } else {
        protection.circuits = owned.filter((circuit) => !removedCircuitIds.has(circuit.id))
      }
    }
    for (const circuit of getAllCircuits(panel)) {
      if (circuit.subCircuitIds) {
        circuit.subCircuitIds = circuit.subCircuitIds.filter((id) => !removedCircuitIds.has(id))
      }
      for (const device of circuit.trunkDevices ?? []) {
        if (!device.dcBusProps?.branchCircuitIds) continue
        device.dcBusProps.branchCircuitIds = device.dcBusProps.branchCircuitIds.filter(
          (id) => !removedCircuitIds.has(id)
        )
      }
    }
    panel.subPanels.forEach(visit)
  }
  panels.forEach(visit)
  return [...removedMemberIds]
}

export function deleteTrunkDeviceInProject(
  project: ProjectV2,
  circuitId: string,
  deviceId: string
): boolean {
  let changed = false
  if (project) {
    // Project is supplied by the caller
    const panels = getProjectElectricalPanels(project)
    for (const panel of panels) {
      const result = findCircuitById(panel, circuitId)
      if (result) {
        const branch = result.circuit.branches?.find((candidate) =>
          candidate.branchDevices?.some((device) => device.id === deviceId)
        )
        if (branch?.branchDevices) {
          const removed = branch.branchDevices.find((device) => device.id === deviceId)
          const removedMemberIds = new Set([deviceId])
          if (supportsCircuitConverterDcConnections(removed)) {
            const ownedEndpointIds = new Set(branch.endpointIds)
            for (const endpoint of result.circuit.endpoints) {
              if (endpoint.converterDcConnection?.converterId === deviceId) {
                ownedEndpointIds.add(endpoint.id)
              }
            }
            ownedEndpointIds.forEach((id) => removedMemberIds.add(id))
            result.circuit.endpoints = result.circuit.endpoints.filter(
              (endpoint) => !ownedEndpointIds.has(endpoint.id)
            )
            result.circuit.branches = (result.circuit.branches ?? [])
              .map((candidate) => ({
                ...candidate,
                endpointIds: candidate.endpointIds.filter(
                  (endpointId) => !ownedEndpointIds.has(endpointId)
                ),
                branchDevices: candidate.branchDevices?.filter((device) => {
                  const isOwned =
                    device.id === deviceId || device.converterDcConnection?.converterId === deviceId
                  if (isOwned) removedMemberIds.add(device.id)
                  return !isOwned
                }),
              }))
              .filter(
                (candidate) =>
                  candidate.endpointIds.length > 0 || (candidate.branchDevices?.length ?? 0) > 0
              )
          } else {
            branch.branchDevices = branch.branchDevices.filter((device) => device.id !== deviceId)
          }
          for (const removedId of removedMemberIds) {
            cleanupPanelGridSlotsForDevice(panels, {
              kind: 'trunkDevice',
              id: removedId,
              scope: 'circuit',
              circuitId,
            })
          }
          pruneEendraadFrames(project, { removedMemberIds: [...removedMemberIds] })
          healPlanWiring(project)
          pruneStaleElectricalEndpointRecords(project)
          changed = true
          break
        }
        if (!result.circuit.trunkDevices) continue
        const index = result.circuit.trunkDevices.findIndex((d) => d.id === deviceId)
        if (index !== -1) {
          const [removed] = result.circuit.trunkDevices.splice(index, 1)
          const linkedDevices =
            removed?.type === 'conversion'
              ? result.circuit.trunkDevices.filter(
                  (device) => device.converterDcConnection?.converterId === deviceId
                )
              : []
          if (linkedDevices.length > 0) {
            const linkedIds = new Set(linkedDevices.map((device) => device.id))
            result.circuit.trunkDevices = result.circuit.trunkDevices.filter(
              (device) => !linkedIds.has(device.id)
            )
          }
          const removedBusDevices = [removed, ...linkedDevices].filter(
            (device): device is NonNullable<typeof device> => device?.type === 'dc_bus'
          )
          const removedDcBusBranchMemberIds = removedBusDevices.flatMap((bus) => {
            const ownedBranches = (result.circuit.branches ?? []).filter(
              (branch) => branch.dcBusId === bus.id
            )
            const endpointIds = new Set(ownedBranches.flatMap((branch) => branch.endpointIds))
            result.circuit.endpoints = result.circuit.endpoints.filter(
              (endpoint) => !endpointIds.has(endpoint.id)
            )
            result.circuit.branches = (result.circuit.branches ?? []).filter(
              (branch) => branch.dcBusId !== bus.id
            )
            return [
              ...ownedBranches.map((branch) => branch.id),
              ...ownedBranches.flatMap((branch) =>
                (branch.branchDevices ?? []).map((device) => device.id)
              ),
              ...endpointIds,
            ]
          })
          const dcBusRemovedIds = removedBusDevices.flatMap((bus) =>
            removeDcBusBranches(panels, bus.id, bus.dcBusProps?.branchCircuitIds ?? [])
          )
          const removedEmptyDcBranchIds =
            result.circuit.dcBusSource?.busId &&
            !('symbol' in result.parent) &&
            result.parent.directDcBusFeeder === true &&
            result.circuit.endpoints.length === 0 &&
            (result.circuit.trunkDevices?.length ?? 0) === 0 &&
            (result.circuit.subCircuitIds?.length ?? 0) === 0
              ? removeDcBusBranches(panels, result.circuit.dcBusSource.busId, [result.circuit.id])
              : []
          for (const endpoint of result.circuit.endpoints) {
            if (endpoint.converterDcConnection?.converterId === deviceId) {
              delete endpoint.converterDcConnection
            }
          }
          const deviceRef: PanelGridModuleRef = {
            kind: 'trunkDevice',
            id: deviceId,
            scope: 'circuit',
            circuitId,
          }
          cleanupPanelGridSlotsForDevice(panels, deviceRef)
          pruneEendraadFrames(project, {
            removedMemberIds: [
              deviceId,
              ...linkedDevices.map((device) => device.id),
              ...removedDcBusBranchMemberIds,
              ...dcBusRemovedIds,
              ...removedEmptyDcBranchIds,
            ],
          })
          syncSequentialEndpointBranchLabelsToCircuit(result.circuit, panel)
          changed = true
          break
        }
      }
    }
    if (changed) pruneOrphanJunctionPanelPlacements(project)
  }

  return changed
}

export function deleteSupplyTrunkDeviceInProject(project: ProjectV2, deviceId: string): boolean {
  let changed = false
  if (project) {
    // Project is supplied by the caller
    const installation = getProjectElectricalInstallation(project)
    const panels = getProjectElectricalPanels(project)
    if (!installation) return false
    const container = findSupplyDeviceContainer(project, deviceId)
    const devices = container?.devices
    if (devices) {
      const index = devices.findIndex((d) => d.id === deviceId)
      if (index !== -1) {
        const owningPanel = findPanelOwningSupplyDevice(project, deviceId)
        const target = devices[index]
        const removedIds = new Set([deviceId])
        if (target?.type === 'dc_bus') {
          devices.forEach((device) => {
            if (device.supplyDcBusId === target.id) removedIds.add(device.id)
          })
        }
        let downgradedGridOrder: string[] | undefined
        if (target?.symbol === 'source_changeover') {
          const backupOutputDevices = devices.filter(
            (device) => device.supplyPath === 'backup-output'
          )
          // Devices after the selector are on its load side even though they are
          // stored as ordinary serial devices. They belong to the selector branch and
          // must be removed with it instead of being left on the restored grid lane.
          const loadSideSerialDevices = devices
            .slice(index + 1)
            .filter((device) => device.supplyPath == null || device.supplyPath === 'serial')
          const changeoverOwnedDevices = [
            ...backupOutputDevices,
            ...loadSideSerialDevices,
            ...devices.filter((device) => device.supplyPath === 'changeover-grid'),
          ]
          changeoverOwnedDevices.forEach((device) => removedIds.add(device.id))
          const backupConverter = devices.find(
            (device) => device.supplyPath === 'backup' && device.symbol === 'inverter'
          )
          const downgraded =
            owningPanel && backupConverter
              ? downgradeChangeoverToDirectConverterAssembly(
                  project,
                  owningPanel.id,
                  target.id,
                  backupConverter
                )
              : undefined
          if (downgraded) {
            downgradedGridOrder = [
              ...devices.filter((device) => device.supplyPath === 'converter-grid'),
            ].map((device) => device.id)
            const assemblies = editProjectSupplyAssemblies(project)
            const assemblyIndex = assemblies.findIndex((assembly) => assembly.id === downgraded.id)
            if (assemblyIndex >= 0) assemblies[assemblyIndex] = downgraded
            else assemblies.push(downgraded)
          }
          devices.forEach((device) => {
            if (downgraded && device.id === backupConverter?.id) {
              device.supplyPath = 'converter-branch'
            } else if (
              !downgraded &&
              device.supplyPath &&
              new Set([
                'backup',
                'backup-output',
                'converter-grid',
                'converter-dc',
                'converter-dc-top',
                'converter-branch',
              ]).has(device.supplyPath)
            ) {
              removedIds.add(device.id)
            }
          })
        } else if (target?.supplyPath === 'converter-branch') {
          devices.forEach((device) => {
            if (device.supplyPath === 'converter-dc' || device.supplyPath === 'converter-dc-top')
              removedIds.add(device.id)
          })
          const dependentIds = removeConverterBackupDependents(panels, target.id)
          dependentIds.forEach((id) => removedIds.add(id))
        }
        // Taps that leave the wire after a removed device move to the nearest device before it.
        if (owningPanel)
          for (let pass = 0; pass < removedIds.size; pass++)
            if (![...removedIds].some((id) => retargetSupplyTapAnchors(owningPanel, devices, id))) break
        const removedDevices = devices.filter((device) => removedIds.has(device.id))
        for (let deviceIndex = devices.length - 1; deviceIndex >= 0; deviceIndex--) {
          if (removedIds.has(devices[deviceIndex]!.id)) {
            devices.splice(deviceIndex, 1)
          }
        }
        if (downgradedGridOrder?.length) {
          const order = new Map(downgradedGridOrder.map((id, orderIndex) => [id, orderIndex]))
          const gridDevices = devices
            .filter((device) => order.has(device.id))
            .sort((left, right) => order.get(left.id)! - order.get(right.id)!)
          for (let deviceIndex = devices.length - 1; deviceIndex >= 0; deviceIndex--) {
            if (order.has(devices[deviceIndex]!.id)) devices.splice(deviceIndex, 1)
          }
          const converterIndex = devices.findIndex(
            (device) => device.supplyPath === 'converter-branch'
          )
          devices.splice(converterIndex < 0 ? devices.length : converterIndex, 0, ...gridDevices)
        }
        devices.forEach((device, deviceIndex) => {
          device.trunkPosition = deviceIndex
        })
        const removed = removedDevices.find((device) => device.id === deviceId)
        if (
          removed?.symbol === 'source_changeover' ||
          removed?.supplyPath === 'backup' ||
          removed?.supplyPath === 'converter-branch'
        ) {
          const assemblies = editProjectSupplyAssemblies(project)
          for (let assemblyIndex = assemblies.length - 1; assemblyIndex >= 0; assemblyIndex--) {
            const assembly = assemblies[assemblyIndex]!
            if (
              assembly.nodes.some((node) => removedIds.has(node.deviceId ?? node.id)) ||
              assembly.connections.some((connection) =>
                connection.endpoints.some((endpoint) => removedIds.has(endpoint.nodeId))
              ) ||
              assembly.loadHandoffs.some((handoff) => removedIds.has(handoff.handoffNodeId))
            ) {
              assemblies.splice(assemblyIndex, 1)
            }
          }
        }
        if (
          owningPanel &&
          (removed?.supplyPath === 'backup-output' ||
            removed?.supplyPath === 'changeover-grid' ||
            removed?.supplyPath === 'converter-grid')
        ) {
          reconcileSupplyAssemblyBranchProtections(project, owningPanel.id)
          reconcileDirectConverterGridProtections(project, owningPanel.id)
        }
        if (
          owningPanel &&
          (removed?.supplyPath === 'converter-dc' || removed?.supplyPath === 'converter-dc-top')
        ) {
          reconcileDirectConverterDcDevices(project, owningPanel.id)
        }
        if (owningPanel && target?.symbol === 'source_changeover') {
          reconcileDirectConverterGridProtections(project, owningPanel.id)
          reconcileDirectConverterDcDevices(project, owningPanel.id)
          syncPanelBackupBusPhaseOrderInProject(project, owningPanel.id)
        }
        if (owningPanel) {
          reconcileSupplyAssemblyBranchProtections(project, owningPanel.id)
          reconcileDirectConverterCommonLoadPath(project, owningPanel.id)
        }
        for (const removedId of removedIds) {
          const deviceRef: PanelGridModuleRef = {
            kind: 'trunkDevice',
            id: removedId,
            scope: 'supply',
          }
          cleanupPanelGridSlotsForDevice(panels, deviceRef)
        }
        pruneEendraadFrames(project, { removedMemberIds: [...removedIds] })
        reconcileInvalidPanelFeedOrganizationsInProject(project)
        syncPanelAndSituationPlanDeviceVisibility(project)
        changed = true
      }
    }
    if (changed) pruneOrphanJunctionPanelPlacements(project)
  }

  return changed
}

export function deleteGroundTrunkDeviceInProject(project: ProjectV2, deviceId: string): boolean {
  let changed = false
  if (!project) return false
  // Project is supplied by the caller
  const installation = getEditableProjectElectricalInstallation(project)
  const panels = getEditableProjectElectricalPanels(project)
  if (!installation) return false
  const owner = findGroundTrunkDeviceOwner(panels, installation, deviceId)
  if (!owner) return false
  const idsToDelete = new Set(getEarthingSeparatorPairIds(owner.devices, deviceId))
  const removed = owner.devices.filter((device) => idsToDelete.has(device.id))
  if (removed.length === 0) return false
  if (owner.panel) {
    owner.panel.groundTrunkDevices = owner.devices.filter((device) => !idsToDelete.has(device.id))
  } else {
    installation.groundTrunkDevices = owner.devices.filter((device) => !idsToDelete.has(device.id))
  }
  for (const removedId of idsToDelete) {
    cleanupPanelGridSlotsForDevice(panels, {
      kind: 'trunkDevice',
      id: removedId,
      scope: 'ground',
    })
  }
  pruneEendraadFrames(project, { removedMemberIds: [...idsToDelete] })
  changed = true
  if (changed) pruneOrphanJunctionPanelPlacements(project)

  return changed
}
