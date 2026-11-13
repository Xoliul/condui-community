import { z } from 'zod'
import {
  movePlanPlacementsToFloorInProject,
  resolvePlanPlacement,
  updateEarthingPlacementInProject,
  updateJunctionPanelPlacementInProject,
  updatePlacementInProject,
} from '@/lib/plan/placementMutations'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import { isAwaitingPlanPlacement } from '@/lib/plan/customPlacement'
import { collectPlanPlacementIdentityConflicts } from '@/lib/plan/planPlacementIdentity'
import type { ProjectV2 } from '@/types/projectV2'
import { defineProjectCommand, type CommandCheck, type EntityRef } from '../types'

const point = z.object({ x: z.number().finite(), y: z.number().finite() })

function checkPlacementsExist(project: ProjectV2, placementIds: readonly string[]): CommandCheck {
  const ambiguous = collectPlanPlacementIdentityConflicts(project)
    .find((conflict) => placementIds.includes(conflict.placementId))
  if (ambiguous) return {
    ok: false,
    code: 'ambiguous_placement',
    message: 'Repair the shared situation-plan placement before moving it',
    details: { placementId: ambiguous.placementId },
  }
  for (const placementId of placementIds) {
    const target = resolvePlanPlacement(project, placementId)
    if (!target) {
      return {
        ok: false,
        code: 'placement_not_found',
        message: 'Placement not found',
        details: { placementId },
      }
    }
  }
  return { ok: true }
}

const placementRefs = (ids: Iterable<string>): EntityRef[] =>
  [...new Set(ids)].map((id) => ({ kind: 'placement', id }))

/**
 * Moves and/or rotates situation-plan symbols on their floor (drag end, nudge, drag-end wall
 * snapping) as one change. Locked placements are skipped; junction panel and earthing
 * placements only take a position.
 */
export const planMovePlacements = defineProjectCommand({
  id: 'plan.movePlacements',
  version: 1,
  input: z.object({
    moves: z
      .array(
        z
          .object({
            placementId: z.string().min(1),
            pos: point.optional(),
            rotationDeg: z.number().finite().optional(),
          })
          .refine((move) => move.pos != null || move.rotationDeg != null, {
            message: 'A move needs a position or a rotation',
          })
      )
      .min(1),
  }),
  check(project, input) {
    return checkPlacementsExist(
      project,
      input.moves.map((move) => move.placementId)
    )
  },
  apply(draft, input) {
    const project = draft as ProjectV2
    const related: EntityRef[] = []
    const moved: string[] = []
    for (const { placementId, pos, rotationDeg } of input.moves) {
      const target = resolvePlanPlacement(project, placementId)!
      if (target.kind === 'junctionPanel' || target.kind === 'earthing') {
        if (!pos) continue
        if (target.kind === 'junctionPanel') {
          if (!updateJunctionPanelPlacementInProject(project, placementId, { pos })) continue
        } else {
          if (!updateEarthingPlacementInProject(project, placementId, { pos })) continue
        }
      } else {
        // Locked placements stay put; the result lists only what changed.
        if (target.placement.locked) continue
        const updated = updatePlacementInProject(project, placementId, {
          ...(pos ? { pos } : {}),
          ...(rotationDeg != null ? { rotationDeg } : {}),
        })
        if (!updated) continue
        if (updated?.circuitId) related.push({ kind: 'circuit', id: updated.circuitId })
      }
      moved.push(placementId)
    }
    return { created: [], changed: placementRefs(moved), removed: [], related }
  },
})

/**
 * Moves situation-plan symbols to another floor, optionally to new positions. Manual wires
 * travel along when both ends move; wires left with one moved end are removed.
 */
export const planMoveToFloor = defineProjectCommand({
  id: 'plan.moveToFloor',
  version: 1,
  input: z.object({
    floorId: z.string().min(1),
    moves: z.array(z.object({ placementId: z.string().min(1), pos: point.optional() })).min(1),
  }),
  check(project, input) {
    if (!selectProjectBuildingFloors(project).some((floor) => floor.id === input.floorId)) {
      return { ok: false, code: 'floor_not_found', message: 'Floor not found' }
    }
    return checkPlacementsExist(
      project,
      input.moves.map((move) => move.placementId)
    )
  },
  apply(draft, input) {
    const changedIds = input.moves
      .filter(({ placementId, pos }) => {
        const target = resolvePlanPlacement(draft as ProjectV2, placementId)!
        return (
          target.placement.floorId !== input.floorId ||
          (pos &&
            (target.placement.pos.x !== pos.x ||
              target.placement.pos.y !== pos.y ||
              (target.kind === 'standard' && isAwaitingPlanPlacement(target.placement))))
        )
      })
      .map((move) => move.placementId)
    if (changedIds.length === 0) return { created: [], changed: [], removed: [] }
    const moved = movePlanPlacementsToFloorInProject(
      draft as ProjectV2,
      input.moves.map((move) => ({ id: move.placementId, pos: move.pos })),
      input.floorId
    )
    if (!moved) throw new Error('Placements could not be moved to the floor')
    return {
      created: [],
      changed: placementRefs(changedIds),
      removed: [],
    }
  },
})
