import type { DropTarget } from '@/lib/layout/findDropTarget'
import type { Branch, Circuit, Endpoint } from '@/types/schema'
import { generateId } from '@/utils'
import { circuitContainsJunctionPanelIdentity, getJunctionIdentity } from '@/lib/junctionIdentity'

export interface MoveEndpointSelectionResult {
  endpoints: Endpoint[]
  branches: Branch[]
  movedEndpointIds: string[]
}

export interface MoveEndpointSelectionBetweenCircuitsResult {
  source: MoveEndpointSelectionResult
  target: MoveEndpointSelectionResult
}

function parseBranchIndex(branchId: string | undefined, circuitId: string): number | null {
  if (!branchId) return null
  const prefix = `branch-${circuitId}-`
  if (!branchId.startsWith(prefix)) return null
  const raw = branchId.slice(prefix.length)
  const index = Number.parseInt(raw, 10)
  return Number.isFinite(index) ? index : null
}

function resolveTargetBranchIndex(circuit: Circuit, target: DropTarget): number | null {
  const branches = circuit.branches ?? []
  if (target.circuitId !== circuit.id) return null

  if (typeof target.branchInsertIndex === 'number') {
    return Math.max(0, Math.min(target.branchInsertIndex, branches.length))
  }

  // A DC rail's insertion index is relative to the rail branches, not to all
  // branches in the circuit. Convert that slot to the absolute branch index
  // used by the reorder algorithm. Without this conversion, selection moves
  // lose the rail target and the generic append path wins.
  if (target.dcBusId && typeof target.secondaryBusInsertIndex === 'number') {
    const dcBusBranchIndexes = branches.flatMap((branch, index) =>
      branch.dcBusId === target.dcBusId ? [index] : []
    )
    const requestedIndex = Math.max(
      0,
      Math.min(target.secondaryBusInsertIndex, dcBusBranchIndexes.length)
    )
    return requestedIndex < dcBusBranchIndexes.length
      ? dcBusBranchIndexes[requestedIndex]!
      : (dcBusBranchIndexes.at(-1) ?? branches.length - 1) + 1
  }

  // A circuit-area drop is also a valid destination for an empty circuit. The
  // moved selection becomes its first branch; endpoint/branch hit targets still
  // require an existing branch to resolve against.
  if (branches.length === 0) return target.type === 'circuit' ? 0 : null

  const parsed = parseBranchIndex(target.branchId, circuit.id)
  if (parsed !== null) return Math.max(0, Math.min(parsed, branches.length))

  if (target.branchEndpoints !== undefined) {
    if (target.branchEndpoints.length === 0) return 0
    const targetIds = new Set(target.branchEndpoints)
    const index = branches.findIndex((branch) =>
      branch.endpointIds.some((endpointId) => targetIds.has(endpointId))
    )
    return index >= 0 ? index : null
  }

  if (target.endpointId) {
    const index = branches.findIndex((branch) => branch.endpointIds.includes(target.endpointId!))
    return index >= 0 ? index : null
  }

  if (target.type === 'circuit') return branches.length
  return null
}

function endpointsInBranchOrder(circuit: Circuit, branches: Branch[]): Endpoint[] {
  const byId = new Map(circuit.endpoints.map((endpoint) => [endpoint.id, endpoint]))
  const used = new Set<string>()
  const ordered: Endpoint[] = []

  for (const branch of branches) {
    for (const endpointId of branch.endpointIds) {
      const endpoint = byId.get(endpointId)
      if (!endpoint || used.has(endpointId)) continue
      ordered.push(endpoint)
      used.add(endpointId)
    }
  }

  for (const endpoint of circuit.endpoints) {
    if (!used.has(endpoint.id)) ordered.push(endpoint)
  }

  return ordered
}

function applyConverterDcMoveTarget(
  endpoints: Endpoint[],
  movedEndpointIds: Set<string>,
  target: DropTarget
): Endpoint[] {
  return endpoints.map((endpoint) => {
    if (!movedEndpointIds.has(endpoint.id)) return endpoint
    if (target.converterDcConnection) {
      return { ...endpoint, converterDcConnection: { ...target.converterDcConnection } }
    }
    if (!endpoint.converterDcConnection) return endpoint
    const { converterDcConnection: _removed, ...ordinaryEndpoint } = endpoint
    return ordinaryEndpoint
  })
}

