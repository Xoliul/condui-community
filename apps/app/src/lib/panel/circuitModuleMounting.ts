import { panelGridModuleRefKey, resolveModuleWidthCols } from '@/lib/panel/panelGridLayout'
import { DEFAULT_PANEL_GRID_COLUMNS, DEFAULT_PANEL_GRID_ROWS } from '@/lib/panel/panelGridDefaults'
import { MIN_PANEL_GRID_MODULE_WIDTH } from '@/lib/panel/panelGridUnits'
import { findPanelById } from '@/lib/panel/panelTree'
import {
  circuitModuleRef,
  collectPanelIds,
  getOwnPanelCircuits,
  isCircuitModuleBehindJunctionPanel,
  listRemountableCircuitModules,
  resolveCircuitModuleEnclosure,
  type CircuitModuleMounting,
  type CircuitModuleOccurrence,
} from '@/lib/panel/circuitModuleMountingRules'
import {
  editProjectAuxiliaryElectricalEnclosures,
  getProjectElectricalPanels,
  selectProjectAuxiliaryElectricalEnclosures,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type {
  Panel,
  PanelGridConfig,
  PanelGridModuleRef,
  PanelGridSlot,
  Point2,
} from '@/types/schema'
import type { AuxiliaryElectricalEnclosure } from '@/types/supplyAssembly'

/** Same minimum as supply enclosures (`MIN_AUXILIARY_COLUMNS`), kept local to avoid a cycle. */
const MIN_ENCLOSURE_COLUMNS = 12
const DEFAULT_ENCLOSURE_COLUMNS = 18

export { circuitModuleRef }

export function findRemountableCircuitModule(
  project: ProjectWithOptionalV2Electrical,
  ref: PanelGridModuleRef
): CircuitModuleOccurrence | undefined {
  if (ref.kind === 'trunkDevice' && ref.scope !== 'circuit') return undefined
  const key = panelGridModuleRefKey(ref)
  return listRemountableCircuitModules(getProjectElectricalPanels(project)).find(
    (occurrence) => panelGridModuleRefKey(circuitModuleRef(occurrence)) === key
  )
}

export function isRemountableCircuitModuleRef(
  project: ProjectWithOptionalV2Electrical,
  ref: PanelGridModuleRef
): boolean {
  return findRemountableCircuitModule(project, ref) != null
}

function enclosureIds(project: ProjectWithOptionalV2Electrical): Set<string> {
  return new Set(selectProjectAuxiliaryElectricalEnclosures(project).map(({ id }) => id))
}

/** Where a circuit module physically hangs; its own panel unless mounted elsewhere. */
export function resolveCircuitModuleEnclosureInProject(
  project: ProjectWithOptionalV2Electrical,
  occurrence: CircuitModuleOccurrence
): CircuitModuleMounting {
  return resolveCircuitModuleEnclosure(occurrence.entity, occurrence.ownerPanel.id, {
    panelIds: collectPanelIds(getProjectElectricalPanels(project)),
    enclosureIds: enclosureIds(project),
  })
}

export function getCircuitModuleRefsInEnclosure(
  project: ProjectWithOptionalV2Electrical,
  enclosureId: string
): PanelGridModuleRef[] {
  return listRemountableCircuitModules(getProjectElectricalPanels(project))
    .filter((occurrence) => {
      const mounting = occurrence.entity.panelMounting
      return mounting?.kind === 'auxiliary' && mounting.enclosureId === enclosureId
    })
    .map(circuitModuleRef)
}

function visitPanels(panels: readonly Panel[], visit: (panel: Panel) => void): void {
  for (const panel of panels) {
    visit(panel)
    visitPanels(panel.subPanels ?? [], visit)
  }
}

function findSlotAnywhere(
  project: ProjectWithOptionalV2Electrical,
  key: string
): PanelGridSlot | undefined {
  let found: PanelGridSlot | undefined
  const match = (slot: PanelGridSlot) => panelGridModuleRefKey(slot.module) === key
  visitPanels(getProjectElectricalPanels(project), (panel) => {
    for (const circuit of getOwnPanelCircuits(panel))
      for (const device of circuit.trunkDevices ?? [])
        found ??= device.junctionPanelGridView?.slots.find(match)
  })
  visitPanels(getProjectElectricalPanels(project), (panel) => {
    found ??= panel.gridView?.slots?.find(match) ?? panel.gridView?.supplyPanelSlots?.find(match)
  })
  for (const enclosure of selectProjectAuxiliaryElectricalEnclosures(project))
    found ??= enclosure.gridView.slots.find(match)
  return found
}

/** Stored physical width used by both transfer validation and the transfer itself. */
export function getCircuitModuleSlot(
  project: ProjectWithOptionalV2Electrical,
  ref: PanelGridModuleRef
): PanelGridSlot | undefined {
  const key = panelGridModuleRefKey(ref)
  const mounting = findRemountableCircuitModule(project, ref)?.entity.panelMounting
  const grid =
    mounting?.kind === 'panel'
      ? findPanelById(getProjectElectricalPanels(project), mounting.panelId)?.gridView
      : mounting?.kind === 'auxiliary'
        ? selectProjectAuxiliaryElectricalEnclosures(project).find(
            (enclosure) => enclosure.id === mounting.enclosureId
          )?.gridView
        : undefined
  return (
    grid?.slots.find((slot) => panelGridModuleRefKey(slot.module) === key) ??
    findSlotAnywhere(project, key)
  )
}

function removeFromAllGrids(project: ProjectWithOptionalV2Electrical, key: string): void {
  const keep = (slot: PanelGridSlot) => panelGridModuleRefKey(slot.module) !== key
  visitPanels(getProjectElectricalPanels(project), (panel) => {
    for (const circuit of getOwnPanelCircuits(panel))
      for (const device of circuit.trunkDevices ?? [])
        if (device.junctionPanelGridView)
          device.junctionPanelGridView.slots = device.junctionPanelGridView.slots.filter(keep)
    if (!panel.gridView) return
    panel.gridView.slots = (panel.gridView.slots ?? []).filter(keep)
    if (panel.gridView.supplyPanelSlots)
      panel.gridView.supplyPanelSlots = panel.gridView.supplyPanelSlots.filter(keep)
  })
  for (const enclosure of selectProjectAuxiliaryElectricalEnclosures(project))
    enclosure.gridView.slots = enclosure.gridView.slots.filter(keep)
}

/** Return a circuit module to its circuit's default location before a board/field choice. */
export function releaseCircuitModuleMountingInProject(
  project: ProjectWithOptionalV2Electrical,
  ref: PanelGridModuleRef
): boolean {
  const occurrence = findRemountableCircuitModule(project, ref)
  if (!occurrence?.entity.panelMounting) return false
  removeFromAllGrids(project, panelGridModuleRefKey(ref))
  delete occurrence.entity.panelMounting
  return true
}

function showInGrid(grid: PanelGridConfig, key: string): void {
  if (grid.hiddenModuleKeys) {
    grid.hiddenModuleKeys = grid.hiddenModuleKeys.filter((candidate) => candidate !== key)
    if (grid.hiddenModuleKeys.length === 0) grid.hiddenModuleKeys = undefined
  }
  grid.shownModuleKeys = [...new Set([...(grid.shownModuleKeys ?? []), key])]
}

function manualWidthProps(slot: PanelGridSlot | undefined) {
  return slot?.moduleWidthManual === true && slot.moduleWidth != null
    ? { moduleWidth: slot.moduleWidth, moduleWidthManual: true as const }
    : {}
}

function setMounting(occurrence: CircuitModuleOccurrence, destination: CircuitModuleMounting) {
  // Behind a junction panel the default place is that junction panel, so a module placed on
  // its own board keeps the explicit mounting.
  if (
    destination.kind === 'panel' &&
    destination.panelId === occurrence.ownerPanel.id &&
    !isCircuitModuleBehindJunctionPanel(occurrence)
  ) {
    delete occurrence.entity.panelMounting
  } else {
    occurrence.entity.panelMounting = { ...destination }
  }
}

function destinationGrid(
  project: ProjectWithOptionalV2Electrical,
  destination: CircuitModuleMounting
): PanelGridConfig | undefined {
  if (destination.kind === 'auxiliary') {
    return selectProjectAuxiliaryElectricalEnclosures(project).find(
      (enclosure) => enclosure.id === destination.enclosureId
    )?.gridView
  }
  const panel = findPanelById(getProjectElectricalPanels(project), destination.panelId)
  if (!panel) return undefined
  panel.gridView ??= {
    rows: DEFAULT_PANEL_GRID_ROWS,
    columns: DEFAULT_PANEL_GRID_COLUMNS,
    feedFromTop: false,
    slots: [],
  }
  return panel.gridView
}

/**
 * Hang a relay, meter or domotica module in another panel or virtual enclosure at a grid
 * position. Dropping it back in its own panel clears the mounting. The circuit, its order
 * and its connections never change. Returns false when it already hangs there.
 */
export function moveCircuitModuleInProject(
  project: ProjectWithOptionalV2Electrical,
  ref: PanelGridModuleRef,
  destination: CircuitModuleMounting,
  position: { row: number; col: number }
): boolean {
  const occurrence = findRemountableCircuitModule(project, ref)
  if (!occurrence) return false
  const key = panelGridModuleRefKey(ref)
  const previous = getCircuitModuleSlot(project, ref)
  const current = resolveCircuitModuleEnclosureInProject(project, occurrence)
  const sameEnclosure =
    current.kind === destination.kind &&
    (current.kind === 'panel'
      ? current.panelId === (destination as { panelId: string }).panelId
      : current.enclosureId === (destination as { enclosureId: string }).enclosureId)
  const grid = destinationGrid(project, destination)
  if (!grid) return false
  const currentSlot = grid.slots.find((slot) => panelGridModuleRefKey(slot.module) === key)
  const defaultsToJunction =
    occurrence.entity.panelMounting == null && isCircuitModuleBehindJunctionPanel(occurrence)
  if (
    !defaultsToJunction &&
    sameEnclosure &&
    currentSlot?.row === position.row &&
    currentSlot.col === position.col
  )
    return false
  removeFromAllGrids(project, key)
  setMounting(occurrence, destination)
  showInGrid(grid, key)
  grid.slots.push({
    row: position.row,
    col: position.col,
    module: ref,
    ...manualWidthProps(previous),
  })
  return true
}

/** Packs modules left to right into a new enclosure grid, wrapping to a new row when full. */
function planEnclosureGrid(
  project: ProjectWithOptionalV2Electrical,
  refs: PanelGridModuleRef[]
): PanelGridConfig {
  const previous = refs.map((ref) => getCircuitModuleSlot(project, ref))
  const widths = refs.map((ref, index) =>
    Math.max(MIN_PANEL_GRID_MODULE_WIDTH, resolveModuleWidthCols(ref, project, previous[index]))
  )
  const columns = Math.max(
    MIN_ENCLOSURE_COLUMNS,
    Math.max(...widths),
    Math.min(
      DEFAULT_ENCLOSURE_COLUMNS,
      widths.reduce((sum, width) => sum + width, 0)
    )
  )
  const slots: PanelGridSlot[] = []
  let row = 0
  let col = 0
  refs.forEach((ref, index) => {
    const width = widths[index]!
    if (col > 0 && col + width > columns) {
      row += 1
      col = 0
    }
    slots.push({ row, col, module: ref, ...manualWidthProps(previous[index]) })
    col += width
  })
  return { rows: row + 1, columns, feedFromTop: true, slots }
}

/** A supply-less virtual enclosure holding the dragged relays, meters or domotica modules. */
export function createCircuitModuleEnclosureInProject(
  project: ProjectWithOptionalV2Electrical,
  options: {
    id: string
    refs: PanelGridModuleRef[]
    ownerPanelId: string
    position: Point2
    name?: string
  }
): AuxiliaryElectricalEnclosure | null {
  if (selectProjectAuxiliaryElectricalEnclosures(project).some(({ id }) => id === options.id))
    return null
  const keys = [...new Set(options.refs.map(panelGridModuleRefKey))]
  if (keys.length === 0 || keys.length !== options.refs.length) return null
  const occurrences = options.refs.map((ref) => findRemountableCircuitModule(project, ref))
  if (occurrences.some((occurrence) => occurrence == null)) return null
  if (!findPanelById(getProjectElectricalPanels(project), options.ownerPanelId)) return null
  const gridView = planEnclosureGrid(project, options.refs)
  for (const occurrence of occurrences) {
    const key = panelGridModuleRefKey(circuitModuleRef(occurrence!))
    removeFromAllGrids(project, key)
    setMounting(occurrence!, { kind: 'auxiliary', enclosureId: options.id })
  }
  gridView.shownModuleKeys = keys
  const enclosure: AuxiliaryElectricalEnclosure = {
    id: options.id,
    name: options.name ?? '',
    kind: 'other',
    ownerPanelId: options.ownerPanelId,
    panelViewPosition: options.position,
    gridView,
  }
  editProjectAuxiliaryElectricalEnclosures(project).push(enclosure)
  return enclosure
}

/**
 * Returns the circuit modules of a removed enclosure to their own panels. They get an
 * automatic position there, as after any other placement without a stored slot.
 */
export function releaseCircuitModulesFromEnclosure(
  project: ProjectWithOptionalV2Electrical,
  enclosureId: string
): void {
  for (const occurrence of listRemountableCircuitModules(getProjectElectricalPanels(project))) {
    const mounting = occurrence.entity.panelMounting
    if (mounting?.kind !== 'auxiliary' || mounting.enclosureId !== enclosureId) continue
    const key = panelGridModuleRefKey(circuitModuleRef(occurrence))
    removeFromAllGrids(project, key)
    delete occurrence.entity.panelMounting
    occurrence.ownerPanel.gridView ??= {
      rows: DEFAULT_PANEL_GRID_ROWS,
      columns: DEFAULT_PANEL_GRID_COLUMNS,
      feedFromTop: false,
      slots: [],
    }
    showInGrid(occurrence.ownerPanel.gridView, key)
  }
}
