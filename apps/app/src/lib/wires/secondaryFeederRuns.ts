import { moveWireRunMember } from './conductorIdentity'
import type { ElectricalStructureRelationship } from '@/lib/electricalStructure'
import { buildElectricalStructureSnapshot } from '@/lib/electricalStructure/builder'
import { editProjectWireRuns, selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
import type { ProjectV2 } from '@/types/projectV2'

/**
 * The feeder cable of a secondary board is one physical cable drawn twice: leaving its protection
 * on the parent board (`circuit:…:into:open-end:protection:…`) and arriving on the secondary's
 * incoming supply (`panel-feed:…`, into its bus or first local device). Both leave the same
 * protection node in the structure snapshot. Returns each such pair of anchors.
 */
export function secondaryFeederAnchorPairs(
  relationships: readonly ElectricalStructureRelationship[]
): Array<[parentSide: string, secondarySide: string]> {
  const openEndByProtection = new Map<string, string>()
  for (const relationship of relationships) {
    const anchor = relationship.properties?.wireAnchor
    if (
      typeof anchor === 'string' &&
      anchor.includes(':into:open-end:protection:') &&
      relationship.from.startsWith('protection:')
    ) {
      openEndByProtection.set(relationship.from, anchor)
    }
  }
  const pairs: Array<[string, string]> = []
  for (const relationship of relationships) {
    const anchor = relationship.properties?.wireAnchor
    if (relationship.kind !== 'panel-feed' || typeof anchor !== 'string') continue
    const parentSide = openEndByProtection.get(relationship.from)
    if (parentSide) pairs.push([parentSide, anchor])
  }
  return pairs
}

/** The other anchor of the same feeder cable, when `anchor` is one end of a secondary feeder. */
export function secondaryFeederPartnerAnchors(
  relationships: readonly ElectricalStructureRelationship[],
  anchor: string
): string[] {
  return secondaryFeederAnchorPairs(relationships).flatMap(([parentSide, secondarySide]) =>
    anchor === parentSide ? [secondarySide] : anchor === secondarySide ? [parentSide] : []
  )
}

/**
 * Joins the two ends of every secondary feeder into one wire run, so a cable, route, or label set
 * on either board shows on both. Older files may have split runs; the parent board's run wins
 * for the shared specification, while each end keeps its own measured length. Mutates the
 * project; returns true when a run changed.
 */
export function joinSecondaryFeederRuns(project: ProjectV2): boolean {
  if (selectProjectWireRuns(project).length === 0) return false
  const pairs = secondaryFeederAnchorPairs(buildElectricalStructureSnapshot(project).relationships)
  if (pairs.length === 0) return false
  const runs = editProjectWireRuns(project)
  let changed = false
  for (const [parentSide, secondarySide] of pairs) {
    const parentRun = runs.find((run) => run.members.includes(parentSide))
    const secondaryRun = runs.find((run) => run.members.includes(secondarySide))
    if (parentRun === secondaryRun) continue
    const keep = parentRun ?? secondaryRun!
    const other = keep === parentRun ? secondaryRun : undefined
    const moved = keep === parentRun ? secondarySide : parentSide
    if (other) {
      moveWireRunMember(other, keep, moved)
      if (other.members.length === 0) runs.splice(runs.indexOf(other), 1)
    }
    if (!keep.members.includes(moved)) keep.members.push(moved)
    changed = true
  }
  return changed
}
