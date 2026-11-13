import type { DomoticaControlKey, Endpoint, SymbolKey } from '@/types/schema'
import { getSymbolsByCategory, symbols } from '@/lib/symbols'
import { isInBetweenEndpoint } from '@/utils/symbolMapping'

export const APPLIANCE_SYMBOLS = [
  ...getSymbolsByCategory('appliances'),
  ...getSymbolsByCategory('hvac'),
  ...getSymbolsByCategory('sound'),
]

export const DOMOTICA_CONTROL_KEYS: DomoticaControlKey[] = [
  'programmed_control',
  'wireless_control',
  'detection_control',
  'button_control',
] as const

// Dynamically derive switch type symbol keys from the symbols catalog (excludes relay)
export const SWITCH_TYPE_SYMBOLS: SymbolKey[] = symbols
  .filter(
    (s) =>
      s.category === 'switches' &&
      s.id !== 'relay' &&
      (s.id === 'switch' ||
        s.id.startsWith('switch_') ||
        s.id === 'contact' ||
        s.id === 'light_sensor' ||
        s.id === 'motion_detector' ||
        s.id === 'smoke_detector')
  )
  .map((s) => s.id as SymbolKey)

/** HVAC-only symbol keys, used to limit the appliance-type dropdown for HVAC-chained units. */
export const HVAC_TYPE_SYMBOLS: SymbolKey[] = getSymbolsByCategory('hvac').map(
  (sym) => sym.id as SymbolKey
)

/** Fixed-appliance symbols that are not appliances; picking an appliance type would replace them. */
const NON_APPLIANCE_FIXED_SYMBOLS = new Set<string>([
  'junction_box',
  'junction_panel',
  'terminal_strip',
  'domotica',
  'energy_meter',
  'solar_panel',
  'battery',
  'transformer',
  'rectifier',
  'inverter',
  'dc_dc_converter',
])

/** Whether the appliance-type dropdown applies to this endpoint. */
export function hasApplianceTypePicker(endpoint: Endpoint): boolean {
  return (
    endpoint.type === 'fixed_appliance' &&
    !isInBetweenEndpoint(endpoint) &&
    !NON_APPLIANCE_FIXED_SYMBOLS.has(endpoint.symbol ?? '')
  )
}

/** Normalize legacy socket symbol keys for display (old projects may have socket_230v/socket_3phase) */
export function normalizeSocketSymbol(symbol: SymbolKey | string | undefined): SymbolKey {
  if (symbol === 'socket_230v') return 'socket_gnd_child'
  if (symbol === 'socket_3phase') return 'socket'
  return (symbol as SymbolKey) ?? 'socket_gnd_child'
}

/** Normalize switch symbol keys for display (legacy + switch_2p_twoway shown as two-way with 2 poles) */
export function normalizeSwitchSymbol(symbol: SymbolKey | string | undefined): SymbolKey {
  if (symbol === 'switch_single') return 'switch'
  if (symbol === 'switch_double' || symbol === 'switch_2p_twoway') return 'switch_1p_twoway'
  return (symbol as SymbolKey) ?? 'switch'
}
