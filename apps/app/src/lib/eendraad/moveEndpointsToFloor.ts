import type { ProjectV2 } from '@/types/projectV2'
import type { Point } from '@/types/ui'
import { findEndpointById } from '@/lib/eendraad/projectElectricalDomain'
import { resolvePlacementsForFloorMove } from '@/lib/eendraad/floorMoveFromEendraad'
import { buildAutoSitplanPlacement } from '@/lib/plan/autoSitplanPlacement'
import { isVirtualOneWireOnlySymbol } from '@/lib/plan/situationPlanSymbolEligibility'
import {
  addPlacementToProject,
  movePlanPlacementsToFloorInProject,
} from '@/lib/plan/placementMutations'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'

export interface MoveEndpointsToFloorResult {
  /** Plan placements that already existed and were retargeted to the floor. */
  movedPlacementIds: string[]
  /** Placements created for endpoints that were not on any plan yet. */
  createdPlacementIds: string[]
  /** Endpoints whose placements were created or moved. */
  endpointIds: string[]
}

/**
 * One-wire "move to floor": retargets each endpoint's plan placements to the floor, creating an
 * automatic placement for endpoints that have none. The store-less core of the context-menu action.
 */
export function moveEndpointsToFloorInProject(
  project: ProjectV2,
  endpointIds: readonly string[],
  floorId: string,
  options: { activeFloorId: string | null; preferredPlanPos?: Point; newId: () => string }
): MoveEndpointsToFloorResult {
  const movedPlacementIds: string[] = []
  const createdPlacementIds: string[] = []
  const touched = new Set<string>()
  for (const endpointId of endpointIds) {
    let latest: ReturnType<typeof findEndpointById>
    for (const panel of getEditableProjectElectricalPanels(project)) {
      latest = findEndpointById(panel, endpointId)
      if (latest) break
    }
    if (!latest) continue
    const placements = resolvePlacementsForFloorMove(latest.endpoint, options.activeFloorId)
    if (placements.length > 0) {
      movedPlacementIds.push(...placements.map((placement) => placement.id))
      touched.add(endpointId)
      continue
    }
    if (isVirtualOneWireOnlySymbol(latest.endpoint.symbol)) continue
    const built = buildAutoSitplanPlacement(project, {
      circuitId: latest.circuit.id,
      floorId,
      placementId: options.newId(),
      ...(options.preferredPlanPos ? { preferredPlanPos: options.preferredPlanPos } : {}),
    })
    if (built && addPlacementToProject(project, endpointId, built)) {
      createdPlacementIds.push(built.id)
      touched.add(endpointId)
    }
  }
  if (movedPlacementIds.length > 0) {
    movePlanPlacementsToFloorInProject(
      project,
      movedPlacementIds.map((id) => ({ id })),
      floorId
    )
  }
  return { movedPlacementIds, createdPlacementIds, endpointIds: [...touched] }
}
