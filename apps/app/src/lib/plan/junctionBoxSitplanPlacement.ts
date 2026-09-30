import {
  selectProjectBuildingFloors,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import { getAllCircuits } from '@/lib/eendraad/projectElectricalDomain'
import {
  selectProjectElectricalInstallation,
  selectProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { generateId } from '@/utils/project'
import { buildAutoSitplanPlacement } from './autoSitplanPlacement'
import { collectSharedJunctions, type JunctionOccurrence } from './sharedJunctionPlacements'
import { resolveCircuitSitplanTargetFloorId } from './sitplanTargetFloor'

type JunctionBoxSitplanProject = ProjectWithOptionalV2Building &
  ProjectWithOptionalV2Electrical & {
    project?: { lastActiveFloorId?: string | null }
  }

/**
 * Backfills situation-plan placements for junction boxes and junction panels created before
 * they became situation-plan symbols. A junction box or panel is one physical object however
 * often the one-wire draws it, so each identity gets one placement: occurrences sharing an
 * identity with a placed box stay unplaced. Existing placements are left untouched.
 */
export function healJunctionBoxSitplanPlacements(project: JunctionBoxSitplanProject): boolean {
  const floors = selectProjectBuildingFloors(project)
  const fallbackFloorId = floors[0]?.id
  if (!fallbackFloorId) return false

  const placementFor = (circuitId: string | undefined) => {
    if (!circuitId) return null
    const floorId = resolveCircuitSitplanTargetFloorId(project, null, circuitId) ?? fallbackFloorId
    return buildAutoSitplanPlacement(project, {
      circuitId,
      floorId,
      placementId: generateId(),
      ignoreManualPlacementPreference: true,
    })
  }
  const placeOwner = (occurrence: JunctionOccurrence): boolean => {
    const placement = placementFor(occurrence.circuitId)
    if (!placement) return false
    occurrence.entity.placements = [...(occurrence.entity.placements ?? []), placement]
    return true
  }

  let changed = false
  const grouped = new Set<string>()
  for (const junction of collectSharedJunctions(project).values()) {
    for (const occurrence of junction.occurrences) grouped.add(occurrence.entity.id)
    if (junction.symbol === 'junction_box') {
      if (junction.owner) continue
      // Only circuit occurrences can be placed automatically; the first one becomes the box.
      const first = junction.occurrences.find((occurrence) => occurrence.circuitId)
      if (first && placeOwner(first)) changed = true
      continue
    }
    if (junction.panelPlacements?.length) continue
    const circuitId = junction.occurrences.find((occurrence) => occurrence.circuitId)?.circuitId
    const placement = placementFor(circuitId)
    const installation = selectProjectElectricalInstallation(project)
    if (!placement || !installation) continue
    const first = junction.occurrences[0]!.entity
    installation.junctionPanelPlacements = [
      ...(installation.junctionPanelPlacements ?? []),
      {
        id: placement.id,
        label: (first.junctionIdentity ?? first.label ?? junction.identity).trim(),
        floorId: placement.floorId,
        pos: placement.pos,
        rotationDeg: placement.rotationDeg,
        scale: placement.scale,
        layer: placement.layer,
      },
    ]
    changed = true
  }

  // Unnamed junction boxes are each their own box.
  for (const junction of collectUnnamedJunctionBoxes(project, grouped)) {
    if (placeOwner(junction)) changed = true
  }
  return changed
}

function collectUnnamedJunctionBoxes(
  project: JunctionBoxSitplanProject,
  grouped: ReadonlySet<string>
): JunctionOccurrence[] {
  const result: JunctionOccurrence[] = []
  for (const junction of collectAllJunctionBoxOccurrences(project)) {
    if (grouped.has(junction.entity.id)) continue
    if ((junction.entity.placements?.length ?? 0) > 0) continue
    result.push(junction)
  }
  return result
}

function collectAllJunctionBoxOccurrences(project: JunctionBoxSitplanProject): JunctionOccurrence[] {
  const result: JunctionOccurrence[] = []
  for (const circuit of selectProjectElectricalPanels(project).flatMap(getAllCircuits)) {
    for (const endpoint of circuit.endpoints) {
      if (endpoint.symbol === 'junction_box') {
        result.push({ kind: 'endpoint', entity: endpoint, circuitId: circuit.id })
      }
    }
    for (const device of circuit.trunkDevices ?? []) {
      if (device.symbol === 'junction_box') {
        result.push({ kind: 'trunkDevice', entity: device, circuitId: circuit.id })
      }
    }
  }
  return result
}
