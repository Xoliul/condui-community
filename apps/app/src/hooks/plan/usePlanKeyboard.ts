import { useEffect, type MutableRefObject } from 'react'
import { usePlanSymbolNudgeKeyboard } from '@/hooks/plan/usePlanSymbolNudgeKeyboard'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import { useDialogStore } from '@/stores/dialogStore'
import { endpointSupportsMultiplier } from '@/utils/endpointMultipliers'
import { logger } from '@/lib/logger'
import type { Door, Floor, Panel, Placement, Stair, Wall, Window } from '@/types/schema'
import {
  isMainPanelDistributionEndpoint,
  resolvePanelForDistributionEndpoint,
} from '@/lib/plan/panelDistributionEndpoint'
import { resolveSelectionToEndpointIds } from '@/lib/plan/selectionResolvers'
import { confirmDeleteEarthing } from '@/lib/installation/deleteEarthing'
import {
  selectProjectBuildingFloors,
  readLegacyCompatibilityFloors,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import { isKeyboardTypingTarget } from '@/lib/ui/keyboardTypingTarget'
import {
  decidePlanKeyboardAction,
  describePlanKeyboardDecision,
  PLAN_ARROW_KEY_PRECEDENCE,
} from '@/lib/plan/planKeyboardDecisions'
import { explicitClockwiseRotationPatch } from '@/lib/plan/situationPlanRotation'
import { deleteSelectedPlanGraphicElements } from '@/lib/plan/planGraphicElementDeletion'
import { mergeHiddenSituationPlanPlacementIds } from '@/lib/plan/hideSituationPlanPlacements'
import { openSituationPlanBulkDeleteWarning } from '@/components/plan/SituationPlanBulkDeleteWarningDialog'

type PlanKeyboardProject = ProjectWithOptionalV2Building & ProjectWithOptionalV2Electrical

/**
 * Resolve wall IDs from either wall selection or encoded wall-point selection IDs.
 */
function resolveSelectionToWallIds(selection: { type: string | null; ids: string[] }): string[] {
  if (selection.type === 'wall') {
    return selection.ids
  }
  if (selection.type === 'wallPoint') {
    const wallIds = new Set<string>()
    selection.ids.forEach((id) => {
      // Wall-point IDs are encoded as: v|<wallId>|<pointIndex>
      const parts = id.split('|')
      if (parts.length === 3 && parts[0] === 'v' && parts[1]) {
        wallIds.add(parts[1])
      }
    })
    return Array.from(wallIds)
  }
  return []
}

function resolveSelectionToWallPointIds(selection: {
  type: string | null
  ids: string[]
}): Map<string, number[]> {
  const map = new Map<string, number[]>()
  if (selection.type !== 'wallPoint') return map
  selection.ids.forEach((id) => {
    const parts = id.split('|')
    if (parts.length !== 3 || parts[0] !== 'v' || !parts[1]) return
    const pointIndex = Number(parts[2])
    if (!Number.isFinite(pointIndex)) return
    const wallId = parts[1]
    const existing = map.get(wallId) ?? []
    if (!existing.includes(pointIndex)) {
      map.set(
        wallId,
        [...existing, pointIndex].sort((a, b) => a - b)
      )
    }
  })
  return map
}

function resolveSelectionToStairIds(selection: { type: string | null; ids: string[] }): string[] {
  if (selection.type === 'stair') {
    return selection.ids
  }
  if (selection.type === 'stairPoint' && selection.ids.length > 0) {
    return selection.ids[0] ? [selection.ids[0]] : []
  }
  return []
}

function resolveSelectionToStairPointIds(selection: {
  type: string | null
  ids: string[]
}): Map<string, number[]> {
  const map = new Map<string, number[]>()
  if (selection.type === 'stairPoint' && selection.ids.length >= 2) {
    const stairId = selection.ids[0]
    const idx = Number(selection.ids[1])
    if (stairId && Number.isFinite(idx)) {
      map.set(stairId, [idx])
    }
    return map
  }
  if (selection.type === 'wallPoint') {
    selection.ids.forEach((id) => {
      if (!id.startsWith('s|')) return
      const parts = id.split('|')
      if (parts.length !== 3 || !parts[1]) return
      const pointIndex = Number(parts[2])
      if (!Number.isFinite(pointIndex)) return
      const stairId = parts[1]
      const existing = map.get(stairId) ?? []
      if (!existing.includes(pointIndex)) {
        map.set(
          stairId,
          [...existing, pointIndex].sort((a, b) => a - b)
        )
      }
    })
  }
  return map
}

/**
 * Trace plan hotkeys in the console (filter: [PlanKeyboard]).
 * Enabled in Vite dev, or after: localStorage.setItem('debugPlanKeyboard', '1') and reload.
 */
export function isPlanKeyboardDebugEnabled(): boolean {
  try {
    if (import.meta.env?.DEV) return true
  } catch {
    /* non-Vite / SSR */
  }
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('debugPlanKeyboard') === '1'
  } catch {
    return false
  }
}

