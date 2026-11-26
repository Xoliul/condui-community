import type { Branch, Circuit, Endpoint, TrunkDevice } from '@/types/schema'
import { canEditOneWireForks } from '@/lib/eendraad/oneWireForkProject'
import { getBranchLabelOwners, getCircuitPointSequence } from '@/lib/eendraad/circuitPointNumbering'
import type { TrikCircuit, TrikNode } from '@/lib/import/trik/shared'

type ForkVariant = NonNullable<TrikCircuit['forkVariant']>

const TRUNK_DEVICE_TYPE = {
  transformer: 'conversion',
  converter: 'conversion',
  energy_meter: 'energy_meter',
  protection: 'protection',
  terminal_strip: 'terminal_strip',
} as const

/** Branch keys in order of first appearance, with the nodes that run along each. */
function groupNodesByBranchKey(nodes: readonly TrikNode[]): Map<string, TrikNode[]> {
  const groups = new Map<string, TrikNode[]>()
  nodes.forEach((node, index) => {
    const key = node.branchKey?.trim() || `struct-${index + 1}`
    const group = groups.get(key)
    if (group) group.push(node)
    else groups.set(key, [node])
  })
  return groups
}

/**
 * The fork-keeping reading of a TRiK circuit, or undefined when the circuit has no splits, forks are
 * disabled, or the result would not be an ordinary circuit the editor can fork (then the importer
 * keeps the flattened mapping). Fuses on a branch and domotica outputs key off the flat branch keys,
 * so circuits using them stay flat as well.
 */
export function selectTrikForkVariant(
  trikCircuit: TrikCircuit,
  circuitCode: string,
  forksEnabled: boolean,
): ForkVariant | undefined {
  const variant = trikCircuit.forkVariant
  if (!forksEnabled || !variant) return undefined
  if (trikCircuit.branchDevices?.length) return undefined
  if (variant.nodes.some((node) => node.domoticaParentNodeId || node.converterDcConnection)) return undefined
  const groups = groupNodesByBranchKey(variant.nodes)
  // A leg keeps its place when it has symbols or is an open Leiding; a leg that lost its symbols is dropped.
  const legs = variant.forkLegs.filter((leg) => groups.has(leg.branchKey) || leg.empty)
  const hasStems = Object.keys(variant.stems).length > 0
  if (legs.length === 0 && !hasStems) return undefined
  const legByKey = new Map(legs.map((leg) => [leg.branchKey, leg]))
  const knownKeys = new Set([...groups.keys(), ...legs.filter((leg) => leg.empty).map((leg) => leg.branchKey)])
  const branchOrder = [...variant.branchOrder.filter((key) => knownKeys.has(key)), ...[...knownKeys].filter((key) => !variant.branchOrder.includes(key))]
  const endpoints: Endpoint[] = variant.nodes.map((node) => ({
    id: node.id, type: node.type, label: '', symbol: node.symbol, placements: [],
  }))
  const branches: Branch[] = branchOrder.map((key) => {
    const leg = legByKey.get(key)
    const stem = variant.stems[key]
    return {
      id: key,
      label: '',
      endpointIds: (groups.get(key) ?? []).map((node) => node.id),
      ...(leg ? { forkFrom: { afterEndpointId: leg.afterNodeId } } : {}),
      ...(leg?.empty ? { keepEmpty: true as const } : {}),
      ...(stem && !leg ? { stem } : {}),
    }
  })
  const trunkDevices: TrunkDevice[] = (trikCircuit.trunkDevices ?? []).map((device, index) => ({
    id: device.id, type: TRUNK_DEVICE_TYPE[device.kind], symbol: device.kind === 'terminal_strip' ? 'terminal_strip' : 'mcb', label: '', trunkPosition: index,
  }))
  const probe: Circuit = {
    id: trikCircuit.id,
    code: circuitCode,
    kind: 'mixed',
    cable: { kind: 'other', conductors: 3, sectionMm2: 1.5, hasPE: true },
    endpoints,
    branches,
    ...(trunkDevices.length > 0 ? { trunkDevices } : {}),
    ...(trikCircuit.childCircuitIds.length > 0 ? { subCircuitIds: trikCircuit.childCircuitIds } : {}),
  }
  return canEditOneWireForks(probe) ? { ...variant, forkLegs: legs, branchOrder } : undefined
}

/**
 * Branch numbers by key, numbered the way the editor numbers points (`getCircuitPointSequence`):
 * each root, then its numbered legs (after a changeover switch, or off a run nothing switches),
 * then the next root. Other legs take the number of the branch they hang from.
 */
export function numberBranchesForForks(
  branchOrder: readonly string[],
  nodes: readonly TrikNode[],
  variant: ForkVariant | undefined,
): Map<string, number> {
  const legByKey = new Map((variant?.forkLegs ?? []).map((leg) => [leg.branchKey, leg]))
  const members = new Map<string, string[]>()
  for (const node of nodes) {
    const key = node.branchKey?.trim()
    if (key) members.set(key, [...(members.get(key) ?? []), node.id])
  }
  const branches: Branch[] = branchOrder.map((key) => {
    const leg = legByKey.get(key)
    const stem = variant?.stems[key]
    return { id: key, label: '', endpointIds: members.get(key) ?? [], ...(leg ? { forkFrom: { afterEndpointId: leg.afterNodeId } } : {}), ...(leg?.empty ? { keepEmpty: true as const } : {}), ...(stem && !leg ? { stem } : {}) }
  })
  const probe = { branches, endpoints: nodes.map((node) => ({ id: node.id, type: node.type, symbol: node.symbol })) as Endpoint[] }
  const numbers = new Map<string, number>()
  for (const slot of getCircuitPointSequence(probe)) {
    if (slot.kind === 'branch') numbers.set(branches[slot.branchIndex]!.id, numbers.size + 1)
  }
  const owners = getBranchLabelOwners(probe)
  for (const branch of branches) {
    if (!numbers.has(branch.id)) numbers.set(branch.id, numbers.get(owners.get(branch.id) ?? '') ?? numbers.size + 1)
  }
  return numbers
}
