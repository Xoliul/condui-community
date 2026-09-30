import type { TFunction } from 'i18next'
import { getSymbolById } from '@/lib/symbols'
import type { CableRoutePoint } from './estimateCableRoutes'

/**
 * Short localized name, e.g. "Wisselschakelaar". Socket symbol names spell out every variant
 * (earth, child protection), so sockets read as "Stopcontact"; the tooltip keeps the full name.
 */
export function cableSchedulePointName(point: CableRoutePoint | undefined, t: TFunction): string {
  if (point?.nodeType === 'socket') return t('cableSchedule.point.socket', 'Socket')
  return cableSchedulePointFullName(point, t)
}

export function cableSchedulePointFullName(
  point: CableRoutePoint | undefined,
  t: TFunction
): string {
  const meta = point?.symbolId ? getSymbolById(point.symbolId) : undefined
  return meta ? t(`symbols.${meta.id}`, meta.name) : ''
}

/** "C1 Wisselschakelaar" for exports and titles. */
export function cableSchedulePointText(
  point: CableRoutePoint | undefined,
  fallback: string,
  t: TFunction
): string {
  if (!point) return fallback
  return [point.code, cableSchedulePointName(point, t)].filter(Boolean).join(' ')
}
