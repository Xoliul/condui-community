import type { Endpoint } from '@/types/schema'

/** Quarter turn that makes a left-to-right symbol enter from below and leave upward. */
export const HORIZONTAL_DOMOTICA_CHILD_ROTATION_DEG = -90

/**
 * Symbols that keep their upright drawing on a horizontal module's output chain. They either
 * draw text or a second artwork layer inside the symbol (HVAC, transformer overlays), are
 * drawn by a different component (boards, junctions), are large directional converters, or
 * would nest a module. Everything else is a plain left-to-right glyph that is rotated so the
 * wire runs up through it.
 */
const UPRIGHT_SYMBOL_IDS: ReadonlySet<string> = new Set([
  'domotica',
  'panel_distribution',
  'junction_box',
  'terminal_strip',
  'junction_panel',
  'transformer',
  'rectifier',
  'inverter',
  'dc_dc_converter',
  'furnace',
  'furnace_heatpump',
  'furnace_gas',
  'furnace_oil',
  'furnace_pellets',
  'heating',
  'ventilation',
  'energy_meter',
  'relay',
  'note',
  'earthing',
  'earthing_separator',
])

/** Rotation for an output child of a horizontal module, or undefined when it stays upright. */
export function getHorizontalDomoticaChildRotationDeg(
  endpoint: Pick<Endpoint, 'symbol'>
): number | undefined {
  if (!endpoint.symbol || UPRIGHT_SYMBOL_IDS.has(endpoint.symbol)) return undefined
  return HORIZONTAL_DOMOTICA_CHILD_ROTATION_DEG
}
