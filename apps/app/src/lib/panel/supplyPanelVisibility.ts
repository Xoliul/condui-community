import { getAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { resolveSupplyDeviceMounting } from '@/lib/panel/auxiliarySupplyEnclosures'
import { findPanelById } from '@/lib/panel/panelTree'
import {
  getProjectElectricalPanels,
  selectProjectAuxiliaryElectricalEnclosures,
  selectProjectSupplyAssemblies,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { Panel, TrunkDevice } from '@/types/schema'

export function isInverterPanelDevice(device: TrunkDevice | undefined): boolean {
  return device?.symbol === 'inverter'
}

function isDcSupplyFuse(project: ProjectWithOptionalV2Electrical, deviceId: string): boolean {
  return selectProjectSupplyAssemblies(project).some((assembly) => {
    const fuseNode = assembly.nodes.find(
      (node) =>
        (node.deviceId ?? node.id) === deviceId &&
        node.kind === 'protection' &&
        node.symbol === 'fuse',
    )
    if (!fuseNode) return false
    return assembly.connections.some(
      (connection) =>
        connection.domain === 'DC' &&
        connection.endpoints.some((endpoint) => endpoint.nodeId === fuseNode.id),
    )
  })
}

/** Visibility belongs to the physical surface; slots specify positions, never visibility. */
export function getSupplyDeviceVisibilitySurface(
  project: ProjectWithOptionalV2Electrical,
  deviceId: string,
): { id: string; gridView?: Panel['gridView']; ownerPanelId?: string } | undefined {
  const mounting = resolveSupplyDeviceMounting(project, deviceId)
  const panels = getProjectElectricalPanels(project)
  if (mounting?.kind === 'auxiliary') {
    const enclosure = selectProjectAuxiliaryElectricalEnclosures(project).find(
      (candidate) => candidate.id === mounting.enclosureId,
    )
    return enclosure
  }
  const panel = mounting?.kind === 'panel'
    ? findPanelById(panels, mounting.panelId)
    : panels.find((candidate) => candidate.isMain)
  return panel
}

export function isSupplyDeviceVisibleInPanel(
  project: ProjectWithOptionalV2Electrical,
  deviceId: string,
): boolean {
  const device = getAllSupplyTrunkDevices(project).find((candidate) => candidate.id === deviceId)
  if (!device) return false
  const grid = getSupplyDeviceVisibilitySurface(project, deviceId)?.gridView
  const key = `trunkDevice:${deviceId}:supply`
  if (grid?.hiddenModuleKeys?.includes(key)) return false
  if (grid?.shownModuleKeys?.includes(key)) return true
  return !isInverterPanelDevice(device) && !isDcSupplyFuse(project, deviceId)
}

/** Set the choice on the mounted surface, even when the menu uses its owning panel. */
export function setSupplyDevicePanelVisibility(
  project: ProjectWithOptionalV2Electrical,
  deviceId: string,
  visible: boolean,
): boolean {
  const surface = getSupplyDeviceVisibilitySurface(project, deviceId)
  if (!surface) return false
  surface.gridView ??= { rows: 8, columns: 12, feedFromTop: false, slots: [] }
  const grid = surface.gridView
  const key = `trunkDevice:${deviceId}:supply`
  const target = visible ? 'shownModuleKeys' : 'hiddenModuleKeys'
  const opposite = visible ? 'hiddenModuleKeys' : 'shownModuleKeys'
  let changed = false
  if (!grid[target]?.includes(key)) {
    grid[target] = [...(grid[target] ?? []), key]
    changed = true
  }
  if (grid[opposite]?.includes(key)) {
    grid[opposite] = grid[opposite]!.filter((candidate) => candidate !== key)
    changed = true
  }
  return changed
}
