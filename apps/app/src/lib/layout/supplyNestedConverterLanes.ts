import type { TrunkDevice } from '@/types/schema'
import type { LayoutNode } from './layoutTree'

/** Vertical distance between the sideways jogs of neighbouring strings of one converter. */
export const NESTED_LANE_JOG_STEP = 12
/** Clearance between an unused output's stub top and a jog passing over it. */
const NESTED_LANE_STUB_CLEARANCE = 10
/** Shortest stub an unused output keeps, so its drop hint stays reachable. */
const NESTED_LANE_MIN_STUB = 6

/**
 * Row of each device of one DC-bus branch. The devices fed by an output of a multi-port
 * converter stack above it like a single string, so lane device `n` sits on the row after
 * the converter plus `n`; every lane (and every neighbouring string) is level, row by row.
 */
export function getNestedLaneRowIndices(devices: readonly TrunkDevice[]): number[] {
  const seen = new Map<string, number>()
  return devices.map((device, index) => {
    const connection = device.converterDcConnection
    const converterIndex = connection
      ? devices.findIndex((candidate) => candidate.id === connection.converterId)
      : -1
    if (!connection || converterIndex < 0) return index
    const key = `${connection.converterId}:${connection.connectionIndex}`
    const ordinal = seen.get(key) ?? 0
    seen.set(key, ordinal + 1)
    return converterIndex + 1 + ordinal
  })
}

/** Output indexes of a converter that feed at least one device, ascending. */
export function getPopulatedLaneIndexes(
  devices: readonly TrunkDevice[],
  converterId: string
): number[] {
  const indexes = new Set<number>()
  for (const device of devices)
    if (device.converterDcConnection?.converterId === converterId)
      indexes.add(device.converterDcConnection.connectionIndex)
  return [...indexes].sort((left, right) => left - right)
}

/**
 * Column of each populated output's string, counted outwards from the converter's own column.
 * Strings keep their output order. The first output's string stands in the converter's column;
 * when the first output is unused, every string moves out one column so none covers its stub.
 */
export function getNestedLaneSlots(
  devices: readonly TrunkDevice[],
  converterId: string
): Map<number, number> {
  const populated = getPopulatedLaneIndexes(devices, converterId)
  const shift = populated[0] === 0 ? 0 : 1
  return new Map(populated.map((connectionIndex, ordinal) => [connectionIndex, ordinal + shift]))
}

/** Outermost column a converter's strings use (0 when only its first output feeds one). */
export function getNestedLaneMaxSlot(devices: readonly TrunkDevice[], converterId: string): number {
  return Math.max(0, ...getNestedLaneSlots(devices, converterId).values())
}

/**
 * Sideways offset of each device of one DC-bus branch, outwards from the bus: the string on a
 * populated output of a multi-port converter sits its column (getNestedLaneSlots) times the lane
 * spacing beyond the converter. The supply layout applies it to the device positions, so the
 * frame, drop zones and wires all see where each string is drawn.
 */
export function getNestedLaneOffsets(
  devices: readonly TrunkDevice[],
  laneSpacing: (laneDevices: TrunkDevice[]) => number
): number[] {
  const offsetByLane = new Map<string, number>()
  for (const converter of devices) {
    const laneDevices = devices.filter(
      (device) => device.converterDcConnection?.converterId === converter.id
    )
    const slots = getNestedLaneSlots(laneDevices, converter.id)
    if (getNestedLaneMaxSlot(laneDevices, converter.id) === 0) continue
    const spacing = laneSpacing(laneDevices)
    for (const [connectionIndex, slot] of slots)
      offsetByLane.set(`${converter.id}:${connectionIndex}`, slot * spacing)
  }
  return devices.map((device) => {
    const connection = device.converterDcConnection
    return connection
      ? (offsetByLane.get(`${connection.converterId}:${connection.connectionIndex}`) ?? 0)
      : 0
  })
}

/**
 * Strings that leave their port sideways, per converter row: the wire between the converter and
 * the strings' first row needs room for that many jogs, NESTED_LANE_JOG_STEP apart, plus one more
 * step below the lowest so an unused output's stub stops clear of it (getNestedLaneRoutes).
 */
export function getNestedLaneJogRows(
  devices: readonly TrunkDevice[]
): Array<{ row: number; jogs: number }> {
  const rows = getNestedLaneRowIndices(devices)
  return devices.flatMap((converter, index) => {
    const laneDevices = devices.filter(
      (device) => device.converterDcConnection?.converterId === converter.id
    )
    const jogs = [...getNestedLaneSlots(laneDevices, converter.id).values()].filter(
      (slot) => slot > 0
    ).length
    return jogs > 0 ? [{ row: rows[index]! + 1, jogs }] : []
  })
}

