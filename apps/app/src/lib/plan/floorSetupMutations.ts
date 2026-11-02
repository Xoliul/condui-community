import type { Floor, ImportedPlanAsset, Point2 } from '@/types/schema'
import type { ProjectV2, FloorV2 } from '@/types/projectV2'
import {
  editPlanPlacements,
  invalidatePlanLengthEstimates,
  preserveOtherFloorsOnScaleChange,
  rescalePlanFloorExtras,
} from './rescalePlan'
import {
  commitBuildingFloorView,
  mutateBuildingFloorView,
  mutateBuildingFloorViews,
  readLegacyCompatibilityFloors,
  removeBuildingFloor,
  selectProjectPlanScale,
  setPlanScaleForProject,
} from '@/lib/projectV2/buildingFloors'
import { getUnusedFloorPlanAssetIds } from '@/lib/projectV2/floorPlanAssets'
import { querySitplanNotes, replaceSitplanNotes } from '@/lib/projectV2/annotations'
import {
  replacePlanWireRoutesForProject,
  selectProjectPlanWireRoutes,
} from '@/lib/projectV2/planWiring'
import { resolvePlanPxPerMeter } from './planScale'

export type PlanRescaleOptions = { scaleScope?: 'floor' | 'building' }

export interface DeleteFloorResult {
  replacementFloorId: string
  removedAssetIds: string[]
}

/** Delete a floor while preserving every project reference that must remain usable. */
export function deleteFloorInProject(
  project: ProjectV2,
  floorId: string
): DeleteFloorResult | null {
  const floors = project.building.floors
  if (floors.length <= 1) return null
  const floorIndex = floors.findIndex((floor) => floor.id === floorId)
  if (floorIndex < 0) return null
  const replacementFloorId = floors[floorIndex - 1]?.id ?? floors[floorIndex + 1]?.id
  if (!replacementFloorId) return null

  const scale = selectProjectPlanScale(project)
  const pxPerMeter = scale ? resolvePlanPxPerMeter(scale) : null

  // Clear the plan while it still exists so asset cleanup can see every remaining reference.
  const removedAssetIds = detachPlanBackgroundInProject(project, floorId) ?? []

  // All physical placement owners share this traversal, including trunk devices and enclosures.
  editPlanPlacements(project, (placement) => {
    if (placement.floorId === floorId) placement.floorId = replacementFloorId
  })

  replacePlanWireRoutesForProject(
    project,
    selectProjectPlanWireRoutes(project).map((route) => ({
      ...route,
      floorId: route.floorId === floorId ? replacementFloorId : route.floorId,
      ...(route.riser?.fromFloorId === floorId
        ? { riser: { ...route.riser, fromFloorId: replacementFloorId } }
        : {}),
      ...(route.riserExit?.toFloorId === floorId
        ? { riserExit: { ...route.riserExit, toFloorId: replacementFloorId } }
        : {}),
    }))
  )

  const sitplanNotes = querySitplanNotes(project)
  if (sitplanNotes.some((note) => note.floorId === floorId)) {
    replaceSitplanNotes(
      project,
      sitplanNotes.map((note) =>
        note.floorId === floorId ? { ...note, floorId: replacementFloorId } : note
      )
    )
  }

  removeBuildingFloor(project, floorId)

  // A ruler tied to the deleted plan no longer has a valid coordinate frame. Keep its
  // numerical calibration and remove only the stale reference owner.
  if (scale?.reference?.floorId === floorId) {
    project.building.planScale = undefined
    setPlanScaleForProject(project, pxPerMeter == null ? undefined : { pxPerMeter })
  }

  return { replacementFloorId, removedAssetIds }
}

/** Shared legacy store operation used by the headless calibration command and live UI adapters. */
export function applyPlanRescaleInProject(
  project: ProjectV2,
  floorId: string,
  floorUpdates: Partial<Floor>,
  placementUpdates: Array<{ id: string; pos: Point2 }>,
  options?: PlanRescaleOptions
): boolean {
  let changed = false
  const floor = readLegacyCompatibilityFloors(project).find((candidate) => candidate.id === floorId)
  if (floor) {
    if (floorUpdates.scale && resolvePlanPxPerMeter(floorUpdates.scale) == null) return false
    if (options?.scaleScope === 'building' && floorUpdates.scale) {
      const before = resolvePlanPxPerMeter(selectProjectPlanScale(project)) ?? 100
      const after = resolvePlanPxPerMeter(floorUpdates.scale)
      if (after == null) return false
      setPlanScaleForProject(project, floorUpdates.scale)
      Object.assign(floor, {
        scale: selectProjectPlanScale(project),
        planScaleNeedsCalibration: false,
      })
      if (Math.abs(after / before - 1) > 1e-9) invalidatePlanLengthEstimates(project)
      commitBuildingFloorView(project, floorId, floor)
      changed = true
    } else {
      const before = resolvePlanPxPerMeter(floor.scale) ?? 100
      const after = resolvePlanPxPerMeter(floorUpdates.scale)
      if (floorUpdates.scale) {
        preserveOtherFloorsOnScaleChange(project, floorId, floorUpdates.scale)
        if (floorUpdates.scale.reference)
          floorUpdates = { ...floorUpdates, planScaleNeedsCalibration: false }
      }
      if (floorUpdates.floorPlan && after && Math.abs(after / before - 1) > 1e-9) {
        const points = floor.floorPlan?.walls.flatMap((wall) => wall.points) ?? []
        const center = points.length
          ? {
              x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
              y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
            }
          : { x: 0, y: 0 }
        editPlanPlacements(project, (placement) => {
          if (placement.floorId === floorId)
            placement.pos = {
              x: center.x + (placement.pos.x - center.x) * (after / before),
              y: center.y + (placement.pos.y - center.y) * (after / before),
            }
        })
        rescalePlanFloorExtras(project, floorId, after / before, center)
        invalidatePlanLengthEstimates(project)
      }
      Object.assign(floor, floorUpdates)
      if (floorUpdates.scale) {
        setPlanScaleForProject(project, floorUpdates.scale)
        floor.scale = selectProjectPlanScale(project)
      }
      commitBuildingFloorView(project, floorId, floor)
      changed = true
    }
  }
  if (placementUpdates.length > 0) {
    const idToPos = new Map<string, Point2>(
      placementUpdates.map((update) => [update.id, update.pos])
    )
    editPlanPlacements(project, (placement) => {
      const pos = idToPos.get(placement.id)
      if (pos) placement.pos = pos
    })
    changed = true
  }
  return changed
}

