import { create } from 'zustand'
import type { WheelBehavior, WheelInputDevice } from '@/types/ui'

/** Session-only visibility of the suggested wheel behavior. */
interface WheelBehaviorHintState {
  open: boolean
  suggestedBehavior: WheelBehavior | null
  dismissedInput: WheelInputDevice | null
  show: (behavior: WheelBehavior) => void
  hide: () => void
  dismiss: (input: WheelInputDevice) => void
  clearDismissal: () => void
}

export const useWheelBehaviorHintStore = create<WheelBehaviorHintState>()((set) => ({
  open: false,
  suggestedBehavior: null,
  dismissedInput: null,
  show: (suggestedBehavior) => set({ open: true, suggestedBehavior }),
  hide: () => set({ open: false, suggestedBehavior: null }),
  dismiss: (dismissedInput) => set({ open: false, suggestedBehavior: null, dismissedInput }),
  clearDismissal: () => set({ dismissedInput: null }),
}))
