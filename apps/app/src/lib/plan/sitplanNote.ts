import type { Note } from '@/types/schema'
import type { Point } from '@/types/ui'

export const DEFAULT_SITPLAN_NOTE_TEXT = 'New note'
export const DEFAULT_SITPLAN_NOTE_FONT_SIZE = 14

/** Build the same note a library Note drop creates, at a plan position on a floor. */
export function createSitplanNote(floorId: string, pos: Point, now: number = Date.now()): Note {
  return {
    id: `note-${now}`,
    text: DEFAULT_SITPLAN_NOTE_TEXT,
    fontSize: DEFAULT_SITPLAN_NOTE_FONT_SIZE,
    pos: { x: pos.x, y: pos.y },
    floorId,
  }
}
