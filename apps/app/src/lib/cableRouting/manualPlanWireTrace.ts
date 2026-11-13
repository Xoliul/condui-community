import type { PlanWireRoute, Point2 } from '@/types/schema'

export interface ManualTrace {
  /** Waypoints in travel order from `from` to `to`. */
  waypoints: Point2[]
  /** Moved riser position, for traces arriving from another floor. */
  riserPos?: Point2
}

interface TraceEnd {
  floorId: string
  placementId?: string
}

/**
 * The manual plan wire trace drawn for this placement pair, if any. Traces live on the floor
 * where the cable arrives; a same-floor trace may be stored in either direction.
 */
export function manualTraceFor(
  traces: readonly PlanWireRoute[],
  from: TraceEnd,
  to: TraceEnd
): ManualTrace | undefined {
  if (!from.placementId || !to.placementId) return undefined
  for (const trace of traces) {
    if (trace.source !== 'manual' || trace.hidden || trace.floorId !== to.floorId) continue
    const a = trace.from.placementId
    const b = trace.to.placementId
    if (a === from.placementId && b === to.placementId) {
      return { waypoints: trace.waypoints ?? [], riserPos: trace.riser?.pos }
    }
    if (from.floorId === to.floorId && a === to.placementId && b === from.placementId) {
      return { waypoints: [...(trace.waypoints ?? [])].reverse() }
    }
  }
  return undefined
}
