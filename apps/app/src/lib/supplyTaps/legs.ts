import type { TrunkDevice } from '@/types/schema'
import type { SupplyTapAnchor } from '@/types/supplySources'

export type SupplyTapLeg = SupplyTapAnchor['leg']

/**
 * The leg of the owner's supply grid side a root-feed trunk device sits on, or undefined when it
 * is not on a grid-side leg a tap can leave from (backup, DC and converter-branch devices).
 * Mirrors the supply layout: the serial run is the main grid wire, `changeover-grid` is the
 * changeover port-1 riser and `converter-grid` is the converter grid-input leg.
 */
export function getSupplyTapLegOfDevice(
  device: Pick<TrunkDevice, 'supplyPath'>
): SupplyTapLeg | undefined {
  switch (device.supplyPath) {
    case undefined:
    case 'serial':
      return 'grid-run'
    case 'changeover-grid':
      return 'changeover-grid'
    case 'converter-grid':
      return 'converter-input'
    default:
      return undefined
  }
}

/** Devices of one grid-side leg, in supply order (source toward the load). */
export function getSupplyTapLegDevices(
  devices: readonly TrunkDevice[] | undefined,
  leg: SupplyTapLeg
): TrunkDevice[] {
  return (devices ?? []).filter((device) => getSupplyTapLegOfDevice(device) === leg)
}

/**
 * Devices of one grid-side leg a tap may leave from, in supply order. On the grid run these are
 * the serial devices up to the source changeover: devices stored after it are on its load side,
 * where a tap would be fed from the backup, and devices handed off to the panel are not part of
 * the supply wire. Other legs list every device on that leg.
 */
export function getGridSideTapDevices(
  devices: readonly TrunkDevice[] | undefined,
  leg: SupplyTapLeg
): TrunkDevice[] {
  const all = devices ?? []
  const changeoverIndex = all.findIndex(
    (device) => device.type === 'changeover' || device.symbol === 'source_changeover'
  )
  return all.filter(
    (device, index) =>
      getSupplyTapLegOfDevice(device) === leg &&
      !device.supplyPanelInput &&
      (leg !== 'grid-run' || changeoverIndex < 0 || index < changeoverIndex)
  )
}
