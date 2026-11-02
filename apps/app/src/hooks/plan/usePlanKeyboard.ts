import { liveProjectSession, runProjectCommand } from '@/stores/liveProjectCommandSession'
import { CommandError } from '@/lib/commands/project/types'
import type { DeleteEntityRef } from '@/lib/eendraad/entityDeletion'
import type { PropertiesEditInput } from '@/lib/commands/project/commands/propertiesEdit'
import { useEffect, type MutableRefObject } from 'react'
import { usePlanSymbolNudgeKeyboard } from '@/hooks/plan/usePlanSymbolNudgeKeyboard'
import { useTranslation } from 'react-i18next'
import { useCanvasWindow, useViewport } from '@/components/viewport/ViewportContext'
import { viewportShortcutRouter } from '@/lib/viewport/viewportShortcutRouting'
import { useViewportUIApi, useIsActiveViewport } from '@/components/viewport/ViewportUIStore'
import { useProjectStore } from '@/stores/projectStore'
import {
  hidePlanPlacementsOnActiveFloor,
  requestDeletePlanPlacements,
} from '@/handlers/plan/deletePlanPlacements'
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
  const window = useCanvasWindow()
  const viewport = useViewport()
  const document = window.document
  const viewportUI = useViewportUIApi()
  const isActiveViewport = useIsActiveViewport()
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
        ? readLegacyCompatibilityFloors(project).flatMap((floor) => floor.floorPlan?.walls ?? [])
        : []
    const getAllPlanDoors = (project: PlanKeyboardProject | null): Door[] =>
      project
        ? readLegacyCompatibilityFloors(project).flatMap((floor) => floor.floorPlan?.doors ?? [])
        : []
    const getAllPlanWindows = (project: PlanKeyboardProject | null): Window[] =>
      project
        ? readLegacyCompatibilityFloors(project).flatMap((floor) => floor.floorPlan?.windows ?? [])
        : []
    const getAllPlanStairs = (project: PlanKeyboardProject | null): Stair[] =>
      project
        ? readLegacyCompatibilityFloors(project).flatMap((floor) => floor.floorPlan?.stairs ?? [])
        : []

    if (isPlanKeyboardDebugEnabled() && !planKeyboardRegistrationLogged) {
      planKeyboardRegistrationLogged = true
      logger.info(
        '[PlanKeyboard] window keydown listener registered for plan canvas. Hover the plan, then try S or 1–9. (Prod: localStorage.setItem("debugPlanKeyboard","1") + reload if you see no logs.)'
      )
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActiveViewport()) return
      const typing = isKeyboardTypingTarget(e.target)
      if (keyboardDisabled) return
      const floors = getCurrentProjectFloors()
      const pointerOverPlan =
        pointerOverPlanRef?.current === true ||
        (viewport != null && viewportShortcutRouter.isHoveredViewport(window, viewport.panelIndex))

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
        const { selection } = viewportUI.getState()
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
          runProjectCommand(
            'plan.rotatePlacements',
            { placementIds: targets.map((placement) => placement.id) },
            { label: 'rotate situation plan symbols' }
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
          const { planView, setPlanView } = viewportUI.getState()
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
          viewportUI.getState().setActiveFloor(decision.floorId)
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
        const { selection } = viewportUI.getState()
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
        const store = useProjectStore.getState()
        const project = store.currentProject
        const clearSelection = () => viewportUI.getState().clearSelection()
        const refs: DeleteEntityRef[] = []
        const edits: NonNullable<PropertiesEditInput['edits']> = []
        const walls = getAllPlanWalls(project)
        const stairs = getAllPlanStairs(project)
        const appendPointDeletion = (kind: 'wall' | 'stair', pointsById: Map<string, number[]>) => {
          for (const [id, indices] of pointsById) {
            const item = (kind === 'wall' ? walls : stairs).find((candidate) => candidate.id === id)
            if (!item) continue
            const points = item.points.filter((_, index) => !indices.includes(index))
            if (points.length >= 2)
              edits.push(
                kind === 'wall'
                  ? { kind: 'wall', ids: [id], set: { points } }
                  : { kind: 'stair', ids: [id], set: { points } }
              )
            else refs.push({ kind, id })
          }
        }
        const commit = () => {
          if (!refs.length && !edits.length) return
          try {
            liveProjectSession.execute(
              [
                ...(edits.length ? [{ id: 'properties.edit', input: { edits } }] : []),
                ...(refs.length ? [{ id: 'entities.delete', input: { refs } }] : []),
              ],
              { label: 'delete plan selection', source: 'keyboard' }
            )
            clearSelection()
          } catch (error) {
            if (!(error instanceof CommandError)) throw error
            logger.warn('[ProjectCommand] plan delete rejected', { code: error.code })
          }
        }
        if (selection.ids.length === 0) return
        if (selection.type === 'placement') {
          e.preventDefault()
          const floorIds = new Set(
            (activeFloorId ? store.getPlacementsByFloor(activeFloorId) : []).map(
              (placement) => placement.id
            )
          )
          requestDeletePlanPlacements({
            placementIds: selection.ids.filter((id) => floorIds.has(id)),
            t,
            onHide: hidePlanPlacementsOnActiveFloor,
            onDone: clearSelection,
          })
          return
        }
        if (selection.type === 'ground' && selection.ids.includes('ground')) {
          e.preventDefault()
          confirmDeleteEarthing()
          return
        }
        if (selection.type === 'endpoint' || selection.type === 'panel') {
          e.preventDefault()
          const endpointIds = resolveSelectionToEndpointIds(selection, {
            getPanelById: store.getPanelById,
            getPanelByName: store.getPanelByName,
            getAllEndpoints: store.getAllEndpoints,
          })
          const panelsToDelete: Panel[] = []
          for (const id of endpointIds) {
            const endpoint = store.getEndpointById(id)
            if (!endpoint || (project && isMainPanelDistributionEndpoint(project, endpoint)))
              continue
            const placement = endpoint.placements.find((entry) => entry.floorId === activeFloorId)
            if (placement && endpointSupportsMultiplier(endpoint) && endpoint.placements.length > 1)
              refs.push({ kind: 'placement', id: placement.id, retainOwner: true })
            else {
              refs.push({ kind: 'endpoint', id })
              if (endpoint.symbol === 'panel_distribution' && project) {
                const panel = resolvePanelForDistributionEndpoint(project, endpoint)
                if (panel) panelsToDelete.push(panel)
              }
            }
          }
          if (panelsToDelete.length) {
            const panelNames = panelsToDelete.map((panel) => panel.name).join(', ')
            openDialog({
              type: 'confirm',
              title: t('panel.deleteConfirmTitle'),
              message: t('panel.deleteConfirmMessage', { panelNames }),
              variant: 'warning',
              confirmLabel: t('common.delete'),
              cancelLabel: t('common.cancel'),
              onConfirm: commit,
            })
          } else commit()
          return
        }
        if (selection.type === 'wall' || selection.type === 'wallPoint') {
          const wallPoints = resolveSelectionToWallPointIds(selection)
          appendPointDeletion('wall', wallPoints)
          appendPointDeletion('stair', resolveSelectionToStairPointIds(selection))
          if (!wallPoints.size)
            for (const id of resolveSelectionToWallIds(selection)) {
              if (walls.some((wall) => wall.id === id)) refs.push({ kind: 'wall', id })
              else if (stairs.some((stair) => stair.id === id)) refs.push({ kind: 'stair', id })
            }
        } else if (selection.type === 'stairPoint')
          appendPointDeletion('stair', resolveSelectionToStairPointIds(selection))
        else if (selection.type === 'stair')
          refs.push(
            ...resolveSelectionToStairIds(selection).map((id) => ({ kind: 'stair' as const, id }))
          )
        else if (selection.type === 'graphicElement')
          refs.push(...selection.ids.map((id) => ({ kind: 'graphicElement' as const, id })))
        else if (selection.type === 'note')
          refs.push(
            ...selection.ids
              .filter((id) => store.getSitplanNoteById(id))
              .map((id) => ({ kind: 'note' as const, id, scope: 'sitplan' as const }))
          )
        else if (selection.type === 'door' || selection.type === 'window') {
          for (const id of selection.ids) refs.push({ kind: selection.type, id })
        } else {
          for (const id of selection.ids) {
            if (walls.some((wall) => wall.id === id)) refs.push({ kind: 'wall', id })
            else if (stairs.some((stair) => stair.id === id)) refs.push({ kind: 'stair', id })
            else if (getAllPlanDoors(project).some((door) => door.id === id))
              refs.push({ kind: 'door', id })
            else if (getAllPlanWindows(project).some((window) => window.id === id))
              refs.push({ kind: 'window', id })
          }
          appendPointDeletion('stair', resolveSelectionToStairPointIds(selection))
        }
        if (refs.length || edits.length) {
          e.preventDefault()
          commit()
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
    viewportUI,
    window,
    document,
    isActiveViewport,
    viewport,
  ])
}
