/**
 * Pack panel grid modules left-to-right, top-to-bottom within a fixed row/column budget.
 * Does not expand the user's row count; overflow goes to the same overflow column band as manual layout.
 */
import type { PanelGridModuleRef, PanelGridSlot } from '@/types/schema'
import { panelGridFieldRangesUnits, type PanelGridFieldLayout } from '@/lib/panel/panelGridFields'
import {
  PANEL_GRID_OVERFLOW_GAP_MODULES,
  PANEL_GRID_UNITS_PER_MODULE,
  panelGridUnitsToModules,
  panelModulesToGridUnits,
} from '@/lib/panel/panelGridUnits'

function mapLogicalRowToStored(
  logicalRow: number,
  panelRows: number,
  feedFromTop: boolean
): number {
  return feedFromTop ? logicalRow : panelRows - 1 - logicalRow
}

export interface PackedSupplyItem<T> {
  item: T
  row: number
  col: number
  width: number
}

export interface AutoArrangeGroup<T> {
  rows: T[][]
  standalone?: boolean
  align?: 'left' | 'right'
}

function packAnchoredSegmentsIntoUnitRows<T>(
  anchorItems: T[],
  segments: T[][],
  panelCols: number,
  getWidth: (item: T) => number,
  side: 'left' | 'right' = 'left'
): T[][] {
  const cols = Math.max(1, panelCols)
  const rows: T[][] = []
  const anchorWidth = groupRowWidth(anchorItems, getWidth)
  const orderedSegments = [...segments]

  const flushRow = (rowSegments: T[][], includeAnchor: boolean) => {
    const rowItems = rowSegments.flat()
    if (includeAnchor) {
      rows.push(side === 'left' ? [...anchorItems, ...rowItems] : [...rowItems, ...anchorItems])
      return
    }
    if (rowItems.length > 0) rows.push(rowItems)
  }

  let currentSegments: T[][] = []
  let currentWidth = 0
  let includeAnchor = anchorItems.length > 0
  let availableWidth = includeAnchor ? cols - anchorWidth : cols

  if (includeAnchor && anchorWidth > cols) {
    rows.push([...anchorItems])
    includeAnchor = false
    availableWidth = cols
  }

  for (const segment of orderedSegments) {
    const segmentWidth = groupRowWidth(segment, getWidth)
    if (segmentWidth > cols) {
      flushRow(currentSegments, includeAnchor)
      currentSegments = []
      currentWidth = 0
      includeAnchor = false
      availableWidth = cols
      rows.push([...segment])
      continue
    }
    if (currentWidth + segmentWidth > availableWidth && currentSegments.length > 0) {
      flushRow(currentSegments, includeAnchor)
      currentSegments = []
      currentWidth = 0
      includeAnchor = false
      availableWidth = cols
    }
    currentSegments.push(segment)
    currentWidth += segmentWidth
  }

  if (currentSegments.length > 0 || (includeAnchor && rows.length === 0)) {
    flushRow(currentSegments, includeAnchor)
  }

  return rows
}

export function packAnchoredSegmentsIntoRows<T>(
  anchorItems: T[],
  segments: T[][],
  panelCols: number,
  getWidth: (item: T) => number,
  side: 'left' | 'right' = 'left'
): T[][] {
  return packAnchoredSegmentsIntoUnitRows(
    anchorItems,
    segments,
    panelModulesToGridUnits(panelCols),
    (item) => panelModulesToGridUnits(getWidth(item)),
    side
  )
}

function packAutoArrangeSupplyUnitSlots<T>(
  orderedItems: T[],
  panelRows: number,
  panelCols: number,
  getWidth: (item: T) => number
): { placed: Array<PackedSupplyItem<T>>; overflow: T[] } {
  const rows = Math.max(1, panelRows)
  const cols = Math.max(1, panelCols)
  const placed: Array<PackedSupplyItem<T>> = []
  const overflow: T[] = []
  let row = 0
  let col = 0

  for (const item of orderedItems) {
    const width = Math.max(1, getWidth(item))
    if (width > cols) {
      overflow.push(item)
      continue
    }
    if (col + width > cols) {
      row += 1
      col = 0
    }
    if (row >= rows) {
      overflow.push(item)
      continue
    }
    placed.push({ item, row, col, width })
    col += width
  }

  return { placed, overflow }
}

