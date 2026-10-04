import { useProjectStore } from '@/stores/projectStore'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import type { Endpoint } from '@/types/schema'
import { getControlLinkLabel } from './controlLink'

/**
 * Resolved control-link note for an endpoint, or undefined when it has no valid link.
 * Renderers pass it to `getVisibleEndpointNoteText` so painted text matches the layout.
 */
export function useControlLinkNote(endpoint: Pick<Endpoint, 'controlLink'> | undefined): string | undefined {
  return useProjectStore((state) => {
    const link = endpoint?.controlLink
    const project = state.currentProject
    if (!link || !project) return undefined
    return getControlLinkLabel(getProjectElectricalPanels(project), link)
  })
}
