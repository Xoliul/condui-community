import { updateBuildingPropertiesInProject } from '@/lib/properties/generalPropertyMutations'
import { deleteBuildingEntitiesInProject } from '@/lib/plan/buildingDeletion'
import {
  applyPlanRescaleInProject,
  deleteFloorInProject,
  detachPlanBackgroundInProject,
  reorderFloorsInProject,
} from '@/lib/plan/floorSetupMutations'
import { pickDefaultPlanReferenceOverlayFloor } from './projectStoreHistory'
import type { ProjectSliceCreator } from './projectStoreTypes'
import { ensureElectricalLayerOnFloor } from '@/lib/plan/floorLayers'
import { resolvePlanPxPerMeter } from '@/lib/plan/planScale'
import { updatePlanWiringVisibilityInProject } from '@/lib/plan/planWiringVisibilityMutation'
import { preserveOtherFloorsOnScaleChange } from '@/lib/plan/rescalePlan'
import {
  addBuildingGeometryToFloorPlan,
  createEmptyFloorPlan,
} from '@/lib/plan/buildingGeometryMutations'
import { mergeWallPointsInFloorPlan } from '@/lib/plan/wallMerge'
import { updateFloorInProject } from '@/lib/projectMutations/storeActions'
import {
  addBuildingFloorView,
  commitBuildingFloorView,
  readLegacyCompatibilityFloors,
  selectProjectPlanScale,
  setPlanScaleForProject,
} from '@/lib/projectV2/buildingFloors'
import { useUIStore } from '@/stores/uiStore'
import type { PlanGraphicElement } from '@/types/schema'
import { generateId } from '@/utils/project'

