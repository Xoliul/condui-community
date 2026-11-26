/**
 * Situation-plan duplicate on a mutable project (an Immer draft in a project command):
 * multiplier symbols get extra placements on the same endpoint; other symbols get a new
 * one-wire endpoint or branch plus a placement. Shared by `plan.duplicate` and its UI binding.
 */
import {
  duplicateBranchAboveOnCircuit,
  duplicateEndpointOnCircuit,
  endpointSymbolCanBeDuplicated,
  type DuplicateEndpointDeps,
} from '@/lib/eendraad/duplicateEndpoint'
import { ensureSitplanPlacementsAt } from '@/lib/eendraad/duplicateSitplanHelpers'
import { updateCircuitInProject } from '@/lib/eendraad/circuitMutations'
import { addEndpointToProject } from '@/lib/eendraad/endpointMutations'
import { findCircuitById, findEndpointById } from '@/lib/eendraad/projectElectricalDomain'
import { getCircuitBranches } from '@/lib/layout/endpointChains'
import { isMainPanelDistributionEndpoint } from '@/lib/plan/panelDistributionEndpoint'
import {
  addPlacementToProject,
  findMutablePlacementOwner,
  updatePlacementInProject,
} from '@/lib/plan/placementMutations'
import {
  readLegacyCompatibilityFloors,
  selectProjectBuildingFloors,
} from '@/lib/projectV2/buildingFloors'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import type { ProjectV2 } from '@/types/projectV2'
import type { Endpoint, Placement } from '@/types/schema'
import type { Point } from '@/types/ui'
import { endpointSupportsMultiplier } from '@/utils/endpointMultipliers'
import { generateId } from '@/utils/id'
import { suggestRotationForPlacement } from '@/utils/planAutoOrient'
import { getEndpointPlanWallFacingSide } from './planWallOrientation'
import { findCircuitForEndpointInPanel } from '@/utils/project'

const MULTIPLIER_PLACEMENT_OFFSET = 24

export type PlanDuplicateItemRef = { endpointId: string; placementId?: string }

export interface PlanDuplicateOptions {
  /** The floor the user works on; new placements go there. */
  activeFloorId: string | null
  /** Where a placement goes when its source has none. */
  fallbackPosition: Point
  /** Plan viewport centre on the active floor, for automatically placed copies. */
  viewportCenter?: Point | null
  /** Plan symbol size used when re-orienting copies against walls. */
  symbolBaseSizePx?: number
}

export type PlanDuplicateOutcome = { type: 'placement' | 'endpoint'; ids: string[] } | null

// Direct traversal, not the cached lookup index: inside a draft the panel arrays keep their
// identity while content changes, so a cached index would go stale mid-command.
function getEndpoint(project: ProjectV2, endpointId: string): Endpoint | undefined {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const found = findEndpointById(panel, endpointId)
    if (found) return found.endpoint
  }
  return undefined
}

function findCircuitForEndpoint(project: ProjectV2, endpointId: string) {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const found = findCircuitForEndpointInPanel(panel, endpointId)
    if (found) return found
  }
  return undefined
}

function placementOf(project: ProjectV2, item: PlanDuplicateItemRef): Placement | undefined {
  return item.placementId
    ? findMutablePlacementOwner(project, item.placementId)?.placement
    : undefined
}

function resolveDuplicateFloorId(
  project: ProjectV2,
  activeFloorId: string | null,
  refPlacement?: Pick<Placement, 'floorId'>
): string | undefined {
  return activeFloorId ?? refPlacement?.floorId ?? selectProjectBuildingFloors(project)[0]?.id
}

/** Whether these endpoints (and plan placements) can be duplicated together. */
export function canDuplicatePlanItems(
  project: ProjectV2,
  items: readonly PlanDuplicateItemRef[]
): boolean {
  if (items.length === 0) return false
  const endpointIds = [...new Set(items.map((item) => item.endpointId))]
  const endpoints: Endpoint[] = []
  for (const endpointId of endpointIds) {
    const endpoint = getEndpoint(project, endpointId)
    if (!endpoint || !endpointSymbolCanBeDuplicated(endpoint)) return false
    if (
      endpoint.symbol === 'panel_distribution' &&
      isMainPanelDistributionEndpoint(project, endpoint)
    ) {
      return false
    }
    if (!endpointSupportsMultiplier(endpoint) && !findCircuitForEndpoint(project, endpointId)) {
      return false
    }
    endpoints.push(endpoint)
  }
  const allMultiplier = endpoints.every((ep) => endpointSupportsMultiplier(ep))
  const noneMultiplier = endpoints.every((ep) => !endpointSupportsMultiplier(ep))
  if (!allMultiplier && !noneMultiplier) return false
  if (endpointIds.length > 1 && !allMultiplier) {
    const circuitIds = new Set(
      endpointIds.map((endpointId) => findCircuitForEndpoint(project, endpointId)?.circuit.id)
    )
    if (circuitIds.size !== 1 || circuitIds.has(undefined)) return false
  }
  return true
}

