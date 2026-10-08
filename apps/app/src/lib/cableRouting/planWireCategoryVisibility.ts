import type { PlanWireRoute, PlanWiringVisibility } from '@/types/schema'
import type { CableRouteCategory } from './estimateCableRoutes'
import type { CableTraceInfo } from './cableRoutePlanWires'

export const PLAN_WIRE_CATEGORIES: readonly CableRouteCategory[] = [
  'lighting',
  'sockets',
  'devices',
  'feeders',
  'supply',
  'dc',
  'earthing',
  'other',
]

/** Wire mode follows colour groups, including manually edited traces and cross-floor cables. */
export function isWireToolTraceVisible(
  route: Pick<PlanWireRoute, 'wireAnchor' | 'circuitId' | 'kind'>,
  info: ReadonlyMap<string, CableTraceInfo>,
  categoryByCircuit: ReadonlyMap<string, CableRouteCategory>,
  visibility: PlanWiringVisibility
): boolean {
  if (visibility.wireToolWiresVisible === false) return false
  const category =
    (route.wireAnchor ? info.get(route.wireAnchor)?.category : undefined) ??
    categoryByCircuit.get(route.circuitId) ??
    (route.kind === 'lighting-control'
      ? 'lighting'
      : route.kind === 'sockets'
        ? 'sockets'
        : 'other')
  return visibility.wireToolCategoriesVisible?.[category] !== false
}
