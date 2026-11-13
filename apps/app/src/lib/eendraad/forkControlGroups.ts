import type { Circuit, Endpoint } from '@/types/schema'
import { getOneWireEndpointFeedPath, resolveOneWireBranchTopology } from './oneWireBranchTopology'

export function getForkControlGroups(circuit: Circuit): Array<{ endpoints: Endpoint[]; controlled: boolean }> | null {
  if (!circuit.branches?.some((branch) => branch.forkFrom)) return null
  const topology = resolveOneWireBranchTopology({ ...circuit, branches: circuit.branches })
  const controls = new Set([
    ...circuit.endpoints.filter((endpoint) => endpoint.type === 'switch' || endpoint.symbol === 'relay' || endpoint.symbol === 'contact').map((endpoint) => endpoint.id),
    ...(circuit.trunkDevices ?? []).filter((device) => device.type === 'switch' || device.type === 'relay').map((device) => device.id),
  ])
  const groups = new Map<string, { endpoints: Endpoint[]; controlled: boolean }>()
  for (const endpoint of circuit.endpoints) {
    const path = getOneWireEndpointFeedPath(topology, endpoint.id)
    const control = path?.findLast((step) => controls.has(step.id))
    const key = control ? `${control.kind}:${control.id}` : `endpoint:${endpoint.id}`
    const group = groups.get(key) ?? { endpoints: [], controlled: !!control }
    group.endpoints.push(endpoint); groups.set(key, group)
  }
  return [...groups.values()]
}
