import type { TrunkDevice } from '@/types/schema'
import { LAYOUT_CONSTANTS } from './bottomUpLayoutConstants'
import { CIRCUIT_CONVERTER_OUTPUT_DEVICE_STEP } from './circuitConverterGeometry'
import type { LayoutNode } from './layoutTree'

const SLOT_PADDING = 9

/**
 * Drop zones for circuit devices (protections, strips, ...) on one output row of a converter in a
 * circuit: one per position among the output's devices, from the port to the first endpoint. Each
 * carries `branchDeviceInsertIndex`, the place the device takes among the output's devices. When
 * nothing stands on the row yet, or a lone item stands on its port, the first zone is the riser.
 */
export function getConverterOutputDeviceSlots(input: {
  circuitId: string
  connection: NonNullable<TrunkDevice['converterDcConnection']>
  port: { x: number; y: number }
  rowY: number
  /** Centres of the output's devices (not a DC rail), in order. */
  deviceXs: readonly number[]
  /** Centre of the output's first endpoint, if any. */
  firstEndpointX?: number
}): LayoutNode[] {
  const { connection, port, rowY, deviceXs, firstEndpointX } = input
  const half = LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
  const slots: LayoutNode[] = []
  const push = (index: number, x1: number, y1: number, x2: number, y2: number) => {
    if (Math.abs(x2 - x1) + Math.abs(y2 - y1) < 1) return
    slots.push({
      id: `converter-dc-output-device-slot-${connection.converterId}-${connection.connectionIndex}-${index}`,
      type: 'wire',
      bounds: {
        x: Math.min(x1, x2) - SLOT_PADDING,
        y: Math.min(y1, y2) - SLOT_PADDING,
        width: Math.abs(x2 - x1) + SLOT_PADDING * 2,
        height: Math.abs(y2 - y1) + SLOT_PADDING * 2,
      },
      hitZone: {
        type: 'circuit',
        padding: 0,
        converterDcConnection: connection,
        branchDeviceInsertIndex: index,
        dropHintAnchor: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
      },
      children: [],
    })
  }
  const firstItemX = deviceXs[0] ?? firstEndpointX
  for (let index = 0; index <= deviceXs.length; index += 1) {
    if (index === 0 && (firstItemX === undefined || firstItemX === port.x)) {
      // The riser up to the row (or to the item standing on the port).
      push(0, port.x, port.y, port.x, firstItemX === undefined ? rowY : rowY + half)
      continue
    }
    const from = index === 0 ? port.x : deviceXs[index - 1]! + half
    const to =
      index < deviceXs.length
        ? deviceXs[index]! - half
        : firstEndpointX !== undefined
          ? firstEndpointX - half
          : deviceXs[index - 1]! + half + CIRCUIT_CONVERTER_OUTPUT_DEVICE_STEP / 2
    if (to > from) push(index, from, rowY, to, rowY)
  }
  return slots
}
