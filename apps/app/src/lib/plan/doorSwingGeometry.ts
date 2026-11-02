import type { Door, Point2 } from '@/types/schema'
import { clamp } from '@/lib/geometry'

/**
 * Pure door-swing geometry with no editor dependencies, so project commands can place
 * recognized doors with the same orientation rules as the canvas.
 */
const DEFAULT_SWING_ANGLE_DEG = 35

export function leftNormalFromTangent(tangent: Point2): Point2 {
  return { x: -tangent.y, y: tangent.x }
}

/** Which side of the wall (relative to its tangent) a point lies on. */
export function getWallNormalSide(
  center: Point2,
  tangent: Point2,
  point: Point2,
): 'left' | 'right' {
  const leftNormal = leftNormalFromTangent(tangent)
  const dx = point.x - center.x
  const dy = point.y - center.y
  const d = dx * leftNormal.x + dy * leftNormal.y
  return d >= 0 ? 'left' : 'right'
}

/**
 * Which wall-normal side the door leaf opens toward.
 * Mirrors WallRenderer swing geometry so placement and rendering stay aligned.
 */
export function computeDoorOpenNormalSide(
  swing: NonNullable<Door['swing']>,
  direction: NonNullable<Door['direction']>,
  tangent: Point2,
  interiorSide: 'left' | 'right' | null,
  swingAngleDeg = DEFAULT_SWING_ANGLE_DEG,
): 'left' | 'right' {
  if (swing === 'none' || swing === 'double') {
    return 'left'
  }

  const angleDeg = (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI
  const leftNormal = leftNormalFromTangent(tangent)
  const closedAngleDeg = swing === 'left' ? angleDeg : angleDeg + 180
  const angleOffset = clamp(swingAngleDeg, 1, 100)

  const candidate = (sign: 1 | -1): 'left' | 'right' => {
    const openAngleDeg = closedAngleDeg + sign * angleOffset
    const openRad = (openAngleDeg * Math.PI) / 180
    const vx = Math.cos(openRad)
    const vy = Math.sin(openRad)
    const d = vx * leftNormal.x + vy * leftNormal.y
    return d >= 0 ? 'left' : 'right'
  }

  if (!interiorSide) {
    const fallbackDirection: 'in' | 'out' =
      swing === 'left' ? (direction === 'in' ? 'out' : 'in') : direction
    return candidate(fallbackDirection === 'in' ? 1 : -1)
  }

  const desiredSide =
    direction === 'in'
      ? interiorSide
      : interiorSide === 'left'
        ? 'right'
        : 'left'

  return candidate(candidate(1) === desiredSide ? 1 : -1)
}

/** Pick in/out so a fixed hinge opens toward the target wall-normal side. */
export function resolveDoorDirectionForHinge(
  swing: 'left' | 'right',
  tangent: Point2,
  targetOpenSide: 'left' | 'right',
  interiorSide: 'left' | 'right' | null,
): 'in' | 'out' {
  const matches: Array<{ direction: 'in' | 'out'; score: number }> = []
  for (const direction of ['in', 'out'] as const) {
    if (computeDoorOpenNormalSide(swing, direction, tangent, interiorSide) !== targetOpenSide) {
      continue
    }
    let score = direction === 'out' ? 1 : 0
    if (interiorSide) {
      const expectedDirection = targetOpenSide === interiorSide ? 'in' : 'out'
      if (direction === expectedDirection) score += 4
    }
    matches.push({ direction, score })
  }
  if (matches.length === 0) return 'out'
  matches.sort((a, b) => b.score - a.score)
  return matches[0]!.direction
}
