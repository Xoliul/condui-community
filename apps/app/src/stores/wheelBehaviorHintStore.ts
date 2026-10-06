import { create } from 'zustand'

/** Session-only visibility of the "using a trackpad?" hint; whether it was answered is persisted in settings. */
interface WheelBehaviorHintState {
  open: boolean
  show: () => void
  hide: () => void
}

export const useWheelBehaviorHintStore = create<WheelBehaviorHintState>()((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}))
