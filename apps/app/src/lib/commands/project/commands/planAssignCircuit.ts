import { z } from 'zod'
import type { ProjectV2 } from '@/types/projectV2'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'
import { findCircuitById, findEndpointById, getAllCircuits } from '@/lib/eendraad/projectElectricalDomain'
import { deleteCircuitFromProject, updateCircuitInProject } from '@/lib/eendraad/circuitMutations'
import { promoteCircuitToMainBusInProject } from '@/lib/eendraad/busMoveMutations'
import { getPlanDropCircuitInsertIndexForCode } from '@/lib/plan/planDropPicker'
import { createEmptyCircuitInProject } from '@/lib/plan/planSymbolDrop'
import { isMainPanelDistributionEndpoint } from '@/lib/plan/panelDistributionEndpoint'
import { CommandError, defineProjectCommand, type EntityRef } from '../types'
import { electricalAssignEndpoints } from './electricalAssignEndpoints'

function circuit(project: ProjectV2, id: string) {
  for (const panel of getProjectElectricalPanels(project)) {
    const found = findCircuitById(panel, id)
    if (found) return found
  }
  return null
}

function positionCircuit(project: ProjectV2, panelId: string, circuitId: string) {
  const panel = findPanelById(getProjectElectricalPanels(project), panelId)
  const code = circuit(project, circuitId)?.circuit.code?.trim()
  if (!panel || !code) return false
  // The code orders main-bus circuits only. A circuit behind an RCD or another circuit keeps
  // its place; promoting it would silently take it off its upstream protection.
  if (getAllCircuits(panel).some((parent) => parent.subCircuitIds?.includes(circuitId))) return false
  const result = promoteCircuitToMainBusInProject(project, {
    kind: 'promoteCircuit',
    panelId,
    circuitId,
    insertIndex: getPlanDropCircuitInsertIndexForCode(panel, circuitId, code),
  })
  if (result.reason)
    throw new CommandError('check_failed', 'Circuit could not be positioned', {
      reason: result.reason,
    })
  return result.changed
}

/** The picker creates, assigns, cleans up and orders circuits before publishing one gesture. */
export const planAssignCircuit = defineProjectCommand({
  id: 'plan.assignCircuit',
  version: 1,
  input: z.strictObject({
    panelId: z.string().min(1),
    endpointIds: z.array(z.string().min(1)).min(1),
    circuit: z.discriminatedUnion('mode', [
      z.strictObject({ mode: z.literal('existing'), circuitId: z.string().min(1) }),
      z.strictObject({
        mode: z.literal('new'),
        kind: z.enum(['lighting', 'sockets', 'fixed_appliance', 'other']),
      }),
    ]),
    provisionalCircuitIds: z.array(z.string().min(1)).default([]),
    sortCircuit: z.boolean().default(false),
  }),
  check(project, input) {
    const panel = findPanelById(getProjectElectricalPanels(project), input.panelId)
    if (!panel) return { ok: false, code: 'panel_not_found', message: 'Panel not found' }
    if (new Set(input.endpointIds).size !== input.endpointIds.length) {
      return { ok: false, code: 'duplicate_endpoint_id', message: 'Endpoint ids must be unique' }
    }
    for (const id of input.endpointIds) {
      const endpoint = getProjectElectricalPanels(project)
        .map((root) => findEndpointById(root, id))
        .find(Boolean)?.endpoint
      if (!endpoint || isMainPanelDistributionEndpoint(project, endpoint)) {
        return { ok: false, code: 'invalid_endpoint', message: 'Endpoint cannot be assigned' }
      }
    }
    if (input.circuit.mode === 'existing') {
      const targetId = input.circuit.circuitId
      if (
        ![...panel.circuits, ...panel.protections.flatMap((p) => p.circuits ?? [])].some(
          (c) => c.id === targetId
        )
      ) {
        return {
          ok: false,
          code: 'wrong_panel',
          message: 'Circuit does not belong to the selected panel',
        }
      }
      return electricalAssignEndpoints.check(project, {
        endpointIds: input.endpointIds,
        targetCircuitId: targetId,
      })
    }
    return { ok: true }
  },
  apply(draft, input, env) {
    const project = draft as ProjectV2
    const targetCircuitId =
      input.circuit.mode === 'existing'
        ? input.circuit.circuitId
        : createEmptyCircuitInProject(
            project,
            input.panelId,
            input.circuit.kind,
            {},
            { activeFloorId: null },
            env.language
          )
    if (!targetCircuitId) throw new CommandError('apply_failed', 'Circuit could not be created')
    const assignment = { endpointIds: input.endpointIds, targetCircuitId }
    const check = electricalAssignEndpoints.check(project, assignment)
    if (!check.ok) throw new CommandError('check_failed', check.message, { reason: check.code })
    const result = electricalAssignEndpoints.apply(draft, assignment, env)
    const removed: EntityRef[] = []
    for (const id of new Set(input.provisionalCircuitIds)) {
      if (id === targetCircuitId) continue
      const existing = circuit(project, id)?.circuit
      if (
        !existing ||
        existing.code === 'PANEL' ||
        existing.trunkDevices?.length ||
        existing.subCircuitIds?.length
      )
        continue
      if (existing.endpoints.some((endpoint) => endpoint.symbol !== 'panel_distribution')) continue
      if (deleteCircuitFromProject(project, id)) removed.push({ kind: 'circuit', id })
    }
    const positioned =
      (input.sortCircuit || input.circuit.mode === 'new') &&
      positionCircuit(project, input.panelId, targetCircuitId)
    const target: EntityRef = { kind: 'circuit', id: targetCircuitId }
    return {
      created: input.circuit.mode === 'new' ? [target] : [],
      changed:
        positioned && !result.changed.some((ref) => ref.id === targetCircuitId)
          ? [...result.changed, target]
          : result.changed,
      removed,
      related: [target],
      select: result.select,
    }
  },
})

/** Changing the picker code and its bus position is also one transaction. */
export const circuitSetCodeAndPosition = defineProjectCommand({
  id: 'circuit.setCodeAndPosition',
  version: 1,
  input: z.strictObject({
    panelId: z.string().min(1),
    circuitId: z.string().min(1),
    code: z.string().trim().min(1),
    manualCodeLock: z.boolean(),
  }),
  check(project, input) {
    const panel = findPanelById(getProjectElectricalPanels(project), input.panelId)
    const found =
      panel &&
      [...panel.circuits, ...panel.protections.flatMap((p) => p.circuits ?? [])].some(
        (c) => c.id === input.circuitId
      )
    return found
      ? { ok: true }
      : { ok: false, code: 'circuit_not_found', message: 'Circuit does not belong to the panel' }
  },
  apply(draft, input) {
    const project = draft as ProjectV2
    const changed = updateCircuitInProject(project, input.circuitId, {
      code: input.code,
      ...(input.manualCodeLock ? { eendraadManualCodeLock: true } : {}),
    })
    const positioned = positionCircuit(project, input.panelId, input.circuitId)
    return {
      created: [],
      changed: changed || positioned ? [{ kind: 'circuit' as const, id: input.circuitId }] : [],
      removed: [],
    }
  },
})
