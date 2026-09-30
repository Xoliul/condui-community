import type { Point } from '@/types/ui'
import type { DropTarget } from './findDropTarget'
import type { LayoutNode, LayoutTree } from './layoutTree'

/** Horizontal reach of the trunk column on either side of the trunk wire centre. */
const TRUNK_COLUMN_HALF_WIDTH = 16
/** Branch spacing used above the top branch and below the bottom branch. */
const DEFAULT_BRANCH_SPACING = 50

/**
 * A gap between two endpoint branches on a circuit trunk, resolved from the pointer height.
 * Branches stack along the trunk away from the protection; `insertIndex` counts the
 * branches between the protection and the pointer.
 */
export interface CircuitTrunkBranchSlot {
  circuitId: string
  panelId?: string
  diagramId?: string
  insertIndex: number
  branchCount: number
  /** Trunk wire centre X. */
  trunkX: number
  /** Trunk extent covered by the slot area. */
  top: number
  bottom: number
  /** Pointer height, for the marker that slides freely along the trunk. */
  markerY: number
  /** Height of the gap the moved branches will occupy. */
  slotY: number
  /** Side of the trunk the branches are drawn on. */
  direction: 1 | -1
}

interface TrunkColumn {
  circuitId: string
  panelId?: string
  diagramId?: string
  trunkX: number
  top: number
  bottom: number
  direction: 1 | -1
  /** True when branches stack towards smaller Y (away from a protection below). */
  climbs: boolean
  spacing: number
  /** Branch attachment heights by branch index. */
  branchYs: number[]
  branchRows: LayoutNode['bounds'][]
}

const TRUNK_SEGMENT_ID = /^circuit-trunk-(.+)-segment-\d+$/

function branchIndexFor(node: LayoutNode, circuitId: string): number | null {
  const prefix = `branch-${circuitId}-`
  if (node.type !== 'branch' || !node.domainId?.startsWith(prefix)) return null
  const index = Number.parseInt(node.domainId.slice(prefix.length), 10)
  return Number.isFinite(index) ? index : null
}

function readTrunkColumn(
  parent: LayoutNode,
  circuitId: string,
  panelId: string | undefined,
  diagramId: string | undefined
): TrunkColumn | null {
  const segments = parent.children.filter(
    (child) => child.type === 'wire' && child.id.match(TRUNK_SEGMENT_ID)?.[1] === circuitId
  )
  if (segments.length === 0) return null
  const trunkLeft = Math.min(...segments.map((segment) => segment.bounds.x))
  const trunkRight = Math.max(...segments.map((segment) => segment.bounds.x + segment.bounds.width))
  const trunkTop = Math.min(...segments.map((segment) => segment.bounds.y))
  const trunkBottom = Math.max(...segments.map((segment) => segment.bounds.y + segment.bounds.height))
  const trunkX = (trunkLeft + trunkRight) / 2

  // Only branches that attach to this trunk; DC-bus rails carry their own branches.
  const attached = parent.children.flatMap((child) => {
    const index = branchIndexFor(child, circuitId)
    if (index === null) return []
    const { x, width } = child.bounds
    if (x > trunkX + TRUNK_COLUMN_HALF_WIDTH || x + width < trunkX - TRUNK_COLUMN_HALF_WIDTH) {
      return []
    }
    return [{ index, bounds: child.bounds }]
  })
  if (attached.length === 0) return null
  attached.sort((left, right) => left.index - right.index)

  const branchYs = attached.map(({ bounds }) => bounds.y + bounds.height / 2)
  const first = branchYs[0]!
  const last = branchYs.at(-1)!
  // One-wire circuits rise from their protection; with one branch there is no order to read.
  const climbs = attached.length > 1 ? last < first : first < trunkBottom
  const spacing =
    attached.length > 1 ? Math.abs(last - first) / (attached.length - 1) : DEFAULT_BRANCH_SPACING
  const far = climbs ? last - spacing / 2 : last + spacing / 2
  const near = climbs ? Math.max(trunkBottom, first) : Math.min(trunkTop, first)
  const branchRight = Math.max(...attached.map(({ bounds }) => bounds.x + bounds.width))
  const branchLeft = Math.min(...attached.map(({ bounds }) => bounds.x))

  return {
    circuitId,
    panelId,
    diagramId,
    trunkX,
    top: Math.min(far, near),
    bottom: Math.max(far, near),
    direction: branchRight - trunkX >= trunkX - branchLeft ? 1 : -1,
    climbs,
    spacing,
    branchYs,
    branchRows: attached.map(({ bounds }) => bounds),
  }
}

