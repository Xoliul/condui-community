import { buildElectricalStructureSnapshot } from '@/lib/electricalStructure/builder'
import type { ProjectV2, WireRun } from '@/types/projectV2'
import type { CableSpec } from '@/types/schema'
import { editProjectWireRuns, findWireRunForAnchor } from '@/lib/projectV2/wireRuns'
import { deriveSeedConductors } from '@/lib/projectV2/wireRunSeed'
import { generateId } from '@/utils/project'
import { getProjectElectricalInstallation, getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { circuitConverterEndpointConnections, circuitWireNodeKind } from './circuitWireIdentity'
import { secondaryFeederPartnerAnchors } from './secondaryFeederRuns'
import { isProjectDefaultCableAnchor, resolveProjectDefaultCableKind } from './circuitWireDefaults'
import { isSecondaryBusFeederAnchor, sharedRailRun } from './railWireRuns'
import { buildWireBusIndex } from './wireBusIndex'
import type { Circuit, Panel } from '@/types/schema'

export interface WireRunChanges {
  medium?: WireRun['medium']
  cable?: CableSpec
  route?: WireRun['route']
  inTube?: boolean
  labels?: WireRun['labels']
  lengthM?: number
  /** With `lengthM`: `'estimated'` stores it as an accepted plan estimate instead of an entered length. */
  lengthSource?: 'estimated'
  /** `true` hands the cable type back to the project default; a `cable` change makes it authored. */
  followsDefaultCable?: boolean
}

/** The unbroken fan-out after a circuit trunk is one physical run until a branch device or DC split. */
export function sharedTrunkAnchors(project: ProjectV2, anchor: string, liveAnchors: ReadonlySet<string>): string[] {
  const circuitId = /^circuit:([^:]+):into:/.exec(anchor)?.[1]
  if (!circuitId) return [anchor]
  const findCircuit = (panel: Panel): Circuit | undefined =>
    [...(panel.circuits ?? []), ...panel.protections.flatMap((protection) => protection.circuits ?? [])]
      .find((circuit) => circuit.id === circuitId) ??
    panel.subPanels?.map(findCircuit).find(Boolean)
  const circuit = getProjectElectricalPanels(project).map(findCircuit).find(Boolean)
  const branches = circuit?.branches ?? []
  if (branches.length < 2 || branches.some((branch) =>
    branch.dcBusId || (branch.branchDevices?.length ?? 0) > 0)) return [anchor]
  const converterOutputs = circuitConverterEndpointConnections(circuit!)
  const eligible = branches.flatMap((branch) => branch.endpointIds).flatMap((endpointId) => {
    const endpoint = circuit?.endpoints.find((candidate) => candidate.id === endpointId)
    if (!endpoint || endpoint.domoticaChildProps || converterOutputs.has(endpointId)) return []
    const key = `circuit:${circuitId}:into:${circuitWireNodeKind(circuit!, endpointId)}:${endpointId}:${anchor.endsWith(':DC') ? 'DC' : 'AC'}`
    return liveAnchors.has(key) ? [key] : []
  })
  return eligible.includes(anchor) ? [...new Set(eligible)] : [anchor]
}

/** Shared specification updates affect the run; measured length affects only this connection. */
export function editWireRunAtAnchor(
  project: ProjectV2,
  anchor: string,
  defaultCable: CableSpec,
  changes: WireRunChanges
): void {
  if (!anchor) return
  const relationships = buildElectricalStructureSnapshot(project).relationships
  const liveEdge = relationships.find((edge) => edge.properties?.wireAnchor === anchor)
  if (!liveEdge) return // A stale selection must not mint an orphan run.
  const liveWire = liveEdge.properties?.wire as
    | { medium?: string; followsDefaultCable?: boolean }
    | undefined
  const isRailEdge = liveWire?.medium === 'busbar'
  const buses = buildWireBusIndex(getProjectElectricalPanels(project))
  const group = buses.groupByAnchor.get(anchor)
  const railMembers = group ? buses.membersByGroup.get(group) ?? [] : []
  const joinsRail = !!group && (changes.medium === 'busbar' || (!changes.medium && isRailEdge))
  const liveAnchors = new Set(relationships.flatMap((edge) =>
    typeof edge.properties?.wireAnchor === 'string' ? [edge.properties.wireAnchor] : []))
  // A secondary board's feeder is one cable on both boards: edits from either end share its run.
  const feederPartners = secondaryFeederPartnerAnchors(relationships, anchor)
  const trunkAnchors = [
    ...new Set([...sharedTrunkAnchors(project, anchor, liveAnchors), ...feederPartners]),
  ]
  const runs = editProjectWireRuns(project)
  let run =
    findWireRunForAnchor(runs, anchor) ??
    feederPartners.map((partner) => findWireRunForAnchor(runs, partner)).find(Boolean)
  const establishedRail = joinsRail ? sharedRailRun(runs, railMembers) : undefined
  const railCable = establishedRail?.cable ?? (group ? buses.cableByGroup.get(group) : undefined)
  if (!run) {
    run = {
      id: generateId(),
      members: !joinsRail && liveEdge?.properties?.wireBusGroup && !changes.medium
        ? [
            ...new Set(
              relationships
                .filter(
                  (edge) => edge.properties?.wireBusGroup === liveEdge.properties?.wireBusGroup
                )
                .flatMap((edge) =>
                  typeof edge.properties?.wireAnchor === 'string' &&
                  !findWireRunForAnchor(runs, edge.properties.wireAnchor)
                    ? [edge.properties.wireAnchor]
                    : []
                )
            ),
          ]
        : trunkAnchors,
      cable: { ...defaultCable },
      conductors: deriveSeedConductors(defaultCable),
      // Editing only the route or length must not freeze the inherited cable type.
      ...(liveWire?.followsDefaultCable ? { followsDefaultCable: true } : {}),
    }
    const medium = (liveEdge?.properties?.wire as { medium?: WireRun['medium'] } | undefined)
      ?.medium
    if (medium) run.medium = medium
    if (medium === 'busbar') run.material = 'copper'
    runs.push(run)
  }
  // A tap may use a wire while its neighbours remain on the comb rail. A type
  // choice authors that connection independently, even after a shared rail edit.
  if (changes.medium === 'cable' && liveEdge.properties?.wireBusGroup && run.members.length > 1) {
    const sharedRun = run
    run = { ...sharedRun, id: generateId(), members: [anchor],
      segmentLengths: sharedRun.segmentLengths?.[anchor] === undefined ? undefined
        : { [anchor]: sharedRun.segmentLengths[anchor]! },
      segmentLengthSources: sharedRun.segmentLengthSources?.[anchor] === undefined ? undefined
        : { [anchor]: sharedRun.segmentLengthSources[anchor]! },
    }
    sharedRun.members = sharedRun.members.filter((member) => member !== anchor)
    if (sharedRun.segmentLengths) delete sharedRun.segmentLengths[anchor]
    if (sharedRun.segmentLengthSources) delete sharedRun.segmentLengthSources[anchor]
    runs.push(run)
  }
  if (joinsRail) {
    const previousRun = run
    run = establishedRail ?? run
    const members = railMembers.filter((member) => liveAnchors.has(member) && (member === anchor ||
      findWireRunForAnchor(runs, member)?.medium !== 'cable'))
    for (const member of members) {
      const owner = findWireRunForAnchor(runs, member)
      if (owner && owner !== run) {
        if (owner.segmentLengths?.[member] !== undefined)
          run.segmentLengths = { ...run.segmentLengths, [member]: owner.segmentLengths[member]! }
        if (owner.segmentLengthSources?.[member])
          run.segmentLengthSources = { ...run.segmentLengthSources, [member]: owner.segmentLengthSources[member]! }
        owner.members = owner.members.filter((candidate) => candidate !== member)
      }
      if (!run.members.includes(member)) run.members.push(member)
    }
    if (changes.medium === 'busbar' && railCable) {
      run.cable = { ...railCable }
      run.conductors = establishedRail?.conductors ?? deriveSeedConductors(railCable)
      run.conductorsOverridden = establishedRail?.conductorsOverridden
    } else if (previousRun !== run && !changes.cable && railCable) run.cable = { ...railCable }
    run.medium = 'busbar'
    for (let index = runs.length - 1; index >= 0; index -= 1)
      if (!runs[index]?.members.length) runs.splice(index, 1)
  }
  // An explicit edit of the trunk makes every eligible branch path share its stored specification.
  // Keep per-edge measured lengths while folding pre-existing branch runs into this run.
  if (trunkAnchors.length > 1) {
    for (const member of trunkAnchors) {
      const owner = findWireRunForAnchor(runs, member)
      if (owner && owner !== run) {
        if (owner.segmentLengths?.[member] !== undefined)
          run.segmentLengths = { ...run.segmentLengths, [member]: owner.segmentLengths[member]! }
        if (owner.segmentLengthSources?.[member])
          run.segmentLengthSources = {
            ...run.segmentLengthSources,
            [member]: owner.segmentLengthSources[member]!,
          }
        owner.members = owner.members.filter((candidate) => candidate !== member)
      }
      if (!run.members.includes(member)) run.members.push(member)
    }
    for (let index = runs.length - 1; index >= 0; index -= 1)
      if (runs[index]?.members.length === 0) runs.splice(index, 1)
  }
  const railEligible = isRailEdge || !!liveEdge.properties?.wireBusGroup || isSecondaryBusFeederAnchor(anchor)
  if (changes.medium && (changes.medium === 'cable' || railEligible)) {
    run.medium = changes.medium
    if (changes.medium === 'busbar') run.material = 'copper'
    else {
      run.material = undefined
      run.labels = { ...run.labels, hideWireLabel: false }
      if (run.cable.customKind?.toLowerCase() === 'busbar')
        run.cable = { ...run.cable,
          kind: resolveProjectDefaultCableKind(getProjectElectricalInstallation(project)),
          customKind: undefined }
    }
  }
  if (run.medium === 'busbar' && !railEligible) run.medium = 'cable'
  if (run.medium === 'busbar') {
    run.cable = { ...run.cable, kind: 'other', customKind: 'busbar', hasPE: false,
      fireClass: undefined }
  }
  if (changes.cable && !(joinsRail && changes.medium === 'busbar')) {
    run.cable = run.medium === 'busbar'
      ? { ...changes.cable, kind: 'other', customKind: 'busbar', hasPE: false, fireClass: undefined }
      : { ...changes.cable,
          ...(changes.cable.customKind?.toLowerCase() === 'busbar'
            ? { customKind: undefined } : {}) }
    if (!run.conductorsOverridden) run.conductors = deriveSeedConductors(run.cable)
    delete run.followsDefaultCable
  }
  if (changes.followsDefaultCable && run.medium !== 'busbar' && isProjectDefaultCableAnchor(anchor))
    run.followsDefaultCable = true
  else if (changes.followsDefaultCable === false) delete run.followsDefaultCable
  if ('route' in changes) run.route = changes.route
  if ('inTube' in changes) run.inTube = changes.inTube
  if (changes.labels) run.labels = { ...run.labels, ...changes.labels }
  if ('lengthM' in changes) {
    const sources = { ...run.segmentLengthSources }
    delete sources[anchor]
    if (changes.lengthM != null && Number.isFinite(changes.lengthM) && changes.lengthM >= 0) {
      run.segmentLengths = { ...run.segmentLengths, [anchor]: changes.lengthM }
      if (changes.lengthSource === 'estimated') sources[anchor] = 'estimated'
    } else if (run.segmentLengths) delete run.segmentLengths[anchor]
    if (Object.keys(sources).length > 0) run.segmentLengthSources = sources
    else delete run.segmentLengthSources
  }
  if (run.medium === 'busbar') {
    // Cable routing and label overrides have no meaning on a comb busbar.
    run.route = undefined
    run.inTube = undefined
    run.labels = undefined
    delete run.followsDefaultCable
    if (!run.conductorsOverridden) run.conductors = deriveSeedConductors(run.cable)
  }
}
