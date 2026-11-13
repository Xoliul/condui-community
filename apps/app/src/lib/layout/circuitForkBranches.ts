import type { Circuit } from '@/types/schema'
import type { BranchLayout } from './wireSegments'
import { resolveOneWireBranchTopology } from '@/lib/eendraad/oneWireBranchTopology'
import { getBranchLabelOwners } from '@/lib/eendraad/circuitPointNumbering'
import { getEndpointLayoutXOffsets, calculateBranchWidth } from './bottomUpBranchWidths'

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
}

/** Production branch geometry, using the same symbol/label offsets as ordinary
 * rows. Iterative subtree reservations keep arbitrary-depth legs above their
 * parent; rightmost attachments sit lowest so stems cannot cross other legs.
 */
export function layoutCircuitForkBranches(
  circuit: Circuit, startX: number, startY: number, firstY: number, metrics: ForkBranchMetrics
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
  let rootY = firstY
  const pending = roots.map((id, index) => {
    const y = rootY
    rootY -= heights.get(id)!
    rootY -= (circuit.trunkDevices ?? []).filter((device) => device.trunkPosition === index + 1).length * metrics.trunkDeviceSpacing
    return { id, x: startX, stemX: startX, y, sourceY: startY }
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
      ...(source.forkFrom ? { labelX: startX } : {}),
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
      pending.push({ id: leg.id, x: firstOffset == null ? stemX : item.x + nextX - firstOffset, stemX, y: nextY, sourceY: item.y })
      nextY -= heights.get(leg.id)!
    }
  }
  return result
}
