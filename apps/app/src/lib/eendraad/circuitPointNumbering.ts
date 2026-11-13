import type { Branch, Circuit, TrunkDevice } from '@/types/schema'
import { getOneWireBranchRoots } from './oneWireForkProject'

/**
 * A plain or twilight switch on an ordinary circuit trunk is a field control: like
 * an endpoint branch it gets a drawing reference (`A1`, `A2`, …). That reference
 * does not make it a socket-equivalent point for the AREI limit. Relays on the trunk sit in the
 * panel and keep their own labels.
 */
export function isNumberedCircuitTrunkSwitch(device: TrunkDevice): boolean {
  return (
    device.type === 'switch' &&
    (device.symbol === 'switch' || device.symbol === 'light_sensor') &&
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

type PointNumberedCircuit = Pick<Circuit, 'trunkDevices' | 'branches'> & Partial<Pick<Circuit, 'endpoints'>>

/** A two-in-one switch: its first output continues the run, further outputs are legs. */
export const CHANGEOVER_SWITCH_SYMBOL = 'switch_1p_changeover'

/** Endpoints and trunk devices that switch what they feed, so it all forms one point. */
const isControlEndpoint = (endpoint: { type: string; symbol?: string }) =>
  endpoint.type === 'switch' || endpoint.symbol === 'relay' || endpoint.symbol === 'contact'
const isControlTrunkDevice = (device: TrunkDevice) => device.type === 'switch' || device.type === 'relay'

/**
 * Legs that are numbered points of their own instead of sharing the label of
 * what they hang from. Numbers follow control groups, not where a split is
 * drawn: everything one switch controls shares its number, so a leg that
 * splits off behind a switch (or a switching trunk device) is not numbered.
 * A leg directly after a changeover switch is a further output of that switch
 * and is numbered. A leg off a run that nothing switches (sockets, fixed
 * appliances, a junction box or terminal strip) is numbered like a root branch,
 * so a split on a branch numbers the same as a split on the trunk. Returns, per
 * root branch index, the stored indexes of those legs in walking order (a leg
 * is followed by what forks from it).
 */
function getNumberedLegsByRoot(circuit: PointNumberedCircuit, branchCount: number): Map<number, number[]> {
  const result = new Map<number, number[]>()
  const branches = (circuit.branches ?? []).slice(0, branchCount)
  const legsAfter = new Map<string, number[]>()
  branches.forEach((branch, index) => {
    if (!branch.forkFrom) return
    const list = legsAfter.get(branch.forkFrom.afterEndpointId) ?? []
    list.push(index)
    legsAfter.set(branch.forkFrom.afterEndpointId, list)
  })
  if (!legsAfter.size) return result
  const endpoints = new Map((circuit.endpoints ?? []).map((endpoint) => [endpoint.id, endpoint]))
  const trunkControls = (circuit.trunkDevices ?? []).filter(isControlTrunkDevice)
  const seen = new Set<number>()
  let ordinaryIndex = 0
  branches.forEach((root, rootIndex) => {
    if (root.forkFrom) return
    const rootSwitched = trunkControls.some((device) => (device.trunkPosition ?? 0) <= ordinaryIndex)
    ordinaryIndex++
    const legs: number[] = []
    // Iterative pre-order walk (nesting has no depth limit); each item carries whether its feed is switched.
    const stack: Array<{ index: number; switched: boolean }> = [{ index: rootIndex, switched: rootSwitched }]
    while (stack.length) {
      const { index, switched } = stack.pop()!
      const children: Array<{ index: number; switched: boolean }> = []
      let switchedHere = switched
      for (const id of branches[index]!.endpointIds) {
        const endpoint = endpoints.get(id)
        const changeover = endpoint?.symbol === CHANGEOVER_SWITCH_SYMBOL
        if (endpoint && isControlEndpoint(endpoint)) switchedHere = true
        for (const leg of legsAfter.get(id) ?? []) {
          if (seen.has(leg)) continue
          seen.add(leg)
          if (changeover || !switchedHere) legs.push(leg)
          children.push({ index: leg, switched: switchedHere })
        }
      }
      for (let item = children.length - 1; item >= 0; item--) stack.push(children[item]!)
    }
    if (legs.length) result.set(rootIndex, legs)
  })
  return result
}

/**
 * Numbered points of a circuit in walking order from its breaker. A trunk
 * device at `trunkPosition` p sits after branch p-1, so a switch at position 0
 * is point 1 and the branches it feeds follow it. A root branch is followed by
 * its numbered legs (see `getNumberedLegsByRoot`), which therefore shift later
 * roots and trunk switches up; other legs are not points.
 */
export function getCircuitPointSequence(
  circuit: PointNumberedCircuit,
  branchCount = circuit.branches?.length ?? 0
): CircuitPointSlot[] {
  const switches = getNumberedCircuitTrunkSwitches(circuit)
  const numberedLegs = getNumberedLegsByRoot(circuit, branchCount)
  const sequence: CircuitPointSlot[] = []
  let next = 0
  let ordinaryIndex = 0
  for (let branchIndex = 0; branchIndex < branchCount; branchIndex++) {
    if (circuit.branches?.[branchIndex]?.forkFrom) continue
    while (next < switches.length && (switches[next]!.trunkPosition ?? 0) <= ordinaryIndex) {
      sequence.push({ kind: 'trunkSwitch', device: switches[next++]! })
    }
    sequence.push({ kind: 'branch', branchIndex })
    for (const leg of numberedLegs.get(branchIndex) ?? []) sequence.push({ kind: 'branch', branchIndex: leg })
    ordinaryIndex++
  }
  while (next < switches.length) {
    sequence.push({ kind: 'trunkSwitch', device: switches[next++]! })
  }
  return sequence
}

/**
 * For each branch, the branch whose label it shows: roots and numbered legs
 * show their own; every other leg shows the nearest of those up its ancestry.
 * Unresolved attachments map to themselves.
 */
export function getBranchLabelOwners(circuit: PointNumberedCircuit): Map<string, string> {
  const branches = circuit.branches ?? []
  const numbered = new Set<string>()
  for (const legs of getNumberedLegsByRoot(circuit, branches.length).values()) {
    for (const leg of legs) numbered.add(branches[leg]!.id)
  }
  const holder = new Map(branches.flatMap((branch) => branch.endpointIds.map((id) => [id, branch] as const)))
  const owners = new Map<string, string>()
  for (const branch of branches) {
    const pending: Branch[] = []
    const visited = new Set<string>()
    let cursor: Branch | undefined = branch
    let owner = branch.id
    while (cursor) {
      const known = owners.get(cursor.id)
      if (known) { owner = known; break }
      if (visited.has(cursor.id)) break
      visited.add(cursor.id)
      pending.push(cursor)
      if (!cursor.forkFrom || numbered.has(cursor.id)) { owner = cursor.id; break }
      cursor = holder.get(cursor.forkFrom.afterEndpointId)
    }
    for (const item of pending) owners.set(item.id, owner)
  }
  return owners
}

/** Zero-based point number of a branch once trunk switches and numbered legs are numbered too. */
export function getCircuitBranchPointIndex(
  circuit: PointNumberedCircuit,
  branchIndex: number
): number {
  const branches = circuit.branches ?? []
  const ownerId = getBranchLabelOwners(circuit).get(branches[branchIndex]?.id ?? '')
  const ownerIndex = ownerId ? branches.findIndex((branch) => branch.id === ownerId) : -1
  if (branches.length && ownerIndex >= 0) {
    const point = getCircuitPointSequence(circuit).findIndex((slot) => slot.kind === 'branch' && slot.branchIndex === ownerIndex)
    if (point >= 0) return point
  }
  const rootId = getOneWireBranchRoots(branches).get(branches[branchIndex]?.id ?? '')
  const rootIndex = rootId ? branches.findIndex((branch) => branch.id === rootId) : branchIndex
  const ordinaryIndex = branches.slice(0, Math.max(0, rootIndex)).filter((branch) => !branch.forkFrom).length
  const switchesBefore = getNumberedCircuitTrunkSwitches(circuit).filter(
    (device) => (device.trunkPosition ?? 0) <= (branches.length ? ordinaryIndex : branchIndex)
  ).length
  return (branches.length ? ordinaryIndex : branchIndex) + switchesBefore
}

export function isChangeoverSwitchEndpoint(circuit: Pick<Circuit, 'endpoints'>, endpointId: string | null | undefined): boolean {
  return !!endpointId && circuit.endpoints.some((endpoint) => endpoint.id === endpointId && endpoint.symbol === CHANGEOVER_SWITCH_SYMBOL)
}
