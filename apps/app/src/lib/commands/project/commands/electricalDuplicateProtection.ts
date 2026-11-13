import { getPanelGridTotalColumns } from '@/lib/panel/panelGridFields'
import { z } from 'zod'
import { runDuplicateProtectionLeft } from '@/lib/eendraad/duplicateProtectionLeftCore'
import { findCircuitOnPanel } from '@/lib/eendraad/cloneCircuitContent'
import {
  collectCircuitClosureDownstreamFromProtection,
  getMainBusOrder,
} from '@/lib/eendraad/mainBusOrder'
import { getModuleWidthInCols } from '@/lib/panel/panelGridLayout'
import { electricalDropTargetSchema } from '../electricalDropTarget'
import { checkElectricalDropTarget } from '../electricalDropTarget'
import { moveProtectionOnBusInProject } from '@/lib/eendraad/busMoveMutations'
import {
  getEditableProjectElectricalPanels,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
import type { Panel } from '@/types/schema'
import type { ProjectV2 } from '@/types/projectV2'
import type { DuplicateProtectionLeftBridge } from '@/lib/eendraad/duplicateProtectionLeftCore'
import { ensureSitplanPlacementsAt } from '@/lib/eendraad/duplicateSitplanHelpers'
import { CommandError, defineProjectCommand, type EntityRef } from '../types'

export const electricalDuplicateProtectionInputSchema = z.strictObject({
  protectionId: z.string().min(1),
  copyCircuitContents: z.boolean().optional(),
  mainBusPlacement: z
    .strictObject({
      panelId: z.string().min(1),
      mainBusInsertIndex: z.number().int().nonnegative(),
    })
    .optional(),
  gridPlacement: z
    .strictObject({
      panelId: z.string().min(1),
      row: z.number().int().nonnegative(),
      col: z.number().int().nonnegative(),
    })
    .optional(),
  dropTarget: electricalDropTargetSchema.optional(),
  sitplanTarget: z
    .strictObject({
      activeFloorId: z.string().min(1).nullable(),
      viewportCenter: z
        .strictObject({ x: z.number().finite(), y: z.number().finite() })
        .nullable()
        .optional(),
    })
    .optional(),
})
export type ElectricalDuplicateProtectionInput = z.input<
  typeof electricalDuplicateProtectionInputSchema
>

function findProtectionOwner(panels: Panel[], protectionId: string): Panel | undefined {
  for (const panel of panels) {
    if (panel.protections.some((protection) => protection.id === protectionId)) return panel
    const child = findProtectionOwner(panel.subPanels ?? [], protectionId)
    if (child) return child
  }
  return undefined
}

function collectClonedRefs(project: ProjectV2): EntityRef[] {
  const result: EntityRef[] = []
  const visit = (panels: Panel[]) => {
    for (const panel of panels) {
      const addCircuit = (circuit: NonNullable<Panel['circuits']>[number]) => {
        result.push({ kind: 'circuit', id: circuit.id })
        result.push(
          ...circuit.endpoints.map((endpoint) => ({ kind: 'endpoint' as const, id: endpoint.id }))
        )
        result.push(
          ...circuit.endpoints.flatMap((endpoint) =>
            (endpoint.placements ?? []).map((placement) => ({
              kind: 'placement' as const,
              id: placement.id,
            }))
          )
        )
        result.push(
          ...(circuit.trunkDevices ?? []).map((device) => ({
            kind: 'trunkDevice' as const,
            id: device.id,
          }))
        )
        result.push(
          ...(circuit.trunkDevices ?? []).flatMap((device) =>
            (device.placements ?? []).map((placement) => ({
              kind: 'placement' as const,
              id: placement.id,
            }))
          )
        )
        for (const branch of circuit.branches ?? []) {
          result.push(
            ...(branch.branchDevices ?? []).map((device) => ({
              kind: 'trunkDevice' as const,
              id: device.id,
            }))
          )
        }
      }
      for (const protection of panel.protections) {
        result.push({ kind: 'protection', id: protection.id })
        for (const circuit of protection.circuits ?? []) addCircuit(circuit)
      }
      panel.circuits.forEach(addCircuit)
      visit(panel.subPanels ?? [])
    }
  }
  visit(getProjectElectricalPanels(project))
  result.push(
    ...selectProjectWireRuns(project).map((run) => ({ kind: 'wireRun' as const, id: run.id }))
  )
  return [...new Map(result.map((ref) => [`${ref.kind}:${ref.id}`, ref])).values()]
}

function collectExistingIds(project: ProjectV2): Set<string> {
  return new Set(collectClonedRefs(project).map((ref) => ref.id))
}

function projectBridge(project: ProjectV2): DuplicateProtectionLeftBridge {
  return {
    getProject: () => project,
    withSingleUndoEntry: (fn: () => boolean) => fn(),
    insertProtectionAfter: () => undefined,
    addCircuit: () => undefined,
    setDraft: (recipe: (state: { currentProject?: ProjectV2 | null; isDirty?: boolean }) => void) =>
      recipe({ currentProject: project, isDirty: false }),
  }
}

/** Copies one protection and its owned circuit/dependency closure atomically. */
export const electricalDuplicateProtection = defineProjectCommand({
  id: 'electrical.duplicateProtection',
  version: 1,
  input: electricalDuplicateProtectionInputSchema,
  check(project, input) {
    const panels = getProjectElectricalPanels(project)
    const panel = findProtectionOwner(panels, input.protectionId)
    const protection = panel?.protections.find((candidate) => candidate.id === input.protectionId)
    const sourceCircuitId = protection?.circuits?.[0]?.id
    if (!panel || !protection || !sourceCircuitId || !findCircuitOnPanel(panel, sourceCircuitId)) {
      return {
        ok: false,
        code: 'protection_not_found',
        message: 'Protection with an owned circuit not found',
      }
    }
    if (input.mainBusPlacement) {
      if (input.mainBusPlacement.panelId !== panel.id) {
        return {
          ok: false,
          code: 'placement_panel_mismatch',
          message: 'Placement panel does not own the protection',
        }
      }
      if (input.mainBusPlacement.mainBusInsertIndex > getMainBusOrder(panel).length) {
        return {
          ok: false,
          code: 'main_bus_index_out_of_range',
          message: 'Main-bus insertion index is outside the bus',
        }
      }
    }
    if (input.gridPlacement) {
      const targetPanel = getProjectElectricalPanels(project).find(
        (candidate) => candidate.id === input.gridPlacement!.panelId
      )
      const grid = targetPanel?.gridView
      if (!targetPanel || targetPanel.id !== panel.id || !grid) {
        return {
          ok: false,
          code: 'grid_panel_not_found',
          message: 'Grid panel does not own the protection',
        }
      }
      if (input.gridPlacement.row >= grid.rows || input.gridPlacement.col >= getPanelGridTotalColumns(grid)) {
        return {
          ok: false,
          code: 'grid_slot_out_of_range',
          message: 'Grid placement is outside the panel',
        }
      }
      const duplicateWidth = Math.max(
        1,
        getModuleWidthInCols({ kind: 'protection', id: input.protectionId }, project)
      )
      if (input.gridPlacement.col + duplicateWidth > getPanelGridTotalColumns(grid)) {
        return {
          ok: false,
          code: 'grid_slot_out_of_range',
          message: 'Grid placement is outside the panel',
        }
      }
      const occupied = grid.slots.some((slot) => {
        if (slot.row !== input.gridPlacement!.row) return false
        const width = Math.max(1, slot.moduleWidth ?? getModuleWidthInCols(slot.module, project))
        return (
          input.gridPlacement!.col < slot.col + width &&
          slot.col < input.gridPlacement!.col + duplicateWidth
        )
      })
      if (occupied) {
        return {
          ok: false,
          code: 'grid_slot_occupied',
          message: 'Grid placement is already occupied',
        }
      }
    }
    if (input.dropTarget) {
      if (input.mainBusPlacement || input.gridPlacement) {
        return {
          ok: false,
          code: 'conflicting_placement',
          message: 'Choose one duplicate placement',
        }
      }
      const targetCheck = checkElectricalDropTarget(project, input.dropTarget)
      if (!targetCheck.ok) return targetCheck
      if (input.dropTarget.type == null) {
        return {
          ok: false,
          code: 'drop_target_required',
          message: 'A valid placement target is required',
        }
      }
    }
    if (input.copyCircuitContents !== false) {
      const closure = collectCircuitClosureDownstreamFromProtection(panel, protection)
      for (const circuitId of closure) {
        if (!findCircuitOnPanel(panel, circuitId)) {
          return {
            ok: false,
            code: 'circuit_dependency_missing',
            message: 'A dependent circuit no longer exists',
          }
        }
      }
    }
    return { ok: true }
  },
  apply(draft, input, env) {
    const project = draft as ProjectV2
    const existingIds = collectExistingIds(project)
    const newProtectionId = runDuplicateProtectionLeft(
      input.protectionId,
      projectBridge(project),
      input.mainBusPlacement,
      { copyCircuitContents: input.copyCircuitContents },
      env.newId
    )
    if (!newProtectionId) {
      throw new CommandError('check_failed', 'Protection could not be duplicated', {
        reason: 'duplicate_failed',
      })
    }
    const clonedEndpointIds = collectClonedRefs(project)
      .filter((ref) => !existingIds.has(ref.id) && ref.kind === 'endpoint')
      .map((ref) => ref.id)
    const endpointById = new Map<
      string,
      NonNullable<ReturnType<typeof findCircuitOnPanel>>['endpoints'][number]
    >()
    for (const panel of getEditableProjectElectricalPanels(project)) {
      const pending = [panel]
      while (pending.length) {
        const current = pending.pop()!
        for (const circuit of [
          ...(current.circuits ?? []),
          ...(current.protections ?? []).flatMap((protection) => protection.circuits ?? []),
        ]) {
          for (const endpoint of circuit.endpoints) endpointById.set(endpoint.id, endpoint)
        }
        pending.push(...(current.subPanels ?? []))
      }
    }
    ensureSitplanPlacementsAt(
      project,
      clonedEndpointIds,
      (endpointId) => endpointById.get(endpointId),
      (endpointId, placement) => {
        const endpoint = endpointById.get(endpointId)
        if (!endpoint) return
        endpoint.placements ??= []
        endpoint.placements.push(placement)
      },
      {
        activeFloorId: input.sitplanTarget?.activeFloorId ?? null,
        viewportCenter: input.sitplanTarget?.viewportCenter,
      },
      env.newId
    )
    if (input.dropTarget) {
      const move = moveProtectionOnBusInProject(project, newProtectionId, input.dropTarget)
      if (!move.changed) {
        throw new CommandError(
          'check_failed',
          'Protection could not be placed at the requested target',
          {
            reason: move.reason ?? 'drop_rejected',
          }
        )
      }
    }
    if (input.gridPlacement) {
      const panel = findProtectionOwner(getProjectElectricalPanels(project), newProtectionId)
      const slots = panel?.gridView?.slots
      if (!panel?.gridView || !slots) {
        throw new CommandError('check_failed', 'Grid panel no longer exists', {
          reason: 'grid_panel_not_found',
        })
      }
      const duplicateSlot = slots.find(
        (slot) => slot.module.kind === 'protection' && slot.module.id === newProtectionId
      )
      if (duplicateSlot) {
        duplicateSlot.row = input.gridPlacement.row
        duplicateSlot.col = input.gridPlacement.col
      } else {
        slots.push({
          row: input.gridPlacement.row,
          col: input.gridPlacement.col,
          module: { kind: 'protection', id: newProtectionId },
        })
      }
    }
    const created = collectClonedRefs(project).filter((ref) => !existingIds.has(ref.id))
    return {
      created,
      changed: [{ kind: 'protection' as const, id: input.protectionId }],
      removed: [],
      select: [{ kind: 'protection' as const, id: newProtectionId }],
    }
  },
})
