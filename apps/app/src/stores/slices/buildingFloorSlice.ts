import { pickDefaultPlanReferenceOverlayFloor } from './projectStoreHistory'
import type { ProjectSliceCreator } from './projectStoreTypes'
import { getAllEndpoints } from '@/lib/eendraad/projectElectricalDomain'
import { clamp } from '@/lib/geometry'
import { logger } from '@/lib/logger'
import {
  cumulativeLengths,
  getWallTotalLengthFromPoints,
  preserveOpeningPositionsAfterPointChange,
  preserveOpeningWorldPositionsAfterPointChange,
  recomputeOpeningLocalFromNormalized,
  removeDuplicateConsecutivePoints,
  resizeOpeningTowardFreeSpace,
  sanitizeWallOpeningPositions,
} from '@/lib/plan/constraints'
import { ensureElectricalLayerOnFloor } from '@/lib/plan/floorLayers'
import { resolvePlanWiringVisibility } from '@/lib/plan/planWiring'
import {
  hasIndependentSituationPlanVisibility,
  showSituationPlanPlacementInPanel,
  showSituationPlanPlacementOnPlan,
} from '@/lib/plan/panelPlanPlacementVisibility'
import {
  readLegacyCompatibilityFloors,
  selectProjectPlanScale,
  addBuildingFloorView,
  mutateBuildingFloorViews,
  removeBuildingFloor,
  commitBuildingFloorView,
  setPlanScaleForProject,
} from '@/lib/projectV2/buildingFloors'
import {
  selectProjectElectricalInstallation,
  editProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import {
  selectProjectPlanWiringVisibility,
  replacePlanWiringVisibilityForProject,
} from '@/lib/projectV2/planWiring'
import type { Floor, PlanGraphicElement, Point2, Wall } from '@/types/schema'
import type { FloorV2 } from '@/types/projectV2'
import { getUnusedFloorPlanAssetIds } from '@/lib/projectV2/floorPlanAssets'
import { generateId } from '@/utils/project'
import { useUIStore } from '@/stores/uiStore'
import { isCurvedWall } from '@/lib/plan/wallCurve'
import { preserveOtherFloorsOnScaleChange, editPlanPlacements, rescalePlanFloorExtras, invalidatePlanLengthEstimates } from '@/lib/plan/rescalePlan'
import { resolvePlanPxPerMeter } from '@/lib/plan/planScale'

/** True when an update deliberately removes the floor's plan image. */
function clearsPlanImage(updates: Partial<Floor>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(updates, 'planAsset') &&
    Object.prototype.hasOwnProperty.call(updates, 'planImportAsset') &&
    !updates.planAsset &&
    !updates.planImportAsset
  )
}

