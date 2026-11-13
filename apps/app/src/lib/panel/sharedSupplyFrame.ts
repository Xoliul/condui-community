import { getAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { resolveSupplyDeviceMounting } from './auxiliarySupplyEnclosures'
import { isSupplyDeviceVisibleInPanel } from './supplyPanelVisibility'
import { getProjectElectricalPanels, type ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import { DEFAULT_PANEL_GRID_COLUMNS, DEFAULT_PANEL_GRID_ROWS } from './panelGridDefaults'

export const SHARED_SUPPLY_FRAME_ID = 'shared-supply'

export function getSharedSupplyFrameDevices(project: ProjectWithOptionalV2Electrical) {
  return getAllSupplyTrunkDevices(project).filter((device) =>
    device.type !== 'junction_box' && device.type !== 'junction_panel' && device.type !== 'terminal_strip' &&
    resolveSupplyDeviceMounting(project, device.id)?.kind === 'grid' &&
    isSupplyDeviceVisibleInPanel(project, device.id)
  )
}

/**
 * Whether the board overview draws the shared supply frame. Panel scene and PDF export plan both
 * use this, so the export never asks for a page the scene did not draw.
 */
export function isSharedSupplyFrameVisible(project: ProjectWithOptionalV2Electrical): boolean {
  return (
    getSharedSupplyFrameDevices(project).length > 0 ||
    getProjectElectricalPanels(project).find((panel) => panel.isMain)?.gridView?.supplyPanelVisible !== false
  )
}

/** Dismiss the empty physical frame, retaining all electrical devices and connections. */
export function dismissEmptySharedSupplyFrame(project: ProjectWithOptionalV2Electrical): boolean {
  if (getSharedSupplyFrameDevices(project).length > 0) return false
  const owner = getProjectElectricalPanels(project).find((panel) => panel.isMain)
  if (!owner || owner.gridView?.supplyPanelVisible === false) return false
  owner.gridView ??= { rows: DEFAULT_PANEL_GRID_ROWS, columns: DEFAULT_PANEL_GRID_COLUMNS, feedFromTop: false, slots: [] }
  owner.gridView.supplyPanelVisible = false
  return true
}
