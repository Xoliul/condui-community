import type { Point } from '@/types/ui'

export const MULTIPLIER_BADGE_FONT_SIZE = 8
export const MULTIPLIER_BADGE_HEIGHT = MULTIPLIER_BADGE_FONT_SIZE + 2

export function getMultiplierBadgeText(count: number): string {
  return `${count}x`
}

export function getMultiplierBadgeWidth(count: number): number {
  return Math.max(
    9,
    Math.ceil(getMultiplierBadgeText(count).length * MULTIPLIER_BADGE_FONT_SIZE * 0.58)
  )
}

/**
 * Return the badge's top-left position when its bottom-center is anchored to
 * the supplied symbol corner.
 */
export function getMultiplierBadgePosition(anchor: Point, count: number): Point {
  return {
    x: anchor.x - getMultiplierBadgeWidth(count) / 2,
    y: anchor.y - MULTIPLIER_BADGE_HEIGHT,
  }
}

/**
 * Domotica output rows are only one symbol-height apart, so the usual
 * top-right badge would land on the symbol of the row above. Return the
 * bottom-center anchor that places the badge in the symbol's own row instead:
 * just right of the symbol, sitting on the row wire.
 */
export function getDomoticaChildMultiplierBadgeAnchor(
  symbolRight: number,
  symbolCenterY: number,
  count: number
): Point {
  return { x: symbolRight + 1 + getMultiplierBadgeWidth(count) / 2, y: symbolCenterY - 1 }
}