type BackgroundTransform = Pick<
  Floor,
  'planImageOffset' | 'planImageRotationDeg' | 'planImageOpacity'
>

/** Assign a validated background transform to a floor projection. */
export function transformPlanBackgroundFloorView(
  floor: Floor,
  updates: BackgroundTransform
): boolean {
  let changed = false
  if (
    'planImageOffset' in updates &&
    JSON.stringify(floor.planImageOffset) !== JSON.stringify(updates.planImageOffset)
  )
    changed = true
  if (
    'planImageRotationDeg' in updates &&
    floor.planImageRotationDeg !== updates.planImageRotationDeg
  )
    changed = true
  if ('planImageOpacity' in updates && floor.planImageOpacity !== updates.planImageOpacity)
    changed = true
  if (changed) Object.assign(floor, updates)
  return changed
}

/** Update only the floor-plan image transform/opacity fields, preserving geometry and assets. */
export function transformPlanBackgroundInProject(
  project: ProjectV2,
  floorId: string,
  updates: BackgroundTransform
): boolean {
  const floor = project.building.floors.find((candidate) => candidate.id === floorId)
  if (!floor) return false
  const view = readLegacyCompatibilityFloors(project).find((candidate) => candidate.id === floorId)
  if (!view) return false
  const changed = transformPlanBackgroundFloorView(view, updates)
  if (!changed) return false
  commitBuildingFloorView(project, floorId, view)
  return true
}

/** Attach a prepared or already-owned image/PDF import to an existing floor. */
export function attachPlanBackgroundInProject(
  project: ProjectV2,
  floorId: string,
  asset: ImportedPlanAsset,
  planScaleNeedsCalibration?: boolean
): boolean {
  const floor = project.building.floors.find((candidate) => candidate.id === floorId)
  if (!floor) return false
  const sameAsset =
    floor.planAssetId === asset.id &&
    (planScaleNeedsCalibration === undefined ||
      floor.planScaleNeedsCalibration === planScaleNeedsCalibration)
  if (sameAsset) return false
  return !!mutateBuildingFloorView(project, floorId, (view) => {
    view.planImportAsset = asset
    view.planAsset = asset.dataUrl
    view.planAssetProcessed = asset.processedDataUrl
    view.planAssetHasWhiteBackground = asset.hasWhiteBackground
    if (planScaleNeedsCalibration !== undefined)
      view.planScaleNeedsCalibration = planScaleNeedsCalibration
  })
}

/** Detach one floor's image and remove its payload only after its last floor reference disappears. */
export function detachPlanBackgroundInProject(
  project: ProjectV2,
  floorId: string
): string[] | null {
  const floor = project.building.floors.find((candidate) => candidate.id === floorId)
  if (!floor || (!floor.planAssetId && !floor.processedPlanAssetId)) return null
  const planAssetId = floor.planAssetId ?? floor.processedPlanAssetId!
  const changed = mutateBuildingFloorView(project, floorId, (view) => {
    view.planAsset = undefined
    view.planAssetProcessed = undefined
    view.planAssetHasWhiteBackground = undefined
    view.planImportAsset = undefined
    // The compatibility projection also carries the canonical V2 ids. floorToV2 gives
    // those ids precedence over empty compatibility fields unless they are cleared too.
    const canonicalIds = view as Floor &
      Partial<Pick<FloorV2, 'planAssetId' | 'processedPlanAssetId'>>
    canonicalIds.planAssetId = undefined
    canonicalIds.processedPlanAssetId = undefined
  })
  if (!changed) return null
  const removed = getUnusedFloorPlanAssetIds(project.assets, project.building.floors, planAssetId)
  const removedSet = new Set(removed)
  project.assets = project.assets.filter((asset) => !removedSet.has(asset.id))
  return removed
}

/** Moves a floor to a new position in the building's floor order. False when nothing moved. */
export function reorderFloorsInProject(
  project: ProjectV2,
  fromIndex: number,
  toIndex: number
): boolean {
  if (fromIndex === toIndex) return false
  const reordered = mutateBuildingFloorViews(project, (floors) => {
    if (fromIndex < 0 || fromIndex >= floors.length || toIndex < 0 || toIndex >= floors.length)
      return
    const [removed] = floors.splice(fromIndex, 1)
    floors.splice(toIndex, 0, removed!)
  })
  return !(
    fromIndex < 0 ||
    fromIndex >= reordered.length ||
    toIndex < 0 ||
    toIndex >= reordered.length
  )
}
