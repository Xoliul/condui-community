/**
 * Repair legacy shared-supply slots using the historical default grid placement.
 * An explicit physical panel mounting takes precedence over that old convention.
 */
import type { Panel, PanelGridModuleRef } from '@/types/schema'
import {
  getSupplyPanelColumns,
  getSupplyPanelRows,
  panelGridModuleRefKey,
  resolveModuleWidthCols,
} from '@/components/canvas/panel/panelGridLayout'
import { findFirstFreeMainOrOverflowSlot } from '@/components/canvas/panel/autoArrangeLayout'
import { getAllSupplyTrunkDevices, getPanelFeedProjection } from '@/lib/feedTopology'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { DEFAULT_PANEL_GRID_COLUMNS, DEFAULT_PANEL_GRID_ROWS } from '@/lib/panel/panelGridDefaults'
import {
  MIN_PANEL_GRID_MODULE_WIDTH,
  panelGridUnitsToModules,
  panelModulesToGridUnits,
} from '@/lib/panel/panelGridUnits'

function visitPanels(panels: Panel[], fn: (p: Panel) => void): void {
  for (const p of panels) {
    fn(p)
    visitPanels(p.subPanels ?? [], fn)
  }
}

function isSharedSupplyRef(
  panel: Panel,
  project: ProjectWithOptionalV2Electrical,
  moduleRef: PanelGridModuleRef
): boolean {
  if (!panel.isMain || moduleRef.kind !== 'trunkDevice' || moduleRef.scope !== 'supply') {
    return false
  }
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return false
  const projection = getPanelFeedProjection(
    installation,
    getProjectElectricalPanels(project),
    panel
  )
  const key = panelGridModuleRefKey(moduleRef)
  return (projection?.sharedFeed.trunkDevices ?? []).some(
    (device) =>
      panelGridModuleRefKey({ kind: 'trunkDevice', id: device.id, scope: 'supply' }) === key
  )
}

/**
 * Move a physically panel-mounted supply device out of the shared-strip slots.
 *
 * `panelMounting` is the canonical physical surface. Older editor flows could leave the
 * device's old shared-strip slot behind after setting that field. The panel selector correctly
 * excludes that slot from the shared strip, so without this repair the device disappears.
 */
export function healPanelMountedSupplyTrunkSlotsForPanel(
  panel: Panel,
  project: ProjectWithOptionalV2Electrical,
  onlyDeviceId?: string
): boolean {
  const supplySlots = panel.gridView?.supplyPanelSlots ?? []
  if (supplySlots.length === 0) return false

  const mountedDeviceIds = new Set(
    getAllSupplyTrunkDevices(project)
      .filter(
        (device) =>
          device.panelMounting?.kind === 'panel' && device.panelMounting.panelId === panel.id
      )
      .filter((device) => onlyDeviceId == null || device.id === onlyDeviceId)
      .map((device) => device.id)
  )
  const staleSlots = supplySlots.filter(
    (slot) => slot.module.kind === 'trunkDevice' && mountedDeviceIds.has(slot.module.id)
  )
  if (staleSlots.length === 0) return false

  const grid = (panel.gridView ??= {
    rows: DEFAULT_PANEL_GRID_ROWS,
    columns: DEFAULT_PANEL_GRID_COLUMNS,
    feedFromTop: false,
    slots: [],
  })
  const mainSlots = grid.slots ?? (grid.slots = [])
  const staleKeys = new Set(staleSlots.map((slot) => panelGridModuleRefKey(slot.module)))
  const nextSupplySlots = supplySlots.filter(
    (slot) => !staleKeys.has(panelGridModuleRefKey(slot.module))
  )
  const occupied = mainSlots.map((slot) => ({
    row: slot.row,
    col: slot.col,
    width: Math.max(
      MIN_PANEL_GRID_MODULE_WIDTH,
      resolveModuleWidthCols(slot.module, project, slot)
    ),
  }))
  const rows = Math.max(1, grid.rows ?? DEFAULT_PANEL_GRID_ROWS)
  const cols = Math.max(1, grid.columns ?? DEFAULT_PANEL_GRID_COLUMNS)
  let changed = nextSupplySlots.length !== supplySlots.length

  for (const staleSlot of staleSlots) {
    const moduleKey = panelGridModuleRefKey(staleSlot.module)
    if (mainSlots.some((slot) => panelGridModuleRefKey(slot.module) === moduleKey)) continue

    const width = Math.max(
      MIN_PANEL_GRID_MODULE_WIDTH,
      Math.min(cols, resolveModuleWidthCols(staleSlot.module, project, staleSlot))
    )
    const spot = findFirstFreeMainOrOverflowSlot(
      occupied,
      width,
      rows,
      cols,
      grid.feedFromTop ?? false
    )
    mainSlots.push({
      row: spot.row,
      col: spot.col,
      ...(staleSlot.moduleWidthManual === true && staleSlot.moduleWidth != null
        ? { moduleWidth: staleSlot.moduleWidth, moduleWidthManual: true }
        : {}),
      module: staleSlot.module,
    })
    occupied.push({ row: spot.row, col: spot.col, width })
    changed = true
  }

  if (changed) {
    grid.supplyPanelSlots = nextSupplySlots.length > 0 ? nextSupplySlots : undefined
  }
  return changed
}

