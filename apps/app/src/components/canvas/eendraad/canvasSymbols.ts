/**
 * Centralized constants for canvas symbol rendering
 * Used across EndpointSymbol, ProtectionSymbol, and other canvas components
 */

import { applyTouchHitPadding } from '@/lib/canvas/touchHitZones'
import type { Endpoint } from '@/types/schema'
import { INTERACTIVE_OVERLAY_EXPORT_NAME } from '@/lib/export/interactiveOverlayExport'
import {
  canvasSizeWithScreenMinimum,
  HOVER_OUTLINE_DASH_PX,
  HOVER_OUTLINE_DASH_PX_MAX,
  HOVER_OUTLINE_DASH_PX_MIN,
  HOVER_OUTLINE_STROKE_PX,
  HOVER_OUTLINE_STROKE_PX_MAX,
  HOVER_OUTLINE_STROKE_PX_MIN,
  screenPxToCanvasUnits,
  SELECTION_OUTLINE_CORNER_RADIUS_PX,
  SELECTION_OUTLINE_CORNER_RADIUS_PX_MAX,
  SELECTION_OUTLINE_CORNER_RADIUS_PX_MIN,
  SELECTION_OUTLINE_STROKE_PX,
  SELECTION_OUTLINE_STROKE_PX_MAX,
  SELECTION_OUTLINE_STROKE_PX_MIN,
} from '@/constants/canvasConstants'
import {
  EENDRAAD_PANEL_SYMBOL_SCALE,
  EENDRAAD_PANEL_SYMBOL_WIDTH,
  EENDRAAD_PANEL_SYMBOL_HEIGHT,
  MULTI_SOCKET_OFFSET,
  PANEL_SYMBOL_WIDTH,
  PLAN_PANEL_VISUAL_SCALE,
  SYMBOL_SIZE,
} from '@/lib/canvas/symbolGeometry'

// Symbol size, multi-socket offset and panel symbol size live in lib for headless plan logic.
export {
  EENDRAAD_PANEL_SYMBOL_SCALE,
  EENDRAAD_PANEL_SYMBOL_WIDTH,
  EENDRAAD_PANEL_SYMBOL_HEIGHT,
  MULTI_SOCKET_OFFSET,
  PANEL_SYMBOL_HEIGHT,
  PANEL_SYMBOL_WIDTH,
  PLAN_PANEL_VISUAL_SCALE,
  SYMBOL_SIZE,
} from '@/lib/canvas/symbolGeometry'

// Outline/highlight dimensions (independent of symbol size)
// These control the size of hover and selection outlines
export const PROTECTION_OUTLINE_SIZE = 20 // For protection devices (MCB, RCD, RCBO)
export const ENDPOINT_OUTLINE_SIZE = 20 // For endpoints (62.5% of original symbol size for visual design)
export const GROUND_OUTLINE_SIZE = 20 // For ground symbols
export const PANEL_OUTLINE_WIDTH = 24 // For panel symbols (width)
export const PANEL_OUTLINE_HEIGHT = 14 // For panel symbols (height)
export const EENDRAAD_PANEL_OUTLINE_WIDTH = PANEL_OUTLINE_WIDTH * EENDRAAD_PANEL_SYMBOL_SCALE
export const EENDRAAD_PANEL_OUTLINE_HEIGHT = PANEL_OUTLINE_HEIGHT * EENDRAAD_PANEL_SYMBOL_SCALE

// Selection and hover styles
export const SELECTION_COLOR = '#fbbf24' // Yellow
export const SELECTION_STROKE_WIDTH = 1.5
export const HOVER_STROKE_WIDTH = 1
export const PREVIEW_STROKE_WIDTH = 1

// Drag artwork stays finer than the committed wiring. These are paint widths only;
// drop zones and wire hit areas keep their existing, more forgiving dimensions.
export const DRAG_PREVIEW_WIRE_WIDTH = 1.6
export const DRAG_PREVIEW_BUS_WIDTH = 3.2
export const DRAG_PREVIEW_HIGHLIGHT_WIDTH = 4
export const DRAG_PREVIEW_DASH = [5, 3]

// Dash patterns
export const HOVER_DASH_PATTERN = [4, 4]
export const PREVIEW_DASH_PATTERN = [4, 4]

// Corner radius for rounded rectangles
export const OUTLINE_CORNER_RADIUS = 2

// Multi-socket offset: horizontal distance between repeated socket symbols (px in eendraad scale)
// Increase to spread sockets further apart, decrease to overlap more.

