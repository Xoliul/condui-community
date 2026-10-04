/**
 * Compute (x, y, width, height) in canvas coordinates for each module in panel grid view.
 */
import type { Panel, PanelGridConfig, PanelGridModuleRef, PanelGridSlot } from '@/types/schema'
import { panelGridModuleRefKey } from '@/lib/panel/panelGridModuleRef'
export { panelGridModuleRefKey } from '@/lib/panel/panelGridModuleRef'
import {
  getModuleWidthInCols,
  isTerminalStripModuleRef,
  moduleWidthFollowsDevice,
} from '@/lib/panel/panelGridModuleWidth'
export { getModuleWidthInCols } from '@/lib/panel/panelGridModuleWidth'
import { clamp } from '@/lib/geometry'
import { DEFAULT_PANEL_GRID_COLUMNS, DEFAULT_PANEL_GRID_ROWS } from '@/lib/panel/panelGridDefaults'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import {
  MIN_PANEL_GRID_MODULE_WIDTH,
  PANEL_GRID_OVERFLOW_GAP_MODULES,
  PANEL_GRID_UNITS_PER_MODULE,
  panelGridUnitsToModules,
  panelModulesToGridUnits,
} from '@/lib/panel/panelGridUnits'

export const CELL_W = 20 // Width of a single module slot
export const GRID_UNIT_W = CELL_W / PANEL_GRID_UNITS_PER_MODULE
export const CELL_H = 80 // Height of a row / module body
export const ROW_GAP = 16 // Vertical gap between rows
export const ROW_STRIDE = CELL_H + ROW_GAP // Total vertical step per row
export const TERMINAL_STRIP_RAIL_H = CELL_H / 3

export function getTerminalStripTopOffset(panel: Panel | null | undefined): number {
  return panel?.gridView?.terminalStripTopRail ? TERMINAL_STRIP_RAIL_H + ROW_GAP : 0
}

export function getTerminalStripBottomExtent(panel: Panel | null | undefined): number {
  return panel?.gridView?.terminalStripBottomRail ? TERMINAL_STRIP_RAIL_H + ROW_GAP : 0
}

/** Horizontal routing corridors around regular rows and optional compact terminal rows. */
export function getPanelMainHorizontalRoutingLanes(
  panel: Panel | null | undefined,
  mainContentTop: number,
  rows: number
): number[] {
  const rowCount = Math.max(1, rows)
  const mainContentBottom = mainContentTop + rowCount * CELL_H + (rowCount - 1) * ROW_GAP
  const lanes = Array.from({ length: rowCount + 1 }, (_, gapIndex) => {
    if (gapIndex === 0) return mainContentTop - ROW_GAP
    if (gapIndex === rowCount) return mainContentBottom + ROW_GAP
    return mainContentTop + gapIndex * ROW_STRIDE - ROW_GAP / 2
  })

  if (panel?.gridView?.terminalStripTopRail) {
    lanes[0] = mainContentTop - getTerminalStripTopOffset(panel) - ROW_GAP
    lanes.push(mainContentTop - ROW_GAP / 2)
  }
  if (panel?.gridView?.terminalStripBottomRail) {
    lanes[rowCount] = mainContentBottom + getTerminalStripBottomExtent(panel) + ROW_GAP
    lanes.push(mainContentBottom + ROW_GAP / 2)
  }
  return [...new Set(lanes)].sort((a, b) => a - b)
}

export function getSupplyPanelRows(panel: Panel | null | undefined): number {
  return Math.max(1, panel?.gridView?.supplyPanelRows ?? 1)
}

export function getSupplyPanelColumns(panel: Panel | null | undefined): number {
  return Math.max(
    1,
    panel?.gridView?.supplyPanelColumns ?? panel?.gridView?.columns ?? DEFAULT_PANEL_GRID_COLUMNS
  )
}

/** Snap a pixel position to the nearest row/col. Boundary falls in middle of the gap. */
export function snapToGrid(px: number, py: number): { col: number; row: number } {
  return {
    col: Math.round(px / CELL_W),
    row: Math.floor((py + ROW_GAP / 2) / ROW_STRIDE),
  }
}

