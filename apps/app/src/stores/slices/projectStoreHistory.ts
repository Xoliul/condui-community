import type { StoreApi } from 'zustand'
import type { Floor } from '@/types/schema'
import { useUIStore } from '@/stores/uiStore'
import { type Project, type ProjectState } from './projectStoreTypes'

export const MAX_HISTORY_ENTRIES = 100
export const MIN_HISTORY_ENTRIES = 10
export const MAX_HISTORY_ESTIMATED_BYTES = 96 * 1024 * 1024

const historySnapshotBytes = new WeakMap<Project, number>()
const lastEstimatedBytesByProjectId = new Map<string, number>()
const CONSERVATIVE_UNKNOWN_SNAPSHOT_BYTES = 8 * 1024 * 1024

type HistoryAssetPayload = {
  dataUrl?: string
  svgContent?: string
  legacyDataUrl?: string
  legacyProcessedDataUrl?: string
  legacySvgContent?: string
}

/**
 * Asset payload strings are immutable and can be very large. Keep them out of the
 * deep-clone input, then attach the original string values to the snapshot. The
 * asset records themselves are still cloned, so undo snapshots cannot mutate the
 * current project's asset metadata.
 */
function cloneProjectWithoutCopyingAssetPayloads(project: Project): Project {
  const payloads = new Map<string, HistoryAssetPayload>()
  const cloneInput: Project = {
    ...project,
    assets: project.assets.map((asset) => {
      payloads.set(asset.id, {
        dataUrl: asset.dataUrl,
        svgContent: asset.svgContent,
        legacyDataUrl: asset.legacy?.dataUrl,
        legacyProcessedDataUrl: asset.legacy?.processedDataUrl,
        legacySvgContent: asset.legacy?.svgContent,
      })
      return {
        ...asset,
        dataUrl: undefined,
        svgContent: undefined,
        legacy: asset.legacy
          ? {
              ...asset.legacy,
              dataUrl: undefined,
              processedDataUrl: undefined,
              svgContent: undefined,
            }
          : undefined,
      }
    }),
  }

  const snapshot =
    typeof structuredClone === 'function'
      ? structuredClone(cloneInput)
      : (JSON.parse(JSON.stringify(cloneInput)) as Project)

  historySnapshotBytes.set(snapshot, estimateRetainedBytes(cloneInput))
  lastEstimatedBytesByProjectId.set(
    project.project.id,
    historySnapshotBytes.get(snapshot) ?? CONSERVATIVE_UNKNOWN_SNAPSHOT_BYTES
  )

  for (const asset of snapshot.assets) {
    const payload = payloads.get(asset.id)
    if (!payload) continue
    asset.dataUrl = payload.dataUrl
    asset.svgContent = payload.svgContent
    if (asset.legacy) {
      asset.legacy.dataUrl = payload.legacyDataUrl
      asset.legacy.processedDataUrl = payload.legacyProcessedDataUrl
      asset.legacy.svgContent = payload.legacySvgContent
    }
  }
  return snapshot
}

function estimateRetainedBytes(value: unknown, seen = new WeakSet<object>()): number {
  if (value == null) return 4
  if (typeof value === 'string') return 8 + value.length * 2
  if (typeof value === 'number') return 8
  if (typeof value === 'boolean') return 4
  if (typeof value !== 'object') return 0
  if (seen.has(value)) return 0
  seen.add(value)

  if (Array.isArray(value)) {
    return 24 + value.reduce((total, item) => total + estimateRetainedBytes(item, seen), 0)
  }

  let bytes = 32
  for (const [key, item] of Object.entries(value)) {
    bytes += 8 + key.length * 2 + estimateRetainedBytes(item, seen)
  }
  return bytes
}

function estimateProjectRetainedBytes(project: Project): number {
  const projectWithoutAssets = { ...project, assets: undefined }
  let bytes = estimateRetainedBytes(projectWithoutAssets)
  for (const asset of project.assets) {
    const assetWithoutPayloads = {
      ...asset,
      dataUrl: undefined,
      svgContent: undefined,
      legacy: asset.legacy
        ? {
            ...asset.legacy,
            dataUrl: undefined,
            processedDataUrl: undefined,
            svgContent: undefined,
          }
        : undefined,
    }
    bytes += estimateRetainedBytes(assetWithoutPayloads)
  }
  return bytes
}

export function getEstimatedHistoryBytes(snapshots: readonly Project[]): number {
  return snapshots.reduce(
    (total, snapshot) =>
      total + (historySnapshotBytes.get(snapshot) ?? estimateProjectRetainedBytes(snapshot)),
    0
  )
}

