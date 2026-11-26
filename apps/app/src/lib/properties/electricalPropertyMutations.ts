import type { ProjectV2 } from '@/types/projectV2'
import type { Panel, Circuit, TrunkDevice, PanelGridModuleRef } from '@/types/schema'
import { findPanelById, walkPanels } from '@/lib/panel/panelTree'
import {
  getEditableProjectElectricalPanels,
  getEditableProjectElectricalInstallation,
} from '@/lib/projectV2/electrical'
import { cascadeMainEarthingToPanels } from '@/lib/panel/panelEarthingSync'
import {
  syncManualChronologyForInstallDateUpdate,
  clearStaleAutoModuleWidthForModuleRef,
  maybeApplyAutomaticEendraadNamingForPanel,
  findCircuitById,
} from '@/lib/eendraad/projectElectricalDomain'
import { getModuleWidthInCols } from '@/lib/panel/panelGridLayout'
import { resolveUniqueSupplyProtectionLabelOnPanel } from '@/lib/eendraad/automaticMainBusNaming'
import { findGroundTrunkDeviceOwner } from '@/lib/eendraad/panelGround'
import { normalizeProtectionCapacityUpdates } from '@/lib/protectionDefaults'
export function updatePanelPropertiesInProject(
  project: ProjectV2,
  id: string,
  updates: Partial<Panel>
): boolean {
  const panels = getEditableProjectElectricalPanels(project)
  const panel = findPanelById(panels, id)
  if (!panel) return false
  const updatesToApply = { ...updates }
  if (typeof updatesToApply.name === 'string' && updatesToApply.name.trim().length === 0) {
    delete updatesToApply.name
  }
  if (Object.keys(updatesToApply).length === 0) return false
  const previousName = panel.name
  const uniquePreviousName = typeof updatesToApply.name === 'string' &&
    ![...walkPanels(panels)].some((other) => other.id !== id && other.name === previousName)
  const isMainEarthingUpdate =
    panel.isMain && Object.prototype.hasOwnProperty.call(updatesToApply, 'earthingSystem')
  const previousMainEarthing = isMainEarthingUpdate ? panel.earthingSystem : undefined
  Object.assign(panel, updatesToApply)
  syncManualChronologyForInstallDateUpdate(project, { id, type: 'panel' }, updatesToApply)
  if (isMainEarthingUpdate) {
    cascadeMainEarthingToPanels(
      getEditableProjectElectricalPanels(project),
      panel,
      panel.earthingSystem,
      previousMainEarthing
    )
  }
  // Keep the panel_distribution endpoint label aligned with panel.name.
  // This avoids false orphan warnings right after renaming a panel.
  if (typeof updatesToApply.name === 'string' && updatesToApply.name.trim().length > 0) {
    const syncCircuitEndpoints = (circuit: Circuit, ownerId: string) => {
      for (const endpoint of circuit.endpoints ?? []) {
        if (endpoint.symbol !== 'panel_distribution') continue
        const matchesPanel = endpoint.panelId
          ? endpoint.panelId === id
          : circuit.code === 'PANEL'
            ? ownerId === id
            : uniquePreviousName && endpoint.label === previousName
        if (matchesPanel) {
          endpoint.label = panel.name
          endpoint.panelId = panel.id
        }
      }
    }
    for (const owner of walkPanels(panels)) {
      for (const circuit of owner.circuits ?? []) {
        syncCircuitEndpoints(circuit, owner.id)
      }
      for (const protection of owner.protections ?? []) {
        for (const circuit of protection.circuits ?? []) {
          syncCircuitEndpoints(circuit, owner.id)
        }
      }
    }
  }

  return true
}
export function updateCircuitTrunkPropertiesInProject(
  project: ProjectV2,
  circuitId: string,
  deviceId: string,
  updates: Partial<TrunkDevice>
): boolean {
  const panels = getEditableProjectElectricalPanels(project)
  for (const panel of panels) {
    const result = findCircuitById(panel, circuitId)
    if (result) {
      const device =
        result.circuit.trunkDevices?.find((d) => d.id === deviceId) ??
        result.circuit.branches
          ?.flatMap((branch) => branch.branchDevices ?? [])
          .find((d) => d.id === deviceId)
      if (device) {
        updates = normalizeProtectionCapacityUpdates(updates, device)
        const trunkRef: PanelGridModuleRef = {
          kind: 'trunkDevice',
          id: deviceId,
          scope: 'circuit',
          circuitId,
        }
        const oldPoleWidth = getModuleWidthInCols(trunkRef, project)
        const oldLabel = typeof device.label === 'string' ? device.label.trim() : ''
        const nextUpdates =
          result.circuit.code === 'PANEL' &&
          device.type === 'protection' &&
          typeof updates.label === 'string' &&
          getEditableProjectElectricalInstallation(project)?.eendraadAutomaticNaming
            ? {
                ...updates,
                label: resolveUniqueSupplyProtectionLabelOnPanel(
                  panel,
                  project,
                  deviceId,
                  updates.label
                ),
              }
            : updates
        Object.assign(device, nextUpdates)
        syncManualChronologyForInstallDateUpdate(
          project,
          { id: deviceId, type: 'trunkDevice' },
          nextUpdates
        )
        const newPoleWidth = getModuleWidthInCols(trunkRef, project)
        if (oldPoleWidth !== newPoleWidth) {
          clearStaleAutoModuleWidthForModuleRef(panels, trunkRef, oldPoleWidth)
        }
        const newLabel = typeof nextUpdates.label === 'string' ? nextUpdates.label.trim() : oldLabel
        if (
          result.circuit.code === 'PANEL' &&
          Object.prototype.hasOwnProperty.call(updates, 'label') &&
          newLabel !== oldLabel &&
          getEditableProjectElectricalInstallation(project)?.eendraadAutomaticNaming
        ) {
          maybeApplyAutomaticEendraadNamingForPanel(project, panel.id)
        }
        return true
      }
    }
  }

  return false
}
export function updateGroundTrunkPropertiesInProject(
  project: ProjectV2,
  deviceId: string,
  updates: Partial<TrunkDevice>
): boolean {
  const owner = findGroundTrunkDeviceOwner(
    getEditableProjectElectricalPanels(project),
    getEditableProjectElectricalInstallation(project),
    deviceId
  )
  const device = owner?.devices[owner.index]
  if (!device) return false
  updates = normalizeProtectionCapacityUpdates(updates, device)
  Object.assign(device, updates)
  syncManualChronologyForInstallDateUpdate(project, { id: deviceId, type: 'trunkDevice' }, updates)
  return true
}
