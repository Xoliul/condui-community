import type { Point2 } from '@/types/schema'
import type { RoutePointContext } from '@/lib/plan/planWireOrthogonal'

/**
 * Path geometry shared by the plan wire tool and cable-route drawing: spline controls, sampled
 * splines for hit testing, and small vector helpers. Pure; no rendering.
 */

export function contextualNeighbor(
  points: Point2[],
  index: number,
  direction: 'previous' | 'next',
  context?: RoutePointContext
): Point2 | undefined {
  if (direction === 'previous')
    return points[index - 1] ?? (index === 0 ? context?.startPrevious : undefined)
  return points[index + 1] ?? (index === points.length - 1 ? context?.endNext : undefined)
}

export function cubicPoint(
  start: Point2,
  controlA: Point2,
  controlB: Point2,
  end: Point2,
  t: number
): Point2 {
  const mt = 1 - t
  return {
    x:
      mt * mt * mt * start.x +
      3 * mt * mt * t * controlA.x +
      3 * mt * t * t * controlB.x +
      t * t * t * end.x,
    y:
      mt * mt * mt * start.y +
      3 * mt * mt * t * controlA.y +
      3 * mt * t * t * controlB.y +
      t * t * t * end.y,
  }
}

export function vectorLength(vector: Point2): number {
  return Math.hypot(vector.x, vector.y)
}

export function scaledVector(vector: Point2, length: number): Point2 {
  const currentLength = vectorLength(vector)
  if (currentLength <= 1e-6) return { x: 0, y: 0 }
  return { x: (vector.x / currentLength) * length, y: (vector.y / currentLength) * length }
}

export function unitVector(vector: Point2): Point2 {
  const length = vectorLength(vector)
  if (length <= 1e-6) return { x: 0, y: 0 }
  return { x: vector.x / length, y: vector.y / length }
}

export function tangentAt(points: Point2[], index: number, context?: RoutePointContext): Point2 {
  const point = points[index]!
  const previous = contextualNeighbor(points, index, 'previous', context)
  const next = contextualNeighbor(points, index, 'next', context)
  if (previous && next) {
    const previousDistance = Math.hypot(point.x - previous.x, point.y - previous.y)
    const nextDistance = Math.hypot(next.x - point.x, next.y - point.y)
    const incoming = unitVector({ x: point.x - previous.x, y: point.y - previous.y })
    const outgoing = unitVector({ x: next.x - point.x, y: next.y - point.y })
    const tangent = { x: incoming.x + outgoing.x, y: incoming.y + outgoing.y }
    const fallback = { x: next.x - previous.x, y: next.y - previous.y }
    return scaledVector(
      vectorLength(tangent) > 1e-4 ? tangent : fallback,
      Math.min(previousDistance, nextDistance) * 0.58
    )
  }
  const neighbor = next ?? previous
  if (!neighbor) return { x: 0, y: 0 }
  const towardNeighbor = next
    ? { x: neighbor.x - point.x, y: neighbor.y - point.y }
    : { x: point.x - neighbor.x, y: point.y - neighbor.y }
  const direction =
    Math.abs(towardNeighbor.x) >= Math.abs(towardNeighbor.y)
      ? { x: Math.sign(towardNeighbor.x) || 1, y: 0 }
      : { x: 0, y: Math.sign(towardNeighbor.y) || 1 }
  return scaledVector(direction, Math.min(vectorLength(towardNeighbor) * 0.32, 90))
}

export function limitHandleLength(vector: Point2, maxLength: number): Point2 {
  const length = vectorLength(vector)
  if (length <= maxLength) return vector
  return scaledVector(vector, maxLength)
}

export function splineControls(
  points: Point2[],
  index: number,
  context?: RoutePointContext
): { controlA: Point2; controlB: Point2 } {
  const start = points[index]!
  const end = points[index + 1]!
  const segmentLength = Math.hypot(end.x - start.x, end.y - start.y)
  const maxHandle = Math.max(12, segmentLength * 0.46)
  const startTangent = limitHandleLength(tangentAt(points, index, context), maxHandle)
  const endTangent = limitHandleLength(tangentAt(points, index + 1, context), maxHandle)
  return {
    controlA: { x: start.x + startTangent.x, y: start.y + startTangent.y },
    controlB: { x: end.x - endTangent.x, y: end.y - endTangent.y },
  }
}

export function splinePath(points: Point2[], context?: RoutePointContext): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`
  const parts = [`M ${points[0]!.x} ${points[0]!.y}`]
  for (let index = 0; index < points.length - 1; index += 1) {
    const { controlA, controlB } = splineControls(points, index, context)
    const end = points[index + 1]!
    parts.push(`C ${controlA.x} ${controlA.y} ${controlB.x} ${controlB.y} ${end.x} ${end.y}`)
  }
  return parts.join(' ')
}

export function sampleSpline(points: Point2[], context?: RoutePointContext): Point2[] {
  if (points.length <= 1) return points
  const samples: Point2[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!
    const end = points[index + 1]!
    const { controlA, controlB } = splineControls(points, index, context)
    if (samples.length === 0) samples.push(start)
    const segmentDistance = Math.hypot(end.x - start.x, end.y - start.y)
    const steps = Math.max(8, Math.min(28, Math.ceil(segmentDistance / 16)))
    for (let step = 1; step <= steps; step += 1) {
      samples.push(cubicPoint(start, controlA, controlB, end, step / steps))
    }
  }
  return samples
}

export function flatten(points: Point2[]): number[] {
  return points.flatMap((point) => [point.x, point.y])
}
