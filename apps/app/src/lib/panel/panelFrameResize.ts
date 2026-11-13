/**
 * Frame-edge resize of a board. Rows are shared by all fields and every field keeps the same
 * columns, so dragging the width changes every field at once: the frame width moves in steps
 * of `fields` modules (one column per field) and the drag snaps to those steps.
 */
import { CELL_W, ROW_STRIDE } from '@/lib/panel/panelGridLayout'
import {
  getPanelGridFieldLayout,
  getPanelGridTotalColumns,
  type PanelGridFieldSource,
} from '@/lib/panel/panelGridFields'

export interface PanelFrameResizeSnap {
  rows: number
  /** Columns per field after the drag. */
  columns: number
  /** Content width in pixels (all fields and gaps) after the drag. */
  contentWidth: number
}

export function snapPanelFrameResize(
  grid: (PanelGridFieldSource & { rows?: number }) | undefined,
  axis: 'rows' | 'columns',
  deltaPx: number,
  fallback: { rows: number; columns: number }
): PanelFrameResizeSnap {
  const layout = getPanelGridFieldLayout(grid ? { ...grid } : { columns: fallback.columns })
  const rows = grid?.rows ?? fallback.rows
  const nextRows = axis === 'rows' ? Math.max(1, rows + Math.round(deltaPx / ROW_STRIDE)) : rows
  const nextColumns =
    axis === 'columns'
      ? Math.max(1, Math.round(layout.columns + deltaPx / CELL_W / layout.fields))
      : layout.columns
  return {
    rows: nextRows,
    columns: nextColumns,
    contentWidth:
      getPanelGridTotalColumns({ columns: nextColumns, fields: layout.fields }) * CELL_W,
  }
}
