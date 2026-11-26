/**
 * Hit-zone wire nodes of a circuit drawn in columns: the crossbar and risers of the automatic split, and the
 * lead and vertical of every manual riser (a second cable leaving the breaker).
 */
import type { HitZone, LayoutNode } from './layoutTree'
import type { BranchLayout } from './wireSegments'

export const CIRCUIT_CROSSBAR_NODE_PREFIX = 'circuit-crossbar-'
export const CIRCUIT_RISER_NODE_PREFIX = 'circuit-riser-'
export const CIRCUIT_STEM_CROSSBAR_NODE_PREFIX = 'circuit-stemcrossbar-'
export const CIRCUIT_STEM_NODE_PREFIX = 'circuit-stem-'
export const CIRCUIT_STEM_LEAD_NODE_PREFIX = 'circuit-stemlead-'

/** Where the horizontal lead of a manual riser leaves the trunk, above the breaker output (below the cable captions). */
export const CIRCUIT_RISER_SPLIT_RISE = 30

const SEGMENT_NODE = /^circuit-trunk-(.+)-segment-(\d+)$/
const RISER_NODE = /^circuit-riser-(.+)-(\d+)$/
const STEM_CROSSBAR_NODE = /^circuit-stemcrossbar-(.+)-(\d+)$/
const STEM_NODE = /^circuit-stem-(.+)-(\d+)-(\d+)$/
const STEM_LEAD_NODE = /^circuit-stemlead-(.+)-(\d+)-(\d+)$/

/** A wire node that is part of a circuit's trunk: a trunk segment, or the crossbar/riser/lead of a circuit in columns. */
export interface CircuitTrunkWire {
  circuitId: string
  /** `riser` is a vertical on a column other than the trunk's: a manual riser or a column of the automatic split. */
  kind: 'segment' | 'crossbar' | 'riser' | 'stemLead'
  /** The trunk segment the wire is, or continues. */
  segmentIndex: number
  /** The column the wire serves: 0 for the trunk and the crossbar, k for riser k. */
  column: number
  /** The stem the wire belongs to: 0 for the trunk, k for manual riser k. */
  stem: number
  /** The vertical of a manual riser itself (its own cable), as opposed to a column of the automatic split. */
  manual: boolean
}

/**
 * The one place that says whether a node is a vertical trunk wire (and which segment, circuit, column and stem).
 * A drop on the crossbar, a riser or a lead means what it means on the trunk segment it continues.
 */
export function parseCircuitTrunkWire(node: Pick<LayoutNode, 'id' | 'hitZone'>): CircuitTrunkWire | null {
  const id = node.id ?? ''
  const segment = SEGMENT_NODE.exec(id)
  if (segment) return { circuitId: segment[1]!, kind: 'segment', segmentIndex: Number(segment[2]), column: 0, stem: 0, manual: false }
  const continued = node.hitZone?.circuitTrunkSegmentIndex
  if (typeof continued !== 'number') return null
  const stem = node.hitZone?.branchStem ?? 0
  if (id.startsWith(CIRCUIT_CROSSBAR_NODE_PREFIX)) {
    return { circuitId: id.slice(CIRCUIT_CROSSBAR_NODE_PREFIX.length), kind: 'crossbar', segmentIndex: continued, column: 0, stem: 0, manual: false }
  }
  const stemCrossbar = STEM_CROSSBAR_NODE.exec(id)
  if (stemCrossbar) {
    return { circuitId: stemCrossbar[1]!, kind: 'crossbar', segmentIndex: continued, column: 0, stem: Number(stemCrossbar[2]), manual: false }
  }
  const manualRiser = STEM_NODE.exec(id)
  if (manualRiser) {
    return { circuitId: manualRiser[1]!, kind: 'riser', segmentIndex: continued, column: Number(manualRiser[3]), stem: Number(manualRiser[2]), manual: true }
  }
  const lead = STEM_LEAD_NODE.exec(id)
  if (lead) {
    return { circuitId: lead[1]!, kind: 'stemLead', segmentIndex: continued, column: Number(lead[3]), stem: Number(lead[2]), manual: true }
  }
  const riser = RISER_NODE.exec(id)
  return riser ? { circuitId: riser[1]!, kind: 'riser', segmentIndex: continued, column: Number(riser[2]), stem, manual: false } : null
}

/** Trunk segments, the horizontal trunk stub, crossbar, risers and leads: every wire of a circuit's own trunk. */
export function isCircuitTrunkWireNode(node: Pick<LayoutNode, 'id' | 'hitZone'>): boolean {
  return !!node.id?.startsWith('circuit-trunk-') || parseCircuitTrunkWire(node) !== null
}

export function getCircuitCrossbarNodeId(circuitId: string, stem = 0): string {
  return stem > 0 ? `${CIRCUIT_STEM_CROSSBAR_NODE_PREFIX}${circuitId}-${stem}` : `${CIRCUIT_CROSSBAR_NODE_PREFIX}${circuitId}`
}

