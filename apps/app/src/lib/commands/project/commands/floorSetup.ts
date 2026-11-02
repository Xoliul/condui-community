import { z } from 'zod'
import type { Floor, ImportedPlanAsset } from '@/types/schema'
import { rescaleFloorPlan } from '@/lib/plan/rescalePlan'
import { resolvePlanPxPerMeter } from '@/lib/plan/planScale'
import {
  applyPlanRescaleInProject,
  attachPlanBackgroundInProject,
  deleteFloorInProject,
  detachPlanBackgroundInProject,
  reorderFloorsInProject,
  transformPlanBackgroundInProject,
} from '@/lib/plan/floorSetupMutations'
import { duplicateFloorPlan } from '@/lib/plan/duplicateFloorPlan'
import { ensureElectricalLayerOnFloor } from '@/lib/plan/floorLayers'
import { isFloorPlanImageAsset } from '@/lib/projectV2/floorPlanAssets'
import {
  addBuildingFloorView,
  getPlanImportAssetForBuildingFloor,
  selectProjectFloorPlan,
  selectProjectPlanScale,
  setPlanScaleForProject,
} from '@/lib/projectV2/buildingFloors'
import { preserveOtherFloorsOnScaleChange } from '@/lib/plan/rescalePlan'
import { CommandError, defineProjectCommand, type EntityRef } from '../types'
import type { AssetModelV2 } from '@/types/projectV2'

const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict()
const scaleReferenceSchema = z
  .object({
    p1: pointSchema,
    p2: pointSchema,
    meters: z.number().finite().positive(),
    coordinateSpace: z.literal('asset').optional(),
    floorId: z.string().min(1).optional(),
  })
  .strict()
const floorScaleSchema = z
  .object({
    pxPerMeter: z.number().finite().positive().optional(),
    reference: scaleReferenceSchema.optional(),
  })
  .strict()
const cropSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict()

const cadPointSchema = z
  .object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite().optional() })
  .strict()
const cadRectSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict()
const cadExtentsSchema = z.object({ min: cadPointSchema, max: cadPointSchema }).strict()
const cadReferenceSchema = z
  .object({
    version: z.literal(1),
    sourceKind: z.enum(['dxf', 'dwg']),
    sourceFileName: z.string(),
    sourceFingerprint: z.string(),
    cadImportSessionId: z.string(),
    insunitsRaw: z.number().finite().nullable(),
    insunitsResolved: z.number().finite(),
    metersPerCadUnit: z.number().finite().positive(),
    unitResolutionNote: z.string().optional(),
    fullSourceExtents: cadExtentsSchema.nullable(),
    uncroppedAssetSize: z
      .object({ width: z.number().finite().positive(), height: z.number().finite().positive() })
      .strict(),
    extmin: cadPointSchema.nullable(),
    extmax: cadPointSchema.nullable(),
    yAxisUp: z.boolean(),
    isReferenceCrop: z.boolean(),
    cropInAssetSpace: cadRectSchema,
    cropInModelSpace: cadExtentsSchema,
    referenceCropAssetRect: cadRectSchema.optional(),
    svgNormalization: z
      .object({
        scale: z.number().finite().positive(),
        translateX: z.number().finite(),
        translateY: z.number().finite(),
      })
      .strict(),
    libreDwgToSvg: z
      .object({
        translateX: z.number().finite(),
        translateY: z.number().finite(),
        scale: z.number().finite().positive(),
        flipY: z.boolean(),
      })
      .strict(),
    cadToSvgMatrix: z
      .object({
        a: z.number().finite(),
        b: z.number().finite(),
        c: z.number().finite(),
        d: z.number().finite(),
        e: z.number().finite(),
        f: z.number().finite(),
      })
      .strict()
      .optional(),
    rawViewBox: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite().positive(),
        height: z.number().finite().positive(),
      })
      .strict()
      .optional(),
    planImageOffset: pointSchema,
    controlPoints: z
      .array(
        z
          .object({
            cad: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
            asset: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
          })
          .strict()
      )
      .optional(),
    capturedAt: z.string().datetime({ offset: true }),
  })
  .strict() satisfies z.ZodType<NonNullable<ImportedPlanAsset['cadReference']>>