let planKeyboardRegistrationLogged = false

function describeKeyEventTarget(target: EventTarget | null): string {
  if (!target || !(target instanceof Node)) return String(target)
  if (target instanceof HTMLElement) {
    const id = target.id ? `#${target.id}` : ''
    const ce = target.isContentEditable ? ' contenteditable' : ''
    const role = target.getAttribute('role') ? ` role=${target.getAttribute('role')}` : ''
    return `${target.tagName.toLowerCase()}${id}${ce}${role}`
  }
  return target.nodeName
}

export type PlanKeyboardToolShortcuts = {
  onToggleQuickPlacer: () => void
  onToggleWiring: () => void
  onToggleDrawMode: () => void
  canToggleQuickPlacerAndWiring: boolean
  canToggleDrawMode: boolean
}

export type PlanKeyboardOptions = {
  /** When set, hotkey S toggles snap only while the pointer is inside the plan container. */
  pointerOverPlanRef?: MutableRefObject<boolean>
  /** When true, digit keys 1–9 are not used for floor switching (e.g. opening width editor). */
  suppressDigitFloorShortcuts?: boolean
  /**
   * Called immediately before a digit-key floor switch. Returning false keeps the current floor.
   * The plan drag controller uses this to move held symbols before the canvas changes floors.
   */
  onBeforeSwitchFloor?: (floorId: string) => boolean
  /** Disable edit-only shortcuts such as Delete while keeping view-level shortcuts elsewhere active. */
  disabled?: boolean
  /** Canvas-owned deletion for local wall point/segment selection state. */
  onDeleteFloorPlanSelection?: () => boolean
  /** Standard Ctrl/Cmd+C and Ctrl/Cmd+V for floor-plan geometry. */
  floorPlanClipboard?: {
    onCopy: () => boolean
    onPaste: () => boolean
  }
  /** Q / W / D toggles for quick placer, wiring, and draw mode (plan hover only). */
  toolShortcuts?: PlanKeyboardToolShortcuts
  /** Arrow-key nudge for selected symbols (plan visible, selection active). */
  symbolNudge?: {
    pxPerMeter?: number | null
    setPreviewPositions: (positions: Map<string, import('@/types/ui').Point>) => void
    isDraggingRef?: MutableRefObject<boolean>
    onCommit?: () => void
  }
}

type FloorPlacement = Placement & {
  endpointId?: string
  trunkDeviceId?: string
  junctionPanelLabel?: string
  isEarthing?: boolean
}

/**
 * Hook to handle keyboard shortcuts for the plan canvas
 */
