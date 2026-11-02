import type { Endpoint } from '@/types/schema'

import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import { readLegacyCompatibilityFloors } from '@/lib/projectV2/buildingFloors'

const MAX_ENDPOINT_MULTIPLIER = 99

export interface SyncEndpointMultiplierDeps {
  getEndpointById: (id: string) => Endpoint | undefined
  /** Resizes the endpoint's placements to the requested count as one project command (one undo step). */
  setMultiplierCount: (endpointId: string, count: number, floorId: string) => boolean
  getActiveFloorId: () => string | null
  getFallbackFloorId: () => string | undefined
}

export function syncEndpointMultiplierCount(
  deps: SyncEndpointMultiplierDeps,
  endpointId: string,
  target: number
): boolean {
  if (!Number.isFinite(target) || !Number.isInteger(target) || target < 1) {
    return false
  }

  const latestEndpoint = deps.getEndpointById(endpointId)
  if (!latestEndpoint) return false

  const current = latestEndpoint.placements.length

  if (target === current) return true

  const floorId =
    deps.getActiveFloorId() ??
    latestEndpoint.placements[0]?.floorId ??
    deps.getFallbackFloorId()
  if (!floorId) return false

  return deps.setMultiplierCount(latestEndpoint.id, target, floorId)
}

export function createSyncEndpointMultiplierDeps(): SyncEndpointMultiplierDeps {
  const state = useProjectStore.getState()
  return {
    getEndpointById: state.getEndpointById,
    setMultiplierCount: (endpointId, count, floorId) =>
      count <= MAX_ENDPOINT_MULTIPLIER &&
      runProjectCommand(
        'properties.edit',
        { edits: [], actions: [{ kind: 'endpointMultiplier', endpointId, count, activeFloorId: floorId }] },
        { label: 'set endpoint multiplier', source: 'properties' }
      ) !== null,
    getActiveFloorId: () => useUIStore.getState().activeFloorId,
    getFallbackFloorId: () =>
      state.currentProject ? readLegacyCompatibilityFloors(state.currentProject)[0]?.id : undefined,
  }
}
