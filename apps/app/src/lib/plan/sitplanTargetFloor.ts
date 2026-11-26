import {
  selectProjectBuildingFloors,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import {
  selectProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { Circuit, Panel } from '@/types/schema'
import { findPanelOwnDistributionEndpoint } from '@/lib/eendraad/panelSupplyLink'

type SitplanTargetFloorProject = ProjectWithOptionalV2Building & {
  project?: { lastActiveFloorId?: string | null }
}

/**
 * Floor for auto sitplan placement (one-wire drops, orphan "missing placement" fix).
 *
 * 1. `activeFloorId` from UI when it exists on this project (floor picker / plan tab).
 * 2. Else `project.lastActiveFloorId` when valid (persisted last plan floor for this project).
 *
 * Never uses `floors[0]` — that was wrong when the user worked on another floor.
 */
export function resolveSitplanTargetFloorId(
  project: SitplanTargetFloorProject,
  uiActiveFloorId: string | null
): string | null {
  const floors = selectProjectBuildingFloors(project)
  if (!floors.length) return null

  if (uiActiveFloorId && floors.some((f) => f.id === uiActiveFloorId)) {
    return uiActiveFloorId
  }

  const last = project.project?.lastActiveFloorId
  if (last && floors.some((f) => f.id === last)) {
    return last
  }

  return null
}

type CircuitSitplanTargetProject = SitplanTargetFloorProject & ProjectWithOptionalV2Electrical

function findOwningPanelAndCircuit(
  panels: Panel[],
  circuitId: string
): { panel: Panel; circuit: Circuit } | null {
  for (const panel of panels) {
    const circuits = [
      ...(panel.circuits ?? []),
      ...(panel.protections ?? []).flatMap((protection) => protection.circuits ?? []),
    ]
    const circuit = circuits.find((candidate) => candidate.id === circuitId)
    if (circuit) return { panel, circuit }
    const nested = findOwningPanelAndCircuit(panel.subPanels ?? [], circuitId)
    if (nested) return nested
  }
  return null
}

/**
 * Resolve a floor for a newly-created endpoint when the remembered UI floor is stale.
 * Prefer an existing circuit mate, then the owning panel's own plan symbol. With a single
 * floor, there is also an unambiguous destination when the circuit has no placements yet.
 */
export function resolveCircuitSitplanTargetFloorId(
  project: CircuitSitplanTargetProject,
  uiActiveFloorId: string | null,
  circuitId: string
): string | null {
  const preferred = resolveSitplanTargetFloorId(project, uiActiveFloorId)
  if (preferred) return preferred

  const floors = selectProjectBuildingFloors(project)
  if (floors.length === 1) return floors[0]!.id
  const validFloorIds = new Set(floors.map((floor) => floor.id))
  const owner = findOwningPanelAndCircuit(selectProjectElectricalPanels(project), circuitId)
  if (!owner) return null

  for (const endpoint of owner.circuit.endpoints) {
    const placement = endpoint.placements?.find((entry) => validFloorIds.has(entry.floorId))
    if (placement) return placement.floorId
  }

  const panelEndpoint = findPanelOwnDistributionEndpoint(owner.panel)
  const panelFloor = panelEndpoint?.placements?.find((placement) => validFloorIds.has(placement.floorId))
  if (panelFloor) return panelFloor.floorId

  return null
}
