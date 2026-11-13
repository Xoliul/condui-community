import { CommandError } from '@/lib/commands/project'
import { logger } from '@/lib/logger'
import { liveProjectSession, runProjectCommand } from '@/stores/liveProjectCommandSession'
import { buildQuickPlacerPlacementBatch } from '@/lib/plan/quickPlacerPlacementBatch'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'

/** Plan canvas edits, committed as project commands with the store actions' signatures. */

// The quick placer puts a symbol on this floor at a position and may rotate it: one undo step.
export function updatePlanPlacement(
  placementId: string,
  updates: Parameters<ProjectState['updatePlacement']>[1]
): void {
  const batch = buildQuickPlacerPlacementBatch(
    useProjectStore.getState().currentProject,
    placementId,
    updates
  )
  if (batch.length === 0) return
  try {
    liveProjectSession.execute(batch, { label: 'place symbol', source: 'plan-quick-placer' })
  } catch (error) {
    if (!(error instanceof CommandError)) throw error
    logger.warn('[ProjectCommand] rejected', { code: error.code, message: error.message })
  }
}

export function updatePlanWall(
  wallId: string,
  updates: Parameters<ProjectState['updateWall']>[1]
): void {
  const { doorUpdates, windowUpdates, ...set } = updates
  runProjectCommand(
    'properties.edit',
    { edits: [{ kind: 'wall', ids: [wallId], set: { ...set, doorUpdates, windowUpdates } }] },
    { label: 'edit wall geometry', source: 'plan-canvas-geometry' }
  )
}

export function updatePlanDoor(
  doorId: string,
  updates: Parameters<ProjectState['updateDoor']>[1]
): void {
  runProjectCommand(
    'properties.edit',
    { edits: [{ kind: 'door', ids: [doorId], set: updates }] },
    { label: 'edit door', source: 'plan-canvas-geometry' }
  )
}

export function updatePlanWindow(
  windowId: string,
  updates: Parameters<ProjectState['updateWindow']>[1]
): void {
  runProjectCommand(
    'properties.edit',
    { edits: [{ kind: 'window', ids: [windowId], set: updates }] },
    { label: 'edit window', source: 'plan-canvas-geometry' }
  )
}

export function updatePlanStair(
  stairId: string,
  updates: Parameters<ProjectState['updateStair']>[1]
): void {
  runProjectCommand(
    'properties.edit',
    { edits: [{ kind: 'stair', ids: [stairId], set: updates }] },
    { label: 'edit stair', source: 'plan-canvas-geometry' }
  )
}

export function updatePlanGraphicElement(
  elementId: string,
  updates: Parameters<ProjectState['updatePlanGraphicElement']>[1]
): void {
  runProjectCommand(
    'properties.edit',
    { edits: [{ kind: 'graphicElement', ids: [elementId], set: updates }] },
    { label: 'edit plan graphic', source: 'plan-canvas-geometry' }
  )
}
