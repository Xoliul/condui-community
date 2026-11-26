import { z } from 'zod'
import { hasOneWireForks } from '@/lib/eendraad/oneWireForkProject'
import { CommandError, defineProjectCommand } from '../types'
import type { ProjectV2 } from '@/types/projectV2'
import {
  assignEndpointsToCircuitInProject,
  expandDomoticaEndpointAssignment,
} from '@/lib/eendraad/endpointMutations'
import { findCircuitById, findEndpointById } from '@/lib/eendraad/projectElectricalDomain'
import { isMainPanelDistributionEndpoint } from '@/lib/plan/panelDistributionEndpoint'
import { isDomoticaPanelFeedEndpoint } from '@/lib/eendraad/panelSupplyLink'
import { circuitContainsJunctionPanelIdentity, getJunctionIdentity } from '@/lib/junctionIdentity'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { checkHorizontalDomoticaNotIntoSupply } from '../horizontalDomoticaIntegrity'

function findCircuit(project: ProjectV2, circuitId: string) {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const found = findCircuitById(panel, circuitId)
    if (found) return found
  }
  return null
}

function findEndpoint(project: ProjectV2, endpointId: string) {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const found = findEndpointById(panel, endpointId)
    if (found) return found
  }
  return null
}

/** Assign existing endpoints to a circuit in one undoable project transaction. */
export const electricalAssignEndpoints = defineProjectCommand({
  id: 'electrical.assignEndpoints',
  version: 1,
  input: z.object({
    endpointIds: z.array(z.string().min(1)).min(1),
    targetCircuitId: z.string().min(1),
  }),
  check(project, input) {
    if (new Set(input.endpointIds).size !== input.endpointIds.length) {
      return { ok: false, code: 'invalid_selection', message: 'Endpoint ids must be unique' }
    }
    const target = findCircuit(project, input.targetCircuitId)
    if (!target || target.circuit.code === 'PANEL') {
      return { ok: false, code: 'invalid_target_circuit', message: 'Target circuit not found' }
    }
    const endpointIds = expandDomoticaEndpointAssignment(project, input.endpointIds)
    const endpoints = endpointIds.map((id) => findEndpoint(project, id))
    if (endpoints.some((entry) => !entry)) {
      return { ok: false, code: 'endpoint_not_found', message: 'An endpoint no longer exists' }
    }
    if (hasOneWireForks(target.circuit) || endpoints.some((entry) => hasOneWireForks(entry!.circuit)))
      return { ok: false, code: 'fork_run_required', message: 'Move the complete run to preserve its forks' }
    if (endpoints.some((owner) => owner && isDomoticaPanelFeedEndpoint(owner.endpoint) &&
      owner.circuit.id !== input.targetCircuitId)) {
      return { ok: false, code: 'output_feed', message: 'A domotica output feeding a panel cannot be moved to another circuit.' }
    }
    const supplyCheck = checkHorizontalDomoticaNotIntoSupply(project, endpointIds, { circuitId: input.targetCircuitId })
    if (!supplyCheck.ok) return supplyCheck
    const sourceCircuitIds = new Set(endpoints.map((entry) => entry!.circuit.id))
    if (sourceCircuitIds.size > 1) {
      const selectedJunctionPanels = new Set<string>()
      for (const owner of endpoints) {
        if (owner?.endpoint.symbol !== 'junction_panel') continue
        const identity = getJunctionIdentity(owner.endpoint).trim().toUpperCase()
        if (identity && selectedJunctionPanels.has(identity)) {
          return {
            ok: false,
            code: 'duplicate_junction_panel',
            message: 'This junction panel already belongs to the target circuit',
          }
        }
        if (identity) selectedJunctionPanels.add(identity)
      }
    }
    for (const owner of endpoints) {
      if (isMainPanelDistributionEndpoint(project, owner!.endpoint)) {
        return {
          ok: false,
          code: 'protected_endpoint',
          message: 'The main panel symbol cannot be moved',
        }
      }
      if (
        owner!.endpoint.symbol === 'junction_panel' &&
        circuitContainsJunctionPanelIdentity(
          target.circuit,
          getJunctionIdentity(owner!.endpoint),
          owner!.endpoint.id
        )
      ) {
        return {
          ok: false,
          code: 'duplicate_junction_panel',
          message: 'This junction panel already belongs to the target circuit',
        }
      }
    }
    return { ok: true }
  },
  apply(draft, input, env) {
    const result = assignEndpointsToCircuitInProject(
      draft as ProjectV2,
      input.endpointIds,
      input.targetCircuitId,
      env.newId
    )
    if (!result) {
      const allAlreadyAssigned = expandDomoticaEndpointAssignment(
        draft as ProjectV2,
        input.endpointIds
      ).every((id) => findEndpoint(draft as ProjectV2, id)?.circuit.id === input.targetCircuitId)
      if (allAlreadyAssigned) return { created: [], changed: [], removed: [], select: [] }
      throw new CommandError('check_failed', 'Endpoints could not be assigned', {
        reason: 'assignment_rejected',
      })
    }
    return {
      created: [],
      changed: result.changedCircuitIds.map((id) => ({ kind: 'circuit' as const, id })),
      removed: [],
      related: result.movedEndpointIds.map((id) => ({ kind: 'endpoint' as const, id })),
      select: result.movedEndpointIds.map((id) => ({ kind: 'endpoint' as const, id })),
    }
  },
})
