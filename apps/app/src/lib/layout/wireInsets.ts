/**
 * Wire Insets — controls how far wires extend toward symbol anchor points
 *
 * Positive values = wire stops before reaching the anchor (creates a gap)
 * Negative values = wire extends past the anchor
 * Zero           = wire reaches exactly to the anchor point
 *
 * Usage in deriveWires.ts:
 *   const adjusted = applyNodeWireInset(endPoint, otherEnd, node)
 */

import type { LightPointDeviceProps, MotionDetectorDeviceProps } from '@/types/schema'
import { showLightPointDecentralOverlay } from '@/lib/lightPointProps'
import { SYMBOL_SIZE } from '@/components/canvas/eendraad/canvasSymbols'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface WireInsets {
  top: number
  bottom: number
  left: number
  right: number
}

// ─── Configuration ─────────────────────────────────────────────────────────────
//
// Single flat lookup. Keys can be:
//   - A symbolId  (e.g. 'socket', 'panel_distribution')  → checked first
//   - A nodeType  (e.g. 'endpoint', 'protection')        → checked second
//
// For grouped node types (mcb, rcd → protection), see NODE_TYPE_CATEGORY below.

const _ = { top: 0, bottom: 0, left: 0, right: 0 } // shorthand for "no inset"

const SOCKET: WireInsets = { top: 0, bottom: 0, left: 2.5, right: -2.5 }
const APPLIANCE: WireInsets = { top: 9, bottom: 9, left: 9, right: 9 }
// Switches (toggle, twoway, dimmer, etc.) — not relay, not switch_impulse
const SWITCH: WireInsets = { top: 0, bottom: 0, left: 2.5, right: 2.5 }
const SOUND_DEVICE: WireInsets = { top: 6, bottom: 6, left: 4, right: 4 }
/** Decentral emergency light: wires stop near the outer square (~layout SYMBOL_SIZE 30). */
export const LIGHT_POINT_DECENTRAL_INSETS: WireInsets = {
  top: 15,
  bottom: 15,
  left: 15,
  right: 15,
}

