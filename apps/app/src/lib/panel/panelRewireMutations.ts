import type { ProjectV2 } from '@/types/projectV2'
import type { PanelGridModuleRef, TrunkDevice } from '@/types/schema'
import {
  getEditableProjectElectricalPanels,
  getEditableProjectElectricalInstallation,
  getProjectElectricalInstallation,
} from '@/lib/projectV2/electrical'
import { findPanelById } from './panelTree'
import { getPanelRewireOperation } from './panelRewire'
import {
  findCircuitById,
  findSupplyDeviceContainer,
  findPanelOwningSupplyDevice,
  applyAutomaticEendraadNamingAllPanelsInProject,
} from '@/lib/eendraad/projectElectricalDomain'
import { findParentCircuitInfo } from '@/lib/eendraad/findParentCircuitInfo'
import { promotePanelToRootSupply } from './panelSupplyMove'
import { attachRootPanelToExistingSupplyAssembly } from '@/lib/supplyAssembly/panelHandoff'
import {
  reconcileSupplyAssemblyBranchProtections,
  reconcileDirectConverterCommonLoadPath,
} from '@/lib/supplyAssembly/editorIntegration'
import { addSupplyTrunkDeviceInProject } from '@/lib/projectMutations/storeActions'
import { updateCircuitInProject } from '@/lib/eendraad/circuitMutations'
import { placeSupplyModuleAfterInsert } from './panelSupplySlots'
import {
  updatePanelGridSlotsInProject,
  updateSupplyPanelSlotsInProject,
} from './panelGridMutations'

function synchronizeSharedSupplyOrder(
  project: ProjectV2,
  devices: import('@/types/schema').TrunkDevice[]
) {
  const installation = getProjectElectricalInstallation(project)
  if (installation?.feedTopology && installation.mainSupply.supplyTrunkDevices === devices) {
    installation.feedTopology.sharedFeed.trunkDevices = [...devices]
  }
}

export function moveSupplyTrunkDeviceInProject(
  project: ProjectV2,
  deviceId: string,
  direction: 'left' | 'right'
): boolean {
  const devices = findSupplyDeviceContainer(project, deviceId)?.devices
  if (!devices) return false
  const index = devices.findIndex((device) => device.id === deviceId)
  const target = index + (direction === 'left' ? 1 : -1)
  if (index < 0 || target < 0 || target >= devices.length) return false
  ;[devices[index], devices[target]] = [devices[target]!, devices[index]!]
  devices.forEach((device, position) => {
    device.trunkPosition = position
  })
  synchronizeSharedSupplyOrder(project, devices)
  const owner = findPanelOwningSupplyDevice(project, deviceId)
  if (owner) {
    reconcileSupplyAssemblyBranchProtections(project, owner.id)
    reconcileDirectConverterCommonLoadPath(project, owner.id)
  }
  return true
}

export function rewireCircuitModulesInProject(
  project: ProjectV2,
  originCircuitId: string,
  targetCircuitId: string
): boolean {
  if (originCircuitId === targetCircuitId) return false
  const panels = getEditableProjectElectricalPanels(project)
  const find = (id: string) =>
    panels.map((panel) => findCircuitById(panel, id)?.circuit).find(Boolean)
  const origin = find(originCircuitId),
    target = find(targetCircuitId)
  if (!origin || !target) return false
  if (origin.subCircuitIds?.includes(targetCircuitId)) return false
  const reachesOrigin = (id: string, visited = new Set<string>()): boolean => {
    if (id === originCircuitId) return true
    if (visited.has(id)) return false
    visited.add(id)
    return find(id)?.subCircuitIds?.some((child) => reachesOrigin(child, visited)) ?? false
  }
  if (reachesOrigin(targetCircuitId)) return false
  const previous = findParentCircuitInfo(targetCircuitId, panels)?.parentCircuit
  if (previous) {
    const ids = previous.subCircuitIds?.filter((id) => id !== targetCircuitId) ?? []
    previous.subCircuitIds = ids.length ? ids : undefined
  }
  origin.subCircuitIds = [...(origin.subCircuitIds ?? []), targetCircuitId]
  applyAutomaticEendraadNamingAllPanelsInProject(project)
  return true
}

function moveSupplyTrunkDeviceAfterInProject(
  project: ProjectV2,
  deviceId: string,
  afterId: string
): boolean {
  const devices = findSupplyDeviceContainer(project, deviceId)?.devices
  if (!devices || devices !== findSupplyDeviceContainer(project, afterId)?.devices) return false
  const index = devices.findIndex((device) => device.id === deviceId)
  const afterIndex = devices.findIndex((device) => device.id === afterId)
  if (index < 0 || afterIndex < 0 || index === afterIndex + 1 || index === afterIndex) return false
  const [device] = devices.splice(index, 1)
  devices.splice(devices.findIndex((device) => device.id === afterId) + 1, 0, device!)
  devices.forEach((device, position) => {
    device.trunkPosition = position
  })
  synchronizeSharedSupplyOrder(project, devices)
  const owner = findPanelOwningSupplyDevice(project, deviceId)
  if (owner) {
    reconcileSupplyAssemblyBranchProtections(project, owner.id)
    reconcileDirectConverterCommonLoadPath(project, owner.id)
  }
  return true
}