/** Outlet SVG viewBox width/height (public/symbols/outlets/*.svg). */
export const SOCKET_SYMBOL_SVG_SIZE = 48

/**
 * Horizontal spacing between sockets in library double-outlet icons.
 * Scales eendraad MULTI_SOCKET_OFFSET to SVG units: (offset / SYMBOL_SIZE) × viewBox.
 */
export const LIBRARY_DOUBLE_SOCKET_OFFSET_SVG =
  (MULTI_SOCKET_OFFSET / SYMBOL_SIZE) * SOCKET_SYMBOL_SVG_SIZE

// Domotica: single source in lib/domoticaLayout; re-export for components. Box width follows symbol size.
export {
  DOMOTICA_BASE_HEIGHT,
  DOMOTICA_BRANCH_LEAD,
  DOMOTICA_BRANCH_CONTROL_LEAD,
  DOMOTICA_OUTPUT_SPACING,
  DOMOTICA_ENDPOINT_OUTPUT_START_Y,
  DOMOTICA_CONTROL_OUTPUT_Y,
  DOMOTICA_MIN_ENDPOINT_OUTPUTS,
  DOMOTICA_MAX_ENDPOINT_OUTPUTS,
  DOMOTICA_CONTROL_BAR_HEIGHT,
} from '@/lib/domoticaLayout'
export const DOMOTICA_BOX_WIDTH = SYMBOL_SIZE

// Panel distribution SVG viewBox (public/symbols/panels/panel_distribution.svg)
export const PANEL_SVG_VIEWBOX_WIDTH = 88.2
export const PANEL_SVG_BODY_WIDTH = 79.4

// Panel circuit indicator lines configuration (authored against PANEL_OUTLINE_WIDTH on plan)
export const PANEL_CIRCUIT_LINE_START_Y = -2 // Top of the lines (relative to symbol center)
export const PANEL_CIRCUIT_LINE_END_Y = 1 // Bottom of the lines (relative to symbol center)
export const PANEL_CIRCUIT_LINE_SPACING = 24 // Total horizontal width at outline scale (plan sitplanScale)
export const PANEL_CIRCUIT_LINE_STROKE_WIDTH = 1
export const PANEL_MAX_CIRCUIT_LINES = 8 // Maximum number of lines to display

/** Visible panel body width for a rendered symbol width (inner rect in the SVG). */
export function getPanelBodyWidth(symbolWidth: number): number {
  return symbolWidth * (PANEL_SVG_BODY_WIDTH / PANEL_SVG_VIEWBOX_WIDTH)
}

/** Circuit tick span as a proportion of the visible body in the site-plan symbol. */
export const PANEL_CIRCUIT_LINE_BODY_SPAN_RATIO =
  PANEL_CIRCUIT_LINE_SPACING / (getPanelBodyWidth(PANEL_SYMBOL_WIDTH) * PLAN_PANEL_VISUAL_SCALE)

/** Circuit tick layout for the 1-wire panel symbol at its native render size. */
export function getEendraadPanelCircuitLineMetrics() {
  return {
    // Match the site-plan symbol's tick spread relative to its visible body.
    lineSpacing:
      getPanelBodyWidth(EENDRAAD_PANEL_SYMBOL_WIDTH) * PANEL_CIRCUIT_LINE_BODY_SPAN_RATIO,
    lineStartY: PANEL_CIRCUIT_LINE_START_Y,
    lineEndY: PANEL_CIRCUIT_LINE_END_Y,
    strokeWidth: PANEL_CIRCUIT_LINE_STROKE_WIDTH,
  }
}

/** Vector body geometry for the one-wire panel symbol. */
export function getEendraadPanelBodyGeometry() {
  const offsetY = EENDRAAD_PANEL_SYMBOL_HEIGHT / 4
  return {
    x:
      -EENDRAAD_PANEL_SYMBOL_WIDTH / 2 +
      EENDRAAD_PANEL_SYMBOL_WIDTH * (4.4 / PANEL_SVG_VIEWBOX_WIDTH),
    y: -offsetY + EENDRAAD_PANEL_SYMBOL_HEIGHT * (15.6 / 48),
    width: getPanelBodyWidth(EENDRAAD_PANEL_SYMBOL_WIDTH),
    height: EENDRAAD_PANEL_SYMBOL_HEIGHT * (16.9 / 48),
    strokeWidth: PANEL_CIRCUIT_LINE_STROKE_WIDTH,
    cornerRadius: PANEL_CIRCUIT_LINE_STROKE_WIDTH * 0.4,
  }
}