export function packAutoArrangeSupplySlots<T>(
  orderedItems: T[],
  panelRows: number,
  panelCols: number,
  getWidth: (item: T) => number
): { placed: Array<PackedSupplyItem<T>>; overflow: T[] } {
  const result = packAutoArrangeSupplyUnitSlots(
    orderedItems,
    panelRows,
    panelModulesToGridUnits(panelCols),
    (item) => panelModulesToGridUnits(getWidth(item))
  )
  return {
    ...result,
    placed: result.placed.map((item) => ({
      ...item,
      col: panelGridUnitsToModules(item.col),
      width: panelGridUnitsToModules(item.width),
    })),
  }
}

function packOverflowSlots(
  items: Array<{ ref: PanelGridModuleRef; w: number }>,
  panelRows: number,
  panelCols: number,
  feedFromTop: boolean
): PanelGridSlot[] {
  if (items.length === 0) return []
  const overflowStart = panelCols + PANEL_GRID_OVERFLOW_GAP_MODULES * PANEL_GRID_UNITS_PER_MODULE
  const used = new Set<string>()
  const cellKey = (r: number, c: number) => `${r},${c}`
  const isFree = (r: number, c: number, w: number) => {
    for (let i = 0; i < w; i++) if (used.has(cellKey(r, c + i))) return false
    return true
  }
  const mark = (r: number, c: number, w: number) => {
    for (let i = 0; i < w; i++) used.add(cellKey(r, c + i))
  }
  const out: PanelGridSlot[] = []
  for (const { ref, w } of items) {
    let placed = false
    for (let logR = 0; logR < panelRows && !placed; logR++) {
      const r = mapLogicalRowToStored(logR, panelRows, feedFromTop)
      const cMax = overflowStart + panelCols - w
      for (let c = overflowStart; c <= cMax; c++) {
        if (isFree(r, c, w)) {
          out.push({ row: r, col: c, module: ref })
          mark(r, c, w)
          placed = true
          break
        }
      }
    }
    if (!placed) {
      const r = mapLogicalRowToStored(0, panelRows, feedFromTop)
      let c = overflowStart
      while (!isFree(r, c, w)) c += 1
      out.push({ row: r, col: c, module: ref })
      mark(r, c, w)
    }
  }
  return out
}

function packAutoArrangeMainUnitSlots(
  orderedRefs: PanelGridModuleRef[],
  panelRows: number,
  panelCols: number,
  feedFromTop: boolean,
  getWidth: (ref: PanelGridModuleRef) => number,
  preferredSide: 'left' | 'right' = 'left'
): PanelGridSlot[] {
  const rows = Math.max(1, panelRows)
  const cols = Math.max(1, panelCols)
  const slots: PanelGridSlot[] = []
  const overflowQueue: Array<{ ref: PanelGridModuleRef; w: number }> = []

  let logRow = 0
  let col = preferredSide === 'left' ? 0 : cols

  for (const ref of orderedRefs) {
    const w = Math.max(1, getWidth(ref))
    if (w > cols) {
      overflowQueue.push({ ref, w })
      continue
    }
    for (;;) {
      if (logRow >= rows) {
        overflowQueue.push({ ref, w })
        break
      }
      if (preferredSide === 'left' && col + w <= cols) {
        slots.push({
          row: mapLogicalRowToStored(logRow, rows, feedFromTop),
          col,
          module: ref,
        })
        col += w
        break
      }
      if (preferredSide === 'right' && col - w >= 0) {
        slots.push({
          row: mapLogicalRowToStored(logRow, rows, feedFromTop),
          col: col - w,
          module: ref,
        })
        col -= w
        break
      }
      logRow += 1
      col = preferredSide === 'left' ? 0 : cols
    }
  }

  slots.push(...packOverflowSlots(overflowQueue, rows, cols, feedFromTop))
  return slots
}

