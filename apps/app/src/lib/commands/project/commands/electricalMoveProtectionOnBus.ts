import { z } from 'zod'
import {
  moveCircuitOnSecondaryBusInProject,
  moveMainBusCircuitInProject,
  moveProtectionOnBusInProject,
  moveProtectionSelectionOnBusInProject,
  promoteCircuitToMainBusInProject,
  checkProtectionBusDrop,
} from '@/lib/eendraad/busMoveMutations'
import { checkElectricalDropTarget, electricalDropTargetSchema } from '../electricalDropTarget'
import type { ProjectV2 } from '@/types/projectV2'
import { CommandError, defineProjectCommand, type EntityRef } from '../types'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { getAllCircuits } from '@/lib/eendraad/projectElectricalDomain'
import { findPanelById } from '@/lib/panel/panelTree'
import { getMainBusItemsWithIndices } from '@/lib/eendraad/mainBusOrder'
import {
  findPanelOwningProtection,
  findProtectionById,
} from '@/lib/eendraad/projectElectricalDomain'
import { circuitClosureContains } from '@/lib/eendraad/multiSelectionMove'

const protectionDropSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('protectionDrop'),
    protectionId: z.string().min(1),
    target: electricalDropTargetSchema,
  }),
  z.strictObject({
    kind: z.literal('protectionSelectionDrop'),
    protectionIds: z.array(z.string().min(1)).min(1),
    target: electricalDropTargetSchema,
  }),
  z.strictObject({
    kind: z.literal('mainBusDirection'),
    panelId: z.string().min(1),
    circuitId: z.string().min(1),
    direction: z.enum(['left', 'right']),
  }),
  z.strictObject({
    kind: z.literal('secondaryBus'),
    panelId: z.string().min(1),
    parentCircuitId: z.string().min(1),
    circuitId: z.string().min(1),
    /** Position among the parent's sub-circuits; omitted appends at the end. */
    insertIndex: z.number().int().nonnegative().optional(),
    itemCount: z.number().int().nonnegative().optional(),
    insertBeforeCircuitContent: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal('promoteCircuit'),
    panelId: z.string().min(1),
    circuitId: z.string().min(1),
    insertIndex: z.number().int().nonnegative(),
  }),
])

type MoveInput = z.infer<typeof protectionDropSchema>
type DropTarget = z.infer<typeof electricalDropTargetSchema>

/**
 * The editor's drag surface always sends an exact position. Agents may leave it out, which means
 * "append at the end" of the main bus, the RCD's bus or the parent circuit's secondary bus.
 */
function withAppendTarget(project: ProjectV2, target: DropTarget): DropTarget {
  const panel = target.panelId
    ? findPanelById(getEditableProjectElectricalPanels(project), target.panelId)
    : undefined
  if (!panel) return target
  if (target.type === 'mainBus' && target.mainBusInsertIndex == null)
    return { ...target, mainBusInsertIndex: getMainBusItemsWithIndices(panel).length }
  if (target.type === 'rcd' && target.secondaryBusInsertIndex == null && target.protectionId) {
    const rcd = panel.protections.find((protection) => protection.id === target.protectionId)
    if (!rcd) return target
    const carrier = rcd.circuits?.[0]
    return {
      ...target,
      secondaryBusInsertIndex: carrier?.subCircuitIds?.length ?? 0,
      secondaryBusItemCount: undefined,
    }
  }
  return target
}

function withAppendPositions(project: ProjectV2, input: MoveInput): MoveInput {
  if (input.kind === 'protectionDrop' || input.kind === 'protectionSelectionDrop')
    return { ...input, target: withAppendTarget(project, input.target) }
  if (input.kind === 'secondaryBus' && input.insertIndex == null) {
    const panel = findPanelById(getEditableProjectElectricalPanels(project), input.panelId)
    const parent = panel && getAllCircuits(panel).find((circuit) => circuit.id === input.parentCircuitId)
    return { ...input, insertIndex: parent?.subCircuitIds?.length ?? 0, itemCount: undefined }
  }
  return input
}