/** Vertical distance from the one-wire panel anchor to the visible body's center. */
export function getEendraadPanelBodyCenterYOffset(): number {
  const body = getEendraadPanelBodyGeometry()
  return body.y + body.height / 2
}

/**
 * Extra width added by multi-socket rendering.
 * @param socketCount Number of sockets (1-4). Values <= 1 return 0.
 */
export function getSocketExtraWidth(socketCount: number): number {
  return Math.max(0, socketCount - 1) * MULTI_SOCKET_OFFSET
}

/** Standard endpoint highlight relative to the symbol's electrical anchor. */
export function getEndpointOutlineGeometry(endpoint: Endpoint, mirrorHorizontally = false) {
  const socketExtraWidth = getSocketExtraWidth(endpoint.type === 'socket' ? endpoint.socketProps?.socketCount || 1 : 1)
  const onWallExtraWidth =
    endpoint.type === 'light_point' && endpoint.symbol === 'light_point' && endpoint.lightPointProps?.onWall ? 6 : 0
  return {
    socketExtraWidth,
    onWallExtraWidth,
    centerX: (mirrorHorizontally ? -1 : 1) * socketExtraWidth / 2,
    width: ENDPOINT_OUTLINE_SIZE + socketExtraWidth + onWallExtraWidth,
    height: ENDPOINT_OUTLINE_SIZE,
  }
}

// Waterproof "h" indicator on socket symbols (eendraad) — top-right corner
export const SOCKET_WATERPROOF_H_OFFSET_RIGHT = 3 // gap from right edge of symbol (with align="right", this is the inset)
export const SOCKET_WATERPROOF_H_OFFSET_TOP = -7 // gap from top edge of symbol
export const SOCKET_WATERPROOF_H_FONT_SIZE = 8

// Waterproof "h" indicator on light point symbols (eendraad) — centered above symbol
export const LIGHT_POINT_WATERPROOF_H_OFFSET_TOP = -7

// Theme-aware colors
// @deprecated Use getThemeColors() from '@/lib/theme/colors' instead
// These are kept for backward compatibility
export const SYMBOL_COLOR_LIGHT = '#1f2937' // gray-800
export const SYMBOL_COLOR_DARK = '#e5e7eb' // gray-200
export const TEXT_COLOR_LIGHT = '#1f2937' // gray-800
export const TEXT_COLOR_DARK = '#e5e7eb' // gray-200
export const BUS_COLOR_LIGHT = '#1f2937' // gray-800
export const BUS_COLOR_DARK = '#6b7280' // gray-500
export const SECONDARY_TEXT_COLOR_LIGHT = '#6b7280' // gray-500
export const SECONDARY_TEXT_COLOR_DARK = '#9ca3af' // gray-400
export const FRAME_COLOR_LIGHT = '#9ca3af' // gray-400
export const FRAME_COLOR_DARK = '#4b5563' // gray-600

// HVAC overlays (relative positioning within symbol)
// Energy source overlays should move down by ~33% of symbol height from center.
export const HVAC_ENERGY_OFFSET_Y_FACTOR = 1 / 4
// When both energy source and function are present, space them horizontally using this factor.
export const HVAC_FUNCTION_OFFSET_X_FACTOR = 0.2
// Heat exchange type overlay needs a small upward nudge (in eendraad pixels).
export const HVAC_HEAT_EXCHANGE_TYPE_OFFSET_Y = -2

/**
 * Get symbol color based on theme
 * @param isDark - Whether dark theme is active
 * @returns Color hex string
 * @deprecated Use useThemeColors() from '@/lib/theme/hooks' instead
 */
export function getSymbolColor(isDark: boolean): string {
  return isDark ? SYMBOL_COLOR_DARK : SYMBOL_COLOR_LIGHT
}

/**
 * Get text color based on theme
 * @param isDark - Whether dark theme is active
 * @returns Color hex string
 * @deprecated Use useThemeColors() from '@/lib/theme/hooks' instead
 */
export function getTextColor(isDark: boolean): string {
  return isDark ? TEXT_COLOR_DARK : TEXT_COLOR_LIGHT
}

/**
 * Get bus/main line color based on theme
 * @param isDark - Whether dark theme is active
 * @returns Color hex string
 * @deprecated Use useThemeColors() from '@/lib/theme/hooks' instead
 */
