import type { BottomUpLayoutResult, BottomUpPanelLayout } from '@/lib/layout/bottomUpLayout'
import { getCircuitNotesPaintBounds } from '@/lib/layout/circuitNoteMetrics'
import { getAllEndpoints } from '@/lib/eendraad/projectElectricalDomain'
import { resolveFrameContentItems } from '@/lib/eendraad/frameContent'
import {
  computeOneWireFrameBounds,
  getOneWireFrameTitleY,
  type EendraadFrameBounds,
} from '@/lib/eendraad/frameBounds'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import type { Endpoint, Frame } from '@/types/schema'

/** Gap kept between a lifted note's painted text and the frame (title) below it. */
const NOTE_TO_FRAME_GAP = 2
/**
 * Besides notes of circuits inside the frame, only notes reaching into a frame's top
 * band (title and top padding) are lifted. A note brushing the side of a tall frame
 * further down stays put instead of jumping over the whole frame.
 */
const FRAME_TOP_BAND = 48

type CircuitNote = NonNullable<BottomUpPanelLayout['circuitNotes']>[number]

interface Rect {
  left: number
  right: number
  top: number
  bottom: number
}

interface FrameObstacle extends Rect {
  /** Circuits with an item inside the frame; their notes always belong above it. */
  circuitIds: Set<string>
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/**
 * Circuit notes are stacked above their circuit before user frames are known, so a
 * frame drawn around neighbouring items (and its title) can end up under a note.
 * Lift every colliding note above the frame, keep notes in one column clear of each
 * other, and grow the panel frame so the canvas and the PDF export both keep them.
 */
export function liftCircuitNotesClearOfFrames(
  layout: BottomUpLayoutResult,
  project: ProjectWithOptionalV2Electrical,
  frames: readonly Frame[]
): void {
  if (frames.length === 0) return
  for (const panelLayout of layout.panels) {
    if (panelLayout.frameRole === 'supply') continue
    const notes = (panelLayout.circuitNotes ?? []).filter((note) => note.notesVisible)
    if (notes.length === 0) continue
    const panelFrames = frames.filter((frame) => frame.panelId === panelLayout.panel.id)
    if (panelFrames.length === 0) continue

    const endpoints = new Map<string, Endpoint>(
      getAllEndpoints(panelLayout.panel).map((endpoint) => [endpoint.id, endpoint])
    )
    const obstacles = panelFrames.flatMap((frame): FrameObstacle[] => {
      const items = resolveFrameContentItems(frame, project)
      const bounds: EendraadFrameBounds | null = computeOneWireFrameBounds(
        frame,
        items,
        panelLayout,
        (id) => endpoints.get(id)
      )
      if (!bounds) return []
      const itemIds = new Set(items.map((item) => item.id))
      const circuitIds = new Set(
        panelLayout.elements.flatMap((element) =>
          element.circuitId &&
          [element.id, element.endpointId, element.protectionId, element.trunkDeviceId].some(
            (id) => id != null && itemIds.has(id)
          )
            ? [element.circuitId]
            : []
        )
      )
      return [
        {
          left: bounds.x,
          right: bounds.x + bounds.width,
          top: Math.min(bounds.y, getOneWireFrameTitleY(frame, bounds)),
          bottom: bounds.y + bounds.height,
          circuitIds,
        },
      ]
    })
    if (obstacles.length === 0) continue
    liftPanelNotes(panelLayout, notes, obstacles)
  }
}

function liftPanelNotes(
  panelLayout: BottomUpPanelLayout,
  notes: CircuitNote[],
  frames: FrameObstacle[]
): void {
  const paint = new Map(
    notes.map((note) => [note, getCircuitNotesPaintBounds(note.label, note.notesOrientation)])
  )
  const rectOf = (note: CircuitNote): Rect => {
    const bounds = paint.get(note)!
    return {
      left: note.x + bounds.left,
      right: note.x + bounds.right,
      top: note.y + bounds.top,
      bottom: note.y + bounds.bottom,
    }
  }
  const panelTopBefore = Math.min(...notes.map((note) => rectOf(note).top))
  let moved = false

  // Lowest notes first: a lifted note can then push the notes above it further up.
  const ordered = [...notes].sort((a, b) => b.y - a.y)
  for (let pass = 0; pass < ordered.length + 1; pass += 1) {
    let changed = false
    for (const note of ordered) {
      const rect = rectOf(note)
      const blockers = [
        ...frames.filter(
          (frame) =>
            frame.circuitIds.has(note.circuitId) || rect.bottom <= frame.top + FRAME_TOP_BAND
        ),
        ...ordered.filter((other) => other !== note && other.y > note.y).map(rectOf),
      ].filter((blocker) => overlaps(rect, blocker))
      if (blockers.length === 0) continue
      const ceiling = Math.min(...blockers.map((blocker) => blocker.top))
      note.y -= rect.bottom - ceiling + NOTE_TO_FRAME_GAP
      changed = true
      moved = true
    }
    if (!changed) break
  }
  if (!moved) return

  for (const note of notes) {
    const element = panelLayout.elements.find(
      (candidate) => candidate.id === `circuit-notes-${note.circuitId}`
    )
    if (element) element.position.y = note.y
  }
  // Keep the clearance the panel frame already had above its highest note.
  const panelTopAfter = Math.min(...notes.map((note) => rectOf(note).top))
  const growth = panelTopBefore - panelTopAfter
  if (growth > 0) {
    panelLayout.frame.y -= growth
    panelLayout.frame.height += growth
  }
}
