import type { Branch, Circuit, TrunkDevice } from '@/types/schema'

/**
 * Circuit reference shown beside a junction box on the situation plan.
 * A trunk box before the first branch belongs to the circuit; one after a
 * branch carries that branch's reference, matching the nearby socket label.
 */
export function getJunctionBoxPlanLabel(
  circuit: Circuit,
  device: TrunkDevice
): string | undefined {
  if (device.symbol !== 'junction_box') return undefined

  const branchDeviceOwner = circuit.branches?.find((branch) =>
    branch.branchDevices?.some((branchDevice) => branchDevice.id === device.id)
  )
  const endpointLabelById = new Map(
    circuit.endpoints.map((endpoint) => [endpoint.id, endpoint.label.trim()])
  )
  const labelForBranch = (branch: Branch | undefined) =>
    branch?.label.trim() ||
    branch?.endpointIds.map((endpointId) => endpointLabelById.get(endpointId) ?? '').find(Boolean) ||
    ''
  const rootBranches = (circuit.branches ?? []).filter((branch) => !branch.forkFrom)
  const endpointLabels = [...new Set(endpointLabelById.values())].filter(Boolean)
  const position = Number.isFinite(device.trunkPosition)
    ? Math.max(0, Math.floor(device.trunkPosition))
    : 0
  const precedingBranch = position > 0 ? rootBranches[position - 1] : undefined
  const precedingBranchLabel =
    labelForBranch(precedingBranch) ||
    (position > 0 && rootBranches.length === 0 ? endpointLabels[position - 1] : '')
  const circuitLabel =
    labelForBranch(branchDeviceOwner) ||
    precedingBranchLabel ||
    (circuit.code === 'PANEL' ? '' : circuit.code.trim())
  const boxLabel = device.label.trim() || device.junctionIdentity?.trim() || ''

  if (!circuitLabel) return boxLabel || undefined
  if (!boxLabel || boxLabel === circuitLabel) return circuitLabel
  return `${circuitLabel}\n${boxLabel}`
}