export function trimProjectHistory(
  snapshots: readonly Project[],
  limits: { maxEntries?: number; minEntries?: number; maxEstimatedBytes?: number } = {}
): Project[] {
  const maxEntries = limits.maxEntries ?? MAX_HISTORY_ENTRIES
  const minEntries = Math.min(limits.minEntries ?? MIN_HISTORY_ENTRIES, maxEntries)
  const maxEstimatedBytes = limits.maxEstimatedBytes ?? MAX_HISTORY_ESTIMATED_BYTES
  const retained = snapshots.slice(-maxEntries)
  let retainedBytes = getEstimatedHistoryBytes(retained)
  while (retained.length > minEntries && retainedBytes > maxEstimatedBytes) {
    const removed = retained.shift()
    if (removed) {
      retainedBytes -= historySnapshotBytes.get(removed) ?? estimateProjectRetainedBytes(removed)
    }
  }
  return retained
}

export const cloneProjectForHistory = (project: Project): Project => {
  return cloneProjectWithoutCopyingAssetPayloads(project)
}

/**
 * Capture an Immer-produced project revision for undo without cloning it.
 *
 * Zustand's Immer middleware freezes completed revisions, so subsequent edits create new
 * objects and cannot mutate this revision. Keeping that immutable root is both undo-safe and
 * lets adjacent history entries share their unchanged V2 subtrees. Non-Immer callers retain
 * the defensive deep-clone behavior.
 */
export const captureProjectForHistory = (project: Project): Project => {
  if (!Object.isFrozen(project)) return cloneProjectForHistory(project)

  if (!historySnapshotBytes.has(project)) {
    historySnapshotBytes.set(
      project,
      lastEstimatedBytesByProjectId.get(project.project.id) ?? CONSERVATIVE_UNKNOWN_SNAPSHOT_BYTES
    )
  }
  return project
}

// Coalesce rapid-fire edits (typing, sliders) into a single undo entry.
// This avoids deep-cloning the entire project on every keystroke.
export const HISTORY_DEBOUNCE_MS = 400

class ProjectHistoryCoordinator {
  private recordingSuppressionDepth = 0
  private skipNextSubscriber = false
  private suppressNextDebouncedSubscriber = false
  private pendingTimer: number | null = null
  private pendingProject: Project | null = null

  isRecordingEnabled(): boolean {
    return this.recordingSuppressionDepth === 0
  }

  runWithoutRecording<T>(fn: () => T): T {
    this.recordingSuppressionDepth += 1
    try {
      return fn()
    } finally {
      this.recordingSuppressionDepth = Math.max(0, this.recordingSuppressionDepth - 1)
    }
  }

  skipNextSubscriberRun(): void {
    this.skipNextSubscriber = true
  }

  consumeSkipNextSubscriberRun(): boolean {
    const shouldSkip = this.skipNextSubscriber
    this.skipNextSubscriber = false
    if (shouldSkip) this.clearPending()
    return shouldSkip
  }

  suppressNextDebouncedRun(): void {
    this.suppressNextDebouncedSubscriber = true
  }

  consumeSuppressNextDebouncedRun(): boolean {
    const shouldSuppress = this.suppressNextDebouncedSubscriber
    this.suppressNextDebouncedSubscriber = false
    return shouldSuppress
  }

  clearDebouncedSuppression(): void {
    this.suppressNextDebouncedSubscriber = false
  }

  resetForProjectSwitch(): void {
    this.clearPending()
    this.clearDebouncedSuppression()
    this.skipNextSubscriber = true
  }

  clearPending(): void {
    if (this.pendingTimer != null) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = null
    }
    this.pendingProject = null
  }

  flushPending(): void {
    if (this.pendingTimer != null) {
      clearTimeout(this.pendingTimer)
      this.pendingTimer = null
    }
    const toSnapshot = this.pendingProject
    this.pendingProject = null
    if (!toSnapshot) return
    pushUndoSnapshot(toSnapshot)
  }

  schedulePending(project: Project): void {
    this.pendingProject = project
    if (this.pendingTimer != null) clearTimeout(this.pendingTimer)
    this.pendingTimer = window.setTimeout(() => {
      this.flushPending()
    }, HISTORY_DEBOUNCE_MS)
  }
}

export const projectHistory = new ProjectHistoryCoordinator()

let projectStoreApi: StoreApi<ProjectState> | null = null

export function bindProjectStoreApi(api: StoreApi<ProjectState>): void {
  projectStoreApi = api
}

export function getProjectStoreApi(): StoreApi<ProjectState> {
  if (!projectStoreApi) throw new Error('Project store API requested before initialization')
  return projectStoreApi
}

export function appendUndoSnapshotInStore(
  _set: (fn: (state: ProjectState) => void) => void,
  snapshotBefore: Project
): void {
  const api = getProjectStoreApi()
  const state = api.getState()
  // History entries are already immutable snapshots. Apply this shallow store-only update
  // directly so Immer does not draft/finalize an ever-growing history array on every edit.
  api.setState({
    undoStack: trimProjectHistory([...state.undoStack, snapshotBefore]),
    redoStack: [],
  })
}

