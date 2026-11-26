import type { Branch } from '@/types/schema'

/** Inserts an endpoint into one branch and removes provisional membership elsewhere. */
export function insertEndpointIntoBranch(
  branches: Branch[],
  branchId: string,
  endpointId: string,
  insertAfterEndpointId?: string | null
): Branch[] {
  const targetBranch = branches.find((branch) => branch.id === branchId)
  if (!targetBranch) return branches

  return branches.map((branch) => {
    const endpointIds = branch.endpointIds.filter((id) => id !== endpointId)
    if (branch.id === branchId) {
      const anchorIndex =
        typeof insertAfterEndpointId === 'string' ? endpointIds.indexOf(insertAfterEndpointId) : -1
      const insertIndex =
        typeof insertAfterEndpointId !== 'string'
          ? 0
          : anchorIndex >= 0
            ? anchorIndex + 1
            : endpointIds.length
      endpointIds.splice(insertIndex, 0, endpointId)
      return { ...branch, endpointIds }
    }
    return endpointIds.length === branch.endpointIds.length ? branch : { ...branch, endpointIds }
  })
}