function duplicateEndpointDeps(project: ProjectV2): DuplicateEndpointDeps {
  return {
    getCircuitById: (circuitId) => {
      for (const panel of getEditableProjectElectricalPanels(project)) {
        const found = findCircuitById(panel, circuitId)
        if (found) return found.circuit
      }
      return undefined
    },
    getEndpointById: (endpointId) => getEndpoint(project, endpointId),
    addEndpoint: (circuitId, endpoint, insertAfterEndpointId) => {
      addEndpointToProject(project, circuitId, endpoint, insertAfterEndpointId)
    },
    updateCircuit: (circuitId, updates) => {
      updateCircuitInProject(project, circuitId, updates)
    },
    setSelection: undefined,
  }
}

/** Paste the transformed placement, using the same electrical duplication rules as the plan. */
export function pastePlanEndpointPlacementInProject(
  project: ProjectV2,
  endpointId: string,
  placement: Placement
): { circuitId: string; createdEndpointId?: string } | null {
  const endpoint = getEndpoint(project, endpointId)
  if (!endpoint || !endpointSymbolCanBeDuplicated(endpoint)) return null
  if (endpointSupportsMultiplier(endpoint)) {
    const circuitId = addPlacementToProject(project, endpointId, placement)
    return circuitId ? { circuitId } : null
  }

  const owner = findCircuitForEndpoint(project, endpointId)
  if (!owner || owner.circuit.code === 'PANEL') return null
  const circuitId = owner.circuit.id
  const deps = duplicateEndpointDeps(project)
  const result = duplicateEndpointOnCircuit(
    project,
    { circuitId, sourceEndpointId: endpointId, context: 'plan', selectNew: false },
    {
      ...deps,
      addEndpoint: (id, copy, after) => deps.addEndpoint(id, { ...copy, placements: [placement] }, after),
    }
  )
  return result.ok && result.newEndpointId
    ? { circuitId, createdEndpointId: result.newEndpointId }
    : null
}

function duplicateMultiplierPlacements(
  project: ProjectV2,
  endpointId: string,
  refPlacement: Placement | undefined,
  count: number,
  floorId: string,
  fallbackPosition: Point
): string[] {
  const newIds: string[] = []
  for (let i = 0; i < count; i++) {
    const id = generateId()
    const placement: Placement = refPlacement
      ? {
          ...refPlacement,
          id,
          floorId: refPlacement.floorId,
          pos: {
            x: refPlacement.pos.x + MULTIPLIER_PLACEMENT_OFFSET * (i + 1),
            y: refPlacement.pos.y + MULTIPLIER_PLACEMENT_OFFSET * (i + 1),
          },
          locked: false,
        }
      : {
          id,
          floorId,
          layer: 'electrical',
          pos: {
            x: fallbackPosition.x + MULTIPLIER_PLACEMENT_OFFSET * i,
            y: fallbackPosition.y + MULTIPLIER_PLACEMENT_OFFSET * i,
          },
          rotationDeg: 0,
          scale: 1,
          locked: false,
        }
    addPlacementToProject(project, endpointId, placement)
    newIds.push(id)
  }
  return newIds
}

function duplicateNonMultiplier(
  project: ProjectV2,
  sourceEndpointId: string,
  refPlacement: Placement | undefined,
  options: PlanDuplicateOptions
): string | null {
  const circuitInfo = findCircuitForEndpoint(project, sourceEndpointId)
  if (!circuitInfo) return null
  const result = duplicateEndpointOnCircuit(
    project,
    { circuitId: circuitInfo.circuit.id, sourceEndpointId, context: 'plan' },
    duplicateEndpointDeps(project)
  )
  if (!result.ok || !result.newEndpointId) return null

  const created = getEndpoint(project, result.newEndpointId)
  if ((created?.placements?.length ?? 0) > 0) return created?.placements[0]?.id ?? null

  const floorId = resolveDuplicateFloorId(project, options.activeFloorId, refPlacement)
  if (!floorId) return null
  const basePos = refPlacement?.pos ?? options.fallbackPosition
  const newPlacementId = generateId()
  addPlacementToProject(project, result.newEndpointId, {
    id: newPlacementId,
    floorId,
    layer: refPlacement?.layer ?? 'electrical',
    pos: {
      x: basePos.x + MULTIPLIER_PLACEMENT_OFFSET,
      y: basePos.y + MULTIPLIER_PLACEMENT_OFFSET,
    },
    rotationDeg: refPlacement?.rotationDeg ?? 0,
    rotationMode: refPlacement?.rotationMode,
    scale: refPlacement?.scale ?? 1,
    locked: false,
  })
  return newPlacementId
}

