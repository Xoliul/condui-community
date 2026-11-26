/**
 * Where manual risers leave the trunk. Without trunk devices the split sits `CIRCUIT_RISER_SPLIT_RISE` above the
 * breaker; with devices on the shared part (energy meter, terminal strip, junction box, trunk switch) it sits just
 * above the topmost one, so the risers fork after the meter. Rows are lifted by the same amount, which keeps the
 * span between the split and the first row of every riser (its cable caption) as without risers.
 */
import type { Circuit, TrunkDevice } from '@/types/schema'
import { getTrunkDeviceVerticalPaintHeight } from './trunkDeviceSpacing'
import { CIRCUIT_RISER_SPLIT_RISE } from './layoutTreeCircuitColumns'

/** Clear distance kept between a trunk device's painted top and the split. */
const SPLIT_DEVICE_CLEARANCE = 12

export interface RiserSplitGeometry {
  /** How far the rows move up. */
  lift: number
  /** Distance from the breaker row (`trunkY`) to the split; absent when it is the default rise. */
  splitRise?: number
}

/** The topmost device of the shared part, if any. */
function getTopSharedDevice(circuit: Pick<Circuit, 'trunkDevices'>): TrunkDevice | undefined {
  return (circuit.trunkDevices ?? []).filter((device) => (device.trunkPosition ?? 0) === 0).at(-1)
}

export function getRiserSplitGeometry(
  circuit: Pick<Circuit, 'trunkDevices'>,
  startY: number,
  firstBranchY: number,
  constants: { SYMBOL_SIZE: number; BRANCH_START_OFFSET: number },
  captionSpan: number,
): RiserSplitGeometry {
  const top = getTopSharedDevice(circuit)
  if (!top) return { lift: CIRCUIT_RISER_SPLIT_RISE }
  // `firstBranchY` is the topmost device centre minus BRANCH_START_OFFSET.
  const deviceY = firstBranchY + constants.BRANCH_START_OFFSET
  const rise = Math.max(CIRCUIT_RISER_SPLIT_RISE, getTrunkDeviceVerticalPaintHeight(top, constants.SYMBOL_SIZE) / 2 + SPLIT_DEVICE_CLEARANCE)
  return {
    lift: rise + Math.max(0, captionSpan - constants.BRANCH_START_OFFSET),
    splitRise: startY - deviceY + rise,
  }
}

/** Distance from the centre of the topmost shared device up to the split. */
export function getSplitRiseAboveDevice(device: TrunkDevice, symbolSize: number): number {
  return Math.max(CIRCUIT_RISER_SPLIT_RISE, getTrunkDeviceVerticalPaintHeight(device, symbolSize) / 2 + SPLIT_DEVICE_CLEARANCE)
}

/**
 * Height of the split for the drop zone, also on a circuit that has no riser yet (no run plan, so no `column`): the
 * rows already carry it when they are drawn in runs, otherwise it is derived from where the topmost shared device is
 * drawn, exactly as the layout will place it after the drop.
 */
export function getDrawnRiserSplitY(
  circuit: Pick<Circuit, 'trunkDevices'>, trunkY: number, rowSplitRise: number | undefined,
  deviceCentreY: (deviceId: string) => number | undefined, symbolSize: number,
): number {
  if (rowSplitRise) return trunkY - rowSplitRise
  const top = getTopSharedDevice(circuit)
  const y = top ? deviceCentreY(top.id) : undefined
  return top && y !== undefined ? y - getSplitRiseAboveDevice(top, symbolSize) : trunkY - CIRCUIT_RISER_SPLIT_RISE
}
