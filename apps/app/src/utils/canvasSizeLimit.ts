/**
 * Browsers refuse canvases past a per-side or total-area limit (Firefox: "Canvas exceeds
 * max size"; low-memory devices: "could not create basic draw target"). These bounds stay
 * below every desktop browser's limit while keeping large plan scans sharp.
 */
export const MAX_CANVAS_SIDE = 16_384
export const MAX_CANVAS_PIXELS = 50_000_000

/** Largest whole-pixel size with the requested aspect ratio that a browser can allocate. */
export function fitCanvasSize(
  width: number,
  height: number
): { width: number; height: number; scale: number } {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const scale = Math.min(
    1,
    MAX_CANVAS_SIDE / safeWidth,
    MAX_CANVAS_SIDE / safeHeight,
    Math.sqrt(MAX_CANVAS_PIXELS / (safeWidth * safeHeight))
  )
  return {
    width: Math.max(1, Math.floor(safeWidth * scale)),
    height: Math.max(1, Math.floor(safeHeight * scale)),
    scale,
  }
}
