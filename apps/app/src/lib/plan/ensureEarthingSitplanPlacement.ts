import type { Point2 } from '@/types/schema'
import { useProjectStore } from '@/stores/projectStore'
import {
  selectProjectElectricalInstallation,
  selectProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { installationHasAnyEarthing } from '@/lib/eendraad/panelGround'
import {
  buildDefaultEarthingSitplanPlacement,
  findEarthingPlacementOnFloor,
  getEarthingPlacements,
} from '@/lib/plan/earthingSitplanPlacement'

/**
 * Ensure the earthing symbol exists on the given sitplan floor when ground is enabled.
 * Returns placement id, or null when ground is disabled or there is no project.
 *
 * Kept apart from the pure earthing placement helpers so the validation worker,
 * which reaches those helpers, never loads the project store.
 */
export function ensureEarthingSitplanPlacement(
  floorId: string,
  pos?: Point2,
): string | null {
  const store = useProjectStore.getState()
  const project = store.currentProject
  const installation = project ? selectProjectElectricalInstallation(project) : undefined
  if (
    !project ||
    !installation ||
    !installationHasAnyEarthing(selectProjectElectricalPanels(project), installation)
  ) {
    return null
  }

  const existing = findEarthingPlacementOnFloor(project, floorId)
  if (existing) {
    if (pos) store.updateEarthingPlacement(existing.id, { pos })
    return existing.id
  }

  const anyExisting = getEarthingPlacements(installation)
  if (anyExisting.length > 0) {
    return anyExisting[0]!.id
  }

  const placement = buildDefaultEarthingSitplanPlacement(project, floorId, pos)
  store.addEarthingPlacement(placement)
  return placement.id
}
