import type { Point2 } from '@/types/schema'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'

/**
 * Ensure the earthing symbol exists on the given sitplan floor when ground is enabled.
 * Does nothing when ground is disabled or there is no project.
 *
 * Kept apart from the pure earthing placement helpers so the validation worker,
 * which reaches those helpers, never loads the project store.
 */
export function ensureEarthingSitplanPlacement(floorId: string, pos?: Point2): void {
  runProjectCommand(
    'plan.ensureEarthingPlacement',
    { floorId, ...(pos ? { pos: { x: pos.x, y: pos.y } } : {}) },
    { label: 'ensure earthing on situation plan' }
  )
}
