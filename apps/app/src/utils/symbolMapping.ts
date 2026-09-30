import { getLocalizedSymbolName } from '@/lib/symbolNames'
/**
 * Utility functions for mapping symbol metadata to endpoint types and symbol keys
 */

import type { SymbolMetadata } from '@/lib/symbols'
import { withModularSocketProps } from '@/lib/socket/modularSocket'
import type { Endpoint, EndpointType, SymbolKey } from '@/types/schema'

/**
 * Map symbol ID to endpoint type
 */
export function getEndpointTypeFromSymbol(symbol: SymbolMetadata): EndpointType | null {
  const id = symbol.id

  // Sockets (including library double presets)
  if (
    id === 'socket' ||
    id === 'socket_gnd' ||
    id === 'socket_child' ||
    id === 'socket_gnd_child' ||
    id === 'double_socket_child' ||
    id === 'double_socket_gnd_child' ||
    id === 'modular_socket'
  ) {
    return 'socket'
  }

  // Switches
  if (
    id === 'switch' ||
    id === 'switch_1p_twoway' ||
    id === 'switch_2p_twoway' ||
    id === 'switch_dimmer' ||
    id === 'switch_1p_changeover' ||
    id === 'switch_1p_pull' ||
    id === 'contact' ||
    id === 'switch_impulse' ||
    id === 'switch_cross' ||
    id === 'motion_detector' ||
    id === 'smoke_detector' ||
    id === 'relay' ||
    id === 'switch_single' ||
    id === 'switch_double'
  ) {
    return 'switch'
  }

  // Lighting
  if (
    id === 'light_point' ||
    id === 'light_spot' ||
    id === 'light_led' ||
    id === 'light_fluorescent'
  ) {
    return 'light_point'
  }

  // Appliances
  if (
    id === 'oven' ||
    id === 'washer' ||
    id === 'dryer' ||
    id === 'dishwasher' ||
    id === 'boiler' ||
    id === 'ev' ||
    id === 'freezer' ||
    id === 'fridge' ||
    id === 'microwave' ||
    id === 'motor' ||
    id === 'fixed_appliance_generic' ||
    id === 'stove' ||
    id === 'furnace' ||
    id === 'furnace_heatpump' ||
    id === 'furnace_gas' ||
    id === 'furnace_oil' ||
    id === 'furnace_pellets' ||
    id === 'heating' ||
    id === 'ventilation' ||
    id === 'door_lock' ||
    id === 'buzzer' ||
    id === 'bell' ||
    id === 'horn' ||
    id === 'siren' ||
    id === 'solar_panel' ||
    id === 'battery'
  ) {
    return 'fixed_appliance'
  }

  // DC busbars are selectable trunk/topology devices, never endpoint symbols.
  if (id === 'dc_bus') return null

  // Domotica
  if (id === 'domotica') {
    return 'domotica'
  }

  // Metering and energy conversion (can be trunk device or endpoint)
  if (
    id === 'energy_meter' ||
    id === 'transformer' ||
    id === 'rectifier' ||
    id === 'inverter' ||
    id === 'dc_dc_converter'
  ) {
    return 'fixed_appliance'
  }

  // Junction box/panel: can be trunk device or in-between endpoint on branch (like energy meter)
  if (id === 'junction_box' || id === 'junction_panel' || id === 'terminal_strip') {
    return 'fixed_appliance'
  }

  // Protection devices and grid/panel symbols are not endpoints
  // They are handled via dedicated protection/panel drop behaviors instead.
  if (
    id === 'mcb' ||
    id === 'rcd' ||
    id === 'rcbo' ||
    id === 'fuse' ||
    id === 'main_switch' ||
    id === 'spd' ||
    id === 'panel_distribution' ||
    id === 'mains' ||
    id === 'earthing'
  ) {
    return null
  }

  // Default to fixed_appliance for unknown types
  return 'fixed_appliance'
}

/**
 * Map symbol ID to symbol key (for endpoint.symbol field)
 * Returns the actual symbol ID as the symbol key to preserve subtype information
 */
