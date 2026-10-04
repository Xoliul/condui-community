import { create } from 'zustand'
import type { WallScanState } from '@/stores/wallScanStore'

export type { WallScanTarget } from '@/stores/wallScanStore'

/** Build-time substitute for Community and hosted builds with wall scans disabled. */
export const useWallScanStore = create<WallScanState>(() => ({
  status: 'idle',
  inputKey: null,
  results: [],
  projectId: null,
  targets: [],
  errorKey: null,
  start: () => {},
  attach: () => {},
  keep: async () => {},
  discard: () => {},
}))

export function WallRecognitionToggle() {
  return null
}

export function WallScanBar() {
  return null
}

export function WallScanPreviewLayer(props: {
  floorId: string | null
  pxPerMeter: number | null
  zoom: number
  theme: 'light' | 'dark'
}) {
  void props
  return null
}

export function useWallRecognitionAccess() {
  return 'locked' as const
}
