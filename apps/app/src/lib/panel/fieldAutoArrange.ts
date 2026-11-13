/**
 * Auto-arrange on a multi-field board: the packers know one rectangular grid, so the board
 * is packed as one tall grid of `rows * fields` rows that is `columns` wide, and the result
 * is folded back into the fields. Field 1 fills completely before field 2, and nothing can
 * straddle a field boundary. Overflow is re-placed in the band right of the last field.
 */
import type { PanelGridModuleRef, PanelGridSlot } from '@/types/schema'
import {
  getPanelGridFieldLayout,
  getPanelGridTotalColumns,
  panelGridFieldStartModules,
  type PanelGridFieldSource,
} from '@/lib/panel/panelGridFields'
import {
  PANEL_GRID_OVERFLOW_GAP_MODULES,
  panelGridUnitsToModules,
  panelModulesToGridUnits,
} from '@/lib/panel/panelGridUnits'

export function packSlotsInFields(
  grid: PanelGridFieldSource,
  rows: number,
  feedFromTop: boolean,
  widthOf: (ref: PanelGridModuleRef) => number,
  pack: (virtualRows: number, columns: number) => PanelGridSlot[]
): PanelGridSlot[] {
  const layout = getPanelGridFieldLayout(grid)
  if (layout.fields < 2) return pack(rows, getPanelGridTotalColumns(grid))
  const virtualRows = rows * layout.fields
  const columnUnits = panelModulesToGridUnits(layout.columns)
  const placed: PanelGridSlot[] = []
  const overflow: PanelGridSlot[] = []
  for (const slot of pack(virtualRows, layout.columns)) {
    const col = panelModulesToGridUnits(slot.col)
    const width = Math.max(1, panelModulesToGridUnits(widthOf(slot.module)))
    if (slot.row < 0 || slot.row >= virtualRows || col < 0 || col + width > columnUnits) {
      overflow.push(slot)
      continue
    }
    // Feed from the bottom packs from the last virtual row, which is the first field's bottom.
    const block = Math.floor(slot.row / rows)
    const field = feedFromTop ? block : layout.fields - 1 - block
    placed.push({
      ...slot,
      row: slot.row % rows,
      col: panelGridUnitsToModules(
        col + panelModulesToGridUnits(panelGridFieldStartModules(layout, field))
      ),
    })
  }
  const cursors = Array.from({ length: Math.max(1, rows) }, () =>
    panelModulesToGridUnits(
      getPanelGridTotalColumns(grid) + PANEL_GRID_OVERFLOW_GAP_MODULES
    )
  )
  for (const slot of overflow) {
    const width = Math.max(1, panelModulesToGridUnits(widthOf(slot.module)))
    const row = cursors.indexOf(Math.min(...cursors))
    placed.push({ ...slot, row, col: panelGridUnitsToModules(cursors[row]!) })
    cursors[row]! += width
  }
  return placed
}