function duplicateItems(
  project: ProjectV2,
  items: readonly PlanDuplicateItemRef[],
  options: PlanDuplicateOptions
): PlanDuplicateOutcome {
  const endpointIds = [...new Set(items.map((item) => item.endpointId))]
  const firstEndpoint = getEndpoint(project, endpointIds[0]!)
  if (!firstEndpoint) return null

  if (endpointSupportsMultiplier(firstEndpoint)) {
    const floorId = resolveDuplicateFloorId(
      project,
      options.activeFloorId,
      placementOf(project, items[0]!)
    )
    if (!floorId) return null
    const byEndpoint = new Map<string, PlanDuplicateItemRef[]>()
    for (const item of items) {
      byEndpoint.set(item.endpointId, [...(byEndpoint.get(item.endpointId) ?? []), item])
    }
    const newPlacementIds: string[] = []
    for (const [endpointId, group] of byEndpoint) {
      const endpoint = getEndpoint(project, endpointId)
      if (!endpoint || !endpointSupportsMultiplier(endpoint)) continue
      const refPlacement =
        placementOf(project, group[0]!) ??
        endpoint.placements.find((p) => p.floorId === floorId) ??
        endpoint.placements[0]
      newPlacementIds.push(
        ...duplicateMultiplierPlacements(
          project,
          endpointId,
          refPlacement,
          group.length,
          floorId,
          options.fallbackPosition
        )
      )
    }
    return newPlacementIds.length > 0 ? { type: 'placement', ids: newPlacementIds } : null
  }

  if (endpointIds.length === 1) {
    const item = items[0]!
    const id = duplicateNonMultiplier(project, item.endpointId, placementOf(project, item), options)
    return id ? { type: 'placement', ids: [id] } : null
  }

  const circuitInfo = findCircuitForEndpoint(project, endpointIds[0]!)
  if (!circuitInfo) return null
  const branch = getCircuitBranches(circuitInfo.circuit).find((candidate) =>
    endpointIds.every((endpointId) => candidate.some((ep) => ep.id === endpointId))
  )
  if (branch) {
    const orderedIds = branch.map((ep) => ep.id).filter((id) => endpointIds.includes(id))
    const result = duplicateBranchAboveOnCircuit(
      project,
      { circuitId: circuitInfo.circuit.id, sourceEndpointIds: orderedIds, selectNew: false },
      duplicateEndpointDeps(project)
    )
    if (!result.ok || !result.newEndpointIds?.length) return null
    ensureSitplanPlacementsAt(
      project,
      result.newEndpointIds,
      (endpointId) => getEndpoint(project, endpointId),
      (endpointId, placement) => addPlacementToProject(project, endpointId, placement),
      { activeFloorId: options.activeFloorId, viewportCenter: options.viewportCenter }
    )
    const newPlacementIds = result.newEndpointIds
      .map((endpointId) => getEndpoint(project, endpointId)?.placements[0]?.id)
      .filter((id): id is string => !!id)
    return newPlacementIds.length > 0
      ? { type: 'placement', ids: newPlacementIds }
      : { type: 'endpoint', ids: result.newEndpointIds }
  }

  const newPlacementIds: string[] = []
  for (const item of items) {
    const id = duplicateNonMultiplier(project, item.endpointId, placementOf(project, item), options)
    if (!id) return null
    newPlacementIds.push(id)
  }
  return newPlacementIds.length > 0 ? { type: 'placement', ids: newPlacementIds } : null
}

/** Recompute automatic plan angles of the copies after their offset has been applied. */
function reorientDuplicates(
  project: ProjectV2,
  outcome: NonNullable<PlanDuplicateOutcome>,
  symbolBaseSizePx?: number
): void {
  const placementIds =
    outcome.type === 'placement'
      ? outcome.ids
      : outcome.ids.flatMap(
          (endpointId) =>
            getEndpoint(project, endpointId)?.placements.map((placement) => placement.id) ?? []
        )
  for (const placementId of placementIds) {
    const owner = findMutablePlacementOwner(project, placementId)
    if (!owner?.endpointId) continue
    const endpoint = getEndpoint(project, owner.endpointId)
    const wallFacingSide = endpoint && getEndpointPlanWallFacingSide(endpoint)
    if (!endpoint || !wallFacingSide) continue
    if (owner.placement.rotationMode === 'explicit') continue
    const floor = readLegacyCompatibilityFloors(project).find(
      (candidate) => candidate.id === owner.placement.floorId
    )
    const suggested = suggestRotationForPlacement(
      owner.placement,
      {
        walls: floor?.floorPlan?.walls ?? [],
        ...(symbolBaseSizePx != null ? { symbolBaseSizePx } : {}),
        ...(endpoint.type === 'socket'
          ? { socketCount: endpoint.socketProps?.socketCount ?? 1 }
          : {}),
      },
      wallFacingSide
    )
    updatePlacementInProject(project, placementId, { rotationDeg: suggested ?? 0 })
  }
}

/** Duplicates plan items in place and returns what to select, or null when nothing was made. */
export function duplicatePlanItemsInProject(
  project: ProjectV2,
  items: readonly PlanDuplicateItemRef[],
  options: PlanDuplicateOptions
): PlanDuplicateOutcome {
  if (!canDuplicatePlanItems(project, items)) return null
  const outcome = duplicateItems(project, items, options)
  if (outcome) reorientDuplicates(project, outcome, options.symbolBaseSizePx)
  return outcome
}