export function packAutoArrangeMainSlots(
  orderedRefs: PanelGridModuleRef[],
  panelRows: number,
  panelCols: number,
  feedFromTop: boolean,
  getWidth: (ref: PanelGridModuleRef) => number,
  preferredSide: 'left' | 'right' = 'left'
): PanelGridSlot[] {
  return packAutoArrangeMainUnitSlots(
    orderedRefs,
    panelRows,
    panelModulesToGridUnits(panelCols),
    feedFromTop,
    (ref) => panelModulesToGridUnits(getWidth(ref)),
    preferredSide
  ).map((slot) => ({ ...slot, col: panelGridUnitsToModules(slot.col) }))
}

function groupRowWidth<T>(row: T[], getWidth: (item: T) => number): number {
  return row.reduce((sum, item) => sum + Math.max(1, getWidth(item)), 0)
}

function groupWidth<T>(group: AutoArrangeGroup<T>, getWidth: (item: T) => number): number {
  return group.rows.reduce((max, row) => Math.max(max, groupRowWidth(row, getWidth)), 0)
}

function flattenGroupItems<T>(group: AutoArrangeGroup<T>): T[] {
  return group.rows.flat()
}

function packGroupsIntoLocalUnitRows<T>(
  groups: AutoArrangeGroup<T>[],
  panelCols: number,
  getWidth: (item: T) => number,
  preferredSide: 'left' | 'right' = 'left'
): T[][] {
  const cols = Math.max(1, panelCols)
  const placements: Array<{
    group: AutoArrangeGroup<T>
    x: number
    y: number
    width: number
    height: number
  }> = []
  const used = new Set<string>()
  const cellKey = (r: number, c: number) => `${r},${c}`
  const isRectFree = (y: number, x: number, width: number, height: number) => {
    for (let row = y; row < y + height; row++) {
      for (let col = x; col < x + width; col++) {
        if (used.has(cellKey(row, col))) return false
      }
    }
    return true
  }
  const markRect = (y: number, x: number, width: number, height: number) => {
    for (let row = y; row < y + height; row++) {
      for (let col = x; col < x + width; col++) {
        used.add(cellKey(row, col))
      }
    }
  }

  let totalRows = 0
  for (const group of groups) {
    const width = groupWidth(group, getWidth)
    const height = Math.max(1, group.rows.length)
    const reservedWidth = group.standalone ? cols : width
    if (width > cols) {
      placements.push({ group, x: 0, y: totalRows, width, height })
      totalRows += height
      continue
    }
    let placed = false
    for (let y = 0; y <= totalRows && !placed; y++) {
      if (group.standalone) {
        if (isRectFree(y, 0, reservedWidth, height)) {
          markRect(y, 0, reservedWidth, height)
          placements.push({ group, x: 0, y, width, height })
          totalRows = Math.max(totalRows, y + height)
          placed = true
        }
        continue
      }
      if (preferredSide === 'right') {
        for (let x = cols - width; x >= 0; x--) {
          if (!isRectFree(y, x, reservedWidth, height)) continue
          markRect(y, x, reservedWidth, height)
          placements.push({ group, x, y, width, height })
          totalRows = Math.max(totalRows, y + height)
          placed = true
          break
        }
      } else {
        for (let x = 0; x <= cols - width; x++) {
          if (!isRectFree(y, x, reservedWidth, height)) continue
          markRect(y, x, reservedWidth, height)
          placements.push({ group, x, y, width, height })
          totalRows = Math.max(totalRows, y + height)
          placed = true
          break
        }
      }
    }
    if (!placed) {
      markRect(totalRows, 0, reservedWidth, height)
      placements.push({ group, x: 0, y: totalRows, width, height })
      totalRows += height
    }
  }

  const rows: Array<Array<{ x: number; items: T[] }>> = Array.from({ length: totalRows }, () => [])
  for (const placement of placements) {
    for (let rowIndex = 0; rowIndex < placement.group.rows.length; rowIndex++) {
      const row = placement.group.rows[rowIndex] ?? []
      rows[placement.y + rowIndex]?.push({ x: placement.x, items: row })
    }
  }

  return rows.map((segments) =>
    segments
      .sort((a, b) => (preferredSide === 'right' ? b.x - a.x : a.x - b.x))
      .flatMap((segment) => segment.items)
  )
}

