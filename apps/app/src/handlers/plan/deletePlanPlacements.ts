import type { TFunction } from 'i18next'
import { openSituationPlanBulkDeleteWarning } from '@/components/plan/SituationPlanBulkDeleteWarningDialog'
import { CommandError, type CommandInvocation } from '@/lib/commands/project'
import { logger } from '@/lib/logger'
import type { PlanPlacementDeletion } from '@/lib/plan/placementMutations'
import { liveProjectSession } from '@/stores/liveProjectCommandSession'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { hidePlanPlacementsOnFloor } from './hidePlanPlacements'

export interface DeletePlanPlacementsRequest {
  placementIds: readonly string[]
  t: TFunction
  /** Hides the placements instead (offered by the bulk-delete warning). */
  onHide: (placementIds: string[]) => void
  onDone: () => void
}

/**
 * Deletes a situation-plan selection through `entities.delete`: previews what goes, lets the
 * bulk-delete warning confirm larger selections, and runs against the previewed revision. If
 * the project changed while the warning was open, the request starts over for a fresh
 * confirmation. Returns false when nothing in the selection can be deleted.
 */
export function requestDeletePlanPlacements(request: DeletePlanPlacementsRequest): boolean {
  const invocation: CommandInvocation = {
    id: 'entities.delete',
    input: { refs: request.placementIds.map((id) => ({ kind: 'placement', id })) },
  }
  let preview
  try {
    preview = liveProjectSession.preview(invocation)
  } catch (error) {
    if (error instanceof CommandError) return false
    throw error
  }
  if (!preview.check.ok) return false
  const deletion = preview.check.preview as PlanPlacementDeletion
  const deletableIds = request.placementIds.filter(
    (id) => !deletion.blockedPlacementIds.includes(id)
  )

  const runDelete = () => {
    try {
      liveProjectSession.execute([invocation], {
        expectedRevision: preview.revision,
        label: 'delete plan selection',
      })
    } catch (error) {
      if (!(error instanceof CommandError)) throw error
      if (error.code === 'stale_revision') {
        // Ask again once the warning has closed, with what the selection deletes now.
        queueMicrotask(() => requestDeletePlanPlacements(request))
        return
      }
      logger.warn('[ProjectCommand] plan delete rejected', { code: error.code })
    }
    request.onDone()
  }

  const opened = openSituationPlanBulkDeleteWarning({
    projectId: useProjectStore.getState().currentProject?.project.id ?? '',
    placementIds: deletableIds,
    t: request.t,
    onDelete: runDelete,
    onHide: () => {
      request.onHide(deletableIds)
      request.onDone()
    },
  })
  if (!opened) runDelete()
  return true
}

/** Hides placements in the active floor's view (the bulk-delete warning's alternative). */
export function hidePlanPlacementsOnActiveFloor(placementIds: string[]): void {
  const activeFloorId = useUIStore.getState().activeFloorId
  if (!activeFloorId) return
  hidePlanPlacementsOnFloor(activeFloorId, placementIds)
}
