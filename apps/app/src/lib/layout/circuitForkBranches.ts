import type { Circuit } from '@/types/schema'
import type { BranchLayout } from './wireSegments'
import { resolveOneWireBranchTopology } from '@/lib/eendraad/oneWireBranchTopology'
import { getBranchLabelOwners } from '@/lib/eendraad/circuitPointNumbering'
import { getEndpointLayoutXOffsets, calculateBranchWidth } from './bottomUpBranchWidths'
import type { CircuitRunPlan } from './circuitRunPlan'

/** Extra space after a symbol that legs fork from, leaving room either side of the tap. */
export const FORK_TAP_EXTRA_GAP = 30

export interface ForkBranchMetrics {
  branchLeadIn: number
  endpointSpacing: number
  applianceAfterSocketGap: number
  rowSpacing: number
  trunkDeviceSpacing: number
  bottomHeight?: (endpoints: Circuit['endpoints']) => number
  /** Clear height a row needs above itself (a converter's detached metadata card), as in rows without forks. */
  topReserve?: (endpoints: Circuit['endpoints']) => number
  /** Paint below a row's wire; sizes the lift of a stem's first rows above its crossbar. */
  columnBottomExtent?: (endpoints: Circuit['endpoints']) => number
}

/** Runs of a circuit drawn in columns: each starts at `firstY` (or above its stem's crossbar) at its own riser x. */
export interface ForkRunLayout {
  plan: CircuitRunPlan
  /** Riser x offset from the trunk, one per run. */
  offsets: readonly number[]
  /** Split height above the breaker row when trunk devices sit under it; see `circuitRiserSplit.ts`. */
  splitRise?: number
}

/** Gap kept between a crossbar and the lowest note of a stem's first row (as in `circuitColumnRows`). */
const CROSSBAR_NOTE_CLEARANCE = 10

/** Production branch geometry, using the same symbol/label offsets as ordinary
 * rows. Iterative subtree reservations keep arbitrary-depth legs above their
 * parent; rightmost attachments sit lowest so stems cannot cross other legs.
 */
