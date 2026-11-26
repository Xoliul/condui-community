/**
 * Runs of a circuit drawn side by side: a run is a stretch of consecutive ROOT branches (with all their
 * fork legs) on one stem, `offsetX` right of the trunk. Manual risers (`Branch.stem` k > 0) and the
 * automatic 16-row split both produce runs; the automatic split is computed per stem and only cuts
 * between root subtrees, so adding a riser never reflows the rows of the other stems.
 */
import type { Branch, Circuit } from '@/types/schema'
import {
  isCircuitColumnEligible, CIRCUIT_COLUMN_MAX_ROWS, oneWireColumnsEnabled, getBranchStem, circuitHasRootStems,
  type CircuitColumnPlanOptions,
} from './circuitColumns'

export { getBranchStem, circuitHasRootStems }
import { hasOneWireForks } from '@/lib/eendraad/oneWireForkProject'
import { hasOnlyRiserCompatibleTrunkDevices } from '@/lib/eendraad/oneWireRiserDevices'

export type CircuitRunKind = 'riser' | 'auto'

export interface CircuitRunSpec {
  /** 'riser' = first run of a stem k > 0 (its own cable), 'auto' = every other run (one cable, drawn folded). */
  kind: CircuitRunKind
  stem: number
  /** Index in drawing order: 0 = the trunk's own run. */
  column: number
  /** Position of the first root in the stably stem-sorted root list. */
  firstRoot: number
  rootCount: number
  /** Drawn rows (roots plus legs) before this run, and in it. */
  startRow: number
  rowCount: number
}

export interface CircuitRunPlan {
  runs: CircuitRunSpec[]
  /** Root branch ids in drawing order (stably sorted by stem). */
  rootIds: string[]
  /** Drawn rows of each root subtree, in `rootIds` order. */
  rootRows: number[]
  stems: number[]
}

/** Root branches with their subtree row counts, stably sorted by stem. */
export function listRootSubtrees(circuit: Pick<Circuit, 'branches'>): Array<{ id: string; stem: number; rows: number }> {
  const branches = (circuit.branches ?? []).filter((branch) => !branch.dcBusId)
  const owner = new Map(branches.flatMap((branch) => branch.endpointIds.map((id) => [id, branch.id] as const)))
  const byId = new Map(branches.map((branch) => [branch.id, branch]))
  const rootOf = (branch: Branch): string | null => {
    const seen = new Set<string>()
    let cursor: Branch | undefined = branch
    while (cursor?.forkFrom && !seen.has(cursor.id)) {
      seen.add(cursor.id)
      const parentId = owner.get(cursor.forkFrom.afterEndpointId)
      cursor = parentId ? byId.get(parentId) : undefined
    }
    return cursor && !cursor.forkFrom ? cursor.id : null
  }
  const rows = new Map<string, number>()
  for (const branch of branches) {
    const root = rootOf(branch)
    if (root) rows.set(root, (rows.get(root) ?? 0) + 1)
  }
  return branches.filter((branch) => !branch.forkFrom)
    .map((branch, index) => ({ id: branch.id, stem: getBranchStem(branch), rows: rows.get(branch.id) ?? 1, index }))
    .sort((a, b) => a.stem - b.stem || a.index - b.index)
    .map(({ id, stem, rows: count }) => ({ id, stem, rows: count }))
}

/** Start index (into one stem's roots) of every automatic run: balanced by drawn rows, cut only between roots. */
export function splitStemRoots(rows: readonly number[]): number[] {
  const total = rows.reduce((sum, count) => sum + count, 0)
  if (total <= CIRCUIT_COLUMN_MAX_ROWS) return [0]
  const columns = Math.ceil(total / CIRCUIT_COLUMN_MAX_ROWS)
  const base = Math.floor(total / columns)
  const extra = total % columns
  const boundaries = [0]
  for (const count of rows) boundaries.push(boundaries.at(-1)! + count)
  const starts = [0]
  for (let column = 1; column < columns; column++) {
    const ideal = column * base + Math.min(column, extra)
    let best = starts.at(-1)! + 1
    for (let index = best; index < rows.length; index++) {
      if (Math.abs(boundaries[index]! - ideal) < Math.abs(boundaries[best]! - ideal)) best = index
    }
    if (best < rows.length && best > starts.at(-1)!) starts.push(best)
  }
  return starts
}

export function isCircuitRunEligible(circuit: Circuit, options: CircuitColumnPlanOptions = {}): boolean {
  if (!oneWireColumnsEnabled()) return false
  if (!isCircuitColumnEligible(circuit, options)) return false
  // Manual risers split above the devices of the shared part; devices between rows cannot be drawn with them.
  return !circuitHasRootStems(circuit) || hasOnlyRiserCompatibleTrunkDevices(circuit)
}

/** Circuits whose rows come from the fork layout: with legs or empty rows, or with manual risers that can be drawn. */
export function usesForkRowLayout(circuit: Circuit, options: CircuitColumnPlanOptions = {}): boolean {
  return hasOneWireForks(circuit) || (circuitHasRootStems(circuit) && isCircuitRunEligible(circuit, options))
}

/** The runs of an eligible circuit, or null when it stays one stack (no riser and nothing over 16 rows). */
export function planCircuitRuns(circuit: Circuit, options: CircuitColumnPlanOptions = {}): CircuitRunPlan | null {
  if (!isCircuitRunEligible(circuit, options) || !circuit.branches?.length) return null
  const roots = listRootSubtrees(circuit)
  if (!roots.length) return null
  const runs: CircuitRunSpec[] = []
  const stems = [...new Set(roots.map((root) => root.stem))]
  let row = 0
  for (const stem of stems) {
    const first = roots.findIndex((root) => root.stem === stem)
    const group = roots.filter((root) => root.stem === stem)
    const starts = splitStemRoots(group.map((root) => root.rows))
    starts.forEach((start, index) => {
      const end = starts[index + 1] ?? group.length
      const rowCount = group.slice(start, end).reduce((sum, root) => sum + root.rows, 0)
      runs.push({ kind: index === 0 && stem > 0 ? 'riser' : 'auto', stem, column: runs.length, firstRoot: first + start,
        rootCount: end - start, startRow: row, rowCount })
      row += rowCount
    })
  }
  if (runs.length < 2 && stems.length < 2 && stems[0] === 0) return null
  return { runs, rootIds: roots.map((root) => root.id), rootRows: roots.map((root) => root.rows), stems }
}
