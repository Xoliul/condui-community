import { z } from 'zod'
import type { ProjectV2 } from '@/types/projectV2'
import type { PanelGridSlot } from '@/types/schema'
import { CommandError, defineProjectCommand, type EntityRef } from '../types'
import {
  getProjectElectricalPanels,
  selectProjectAuxiliaryElectricalEnclosures,
} from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'
import { isModuleRefValid, findTerminalStripEntity } from '@/lib/eendraad/projectElectricalDomain'
import {
  isPanelGridSlotModuleCurrent,
  updatePanelGridInProject,
  updatePanelGridSlotsInProject,
  updateSupplyPanelSlotsInProject,
} from '@/lib/panel/panelGridMutations'
import {
  createAuxiliarySupplyEnclosure,
  deleteAuxiliarySupplyEnclosure,
  moveSupplyDeviceToAuxiliaryEnclosure,
  moveSupplyDeviceToPanelEnclosure,
  moveSupplyDeviceToGridEnclosure,
  isAuxiliaryMountableSupplyDevice,
  MIN_AUXILIARY_COLUMNS,
  resolveSupplyDeviceMounting,
  getSupplyDeviceSlot,
} from '@/lib/panel/auxiliarySupplyEnclosures'
import { dismissEmptySharedSupplyFrame } from '@/lib/panel/sharedSupplyFrame'
import { moveTerminalStripToPanelInProject } from '@/lib/panel/panelTerminalStripMove'
import { getSupplyPanelLayout, arePanelGridSlotArraysEqual } from '@/lib/panel/panelSupplySlots'
import { panelGridModuleRefKey, resolveModuleWidthCols } from '@/lib/panel/panelGridLayout'
import { DEFAULT_PANEL_GRID_ROWS, DEFAULT_PANEL_GRID_COLUMNS } from '@/lib/panel/panelGridDefaults'
import { getPanelGridTotalColumns } from '@/lib/panel/panelGridFields'
import { persistAutomaticPanelSlotsInProject } from '@/lib/panel/panelAutomaticSlots'
import { getNextModuleEnclosureName } from '@/lib/panel/auxiliaryEnclosureLabel'
import { getDomainTranslator } from '@/lib/i18n/domainI18n'
import {
  createCircuitModuleEnclosureInProject,
  getCircuitModuleSlot,
  isRemountableCircuitModuleRef,
  moveCircuitModuleInProject,
} from '@/lib/panel/circuitModuleMounting'
import { isTerminalStripModuleRef } from '@/lib/panel/panelGridModuleWidth'
import { updateSharedJunctionPanelGrid } from '@/lib/junctionPanel/grid'
import {
  getJunctionPanelModuleLayout,
  getJunctionPanelModuleRowOffset,
} from '@/lib/junctionPanel/moduleLayout'
import { findTrunkDeviceInProject } from '@/utils/project'
import { buildPanelAutoArrangeSlots } from '@/lib/panel/panelSupplySlots'
import { getPanelGridModulesInProject } from '@/lib/panel/panelGridModules'
import {
  ejectToSupplyPanelInProject,
  returnFromSupplyPanelInProject,
  setSupplyPanelVisibleInProject,
} from '@/lib/panel/panelSupplyTransitions'