export function getCircuitRiserNodeId(circuitId: string, column: number): string {
  return `${CIRCUIT_RISER_NODE_PREFIX}${circuitId}-${column}`
}

export function getCircuitStemNodeId(circuitId: string, stem: number, column: number): string {
  return `${CIRCUIT_STEM_NODE_PREFIX}${circuitId}-${stem}-${column}`
}

export function getCircuitStemLeadNodeId(circuitId: string, stem: number, column: number): string {
  return `${CIRCUIT_STEM_LEAD_NODE_PREFIX}${circuitId}-${stem}-${column}`
}

interface ColumnGeometry { index: number; stem: number; kind?: 'riser' | 'auto'; x: number; topY: number; crossbarY: number; trunkY: number; splitY: number }

/** Geometry of every column from its root rows (legs hang off endpoints and have their own wires). */
export function readColumnGeometries(branches: readonly BranchLayout[]): ColumnGeometry[] {
  const columns = new Map<number, ColumnGeometry>()
  for (const branch of branches) {
    if (!branch.column || branch.forkFrom) continue
    const known = columns.get(branch.column.index)
    columns.set(branch.column.index, {
      index: branch.column.index, stem: branch.column.stem ?? 0, kind: branch.column.kind,
      x: branch.trunkX, topY: Math.min(known?.topY ?? Infinity, branch.branchY),
      crossbarY: branch.column.crossbarY, trunkY: branch.trunkY, splitY: branch.trunkY - (branch.column.splitRise ?? CIRCUIT_RISER_SPLIT_RISE),
    })
  }
  return [...columns.values()].sort((a, b) => a.index - b.index)
}

/** Y of the node where manual risers leave the trunk. */
export function getCircuitRiserSplitY(trunkY: number): number {
  return trunkY - CIRCUIT_RISER_SPLIT_RISE
}

/**
 * `branches` are all rows of one circuit. Zones follow the trunk segment hit zones (same pad, type,
 * domain) and name the trunk segment they continue, so a drop on them resolves like a drop on it.
 */
export function buildCircuitColumnWireNodes(
  circuitId: string,
  branches: BranchLayout[],
  options: { wirePad: number; wireDomain: 'AC' | 'DC'; trunkSegmentIndex: number }
): LayoutNode[] {
  const ordered = readColumnGeometries(branches)
  if (ordered.length === 0) return []
  const { wirePad } = options
  const hitZone = (stem: number): HitZone => ({
    type: 'circuit',
    padding: 0,
    wireDomain: options.wireDomain,
    circuitTrunkSegmentIndex: options.trunkSegmentIndex,
    ...(stem > 0 ? { branchStem: stem } : {}),
  })
  const wire = (id: string, x: number, y: number, width: number, height: number, stem: number): LayoutNode =>
    ({ id, type: 'wire', bounds: { x, y, width, height }, hitZone: hitZone(stem), children: [] })
  const nodes: LayoutNode[] = []
  const trunkX = ordered[0]!.x
  for (const stem of new Set(ordered.map((column) => column.stem))) {
    const runs = ordered.filter((column) => column.stem === stem)
    const first = runs[0]!
    const last = runs.at(-1)!
    if (runs.length > 1) {
      nodes.push(wire(getCircuitCrossbarNodeId(circuitId, stem), first.x, first.crossbarY - wirePad, last.x - first.x, wirePad * 2, stem))
    }
    for (const run of runs.slice(1)) {
      nodes.push(wire(getCircuitRiserNodeId(circuitId, run.index), run.x - wirePad, run.topY, wirePad * 2, run.crossbarY - run.topY, stem))
    }
    if (stem === 0) continue
    // Manual riser: a lead from the trunk, then the vertical up to its crossbar (or its first row).
    const splitY = first.splitY
    const top = first.topY // the vertical runs on past a crossbar, up to the first run's topmost row
    nodes.push(wire(getCircuitStemLeadNodeId(circuitId, stem, first.index), trunkX, splitY - wirePad, first.x - trunkX, wirePad * 2, stem))
    nodes.push(wire(getCircuitStemNodeId(circuitId, stem, first.index), first.x - wirePad, top, wirePad * 2, splitY - top, stem))
  }
  return nodes
}

/**
 * With trunk devices under the split, a drop hint on the last trunk segment belongs on the shared part between the
 * topmost device and the split, not at the top of the trunk's own riser. Empty without risers.
 */
export function getSharedTrunkHitZoneProps(
  branches: readonly BranchLayout[], wireX: number, topDeviceY: number
): { dropHintAnchor?: { x: number; y: number } } {
  const rows = branches.filter((branch) => !branch.forkFrom && branch.column)
  if (!rows.some((branch) => (branch.column!.stem ?? 0) > 0)) return {}
  const rise = rows.find((branch) => branch.column!.splitRise)?.column?.splitRise ?? CIRCUIT_RISER_SPLIT_RISE
  return { dropHintAnchor: { x: wireX, y: (topDeviceY + rows[0]!.trunkY - rise) / 2 } }
}
