import type { Point2 } from '@/types/schema'

/**
 * A floor's plan image is drawn with its local origin at `planImageOffset` and
 * rotated clockwise (screen coordinates, y down) by `planImageRotationDeg`
 * around that origin, matching Konva's `rotation` on the plan image group.
 */

export function normalizePlanImageRotationDeg(rotationDeg: number | undefined): number {
  if (rotationDeg == null || !Number.isFinite(rotationDeg)) return 0
  const normalized = ((rotationDeg % 360) + 360) % 360
  return Math.abs(normalized) < 1e-9 || Math.abs(normalized - 360) < 1e-9 ? 0 : normalized
}

function rotate(point: Point2, rotationDeg: number): Point2 {
  if (!rotationDeg) return { x: point.x, y: point.y }
  const radians = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos }
}

export function planImageLocalToScenePoint(local: Point2, offset: Point2, rotationDeg = 0): Point2 {
  const rotated = rotate(local, rotationDeg)
  return { x: rotated.x + offset.x, y: rotated.y + offset.y }
}

export function scenePointToPlanImageLocal(scene: Point2, offset: Point2, rotationDeg = 0): Point2 {
  return rotate({ x: scene.x - offset.x, y: scene.y - offset.y }, -rotationDeg)
}

/** Axis-aligned scene bounds of the rotated plan image. */
export function getPlanImageSceneBounds(
  offset: Point2,
  width: number,
  height: number,
  rotationDeg = 0,
): { left: number; top: number; right: number; bottom: number } {
  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height },
  ].map((corner) => planImageLocalToScenePoint(corner, offset, rotationDeg))
  const xs = corners.map((corner) => corner.x)
  const ys = corners.map((corner) => corner.y)
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) }
}
