import { useProjectStore } from '@/stores/projectStore'
import {
  getMetadataCalloutOffset,
  normalizeMetadataCalloutOffset,
  type MetadataCalloutOffset,
} from '@/lib/metadataCalloutOffset'

export interface MetadataCalloutOwnerRef {
  type: 'endpoint' | 'trunkDevice'
  id: string
}

function offsetsEqual(left: MetadataCalloutOffset | null, right: MetadataCalloutOffset | null) {
  return left?.x === right?.x && left?.y === right?.y
}

/** Current stored card offset for an endpoint or trunk device, if any. */
export function getStoredMetadataCalloutOffset(
  owner: MetadataCalloutOwnerRef
): MetadataCalloutOffset | null {
  const state = useProjectStore.getState()
  if (owner.type === 'endpoint') {
    return getMetadataCalloutOffset(state.getEndpointById(owner.id))
  }
  return getMetadataCalloutOffset(state.getTrunkDeviceById(owner.id)?.device)
}

/**
 * Persist (or clear with `null`) a user-dragged metadata card position as one
 * undoable project update. Clearing returns the card to automatic placement.
 */
export function setMetadataCalloutOffset(
  owner: MetadataCalloutOwnerRef,
  offset: MetadataCalloutOffset | null
): void {
  const nextOffset = offset ? normalizeMetadataCalloutOffset(offset) : null
  if (offsetsEqual(getStoredMetadataCalloutOffset(owner), nextOffset)) return
  const updates = { metadataCalloutOffset: nextOffset ?? undefined }
  const state = useProjectStore.getState()
  if (owner.type === 'endpoint') {
    state.updateEndpoint(owner.id, updates)
    return
  }
  const result = state.getTrunkDeviceById(owner.id)
  if (!result) return
  if (result.isSupplyDevice) state.updateSupplyTrunkDevice(owner.id, updates)
  else if (result.isGroundDevice) state.updateGroundTrunkDevice(owner.id, updates)
  else if (result.circuit) state.updateTrunkDevice(result.circuit.id, owner.id, updates)
}