export function pushUndoSnapshot(snapshotProject: Project): void {
  const snapshot = captureProjectForHistory(snapshotProject)
  getProjectStoreApi().setState((s: ProjectState) => {
    return { undoStack: trimProjectHistory([...s.undoStack, snapshot]), redoStack: [] }
  })
}

export function flushPendingProjectHistory(): void {
  projectHistory.flushPending()
}

/**
 * Start a fresh undo history. Used after actions that must not be undone, such as
 * importing a plan: undo would otherwise silently remove the imported floors.
 */
export function clearProjectHistory(): void {
  projectHistory.clearPending()
  getProjectStoreApi().setState({ undoStack: [], redoStack: [] })
}

/**
 * Merge consecutive undo snapshots from `startIndex` onward into a single step.
 * Used when a picker records exploratory edits that should undo atomically on exit.
 */
export function collapseUndoGroupFromIndex(startIndex: number): void {
  getProjectStoreApi().setState((state) => {
    if (startIndex < 0 || startIndex >= state.undoStack.length) return {}
    const baseline = state.undoStack[startIndex]
    if (!baseline) return {}
    return {
      undoStack: [...state.undoStack.slice(0, startIndex), baseline],
      redoStack: [],
    }
  })
}

export function clearStaleSelectionAfterProjectRestore(): void {
  const { selection, setSelection } = useUIStore.getState()
  if (!selection.type || selection.ids.length === 0) return

  const store = getProjectStoreApi().getState()
  if (selection.type === 'endpoint') {
    const hasMissing = selection.ids.some((id) => !store.getEndpointById(id))
    if (hasMissing) setSelection({ type: null, ids: [] })
    return
  }
  if (selection.type === 'placement') {
    const hasMissing = selection.ids.some((id) => !store.getPlacementById(id))
    if (hasMissing) setSelection({ type: null, ids: [] })
  }
}

export function floorHasReferenceOverlayContent(floor: Floor): boolean {
  if (floor.planAsset || floor.planImportAsset) return true
  const fp = floor.floorPlan
  if (!fp) return false
  return (
    (fp.walls?.length ?? 0) > 0 ||
    (fp.doors?.length ?? 0) > 0 ||
    (fp.windows?.length ?? 0) > 0 ||
    (fp.stairs?.length ?? 0) > 0
  )
}

export function findClosestNonEmptyBelow(floors: Floor[], startIndex: number): Floor | null {
  for (let i = startIndex; i < floors.length; i++) {
    const f = floors[i]
    if (f && floorHasReferenceOverlayContent(f)) return f
  }
  return null
}

export function findClosestNonEmptyAbove(floors: Floor[], startIndex: number): Floor | null {
  for (let i = startIndex; i >= 0; i--) {
    const f = floors[i]
    if (f && floorHasReferenceOverlayContent(f)) return f
  }
  return null
}

export function pickDefaultPlanReferenceOverlayFloor(
  floors: Floor[],
  baseFloorId: string
): string | null {
  const idx = floors.findIndex((f) => f.id === baseFloorId)
  if (idx < 0) return null

  const immediateBelow = floors[idx + 1] ?? null
  if (immediateBelow) {
    if (floorHasReferenceOverlayContent(immediateBelow)) return immediateBelow.id
    const nonEmptyBelow = findClosestNonEmptyBelow(floors, idx + 1)
    return nonEmptyBelow?.id ?? immediateBelow.id
  }

  const immediateAbove = floors[idx - 1] ?? null
  if (immediateAbove) {
    if (floorHasReferenceOverlayContent(immediateAbove)) return immediateAbove.id
    const nonEmptyBelow = findClosestNonEmptyBelow(floors, idx + 1)
    if (nonEmptyBelow) return nonEmptyBelow.id
    const nonEmptyAbove = findClosestNonEmptyAbove(floors, idx - 1)
    return nonEmptyAbove?.id ?? immediateAbove.id
  }

  return null
}

export function sanitizeOverlayMap(
  overlayByBase: Record<string, string[]> | undefined,
  floors: Floor[]
): Record<string, string[]> {
  if (!overlayByBase) return {}
  const knownFloorIds = new Set(floors.map((f) => f.id))
  const sanitized: Record<string, string[]> = {}

  for (const [baseFloorId, overlayFloorIds] of Object.entries(overlayByBase)) {
    if (!knownFloorIds.has(baseFloorId)) continue
    const unique: string[] = []
    for (const floorId of overlayFloorIds ?? []) {
      if (!knownFloorIds.has(floorId) || floorId === baseFloorId || unique.includes(floorId))
        continue
      unique.push(floorId)
    }
    if (unique.length > 0) sanitized[baseFloorId] = unique
  }

  return sanitized
}