export const panelModuleRefSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('protection'), id: z.string().min(1) }),
  z.strictObject({
    kind: z.literal('trunkDevice'),
    id: z.string().min(1),
    scope: z.enum(['circuit', 'supply', 'ground']),
    circuitId: z.string().min(1).optional(),
  }),
  z.strictObject({
    kind: z.literal('domotica'),
    endpointId: z.string().min(1),
    circuitId: z.string().min(1),
  }),
])
const measure = z.number().finite().nonnegative()
export const panelSlotSchema = z.strictObject({
  row: z.number().int().nonnegative(),
  col: measure,
  module: panelModuleRefSchema,
  moduleWidth: z.number().finite().positive().optional(),
  moduleWidthManual: z.boolean().optional(),
  terminalStripRail: z.enum(['top', 'bottom']).optional(),
})
export const panelGridPatchSchema = z.strictObject({
  rows: z.number().int().min(1).max(100).optional(),
  columns: z.number().int().min(1).max(1000).optional(),
  fields: z.number().int().min(1).max(8).optional(),
  feedFromTop: z.boolean().optional(),
  terminalStripTopRail: z.boolean().optional(),
  terminalStripBottomRail: z.boolean().optional(),
  supplyPanelRows: z.number().int().min(1).max(100).optional(),
  supplyPanelColumns: z.number().int().min(1).max(1000).optional(),
  supplyPanelVisible: z.boolean().optional(),
})
const point = z.strictObject({ x: z.number().finite(), y: z.number().finite() })
export const panelEditLayoutInputSchema = z
  .strictObject({
    reconcilePanelIds: z.array(z.string().min(1)).min(1).optional(),
    autoArrange: z
      .strictObject({
        panelIds: z.array(z.string().min(1)).min(1),
        feedSideDirection: z.enum(['left', 'right']),
      })
      .optional(),
    supplyTransitions: z
      .array(
        z.strictObject({
          panelId: z.string().min(1),
          module: panelModuleRefSchema,
          destination: z.enum(['main', 'supply']),
        })
      )
      .optional(),
    supplyVisibility: z
      .array(z.strictObject({ panelId: z.string().min(1), visible: z.boolean() }))
      .optional(),
    panels: z
      .array(
        z.strictObject({
          panelId: z.string().min(1),
          mainSlots: z.array(panelSlotSchema).optional(),
          supplySlots: z.array(panelSlotSchema).optional(),
          grid: panelGridPatchSchema.optional(),
        })
      )
      .optional(),
    enclosures: z
      .array(
        z.strictObject({
          enclosureId: z.string().min(1),
          slots: z.array(panelSlotSchema).optional(),
          grid: panelGridPatchSchema.optional(),
        })
      )
      .optional(),
    junctionGrids: z
      .array(
        z
          .strictObject({
            deviceId: z.string().min(1),
            grid: panelGridPatchSchema.optional(),
            slots: z.array(panelSlotSchema).optional(),
          })
          .refine(
            (edit) => edit.grid != null || edit.slots != null,
            'Expected a junction layout edit'
          )
      )
      .optional(),
    supplyMoves: z
      .array(
        z.strictObject({
          deviceId: z.string().min(1),
          destination: z.enum(['panel', 'grid', 'auxiliary']),
          targetId: z.string().min(1),
          row: z.number().int().nonnegative(),
          col: measure,
        })
      )
      .optional(),
    terminalMoves: z
      .array(
        z.strictObject({
          deviceId: z.string().min(1),
          panelId: z.string().min(1),
          enclosureId: z.string().min(1).optional(),
          slot: panelSlotSchema,
        })
      )
      .optional(),
    createAuxiliary: z
      .strictObject({
        deviceIds: z.array(z.string().min(1)).min(1),
        ownerPanelId: z.string().min(1),
        position: point,
      })
      .optional(),
    /** Relays, meters and domotica modules hung in another panel or virtual enclosure. */
    circuitModuleMoves: z
      .array(
        z.strictObject({
          module: panelModuleRefSchema,
          destination: z.discriminatedUnion('kind', [
            z.strictObject({ kind: z.literal('panel'), panelId: z.string().min(1) }),
            z.strictObject({ kind: z.literal('auxiliary'), enclosureId: z.string().min(1) }),
          ]),
          row: z.number().int().nonnegative(),
          col: measure,
        })
      )
      .optional(),
    createCircuitModuleEnclosure: z
      .strictObject({
        modules: z.array(panelModuleRefSchema).min(1),
        ownerPanelId: z.string().min(1),
        position: point,
      })
      .optional(),
    /** Removes virtual/auxiliary enclosures; their devices return to the panel grid. */
    deleteEnclosures: z.array(z.string().min(1)).min(1).optional(),
    /** Dismisses the empty shared supply frame of the main panel (devices are kept). */
    dismissEmptySharedSupplyFrame: z.literal(true).optional(),
  })
  .refine(
    (input) =>
      Object.values(input).some((value) => (Array.isArray(value) ? value.length : value != null)),
    'Expected a layout edit'
  )
