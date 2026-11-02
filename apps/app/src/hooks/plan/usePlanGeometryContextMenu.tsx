import { useCallback } from 'react'
import type { ProjectState } from '@/stores/projectStore'
import { CommandError, type CommandInvocation } from '@/lib/commands/project'
import { logger } from '@/lib/logger'
import { liveProjectSession, runProjectCommand } from '@/stores/liveProjectCommandSession'
import { parseStairPointIds } from '@/lib/plan/planCanvasPointSelection'
import type { Point } from '@/types/ui'
import type { Wall, Point2, Stair } from '@/types/schema'
import CopyFloorPlanSelectionDialog from '@/components/plan/CopyFloorPlanSelectionDialog'
import { buildWallSelectionDeletionPlan } from '@/lib/plan/wallSelectionDeletion'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'

interface PlanGeometryContextMenuOptions {
  withJunctionEditorItem: (
    items: import('@/components/common/ContextMenu').ContextMenuItem[],
    candidates: readonly (string | null | undefined)[],
    options?: { afterLabel?: string | undefined }
  ) => import('@/components/common/ContextMenu').ContextMenuItem[]
  baseGetContextMenuItems: (
    position: import('@/types/ui').Point,
    elementId: string | null
  ) => import('@/components/common/ContextMenu').ContextMenuItem[]
  viewportUI: import('zustand/vanilla').StoreApi<import('@/stores/uiStore').UIState>
  t: import('i18next').TFunction<'translation', undefined>
  canDeleteItems: boolean
  activeTool: import('@/types/ui').PlanToolMode
  hasPlanImage: boolean
  activeFloorId: string | null
  handleDeleteSelectedPlanImage: () => void
  canEditFloorPlan: boolean
  isFloorPlanMode: boolean
  activeFloor: import('@/types/schema').Floor | null | undefined
  getProjectState: () => ProjectState
  clearSelection: () => void
  selectedPointIndices: Map<string, number[]>
  selectedSegmentIndices: Map<string, number[]>
  deleteSelectedWallGeometry: () => boolean
  selectedWallsForCopy: import('@/types/schema').Wall[]
  selectedStairsForCopy: import('@/types/schema').Stair[]
  currentProjectFloors: (import('@/types/schema').Floor | import('@/types/projectV2').FloorV2)[]
  selectedOpeningsForCopy: {
    doors: import('@/types/schema').Door[]
    windows: import('@/types/schema').Window[]
  }
  openDialog: (
    config: import('@/stores/dialogStore').DialogConfig,
    ownerDocument?: Document | null | undefined
  ) => void
  handleCopySelectionToFloors: (
    targetFloorIds: string[],
    options: { copyOpenings: boolean }
  ) => void
  getDialogState: () => { closeDialog: () => void }
}

