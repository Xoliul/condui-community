import type { Point } from '@/types/ui'
import type { DropTarget } from './findDropTarget'
import type { LayoutNode, LayoutTree } from './layoutTree'
import { parseCircuitTrunkWire } from './layoutTreeCircuitColumns'

/** Horizontal reach of the trunk column on either side of the trunk wire centre. */
const TRUNK_COLUMN_HALF_WIDTH = 16
/** Branch spacing used above the top branch and below the bottom branch. */
const DEFAULT_BRANCH_SPACING = 50

/**
 * A gap between two endpoint branches on a circuit trunk, resolved from the pointer height.
 * Branches stack along the trunk away from the protection; `insertIndex` counts the
 * branches between the protection and the pointer. A circuit drawn in columns keeps one
 * numbering: `insertIndex` and `branchCount` are those of the single stack, `columnIndex`
 * names the riser the slot is on (the gap after column k's last row and the gap below
 * column k+1's first row are the same `insertIndex`, on different risers).
 */
export interface CircuitTrunkBranchSlot {
  circuitId: string
  panelId?: string
  diagramId?: string
  insertIndex: number
  branchCount: number
  /** Riser the slot is on, set for columns 1+ of a circuit drawn in columns. */
  columnIndex?: number
  /** Cable run the slot is on (0 = the trunk, k = manual riser k); set only on a circuit that has manual risers. */
  stem?: number
  /** Trunk wire centre X (of the riser, for a column). */
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
  /** Rows of the single stack that sit before this column. */
  insertIndexOffset: number
  /** Rows of the whole circuit. */
  branchCount: number
  columnIndex: number
  /** Cable run of the column; undefined on a circuit without manual risers. */
  stem?: number
  /** The crossbar area belongs to its stem's first column, slot 0. */
  crossbar?: LayoutNode['bounds']
  /** The lead of a manual riser (from the trunk to its vertical) is the riser's first gap, slot 0 of its stem. */
  lead?: LayoutNode['bounds']
}

function branchIndexFor(node: LayoutNode, circuitId: string): number | null {
  const prefix = `branch-${circuitId}-`
  if (node.type !== 'branch' || !node.domainId?.startsWith(prefix)) return null
  const index = Number.parseInt(node.domainId.slice(prefix.length), 10)
  return Number.isFinite(index) ? index : null
}

interface AttachedRow { index: number; bounds: LayoutNode['bounds']; column: number }

function readAttachedRows(parent: LayoutNode, circuitId: string): AttachedRow[] {
  return parent.children.flatMap((child) => {
    const index = branchIndexFor(child, circuitId)
    return index === null ? [] : [{ index, bounds: child.bounds, column: child.branchLayout?.column?.index ?? 0 }]
  })
}

interface ColumnGeometry {
  trunkX: number
  trunkTop: number
  trunkBottom: number
  columnIndex: number
  stem?: number
  rows: AttachedRow[]
  crossbar?: LayoutNode['bounds']
  lead?: LayoutNode['bounds']
}

function createTrunkColumn(
  circuitId: string, panelId: string | undefined, diagramId: string | undefined,
  geometry: ColumnGeometry, insertIndexOffset: number, branchCount: number, defaultSpacing: number
): TrunkColumn | null {
  const { trunkX, trunkTop, trunkBottom, columnIndex, crossbar, stem, lead } = geometry
  // Only branches that attach to this trunk; DC-bus rails carry their own branches.
  const attached = geometry.rows.filter(({ bounds: { x, width } }) =>
    !(x > trunkX + TRUNK_COLUMN_HALF_WIDTH || x + width < trunkX - TRUNK_COLUMN_HALF_WIDTH))
  if (attached.length === 0) return null
  attached.sort((left, right) => left.index - right.index)

  const branchYs = attached.map(({ bounds }) => bounds.y + bounds.height / 2)
  const first = branchYs[0]!
  const last = branchYs.at(-1)!
  // One-wire circuits rise from their protection; with one branch there is no order to read.
  const climbs = attached.length > 1 ? last < first : first < trunkBottom
  const spacing = attached.length > 1 ? Math.abs(last - first) / (attached.length - 1) : defaultSpacing
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
    insertIndexOffset,
    branchCount,
    columnIndex,
    ...(stem !== undefined ? { stem } : {}),
    ...(crossbar ? { crossbar } : {}),
    ...(lead ? { lead } : {}),
  }
}

