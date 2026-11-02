/**
 * Alt-drag duplicate on the situation plan, on a mutable project: another plan occurrence of a
 * multiplier symbol or supply device, or a new endpoint with the properties of the source, plus
 * the placement the pointer then carries. Shared by the `plan.altDuplicate` command; the editor
 * adapter in `planAltDragDuplicate.ts` owns the selection and pointer handling.
 */

import {
  duplicateEndpointOnCircuit,
  endpointSymbolCanBeDuplicated,
} from '@/lib/eendraad/duplicateEndpoint'
import { addEndpointToProject } from '@/lib/eendraad/endpointMutations'
import { updateCircuitInProject } from '@/lib/eendraad/circuitMutations'
import {
  ensureSitplanPlacementsAt,
  type SitplanPlacementTarget,
} from '@/lib/eendraad/duplicateSitplanHelpers'
import { findTrunkDeviceInProject } from '@/lib/eendraad/findTrunkDeviceInProject'
import { findCircuitById, findEndpointById } from '@/lib/eendraad/projectElectricalDomain'
import { syncSupplyDeviceMultiplierInProject } from '@/lib/eendraad/supplyDeviceMultiplierInProject'
import { getEndpointPlanWallFacingSide } from '@/lib/plan/planWallOrientation'
import {
  addPlacementToProject,
  deletePlacementsFromProject,
  resolvePlanPlacement,
  updatePlacementInProject,
} from '@/lib/plan/placementMutations'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import {
  getSupplyDeviceMultiplier,
  supportsSupplyDeviceMultiplier,
} from '@/lib/supplyAssembly/inverterMultipliers'
import type { ProjectV2 } from '@/types/projectV2'
import type { Circuit, Placement } from '@/types/schema'
import { endpointSupportsMultiplier } from '@/utils/endpointMultipliers'

/** Initial nudge so the copy is visible while dragging; the pointer position replaces it. */
export const PLAN_ALT_DRAG_COPY_OFFSET = { x: 24, y: 24 } as const

export type PlanAltDuplicateSourceRef =
  | { kind: 'endpoint'; id: string }
  | { kind: 'trunkDevice'; id: string }

export interface PlanAltDuplicateResult {
  placementId: string
  createdEndpointId?: string
  circuitId?: string
}

function endpointFor(project: ProjectV2, id: string) {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const found = findEndpointById(panel, id)
    if (found) return found
  }
  return undefined
}

function circuitFor(project: ProjectV2, id: string): Circuit | undefined {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const found = findCircuitById(panel, id)
    if (found) return found.circuit
  }
  return undefined
}

/** Whether the symbol has an alt-drag duplication strategy in this project. */
export function canAltDuplicateInProject(
  project: ProjectV2,
  source: PlanAltDuplicateSourceRef
): boolean {
  if (source.kind === 'trunkDevice') {
    const device = findTrunkDeviceInProject(project, source.id)
    return !!device && supportsSupplyDeviceMultiplier(device)
  }
  const endpoint = endpointFor(project, source.id)?.endpoint
  return (
    !!endpoint && (endpointSupportsMultiplier(endpoint) || endpointSymbolCanBeDuplicated(endpoint))
  )
}

/**
 * Creates the copy and returns its placement. `pos` is where the pointer ended; without it the
 * copy stays at the default nudge from the placement being dragged. Returns null when the
 * source cannot be duplicated.
 */
