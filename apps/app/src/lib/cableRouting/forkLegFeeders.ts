import type { Circuit } from '@/types/schema'
import { getBranchStems, hasOneWireRisers } from '@/lib/eendraad/oneWireRisers'

interface UnitStop {
  endpoint: { id: string }
}

/**
 * A one-wire fork leg starts in the box of the point it is attached to, so its cable can only
 * be fed from there. Nearest-first feeding must not reach the leg before that point: otherwise
 * the attachment point (a switch, say) ends up fed from its own fork light.
 */
export function createForkLegFeeders<Point>(circuit: Pick<Circuit, 'branches'>) {
  const attachmentByFirstEndpoint = new Map<string, string>()
  for (const branch of circuit.branches ?? []) {
    const first = branch.endpointIds[0]
    if (branch.forkFrom && first) attachmentByFirstEndpoint.set(first, branch.forkFrom.afterEndpointId)
  }
  // A riser is its own cable run: its first root is fed from the protection, later roots chain
  // only inside their own run. Circuits without risers skip this entirely.
  const stems = hasOneWireRisers(circuit) ? getBranchStems(circuit.branches ?? []) : null
  const stemOfEndpoint = new Map<string, number>()
  const firstOfRiser = new Set<string>()
  if (stems) {
    const seenStems = new Set<number>()
    for (const branch of circuit.branches ?? []) {
      branch.endpointIds.forEach((id) => stemOfEndpoint.set(id, stems.get(branch.id) ?? 0))
      const stem = branch.stem ?? 0
      if (!branch.forkFrom && stem > 0 && branch.endpointIds[0] && !seenStems.has(stem)) {
        seenStems.add(stem)
        firstOfRiser.add(branch.endpointIds[0])
      }
    }
  }
  const reached = new Map<string, Point>()
  return {
    reach(endpointId: string, point: Point) {
      reached.set(endpointId, point)
    },
    /**
     * The points a unit may be fed from: its attachment point once reached, nothing while that
     * point is still pending, else every live point (also when the attachment is not on the plan).
     */
    candidates(
      unit: readonly UnitStop[],
      pending: readonly (readonly UnitStop[])[],
      live: readonly Point[],
      endpointOfPoint?: (point: Point) => string | undefined
    ): readonly Point[] {
      const attachment = attachmentByFirstEndpoint.get(unit[0]!.endpoint.id)
      if (!attachment && stems && endpointOfPoint) {
        const first = unit[0]!.endpoint.id
        const stem = stemOfEndpoint.get(first) ?? 0
        return live.filter((point) => {
          const owner = endpointOfPoint(point)
          return owner === undefined || (!firstOfRiser.has(first) && stemOfEndpoint.get(owner) === stem)
        })
      }
      if (!attachment) return live
      const point = reached.get(attachment)
      if (point !== undefined) return [point]
      const waiting = pending.some((other) => other.some((stop) => stop.endpoint.id === attachment))
      return waiting ? [] : live
    },
  }
}
