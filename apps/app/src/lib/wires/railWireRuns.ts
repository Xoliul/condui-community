import type { CableSpec } from '@/types/schema'
import type { WireRun } from '@/types/projectV2'
import type { buildWireBusIndex } from './wireBusIndex'

/** Prefer an established shared rail over an old isolated tap specification. */
export function sharedRailRun(runs: readonly WireRun[], members: readonly string[]): WireRun | undefined {
  const candidates = runs.filter((run) => run.medium === 'busbar' && run.members.some((member) => members.includes(member)))
  return candidates.sort((left, right) =>
    right.members.filter((member) => members.includes(member)).length -
    left.members.filter((member) => members.includes(member)).length ||
    Math.min(...left.members.map((member) => members.indexOf(member)).filter((index) => index >= 0)) -
    Math.min(...right.members.map((member) => members.indexOf(member)).filter((index) => index >= 0)))[0]
}

export function railRunByGroup(buses: ReturnType<typeof buildWireBusIndex>, runs: readonly WireRun[]) {
  const ranks = new Map<string, number>()
  for (const members of buses.membersByGroup.values()) members.forEach((member, index) => ranks.set(member, index))
  const result = new Map<string, WireRun>()
  const scores = new Map<string, { count: number; rank: number }>()
  for (const run of runs) {
    if (run.medium !== 'busbar') continue
    const counts = new Map<string, { count: number; rank: number }>()
    for (const member of run.members) {
      const group = buses.groupByAnchor.get(member)
      if (!group) continue
      const score = counts.get(group) ?? { count: 0, rank: Infinity }
      score.count += 1
      score.rank = Math.min(score.rank, ranks.get(member) ?? Infinity)
      counts.set(group, score)
    }
    for (const [group, score] of counts) {
      const best = scores.get(group)
      if (!best || score.count > best.count || (score.count === best.count && score.rank < best.rank)) {
        scores.set(group, score)
        result.set(group, run)
      }
    }
  }
  return result
}

/** The final connection feeding a secondary bus belongs to its feeder, not its taps. */
export function isSecondaryBusFeederAnchor(anchor: string): boolean {
  return /^circuit:([^:]+):into:bus-section:secondary-bus:\1:(AC|DC)$/.test(anchor)
}

export function asRailCable(cable: CableSpec): CableSpec {
  return { ...cable, kind: 'other', customKind: 'busbar', hasPE: false, fireClass: undefined }
}
