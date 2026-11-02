import { buildElectricalStructureSnapshot } from '@/lib/electricalStructure/builder'
import type { ProjectV2, WireRun } from '@/types/projectV2'
import type { CableSpec } from '@/types/schema'
import { editProjectWireRuns, findWireRunForAnchor } from '@/lib/projectV2/wireRuns'
import { deriveSeedConductors } from '@/lib/projectV2/wireRunSeed'
import {
  anchorConductorIdSeed,
  copyConductorsForFork,
  moveWireRunMember,
  reconcileConductors,
  withConductorIds,
} from './conductorIdentity'
import { generateId } from '@/utils/project'
import { getProjectElectricalInstallation, getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { circuitConverterEndpointConnections, circuitWireNodeKind } from './circuitWireIdentity'
import { secondaryFeederPartnerAnchors } from './secondaryFeederRuns'
import { isProjectDefaultCableAnchor, resolveProjectDefaultCableKind } from './circuitWireDefaults'
import { isRailFeederAnchor, sharedRailRun } from './railWireRuns'
import { buildWireBusIndex } from './wireBusIndex'
import type { Circuit, Panel } from '@/types/schema'

export interface WireRunChanges {
  medium?: WireRun['medium']
  material?: WireRun['material']
  cable?: CableSpec
  route?: WireRun['route']
  inTube?: boolean
  labels?: WireRun['labels']
  lengthM?: number
  /** With `lengthM`: `'estimated'` stores it as an accepted plan estimate instead of an entered length. */
  lengthSource?: 'estimated'
  /** `true` hands the cable type back to the project default; a `cable` change makes it authored. */
  followsDefaultCable?: boolean
  /** `true` stores an explicit "no fire class"; choosing a class or `false` restores inheritance. */
  fireClassNone?: boolean
}

function pickMemberEntries<T>(
  entries: Record<string, T> | undefined,
  members: ReadonlySet<string>
): Record<string, T> | undefined {
  if (!entries) return undefined
  const picked = Object.fromEntries(
    Object.entries(entries).filter(([member]) => members.has(member))
  )
  return Object.keys(picked).length > 0 ? picked : undefined
}

function copyCoreAliases(
  entries: Record<string, Record<string, string>> | undefined,
  members: ReadonlySet<string>
): Record<string, Record<string, string>> | undefined {
  const picked = pickMemberEntries(entries, members)
  if (!picked) return undefined
  return Object.fromEntries(
    Object.entries(picked).map(([member, aliases]) => [member, { ...aliases }])
  )
}

/** Split selected members away from a legacy/shared run while preserving their core references. */
function forkWireRunMembers(
  runs: WireRun[],
  source: WireRun,
  members: readonly string[],
  newId: () => string
): WireRun | undefined {
  const selected = new Set(members.filter((member) => source.members.includes(member)))
  if (selected.size === 0 || selected.size === source.members.length) return undefined

  const fork: WireRun = {
    ...source,
    id: newId(),
    members: source.members.filter((member) => selected.has(member)),
    cable: { ...source.cable },
    conductors: copyConductorsForFork(source.conductors),
    segmentLengths: pickMemberEntries(source.segmentLengths, selected),
    segmentLengthSources: pickMemberEntries(source.segmentLengthSources, selected),
    coreAliases: copyCoreAliases(source.coreAliases, selected),
    ...(source.labels ? { labels: { ...source.labels } } : {}),
  }
  if (!fork.segmentLengths) delete fork.segmentLengths
  if (!fork.segmentLengthSources) delete fork.segmentLengthSources
  if (!fork.coreAliases) delete fork.coreAliases

  source.members = source.members.filter((member) => !selected.has(member))
  source.segmentLengths = pickMemberEntries(source.segmentLengths, new Set(source.members))
  source.segmentLengthSources = pickMemberEntries(
    source.segmentLengthSources,
    new Set(source.members)
  )
  source.coreAliases = copyCoreAliases(source.coreAliases, new Set(source.members))
  if (!source.segmentLengths) delete source.segmentLengths
  if (!source.segmentLengthSources) delete source.segmentLengthSources
  if (!source.coreAliases) delete source.coreAliases
  runs.push(fork)
  return fork
}

/** Candidate anchors for one rendered shared stem, before a branch device or DC split. */
export function sharedTrunkAnchors(project: ProjectV2, anchor: string, liveAnchors: ReadonlySet<string>): string[] {
  const circuitId = /^circuit:([^:]+):into:/.exec(anchor)?.[1]
  if (!circuitId) return [anchor]
  const findCircuit = (panel: Panel): Circuit | undefined =>
    [...(panel.circuits ?? []), ...panel.protections.flatMap((protection) => protection.circuits ?? [])]
      .find((circuit) => circuit.id === circuitId) ??
    panel.subPanels?.map(findCircuit).find(Boolean)
  const circuit = getProjectElectricalPanels(project).map(findCircuit).find(Boolean)
  const branches = circuit?.branches ?? []
  if (branches.length < 2 || branches.some((branch) => branch.dcBusId)) return [anchor]
  const converterOutputs = circuitConverterEndpointConnections(circuit!)
  // Match wireIdentity's rendered-stem anchors: the first branch device, or otherwise the first
  // non-domotica endpoint. Later symbols have their own physical connection sections.
  const eligible = branches.flatMap((branch) => {
    const firstBranchDevice = branch.branchDevices?.[0]
    if (firstBranchDevice) return [firstBranchDevice.id]
    const firstEndpointId = branch.endpointIds.find((endpointId) =>
      !circuit!.endpoints.find((endpoint) => endpoint.id === endpointId)?.domoticaChildProps)
    if (!firstEndpointId || converterOutputs.has(firstEndpointId)) return []
    return [firstEndpointId]
  }).flatMap((targetId) => {
    const key = `circuit:${circuitId}:into:${circuitWireNodeKind(circuit!, targetId)}:${targetId}:${anchor.endsWith(':DC') ? 'DC' : 'AC'}`
    return liveAnchors.has(key) ? [key] : []
  })
  return eligible.includes(anchor) ? [...new Set(eligible)] : [anchor]
}

/** Edit one connection or an explicitly shared stem/rail; length remains per connection. */
export function editWireRunAtAnchor(
  project: ProjectV2,
  anchor: string,
  defaultCable: CableSpec,
  changes: WireRunChanges,
  newId: () => string = generateId,
  sharedGeometryAnchors?: readonly string[]
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
  // Ordinary endpoint wires are one connection each. A multi-anchor run is retained only when
  // the caller identifies the other anchors represented by the selected shared stem, or when
  // electrical topology defines genuine continuity (such as a secondary-board feeder).
  const sharedGeometryMembers = sharedGeometryAnchors?.includes(anchor)
    ? sharedTrunkAnchors(project, anchor, new Set(sharedGeometryAnchors))
    : []
  const trunkAnchors = [...new Set([anchor, ...sharedGeometryMembers, ...feederPartners])]
  const runs = editProjectWireRuns(project)
  let run =
    findWireRunForAnchor(runs, anchor) ??
    feederPartners.map((partner) => findWireRunForAnchor(runs, partner)).find(Boolean)
  const establishedRail = joinsRail ? sharedRailRun(runs, railMembers) : undefined
  const railCable = establishedRail?.cable ?? (group ? buses.cableByGroup.get(group) : undefined)
  if (!run) {
    run = {
      id: newId(),
      members: trunkAnchors,
      cable: { ...defaultCable },
      // Same ids the default cable showed for this anchor, so earlier references keep resolving.
      conductors: withConductorIds(anchorConductorIdSeed(anchor), deriveSeedConductors(defaultCable)),
      // Editing only the route or length must not freeze the inherited cable type.
      ...(liveWire?.followsDefaultCable ? { followsDefaultCable: true } : {}),
    }
    const medium = (liveEdge?.properties?.wire as { medium?: WireRun['medium'] } | undefined)
      ?.medium
    if (medium) run.medium = medium
    if (medium === 'busbar') run.material = 'copper'
    runs.push(run)
  }
  if (!joinsRail && run.members.length > 1) {
    const retainedMembers = new Set(trunkAnchors)
    if (!run.members.every((member) => retainedMembers.has(member)))
      run = forkWireRunMembers(runs, run, trunkAnchors, newId) ?? run
  }
  // A tap may use a wire while its neighbours remain on the comb rail. A type
  // choice authors that connection independently, even after a shared rail edit.
  if (changes.medium === 'cable' && liveEdge.properties?.wireBusGroup && run.members.length > 1) {
    const sharedRun = run
    run = { ...sharedRun, id: newId(), members: [anchor],
      conductors: copyConductorsForFork(sharedRun.conductors),
      segmentLengths: sharedRun.segmentLengths?.[anchor] === undefined ? undefined
        : { [anchor]: sharedRun.segmentLengths[anchor]! },
      segmentLengthSources: sharedRun.segmentLengthSources?.[anchor] === undefined ? undefined
        : { [anchor]: sharedRun.segmentLengthSources[anchor]! },
      coreAliases: sharedRun.coreAliases?.[anchor] === undefined ? undefined
        : { [anchor]: { ...sharedRun.coreAliases[anchor] } },
    }
    if (!run.coreAliases) delete run.coreAliases
    if (sharedRun.coreAliases?.[anchor]) {
      const remaining = { ...sharedRun.coreAliases }
      delete remaining[anchor]
      if (Object.keys(remaining).length > 0) sharedRun.coreAliases = remaining
      else delete sharedRun.coreAliases
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
      if (owner && owner !== run) moveWireRunMember(owner, run, member)
      if (!run.members.includes(member)) run.members.push(member)
    }
    if (changes.medium === 'busbar' && railCable) {
      run.cable = { ...railCable }
      run.conductors = establishedRail?.conductors ??
        reconcileConductors(run.conductors, deriveSeedConductors(railCable))
      run.conductorsOverridden = establishedRail?.conductorsOverridden
    } else if (previousRun !== run && !changes.cable && railCable) run.cable = { ...railCable }
    run.medium = 'busbar'
    for (let index = runs.length - 1; index >= 0; index -= 1)
      if (!runs[index]?.members.length) runs.splice(index, 1)
  }
  // An explicit stem edit makes its first branch connections share the stored specification.
  // Keep per-edge measured lengths while folding pre-existing branch runs into this run.
  if (trunkAnchors.length > 1) {
    for (const member of trunkAnchors) {
      const owner = findWireRunForAnchor(runs, member)
      if (owner && owner !== run) moveWireRunMember(owner, run, member)
      if (!run.members.includes(member)) run.members.push(member)
    }
    for (let index = runs.length - 1; index >= 0; index -= 1)
      if (runs[index]?.members.length === 0) runs.splice(index, 1)
  }
  const railEligible = isRailEdge || !!liveEdge.properties?.wireBusGroup || isRailFeederAnchor(anchor, buses)
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
    if (!run.conductorsOverridden)
      run.conductors = reconcileConductors(run.conductors, deriveSeedConductors(run.cable))
    delete run.followsDefaultCable
    if (run.cable.fireClass) delete run.fireClassNone
  }
  if (changes.fireClassNone && !run.cable.fireClass && run.medium !== 'busbar') run.fireClassNone = true
  else if (changes.fireClassNone === false) delete run.fireClassNone
  if (changes.followsDefaultCable && run.medium !== 'busbar' && isProjectDefaultCableAnchor(anchor))
    run.followsDefaultCable = true
  else if (changes.followsDefaultCable === false) delete run.followsDefaultCable
  if ('material' in changes) run.material = changes.material
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
    delete run.fireClassNone
    if (!run.conductorsOverridden)
      run.conductors = reconcileConductors(run.conductors, deriveSeedConductors(run.cable))
  }
}