/** Smoke / fire detector square (smaller than full symbol canvas). */
export const SMOKE_DETECTOR_INSETS: WireInsets = { top: 5.5, bottom: 5.5, left: 5.5, right: 5.5 }
/** Spread motion detector (library default / fan-beam artwork). */
export const MOTION_DETECTOR_SPREAD_INSETS: WireInsets = {
  top: 6,
  bottom: 6,
  left: 8,
  right: 7.5,
}
/** Generic IR motion detector — horizontal feeders only (taller rectangle). */
export const MOTION_DETECTOR_GENERIC_INSETS: WireInsets = {
  top: 0,
  bottom: 0,
  left: 5.5,
  right: 5.5,
}
export const WIRE_INSETS: Record<string, WireInsets> = {
  // ── Node types ──────────────────────────────────────────
  mainBus: _,
  busBar: _,
  secondaryBus: _,
  branch: _,
  supply: { top: 1, bottom: 0, left: 8, right: 0 },
  ground: { top: 1, bottom: 0, left: 0, right: 0 },
  trunkDevice: _,
  endpoint: _,

  // Junction boxes
  junction_box: { top: 6, bottom: 6, left: 6, right: 6 },
  junction_panel: { top: 2, bottom: 2, left: 8, right: 8 },
  terminal_strip: { top: 3, bottom: 3, left: 3, right: 3 },

  // Protection devices (mcb + rcd both resolve here, see NODE_TYPE_CATEGORY)
  protection: { top: 8, bottom: 6, left: 8, right: 6 },
  rotating_switch: { top: 9, bottom: 6, left: 9, right: 6 },
  source_changeover: { top: 10, bottom: 10, left: 10, right: 10 },
  fuse: { top: 9, bottom: 9, left: 9, right: 9 },

  // ── Symbol overrides (take precedence over node type) ───
  socket: SOCKET,
  socket_gnd: SOCKET,
  socket_child: SOCKET,
  socket_gnd_child: SOCKET,

  // Light symbols
  light_point: { top: 0, bottom: 0, left: 0, right: 0 },
  light_spot: { top: 5, bottom: 5, left: 7.5, right: 5 },
  light_led: { top: 5, bottom: 5, left: 4.5, right: 5 },
  light_fluorescent: { top: 4, bottom: 4, left: 9, right: 9 },

  // Switches (all switch types except relay and switch_impulse; see CATEGORY below)
  switch: SWITCH,
  switch_impulse: { top: 6, bottom: 6, left: 6, right: 6 },
  // Default motion_detector entry = spread; generic overrides in getWireInsets()
  motion_detector: MOTION_DETECTOR_SPREAD_INSETS,
  smoke_detector: SMOKE_DETECTOR_INSETS,

  earthing_separator: { top: 2, bottom: 2, left: 0, right: 0 },

  energy_meter: { top: 8, bottom: 8, left: 6, right: 6 },

  // An SPD is tapped off the trunk; the trunk itself remains uninterrupted.
  spd: _,

  // Stop vertical feeders at the lower edge and horizontal feeders at the panel body.
  panel_distribution: { top: 0, bottom: 6.5, left: 12.5, right: 12.5 },

  // Actual image size, not the larger layout slot: relay.svg body in a 48-unit viewBox.
  relay: {
    top: (24 - 14.2) / 48 * SYMBOL_SIZE,
    bottom: (33.7 - 24) / 48 * SYMBOL_SIZE,
    left: (24 - 3.2) / 48 * SYMBOL_SIZE,
    right: (44.8 - 24) / 48 * SYMBOL_SIZE,
  },
  // Domotica wires are fully controlled by custom geometry (deriveWires/layoutTree); no automatic insets.
  domotica: { top: 0, bottom: 0, left: 0, right: 0 },

  //fixed appliances
  stove: APPLIANCE,
  oven: APPLIANCE,
  washer: APPLIANCE,
  dryer: APPLIANCE,
  dishwasher: APPLIANCE,
  boiler: APPLIANCE,
  freezer: APPLIANCE,
  fridge: APPLIANCE,
  microwave: APPLIANCE,
  motor: APPLIANCE,
  furnace: APPLIANCE,
  heating: APPLIANCE,
  ventilation: APPLIANCE,
  /** Same base graphic as `furnace` (HVAC source); match HVAC wire gaps */
  fixed_appliance_generic: APPLIANCE,
  door_lock: APPLIANCE,
  ev: { top: 9, bottom: 9, left: 5, right: 7 },

  buzzer: SOUND_DEVICE,
  bell: SOUND_DEVICE,
  horn: { top: 4, bottom: 4, left: 7, right: 6 },
  siren: SOUND_DEVICE,

  //energy conversion
  transformer: { top: 3, bottom: 3, left: 6, right: 6 },
  rectifier: { top: 8, bottom: 8, left: 8, right: 8 },
  inverter: { top: 8, bottom: 8, left: 8, right: 8 },
  dc_dc_converter: { top: 8, bottom: 8, left: 8, right: 8 },
  solar_panel: { top: 8, bottom: 8, left: 8, right: 9 },
  battery: { top: 0, bottom: 0, left: 6, right: 5 },
}

// Maps node types OR symbol IDs that should resolve to a different key
// Used for both nodeType fallback and symbolId fallback
const CATEGORY: Record<string, string> = {
  // Node types and symbol IDs (protection symbols can also appear on trunk devices)
  mcb: 'protection',
  rcd: 'protection',
  rcbo: 'protection',
  fuse: 'protection',
  main_switch: 'protection',
  spd: 'protection',
  // Switch symbol IDs → shared inset (excludes relay and switch_impulse)
  switch_1p_twoway: 'switch',
  switch_2p_twoway: 'switch',
  switch_dimmer: 'switch',
  switch_1p_changeover: 'switch',
  switch_1p_pull: 'switch',
  // Standalone contact reuses the MCB artwork minus its head block: same wire gaps as protection.
  contact: 'protection',
  switch_cross: 'switch',
}

