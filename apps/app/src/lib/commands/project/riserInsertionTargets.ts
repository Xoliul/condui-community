import type { DropTarget } from '@/lib/layout/findDropTarget'
import type { Circuit } from '@/types/schema'
import { canEditOneWireRisers, getBranchStems, getMaxStem } from '@/lib/eendraad/oneWireRisers'
import { hasOneWireForks } from '@/lib/eendraad/oneWireForkProject'
import { emptyBranchTarget } from './forkRiserSemanticTarget'

/**
 * Row destinations of one ordinary circuit with forks or risers, in the values the editor's drop zones carry: the
 * new-riser zone, the slot that fills an empty riser, and the root gaps of every cable run that already holds a row
 * (`branchStem` + `branchInsertIndex`, an index into the stored branch list; a gap never splits a row from its legs).
 * The caller dry-runs each one, so only possible drops are offered.
 */
export function riserInsertionTargets(panelId: string, circuit: Circuit): DropTarget[] {
  if (!circuit.endpoints.length || !canEditOneWireRisers(circuit)) return []
  const base = { type: 'circuit' as const, panelId, circuitId: circuit.id }
  const branches = circuit.branches ?? []
  const targets: DropTarget[] = [{ ...base, newRiser: true, branchEndpoints: [] }]
  for (const branch of branches) {
    const empty = !branch.forkFrom && (branch.stem ?? 0) > 0 ? emptyBranchTarget(panelId, circuit, branch) : null
    if (empty) targets.push(empty)
  }
  const stems = getBranchStems(branches)
  if (!branches.length || !stems || !hasOneWireForks(circuit)) return targets
  for (let stem = 0; stem <= getMaxStem(circuit); stem++) {
    const rows = branches.flatMap((branch, index) => stems.get(branch.id) === stem ? [{ branch, index }] : [])
    // A riser that only holds its empty row is filled through that row, not through a gap next to it.
    if (!rows.some(({ branch }) => branch.endpointIds.length || !branch.keepEmpty || branch.forkFrom)) continue
    const first = rows[0]!.index
    const last = rows.at(-1)!.index
    for (let index = first; index <= last + 1; index++) {
      if (!branches[index]?.forkFrom) targets.push({ ...base, branchStem: stem, branchInsertIndex: index })
    }
  }
  return targets
}
