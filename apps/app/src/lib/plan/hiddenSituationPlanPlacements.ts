import { readLegacyCompatibilityFloors } from '@/lib/projectV2/buildingFloors'
import {
  selectProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { ProjectWithOptionalV2Building } from '@/lib/projectV2/buildingFloors'
import type { Panel, Placement, SymbolKey } from '@/types/schema'
import { canSymbolAppearOnSituationPlan } from '@/lib/plan/situationPlanSymbolEligibility'
import { hasCustomPlacement, isAwaitingPlanPlacement } from '@/lib/plan/customPlacement'
import { getSituationPlanPlacementIdsHiddenByPanel } from '@/lib/plan/panelPlanPlacementVisibility'
import { isModularSocket } from '@/lib/socket/modularSocket'

export type ProjectWithSituationPlanPlacements = ProjectWithOptionalV2Electrical &
  ProjectWithOptionalV2Building

export interface HiddenSituationPlanPlacement {
  placementId: string
  floorId: string
  floorName: string
  endpointId: string
  endpointLabel: string
  circuitLabel: string
  symbol?: SymbolKey
  isCustomPlacement: boolean
}

/**
 * Returns hidden situation-plan placements that still belong to an endpoint in
 * the one-wire model. Stale hidden IDs and non-endpoint plan items are ignored.
 */
export function getHiddenSituationPlanPlacements(
  project: ProjectWithSituationPlanPlacements
): HiddenSituationPlanPlacement[] {
  return collectSituationPlanPlacements(project, ({ hiddenOnFloor }) => hiddenOnFloor)
}

/**
 * Returns automatic placements still waiting for the user to put them on the plan
 * (manual plan placement). Placements the user also hid are reported as hidden instead.
 */
export function getAwaitingSituationPlanPlacements(
  project: ProjectWithSituationPlanPlacements
): HiddenSituationPlanPlacement[] {
  return collectSituationPlanPlacements(
    project,
    ({ placement, hiddenOnFloor }) => !hiddenOnFloor && isAwaitingPlanPlacement(placement)
  )
}

function collectSituationPlanPlacements(
  project: ProjectWithSituationPlanPlacements,
  include: (item: { placement: Placement; hiddenOnFloor: boolean }) => boolean
): HiddenSituationPlanPlacement[] {
  const floors = readLegacyCompatibilityFloors(project)
  const hiddenByFloor = new Map(
    floors.map((floor) => [floor.id, new Set(floor.hiddenSitplanPlacementIds ?? [])])
  )
  const floorNameById = new Map(floors.map((floor) => [floor.id, floor.name]))
  const hiddenByPanel = getSituationPlanPlacementIdsHiddenByPanel(project)
  const seenPlacementIds = new Set<string>()
  const hidden: HiddenSituationPlanPlacement[] = []

  const visitPanels = (panels: Panel[]) => {
    for (const panel of panels) {
      const circuits = [
        ...panel.circuits,
        ...panel.protections.flatMap((protection) => protection.circuits ?? []),
      ]
      const seenCircuitIds = new Set<string>()
      for (const circuit of circuits) {
        if (seenCircuitIds.has(circuit.id)) continue
        seenCircuitIds.add(circuit.id)
        for (const endpoint of circuit.endpoints) {
          if (!canSymbolAppearOnSituationPlan(endpoint.symbol)) continue
          if (isModularSocket(endpoint)) continue
          for (const placement of endpoint.placements) {
            if (seenPlacementIds.has(placement.id)) continue
            const hiddenOnFloor = hiddenByFloor.get(placement.floorId)?.has(placement.id) === true
            if (!include({ placement, hiddenOnFloor })) continue
            if (hiddenByPanel.has(placement.id)) continue
            seenPlacementIds.add(placement.id)
            hidden.push({
              placementId: placement.id,
              floorId: placement.floorId,
              floorName: floorNameById.get(placement.floorId) ?? placement.floorId,
              endpointId: endpoint.id,
              endpointLabel: endpoint.label,
              circuitLabel: circuit.code?.trim() ?? '',
              symbol: endpoint.symbol,
              isCustomPlacement: hasCustomPlacement(placement),
            })
          }
        }
        for (const device of circuit.trunkDevices ?? []) {
          if (!canSymbolAppearOnSituationPlan(device.symbol)) continue
          for (const placement of device.placements ?? []) {
            if (seenPlacementIds.has(placement.id)) continue
            const hiddenOnFloor = hiddenByFloor.get(placement.floorId)?.has(placement.id) === true
            if (!include({ placement, hiddenOnFloor })) continue
            if (hiddenByPanel.has(placement.id)) continue
            seenPlacementIds.add(placement.id)
            hidden.push({
              placementId: placement.id,
              floorId: placement.floorId,
              floorName: floorNameById.get(placement.floorId) ?? placement.floorId,
              endpointId: device.id,
              endpointLabel: device.label,
              circuitLabel: circuit.code?.trim() ?? '',
              symbol: device.symbol,
              isCustomPlacement: hasCustomPlacement(placement),
            })
          }
        }
      }
      visitPanels(panel.subPanels ?? [])
    }
  }

  visitPanels(selectProjectElectricalPanels(project))
  return hidden.sort(
    (a, b) =>
      a.floorName.localeCompare(b.floorName) ||
      a.endpointLabel.localeCompare(b.endpointLabel) ||
      a.placementId.localeCompare(b.placementId)
  )
}
