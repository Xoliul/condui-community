import type { Branch, Circuit } from '@/types/schema'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import { canEditOneWireForks } from './oneWireForkProject'
import { isEndpointInOneWireConverterTree, isOneWireConverterBranch } from './oneWireConverterBranches'
import { initializeBranchesIfNeeded } from '@/lib/layout/endpointChains'
import { generateId } from '@/utils/id'
import { getEndpointTypeFromSymbol } from '@/utils/symbolMapping'
import { getSymbolById } from '@/lib/symbols'

export function checkForkSymbolPlacement(circuit: Circuit, target: DropTarget, symbolId: string): boolean {
  const symbol = getSymbolById(symbolId)
  if (!symbol || !getEndpointTypeFromSymbol(symbol) ||
    ['domotica', 'panel_distribution', 'junction_panel', 'solar_panel', 'battery', 'transformer', 'rectifier', 'inverter', 'dc_dc_converter'].includes(symbolId) ||
    !canEditOneWireForks(circuit) || (!!target.forkAfterEndpointId === !!target.forkBranchId)) return false
  if (target.releaseForkLegsOf) return false
  // Branches holding a converter endpoint stay specialized: no fork leg, tap or series insert.
  if (target.forkAfterEndpointId && isEndpointInOneWireConverterTree(circuit, target.forkAfterEndpointId) ||
    target.forkBranchId && isOneWireConverterBranch(circuit, target.forkBranchId)) return false
  if (target.forkAfterEndpointId) return circuit.endpoints.some((endpoint) => endpoint.id === target.forkAfterEndpointId)
  const branch = circuit.branches?.find((item) => item.id === target.forkBranchId)
  if (target.adoptForksOf && (target.adoptForksOf !== target.insertAfterEndpointId ||
    !circuit.branches?.some((item) => item.forkFrom?.afterEndpointId === target.adoptForksOf))) return false
  // Root branches take explicit fork-row inserts only on either side of a tap.
  return !!branch && !!(branch.forkFrom || branch.keepEmpty || circuit.branches?.some((item) => item.forkFrom &&
    branch.endpointIds.includes(item.forkFrom.afterEndpointId))) &&
    (target.insertAfterEndpointId == null || branch.endpointIds.includes(target.insertAfterEndpointId))
}

export function captureForkPlacementBranches(circuit: Circuit, target: DropTarget): Branch[] | null {
  return target.forkAfterEndpointId || target.forkBranchId
    ? initializeBranchesIfNeeded(circuit).map((branch) => ({ ...branch, endpointIds: [...branch.endpointIds] })) : null
}

/** Called after the existing factory adds the configured symbol and plan
 * occurrence. Keep its defaults and dependent edits; replace only branch order.
 */
export function insertSavedForkEndpoint(branches: Branch[], target: DropTarget, endpointId: string): Branch[] {
  if (target.forkAfterEndpointId) return [...branches, {
    id: generateId(), label: '', endpointIds: [endpointId], forkFrom: { afterEndpointId: target.forkAfterEndpointId },
  }]
  return branches.map((branch) => {
    if (branch.forkFrom && branch.forkFrom.afterEndpointId === target.adoptForksOf) return { ...branch, forkFrom: { afterEndpointId: endpointId } }
    if (branch.id !== target.forkBranchId) return branch
    const index = target.insertAfterEndpointId == null ? 0 : branch.endpointIds.indexOf(target.insertAfterEndpointId) + 1
    return { ...branch, endpointIds: [...branch.endpointIds.slice(0, index), endpointId, ...branch.endpointIds.slice(index)] }
  })
}
