import type { DropTarget } from '@/lib/layout/findDropTarget'
import type { Branch, Circuit } from '@/types/schema'
import { canEditOneWireForks, canForkAfterEndpoint, getOneWireBranchRoots } from '@/lib/eendraad/oneWireForkProject'
import { isEndpointInOneWireConverterTree } from '@/lib/eendraad/oneWireConverterBranches'
import { canEditOneWireRisers, getBranchStems, hasOneWireRisers } from '@/lib/eendraad/oneWireRisers'

export type ForkRiserTargetResult =
  | { ok: true; target: DropTarget }
  | { ok: false; code: string; message: string }

const refuse = (code: string, message: string): ForkRiserTargetResult => ({ ok: false, code, message })

/**
 * An empty leg or riser is filled through the values the editor's drop zone carries: its stored branch id
 * and no anchor endpoint. A leg is addressed on the endpoint it hangs from, an empty riser as a circuit target.
 */
export function emptyBranchTarget(panelId: string, circuit: Circuit, branch: Branch): DropTarget | null {
  if (branch.endpointIds.length || !(branch.forkFrom || branch.keepEmpty)) return null
  return {
    ...(branch.forkFrom ? { type: 'endpoint' as const, endpointId: branch.forkFrom.afterEndpointId } : { type: 'circuit' as const }),
    panelId, circuitId: circuit.id, forkBranchId: branch.id, branchEndpoints: [], insertAfterEndpointId: null,
  }
}

/**
 * A new row on a circuit with risers always names its cable run and its place in the stored branch list. Without an
 * anchor it is the end of the trunk; with one it is the row right after the anchor's root row and that row's legs,
 * on the same cable run. Undefined for circuits without risers (or anchors outside the stored rows): they keep the
 * ordinary circuit destination.
 */
export function riserCircuitRowTarget(panelId: string, circuit: Circuit, afterEndpointId?: string): DropTarget | undefined {
  const branches = circuit.branches ?? []
  if (!hasOneWireRisers(circuit) || !canEditOneWireRisers(circuit)) return undefined
  const stems = getBranchStems(branches)
  if (!stems) return undefined
  const roots = getOneWireBranchRoots(branches)
  let stem = 0
  let last = -1
  if (afterEndpointId) {
    const anchor = branches.find((branch) => branch.endpointIds.includes(afterEndpointId))
    const root = anchor && roots.get(anchor.id)
    if (!anchor || !root) return undefined
    stem = stems.get(anchor.id) ?? 0
    branches.forEach((branch, index) => { if (roots.get(branch.id) === root) last = index })
  } else {
    branches.forEach((branch, index) => { if ((stems.get(branch.id) ?? 0) === 0) last = index })
  }
  return { type: 'circuit', panelId, circuitId: circuit.id, branchStem: stem, branchInsertIndex: last + 1 }
}

/** A new leg after one endpoint, offered only where the editor offers it (something already follows). */
export function forkAfterEndpointTarget(panelId: string, circuit: Circuit, endpointId: string): ForkRiserTargetResult {
  if (!canEditOneWireForks(circuit))
    return refuse('unsupported_fork', 'Forks need an ordinary AC final circuit without inline protections or converters')
  if (isEndpointInOneWireConverterTree(circuit, endpointId))
    return refuse('unsupported_fork', 'A branch with a converter cannot fork')
  if (!canForkAfterEndpoint(circuit, endpointId))
    return refuse('fork_needs_following_symbol', 'This is the last symbol of its run, so nothing branches off after it; place the symbol after it instead')
  return { ok: true, target: { type: 'endpoint', panelId, circuitId: circuit.id, endpointId, forkAfterEndpointId: endpointId } }
}