function refs(ids: readonly string[], kind: EntityRef['kind']): EntityRef[] {
  return [...new Set(ids)].map((id) => ({ kind, id }))
}

function checkJunctionBoundary(
  project: ProjectV2,
  protectionIds: readonly string[],
  target: z.infer<typeof electricalDropTargetSchema>
): string | null {
  if (target.type !== 'circuit' || !target.circuitId) return null
  const panels = getEditableProjectElectricalPanels(project)
  const pending = [...panels]
  let targetPanel: (typeof pending)[number] | undefined
  while (pending.length) {
    const panel = pending.pop()!
    if (getAllCircuits(panel).some((circuit) => circuit.id === target.circuitId)) {
      targetPanel = panel
      break
    }
    pending.push(...panel.subPanels)
  }
  const targetCircuit =
    targetPanel && getAllCircuits(targetPanel).find((circuit) => circuit.id === target.circuitId)
  if (!targetCircuit) return 'circuit_not_found'
  const orderedDevices = [...(targetCircuit.trunkDevices ?? [])].sort(
    (left, right) => (left.trunkPosition ?? 0) - (right.trunkPosition ?? 0)
  )
  const junctionIndex = orderedDevices.findIndex(
    (device) => device.type === 'junction_panel' || device.symbol === 'junction_panel'
  )
  if (junctionIndex < 0) return null
  const targetPosition = target.circuitTrunkSegmentIndex
  for (const protectionId of protectionIds) {
    const sourcePanel = findPanelOwningProtection(panels, protectionId)
    const protection = sourcePanel && findProtectionById(sourcePanel, protectionId)
    if (protection?.type === 'ROTATING_SWITCH' && (target.branchEndpoints?.length ?? 0) > 0)
      continue
    if (targetPosition == null || targetPosition > junctionIndex) return 'junction_boundary'
  }
  return null
}

