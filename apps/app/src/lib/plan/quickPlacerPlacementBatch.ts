import type { CommandInvocation } from '@/lib/commands/project'
import { resolvePlanPlacement } from '@/lib/plan/placementMutations'
import { isUserHiddenPlanPlacement } from '@/lib/plan/quickPlacer'
import type { ProjectV2 } from '@/types/projectV2'
import type { Placement } from '@/types/schema'

/**
 * Commands that put a quick placer symbol on a floor at a position, optionally rotated, as
 * one undo step. A symbol the user hid from the plan is shown again first, so placing it
 * actually puts it back on the plan.
 */
export function buildQuickPlacerPlacementBatch(
  project: ProjectV2 | null,
  placementId: string,
  updates: Pick<Partial<Placement>, 'floorId' | 'pos' | 'rotationDeg'>
): CommandInvocation[] {
  const { floorId, pos, rotationDeg } = updates
  const batch: CommandInvocation[] = []
  if (floorId)
    batch.push({ id: 'plan.moveToFloor', input: { floorId, moves: [{ placementId, pos }] } })
  if (rotationDeg != null || (!floorId && pos))
    batch.push({
      id: 'plan.movePlacements',
      input: { moves: [{ placementId, rotationDeg, ...(floorId ? {} : { pos }) }] },
    })
  if (batch.length === 0 || !project || !isUserHiddenPlanPlacement(project, placementId))
    return batch
  const target = resolvePlanPlacement(project, placementId)
  if (!target) return batch
  return [
    {
      id: 'plan.showHiddenPlacements',
      input: {
        floorId: floorId ?? target.placement.floorId,
        layer: target.placement.layer,
        placementIds: [placementId],
      },
    },
    ...batch,
  ]
}
