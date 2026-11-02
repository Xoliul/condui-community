import { z } from 'zod'
import { moveEndpointsToFloorInProject } from '@/lib/eendraad/moveEndpointsToFloor'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import { defineProjectCommand } from '../types'

const point = z.strictObject({ x: z.number().finite(), y: z.number().finite() })

/** Moves one-wire endpoints to a plan floor, placing endpoints that are not on the plan yet. */
export const planMoveEndpointsToFloor = defineProjectCommand({
  id: 'plan.moveEndpointsToFloor',
  version: 1,
  input: z.strictObject({
    endpointIds: z.array(z.string().min(1)).min(1),
    floorId: z.string().min(1),
    activeFloorId: z.string().nullable().optional(),
    preferredPlanPos: point.optional(),
  }),
  check(project, input) {
    return selectProjectBuildingFloors(project).some((floor) => floor.id === input.floorId)
      ? { ok: true }
      : { ok: false, code: 'floor_not_found', message: 'Floor not found' }
  },
  apply(draft, input, env) {
    const result = moveEndpointsToFloorInProject(draft, input.endpointIds, input.floorId, {
      activeFloorId: input.activeFloorId ?? null,
      preferredPlanPos: input.preferredPlanPos,
      newId: env.newId,
    })
    return {
      created: result.createdPlacementIds.map((id) => ({ kind: 'placement' as const, id })),
      changed: [
        ...result.endpointIds.map((id) => ({ kind: 'endpoint' as const, id })),
        ...result.movedPlacementIds.map((id) => ({ kind: 'placement' as const, id })),
      ],
      removed: [],
    }
  },
})
