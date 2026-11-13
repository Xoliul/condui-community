import type { Circuit, Panel, WireSegment } from '@/types/schema'
import type { LayoutNode } from './layoutTree'
import { getCircuitWirePropertiesForDomain, applyNodeWireInset } from './circuitWireDerivationSupport'
import { resolveOneWireBranchTopology } from '@/lib/eendraad/oneWireBranchTopology'
import { generateId } from '@/utils/id'

/** Fork cables retain the referenced endpoint as their logical/physical source.
 * The drawing tap is geometry, never an invented situated splice or junction box.
 */
export function deriveSavedForkWires(mcb: LayoutNode, circuit: Circuit, panel: Panel): WireSegment[] {
  if (!circuit.branches?.some((branch) => branch.forkFrom)) return []
  const topology = resolveOneWireBranchTopology({ ...circuit, branches: circuit.branches })
  const rows = mcb.children.filter((node) => node.type === 'branch')
  const endpoints = new Map(rows.flatMap((row) => row.children.filter((node) => node.type === 'endpoint').map((node) => [node.domainId!, node] as const)))
  const result: WireSegment[] = []
  for (const row of rows) {
    const layout = row.branchLayout
    if (!layout?.forkFrom || layout.forkUnresolved || topology.byBranchId.get(layout.storedBranchId ?? '')?.feed.kind === 'unresolved') continue
    const parent = endpoints.get(layout.forkFrom.afterEndpointId)
    if (!parent) continue
    const nodes = row.children.filter((node) => node.type === 'endpoint')
    const first = nodes[0]
    const toId = first?.domainId
    const anchor = toId ? `circuit:${circuit.id}:into:endpoint:${toId}:AC` : `circuit:${circuit.id}:fork:${layout.storedBranchId}:AC`
    const props = getCircuitWirePropertiesForDomain(circuit, 'AC', {
      fromElementType: 'endpoint', fromElementId: parent.domainId, toElementType: 'endpoint', toElementId: toId, domain: 'AC',
    })
    const common = { ...props, circuitId: circuit.id, panelId: panel.id, domain: 'AC' as const,
      fromElementId: parent.domainId, fromElementType: 'endpoint' as const,
      toElementId: toId, toElementType: 'endpoint' as const, wireAnchor: anchor }
    const tap = { x: layout.trunkX, y: parent.bounds.y }
    const turn = { x: layout.trunkX, y: layout.branchY }
    result.push({ ...common, id: generateId(), type: 'branch', hideWireLabel: true,
      startPoint: applyNodeWireInset({ x: parent.bounds.x, y: parent.bounds.y }, tap, parent), endPoint: tap })
    result.push({ ...common, id: generateId(), type: 'vertical', startPoint: tap, endPoint: turn })
    const end = first ? { x: first.bounds.x, y: layout.branchY } : { x: layout.branchX + layout.branchWidth, y: layout.branchY }
    result.push({ ...common, id: generateId(), type: 'branch', hideWireLabel: true,
      startPoint: turn, endPoint: first ? applyNodeWireInset(end, turn, first) : end })
    for (let index = 1; index < nodes.length; index++) {
      const from = nodes[index - 1]!, to = nodes[index]!
      const fromPoint = { x: from.bounds.x, y: from.bounds.y }, toPoint = { x: to.bounds.x, y: to.bounds.y }
      const section = getCircuitWirePropertiesForDomain(circuit, 'AC', { fromElementType: 'endpoint', fromElementId: from.domainId, toElementType: 'endpoint', toElementId: to.domainId, domain: 'AC' })
      result.push({ ...section, id: generateId(), type: 'branch', circuitId: circuit.id, panelId: panel.id, domain: 'AC',
        fromElementId: from.domainId, fromElementType: 'endpoint', toElementId: to.domainId, toElementType: 'endpoint',
        startPoint: applyNodeWireInset(fromPoint, toPoint, from), endPoint: applyNodeWireInset(toPoint, fromPoint, to),
        wireAnchor: `circuit:${circuit.id}:into:endpoint:${to.domainId}:AC` })
    }
  }
  return result
}
