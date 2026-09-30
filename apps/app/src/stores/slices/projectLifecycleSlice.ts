import {
  applyProjectMetadataUpdate,
  hydrateProjectForEditor,
  prepareProjectForPersistence,
  resetDisciplineSessionState,
} from './projectStoreElectricalHelpers'
import {
  appendUndoSnapshotInStore,
  captureProjectForHistory,
  clearStaleSelectionAfterProjectRestore,
  collapseUndoGroupFromIndex,
  flushPendingProjectHistory,
  getProjectStoreApi,
  projectHistory,
  trimProjectHistory,
} from './projectStoreHistory'
import type { Project, ProjectSliceCreator } from './projectStoreTypes'
import { trackSupplyAssembliesPersisted } from '@/lib/analytics/supplyAssemblyAnalytics'
import { saveProject } from '@/lib/db'
import { clearSessionActionLog, recordSessionAction } from '@/lib/diagnostics/sessionActionLog'
import { projectToStoredProjectV2 } from '@/lib/projectV2/migration'
import { viewportLayoutForPersistence } from '@/lib/viewport/viewportLayoutPersistence'
import { useUIStore } from '@/stores/uiStore'
import { logger } from '@/lib/logger'
import { summarizeConverterDcPersistence } from '@/lib/supplyAssembly/persistenceDiagnostics'
import {
  hasInheritedEendraadLayout,
  inheritEendraadLayoutForVisualEndpointChange,
} from '@/lib/layout/eendraadDerivedLayout'

let saveQueueTail: Promise<void> = Promise.resolve()

function enqueueProjectSave(task: () => Promise<void>): Promise<void> {
  const run = saveQueueTail.catch(() => undefined).then(task)
  saveQueueTail = run
  return run
}

