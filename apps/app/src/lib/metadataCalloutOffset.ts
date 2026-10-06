import type { SupplyMetadataCalloutRect } from '@/lib/supplyMetadataCallout'

/**
 * User-dragged position of a one-wire metadata card: the card's top-left
 * corner relative to the rendered centre of the card owner's symbol. For a
 * card shared by several identical targets the owner is the first target.
 */
export interface MetadataCalloutOffset {
  x: number
  y: number
}

const MAX_METADATA_CALLOUT_OFFSET = 5000

/** Return a usable persisted offset, ignoring malformed or absurd values. */
export function getMetadataCalloutOffset(
  owner: { metadataCalloutOffset?: unknown } | null | undefined
): MetadataCalloutOffset | null {
  const offset = owner?.metadataCalloutOffset as Partial<MetadataCalloutOffset> | undefined
  if (!offset || typeof offset !== 'object') return null
  const { x, y } = offset
  if (typeof x !== 'number' || typeof y !== 'number') return null
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  if (Math.abs(x) > MAX_METADATA_CALLOUT_OFFSET || Math.abs(y) > MAX_METADATA_CALLOUT_OFFSET) {
    return null
  }
  return { x, y }
}

/** Round a dragged card position to whole canvas units before persisting it. */
export function normalizeMetadataCalloutOffset(offset: MetadataCalloutOffset): MetadataCalloutOffset {
  return { x: Math.round(offset.x), y: Math.round(offset.y) }
}

export function getMetadataCalloutRectAtOffset(
  origin: { x: number; y: number },
  offset: MetadataCalloutOffset,
  width: number,
  height: number
): SupplyMetadataCalloutRect {
  const left = origin.x + offset.x
  const top = origin.y + offset.y
  return { left, top, right: left + width, bottom: top + height }
}

/** Move the card-side start of each leader with a card that is being dragged. */
export function translateMetadataCalloutLeaderStarts(
  segments: Array<[number, number, number, number]>,
  dx: number,
  dy: number
): Array<[number, number, number, number]> {
  if (dx === 0 && dy === 0) return segments
  return segments.map(([x1, y1, x2, y2]) => [x1 + dx, y1 + dy, x2, y2])
}
