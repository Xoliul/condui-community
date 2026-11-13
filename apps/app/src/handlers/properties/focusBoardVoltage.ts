import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'
import { getPrimaryPanelBusSectionId } from '@/lib/panel/panelBusSections'
import { focusSelectionOnCanvas } from '@/lib/ui/focusSelectionOnCanvas'

/** Select a board's busbar on the one-wire diagram, where its voltage is chosen, and bring it into view. */
export function focusBoardVoltage(panelId: string): void {
  const project = useProjectStore.getState().currentProject
  const panel = project ? findPanelById(getProjectElectricalPanels(project), panelId) : undefined
  if (!panel) return
  const busSectionId = getPrimaryPanelBusSectionId(panel)
  const selection = {
    type: 'busSection' as const,
    ids: [busSectionId],
    busSectionMetadata: { panelId, busSectionId },
  }
  useUIStore.getState().setSelection(selection)
  focusSelectionOnCanvas(selection, { preferredCanvas: 'eendraad' })
}
