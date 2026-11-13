import type { Branch, Circuit } from '@/types/schema'
import { resolveOneWireBranchTopology } from './oneWireBranchTopology'
import { isEndpointInOneWireConverterTree } from './oneWireConverterBranches'

/** Forks are unreleased: on in dev builds, or in a build with VITE_ENABLE_ONEWIRE_FORKS=1. */
export function oneWireForksEnabled(): boolean {
  return !!import.meta.env?.DEV || import.meta.env?.VITE_ENABLE_ONEWIRE_FORKS === '1'
}

export function hasOneWireForks(circuit: Pick<Circuit, 'branches'>): boolean {
  return !!circuit.branches?.some((branch) => branch.forkFrom || branch.keepEmpty)
}

/** One contract for command checks, readers and the ordinary AC layout. */
export function canEditOneWireForks(circuit: Circuit): boolean {
  if (circuit.code === 'PANEL' || circuit.subCircuitIds?.length ||
    circuit.trunkDevices?.some((device) => device.type === 'protection' || device.type === 'changeover' || !!device.supplyPath) ||
    circuit.sectionWireOverrides?.some((section) => section.phaseAssignment) ||
    circuit.endpoints.some((endpoint) => ['panel_distribution', 'junction_panel', 'solar_panel', 'battery'].includes(endpoint.symbol ?? '')))
    return false
  const topology = resolveOneWireBranchTopology({ ...circuit, branches: circuit.branches?.length ? circuit.branches :
    [{ id: 'implicit-root', label: '', endpointIds: circuit.endpoints.map((endpoint) => endpoint.id) }] })
  return topology.valid && topology.branches.every((branch) => branch.rootStem === 0 && (branch.feed.kind === 'trunk' || branch.feed.kind === 'endpoint' ||
    branch.feed.kind === 'existing-specialized' && !!branch.feed.converterBranch))
}

/** A fork after the last symbol of a run would only append to that run, so offer
 * one only where something already follows: a later symbol in the same branch,
 * or a leg already attached there. `ignoring` excludes symbols being moved away.
 * A root holding a converter endpoint (and its legs, if any) never takes a fork.
 */
export function canForkAfterEndpoint(circuit: Pick<Circuit, 'branches' | 'endpoints'>, endpointId: string, ignoring: ReadonlySet<string> = new Set()): boolean {
  if (isEndpointInOneWireConverterTree(circuit, endpointId)) return false
  const branches = circuit.branches ?? []
  const run = branches.find((branch) => branch.endpointIds.includes(endpointId))?.endpointIds ??
    (branches.length ? [] : circuit.endpoints.map((endpoint) => endpoint.id))
  const index = run.indexOf(endpointId)
  if (index < 0) return false
  if (run.slice(index + 1).some((id) => !ignoring.has(id))) return true
  return branches.some((branch) => branch.forkFrom?.afterEndpointId === endpointId &&
    (branch.keepEmpty || branch.endpointIds.some((id) => !ignoring.has(id))))
}

export function removeEndpointBranchMembers(circuit: Circuit, removed: ReadonlySet<string>): void {
  healOneWireForkDeletion(circuit, removed)
  circuit.endpoints = circuit.endpoints.filter((endpoint) => !removed.has(endpoint.id))
  if (!circuit.branches) return
  circuit.branches = circuit.branches.map((branch) => {
    const endpointIds = branch.endpointIds.filter((id) => !removed.has(id))
    return { ...branch, endpointIds, ...(branch.endpointIds.length && !endpointIds.length ? { keepEmpty: undefined } : {}) }
  }).filter((branch) => branch.endpointIds.length > 0 || branch.keepEmpty || (branch.branchDevices?.length ?? 0) > 0)
}

/** Root lookup without requiring endpoint records (also used by label queries). */
export function getOneWireBranchRoots(branches: readonly Branch[]): Map<string, string | null> {
  const owner = new Map(branches.flatMap((branch) => branch.endpointIds.map((id) => [id, branch] as const)))
  const result = new Map<string, string | null>()
  for (const branch of branches) {
    const pending: Branch[] = []
    const seen = new Set<string>()
    let cursor: Branch | undefined = branch
    let root: string | null = null
    while (cursor) {
      if (result.has(cursor.id)) { root = result.get(cursor.id)!; break }
      if (seen.has(cursor.id)) break
      seen.add(cursor.id); pending.push(cursor)
      if (!cursor.forkFrom) { root = cursor.id; break }
      cursor = owner.get(cursor.forkFrom.afterEndpointId)
    }
    for (const item of pending) result.set(item.id, root)
  }
  return result
}

/** Heal against the original topology before removing anything. */
export function healOneWireForkDeletion(circuit: Circuit, removed: ReadonlySet<string>): void {
  if (!hasOneWireForks(circuit)) return
  const original = circuit.branches ?? []
  const locations = new Map(original.flatMap((branch) => branch.endpointIds.map((id, index) => [id, { branch, index }] as const)))
  const healed = new Map<string, string | null>()
  function preceding(id: string): string | null {
    const pending: string[] = []
    const seen = new Set<string>()
    let cursor: string | null = id
    while (cursor && removed.has(cursor)) {
      if (healed.has(cursor)) { cursor = healed.get(cursor)!; break }
      if (seen.has(cursor)) return null
      seen.add(cursor); pending.push(cursor)
      const location: { branch: Branch; index: number } | undefined = locations.get(cursor)
      if (!location) return null
      cursor = location.branch.endpointIds[location.index - 1] ?? location.branch.forkFrom?.afterEndpointId ?? null
    }
    for (const item of pending) healed.set(item, cursor)
    return cursor
  }
  circuit.branches = original.map((branch) => {
    if (!branch.forkFrom || !removed.has(branch.forkFrom.afterEndpointId)) return branch
    const parent = preceding(branch.forkFrom.afterEndpointId)
    const { forkFrom: _attachment, ...rest } = branch
    return { ...rest, ...(parent ? { forkFrom: { afterEndpointId: parent } } : {}) }
  })
}
