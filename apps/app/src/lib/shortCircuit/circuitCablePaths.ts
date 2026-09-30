import { buildElectricalStructureSnapshot } from '@/lib/electricalStructure'
import type {
  ElectricalStructureRelationship,
  ElectricalStructureSnapshot,
} from '@/lib/electricalStructure'
import { isProjectV2 } from '@/lib/projectV2/migration'
import type { CableSpec } from '@/types/schema'
import type { ConductorMaterial } from './minimumShortCircuit'

/** One wire run on a circuit's conductive path, keyed by its structural wire anchor. */
export interface CircuitCableEdge {
  anchor: string
  fromNodeId: string
  toNodeId: string
  /** Stored length; undefined when none is stored. */
  lengthM?: number
  /** True when `lengthM` is an accepted plan estimate rather than typed. */
  lengthEstimated?: boolean
  cable?: CableSpec
  material?: ConductorMaterial
}

/** A path from the circuit's protection to one of its furthest points. */
export interface CircuitCablePath {
  circuitId: string
  edges: CircuitCableEdge[]
  /** Sum of entered lengths along the path; a lower bound when some are missing. */
  knownLengthM: number
  /** Anchors on this path without an entered length. */
  missingLengthAnchors: string[]
  /** Smallest positive cross-section on the path. */
  minSectionMm2?: number
}

interface WireProperties {
  anchor?: string
  lengthM?: number
  lengthEstimated?: boolean
  cable?: CableSpec
  material?: ConductorMaterial
}

function wireOf(relationship: ElectricalStructureRelationship): WireProperties | undefined {
  const wire = relationship.properties?.wire
  return wire && typeof wire === 'object' ? (wire as WireProperties) : undefined
}

/**
 * Directed cable edges per circuit from the structure snapshot. The home run is stored as
 * endpoint → circuit membership (`belongs-to-circuit`); it is reversed so every edge points
 * away from the protection. Endpoint chains are `ordered-before`.
 */
export function collectCircuitCableEdges(
  snapshot: ElectricalStructureSnapshot
): Map<string, CircuitCableEdge[]> {
  const circuitIdByNode = new Map<string, string>()
  for (const node of snapshot.nodes) {
    if (node.kind === 'circuit' && node.source.entityId)
      circuitIdByNode.set(node.id, node.source.entityId)
    else if (node.circuitId) circuitIdByNode.set(node.id, node.circuitId)
  }

  const edgesByCircuit = new Map<string, CircuitCableEdge[]>()
  for (const relationship of snapshot.relationships) {
    const wire = wireOf(relationship)
    if (!wire?.anchor) continue
    let from: string
    let to: string
    if (relationship.kind === 'belongs-to-circuit') {
      from = relationship.to
      to = relationship.from
    } else if (relationship.kind === 'ordered-before') {
      from = relationship.from
      to = relationship.to
    } else {
      continue
    }
    const circuitId = circuitIdByNode.get(from)
    if (!circuitId || circuitIdByNode.get(to) !== circuitId) continue
    const edges = edgesByCircuit.get(circuitId) ?? []
    edges.push({
      anchor: wire.anchor,
      fromNodeId: from,
      toNodeId: to,
      lengthM: typeof wire.lengthM === 'number' && wire.lengthM > 0 ? wire.lengthM : undefined,
      ...(wire.lengthEstimated === true ? { lengthEstimated: true } : {}),
      cable: wire.cable,
      material: wire.material,
    })
    edgesByCircuit.set(circuitId, edges)
  }
  return edgesByCircuit
}

/** Every root-to-leaf path of a circuit, starting at its circuit node. */
export function enumerateCircuitCablePaths(
  circuitId: string,
  edges: readonly CircuitCableEdge[]
): CircuitCablePath[] {
  const outgoing = new Map<string, CircuitCableEdge[]>()
  const hasIncoming = new Set<string>()
  for (const edge of edges) {
    const list = outgoing.get(edge.fromNodeId) ?? []
    list.push(edge)
    outgoing.set(edge.fromNodeId, list)
    hasIncoming.add(edge.toNodeId)
  }
  const roots = [...outgoing.keys()].filter((nodeId) => !hasIncoming.has(nodeId))

  const paths: CircuitCablePath[] = []
  const walk = (nodeId: string, trail: CircuitCableEdge[], visited: Set<string>) => {
    const next = (outgoing.get(nodeId) ?? []).filter((edge) => !visited.has(edge.toNodeId))
    if (next.length === 0) {
      if (trail.length > 0) paths.push(summarizePath(circuitId, trail))
      return
    }
    for (const edge of next) {
      visited.add(edge.toNodeId)
      walk(edge.toNodeId, [...trail, edge], visited)
      visited.delete(edge.toNodeId)
    }
  }
  for (const root of roots) walk(root, [], new Set([root]))
  return paths
}

function summarizePath(circuitId: string, edges: CircuitCableEdge[]): CircuitCablePath {
  let knownLengthM = 0
  const missingLengthAnchors: string[] = []
  let minSectionMm2: number | undefined
  for (const edge of edges) {
    if (edge.lengthM != null) knownLengthM += edge.lengthM
    else missingLengthAnchors.push(edge.anchor)
    const section = edge.cable?.sectionMm2
    if (section != null && section > 0 && (minSectionMm2 == null || section < minSectionMm2)) {
      minSectionMm2 = section
    }
  }
  return { circuitId, edges, knownLengthM, missingLengthAnchors, minSectionMm2 }
}

/** Cable paths for every circuit of a V2 project; empty for anything else. */
export function buildCircuitCablePathIndex(project: unknown): Map<string, CircuitCablePath[]> {
  const byCircuit = new Map<string, CircuitCablePath[]>()
  if (!isProjectV2(project)) return byCircuit
  for (const [id, edges] of collectCircuitCableEdges(buildElectricalStructureSnapshot(project))) {
    byCircuit.set(id, enumerateCircuitCablePaths(id, edges))
  }
  return byCircuit
}
