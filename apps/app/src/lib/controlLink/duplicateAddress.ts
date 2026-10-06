import type { Endpoint } from '@/types/schema'

/**
 * A duplicate keeps what its source is connected to (the operating device, the group addresses)
 * but not the physical channel: a channel belongs to exactly one connection of a device, so a
 * copy starting with the same one would immediately be a duplicate-channel finding.
 * Mutates and returns the freshly cloned endpoint.
 */
export function clearDuplicatedControlChannel<T extends Endpoint>(clone: T): T {
  if (clone.controlLink) {
    const { channel: _channel, ...link } = clone.controlLink
    clone.controlLink = link
  }
  if (clone.domoticaChildProps) {
    const { channel: _channel, ...child } = clone.domoticaChildProps
    clone.domoticaChildProps = child
  }
  return clone
}