export const createBuildingFloorSlice: ProjectSliceCreator = (set, get) => ({
  // Floor actions
  addFloor: (floor) =>
    set((state) => {
      if (state.currentProject) {
        const sharedScale = selectProjectPlanScale(state.currentProject)
        if (floor.scale && resolvePlanPxPerMeter(floor.scale) == null) return
        if (floor.scale) {
          preserveOtherFloorsOnScaleChange(state.currentProject, floor.id, floor.scale)
          if (floor.scale.reference)
            floor.scale = {
              ...floor.scale,
              reference: { ...floor.scale.reference, floorId: floor.id },
            }
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
      set((state) => {
        if (!state.currentProject) return
        let changed = false
        for (const floorId of floorIds)
          changed = !!detachPlanBackgroundInProject(state.currentProject, floorId) || changed
        if (!changed && planAssetId) return
        state.isDirty = true
      })
      return true
    })
  },

  updateFloor: (id, updates) =>
    set((state) => {
      if (!state.currentProject) return
      const result = updateFloorInProject(
        state.currentProject,
        id,
        updates,
        useUIStore.getState().activePanelId
      )
      if (result.changed) state.isDirty = true
    }),

  updatePlanWiringVisibility: (updates) =>
    set((state) => {
      if (!state.currentProject) return
      if (
        updatePlanWiringVisibilityInProject(state.currentProject, updates, new Date().toISOString())
      )
        state.isDirty = true
    }),

  applyPlanRescale: (floorId, floorUpdates, placementUpdates, options) =>
    set((state) => {
      if (!state.currentProject) return
      if (
        applyPlanRescaleInProject(
          state.currentProject,
          floorId,
          floorUpdates,
          placementUpdates,
          options
        )
      )
        state.isDirty = true
    }),

  deleteFloor: (id) =>
    set((state) => {
      if (!state.currentProject) return
      const result = deleteFloorInProject(state.currentProject, id)
      if (!result) return
      state.isDirty = true
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
      if (!state.currentProject) return
      if (reorderFloorsInProject(state.currentProject, fromIndex, toIndex)) state.isDirty = true
    }),

  // Floor plan actions
  addWall: (floorId, wall) =>
    set((state) => {
      if (state.currentProject) {
        const floor = readLegacyCompatibilityFloors(state.currentProject).find(
          (f) => f.id === floorId
        )
        if (floor) {
          const floorPlan = (floor.floorPlan ??= createEmptyFloorPlan())
          if (!addBuildingGeometryToFloorPlan(floorPlan, { kind: 'wall', value: wall }, generateId))
            return
          commitBuildingFloorView(state.currentProject, floor.id, floor)
          state.isDirty = true
        }
      }
    }),

  updateWall: (wallId, updates) =>
    set((state) => {
      if (
        state.currentProject &&
        updateBuildingPropertiesInProject(
          state.currentProject,
          'wall',
          wallId,
          updates as Record<string, unknown>
        )
      )
        state.isDirty = true
    }),

  deleteWall: (wallId) =>
    set((state) => {
      if (
        state.currentProject &&
        deleteBuildingEntitiesInProject(state.currentProject, 'wall', [wallId])
      )
        state.isDirty = true
    }),

  deleteWalls: (wallIds) =>
    set((state) => {
      if (
        state.currentProject &&
        deleteBuildingEntitiesInProject(state.currentProject, 'wall', wallIds)
      )
        state.isDirty = true
    }),

  mergeWallPoints: (floorId, wallId1, pointIndex1, wallId2, pointIndex2) => {
    const state = get()
    const floor = state.currentProject
      ? readLegacyCompatibilityFloors(state.currentProject).find(
          (candidate) => candidate.id === floorId
        )
      : undefined
    if (!floor?.floorPlan || !state.currentProject) return false
    if (!mergeWallPointsInFloorPlan(floor.floorPlan, wallId1, pointIndex1, wallId2, pointIndex2))
      return false
    commitBuildingFloorView(state.currentProject, floor.id, floor)
    state.isDirty = true
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
          const floorPlan = (floor.floorPlan ??= createEmptyFloorPlan())
          if (!addBuildingGeometryToFloorPlan(floorPlan, { kind: 'door', value: door }, generateId))
            return
          commitBuildingFloorView(state.currentProject, floor.id, floor)
          state.isDirty = true
        }
      }
    }),

  updateDoor: (doorId, updates) =>
    set((state) => {
      if (
        state.currentProject &&
        updateBuildingPropertiesInProject(
          state.currentProject,
          'door',
          doorId,
          updates as Record<string, unknown>
        )
      )
        state.isDirty = true
    }),

  deleteDoor: (doorId) =>
    set((state) => {
      if (
        state.currentProject &&
        deleteBuildingEntitiesInProject(state.currentProject, 'door', [doorId])
      )
        state.isDirty = true
    }),

  addWindow: (floorId, window) =>
    set((state) => {
      if (state.currentProject) {
        const floor = readLegacyCompatibilityFloors(state.currentProject).find(
          (f) => f.id === floorId
        )
        if (floor) {
          const floorPlan = (floor.floorPlan ??= createEmptyFloorPlan())
          if (
            !addBuildingGeometryToFloorPlan(
              floorPlan,
              { kind: 'window', value: window },
              generateId
            )
          )
            return
          commitBuildingFloorView(state.currentProject, floor.id, floor)
          state.isDirty = true
        }
      }
    }),

  updateWindow: (windowId, updates) =>
    set((state) => {
      if (
        state.currentProject &&
        updateBuildingPropertiesInProject(
          state.currentProject,
          'window',
          windowId,
          updates as Record<string, unknown>
        )
      )
        state.isDirty = true
    }),

  deleteWindow: (windowId) =>
    set((state) => {
      if (
        state.currentProject &&
        deleteBuildingEntitiesInProject(state.currentProject, 'window', [windowId])
      )
        state.isDirty = true
    }),

  addStair: (floorId, stair) =>
    set((state) => {
      if (!state.currentProject) return
      const floor = readLegacyCompatibilityFloors(state.currentProject).find(
        (f) => f.id === floorId
      )
      if (!floor) return
      const floorPlan = (floor.floorPlan ??= createEmptyFloorPlan())
      addBuildingGeometryToFloorPlan(floorPlan, { kind: 'stair', value: stair }, generateId)
      commitBuildingFloorView(state.currentProject, floor.id, floor)
      state.isDirty = true
    }),

  updateStair: (stairId, updates) =>
    set((state) => {
      if (
        state.currentProject &&
        updateBuildingPropertiesInProject(
          state.currentProject,
          'stair',
          stairId,
          updates as Record<string, unknown>
        )
      )
        state.isDirty = true
    }),

  deleteStair: (stairId) =>
    set((state) => {
      if (
        state.currentProject &&
        deleteBuildingEntitiesInProject(state.currentProject, 'stair', [stairId])
      )
        state.isDirty = true
    }),

  addPlanGraphicElement: (floorId: string, element: Omit<PlanGraphicElement, 'id'>) =>
    set((state) => {
      if (!state.currentProject) return
      const floor = readLegacyCompatibilityFloors(state.currentProject).find(
        (f) => f.id === floorId
      )
      if (!floor) return
      const floorPlan = (floor.floorPlan ??= createEmptyFloorPlan())
      addBuildingGeometryToFloorPlan(
        floorPlan,
        { kind: 'graphicElement', value: element },
        generateId
      )
      commitBuildingFloorView(state.currentProject, floor.id, floor)
      state.isDirty = true
    }),

  updatePlanGraphicElement: (elementId: string, updates: Partial<PlanGraphicElement>) =>
    set((state) => {
      if (
        state.currentProject &&
        updateBuildingPropertiesInProject(
          state.currentProject,
          'graphicElement',
          elementId,
          updates as Record<string, unknown>
        )
      )
        state.isDirty = true
    }),

  deletePlanGraphicElement: (elementId) =>
    set((state) => {
      if (
        state.currentProject &&
        deleteBuildingEntitiesInProject(state.currentProject, 'graphicElement', [elementId])
      )
        state.isDirty = true
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
