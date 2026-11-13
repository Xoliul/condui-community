import type { Endpoint } from '@/types/schema'

/** Branch-local conversion devices (an endpoint, not a trunk converter). */
export const ONE_WIRE_CONVERTER_SYMBOLS: ReadonlySet<string> = new Set(['transformer', 'rectifier', 'inverter', 'dc_dc_converter'])

export function isOneWireConverterEndpoint(endpoint: Pick<Endpoint, 'symbol'>): boolean {
  return ONE_WIRE_CONVERTER_SYMBOLS.has(endpoint.symbol ?? '')
}

interface BranchLike { id: string; endpointIds: readonly string[]; forkFrom?: { afterEndpointId: string } }
interface CircuitLike { endpoints: readonly Pick<Endpoint, 'id' | 'symbol'>[]; branches?: readonly BranchLike[] }

/**
 * Root branches whose tree (the root and every leg below it) holds a converter
 * endpoint. These stay specialized: nothing forks from them and their rows keep
 * the layout, wiring and drop targets of a circuit without forks. Every other
 * root is an ordinary AC branch. Circuit-wide specialness (supply sources, DC
 * rails, trunk converters, domotica) is decided separately by the topology.
 */
export function getOneWireConverterRootIds(circuit: CircuitLike): Set<string> {
  const result = new Set<string>()
  const converters = new Set(circuit.endpoints.filter(isOneWireConverterEndpoint).map((endpoint) => endpoint.id))
  if (!converters.size) return result
  const branches = circuit.branches ?? []
  const owner = new Map(branches.flatMap((branch) => branch.endpointIds.map((id) => [id, branch] as const)))
  const rootOf = new Map<string, string | null>()
  for (const branch of branches) {
    const path: string[] = []
    let cursor: BranchLike | undefined = branch
    let root: string | null = null
    while (cursor) {
      if (rootOf.has(cursor.id)) { root = rootOf.get(cursor.id)!; break }
      if (path.includes(cursor.id)) break
      path.push(cursor.id)
      if (!cursor.forkFrom) { root = cursor.id; break }
      cursor = owner.get(cursor.forkFrom.afterEndpointId)
    }
    for (const id of path) rootOf.set(id, root)
  }
  for (const branch of branches) {
    const root = rootOf.get(branch.id)
    if (root && branch.endpointIds.some((id) => converters.has(id))) result.add(root)
  }
  return result
}

/** True when the endpoint sits in a root tree that holds a converter endpoint. */
export function isEndpointInOneWireConverterTree(circuit: CircuitLike, endpointId: string): boolean {
  const branches = circuit.branches ?? []
  // Without stored branches the circuit is one implicit run.
  if (!branches.length) return circuit.endpoints.some(isOneWireConverterEndpoint) && circuit.endpoints.some((endpoint) => endpoint.id === endpointId)
  const roots = getOneWireConverterRootIds(circuit)
  if (!roots.size) return false
  const owner = new Map(branches.flatMap((branch) => branch.endpointIds.map((id) => [id, branch] as const)))
  const seen = new Set<string>()
  let cursor = owner.get(endpointId)
  while (cursor && !seen.has(cursor.id)) {
    if (roots.has(cursor.id)) return true
    seen.add(cursor.id)
    cursor = cursor.forkFrom ? owner.get(cursor.forkFrom.afterEndpointId) : undefined
  }
  return false
}

/** True when the branch record is a root or leg inside a converter tree. */
export function isOneWireConverterBranch(circuit: CircuitLike, branchId: string): boolean {
  const branch = circuit.branches?.find((item) => item.id === branchId)
  const first = branch?.endpointIds[0]
  if (first) return isEndpointInOneWireConverterTree(circuit, first)
  if (branch?.forkFrom) return isEndpointInOneWireConverterTree(circuit, branch.forkFrom.afterEndpointId)
  return !!branch && getOneWireConverterRootIds(circuit).has(branch.id)
}
