import type { ProjectV2 } from '@/types/projectV2'
import { buildElectricalStructureSnapshot } from '@/lib/electricalStructure/builder'
import { selectProjectWireRuns } from '@/lib/projectV2/wireRuns'

/** Carry authored values from former node-pair keys to their canonical feed edges. */
export function migrateLegacyWireRunEdgeAnchors(project: ProjectV2): boolean {
  const runs = selectProjectWireRuns(project)
  if (!runs.some((run) => run.members.some((anchor) => anchor.startsWith('wire:')))) return false
  const snapshot = buildElectricalStructureSnapshot(project)
  const replacements = new Map<string, string>()
  for (const relationship of snapshot.relationships) {
    const canonical = relationship.properties?.wireAnchor
    if (typeof canonical !== 'string' || !canonical.startsWith('feed:')) continue
    const former = `wire:${relationship.from}>${relationship.to}`
    if (former !== canonical) replacements.set(former, canonical)
  }
  const owned = new Map(runs.flatMap((run) => run.members.map((anchor) => [anchor, run.id] as const)))
  let changed = false
  for (const run of runs) {
    const nextMembers: string[] = []
    let runChanged = false
    for (const anchor of run.members) {
      const candidate = replacements.get(anchor)
      const replacement = candidate && (!owned.has(candidate) || owned.get(candidate) === run.id)
        ? candidate : anchor
      if (replacement !== anchor) {
        runChanged = true
        const lengthM = run.segmentLengths?.[anchor]
        if (lengthM != null) {
          run.segmentLengths ??= {}
          run.segmentLengths[replacement] ??= lengthM
          delete run.segmentLengths[anchor]
        }
      }
      if (nextMembers.includes(replacement)) runChanged = true
      else nextMembers.push(replacement)
    }
    if (runChanged) {
      run.members = nextMembers
      changed = true
    }
  }
  return changed
}
