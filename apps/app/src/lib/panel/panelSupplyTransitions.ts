import { getPanelGridFieldLayout, getPanelGridTotalColumns } from '@/lib/panel/panelGridFields'
import type { ProjectV2 } from '@/types/projectV2'
import type { PanelGridModuleRef } from '@/types/schema'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { findPanelById } from './panelTree'
import { ejectSupplyTrunkFromMainGridSlot } from './healSupplyTrunkGrid'
import { setSupplyDeviceMounting } from './auxiliarySupplyEnclosures'
import { panelGridModuleRefKey, resolveModuleWidthCols } from './panelGridLayout'
import { findFirstFreeMainOrOverflowSlot } from './autoArrangeLayout'

export function ejectToSupplyPanelInProject(
  project: ProjectV2,
  panelId: string,
  module: PanelGridModuleRef
): boolean {
  const panel = findPanelById(getProjectElectricalPanels(project), panelId)
  if (!panel || !ejectSupplyTrunkFromMainGridSlot(panel, project, module)) return false
  if (module.kind === 'trunkDevice' && module.scope === 'supply')
    setSupplyDeviceMounting(project, module.id, { kind: 'grid' })
  return true
}

export function returnFromSupplyPanelInProject(
  project: ProjectV2,
  panelId: string,
  module: PanelGridModuleRef
): boolean {
  const panel = findPanelById(getProjectElectricalPanels(project), panelId),
    grid = panel?.gridView
  if (!grid) return false
  const key = panelGridModuleRefKey(module),
    slot = grid.supplyPanelSlots?.find((slot) => panelGridModuleRefKey(slot.module) === key)
  if (!slot) return false
  const spot = findFirstFreeMainOrOverflowSlot(
    grid.slots.map((slot) => ({
      row: slot.row,
      col: slot.col,
      width: resolveModuleWidthCols(slot.module, project, slot),
    })),
    resolveModuleWidthCols(module, project, slot),
    grid.rows,
    getPanelGridTotalColumns(grid),
    grid.feedFromTop,
    getPanelGridFieldLayout(grid)
  )
  grid.supplyPanelSlots = grid.supplyPanelSlots!.filter(
    (slot) => panelGridModuleRefKey(slot.module) !== key
  )
  grid.slots.push({ ...slot, row: spot.row, col: spot.col })
  if (!grid.supplyPanelSlots.length) {
    grid.supplyPanelSlots = undefined
    grid.supplyPanelVisible = false
  }
  if (module.kind === 'trunkDevice' && module.scope === 'supply')
    setSupplyDeviceMounting(project, module.id, { kind: 'panel', panelId })
  return true
}

export function setSupplyPanelVisibleInProject(
  project: ProjectV2,
  panelId: string,
  visible: boolean
): boolean {
  const panel = findPanelById(getProjectElectricalPanels(project), panelId),
    grid = panel?.gridView
  if (!grid) return false
  let changed = false
  if (!visible)
    for (const slot of [...(grid.supplyPanelSlots ?? [])])
      changed = returnFromSupplyPanelInProject(project, panelId, slot.module) || changed
  if (grid.supplyPanelVisible !== visible) {
    grid.supplyPanelVisible = visible
    changed = true
  }
  return changed
}