function movingBranchGroupsForSelection(
  circuit: Circuit,
  draggedEndpointId: string,
  selectedEndpointIds: string[],
  allowSingle = false
): { movingBranches: Branch[]; movedEndpointIds: string[]; movedEndpoints: Endpoint[] } | null {
  const branches = circuit.branches ?? []
  const circuitEndpointIds = new Set(circuit.endpoints.map((endpoint) => endpoint.id))
  const selected = new Set(selectedEndpointIds.filter((id) => circuitEndpointIds.has(id)))
  if (
    !selected.has(draggedEndpointId) ||
    selected.size === 0 ||
    (!allowSingle && selected.size <= 1)
  ) {
    return null
  }

  const movingBranchEntries = branches
    .map((branch) => ({
      branch,
      selectedEndpointIds: branch.endpointIds.filter((endpointId) => selected.has(endpointId)),
    }))
    .filter(({ selectedEndpointIds }) => selectedEndpointIds.length > 0)

  if (
    movingBranchEntries.length === 0 ||
    !movingBranchEntries.some(({ selectedEndpointIds }) =>
      selectedEndpointIds.includes(draggedEndpointId)
    )
  ) {
    return null
  }

  const byId = new Map(circuit.endpoints.map((endpoint) => [endpoint.id, endpoint]))
  const movingBranches = movingBranchEntries.map(({ branch, selectedEndpointIds }) => ({
    ...branch,
    id: selectedEndpointIds.length === branch.endpointIds.length ? branch.id : generateId(),
    endpointIds: [...selectedEndpointIds],
  }))
  const movedEndpointIds = movingBranches.flatMap((branch) => branch.endpointIds)
  const movedEndpoints = movedEndpointIds
    .map((id) => byId.get(id))
    .filter((endpoint): endpoint is Endpoint => !!endpoint)

  return { movingBranches, movedEndpointIds, movedEndpoints }
}

/**
 * Move selected endpoint branch groups within one circuit.
 *
 * The canvas still falls back to the existing single-endpoint move for partial
 * selections and domotica slot moves. Complete domotica parent groups use this
 * path for ordinary moves so their children remain attached.
 */
export function moveEndpointSelectionOnCircuit(
  circuit: Circuit,
  draggedEndpointId: string,
  selectedEndpointIds: string[],
  target: DropTarget,
  options?: { allowSingle?: boolean }
): MoveEndpointSelectionResult | null {
  const branches = circuit.branches ?? []
  if (target.circuitId !== circuit.id || branches.length === 0) return null

  const moving = movingBranchGroupsForSelection(
    circuit,
    draggedEndpointId,
    selectedEndpointIds,
    options?.allowSingle
  )
  if (!moving) return null
  const selected = new Set(moving.movedEndpointIds)

  const targetIndex = resolveTargetBranchIndex(circuit, target)
  if (targetIndex === null) return null

  const selectedBranchIndexes = new Set(
    branches
      .map((branch, index) => ({ branch, index }))
      .filter(({ branch }) => branch.endpointIds.some((endpointId) => selected.has(endpointId)))
      .map(({ index }) => index)
  )
  // A branch hit on a moved branch is a no-op. An explicit trunk slot is a gap between
  // branches instead; slots adjacent to the moved branches fall out as unchanged below.
  if (typeof target.branchInsertIndex !== 'number' && selectedBranchIndexes.has(targetIndex)) {
    return null
  }

  const remainingEntries = branches
    .map((branch, index) => ({
      branch: {
        ...branch,
        endpointIds: branch.endpointIds.filter((endpointId) => !selected.has(endpointId)),
      },
      originalIndex: index,
    }))
    .filter(({ branch }) => branch.endpointIds.length > 0)

  const insertIndex = remainingEntries.findIndex(
    ({ originalIndex }) => originalIndex >= targetIndex
  )
  const safeInsertIndex = insertIndex >= 0 ? insertIndex : remainingEntries.length
  const remainingBranches = remainingEntries.map(({ branch }) => branch)
  const movingBranches = moving.movingBranches.map((branch) => {
    const { dcBusId: _sourceDcBusId, ...withoutSourceDcBus } = branch
    return {
      ...withoutSourceDcBus,
      ...(target.dcBusId ? { dcBusId: target.dcBusId } : {}),
    }
  })

  const nextBranches = [
    ...remainingBranches.slice(0, safeInsertIndex),
    ...movingBranches,
    ...remainingBranches.slice(safeInsertIndex),
  ]

  const unchanged =
    nextBranches.length === branches.length &&
    nextBranches.every((branch, index) => branch.id === branches[index]?.id)
  if (unchanged) return null

  return {
    branches: nextBranches,
    endpoints: applyConverterDcMoveTarget(
      endpointsInBranchOrder(circuit, nextBranches),
      selected,
      target
    ),
    movedEndpointIds: moving.movedEndpointIds,
  }
}