export type PanelEditLayoutInput = z.input<typeof panelEditLayoutInputSchema>

function fail(message: string): never {
  throw new CommandError('check_failed', message, { reason: 'invalid_panel_layout' })
}

function sameModuleMembers(left: PanelGridSlot[], right: PanelGridSlot[]): boolean {
  if (left.length !== right.length) return false
  const keys = left.map(slot => panelGridModuleRefKey(slot.module)).sort()
  return right.map(slot => panelGridModuleRefKey(slot.module)).sort().every((key, i) => key === keys[i])
}

/** Coordinate/width edits cannot require initialization of unrelated cabinets. */
function coordinateOnlyPanelIds(project: ProjectV2, input: PanelEditLayoutInput): string[] | null {
  if (!input.panels?.length || Object.entries(input).some(
    ([key, value]) => key !== 'panels' && value !== undefined
  )) return null
  for (const edit of input.panels) {
    const panel = findPanelById(getProjectElectricalPanels(project), edit.panelId)
    if (!panel?.gridView || edit.grid != null ||
        (edit.mainSlots != null && !sameModuleMembers(panel.gridView.slots, edit.mainSlots)) ||
        (edit.supplySlots != null && !sameModuleMembers(panel.gridView.supplyPanelSlots ?? [], edit.supplySlots))) return null
  }
  return [...new Set(input.panels.map(edit => edit.panelId))]
}

function validateSlots(
  project: ProjectV2,
  slots: PanelGridSlot[],
  previous: PanelGridSlot[],
  rows: number,
  columns: number,
  grid: { terminalStripTopRail?: boolean; terminalStripBottomRail?: boolean },
  allowSharedSupply = false
): void {
  const seen = new Set<string>()
  for (const slot of slots) {
    const module = slot.module
    const key = panelGridModuleRefKey(module)
    if (seen.has(key)) fail('Duplicate panel module')
    seen.add(key)
    // Untouched slots are existing layout, not part of this gesture. A stale one (its module
    // moved to another circuit) is invisible and pruned on write; it must not block the edit.
    const old = previous.find((candidate) => panelGridModuleRefKey(candidate.module) === key)
    if (old && arePanelGridSlotArraysEqual([old], [slot])) continue
    if (!isModuleRefValid(slot.module, project)) fail('Panel module no longer exists')
    if (!isPanelGridSlotModuleCurrent(project, slot.module))
      fail('Panel module circuit owner is stale')
    if (
      slot.terminalStripRail &&
      (!isTerminalStripModuleRef(slot.module, project) ||
        !(slot.terminalStripRail === 'top'
          ? grid.terminalStripTopRail
          : grid.terminalStripBottomRail))
    )
      fail('Terminal strip rail is unavailable')
    const width = resolveModuleWidthCols(slot.module, project, slot)
    if (slot.row >= rows || (!allowSharedSupply && slot.col + width > columns + 1e-8))
      fail('Panel module is outside the enclosure')
    for (const other of slots) {
      if (
        other === slot ||
        other.row !== slot.row ||
        other.terminalStripRail !== slot.terminalStripRail ||
        !isPanelGridSlotModuleCurrent(project, other.module)
      )
        continue
      if (
        slot.col < other.col + resolveModuleWidthCols(other.module, project, other) - 1e-8 &&
        other.col < slot.col + width - 1e-8
      )
        fail('Panel modules overlap')
    }
  }
}