export const importedPlanAssetSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(['raster', 'pdf-vector', 'pdf-raster', 'cad-vector']),
    sourceName: z.string().optional(),
    pageIndex: z.number().int().nonnegative().optional(),
    pageCount: z.number().int().positive().optional(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    dataUrl: z.string().optional(),
    processedDataUrl: z.string().optional(),
    svgContent: z.string().optional(),
    hasWhiteBackground: z.boolean().optional(),
    darkModeAware: z.boolean().optional(),
    grayscale: z.boolean().optional(),
    crop: cropSchema.optional(),
    cadReference: cadReferenceSchema.optional(),
  })
  .strict()

function hasPlanAssetPayload(asset: ImportedPlanAsset): boolean {
  return asset.kind === 'raster' || asset.kind === 'pdf-raster'
    ? Boolean(asset.dataUrl)
    : Boolean(asset.svgContent)
}

export const buildingCreateFloor = defineProjectCommand({
  id: 'floor.create',
  version: 1,
  input: z
    .object({
      name: z.string().trim().min(1).max(120),
      sourceFloorId: z.string().min(1).optional(),
      scale: floorScaleSchema.optional(),
      planScaleNeedsCalibration: z.boolean().optional(),
      planImageOffset: pointSchema.optional(),
      asset: importedPlanAssetSchema.optional(),
    })
    .strict(),
  check(project, input) {
    if (!project.building)
      return { ok: false, code: 'building_not_found', message: 'Building not found' }
    if (
      input.sourceFloorId &&
      !project.building.floors.some((floor) => floor.id === input.sourceFloorId)
    )
      return { ok: false, code: 'source_floor_not_found', message: 'Source floor not found' }
    if (input.asset && project.assets.some((asset) => asset.id === input.asset?.id))
      return {
        ok: false,
        code: 'asset_id_conflict',
        message: 'Floor plan asset id is already in use',
      }
    if (input.asset && !hasPlanAssetPayload(input.asset))
      return {
        ok: false,
        code: 'invalid_asset_payload',
        message: 'Floor plan asset data is required',
      }
    if (input.scale && resolvePlanPxPerMeter(input.scale) == null)
      return { ok: false, code: 'invalid_scale', message: 'Invalid floor scale' }
    return { ok: true }
  },
  apply(draft, input, env) {
    const id = env.newId()
    const source = input.sourceFloorId
      ? draft.building.floors.find((floor) => floor.id === input.sourceFloorId)
      : undefined
    let floor: Floor = { id, name: input.name }
    if (source) {
      floor = duplicateFloorPlan(
        {
          ...source,
          layers: ['electrical'],
          planImportAsset: getPlanImportAssetForBuildingFloor(draft, source.id),
          floorPlan: selectProjectFloorPlan(draft, source.id),
        },
        id,
        input.name,
        env.newId
      )
      floor.scale = source.scale
      floor.planScaleNeedsCalibration = source.planScaleNeedsCalibration
    } else {
      floor.scale = selectProjectPlanScale(draft)
    }
    if (input.planImageOffset) floor.planImageOffset = input.planImageOffset
    if (input.planScaleNeedsCalibration !== undefined)
      floor.planScaleNeedsCalibration = input.planScaleNeedsCalibration
    if (input.scale) {
      const scale = input.scale.reference
        ? { ...input.scale, reference: { ...input.scale.reference, floorId: id } }
        : input.scale
      preserveOtherFloorsOnScaleChange(draft, id, scale)
      setPlanScaleForProject(draft, scale)
      floor.scale = selectProjectPlanScale(draft)
    }
    ensureElectricalLayerOnFloor(floor)
    addBuildingFloorView(draft, floor)
    if (input.asset)
      attachPlanBackgroundInProject(draft, id, input.asset, input.planScaleNeedsCalibration)
    const ref = { kind: 'floor' as const, id }
    return { created: [ref], changed: [], removed: [], select: [ref] }
  },
})

