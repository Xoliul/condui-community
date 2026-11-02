import { z } from 'zod'
import { updatePlanWiringVisibilityInProject } from '@/lib/plan/planWiringVisibilityMutation'
import { updateFloorInProject } from '@/lib/projectMutations/storeActions'
import { readLegacyCompatibilityFloors } from '@/lib/projectV2/buildingFloors'
import type { ProjectV2 } from '@/types/projectV2'
import { defineProjectCommand } from '../types'

const heightM = z.number().finite().positive()
const wireToolCategories = z.strictObject({
  lighting: z.boolean().optional(),
  sockets: z.boolean().optional(),
  devices: z.boolean().optional(),
  feeders: z.boolean().optional(),
  supply: z.boolean().optional(),
  dc: z.boolean().optional(),
  earthing: z.boolean().optional(),
  other: z.boolean().optional(),
})

/** Wire visibility, wire style and cable-route settings; colours belong to `plan.setColors`. */
export const planSetWiringVisibilityInputSchema = z.strictObject({
  wiresVisible: z.boolean().optional(),
  lightingVisible: z.boolean().optional(),
  socketsVisible: z.boolean().optional(),
  otherVisible: z.boolean().optional(),
  homeRunsVisible: z.boolean().optional(),
  branchFeedsVisible: z.boolean().optional(),
  supplyVisible: z.boolean().optional(),
  wireToolWiresVisible: z.boolean().optional(),
  wireToolCategoriesVisible: wireToolCategories.optional(),
  cableRouteSettings: z
    .strictObject({
      floorHeightM: heightM.optional(),
      socketHeightM: heightM.optional(),
      switchHeightM: heightM.optional(),
      panelHeightM: heightM.optional(),
    })
    .optional(),
  defaultStyle: z.enum(['spline', 'orthogonal', 'straight']).optional(),
})
export type PlanSetWiringVisibilityInput = z.input<typeof planSetWiringVisibilityInputSchema>

/** Shows or hides plan wires per category and sets the default wire style and route heights. */
export const planSetWiringVisibility = defineProjectCommand({
  id: 'plan.setWiringVisibility',
  version: 1,
  input: planSetWiringVisibilityInputSchema,
  check(project) {
    return project.disciplines?.electrical
      ? { ok: true }
      : { ok: false, code: 'electrical_missing', message: 'Electrical discipline not found' }
  },
  apply(draft, input, env) {
    const changed = updatePlanWiringVisibilityInProject(draft as ProjectV2, input, env.now())
    return {
      created: [],
      changed: changed ? [{ kind: 'project', id: draft.project.id }] : [],
      removed: [],
    }
  },
})

/** Sets the situation-plan symbol size of one floor. */
export const planSetSymbolSize = defineProjectCommand({
  id: 'plan.setSymbolSize',
  version: 1,
  input: z.strictObject({
    floorId: z.string().min(1),
    sizeCm: z.number().finite().positive(),
  }),
  check(project, input) {
    return readLegacyCompatibilityFloors(project as ProjectV2).some(
      (floor) => floor.id === input.floorId
    )
      ? { ok: true }
      : { ok: false, code: 'floor_not_found', message: 'Floor not found' }
  },
  apply(draft, input) {
    const project = draft as ProjectV2
    const floor = readLegacyCompatibilityFloors(project).find(
      (candidate) => candidate.id === input.floorId
    )
    if (floor?.sitplanSymbolSizeCm === input.sizeCm) return { created: [], changed: [], removed: [] }
    const result = updateFloorInProject(project, input.floorId, {
      sitplanSymbolSizeCm: input.sizeCm,
    })
    return {
      created: [],
      changed: result.changed ? [{ kind: 'floor', id: input.floorId }] : [],
      removed: [],
    }
  },
})
