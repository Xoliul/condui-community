import type { DropZoneHint } from './collectDropZoneHints'

/**
 * Remove circle hints that would visually overlap. A symbol and the wire just before it often
 * both expose a slot; drawing both gives two touching balls for one place on screen.
 *
 * - Outline hints (same-symbol targets) are always kept.
 * - Circles within `minDistance` of the active target are dropped: the live preview already
 *   marks that spot.
 * - Otherwise the first hint of an overlapping cluster wins (collection order is stable).
 */
export function declutterDropZoneHints(
  hints: DropZoneHint[],
  activeHint: DropZoneHint | null,
  minDistance: number
): DropZoneHint[] {
  const minDistanceSquared = minDistance * minDistance
  const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < minDistanceSquared

  const kept: DropZoneHint[] = []
  for (const hint of hints) {
    if (hint.outline) {
      kept.push(hint)
      continue
    }
    if (activeHint && overlaps(hint, activeHint)) continue
    if (kept.some((other) => !other.outline && overlaps(hint, other))) continue
    kept.push(hint)
  }
  return kept
}

/** Screen distance (px) at which a hint is fully shown. */
export const DROP_ZONE_HINT_NEAR_PX = 40
/** Screen distance (px) beyond which a hint stays at its faint resting state. */
export const DROP_ZONE_HINT_FAR_PX = 180

/**
 * 0 (far, faint) to 1 (near, full) for a hint relative to the pointer, measured in screen
 * pixels so the fade feels the same at every zoom level. Eased so hints pop in quickly as
 * the pointer closes in.
 */
export function getDropZoneHintProximity(
  hint: { x: number; y: number },
  pointer: { x: number; y: number } | null,
  zoom: number
): number {
  if (!pointer || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return 0
  const distancePx = Math.hypot(hint.x - pointer.x, hint.y - pointer.y) * zoom
  const linear = Math.max(
    0,
    Math.min(1, (DROP_ZONE_HINT_FAR_PX - distancePx) / (DROP_ZONE_HINT_FAR_PX - DROP_ZONE_HINT_NEAR_PX))
  )
  return linear * linear * (3 - 2 * linear)
}

/**
 * Scale factor that keeps a canvas-sized mark at least `minScreenPx` on screen. Zoomed in, marks
 * scale with the diagram (factor 1); zoomed out, they stop shrinking at the minimum.
 */
export function getMinimumScreenSizeScale(
  canvasSize: number,
  zoom: number,
  minScreenPx: number
): number {
  if (!(zoom > 0) || !(canvasSize > 0)) return 1
  return Math.max(1, minScreenPx / (canvasSize * zoom))
}
