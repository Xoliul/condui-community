import type {
  ElectricalStructureIndex,
  ElectricalStructureRelationship,
  ElectricalStructureTraceOptions,
  ElectricalStructureTraceResult,
  ElectricalStructureTraceStep,
  ElectricalStructureTraceStop,
  ElectricalStructureSnapshot,
} from './types'

function append(
  map: Map<string, ElectricalStructureRelationship[]>,
  key: string,
  value: ElectricalStructureRelationship
): void {
  map.set(key, [...(map.get(key) ?? []), value])
}

export function buildElectricalStructureIndex(
  snapshot: ElectricalStructureSnapshot
): ElectricalStructureIndex {
  const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]))
  const outgoingByNodeId = new Map<string, ElectricalStructureRelationship[]>()
  const incomingByNodeId = new Map<string, ElectricalStructureRelationship[]>()
  for (const relationship of snapshot.relationships) {
    append(outgoingByNodeId, relationship.from, relationship)
    append(incomingByNodeId, relationship.to, relationship)
  }
  const sort = (map: Map<string, ElectricalStructureRelationship[]>) => {
    for (const [id, values] of map)
      map.set(
        id,
        values.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
      )
  }
  sort(outgoingByNodeId)
  sort(incomingByNodeId)
  return { snapshot, nodesById, outgoingByNodeId, incomingByNodeId }
}

/** Structural inventory traversal, including ownership/containment. This is not a conductive
 * path and must not drive electrical highlighting or calculations; use traceConductiveGraph
 * with resolved electrical edges for that purpose. */
export function traceElectricalStructure(
  index: ElectricalStructureIndex,
  startNodeId: string,
  options: ElectricalStructureTraceOptions = {}
): ElectricalStructureTraceResult {
  const start = index.nodesById.get(startNodeId)
  if (!start)
    return {
      startNodeId,
      outcome: 'unavailable',
      steps: [],
      stops: [
        {
          code: 'START_NOT_FOUND',
          path: [],
          message: `Snapshot node ${startNodeId} does not exist.`,
        },
      ],
    }
  if (options.requestedDetail === 'cable' || options.requestedDetail === 'terminal') {
    return {
      startNodeId,
      outcome: 'unavailable',
      steps: [
        {
          depth: 0,
          nodeId: startNodeId,
          direction: 'start',
          knowledge: start.knowledge,
          inferenceRuleId: start.inferenceRuleId,
          diagnosticCode: start.diagnosticCode,
        },
      ],
      stops: [
        {
          code: 'UNMODELED_DETAIL',
          nodeId: startNodeId,
          path: [startNodeId],
          message: `V2 does not model individual physical ${options.requestedDetail} hops.`,
        },
      ],
    }
  }
  const direction = options.direction ?? 'both'
  const maxDepth = Math.max(0, options.maxDepth ?? 64)
  const allowed = options.relationshipKinds ? new Set(options.relationshipKinds) : undefined
  const excludedFromDefaultElectricalTrace = new Set(['grounds', 'represents-panel'])
  const steps: ElectricalStructureTraceStep[] = [
    {
      depth: 0,
      nodeId: startNodeId,
      direction: 'start',
      knowledge: start.knowledge,
      inferenceRuleId: start.inferenceRuleId,
      diagnosticCode: start.diagnosticCode,
    },
  ]
  const stops: ElectricalStructureTraceStop[] = []
  const queue: Array<{ nodeId: string; depth: number; path: string[] }> = [
    { nodeId: startNodeId, depth: 0, path: [startNodeId] },
  ]
  const visited = new Set([startNodeId])
  let ambiguous = start.knowledge === 'ambiguous'
  while (queue.length) {
    const current = queue.shift()!
    const candidates: Array<{
      edge: ElectricalStructureRelationship
      nextId: string
      stepDirection: 'upstream' | 'downstream'
    }> = []
    const upstreamForward = new Set([
      'belongs-to-circuit',
      'protected-by',
      'represents-occurrence-of',
      'junction-membership',
      'supply-handoff',
    ])
    const addSemantic = (wanted: 'upstream' | 'downstream') => {
      for (const edge of index.outgoingByNodeId.get(current.nodeId) ?? []) {
        const semantic = upstreamForward.has(edge.kind) ? 'upstream' : 'downstream'
        if (semantic === wanted) candidates.push({ edge, nextId: edge.to, stepDirection: wanted })
      }
      for (const edge of index.incomingByNodeId.get(current.nodeId) ?? []) {
        const semantic = upstreamForward.has(edge.kind) ? 'downstream' : 'upstream'
        if (semantic === wanted) candidates.push({ edge, nextId: edge.from, stepDirection: wanted })
      }
    }
    if (direction !== 'downstream') addSemantic('upstream')
    if (direction !== 'upstream') addSemantic('downstream')
    candidates.sort(
      (a, b) =>
        a.edge.kind.localeCompare(b.edge.kind) ||
        a.edge.id.localeCompare(b.edge.id) ||
        a.nextId.localeCompare(b.nextId)
    )
    for (const candidate of candidates) {
      if (!allowed && excludedFromDefaultElectricalTrace.has(candidate.edge.kind)) continue
      if (allowed && !allowed.has(candidate.edge.kind)) continue
      const next = index.nodesById.get(candidate.nextId)
      if (!next) continue
      if (
        (options.panelId && next.panelId !== options.panelId && next.kind !== 'panel') ||
        (options.circuitId && next.circuitId !== options.circuitId && next.kind !== 'circuit')
      )
        continue
      const path = [...current.path, next.id]
      if (current.path.includes(next.id)) {
        stops.push({
          code: 'CYCLE_DETECTED',
          nodeId: next.id,
          path,
          message: `Cycle detected at ${next.id}.`,
        })
        continue
      }
      if (current.depth >= maxDepth) {
        stops.push({
          code: 'MAX_DEPTH',
          nodeId: current.nodeId,
          path: current.path,
          message: `Trace stopped at maximum depth ${maxDepth}.`,
        })
        continue
      }
      if (next.kind === 'missing-target')
        stops.push({
          code: 'MISSING_TARGET',
          nodeId: next.id,
          path,
          message: next.label ?? 'A referenced target is missing.',
        })
      if (candidate.edge.knowledge === 'ambiguous' || next.knowledge === 'ambiguous')
        ambiguous = true
      if (!visited.has(next.id)) {
        visited.add(next.id)
        steps.push({
          depth: current.depth + 1,
          nodeId: next.id,
          viaRelationshipId: candidate.edge.id,
          direction: candidate.stepDirection,
          knowledge: candidate.edge.knowledge,
          inferenceRuleId: candidate.edge.inferenceRuleId,
          diagnosticCode: candidate.edge.diagnosticCode,
        })
        if (next.kind !== 'missing-target')
          queue.push({ nodeId: next.id, depth: current.depth + 1, path })
      }
    }
  }
  stops.sort(
    (a, b) => a.code.localeCompare(b.code) || a.path.join('/').localeCompare(b.path.join('/'))
  )
  return {
    startNodeId,
    outcome: ambiguous ? 'ambiguous' : stops.length ? 'partial' : 'complete',
    steps,
    stops,
  }
}
