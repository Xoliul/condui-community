import { isEnergyConversionEndpointSymbol, isDcOnlyEndpointSymbol } from '@/lib/eendraad/endpointInsertAfter'
import type { SymbolMetadata } from '@/lib/symbols'
import { getEndpointTypeFromSymbol } from '@/utils/symbolMapping'

/** What a symbol becomes when dropped on a supply tap handle. */
/** `strip`: a terminal strip on the tap lead; only a protection may follow it. */
export type SupplyTapSymbolKind = 'protection' | 'meter' | 'strip' | 'load'

/** Protections a tap may start with; a surge protector is not a circuit protection. */
const TAP_PROTECTION_SYMBOLS: readonly string[] = [
  'mcb',
  'fuse',
  'rcd',
  'rcbo',
  'main_switch',
  'rotating_switch',
]

/** Library categories whose symbols are plain loads, so equipment that is not a load never qualifies. */
const TAP_LOAD_CATEGORIES: readonly string[] = ['appliances', 'hvac', 'outlets', 'lighting']

const TAP_LOAD_ENDPOINT_TYPES: readonly string[] = ['socket', 'light_point', 'fixed_appliance']

/** The tap kind a symbol can create, or null when it cannot start a supply tap. */
export function getSupplyTapSymbolKind(symbol: SymbolMetadata): SupplyTapSymbolKind | null {
  if (TAP_PROTECTION_SYMBOLS.includes(symbol.id)) return 'protection'
  if (symbol.id === 'energy_meter') return 'meter'
  if (symbol.id === 'terminal_strip') return 'strip'
  const type = getEndpointTypeFromSymbol(symbol)
  if (
    !type ||
    !TAP_LOAD_CATEGORIES.includes(symbol.category) ||
    !TAP_LOAD_ENDPOINT_TYPES.includes(type) ||
    isEnergyConversionEndpointSymbol(symbol.id) ||
    isDcOnlyEndpointSymbol(symbol)
  )
    return null
  return 'load'
}
