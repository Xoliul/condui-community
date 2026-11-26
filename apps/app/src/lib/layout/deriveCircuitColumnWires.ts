/** Wires of a circuit drawn in columns, read from the layout tree nodes (deriveWires mirrors nodes, not branchLayout). */
import type { WireSegment } from '@/types/schema'
import { generateId } from '@/utils'
import { LAYOUT_CONSTANTS } from './bottomUpLayoutConstants'
import { parseCircuitTrunkWire } from './layoutTreeCircuitColumns'
import type { LayoutNode } from './layoutTree'

const columnOf = (node: LayoutNode): number => node.branchLayout?.column?.index ?? 0

/** The stem (0 = trunk, k = manual riser k) a branch row is drawn on. */
export const getBranchNodeStem = (node: LayoutNode): number => node.branchLayout?.column?.stem ?? 0

/** Branch rows of the trunk's own column: they decide where the trunk ends. */
export function getTrunkOwnBranchNodes(branchNodes: LayoutNode[]): LayoutNode[] {
  return branchNodes.some((node) => node.branchLayout?.column) ? branchNodes.filter((node) => columnOf(node) === 0) : branchNodes
}

/** Where a stem's cable caption must end: its crossbar, or undefined for a single stack. */
export function getCircuitCrossbarY(mcbNode: LayoutNode, stem = 0): number | undefined {
  const crossbar = mcbNode.children.find((node) => {
    const wire = parseCircuitTrunkWire(node)
    return wire?.kind === 'crossbar' && wire.stem === stem
  })
  return crossbar && crossbar.bounds.y + crossbar.bounds.height / 2
}

/** Riser x of the column a branch row belongs to (the trunk x for column 0). */
export function getBranchRiserX(mcbNode: LayoutNode, branchNode: LayoutNode, trunkX: number): number {
  const column = columnOf(branchNode)
  if (column === 0) return trunkX
  const riser = mcbNode.children.find((node) => {
    const wire = parseCircuitTrunkWire(node)
    return wire?.kind === 'riser' && wire.column === column
  })
  return riser ? riser.bounds.x + riser.bounds.width / 2 : trunkX
}

/** The topmost row of each column closes its riser: it is the one whose wire corner is nudged. */
export function isColumnTopBranch(branchNode: LayoutNode, branchNodes: LayoutNode[], fallback: boolean): boolean {
  if (!branchNode.branchLayout?.column) return fallback
  const column = columnOf(branchNode)
  return !branchNodes.some((other) => columnOf(other) === column && other.bounds.y < branchNode.bounds.y)
}

/** A continuation of a trunk or riser segment: same cable, section reference, wire properties and anchor, no label. */
export function continueSegment(base: WireSegment, startPoint: WireSegment['startPoint'], endPoint: WireSegment['endPoint']): WireSegment {
  const { wireLabelEndPoint: _labelEnd, wireLabelBaseEndPoint: _labelBase, ...shared } = base
  return { ...shared, id: generateId(), startPoint, endPoint, hideWireLabel: true, trunkContinuation: true }
}

/**
 * Crossbars and automatic risers as continuations of their stem's own segment (the last trunk segment for stem 0,
 * the riser's vertical for a manual riser): flagged so the section is not counted twice.
 */
export function deriveCircuitColumnWires(
  mcbNode: LayoutNode,
  trunkSegment: WireSegment | undefined,
  riserSegments: ReadonlyMap<number, WireSegment> = new Map()
): WireSegment[] {
  if (!trunkSegment) return []
  return mcbNode.children.flatMap((node): WireSegment[] => {
    const wire = parseCircuitTrunkWire(node)
    if (!wire || wire.manual || wire.kind === 'segment' || wire.kind === 'stemLead') return []
    const base = wire.stem === 0 ? trunkSegment : riserSegments.get(wire.stem)
    if (!base) return []
    const { x, y, width, height } = node.bounds
    if (wire.kind === 'crossbar') {
      // Square the outer corner: the last riser is as wide as the line.
      return [continueSegment(base, { x, y: y + height / 2 }, { x: x + width + LAYOUT_CONSTANTS.BRANCH_LINE_WIDTH / 2, y: y + height / 2 })]
    }
    return [continueSegment(base, { x: x + width / 2, y: y + height }, { x: x + width / 2, y })]
  })
}
