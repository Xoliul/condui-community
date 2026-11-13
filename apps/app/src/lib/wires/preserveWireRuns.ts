import type { ProjectV2, WireRun } from '@/types/projectV2'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { editProjectWireRuns, selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
import { deriveSeedConductors } from '@/lib/projectV2/wireRunSeed'
import { withConductorIds } from './conductorIdentity'
import { circuitWireSpecifications } from './circuitWireSpecifications'
import { resolveProjectDefaultCableKind } from './circuitWireDefaults'
import { wireRunAppearance } from './wireRunAppearance'
import { followProjectWireAnchorReferences, rekeyWireRunMember } from './wireAnchorMutation'
import { getWireTopologyContext } from './wireTopologyContext'
import { preserveForkWireRuns } from './preserveForkWireRuns'

/** Preserve authored cables across a complete structural edit; fresh wires get specs, never old lengths/cores. */
export function preserveWireRuns(
  before: ProjectV2,
  after: ProjectV2,
  draft: ProjectV2,
  newId: () => string
): { created: string[]; changed: string[]; removed: string[] } {
  const created: string[] = []
  const changed = new Set<string>()
  const oldRuns = selectProjectWireRuns(before)
  if (!oldRuns.length || getProjectElectricalPanels(before) === getProjectElectricalPanels(after))
    return { created, changed: [], removed: [] }
  const previous = getWireTopologyContext(before)
  const next = getWireTopologyContext(after)
  const oldOwner = new Map(
    oldRuns.flatMap((run) => run.members.map((anchor) => [anchor, run] as const))
  )
  const runs = editProjectWireRuns(draft)
  const owners = new Map(runs.flatMap((run) => run.members.map((anchor) => [anchor, run] as const)))
  const byId = new Map(runs.map((run) => [run.id, run]))
  const replacements = new Map<string, string>()
  const move = (from: string, to: string) => {
    const run = owners.get(from)
    if (!run || (owners.has(to) && owners.get(to) !== run)) return false
    rekeyWireRunMember(run, from, to)
    owners.delete(from)
    owners.set(to, run)
    replacements.set(from, to)
    changed.add(run.id)
    return true
  }
  // A new enclosing protection changes circuit ownership while the physical cable still ends at the same device.
  for (const [anchor, connection] of previous.connections) {
    if (next.connections.has(anchor) || !owners.has(anchor)) continue
    const relocated = next.byTarget.get(connection.targetKey)
    if (relocated && relocated.circuitId !== connection.circuitId) move(anchor, relocated.anchor)
  }
  // Removing the leading device leaves the incoming cable ending at the next device of that same branch.
  const nextBranches = new Map(
    [...next.connections.values()].flatMap((connection) =>
      connection.branchKey ? [[connection.branchKey, connection] as const] : []
    )
  )
  for (const [anchor, connection] of previous.connections) {
    if (
      !connection.branchKey ||
      next.connections.has(anchor) ||
      next.byTarget.has(connection.targetKey)
    )
      continue
    const replacement = nextBranches.get(connection.branchKey)
    if (replacement && !replacement.rail) move(anchor, replacement.anchor)
  }
  const specifications = circuitWireSpecifications(getProjectElectricalPanels(before), oldRuns)
  const defaultKind = resolveProjectDefaultCableKind(getProjectElectricalInstallation(before))
  for (const [key, inputs] of previous.roots) {
    const targets = next.roots.get(key)?.filter((connection) => !connection.rail) ?? []
    if (!targets.length || inputs.some((connection) => connection.rail)) continue
    const first = inputs[0]!
    const source = oldOwner.get(first.anchor)
    if (!source || source.medium === 'busbar') continue
    const appearance = wireRunAppearance(
      source,
      first.anchor,
      specifications.get(first.anchor),
      defaultKind
    )
    if (
      !inputs.every((connection) => {
        const run = oldOwner.get(connection.anchor)
        return (
          run &&
          wireRunAppearance(
            run,
            connection.anchor,
            specifications.get(connection.anchor),
            defaultKind
          ) === appearance
        )
      })
    )
      continue // Mixed branch specifications never become one arbitrary circuit default.
    const pending = targets.filter((connection) => !owners.has(connection.anchor))
    // A preset empty wire becomes its first real connection with the same physical identity.
    if (first.empty && pending.length === 1) move(first.anchor, pending[0]!.anchor)
    // Keeping an empty output after the last loads are removed preserves a circuit preset, not a removed cable's length.
    for (const target of pending) {
      if (owners.has(target.anchor)) continue
      const id = newId()
      const copy: WireRun = {
        id,
        members: [target.anchor],
        cable: { ...source.cable },
        conductors: withConductorIds(id, deriveSeedConductors(source.cable)),
        ...(source.followsDefaultCable ? { followsDefaultCable: true } : {}),
        ...(source.fireClassNone ? { fireClassNone: true } : {}),
        ...(source.medium ? { medium: source.medium } : {}),
        ...(source.material ? { material: source.material } : {}),
        ...(source.route !== undefined ? { route: source.route } : {}),
        ...(source.inTube !== undefined ? { inTube: source.inTube } : {}),
        ...(source.labels ? { labels: { ...source.labels } } : {}),
      }
      runs.push(copy)
      byId.set(id, copy)
      owners.set(target.anchor, copy)
      created.push(id)
    }
  }
  followProjectWireAnchorReferences(draft, replacements, before)
  created.push(...preserveForkWireRuns(before, after, draft, previous, next, oldOwner, newId))
  // Retire only formerly live connections whose device has actually gone. A domain-only change
  // still belongs to the same device and is followed by the existing AC/DC repair.
  const survivingTargets = new Set(
    [...next.byTarget.keys()].map((key) => key.replace(/:(AC|DC)$/, ''))
  )
  const removed: string[] = []
  for (let index = runs.length - 1; index >= 0; index--) {
    const run = runs[index]!
    const retired = run.members.filter((anchor) => {
      const connection = previous.connections.get(anchor)
      return (
        connection &&
        !next.connections.has(anchor) &&
        !survivingTargets.has(connection.targetKey.replace(/:(AC|DC)$/, ''))
      )
    })
    if (!retired.length) continue
    const discarded = new Set(retired)
    run.members = run.members.filter((anchor) => !discarded.has(anchor))
    for (const anchor of retired) {
      if (run.segmentLengths) delete run.segmentLengths[anchor]
      if (run.segmentLengthSources) delete run.segmentLengthSources[anchor]
      if (run.coreAliases) delete run.coreAliases[anchor]
    }
    if (run.members.length) changed.add(run.id)
    else {
      runs.splice(index, 1)
      byId.delete(run.id)
      removed.push(run.id)
    }
  }
  return { created, changed: [...changed].filter((id) => byId.has(id)), removed }
}
