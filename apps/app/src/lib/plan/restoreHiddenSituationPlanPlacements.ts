import { readLegacyCompatibilityFloors } from '@/lib/projectV2/buildingFloors'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import type { Point } from '@/types/ui'
import { getViewportCenterPlanSpaceIfApplicable } from './autoSitplanPlacement'
import { hasCustomPlacement } from './customPlacement'

function activePlanViewportCenter(): Point {
  const ui = useUIStore.getState()
  const activeFloorId = ui.activeFloorId
  if (activeFloorId) {
    const exact = getViewportCenterPlanSpaceIfApplicable(
      ui.viewportLayout,
      ui.planCanvasViewportPx,
      activeFloorId,
      activeFloorId,
      ui.planView,
    )
    if (exact) return exact
  }

  const viewport = ui.planCanvasViewportPx ?? { width: 800, height: 600 }
  const zoom = Number.isFinite(ui.planView.zoom) && Math.abs(ui.planView.zoom) > 1e-6
    ? ui.planView.zoom
    : 1
  return {
    x: (viewport.width / 2 - ui.planView.pan.x) / zoom,
    y: (viewport.height / 2 - ui.planView.pan.y) / zoom,
  }
}

/**
 * Unhide symbols. Untouched auto-placements move into the active view by default;
 * custom-positioned placements stay on their existing floor unless explicitly moved.
 */
export function restoreHiddenSituationPlanPlacementsToActiveView(
  selectedIds: string[],
  options: { moveToActiveView?: boolean } = {},
): boolean {
  if (selectedIds.length === 0) return false

  const ui = useUIStore.getState()
  const store = useProjectStore.getState()
  const project = store.currentProject
  const activeFloorId = ui.activeFloorId
  if (!project || !activeFloorId) return false

  const floors = readLegacyCompatibilityFloors(project)
  const activeFloor = floors.find((floor) => floor.id === activeFloorId)
  if (!activeFloor) return false

  const selected = new Set(selectedIds)
  const rowsById = new Map(
    floors
      .flatMap((floor) => store.getPlacementsByFloor(floor.id))
      .filter((placement) => selected.has(placement.id))
      .map((placement) => [placement.id, placement]),
  )
  const placementsToMove = selectedIds
    .map((id) => rowsById.get(id))
    .filter((placement): placement is NonNullable<typeof placement> => Boolean(placement))
    .filter((placement) => options.moveToActiveView ?? !hasCustomPlacement(placement))
  const movingIds = new Set(placementsToMove.map((placement) => placement.id))
  const center = activePlanViewportCenter()
  const layer = activeFloor.layers?.[0] ?? 'electrical'
  const spacing = 80
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(placementsToMove.length))))
  const rows = Math.ceil(placementsToMove.length / columns)
  const positions = new Map(
    placementsToMove.map((placement, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      return [
        placement.id,
        {
          x: center.x + (column - (columns - 1) / 2) * spacing,
          y: center.y + (row - (rows - 1) / 2) * spacing,
        },
      ] as const
    }),
  )
  const restored = selectedIds.filter((placementId) => rowsById.has(placementId))
  if (restored.length === 0) return false
  runProjectCommand(
    'plan.showHiddenPlacements',
    {
      floorId: activeFloorId,
      layer,
      placementIds: selectedIds,
      moves: restored.flatMap((placementId) => {
        const pos = positions.get(placementId)
        return movingIds.has(placementId) && pos ? [{ placementId, pos }] : []
      }),
    },
    { label: 'show hidden situation plan symbols' },
  )
  return true
}
