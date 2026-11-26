import type { TrunkDevice } from '@/types/schema'

/**
 * Where a supply tap physically starts, from the devices upstream of it in supply order (grid
 * source first, see `getSupplyTapUpstreamDevices`): the first terminal strip after the nearest
 * upstream protection (an originating terminal block, so every tap behind it is a star from that
 * block), else that protection (individual runs from the breaker), else the nearest device.
 */
export function getSupplyTapOrigin(upstream: readonly TrunkDevice[]): TrunkDevice | undefined {
  let protectionIndex = -1
  upstream.forEach((device, index) => {
    if (device.type === 'protection') protectionIndex = index
  })
  const strip = upstream.slice(protectionIndex + 1).find((device) => device.symbol === 'terminal_strip')
  return strip ?? upstream[protectionIndex] ?? upstream.at(-1)
}
