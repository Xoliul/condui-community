import { DEFAULT_PLAN_PX_PER_METER, isPositiveFinite } from './planScale'

/** Wire decorations follow calibration, with readable screen sizes in the editor. */
export function planWireVisualMetrics(zoom?: number, pxPerMeter?: number | null) {
  const planScale = isPositiveFinite(pxPerMeter) ? pxPerMeter / DEFAULT_PLAN_PX_PER_METER : 1
  const screenUnit = isPositiveFinite(zoom) ? 1 / zoom : 0
  const decorationScale = Math.max(planScale, screenUnit)
  return {
    decorationScale,
    strokeWidth: Math.max(planScale, 2 * screenUnit),
    hitStrokeWidth: Math.max(10 * planScale, 14 * screenUnit),
    dash: [4 * decorationScale, 4 * decorationScale],
    waypointRadius: 4 * decorationScale,
    previewRadius: 3.5 * decorationScale,
    parallelSpacing: 8 * decorationScale,
    countFontSize: 12 * (screenUnit || planScale),
    countOffset: 6 * (screenUnit || planScale),
    arrowLength: 14 * decorationScale,
    arrowWidth: 12 * decorationScale,
  }
}