export const createBuildingFloorSlice: ProjectSliceCreator = (set, get) => ({
  // Floor actions
  addFloor: (floor) =>
    set((state) => {
      if (state.currentProject) {
        const sharedScale = selectProjectPlanScale(state.currentProject)
        if (floor.scale && resolvePlanPxPerMeter(floor.scale) == null) return
        if (floor.scale) {
          preserveOtherFloorsOnScaleChange(state.currentProject, floor.id, floor.scale)
          if (floor.scale.reference) floor.scale = { ...floor.scale, reference: { ...floor.scale.reference, floorId: floor.id } }
          setPlanScaleForProject(state.currentProject, floor.scale)
          floor.scale = selectProjectPlanScale(state.currentProject)
        } else if (sharedScale) {
          floor.scale = sharedScale
        }
        ensureElectricalLayerOnFloor(floor)
        addBuildingFloorView(state.currentProject, floor)
        state.isDirty = true
      }
    }),

  removeFloorPlan: ({ planAssetId, floorIds }) => {
    get().withSingleUndoEntry(() => {
      for (const floorId of floorIds) {
        get().updateFloor(floorId, {
          planAsset: undefined,
          planAssetProcessed: undefined,
          planAssetHasWhiteBackground: undefined,
          planImportAsset: undefined,
        })
      }
      const project = get().currentProject
      if (project && planAssetId) {
        const unused = getUnusedFloorPlanAssetIds(project.assets, project.building.floors, planAssetId)
        if (unused.length > 0) get().removeProjectAssets(unused)
      }
      return true
    })
  },

  updateFloor: (id, updates) =>
    set((state) => {
      if (state.currentProject) {
        const floor = readLegacyCompatibilityFloors(state.currentProject).find(
          (f) => f.id === id
        )
        if (floor) {
          if (updates.scale && resolvePlanPxPerMeter(updates.scale) == null) return
          if (updates.planScaleNeedsCalibration === true) invalidatePlanLengthEstimates(state.currentProject)
          if (updates.scale) {
            preserveOtherFloorsOnScaleChange(state.currentProject, id, updates.scale)
            if (updates.scale.reference) {
              updates = { ...updates, scale: { ...updates.scale, reference: { ...updates.scale.reference, floorId: id } }, planScaleNeedsCalibration: false }
            }
          }
          const previouslyHidden = new Set(floor.hiddenSitplanPlacementIds ?? [])
          Object.assign(floor, updates)
          if (clearsPlanImage(updates)) {
            // The floor view also carries the canonical plan ids; left in place they would
            // re-attach the plan when the view is committed.
            const view = floor as Floor & Partial<Pick<FloorV2, 'planAssetId' | 'processedPlanAssetId'>>
            view.planAssetId = undefined
            view.processedPlanAssetId = undefined
          }
          if (Object.prototype.hasOwnProperty.call(updates, 'hiddenSitplanPlacementIds')) {
            const nextHiddenIds = updates.hiddenSitplanPlacementIds ?? []
            const nextHidden = new Set(nextHiddenIds)
            const preferredPanelId = useUIStore.getState().activePanelId
            for (const placementId of nextHiddenIds) {
              if (previouslyHidden.has(placementId)) continue
              if (!hasIndependentSituationPlanVisibility(state.currentProject, placementId)) {
                showSituationPlanPlacementInPanel(state.currentProject, placementId, preferredPanelId)
              }
            }
            for (const placementId of previouslyHidden) {
              if (nextHidden.has(placementId)) continue
              if (!hasIndependentSituationPlanVisibility(state.currentProject, placementId)) {
                showSituationPlanPlacementOnPlan(state.currentProject, placementId)
              }
            }
          }
          if (updates.scale) {
            setPlanScaleForProject(state.currentProject, updates.scale)
            floor.scale = selectProjectPlanScale(state.currentProject)
          }
          ensureElectricalLayerOnFloor(floor)
          commitBuildingFloorView(state.currentProject, id, floor)
          state.isDirty = true
        }
      }
    }),

  updatePlanWiringVisibility: (updates) =>
    set((state) => {
      if (!state.currentProject) return
      const currentVisibility = selectProjectPlanWiringVisibility(state.currentProject)
      replacePlanWiringVisibilityForProject(state.currentProject, {
        ...resolvePlanWiringVisibility({ version: 1, routes: [], visibility: currentVisibility }),
        ...updates,
      })
      state.currentProject.project.updatedAt = new Date().toISOString()
      state.isDirty = true
    }),

  applyPlanRescale: (floorId, floorUpdates, placementUpdates) =>
    set((state) => {
      if (!state.currentProject) return
      const floor = readLegacyCompatibilityFloors(state.currentProject).find(
        (f) => f.id === floorId
      )
      if (floor) {
        if (floorUpdates.scale && resolvePlanPxPerMeter(floorUpdates.scale) == null) return
        const before = resolvePlanPxPerMeter(floor.scale) ?? 100
        const after = resolvePlanPxPerMeter(floorUpdates.scale)
        if (floorUpdates.scale) {
          preserveOtherFloorsOnScaleChange(state.currentProject, floorId, floorUpdates.scale)
          if (floorUpdates.scale.reference) floorUpdates = { ...floorUpdates, planScaleNeedsCalibration: false }
        }
        if (floorUpdates.floorPlan && after && Math.abs(after / before - 1) > 1e-9) {
          const points = floor.floorPlan?.walls.flatMap((wall) => wall.points) ?? []
          const center = points.length ? { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length } : { x: 0, y: 0 }
          editPlanPlacements(state.currentProject, (placement) => {
            if (placement.floorId === floorId) placement.pos = {
              x: center.x + (placement.pos.x - center.x) * (after / before),
              y: center.y + (placement.pos.y - center.y) * (after / before),
            }
          })
          rescalePlanFloorExtras(state.currentProject, floorId, after / before, center)
          invalidatePlanLengthEstimates(state.currentProject)
        }
        Object.assign(floor, floorUpdates)
        if (floorUpdates.scale) {
          setPlanScaleForProject(state.currentProject, floorUpdates.scale)
          floor.scale = selectProjectPlanScale(state.currentProject)
        }
        commitBuildingFloorView(state.currentProject, floorId, floor)
        state.isDirty = true
      }
      if (placementUpdates.length === 0) return
      const idToPos = new Map<string, Point2>(placementUpdates.map((u) => [u.id, u.pos]))
      editPlanPlacements(state.currentProject, (placement) => { const pos = idToPos.get(placement.id); if (pos) placement.pos = pos })
    }),

  deleteFloor: (id) =>
    set((state) => {
      if (state.currentProject) {
        const floors = readLegacyCompatibilityFloors(state.currentProject)
        if (floors.length <= 1) return
        const floorIndex = floors.findIndex((f) => f.id === id)
        if (floorIndex < 0) return
        const reassignedFloorId =
          (floorIndex > 0 ? floors[floorIndex - 1]?.id : undefined) ??
          floors[floorIndex + 1]?.id ??
          floors.find((f) => f.id !== id)?.id

        removeBuildingFloor(state.currentProject, id)
        // Preserve placements by moving them to the nearest remaining floor.
        for (const panel of editProjectElectricalPanels(state.currentProject)) {
          const endpoints = getAllEndpoints(panel)
          for (const endpoint of endpoints) {
            if (!reassignedFloorId) continue
            endpoint.placements = endpoint.placements.map((p) =>
              p.floorId === id ? { ...p, floorId: reassignedFloorId } : p
            )
          }
        }
        if (reassignedFloorId) {
          const installation = selectProjectElectricalInstallation(state.currentProject)
          for (const placement of installation?.earthingPlacements ?? []) {
            if (placement.floorId === id) placement.floorId = reassignedFloorId
          }
          for (const placement of installation?.junctionPanelPlacements ?? []) {
            if (placement.floorId === id) placement.floorId = reassignedFloorId
          }
        }
        state.isDirty = true
      }
      delete state.planFloorOverlayVisibleByBaseFloorId[id]
      for (const baseId of Object.keys(state.planFloorOverlayVisibleByBaseFloorId)) {
        const list = state.planFloorOverlayVisibleByBaseFloorId[baseId]
        if (!list?.length) continue
        const next = list.filter((fid) => fid !== id)
        if (next.length === 0) delete state.planFloorOverlayVisibleByBaseFloorId[baseId]
        else state.planFloorOverlayVisibleByBaseFloorId[baseId] = next
      }
      delete state.planCanvasPlanImageOffsetByFloorId[id]
    }),

  togglePlanFloorOverlayFloor: (baseFloorId, overlayFloorId) =>
    set((state) => {
      if (baseFloorId === overlayFloorId) return
      const cur = state.planFloorOverlayVisibleByBaseFloorId[baseFloorId] ?? []
      const setIds = new Set(cur)
      if (setIds.has(overlayFloorId)) setIds.delete(overlayFloorId)
      else setIds.add(overlayFloorId)
      const next = [...setIds]
      if (next.length === 0) delete state.planFloorOverlayVisibleByBaseFloorId[baseFloorId]
      else state.planFloorOverlayVisibleByBaseFloorId[baseFloorId] = next
    }),

  ensurePlanReferenceOverlayAboveInList: (baseFloorId) =>
    set((state) => {
      if (!state.currentProject) return
      const floors = readLegacyCompatibilityFloors(state.currentProject)
      const cur = state.planFloorOverlayVisibleByBaseFloorId[baseFloorId] ?? []
      if (cur.length > 0) return
      const defaultOverlayFloorId = pickDefaultPlanReferenceOverlayFloor(floors, baseFloorId)
      if (!defaultOverlayFloorId) return
      state.planFloorOverlayVisibleByBaseFloorId[baseFloorId] = [defaultOverlayFloorId]
    }),

  setPlanCanvasPlanImageOffset: (floorId, pos) =>
    set((state) => {
      state.planCanvasPlanImageOffsetByFloorId[floorId] = { x: pos.x, y: pos.y }
    }),

  reorderFloors: (fromIndex, toIndex) =>
    set((state) => {
      if (!state.currentProject || fromIndex === toIndex) return
      const reordered = mutateBuildingFloorViews(state.currentProject, (floors) => {
        if (fromIndex < 0 || fromIndex >= floors.length || toIndex < 0 || toIndex >= floors.length)
          return
        const [removed] = floors.splice(fromIndex, 1)
        floors.splice(toIndex, 0, removed!)
      })
      if (
        fromIndex < 0 ||
        fromIndex >= reordered.length ||
        toIndex < 0 ||
        toIndex >= reordered.length
      )
        return
      state.isDirty = true
    }),

  // Floor plan actions
  addWall: (floorId, wall) =>
    set((state) => {
      if (state.currentProject) {
        const floor = readLegacyCompatibilityFloors(state.currentProject).find(
          (f) => f.id === floorId
        )
        if (floor) {
          if (!floor.floorPlan) {
            floor.floorPlan = {
              walls: [],
              doors: [],
              windows: [],
              stairs: [],
              graphicElements: [],
              masterWallThickness: 20,
            }
          }
          const DEDUP_THRESHOLD = 1.0
          const isDuplicate =
            !wall.curve &&
            floor.floorPlan.walls.some((existing) => {
              if (isCurvedWall(existing) || existing.points.length !== wall.points.length)
                return false
              const n = wall.points.length
              const allMatch = (forward: boolean) =>
                wall.points.every((p, i) => {
                  const q = existing.points[forward ? i : n - 1 - i]!
                  return (
                    Math.abs(p.x - q.x) <= DEDUP_THRESHOLD && Math.abs(p.y - q.y) <= DEDUP_THRESHOLD
                  )
                })
              return allMatch(true) || allMatch(false)
            })
          if (isDuplicate) return
          floor.floorPlan.walls.push({
            ...wall,
            id: generateId(),
          })
          commitBuildingFloorView(state.currentProject, floor.id, floor)
          state.isDirty = true
        }
      }
    }),

  updateWall: (wallId, updates) =>
    set((state) => {
      if (state.currentProject) {
        for (const floor of readLegacyCompatibilityFloors(state.currentProject)) {
          if (floor.floorPlan) {
            const wall = floor.floorPlan.walls.find((w) => w.id === wallId)
            if (wall) {
              const payload = updates as Partial<Wall> & {
                doorUpdates?: Array<{ id: string; position: number }>
                windowUpdates?: Array<{ id: string; position: number }>
              }
              const updateKeys = Object.keys(payload)
              const passedDoorUpdates = payload.doorUpdates
              const passedWindowUpdates = payload.windowUpdates
              const { doorUpdates: _du, windowUpdates: _wu, ...wallUpdates } = payload
              // Never persist zero-length segments (duplicate consecutive points) on straight walls.
              if (wallUpdates.points && !wallUpdates.curve && !wall.curve) {
                wallUpdates.points = removeDuplicateConsecutivePoints(wallUpdates.points)
              }
              const hadPointsUpdate = wallUpdates.points != null && wallUpdates.points.length >= 2
              // Map openings from the de-duplicated old path so segment indices line up with the
              // de-duplicated new points (zero-length segments add no length, so positions hold).
              const oldPoints = hadPointsUpdate
                ? wall.curve
                  ? wall.points
                  : removeDuplicateConsecutivePoints(wall.points)
                : null
              const doorsBefore = floor.floorPlan.doors
                .filter((d) => d.wallId === wallId)
                .map((d) => ({ id: d.id, position: d.position }))
              const windowsBefore = floor.floorPlan.windows
                .filter((w) => w.wallId === wallId)
                .map((w) => ({ id: w.id, position: w.position }))
              Object.assign(wall, wallUpdates)
              if (hadPointsUpdate && wall.points.length >= 2 && oldPoints) {
                // Callers with constraint-computed door/window updates (e.g. vertex drag) keep those.
                // Points-only updates keep every opening at its world position (a translated or
                // rotated segment carries its openings along) and then fit it inside its segment.
                const callerSentOpeningUpdates =
                  (passedDoorUpdates?.length ?? 0) > 0 || (passedWindowUpdates?.length ?? 0) > 0
                logger.info('[updateWall]', {
                  wallId,
                  updateKeys,
                  hadPointsUpdate: true,
                  callerSentOpeningUpdates,
                  doorsBefore,
                  windowsBefore,
                })
                if (oldPoints) {
                  const wallDoors = floor.floorPlan.doors.filter((d) => d.wallId === wallId)
                  const wallWindows = floor.floorPlan.windows.filter((w) => w.wallId === wallId)
                  for (const u of passedDoorUpdates ?? []) {
                    const d = floor.floorPlan!.doors.find((x) => x.id === u.id)
                    if (d) d.position = u.position
                  }
                  for (const u of passedWindowUpdates ?? []) {
                    const w = floor.floorPlan!.windows.find((x) => x.id === u.id)
                    if (w) w.position = u.position
                  }
                  const excludeIds = new Set([
                    ...(passedDoorUpdates ?? []).map((u) => u.id),
                    ...(passedWindowUpdates ?? []).map((u) => u.id),
                  ])
                  const { doorUpdates: preservedDoors, windowUpdates: preservedWindows } =
                    (callerSentOpeningUpdates
                      ? preserveOpeningPositionsAfterPointChange
                      : preserveOpeningWorldPositionsAfterPointChange)(
                      oldPoints,
                      wall.points,
                      wallDoors,
                      wallWindows,
                      excludeIds
                    )
                  for (const u of preservedDoors) {
                    const d = floor.floorPlan!.doors.find((x) => x.id === u.id)
                    if (d) d.position = u.position
                  }
                  for (const u of preservedWindows) {
                    const w = floor.floorPlan!.windows.find((x) => x.id === u.id)
                    if (w) w.position = u.position
                  }
                  const finalWallDoors = floor.floorPlan.doors.filter((d) => d.wallId === wallId)
                  const finalWallWindows = floor.floorPlan.windows.filter(
                    (w) => w.wallId === wallId
                  )
                  if (!callerSentOpeningUpdates) {
                    // Fit openings inside their segment so they never overlap wall ends/junctions.
                    const sanitized = sanitizeWallOpeningPositions(
                      wall.points,
                      finalWallDoors,
                      finalWallWindows
                    )
                    for (const u of sanitized.doorUpdates) {
                      const d = finalWallDoors.find((x) => x.id === u.id)
                      if (d) d.position = u.position
                    }
                    for (const u of sanitized.windowUpdates) {
                      const w = finalWallWindows.find((x) => x.id === u.id)
                      if (w) w.position = u.position
                    }
                  }
                  recomputeOpeningLocalFromNormalized(wall.points, finalWallDoors, finalWallWindows)
                }
              }
              const doorsAfter = floor.floorPlan.doors
                .filter((d) => d.wallId === wallId)
                .map((d) => ({ id: d.id, position: d.position }))
              const windowsAfter = floor.floorPlan.windows
                .filter((w) => w.wallId === wallId)
                .map((w) => ({ id: w.id, position: w.position }))
              const doorPositionsChanged =
                JSON.stringify(doorsBefore) !== JSON.stringify(doorsAfter)
              const windowPositionsChanged =
                JSON.stringify(windowsBefore) !== JSON.stringify(windowsAfter)
              if (doorPositionsChanged || windowPositionsChanged) {
                logger.info('[updateWall] openings changed', { wallId, doorsAfter, windowsAfter })
              }
              commitBuildingFloorView(state.currentProject, floor.id, floor)
              state.isDirty = true
              return
            }
          }
        }
      }
    }),

  deleteWall: (wallId) =>
    set((state) => {
      if (state.currentProject) {
        for (const floor of readLegacyCompatibilityFloors(state.currentProject)) {
          if (floor.floorPlan) {
            const wallIndex = floor.floorPlan.walls.findIndex((w) => w.id === wallId)
            if (wallIndex !== -1) {
              // Also delete doors and windows on this wall
              floor.floorPlan.doors = floor.floorPlan.doors.filter((d) => d.wallId !== wallId)
              floor.floorPlan.windows = floor.floorPlan.windows.filter((w) => w.wallId !== wallId)
              // Remove attachments from other walls that reference this wall
              for (const otherWall of floor.floorPlan.walls) {
                if (otherWall.attachedPoints) {
                  otherWall.attachedPoints = otherWall.attachedPoints.filter(
                    (ap) => ap.wallId !== wallId
                  )
                }
              }
              floor.floorPlan.walls.splice(wallIndex, 1)
              commitBuildingFloorView(state.currentProject, floor.id, floor)
              state.isDirty = true
              return
            }
          }
        }
      }
    }),

  deleteWalls: (wallIds) =>
    set((state) => {
      if (state.currentProject) {
        const wallIdSet = new Set(wallIds)
        for (const floor of readLegacyCompatibilityFloors(state.currentProject)) {
          if (floor.floorPlan) {
            // Delete doors and windows on these walls
            floor.floorPlan.doors = floor.floorPlan.doors.filter((d) => !wallIdSet.has(d.wallId))
            floor.floorPlan.windows = floor.floorPlan.windows.filter(
              (w) => !wallIdSet.has(w.wallId)
            )
            // Remove attachments from other walls
            for (const otherWall of floor.floorPlan.walls) {
              if (otherWall.attachedPoints) {
                otherWall.attachedPoints = otherWall.attachedPoints.filter(
                  (ap) => !wallIdSet.has(ap.wallId)
                )
              }
            }
            floor.floorPlan.walls = floor.floorPlan.walls.filter((w) => !wallIdSet.has(w.id))
            commitBuildingFloorView(state.currentProject, floor.id, floor)
            state.isDirty = true
          }
        }
      }
    }),

  mergeWallPoints: (floorId, wallId1, pointIndex1, wallId2, pointIndex2) => {
    const state = get()
    const floor = state.currentProject
      ? readLegacyCompatibilityFloors(state.currentProject).find((f) => f.id === floorId)
      : undefined
    if (!floor?.floorPlan) return false
    const walls = floor.floorPlan.walls
    const wall1 = walls.find((w) => w.id === wallId1)
    const wall2 = walls.find((w) => w.id === wallId2)
    if (!wall1 || !wall2 || wall1.points.length < 2 || wall2.points.length < 2) return false
    // Curves remain standalone entities; their middle point is a geometric control, not a join vertex.
    if (isCurvedWall(wall1) || isCurvedWall(wall2)) return false

    const p1 = wall1.points[pointIndex1]
    const p2 = wall2.points[pointIndex2]
    if (!p1 || !p2) return false

    const MERGE_THRESHOLD = 1.0
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    if (Math.sqrt(dx * dx + dy * dy) > MERGE_THRESHOLD) return false

    const mergedPoint: Point2 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }

    if (wallId1 === wallId2) {
      const i = Math.min(pointIndex1, pointIndex2)
      const j = Math.max(pointIndex1, pointIndex2)
      if (i === j) return false
      const newPoints = [...wall1.points.slice(0, i), mergedPoint, ...wall1.points.slice(j + 1)]
      if (newPoints.length < 2) return false
      state.updateWall(wallId1, { points: newPoints })
      return true
    }

    const n1 = wall1.points.length
    const n2 = wall2.points.length
    const is1Last = pointIndex1 === n1 - 1
    const is1First = pointIndex1 === 0
    const is2Last = pointIndex2 === n2 - 1
    const is2First = pointIndex2 === 0

    // Detect fully overlapping walls: all segments of one wall coincide with segments of the other.
    if (wallId1 !== wallId2 && n1 === n2) {
      const allMatch = (forward: boolean) =>
        wall1.points.every((p, i) => {
          const q = wall2.points[forward ? i : n2 - 1 - i]!
          return Math.abs(p.x - q.x) <= MERGE_THRESHOLD && Math.abs(p.y - q.y) <= MERGE_THRESHOLD
        })
      if (allMatch(true) || allMatch(false)) {
        // Walls are duplicates — keep the first, transfer openings, delete the second.
        for (const door of floor.floorPlan.doors) {
          if (door.wallId === wall2.id) {
            state.updateDoor(door.id, { wallId: wall1.id })
          }
        }
        for (const window of floor.floorPlan.windows) {
          if (window.wallId === wall2.id) {
            state.updateWindow(window.id, { wallId: wall1.id })
          }
        }
        state.deleteWall(wall2.id)
        return true
      }
    }

    const endpointMerge = (is1Last && is2First) || (is1First && is2Last)
    if (!endpointMerge) return false

    let keeperWall: Wall
    let otherWall: Wall
    let mergedPoints: Point2[]

    if (is1Last && is2First) {
      keeperWall = wall1
      otherWall = wall2
      mergedPoints = [...wall1.points.slice(0, -1), mergedPoint, ...wall2.points.slice(1)]
    } else {
      keeperWall = wall2
      otherWall = wall1
      mergedPoints = [...wall2.points.slice(0, -1), mergedPoint, ...wall1.points.slice(1)]
    }
    if (mergedPoints.length < 2) return false

    const totalMerged = getWallTotalLengthFromPoints(mergedPoints)
    if (totalMerged < 1e-10) return false

    const keeperPoints = keeperWall.points
    const otherPoints = otherWall.points
    const cumKeeper = cumulativeLengths(keeperPoints)
    const cumOther = cumulativeLengths(otherPoints)
    const totalOther = cumOther[cumOther.length - 1] ?? 0
    const distToM = cumKeeper[cumKeeper.length - 2] ?? 0
    const firstSegLenOther = totalOther > 0 ? (cumOther[1] ?? 0) - (cumOther[0] ?? 0) : 0
    const distMToOther1 = Math.sqrt(
      (otherPoints[1]!.x - mergedPoint.x) ** 2 + (otherPoints[1]!.y - mergedPoint.y) ** 2
    )
    const startOfOtherPart = distToM + distMToOther1

    const mapPosition = (positionOnOther: number): number => {
      const distOnOther = positionOnOther * totalOther
      const newDist =
        distOnOther <= firstSegLenOther
          ? startOfOtherPart
          : startOfOtherPart + (distOnOther - firstSegLenOther)
      return clamp(newDist / totalMerged, 0, 1)
    }

    state.updateWall(keeperWall.id, { points: mergedPoints })

    for (const door of floor.floorPlan.doors) {
      if (door.wallId === otherWall.id) {
        state.updateDoor(door.id, { wallId: keeperWall.id, position: mapPosition(door.position) })
      }
    }
    for (const window of floor.floorPlan.windows) {
      if (window.wallId === otherWall.id) {
        state.updateWindow(window.id, {
          wallId: keeperWall.id,
          position: mapPosition(window.position),
        })
      }
    }

    state.deleteWall(otherWall.id)
    return true
  },

  getWallsByFloor: (floorId) => {
    const { currentProject } = get()
    if (!currentProject) return []
    const floor = readLegacyCompatibilityFloors(currentProject).find((f) => f.id === floorId)
    return floor?.floorPlan?.walls ?? []
  },

  addDoor: (floorId, door) =>
    set((state) => {
      if (state.currentProject) {
        const floor = readLegacyCompatibilityFloors(state.currentProject).find(
          (f) => f.id === floorId
        )
        if (floor) {
          if (!floor.floorPlan) {
            floor.floorPlan = {
              walls: [],
              doors: [],
              windows: [],
              stairs: [],
              graphicElements: [],
              masterWallThickness: 20,
            }
          }
          const wall = floor.floorPlan.walls.find((w) => w.id === door.wallId)
          if (!wall || isCurvedWall(wall)) return
          const newDoor = { ...door, id: generateId() }
          floor.floorPlan.doors.push(newDoor)
          if (wall && wall.points.length >= 2) {
            const wallDoors = floor.floorPlan.doors.filter((d) => d.wallId === door.wallId)
            const wallWindows = floor.floorPlan.windows.filter((w) => w.wallId === door.wallId)
            const { doorUpdates, windowUpdates } = sanitizeWallOpeningPositions(
              wall.points,
              wallDoors,
              wallWindows
            )
            for (const u of doorUpdates) {
              const d = floor.floorPlan!.doors.find((x) => x.id === u.id)
              if (d) d.position = u.position
            }
            for (const u of windowUpdates) {
              const w = floor.floorPlan!.windows.find((x) => x.id === u.id)
              if (w) w.position = u.position
            }
            const finalWallDoors = floor.floorPlan.doors.filter((d) => d.wallId === door.wallId)
            const finalWallWindows = floor.floorPlan.windows.filter((w) => w.wallId === door.wallId)
            recomputeOpeningLocalFromNormalized(wall.points, finalWallDoors, finalWallWindows)
          }
          commitBuildingFloorView(state.currentProject, floor.id, floor)
          state.isDirty = true
        }
      }
    }),

  updateDoor: (doorId, updates) =>
    set((state) => {
      if (state.currentProject) {
        for (const floor of readLegacyCompatibilityFloors(state.currentProject)) {
          if (floor.floorPlan) {
            const door = floor.floorPlan.doors.find((d) => d.id === doorId)
            if (door) {
              Object.assign(door, updates)
              const wall = floor.floorPlan.walls.find((w) => w.id === door.wallId)
              if (
                wall &&
                wall.points.length >= 2 &&
                (updates.position !== undefined || updates.width !== undefined)
              ) {
                if (updates.width !== undefined && updates.position === undefined) {
                  const adjusted = resizeOpeningTowardFreeSpace(
                    wall.points,
                    floor.floorPlan.doors.filter((d) => d.wallId === door.wallId),
                    floor.floorPlan.windows.filter((w) => w.wallId === door.wallId),
                    door.id,
                    'door',
                    updates.width
                  )
                  if (adjusted) {
                    door.width = adjusted.width
                    door.position = adjusted.position
                  }
                }
                const wallDoors = floor.floorPlan.doors.filter((d) => d.wallId === door.wallId)
                const wallWindows = floor.floorPlan.windows.filter((w) => w.wallId === door.wallId)
                const { doorUpdates, windowUpdates } = sanitizeWallOpeningPositions(
                  wall.points,
                  wallDoors,
                  wallWindows
                )
                for (const u of doorUpdates) {
                  const d = floor.floorPlan!.doors.find((x) => x.id === u.id)
                  if (d) d.position = u.position
                }
                for (const u of windowUpdates) {
                  const w = floor.floorPlan!.windows.find((x) => x.id === u.id)
                  if (w) w.position = u.position
                }
                const finalWallDoors = floor.floorPlan.doors.filter((d) => d.wallId === door.wallId)
                const finalWallWindows = floor.floorPlan.windows.filter(
                  (w) => w.wallId === door.wallId
                )
                recomputeOpeningLocalFromNormalized(wall.points, finalWallDoors, finalWallWindows)
              }
              commitBuildingFloorView(state.currentProject, floor.id, floor)
              state.isDirty = true
              return
            }
          }
        }
      }
    }),

  deleteDoor: (doorId) =>
    set((state) => {
      if (state.currentProject) {
        for (const floor of readLegacyCompatibilityFloors(state.currentProject)) {
          if (floor.floorPlan) {
            const doorIndex = floor.floorPlan.doors.findIndex((d) => d.id === doorId)
            if (doorIndex !== -1) {
              floor.floorPlan.doors.splice(doorIndex, 1)
              commitBuildingFloorView(state.currentProject, floor.id, floor)
              state.isDirty = true
              return
            }
          }
        }
      }
    }),

  addWindow: (floorId, window) =>
    set((state) => {
      if (state.currentProject) {
        const floor = readLegacyCompatibilityFloors(state.currentProject).find(
          (f) => f.id === floorId
        )
        if (floor) {
          if (!floor.floorPlan) {
            floor.floorPlan = {
              walls: [],
              doors: [],
              windows: [],
              stairs: [],
              graphicElements: [],
              masterWallThickness: 20,
            }
          }
          const wall = floor.floorPlan.walls.find((w) => w.id === window.wallId)
          if (!wall || isCurvedWall(wall)) return
          const newWindow = { ...window, id: generateId() }
          floor.floorPlan.windows.push(newWindow)
          if (wall && wall.points.length >= 2) {
            const wallDoors = floor.floorPlan.doors.filter((d) => d.wallId === window.wallId)
            const wallWindows = floor.floorPlan.windows.filter((w) => w.wallId === window.wallId)
            const { doorUpdates, windowUpdates } = sanitizeWallOpeningPositions(
              wall.points,
              wallDoors,
              wallWindows
            )
            for (const u of doorUpdates) {
              const d = floor.floorPlan!.doors.find((x) => x.id === u.id)
              if (d) d.position = u.position
            }
            for (const u of windowUpdates) {
              const w = floor.floorPlan!.windows.find((x) => x.id === u.id)
              if (w) w.position = u.position
            }
            const finalWallDoors = floor.floorPlan.doors.filter((d) => d.wallId === window.wallId)
            const finalWallWindows = floor.floorPlan.windows.filter(
              (w) => w.wallId === window.wallId
            )
            recomputeOpeningLocalFromNormalized(wall.points, finalWallDoors, finalWallWindows)
          }
          commitBuildingFloorView(state.currentProject, floor.id, floor)
          state.isDirty = true
        }
      }
    }),

  updateWindow: (windowId, updates) =>
    set((state) => {
      if (state.currentProject) {
        for (const floor of readLegacyCompatibilityFloors(state.currentProject)) {
          if (floor.floorPlan) {
            const window = floor.floorPlan.windows.find((w) => w.id === windowId)
            if (window) {
              Object.assign(window, updates)
              const wall = floor.floorPlan.walls.find((w) => w.id === window.wallId)
              if (
                wall &&
                wall.points.length >= 2 &&
                (updates.position !== undefined || updates.width !== undefined)
              ) {
                if (updates.width !== undefined && updates.position === undefined) {
                  const adjusted = resizeOpeningTowardFreeSpace(
                    wall.points,
                    floor.floorPlan.doors.filter((d) => d.wallId === window.wallId),
                    floor.floorPlan.windows.filter((w) => w.wallId === window.wallId),
                    window.id,
                    'window',
                    updates.width
                  )
                  if (adjusted) {
                    window.width = adjusted.width
                    window.position = adjusted.position
                  }
                }
                const wallDoors = floor.floorPlan.doors.filter((d) => d.wallId === window.wallId)
                const wallWindows = floor.floorPlan.windows.filter(
                  (w) => w.wallId === window.wallId
                )
                const { doorUpdates, windowUpdates } = sanitizeWallOpeningPositions(
                  wall.points,
                  wallDoors,
                  wallWindows
                )
                for (const u of doorUpdates) {
                  const d = floor.floorPlan!.doors.find((x) => x.id === u.id)
                  if (d) d.position = u.position
                }
                for (const u of windowUpdates) {
                  const w = floor.floorPlan!.windows.find((x) => x.id === u.id)
                  if (w) w.position = u.position
                }
                const finalWallDoors = floor.floorPlan.doors.filter(
                  (d) => d.wallId === window.wallId
                )
                const finalWallWindows = floor.floorPlan.windows.filter(
                  (w) => w.wallId === window.wallId
                )
                recomputeOpeningLocalFromNormalized(wall.points, finalWallDoors, finalWallWindows)
              }
              commitBuildingFloorView(state.currentProject, floor.id, floor)
              state.isDirty = true
              return
            }
          }
        }
      }
    }),

  deleteWindow: (windowId) =>
    set((state) => {
      if (state.currentProject) {
        for (const floor of readLegacyCompatibilityFloors(state.currentProject)) {
          if (floor.floorPlan) {
            const windowIndex = floor.floorPlan.windows.findIndex((w) => w.id === windowId)
            if (windowIndex !== -1) {
              floor.floorPlan.windows.splice(windowIndex, 1)
              commitBuildingFloorView(state.currentProject, floor.id, floor)
              state.isDirty = true
              return
            }
          }
        }
      }
    }),

  addStair: (floorId, stair) =>
    set((state) => {
      if (!state.currentProject) return
      const floor = readLegacyCompatibilityFloors(state.currentProject).find(
        (f) => f.id === floorId
      )
      if (!floor) return
      if (!floor.floorPlan) {
        floor.floorPlan = {
          walls: [],
          doors: [],
          windows: [],
          stairs: [],
          graphicElements: [],
          masterWallThickness: 20,
        }
      }
      if (!Array.isArray(floor.floorPlan.stairs)) {
        floor.floorPlan.stairs = []
      }
      floor.floorPlan.stairs.push({ ...stair, id: generateId() })
      commitBuildingFloorView(state.currentProject, floor.id, floor)
      state.isDirty = true
    }),

  updateStair: (stairId, updates) =>
    set((state) => {
      if (!state.currentProject) return
      for (const floor of readLegacyCompatibilityFloors(state.currentProject)) {
        const stair = floor.floorPlan?.stairs?.find((s) => s.id === stairId)
        if (!stair) continue
        Object.assign(stair, updates)
        commitBuildingFloorView(state.currentProject, floor.id, floor)
        state.isDirty = true
        return
      }
    }),

  deleteStair: (stairId) =>
    set((state) => {
      if (!state.currentProject) return
      for (const floor of readLegacyCompatibilityFloors(state.currentProject)) {
        if (!floor.floorPlan?.stairs) continue
        const before = floor.floorPlan.stairs.length
        floor.floorPlan.stairs = floor.floorPlan.stairs.filter((s) => s.id !== stairId)
        if (floor.floorPlan.stairs.length !== before) {
          commitBuildingFloorView(state.currentProject, floor.id, floor)
          state.isDirty = true
          return
        }
      }
    }),

  addPlanGraphicElement: (floorId: string, element: Omit<PlanGraphicElement, 'id'>) =>
    set((state) => {
      if (!state.currentProject) return
      const floor = readLegacyCompatibilityFloors(state.currentProject).find(
        (f) => f.id === floorId
      )
      if (!floor) return
      if (!floor.floorPlan) {
        floor.floorPlan = {
          walls: [],
          doors: [],
          windows: [],
          stairs: [],
          graphicElements: [],
          masterWallThickness: 20,
        }
      }
      if (!Array.isArray(floor.floorPlan.graphicElements)) {
        floor.floorPlan.graphicElements = []
      }
      floor.floorPlan.graphicElements.push({ ...element, id: generateId() })
      commitBuildingFloorView(state.currentProject, floor.id, floor)
      state.isDirty = true
    }),

  updatePlanGraphicElement: (elementId: string, updates: Partial<PlanGraphicElement>) =>
    set((state) => {
      if (!state.currentProject) return
      for (const floor of readLegacyCompatibilityFloors(state.currentProject)) {
        const element = floor.floorPlan?.graphicElements?.find((entry) => entry.id === elementId)
        if (!element) continue
        Object.assign(element, updates)
        commitBuildingFloorView(state.currentProject, floor.id, floor)
        state.isDirty = true
        return
      }
    }),

  deletePlanGraphicElement: (elementId: string) =>
    set((state) => {
      if (!state.currentProject) return
      for (const floor of readLegacyCompatibilityFloors(state.currentProject)) {
        if (!floor.floorPlan?.graphicElements) continue
        const before = floor.floorPlan.graphicElements.length
        floor.floorPlan.graphicElements = floor.floorPlan.graphicElements.filter(
          (entry) => entry.id !== elementId
        )
        if (floor.floorPlan.graphicElements.length !== before) {
          commitBuildingFloorView(state.currentProject, floor.id, floor)
          state.isDirty = true
          return
        }
      }
    }),

  updateFloorPlanSettings: (floorId, settings) =>
    set((state) => {
      if (state.currentProject) {
        const floor = readLegacyCompatibilityFloors(state.currentProject).find(
          (f) => f.id === floorId
        )
        if (floor) {
          if (!floor.floorPlan) {
            floor.floorPlan = {
              walls: [],
              doors: [],
              windows: [],
              stairs: [],
              graphicElements: [],
              masterWallThickness: 20,
            }
          }
          if (settings.masterWallThickness !== undefined) {
            floor.floorPlan.masterWallThickness = settings.masterWallThickness
          }
          commitBuildingFloorView(state.currentProject, floor.id, floor)
          state.isDirty = true
        }
      }
    }),
})
