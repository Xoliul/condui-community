import { create } from 'zustand'

/**
 * Ephemeral state of a one-wire drag whose drop moves a whole downstream
 * circuit: which protection is dragged and how far it is from its start.
 */
interface OneWireDragGhostState {
  protectionId: string | null
  originX: number
  originY: number
  dx: number
  dy: number
  /** Start a drag; the origin is the dragged symbol's diagram position. */
  begin: (protectionId: string, originX: number, originY: number) => void
  /** Report the dragged symbol's current diagram position. */
  follow: (x: number, y: number) => void
  end: () => void
}

export const useOneWireDragGhostStore = create<OneWireDragGhostState>((set) => ({
  protectionId: null,
  originX: 0,
  originY: 0,
  dx: 0,
  dy: 0,
  begin: (protectionId, originX, originY) =>
    set({ protectionId, originX, originY, dx: 0, dy: 0 }),
  follow: (x, y) =>
    set((state) => (state.protectionId ? { dx: x - state.originX, dy: y - state.originY } : state)),
  end: () =>
    set((state) => (state.protectionId ? { protectionId: null, dx: 0, dy: 0 } : state)),
}))