/**
 * Terminal strips move on the internal twelfth-module grid. Normal dragging attracts
 * their edges to module boundaries and neighbouring modules; Shift keeps the raw
 * twelfth position so a user can deliberately override that attraction.
 */
export function snapTerminalStripPlacementCol(
  rawPixelX: number,
  widthCols: number,
  maxCol: number,
  row: number,
  placements: ModulePlacement[],
  forceTwelfths = false,
  terminalStripRail?: 'top' | 'bottom'
): number {
  const rawUnits = Math.round(rawPixelX / GRID_UNIT_W)
  const widthUnits = Math.max(1, panelModulesToGridUnits(widthCols))
  const maxUnits = Math.max(0, panelModulesToGridUnits(maxCol))
  const clampedRaw = clamp(rawUnits, 0, maxUnits)
  if (forceTwelfths) return panelGridUnitsToModules(clampedRaw)

  const neighbours = placements.filter(
    (placement) => placement.row === row && placement.terminalStripRail === terminalStripRail
  )
  const overlappingEdges: number[] = []
  for (const neighbour of neighbours) {
    const start = panelModulesToGridUnits(neighbour.col)
    const end = start + panelModulesToGridUnits(neighbour.width / CELL_W)
    if (clampedRaw < end && start < clampedRaw + widthUnits) {
      overlappingEdges.push(start - widthUnits, end)
    }
  }
  const valid = (units: number) => units >= 0 && units <= maxUnits
  const nearest = (candidates: number[]) =>
    candidates.filter(valid).sort((a, b) => Math.abs(a - clampedRaw) - Math.abs(b - clampedRaw))[0]

  // Contact with another module is magnetic: dock immediately to its nearest edge.
  const overlapSnap = nearest(overlappingEdges)
  if (overlapSnap != null) return panelGridUnitsToModules(overlapSnap)

  const attractionUnits = 2
  const wholeModule =
    Math.round(clampedRaw / PANEL_GRID_UNITS_PER_MODULE) * PANEL_GRID_UNITS_PER_MODULE
  if (valid(wholeModule) && Math.abs(wholeModule - clampedRaw) <= attractionUnits) {
    return panelGridUnitsToModules(wholeModule)
  }

  const adjacentEdges = neighbours.flatMap((neighbour) => {
    const start = panelModulesToGridUnits(neighbour.col)
    const end = start + panelModulesToGridUnits(neighbour.width / CELL_W)
    return [start - widthUnits, end]
  })
  const edgeSnap = nearest(adjacentEdges)
  if (edgeSnap != null && Math.abs(edgeSnap - clampedRaw) <= attractionUnits) {
    return panelGridUnitsToModules(edgeSnap)
  }
  return panelGridUnitsToModules(clampedRaw)
}

/** True when this protection module sits in the supply panel strip (not the main grid). */
export function isProtectionOnSupplyPanel(
  panel: Panel | null | undefined,
  protectionId: string
): boolean {
  if (!panel?.gridView) return false
  const key = panelGridModuleRefKey({ kind: 'protection', id: protectionId })
  return (
    panel.gridView.supplyPanelSlots?.some((s) => panelGridModuleRefKey(s.module) === key) ?? false
  )
}

/** Effective grid width: manual slot width when flagged, else pole-based columns. */
export function resolveModuleWidthCols(
  ref: PanelGridModuleRef,
  project: ProjectWithOptionalV2Electrical | null,
  slot?: { moduleWidth?: number; moduleWidthManual?: boolean }
): number {
  const poleBased = getModuleWidthInCols(ref, project)
  if (moduleWidthFollowsDevice(ref, project)) return poleBased
  if (slot?.moduleWidthManual === true) {
    return Math.max(MIN_PANEL_GRID_MODULE_WIDTH, slot.moduleWidth ?? poleBased)
  }
  return poleBased
}

