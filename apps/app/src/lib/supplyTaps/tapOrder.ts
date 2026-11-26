import type { SupplyTapAnchor } from '@/types/supplySources'

/**
 * Effective position of each tap among taps at the same anchor, increasing along the power flow:
 * its `order`, or its index in the supply-taps board when it has none. Ties keep board order.
 */
export function sortSupplyTapsByOrder<T extends { anchor: SupplyTapAnchor }>(taps: readonly T[]): T[] {
  return taps
    .map((tap, index) => ({ tap, index, key: tap.anchor.order ?? index }))
    .sort((left, right) => left.key - right.key || left.index - right.index)
    .map((entry) => entry.tap)
}

/** The effective order of every tap, keyed by item id, in board order. */
export function getEffectiveSupplyTapOrders<T extends { id: string; anchor: SupplyTapAnchor }>(
  taps: readonly T[]
): Map<string, number> {
  return new Map(taps.map((tap, index) => [tap.id, tap.anchor.order ?? index]))
}
