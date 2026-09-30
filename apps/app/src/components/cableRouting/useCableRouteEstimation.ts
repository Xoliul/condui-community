import { useMemo } from 'react'
import {
  estimateCableRoutes,
  type CableRouteEstimate,
  type CableRouteEstimation,
} from '@/lib/cableRouting/estimateCableRoutes'
import { useProjectStore } from '@/stores/projectStore'
import type { ProjectV2 } from '@/types/projectV2'

export interface CableRouteIndex extends CableRouteEstimation {
  byAnchor: Map<string, CableRouteEstimate>
}

const cache = new WeakMap<ProjectV2, CableRouteIndex>()

/** Estimation for a project, cached per immutable project snapshot. */
export function cableRouteIndexFor(project: ProjectV2): CableRouteIndex {
  let index = cache.get(project)
  if (!index) {
    const estimation = estimateCableRoutes(project)
    index = {
      ...estimation,
      byAnchor: new Map(estimation.routes.map((route) => [route.anchor, route])),
    }
    cache.set(project, index)
  }
  return index
}

/** Plan-based cable route estimates for the open project; `undefined` when `enabled` is false. */
export function useCableRouteEstimation(enabled = true): CableRouteIndex | undefined {
  const project = useProjectStore((s) => s.currentProject)
  return useMemo(
    () => (enabled && project ? cableRouteIndexFor(project) : undefined),
    [enabled, project]
  )
}