export function packGroupsIntoLocalRows<T>(
  groups: AutoArrangeGroup<T>[],
  panelCols: number,
  getWidth: (item: T) => number,
  preferredSide: 'left' | 'right' = 'left'
): T[][] {
  return packGroupsIntoLocalUnitRows(
    groups,
    panelModulesToGridUnits(panelCols),
    (item) => panelModulesToGridUnits(getWidth(item)),
    preferredSide
  )
}

function packAutoArrangeMainGroupUnitSlots(
  groups: AutoArrangeGroup<PanelGridModuleRef>[],
  panelRows: number,
  panelCols: number,
  feedFromTop: boolean,
  getWidth: (ref: PanelGridModuleRef) => number,
  preferredSide: 'left' | 'right' = 'left'
): PanelGridSlot[] {
  const rows = Math.max(1, panelRows)
  const cols = Math.max(1, panelCols)
  const slots: PanelGridSlot[] = []
  const overflowQueue: Array<{ ref: PanelGridModuleRef; w: number }> = []
  const used = new Set<string>()
  const cellKey = (r: number, c: number) => `${r},${c}`
  const isRectFree = (r: number, c: number, width: number, height: number) => {
    for (let row = r; row < r + height; row++) {
      for (let col = c; col < c + width; col++) {
        if (used.has(cellKey(row, col))) return false
      }
    }
    return true
  }
  const markRect = (r: number, c: number, width: number, height: number) => {
    for (let row = r; row < r + height; row++) {
      for (let col = c; col < c + width; col++) {
        used.add(cellKey(row, col))
      }
    }
  }

  for (const group of groups) {
    const width = groupWidth(group, getWidth)
    const height = Math.max(1, group.rows.length)
    const reservedWidth = group.standalone ? cols : width
    const alignmentWidth = group.standalone ? cols : width
    if (width > cols || height > rows) {
      for (const ref of flattenGroupItems(group)) {
        overflowQueue.push({ ref, w: Math.max(1, getWidth(ref)) })
      }
      continue
    }

    let placed = false
    for (let logRow = 0; logRow <= rows - height && !placed; logRow++) {
      if (group.standalone) {
        const col = 0
        if (!isRectFree(logRow, col, reservedWidth, height)) continue
        markRect(logRow, col, reservedWidth, height)
        for (let rowOffset = 0; rowOffset < group.rows.length; rowOffset++) {
          const storedRow = mapLogicalRowToStored(logRow + rowOffset, rows, feedFromTop)
          const rowItems = group.rows[rowOffset] ?? []
          const rowWidth = groupRowWidth(rowItems, getWidth)
          let cursor = group.align === 'right' ? col + alignmentWidth - rowWidth : col
          for (const ref of rowItems) {
            slots.push({ row: storedRow, col: cursor, module: ref })
            cursor += Math.max(1, getWidth(ref))
          }
        }
        placed = true
        continue
      }
      if (preferredSide === 'right') {
        for (let col = cols - width; col >= 0; col--) {
          if (!isRectFree(logRow, col, reservedWidth, height)) continue
          markRect(logRow, col, reservedWidth, height)
          for (let rowOffset = 0; rowOffset < group.rows.length; rowOffset++) {
            const storedRow = mapLogicalRowToStored(logRow + rowOffset, rows, feedFromTop)
            const rowItems = group.rows[rowOffset] ?? []
            let cursor = col
            for (const ref of rowItems) {
              slots.push({ row: storedRow, col: cursor, module: ref })
              cursor += Math.max(1, getWidth(ref))
            }
          }
          placed = true
          break
        }
      } else {
        for (let col = 0; col <= cols - width; col++) {
          if (!isRectFree(logRow, col, reservedWidth, height)) continue
          markRect(logRow, col, reservedWidth, height)
          for (let rowOffset = 0; rowOffset < group.rows.length; rowOffset++) {
            const storedRow = mapLogicalRowToStored(logRow + rowOffset, rows, feedFromTop)
            const rowItems = group.rows[rowOffset] ?? []
            let cursor = col
            for (const ref of rowItems) {
              slots.push({ row: storedRow, col: cursor, module: ref })
              cursor += Math.max(1, getWidth(ref))
            }
          }
          placed = true
          break
        }
      }
    }

    if (!placed) {
      for (const ref of flattenGroupItems(group)) {
        overflowQueue.push({ ref, w: Math.max(1, getWidth(ref)) })
      }
    }
  }

  slots.push(...packOverflowSlots(overflowQueue, rows, cols, feedFromTop))
  return slots
}

