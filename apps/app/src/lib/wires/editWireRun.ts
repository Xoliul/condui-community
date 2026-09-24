import { buildElectricalStructureSnapshot } from '@/lib/electricalStructure/builder'
import type { ProjectV2, WireRun } from '@/types/projectV2'
import type { CableSpec } from '@/types/schema'
import { editProjectWireRuns, findWireRunForAnchor } from '@/lib/projectV2/wireRuns'
import { deriveSeedConductors } from '@/lib/projectV2/wireRunSeed'
import { generateId } from '@/utils/project'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { circuitConverterEndpointConnections, circuitWireNodeKind } from './circuitWireIdentity'
import type { Circuit, Panel } from '@/types/schema'

export interface WireRunChanges {
  cable?: CableSpec
  route?: WireRun['route']
  inWall?: boolean
  inTube?: boolean
  labels?: WireRun['labels']
  lengthM?: number
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
  const isRailEdge = (liveEdge.properties?.wire as { medium?: string } | undefined)?.medium === 'busbar'
  const liveAnchors = new Set(relationships.flatMap((edge) =>
    typeof edge.properties?.wireAnchor === 'string' ? [edge.properties.wireAnchor] : []))
  const trunkAnchors = sharedTrunkAnchors(project, anchor, liveAnchors)
  const runs = editProjectWireRuns(project)
  let run = findWireRunForAnchor(runs, anchor)
  if (!run) {
    run = {
      id: generateId(),
      members: liveEdge?.properties?.wireBusGroup
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
    }
    const medium = (liveEdge?.properties?.wire as { medium?: WireRun['medium'] } | undefined)
      ?.medium
    if (medium) run.medium = medium
    if (medium === 'busbar') run.material = 'copper'
    runs.push(run)
  }
  // An explicit edit of the trunk makes every eligible branch path share its stored specification.
  // Keep per-edge measured lengths while folding pre-existing branch runs into this run.
  if (trunkAnchors.length > 1) {
    for (const member of trunkAnchors) {
      const owner = findWireRunForAnchor(runs, member)
      if (owner && owner !== run) {
        if (owner.segmentLengths?.[member] !== undefined)
          run.segmentLengths = { ...run.segmentLengths, [member]: owner.segmentLengths[member]! }
        owner.members = owner.members.filter((candidate) => candidate !== member)
      }
      if (!run.members.includes(member)) run.members.push(member)
    }
    for (let index = runs.length - 1; index >= 0; index -= 1)
      if (runs[index]?.members.length === 0) runs.splice(index, 1)
  }
  if (run.medium === 'busbar' && !isRailEdge) run.medium = 'cable'
  if (run.medium === 'busbar') {
    // Cable routing and label overrides have no meaning on a comb busbar.
    run.route = undefined
    run.inWall = undefined
    run.inTube = undefined
    run.labels = undefined
    run.cable = { ...run.cable, kind: 'other', customKind: 'busbar', hasPE: false,
      fireClass: undefined }
  }
  if (changes.cable) {
    run.cable = run.medium === 'busbar'
      ? { ...changes.cable, kind: 'other', customKind: 'busbar', hasPE: false, fireClass: undefined }
      : { ...changes.cable,
          ...(changes.cable.customKind?.toLowerCase() === 'busbar'
            ? { customKind: undefined } : {}) }
    if (!run.conductorsOverridden) run.conductors = deriveSeedConductors(run.cable)
  }
  if ('route' in changes) run.route = changes.route
  if ('inWall' in changes) run.inWall = changes.inWall
  if ('inTube' in changes) run.inTube = changes.inTube
  if (changes.labels) run.labels = { ...run.labels, ...changes.labels }
  if ('lengthM' in changes) {
    if (changes.lengthM != null && Number.isFinite(changes.lengthM) && changes.lengthM >= 0) {
      run.segmentLengths = { ...run.segmentLengths, [anchor]: changes.lengthM }
    } else if (run.segmentLengths) delete run.segmentLengths[anchor]
  }
}
