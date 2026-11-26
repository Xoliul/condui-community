import { z } from 'zod'
import { defineProjectCommand } from '../types'
import type { CommandCheck } from '../types'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { collectCircuits, walkPanels } from '@/lib/panel/panelTree'
import { canEditOneWireForks } from '@/lib/eendraad/oneWireForkProject'
import { canEditOneWireRisers, getMaxStem, normalizeCircuitStems } from '@/lib/eendraad/oneWireRisers'
import { initializeBranchesIfNeeded } from '@/lib/layout/endpointChains'
import { syncSequentialEndpointBranchLabelsToCircuit } from '@/lib/eendraad/automaticEndpointBranchNaming'
import { cloneValue } from '@/utils/cloneValue'
import { PROJECT_V2_RISER_SCHEMA_VERSION } from '@/types/projectV2'
import { raiseSchemaVersion } from '@/lib/projectV2/projectSchemaVersion'
import type { ProjectV2 } from '@/types/projectV2'
import type { Branch, Circuit } from '@/types/schema'

function findCircuit(project: ProjectV2, circuitId: string): Circuit | undefined {
  return [...walkPanels(getProjectElectricalPanels(project))].flatMap(collectCircuits).find((item) => item.id === circuitId)
}

const circuitId = z.string().min(1).describe('The circuit (an ordinary final AC circuit without sub-circuits, nested protections, converters or inline protections; energy meters, terminal strips, junction boxes and panels and trunk switches on the shared part are fine).')

/** Pure edit shared by the check (on a copy) and apply. Returns a failure code or null. */
function buildRiser(circuit: Circuit, branchIds: readonly string[] | undefined, newId: () => string): CommandCheck | null {
  const branches: Branch[] = initializeBranchesIfNeeded(circuit).map((branch) => ({ ...branch, endpointIds: [...branch.endpointIds] }))
  const next = getMaxStem(circuit) + 1
  if (!branches.some((branch) => !branch.forkFrom && (branch.stem ?? 0) === 0 && branch.endpointIds.length))
    return { ok: false, code: 'riser_needs_trunk', message: 'A riser needs content on the trunk first' }
  if (branchIds?.length) {
    const wanted = new Set(branchIds)
    const roots = branches.filter((branch) => wanted.has(branch.id))
    if (roots.length !== wanted.size || roots.some((branch) => branch.forkFrom))
      return { ok: false, code: 'branch_not_found', message: 'Only root branches of this circuit can move to a riser' }
    if (!branches.some((branch) => !branch.forkFrom && !wanted.has(branch.id) && (branch.stem ?? 0) === 0 && branch.endpointIds.length))
      return { ok: false, code: 'would_empty_trunk', message: 'At least one row must stay on the trunk' }
    for (const branch of roots) branch.stem = next
    circuit.branches = branches
  } else {
    circuit.branches = [...branches, { id: newId(), label: '', endpointIds: [], keepEmpty: true, stem: next }]
  }
  normalizeCircuitStems(circuit)
  syncSequentialEndpointBranchLabelsToCircuit(circuit)
  return null
}

export const electricalCreateRiser = defineProjectCommand({
  id: 'electrical.createRiser', version: 1,
  input: z.strictObject({
    circuitId,
    branchIds: z.array(z.string().min(1)).min(1).optional()
      .describe('Root branch ids (with their fork legs) to move onto the new riser. Omit to create an empty riser that symbols can be placed on afterwards.'),
  }),
  check(project, input) {
    const circuit = findCircuit(project, input.circuitId)
    if (!circuit) return { ok: false, code: 'circuit_not_found', message: 'Circuit not found' }
    if (!canEditOneWireForks(circuit) || !canEditOneWireRisers(circuit))
      return { ok: false, code: 'unsupported_riser', message: 'Risers need an ordinary AC final circuit without converters, inline protections or nested protections' }
    const preview = cloneValue(circuit)
    const failure = buildRiser(preview, input.branchIds, () => 'preview-riser')
    if (failure) return failure
    return canEditOneWireRisers(preview) ? { ok: true } : { ok: false, code: 'unsupported_riser', message: 'These rows cannot move to a riser' }
  },
  apply(project, input, env) {
    const circuit = findCircuit(project, input.circuitId)!
    buildRiser(circuit, input.branchIds, env.newId)
    raiseSchemaVersion(project, PROJECT_V2_RISER_SCHEMA_VERSION)
    return { created: [], changed: [{ kind: 'circuit', id: circuit.id }], removed: [] }
  },
})

export const electricalJoinRisers = defineProjectCommand({
  id: 'electrical.joinRisers', version: 1,
  input: z.strictObject({ circuitId }),
  check(project, input) {
    const circuit = findCircuit(project, input.circuitId)
    if (!circuit) return { ok: false, code: 'circuit_not_found', message: 'Circuit not found' }
    return circuit.branches?.some((branch) => !branch.forkFrom && (branch.stem ?? 0) > 0)
      ? { ok: true } : { ok: false, code: 'no_risers', message: 'This circuit has no risers' }
  },
  apply(project, input) {
    const circuit = findCircuit(project, input.circuitId)!
    // Empty risers vanish; every other riser row joins the single trunk in drawing order.
    circuit.branches = circuit.branches!
      .filter((branch) => !(!branch.forkFrom && (branch.stem ?? 0) > 0 && !branch.endpointIds.length))
      .map((branch) => {
        if (branch.forkFrom || branch.stem === undefined) return branch
        const { stem: _stem, ...rest } = branch
        return rest
      })
    syncSequentialEndpointBranchLabelsToCircuit(circuit)
    return { created: [], changed: [{ kind: 'circuit', id: circuit.id }], removed: [] }
  },
})

export const electricalDeleteEmptyRiser = defineProjectCommand({
  id: 'electrical.deleteEmptyRiser', version: 1,
  input: z.strictObject({
    circuitId,
    branchId: z.string().min(1).describe('The empty root branch that forms the riser.'),
  }),
  check(project, input) {
    const branch = findCircuit(project, input.circuitId)?.branches?.find((item) => item.id === input.branchId)
    return branch && !branch.forkFrom && (branch.stem ?? 0) > 0 && !branch.endpointIds.length
      ? { ok: true } : { ok: false, code: 'riser_not_empty', message: 'Only an empty riser can be removed' }
  },
  apply(project, input) {
    const circuit = findCircuit(project, input.circuitId)!
    circuit.branches = circuit.branches!.filter((branch) => branch.id !== input.branchId)
    normalizeCircuitStems(circuit)
    syncSequentialEndpointBranchLabelsToCircuit(circuit)
    return { created: [], changed: [{ kind: 'circuit', id: circuit.id }], removed: [] }
  },
})