export function getBusColor(isDark: boolean): string {
  return isDark ? BUS_COLOR_DARK : BUS_COLOR_LIGHT
}

/**
 * Get secondary text color (for labels, ratings, etc.) based on theme
 * @param isDark - Whether dark theme is active
 * @returns Color hex string
 * @deprecated Use useThemeColors() from '@/lib/theme/hooks' instead
 */
export function getSecondaryTextColor(isDark: boolean): string {
  return isDark ? SECONDARY_TEXT_COLOR_DARK : SECONDARY_TEXT_COLOR_LIGHT
}

/**
 * Get frame/border color based on theme
 * @param isDark - Whether dark theme is active
 * @returns Color hex string
 * @deprecated Use useThemeColors() from '@/lib/theme/hooks' instead
 */
export function getFrameColor(isDark: boolean): string {
  return isDark ? FRAME_COLOR_DARK : FRAME_COLOR_LIGHT
}

/**
 * Get outline rectangle props for selection/hover/preview
 * @param outlineSize - Size of the outline (independent of symbol size)
 * @returns Object with x, y, width, height for a centered rectangle
 */
export function getOutlineRectProps(outlineSize: number): {
  x: number
  y: number
  width: number
  height: number
} {
  return {
    x: -outlineSize / 2,
    y: -outlineSize / 2,
    width: outlineSize,
    height: outlineSize,
  }
}

/**
 * Get outline rectangle props for non-square symbols (e.g., panels)
 * @param width - Width of the outline
 * @param height - Height of the outline
 * @param offsetY - Vertical offset for the symbol (default 0 for centered)
 * @returns Object with x, y, width, height for a centered rectangle
 */
export function getRectOutlineProps(
  width: number,
  height: number,
  offsetY: number = 0
): { x: number; y: number; width: number; height: number } {
  return {
    x: -width / 2,
    y: -height / 2 + offsetY,
    width,
    height,
  }
}

function getVisualOutlineRectProps(zoom: number, outlineSize: number) {
  const size = canvasSizeWithScreenMinimum(zoom, outlineSize)
  return getOutlineRectProps(size)
}

function getVisualRectOutlineProps(
  zoom: number,
  width: number,
  height: number,
  offsetY: number = 0
) {
  const w = canvasSizeWithScreenMinimum(zoom, width)
  const h = canvasSizeWithScreenMinimum(zoom, height)
  return getRectOutlineProps(w, h, offsetY)
}

/** Screen-constant stroke (and corner radius) for selection outlines on the 1-wire canvas. */
export function getSelectionOutlineStrokeStyle(zoom: number) {
  return {
    strokeWidth: screenPxToCanvasUnits(
      zoom,
      SELECTION_OUTLINE_STROKE_PX,
      SELECTION_OUTLINE_STROKE_PX_MIN,
      SELECTION_OUTLINE_STROKE_PX_MAX
    ),
    cornerRadius: screenPxToCanvasUnits(
      zoom,
      SELECTION_OUTLINE_CORNER_RADIUS_PX,
      SELECTION_OUTLINE_CORNER_RADIUS_PX_MIN,
      SELECTION_OUTLINE_CORNER_RADIUS_PX_MAX
    ),
  }
}

/** Padding around selection boxes in canvas units (screen-constant). */
export function getSelectionOutlineInsetCanvas(
  zoom: number,
  px: number = 2,
  minPx: number = 1,
  maxPx: number = 4
): number {
  return screenPxToCanvasUnits(zoom, px, minPx, maxPx)
}

/** Yellow selection rect for 1-wire panels (info block boxes, notes, etc.). */
export function getEendraadSelectionRectProps(
  zoom: number,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const inset = getSelectionOutlineInsetCanvas(zoom)
  return {
    name: INTERACTIVE_OVERLAY_EXPORT_NAME,
    x: x - inset,
    y: y - inset,
    width: width + inset * 2,
    height: height + inset * 2,
    fill: 'transparent' as const,
    stroke: SELECTION_COLOR,
    listening: false as const,
    ...getSelectionOutlineStrokeStyle(zoom),
  }
}

