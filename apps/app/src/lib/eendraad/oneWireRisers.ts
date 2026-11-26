import type { Branch, Circuit } from '@/types/schema'
import { canEditOneWireForks } from './oneWireForkProject'
import { PROTECTION_SYMBOL_IDS } from '@/lib/protectionKind'
import { hasOnlyRiserCompatibleTrunkDevices } from './oneWireRiserDevices'

type BranchesOnly = Pick<Circuit, 'branches'>

/** Root branch (never a leg) that feeds a second cable run from the protection. */
export function hasOneWireRisers(circuit: BranchesOnly): boolean {
  return !!circuit.branches?.some((branch) => !branch.forkFrom && (branch.stem ?? 0) > 0)
}

/** Raw check used before eligibility: any branch carries a stem field at all. */
export function hasStemFields(circuit: BranchesOnly): boolean {
  return !!circuit.branches?.some((branch) => branch.stem !== undefined)
}

/**
 * Risers exist only on ordinary AC final circuits without sub-circuits or nested protections (the fork
 * eligibility already excludes the latter two). Trunk devices are allowed when they all sit on the shared part
 * under the split: energy meters, terminal strips, junction boxes/panels and trunk switches (see
 * `isRiserCompatibleTrunkDevice`); converters, inline protections and devices between rows are not.
 */
export function canEditOneWireRisers(circuit: Circuit): boolean {
  return !circuit.subCircuitIds?.length && hasOnlyRiserCompatibleTrunkDevices(circuit) && canEditOneWireForks(circuit)
}

/** Stem of every branch, legs taking the stem of their root. Null when a leg cannot be resolved. */
export function getBranchStems(branches: readonly Branch[]): Map<string, number> | null {
  const owner = new Map(branches.flatMap((branch) => branch.endpointIds.map((id) => [id, branch] as const)))
  const result = new Map<string, number>()
  for (const branch of branches) {
    const path: Branch[] = []
    const seen = new Set<string>()
    let cursor: Branch | undefined = branch
    let stem: number | null = null
    while (cursor) {
      const known = result.get(cursor.id)
      if (known !== undefined) { stem = known; break }
      if (seen.has(cursor.id)) return null
      seen.add(cursor.id); path.push(cursor)
      if (!cursor.forkFrom) { stem = cursor.stem ?? 0; break }
      cursor = owner.get(cursor.forkFrom.afterEndpointId)
    }
    if (stem === null) return null
    for (const item of path) result.set(item.id, stem)
  }
  return result
}

/** Highest stem in use (0 without risers). */
export function getMaxStem(circuit: BranchesOnly): number {
  return (circuit.branches ?? []).reduce((max, branch) => Math.max(max, branch.forkFrom ? 0 : branch.stem ?? 0), 0)
}

/**
 * Keep stems contiguous (1..k), `branches` stably sorted by stem (legs keep their
 * root's stem) and the stem field absent for the trunk. Circuits without stem
 * fields are returned untouched; malformed ones (ineligible circuit, bad stems,
 * unresolved legs) are never rewritten. Returns whether anything changed.
 */
export function normalizeCircuitStems(circuit: Circuit): boolean {
  const branches = circuit.branches
  if (!branches || !hasStemFields(circuit)) return false
  if (branches.some((branch) => branch.stem !== undefined && (!Number.isSafeInteger(branch.stem) || branch.stem < 0 || !!branch.forkFrom))) return false
  if (!canEditOneWireRisers(circuit)) return false
  const stems = getBranchStems(branches)
  if (!stems) return false
  const used = [...new Set(stems.values())].sort((a, b) => a - b)
  const rank = new Map(used.map((stem, index) => [stem, index]))
  const sorted = branches.map((branch, index) => ({ branch, index, key: rank.get(stems.get(branch.id)!)! }))
    .sort((a, b) => a.key - b.key || a.index - b.index)
  let changed = false
  const next = sorted.map(({ branch, key }, index) => {
    if (branches[index] !== branch) changed = true
    if (branch.forkFrom) return branch
    const stem = key > 0 ? key : undefined
    if (branch.stem === stem || (branch.stem === undefined && stem === undefined)) return branch
    changed = true
    const { stem: _stem, ...rest } = branch
    return stem ? { ...rest, stem } : rest
  })
  if (!changed) return false
  circuit.branches = next
  return true
}

/** Stem a new root inserted at `index` joins: the neighbour before it, else the one after. */
export function stemAtInsertIndex(branches: readonly Branch[], index: number, requested?: number): number {
  if (requested !== undefined) return requested
  const stems = getBranchStems(branches)
  const neighbour = branches[index - 1] ?? branches[index]
  return neighbour && stems ? stems.get(neighbour.id) ?? 0 : 0
}

/** Insert a new root branch carrying `stem`; `newRiser` appends the next stem to the right. A new row replaces the empty row of its riser. */
export function insertRootBranch(branches: readonly Branch[], branch: Branch, index: number, options: { stem?: number; newRiser?: boolean; stemStart?: boolean } = {}): Branch[] {
  const max = branches.reduce((value, item) => Math.max(value, item.forkFrom ? 0 : item.stem ?? 0), 0)
  const stem = options.newRiser ? max + 1 : stemAtInsertIndex(branches, index, options.stem)
  const next = [...branches]
  // A drop on a riser's lead or vertical (a stem without a slot) joins the riser at the row nearest the breaker.
  const first = options.stemStart && !options.newRiser ? next.findIndex((item) => !item.forkFrom && (item.stem ?? 0) === stem) : -1
  const position = options.newRiser ? next.length : first >= 0 ? first : Math.max(0, Math.min(index, next.length))
  next.splice(position, 0, stem > 0 ? { ...branch, stem } : branch)
  // A riser that only held its empty row takes the new row in its place, so no empty sibling stays behind.
  return stem > 0 ? next.filter((item) => item.id === branch.id || item.forkFrom || (item.stem ?? 0) !== stem || item.endpointIds.length || !item.keepEmpty) : next
}

/** Riser fields of a drop target (read structurally so any target shape works). */
export function getRiserTargetFields(target: object): { stem?: number; newRiser?: boolean; stemStart?: boolean } {
  const fields = target as { branchStem?: unknown; newRiser?: unknown; branchInsertIndex?: unknown }
  return {
    ...(typeof fields.branchStem === 'number' ? { stem: fields.branchStem } : {}),
    ...(typeof fields.branchStem === 'number' && typeof fields.branchInsertIndex !== 'number' ? { stemStart: true } : {}),
    ...(fields.newRiser === true ? { newRiser: true } : {}),
  }
}

/**
 * A breaker or other protection dropped on a circuit would wrap the circuit's rows, risers included, into a nested
 * circuit. A circuit with risers refuses it everywhere: no hint, no preview, and the command rejects it. That includes a
 * slot on the circuit's own secondary bus (`secondaryBusInsertIndex`): it adds a sub-circuit to this circuit too, and
 * `target.circuitId` always names the circuit that owns that bus.
 */
export function isProtectionDropOnRiserCircuit(
  symbolId: string,
  target: { type?: string | null },
  circuit: BranchesOnly | null | undefined,
): boolean {
  return (PROTECTION_SYMBOL_IDS as readonly string[]).includes(symbolId) && isNestingTargetOnRiserCircuit(target, circuit)
}

/** Any drop or move that would put a circuit or protection inside this circuit (its nest zone, bus slot or own-protection lift). */
export function isNestingTargetOnRiserCircuit(target: { type?: string | null }, circuit: BranchesOnly | null | undefined): boolean {
  return !!circuit && target.type === 'circuit' && hasOneWireRisers(circuit)
}
