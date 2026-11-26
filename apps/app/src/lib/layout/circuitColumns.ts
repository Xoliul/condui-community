/**
 * Long final circuits are drawn as side-by-side columns: the trunk rises to a horizontal crossbar
 * above the cable caption and parallel risers carry consecutive rows. This is drawing only; the
 * rows, their numbering and the cable stay those of the single stack.
 *
 * Eligibility, the row split and the shared helpers live here; X comes from the envelope
 * (`columnAnchorOffsets`), Y from the branch pass post-step in `circuitColumnRows.ts`.
 */
import { isEnergyConversionEndpointSymbol } from '@/lib/eendraad/endpointInsertAfter'
import { getBranchConverterMetadataCalloutHeight } from './circuitConverterMetadataCallouts'
import { isCircuitConverterDcChild, supportsCircuitConverterDcConnections } from './circuitConverterGeometry'
import { getBranchStem, circuitHasRootStems } from '@/lib/wires/riserStems'
import type { Circuit, Endpoint, ProtectionDevice, TrunkDevice } from '@/types/schema'
import type { BranchLayout } from './wireSegments'

export const CIRCUIT_COLUMN_MAX_ROWS = 16

let overrideForTests: boolean | null = null

/** Test-only switch to compare with the single stack; `null` restores the default (on). */
export function setOneWireColumnsOverrideForTests(value: boolean | null): void {
  overrideForTests = value
}

export function oneWireColumnsEnabled(): boolean {
  return overrideForTests ?? true
}

export { getBranchStem, circuitHasRootStems }

export interface CircuitColumnPlanOptions {
  protection?: ProtectionDevice | null
  circuitMap?: ReadonlyMap<string, Circuit>
}

function isExcludedEndpoint(endpoint: Endpoint): boolean {
  const symbol = endpoint.symbol ?? ''
  return (
    symbol === 'panel_distribution' || symbol === 'domotica' || symbol === 'solar_panel' ||
    symbol === 'battery' || !!endpoint.domoticaChildProps || isEnergyConversionEndpointSymbol(symbol) ||
    isCircuitConverterDcChild(endpoint) || getBranchConverterMetadataCalloutHeight(endpoint) > 0
  )
}

function isExcludedTrunkDevice(device: TrunkDevice): boolean {
  return (
    device.trunkPosition !== 0 || device.type === 'dc_bus' || !!device.supplyPath ||
    !!device.converterDcConnection || supportsCircuitConverterDcConnections(device) ||
    isEnergyConversionEndpointSymbol(device.symbol)
  )
}

function isNestedInSupplyTap(circuit: Circuit, circuitMap: ReadonlyMap<string, Circuit>): boolean {
  const seen = new Set<string>([circuit.id])
  let current = circuit
  for (;;) {
    const parent = [...circuitMap.values()].find((candidate) => candidate.subCircuitIds?.includes(current.id))
    if (!parent || seen.has(parent.id)) return false
    if (parent.supplyTap) return true
    seen.add(parent.id)
    current = parent
  }
}

/** Structural eligibility for runs (automatic columns and manual risers); forks are fine, legs move with their root. */
export function isCircuitColumnEligible(circuit: Circuit, options: CircuitColumnPlanOptions = {}): boolean {
  if (
    (circuit.subCircuitIds?.length ?? 0) > 0 || circuit.code === 'PANEL' ||
    circuit.dcBusSource || circuit.supplySource || circuit.supplyTap || options.protection?.supplyTap ||
    circuit.branches?.some((branch) => !!branch.dcBusId) ||
    circuit.endpoints.some(isExcludedEndpoint) || (circuit.trunkDevices ?? []).some(isExcludedTrunkDevice)
  ) {
    return false
  }
  return !(options.circuitMap && isNestedInSupplyTap(circuit, options.circuitMap))
}

/** Start row of every column (balanced consecutive runs), or null when the circuit stays one stack. */
export function planCircuitColumns(
  circuit: Circuit,
  rowCount: number,
  options: CircuitColumnPlanOptions = {}
): number[] | null {
  if (rowCount <= CIRCUIT_COLUMN_MAX_ROWS || !oneWireColumnsEnabled()) return null
  // Circuits with stems are planned by `planCircuitRuns`; one that cannot draw them stays one stack.
  if (circuitHasRootStems(circuit) || !isCircuitColumnEligible(circuit, options)) return null
  const columns = Math.ceil(rowCount / CIRCUIT_COLUMN_MAX_ROWS)
  const base = Math.floor(rowCount / columns)
  const extra = rowCount % columns
  const starts: number[] = []
  let row = 0
  for (let column = 0; column < columns; column++) {
    starts.push(row)
    row += base + (column < extra ? 1 : 0)
  }
  return starts
}

/** Rows of the circuit's own trunk: everything except the extra columns. */
export function getTrunkOwnBranches<T extends Pick<BranchLayout, 'column'>>(branches: T[]): T[] {
  return branches.some((branch) => branch.column) ? branches.filter((branch) => !branch.column || branch.column.index === 0) : branches
}

/** Moves the crossbar of a branch row along with a vertical shift of the branch. */
export function shiftBranchColumn(branch: Pick<BranchLayout, 'column'>, dy: number): void {
  if (branch.column) branch.column.crossbarY += dy
}

/** Copy of a branch column carrying a new crossbar position (branch copies must not share it). */
export function offsetBranchColumn(column: BranchLayout['column'], dy: number): BranchLayout['column'] {
  return column && { ...column, crossbarY: column.crossbarY + dy }
}

export interface ColumnRowExtent { left: number; right: number }

/** Riser offsets from the anchor (column 0 = 0) and the painted union, from per-row extents around each riser. */
export function measureCircuitColumnOffsets(
  starts: number[],
  rowExtents: ColumnRowExtent[],
  gutter: number
): { offsets: number[]; left: number; right: number } {
  const offsets: number[] = []
  let left = 0
  let right = 0
  let previousRight = 0
  starts.forEach((start, column) => {
    const end = starts[column + 1] ?? rowExtents.length
    const rows = rowExtents.slice(start, end)
    const columnLeft = Math.min(0, ...rows.map((row) => row.left))
    const columnRight = Math.max(0, ...rows.map((row) => row.right))
    const offset = column === 0 ? 0 : previousRight + gutter - columnLeft
    offsets.push(offset)
    left = Math.min(left, offset + columnLeft)
    right = Math.max(right, offset + columnRight)
    previousRight = offset + columnRight
  })
  return { offsets, left, right }
}

/** One riser of a circuit: `count` consecutive rows from `startRow`, `offsetX` right of the trunk. */
export interface CircuitColumnRun {
  startRow: number
  count: number
  offsetX: number
}

/** The automatic runs (starts from the 16-row rule, risers from the envelope), or null for one stack. */
export function planCircuitColumnRuns(
  circuit: Circuit,
  rowCount: number,
  columnAnchorOffsets: readonly number[] | undefined,
  options: CircuitColumnPlanOptions = {}
): CircuitColumnRun[] | null {
  const starts = columnAnchorOffsets ? planCircuitColumns(circuit, rowCount, options) : null
  if (!starts || !columnAnchorOffsets || starts.length !== columnAnchorOffsets.length) return null
  return starts.map((startRow, index) => ({
    startRow,
    count: (starts[index + 1] ?? rowCount) - startRow,
    offsetX: columnAnchorOffsets[index]!,
  }))
}
