import { resolvePlanWiringVisibility } from '@/lib/plan/planWiring'
import {
  replacePlanWiringVisibilityForProject,
  selectProjectPlanWiringVisibility,
} from '@/lib/projectV2/planWiring'
import type { ProjectV2 } from '@/types/projectV2'
import type { PlanWiringVisibility } from '@/types/schema'

/**
 * Store action `updatePlanWiringVisibility` on a mutable project, shared with the
 * `plan.setWiringVisibility` command. Merges onto the resolved visibility settings and stamps the
 * project; returns false (project untouched) when the merge changes nothing.
 */
export function updatePlanWiringVisibilityInProject(
  project: ProjectV2,
  updates: Partial<PlanWiringVisibility>,
  now: string
): boolean {
  const current = resolvePlanWiringVisibility({
    version: 1,
    routes: [],
    visibility: selectProjectPlanWiringVisibility(project),
  })
  const next = { ...current, ...updates }
  if (JSON.stringify(next) === JSON.stringify(current)) return false
  replacePlanWiringVisibilityForProject(project, next)
  project.project.updatedAt = now
  return true
}
