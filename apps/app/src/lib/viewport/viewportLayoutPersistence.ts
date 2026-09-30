import { VIEWPORT_RATIO_MAX, VIEWPORT_RATIO_MIN } from '@/constants/layoutConstants'
import { getResponsiveEditorMode } from '@/hooks/useResponsiveEditorMode'
import { DEFAULT_LAYOUTS } from '@/stores/uiStore'
import type { CanvasType, LayoutPreset, ViewportLayout, ViewportPanel } from '@/types/ui'
import { isAvailableCanvasType } from '@/lib/viewport/availableCanvasTypes'
import { clamp } from '@/lib/geometry'

function isCanvasType(value: string): value is CanvasType {
  return isAvailableCanvasType(value)
}

function isLayoutPreset(value: string): value is LayoutPreset {
  return (
    value === 'single' ||
    value === 'sideBySide' ||
    value === 'stacked' ||
    value === 'topPairBottomWide' ||
    value === 'topWideBottomPair' ||
    value === 'grid'
  )
}

function expectedPanelCount(preset: LayoutPreset): number {
  if (preset === 'single') return 1
  if (preset === 'sideBySide' || preset === 'stacked') return 2
  if (preset === 'grid') return 4
  return 3
}

function normalizeRatio(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return clamp(n, VIEWPORT_RATIO_MIN, VIEWPORT_RATIO_MAX)
}

function parsePanels(raw: unknown): ViewportPanel[] | null {
  if (!Array.isArray(raw)) return null
  const panels: ViewportPanel[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const canvas = (item as { canvas?: unknown }).canvas
    if (typeof canvas === 'string' && isCanvasType(canvas)) {
      panels.push({ canvas })
    }
  }
  return panels
}

/**
 * Validates and normalizes a viewport layout from JSON/localStorage/project.
 * **Older projects** omit `project.lastViewportLayout`; callers should fall back to a default layout.
 * Malformed or partial snapshots (wrong preset, unknown canvas ids, too few panels) also yield `null`.
 */
export function sanitizeViewportLayoutSnapshot(raw: unknown): ViewportLayout | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const presetRaw = o.preset
  if (typeof presetRaw !== 'string' || !isLayoutPreset(presetRaw)) return null
  const panels = parsePanels(o.panels)
  if (!panels) return null
  const need = expectedPanelCount(presetRaw)
  if (panels.length < need) return null
  const trimmed = panels.slice(0, need)
  return {
    preset: presetRaw,
    panels: trimmed,
    primaryRatio: normalizeRatio(o.primaryRatio, 0.5),
    secondaryRatio: normalizeRatio(o.secondaryRatio, 0.5),
    focusReturnLayout: null,
  }
}

/**
 * Default multi-panel preset when escaping a stuck single-panel maximize
 * (e.g. after refresh when focusReturnLayout was not persisted).
 */
export function getDefaultMultiPanelPreset(): LayoutPreset {
  const { mode } = getResponsiveEditorMode()
  return mode === 'compactPortrait' ? 'stacked' : 'sideBySide'
}

/** Strip transient focus state before persisting (localStorage / project JSON). */
export function viewportLayoutForPersistence(layout: ViewportLayout): ViewportLayout {
  const source = layout.focusReturnLayout ?? layout
  const snapshot = sanitizeViewportLayoutSnapshot({
    preset: source.preset,
    panels: source.panels,
    primaryRatio: source.primaryRatio,
    secondaryRatio: source.secondaryRatio,
  })
  return snapshot ?? DEFAULT_LAYOUTS.sideBySide()
}

export function visibleCanvasTypesInLayout(layout: ViewportLayout): CanvasType[] {
  const seen = new Set<CanvasType>()
  const out: CanvasType[] = []
  for (const p of layout.panels) {
    if (seen.has(p.canvas)) continue
    seen.add(p.canvas)
    out.push(p.canvas)
  }
  return out
}
