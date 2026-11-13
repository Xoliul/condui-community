import type { Circuit } from '@/types/schema'

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
      live: readonly Point[]
    ): readonly Point[] {
      const attachment = attachmentByFirstEndpoint.get(unit[0]!.endpoint.id)
      if (!attachment) return live
      const point = reached.get(attachment)
      if (point !== undefined) return [point]
      const waiting = pending.some((other) => other.some((stop) => stop.endpoint.id === attachment))
      return waiting ? [] : live
    },
  }
}
