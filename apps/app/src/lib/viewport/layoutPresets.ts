import type { LayoutPreset } from '@/types/ui'

/** Viewport layout presets in layout-picker order. */
export const LAYOUT_PRESETS: readonly LayoutPreset[] = [
  'single',
  'sideBySide',
  'stacked',
  'topPairBottomWide',
  'topWideBottomPair',
  'grid',
]

export function isLayoutPreset(value: unknown): value is LayoutPreset {
  return typeof value === 'string' && (LAYOUT_PRESETS as readonly string[]).includes(value)
}
