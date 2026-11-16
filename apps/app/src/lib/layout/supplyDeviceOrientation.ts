import type { TrunkDevice } from '@/types/schema'
import { getSupplyConverterDcConnectionIndex } from '@/lib/supplyAssembly/converterDcConnections'

type SupplyDeviceOrientationSource = Pick<
  TrunkDevice,
  'supplyPath' | 'converterGridPlacement' | 'changeoverGridPlacement' | 'supplyDcBusId'
> &
  Partial<Pick<TrunkDevice, 'id'>>

/** Layout facts that change a supply device's orientation without changing the device. */
export interface SupplyDeviceOrientationContext {
  /**
   * Effective changeover grid source of the panel. With `converter-input` the changeover's
   * port-1 devices sit inline on the horizontal wire from the inverter-leg tap.
   */
  changeoverGridSource?: 'grid' | 'converter-input'
  /**
   * Devices on a converter DC top lane that holds several devices. Such a lane is a horizontal
   * chain leaving the converter port, so its devices use the inline (horizontal) artwork.
   */
  horizontalDcLaneDeviceIds?: ReadonlySet<string>
}

/** Ids of top-lane DC devices that are chained horizontally because their lane holds several. */
export function getHorizontalDcLaneDeviceIds(
  devices: readonly TrunkDevice[]
): ReadonlySet<string> {
  const laneSizes = new Map<number, number>()
  for (const device of devices) {
    if (device.supplyPath !== 'converter-dc-top') continue
    const lane = getSupplyConverterDcConnectionIndex(device) ?? 1
    laneSizes.set(lane, (laneSizes.get(lane) ?? 0) + 1)
  }
  return new Set(
    devices
      .filter(
        (device) =>
          device.supplyPath === 'converter-dc-top' &&
          device.type !== 'dc_bus' &&
          !device.supplyDcBusId &&
          (laneSizes.get(getSupplyConverterDcConnectionIndex(device) ?? 1) ?? 0) > 1
      )
      .map((device) => device.id)
  )
}

/** Supply devices placed on upright risers must keep their normal artwork orientation. */
export function isVerticalSupplyDevice(
  device: SupplyDeviceOrientationSource,
  context?: SupplyDeviceOrientationContext
): boolean {
  if (device.id != null && context?.horizontalDcLaneDeviceIds?.has(device.id)) return false
  return (
    (device.supplyPath === 'converter-grid' &&
      (device.converterGridPlacement === 'input-leg' ||
        device.converterGridPlacement === 'converter-leg')) ||
    (device.supplyPath === 'changeover-grid' &&
      device.changeoverGridPlacement === 'input-leg' &&
      context?.changeoverGridSource !== 'converter-input') ||
    device.supplyPath === 'converter-dc-top' ||
    !!device.supplyDcBusId
  )
}

/** The orientation facts a laid-out supply panel records for its devices. */
export function getPanelSupplyOrientationContext(panelLayout: {
  supplyChangeoverGridSource?: 'converter-input'
  supplyHorizontalDcLaneDeviceIds?: ReadonlySet<string>
}): SupplyDeviceOrientationContext {
  return {
    changeoverGridSource: panelLayout.supplyChangeoverGridSource,
    horizontalDcLaneDeviceIds: panelLayout.supplyHorizontalDcLaneDeviceIds,
  }
}
