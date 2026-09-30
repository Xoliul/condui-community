import { create } from 'zustand'

/**
 * Cables hovered in the cable list, shown on the plan while the pointer rests on them. Separate
 * from the app-wide hover, which names symbols rather than wires.
 */
interface CableHoverState {
  anchors: ReadonlySet<string>
  setHovered: (anchors: readonly string[]) => void
}

const NONE: ReadonlySet<string> = new Set()

export const useCableHoverStore = create<CableHoverState>((set) => ({
  anchors: NONE,
  setHovered: (anchors) => set({ anchors: anchors.length ? new Set(anchors) : NONE }),
}))