export interface ModulePlacement {
  ref: PanelGridModuleRef
  /** Logical one-wire occurrences represented by this single physical panel module. */
  terminalStripMemberRefs?: PanelGridModuleRef[]
  /** Derived terminal block inside a shared junction-panel enclosure. */
  junctionPanelTerminal?: {
    panelId: string
    terminalId: string
    label: string
    pinCount: number
    feedFromTop: boolean
  }
  x: number
  y: number
  width: number
  height: number
  row: number
  col: number
  terminalStripRail?: 'top' | 'bottom'
  isOverflow?: boolean
}

export function canResizeModulePlacement(
  placement: ModulePlacement & { inSupplyPanel?: boolean },
  placements: Array<ModulePlacement & { inSupplyPanel?: boolean }>,
  newWidthCols: number,
  totalCols: number
): boolean {
  const widthUnits = Math.max(1, panelModulesToGridUnits(newWidthCols))
  const placementColUnits = panelModulesToGridUnits(placement.col)
  const totalUnits = panelModulesToGridUnits(totalCols)
  if (placementColUnits < 0 || placementColUnits + widthUnits > totalUnits) return false
  const key = panelGridModuleRefKey(placement.ref)
  return !placements.some((other) => {
    if (panelGridModuleRefKey(other.ref) === key) return false
    if (other.inSupplyPanel !== placement.inSupplyPanel) return false
    const verticallyOverlaps =
      placement.y < other.y + other.height && other.y < placement.y + placement.height
    if (!verticallyOverlaps) return false
    const otherWidthUnits = Math.max(1, panelModulesToGridUnits(other.width / CELL_W))
    const otherColUnits = panelModulesToGridUnits(other.col)
    return (
      placementColUnits < otherColUnits + otherWidthUnits &&
      otherColUnits < placementColUnits + widthUnits
    )
  })
}