function collectTrunkColumns(tree: LayoutTree): TrunkColumn[] {
  const columns: TrunkColumn[] = []
  const visit = (node: LayoutNode, panelId?: string, diagramId?: string) => {
    const nextPanelId = node.type === 'panel' ? (node.domainId ?? panelId) : panelId
    const nextDiagramId = node.type === 'panel' ? (node.diagramId ?? diagramId) : diagramId
    const circuitIds = new Set(
      node.children.flatMap((child) => {
        const circuitId = child.type === 'wire' ? child.id.match(TRUNK_SEGMENT_ID)?.[1] : undefined
        return circuitId ? [circuitId] : []
      })
    )
    for (const circuitId of circuitIds) {
      const column = readTrunkColumn(node, circuitId, nextPanelId, nextDiagramId)
      if (column) columns.push(column)
    }
    for (const child of node.children) visit(child, nextPanelId, nextDiagramId)
  }
  for (const panel of tree.panels) visit(panel)
  return columns
}

function columnContains(
  column: TrunkColumn,
  position: Point,
  includeBranchRows: boolean
): boolean {
  if (position.y < column.top || position.y > column.bottom) {
    return false
  }
  if (Math.abs(position.x - column.trunkX) <= TRUNK_COLUMN_HALF_WIDTH) return true
  return includeBranchRows && column.branchRows.some(
    (row) =>
      position.x >= row.x &&
      position.x <= row.x + row.width &&
      position.y >= row.y &&
      position.y <= row.y + row.height
  )
}

function slotFromColumn(column: TrunkColumn, position: Point): CircuitTrunkBranchSlot {
  const { branchYs, climbs } = column
  const isNearer = (branchY: number) => (climbs ? branchY > position.y : branchY < position.y)
  const insertIndex = branchYs.filter(isNearer).length

  const step = climbs ? -column.spacing / 2 : column.spacing / 2
  const slotY =
    insertIndex === 0
      ? branchYs[0]! - step
      : insertIndex >= branchYs.length
        ? branchYs.at(-1)! + step
        : (branchYs[insertIndex - 1]! + branchYs[insertIndex]!) / 2

  return {
    circuitId: column.circuitId,
    panelId: column.panelId,
    diagramId: column.diagramId,
    insertIndex,
    branchCount: branchYs.length,
    trunkX: column.trunkX,
    top: column.top,
    bottom: column.bottom,
    markerY: position.y,
    slotY: Math.max(column.top, Math.min(column.bottom, slotY)),
    direction: column.direction,
  }
}

export interface CircuitTrunkBranchSlotOptions {
  /**
   * Also resolve slots over branch rows. Whole-branch moves use this; single endpoints keep
   * branch rows for series insertion and reorder only from the trunk itself.
   */
  includeBranchRows?: boolean
}

/**
 * Resolve the branch gap under the pointer anywhere along a circuit trunk (and optionally on
 * one of its branch rows). Returns null outside every trunk column.
 */
export function findCircuitTrunkBranchSlot(
  tree: LayoutTree,
  position: Point,
  { includeBranchRows = true }: CircuitTrunkBranchSlotOptions = {}
): CircuitTrunkBranchSlot | null {
  const matches = collectTrunkColumns(tree).filter((column) =>
    columnContains(column, position, includeBranchRows)
  )
  if (matches.length === 0) return null
  const nearest = matches.reduce((best, column) =>
    Math.abs(column.trunkX - position.x) < Math.abs(best.trunkX - position.x) ? column : best
  )
  return slotFromColumn(nearest, position)
}

export function circuitTrunkBranchSlotDropTarget(slot: CircuitTrunkBranchSlot): DropTarget {
  return {
    type: 'circuit',
    circuitId: slot.circuitId,
    panelId: slot.panelId,
    diagramId: slot.diagramId,
    branchInsertIndex: slot.insertIndex,
  }
}
