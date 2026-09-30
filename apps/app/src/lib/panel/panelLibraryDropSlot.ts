import { panelGridUnitsToModules, panelModulesToGridUnits } from './panelGridUnits'

/** A module footprint on the main panel grid: grid row, DIN-module column and width (may be fractional). */
export interface PanelGridFootprint {
  row: number
  col: number
  widthCols: number
}

/**
 * Chooses where a library drop lands on a panel grid without covering existing modules.
 *
 * A free requested footprint is used as-is unless the pointer is on a module (`anchor`);
 * then, or when the requested cells are taken, the nearest free footprint wins: same row
 * first, directly right of the anchor before directly left, then rows by distance.
 * Returns null when the grid has no room for the module.
 */
export function findPanelLibraryDropSlot(options: {
  occupied: PanelGridFootprint[]
  rows: number
  cols: number
  widthCols: number
  requested: { row: number; col: number }
  anchor?: PanelGridFootprint | null
}): { row: number; col: number } | null {
  const { occupied, rows, requested, anchor } = options
  // Work in the grid's 1/12-module units so fractional module widths pack exactly.
  const cols = panelModulesToGridUnits(options.cols)
  const width = Math.max(1, panelModulesToGridUnits(options.widthCols))
  if (width > cols || rows <= 0) return null

  const used = new Set<string>()
  for (const item of occupied) {
    const start = panelModulesToGridUnits(item.col)
    const itemWidth = Math.max(1, panelModulesToGridUnits(item.widthCols))
    for (let i = 0; i < itemWidth; i++) used.add(`${item.row}:${start + i}`)
  }
  const isFree = (row: number, col: number) => {
    for (let i = 0; i < width; i++) {
      if (used.has(`${row}:${col + i}`)) return false
    }
    return true
  }

  const requestedCol = panelModulesToGridUnits(requested.col)
  if (!anchor && isFree(requested.row, requestedCol)) return requested

  const originRow = anchor?.row ?? requested.row
  const originCol = anchor ? panelModulesToGridUnits(anchor.col) : requestedCol
  const originEnd =
    originCol + (anchor ? Math.max(1, panelModulesToGridUnits(anchor.widthCols)) : width)
  let best: { row: number; col: number; score: number } | null = null
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col <= cols - width; col++) {
      if (!isFree(row, col)) continue
      let colCost: number
      if (col >= originEnd) colCost = (col - originEnd) * 2
      else if (col + width <= originCol) colCost = (originCol - (col + width)) * 2 + 1
      else colCost = Math.abs(col - originCol) * 2
      const score = Math.abs(row - originRow) * 1_000_000 + colCost
      if (!best || score < best.score) best = { row, col, score }
    }
  }
  return best ? { row: best.row, col: panelGridUnitsToModules(best.col) } : null
}
