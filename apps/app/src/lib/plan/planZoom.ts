import { ZOOM_MIN } from '@/constants/canvasConstants'
import { DEFAULT_PLAN_PX_PER_METER } from '@/lib/plan/planScale'

/**
 * Keep the minimum plan zoom tied to physical plan units. At the default scale,
 * the shared canvas floor is unchanged; denser calibrated plans may zoom out
 * farther by the same ratio as their pixels-per-metre value.
 */
export function getPlanZoomMinimum(pxPerMeter: number | null | undefined): number {
  if (typeof pxPerMeter !== 'number' || !Number.isFinite(pxPerMeter) || pxPerMeter <= 0) {
    return ZOOM_MIN
  }
  return Math.min(
    ZOOM_MIN,
    (ZOOM_MIN * DEFAULT_PLAN_PX_PER_METER) / pxPerMeter,
  )
}
