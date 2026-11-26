import type { Circuit, TrunkDevice } from '@/types/schema'

/**
 * Trunk devices that may share a trunk with risers: they sit on the shared part between the breaker and the split
 * (`trunkPosition` 0, so they measure or switch every riser). Domain converters, inline protections, changeovers,
 * DC rails and devices between rows are not supported.
 */
const RISER_TRUNK_DEVICE_TYPES: ReadonlySet<TrunkDevice['type']> = new Set([
  'energy_meter', 'terminal_strip', 'junction_box', 'junction_panel', 'switch', 'relay',
])

export function isRiserCompatibleTrunkDevice(device: TrunkDevice): boolean {
  return RISER_TRUNK_DEVICE_TYPES.has(device.type) && (device.trunkPosition ?? 0) === 0 && !device.supplyPath &&
    !device.converterDcConnection && !device.dcBusProps
}

/** True when every trunk device of the circuit may sit under the split of a riser circuit (also without devices). */
export function hasOnlyRiserCompatibleTrunkDevices(circuit: Pick<Circuit, 'trunkDevices'>): boolean {
  return (circuit.trunkDevices ?? []).every(isRiserCompatibleTrunkDevice)
}
