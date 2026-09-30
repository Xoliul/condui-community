import type { Circuit } from '@/types/schema'
import type { LayoutNode } from '@/lib/layout/layoutTree'
import { getCircuitBranches } from '@/lib/layout/endpointChains'

/**
 * Endpoints from the clicked endpoint to the end of its own branch, in branch order.
 * Neighbouring branches of the same circuit are never included.
 */
export function getBranchDownstreamEndpointIds(circuit: Circuit, endpointId: string): string[] {
  const branch = getCircuitBranches(circuit).find((candidate) =>
    candidate.some((endpoint) => endpoint.id === endpointId)
  )
  if (!branch) return [endpointId]
  const index = branch.findIndex((endpoint) => endpoint.id === endpointId)
  return branch.slice(index).map((endpoint) => endpoint.id)
}

/**
 * Dragging the first endpoint of a multi-endpoint branch moves the whole branch.
 * Returns the branch endpoint ids, or null when the drag should stay a single-endpoint move.
 * Domotica groups keep their dedicated move handling.
 */
export function getBranchDragGroupEndpointIds(circuit: Circuit, endpointId: string): string[] | null {
  // Branch-group moves operate on stored branches only.
  if (!circuit.branches?.length) return null
  const branch = getCircuitBranches(circuit).find((candidate) =>
    candidate.some((endpoint) => endpoint.id === endpointId)
  )
  if (!branch || branch.length < 2 || branch[0]!.id !== endpointId) return null
  if (branch.some((endpoint) => endpoint.symbol === 'domotica' || endpoint.domoticaChildProps)) {
    return null
  }
  return branch.map((endpoint) => endpoint.id)
}

const SELECTABLE_DOWNSTREAM_NODE_TYPES = new Set<LayoutNode['type']>([
  'rcd',
  'mcb',
  'trunkDevice',
  'endpoint',
])

/**
 * Every selectable element in a protection's layout subtree: the protection itself,
 * nested protections, trunk devices and all branch endpoints, in tree order.
 */
export function getLayoutSubtreeSelectionIds(root: LayoutNode): string[] {
  const ids = new Set<string>()
  const visit = (node: LayoutNode) => {
    if (node.domainId && SELECTABLE_DOWNSTREAM_NODE_TYPES.has(node.type)) ids.add(node.domainId)
    for (const child of node.children) visit(child)
  }
  visit(root)
  return [...ids]
}
