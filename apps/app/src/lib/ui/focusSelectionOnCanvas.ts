import { useUIStore } from '@/stores/uiStore'
import type { CanvasType, Selection } from '@/types/ui'

const PLAN_ONLY_SELECTIONS = new Set<Selection['type']>([
  'placement',
  'wall',
  'wallPoint',
  'door',
  'window',
  'stair',
  'stairPoint',
  'graphicElement',
])

const ONE_WIRE_SELECTIONS = new Set<Selection['type']>([
  'panel',
  'supplyPanel',
  'protection',
  'circuit',
  'endpoint',
  'wire',
  'ground',
  'supply',
  'busSection',
  'trunkDevice',
  'frame',
  'note',
  'infoBlock',
])

function isCompactRenderedViewport(ownerWindow: Window): boolean {
  const width = ownerWindow.innerWidth
  const height = ownerWindow.innerHeight
  const coarsePointer = ownerWindow.matchMedia('(pointer: coarse)').matches
  const isPortrait = height >= width
  return width < 900 || (coarsePointer && isPortrait && width < 1100) || (coarsePointer && !isPortrait && height < 620)
}

export function getPreferredCanvasForSelection(
  selection: Selection,
  currentCanvas: CanvasType = 'eendraad'
): CanvasType {
  if (!selection.type || selection.ids.length === 0) return currentCanvas
  if (PLAN_ONLY_SELECTIONS.has(selection.type)) return 'plan'
  if (ONE_WIRE_SELECTIONS.has(selection.type)) {
    if (currentCanvas === 'panel' && selection.type === 'protection') return 'panel'
    return currentCanvas === 'eendraad' ? currentCanvas : 'eendraad'
  }
  return currentCanvas
}

export function focusSelectionOnCanvas(
  selection: Selection,
  options?: { preferredCanvas?: CanvasType; delayMs?: number },
  scope?: { getState: typeof useUIStore.getState; getWindow: () => Window }
) {
  if (!selection.type || selection.ids.length === 0) return

  const getState = scope?.getState ?? useUIStore.getState
  const ownerWindow = scope?.getWindow() ?? window
  const state = getState()
  const currentCanvas = state.viewportLayout.panels[0]?.canvas ?? 'eendraad'
  const targetCanvas =
    options?.preferredCanvas ?? getPreferredCanvasForSelection(selection, currentCanvas)
  const visiblePanelIndex = state.viewportLayout.panels.findIndex(
    (panel) => panel.canvas === targetCanvas
  )
  const firstPanelCanvas = state.viewportLayout.panels[0]?.canvas
  const compactViewport = isCompactRenderedViewport(ownerWindow)

  if (visiblePanelIndex === -1 || (compactViewport && firstPanelCanvas !== targetCanvas)) {
    state.setPanelCanvas(0, targetCanvas)
  }

  // Request the first fit synchronously so clicking an issue feels immediate.
  // Keep short retries for the canvas/layout render pass, but avoid a long
  // fallback that makes a successful focus appear to lag by half a second.
  getState().requestFitToView([targetCanvas])
  for (const delayMs of [options?.delayMs ?? 80, 220]) {
    ownerWindow.setTimeout(() => {
      getState().requestFitToView([targetCanvas])
    }, delayMs)
  }
}