export function usePlanGeometryContextMenu({
  withJunctionEditorItem,
  baseGetContextMenuItems,
  viewportUI,
  t,
  canDeleteItems,
  activeTool,
  hasPlanImage,
  activeFloorId,
  handleDeleteSelectedPlanImage,
  canEditFloorPlan,
  isFloorPlanMode,
  activeFloor,
  getProjectState,
  clearSelection,
  selectedPointIndices,
  selectedSegmentIndices,
  deleteSelectedWallGeometry,
  selectedWallsForCopy,
  selectedStairsForCopy,
  currentProjectFloors,
  selectedOpeningsForCopy,
  openDialog,
  handleCopySelectionToFloors,
  getDialogState,
}: PlanGeometryContextMenuOptions) {
  const handleGetContextMenuItems = useCallback(
    (position: Point, elementId: string | null) => {
      const items = withJunctionEditorItem(
        baseGetContextMenuItems(position, elementId),
        [elementId, ...viewportUI.getState().selection.ids],
        { afterLabel: t('contextMenu.moveToFloor') }
      )
      const canDeletePlanImage =
        canDeleteItems && activeTool === 'move' && hasPlanImage && !!activeFloorId
      if (canDeletePlanImage) {
        items.unshift({
          label: t('contextMenu.deletePlanImage'),
          onClick: () => handleDeleteSelectedPlanImage(),
          variant: 'danger',
        })
      }
      if (canEditFloorPlan && isFloorPlanMode && activeFloor?.floorPlan && activeFloorId) {
        const selectionState = viewportUI.getState().selection
        const selectedDirectStairIds =
          selectionState.type === 'stair'
            ? selectionState.ids
            : selectionState.type === 'stairPoint'
              ? selectionState.ids.slice(0, 1)
              : []
        const hitStairId =
          elementId && activeFloor.floorPlan.stairs?.some((stair: Stair) => stair.id === elementId)
            ? elementId
            : null
        if (hitStairId && !selectedDirectStairIds.includes(hitStairId)) {
          selectedDirectStairIds.push(hitStairId)
        }
        const selectedEncodedStairPoints =
          selectionState.type === 'wallPoint'
            ? parseStairPointIds(selectionState.ids)
            : selectionState.type === 'stairPoint' && selectionState.ids.length >= 2
              ? new Map([
                  [
                    selectionState.ids[0]!,
                    Number.isFinite(Number(selectionState.ids[1]))
                      ? [Number(selectionState.ids[1])]
                      : [],
                  ],
                ])
              : new Map<string, number[]>()
        const hasStairSelection =
          selectedDirectStairIds.length > 0 || selectedEncodedStairPoints.size > 0
        if (hasStairSelection) {
          items.unshift({ label: '', onClick: () => {}, separator: true })
          items.unshift({
            label: t('contextMenu.delete', 'Delete'),
            onClick: () => {
              const { currentProject } = getProjectState()
              const deleteIds = new Set(selectedDirectStairIds)
              const trimmed: Array<{ id: string; points: Point2[] }> = []
              for (const [stairId, indices] of selectedEncodedStairPoints.entries()) {
                if (!indices.length || deleteIds.has(stairId)) continue
                const stair = (
                  currentProject
                    ? selectProjectBuildingFloors(currentProject).flatMap((floor) =>
                        'floorPlan' in floor ? (floor.floorPlan?.stairs ?? []) : []
                      )
                    : []
                ).find((entry: Stair) => entry.id === stairId)
                if (!stair) continue
                const nextPoints = stair.points.filter(
                  (_: Point2, idx: number) => !indices.includes(idx)
                )
                if (nextPoints.length >= 2) trimmed.push({ id: stairId, points: nextPoints })
                else deleteIds.add(stairId)
              }
              // Deleting stairs and trimming stair points is one gesture and one undo step.
              const batch: CommandInvocation[] = []
              if (deleteIds.size > 0)
                batch.push({
                  id: 'entities.delete',
                  input: { refs: [...deleteIds].map((id) => ({ kind: 'stair', id })) },
                })
              if (trimmed.length > 0)
                batch.push({
                  id: 'properties.edit',
                  input: {
                    edits: trimmed.map(({ id, points }) => ({
                      kind: 'stair',
                      ids: [id],
                      set: { points },
                    })),
                  },
                })
              if (batch.length > 0) {
                try {
                  liveProjectSession.execute(batch, {
                    label: 'delete stair geometry',
                    source: 'plan-canvas-geometry',
                  })
                } catch (error) {
                  if (!(error instanceof CommandError)) throw error
                  logger.warn('[ProjectCommand] rejected', {
                    code: error.code,
                    message: error.message,
                  })
                }
              }
              clearSelection()
            },
            variant: 'danger',
          })
        }

        const wallDeletionPlan = buildWallSelectionDeletionPlan({
          walls: activeFloor.floorPlan.walls,
          selectedWallIds: selectionState.type === 'wall' ? selectionState.ids : [],
          selectedPointIndices,
          selectedSegmentIndices,
        })
        if (
          wallDeletionPlan.wholeWallIds.length > 0 ||
          wallDeletionPlan.pointIndicesByWall.size > 0 ||
          wallDeletionPlan.segmentIndicesByWall.size > 0
        ) {
          items.unshift({ label: '', onClick: () => {}, separator: true })
          items.unshift({
            label: t('contextMenu.delete', 'Delete'),
            onClick: deleteSelectedWallGeometry,
            variant: 'danger',
          })
        }

        const canCopyFloorPlanSelection =
          selectedWallsForCopy.length > 0 || selectedStairsForCopy.length > 0
        if (canCopyFloorPlanSelection) {
          const sourceFloors = currentProjectFloors
          const hasTargetFloor = sourceFloors.some((floor) => floor.id !== activeFloorId)
          const openingCount =
            selectedOpeningsForCopy.doors.length + selectedOpeningsForCopy.windows.length
          items.unshift({ label: '', onClick: () => {}, separator: true })
          items.unshift({
            label: t('contextMenu.copyToFloor', 'Copy to floor...'),
            disabled: !hasTargetFloor,
            onClick: () => {
              if (!hasTargetFloor) return
              openDialog({
                type: 'custom',
                title: t('contextMenu.copyToFloor', 'Copy to floor...'),
                content: (
                  <CopyFloorPlanSelectionDialog
                    currentFloorId={activeFloorId}
                    floors={sourceFloors}
                    wallCount={selectedWallsForCopy.length}
                    stairCount={selectedStairsForCopy.length}
                    openingCount={openingCount}
                    onConfirm={(targetFloorIds, options) => {
                      handleCopySelectionToFloors(targetFloorIds, options)
                      getDialogState().closeDialog()
                    }}
                    onCancel={() => getDialogState().closeDialog()}
                  />
                ),
              })
            },
          })
        }

        const vertices: Array<{ wallId: string; pointIndex: number; point: Point2 }> = []
        for (const [wallId, indices] of selectedPointIndices.entries()) {
          const wall = activeFloor.floorPlan.walls.find((w: Wall) => w.id === wallId)
          if (!wall) continue
          for (const idx of indices) {
            const p = wall.points[idx]
            if (p) vertices.push({ wallId, pointIndex: idx, point: p })
          }
        }
        if (vertices.length === 2) {
          const a = vertices[0]!
          const b = vertices[1]!
          const dist = Math.sqrt((b.point.x - a.point.x) ** 2 + (b.point.y - a.point.y) ** 2)
          const MERGE_THRESHOLD = 1.0
          if (dist <= MERGE_THRESHOLD) {
            items.unshift({ label: '', onClick: () => {}, separator: true })
            items.unshift({
              label: t('contextMenu.mergePoints', 'Merge Points'),
              onClick: () => {
                const outcome = runProjectCommand(
                  'plan.mergeWallPoints',
                  {
                    floorId: activeFloorId,
                    wallId1: a.wallId,
                    pointIndex1: a.pointIndex,
                    wallId2: b.wallId,
                    pointIndex2: b.pointIndex,
                  },
                  { label: 'merge wall points', source: 'plan-canvas-geometry' }
                )
                if (outcome?.changed) viewportUI.getState().setSelection({ type: null, ids: [] })
              },
            })
          }
        }
      }
      return items
    },
    [
      baseGetContextMenuItems,
      withJunctionEditorItem,
      isFloorPlanMode,
      activeFloor,
      activeFloorId,
      activeTool,
      hasPlanImage,
      selectedPointIndices,
      selectedSegmentIndices,
      deleteSelectedWallGeometry,
      selectedWallsForCopy,
      selectedStairsForCopy,
      selectedOpeningsForCopy.doors,
      selectedOpeningsForCopy.windows,
      openDialog,
      handleCopySelectionToFloors,
      t,
      handleDeleteSelectedPlanImage,
      canDeleteItems,
      canEditFloorPlan,
      clearSelection,
      currentProjectFloors,
      viewportUI,
      getProjectState,
      getDialogState,
    ]
  )

  return { handleGetContextMenuItems }
}
