/**
 * The one place that answers "which frame is this" for the one-wire supply layout.
 * Runtime-dependency-free on purpose (type imports only): layout, wire derivation, hooks and canvas all import it.
 */
import type { DropTarget } from '@/lib/layout/findDropTarget'

/** Suffix of the diagram id of a detached supply frame (`<panelId>--supply`). */
const SUPPLY_DIAGRAM_SUFFIX = '--supply'

/** Diagram id of the detached supply frame that belongs to `panelId`. */
export function getSupplyDiagramId(panelId: string): string {
  return `${panelId}${SUPPLY_DIAGRAM_SUFFIX}`
}

/** True for the diagram id of a detached supply frame (the frame role 'supply'). */
export function isSupplyDiagramId(diagramId: string | null | undefined): boolean {
  return diagramId?.endsWith(SUPPLY_DIAGRAM_SUFFIX) ?? false
}

/**
 * True when the frame draws hosted feeder stubs (the feeds to other boards): a continuation
 * rail, or the main board's own mains frame. A detached supply frame and sub-panels do not.
 * Absent endpoint kind / frame role mean 'mains' / 'panel', as the layout applies them.
 */
export function drawsHostedFeederStubs(
  frame: {
    supplyEndpointKind?: 'mains' | 'continuation'
    frameRole?: 'panel' | 'supply'
  },
  panel: { isMain?: boolean }
): boolean {
  return (
    frame.supplyEndpointKind === 'continuation' ||
    ((frame.supplyEndpointKind ?? 'mains') === 'mains' &&
      (frame.frameRole ?? 'panel') === 'panel' &&
      Boolean(panel.isMain))
  )
}

/**
 * A bus-feed symbol (grid/backup feed) dropped on the bare frame of a detached supply
 * board behaves like a drop at the start of its main bus. Other drops pass through.
 */
export function normalizeBusFeedSupplyFrameDrop(
  target: DropTarget,
  symbol: { busFeedKind?: 'grid' | 'backup' }
): DropTarget {
  if (symbol.busFeedKind && target.type === null && target.panelId && isSupplyDiagramId(target.diagramId)) {
    return { ...target, type: 'mainBus', mainBusInsertIndex: 0 }
  }
  return target
}