export interface NestedLaneRoute {
  /** Height of the sideways jog from the port to its string; absent when the string stands above its port. */
  jogY?: number
  /** Top of an unused output's stub; absent for a populated output. */
  stubTopY?: number
}

/**
 * How each output port of a multi-port converter reaches its string, shared by the layout's hit
 * zones and the drawn wires. Strings further out jog lower, closer to the converter, so every
 * port-to-string path nests inside the next one and no two cross or overlap. An unused output's
 * stub stops below every jog that passes over it. The jogs share the wire's height evenly and leave
two shares below the lowest one for those stubs. `strings[i]` is output `i`'s string (its column
 * and the centre of its first device) or undefined when the output is unused.
 */
export function getNestedLaneRoutes(input: {
  portXs: readonly number[]
  portY: number
  strings: ReadonlyArray<{ x: number; firstDeviceY: number } | undefined>
  halfSymbol: number
  emptyStubHeight: number
}): NestedLaneRoute[] {
  const { portXs, portY, strings, halfSymbol, emptyStubHeight } = input
  const jogged = strings
    .map((string, index) => ({ string, index }))
    .filter(({ string, index }) => string && string.x !== portXs[index])
    .sort(
      (left, right) =>
        Math.abs(left.string!.x - portXs[0]!) - Math.abs(right.string!.x - portXs[0]!)
    )
  const bottom = Math.max(
    ...strings.flatMap((string) => (string ? [string.firstDeviceY + halfSymbol] : []))
  )
  const jogYByPort = new Map<number, number>()
  jogged.forEach(({ index }, rank) =>
    jogYByPort.set(index, Math.round(bottom + ((portY - bottom) * (rank + 1)) / (jogged.length + 2)))
  )
  return portXs.map((portX, index) => {
    if (strings[index]) return { jogY: jogYByPort.get(index) }
    // Jogs whose sideways run passes over this port.
    const covering = jogged
      .filter(({ index: other }) => {
        const from = portXs[other]!
        const to = strings[other]!.x
        return portX > Math.min(from, to) && portX < Math.max(from, to)
      })
      .map(({ index: other }) => jogYByPort.get(other)!)
    const below = covering.length > 0 ? Math.max(...covering) + NESTED_LANE_STUB_CLEARANCE : -Infinity
    return {
      stubTopY: Math.min(portY - NESTED_LANE_MIN_STUB, Math.max(portY - emptyStubHeight, below)),
    }
  })
}

/**
 * Each output of a multi-port converter on a DC-bus branch: the nodes of its string in drawing
 * order and how its port reaches them. The layout's hit zones and deriveWires both read this, so
 * the drop zones always follow the drawn wires.
 */
export function getNestedConverterOutputs(input: {
  nodes: readonly LayoutNode[]
  converterId: string
  ports: ReadonlyArray<{ x: number; y: number }>
  halfSymbol: number
  emptyStubHeight: number
}): Array<{ laneNodes: LayoutNode[]; route?: NestedLaneRoute }> {
  const deviceOf = (node: LayoutNode) => node.domainRef as TrunkDevice | undefined
  const lanes = input.ports.map((_, connectionIndex) =>
    input.nodes
      .filter((node) => {
        const connection = deviceOf(node)?.converterDcConnection
        return (
          connection?.converterId === input.converterId &&
          connection.connectionIndex === connectionIndex
        )
      })
      .sort(
        (left, right) => (deviceOf(left)!.trunkPosition ?? 0) - (deviceOf(right)!.trunkPosition ?? 0)
      )
  )
  // With no string at all, every output keeps its full-height stub (no route).
  if (lanes.every((lane) => lane.length === 0)) return lanes.map((laneNodes) => ({ laneNodes }))
  const routes = getNestedLaneRoutes({
    portXs: input.ports.map((port) => port.x),
    portY: input.ports[0]!.y,
    strings: lanes.map((lane) =>
      lane[0] ? { x: lane[0].bounds.x, firstDeviceY: lane[0].bounds.y } : undefined
    ),
    halfSymbol: input.halfSymbol,
    emptyStubHeight: input.emptyStubHeight,
  })
  return lanes.map((laneNodes, index) => ({ laneNodes, route: routes[index] }))
}
