import { z } from 'zod'
import {
  altDuplicatePlacementInProject,
  canAltDuplicateInProject,
} from '@/lib/plan/planAltDuplicateMutations'
import { resolvePlanPlacement } from '@/lib/plan/placementMutations'
import type { ProjectV2 } from '@/types/projectV2'
import { CommandError, defineProjectCommand, type EntityRef } from '../types'

const id = z.string().min(1)
const point = z.strictObject({ x: z.number().finite(), y: z.number().finite() })

/**
 * Alt-drag duplicate on the situation plan, committed when the pointer is released: another plan
 * occurrence of a multiplier symbol or supply device, or a new endpoint with the properties of
 * the source. The copy takes the placement of the symbol being dragged and lands at `pos`.
 * Selects the copy's placement.
 */
export const planAltDuplicate = defineProjectCommand({
  id: 'plan.altDuplicate',
  version: 1,
  input: z.strictObject({
    source: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('endpoint'), id }),
      z.strictObject({ kind: z.literal('trunkDevice'), id }),
    ]),
    refPlacementId: id,
    pos: point.optional(),
    sitplan: z
      .strictObject({
        activeFloorId: id.nullable(),
        viewportCenter: point.nullable().optional(),
        activePanelId: id.nullable().optional(),
      })
      .default({ activeFloorId: null }),
  }),
  check(project, input) {
    if (!resolvePlanPlacement(project as ProjectV2, input.refPlacementId))
      return { ok: false, code: 'placement_not_found', message: 'Placement not found' }
    return canAltDuplicateInProject(project as ProjectV2, input.source)
      ? { ok: true }
      : { ok: false, code: 'cannot_duplicate', message: 'This symbol cannot be duplicated' }
  },
  apply(draft, input, env) {
    const result = altDuplicatePlacementInProject(draft as ProjectV2, input, env.newId)
    if (!result)
      throw new CommandError('check_failed', 'Nothing could be duplicated', {
        reason: 'duplicate_failed',
      })
    const placement: EntityRef = { kind: 'placement', id: result.placementId }
    return {
      created: [
        placement,
        ...(result.createdEndpointId
          ? [{ kind: 'endpoint' as const, id: result.createdEndpointId }]
          : []),
      ],
      changed: [],
      removed: [],
      related: result.circuitId ? [{ kind: 'circuit', id: result.circuitId }] : [],
      select: [placement],
    }
  },
})