// ─── Public API ────────────────────────────────────────────────────────────────

export type WireInsetSymbolProps = {
  lightPointProps?: LightPointDeviceProps
  motionDetectorProps?: MotionDetectorDeviceProps
}

function resolveWireInsetOptions(
  lightPointPropsOrOptions?: LightPointDeviceProps | WireInsetSymbolProps,
  motionDetectorProps?: MotionDetectorDeviceProps
): WireInsetSymbolProps {
  if (
    lightPointPropsOrOptions &&
    ('lightPointProps' in lightPointPropsOrOptions ||
      'motionDetectorProps' in lightPointPropsOrOptions)
  ) {
    return lightPointPropsOrOptions as WireInsetSymbolProps
  }
  return {
    lightPointProps: lightPointPropsOrOptions as LightPointDeviceProps | undefined,
    motionDetectorProps,
  }
}

/**
 * Look up wire insets: symbolId → symbolId category → nodeType → nodeType category → zero.
 */
export function getWireInsets(
  nodeType: string,
  symbolId?: string,
  lightPointPropsOrOptions?: LightPointDeviceProps | WireInsetSymbolProps,
  motionDetectorProps?: MotionDetectorDeviceProps
): WireInsets {
  const options = resolveWireInsetOptions(lightPointPropsOrOptions, motionDetectorProps)

  if (symbolId === 'light_point' && showLightPointDecentralOverlay(options.lightPointProps)) {
    return LIGHT_POINT_DECENTRAL_INSETS
  }
  if (
    symbolId === 'motion_detector' &&
    (options.motionDetectorProps?.type ?? 'spread') === 'generic'
  ) {
    return MOTION_DETECTOR_GENERIC_INSETS
  }
  if (symbolId) {
    if (symbolId in WIRE_INSETS) return WIRE_INSETS[symbolId]!
    const symCat = CATEGORY[symbolId]
    if (symCat && symCat in WIRE_INSETS) return WIRE_INSETS[symCat]!
  }
  if (nodeType in WIRE_INSETS) return WIRE_INSETS[nodeType]!
  const nodeCat = CATEGORY[nodeType]
  if (nodeCat && nodeCat in WIRE_INSETS) return WIRE_INSETS[nodeCat]!
  return _
}

/**
 * Adjust a wire endpoint so it respects the symbol's wire inset.
 * Direction is auto-detected from the wire geometry.
 */
export function applyWireInset(
  point: { x: number; y: number },
  otherEnd: { x: number; y: number },
  nodeType: string,
  symbolId?: string,
  lightPointPropsOrOptions?: LightPointDeviceProps | WireInsetSymbolProps,
  motionDetectorProps?: MotionDetectorDeviceProps
): { x: number; y: number } {
  // Domotica uses custom wire geometry (boxLeft/boxRight/top/bottom) and should not be auto-inset.
  if (symbolId === 'domotica') {
    return point
  }

  const insets = getWireInsets(nodeType, symbolId, lightPointPropsOrOptions, motionDetectorProps)

  if (insets.top === 0 && insets.bottom === 0 && insets.left === 0 && insets.right === 0) {
    return point
  }

  const dx = otherEnd.x - point.x
  const dy = otherEnd.y - point.y

  let { x, y } = point

  if (Math.abs(dy) >= Math.abs(dx)) {
    // Predominantly vertical wire
    if (dy > 0) y += insets.bottom
    else if (dy < 0) y -= insets.top
  } else {
    // Predominantly horizontal wire
    if (dx > 0) x += insets.right
    else if (dx < 0) x -= insets.left
  }

  return { x, y }
}
