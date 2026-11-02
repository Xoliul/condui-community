import { z } from 'zod'
import { recognizedWallsToFloorPlan } from '@/lib/plan/recognizedWalls'
import { resolvePlanPxPerMeter } from '@/lib/plan/planScale'
import { readLegacyCompatibilityFloors } from '@/lib/projectV2/buildingFloors'
import { updateFloorInProject } from '@/lib/projectMutations/storeActions'
import { CommandError, defineProjectCommand } from '../types'

const unitPoint = z.object({ x: z.number(), y: z.number() })
const segment = z.object({ start: unitPoint.optional(), end: unitPoint.optional() })
const optionalPoint = unitPoint.nullable().optional()

/** The part of a recognized plan page that becomes editable walls, doors and windows. */
const recognizedPageSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  walls: z.array(segment.extend({ thicknessPx: z.number().optional() })),
  windows: z.array(segment.extend({ supportWallIndex: z.number().optional() })),
  doors: z
    .array(
      segment.extend({
        hinge: optionalPoint,
        leafTip: optionalPoint,
        supportWallIndex: z.number().optional(),
      })
    )
    .optional(),
})

const inputSchema = z
  .object({
    floors: z
      .array(
        z
          .object({
            floorId: z.string().min(1),
            imageSize: z
              .object({ width: z.number().positive(), height: z.number().positive() })
              .strict(),
            offset: unitPoint.optional(),
            page: recognizedPageSchema,
          })
          .strict()
      )
      .min(1),
  })
  .strict()

/**
 * Keeps scanned plan walls: merges the recognized walls, doors and windows of each page into
 * its floor's editable geometry and dims the plan image behind them.
 */
export const planApplyRecognizedWalls = defineProjectCommand({
  id: 'plan.applyRecognizedWalls',
  version: 1,
  input: inputSchema,
  check(project, input) {
    const floorIds = new Set(input.floors.map((entry) => entry.floorId))
    if (floorIds.size !== input.floors.length)
      return { ok: false, code: 'duplicate_floor', message: 'A floor can only be scanned once' }
    for (const entry of input.floors)
      if (!project.building.floors.some((floor) => floor.id === entry.floorId))
        return { ok: false, code: 'floor_not_found', message: 'Floor not found' }
    return { ok: true }
  },
  apply(draft, input, env) {
    for (const entry of input.floors) {
      const floor = readLegacyCompatibilityFloors(draft).find(
        (candidate) => candidate.id === entry.floorId
      )
      if (!floor)
        throw new CommandError('check_failed', 'Floor not found', { reason: 'floor_not_found' })
      updateFloorInProject(draft, entry.floorId, {
        planImageOpacity: 30,
        floorPlan: recognizedWallsToFloorPlan(
          entry.page,
          entry.floorId,
          entry.imageSize,
          entry.offset,
          floor.floorPlan,
          resolvePlanPxPerMeter(floor.scale) ?? 100,
          env.newId
        ),
      })
    }
    return {
      created: [],
      changed: input.floors.map((entry) => ({ kind: 'floor' as const, id: entry.floorId })),
      removed: [],
    }
  },
})