export function moveEndpointSelectionBetweenCircuits(
  sourceCircuit: Circuit,
  targetCircuit: Circuit,
  draggedEndpointId: string,
  selectedEndpointIds: string[],
  target: DropTarget,
  options?: { allowSingle?: boolean }
): MoveEndpointSelectionBetweenCircuitsResult | null {
  if (sourceCircuit.id === targetCircuit.id || target.circuitId !== targetCircuit.id) return null
  const moving = movingBranchGroupsForSelection(
    sourceCircuit,
    draggedEndpointId,
    selectedEndpointIds,
    options?.allowSingle
  )
  if (!moving) return null
  if (moving.movedEndpoints.some((endpoint) =>
    endpoint.symbol === 'junction_panel' &&
    circuitContainsJunctionPanelIdentity(targetCircuit, getJunctionIdentity(endpoint))
  )) return null

  const selected = new Set(moving.movedEndpointIds)
  const sourceBranches = (sourceCircuit.branches ?? [])
    .map((branch) => ({
      ...branch,
      endpointIds: branch.endpointIds.filter((endpointId) => !selected.has(endpointId)),
    }))
    .filter((branch) => branch.endpointIds.length > 0)
  const sourceEndpoints = sourceCircuit.endpoints.filter((endpoint) => !selected.has(endpoint.id))

  const targetBranches = targetCircuit.branches ?? []
  const targetIndex = resolveTargetBranchIndex(targetCircuit, target)
  if (targetIndex === null) return null
  const insertIndex = Math.max(0, Math.min(targetIndex, targetBranches.length))

  const movingTargetBranches = moving.movingBranches.map((branch) => ({
    ...(() => {
      const { dcBusId: _sourceDcBusId, ...withoutSourceDcBus } = branch
      return withoutSourceDcBus
    })(),
    id: generateId(),
    label: '',
    ...(target.dcBusId ? { dcBusId: target.dcBusId } : {}),
  }))
  const nextTargetBranches = [
    ...targetBranches
      .slice(0, insertIndex)
      .map((branch) => ({ ...branch, endpointIds: [...branch.endpointIds] })),
    ...movingTargetBranches,
    ...targetBranches
      .slice(insertIndex)
      .map((branch) => ({ ...branch, endpointIds: [...branch.endpointIds] })),
  ]
  const nextTargetEndpoints = applyConverterDcMoveTarget(
    endpointsInBranchOrder(
      { ...targetCircuit, endpoints: [...targetCircuit.endpoints, ...moving.movedEndpoints] },
      nextTargetBranches
    ),
    selected,
    target
  )

  return {
    source: {
      branches: sourceBranches,
      endpoints: sourceEndpoints,
      movedEndpointIds: moving.movedEndpointIds,
    },
    target: {
      branches: nextTargetBranches,
      endpoints: nextTargetEndpoints,
      movedEndpointIds: moving.movedEndpointIds,
    },
  }
}
