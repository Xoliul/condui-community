import type { ProjectV2 } from '@/types/projectV2'
import { buildElectricalStructureSnapshot } from '@/lib/electricalStructure/builder'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { walkPanels, collectCircuits } from '@/lib/panel/panelTree'

export interface CircuitWireConnection {
  anchor: string
  circuitId: string
  domain: string
  targetKey: string
  sourceKey: string
  branchKey?: string
  rootKey?: string
  empty: boolean
  rail: boolean
}

/** Use the electrical graph's actual connections, independently of volatile drawing segments. */
export function getWireTopologyContext(project: ProjectV2) {
  const branches = new Map<string, string>()
  for (const panel of walkPanels(getProjectElectricalPanels(project))) {
    for (const circuit of collectCircuits(panel)) {
      for (const branch of circuit.branches ?? []) {
        for (const id of [
          ...branch.endpointIds,
          ...(branch.branchDevices ?? []).map((device) => device.id),
        ])
          branches.set(`${circuit.id}:${id}`, branch.id)
      }
    }
  }
  const snapshot = buildElectricalStructureSnapshot(project)
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]))
  const connections = new Map<string, CircuitWireConnection>()
  const byTarget = new Map<string, CircuitWireConnection>()
  const roots = new Map<string, CircuitWireConnection[]>()
  const feeds = new Map<string, CircuitWireConnection[]>()
  for (const edge of snapshot.relationships) {
    const anchor = edge.properties?.wireAnchor
    if (typeof anchor !== 'string' || !anchor.startsWith('circuit:') || connections.has(anchor))
      continue
    const match = /^circuit:([^:]+):into:(.+):(AC|DC)$/.exec(anchor)
    if (!match) continue
    const from = nodes.get(edge.kind === 'belongs-to-circuit' ? edge.to : edge.from)
    const to = nodes.get(edge.kind === 'belongs-to-circuit' ? edge.from : edge.to)
    if (!from || !to) continue
    const circuitId = match[1]!
    const domain = match[3]!
    const rootKey =
      from.kind === 'protection' || from.kind === 'circuit'
        ? `${circuitId}:input:${domain}`
        : undefined
    const branch = to.source.entityId
      ? branches.get(`${circuitId}:${to.source.entityId}`)
      : undefined
    const connection: CircuitWireConnection = {
      anchor,
      circuitId,
      domain,
      rootKey,
      targetKey: `${to.kind}:${to.source.entityId}:${domain}`,
      sourceKey: `${from.kind}:${from.source.entityId}:${domain}`,
      branchKey: branch && rootKey ? `${rootKey}:${branch}` : undefined,
      empty: edge.properties?.emptyCircuitWire === true,
      rail: (edge.properties?.wire as { medium?: string } | undefined)?.medium === 'busbar',
    }
    connections.set(anchor, connection)
    const siblings = feeds.get(connection.sourceKey) ?? []
    siblings.push(connection); feeds.set(connection.sourceKey, siblings)
    if (to.kind === 'endpoint' || to.kind === 'trunk-device')
      byTarget.set(connection.targetKey, connection)
    if (rootKey) {
      const group = roots.get(rootKey) ?? []
      group.push(connection)
      roots.set(rootKey, group)
    }
  }
  return { connections, byTarget, roots, feeds }
}
