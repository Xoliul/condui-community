import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import { useUIStore } from '@/stores/uiStore'

/**
 * Hides placements in one floor's situation-plan view (one undo step). The panel the editor
 * shows first takes over newly visible placements, so it travels with the command.
 */
export function hidePlanPlacementsOnFloor(floorId: string, placementIds: readonly string[]): boolean {
  if (placementIds.length === 0) return false
  const outcome = runProjectCommand(
    'plan.setPlacementsHidden',
    {
      floorId,
      placementIds: [...placementIds],
      hidden: true,
      activePanelId: useUIStore.getState().activePanelId,
    },
    { label: 'hide situation plan symbols' }
  )
  return !!outcome?.changed
}