/** Relocates or reorders protections from the one-wire drag surface in one atomic project command. */
export const electricalMoveProtectionOnBus = defineProjectCommand({
  id: 'electrical.moveProtectionOnBus',
  version: 1,
  input: protectionDropSchema,
  check(project, rawInput) {
    const input = withAppendPositions(project, rawInput)
    if (input.kind === 'promoteCircuit') {
      const panel = findPanelById(getEditableProjectElectricalPanels(project), input.panelId)
      if (!panel) return { ok: false, code: 'panel_not_found', message: 'Panel not found' }
      if (input.insertIndex > getMainBusItemsWithIndices(panel).length) {
        return {
          ok: false,
          code: 'main_bus_index_out_of_range',
          message: 'Main-bus insertion index is outside the bus',
        }
      }
      const roots = getEditableProjectElectricalPanels(project)
      const pending = [...roots]
      let found = false
      while (pending.length) {
        const current = pending.pop()!
        if (
          current.protections.some((protection) =>
            protection.circuits?.some((circuit) => circuit.id === input.circuitId)
          )
        ) {
          found = true
          break
        }
        pending.push(...current.subPanels)
      }
      return found
        ? { ok: true }
        : {
            ok: false,
            code: 'protection_owner_not_found',
            message: 'Circuit has no protection to promote',
          }
    }
    if (input.kind === 'secondaryBus') {
      const panel = findPanelById(getEditableProjectElectricalPanels(project), input.panelId)
      if (!panel) return { ok: false, code: 'panel_not_found', message: 'Panel not found' }
      const circuits = getAllCircuits(panel)
      const parent = circuits.find((circuit) => circuit.id === input.parentCircuitId)
      const moving = circuits.find((circuit) => circuit.id === input.circuitId)
      if (!parent || !moving)
        return { ok: false, code: 'circuit_not_found', message: 'Circuit not found' }
      const itemCount = input.itemCount ?? parent.subCircuitIds?.length ?? 0
      if ((input.insertIndex ?? itemCount) > itemCount) {
        return {
          ok: false,
          code: 'secondary_bus_index_out_of_range',
          message: 'Secondary-bus insertion index is outside the bus',
        }
      }
      if (
        input.parentCircuitId === input.circuitId ||
        circuitClosureContains(input.circuitId, input.parentCircuitId, (id) =>
          circuits.find((circuit) => circuit.id === id)
        )
      ) {
        return {
          ok: false,
          code: 'circuit_cycle',
          message: 'A circuit cannot be moved into itself or its descendants',
        }
      }
      return { ok: true }
    }
    if (input.kind === 'mainBusDirection') {
      const panel = findPanelById(getEditableProjectElectricalPanels(project), input.panelId)
      if (!panel) return { ok: false, code: 'panel_not_found', message: 'Panel not found' }
      const circuit = getAllCircuits(panel).find((candidate) => candidate.id === input.circuitId)
      if (!circuit) return { ok: false, code: 'circuit_not_found', message: 'Circuit not found' }
      const protection = panel.protections.find((candidate) =>
        candidate.circuits?.some((entry) => entry.id === input.circuitId)
      )
      if (
        !getMainBusItemsWithIndices(panel).some(
          (item) =>
            (item.type === 'circuit' && item.id === input.circuitId) ||
            (item.type === 'protection' && item.id === protection?.id)
        )
      )
        return {
          ok: false,
          code: 'circuit_not_on_main_bus',
          message: 'Circuit is not attached to the main bus',
        }
      return { ok: true }
    }
    const ids =
      input.kind === 'protectionDrop' ? [input.protectionId] : [...new Set(input.protectionIds)]
    const targetCheck = checkElectricalDropTarget(project, input.target)
    if (!targetCheck.ok) return targetCheck
    if (input.target.type === 'mainBus' && input.target.mainBusInsertIndex == null) {
      return {
        ok: false,
        code: 'main_bus_index_required',
        message: 'A main-bus destination needs an insertion index',
      }
    }
    if (
      input.target.type === 'mainBus' &&
      input.target.panelId &&
      input.target.mainBusInsertIndex != null
    ) {
      const panel = findPanelById(getEditableProjectElectricalPanels(project), input.target.panelId)
      if (panel && input.target.mainBusInsertIndex > getMainBusItemsWithIndices(panel).length) {
        return {
          ok: false,
          code: 'main_bus_index_out_of_range',
          message: 'Main-bus insertion index is outside the bus',
        }
      }
    }
    if (
      input.target.type === 'circuit' &&
      input.target.secondaryBusInsertIndex == null &&
      input.target.insertAfterCircuitContent !== true
    ) {
      return {
        ok: false,
        code: 'secondary_bus_index_required',
        message: 'A secondary-bus destination needs an insertion index',
      }
    }
    if (input.target.type === 'rcd' && input.target.secondaryBusInsertIndex == null) {
      return {
        ok: false,
        code: 'secondary_bus_index_required',
        message: 'An RCD destination needs an insertion index',
      }
    }
    if (input.target.type === 'circuit' || input.target.type === 'rcd') {
      const count = input.target.secondaryBusItemCount
      if (
        count != null &&
        input.target.secondaryBusInsertIndex != null &&
        input.target.secondaryBusInsertIndex > count
      ) {
        return {
          ok: false,
          code: 'secondary_bus_index_out_of_range',
          message: 'Secondary-bus insertion index is outside the bus',
        }
      }
    }
    if (input.kind === 'protectionDrop') {
      const reason = checkProtectionBusDrop(project, input.protectionId, input.target)
      if (reason)
        return {
          ok: false,
          code: reason,
          message: 'Protection cannot be moved to this bus position',
        }
      const boundary = checkJunctionBoundary(project, ids, input.target)
      return boundary
        ? { ok: false, code: boundary, message: 'This move crosses a junction panel boundary' }
        : { ok: true }
    }
    if (ids.length !== input.protectionIds.length) {
      return {
        ok: false,
        code: 'duplicate_protection_id',
        message: 'A protection can only appear once in a move',
      }
    }
    if (
      input.target.type !== 'mainBus' &&
      !(input.target.type === 'circuit' && input.target.secondaryBusInsertIndex != null) &&
      !(input.target.type === 'rcd' && input.target.secondaryBusInsertIndex != null)
    ) {
      return {
        ok: false,
        code: 'unsupported_drop_target',
        message: 'Protections can only be moved onto a bus',
      }
    }
    for (const id of ids) {
      const reason = checkProtectionBusDrop(project, id, input.target)
      if (reason)
        return {
          ok: false,
          code: reason,
          message: 'Protection cannot be moved to this bus position',
        }
    }
    const boundary = checkJunctionBoundary(project, ids, input.target)
    return boundary
      ? { ok: false, code: boundary, message: 'This move crosses a junction panel boundary' }
      : { ok: true }
  },
  apply(draft, rawInput) {
    const project = draft as ProjectV2
    const input = withAppendPositions(project, rawInput)
    if (input.kind === 'promoteCircuit') {
      const result = promoteCircuitToMainBusInProject(project, input)
      if (result.reason)
        throw new CommandError('check_failed', 'Circuit cannot be promoted to the main bus', {
          reason: result.reason,
        })
      if (!result.changed) return { created: [], changed: [], removed: [] }
      return {
        created: [],
        changed: result.circuitId ? [{ kind: 'circuit' as const, id: result.circuitId }] : [],
        removed: [],
        related: [{ kind: 'panel' as const, id: input.panelId }],
      }
    }
    if (input.kind === 'secondaryBus') {
      const result = moveCircuitOnSecondaryBusInProject(project, {
        ...input,
        insertIndex: input.insertIndex ?? 0,
      })
      if (result.reason)
        throw new CommandError('check_failed', 'Circuit cannot be moved to this secondary bus', {
          reason: result.reason,
        })
      if (!result.changed) return { created: [], changed: [], removed: [] }
      return {
        created: [],
        changed: result.circuitId ? [{ kind: 'circuit' as const, id: result.circuitId }] : [],
        removed: [],
        related: [{ kind: 'circuit' as const, id: input.parentCircuitId }],
      }
    }
    if (input.kind === 'mainBusDirection') {
      const result = moveMainBusCircuitInProject(
        project,
        input.panelId,
        input.circuitId,
        input.direction
      )
      if (result.reason)
        throw new CommandError('check_failed', 'Circuit cannot be moved along the main bus', {
          reason: result.reason,
        })
      return {
        created: [],
        changed:
          result.changed && result.circuitId
            ? [{ kind: 'circuit' as const, id: result.circuitId }]
            : [],
        removed: [],
      }
    }
    const ids =
      input.kind === 'protectionDrop' ? [input.protectionId] : [...new Set(input.protectionIds)]
    const result =
      input.kind === 'protectionDrop'
        ? moveProtectionOnBusInProject(project, input.protectionId, input.target)
        : moveProtectionSelectionOnBusInProject(project, ids, input.target)
    if (result.reason) {
      throw new CommandError('check_failed', 'Protection move was rejected', {
        reason: result.reason,
      })
    }
    if (!result.changed) return { created: [], changed: [], removed: [] }
    const changed = refs(ids, 'protection')
    if (result.circuitId) changed.push({ kind: 'circuit', id: result.circuitId })
    return {
      created: [],
      changed,
      removed: [],
      select: refs(
        input.kind === 'protectionDrop' ? ids : input.protectionIds,
        input.kind === 'protectionDrop' && input.target.type === 'supplyWire'
          ? 'trunkDevice'
          : 'protection'
      ),
    }
  },
})
