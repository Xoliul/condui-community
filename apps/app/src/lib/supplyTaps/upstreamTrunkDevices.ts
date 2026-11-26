import type { Circuit, Panel, ProtectionDevice, TrunkDevice } from '@/types/schema'
import type { SupplyTapAnchor } from '@/types/supplySources'
import { isConverterGridLegPlacement } from '@/lib/supplyAssembly/changeoverGridSource'
import { getSupplyTapLegOfDevice } from './legs'
import { getSupplyTapsPanel } from './virtualPanel'

/**
 * Owner supply devices a tap sees upstream of itself, in supply order (grid source toward the tap).
 * `feedDevices` are the owner's root-feed trunk devices and `sharedDevices` the installation's
 * shared feed in front of them. The chain ends at the anchor device and never contains devices
 * downstream of it, nor inverter, backup or converter-branch devices.
 *
 * - `grid-run`: serial run devices up to the anchor.
 * - `changeover-grid`: the serial devices before the changeover, then the changeover grid-leg
 *   devices up to the anchor.
 * - `converter-input`: the serial devices before the changeover, then, for an inline device on
 *   the grid wire after the converter T, the inline devices from the T up to the anchor (stored
 *   nearest the changeover first, so in reverse); for a device on the converter's input riser, the
 *   riser devices up to the anchor.
 * - `changeover-grid` inline on the grid wire (not on the port-1 riser): the serial devices, the
 *   inline converter-grid devices between the T and the changeover riser, then the grid-wire
 *   devices from the riser up to the anchor (stored nearest the grid bus first, so in reverse).
 * An anchor without a device is the start of its leg: only what precedes the leg counts.
 */
export function getSupplyTapUpstreamDevices(
  sharedDevices: readonly TrunkDevice[] | undefined,
  feedDevices: readonly TrunkDevice[] | undefined,
  anchor: SupplyTapAnchor
): TrunkDevice[] {
  const devices = feedDevices ?? []
  const changeoverIndex = devices.findIndex((device) => device.symbol === 'source_changeover')
  const serialRun = devices.filter(
    (device, index) =>
      getSupplyTapLegOfDevice(device) === 'grid-run' &&
      (anchor.leg === 'grid-run' || changeoverIndex < 0 || index < changeoverIndex)
  )
  const leg = devices.filter((device) => getSupplyTapLegOfDevice(device) === anchor.leg)
  const upToAnchor = (list: readonly TrunkDevice[]): TrunkDevice[] => {
    if (anchor.afterTrunkDeviceId === undefined) return []
    const index = list.findIndex((device) => device.id === anchor.afterTrunkDeviceId)
    return index < 0 ? [] : list.slice(0, index + 1)
  }
  const anchorDevice = devices.find((device) => device.id === anchor.afterTrunkDeviceId)
  const inlineConverterGrid = devices.filter(
    (device) =>
      getSupplyTapLegOfDevice(device) === 'converter-input' &&
      !isConverterGridLegPlacement(device.converterGridPlacement)
  )
  const chain = (() => {
    if (anchor.leg === 'grid-run') return upToAnchor(serialRun)
    if (changeoverIndex < 0) return [...serialRun, ...upToAnchor(leg)]
    if (anchor.leg === 'converter-input') {
      return anchorDevice && isConverterGridLegPlacement(anchorDevice.converterGridPlacement)
        ? [...serialRun, ...upToAnchor(leg.filter((device) => isConverterGridLegPlacement(device.converterGridPlacement)))]
        : [...serialRun, ...upToAnchor([...inlineConverterGrid].reverse())]
    }
    if (anchorDevice?.changeoverGridPlacement === 'input-leg')
      return [...serialRun, ...upToAnchor(leg.filter((device) => device.changeoverGridPlacement === 'input-leg'))]
    const gridWire = leg.filter((device) => device.changeoverGridPlacement !== 'input-leg')
    return [...serialRun, ...inlineConverterGrid, ...upToAnchor([...gridWire].reverse())]
  })()
  return [...(sharedDevices ?? []), ...chain]
}

/** The tap anchor of the top-level item of the owner's supply-taps board that holds `circuitId`. */
export function findSupplyTapAnchorOfCircuit(
  virtualBoard: Pick<Panel, 'protections' | 'circuits'>,
  circuitId: string
): SupplyTapAnchor | undefined {
  const direct = (virtualBoard.circuits ?? []).find((circuit) => circuit.id === circuitId)
  if (direct) return direct.supplyTap
  return (virtualBoard.protections ?? []).find((protection: ProtectionDevice) =>
    (protection.circuits ?? []).some((circuit: Circuit) => circuit.id === circuitId)
  )?.supplyTap
}

/** Convenience for callers that only hold the owner panel. */
export function findOwnerSupplyTapAnchor(
  owner: Pick<Panel, 'subPanels'>,
  circuitId: string
): SupplyTapAnchor | undefined {
  const board = getSupplyTapsPanel(owner)
  return board ? findSupplyTapAnchorOfCircuit(board, circuitId) : undefined
}
