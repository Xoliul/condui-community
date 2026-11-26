import type { TrunkDevice } from '@/types/schema'

type Connection = NonNullable<TrunkDevice['converterDcConnection']>

const onOutput = (device: TrunkDevice, connection: Connection) =>
  device.converterDcConnection?.converterId === connection.converterId &&
  device.converterDcConnection.connectionIndex === connection.connectionIndex

/**
 * The circuit devices on one output of a widened converter in a circuit (protections, terminal
 * strips, junction boxes, ...), in order from the converter. They come before the output's
 * endpoints. A DC rail on the output is its terminal and always comes last.
 */
export function getConverterOutputDevices(
  trunkDevices: readonly TrunkDevice[],
  connection: Connection
): TrunkDevice[] {
  const rank = (device: TrunkDevice) =>
    device.type === 'dc_bus' ? Number.POSITIVE_INFINITY : (device.trunkPosition ?? 0)
  return trunkDevices
    .filter((device) => device.id !== connection.converterId && onOutput(device, connection))
    .sort((left, right) => rank(left) - rank(right))
}

/**
 * The circuit's trunk devices with `device` inserted on its converter output at `insertIndex`
 * (among that output's devices, clamped; default after the last). The output's devices are
 * renumbered 0, 1, 2, ... so their order stays explicit; other trunk devices are untouched.
 */
export function insertConverterOutputDevice(
  trunkDevices: readonly TrunkDevice[],
  device: TrunkDevice,
  insertIndex?: number
): TrunkDevice[] {
  const connection = device.converterDcConnection
  if (!connection) return [...trunkDevices, device]
  const ordered = getConverterOutputDevices(trunkDevices, connection).filter(
    (candidate) => candidate.type !== 'dc_bus'
  )
  const index = Math.max(0, Math.min(insertIndex ?? ordered.length, ordered.length))
  ordered.splice(index, 0, device)
  const positions = new Map(ordered.map((candidate, position) => [candidate.id, position]))
  return [...trunkDevices, device].map((candidate) =>
    positions.has(candidate.id) ? { ...candidate, trunkPosition: positions.get(candidate.id)! } : candidate
  )
}

/** Symbols that become circuit devices when dropped among an output's devices. */
export const CONVERTER_OUTPUT_DEVICE_SYMBOLS: ReadonlySet<string> = new Set([
  'mcb', 'rcd', 'rcbo', 'fuse', 'spd', 'main_switch', 'rotating_switch',
  'junction_box', 'terminal_strip', 'junction_panel', 'energy_meter',
])

/**
 * A drop that places a circuit device on an output of a widened converter in a circuit. Its
 * preview runs the real placement command, so the preview and the drop insert at the same place.
 */
export function placesConverterOutputDevice(
  symbolId: string,
  target: { circuitId?: string; dcBusId?: string; converterDcConnection?: Connection }
): boolean {
  return !!target.circuitId && !target.dcBusId && !!target.converterDcConnection &&
    CONVERTER_OUTPUT_DEVICE_SYMBOLS.has(symbolId)
}
