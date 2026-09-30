import type { Floor, Point2 } from '@/types/schema'

export const DEFAULT_PLAN_PX_PER_METER = 100

export function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function createPlanScaleReference(
  p1: Point2,
  p2: Point2,
  meters: number,
  floorId?: string
): NonNullable<NonNullable<Floor['scale']>['reference']> | null {
  if (![p1.x, p1.y, p2.x, p2.y].every(Number.isFinite) || !isPositiveFinite(meters)) return null
  const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y)
  if (!isPositiveFinite(distance) || distance < 1e-6 || !isPositiveFinite(distance / meters))
    return null
  return {
    p1: { ...p1 },
    p2: { ...p2 },
    meters,
    coordinateSpace: 'asset',
    ...(floorId ? { floorId } : {}),
  }
}

export function resolvePlanPxPerMeter(scale: Floor['scale']): number | null {
  if (isPositiveFinite(scale?.pxPerMeter)) return scale.pxPerMeter
  const ref = scale?.reference
  if (!ref || !createPlanScaleReference(ref.p1, ref.p2, ref.meters)) return null
  return Math.hypot(ref.p2.x - ref.p1.x, ref.p2.y - ref.p1.y) / ref.meters
}

export function parsePlanMeters(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d*\.?\d+$/.test(normalized)) return null
  const meters = Number(normalized)
  return isPositiveFinite(meters) ? meters : null
}
