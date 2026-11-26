import type { Placement, TrunkDevice } from '@/types/schema'
import { queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { collectAllGroundTrunkDevices } from '@/lib/eendraad/panelGround'
import { walkPanels } from '@/lib/panel/panelTree'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

/** Projects as stored, or the partial shapes diagnostics receive. */
export type IdentityProject = ProjectWithOptionalV2Electrical & {
  building?: { floors?: readonly { id: string }[] }
  elements?: readonly { id: string }[]
}

/** Entity kinds whose IDs must be unique within a project. */
export type IdentityKind =
  | 'panel'
  | 'protection'
  | 'circuit'
  | 'endpoint'
  | 'branch'
  | 'trunkDevice'
  | 'placement'
  | 'wireRun'
  | 'floor'
  | 'element'

export interface DuplicateIdentity {
  kind: IdentityKind
  id: string
  /** How many separately stored entities carry this ID. */
  count: number
}

/**
 * Counts every stored entity per kind and ID. References (gridView module refs, subCircuitIds,
 * branch endpointIds, frame contents) are not entities and are not counted. Supply devices that
 * the model mirrors between the main supply and the feed topology count once.
 */
function countIdentities(project: IdentityProject): Map<string, DuplicateIdentity> {
  const counts = new Map<string, DuplicateIdentity>()
  const add = (kind: IdentityKind, id: string | undefined) => {
    if (!id) return
    const key = `${kind}:${id}`
    const entry = counts.get(key)
    if (entry) entry.count += 1
    else counts.set(key, { kind, id, count: 1 })
  }
  const addPlacements = (placements: readonly Pick<Placement, 'id'>[] | undefined) =>
    placements?.forEach((placement) => add('placement', placement.id))
  const addDevice = (device: TrunkDevice) => {
    add('trunkDevice', device.id)
    addPlacements(device.placements)
  }

  const panels = getProjectElectricalPanels(project)
  for (const panel of walkPanels(panels)) {
    add('panel', panel.id)
    for (const protection of panel.protections) add('protection', protection.id)
    // Stored circuits, not collectCircuits(): that merges same-ID circuits and would hide copies.
    for (const circuit of [...panel.circuits, ...panel.protections.flatMap((protection) => protection.circuits ?? [])]) {
      add('circuit', circuit.id)
      for (const endpoint of circuit.endpoints) {
        add('endpoint', endpoint.id)
        addPlacements(endpoint.placements)
      }
      for (const branch of circuit.branches ?? []) {
        add('branch', branch.id)
        branch.branchDevices?.forEach(addDevice)
      }
      circuit.trunkDevices?.forEach(addDevice)
    }
  }
  queryAllSupplyTrunkDevices(project).forEach(addDevice)
  const installation = getProjectElectricalInstallation(project)
  collectAllGroundTrunkDevices(panels, installation).forEach(addDevice)
  addPlacements(installation?.earthingPlacements)
  for (const wireRun of project.disciplines?.electrical?.wireRuns ?? []) add('wireRun', wireRun.id)
  for (const floor of project.building?.floors ?? []) add('floor', floor.id)
  for (const element of project.elements ?? []) add('element', element.id)
  return counts
}

export function collectDuplicateIdentities(project: IdentityProject): DuplicateIdentity[] {
  return [...countIdentities(project).values()].filter(({ count }) => count > 1)
}

/**
 * Duplicates an edit created or extended. Existing damage may be repaired or left alone, but an
 * edit may never add a copy of an ID that is already stored.
 */
export function newDuplicateIdentities(before: IdentityProject, after: IdentityProject): DuplicateIdentity[] {
  const duplicates = collectDuplicateIdentities(after)
  if (!duplicates.length) return []
  const previous = countIdentities(before)
  return duplicates.filter(({ kind, id, count }) => count > (previous.get(`${kind}:${id}`)?.count ?? 1))
}
