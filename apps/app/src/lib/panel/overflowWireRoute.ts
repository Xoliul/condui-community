/** Relation-wire geometry for modules hanging outside their board frame (the overflow zone). */

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Vertical lead from a module edge when both modules share a row band. */
const OVERFLOW_WIRE_LEAD = 14

/** True when a placement, in its surface's local coordinates, lies outside the board frame. */
export function isPlacementOutsideFrame(
  placement: Box,
  frame: { width: number; height: number }
): boolean {
  return (
    placement.x < 0 ||
    placement.y < 0 ||
    placement.x + placement.width > frame.width ||
    placement.y + placement.height > frame.height
  )
}

/**
 * Shortest orthogonal route between two modules when one hangs in the overflow zone: it leaves
 * the module edge facing the other one and does not follow the board's corridors, which the
 * overflow module is not inside. Modules side by side are joined over their tops.
 */
export function routeOverflowModuleWire(source: Box, target: Box, offsetX = 0): number[] {
  const sourceX = source.x + source.width / 2 + offsetX
  const targetX = target.x + target.width / 2 + offsetX
  const sourceBottom = source.y + source.height
  const targetBottom = target.y + target.height
  if (sourceBottom <= target.y) {
    const midY = (sourceBottom + target.y) / 2
    return [sourceX, sourceBottom, sourceX, midY, targetX, midY, targetX, target.y]
  }
  if (targetBottom <= source.y) {
    const midY = (targetBottom + source.y) / 2
    return [sourceX, source.y, sourceX, midY, targetX, midY, targetX, targetBottom]
  }
  const laneY = Math.min(source.y, target.y) - OVERFLOW_WIRE_LEAD
  return [sourceX, source.y, sourceX, laneY, targetX, laneY, targetX, target.y]
}