export function getSymbolKeyFromSymbol(symbol: SymbolMetadata): SymbolKey | undefined {
  const id = symbol.id

  // Map known symbols - return the actual symbol ID to preserve subtype
  // Sockets
  if (
    id === 'socket' ||
    id === 'socket_gnd' ||
    id === 'socket_child' ||
    id === 'socket_gnd_child'
  ) {
    return id as SymbolKey
  }
  if (id === 'double_socket_child') return 'socket_child' as SymbolKey
  if (id === 'double_socket_gnd_child') return 'socket_gnd_child' as SymbolKey
  if (id === 'modular_socket') return 'socket_gnd_child' as SymbolKey

  // Switches (return resolved id for legacy)
  if (
    id === 'switch' ||
    id === 'switch_1p_twoway' ||
    id === 'switch_2p_twoway' ||
    id === 'switch_dimmer' ||
    id === 'switch_1p_changeover' ||
    id === 'switch_1p_pull' ||
    id === 'contact' ||
    id === 'switch_impulse' ||
    id === 'switch_cross' ||
    id === 'motion_detector' ||
    id === 'smoke_detector' ||
    id === 'relay'
  ) {
    return id as SymbolKey
  }
  if (id === 'switch_single') return 'switch' as SymbolKey
  if (id === 'switch_double') return 'switch_1p_twoway' as SymbolKey

  // Lighting
  if (
    id === 'light_point' ||
    id === 'light_spot' ||
    id === 'light_led' ||
    id === 'light_fluorescent'
  ) {
    return id as SymbolKey
  }

  // Appliances - preserve specific symbol so correct SVG is shown
  if (
    id === 'oven' ||
    id === 'washer' ||
    id === 'dryer' ||
    id === 'dishwasher' ||
    id === 'boiler' ||
    id === 'ev' ||
    id === 'freezer' ||
    id === 'fridge' ||
    id === 'microwave' ||
    id === 'motor' ||
    id === 'fixed_appliance_generic' ||
    id === 'stove' ||
    id === 'furnace' ||
    id === 'furnace_heatpump' ||
    id === 'furnace_gas' ||
    id === 'furnace_oil' ||
    id === 'furnace_pellets' ||
    id === 'heating' ||
    id === 'ventilation' ||
    id === 'door_lock' ||
    id === 'buzzer' ||
    id === 'bell' ||
    id === 'horn' ||
    id === 'siren' ||
    id === 'solar_panel' ||
    id === 'battery'
  ) {
    // All furnace presets share the same symbol key so rendering logic stays simple
    if (
      id === 'furnace_heatpump' ||
      id === 'furnace_gas' ||
      id === 'furnace_oil' ||
      id === 'furnace_pellets'
    ) {
      return 'furnace'
    }
    return id as SymbolKey
  }

  // Domotica, energy meter, junction, energy conversion - preserve specific symbol
  if (
    id === 'domotica' ||
    id === 'energy_meter' ||
    id === 'source_changeover' ||
    id === 'junction_box' ||
    id === 'junction_panel' ||
    id === 'terminal_strip' ||
    id === 'transformer' ||
    id === 'rectifier' ||
    id === 'inverter' ||
    id === 'dc_dc_converter'
  ) {
    return id as SymbolKey
  }

  return undefined
}

/**
 * Check if a symbol is a switch (any type)
 */
export function isSwitchSymbol(symbol: SymbolMetadata): boolean {
  const id = symbol.id
  return (
    id === 'switch' ||
    id === 'switch_1p_twoway' ||
    id === 'switch_2p_twoway' ||
    id === 'switch_dimmer' ||
    id === 'switch_1p_changeover' ||
    id === 'switch_1p_pull' ||
    id === 'contact' ||
    id === 'switch_impulse' ||
    id === 'switch_cross' ||
    id === 'motion_detector' ||
    id === 'smoke_detector' ||
    id === 'relay' ||
    id === 'switch_single' ||
    id === 'switch_double'
  )
}

/**
 * Check if a symbol is a relay
 */
export function isRelaySymbol(symbol: SymbolMetadata): boolean {
  const id = symbol.id
  return (
    id === 'relay' ||
    id === 'teleruptor' ||
    (id.includes && (id.includes('relay') || id.includes('teleruptor')))
  )
}

/**
 * Check if a symbol is a switch or relay (should be inserted on branch, not create new branch)
 */
export function isSwitchOrRelay(symbol: SymbolMetadata): boolean {
  return isSwitchSymbol(symbol) || isRelaySymbol(symbol)
}

/**
 * In-between devices sit between trunk and actual endpoint (switch, relay, domotica, energy_meter, junction_box).
 * They can have many per branch and must never be after the actual endpoint.
 */
export function isInBetweenDevice(symbol: SymbolMetadata): boolean {
  const id = symbol.id
  return (
    id === 'switch' ||
    id === 'switch_1p_twoway' ||
    id === 'switch_2p_twoway' ||
    id === 'switch_dimmer' ||
    id === 'switch_1p_changeover' ||
    id === 'switch_1p_pull' ||
    id === 'contact' ||
    id === 'switch_impulse' ||
    id === 'switch_cross' ||
    id === 'motion_detector' ||
    id === 'smoke_detector' ||
    id === 'relay' ||
    id === 'domotica' ||
    id === 'energy_meter' ||
    id === 'junction_box' ||
    id === 'junction_panel' ||
    id === 'terminal_strip' ||
    id === 'switch_single' ||
    id === 'switch_double'
  )
}

/**
 * Static endpoint symbols that may be added after a socket on the same branch.
 *
 * Conversion devices are endpoint loads in this position. They still change
 * the electrical domain for the part of the branch after them, but they do
 * not become circuit-wide trunk devices just because they are converters.
 */