export function getHoverOutlineStrokeStyle(zoom: number) {
  const dashUnit = screenPxToCanvasUnits(
    zoom,
    HOVER_OUTLINE_DASH_PX,
    HOVER_OUTLINE_DASH_PX_MIN,
    HOVER_OUTLINE_DASH_PX_MAX
  )
  return {
    strokeWidth: screenPxToCanvasUnits(
      zoom,
      HOVER_OUTLINE_STROKE_PX,
      HOVER_OUTLINE_STROKE_PX_MIN,
      HOVER_OUTLINE_STROKE_PX_MAX
    ),
    dash: [dashUnit, dashUnit] as [number, number],
    cornerRadius: screenPxToCanvasUnits(
      zoom,
      SELECTION_OUTLINE_CORNER_RADIUS_PX,
      SELECTION_OUTLINE_CORNER_RADIUS_PX_MIN,
      SELECTION_OUTLINE_CORNER_RADIUS_PX_MAX
    ),
  }
}

/**
 * Endpoint/multi-socket selection box (width may exceed height).
 */
export function getEndpointOutlineRectProps(
  zoom: number,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  const w = canvasSizeWithScreenMinimum(zoom, width)
  const h = canvasSizeWithScreenMinimum(zoom, height)
  return {
    x: -w / 2,
    y: -h / 2,
    width: w,
    height: h,
  }
}

/**
 * Get selection outline props (solid, thicker stroke)
 * @param zoom - Current canvas zoom (eendraad or plan view)
 * @param outlineSize - Size of the outline (use PROTECTION_OUTLINE_SIZE, ENDPOINT_OUTLINE_SIZE, etc.)
 */
export function getSelectionOutlineProps(zoom: number, outlineSize: number) {
  const rect = getVisualOutlineRectProps(zoom, outlineSize)
  return {
    name: INTERACTIVE_OVERLAY_EXPORT_NAME,
    ...rect,
    fill: 'transparent' as const,
    stroke: SELECTION_COLOR,
    ...getSelectionOutlineStrokeStyle(zoom),
    listening: false,
  }
}

/**
 * Get selection outline props for rectangular symbols (e.g., panels)
 */
export function getRectSelectionOutlineProps(
  zoom: number,
  width: number,
  height: number,
  offsetY: number = 0
) {
  const rect = getVisualRectOutlineProps(zoom, width, height, offsetY)
  return {
    name: INTERACTIVE_OVERLAY_EXPORT_NAME,
    ...rect,
    fill: 'transparent' as const,
    stroke: SELECTION_COLOR,
    ...getSelectionOutlineStrokeStyle(zoom),
    listening: false,
  }
}

/**
 * Get hover outline props (dashed, thinner stroke)
 */
export function getHoverOutlineProps(zoom: number, outlineSize: number) {
  const rect = getVisualOutlineRectProps(zoom, outlineSize)
  return {
    name: INTERACTIVE_OVERLAY_EXPORT_NAME,
    ...rect,
    fill: 'transparent' as const,
    stroke: SELECTION_COLOR,
    ...getHoverOutlineStrokeStyle(zoom),
    listening: false,
  }
}

/**
 * Get hover outline props for rectangular symbols (e.g., panels)
 */
export function getRectHoverOutlineProps(
  zoom: number,
  width: number,
  height: number,
  offsetY: number = 0
) {
  const rect = getVisualRectOutlineProps(zoom, width, height, offsetY)
  return {
    name: INTERACTIVE_OVERLAY_EXPORT_NAME,
    ...rect,
    fill: 'transparent' as const,
    stroke: SELECTION_COLOR,
    ...getHoverOutlineStrokeStyle(zoom),
    listening: false,
  }
}

/**
 * Get preview outline props (dashed, thinner stroke, for drag rectangle selection)
 */
export function getPreviewOutlineProps(zoom: number, outlineSize: number) {
  const rect = getVisualOutlineRectProps(zoom, outlineSize)
  return {
    name: INTERACTIVE_OVERLAY_EXPORT_NAME,
    ...rect,
    fill: 'transparent' as const,
    stroke: SELECTION_COLOR,
    ...getHoverOutlineStrokeStyle(zoom),
    listening: false,
  }
}

/** Selection/hover/preview outline for endpoints with extra horizontal width (multi-socket). */
export function getEndpointSelectionOutlineProps(zoom: number, width: number, height: number) {
  const rect = getEndpointOutlineRectProps(zoom, width, height)
  return {
    name: INTERACTIVE_OVERLAY_EXPORT_NAME,
    ...rect,
    fill: 'transparent' as const,
    stroke: SELECTION_COLOR,
    ...getSelectionOutlineStrokeStyle(zoom),
    listening: false,
  }
}

