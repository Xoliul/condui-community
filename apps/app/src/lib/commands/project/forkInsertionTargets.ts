import type { DropTarget } from '@/lib/layout/findDropTarget'
import type { Circuit } from '@/types/schema'
import { canEditOneWireForks, canForkAfterEndpoint } from '@/lib/eendraad/oneWireForkProject'
import { emptyBranchTarget } from './forkRiserSemanticTarget'

/**
 * Fork destinations of one circuit, in the values the editor's fork drop zones carry and without any layout: a new
 * leg after every endpoint where something follows, the empty legs, the positions inside a leg or riser row, and the
 * gap right after a symbol that has legs (they stay on it). The caller dry-runs each one.
 */
export function forkInsertionTargets(panelId: string, circuit: Circuit): DropTarget[] {
  if (!circuit.endpoints.length || !canEditOneWireForks(circuit)) return []
  const base = { panelId, circuitId: circuit.id }
  const branches = circuit.branches ?? []
  const targets: DropTarget[] = []
  for (const endpoint of circuit.endpoints) {
    if (canForkAfterEndpoint(circuit, endpoint.id))
      targets.push({ ...base, type: 'endpoint', endpointId: endpoint.id, forkAfterEndpointId: endpoint.id })
  }
  const tapped = new Set(branches.flatMap((branch) => branch.forkFrom ? [branch.forkFrom.afterEndpointId] : []))
  for (const branch of branches) {
    const empty = branch.forkFrom ? emptyBranchTarget(panelId, circuit, branch) : null
    if (empty) targets.push(empty)
    const ids = branch.endpointIds
    for (const id of ids) {
      if (tapped.has(id))
        targets.push({ ...base, type: 'endpoint', endpointId: id, forkBranchId: branch.id, branchEndpoints: [...ids], insertAfterEndpointId: id })
    }
    if (!ids.length || !(branch.forkFrom || branch.keepEmpty)) continue
    for (let index = 0; index <= ids.length; index++) {
      if (tapped.has(ids[index - 1] ?? '')) continue
      const endpointId = ids[index - 1] ?? ids[0]
      targets.push({ ...base, type: endpointId ? 'endpoint' : 'circuit', ...(endpointId ? { endpointId } : {}),
        forkBranchId: branch.id, branchEndpoints: [...ids], insertAfterEndpointId: ids[index - 1] ?? null })
    }
  }
  return targets
}
