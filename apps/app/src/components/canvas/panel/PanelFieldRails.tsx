import { Group, Line, Rect } from 'react-konva'
import { CELL_H, CELL_W, ROW_GAP } from '@/lib/panel/panelGridLayout'
import {
  getPanelGridFieldLayout,
  panelGridFieldStartModules,
  type PanelGridFieldSource,
} from '@/lib/panel/panelGridFields'

/** Inset of a field's outline around its rails (only drawn on multi-field boards). */
const FIELD_OUTLINE_INSET = 8

/**
 * Rails, module grid lines and optional compact terminal rails of one board, drawn per
 * field so several fields show as separate rail blocks with a gap between them.
 */
export function PanelFieldRails({
  idPrefix,
  grid,
  rows,
  margin,
  firstRowY,
  stroke,
  topRailY,
  bottomRailY,
  terminalRailHeight,
}: {
  idPrefix: string
  grid: PanelGridFieldSource
  rows: number
  margin: number
  /** Top of the first row, relative to the frame. */
  firstRowY: number
  stroke: string
  /** Frame-relative top of an enabled top terminal rail. */
  topRailY?: number
  /** Frame-relative top of an enabled bottom terminal rail. */
  bottomRailY?: number
  terminalRailHeight: number
}) {
  const layout = getPanelGridFieldLayout(grid)
  const fieldWidth = layout.columns * CELL_W
  const rowsHeight = rows * CELL_H + Math.max(0, rows - 1) * ROW_GAP
  return (
    <>
      {Array.from({ length: layout.fields }, (_, field) => {
        const x = margin + panelGridFieldStartModules(layout, field) * CELL_W
        const top = topRailY ?? firstRowY
        const bottom =
          bottomRailY != null ? bottomRailY + terminalRailHeight : firstRowY + rowsHeight
        return (
          <Group key={`${idPrefix}-field-${field}`}>
            {layout.fields > 1 && (
              <Rect
                x={x - FIELD_OUTLINE_INSET}
                y={top - FIELD_OUTLINE_INSET}
                width={fieldWidth + FIELD_OUTLINE_INSET * 2}
                height={bottom - top + FIELD_OUTLINE_INSET * 2}
                fillEnabled={false}
                stroke={stroke}
                opacity={0.35}
                strokeWidth={1.5}
                cornerRadius={3}
                listening={false}
              />
            )}
            {topRailY != null && (
              <Rect
                x={x}
                y={topRailY}
                width={fieldWidth}
                height={terminalRailHeight}
                fillEnabled={false}
                stroke={stroke}
                opacity={0.18}
                strokeWidth={1}
                listening={false}
              />
            )}
            {Array.from({ length: rows }, (_, row) => (
              <Rect
                key={`${idPrefix}-rail-${field}-${row}`}
                x={x}
                y={firstRowY + row * (CELL_H + ROW_GAP)}
                width={fieldWidth}
                height={CELL_H}
                fillEnabled={false}
                stroke={stroke}
                opacity={0.12}
                strokeWidth={1}
                listening={false}
              />
            ))}
            {Array.from({ length: rows }, (_, row) =>
              Array.from({ length: layout.columns + 1 }, (_, col) => (
                <Line
                  key={`${idPrefix}-grid-${field}-${row}-${col}`}
                  points={[
                    x + col * CELL_W,
                    firstRowY + row * (CELL_H + ROW_GAP),
                    x + col * CELL_W,
                    firstRowY + row * (CELL_H + ROW_GAP) + CELL_H,
                  ]}
                  stroke={stroke}
                  opacity={0.08}
                  strokeWidth={0.75}
                  listening={false}
                />
              ))
            )}
            {bottomRailY != null && (
              <Rect
                x={x}
                y={bottomRailY}
                width={fieldWidth}
                height={terminalRailHeight}
                fillEnabled={false}
                stroke={stroke}
                opacity={0.18}
                strokeWidth={1}
                listening={false}
              />
            )}
          </Group>
        )
      })}
    </>
  )
}
