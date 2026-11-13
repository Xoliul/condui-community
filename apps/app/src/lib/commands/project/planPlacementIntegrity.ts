import type { ProjectV2 } from '@/types/projectV2'
import { newlyConflictingPlanPlacementId } from '@/lib/plan/planPlacementIdentity'
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