export const buildingDeleteFloor = defineProjectCommand({
  id: 'floor.delete',
  version: 1,
  input: z.object({ floorId: z.string().min(1) }).strict(),
  check(project, input) {
    const floors = project.building?.floors ?? []
    if (!floors.some((floor) => floor.id === input.floorId))
      return { ok: false, code: 'floor_not_found', message: 'Floor not found' }
    if (floors.length <= 1)
      return { ok: false, code: 'last_floor', message: 'A project must keep at least one floor' }
    return { ok: true }
  },
  apply(draft, input) {
    const result = deleteFloorInProject(draft, input.floorId)
    if (!result)
      throw new CommandError('check_failed', 'Floor cannot be deleted', {
        reason: 'floor_not_found',
      })
    const ref = { kind: 'floor' as const, id: input.floorId }
    return {
      created: [],
      changed: [{ kind: 'floor' as const, id: result.replacementFloorId }],
      removed: [ref],
    }
  },
})

export const buildingReorderFloors = defineProjectCommand({
  id: 'floor.reorder',
  version: 1,
  input: z.object({ floorId: z.string().min(1), toIndex: z.number().int().nonnegative() }).strict(),
  check(project, input) {
    const floors = project.building?.floors ?? []
    if (!floors.some((floor) => floor.id === input.floorId))
      return { ok: false, code: 'floor_not_found', message: 'Floor not found' }
    if (input.toIndex >= floors.length)
      return { ok: false, code: 'invalid_index', message: 'Floor position is out of range' }
    return { ok: true }
  },
  apply(draft, input) {
    const fromIndex = draft.building.floors.findIndex((floor) => floor.id === input.floorId)
    if (!reorderFloorsInProject(draft, fromIndex, input.toIndex))
      return { created: [], changed: [], removed: [] }
    return { created: [], changed: [{ kind: 'floor', id: input.floorId }], removed: [] }
  },
})

export const planAttachBackground = defineProjectCommand({
  id: 'plan.attachBackground',
  version: 1,
  input: z
    .object({
      floorId: z.string().min(1),
      asset: importedPlanAssetSchema.optional(),
      assetId: z.string().min(1).optional(),
      scale: floorScaleSchema.optional(),
      planImageOffset: pointSchema.optional(),
      planScaleNeedsCalibration: z.boolean().optional(),
    })
    .strict()
    .refine((input) => (input.asset ? 1 : 0) + (input.assetId ? 1 : 0) === 1, {
      message: 'Provide exactly one prepared asset or existing asset id',
    }),
  check(project, input) {
    if (!project.building.floors.some((floor) => floor.id === input.floorId))
      return { ok: false, code: 'floor_not_found', message: 'Floor not found' }
    if (input.asset && project.assets.some((asset) => asset.id === input.asset?.id))
      return {
        ok: false,
        code: 'asset_id_conflict',
        message: 'Floor plan asset id is already in use',
      }
    if (input.scale && resolvePlanPxPerMeter(input.scale) == null)
      return { ok: false, code: 'invalid_scale', message: 'Invalid floor scale' }
    if (input.assetId) {
      const asset = project.assets.find((candidate) => candidate.id === input.assetId)
      if (!asset || !isFloorPlanImageAsset(asset))
        return { ok: false, code: 'asset_not_found', message: 'Floor plan asset not found' }
    }
    const asset =
      input.asset ??
      (input.assetId ? importedAssetFromProject(project.assets, input.assetId) : undefined)
    if (!asset) return { ok: false, code: 'asset_not_found', message: 'Floor plan asset not found' }
    if (!hasPlanAssetPayload(asset))
      return {
        ok: false,
        code: 'invalid_asset_payload',
        message: 'Floor plan asset data is required',
      }
    return { ok: true }
  },
  apply(draft, input) {
    const scale = input.scale
      ? {
          ...input.scale,
          ...(input.scale.reference
            ? { reference: { ...input.scale.reference, floorId: input.floorId } }
            : {}),
        }
      : undefined
    const asset =
      input.asset ??
      (input.assetId ? importedAssetFromProject(draft.assets, input.assetId) : undefined)
    if (!asset)
      throw new CommandError('check_failed', 'Floor plan asset not found', {
        reason: 'asset_not_found',
      })
    const changed = scale ? applyPlanRescaleInProject(draft, input.floorId, { scale }, []) : false
    const attached = attachPlanBackgroundInProject(
      draft,
      input.floorId,
      asset,
      input.planScaleNeedsCalibration
    )
    const transformed =
      input.planImageOffset !== undefined &&
      transformPlanBackgroundInProject(draft, input.floorId, {
        planImageOffset: input.planImageOffset,
      })
    return {
      created: [],
      changed: changed || attached || transformed ? [{ kind: 'floor', id: input.floorId }] : [],
      removed: [],
    }
  },
})

