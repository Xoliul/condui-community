import type { Circuit, TrunkDevice } from '@/types/schema'

/**
 * A plain switch in series on an ordinary circuit trunk is a wall switch: like
 * an endpoint branch it gets a drawing reference (`A1`, `A2`, …). That reference
 * does not make it a socket-equivalent point for the AREI limit. Relays on the trunk sit in the
 * panel and keep their own labels.
 */
export function isNumberedCircuitTrunkSwitch(device: TrunkDevice): boolean {
  return (
    device.type === 'switch' &&
    device.symbol === 'switch' &&
    !device.supplyPath &&
    !device.converterDcConnection
  )
}

export function getNumberedCircuitTrunkSwitches(
  circuit: Pick<Circuit, 'trunkDevices'>
): TrunkDevice[] {
  return (circuit.trunkDevices ?? [])
    .map((device, order) => ({ device, order }))
    .filter(({ device }) => isNumberedCircuitTrunkSwitch(device))
    // Devices sharing a trunk position stack outward from the breaker in array order.
    .sort((a, b) => (a.device.trunkPosition ?? 0) - (b.device.trunkPosition ?? 0) || a.order - b.order)
    .map(({ device }) => device)
}

export type CircuitPointSlot =
  | { kind: 'branch'; branchIndex: number }
  | { kind: 'trunkSwitch'; device: TrunkDevice }

/**
 * Numbered points of a circuit in walking order from its breaker. A trunk
 * device at `trunkPosition` p sits after branch p-1, so a switch at position 0
 * is point 1 and the branches it feeds follow it.
 */
export function getCircuitPointSequence(
  circuit: Pick<Circuit, 'trunkDevices' | 'branches'>,
  branchCount = circuit.branches?.length ?? 0
): CircuitPointSlot[] {
  const switches = getNumberedCircuitTrunkSwitches(circuit)
  const sequence: CircuitPointSlot[] = []
  let next = 0
  for (let branchIndex = 0; branchIndex < branchCount; branchIndex++) {
    while (next < switches.length && (switches[next]!.trunkPosition ?? 0) <= branchIndex) {
      sequence.push({ kind: 'trunkSwitch', device: switches[next++]! })
    }
    sequence.push({ kind: 'branch', branchIndex })
  }
  while (next < switches.length) {
    sequence.push({ kind: 'trunkSwitch', device: switches[next++]! })
  }
  return sequence
}

/** Zero-based point number of a branch once trunk switches are numbered too. */
export function getCircuitBranchPointIndex(
  circuit: Pick<Circuit, 'trunkDevices' | 'branches'>,
  branchIndex: number
): number {
  const switchesBefore = getNumberedCircuitTrunkSwitches(circuit).filter(
    (device) => (device.trunkPosition ?? 0) <= branchIndex
  ).length
  return branchIndex + switchesBefore
}