/** The trunk column of a circuit, plus one column per riser when it is drawn in columns. */
function readTrunkColumns(
  parent: LayoutNode,
  circuitId: string,
  panelId: string | undefined,
  diagramId: string | undefined
): TrunkColumn[] {
  const segments = parent.children.filter(
    (child) => child.type === 'wire' && parseCircuitTrunkWire(child)?.kind === 'segment' &&
      parseCircuitTrunkWire(child)?.circuitId === circuitId
  )
  if (segments.length === 0) return []
  const trunkLeft = Math.min(...segments.map((segment) => segment.bounds.x))
  const trunkRight = Math.max(...segments.map((segment) => segment.bounds.x + segment.bounds.width))
  const trunk: ColumnGeometry = {
    trunkX: (trunkLeft + trunkRight) / 2,
    trunkTop: Math.min(...segments.map((segment) => segment.bounds.y)),
    trunkBottom: Math.max(...segments.map((segment) => segment.bounds.y + segment.bounds.height)),
    columnIndex: 0,
    rows: [],
  }
  const wires = parent.children.flatMap((child) => {
    const wire = child.type === 'wire' ? parseCircuitTrunkWire(child) : null
    return wire && wire.circuitId === circuitId ? [{ wire, bounds: child.bounds }] : []
  })
  const crossbars = new Map(wires.filter(({ wire }) => wire.kind === 'crossbar').map(({ wire, bounds }) => [wire.stem, bounds] as const))
  const crossbar = crossbars.get(0)
  const risers = wires.filter(({ wire }) => wire.kind === 'riser').sort((a, b) => a.wire.column - b.wire.column)
  const leads = new Map(wires.filter(({ wire }) => wire.kind === 'stemLead').map(({ wire, bounds }) => [wire.column, bounds] as const))
  const rows = readAttachedRows(parent, circuitId)
  if (risers.length === 0 || (!crossbar && !risers.some(({ wire }) => wire.manual))) {
    const column = createTrunkColumn(circuitId, panelId, diagramId, { ...trunk, rows }, 0, rows.length, DEFAULT_BRANCH_SPACING)
    return column ? [column] : []
  }

  // A circuit with manual risers tells its columns apart by stem; one without keeps the single-stack numbering.
  const hasStems = risers.some(({ wire }) => wire.manual)
  const firstOfStem = new Set<number>()
  // Rows belong to a riser by their column, never by how close they happen to be.
  const geometries: ColumnGeometry[] = [
    { ...trunk, ...(hasStems ? { stem: 0 } : {}), ...(crossbar ? { crossbar } : {}) },
    ...risers.map(({ wire, bounds }): ColumnGeometry => {
      const stemCrossbar = wire.manual && !firstOfStem.has(wire.stem) ? crossbars.get(wire.stem) : undefined
      firstOfStem.add(wire.stem)
      const owner = crossbars.get(wire.stem)
      return {
        trunkX: bounds.x + bounds.width / 2,
        trunkTop: bounds.y,
        // The crossbar itself is its stem's first slot, not the first gap of a riser; a manual riser starts at its lead.
        trunkBottom: bounds.y + bounds.height - (wire.manual ? 0 : (owner?.height ?? 0) / 2),
        columnIndex: wire.column,
        ...(hasStems ? { stem: wire.stem } : {}),
        ...(stemCrossbar ? { crossbar: stemCrossbar } : {}),
        ...(leads.has(wire.column) ? { lead: leads.get(wire.column) } : {}),
        rows: [],
      }
    }),
  ]
  for (const row of rows) (geometries.find((geometry) => geometry.columnIndex === row.column) ?? geometries[0]!).rows.push(row)
  // Legs carry their root's column but hang off symbols: with manual risers only rows on the riser's own wire count.
  const attachedRows = (geometry: ColumnGeometry): AttachedRow[] => !hasStems ? geometry.rows : geometry.rows.filter(({ bounds: { x, width } }) =>
    !(x > geometry.trunkX + TRUNK_COLUMN_HALF_WIDTH || x + width < geometry.trunkX - TRUNK_COLUMN_HALF_WIDTH))
  const attachedCount = (geometry: ColumnGeometry): number => attachedRows(geometry).length
  const tall = geometries.find((geometry) => attachedCount(geometry) > 1)
  const spacing = tall
    ? Math.abs(attachedRows(tall).at(-1)!.bounds.y - attachedRows(tall)[0]!.bounds.y) / (attachedCount(tall) - 1)
    : DEFAULT_BRANCH_SPACING
  const total = geometries.reduce((sum, geometry) => sum + attachedCount(geometry), 0)
  let offset = 0
  return geometries.flatMap((geometry) => {
    const startRow = offset
    offset += attachedCount(geometry)
    const column = createTrunkColumn(circuitId, panelId, diagramId, geometry, startRow, total, spacing)
    return column ? [column] : []
  })
}

