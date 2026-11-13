import type { LayoutNode } from '@/lib/layout/layoutTree'
import type { WireSegment, Endpoint, ProtectionDevice } from '@/types/schema'

export interface OverviewSymbol {
  targetName: string
  x: number
  y: number
  width: number
  height: number
}

/** Overview geometry contains no Konva nodes or component subscriptions. */
export function buildDiagramOverview(panelNode: LayoutNode, wires: readonly WireSegment[]) {
  const symbols: OverviewSymbol[] = []
  const coarseSymbols: Array<{ x: number; y: number; width: number; height: number }> = []
  const auxiliaryNodes: LayoutNode[] = []
  const names = new Set<string>()
  const collectCoarse = (node: LayoutNode) => {
    if (node.visual?.type === 'symbol' && node.visual.opacity === 0) return
    if (node.visual?.type === 'symbol' ||
      ['endpoint', 'mcb', 'rcd', 'trunkDevice', 'supply', 'ground'].includes(node.type)) {
      coarseSymbols.push({ x: node.bounds.x - 16, y: node.bounds.y - 16, width: 32, height: 32 })
    }
    node.children.forEach(collectCoarse)
  }
  collectCoarse(panelNode)
  const visit = (node: LayoutNode) => {
    if (node.visual?.type === 'symbol' && node.visual.opacity === 0) return
    if (
      (node.visual?.type === 'symbol' &&
        (node.visual.symbolId === 'domotica' || node.visual.metadataCallout)) ||
      (node.type === 'branch' &&
        node.children.some(
          (child) => child.visual?.type === 'symbol' && child.visual.metadataCallout
        )) ||
      (node.type === 'endpoint' && (node.domainRef as Endpoint | undefined)?.symbol === 'domotica')
    ) {
      // Keep only the rich subtree on the existing renderer. A single special
      // device must not force every other circuit on the board into full detail.
      auxiliaryNodes.push(node)
      return
    }
    if (
      node.type === 'supply' ||
      node.type === 'ground' ||
      (node.type === 'endpoint' &&
        node.visual?.type === 'symbol' &&
        node.visual.symbolId === 'panel_distribution')
    ) {
      // Preserve uncommon unselected-drag and linked-panel behavior through the
      // existing components; these add only a few nodes per board.
      auxiliaryNodes.push(node)
      return
    }
    let targetName: string | undefined
    if (node.type === 'endpoint' && node.domainId) targetName = `endpoint-${node.domainId}`
    if ((node.type === 'mcb' || node.type === 'rcd') && node.domainId) {
      const protection = node.domainRef as ProtectionDevice | undefined
      // Hidden feed protections have no named symbol to receive a forwarded click.
      if (
        protection?.subPanelId ||
        protection?.directPanelFeeder ||
        protection?.directDcBusFeeder
      ) {
        auxiliaryNodes.push(node)
        return
      }
      targetName = `protection-${node.domainId}`
    }
    if (node.type === 'trunkDevice' && node.domainId) targetName = `trunkDevice-${node.domainId}`
    if (targetName && !names.has(targetName)) {
      names.add(targetName)
      symbols.push({
        targetName,
        x: node.bounds.x - 16,
        y: node.bounds.y - 16,
        width: 32,
        height: 32,
      })
    }
    for (const child of node.children) visit(child)
  }
  visit(panelNode)
  return { symbols, coarseSymbols, auxiliaryNodes, wires }
}
