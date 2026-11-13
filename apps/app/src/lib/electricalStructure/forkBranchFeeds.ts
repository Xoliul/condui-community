import type { Circuit } from '@/types/schema'
import { resolveOneWireBranchTopology } from '@/lib/eendraad/oneWireBranchTopology'

/** Undefined keeps a specialized legacy source opaque; null withholds an
 * unresolved attachment instead of reconnecting it to a permanent trunk feed.
 */
export function getStructureForkFeeds(circuit: Circuit, circuitNodeId: string,
  endpoints: ReadonlyMap<string, string>, trunks: ReadonlyMap<string, string>
): Map<string, string | null> {
  const result = new Map<string, string | null>()
  if (!circuit.branches?.some((branch) => branch.forkFrom)) return result
  const topology = resolveOneWireBranchTopology({ ...circuit, branches: circuit.branches })
  for (const item of topology.branches) {
    if (item.feed.kind === 'unresolved') result.set(item.branch.id, null)
    else if (item.feed.kind === 'endpoint') result.set(item.branch.id, endpoints.get(item.feed.endpointId) ?? null)
    else if (item.feed.kind === 'trunk') {
      const device = item.feed.deviceIds.at(-1)
      result.set(item.branch.id, device ? trunks.get(device) ?? null : circuitNodeId)
    }
  }
  return result
}