export function altDuplicatePlacementInProject(
  project: ProjectV2,
  input: {
    source: PlanAltDuplicateSourceRef
    refPlacementId: string
    pos?: Placement['pos']
    sitplan: SitplanPlacementTarget
  },
  newId: () => string
): PlanAltDuplicateResult | null {
  const refPlacement = resolvePlanPlacement(project, input.refPlacementId)?.placement as
    | Placement
    | undefined
  if (!refPlacement) return null

  let result: PlanAltDuplicateResult | null = null
  if (input.source.kind === 'trunkDevice') {
    const device = findTrunkDeviceInProject(project, input.source.id)
    if (!device || !supportsSupplyDeviceMultiplier(device)) return null
    const synced = syncSupplyDeviceMultiplierInProject(
      project,
      device.id,
      getSupplyDeviceMultiplier(device) + 1,
      { activeFloorId: input.sitplan.activeFloorId, sourcePlacement: refPlacement, newId }
    )
    if (!synced) return null
    const placementId = findTrunkDeviceInProject(project, device.id)?.placements?.at(-1)?.id
    if (!placementId) return null
    result = { placementId }
  } else {
    const found = endpointFor(project, input.source.id)
    if (!found) return null
    const { endpoint, circuit } = found
    if (endpointSupportsMultiplier(endpoint)) {
      const placementId = newId()
      const added = addPlacementToProject(project, endpoint.id, {
        ...refPlacement,
        id: placementId,
        pos: {
          x: refPlacement.pos.x + PLAN_ALT_DRAG_COPY_OFFSET.x,
          y: refPlacement.pos.y + PLAN_ALT_DRAG_COPY_OFFSET.y,
        },
        ...(getEndpointPlanWallFacingSide(endpoint) && refPlacement.rotationMode !== 'explicit'
          ? { rotationDeg: 0 }
          : {}),
        locked: false,
      })
      result = { placementId, circuitId: added ?? circuit.id }
    } else if (endpointSymbolCanBeDuplicated(endpoint)) {
      const duplicated = duplicateEndpointOnCircuit(
        project,
        { circuitId: circuit.id, sourceEndpointId: endpoint.id, context: 'plan' },
        {
          newId,
          getCircuitById: (id) => circuitFor(project, id),
          getEndpointById: (id) => endpointFor(project, id)?.endpoint,
          addEndpoint: (circuitId, clone, after) =>
            addEndpointToProject(project, circuitId, clone, after, undefined, newId),
          updateCircuit: (circuitId, updates) => updateCircuitInProject(project, circuitId, updates),
          setSelection: undefined,
        }
      )
      const createdEndpointId = duplicated.newEndpointId
      if (!duplicated.ok || !createdEndpointId) return null
      const clone = endpointFor(project, createdEndpointId)?.endpoint
      if (!clone) return null
      // The clone arrives with offset placements; the pointer carries a single one instead.
      const clonedPlacementIds = (clone.placements ?? []).map((placement) => placement.id)
      if (clonedPlacementIds.length > 0) deletePlacementsFromProject(project, clonedPlacementIds)
      const placementId = newId()
      addPlacementToProject(project, createdEndpointId, {
        id: placementId,
        floorId: refPlacement.floorId,
        layer: refPlacement.layer ?? 'electrical',
        pos: {
          x: refPlacement.pos.x + PLAN_ALT_DRAG_COPY_OFFSET.x,
          y: refPlacement.pos.y + PLAN_ALT_DRAG_COPY_OFFSET.y,
        },
        rotationDeg:
          getEndpointPlanWallFacingSide(endpoint) && refPlacement.rotationMode !== 'explicit'
            ? 0
            : (refPlacement.rotationDeg ?? 0),
        rotationMode: refPlacement.rotationMode,
        scale: refPlacement.scale ?? 1,
        locked: false,
      })
      // Orphan guard: an endpoint that ended up without any placement still gets one.
      ensureSitplanPlacementsAt(
        project,
        [createdEndpointId],
        (id) => endpointFor(project, id)?.endpoint,
        (id, placement) => {
          addPlacementToProject(project, id, placement)
        },
        input.sitplan,
        newId
      )
      result = { placementId, createdEndpointId, circuitId: circuit.id }
    } else {
      return null
    }
  }

  if (input.pos) updatePlacementInProject(project, result.placementId, { pos: input.pos })
  return result
}
