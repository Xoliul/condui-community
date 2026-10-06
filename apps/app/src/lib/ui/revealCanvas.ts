import { useUIStore } from '@/stores/uiStore'
import type { CanvasType } from '@/types/ui'

/**
 * Shows a canvas while keeping the current drawing visible: a single canvas becomes a
 * side-by-side split, otherwise the last viewport slot shows the requested canvas.
 */
export function revealCanvas(canvas: CanvasType): void {
  const ui = useUIStore.getState()
  const { panels } = ui.viewportLayout
  if (panels.some((panel) => panel.canvas === canvas)) return
  if (panels.length === 1) {
    ui.setLayoutPreset('sideBySide', { sourcePanelIndex: 0 })
    useUIStore.getState().setPanelCanvas(1, canvas)
    return
  }
  ui.setPanelCanvas(panels.length - 1, canvas)
}
