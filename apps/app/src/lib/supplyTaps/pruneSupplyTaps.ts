import { walkPanels } from '@/lib/panel/panelTree'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import type { ProjectV2 } from '@/types/projectV2'
import { isSupplyTapsPanel, isSupplyTapsPanelEmpty } from './virtualPanel'

/** Removes supply-taps boards that no longer hold a tap. Returns true when one was removed. */
export function removeEmptySupplyTapsPanels(project: ProjectV2): boolean {
  let removed = false
  for (const owner of [...walkPanels(getEditableProjectElectricalPanels(project))]) {
    const empty = (owner.subPanels ?? []).filter(
      (panel) => isSupplyTapsPanel(panel) && isSupplyTapsPanelEmpty(panel)
    )
    if (empty.length === 0) continue
    owner.subPanels = owner.subPanels.filter((panel) => !empty.includes(panel))
    removed = true
  }
  return removed
}
