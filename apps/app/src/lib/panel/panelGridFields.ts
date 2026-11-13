/**
 * Fields: side-by-side sections of one board's module grid (a multi-field cabinet, or
 * two cabinets next to each other). Every field has the same rows and the same number of
 * module columns. Field `i` starts at column `i * (columns + PANEL_GRID_FIELD_GAP_MODULES)`
 * of the one global grid, so slot columns, pixel positions and snapping keep a single
 * coordinate system and the empty gap columns act as the visible gap and wire corridor.
 * With one field the layout equals the plain `columns` grid.
 */
import type { PanelGridConfig } from '@/types/schema'
import { DEFAULT_PANEL_GRID_COLUMNS } from '@/lib/panel/panelGridDefaults'
import { panelGridUnitsToModules, panelModulesToGridUnits } from '@/lib/panel/panelGridUnits'

/** Empty columns between two fields. */
export const PANEL_GRID_FIELD_GAP_MODULES = 2
export const MAX_PANEL_GRID_FIELDS = 8

export interface PanelGridFieldLayout {
  /** Number of fields (at least 1). */
  fields: number
  /** Module columns inside one field. */
  columns: number
}

export type PanelGridFieldSource =
  | (Partial<Pick<PanelGridConfig, 'columns' | 'fields'>> | null)
  | undefined

export function getPanelGridFields(grid: PanelGridFieldSource): number {
  const fields = grid?.fields
  if (typeof fields !== 'number' || !Number.isFinite(fields)) return 1
  return Math.max(1, Math.min(MAX_PANEL_GRID_FIELDS, Math.floor(fields)))
}

export function getPanelGridFieldLayout(grid: PanelGridFieldSource): PanelGridFieldLayout {
  return {
    fields: getPanelGridFields(grid),
    columns: Math.max(1, grid?.columns ?? DEFAULT_PANEL_GRID_COLUMNS),
  }
}

/** Column (in modules) where field `index` starts. */
export function panelGridFieldStartModules(layout: PanelGridFieldLayout, index: number): number {
  return index * (layout.columns + PANEL_GRID_FIELD_GAP_MODULES)
}

/** Total width of the grid in modules, including the gaps between fields. */
export function getPanelGridTotalColumns(grid: PanelGridFieldSource): number {
  const layout = getPanelGridFieldLayout(grid)
  return panelGridFieldStartModules(layout, layout.fields - 1) + layout.columns
}

/** `[start, end)` of every field in internal grid units. */
export function panelGridFieldRangesUnits(
  layout: PanelGridFieldLayout
): Array<{ start: number; end: number }> {
  const widthUnits = panelModulesToGridUnits(layout.columns)
  return Array.from({ length: layout.fields }, (_, index) => {
    const start = panelModulesToGridUnits(panelGridFieldStartModules(layout, index))
    return { start, end: start + widthUnits }
  })
}

/** True when a module of `widthUnits` starting at `startUnits` lies inside one field. */
export function fitsInPanelGridField(
  layout: PanelGridFieldLayout,
  startUnits: number,
  widthUnits: number
): boolean {
  return panelGridFieldRangesUnits(layout).some(
    (range) => startUnits >= range.start && startUnits + widthUnits <= range.end
  )
}

/**
 * Nearest valid start for a module of `widthUnits` wanted at `startUnits`: it is pulled
 * into the field containing its start, or the next field when it starts in a gap.
 * A module wider than a field starts at the beginning of the nearest field.
 */
export function clampPanelGridStartToField(
  layout: PanelGridFieldLayout,
  startUnits: number,
  widthUnits: number
): number {
  const ranges = panelGridFieldRangesUnits(layout)
  const range =
    ranges.find((candidate) => startUnits < candidate.end) ?? ranges[ranges.length - 1]!
  const lastStart = Math.max(range.start, range.end - widthUnits)
  return Math.min(Math.max(startUnits, range.start), lastStart)
}

/** Module-unit variant of {@link clampPanelGridStartToField} used by pointer handlers. */
export function clampPanelGridColToField(
  layout: PanelGridFieldLayout,
  col: number,
  widthCols: number
): number {
  return panelGridUnitsToModules(
    clampPanelGridStartToField(
      layout,
      panelModulesToGridUnits(col),
      Math.max(1, panelModulesToGridUnits(widthCols))
    )
  )
}

/** Run a per-field search (`find(start, maxStart)`) over the fields in order. */
export function findInPanelGridFields(
  layout: PanelGridFieldLayout,
  startUnits: number,
  widthUnits: number,
  find: (start: number, maxStart: number) => number | null
): number | null {
  for (const range of panelGridFieldRangesUnits(layout)) {
    if (startUnits >= range.end) continue
    const maxStart = range.end - widthUnits
    const found = find(Math.max(startUnits, range.start), maxStart)
    if (found != null) return found
  }
  return null
}

/**
 * Pointer-handler helper: pull a wanted start column into one field of a multi-field board.
 * Boards with one field (and areas without a grid, `undefined`) are returned unchanged.
 */
export function snapPanelGridColToFields(
  grid: PanelGridFieldSource,
  col: number,
  widthCols: number
): number {
  if (!grid || getPanelGridFields(grid) < 2) return col
  return clampPanelGridColToField(getPanelGridFieldLayout(grid), col, widthCols)
}

/** Right edge (in modules) of the field containing `col`; the whole width when one field. */
export function panelGridFieldEndCol(grid: PanelGridFieldSource, col: number): number {
  const layout = getPanelGridFieldLayout(grid)
  const colUnits = panelModulesToGridUnits(col)
  const range =
    panelGridFieldRangesUnits(layout).find((candidate) => colUnits < candidate.end) ??
    panelGridFieldRangesUnits(layout).at(-1)!
  return panelGridUnitsToModules(range.end)
}

/** True when a module of `widthCols` at `col` lies inside one field (always true with one field). */
export function panelGridModuleFitsFields(
  grid: PanelGridFieldSource,
  col: number,
  widthCols: number
): boolean {
  if (!grid || getPanelGridFields(grid) < 2) return true
  return fitsInPanelGridField(
    getPanelGridFieldLayout(grid),
    panelModulesToGridUnits(col),
    Math.max(1, panelModulesToGridUnits(widthCols))
  )
}
