import type { SupplyTapAnchor } from '@/types/supplySources'
import type { Point } from '@/types/ui'
import type { BranchDropIntent } from './branchDropInteraction'
import type { DropTarget } from './findDropTarget'

/** Distance from the grid wire to the tap handle (the middle of the tap zone), in layout units. */
export const SUPPLY_TAP_HANDLE_RISE = 25
/** Distance from the grid wire to the centre of the previewed tap chunk. */
export const SUPPLY_TAP_PREVIEW_RISE = 46
/**
 * The tap zone sits directly on top of the supply wire's drop zone (10 units either side of the
 * wire, see `pushLaneSegment` in layoutTreeMainBus.ts). Device and riser drop zones trim it
 * sideways (`clearOfHitBoxes`), so it fills the stretch between them. On the wire or a device is in
 * series, the zone above starts a tap. Fixed layout units: drawn exactly as it triggers.
 */
const TAP_ZONE_START = 10
const TAP_ZONE_HEIGHT = 30

/** A spot on the grid wire where the layout draws a tap with this anchor. */
export interface SupplyTapSlot {
  id: string
  anchor: SupplyTapAnchor
  x: number
}

/**
 * One horizontal stretch of grid wire in a supply frame, past the grid operator's cabinet. While
 * dragging above it the tap preview follows the cursor freely; a drop locks to the nearest slot.
 */
export interface SupplyTapLane {
  diagramId: string
  ownerPanelId: string
  y: number
  left: number
  right: number
  slots: SupplyTapSlot[]
}

/** The tap a cursor above a lane starts: drawn at the cursor, dropped at the nearest slot. */
export function getSupplyTapLaneIntent(lane: SupplyTapLane, x: number): BranchDropIntent | null {
  const wireX = Math.min(lane.right, Math.max(lane.left, x))
  let slot: SupplyTapSlot | null = null
  for (const candidate of lane.slots)
    if (!slot || Math.abs(candidate.x - wireX) < Math.abs(slot.x - wireX)) slot = candidate
  if (!slot) return null
  const target: DropTarget = {
    type: null,
    panelId: lane.ownerPanelId,
    diagramId: lane.diagramId,
    supplyTapAnchor: slot.anchor,
  }
  return {
    id: slot.id,
    kind: 'branch',
    target,
    point: { x: wireX, y: lane.y - SUPPLY_TAP_HANDLE_RISE },
    wirePoint: { x: wireX, y: lane.y },
    lockPoint: { x: slot.x, y: lane.y },
    direction: 1,
    radiusPx: 0,
  }
}

/** The rectangle above the wire where a drop starts a tap, in layout units. */
export function getSupplyTapLaneZone(lane: SupplyTapLane): { left: number; right: number; top: number; bottom: number } {
  return {
    left: lane.left,
    right: lane.right,
    top: lane.y - TAP_ZONE_START - TAP_ZONE_HEIGHT,
    bottom: lane.y - TAP_ZONE_START,
  }
}

/** The lane whose tap zone is under the cursor, if any. */
export function resolveSupplyTapLane(
  lanes: readonly SupplyTapLane[], position: Point,
): BranchDropIntent | null {
  for (const lane of lanes) {
    const zone = getSupplyTapLaneZone(lane)
    if (position.x < zone.left || position.x > zone.right || position.y < zone.top || position.y > zone.bottom) continue
    return getSupplyTapLaneIntent(lane, position.x)
  }
  return null
}
