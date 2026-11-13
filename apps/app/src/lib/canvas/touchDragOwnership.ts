import type Konva from 'konva'
import type { Selection } from '@/types/ui'

/** Whether a hit node owns the touch drag, keeping it out of canvas pan.
 * - endpoint-*: selected when endpoint or placement in selection
 * - panel-*: selected when panel in selection (panel_distribution wrapper)
 * - placement-*: selected plan placement on touch
 * - protection-/trunkDevice-/note-/frame-/ground-/supply-*: selected one-wire draggable items
 * - plan-wire-symbol-hit-*: owns rewiring immediately, without selection
 * - plan-wire-hit / plan-wire-waypoint-*: owns wire bend editing immediately
 * - panelModule-* (eendraad): always draggable on touch
 */
export function isNodeDraggableForTouch(
  node: Konva.Node,
  stage: Konva.Stage,
  selection: { type: Selection['type']; ids: string[] } | null
): boolean {
  if (node === stage) return false
  let n: Konva.Node | null = node
  let depth = 0
  while (n && n !== stage && depth < 10) {
    const name = n.name()?.split(' ')[0]
    if (typeof n.draggable === 'function' && n.draggable()) return true
    // Measurement labels own their single-finger drag gesture. Treat them like
    // draggable canvas content so the camera pan recognizer does not steal it.
    if (name?.startsWith('planDimension-')) return true
    if (name?.startsWith('plan-wire-symbol-hit-')) return true
    if (name === 'plan-wire-hit' || name?.startsWith('plan-wire-waypoint-')) return true
    if (name?.startsWith('panelModule-')) return true
    if (!selection) {
      n = n.getParent()
      depth++
      continue
    }
    if (name?.startsWith('protection-')) {
      const id = name.slice('protection-'.length)
      if (selection.type === 'protection' && selection.ids.includes(id)) return true
    }
    if (name?.startsWith('trunkDevice-')) {
      const id = name.slice('trunkDevice-'.length)
      if (selection.type === 'trunkDevice' && selection.ids.includes(id)) return true
    }
    if (name?.startsWith('note-')) {
      const id = name.slice('note-'.length)
      if (selection.type === 'note' && selection.ids.includes(id)) return true
    }
    if (name?.startsWith('frame-')) {
      const id = name.slice('frame-'.length)
      if (selection.type === 'frame' && selection.ids.includes(id)) return true
    }
    if (name?.startsWith('ground-')) {
      const id = name.slice('ground-'.length)
      if (selection.type === 'ground' && selection.ids.includes(id)) return true
    }
    if (name === 'supply-supply') {
      if (selection.type === 'supply' && selection.ids.includes('supply')) return true
    }
    if (name?.startsWith('placement-')) {
      const id = name.slice('placement-'.length)
      if (selection.type === 'placement' && selection.ids.includes(id)) return true
    }
    if (name?.startsWith('endpoint-')) {
      const id = name.slice('endpoint-'.length)
      if (
        (selection.type === 'endpoint' || selection.type === 'placement') &&
        selection.ids.includes(id)
      )
        return true
      // Continue to parent: panel_distribution has panel-* wrapper, panel selection uses panel ids
    }
    if (name?.startsWith('panel-')) {
      const id = name.slice('panel-'.length)
      if (selection.type === 'panel' && selection.ids.includes(id)) return true
    }
    n = n.getParent()
    depth++
  }
  return false
}
