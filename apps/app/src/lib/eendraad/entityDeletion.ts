import { produce } from 'immer'
import type { ProjectV2 } from '@/types/projectV2'
import type { PanelGridModuleRef } from '@/types/schema'
import type { EntityRef } from '@/lib/commands/project/types'
import { withIdSource } from '@/utils/id'
import { withProjectMutationTime } from '@/lib/projectMutations/mutationTime'
import { deleteProtectionInProject } from '@/lib/projectMutations/storeActions'
import { deleteEndpointsFromProject } from './endpointDeletion'
import { deleteCircuitFromProject } from './circuitMutations'
import { downgradeMeterBreakerToDirectTrunkFeeder } from './directTrunkFeeder'
import {
  deleteGroundTrunkDeviceInProject,
  deleteSupplyTrunkDeviceInProject,
  deleteTrunkDeviceInProject,
} from './deviceDeletion'
import {
  deletePanelFromProject,
  getAllCircuits,
  cleanupPanelGridSlotsForDevice,
  pruneStaleElectricalEndpointRecords,
} from './projectElectricalDomain'
import { collectAllGroundTrunkDevices, installationHasAnyEarthing } from './panelGround'
import { queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { pruneOrphanJunctionPanelPlacements } from '@/lib/plan/sharedJunctionPlacements'
import { walkPanels } from '@/lib/panel/panelTree'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import {
  queryOneWireFrames,
  queryOneWireNotes,
  querySitplanNotes,
  replaceOneWireFrames,
  replaceOneWireNotes,
  replaceSitplanNotes,
} from '@/lib/projectV2/annotations'
import { selectProjectBuildingFloors, selectProjectFloorPlan } from '@/lib/projectV2/buildingFloors'
import {
  deleteBuildingEntitiesInProject,
  type BuildingDeleteKind,
} from '@/lib/plan/buildingDeletion'
import {
  deletePlacementsFromProject,
  resolvePlanPlacementDeletion,
  type PlanPlacementDeletion,
} from '@/lib/plan/placementMutations'
import { healPlanWiring } from '@/lib/plan/planWiring'
import { pruneEendraadFrames } from './frameContent'
import { persistAutomaticPanelSlotsInProject } from '@/lib/panel/panelAutomaticSlots'
import { collectDomainEvents } from '@/lib/domainEvents'
import { removeEmptySupplyTapsPanels } from '@/lib/supplyTaps/pruneSupplyTaps'

export type DeleteEntityRef =
  | { kind: 'placement'; id: string; retainOwner?: boolean }
  | {
      kind:
        | 'endpoint'
        | 'protection'
        | 'circuit'
        | 'trunkDevice'
        | 'panel'
        | 'frame'
        | BuildingDeleteKind
      id: string
    }
  | { kind: 'note'; id: string; scope?: 'oneWire' | 'sitplan' }
  | { kind: 'ground'; id: string; scope: 'all' | 'installation' | 'panel' }
export type EntityDeletionInput = { refs: DeleteEntityRef[]; preserveLinkedPanels?: boolean }
export type EntityDeletionPreview = PlanPlacementDeletion & {
  created: EntityRef[]
  removed: EntityRef[]
  changed: EntityRef[]
}
type InventoryEntry = { ref: EntityRef; value: unknown }

/** Read-only inventory for target validation and accurate dependent-removal metadata. */
export function deletionInventory(project: ProjectV2): Map<string, InventoryEntry> {
  const entries = new Map<string, InventoryEntry>()
  const add = (kind: EntityRef['kind'], value: { id: string }) =>
    entries.set(`${kind}:${value.id}`, { ref: { kind, id: value.id }, value })
  const device = (value: { id: string; placements?: { id: string }[] }) => {
    add('trunkDevice', value)
    value.placements?.forEach((placement) => add('placement', placement))
  }
  const installation = getProjectElectricalInstallation(project)
  if (installation && installation.hasGround !== false) add('ground', { id: 'installation' })
  if (installation)
    entries.set('installation:installation', {
      ref: { kind: 'installation', id: 'installation' },
      value: installation,
    })
  for (const panel of walkPanels(getProjectElectricalPanels(project))) {
    add('panel', panel)
    if (panel.isMain === false && panel.hasGround === true) add('ground', { id: panel.id })
    panel.protections.forEach((protection) => add('protection', protection))
    for (const circuit of getAllCircuits(panel)) {
      add('circuit', circuit)
      circuit.endpoints.forEach((endpoint) => {
        add('endpoint', endpoint)
        endpoint.placements.forEach((placement) => add('placement', placement))
      })
      circuit.trunkDevices?.forEach(device)
      circuit.branches?.forEach((branch) => branch.branchDevices?.forEach(device))
    }
  }
  queryAllSupplyTrunkDevices(project).forEach(device)
  collectAllGroundTrunkDevices(getProjectElectricalPanels(project), installation).forEach(device)
  installation?.earthingPlacements?.forEach((placement) => add('placement', placement))
  installation?.junctionPanelPlacements?.forEach((placement) => add('placement', placement))
  project.disciplines.electrical?.auxiliaryEnclosures?.forEach((enclosure) =>
    enclosure.placements?.forEach((placement) => add('placement', placement))
  )
  queryOneWireNotes(project).forEach((note) =>
    entries.set(`note:oneWire:${note.id}`, { ref: { kind: 'note', id: note.id }, value: note })
  )
  querySitplanNotes(project).forEach((note) =>
    entries.set(`note:sitplan:${note.id}`, { ref: { kind: 'note', id: note.id }, value: note })
  )
  queryOneWireFrames(project).forEach((frame) => add('frame', frame))
  for (const floor of selectProjectBuildingFloors(project)) {
    const plan = selectProjectFloorPlan(project, floor.id)
    plan?.walls.forEach((entity) => add('wall', entity))
    plan?.doors.forEach((entity) => add('door', entity))
    plan?.windows.forEach((entity) => add('window', entity))
    plan?.stairs?.forEach((entity) => add('stair', entity))
    plan?.graphicElements?.forEach((entity) => add('graphicElement', entity))
  }
  return entries
}

export function deleteEarthingInProject(
  project: ProjectV2,
  scope: 'all' | 'installation' | 'panel',
  panelId?: string
): void {
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return
  const panels = getProjectElectricalPanels(project)
  const removedDeviceIds: string[] = []
  if (scope !== 'panel') installation.hasGround = false
  for (const panel of walkPanels(panels)) {
    if (panel.isMain !== false || (scope !== 'all' && !(scope === 'panel' && panel.id === panelId)))
      continue
    panel.hasGround = false
    for (const device of panel.groundTrunkDevices ?? []) {
      removedDeviceIds.push(device.id)
      cleanupPanelGridSlotsForDevice(panels, {
        kind: 'trunkDevice',
        id: device.id,
        scope: 'ground',
      })
    }
    if ((panel.groundTrunkDevices?.length ?? 0) > 0) panel.groundTrunkDevices = []
  }
  if (
    !installationHasAnyEarthing(panels, installation) &&
    (installation.earthingPlacements?.length ?? 0) > 0
  )
    installation.earthingPlacements = []
  if (removedDeviceIds.length) pruneEendraadFrames(project, { removedMemberIds: removedDeviceIds })
}

/** Runs established deletion/cascade rules on one draft, including layout follow-ups. */
export function deleteEntitiesInProject(project: ProjectV2, input: EntityDeletionInput): void {
  const oldModuleRefs: PanelGridModuleRef[] = []
  for (const panel of walkPanels(getProjectElectricalPanels(project))) {
    for (const protection of panel.protections)
      oldModuleRefs.push({ kind: 'protection', id: protection.id })
    for (const circuit of getAllCircuits(panel)) {
      for (const endpoint of circuit.endpoints)
        oldModuleRefs.push({ kind: 'domotica', endpointId: endpoint.id, circuitId: circuit.id })
      for (const device of [
        ...(circuit.trunkDevices ?? []),
        ...(circuit.branches ?? []).flatMap((branch) => branch.branchDevices ?? []),
      ])
        oldModuleRefs.push({
          kind: 'trunkDevice',
          id: device.id,
          scope: 'circuit',
          circuitId: circuit.id,
        })
    }
    for (const slot of [
      ...(panel.gridView?.slots ?? []),
      ...(panel.gridView?.supplyPanelSlots ?? []),
    ])
      oldModuleRefs.push({ ...slot.module })
  }
  for (const device of queryAllSupplyTrunkDevices(project))
    oldModuleRefs.push({ kind: 'trunkDevice', id: device.id, scope: 'supply' })
  for (const device of collectAllGroundTrunkDevices(
    getProjectElectricalPanels(project),
    getProjectElectricalInstallation(project)
  ))
    oldModuleRefs.push({ kind: 'trunkDevice', id: device.id, scope: 'ground' })
  const placements = resolvePlanPlacementDeletion(
    project,
    input.refs.filter((ref) => ref.kind === 'placement' && !ref.retainOwner).map((ref) => ref.id)
  )
  const retainedPlacements = input.refs
    .filter((ref) => ref.kind === 'placement' && ref.retainOwner)
    .map((ref) => ref.id)
  if (retainedPlacements.length) deletePlacementsFromProject(project, retainedPlacements)
  if (placements.placementIds.length) deletePlacementsFromProject(project, placements.placementIds)
  const endpoints = [
    ...placements.endpointIds,
    ...input.refs.filter((ref) => ref.kind === 'endpoint').map((ref) => ref.id),
  ]
  if (endpoints.length) deleteEndpointsFromProject(project, endpoints)
  for (const ref of input.refs) {
    if (ref.kind !== 'trunkDevice') continue
    if (queryAllSupplyTrunkDevices(project).some((device) => device.id === ref.id)) {
      deleteSupplyTrunkDeviceInProject(project, ref.id)
      continue
    }
    if (
      collectAllGroundTrunkDevices(
        getProjectElectricalPanels(project),
        getProjectElectricalInstallation(project)
      ).some((device) => device.id === ref.id)
    ) {
      deleteGroundTrunkDeviceInProject(project, ref.id)
      continue
    }
    for (const panel of getProjectElectricalPanels(project)) {
      const circuit = getAllCircuits(panel).find(
        (candidate) =>
          candidate.trunkDevices?.some((device) => device.id === ref.id) ||
          candidate.branches?.some((branch) =>
            branch.branchDevices?.some((device) => device.id === ref.id)
          )
      )
      if (!circuit) continue
      const trunk = circuit.trunkDevices?.find((device) => device.id === ref.id)
      if (trunk?.symbol === 'rectifier') {
        const dcEndpoints = circuit.endpoints
          .filter((endpoint) => endpoint.symbol === 'solar_panel' || endpoint.symbol === 'battery')
          .map((endpoint) => endpoint.id)
        if (dcEndpoints.length) deleteEndpointsFromProject(project, dcEndpoints)
      }
      deleteTrunkDeviceInProject(project, circuit.id, ref.id)
      break
    }
  }
  for (const ref of input.refs) {
    if (ref.kind === 'protection') {
      // The breaker in front of a meter that feeds a secondary bus leaves the meter on the busbar.
      if (downgradeMeterBreakerToDirectTrunkFeeder(getProjectElectricalPanels(project), ref.id))
        cleanupPanelGridSlotsForDevice(getProjectElectricalPanels(project), { kind: 'protection', id: ref.id })
      else deleteProtectionInProject(project, ref.id, { preserveLinkedPanels: input.preserveLinkedPanels })
    }
    else if (ref.kind === 'circuit') deleteCircuitFromProject(project, ref.id)
    else if (ref.kind === 'panel') deletePanelFromProject(project, ref.id)
    else if (ref.kind === 'note') {
      if (ref.scope !== 'sitplan' && queryOneWireNotes(project).some((note) => note.id === ref.id))
        replaceOneWireNotes(
          project,
          queryOneWireNotes(project).filter((note) => note.id !== ref.id)
        )
      if (ref.scope !== 'oneWire' && querySitplanNotes(project).some((note) => note.id === ref.id))
        replaceSitplanNotes(
          project,
          querySitplanNotes(project).filter((note) => note.id !== ref.id)
        )
    } else if (
      ref.kind === 'frame' &&
      queryOneWireFrames(project).some((frame) => frame.id === ref.id)
    )
      replaceOneWireFrames(
        project,
        queryOneWireFrames(project).filter((frame) => frame.id !== ref.id)
      )
    else if (ref.kind === 'ground')
      deleteEarthingInProject(project, ref.scope, ref.scope === 'panel' ? ref.id : undefined)
    else if (
      ref.kind === 'wall' ||
      ref.kind === 'door' ||
      ref.kind === 'window' ||
      ref.kind === 'stair' ||
      ref.kind === 'graphicElement'
    )
      deleteBuildingEntitiesInProject(project, ref.kind, [ref.id])
  }
  // A directly wired kWh meter's hidden owner leaves with its meter; what followed it returns to the bus.
  const emptyMeterOwners = [...walkPanels(getProjectElectricalPanels(project))].flatMap((panel) =>
    panel.protections.filter((protection) => protection.directTrunkFeeder &&
      (protection.circuits ?? []).every((circuit) => !circuit.trunkDevices?.length && !circuit.endpoints.length)))
  for (const owner of emptyMeterOwners) deleteProtectionInProject(project, owner.id)
  pruneStaleElectricalEndpointRecords(project)
  removeEmptySupplyTapsPanels(project)
  pruneOrphanJunctionPanelPlacements(project)
  healPlanWiring(project)
  const surviving = deletionInventory(project)
  for (const ref of oldModuleRefs) {
    const key = ref.kind === 'domotica' ? `endpoint:${ref.endpointId}` : `${ref.kind}:${ref.id}`
    if (!surviving.has(key))
      cleanupPanelGridSlotsForDevice(getProjectElectricalPanels(project), ref)
  }
  for (const panel of walkPanels(getProjectElectricalPanels(project)))
    persistAutomaticPanelSlotsInProject(project, panel.id)
}

export function entityDeletionChanges(
  before: ProjectV2,
  after: ProjectV2
): { created: EntityRef[]; removed: EntityRef[]; changed: EntityRef[] } {
  const original = deletionInventory(before),
    next = deletionInventory(after)
  const removed: EntityRef[] = [],
    changed: EntityRef[] = [],
    created: EntityRef[] = []
  for (const [key, entry] of original) {
    const surviving = next.get(key)
    if (!surviving) removed.push(entry.ref)
    else if (JSON.stringify(entry.value) !== JSON.stringify(surviving.value))
      changed.push(entry.ref)
  }
  for (const [key, entry] of next) if (!original.has(key)) created.push(entry.ref)
  return { created, removed, changed }
}

/** Preview uses an isolated Immer draft and synthetic IDs, leaving canonical data untouched. */
export function previewEntityDeletion(
  project: ProjectV2,
  input: EntityDeletionInput
): EntityDeletionPreview {
  let sequence = 0
  const next = collectDomainEvents(() =>
    withIdSource(
      () => `deletion-preview-${sequence++}`,
      () =>
        withProjectMutationTime(
          () => '2000-01-01T00:00:00.000Z',
          () => produce(project, (draft) => deleteEntitiesInProject(draft as ProjectV2, input))
        )
    )
  ).result
  const placementDeletion = resolvePlanPlacementDeletion(
    project,
    input.refs.filter((ref) => ref.kind === 'placement' && !ref.retainOwner).map((ref) => ref.id)
  )
  placementDeletion.placementIds.push(
    ...input.refs
      .filter((ref) => ref.kind === 'placement' && ref.retainOwner)
      .map((ref) => ref.id)
      .filter((id) => !deletionInventory(next).has(`placement:${id}`))
  )
  return { ...placementDeletion, ...entityDeletionChanges(project, next) }
}
