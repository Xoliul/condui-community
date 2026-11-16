import type { Circuit, Endpoint, TrunkDevice } from '@/types/schema'

export const CIRCUIT_CONVERTER_BLOCK_SIZE = 20
export const CIRCUIT_CONVERTER_MIN_CONNECTIONS = 1
export const CIRCUIT_CONVERTER_MAX_CONNECTIONS = 4
export const CIRCUIT_CONVERTER_OUTPUT_STUB_LENGTH = 26
export const CIRCUIT_CONVERTER_OUTPUT_ROW_SPACING = 40
export const CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD = 25
/** Matches the normal MCB/trunk-device to first endpoint-branch spacing. */
export const CIRCUIT_CONVERTER_FIRST_OUTPUT_ROW_OFFSET = 80
/** Matches the converter entry in wireInsets.ts. */
export const CIRCUIT_CONVERTER_TOP_WIRE_INSET = 8

export function supportsCircuitConverterDcConnections(device: TrunkDevice | undefined): boolean {
  return (
    device?.symbol === 'inverter' ||
    device?.symbol === 'rectifier' ||
    device?.symbol === 'dc_dc_converter'
  )
}

export function getCircuitConverterDcConnectionCount(device: TrunkDevice | undefined): number {
  if (!supportsCircuitConverterDcConnections(device)) return 1
  const value = Math.trunc(device?.conversionProps?.dcConnectionCount ?? 1)
  return Math.max(
    CIRCUIT_CONVERTER_MIN_CONNECTIONS,
    Math.min(CIRCUIT_CONVERTER_MAX_CONNECTIONS, value)
  )
}

export function getCircuitConverterBodyGeometry(
  device: TrunkDevice,
  anchor: { x: number; y: number }
) {
  const count = getCircuitConverterDcConnectionCount(device)
  const width = CIRCUIT_CONVERTER_BLOCK_SIZE * count
  const height = CIRCUIT_CONVERTER_BLOCK_SIZE
  const left = anchor.x - CIRCUIT_CONVERTER_BLOCK_SIZE / 2
  const top = anchor.y - height / 2
  return {
    count,
    width,
    height,
    left,
    right: left + width,
    top,
    bottom: top + height,
    center: { x: left + width / 2, y: anchor.y },
    anchor,
    dcPorts: Array.from({ length: count }, (_, index) => ({
      index,
      x: anchor.x + index * CIRCUIT_CONVERTER_BLOCK_SIZE,
      y: anchor.y - CIRCUIT_CONVERTER_TOP_WIRE_INSET,
    })),
  }
}

/**
 * Supply-assembly converters keep their established electrical anchor on the right.
 * Extra converter blocks therefore occupy space to the left of that anchor.
 */
export function getSupplyConverterBodyGeometry(
  device: TrunkDevice,
  anchor: { x: number; y: number }
) {
  const count = getCircuitConverterDcConnectionCount(device)
  const width = CIRCUIT_CONVERTER_BLOCK_SIZE * count
  const height = CIRCUIT_CONVERTER_BLOCK_SIZE
  const right = anchor.x + CIRCUIT_CONVERTER_BLOCK_SIZE / 2
  const top = anchor.y - height / 2
  return {
    count,
    width,
    height,
    left: right - width,
    right,
    top,
    bottom: top + height,
    center: { x: right - width / 2, y: anchor.y },
    anchor,
  }
}

/** Extra horizontal room occupied by a widened supply converter beyond one block. */
export function getSupplyConverterHorizontalGrowth(device: TrunkDevice | undefined): number {
  return (getCircuitConverterDcConnectionCount(device) - 1) * CIRCUIT_CONVERTER_BLOCK_SIZE
}

/**
 * `extraRowGap` widens every row boundary, the converter body included: the row nearest the
 * converter rises by one gap, the next by two, and so on. Horizontal lanes use it to leave room
 * for the captions hanging below their symbols.
 */
export function getCircuitConverterOutputRowY(
  device: TrunkDevice,
  anchorY: number,
  connectionIndex: number,
  extraRowGap = 0
): number {
  const count = getCircuitConverterDcConnectionCount(device)
  const safeIndex = Math.max(0, Math.min(count - 1, Math.trunc(connectionIndex)))
  const bodyTop = anchorY - CIRCUIT_CONVERTER_BLOCK_SIZE / 2
  const rowsAbove = count - 1 - safeIndex
  // Left rows sit highest. This keeps a row from crossing the vertical stubs to its right.
  return (
    bodyTop -
    CIRCUIT_CONVERTER_OUTPUT_STUB_LENGTH -
    rowsAbove * CIRCUIT_CONVERTER_OUTPUT_ROW_SPACING -
    (rowsAbove + 1) * extraRowGap
  )
}

