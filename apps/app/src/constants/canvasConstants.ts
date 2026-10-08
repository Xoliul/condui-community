import { clamp } from '@/lib/geometry'

/**
 * Canvas zoom: internal scale and display.
 * "100%" is shown when the canvas is at ZOOM_100 scale (so 200% of the previous 1:1).
 */

/** Internal zoom value that we display as 100%. */
export const ZOOM_100 = 2

/** Minimum internal zoom (displayed as (ZOOM_MIN / ZOOM_100) * 100%). */
export const ZOOM_MIN = 0.1

/** Maximum internal zoom (displayed as (ZOOM_MAX / ZOOM_100) * 100%). */
export const ZOOM_MAX = 10

/** Display percentage for a given internal zoom. */
export function zoomToDisplayPercent(zoom: number): number {
  const percent = (zoom / ZOOM_100) * 100
  if (percent >= 1) return Math.round(percent)
  if (percent >= 0.1) return Number(percent.toFixed(1))
  return Number(percent.toPrecision(2))
}

// Canvas overlay UI (toolbars, panels) scaling when compartment is small
/** Scale factor for overlays when compartment is large enough (full size). */
export const CANVAS_OVERLAY_FULL_SCALE = 1
/** Scale factor for overlays when compartment is below compact threshold. */
export const CANVAS_OVERLAY_COMPACT_SCALE = 0.86
/** Min width/height (px) below which overlay scale switches to compact. */
export const CANVAS_OVERLAY_COMPACT_THRESHOLD = 460

// Zoom-normalized overlay rendering for plan editing tools.
// These values are in screen pixels so visuals remain readable across zoom levels.
// One knob to scale all draw/selection overlay visuals globally.
export const DRAW_OVERLAY_GLOBAL_SCALE = 1.2
export const DRAW_TOOL_STROKE_PX = 3
export const DRAW_TOOL_STROKE_PX_MIN = 1.5
export const DRAW_TOOL_STROKE_PX_MAX = 5
export const DRAW_TOOL_DASH_PX = 5
export const DRAW_TOOL_POINT_RADIUS_PX = 4
export const DRAW_TOOL_POINT_RADIUS_PX_MIN = 3
export const DRAW_TOOL_POINT_RADIUS_PX_MAX = 7
export const DRAW_TOOL_HANDLE_RADIUS_PX = 8
export const DRAW_TOOL_HANDLE_RADIUS_PX_MIN = 6
export const DRAW_TOOL_HANDLE_RADIUS_PX_MAX = 12
export const DRAW_TOOL_HANDLE_OFFSET_PX = 36
export const DRAW_TOOL_HANDLE_OFFSET_PX_MIN = 20
export const DRAW_TOOL_HANDLE_OFFSET_PX_MAX = 56
export const DRAW_TOOL_PROJECTION_SNAP_ZONE_PX = 14
export const DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MIN = 8
export const DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MAX = 28
/** Always-on attraction radius for placing a drawing point exactly on nearby geometry. */
export const DRAW_TOOL_LINE_SNAP_ZONE_PX = 8
export const DRAW_TOOL_LINE_SNAP_ZONE_PX_MIN = 5
export const DRAW_TOOL_LINE_SNAP_ZONE_PX_MAX = 12
/** Attraction radius for door/window centers on intersection-bounded wall spans. */
export const OPENING_SPAN_CENTER_SNAP_ZONE_PX = 12
export const OPENING_SPAN_CENTER_SNAP_ZONE_PX_MIN = 7
export const OPENING_SPAN_CENTER_SNAP_ZONE_PX_MAX = 18
export const DRAW_TOOL_PROJECTION_GUIDE_STROKE_PX = 2
export const DRAW_TOOL_PROJECTION_GUIDE_STROKE_PX_MIN = 1
export const DRAW_TOOL_PROJECTION_GUIDE_STROKE_PX_MAX = 3
export const DRAW_TOOL_PROJECTION_GUIDE_COLOR = '#22c55e'
/** How long projection alignment guides stay visible after the last snap update. */
export const PROJECTED_SNAP_GUIDE_AUTO_CLEAR_MS = 1500
export const DRAW_TOOL_GRID_SNAP_BREAKAWAY_PX = 16
export const DRAW_TOOL_GRID_SNAP_BREAKAWAY_PX_MIN = 10
export const DRAW_TOOL_GRID_SNAP_BREAKAWAY_PX_MAX = 24

/** Situation-plan grid spacing presets (centimeters when floor scale is set). */
export const PLAN_GRID_SIZE_STEPS_CM: readonly number[] = [10, 12.5, 20, 25, 50, 100]

// Selection outline rendering bounds (screen-space pixels).
export const SELECTION_OUTLINE_STROKE_PX = 2
export const SELECTION_OUTLINE_STROKE_PX_MIN = 1
export const SELECTION_OUTLINE_STROKE_PX_MAX = 4
export const SELECTION_OUTLINE_CORNER_RADIUS_PX = 2
export const SELECTION_OUTLINE_CORNER_RADIUS_PX_MIN = 1
export const SELECTION_OUTLINE_CORNER_RADIUS_PX_MAX = 6
/**
 * Selection outline box floor (screen px) at max zoom-out.
 * Ramps from 0 below SELECTION_OUTLINE_FLOOR_START_DISPLAY_PERCENT.
 */