export function usePlanKeyboard(activeFloorId: string | null, options?: PlanKeyboardOptions) {
  const { t } = useTranslation()
  const getEndpointById = useProjectStore((state) => state.getEndpointById)
  const openDialog = useDialogStore((state) => state.openDialog)
  const onDeleteFloorPlanSelection = options?.onDeleteFloorPlanSelection
  const pointerOverPlanRef = options?.pointerOverPlanRef
  const suppressDigitFloorShortcuts = options?.suppressDigitFloorShortcuts
  const onBeforeSwitchFloor = options?.onBeforeSwitchFloor
  const keyboardDisabled = options?.disabled
  const toolShortcuts = options?.toolShortcuts
  const onCopyFloorPlanSelection = options?.floorPlanClipboard?.onCopy
  const onPasteFloorPlanSelection = options?.floorPlanClipboard?.onPaste

  usePlanSymbolNudgeKeyboard({
    activeFloorId,
    pxPerMeter: options?.symbolNudge?.pxPerMeter,
    setPreviewPositions: options?.symbolNudge?.setPreviewPositions ?? (() => {}),
    isDraggingRef: options?.symbolNudge?.isDraggingRef,
    onCommit: options?.symbolNudge?.onCommit,
    disabled: options?.disabled || !options?.symbolNudge,
  })

  useEffect(() => {
    const getProjectFloors = (project: PlanKeyboardProject | null | undefined): Floor[] =>
      project ? selectProjectBuildingFloors(project) : []
    const getCurrentProjectFloors = (): Floor[] =>
      getProjectFloors(useProjectStore.getState().currentProject)
    const getAllPlanWalls = (project: PlanKeyboardProject | null): Wall[] =>
      project
        ? readLegacyCompatibilityFloors(project).flatMap(
            (floor) => floor.floorPlan?.walls ?? []
          )
        : []
    const getAllPlanDoors = (project: PlanKeyboardProject | null): Door[] =>
      project
        ? readLegacyCompatibilityFloors(project).flatMap(
            (floor) => floor.floorPlan?.doors ?? []
          )
        : []
    const getAllPlanWindows = (project: PlanKeyboardProject | null): Window[] =>
      project
        ? readLegacyCompatibilityFloors(project).flatMap(
            (floor) => floor.floorPlan?.windows ?? []
          )
        : []
    const getAllPlanStairs = (project: PlanKeyboardProject | null): Stair[] =>
      project
        ? readLegacyCompatibilityFloors(project).flatMap(
            (floor) => floor.floorPlan?.stairs ?? []
          )
        : []

    if (isPlanKeyboardDebugEnabled() && !planKeyboardRegistrationLogged) {
      planKeyboardRegistrationLogged = true
      logger.info(
        '[PlanKeyboard] window keydown listener registered for plan canvas. Hover the plan, then try S or 1–9. (Prod: localStorage.setItem("debugPlanKeyboard","1") + reload if you see no logs.)'
      )
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const typing = isKeyboardTypingTarget(e.target)
      if (keyboardDisabled) return
      const floors = getCurrentProjectFloors()
      const pointerOverPlan = pointerOverPlanRef?.current === true

      if (
        pointerOverPlan &&
        !typing &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.repeat &&
        (e.key === 'r' || e.key === 'R') &&
        activeFloorId
      ) {
        const store = useProjectStore.getState()
        const { selection } = useUIStore.getState()
        const rows = store.getPlacementsByFloor(activeFloorId) as FloorPlacement[]
        const selectedPlacementIds = new Set<string>()

        if (selection.type === 'placement') {
          selection.ids.forEach((id) => selectedPlacementIds.add(id))
        } else if (selection.type === 'ground' && selection.ids.includes('ground')) {
          rows.filter((row) => row.isEarthing).forEach((row) => selectedPlacementIds.add(row.id))
        } else if (selection.type === 'endpoint' || selection.type === 'panel') {
          const endpointIds = new Set(
            resolveSelectionToEndpointIds(selection, {
              getPanelById: store.getPanelById,
              getPanelByName: store.getPanelByName,
              getAllEndpoints: store.getAllEndpoints,
            })
          )
          rows
            .filter((row) => row.endpointId && endpointIds.has(row.endpointId))
            .forEach((row) => selectedPlacementIds.add(row.id))
        } else if (selection.type === 'trunkDevice') {
          const trunkDeviceIds = new Set(selection.ids)
          const junctionPanelLabels = new Set(
            selection.ids.flatMap((id) => {
              const device = store.getTrunkDeviceById(id)?.device
              return device?.type === 'junction_panel' && device.label ? [device.label] : []
            })
          )
          rows
            .filter(
              (row) =>
                (row.trunkDeviceId != null && trunkDeviceIds.has(row.trunkDeviceId)) ||
                (row.junctionPanelLabel != null &&
                  (trunkDeviceIds.has(row.id) || junctionPanelLabels.has(row.junctionPanelLabel)))
            )
            .forEach((row) => selectedPlacementIds.add(row.id))
        }

        const targets = rows.filter((row) => selectedPlacementIds.has(row.id))
        if (targets.length > 0) {
          e.preventDefault()
          store.withSingleUndoEntry(
            () => {
              targets.forEach((placement) => {
                const patch = explicitClockwiseRotationPatch(placement)
                if (placement.junctionPanelLabel != null) {
                  store.updateJunctionPanelPlacement(placement.id, patch)
                } else if (placement.isEarthing) {
                  store.updateEarthingPlacement(placement.id, patch)
                } else {
                  store.updatePlacement(placement.id, patch)
                }
              })
              return true
            },
            { sessionLabel: 'rotate situation plan symbols' }
          )
          return
        }
      }

      const decisionContext = {
        pointerOverPlan,
        suppressDigitFloorShortcuts: !!suppressDigitFloorShortcuts,
        floorIds: floors.map((floor) => floor.id),
        toolShortcuts: toolShortcuts
          ? {
              canToggleQuickPlacerAndWiring: toolShortcuts.canToggleQuickPlacerAndWiring,
              canToggleDrawMode: toolShortcuts.canToggleDrawMode,
            }
          : undefined,
        clipboardShortcuts: !!onCopyFloorPlanSelection && !!onPasteFloorPlanSelection,
      }
      const decision = decidePlanKeyboardAction(
        {
          key: e.key,
          code: e.code,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
          typing,
        },
        decisionContext
      )
      const traceHotkeys = e.key === 's' || e.key === 'S' || /^[1-9]$/.test(e.key)

      if (traceHotkeys && isPlanKeyboardDebugEnabled()) {
        logger.info('[PlanKeyboard] keydown', {
          key: e.key,
          code: e.code,
          outcome: describePlanKeyboardDecision(
            {
              key: e.key,
              code: e.code,
              ctrlKey: e.ctrlKey,
              metaKey: e.metaKey,
              altKey: e.altKey,
              shiftKey: e.shiftKey,
              typing,
            },
            decisionContext
          ),
          arrowPrecedence: PLAN_ARROW_KEY_PRECEDENCE,
          typing,
          eventTarget: describeKeyEventTarget(e.target),
          activeElement: describeKeyEventTarget(document.activeElement),
          pointerOverPlan,
          hasPointerOverPlanRef: !!pointerOverPlanRef,
          suppressDigitFloorShortcuts: !!suppressDigitFloorShortcuts,
          floorCount: floors.length,
          defaultPreventedBefore: e.defaultPrevented,
        })
      }

      switch (decision.kind) {
        case 'toggleSnap': {
          e.preventDefault()
          const { planView, setPlanView } = useUIStore.getState()
          setPlanView({ snapToGrid: !planView.snapToGrid })
          if (isPlanKeyboardDebugEnabled()) {
            logger.info('[PlanKeyboard] toggled snapToGrid →', !planView.snapToGrid)
          }
          return
        }
        case 'toggleQuickPlacer':
          e.preventDefault()
          toolShortcuts?.onToggleQuickPlacer()
          return
        case 'toggleWiring':
          e.preventDefault()
          toolShortcuts?.onToggleWiring()
          return
        case 'toggleDrawMode':
          e.preventDefault()
          toolShortcuts?.onToggleDrawMode()
          return
        case 'switchFloor': {
          e.preventDefault()
          const floor = floors[decision.index]
          if (onBeforeSwitchFloor?.(decision.floorId) === false) {
            logger.warn(
              '[PlanKeyboard] floor switch blocked: active drag could not be transferred',
              {
                fromFloorId: activeFloorId,
                toFloorId: decision.floorId,
              }
            )
            return
          }
          useUIStore.getState().setActiveFloor(decision.floorId)
          if (isPlanKeyboardDebugEnabled()) {
            logger.info('[PlanKeyboard] setActiveFloor', {
              index: decision.index,
              floorId: decision.floorId,
              name: floor?.name,
            })
          }
          return
        }
        case 'copyFloorPlanSelection':
          if (onCopyFloorPlanSelection?.()) e.preventDefault()
          return
        case 'pasteFloorPlanSelection':
          if (onPasteFloorPlanSelection?.()) e.preventDefault()
          return
        case 'ignore':
          break
        case 'deleteSelection':
          break
      }

      if (decision.kind !== 'deleteSelection') {
        return
      }

      // Handle Delete (check both key and code for cross-platform compatibility)
      if (e.key === 'Delete' || e.code === 'Delete' || e.key === 'Backspace') {
        const { selection } = useUIStore.getState()
        if (isPlanKeyboardDebugEnabled()) {
          logger.info('[PlanDelete][Global] keydown', {
            key: e.key,
            code: e.code,
            activeFloorId,
            selectionType: selection.type,
            selectionIds: selection.ids,
          })
        }
        if (onDeleteFloorPlanSelection?.()) {
          e.preventDefault()
          return
        }
        const {
          deleteEndpoints,
          deletePlacements,
          deleteSitplanNotes,
          getSitplanNoteById,
          deleteWalls,
          deleteWall,
          updateWall,
          deletePanel,
          getAllEndpoints,
          getPanelById,
          getPanelByName,
          deletePlacement,
          deleteDoor,
          deleteWindow,
          deleteStair,
          updateStair,
          deletePlanGraphicElement,
          updateFloor,
          withSingleUndoEntry,
        } = useProjectStore.getState()
        const project = useProjectStore.getState().currentProject
        const allWalls = getAllPlanWalls(project)
        const allDoors = getAllPlanDoors(project)
        const allWindows = getAllPlanWindows(project)
        const allStairs = getAllPlanStairs(project)
        const wallIdSet = new Set(allWalls.map((wall) => wall.id))
        const doorIdSet = new Set(allDoors.map((door) => door.id))
        const windowIdSet = new Set(allWindows.map((window) => window.id))
        const stairIdSet = new Set(allStairs.map((stair) => stair.id))

        // Delete selection
        if (selection.ids.length > 0) {
          if (selection.type === 'wall' || selection.type === 'wallPoint') {
            // Delete selected walls and/or selected stair points when using encoded vertex IDs.
            e.preventDefault()
            const wallPointIds = resolveSelectionToWallPointIds(selection)
            const wallIds = wallPointIds.size > 0 ? [] : resolveSelectionToWallIds(selection)
            const stairPointIds = resolveSelectionToStairPointIds(selection)
            const resolvedWallIds = wallIds.filter((id) => wallIdSet.has(id))
            const misroutedStairIds = wallIds.filter((id) => stairIdSet.has(id))
            if (isPlanKeyboardDebugEnabled()) {
              logger.info('[PlanDelete][Global] target walls', {
                selectionType: selection.type,
                selectionIds: selection.ids,
                resolvedWallIds: wallIds,
                matchedWallIds: resolvedWallIds,
                misroutedStairIds,
                resolvedWallPointIds: Array.from(wallPointIds.entries()),
                resolvedStairPointIds: Array.from(stairPointIds.entries()),
              })
            }
            for (const [wallId, indices] of wallPointIds.entries()) {
              const currentProject = useProjectStore.getState().currentProject
              const wall = getAllPlanWalls(currentProject).find(
                (entry: Wall) => entry.id === wallId
              )
              if (!wall) continue
              const nextPoints = wall.points.filter(
                (_: unknown, idx: number) => !indices.includes(idx)
              )
              if (nextPoints.length >= 2) {
                updateWall(wallId, { points: nextPoints })
              } else {
                deleteWall(wallId)
              }
            }
            if (resolvedWallIds.length > 0) {
              deleteWalls(resolvedWallIds)
            }
            if (misroutedStairIds.length > 0) {
              misroutedStairIds.forEach((id) => deleteStair(id))
            }
            for (const [stairId, indices] of stairPointIds.entries()) {
              const currentProject = useProjectStore.getState().currentProject
              const stair = getAllPlanStairs(currentProject).find(
                (entry: Stair) => entry.id === stairId
              )
              if (!stair) continue
              const nextPoints = stair.points.filter(
                (_: unknown, idx: number) => !indices.includes(idx)
              )
              if (nextPoints.length >= 2) {
                updateStair(stairId, { points: nextPoints })
              } else {
                deleteStair(stairId)
              }
            }
            useUIStore.getState().clearSelection()
          } else if (selection.type === 'stair') {
            e.preventDefault()
            const stairIds = resolveSelectionToStairIds(selection)
            if (isPlanKeyboardDebugEnabled()) {
              logger.info('[PlanDelete][Global] target stairs', {
                selectionIds: selection.ids,
                stairIds,
              })
            }
            stairIds.forEach((id) => deleteStair(id))
            useUIStore.getState().clearSelection()
          } else if (selection.type === 'stairPoint') {
            e.preventDefault()
            const stairPointIds = resolveSelectionToStairPointIds(selection)
            if (isPlanKeyboardDebugEnabled()) {
              logger.info('[PlanDelete][Global] target stair points', {
                selectionIds: selection.ids,
                stairPointIds: Array.from(stairPointIds.entries()),
              })
            }
            for (const [stairId, indices] of stairPointIds.entries()) {
              const currentProject = useProjectStore.getState().currentProject
              const stair = getAllPlanStairs(currentProject).find(
                (entry: Stair) => entry.id === stairId
              )
              if (!stair) continue
              const nextPoints = stair.points.filter(
                (_: unknown, idx: number) => !indices.includes(idx)
              )
              if (nextPoints.length >= 2) {
                updateStair(stairId, { points: nextPoints })
              } else {
                deleteStair(stairId)
              }
            }
            useUIStore.getState().clearSelection()
          } else if (selection.type === 'graphicElement') {
            if (deleteSelectedPlanGraphicElements(selection, deletePlanGraphicElement)) {
              e.preventDefault()
              useUIStore.getState().clearSelection()
            }
          } else if (selection.type === 'ground' && selection.ids.includes('ground')) {
            e.preventDefault()
            confirmDeleteEarthing()
          } else if (selection.type === 'note') {
            // Delete notes
            const noteIds = selection.ids.filter((id) => getSitplanNoteById(id))
            if (noteIds.length > 0) {
              e.preventDefault()
              if (isPlanKeyboardDebugEnabled()) {
                logger.info('[PlanDelete][Global] target notes', {
                  selectionIds: selection.ids,
                  noteIds,
                })
              }
              deleteSitplanNotes(noteIds)
              useUIStore.getState().clearSelection()
            }
          } else if (selection.type === 'placement') {
            // Placement selection is plan-scoped: multiplier-capable endpoints keep
            // their one-wire endpoint unless every placement for that endpoint is selected.
            e.preventDefault()
            const { getPlacementsByFloor, getEndpointById } = useProjectStore.getState()
            const floorPlacements = activeFloorId ? getPlacementsByFloor(activeFloorId) : []
            const toDelete = floorPlacements.filter((p: FloorPlacement) =>
              selection.ids.includes(p.id)
            )
            const toDeleteFiltered =
              project != null
                ? toDelete.filter((p: FloorPlacement) => {
                    if (!p.endpointId) return true
                    const ep = getEndpointById(p.endpointId)
                    if (ep && isMainPanelDistributionEndpoint(project, ep)) return false
                    return true
                  })
                : toDelete
            if (toDeleteFiltered.length === 0) {
              return
            }
            const selectedPlacementIdSet = new Set<string>(
              toDeleteFiltered.map((p: FloorPlacement) => p.id)
            )
            const endpointIds = [
              ...new Set<string>(
                toDeleteFiltered.flatMap((p: FloorPlacement) =>
                  p.endpointId ? [p.endpointId] : []
                )
              ),
            ]
            const endpointsToDelete: string[] = []
            for (const endpointId of endpointIds) {
              const endpoint = getEndpointById(endpointId)
              if (!endpoint) continue
              const deleteWholeEndpoint =
                !endpointSupportsMultiplier(endpoint) ||
                endpoint.placements.every((placement: Placement) =>
                  selectedPlacementIdSet.has(placement.id)
                )
              if (deleteWholeEndpoint) endpointsToDelete.push(endpointId)
            }
            const endpointsToDeleteSet = new Set(endpointsToDelete)
            const placementIdsToDelete = toDeleteFiltered
              .filter(
                (p: FloorPlacement) => !p.endpointId || !endpointsToDeleteSet.has(p.endpointId)
              )
              .map((p: FloorPlacement) => p.id)
            if (isPlanKeyboardDebugEnabled()) {
              logger.info('[PlanDelete][Global] target placements', {
                selectionIds: selection.ids,
                placementIdsToDelete,
                endpointsToDelete,
              })
            }
            const selectedPlacementIds = toDeleteFiltered.map((placement) => placement.id)
            const deleteSelection = () => {
              withSingleUndoEntry(
                () => {
                  if (placementIdsToDelete.length === 1 && endpointsToDelete.length === 0) {
                    deletePlacement(placementIdsToDelete[0]!)
                  } else if (placementIdsToDelete.length > 0) {
                    deletePlacements(placementIdsToDelete)
                  }
                  if (endpointsToDelete.length > 0) {
                    deleteEndpoints(endpointsToDelete)
                  }
                  return placementIdsToDelete.length > 0 || endpointsToDelete.length > 0
                },
                { sessionLabel: 'delete plan selection' }
              )
              useUIStore.getState().clearSelection()
            }
            const hideSelection = () => {
              if (activeFloorId) {
                const floor = useProjectStore.getState().getFloorById(activeFloorId)
                if (floor) {
                  updateFloor(activeFloorId, {
                    hiddenSitplanPlacementIds: mergeHiddenSituationPlanPlacementIds(
                      floor.hiddenSitplanPlacementIds,
                      selectedPlacementIds,
                    ),
                  })
                }
              }
              useUIStore.getState().clearSelection()
            }
            if (
              openSituationPlanBulkDeleteWarning({
                projectId: project?.project.id ?? '',
                placementIds: selectedPlacementIds,
                t,
                onDelete: deleteSelection,
                onHide: hideSelection,
              })
            ) {
              return
            }
            deleteSelection()
          } else if (selection.type === 'endpoint' || selection.type === 'panel') {
            // Delete placements and endpoints (resolve panel IDs to endpoint IDs if needed)
            e.preventDefault()
            const endpointIds = resolveSelectionToEndpointIds(selection, {
              getPanelById,
              getPanelByName,
              getAllEndpoints,
            })
            if (isPlanKeyboardDebugEnabled()) {
              logger.info('[PlanDelete][Global] target endpoint/panel selection', {
                selectionType: selection.type,
                selectionIds: selection.ids,
                resolvedEndpointIds: endpointIds,
              })
            }

            // Separate panel_distribution endpoints from regular endpoints (excluding main board — never deletable)
            const panelEndpointIds: string[] = []
            const regularEndpointIds: string[] = []
            const placementIdsToDelete: string[] = []

            endpointIds.forEach((id) => {
              const endpoint = getEndpointById(id)
              if (endpoint) {
                if (endpoint.symbol === 'panel_distribution') {
                  if (!project || !isMainPanelDistributionEndpoint(project, endpoint)) {
                    panelEndpointIds.push(id)
                  }
                } else {
                  regularEndpointIds.push(id)
                }
              }
            })

            // Delete panels (for sub-panel distribution symbols only) — matches context menu behavior
            if (panelEndpointIds.length > 0) {
              const panelsToDelete: Panel[] = []
              panelEndpointIds.forEach((id) => {
                const endpoint = getEndpointById(id)
                if (!endpoint) return
                const panelToDelete = project
                  ? resolvePanelForDistributionEndpoint(project, endpoint)
                  : getPanelByName(endpoint.label)
                if (panelToDelete) {
                  panelsToDelete.push(panelToDelete)
                }
              })

              if (panelsToDelete.length > 0) {
                // Check if any panels have content
                const panelHasContent = (panel: Panel): boolean => {
                  const hasDirectCircuits = panel.circuits.some((c) => c.code !== 'PANEL')
                  const hasProtections = panel.protections.length > 0
                  const hasSubPanels = panel.subPanels.length > 0
                  return hasDirectCircuits || hasProtections || hasSubPanels
                }

                const panelsWithContent = panelsToDelete.filter(panelHasContent)
                const panelNames = panelsToDelete.map((p) => p.name).join(', ')

                const message =
                  panelsWithContent.length > 0
                    ? t('panel.deleteConfirmMessage', {
                        panelNames,
                        defaultValue:
                          'The following panel(s) contain circuits, protections, or sub-panels: {{panelNames}}\n\nDeleting them will also delete all their contents. You can undo this action.\n\nAre you sure you want to continue?',
                      })
                    : t('panel.deleteEmptyPanelMessage', {
                        panelNames,
                        defaultValue:
                          'Are you sure you want to delete panel(s): {{panelNames}}?\n\nThis will also remove any associated frames and nested panels. You can undo this action.',
                      })

                openDialog({
                  type: 'confirm',
                  title: t('panel.deleteConfirmTitle', { defaultValue: 'Delete Panel(s)?' }),
                  message,
                  variant: 'warning',
                  confirmLabel: t('common.delete'),
                  cancelLabel: t('common.cancel'),
                  onConfirm: () => {
                    withSingleUndoEntry(
                      () => {
                        let changed = false
                        panelEndpointIds.forEach((id) => {
                          const endpoint = getEndpointById(id)
                          if (!endpoint) return
                          const panelToDelete = project
                            ? resolvePanelForDistributionEndpoint(project, endpoint)
                            : getPanelByName(endpoint.label)
                          if (panelToDelete) {
                            deletePanel(panelToDelete.id)
                            const placement = endpoint.placements.find(
                              (p: Placement) => p.floorId === activeFloorId
                            )
                            if (placement) {
                              deletePlacement(placement.id)
                            }
                            deleteEndpoints([id])
                            changed = true
                          }
                        })
                        return changed
                      },
                      { sessionLabel: 'delete panel from plan' }
                    )
                    useUIStore.getState().clearSelection()
                  },
                })
                return // Don't delete regular endpoints until confirmation
              }
            }

            // Delete regular endpoints (including multiplier-capable ones) and their placements
            const endpointsToDelete: string[] = []
            regularEndpointIds.forEach((endpointId) => {
              const endpoint = getEndpointById(endpointId)
              if (!endpoint) return
              const placement = endpoint.placements.find(
                (p: Placement) => p.floorId === activeFloorId
              )
              if (
                endpointSupportsMultiplier(endpoint) &&
                endpoint.placements.length > 1 &&
                placement
              ) {
                placementIdsToDelete.push(placement.id)
                return
              }
              if (placement) placementIdsToDelete.push(placement.id)
              endpointsToDelete.push(endpointId)
            })
            withSingleUndoEntry(
              () => {
                if (placementIdsToDelete.length > 0) deletePlacements(placementIdsToDelete)
                if (endpointsToDelete.length > 0) deleteEndpoints(endpointsToDelete)
                return placementIdsToDelete.length > 0 || endpointsToDelete.length > 0
              },
              { sessionLabel: 'delete plan selection' }
            )
            if (isPlanKeyboardDebugEnabled()) {
              logger.info('[PlanDelete][Global] deleting regular endpoints', {
                placementIdsToDelete,
                endpointsToDelete,
              })
            }

            useUIStore.getState().clearSelection()
          } else if (selection.type === 'door' || selection.type === 'window') {
            // Delete selected openings (doors/windows) in floor plan mode
            e.preventDefault()
            if (isPlanKeyboardDebugEnabled()) {
              logger.info('[PlanDelete][Global] target openings', {
                openingType: selection.type,
                openingIds: selection.ids,
              })
            }
            if (selection.type === 'door') {
              selection.ids.forEach((id) => deleteDoor(id))
            } else {
              selection.ids.forEach((id) => deleteWindow(id))
            }
            useUIStore.getState().clearSelection()
          } else {
            if (isPlanKeyboardDebugEnabled()) {
              logger.info('[PlanDelete][Global] no delete branch for selection', {
                selectionType: selection.type,
                selectionIds: selection.ids,
              })
            }
            // Fallback: resolve by actual floor-plan object ids, independent from selection.type.
            // This matches right-click delete behavior better when selection type drifts.
            const fallbackWallIds = selection.ids.filter((id) => wallIdSet.has(id))
            const fallbackDoorIds = selection.ids.filter((id) => doorIdSet.has(id))
            const fallbackWindowIds = selection.ids.filter((id) => windowIdSet.has(id))
            const fallbackStairIds = selection.ids.filter((id) => stairIdSet.has(id))
            const fallbackStairPoints = resolveSelectionToStairPointIds(selection)
            if (isPlanKeyboardDebugEnabled()) {
              logger.info('[PlanDelete][Global] fallback resolution', {
                selectionType: selection.type,
                selectionIds: selection.ids,
                fallbackWallIds,
                fallbackDoorIds,
                fallbackWindowIds,
                fallbackStairIds,
                fallbackStairPoints: Array.from(fallbackStairPoints.entries()),
              })
            }
            if (
              fallbackWallIds.length > 0 ||
              fallbackDoorIds.length > 0 ||
              fallbackWindowIds.length > 0 ||
              fallbackStairIds.length > 0 ||
              fallbackStairPoints.size > 0
            ) {
              e.preventDefault()
              if (fallbackWallIds.length > 0) deleteWalls(fallbackWallIds)
              if (fallbackDoorIds.length > 0) fallbackDoorIds.forEach((id) => deleteDoor(id))
              if (fallbackWindowIds.length > 0) fallbackWindowIds.forEach((id) => deleteWindow(id))
              if (fallbackStairIds.length > 0) fallbackStairIds.forEach((id) => deleteStair(id))
              for (const [stairId, indices] of fallbackStairPoints.entries()) {
                const currentProject = useProjectStore.getState().currentProject
                const stair = getAllPlanStairs(currentProject).find(
                  (entry: Stair) => entry.id === stairId
                )
                if (!stair) continue
                const nextPoints = stair.points.filter(
                  (_: unknown, idx: number) => !indices.includes(idx)
                )
                if (nextPoints.length >= 2) {
                  updateStair(stairId, { points: nextPoints })
                } else {
                  deleteStair(stairId)
                }
              }
              useUIStore.getState().clearSelection()
            }
          }
        } else {
          if (isPlanKeyboardDebugEnabled()) {
            logger.info('[PlanDelete][Global] ignored: no selection ids')
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    activeFloorId,
    getEndpointById,
    t,
    openDialog,
    pointerOverPlanRef,
    suppressDigitFloorShortcuts,
    onBeforeSwitchFloor,
    keyboardDisabled,
    onDeleteFloorPlanSelection,
    toolShortcuts,
    onCopyFloorPlanSelection,
    onPasteFloorPlanSelection,
  ])
}
