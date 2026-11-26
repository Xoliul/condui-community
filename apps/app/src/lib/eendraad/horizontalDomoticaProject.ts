import { useProjectStore } from '@/stores/projectStore'
import { findCircuitOwner, findEndpointById } from '@/lib/eendraad/projectElectricalDomain'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import {
  getHorizontalDomoticaSwitchBlock,
  type HorizontalDomoticaSwitchBlock,
} from '@/lib/eendraad/horizontalDomoticaTerminal'

/** Why the module in the open project cannot become horizontal, or null (see the terminal rule). */
export function getOpenProjectHorizontalSwitchBlock(
  endpointId: string
): HorizontalDomoticaSwitchBlock | null {
  const project = useProjectStore.getState().currentProject
  if (!project) return 'not_a_module'
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const found = findEndpointById(panel, endpointId)
    if (found)
      return getHorizontalDomoticaSwitchBlock(
        found.circuit,
        endpointId,
        findCircuitOwner(getEditableProjectElectricalPanels(project), found.circuit.id) ?? undefined
      )
  }
  return 'not_a_module'
}