/** Run the panel-mounted supply-strip repair across the whole panel tree. */
export function healPanelMountedSupplyTrunkSlots(
  project: ProjectWithOptionalV2Electrical
): boolean {
  let changed = false
  visitPanels(getProjectElectricalPanels(project), (panel) => {
    if (healPanelMountedSupplyTrunkSlotsForPanel(panel, project)) changed = true
  })
  return changed
}

/**
 * Move one shared supply-scope trunk module from main grid slots into the supply strip if it still sits in `slots`.
 * Mirrors `ejectToSupplyPanel` placement rules. Returns true if state changed.
 */
export function ejectSupplyTrunkFromMainGridSlot(
  panel: Panel,
  project: ProjectWithOptionalV2Electrical,
  moduleRef: PanelGridModuleRef
): boolean {
  if (!panel.isMain || moduleRef.kind !== 'trunkDevice' || moduleRef.scope !== 'supply')
    return false
  if (!isSharedSupplyRef(panel, project, moduleRef)) return false
  if (!panel.gridView) {
    panel.gridView = {
      rows: DEFAULT_PANEL_GRID_ROWS,
      columns: DEFAULT_PANEL_GRID_COLUMNS,
      feedFromTop: false,
      slots: [],
    }
  }
  const key = panelGridModuleRefKey(moduleRef)
  const slots = panel.gridView.slots ?? []
  const removedSlot = slots.find((s) => panelGridModuleRefKey(s.module) === key)
  const newSlots = slots.filter((s) => panelGridModuleRefKey(s.module) !== key)
  if (!removedSlot || newSlots.length === slots.length) return false

  const supplySlots = [...(panel.gridView.supplyPanelSlots ?? [])]
  if (supplySlots.some((s) => panelGridModuleRefKey(s.module) === key)) {
    panel.gridView.slots = newSlots
    panel.gridView.supplyPanelSlots = supplySlots.length > 0 ? supplySlots : undefined
    return true
  }

  const rows = getSupplyPanelRows(panel)
  const cols = getSupplyPanelColumns(panel)
  const width = Math.max(
    MIN_PANEL_GRID_MODULE_WIDTH,
    Math.min(cols, resolveModuleWidthCols(moduleRef, project, removedSlot))
  )
  const colUnits = panelModulesToGridUnits(cols)
  const widthUnits = panelModulesToGridUnits(width)
  let nextSpot: { row: number; col: number } | null = null
  for (let r = 0; r < rows && !nextSpot; r++) {
    for (let c = 0; c <= colUnits - widthUnits && !nextSpot; c++) {
      const collides = supplySlots.some((slot) => {
        if (slot.row !== r) return false
        const slotWidth = Math.max(
          MIN_PANEL_GRID_MODULE_WIDTH,
          Math.min(cols, resolveModuleWidthCols(slot.module, project, slot))
        )
        const slotColUnits = panelModulesToGridUnits(slot.col)
        const slotWidthUnits = panelModulesToGridUnits(slotWidth)
        return c < slotColUnits + slotWidthUnits && slotColUnits < c + widthUnits
      })
      if (!collides) nextSpot = { row: r, col: panelGridUnitsToModules(c) }
    }
  }
  if (!nextSpot) {
    return false
  }

  panel.gridView.slots = newSlots
  panel.gridView.supplyPanelSlots = [
    ...supplySlots,
    {
      row: nextSpot.row,
      col: nextSpot.col,
      ...(removedSlot.moduleWidthManual === true && removedSlot.moduleWidth != null
        ? { moduleWidth: removedSlot.moduleWidth, moduleWidthManual: true }
        : {}),
      module: moduleRef,
    },
  ]
  panel.gridView.supplyPanelVisible = true
  return true
}

/** Repair legacy shared-supply slots without relocating explicitly panel-mounted devices. */
export function healSupplyTrunkMisplacedOnMainGridForPanel(
  panel: Panel,
  project: ProjectWithOptionalV2Electrical
): boolean {
  if (!panel.isMain || !panel.gridView?.slots?.length) return false
  let changed = false
  const explicitlyMountedDevices = new Set(
    getAllSupplyTrunkDevices(project)
      .filter(
        (device) =>
          device.panelMounting?.kind === 'panel' && device.panelMounting.panelId === panel.id
      )
      .map((device) => device.id)
  )
  const misplaced = panel.gridView.slots.filter(
    (s) =>
      s.module.kind === 'trunkDevice' &&
      s.module.scope === 'supply' &&
      !explicitlyMountedDevices.has(s.module.id) &&
      isSharedSupplyRef(panel, project, s.module)
  )
  for (const slot of misplaced) {
    if (slot.module.kind !== 'trunkDevice' || slot.module.scope !== 'supply') continue
    const ref: PanelGridModuleRef = { kind: 'trunkDevice', id: slot.module.id, scope: 'supply' }
    if (ejectSupplyTrunkFromMainGridSlot(panel, project, ref)) changed = true
  }
  return changed
}

/** Run {@link healSupplyTrunkMisplacedOnMainGridForPanel} on every panel tree node. */
export function healSupplyTrunkMisplacedOnMainGrid(
  project: ProjectWithOptionalV2Electrical
): boolean {
  let changed = false
  visitPanels(getProjectElectricalPanels(project), (panel) => {
    if (healSupplyTrunkMisplacedOnMainGridForPanel(panel, project)) changed = true
  })
  return changed
}