export function rewirePanelModuleInProject(
  project: ProjectV2,
  panelId: string,
  origin: PanelGridModuleRef,
  target: PanelGridModuleRef | null,
  newId: () => string
): { changed: boolean; createdDeviceId?: string; removedProtectionId?: string } {
  const panels = getEditableProjectElectricalPanels(project)
  const panel = findPanelById(panels, panelId)
  const operation = getPanelRewireOperation(panel ?? null, project, origin, target)
  if (!panel || !operation) return { changed: false }
  if (operation.kind === 'connectProtectionToTerminalStrip') {
    const circuit = panels
      .map((root) => findCircuitById(root, operation.circuitId)?.circuit)
      .find(Boolean)
    if (!circuit) return { changed: false }
    const id = newId()
    const trunkDevice: TrunkDevice = {
      id,
      type: 'terminal_strip',
      symbol: 'terminal_strip',
      ...operation.terminalStrip,
      trunkPosition: 0,
    }
    const trunkDevices = [
      trunkDevice,
      ...(circuit.trunkDevices ?? [])
        .slice()
        .sort((left, right) => (left.trunkPosition ?? 0) - (right.trunkPosition ?? 0)),
    ]
    trunkDevices.forEach((device, index) => {
      device.trunkPosition = index
    })
    if (!updateCircuitInProject(project, operation.circuitId, { trunkDevices }))
      return { changed: false }
    return { changed: true, createdDeviceId: id }
  }
  if (operation.kind === 'promotePanelToRootSupply') {
    const installation = getEditableProjectElectricalInstallation(project)
    const changed =
      !!installation && !!promotePanelToRootSupply(panels, installation, operation.panelId)
    if (changed) attachRootPanelToExistingSupplyAssembly(project, operation.panelId)
    return { changed }
  }
  if (operation.kind === 'moveSharedSupplyDevice')
    return {
      changed:
        origin.kind === 'trunkDevice' &&
        moveSupplyTrunkDeviceAfterInProject(project, operation.targetSupplyId, origin.id),
    }
  if (operation.kind === 'detachCircuitFromSupplyParent') {
    const parent = panels
      .map((root) => findCircuitById(root, operation.parentCircuitId)?.circuit)
      .find(Boolean)
    if (!parent) return { changed: false }
    parent.subCircuitIds = operation.subCircuitIds
    applyAutomaticEendraadNamingAllPanelsInProject(project)
    return { changed: true }
  }
  if (operation.kind === 'rewireCircuit')
    return {
      changed: rewireCircuitModulesInProject(
        project,
        operation.originCircuitId,
        operation.targetCircuitId
      ),
    }
  const id = newId()
  addSupplyTrunkDeviceInProject(project, { id, ...operation.trunkDevice }, operation.insertIndex, {
    panelId,
    feedScope: operation.kind === 'promoteProtectionToRootSupply' ? 'root' : 'shared',
  })
  let removedProtectionId: string | undefined
  const remove = (owner: typeof panel): boolean => {
    const protection = owner.protections.find(
      (candidate) => candidate.id === operation.protectionId
    )
    if (protection?.circuits?.some((circuit) => circuit.id === operation.circuit.id)) {
      protection.circuits = protection.circuits.filter(
        (circuit) => circuit.id !== operation.circuit.id
      )
      if (!protection.circuits.length) {
        owner.protections = owner.protections.filter((candidate) => candidate.id !== protection.id)
        removedProtectionId = protection.id
      }
      return true
    }
    return owner.subPanels.some(remove)
  }
  if (!panels.some(remove)) throw new Error('Protection ownership changed during rewire')
  panel.circuits.push(operation.circuit)
  // Remove obsolete protection refs before packing the replacement supply device.
  if (removedProtectionId) {
    const cleanup = (owner: typeof panel) => {
      if (owner.gridView) {
        owner.gridView.slots = owner.gridView.slots.filter(
          (slot) => !(slot.module.kind === 'protection' && slot.module.id === removedProtectionId)
        )
        owner.gridView.supplyPanelSlots = owner.gridView.supplyPanelSlots?.filter(
          (slot) => !(slot.module.kind === 'protection' && slot.module.id === removedProtectionId)
        )
        owner.gridView.hiddenModuleKeys = owner.gridView.hiddenModuleKeys?.filter(
          (key) => key !== `protection:${removedProtectionId}`
        )
        owner.gridView.shownModuleKeys = owner.gridView.shownModuleKeys?.filter(
          (key) => key !== `protection:${removedProtectionId}`
        )
      }
      owner.subPanels.forEach(cleanup)
    }
    panels.forEach(cleanup)
  }
  const { mainSlots, supplySlots } = placeSupplyModuleAfterInsert(panel, project, {
    kind: 'trunkDevice',
    id,
    scope: 'supply',
  })
  updatePanelGridSlotsInProject(project, panelId, mainSlots)
  updateSupplyPanelSlotsInProject(project, panelId, supplySlots)
  applyAutomaticEendraadNamingAllPanelsInProject(project)
  return { changed: true, createdDeviceId: id, removedProtectionId }
}
