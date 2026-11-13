import {
  arePanelGridSlotsEqual,
  getAllCircuits,
  isModuleRefValid,
  isSharedSupplyTrunkModuleRef,
  maybeApplyAutomaticEendraadNamingForPanel,
  panelGridModuleRefKey,
} from '@/lib/eendraad/projectElectricalDomain'
import { queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { isSupplyTransformer } from '@/lib/electrical/supplyTransformer'
import { healSupplyTrunkMisplacedOnMainGridForPanel } from '@/lib/panel/healSupplyTrunkGrid'
import { DEFAULT_PANEL_GRID_COLUMNS, DEFAULT_PANEL_GRID_ROWS } from '@/lib/panel/panelGridDefaults'
import { findPanelById } from '@/lib/panel/panelTree'
import { setSupplyDevicePanelVisibility } from '@/lib/panel/supplyPanelVisibility'
import { syncPanelAndSituationPlanDeviceVisibility } from '@/lib/plan/panelPlanPlacementVisibility'
import {
  getEditableProjectElectricalPanels,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import type { ProjectV2 } from '@/types/projectV2'
import type { PanelGridSlot } from '@/types/schema'
import type { PanelGridConfig } from '@/types/schema'
import {
  applyPanelColumnChange,
  applyPanelFieldsChange,
  applyPanelRowChange,
  normalizePanelSlotsToFields,
} from './panelRowChange'
import { getPanelGridFields } from './panelGridFields'

export function updatePanelGridInProject(
  project: ProjectV2,
  panelId: string,
  updates: Partial<PanelGridConfig>
): boolean {
  const panel = findPanelById(getProjectElectricalPanels(project), panelId)
  if (!panel) return false
  const current = panel.gridView ?? {
    rows: DEFAULT_PANEL_GRID_ROWS,
    columns: DEFAULT_PANEL_GRID_COLUMNS,
    feedFromTop: false,
    slots: [],
  }
  if (
    Object.entries(updates).every(
      ([key, value]) =>
        JSON.stringify(current[key as keyof PanelGridConfig]) === JSON.stringify(value)
    )
  )
    return false
  panel.gridView ??= current
  const rowChanged = updates.rows != null && updates.rows !== current.rows
  const columnsChanged = updates.columns != null && updates.columns !== current.columns
  const fieldsChanged =
    updates.fields != null && getPanelGridFields(updates) !== getPanelGridFields(current)
  let slots = current.slots ?? []
  if (rowChanged) slots = applyPanelRowChange(panel, project, updates.rows!).slots
  if (fieldsChanged)
    slots = applyPanelFieldsChange(
      { ...panel, gridView: { ...current, rows: updates.rows ?? current.rows, slots } },
      project,
      getPanelGridFields(updates)
    ).slots
  if (columnsChanged)
    slots = applyPanelColumnChange(
      {
        ...panel,
        gridView: {
          ...current,
          rows: updates.rows ?? current.rows,
          fields: updates.fields ?? current.fields,
          slots,
        },
      },
      project,
      updates.columns!
    ).slots
  Object.assign(panel.gridView, updates)
  // One field is the default; do not persist it.
  if (panel.gridView.fields === 1) delete panel.gridView.fields
  if (rowChanged || columnsChanged || fieldsChanged) panel.gridView.slots = slots
  return true
}

/** Grid persistence and visibility rules shared by the store and atomic library drops. */
/**
 * Whether a slot still addresses a module that exists where it says: circuit-scoped trunk
 * devices and domotica endpoints must still belong to the slot's circuit. A slot left behind
 * after an endpoint or device moved to another circuit is never rendered.
 */
export function isPanelGridSlotModuleCurrent(
  project: ProjectV2,
  module: PanelGridSlot['module']
): boolean {
  try {
    if (!isModuleRefValid(module, project)) return false
  } catch {
    return false
  }
  if (module.kind !== 'domotica' && !(module.kind === 'trunkDevice' && module.scope === 'circuit'))
    return true
  const circuit = getProjectElectricalPanels(project)
    .flatMap((panel) => getAllCircuits(panel))
    .find((candidate) => candidate.id === module.circuitId)
  if (!circuit) return false
  return module.kind === 'domotica'
    ? circuit.endpoints.some((endpoint) => endpoint.id === module.endpointId)
    : (circuit.trunkDevices ?? []).some((device) => device.id === module.id)
}

export function updatePanelGridSlotsInProject(
  project: ProjectV2,
  panelId: string,
  slots: PanelGridSlot[]
): boolean {
  const panel = findPanelById(getProjectElectricalPanels(project), panelId)
  if (!panel) return false

  if (!panel.gridView) {
    panel.gridView = {
      rows: DEFAULT_PANEL_GRID_ROWS,
      columns: DEFAULT_PANEL_GRID_COLUMNS,
      feedFromTop: false,
      slots: [],
    }
  }

  // Single source of truth: filter out invalid slots before storing.
  const validMainSlots = slots.filter(
    (slot) =>
      !isSharedSupplyTrunkModuleRef(project, panel, slot.module) &&
      isPanelGridSlotModuleCurrent(project, slot.module)
  )
  const currentMainSlots = panel.gridView.slots ?? []
  const fieldSlots = normalizePanelSlotsToFields(panel, project, validMainSlots)
  if (arePanelGridSlotsEqual(currentMainSlots, fieldSlots)) return false

  panel.gridView.slots = fieldSlots
  const dedupeSupplyAgainstMain = () => {
    const supplySlots = panel.gridView?.supplyPanelSlots
    if (supplySlots && supplySlots.length > 0) {
      const mainKeys = new Set(
        (panel.gridView?.slots ?? []).map((slot) => panelGridModuleRefKey(slot.module))
      )
      const filteredSupply = supplySlots.filter(
        (slot) => !mainKeys.has(panelGridModuleRefKey(slot.module))
      )
      panel.gridView!.supplyPanelSlots = filteredSupply.length > 0 ? filteredSupply : undefined
    }
  }

  dedupeSupplyAgainstMain()
  if (panel.isMain) {
    healSupplyTrunkMisplacedOnMainGridForPanel(panel, project)
    dedupeSupplyAgainstMain()
  }
  maybeApplyAutomaticEendraadNamingForPanel(project, panelId)
  return true
}

export function unhideModuleFromPanelInProject(
  project: ProjectV2,
  panelId: string,
  moduleRefKey: string
): boolean {
  const supplyDevice = queryAllSupplyTrunkDevices(project).find(
    (device) => `trunkDevice:${device.id}:supply` === moduleRefKey
  )
  if (supplyDevice) {
    if (isSupplyTransformer(supplyDevice)) return false
    const visibilityChanged = setSupplyDevicePanelVisibility(project, supplyDevice.id, true)
    const synchronized = syncPanelAndSituationPlanDeviceVisibility(project, {
      kind: 'show',
      panelId,
      moduleRefKey,
    })
    return visibilityChanged || synchronized
  }

  const panel = findPanelById(getEditableProjectElectricalPanels(project), panelId)
  if (!panel) return false
  if (!panel.gridView) {
    panel.gridView = {
      rows: DEFAULT_PANEL_GRID_ROWS,
      columns: DEFAULT_PANEL_GRID_COLUMNS,
      feedFromTop: false,
      slots: [],
    }
  }

  let changed = false
  if (panel.gridView.hiddenModuleKeys?.length) {
    const previousLength = panel.gridView.hiddenModuleKeys.length
    panel.gridView.hiddenModuleKeys = panel.gridView.hiddenModuleKeys.filter(
      (key) => key !== moduleRefKey
    )
    changed = panel.gridView.hiddenModuleKeys.length !== previousLength
    if (panel.gridView.hiddenModuleKeys.length === 0) panel.gridView.hiddenModuleKeys = undefined
  }

  const shown = panel.gridView.shownModuleKeys ?? []
  if (!shown.includes(moduleRefKey)) {
    panel.gridView.shownModuleKeys = [...shown, moduleRefKey]
    changed = true
  }
  if (!changed) return false

  syncPanelAndSituationPlanDeviceVisibility(project, {
    kind: 'show',
    panelId,
    moduleRefKey,
  })
  return true
}

export function updateSupplyPanelSlotsInProject(
  project: ProjectV2,
  panelId: string,
  slots: PanelGridSlot[]
): boolean {
  const panel = findPanelById(getEditableProjectElectricalPanels(project), panelId)
  if (!panel?.gridView) return false

  // Single source of truth: filter out invalid slots before storing.
  const validSlots = slots.filter((slot) => {
    try {
      return isModuleRefValid(slot.module, project)
    } catch {
      return false
    }
  })
  const supplyPanelVisible = validSlots.length > 0
  if (
    arePanelGridSlotsEqual(panel.gridView.supplyPanelSlots, validSlots) &&
    panel.gridView.supplyPanelVisible === supplyPanelVisible
  ) {
    return false
  }

  panel.gridView.supplyPanelSlots = validSlots.length > 0 ? validSlots : undefined
  // Keep slot ownership unique: a module key can live in either supply OR main slots, never both.
  if (panel.gridView.slots && panel.gridView.slots.length > 0 && validSlots.length > 0) {
    const supplyKeys = new Set(validSlots.map((slot) => panelGridModuleRefKey(slot.module)))
    panel.gridView.slots = panel.gridView.slots.filter(
      (slot) => !supplyKeys.has(panelGridModuleRefKey(slot.module))
    )
  }
  panel.gridView.supplyPanelVisible = supplyPanelVisible
  return true
}