export function packAutoArrangeMainGroupSlots(
  groups: AutoArrangeGroup<PanelGridModuleRef>[],
  panelRows: number,
  panelCols: number,
  feedFromTop: boolean,
  getWidth: (ref: PanelGridModuleRef) => number,
  preferredSide: 'left' | 'right' = 'left'
): PanelGridSlot[] {
  return packAutoArrangeMainGroupUnitSlots(
    groups,
    panelRows,
    panelModulesToGridUnits(panelCols),
    feedFromTop,
    (ref) => panelModulesToGridUnits(getWidth(ref)),
    preferredSide
  ).map((slot) => ({ ...slot, col: panelGridUnitsToModules(slot.col) }))
}

function findFirstFreeMainOrOverflowUnitSlot(
  occupied: Array<{ row: number; col: number; width: number }>,
  width: number,
  panelRows: number,
  panelCols: number,
  feedFromTop: boolean,
  fieldLayout?: PanelGridFieldLayout
): { row: number; col: number; isOverflow: boolean } {
  const rows = Math.max(1, panelRows)
  const cols = Math.max(1, panelCols)
  const w = Math.max(1, width)
  const used = new Set<string>()
  const cellKey = (r: number, c: number) => `${r},${c}`

  for (const slot of occupied) {
    for (let i = 0; i < slot.width; i++) {
      used.add(cellKey(slot.row, slot.col + i))
    }
  }

  const isFree = (r: number, c: number, slotWidth: number) => {
    for (let i = 0; i < slotWidth; i++) {
      if (used.has(cellKey(r, c + i))) return false
    }
    return true
  }

  const rowOrder = feedFromTop
    ? Array.from({ length: rows }, (_, i) => i)
    : Array.from({ length: rows }, (_, i) => rows - 1 - i)

  if (w <= cols) {
    // With several fields, fill one field at a time and never straddle a boundary.
    const ranges =
      fieldLayout && fieldLayout.fields > 1
        ? panelGridFieldRangesUnits(fieldLayout)
        : [{ start: 0, end: cols }]
    for (const range of ranges) {
      for (const row of rowOrder) {
        for (let col = range.start; col <= range.end - w; col++) {
          if (isFree(row, col, w)) return { row, col, isOverflow: false }
        }
      }
    }
  }

  const overflowStart = cols + PANEL_GRID_OVERFLOW_GAP_MODULES * PANEL_GRID_UNITS_PER_MODULE
  for (const row of rowOrder) {
    const colLimit = overflowStart + Math.max(cols, w) * 8
    for (let col = overflowStart; col <= colLimit; col++) {
      if (isFree(row, col, w)) return { row, col, isOverflow: true }
    }
  }

  return { row: rowOrder[0] ?? 0, col: overflowStart, isOverflow: true }
}

export function findFirstFreeMainOrOverflowSlot(
  occupied: Array<{ row: number; col: number; width: number }>,
  width: number,
  panelRows: number,
  panelCols: number,
  feedFromTop: boolean,
  fieldLayout?: PanelGridFieldLayout
): { row: number; col: number; isOverflow: boolean } {
  const result = findFirstFreeMainOrOverflowUnitSlot(
    occupied.map((slot) => ({
      ...slot,
      col: panelModulesToGridUnits(slot.col),
      width: panelModulesToGridUnits(slot.width),
    })),
    panelModulesToGridUnits(width),
    panelRows,
    panelModulesToGridUnits(panelCols),
    feedFromTop,
    fieldLayout
  )
  return { ...result, col: panelGridUnitsToModules(result.col) }
}
