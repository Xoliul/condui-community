import { getPanelGridTotalColumns } from '@/lib/panel/panelGridFields'
import { z } from 'zod'
import type { ProjectV2 } from '@/types/projectV2'
import type { PanelGridModuleRef } from '@/types/schema'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { findPanelById, collectCircuits } from '@/lib/panel/panelTree'
import { getModuleWidthInCols, panelGridModuleRefKey } from '@/lib/panel/panelGridLayout'
import { DEFAULT_PANEL_GRID_ROWS } from '@/lib/panel/panelGridDefaults'
import { placeSupplyModuleAfterInsert } from '@/lib/panel/panelSupplySlots'
import {
  unhideModuleFromPanelInProject,
  updatePanelGridSlotsInProject,
  updateSupplyPanelSlotsInProject,
} from '@/lib/panel/panelGridMutations'
import { updateCircuitInProject } from '@/lib/eendraad/circuitMutations'
import { CommandError, type EntityRef } from './types'

export const panelDropPlacementSchema = z.strictObject({
  scope: z.enum(['main', 'supply']),
  row: z.number().int().nonnegative(),
  col: z.number().finite().nonnegative(),
  /** A free drop gives a column centre; a child/supply drop gives a left edge. */
  centerColumn: z.boolean().optional(),
  parentCircuitId: z.string().min(1).optional(),
  /** A modular socket may create the missing empty circuit under this protection. */
  ensureCircuitForProtectionId: z.string().min(1).optional(),
})
export type PanelDropPlacement = z.infer<typeof panelDropPlacementSchema>

/** Position only the module this drop actually created, as part of the same transaction. */
export function applyPanelDropPlacement(
  project: ProjectV2,
  panelId: string,
  intent: PanelDropPlacement,
  created: EntityRef[]
): EntityRef[] {
  const fail = (message: string): never => {
    throw new CommandError('check_failed', message, { reason: 'panel_module_not_created' })
  }
  const panel =
    findPanelById(getEditableProjectElectricalPanels(project), panelId) ?? fail('Panel not found')
  const protectionId = created.filter((ref) => ref.kind === 'protection').at(-1)?.id
  const deviceId = created.filter((ref) => ref.kind === 'trunkDevice').at(-1)?.id
  const endpointId = created.filter((ref) => ref.kind === 'endpoint').at(-1)?.id
  let module: PanelGridModuleRef
  if (intent.scope === 'supply' && deviceId) {
    module = { kind: 'trunkDevice', id: deviceId, scope: 'supply' }
  } else if (intent.scope === 'main' && protectionId) {
    module = { kind: 'protection', id: protectionId }
  } else {
    const circuit = collectCircuits(panel).find(
      (candidate) =>
        (deviceId && candidate.trunkDevices?.some((device) => device.id === deviceId)) ||
        (endpointId && candidate.endpoints.some((endpoint) => endpoint.id === endpointId))
    )
    if (!circuit || intent.scope !== 'main') return fail('The drop did not create a panel module')
    module = deviceId
      ? { kind: 'trunkDevice', id: deviceId, scope: 'circuit', circuitId: circuit.id }
      : { kind: 'domotica', endpointId: endpointId!, circuitId: circuit.id }
  }
  const changed: EntityRef[] = [{ kind: 'panel', id: panelId }]
  if (intent.parentCircuitId) {
    const childId = created.filter((ref) => ref.kind === 'circuit').at(-1)?.id
    const parent = collectCircuits(panel).find((circuit) => circuit.id === intent.parentCircuitId)
    if (!parent || !childId) return fail('The drop did not create a child circuit')
    updateCircuitInProject(project, parent.id, {
      subCircuitIds: [...(parent.subCircuitIds ?? []), childId],
    })
    changed.push({ kind: 'circuit', id: parent.id })
  }
  unhideModuleFromPanelInProject(project, panelId, panelGridModuleRefKey(module))
  if (intent.scope === 'supply') {
    const slots = placeSupplyModuleAfterInsert(panel, project, module, intent.row, intent.col)
    updatePanelGridSlotsInProject(project, panelId, slots.mainSlots)
    updateSupplyPanelSlotsInProject(project, panelId, slots.supplySlots)
  } else {
    const width = getModuleWidthInCols(module, project)
    const rows = panel.gridView?.rows ?? DEFAULT_PANEL_GRID_ROWS
    const cols = getPanelGridTotalColumns(panel.gridView)
    const row = Math.min(intent.row, rows - 1)
    const col = Math.max(
      0,
      Math.min(cols - width, intent.col - (intent.centerColumn ? Math.floor(width / 2) : 0))
    )
    const slots = (panel.gridView?.slots ?? []).filter(
      (slot) => panelGridModuleRefKey(slot.module) !== panelGridModuleRefKey(module)
    )
    updatePanelGridSlotsInProject(project, panelId, [...slots, { row, col, module }])
  }
  return changed
}
