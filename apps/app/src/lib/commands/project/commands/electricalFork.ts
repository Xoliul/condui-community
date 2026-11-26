import { z } from 'zod'
import { defineProjectCommand } from '../types'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { collectCircuits, walkPanels } from '@/lib/panel/panelTree'
import { canEditOneWireForks, canForkAfterEndpoint } from '@/lib/eendraad/oneWireForkProject'
import { isEndpointInOneWireConverterTree } from '@/lib/eendraad/oneWireConverterBranches'
import { initializeBranchesIfNeeded } from '@/lib/layout/endpointChains'
import { syncSequentialEndpointBranchLabelsToCircuit } from '@/lib/eendraad/automaticEndpointBranchNaming'
import { PROJECT_V2_FORK_SCHEMA_VERSION } from '@/types/projectV2'
import { raiseSchemaVersion } from '@/lib/projectV2/projectSchemaVersion'
import type { ProjectV2 } from '@/types/projectV2'

function circuits(project: ProjectV2) {
  return [...walkPanels(getProjectElectricalPanels(project))].flatMap(collectCircuits)
}

export const electricalCreateFork = defineProjectCommand({
  id: 'electrical.createFork', version: 1,
  input: z.strictObject({
    afterEndpointId: z.string().min(1).describe('The endpoint after which a new empty leg starts.'),
    /** Agents only: the editor offers a fork where something already follows, so refuse it at the end of a run. */
    requireFollowingSymbol: z.boolean().optional(),
  }),
  check(project, input) {
    const circuit = circuits(project).find((item) => item.endpoints.some((endpoint) => endpoint.id === input.afterEndpointId))
    if (!circuit) return { ok: false, code: 'endpoint_not_found', message: 'Fork endpoint not found' }
    if (!canEditOneWireForks(circuit)) return { ok: false, code: 'unsupported_fork', message: 'Forks require an ordinary AC final circuit' }
    if (isEndpointInOneWireConverterTree(circuit, input.afterEndpointId)) return { ok: false, code: 'unsupported_fork', message: 'A branch with a converter cannot fork' }
    if (input.requireFollowingSymbol && !canForkAfterEndpoint(circuit, input.afterEndpointId))
      return { ok: false, code: 'fork_needs_following_symbol', message: 'This is the last symbol of its run, so nothing branches off after it; place the symbol after it instead' }
    return { ok: true }
  },
  apply(project, input, env) {
    const circuit = circuits(project).find((item) => item.endpoints.some((endpoint) => endpoint.id === input.afterEndpointId))!
    circuit.branches = initializeBranchesIfNeeded(circuit).map((branch) => ({ ...branch, endpointIds: [...branch.endpointIds] }))
    circuit.branches.push({ id: env.newId(), label: '', endpointIds: [], keepEmpty: true, forkFrom: { afterEndpointId: input.afterEndpointId } })
    syncSequentialEndpointBranchLabelsToCircuit(circuit)
    raiseSchemaVersion(project, PROJECT_V2_FORK_SCHEMA_VERSION)
    return { created: [], changed: [{ kind: 'circuit', id: circuit.id }], removed: [], select: [{ kind: 'endpoint', id: input.afterEndpointId }] }
  },
})

export const electricalDeleteEmptyFork = defineProjectCommand({
  id: 'electrical.deleteEmptyFork', version: 1,
  input: z.strictObject({
    circuitId: z.string().min(1),
    branchId: z.string().min(1).describe('The empty leg (a branch with forkFrom and no endpointIds) or empty riser row to remove.'),
  }),
  check(project, input) {
    const branch = circuits(project).find((circuit) => circuit.id === input.circuitId)?.branches?.find((item) => item.id === input.branchId)
    return branch && !branch.endpointIds.length && (branch.forkFrom || branch.keepEmpty)
      ? { ok: true } : { ok: false, code: 'fork_not_empty', message: 'Only an empty fork can be removed' }
  },
  apply(project, input) {
    const circuit = circuits(project).find((item) => item.id === input.circuitId)!
    circuit.branches = circuit.branches!.filter((branch) => branch.id !== input.branchId)
    syncSequentialEndpointBranchLabelsToCircuit(circuit)
    return { created: [], changed: [{ kind: 'circuit', id: circuit.id }], removed: [] }
  },
})