/**
 * Ordinary-panel outputs keep connection zero at the established first-branch
 * row. Extra outputs stack upward and never push that primary row away from the
 * converter. Supply assemblies retain their separate row ordering above.
 */
export function getOrdinaryCircuitConverterOutputRowY(
  device: TrunkDevice,
  anchorY: number,
  connectionIndex: number
): number {
  const count = getCircuitConverterDcConnectionCount(device)
  const safeIndex = Math.max(0, Math.min(count - 1, Math.trunc(connectionIndex)))
  return (
    anchorY -
    CIRCUIT_CONVERTER_FIRST_OUTPUT_ROW_OFFSET -
    safeIndex * CIRCUIT_CONVERTER_OUTPUT_ROW_SPACING
  )
}

export function isCircuitConverterDcChild(endpoint: Endpoint, converterId?: string): boolean {
  const props = endpoint.converterDcConnection
  return !!props && (!converterId || props.converterId === converterId)
}

/**
 * The original endpoint branch becomes output zero when an ordinary-circuit
 * converter is widened. Keeping that ownership derived avoids changing the
 * persisted shape of projects that already have a normal first branch.
 */
export function getCircuitConverterPrimaryBranch(circuit: Circuit, device: TrunkDevice) {
  if (getCircuitConverterDcConnectionCount(device) <= 1) return undefined
  const hasExplicitPrimaryOutput = circuit.endpoints.some(
    (endpoint) =>
      endpoint.converterDcConnection?.converterId === device.id &&
      endpoint.converterDcConnection.connectionIndex === 0
  )
  if (hasExplicitPrimaryOutput) return undefined
  const endpointById = new Map(circuit.endpoints.map((endpoint) => [endpoint.id, endpoint]))
  return (circuit.branches ?? []).find((branch) => {
    if (branch.dcBusId) return false
    const endpoints = branch.endpointIds
      .map((endpointId) => endpointById.get(endpointId))
      .filter((endpoint): endpoint is Endpoint => endpoint !== undefined)
    return (
      endpoints.length > 0 &&
      endpoints.every(
        (endpoint) =>
          endpoint.symbol !== 'panel_distribution' && !isCircuitConverterDcChild(endpoint)
      )
    )
  })
}

export function getCircuitConverterPrimaryEndpointIds(circuit: Circuit): Set<string> {
  const device = (circuit.trunkDevices ?? []).find(
    (candidate) =>
      supportsCircuitConverterDcConnections(candidate) &&
      getCircuitConverterDcConnectionCount(candidate) > 1
  )
  return new Set(
    device ? (getCircuitConverterPrimaryBranch(circuit, device)?.endpointIds ?? []) : []
  )
}

export type CircuitConverterDcConnection = {
  converterId: string
  connectionIndex: number
}

/** Resolve the ordinary-panel DC rail that replaces endpoint branches for one converter output. */
export function findOrdinaryCircuitDcBusForOutput(
  circuit: Circuit,
  connection?: CircuitConverterDcConnection
): TrunkDevice | undefined {
  return (circuit.trunkDevices ?? []).find((device) => {
    if (device.type !== 'dc_bus') return false
    if (!connection) return device.converterDcConnection == null
    return (
      device.converterDcConnection?.converterId === connection.converterId &&
      device.converterDcConnection.connectionIndex === connection.connectionIndex
    )
  })
}

/**
 * Re-present existing ordinary endpoint branches on a newly inserted DC rail.
 * Endpoint identity, order, labels, and circuit ownership stay unchanged.
 */
export function promoteOrdinaryCircuitBranchesToDcBus(
  circuit: Circuit,
  dcBusId: string,
  connection?: CircuitConverterDcConnection
): Circuit['branches'] {
  const branches = circuit.branches ?? []
  if (!connection) {
    return branches.map((branch) => (branch.dcBusId ? branch : { ...branch, dcBusId }))
  }

  const converter = circuit.trunkDevices?.find((device) => device.id === connection.converterId)
  const primaryBranch =
    connection.connectionIndex === 0 && converter
      ? getCircuitConverterPrimaryBranch(circuit, converter)
      : undefined
  const endpointIds = new Set(
    circuit.endpoints.flatMap((endpoint) =>
      (primaryBranch?.endpointIds.includes(endpoint.id) ?? false) ||
      (endpoint.converterDcConnection?.converterId === connection.converterId &&
        endpoint.converterDcConnection.connectionIndex === connection.connectionIndex)
        ? [endpoint.id]
        : []
    )
  )

  return branches.map((branch) =>
    branch.dcBusId || !branch.endpointIds.some((endpointId) => endpointIds.has(endpointId))
      ? branch
      : { ...branch, dcBusId }
  )
}
