import type { ProjectV2 } from '@/types/projectV2'
import { newlyConflictingPlanPlacementId } from '@/lib/plan/planPlacementIdentity'
import { newDuplicateIdentities } from '@/lib/projectV2/entityIdentity'
import { CommandError } from './types'

export function assertNoNewPlanPlacementConflicts(before: ProjectV2, after: ProjectV2): void {
  const placementId = newlyConflictingPlanPlacementId(before, after)
  if (placementId !== undefined)
    throw new CommandError(
      'check_failed',
      'This edit would give multiple symbols the same situation-plan placement',
      { reason: 'plan_placement_identity_conflict', cause: { placementId } }
    )
}

/**
 * Every edit, whatever path it takes (duplicate, paste, copy to floor, import, board creation),
 * must give each new entity its own ID. A batch that would add a second copy of a stored ID is
 * rejected before anything is saved; existing duplicates are left for the orphan repair.
 */
export function assertNoNewDuplicateIds(before: ProjectV2, after: ProjectV2): void {
  if (
    before.disciplines?.electrical === after.disciplines?.electrical &&
    before.building === after.building &&
    before.elements === after.elements
  )
    return
  const [duplicate] = newDuplicateIdentities(before, after)
  if (duplicate)
    throw new CommandError('check_failed', `This edit would give two ${duplicate.kind}s the same ID`, {
      reason: 'duplicate_entity_id',
      cause: duplicate,
    })
}
