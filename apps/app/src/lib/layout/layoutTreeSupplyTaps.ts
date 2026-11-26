import type { ProtectionDevice } from '@/types/schema'
import type { BottomUpPanelLayout } from './bottomUpLayout'
import type { LayoutNode } from './layoutTree'
import { mirrorLayoutNodeHorizontally } from './layoutTreeOrientation'

/**
 * Marks the main-bus children that are supply taps with the y of the grid lane they leave from.
 * Taps are laid out against that lane, so wire derivation treats it as their "main bus".
 */
export function markSupplyTapNodes(panelLayout: BottomUpPanelLayout, nodes: LayoutNode[]): void {
  const placements = panelLayout.supplyTaps
  if (!placements || placements.length === 0) return
  for (const node of nodes) {
    if (node.type !== 'rcd' && node.type !== 'mcb') continue
    const protectionId = (node.domainRef as ProtectionDevice | undefined)?.id
    const placement = placements.find(
      (candidate) =>
        (protectionId != null && candidate.protectionId === protectionId) ||
        (node.circuitIdForWires != null && candidate.circuitIds.includes(node.circuitIdForWires)) ||
        candidate.id === node.domainId
    )
    if (placement) node.supplyTapLaneY = placement.laneY
  }
}

export function isSupplyTapNode(node: LayoutNode): boolean {
  return node.supplyTapLaneY != null
}

/**
 * Mirrors a detached supply frame's nodes. Taps are branch circuits like a board's, so their
 * endpoint branches keep pointing right: each tap is reflected back around its own riser, which
 * leaves it moved along with the supply but not flipped.
 */
export function mirrorDetachedSupplyFrameNodes(panelNode: LayoutNode, axisX: number): void {
  mirrorLayoutNodeHorizontally(panelNode, axisX)
  const visit = (node: LayoutNode) => {
    if (isSupplyTapNode(node)) mirrorLayoutNodeHorizontally(node, node.bounds.x)
    else node.children.forEach(visit)
  }
  visit(panelNode)
}
