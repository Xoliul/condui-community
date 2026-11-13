import type { Circuit, ProtectionDevice, WireSegment } from '@/types/schema'
import type { LayoutNode, LayoutTree } from '@/lib/layout/layoutTree'

/** Everything that travels with a protection when it is dropped somewhere else. */
export interface ProtectionDragSubtree {
  /** Diagram (panel frame) that owns the dragged protection. */
  diagramId: string | undefined
  panelId: string | undefined
  /** Layout nodes below the protection symbol, drawn by the ordinary renderer. */
  childNodes: LayoutNode[]
  /** Wire segments fed by the protection, excluding its own bus stem. */
  wireSegments: WireSegment[]
}

const PROTECTION_NODE_TYPES = new Set<LayoutNode['type']>(['mcb', 'rcd'])

function findProtectionNode(
  node: LayoutNode,
  protectionId: string,
  panelNode: LayoutNode
): { node: LayoutNode; panelNode: LayoutNode } | null {
  if (PROTECTION_NODE_TYPES.has(node.type) && node.domainId === protectionId) {
    return { node, panelNode }
  }
  for (const child of node.children) {
    const found = findProtectionNode(child, protectionId, panelNode)
    if (found) return found
  }
  return null
}

function collectCircuitIds(protection: ProtectionDevice | undefined, into: Set<string>): void {
  for (const circuit of (protection?.circuits ?? []) as Circuit[]) into.add(circuit.id)
}

/**
 * Collects the downstream artwork that moves with a dragged protection: the layout
 * nodes below it and the wire segments of every circuit it feeds (nested protections
 * included). Returns null when nothing hangs below the protection.
 */
export function collectProtectionDragSubtree(
  layoutTree: LayoutTree,
  protectionId: string,
  wireSegments: readonly WireSegment[]
): ProtectionDragSubtree | null {
  let found: { node: LayoutNode; panelNode: LayoutNode } | null = null
  for (const panelNode of layoutTree.panels) {
    found = findProtectionNode(panelNode, protectionId, panelNode)
    if (found) break
  }
  if (!found || found.node.children.length === 0) return null

  const circuitIds = new Set<string>()
  const elementIds = new Set<string>()
  const visit = (node: LayoutNode) => {
    if (node.domainId) elementIds.add(node.domainId)
    if (node.circuitIdForWires) circuitIds.add(node.circuitIdForWires)
    if (PROTECTION_NODE_TYPES.has(node.type)) {
      collectCircuitIds(node.domainRef as ProtectionDevice | undefined, circuitIds)
    }
    node.children.forEach(visit)
  }
  collectCircuitIds(found.node.domainRef as ProtectionDevice | undefined, circuitIds)
  if (found.node.circuitIdForWires) circuitIds.add(found.node.circuitIdForWires)
  found.node.children.forEach(visit)

  const diagramId = found.panelNode.diagramId
  const panelId = found.panelNode.domainId
  const isOwnStem = (wire: WireSegment) =>
    wire.toElementId === protectionId &&
    (wire.fromElementType === 'mainBus' || wire.fromElementType === 'secondaryBus')
  const wires = wireSegments.filter(
    (wire) =>
      (!diagramId || (wire.diagramId ?? wire.panelId) === diagramId) &&
      !isOwnStem(wire) &&
      ((wire.circuitId !== undefined && circuitIds.has(wire.circuitId)) ||
        (wire.fromElementId !== undefined && elementIds.has(wire.fromElementId)))
  )
  if (wires.length === 0 && found.node.children.length === 0) return null
  return { diagramId, panelId, childNodes: found.node.children, wireSegments: wires }
}