export function layoutCircuitForkBranches(
  circuit: Circuit, startX: number, startY: number, firstY: number, metrics: ForkBranchMetrics, runLayout?: ForkRunLayout
): BranchLayout[] {
  const topology = resolveOneWireBranchTopology({ ...circuit, branches: circuit.branches ?? [] })
  const byEndpoint = new Map(circuit.endpoints.map((endpoint) => [endpoint.id, endpoint]))
  if (topology.byBranchId.size !== topology.branches.length) return topology.branches.map((item, index) => ({
    id: `branch-${circuit.id}-${index}`, storedBranchId: item.branch.id, circuitId: circuit.id, label: item.branch.label,
    trunkX: startX, trunkY: startY, branchX: startX, branchY: firstY - index * metrics.rowSpacing,
    branchWidth: metrics.branchLeadIn, endpoints: item.branch.endpointIds.flatMap((id) => byEndpoint.has(id) ? [byEndpoint.get(id)!] : []),
    isStraight: false, forkFrom: item.branch.forkFrom, forkUnresolved: true,
  }))
  const children = new Map<string, string[]>()
  const roots: string[] = []
  for (const item of topology.branches) {
    // Unresolved imports stay visible as isolated rows; consumers withhold their
    // electrical connections. Never silently infer a permanent feed for them.
    if (item.parentBranchId && item.feed.kind !== 'unresolved') {
      const list = children.get(item.parentBranchId) ?? []
      list.push(item.branch.id); children.set(item.parentBranchId, list)
    } else roots.push(item.branch.id)
  }
  if (runLayout) {
    const position = new Map(runLayout.plan.rootIds.map((id, index) => [id, index]))
    roots.sort((a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0))
  }
  const order = [...roots]
  for (let index = 0; index < order.length; index++) order.push(...children.get(order[index]!) ?? [])
  // Numbered legs (after a changeover switch, or off an unswitched run) show a label; other legs share theirs and stay unlabelled.
  const labelOwners = getBranchLabelOwners(circuit)
  const heights = new Map<string, number>()
  const rowSpacing = new Map<string, number>()
  for (let index = order.length - 1; index >= 0; index--) {
    const id = order[index]!
    const endpoints = topology.byBranchId.get(id)!.branch.endpointIds.flatMap((endpointId) => byEndpoint.has(endpointId) ? [byEndpoint.get(endpointId)!] : [])
    const spacing = Math.max(metrics.rowSpacing, (metrics.bottomHeight?.(endpoints) ?? 0) + 35, metrics.topReserve?.(endpoints) ?? 0)
    rowSpacing.set(id, spacing)
    heights.set(id, spacing + (children.get(id) ?? []).reduce((sum, child) => sum + heights.get(child)!, 0))
  }
  // Per stem with several runs, the first rows of all its runs share one y above the stem's crossbar (at `firstY`).
  const liftByStem = new Map<number, number>()
  if (runLayout) {
    for (const stem of runLayout.plan.stems) {
      const runs = runLayout.plan.runs.filter((run) => run.stem === stem)
      if (runs.length < 2) continue
      liftByStem.set(stem, Math.max(metrics.rowSpacing, ...runs.map((run) => {
        const first = topology.byBranchId.get(roots[run.firstRoot]!)?.branch
        const endpoints = first?.endpointIds.flatMap((id) => byEndpoint.has(id) ? [byEndpoint.get(id)!] : []) ?? []
        return (metrics.columnBottomExtent?.(endpoints) ?? 0) + CROSSBAR_NOTE_CLEARANCE
      })))
    }
  }
  const runOfRoot = new Map<string, NonNullable<ForkRunLayout>['plan']['runs'][number]>()
  runLayout?.plan.runs.forEach((run) => {
    for (let index = run.firstRoot; index < run.firstRoot + run.rootCount; index++) runOfRoot.set(roots[index]!, run)
  })
  let rootY = firstY
  const pending = roots.map((id, index) => {
    const run = runOfRoot.get(id)
    if (run && index === run.firstRoot) rootY = firstY - (liftByStem.get(run.stem) ?? 0)
    const y = rootY
    rootY -= heights.get(id)!
    rootY -= (circuit.trunkDevices ?? []).filter((device) => device.trunkPosition === index + 1).length * metrics.trunkDeviceSpacing
    const x = startX + (run ? runLayout!.offsets[run.column] ?? 0 : 0)
    return { id, x, stemX: x, y, sourceY: startY, run }
  })
  const result: BranchLayout[] = []
  for (let index = 0; index < pending.length; index++) {
    const item = pending[index]!
    const source = topology.byBranchId.get(item.id)!.branch
    const endpoints = source.endpointIds.flatMap((id) => byEndpoint.has(id) ? [byEndpoint.get(id)!] : [])
    const positions = new Map(source.endpointIds.map((id, endpointIndex) => [id, endpointIndex]))
    const legs = (children.get(item.id) ?? []).map((id, storedIndex) => ({
      id, storedIndex, endpointIndex: positions.get(topology.byBranchId.get(id)!.branch.forkFrom!.afterEndpointId)!,
    })).sort((a, b) => b.endpointIndex - a.endpointIndex || a.storedIndex - b.storedIndex)
    // A tap gets an extra gap so a symbol can be dropped on either side of it.
    const anchors = new Set(legs.map((leg) => leg.endpointIndex))
    const offsets = getEndpointLayoutXOffsets(endpoints, metrics.branchLeadIn, metrics.endpointSpacing, metrics.applianceAfterSocketGap)
      .map((offset, endpointIndex) => offset + FORK_TAP_EXTRA_GAP * [...anchors].filter((anchor) => anchor < endpointIndex).length)
    const width = (endpoints.length ? calculateBranchWidth(endpoints, metrics.branchLeadIn, metrics.endpointSpacing, metrics.applianceAfterSocketGap) : metrics.branchLeadIn)
      + FORK_TAP_EXTRA_GAP * anchors.size
    result.push({
      id: `branch-${circuit.id}-${topology.byBranchId.get(item.id)!.index}`, storedBranchId: item.id,
      circuitId: circuit.id, label: source.forkFrom && labelOwners.get(source.id) !== source.id ? '' : source.label,
      trunkX: item.stemX, trunkY: item.sourceY, branchX: item.x, branchY: item.y,
      branchWidth: width, endpoints, isStraight: false, forkFrom: source.forkFrom,
      forkUnresolved: topology.byBranchId.get(item.id)!.feed.kind === 'unresolved',
      // Numbered legs line their label up with the root labels at the circuit trunk.
      ...(source.forkFrom ? { labelX: item.run ? startX + (runLayout!.offsets[item.run.column] ?? 0) : startX } : {}),
      ...(item.run ? { column: { index: item.run.column, startRow: item.run.startRow, count: item.run.rowCount, crossbarY: firstY, kind: item.run.kind, stem: item.run.stem, ...(runLayout?.splitRise ? { splitRise: runLayout.splitRise } : {}) } } : {}),
      ...(anchors.size ? { endpointXOffsets: offsets } : {}),
    })
    let nextY = item.y - rowSpacing.get(item.id)!
    for (const leg of legs) {
      const fromX = offsets[leg.endpointIndex] ?? 0
      const nextX = offsets[leg.endpointIndex + 1] ?? fromX + metrics.endpointSpacing + FORK_TAP_EXTRA_GAP
      // The stem taps midway between the two parent points; the leg's first symbol
      // sits directly above the next parent point so stacked runs share columns.
      const stemX = item.x + (fromX + nextX) / 2
      const legEndpoints = topology.byBranchId.get(leg.id)!.branch.endpointIds.flatMap((id) => byEndpoint.has(id) ? [byEndpoint.get(id)!] : [])
      const firstOffset = getEndpointLayoutXOffsets(legEndpoints, metrics.branchLeadIn, metrics.endpointSpacing, metrics.applianceAfterSocketGap)[0]
      pending.push({ id: leg.id, x: firstOffset == null ? stemX : item.x + nextX - firstOffset, stemX, y: nextY, sourceY: item.y, run: item.run })
      nextY -= heights.get(leg.id)!
    }
  }
  return result
}
