import { clamp } from '@/lib/geometry'

/** Narrowest left dock that keeps the library rail, symbol icon and a readable name intact. */
export const MIN_LEFT_DOCK_WIDTH = 300
export const MAX_LEFT_DOCK_WIDTH = 640

/** One clamp for dragging, the stored width and the rendered width of the left dock. */
export function clampLeftDockWidth(width: number): number {
  return clamp(width, MIN_LEFT_DOCK_WIDTH, MAX_LEFT_DOCK_WIDTH)
}