function importedAssetFromProject(
  assets: readonly AssetModelV2[],
  id: string
): ImportedPlanAsset | undefined {
  const source = assets.find((asset) => asset.id === id)
  if (!source || !isFloorPlanImageAsset(source)) return undefined
  const legacy = source.legacy
  const processed = assets.find((asset) => asset.id === `${id}-processed`)
  const kind: ImportedPlanAsset['kind'] =
    legacy?.kind ??
    (source.kind === 'floorplan-vector'
      ? 'pdf-vector'
      : source.kind === 'floorplan-processed'
        ? 'pdf-raster'
        : 'raster')
  return {
    ...(legacy ?? { id, kind, width: source.width ?? 0, height: source.height ?? 0 }),
    id,
    kind,
    sourceName: source.sourceName ?? legacy?.sourceName,
    pageIndex: source.pageIndex ?? legacy?.pageIndex,
    pageCount: source.pageCount ?? legacy?.pageCount,
    width: source.width ?? legacy?.width ?? processed?.width ?? 0,
    height: source.height ?? legacy?.height ?? processed?.height ?? 0,
    dataUrl: source.dataUrl && source.dataUrl !== source.id ? source.dataUrl : legacy?.dataUrl,
    processedDataUrl:
      processed?.dataUrl && processed.dataUrl !== processed.id
        ? processed.dataUrl
        : legacy?.processedDataUrl,
    svgContent: source.svgContent ?? legacy?.svgContent,
    crop: source.crop ?? legacy?.crop,
    darkModeAware: source.darkModeAware ?? legacy?.darkModeAware,
    grayscale: source.grayscale ?? legacy?.grayscale,
  }
}

export const planDetachBackground = defineProjectCommand({
  id: 'plan.detachBackground',
  version: 1,
  input: z.object({ floorId: z.string().min(1) }).strict(),
  check(project, input) {
    const floor = project.building.floors.find((candidate) => candidate.id === input.floorId)
    if (!floor) return { ok: false, code: 'floor_not_found', message: 'Floor not found' }
    if (!floor.planAssetId && !floor.processedPlanAssetId)
      return { ok: false, code: 'background_not_found', message: 'Floor has no background plan' }
    return { ok: true }
  },
  apply(draft, input) {
    const removedAssets = detachPlanBackgroundInProject(draft, input.floorId)
    if (removedAssets === null)
      throw new CommandError('check_failed', 'Floor has no background plan', {
        reason: 'background_not_found',
      })
    return { created: [], changed: [{ kind: 'floor', id: input.floorId }], removed: [] }
  },
})

export const planTransformBackground = defineProjectCommand({
  id: 'plan.transformBackground',
  version: 1,
  input: z
    .object({
      floorId: z.string().min(1),
      offset: pointSchema.nullable().optional(),
      rotationDeg: z.number().finite().nullable().optional(),
      opacity: z.number().finite().min(0).max(100).nullable().optional(),
    })
    .strict()
    .refine(
      (input) =>
        input.offset !== undefined ||
        input.rotationDeg !== undefined ||
        input.opacity !== undefined,
      {
        message: 'Provide at least one background transform field',
      }
    ),
  check(project, input) {
    if (!project.building.floors.some((floor) => floor.id === input.floorId))
      return { ok: false, code: 'floor_not_found', message: 'Floor not found' }
    return { ok: true }
  },
  apply(draft, input) {
    const updates = {
      ...(input.offset !== undefined ? { planImageOffset: input.offset ?? undefined } : {}),
      ...(input.rotationDeg !== undefined
        ? { planImageRotationDeg: input.rotationDeg ?? undefined }
        : {}),
      ...(input.opacity !== undefined ? { planImageOpacity: input.opacity ?? undefined } : {}),
    }
    const changed = transformPlanBackgroundInProject(draft, input.floorId, updates)
    return {
      created: [],
      changed: changed ? [{ kind: 'floor', id: input.floorId }] : [],
      removed: [],
    }
  },
})