export function getEndpointHoverOutlineProps(zoom: number, width: number, height: number) {
  const rect = getEndpointOutlineRectProps(zoom, width, height)
  return {
    name: INTERACTIVE_OVERLAY_EXPORT_NAME,
    ...rect,
    fill: 'transparent' as const,
    stroke: SELECTION_COLOR,
    ...getHoverOutlineStrokeStyle(zoom),
    listening: false,
  }
}

export function getEndpointPreviewOutlineProps(zoom: number, width: number, height: number) {
  const rect = getEndpointOutlineRectProps(zoom, width, height)
  return {
    name: INTERACTIVE_OVERLAY_EXPORT_NAME,
    ...rect,
    fill: 'transparent' as const,
    stroke: SELECTION_COLOR,
    ...getHoverOutlineStrokeStyle(zoom),
    listening: false,
  }
}

/** Padded rect outline (e.g. domotica box) with zoom-normalized stroke and minimum screen size. */
export function getPaddedRectSelectionOutlineProps(
  zoom: number,
  x: number,
  y: number,
  width: number,
  height: number,
  pad: number
) {
  const w = canvasSizeWithScreenMinimum(zoom, width + pad * 2)
  const h = canvasSizeWithScreenMinimum(zoom, height + pad * 2)
  const cx = x + width / 2
  const cy = y + height / 2
  return {
    name: INTERACTIVE_OVERLAY_EXPORT_NAME,
    x: cx - w / 2,
    y: cy - h / 2,
    width: w,
    height: h,
    fill: 'transparent' as const,
    stroke: SELECTION_COLOR,
    ...getSelectionOutlineStrokeStyle(zoom),
    listening: false,
  }
}

export function getPaddedRectHoverOutlineProps(
  zoom: number,
  x: number,
  y: number,
  width: number,
  height: number,
  pad: number
) {
  const w = canvasSizeWithScreenMinimum(zoom, width + pad * 2)
  const h = canvasSizeWithScreenMinimum(zoom, height + pad * 2)
  const cx = x + width / 2
  const cy = y + height / 2
  return {
    name: INTERACTIVE_OVERLAY_EXPORT_NAME,
    x: cx - w / 2,
    y: cy - h / 2,
    width: w,
    height: h,
    fill: 'transparent' as const,
    stroke: SELECTION_COLOR,
    ...getHoverOutlineStrokeStyle(zoom),
    listening: false,
  }
}

export const getPaddedRectPreviewOutlineProps = getPaddedRectHoverOutlineProps

/**
 * Get hit area rectangle props for hover/click detection
 * This should match the outline size so hover detection aligns with the visible outline
 * @param outlineSize - Size of the hit area (use PROTECTION_OUTLINE_SIZE, ENDPOINT_OUTLINE_SIZE, etc.)
 */
export function getHitAreaProps(outlineSize: number) {
  const rect = getOutlineRectProps(outlineSize)
  return {
    ...rect,
    fill: 'transparent' as const,
    listening: true,
  }
}

/**
 * Hit area with touch/tablet padding when zoomed out (selection) and finger-sized drag when selected.
 */
export function getTouchAwareHitAreaProps(
  outlineSize: number,
  zoom: number,
  isSelected: boolean,
  touchPrimary: boolean
) {
  const rect = getOutlineRectProps(outlineSize)
  const adjusted = applyTouchHitPadding(rect, zoom, isSelected, touchPrimary)
  return {
    ...adjusted,
    fill: 'transparent' as const,
    listening: true,
  }
}

/**
 * Get hit area rectangle props for rectangular symbols (e.g., panels)
 * @param width - Width of the hit area
 * @param height - Height of the hit area
 * @param offsetY - Vertical offset for the symbol (default 0)
 */
export function getRectHitAreaProps(width: number, height: number, offsetY: number = 0) {
  const rect = getRectOutlineProps(width, height, offsetY)
  return {
    ...rect,
    fill: 'transparent' as const,
    listening: true,
  }
}

export function getTouchAwareRectHitAreaProps(
  width: number,
  height: number,
  offsetY: number,
  zoom: number,
  isSelected: boolean,
  touchPrimary: boolean
) {
  const rect = getRectOutlineProps(width, height, offsetY)
  const adjusted = applyTouchHitPadding(rect, zoom, isSelected, touchPrimary)
  return {
    ...adjusted,
    fill: 'transparent' as const,
    listening: true,
  }
}
