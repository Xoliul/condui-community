import { useProjectStore } from '@/stores/projectStore'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
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
  const kind = owner.type === 'endpoint' ? 'endpoint' : 'trunkDevice'
  runProjectCommand(
    'properties.edit',
    { edits: [{ kind, ids: [owner.id], set: { metadataCalloutOffset: nextOffset } }] },
    { label: 'Move metadata card' }
  )
}

/** Clears several stored metadata card offsets as one undoable project update. */
export function clearMetadataCalloutOffsets(owners: readonly MetadataCalloutOwnerRef[]): void {
  const stored = owners.filter((owner) => getStoredMetadataCalloutOffset(owner))
  const endpointIds = stored.filter((owner) => owner.type === 'endpoint').map((owner) => owner.id)
  const trunkDeviceIds = stored
    .filter((owner) => owner.type === 'trunkDevice')
    .map((owner) => owner.id)
  const edits = [
    ...(endpointIds.length
      ? [{ kind: 'endpoint' as const, ids: endpointIds, set: { metadataCalloutOffset: null } }]
      : []),
    ...(trunkDeviceIds.length
      ? [{ kind: 'trunkDevice' as const, ids: trunkDeviceIds, set: { metadataCalloutOffset: null } }]
      : []),
  ]
  if (!edits.length) return
  runProjectCommand('properties.edit', { edits }, { label: 'Reset metadata cards' })
}
