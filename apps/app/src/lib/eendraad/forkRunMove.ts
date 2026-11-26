import type { Branch, Circuit } from '@/types/schema'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import { collectOneWireEndpointRun, resolveOneWireBranchTopology } from './oneWireBranchTopology'
import { canEditOneWireForks, hasOneWireForks } from './oneWireForkProject'
import { isEndpointInOneWireConverterTree, isOneWireConverterBranch } from './oneWireConverterBranches'
import { initializeBranchesIfNeeded } from '@/lib/layout/endpointChains'
import { syncSequentialEndpointBranchLabelsToCircuit } from './automaticEndpointBranchNaming'
import { canEditOneWireRisers, getMaxStem, getRiserTargetFields, insertRootBranch } from './oneWireRisers'

export function usesForkRunMove(source: Circuit, destination: Circuit | undefined, target: DropTarget): boolean {
  return hasOneWireForks(source) || !!destination && hasOneWireForks(destination) || !!target.forkAfterEndpointId || !!target.forkBranchId ||
    getRiserTargetFields(target).newRiser === true || getRiserTargetFields(target).stem !== undefined
}

function plan(source: Circuit, destination: Circuit | undefined, draggedId: string, selected: readonly string[], target: DropTarget) {
  if (!destination || !canEditOneWireForks(source) || !canEditOneWireForks(destination) || target.domoticaOutput || target.dcBusId || target.converterDcConnection)
    return null
  const riser = getRiserTargetFields(target)
  if ((riser.newRiser || riser.stem !== undefined) && (!canEditOneWireRisers(destination) || riser.newRiser && riser.stem !== undefined ||
    riser.stem !== undefined && (riser.stem < 0 || riser.stem > getMaxStem(destination)) || target.forkAfterEndpointId || target.forkBranchId)) return null
  let branches: Branch[] = initializeBranchesIfNeeded(source)
  if (target.releaseForkLegsOf) {
    // The dragged anchor stays put past its own tap: its legs heal onto the symbol before it.
    if (target.releaseForkLegsOf !== draggedId) return null
    const owner = branches.find((item) => item.endpointIds.includes(draggedId))
    const index = owner?.endpointIds.indexOf(draggedId) ?? -1
    const previous = owner?.endpointIds[index - 1] ?? owner?.forkFrom?.afterEndpointId
    if (!previous || !branches.some((item) => item.forkFrom?.afterEndpointId === draggedId)) return null
    branches = branches.map((item) => item.forkFrom?.afterEndpointId === draggedId ? { ...item, forkFrom: { afterEndpointId: previous } } : item)
  }
  const topology = resolveOneWireBranchTopology({ ...source, branches })
  const run = collectOneWireEndpointRun(topology, draggedId)
  const location = topology.endpointLocations.get(draggedId)
  if (!run || !location) return null
  // Dragging an anchor carries its legs in the selection; a release leaves those legs behind.
  const carried = target.releaseForkLegsOf ? selected.filter((id) => run.endpointIds.includes(id)) : selected
  if (carried.some((id) => !run.endpointIds.includes(id))) return null
  if (carried.length > 1 && carried.length !== run.endpointIds.length) return null
  const targetBranches: Branch[] = source === destination ? branches : initializeBranchesIfNeeded(destination)
  let branch = target.forkBranchId ? targetBranches.find((item) => item.id === target.forkBranchId) : undefined
  if (!target.forkAfterEndpointId && !branch && target.branchInsertIndex === undefined && !riser.newRiser) {
    branch = targetBranches.find((item, index) => item.id === target.branchId || `branch-${destination.id}-${index}` === target.branchId)
      ?? targetBranches.find((item) => target.branchEndpoints?.some((id) => item.endpointIds.includes(id)))
  }
  if (target.forkAfterEndpointId && (!destination.endpoints.some((endpoint) => endpoint.id === target.forkAfterEndpointId) || run.endpointIds.includes(target.forkAfterEndpointId))) return null
  // Branches holding a converter endpoint stay specialized and accept no moved run.
  const targetShape = { endpoints: destination.endpoints, branches: targetBranches }
  if (target.forkAfterEndpointId && isEndpointInOneWireConverterTree(targetShape, target.forkAfterEndpointId) ||
    branch && isOneWireConverterBranch(targetShape, branch.id)) return null
  if (branch && (run.branchIds.slice(1).includes(branch.id) || target.insertAfterEndpointId && run.endpointIds.includes(target.insertAfterEndpointId))) return null
  if (branch && target.insertAfterEndpointId && !branch.endpointIds.includes(target.insertAfterEndpointId)) return null
  if (target.adoptForksOf && (!branch || target.adoptForksOf !== target.insertAfterEndpointId ||
    !targetBranches.some((item) => item.forkFrom?.afterEndpointId === target.adoptForksOf))) return null
  if (!target.forkAfterEndpointId && !branch && target.type !== 'circuit') return null
  const sourceBranch = branches.find((item) => item.id === location.branchId)!
  const noOp = source === destination && branch?.id === sourceBranch.id && !target.adoptForksOf && !target.releaseForkLegsOf &&
    (target.insertAfterEndpointId ?? null) === (sourceBranch.endpointIds[location.index - 1] ?? null)
  return { branches, targetBranches, run, location, sourceBranch, branch, noOp }
}