function collectTrunkColumns(tree: LayoutTree): TrunkColumn[] {
  const columns: TrunkColumn[] = []
  const visit = (node: LayoutNode, panelId?: string, diagramId?: string) => {
    const nextPanelId = node.type === 'panel' ? (node.domainId ?? panelId) : panelId
    const nextDiagramId = node.type === 'panel' ? (node.diagramId ?? diagramId) : diagramId
    const circuitIds = new Set(
      node.children.flatMap((child) => {
        const wire = child.type === 'wire' ? parseCircuitTrunkWire(child) : null
        return wire?.kind === 'segment' ? [wire.circuitId] : []
      })
    )
    for (const circuitId of circuitIds) {
      columns.push(...readTrunkColumns(node, circuitId, nextPanelId, nextDiagramId))
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
  const local = branchYs.filter(isNearer).length

  const step = climbs ? -column.spacing / 2 : column.spacing / 2
  const slotY =
    local === 0
      ? branchYs[0]! - step
      : local >= branchYs.length
        ? branchYs.at(-1)! + step
        : (branchYs[local - 1]! + branchYs[local]!) / 2

  return {
    circuitId: column.circuitId,
    panelId: column.panelId,
    diagramId: column.diagramId,
    insertIndex: column.insertIndexOffset + local,
    branchCount: column.branchCount,
    ...(column.columnIndex ? { columnIndex: column.columnIndex } : {}),
    ...(column.stem !== undefined ? { stem: column.stem } : {}),
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
  options: CircuitTrunkBranchSlotOptions = {}
): CircuitTrunkBranchSlot | null {
  return findSlotInColumns(collectTrunkColumns(tree), position, options)
}

/** One read-only target collection can resolve many slots from the same drawing. */
export function createCircuitTrunkBranchSlotFinder(tree: LayoutTree) {
  const columns = collectTrunkColumns(tree)
  return (position: Point, options: CircuitTrunkBranchSlotOptions = {}) =>
    findSlotInColumns(columns, position, options)
}

function findSlotInColumns(
  columns: TrunkColumn[],
  position: Point,
  { includeBranchRows = true }: CircuitTrunkBranchSlotOptions = {}
): CircuitTrunkBranchSlot | null {
  // The crossbar is the first gap of the whole stack: it belongs to column 0, slot 0.
  const onCrossbar = columns.find(({ crossbar }) => crossbar &&
    position.x >= crossbar.x && position.x <= crossbar.x + crossbar.width &&
    position.y >= crossbar.y && position.y <= crossbar.y + crossbar.height)
  if (onCrossbar) return slotFromColumn(onCrossbar, position)
  const onLead = columns.find(({ lead }) => lead &&
    position.x >= lead.x && position.x <= lead.x + lead.width && position.y >= lead.y && position.y <= lead.y + lead.height)
  if (onLead) return slotFromColumn(onLead, position)
  const matches = columns.filter((column) =>
    columnContains(column, position, includeBranchRows)
  )
  if (matches.length === 0) return null
  const nearest = matches.reduce((best, column) =>
    Math.abs(column.trunkX - position.x) < Math.abs(best.trunkX - position.x) ? column : best
  )
  return slotFromColumn(nearest, position)
}

/** Intent id of a trunk gap; the same `insertIndex` on two risers of a circuit in columns stays two spots. */
export function getCircuitTrunkBranchSlotId(slot: CircuitTrunkBranchSlot, diagramId = slot.diagramId): string {
  return `${diagramId}/${slot.circuitId}/stem/${slot.insertIndex}${slot.stem !== undefined ? `/riser/${slot.stem}` : ''}${slot.columnIndex ? `/column/${slot.columnIndex}` : ''}`
}

/** The drop target of a slot; `branchStem` names the cable run on a circuit that has manual risers. */
export function circuitTrunkBranchSlotDropTarget(slot: CircuitTrunkBranchSlot): DropTarget {
  return {
    ...(slot.stem !== undefined ? { branchStem: slot.stem } : {}),
    type: 'circuit',
    circuitId: slot.circuitId,
    panelId: slot.panelId,
    diagramId: slot.diagramId,
    branchInsertIndex: slot.insertIndex,
  }
}