/** One physical-layout gesture, including transfers, manual widths and enclosure follow-ups. */
export const panelEditLayout = defineProjectCommand({
  id: 'panel.editLayout',
  version: 1,
  input: panelEditLayoutInputSchema,
  check(project, input) {
    try {
      const panels = getProjectElectricalPanels(project)
      for (const id of [
        ...(input.reconcilePanelIds ?? []),
        ...(input.autoArrange?.panelIds ?? []),
        ...(input.supplyTransitions ?? []).map((entry) => entry.panelId),
        ...(input.supplyVisibility ?? []).map((entry) => entry.panelId),
      ])
        if (!findPanelById(panels, id)) fail('Panel not found')
      for (const transition of input.supplyTransitions ?? [])
        if (!isModuleRefValid(transition.module, project)) fail('Panel module not found')
      for (const edit of input.panels ?? []) {
        const panel = findPanelById(panels, edit.panelId)
        if (!panel) fail('Panel not found')
        const grid = {
          rows: DEFAULT_PANEL_GRID_ROWS,
          columns: DEFAULT_PANEL_GRID_COLUMNS,
          ...panel!.gridView,
          ...edit.grid,
        }
        if (edit.mainSlots)
          validateSlots(
            project,
            edit.mainSlots,
            panel!.gridView?.slots ?? [],
            grid.rows,
            getPanelGridTotalColumns(grid),
            grid
          )
        const supply = getSupplyPanelLayout({
          ...panel!,
          gridView: { ...panel!.gridView!, ...edit.grid },
        })
        if (edit.supplySlots)
          validateSlots(
            project,
            edit.supplySlots,
            panel!.gridView?.supplyPanelSlots ?? [],
            supply.rows,
            supply.cols,
            grid
          )
        if (
          edit.mainSlots &&
          edit.supplySlots &&
          edit.mainSlots.some((slot) =>
            edit.supplySlots!.some(
              (other) => panelGridModuleRefKey(slot.module) === panelGridModuleRefKey(other.module)
            )
          )
        )
          fail('Module belongs to two enclosure grids')
      }
      for (const edit of input.enclosures ?? []) {
        const enclosure = selectProjectAuxiliaryElectricalEnclosures(project).find(
          (candidate) => candidate.id === edit.enclosureId
        )
        if (!enclosure) fail('Enclosure not found')
        const grid = { ...enclosure!.gridView, ...edit.grid }
        if (edit.slots)
          validateSlots(
            project,
            edit.slots,
            enclosure!.gridView.slots,
            grid.rows,
            Math.max(MIN_AUXILIARY_COLUMNS, grid.columns),
            grid
          )
      }
      for (const edit of input.junctionGrids ?? []) {
        const device = findTrunkDeviceInProject(project, edit.deviceId)
        if (!device || (device.type !== 'junction_panel' && device.symbol !== 'junction_panel'))
          fail('Junction panel not found')
        if (edit.slots) {
          const layout = getJunctionPanelModuleLayout(project, device!)
          const grid = { ...layout.grid, ...edit.grid }
          const allowedKeys = new Set(
            layout.slots.map((slot) => panelGridModuleRefKey(slot.module))
          )
          if (edit.slots.some((slot) => !allowedKeys.has(panelGridModuleRefKey(slot.module))))
            fail('Module does not belong to this junction panel')
          validateSlots(
            project,
            edit.slots,
            [],
            Math.max(
              1,
              grid.rows - (layout.slots.length ? getJunctionPanelModuleRowOffset(grid) : 0)
            ),
            grid.columns,
            grid
          )
        }
      }
      // Transfer arrays are one gesture: subsequent moves must see its planned destination slots.
      const plannedDestinationSlots = new Map<string, PanelGridSlot[]>()
      const transferredIds = new Set<string>()
      for (const move of input.supplyMoves ?? []) {
        if (transferredIds.has(move.deviceId)) fail('Supply device moved twice')
        transferredIds.add(move.deviceId)
        if (!isAuxiliaryMountableSupplyDevice(project, move.deviceId))
          fail('Supply device not found')
        const panel = findPanelById(panels, move.targetId)
        const enclosure = selectProjectAuxiliaryElectricalEnclosures(project).find(
          (candidate) => candidate.id === move.targetId
        )
        if (move.destination === 'auxiliary' ? !enclosure : !panel?.gridView)
          fail('Destination enclosure not found')
        const grid = move.destination === 'auxiliary' ? enclosure!.gridView : panel!.gridView!
        const supply =
          move.destination === 'grid'
            ? getSupplyPanelLayout(panel!)
            : { rows: grid.rows, cols: grid.columns }
        const destinationKey = `${move.destination === 'auxiliary' ? 'auxiliary' : 'panel'}:${move.targetId}:${move.destination === 'grid' ? 'supply' : 'main'}`
        const editedPanel = input.panels?.find((edit) => edit.panelId === move.targetId)
        const editedEnclosure = input.enclosures?.find((edit) => edit.enclosureId === move.targetId)
        const slots =
          plannedDestinationSlots.get(destinationKey) ??
          (move.destination === 'grid'
            ? (editedPanel?.supplySlots ?? grid.supplyPanelSlots ?? [])
            : move.destination === 'auxiliary'
              ? (editedEnclosure?.slots ?? grid.slots)
              : (editedPanel?.mainSlots ?? grid.slots))
        const ref = { kind: 'trunkDevice' as const, id: move.deviceId, scope: 'supply' as const }
        const old = getSupplyDeviceSlot(project, move.deviceId)
        const destinationSlots = [
          ...slots.filter(
            (slot) => panelGridModuleRefKey(slot.module) !== panelGridModuleRefKey(ref)
          ),
          { ...old, row: move.row, col: move.col, module: ref },
        ]
        validateSlots(project, destinationSlots, slots, supply.rows, supply.cols, grid)
        plannedDestinationSlots.set(destinationKey, destinationSlots)
      }
      for (const move of input.terminalMoves ?? []) {
        const slotDeviceId =
          move.slot.module.kind === 'domotica'
            ? move.slot.module.endpointId
            : move.slot.module.kind === 'trunkDevice' && move.slot.module.scope === 'circuit'
              ? move.slot.module.id
              : undefined
        if (slotDeviceId !== move.deviceId) fail('Terminal strip slot does not match device')
        if (transferredIds.has(move.deviceId)) fail('Terminal strip moved twice')
        transferredIds.add(move.deviceId)
        if (
          !findTerminalStripEntity(project, move.deviceId) ||
          !findPanelById(panels, move.panelId)
        )
          fail('Terminal strip destination not found')
        const enclosure = move.enclosureId
          ? selectProjectAuxiliaryElectricalEnclosures(project).find(
              (candidate) => candidate.id === move.enclosureId
            )
          : undefined
        if (move.enclosureId && !enclosure) fail('Enclosure not found')
        const grid = enclosure?.gridView ?? findPanelById(panels, move.panelId)?.gridView
        if (!grid) fail('Destination grid not found')
        const key = panelGridModuleRefKey(move.slot.module)
        const destinationKey = `${move.enclosureId ? 'auxiliary' : 'panel'}:${move.enclosureId ?? move.panelId}:main`
        const slots = plannedDestinationSlots.get(destinationKey) ?? grid!.slots
        const destinationSlots = [
          ...slots.filter((slot) => panelGridModuleRefKey(slot.module) !== key),
          move.slot,
        ]
        validateSlots(project, destinationSlots, [], grid!.rows, getPanelGridTotalColumns(grid), grid!)
        plannedDestinationSlots.set(destinationKey, destinationSlots)
      }
      for (const move of input.circuitModuleMoves ?? []) {
        const key = panelGridModuleRefKey(move.module)
        if (transferredIds.has(key)) fail('Panel module moved twice')
        transferredIds.add(key)
        if (!isRemountableCircuitModuleRef(project, move.module)) fail('Panel module cannot move')
        const destination = move.destination
        const grid =
          destination.kind === 'auxiliary'
            ? selectProjectAuxiliaryElectricalEnclosures(project).find(
                (candidate) => candidate.id === destination.enclosureId
              )?.gridView
            : findPanelById(panels, destination.panelId)?.gridView
        if (!grid) fail('Destination enclosure not found')
        const destinationKey =
          destination.kind === 'auxiliary'
            ? `auxiliary:${destination.enclosureId}:main`
            : `panel:${destination.panelId}:main`
        const slots = plannedDestinationSlots.get(destinationKey) ?? grid!.slots
        const destinationSlots = [
          ...slots.filter((slot) => panelGridModuleRefKey(slot.module) !== key),
          {
            ...getCircuitModuleSlot(project, move.module),
            row: move.row,
            col: move.col,
            module: move.module,
          },
        ]
        validateSlots(
          project,
          destinationSlots,
          [],
          grid!.rows,
          destination.kind === 'auxiliary'
            ? Math.max(MIN_AUXILIARY_COLUMNS, grid!.columns)
            : getPanelGridTotalColumns(grid),
          grid!
        )
        plannedDestinationSlots.set(destinationKey, destinationSlots)
      }
      if (
        input.createCircuitModuleEnclosure &&
        (!findPanelById(panels, input.createCircuitModuleEnclosure.ownerPanelId) ||
          input.createCircuitModuleEnclosure.modules.some(
            (module) => !isRemountableCircuitModuleRef(project, module)
          ))
      )
        fail('Virtual enclosure owner or module not found')
      for (const id of input.deleteEnclosures ?? [])
        if (!selectProjectAuxiliaryElectricalEnclosures(project).some((item) => item.id === id))
          fail('Enclosure not found')
      if (
        input.createAuxiliary &&
        (!findPanelById(panels, input.createAuxiliary.ownerPanelId) ||
          input.createAuxiliary.deviceIds.some(
            (id) => !isAuxiliaryMountableSupplyDevice(project, id)
          ))
      )
        fail('Auxiliary enclosure owner or device not found')
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        code: 'invalid_panel_layout',
        message: error instanceof Error ? error.message : 'Invalid panel layout',
      }
    }
  },
  apply(draft, input, env) {
    const localPanelIds = coordinateOnlyPanelIds(draft as ProjectV2, input)
    const project = draft as ProjectV2,
      changed: EntityRef[] = [],
      created: EntityRef[] = []
    for (const id of input.reconcilePanelIds ?? []) {
      const panel = findPanelById(getProjectElectricalPanels(project), id)!
      panel.gridView ??= {
        rows: DEFAULT_PANEL_GRID_ROWS,
        columns: DEFAULT_PANEL_GRID_COLUMNS,
        feedFromTop: false,
        slots: [],
      }
      if (persistAutomaticPanelSlotsInProject(project, id)) changed.push({ kind: 'panel', id })
    }
    for (const id of input.autoArrange?.panelIds ?? []) {
      const panel = findPanelById(getProjectElectricalPanels(project), id)!
      const { mainSlots, supplySlots } = buildPanelAutoArrangeSlots({
        targetPanel: panel,
        targetProject: project,
        feedSideDirection: input.autoArrange!.feedSideDirection,
        getPanelGridModules: (panelId) => getPanelGridModulesInProject(project, panelId),
      })
      const mainChanged = updatePanelGridSlotsInProject(project, id, mainSlots)
      const supplyChanged = updateSupplyPanelSlotsInProject(project, id, supplySlots)
      if (mainChanged || supplyChanged) changed.push({ kind: 'panel', id })
    }
    for (const transition of input.supplyTransitions ?? []) {
      const moved =
        transition.destination === 'supply'
          ? ejectToSupplyPanelInProject(project, transition.panelId, transition.module)
          : returnFromSupplyPanelInProject(project, transition.panelId, transition.module)
      if (moved) changed.push({ kind: 'panel', id: transition.panelId })
    }
    for (const visibility of input.supplyVisibility ?? [])
      if (setSupplyPanelVisibleInProject(project, visibility.panelId, visibility.visible))
        changed.push({ kind: 'panel', id: visibility.panelId })
    for (const edit of input.panels ?? []) {
      let didChange = edit.grid ? updatePanelGridInProject(project, edit.panelId, edit.grid) : false
      if (edit.mainSlots)
        didChange =
          updatePanelGridSlotsInProject(project, edit.panelId, edit.mainSlots) || didChange
      if (edit.supplySlots)
        didChange =
          updateSupplyPanelSlotsInProject(project, edit.panelId, edit.supplySlots) || didChange
      if (didChange) changed.push({ kind: 'panel', id: edit.panelId })
    }
    for (const edit of input.enclosures ?? []) {
      const enclosure = selectProjectAuxiliaryElectricalEnclosures(project).find(
        (candidate) => candidate.id === edit.enclosureId
      )!
      const grid = {
        ...enclosure.gridView,
        ...edit.grid,
        columns: Math.max(MIN_AUXILIARY_COLUMNS, edit.grid?.columns ?? enclosure.gridView.columns),
        ...(edit.slots ? { slots: edit.slots } : {}),
      }
      if (JSON.stringify(enclosure.gridView) !== JSON.stringify(grid)) {
        enclosure.gridView = grid
        changed.push({ kind: 'auxiliaryEnclosure', id: edit.enclosureId })
      }
    }
    for (const edit of input.junctionGrids ?? [])
      if (
        updateSharedJunctionPanelGrid(project, edit.deviceId, {
          ...edit.grid,
          ...(edit.slots ? { slots: edit.slots } : {}),
        })
      )
        changed.push({ kind: 'trunkDevice', id: edit.deviceId })
    for (const move of input.supplyMoves ?? []) {
      const mount = resolveSupplyDeviceMounting(project, move.deviceId)
      const owner =
        move.destination === 'auxiliary'
          ? selectProjectAuxiliaryElectricalEnclosures(project).find(
              (candidate) => candidate.id === move.targetId
            )
          : findPanelById(getProjectElectricalPanels(project), move.targetId)
      const slots =
        move.destination === 'grid'
          ? (owner!.gridView!.supplyPanelSlots ?? [])
          : owner!.gridView!.slots
      const previous = slots.find(
        (slot) =>
          slot.module.kind === 'trunkDevice' &&
          slot.module.id === move.deviceId &&
          slot.module.scope === 'supply'
      )
      const sameMount =
        move.destination === 'grid'
          ? mount?.kind === 'grid'
          : move.destination === 'panel'
            ? mount?.kind === 'panel' && mount.panelId === move.targetId
            : mount?.kind === 'auxiliary' && mount.enclosureId === move.targetId
      if (sameMount && previous?.row === move.row && previous.col === move.col) continue
      const moved =
        move.destination === 'auxiliary'
          ? moveSupplyDeviceToAuxiliaryEnclosure(
              project,
              move.deviceId,
              move.targetId,
              move.row,
              move.col
            )
          : move.destination === 'grid'
            ? moveSupplyDeviceToGridEnclosure(
                project,
                move.deviceId,
                move.targetId,
                move.row,
                move.col
              )
            : moveSupplyDeviceToPanelEnclosure(
                project,
                move.deviceId,
                move.targetId,
                move.row,
                move.col
              )
      if (!moved) fail('Supply module transfer failed')
      // A physical transfer preserves explicit width overrides.
      if (previous?.moduleWidthManual) {
        const slot = (
          move.destination === 'grid' ? owner!.gridView!.supplyPanelSlots! : owner!.gridView!.slots
        ).find((slot) => slot.module.kind === 'trunkDevice' && slot.module.id === move.deviceId)!
        slot.moduleWidth = previous.moduleWidth
        slot.moduleWidthManual = true
      }
      changed.push({ kind: 'trunkDevice', id: move.deviceId })
    }
    for (const move of input.terminalMoves ?? [])
      if (
        moveTerminalStripToPanelInProject(
          project,
          move.deviceId,
          move.panelId,
          move.slot,
          move.enclosureId
        )
      )
        changed.push({ kind: 'trunkDevice', id: move.deviceId })
    for (const move of input.circuitModuleMoves ?? []) {
      if (!moveCircuitModuleInProject(project, move.module, move.destination, move)) continue
      changed.push(
        move.module.kind === 'domotica'
          ? { kind: 'endpoint', id: move.module.endpointId }
          : { kind: 'trunkDevice', id: (move.module as { id: string }).id }
      )
    }
    if (input.createCircuitModuleEnclosure) {
      const enclosure = createCircuitModuleEnclosureInProject(project, {
        id: env.newId(),
        refs: input.createCircuitModuleEnclosure.modules,
        ownerPanelId: input.createCircuitModuleEnclosure.ownerPanelId,
        position: input.createCircuitModuleEnclosure.position,
        name: getNextModuleEnclosureName(
          selectProjectAuxiliaryElectricalEnclosures(project),
          getDomainTranslator(env.language) as (key: string, fallback: string) => string
        ),
      })
      if (!enclosure) fail('Virtual enclosure creation failed')
      created.push({ kind: 'auxiliaryEnclosure', id: enclosure!.id })
    }
    if (input.createAuxiliary) {
      const enclosure = createAuxiliarySupplyEnclosure(project, {
        id: env.newId(),
        ...input.createAuxiliary,
      })
      if (!enclosure) fail('Auxiliary enclosure creation failed')
      created.push({ kind: 'auxiliaryEnclosure', id: enclosure.id })
      changed.push(
        ...input.createAuxiliary.deviceIds.map((id) => ({ kind: 'trunkDevice' as const, id }))
      )
    }
    const removed: EntityRef[] = []
    for (const id of new Set(input.deleteEnclosures ?? []))
      if (deleteAuxiliarySupplyEnclosure(project, id)) removed.push({ kind: 'auxiliaryEnclosure', id })
    // The frame check normalizes supply topology, so skip it once the frame is already gone.
    const frameOwner = input.dismissEmptySharedSupplyFrame
      ? getProjectElectricalPanels(project).find((panel) => panel.isMain)
      : undefined
    if (
      frameOwner &&
      frameOwner.gridView?.supplyPanelVisible !== false &&
      dismissEmptySharedSupplyFrame(project)
    )
      changed.push({ kind: 'panel', id: frameOwner.id })
    // Opening a legacy board asks to initialize only the named boards. Re-running
    // every board's layout through an Immer draft is both unrelated and expensive.
    // Same-board coordinate edits repair only those boards. Membership/mounting
    // changes still perform their full coupled follow-ups.
    const reconcileOnly = input.reconcilePanelIds != null && Object.entries(input).every(
      ([key, value]) => key === 'reconcilePanelIds' || value === undefined
    )
    if ((changed.length || created.length || removed.length) && !reconcileOnly) {
      if (localPanelIds) {
        for (const id of localPanelIds) persistAutomaticPanelSlotsInProject(project, id)
      } else {
        const persist = (panels: ReturnType<typeof getProjectElectricalPanels>) => {
          for (const panel of panels) {
            persistAutomaticPanelSlotsInProject(project, panel.id)
            persist(panel.subPanels)
          }
        }
        persist(getProjectElectricalPanels(project))
      }
    }
    return { created, changed, removed, ...(created.length ? { select: created } : {}) }
  },
})