export function checkForkRunMove(source: Circuit, destination: Circuit | undefined, draggedId: string, selected: readonly string[], target: DropTarget) {
  const prepared = plan(source, destination, draggedId, selected, target)
  // `noOp`: the run would land where it already is, so a canvas slot for it is noise.
  return prepared
    ? { ok: true as const, noOp: prepared.noOp } : { ok: false as const, code: 'invalid_fork_move', message: 'This destination cannot preserve the moved run and its descendants' }
}

export function moveSavedForkRun(source: Circuit, destination: Circuit, draggedId: string, selected: readonly string[], target: DropTarget, newId: () => string): string[] {
  const prepared = plan(source, destination, draggedId, selected, target)
  if (!prepared) throw new Error('Invalid fork move')
  if (prepared.noOp) return []
  const { location, run } = prepared
  const moving = new Set(run.endpointIds)
  const descendantIds = new Set(run.branchIds.slice(1))
  const branches = prepared.branches.map((branch) => ({ ...branch, endpointIds: [...branch.endpointIds] }))
  const sourceBranch = branches.find((item) => item.id === location.branchId)!
  const tail = sourceBranch.endpointIds.splice(location.index)
  const descendants = branches.filter((branch) => descendantIds.has(branch.id))
  let remaining = branches.filter((branch) => !descendantIds.has(branch.id) && (branch !== sourceBranch || branch.endpointIds.length > 0))
  const targetBranches = source === destination ? remaining : prepared.targetBranches.map((branch) => ({ ...branch, endpointIds: [...branch.endpointIds] }))
  if (target.forkAfterEndpointId) targetBranches.push({ id: newId(), label: '', endpointIds: tail, forkFrom: { afterEndpointId: target.forkAfterEndpointId } })
  else if (prepared.branch) {
    let targetBranch = targetBranches.find((branch) => branch.id === prepared.branch!.id)
    if (!targetBranch && prepared.branch.id === sourceBranch.id) { targetBranch = sourceBranch; targetBranches.push(targetBranch) }
    if (!targetBranch) throw new Error('Move destination disappeared')
    const index = target.insertAfterEndpointId == null ? 0 : targetBranch.endpointIds.indexOf(target.insertAfterEndpointId) + 1
    targetBranch.endpointIds.splice(index, 0, ...tail)
    if (target.adoptForksOf) for (const leg of targetBranches)
      if (leg.forkFrom?.afterEndpointId === target.adoptForksOf) leg.forkFrom = { afterEndpointId: tail.at(-1)! }
  } else {
    targetBranches.splice(0, targetBranches.length, ...insertRootBranch(targetBranches, { id: newId(), label: '', endpointIds: tail },
      Math.min(target.branchInsertIndex ?? targetBranches.length, targetBranches.length), getRiserTargetFields(target)))
  }
  targetBranches.push(...descendants)
  if (source === destination) remaining = targetBranches
  else {
    const records = source.endpoints.filter((endpoint) => moving.has(endpoint.id))
    source.endpoints = source.endpoints.filter((endpoint) => !moving.has(endpoint.id))
    destination.endpoints.push(...records)
    destination.branches = targetBranches
    syncSequentialEndpointBranchLabelsToCircuit(destination)
  }
  source.branches = remaining
  syncSequentialEndpointBranchLabelsToCircuit(source)
  return run.endpointIds
}