export function getPanelGridPlacements(
  panel: Panel,
  project: ProjectWithOptionalV2Electrical | null,
  modules: Array<{
    ref: PanelGridModuleRef
    terminalStripMemberRefs?: PanelGridModuleRef[]
    slot?: Pick<
      PanelGridSlot,
      'row' | 'col' | 'moduleWidth' | 'moduleWidthManual' | 'terminalStripRail'
    >
  }>
): ModulePlacement[] {
  const config: PanelGridConfig = panel.gridView ?? {
    rows: DEFAULT_PANEL_GRID_ROWS,
    columns: DEFAULT_PANEL_GRID_COLUMNS,
    feedFromTop: false,
    slots: [],
  }
  const rows = config.rows
  const cols = config.columns
  const colUnits = panelModulesToGridUnits(cols)
  const feedFromTop = config.feedFromTop
  const topRailOffset = getTerminalStripTopOffset(panel)
  const mainContentHeight = rows * CELL_H + Math.max(0, rows - 1) * ROW_GAP

  const placements: ModulePlacement[] = []
  const gridUsed = new Map<string, boolean>()
  const cellKey = (area: string, r: number, c: number) => `${area}:${r},${c}`
  const mark = (area: string, r: number, c: number, w: number) => {
    for (let i = 0; i < w; i++) gridUsed.set(cellKey(area, r, c + i), true)
  }
  const isRowColFree = (area: string, r: number, c: number, w: number) => {
    for (let i = 0; i < w; i++) if (gridUsed.get(cellKey(area, r, c + i))) return false
    return true
  }

  const place = (
    ref: PanelGridModuleRef,
    terminalStripMemberRefs: PanelGridModuleRef[] | undefined,
    row: number,
    col: number,
    w: number,
    isOverflow = false,
    terminalStripRail?: 'top' | 'bottom'
  ) => {
    const area = terminalStripRail ?? 'main'
    mark(area, row, col, w)
    const railY =
      terminalStripRail === 'top'
        ? 0
        : terminalStripRail === 'bottom'
          ? topRailOffset + mainContentHeight + ROW_GAP
          : row * ROW_STRIDE + topRailOffset
    placements.push({
      ref,
      ...(terminalStripMemberRefs ? { terminalStripMemberRefs } : {}),
      x: col * GRID_UNIT_W,
      y: railY,
      width: w * GRID_UNIT_W,
      height: terminalStripRail ? TERMINAL_STRIP_RAIL_H : CELL_H,
      row,
      col: panelGridUnitsToModules(col),
      ...(terminalStripRail ? { terminalStripRail } : {}),
      ...(isOverflow ? { isOverflow: true } : {}),
    })
  }

  /** Find first free position on a given row starting from startCol. */
  const findOnRow = (row: number, startCol: number, w: number): number | null => {
    for (let c = startCol; c <= colUnits - w; c++) {
      if (isRowColFree('main', row, c, w)) return c
    }
    return null
  }
  const findOnRail = (rail: 'top' | 'bottom', w: number): number | null => {
    for (let c = 0; c <= colUnits - w; c++) {
      if (isRowColFree(rail, 0, c, w)) return c
    }
    return null
  }

  /** Find first available spot anywhere in the grid, searching outward from preferredRow. */
  const findAnySpot = (
    w: number,
    preferredRow?: number,
    skipRow?: number
  ): { row: number; col: number } | null => {
    if (preferredRow != null) {
      for (let d = 0; d < rows; d++) {
        for (const r of d === 0 ? [preferredRow] : [preferredRow + d, preferredRow - d]) {
          if (r >= 0 && r < rows && r !== skipRow) {
            const c = findOnRow(r, 0, w)
            if (c != null) return { row: r, col: c }
          }
        }
      }
      return null
    }
    const startRow = feedFromTop ? 0 : rows - 1
    const step = feedFromTop ? 1 : -1
    for (let r = startRow; r >= 0 && r < rows; r += step) {
      const c = findOnRow(r, 0, w)
      if (c != null) return { row: r, col: c }
    }
    return null
  }

  const overflowStartCol = colUnits + PANEL_GRID_OVERFLOW_GAP_MODULES * PANEL_GRID_UNITS_PER_MODULE
  const placeOverflow = (
    ref: PanelGridModuleRef,
    terminalStripMemberRefs: PanelGridModuleRef[] | undefined,
    w: number
  ) => {
    for (let r = 0; r < rows; r++) {
      for (let c = overflowStartCol; c < overflowStartCol + colUnits; c++) {
        if (isRowColFree('main', r, c, w)) {
          place(ref, terminalStripMemberRefs, r, c, w, true)
          return
        }
      }
    }
    place(ref, terminalStripMemberRefs, 0, overflowStartCol, w, true)
  }

  const widthOf = (
    ref: PanelGridModuleRef,
    slot?: { moduleWidth?: number; moduleWidthManual?: boolean }
  ) => Math.max(1, panelModulesToGridUnits(resolveModuleWidthCols(ref, project, slot)))

  // Separate slotted vs unslotted modules
  interface SlottedModule {
    ref: PanelGridModuleRef
    terminalStripMemberRefs?: PanelGridModuleRef[]
    preferredRow: number
    preferredCol: number
    width: number
    isOverflow: boolean
  }
  const slotted: SlottedModule[] = []
  const unslotted: Array<{
    ref: PanelGridModuleRef
    terminalStripMemberRefs?: PanelGridModuleRef[]
    width: number
  }> = []

  for (const { ref, slot, terminalStripMemberRefs } of modules) {
    const w = widthOf(ref, slot)
    const requestedRail = slot?.terminalStripRail
    const railEnabled =
      requestedRail === 'top'
        ? config.terminalStripTopRail === true
        : requestedRail === 'bottom'
          ? config.terminalStripBottomRail === true
          : false
    const isTerminalStrip = isTerminalStripModuleRef(ref, project)
    if (requestedRail && railEnabled && isTerminalStrip) {
      const preferredCol = clamp(panelModulesToGridUnits(slot.col), 0, colUnits - w)
      // A persisted rail slot is manual layout too. Do not move it to the next
      // free position just because another module overlaps it.
      place(ref, terminalStripMemberRefs, 0, preferredCol, w, false, requestedRail)
      continue
    }
    if (slot == null && isTerminalStrip) {
      const preferredRails = [
        ...(config.terminalStripTopRail ? (['top'] as const) : []),
        ...(config.terminalStripBottomRail ? (['bottom'] as const) : []),
      ]
      const availableRail = preferredRails
        .map((rail) => ({ rail, col: findOnRail(rail, w) }))
        .find((candidate) => candidate.col != null)
      if (availableRail?.col != null) {
        place(ref, terminalStripMemberRefs, 0, availableRail.col, w, false, availableRail.rail)
        continue
      }
    }
    if (slot != null) {
      const requestedCol = panelModulesToGridUnits(slot.col)
      const isOverflow =
        slot.row < 0 || slot.row >= rows || requestedCol < 0 || requestedCol + w > colUnits
      slotted.push({
        ref,
        terminalStripMemberRefs,
        preferredRow: clamp(slot.row, 0, rows - 1),
        // Keep explicit overflow positions visible in the overflow band. For
        // an in-grid slot, the exact stored column is authoritative even when
        // it overlaps another manually positioned module.
        preferredCol: isOverflow ? requestedCol : clamp(requestedCol, 0, Math.max(0, colUnits - w)),
        width: w,
        isOverflow,
      })
    } else {
      unslotted.push({ ref, terminalStripMemberRefs, width: w })
    }
  }

  // Group slotted modules by preferred row, sorted by preferred col
  const rowGroups = new Map<number, SlottedModule[]>()
  for (const m of slotted) {
    if (!rowGroups.has(m.preferredRow)) rowGroups.set(m.preferredRow, [])
    rowGroups.get(m.preferredRow)!.push(m)
  }
  for (const group of rowGroups.values()) {
    group.sort((a, b) => a.preferredCol - b.preferredCol)
  }

  // Phase 1: Place slotted modules at their preferred column.
  // Manual placement is authoritative. Never displace an existing module to
  // resolve a collision; the user can see and correct the overlap themselves.
  for (let r = 0; r < rows; r++) {
    const group = rowGroups.get(r)
    if (!group) continue
    for (const m of group) {
      place(m.ref, m.terminalStripMemberRefs, r, m.preferredCol, m.width, m.isOverflow)
    }
  }

  // Phase 2: Auto-place unslotted modules (new modules without stored positions)
  for (const m of unslotted) {
    const spot = findAnySpot(m.width)
    if (spot) {
      place(m.ref, m.terminalStripMemberRefs, spot.row, spot.col, m.width)
    } else {
      placeOverflow(m.ref, m.terminalStripMemberRefs, m.width)
    }
  }

  return placements
}

