/**
 * Stable identity of the physical cores of a wire run.
 *
 * A core keeps its id when its run is reseeded (cable or phase change, auto-sizing) as long as the
 * new list still contains a core with the same function and assignment. Ambiguous correspondences
 * are never guessed: the old core is dropped and the new one gets a fresh id, so anything attached
 * to the old id (a junction termination) is orphaned visibly instead of moving to another core.
 *
 * Shared infrastructure for every edition: ordinary wire editing reseeds conductor lists
 * everywhere, so identity must survive it in Community and local projects too.
 * Design: apps/app/docs/context/future/junctions-and-terminal-strips.md (Core identity).
 */
import type { ProjectV2, WireConductor, WireRun } from '@/types/projectV2'
import { selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
import { generateId } from '@/utils/project'
import { stableHash } from '@/utils/stableHash'

/** Function + assignment + signal pair member: what makes two cores interchangeable. */
export function conductorMatchKey(conductor: WireConductor): string {
  const port = conductor.assignment?.port
  return JSON.stringify([
    conductor.function,
    port ? [port.kind, port.id, port.port, port.pole] : null,
    conductor.assignment?.traveller ?? null,
    conductor.assignment?.group ?? null,
    conductor.signal ? [conductor.signal.pair, conductor.signal.member] : null,
  ])
}

/**
 * Deterministic id for a core that has none (data from before core identity, or from an older
 * client). Two independent upgrades of the same project produce the same ids, so later merges do
 * not duplicate cores.
 */
export function deterministicConductorId(runId: string, conductor: WireConductor, ordinal: number): string {
  return `core_${stableHash(`${runId}|${conductorMatchKey(conductor)}|${ordinal}`)}`
}

/**
 * Returns the list with every core carrying a unique id. Existing unique ids are kept; missing
 * and duplicate ids are assigned deterministically from run id, match key and ordinal.
 */
export function withConductorIds(runId: string, conductors: readonly WireConductor[]): WireConductor[] {
  const used = new Set<string>()
  const ordinals = new Map<string, number>()
  const pending: number[] = []
  const result = conductors.map((conductor, index) => {
    const key = conductorMatchKey(conductor)
    const ordinal = ordinals.get(key) ?? 0
    ordinals.set(key, ordinal + 1)
    if (conductor.id && !used.has(conductor.id)) {
      used.add(conductor.id)
      return conductor
    }
    pending.push(index)
    return conductor
  })
  if (pending.length === 0) return result
  const pendingOrdinals = new Map<string, number>()
  for (const index of pending) {
    const conductor = result[index]!
    const key = conductorMatchKey(conductor)
    let ordinal = pendingOrdinals.get(key) ?? 0
    let id = deterministicConductorId(runId, conductor, ordinal)
    while (used.has(id)) {
      ordinal += 1
      id = deterministicConductorId(runId, conductor, ordinal)
    }
    pendingOrdinals.set(key, ordinal + 1)
    used.add(id)
    result[index] = { ...conductor, id }
  }
  return result
}

/**
 * Ids of a cable that has no stored run yet derive from its anchor, and a run created for that
 * cable starts with the same ids, so a reference made before the run existed keeps resolving.
 */
export function anchorConductorIdSeed(anchor: string): string {
  return `default:${anchor}`
}

/**
 * Carries core ids from the previous list onto a rebuilt one (reseed after a cable or phase change).
 *
 * - A match key that occurs once in both lists keeps its id, wherever the core moved.
 * - A match key that occurs several times (two unassigned `ctrl` cores) keeps ids only for cores
 *   that are unchanged in place (same index, same key); the rest get new ids.
 * - Cores of the previous list without a counterpart disappear; new cores get new ids.
 *
 * Kept cores retain their colour and marking unless the new list sets them.
 */
export function reconcileConductors(
  previous: readonly WireConductor[],
  next: readonly WireConductor[],
  createId: () => string = generateId
): WireConductor[] {
  const previousByKey = new Map<string, number[]>()
  previous.forEach((conductor, index) => {
    const key = conductorMatchKey(conductor)
    previousByKey.set(key, [...(previousByKey.get(key) ?? []), index])
  })
  const nextCountByKey = new Map<string, number>()
  for (const conductor of next) {
    const key = conductorMatchKey(conductor)
    nextCountByKey.set(key, (nextCountByKey.get(key) ?? 0) + 1)
  }
  const used = new Set<string>()
  return next.map((conductor, index) => {
    const key = conductorMatchKey(conductor)
    const candidates = previousByKey.get(key) ?? []
    let match: WireConductor | undefined
    if (candidates.length === 1 && nextCountByKey.get(key) === 1) {
      match = previous[candidates[0]!]
    } else if (candidates.includes(index)) {
      match = previous[index]
    }
    const keptId = match?.id && !used.has(match.id) ? match.id : undefined
    const id = keptId ?? createId()
    used.add(id)
    const kept: WireConductor = { ...conductor, id }
    if (keptId && match) {
      if (kept.colour === undefined && match.colour !== undefined) kept.colour = match.colour
      if (kept.marking === undefined && match.marking !== undefined) kept.marking = match.marking
    }
    return kept
  })
}

/** Deep copy for a run fork: the copy keeps the same core ids, so `(wireAnchor, coreId)` still resolves. */
export function copyConductorsForFork(conductors: readonly WireConductor[]): WireConductor[] {
  return conductors.map((conductor) => structuredClone(conductor))
}

function uniqueKeyIndex(conductors: readonly WireConductor[]): Map<string, WireConductor | null> {
  const index = new Map<string, WireConductor | null>()
  for (const conductor of conductors) {
    const key = conductorMatchKey(conductor)
    index.set(key, index.has(key) ? null : conductor)
  }
  return index
}

/**
 * Old core id -> new core id for cores whose function and assignment occur exactly once in both
 * lists. Ambiguous cores get no entry, so references to them orphan instead of being guessed.
 */
export function mapLinkedConductorIds(
  from: readonly WireConductor[],
  to: readonly WireConductor[]
): Record<string, string> {
  const fromIndex = uniqueKeyIndex(from)
  const toIndex = uniqueKeyIndex(to)
  const mapping: Record<string, string> = {}
  for (const [key, source] of fromIndex) {
    const target = toIndex.get(key)
    if (source?.id && target?.id && source.id !== target.id) mapping[source.id] = target.id
  }
  return mapping
}

/**
 * Moves one member anchor from `from` to `to` (the surviving run keeps its own core ids) and
 * records how the member's former core ids map onto `to`. Segment lengths travel with the member.
 */
export function moveWireRunMember(from: WireRun, to: WireRun, member: string): void {
  if (from === to) return
  const direct = mapLinkedConductorIds(from.conductors, to.conductors)
  const toIds = new Set(to.conductors.map((conductor) => conductor.id))
  const aliases: Record<string, string> = {}
  for (const [oldId, viaId] of Object.entries(from.coreAliases?.[member] ?? {})) {
    const target = toIds.has(viaId) ? viaId : direct[viaId]
    if (target) aliases[oldId] = target
  }
  Object.assign(aliases, direct)
  for (const [oldId, newId] of Object.entries(to.coreAliases?.[member] ?? {})) {
    aliases[oldId] ??= newId
  }
  const nextAliases = { ...to.coreAliases }
  if (Object.keys(aliases).length > 0) nextAliases[member] = aliases
  else delete nextAliases[member]
  to.coreAliases = Object.keys(nextAliases).length > 0 ? nextAliases : undefined
  if (!to.coreAliases) delete to.coreAliases

  if (from.segmentLengths?.[member] !== undefined) {
    to.segmentLengths = { ...to.segmentLengths, [member]: from.segmentLengths[member]! }
  }
  if (from.segmentLengthSources?.[member]) {
    to.segmentLengthSources = { ...to.segmentLengthSources, [member]: from.segmentLengthSources[member]! }
  }
  from.members = from.members.filter((candidate) => candidate !== member)
  if (from.coreAliases?.[member]) {
    const remaining = { ...from.coreAliases }
    delete remaining[member]
    if (Object.keys(remaining).length > 0) from.coreAliases = remaining
    else delete from.coreAliases
  }
  if (!to.members.includes(member)) to.members.push(member)
}

/** The core a `(anchor, coreId)` reference points at in its run, following member aliases. */
export function resolveRunConductor(
  run: Pick<WireRun, 'conductors' | 'coreAliases'>,
  anchor: string,
  coreId: string
): WireConductor | undefined {
  const direct = run.conductors.find((conductor) => conductor.id === coreId)
  if (direct) return direct
  const alias = run.coreAliases?.[anchor]?.[coreId]
  return alias ? run.conductors.find((conductor) => conductor.id === alias) : undefined
}

/** Assigns ids to every core in the project that lacks one. Returns whether anything changed. */
export function ensureProjectConductorIds(project: Pick<ProjectV2, 'disciplines'>): boolean {
  let changed = false
  for (const run of selectProjectWireRuns(project) as WireRun[]) {
    if (!Array.isArray(run.conductors)) continue
    const next = withConductorIds(run.id, run.conductors)
    if (next.some((conductor, index) => conductor !== run.conductors[index])) {
      run.conductors = next
      changed = true
    }
  }
  return changed
}