const FIXED_APPLIANCE_SYMBOL_IDS = [
  'oven',
  'washer',
  'dryer',
  'dishwasher',
  'boiler',
  'ev',
  'freezer',
  'fridge',
  'microwave',
  'motor',
  'fixed_appliance_generic',
  'stove',
  'furnace',
  'furnace_heatpump',
  'furnace_gas',
  'furnace_oil',
  'furnace_pellets',
  'heating',
  'ventilation',
  'door_lock',
  'buzzer',
  'bell',
  'horn',
  'siren',
  'solar_panel',
  'battery',
  'transformer',
  'rectifier',
  'inverter',
  'dc_dc_converter',
] as const

/**
 * True if the symbol is a static device (the endpoint class that can be
 * placed after a socket).
 */
export function isFixedApplianceSymbol(symbol: SymbolMetadata): boolean {
  return FIXED_APPLIANCE_SYMBOL_IDS.includes(
    symbol.id as (typeof FIXED_APPLIANCE_SYMBOL_IDS)[number]
  )
}

/**
 * Actual endpoints sit at the very end of a branch (socket, light, fixed_appliance).
 * Only one terminal (socket/light) per branch; static devices can follow a socket.
 */
export function isActualEndpointSymbol(symbol: SymbolMetadata): boolean {
  const id = symbol.id
  return (
    id === 'socket' ||
    id === 'socket_gnd' ||
    id === 'socket_child' ||
    id === 'socket_gnd_child' ||
    id === 'double_socket_child' ||
    id === 'double_socket_gnd_child' ||
    id === 'modular_socket' ||
    id === 'light_point' ||
    id === 'light_spot' ||
    id === 'light_led' ||
    id === 'light_fluorescent' ||
    id === 'fixed_appliance_generic' ||
    // Static machines (oven, washer, etc.) — can be added after socket later; don't lock out
    id === 'oven' ||
    id === 'washer' ||
    id === 'dryer' ||
    id === 'dishwasher' ||
    id === 'boiler' ||
    id === 'furnace' ||
    id === 'ev' ||
    id === 'freezer' ||
    id === 'fridge' ||
    id === 'microwave' ||
    id === 'motor' ||
    id === 'stove' ||
    id === 'heating' ||
    id === 'ventilation' ||
    id === 'door_lock' ||
    id === 'buzzer' ||
    id === 'bell' ||
    id === 'horn' ||
    id === 'siren' ||
    id === 'solar_panel' ||
    id === 'battery' ||
    id === 'transformer' ||
    id === 'rectifier' ||
    id === 'inverter' ||
    id === 'dc_dc_converter'
  )
}

/**
 * Whether an existing endpoint is "in-between" (switch, relay, domotica,
 * energy_meter, junction_box). Conversion endpoints are static branch devices,
 * so they remain at the end of their branch and own the domain boundary there.
 */
export function isInBetweenEndpoint(ep: Endpoint): boolean {
  if (ep.type === 'switch') return true
  return (
    ep.symbol === 'domotica' ||
    ep.symbol === 'energy_meter' ||
    ep.symbol === 'junction_box' ||
    ep.symbol === 'junction_panel' ||
    ep.symbol === 'terminal_strip'
  )
}

/**
 * Whether an existing endpoint is an actual endpoint (must be at end of branch).
 */
export function isActualEndpoint(ep: Endpoint): boolean {
  return !isInBetweenEndpoint(ep)
}

/**
 * Whether a symbol can be inserted on a circuit's vertical trunk
 * (like a protection device, but for metering/inline devices).
 * Currently only energy_meter supports trunk insertion.
 */
export function isTrunkInsertable(symbol: SymbolMetadata): boolean {
  return symbol.id === 'energy_meter'
}

/**
 * Whether a symbol can be inserted on the supply wire of the main panel.
 * Supports energy meters and protection devices (MCB, RCD, RCBO, etc.)
 * which appear as trunk devices on the horizontal supply wire.
 */
export function isSupplyTrunkInsertable(symbol: SymbolMetadata): boolean {
  const id = symbol.id
  return (
    id === 'energy_meter' ||
    id === 'source_changeover' ||
    id === 'mcb' ||
    id === 'rcd' ||
    id === 'rcbo'
  )
}

/**
 * Whether an existing trunk device type is trunk-insertable (for runtime checks)
 */
export function isTrunkDeviceType(type: string): boolean {
  return (
    type === 'energy_meter' ||
    type === 'protection' ||
    type === 'changeover' ||
    type === 'conversion' ||
    type === 'domotica'
  )
}

/**
 * Get a default label for a symbol based on its metadata
 */
export function getDefaultLabel(symbol: SymbolMetadata, locale: string = 'nl-BE'): string {
  return getLocalizedSymbolName(symbol, locale)
}

/** Apply library-only preset defaults (e.g. double socket count) after symbol key is resolved. */
export function applyLibraryPresetToEndpoint(symbol: SymbolMetadata, endpoint: Endpoint): void {
  if (symbol.id === 'double_socket_child' || symbol.id === 'double_socket_gnd_child') {
    endpoint.socketProps = { ...(endpoint.socketProps ?? {}), socketCount: 2 }
  }
  if (symbol.id === 'modular_socket') {
    endpoint.socketProps = withModularSocketProps(endpoint.socketProps)
  }
}
