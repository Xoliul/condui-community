import type { Placement } from '@/types/schema'

type PlacementStyle = Placement['style'] & {
  customPosition?: boolean
  /** Created automatically while the user places plan symbols manually; hidden until placed. */
  awaitingPlacement?: boolean
}

function resolvePlacementStyle(style: Placement['style'] | undefined): PlacementStyle | undefined {
  if (!style || typeof style !== 'object') return undefined
  return style as PlacementStyle
}

export function hasCustomPlacement(placement: Placement): boolean {
  return resolvePlacementStyle(placement.style)?.customPosition === true
}

/** Automatically created placement the user has not put on the plan yet. */
export function isAwaitingPlanPlacement(placement: Placement): boolean {
  return resolvePlacementStyle(placement.style)?.awaitingPlacement === true
}

/** Marks an automatic placement as waiting for the user to place it on the plan. */
export function markAwaitingPlanPlacement(placement: Placement): Placement {
  return {
    ...placement,
    style: { ...(resolvePlacementStyle(placement.style) ?? {}), awaitingPlacement: true },
  }
}

export function withCustomPlacementFlag(
  placement: Placement,
  updates: Partial<Placement>
): Partial<Placement> {
  const nextPos = updates.pos
  if (!nextPos) return updates

  const moved =
    Math.abs(nextPos.x - placement.pos.x) > 1e-6 || Math.abs(nextPos.y - placement.pos.y) > 1e-6
  // Any explicit position for an awaiting placement counts as placing it, even in place.
  if (!moved && !isAwaitingPlanPlacement(placement)) return updates

  const nextStyle: PlacementStyle = {
    ...(resolvePlacementStyle(placement.style) ?? {}),
    ...(resolvePlacementStyle(updates.style) ?? {}),
    customPosition: true,
  }
  delete nextStyle.awaitingPlacement

  return {
    ...updates,
    style: nextStyle,
  }
}
