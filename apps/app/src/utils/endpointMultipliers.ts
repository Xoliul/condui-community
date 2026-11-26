import type { Endpoint } from '@/types/schema'
import { getSymbolById, isHvacDeviceSymbol } from '@/lib/symbols'

export function endpointSupportsMultiplier(endpoint: Endpoint): boolean {
  if (endpoint.type === 'light_point') return true
  if (
    endpoint.type === 'switch' &&
    (endpoint.symbol === 'switch_impulse' ||
      endpoint.symbol === 'smoke_detector' ||
      endpoint.symbol === 'motion_detector')
  ) {
    return true
  }
  if (endpoint.symbol && getSymbolById(endpoint.symbol)?.category === 'sound') return true
  // Allow multipliers for DC energy endpoints on sitplan
  if (endpoint.type === 'fixed_appliance' && (endpoint.symbol === 'solar_panel' || endpoint.symbol === 'battery')) {
    return true
  }
  // Any HVAC device (ventilation, boiler, heating, a downstream HVAC source, …) supports "add more"
  // when chained after an HVAC source (furnace/heat pump). Gating on the topology-derived flag rather
  // than a specific symbol means changing a chained unit's type afterwards keeps the multiplier instead
  // of orphaning its placements. The flag is synced by syncDerivedEndpointFlags on branch changes.
  if (
    endpoint.type === 'fixed_appliance' &&
    isHvacDeviceSymbol(endpoint.symbol) &&
    endpoint.fixedApplianceProps?.chainedAfterHvacSource === true
  ) {
    return true
  }
  return false
}

/**
 * Canonical multiplier is derived from sitplan placement count.
 */
export function getEndpointMultiplier(endpoint: Endpoint): number {
  if (!endpointSupportsMultiplier(endpoint)) return 1
  return Math.max(1, endpoint.placements.length)
}