export const SELECTION_OUTLINE_MIN_BOX_PX = 7.5
/** Display zoom (%) at and above which selection boxes use natural symbol size only. */
export const SELECTION_OUTLINE_FLOOR_START_DISPLAY_PERCENT = 25
/** Display zoom (%) at min internal zoom — full floor applies here (see ZOOM_MIN). */
export const SELECTION_OUTLINE_FLOOR_END_DISPLAY_PERCENT = (ZOOM_MIN / ZOOM_100) * 100
export const HOVER_OUTLINE_STROKE_PX = 1
export const HOVER_OUTLINE_STROKE_PX_MIN = 1
export const HOVER_OUTLINE_STROKE_PX_MAX = 2
export const HOVER_OUTLINE_DASH_PX = 4
export const HOVER_OUTLINE_DASH_PX_MIN = 2
export const HOVER_OUTLINE_DASH_PX_MAX = 8
/** Extra screen px added to the main wire stroke when selected (on top of natural line width). */
export const WIRE_SELECTION_EXTRA_PX = 1
export const WIRE_SELECTION_EXTRA_PX_MIN = 1
export const WIRE_SELECTION_EXTRA_PX_MAX = 2
/** Screen px thickness for panel/frame border click targets (grows when zoomed out). */
export const FRAME_BORDER_HIT_PX = 12
export const FRAME_BORDER_HIT_PX_MIN = 8
export const FRAME_BORDER_HIT_PX_MAX = 22

// Safety cap: maximum number of expensive image wall-score recomputes per pass.
// Prevents UI lockups when many placements invalidate at once (e.g. tool transitions).
export const PLAN_LABEL_IMAGE_SCORE_MAX_RECOMPUTES_PER_PASS = 200

/**
 * Convert desired screen-space size (px) into canvas units with clamped bounds.
 */
export function screenPxToCanvasUnits(
  zoom: number,
  px: number,
  minPx: number,
  maxPx: number
): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const scaledPx = px * DRAW_OVERLAY_GLOBAL_SCALE
  return clamp(scaledPx, minPx, maxPx) / safeZoom
}

/** Clickable band along panel/symbol frame edges (screen-constant, more forgiving when zoomed out). */
export function getFrameBorderHitThicknessCanvas(zoom: number): number {
  return screenPxToCanvasUnits(
    zoom,
    FRAME_BORDER_HIT_PX,
    FRAME_BORDER_HIT_PX_MIN,
    FRAME_BORDER_HIT_PX_MAX
  )
}

/** Perlin "smootherstep": zero 1st/2nd derivative at 0 and 1 (gentler than smoothstep). */
function smootherstep01(t: number): number {
  const x = clamp(t, 0, 1)
  return x * x * x * (x * (x * 6 - 15) + 10)
}

function zoomToDisplayPercentExact(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return (safeZoom / ZOOM_100) * 100
}

/**
 * Blend weight for zoom-out selection outline compensation (0 = natural size only).
 * 0 at/above 25% display; eases to 1 at max zoom-out.
 */
export function selectionOutlineCompensationWeight(zoom: number): number {
  const displayPercent = zoomToDisplayPercentExact(zoom)
  const start = SELECTION_OUTLINE_FLOOR_START_DISPLAY_PERCENT
  const end = SELECTION_OUTLINE_FLOOR_END_DISPLAY_PERCENT
  if (displayPercent >= start) return 0
  if (displayPercent <= end) return 1
  const span = start - end
  if (span <= 0) return 1
  const t = (start - displayPercent) / span
  return smootherstep01(t)
}

/**
 * Effective screen-space floor after compensation blend (for debugging/tests).
 */
export function selectionOutlineMinScreenPx(zoom: number): number {
  return selectionOutlineCompensationWeight(zoom) * SELECTION_OUTLINE_MIN_BOX_PX
}

/**
 * Zoom-out selection outline size: natural symbol size until 25% display, then eases
 * into a compensated canvas size so the on-screen box does not shrink to a few pixels.
 */
export function canvasSizeWithScreenMinimum(
  zoom: number,
  baseCanvasSize: number,
  fullCompensationScreenPx?: number
): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const displayPercent = zoomToDisplayPercentExact(safeZoom)
  const targetScreenPx = fullCompensationScreenPx ?? SELECTION_OUTLINE_MIN_BOX_PX

  if (fullCompensationScreenPx != null) {
    const weight = displayPercent >= SELECTION_OUTLINE_FLOOR_START_DISPLAY_PERCENT ? 0 : 1
    if (weight <= 0) return baseCanvasSize
    const compensatedCanvas = targetScreenPx / safeZoom
    const target = Math.max(baseCanvasSize, compensatedCanvas)
    return baseCanvasSize + (target - baseCanvasSize) * weight
  }

  if (displayPercent >= SELECTION_OUTLINE_FLOOR_START_DISPLAY_PERCENT) {
    return baseCanvasSize
  }

  const weight = selectionOutlineCompensationWeight(safeZoom)
  if (weight <= 0) return baseCanvasSize

  const compensatedCanvas = targetScreenPx / safeZoom
  const targetCanvas = Math.max(baseCanvasSize, compensatedCanvas)
  return baseCanvasSize + (targetCanvas - baseCanvasSize) * weight
}
