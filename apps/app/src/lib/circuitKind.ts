/**
 * Derives circuit kind (type) from circuit endpoints and trunk devices.
 * Used for display in properties and for rule enforcing.
 *
 * Rules:
 * - Switches, domotica, and energy conversion (except battery/solar) do not affect type.
 * - Only sockets → sockets; only light → lighting; only fixed appliance (or fixed + sockets) → fixed_appliance.
 * - Stove, boiler, heating, solar, battery, doorbell, subpanel, HVAC have dedicated types.
 */
import type { Circuit, ProtectionDevice, Endpoint, TrunkDevice, CircuitKind, SymbolKey } from '@/types/schema'

// Endpoints that do not affect circuit type (ignored when deriving)
const SWITCH_SYMBOLS: SymbolKey[] = [
  'switch', 'switch_1p_twoway', 'switch_2p_twoway', 'switch_dimmer',
  'switch_1p_changeover', 'switch_1p_pull', 'contact', 'switch_impulse', 'switch_cross', 'motion_detector',
  'smoke_detector',
  'switch_single', 'switch_double',
]

function isSwitchOrDomotica(ep: Endpoint): boolean {
  // Relay is a load (controls lights etc.), not a switch for circuit type
  if (ep.symbol === 'relay') return false
  if (ep.type === 'switch') return true
  if (ep.symbol === 'domotica') return true
  if (SWITCH_SYMBOLS.includes(ep.symbol as SymbolKey)) return true
  return false
}

type LoadCategory =
  | 'socket'
  | 'light'
  | 'fixed_appliance'
  | 'stove'
  | 'boiler'
  | 'heating'
  | 'hvac'
  | 'doorbell'
  | 'ev'

function loadCategory(symbol: SymbolKey | undefined): LoadCategory | null {
  if (!symbol) return null
  switch (symbol) {
    case 'socket':
    case 'socket_gnd':
    case 'socket_child':
    case 'socket_gnd_child':
      return 'socket'
    case 'light_point':
    case 'light_spot':
    case 'light_led':
    case 'light_fluorescent':
      return 'light'
    case 'stove':
      return 'stove'
    case 'boiler':
      return 'boiler'
    case 'heating':
      return 'heating'
    case 'furnace':
    case 'ventilation':
      return 'hvac'
    case 'buzzer':
    case 'bell':
    case 'horn':
    case 'siren':
      return 'doorbell'
    case 'fixed_appliance_generic':
    case 'oven':
    case 'washer':
    case 'dryer':
    case 'dishwasher':
    case 'freezer':
    case 'fridge':
    case 'microwave':
    case 'motor':
      return 'fixed_appliance'
    case 'ev':
      return 'ev'
    default:
      return null
  }
}

/** Get the circuit kind derived from endpoints and trunk devices. Use for display and rules. */
export function getDerivedCircuitKind(
  circuit: Circuit,
  protection?: ProtectionDevice | null
): CircuitKind {
  // 1. Subpanel: circuit is fed by a protection that supplies a secondary panel
  if (protection?.subPanelId) return 'subpanel'

  // 2. Solar / battery: on trunk (energy conversion) or as endpoint
  const trunk = circuit.trunkDevices ?? []
  const hasSolarTrunk = trunk.some((d: TrunkDevice) => d.symbol === 'solar_panel')
  const hasBatteryTrunk = trunk.some((d: TrunkDevice) => d.symbol === 'battery')
  const hasSolarEndpoint = circuit.endpoints.some((ep: Endpoint) => ep.symbol === 'solar_panel')
  const hasBatteryEndpoint = circuit.endpoints.some((ep: Endpoint) => ep.symbol === 'battery')
  if (hasSolarTrunk || hasSolarEndpoint) return 'solar'
  if (hasBatteryTrunk || hasBatteryEndpoint) return 'battery'

  // 3. Load-relevant endpoints only (exclude switches and domotica)
  const loadEndpoints = circuit.endpoints.filter((ep) => !isSwitchOrDomotica(ep))
  const categories = loadEndpoints
    .map((ep) => loadCategory(ep.symbol as SymbolKey))
    .filter((c): c is NonNullable<typeof c> => c !== null)

  if (categories.length === 0) return 'empty'

  // 4. Doorbell only
  const onlyDoorbell = categories.length > 0 && categories.every((c) => c === 'doorbell')
  if (onlyDoorbell) return 'doorbell'

  // 5. Only sockets
  const onlySockets = categories.length > 0 && categories.every((c) => c === 'socket')
  if (onlySockets) return 'sockets'

  // 6. Only light
  const onlyLight = categories.length > 0 && categories.every((c) => c === 'light')
  if (onlyLight) return 'lighting'

  // 7. Only fixed appliance, or fixed appliance + sockets only (fixed behind socket)
  const hasFixed = categories.includes('fixed_appliance')
  const hasOtherThanFixedOrSocket = categories.some((c) => c !== 'fixed_appliance' && c !== 'socket')
  if (hasFixed && !hasOtherThanFixedOrSocket) return 'fixed_appliance'

  // 8. Boiler only, or boiler + sockets (boiler may sit behind one socket/domotica)
  const hasBoiler = categories.includes('boiler')
  const hasOtherThanBoilerOrSocket = categories.some((c) => c !== 'boiler' && c !== 'socket')
  if (hasBoiler && !hasOtherThanBoilerOrSocket) return 'boiler'

  // 9. Heating only, or heating + sockets (heating may sit behind one socket/domotica)
  const hasHeating = categories.includes('heating')
  const hasOtherThanHeatingOrSocket = categories.some((c) => c !== 'heating' && c !== 'socket')
  if (hasHeating && !hasOtherThanHeatingOrSocket) return 'heating'

  // 10. Only HVAC (furnace, ventilation) — no other loads
  const onlyHvac = categories.length > 0 && categories.every((c) => c === 'hvac')
  if (onlyHvac) return 'hvac'

  // 11. Stove only — if combined with other loads, treat as mixed
  const onlyStove = categories.length > 0 && categories.every((c) => c === 'stove')
  if (onlyStove) return 'stove'

  // 12. EV charger only
  const onlyEv = categories.length > 0 && categories.every((c) => c === 'ev')
  if (onlyEv) return 'ev'

  // 13. Mixed or other
  const unique = new Set(categories)
  if (unique.size > 1) return 'mixed'
  return 'other'
}
