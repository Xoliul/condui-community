import type Konva from 'konva'

/** Use the live hit graph and handlers, so inactive layers never advertise selection. */
export function hasCanvasPrimaryAction(node: Konva.Node, stage: Konva.Stage): boolean {
  // This surface consumes clicks for floor-plan tools; it is not selectable content.
  if (node.name() === 'floor-plan-hit-area') return false
  let current: Konva.Node | null = node
  while (current && current !== stage && current.getClassName() !== 'Layer') {
    if (!current.isListening()) return false
    if (current.draggable()) return true
    if (
      ['click', 'tap', 'mousedown', 'pointerdown'].some((event) =>
        current?.eventListeners[event]?.some((listener) => listener.name === 'react-konva-event')
      )
    )
      return true
    current = current.getParent()
  }
  return false
}

export function resolveCanvasCursor({
  panning,
  toolCursor,
  primaryAction,
  emptyBackground,
  leftDragPansCanvas,
  shiftKey = false,
  primaryClickTool = false,
}: {
  panning: boolean
  toolCursor?: string
  primaryAction: boolean
  emptyBackground: boolean
  leftDragPansCanvas: boolean
  shiftKey?: boolean
  primaryClickTool?: boolean
}): string {
  if (panning) return 'grabbing'
  if (toolCursor) return toolCursor
  if (primaryClickTool) return 'default'
  if (primaryAction) return 'pointer'
  if (emptyBackground && leftDragPansCanvas && !shiftKey) return 'all-scroll'
  return 'default'
}
