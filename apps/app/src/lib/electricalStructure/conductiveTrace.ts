/** Directed topological connectivity. Enclosure membership is deliberately absent from this API. */
export interface ConductiveEdge {
  id: string
  from: string
  to: string
}
export interface ConductiveGraph {
  nodeIds: ReadonlySet<string>
  edges: readonly ConductiveEdge[]
}
export interface ConductiveTrace {
  nodeIds: Set<string>
  edgeIds: Set<string>
  /** Source-first chain through the selection, stopping at each branching boundary. */
  path: string[]
  upstreamAlternatives: number
  downstreamAlternatives: number
  cycle: boolean
}

export function traceConductiveGraph(
  graph: ConductiveGraph,
  selection: { nodeId: string } | { edgeId: string },
  direction: 'upstream' | 'downstream' | 'both'
): ConductiveTrace {
  const incoming = new Map<string, ConductiveEdge[]>()
  const outgoing = new Map<string, ConductiveEdge[]>()
  for (const edge of graph.edges) {
    if (!graph.nodeIds.has(edge.from) || !graph.nodeIds.has(edge.to)) continue
    const inputs = incoming.get(edge.to) ?? []
    inputs.push(edge)
    incoming.set(edge.to, inputs)
    const outputs = outgoing.get(edge.from) ?? []
    outputs.push(edge)
    outgoing.set(edge.from, outputs)
  }
  const selectedEdge =
    'edgeId' in selection ? graph.edges.find((e) => e.id === selection.edgeId) : undefined
  const start = 'nodeId' in selection ? selection.nodeId : selectedEdge?.to
  const result: ConductiveTrace = {
    nodeIds: new Set(),
    edgeIds: new Set(),
    path: [],
    upstreamAlternatives: 0,
    downstreamAlternatives: 0,
    cycle: false,
  }
  if (!start || !graph.nodeIds.has(start)) return result
  result.nodeIds.add(start)
  if (selectedEdge) {
    result.nodeIds.add(selectedEdge.from)
    result.edgeIds.add(selectedEdge.id)
  }
  const walk = (root: string, upstream: boolean) => {
    const adjacency = upstream ? incoming : outgoing
    const next = (e: ConductiveEdge) => (upstream ? e.from : e.to)
    // Independent directed walks: "both" must not turn upstream then down a sibling branch.
    const visited = new Set([root])
    const queue = [root]
    const traversed: ConductiveEdge[] = []
    for (let i = 0; i < queue.length; i++) {
      for (const edge of adjacency.get(queue[i]!) ?? []) {
        result.edgeIds.add(edge.id) // Include reconverging/parallel edges, not only a BFS tree.
        traversed.push(edge)
        const id = next(edge)
        result.nodeIds.add(id)
        if (!visited.has(id)) {
          visited.add(id)
          queue.push(id)
        }
      }
    }
    // Kahn's algorithm distinguishes a directed cycle from a harmless reconvergence.
    const degrees = new Map([...visited].map((id) => [id, 0]))
    for (const e of traversed) degrees.set(next(e), (degrees.get(next(e)) ?? 0) + 1)
    const ready = [...degrees].filter(([, n]) => n === 0).map(([id]) => id)
    for (let i = 0; i < ready.length; i++) {
      for (const e of adjacency.get(ready[i]!) ?? []) {
        const id = next(e),
          degree = degrees.get(id)! - 1
        degrees.set(id, degree)
        if (degree === 0) ready.push(id)
      }
    }
    result.cycle ||= ready.length !== visited.size
    const path = [root]
    let alternatives = 0
    for (;;) {
      const edges = adjacency.get(path.at(-1)!) ?? []
      if (edges.length !== 1) {
        alternatives = edges.length
        break
      }
      const id = next(edges[0]!)
      if (path.includes(id)) break
      path.push(id)
    }
    return { path, alternatives }
  }
  const upstreamRoot = selectedEdge?.from ?? start
  const upstream =
    direction !== 'downstream'
      ? walk(upstreamRoot, true)
      : { path: [upstreamRoot], alternatives: 0 }
  const downstream =
    direction !== 'upstream' ? walk(start, false) : { path: [start], alternatives: 0 }
  result.path = [...upstream.path]
    .reverse()
    .concat(selectedEdge ? downstream.path : downstream.path.slice(1))
  if (result.cycle) result.path = [start]
  result.upstreamAlternatives = upstream.alternatives
  result.downstreamAlternatives = downstream.alternatives
  return result
}
