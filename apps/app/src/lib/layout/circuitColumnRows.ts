/**
 * Branch pass post-step: moves runs of consecutive rows onto their own riser above a crossbar.
 *
 * The geometry is driven by a generic list of runs, not by the automatic 16-row rule (that is
 * `planCircuitColumnRuns` in circuitColumns.ts), so a saved riser can feed the same code later.
 */
import { planCircuitColumnRuns, type CircuitColumnRun } from './circuitColumns'
import type { Circuit, ProtectionDevice } from '@/types/schema'
import type { BranchLayout } from './wireSegments'

/** Gap kept between the crossbar and the lowest note of a run's first row. */
export const CIRCUIT_CROSSBAR_NOTE_CLEARANCE = 10

export interface CircuitColumnRowsContext {
  rowSpacing: number
  /** How far a row's endpoints paint below the row's wire (symbols, notes, button annotations). */
  bottomExtent: (endpoints: BranchLayout['endpoints']) => number
}

/**
 * `rows` is the single stack as computed today; its first row sits where the trunk used to end
 * (`crossbarY`). The first rows of all runs share one y above the crossbar, and the rows of a run
 * keep the spacing they had in the stack. Run 0 stays on the trunk (offsetX 0).
 */
export function applyCircuitColumnRuns(
  rows: BranchLayout[],
  runs: readonly CircuitColumnRun[],
  crossbarY: number,
  context: CircuitColumnRowsContext
): BranchLayout[] {
  const lift = Math.max(
    context.rowSpacing,
    ...runs.map((run) => context.bottomExtent(rows[run.startRow]!.endpoints) + CIRCUIT_CROSSBAR_NOTE_CLEARANCE)
  )
  const firstRowY = crossbarY - lift
  const originalYs = rows.map((row) => row.branchY)
  runs.forEach((run, index) => {
    for (let row = run.startRow; row < run.startRow + run.count; row++) {
      const branch = rows[row]!
      branch.branchY = firstRowY + (originalYs[row]! - originalYs[run.startRow]!)
      branch.trunkX += run.offsetX
      branch.branchX += run.offsetX
      branch.column = { index, startRow: run.startRow, count: run.count, crossbarY }
    }
  })
  return rows
}

/** The automatic columns of a long plain circuit, applied to its rows (no-op for any other circuit). */
export function applyAutomaticCircuitColumns(
  circuit: Circuit,
  rows: BranchLayout[],
  crossbarY: number,
  context: CircuitColumnRowsContext & {
    columnAnchorOffsets?: number[]
    circuitMap: ReadonlyMap<string, Circuit>
    protection?: ProtectionDevice | null
  }
): BranchLayout[] {
  const runs = planCircuitColumnRuns(circuit, rows.length, context.columnAnchorOffsets, {
    protection: context.protection,
    circuitMap: context.circuitMap,
  })
  return runs ? applyCircuitColumnRuns(rows, runs, crossbarY, context) : rows
}