/**
 * Find best (row, col) for a new module of widthCols next to a parent placement.
 * Prefer same row as parent, as close as possible; then closest row with space; null = no space (eject).
 */
export function getPlacementForNewChildNextToParent(
  placements: ModulePlacement[],
  parentPl: ModulePlacement,
  widthCols: number,
  rows: number,
  cols: number,
  feedFromTop: boolean
): { row: number; col: number } | null {
  const cellKey = (r: number, c: number) => `${r},${c}`
  const widthUnits = Math.max(1, panelModulesToGridUnits(widthCols))
  const colUnits = panelModulesToGridUnits(cols)
  const used = new Set<string>()
  for (const p of placements) {
    const w = Math.max(1, panelModulesToGridUnits(p.width / CELL_W))
    const start = panelModulesToGridUnits(p.col)
    for (let i = 0; i < w; i++) used.add(cellKey(p.row, start + i))
  }
  const isFree = (r: number, c: number, w: number) => {
    for (let i = 0; i < w; i++) if (used.has(cellKey(r, c + i))) return false
    return true
  }
  const findOnRow = (row: number, startCol: number): number | null => {
    for (let c = startCol; c <= colUnits - widthUnits; c++) {
      if (isFree(row, c, widthUnits)) return c
    }
    return null
  }
  const parentW = Math.max(1, panelModulesToGridUnits(parentPl.width / CELL_W))
  const parentCol = panelModulesToGridUnits(parentPl.col)
  // 1) Same row: try left of parent, then right of parent
  const tryColLeft = parentCol - widthUnits
  if (tryColLeft >= 0 && isFree(parentPl.row, tryColLeft, widthUnits))
    return { row: parentPl.row, col: panelGridUnitsToModules(tryColLeft) }
  const tryColRight = parentCol + parentW
  if (tryColRight + widthUnits <= colUnits && isFree(parentPl.row, tryColRight, widthUnits))
    return { row: parentPl.row, col: panelGridUnitsToModules(tryColRight) }
  const onSameRow = findOnRow(parentPl.row, 0)
  if (onSameRow != null) return { row: parentPl.row, col: panelGridUnitsToModules(onSameRow) }
  // 2) Closest row in feed order
  const rowOrder = feedFromTop
    ? Array.from({ length: rows }, (_, i) => i)
    : Array.from({ length: rows }, (_, i) => rows - 1 - i)
  for (const r of rowOrder) {
    const c = findOnRow(r, 0)
    if (c != null) return { row: r, col: panelGridUnitsToModules(c) }
  }
  return null
}

