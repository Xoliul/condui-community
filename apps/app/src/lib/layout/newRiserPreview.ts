/**
 * Preview of the new-riser drop zone, read from the simulated post-drop layout (the same command-equivalent
 * simulation the commit uses): the cable of the riser the drop would create, from the split point on the trunk to the
 * right and up, with its row wires, and the symbols that land on it. Never a hand-drawn approximation.
 */
import type { WireSegment } from '@/types/schema'
import type { Point } from '@/types/ui'
import { getMaxStem } from '@/lib/eendraad/oneWireRisers'
import { findCircuitInProject } from './eendraadPreviewModel'
import type { BottomUpLayoutResult } from './bottomUpLayout'

export interface NewRiserPreviewGeometry {
  /** Line segments of the new cable as [x1, y1, x2, y2]. */
  cable: number[][]
  /** Where the new cable leaves the trunk (the split). */
  junction: Point | null
  /** Centres of the symbols the drop creates or moves onto the riser. */
  symbols: Point[]
}

export function getNewRiserPreviewGeometry(graph: {
  project: Parameters<typeof findCircuitInProject>[0]
  layout: BottomUpLayoutResult
  wireSegments: readonly WireSegment[]
  createdEndpointIds: readonly string[]
}, circuitId: string): NewRiserPreviewGeometry | null {
  const circuit = findCircuitInProject(graph.project, circuitId)
  const stem = circuit ? getMaxStem(circuit) : 0
  if (!circuit || stem < 1) return null
  const wires = graph.wireSegments.filter((wire) => wire.circuitId === circuitId && wire.riserStem === stem)
  if (!wires.length) return null
  const leads = wires.filter((wire) => wire.startPoint.y === wire.endPoint.y && wire.trunkContinuation)
  const lead = leads.reduce<WireSegment | null>((best, wire) => !best || wire.startPoint.x < best.startPoint.x ? wire : best, null)
  const added = new Set(graph.createdEndpointIds)
  return {
    cable: wires.map((wire) => [wire.startPoint.x, wire.startPoint.y, wire.endPoint.x, wire.endPoint.y]),
    junction: lead ? { x: lead.startPoint.x, y: lead.startPoint.y } : null,
    symbols: graph.layout.panels.flatMap((panel) => panel.elements)
      .filter((element) => element.type === 'endpoint' && added.has(element.endpointId ?? '')).map((element) => element.position),
  }
}