export const createProjectLifecycleSlice: ProjectSliceCreator = (set, get) => ({
  setProject: (project) => {
    projectHistory.resetForProjectSwitch()
    set((state) => {
      const hydratedProject = hydrateProjectForEditor(project)
      state.currentProject = hydratedProject.project
      resetDisciplineSessionState(state)
      state.isDirty = hydratedProject.isDirty
      state.undoStack = []
      state.redoStack = []
      state.planFloorOverlayVisibleByBaseFloorId = {}
      state.planCanvasPlanImageOffsetByFloorId = {}
      clearSessionActionLog()
    })
  },

  setCurrentProjectStorageMode: (mode) =>
    set((state) => {
      state.currentProjectStorageMode = mode
    }),

  touchProjectUpdatedAt: () =>
    set((state) => {
      if (!state.currentProject) return
      state.currentProject.project.updatedAt = new Date().toISOString()
    }),

  updateProject: (updates) =>
    set((state) => {
      if (state.currentProject) {
        applyProjectMetadataUpdate(state.currentProject, updates)
        state.currentProject.project.updatedAt = new Date().toISOString()
        state.isDirty = true
      }
    }),

  upsertProjectAssets: (assets) =>
    set((state) => {
      if (!state.currentProject || assets.length === 0) return
      const replacements = new Map(assets.map((asset) => [asset.id, asset]))
      const current = state.currentProject.assets
      const kept = current.map((asset) => replacements.get(asset.id) ?? asset)
      const existingIds = new Set(current.map((asset) => asset.id))
      state.currentProject.assets = [
        ...kept,
        ...assets.filter((asset) => !existingIds.has(asset.id)),
      ]
      state.currentProject.project.updatedAt = new Date().toISOString()
      state.isDirty = true
    }),

  removeProjectAssets: (ids) =>
    set((state) => {
      if (!state.currentProject) return
      const removed = new Set(ids)
      const assets = state.currentProject.assets.filter((asset) => !removed.has(asset.id))
      if (assets.length === state.currentProject.assets.length) return
      state.currentProject.assets = assets
      state.currentProject.project.updatedAt = new Date().toISOString()
      state.isDirty = true
    }),

  saveCurrentProject: (options) =>
    enqueueProjectSave(async () => {
      const saveStartedAt = import.meta.env.VITE_E2E ? performance.now() : 0
      const projectId = get().currentProject?.project.id
      if (!projectId) return

      // A save can overlap a later editor mutation. Never let the older save clear
      // `isDirty`, otherwise that later mutation is skipped by autosave and vanishes
      // on reload. Keep taking the newest snapshot until the project stays unchanged
      // for one complete persistence pass.
      let projectSnapshot = get().currentProject
      while (projectSnapshot?.project.id === projectId) {
        const currentProject = projectSnapshot
        const { currentProjectStorageMode } = get()
        // Persistence repairs can replace nested V2 collections. The live Zustand
        // snapshot is frozen by Immer, so prepare a private copy for this save.
        const preparedProject = structuredClone(currentProject) as Project
        prepareProjectForPersistence(preparedProject)
        const projectToSave: Project = {
          ...preparedProject,
          project: {
            ...preparedProject.project,
            lastViewportLayout: viewportLayoutForPersistence(useUIStore.getState().viewportLayout),
          },
        }
        const storedProject = projectToStoredProjectV2(projectToSave)
        const dcPersistenceSummary = summarizeConverterDcPersistence(storedProject)
        if (dcPersistenceSummary) {
          logger.debug('[SUPPLY-PERSIST] saving converter DC topology', dcPersistenceSummary)
        }
        await saveProject(storedProject, {
          storageMode: currentProjectStorageMode,
          storageMetadata: options?.storageMetadata,
        })
        if (dcPersistenceSummary) {
          logger.debug('[SUPPLY-PERSIST] converter DC topology saved', dcPersistenceSummary)
        }
        trackSupplyAssembliesPersisted(storedProject, {
          storageMode: currentProjectStorageMode,
          source: 'project_lifecycle_save',
        })

        const latestProject = get().currentProject
        if (latestProject !== currentProject) {
          projectSnapshot = latestProject
          continue
        }
        getProjectStoreApi().setState({ isDirty: false, lastSaved: new Date().toISOString() })
        if (import.meta.env.VITE_E2E) {
          performance.measure('eendra:project-save', {
            start: saveStartedAt,
            end: performance.now(),
          })
        }
        return
      }
    }),

  undo: () => {
    flushPendingProjectHistory()
    const { currentProject, undoStack, redoStack } = get()
    if (!currentProject || undoStack.length === 0) {
      logger.info('[UNDO] no-op (empty history)')
      return
    }
    const currentSnapshot = captureProjectForHistory(currentProject)
    logger.info('[UNDO] applying previous snapshot', {
      undoStackSize: undoStack.length,
      redoStackSize: redoStack.length,
      projectId: currentProject.project?.id,
      projectName: currentProject.project?.name,
    })
    projectHistory.skipNextSubscriberRun()
    projectHistory.runWithoutRecording(() => {
      set((state) => {
        if (!state.currentProject || state.undoStack.length === 0) return
        const previous = state.undoStack[state.undoStack.length - 1]
        if (!previous) return
        const newUndoStack = state.undoStack.slice(0, -1)
        state.currentProject = previous
        state.undoStack = newUndoStack
        state.redoStack = trimProjectHistory([...state.redoStack, currentSnapshot])
        state.isDirty = true
      })
    })
    const restoredProject = get().currentProject
    if (
      restoredProject &&
      restoredProject !== currentProject &&
      hasInheritedEendraadLayout(currentProject)
    ) {
      inheritEendraadLayoutForVisualEndpointChange(currentProject, restoredProject)
    }
    clearStaleSelectionAfterProjectRestore()
    recordSessionAction('undo')
  },

  redo: () => {
    flushPendingProjectHistory()
    const { currentProject, undoStack, redoStack } = get()
    if (!currentProject || redoStack.length === 0) {
      logger.info('[REDO] no-op (empty history)')
      return
    }
    const currentSnapshot = captureProjectForHistory(currentProject)
    logger.info('[REDO] applying next snapshot', {
      undoStackSize: undoStack.length,
      redoStackSize: redoStack.length,
      projectId: currentProject.project?.id,
      projectName: currentProject.project?.name,
    })
    projectHistory.skipNextSubscriberRun()
    projectHistory.runWithoutRecording(() => {
      set((state) => {
        if (!state.currentProject || state.redoStack.length === 0) return
        const next = state.redoStack[state.redoStack.length - 1]
        if (!next) return
        const newRedoStack = state.redoStack.slice(0, -1)
        state.currentProject = next
        state.redoStack = newRedoStack
        state.undoStack = trimProjectHistory([...state.undoStack, currentSnapshot])
        state.isDirty = true
      })
    })
    const restoredProject = get().currentProject
    if (
      restoredProject &&
      restoredProject !== currentProject &&
      hasInheritedEendraadLayout(currentProject)
    ) {
      inheritEendraadLayoutForVisualEndpointChange(currentProject, restoredProject)
    }
    clearStaleSelectionAfterProjectRestore()
    recordSessionAction('redo')
  },

  withSingleUndoEntry: (fn, options) => {
    const projectBefore = get().currentProject
    if (!projectBefore) {
      return fn()
    }
    const snapshotBefore = captureProjectForHistory(projectBefore)
    projectHistory.clearPending()
    let applied = false
    applied = projectHistory.runWithoutRecording(fn)
    const projectAfter = get().currentProject
    const projectChanged = projectAfter !== projectBefore
    if (applied || projectChanged) {
      appendUndoSnapshotInStore(set, snapshotBefore)
      if (options?.sessionLabel) {
        recordSessionAction(options.sessionLabel)
      }
    }
    return applied
  },

  collapseUndoGroupFromIndex: (startIndex) => {
    flushPendingProjectHistory()
    collapseUndoGroupFromIndex(startIndex)
  },
})