/** Placements for the supply panel only. */
export function getSupplyPanelPlacements(
  panel: Panel,
  project: ProjectWithOptionalV2Electrical | null,
  supplyModules: Array<{
    ref: PanelGridModuleRef
    slot?: { row: number; col: number; moduleWidth?: number; moduleWidthManual?: boolean }
  }>
): ModulePlacement[] {
  const rows = getSupplyPanelRows(panel)
  const cols = getSupplyPanelColumns(panel)
  const colUnits = panelModulesToGridUnits(cols)
  const placements: ModulePlacement[] = []
  const used = new Set<string>()
  const cellKey = (row: number, col: number) => `${row},${col}`
  const isFree = (row: number, col: number, width: number) => {
    for (let i = 0; i < width; i++) {
      if (used.has(cellKey(row, col + i))) return false
    }
    return true
  }
  const mark = (row: number, col: number, width: number) => {
    for (let i = 0; i < width; i++) used.add(cellKey(row, col + i))
  }
  const findSpot = (width: number, preferredRow?: number, preferredCol?: number) => {
    const tryRow = (row: number, startCol: number) => {
      for (let col = startCol; col <= colUnits - width; col++) {
        if (isFree(row, col, width)) return { row, col }
      }
      return null
    }
    if (preferredRow != null && preferredRow >= 0 && preferredRow < rows) {
      if (preferredCol != null) {
        const col = clamp(preferredCol, 0, colUnits - width)
        if (isFree(preferredRow, col, width)) return { row: preferredRow, col }
      }
      const sameRow = tryRow(preferredRow, 0)
      if (sameRow) return sameRow
    }
    for (let row = 0; row < rows; row++) {
      if (row === preferredRow) continue
      const spot = tryRow(row, 0)
      if (spot) return spot
    }
    return null
  }

  for (const { ref, slot } of supplyModules) {
    const w = Math.min(
      colUnits,
      Math.max(1, panelModulesToGridUnits(resolveModuleWidthCols(ref, project, slot)))
    )
    const spot =
      slot != null
        ? {
            // Stored supply positions are manual as well. Clamp malformed
            // legacy values, but never relocate a valid slot around a collision.
            row: clamp(slot.row, 0, rows - 1),
            col: clamp(panelModulesToGridUnits(slot.col), 0, colUnits - w),
          }
        : findSpot(w)
    if (!spot) continue
    mark(spot.row, spot.col, w)
    placements.push({
      ref,
      x: spot.col * GRID_UNIT_W,
      y: spot.row * ROW_STRIDE,
      width: w * GRID_UNIT_W,
      height: CELL_H,
      row: spot.row,
      col: panelGridUnitsToModules(spot.col),
    })
  }
  return placements
}
