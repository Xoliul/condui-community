import type { CanvasType, PanelCanvasMode, Point, ViewportLayout } from '@/types/ui'
import { getAvailableCanvasTypes } from '@/lib/viewport/availableCanvasTypes'

export interface LocalCanvasViewTransform {
  zoom: number
  pan: Point
}

export interface LocalProjectEditorState {
  activeFloorId?: string | null
  activePanelId?: string | null
  panelCanvasMode?: PanelCanvasMode
  planFloorOverlayVisibleByBaseFloorId?: Record<string, string[]>
  /** Per-project editor viewport (see `Project.project.lastViewportLayout`). */
  viewportLayout?: ViewportLayout
  /** Per-project canvas cameras, restored after iOS/Safari reconstructs an evicted tab. */
  canvasViews?: Partial<Record<CanvasType, LocalCanvasViewTransform>>
}

export function sanitizeLocalCanvasViews(
  value: unknown
): LocalProjectEditorState['canvasViews'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Partial<Record<CanvasType, unknown>>
  const result: Partial<Record<CanvasType, LocalCanvasViewTransform>> = {}

  for (const canvas of getAvailableCanvasTypes()) {
    const candidate = source[canvas]
    if (!candidate || typeof candidate !== 'object') continue
    const view = candidate as { zoom?: unknown; pan?: { x?: unknown; y?: unknown } }
    if (
      typeof view.zoom !== 'number' ||
      !Number.isFinite(view.zoom) ||
      view.zoom <= 0 ||
      typeof view.pan?.x !== 'number' ||
      !Number.isFinite(view.pan.x) ||
      typeof view.pan?.y !== 'number' ||
      !Number.isFinite(view.pan.y)
    ) {
      continue
    }
    result[canvas] = { zoom: view.zoom, pan: { x: view.pan.x, y: view.pan.y } }
  }

  return Object.keys(result).length > 0 ? result : undefined
}

function storageKey(projectId: string): string {
  return `eendra-project-editor-state:${projectId}`
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

export function loadLocalProjectEditorState(projectId: string): LocalProjectEditorState | null {
  if (!canUseLocalStorage()) return null
  try {
    const raw = window.localStorage.getItem(storageKey(projectId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as LocalProjectEditorState | null
    return parsed && typeof parsed === 'object'
      ? { ...parsed, canvasViews: sanitizeLocalCanvasViews(parsed.canvasViews) }
      : null
  } catch {
    return null
  }
}

export function saveLocalProjectEditorState(
  projectId: string,
  state: LocalProjectEditorState
): void {
  if (!canUseLocalStorage()) return
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(state))
  } catch {
    // Ignore local persistence failures; editor behavior should still work.
  }
}