export const planCalibrateScale = defineProjectCommand({
  id: 'plan.calibrateScale',
  version: 1,
  input: z
    .object({
      floorId: z.string().min(1),
      reference: scaleReferenceSchema,
      scaleScope: z.enum(['building', 'floor']).default('floor'),
      rescaleGeometry: z.boolean().default(false),
    })
    .strict(),
  check(project, input) {
    if (!project.building.floors.some((floor) => floor.id === input.floorId))
      return { ok: false, code: 'floor_not_found', message: 'Floor not found' }
    if (resolvePlanPxPerMeter({ reference: input.reference }) == null)
      return {
        ok: false,
        code: 'invalid_scale',
        message: 'Scale reference must have distinct points and a positive distance',
      }
    return { ok: true }
  },
  apply(draft, input) {
    const floor = draft.building.floors.find((candidate) => candidate.id === input.floorId)
    if (!floor)
      throw new CommandError('check_failed', 'Floor not found', { reason: 'floor_not_found' })
    const scale: NonNullable<Floor['scale']> = {
      reference: { ...input.reference, floorId: input.floorId },
    }
    const after = resolvePlanPxPerMeter(scale)
    if (after == null)
      throw new CommandError('check_failed', 'Invalid scale reference', { reason: 'invalid_scale' })
    const beforeScale = selectProjectPlanScale(draft)
    const referenceValues = (reference: NonNullable<Floor['scale']>['reference']) =>
      reference
        ? [
            reference.p1.x,
            reference.p1.y,
            reference.p2.x,
            reference.p2.y,
            reference.meters,
            reference.floorId,
            reference.coordinateSpace,
          ]
        : null
    const isSameScale =
      resolvePlanPxPerMeter(beforeScale) === after &&
      JSON.stringify(referenceValues(beforeScale?.reference)) ===
        JSON.stringify(referenceValues(scale.reference))
    if (
      isSameScale &&
      draft.building.floors.every((candidate) => candidate.planScaleNeedsCalibration !== true)
    )
      return { created: [], changed: [], removed: [] }
    if (input.scaleScope === 'building') {
      applyPlanRescaleInProject(draft, input.floorId, { scale }, [], { scaleScope: 'building' })
      const changedFloors = draft.building.floors.map((candidate) => ({
        kind: 'floor' as const,
        id: candidate.id,
      }))
      return { created: [], changed: changedFloors, removed: [] }
    }
    const changed: EntityRef[] = draft.building.floors
      .filter((candidate) => candidate.id !== input.floorId)
      .map((candidate) => ({ kind: 'floor', id: candidate.id }))
    let floorPlan: Floor['floorPlan']
    if (input.rescaleGeometry) {
      const currentPlan = selectProjectFloorPlan(draft, input.floorId)
      const before = resolvePlanPxPerMeter(selectProjectPlanScale(draft)) ?? 100
      if (currentPlan && Math.abs(after / before - 1) > 1e-9) {
        const points = currentPlan.walls.flatMap((wall) => wall.points)
        const origin = points.length
          ? {
              x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
              y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
            }
          : { x: 0, y: 0 }
        floorPlan = rescaleFloorPlan(currentPlan, after / before, origin)
      }
    }
    const applied = applyPlanRescaleInProject(
      draft,
      input.floorId,
      {
        scale,
        ...(floorPlan ? { floorPlan } : {}),
        planScaleNeedsCalibration: false,
      },
      []
    )
    if (applied && !changed.some((ref) => ref.id === input.floorId))
      changed.push({ kind: 'floor', id: input.floorId })
    return { created: [], changed, removed: [] }
  },
})

export type PlanBackgroundInput = z.input<typeof planAttachBackground.input>
