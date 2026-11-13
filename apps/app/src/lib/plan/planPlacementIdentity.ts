import type { TrunkDevice } from '@/types/schema'
import { queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { collectAllGroundTrunkDevices } from '@/lib/eendraad/panelGround'
import { collectCircuits, walkPanels } from '@/lib/panel/panelTree'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

export type PlanPlacementOwner = { kind: 'endpoint' | 'trunkDevice'; id: string; label: string }
export type PlanPlacementIdentityConflict = { placementId: string; owners: PlanPlacementOwner[] }

/** Read-only inventory shared by diagnostics and the command transaction guard. */
export function collectPlanPlacementIdentityConflicts(
  project: ProjectWithOptionalV2Electrical
): PlanPlacementIdentityConflict[] {
  const ownersById = new Map<string, PlanPlacementOwner[]>()
  const add = (placementId: string, owner: PlanPlacementOwner) => {
    const owners = ownersById.get(placementId) ?? []
    owners.push(owner)
    ownersById.set(placementId, owners)
  }
  const addDevice = (device: TrunkDevice) => {
    for (const placement of device.placements ?? [])
      add(placement.id, { kind: 'trunkDevice', id: device.id, label: device.label || device.id })
  }
  const panels = getProjectElectricalPanels(project)
  for (const panel of walkPanels(panels)) {
    for (const circuit of collectCircuits(panel)) {
      for (const endpoint of circuit.endpoints) {
        for (const placement of endpoint.placements)
          add(placement.id, {
            kind: 'endpoint',
            id: endpoint.id,
            label: endpoint.label || endpoint.id,
          })
      }
      for (const device of circuit.trunkDevices ?? []) addDevice(device)
      for (const branch of circuit.branches ?? [])
        for (const device of branch.branchDevices ?? []) addDevice(device)
    }
  }
  for (const device of queryAllSupplyTrunkDevices(project)) addDevice(device)
  for (const device of collectAllGroundTrunkDevices(
    panels,
    getProjectElectricalInstallation(project)
  ))
    addDevice(device)
  return [...ownersById]
    .filter(([, owners]) => owners.length > 1)
    .map(([placementId, owners]) => ({ placementId, owners }))
}

/** Existing damage may be repaired or left alone, but never extended or reassigned. */
export function newlyConflictingPlanPlacementId(
  before: ProjectWithOptionalV2Electrical,
  after: ProjectWithOptionalV2Electrical
): string | undefined {
  if (before.disciplines?.electrical === after.disciplines?.electrical) return undefined
  const conflicts = collectPlanPlacementIdentityConflicts(after)
  if (!conflicts.length) return undefined
  const previous = new Map(
    collectPlanPlacementIdentityConflicts(before).map((conflict) => [
      conflict.placementId,
      conflict.owners,
    ])
  )
  for (const conflict of conflicts) {
    const remaining = [...(previous.get(conflict.placementId) ?? [])]
    for (const owner of conflict.owners) {
      const index = remaining.findIndex(
        (candidate) => candidate.kind === owner.kind && candidate.id === owner.id
      )
      if (index < 0) return conflict.placementId
      remaining.splice(index, 1)
    }
  }
  return undefined
}
