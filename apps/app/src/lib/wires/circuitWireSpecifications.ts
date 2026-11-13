import type { CableSpec, Circuit, Panel, WireSegment } from '@/types/schema'
import type { WireRun } from '@/types/projectV2'
import { deriveWireAnchorKey, fromWireRunRoute, toWireRunRoute } from '@/lib/projectV2/wireRuns'
import { getCircuitBranches } from '@/lib/layout/endpointChains'
import { circuitWireDomains } from './circuitWireIdentity'
import { resolveOneWireBranchTopology } from '@/lib/eendraad/oneWireBranchTopology'

export type WireInstallationSpecification = Pick<WireRun, 'route' | 'inTube'> & {
  fireClass?: CableSpec['fireClass']
}

/** Resolution-internal: `null` is an explicit "no fire class" that stops inheritance. */
type ResolvingSpecification = Omit<WireInstallationSpecification, 'fireClass'> & {
  fireClass?: CableSpec['fireClass'] | null
}

/** Missing placement and fire-class fields inherit upstream within one circuit/domain.
 * Explicit downstream values override only those fields, independently of cable dimensions;
 * `route: 'none'` and `fireClassNone` stop inheritance like any other explicit value.
 * Cable dimensions, lengths, cores and run identity remain specific to each connection.
 */
export function circuitWireSpecifications(
  panels: Panel[], runs: readonly WireRun[]
): Map<string, WireInstallationSpecification> {
  const domains = circuitWireDomains(panels)
  // First owner wins, matching findWireRunForAnchor, so edits and resolution read the same run.
  const own = new Map<string, ResolvingSpecification>()
  for (const run of runs) {
    if (run.medium === 'busbar') continue
    for (const anchor of run.members) if (!own.has(anchor)) own.set(anchor, {
      fireClass: run.fireClassNone ? null : run.cable.fireClass, route: run.route, inTube: run.inTube,
    })
  }
  const parents = new Map<string, string>()
  const defaults = new Map<string, WireInstallationSpecification>()
  const visitCircuit = (circuit: Circuit) => {
    const trunkIds = new Set([...(circuit.trunkDevices ?? []),
      ...(circuit.branches ?? []).flatMap((branch) => branch.branchDevices ?? [])].map((device) => device.id))
    const anchor = (id: string) => deriveWireAnchorKey({
      kind: 'circuit-section', circuitId: circuit.id,
      nodeRef: `${trunkIds.has(id) ? 'trunk-device' : 'endpoint'}:${id}`,
      domain: domains.get(`${circuit.id}:${id}`) ?? 'AC',
    })
    const devices = [...(circuit.trunkDevices ?? []),
      ...(circuit.branches ?? []).flatMap((branch) => branch.branchDevices ?? []),
      ...circuit.endpoints]
    for (const device of devices) defaults.set(anchor(device.id), {
      fireClass: circuit.cable.fireClass, route: toWireRunRoute(circuit.wireRoute, circuit.inWall), inTube: circuit.inTube,
    })
    const connect = (from: string | undefined, to: string) => {
      if (!from) return
      if (domains.get(`${circuit.id}:${from}`) !== domains.get(`${circuit.id}:${to}`)) return
      parents.set(anchor(to), anchor(from))
    }
    const trunks = [...(circuit.trunkDevices ?? [])].sort((a, b) => a.trunkPosition - b.trunkPosition)
    const forks = circuit.branches?.some((branch) => branch.forkFrom)
      ? resolveOneWireBranchTopology({ ...circuit, branches: circuit.branches }) : null
    trunks.forEach((device, index) => connect(trunks[index - 1]?.id, device.id))
    const branches = getCircuitBranches(circuit)
    branches.forEach((endpoints, branchIndex) => {
      const branch = circuit.branches?.[branchIndex]
      let previous = branch?.dcBusId ?? trunks.filter((device) => device.trunkPosition <= branchIndex).at(-1)?.id
      const feed = branch ? forks?.byBranchId.get(branch.id)?.feed : undefined
      if (feed?.kind === 'unresolved') return
      if (feed?.kind === 'endpoint') previous = feed.endpointId
      else if (feed?.kind === 'trunk') previous = feed.deviceIds.at(-1)
      for (const device of branch?.branchDevices ?? []) {
        connect(previous, device.id)
        previous = device.id
      }
      const outputTails = new Map<string, string>()
      for (const endpoint of endpoints) {
        const child = endpoint.domoticaChildProps
        if (child) {
          // Outputs inherit the module input, never another output's overrides.
          const key = `${child.parentEndpointId}:${child.outputGroup}:${child.outputIndex}`
          connect(outputTails.get(key) ?? child.parentEndpointId, endpoint.id)
          outputTails.set(key, endpoint.id)
        } else {
          connect(previous, endpoint.id)
          previous = endpoint.id
        }
      }
    })
  }
  const visit = (panel: Panel) => {
    for (const circuit of [...panel.circuits, ...panel.protections.flatMap((protection) => protection.circuits ?? [])])
      visitCircuit(circuit)
    panel.subPanels.forEach(visit)
  }
  panels.forEach(visit)
  const resolved = new Map<string, ResolvingSpecification>()
  const completed = new Set<string>()
  const resolve = (anchor: string): ResolvingSpecification | undefined => {
    const path: string[] = [], seen = new Set<string>()
    let cursor: string | undefined = anchor
    while (cursor && !completed.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor); path.push(cursor); cursor = parents.get(cursor)
    }
    let inherited = cursor && completed.has(cursor) ? resolved.get(cursor) : undefined
    for (let index = path.length - 1; index >= 0; index--) {
      const key = path[index]!, authored = own.get(key)
      const upstream = inherited ?? (authored ? defaults.get(key) : undefined)
      const specification: ResolvingSpecification | undefined = authored || upstream ? {
        fireClass: authored?.fireClass !== undefined ? authored.fireClass : upstream?.fireClass,
        route: authored?.route ?? upstream?.route, inTube: authored?.inTube ?? upstream?.inTube,
      } : undefined
      completed.add(key)
      if (specification) resolved.set(key, specification)
      inherited = specification
    }
    return resolved.get(anchor)
  }
  for (const anchor of new Set([...defaults.keys(), ...own.keys()])) resolve(anchor)
  return new Map([...resolved].map(([anchor, { fireClass, ...rest }]) =>
    [anchor, { ...rest, fireClass: fireClass ?? undefined }]))
}

export function hasWirePlacement(segment: Pick<WireSegment, 'installationType' | 'wireRoute' | 'wireRouteNone' | 'inTube'>): boolean {
  return Boolean(segment.installationType || segment.wireRoute || segment.wireRouteNone || segment.inTube)
}

export function applyWireInstallationSpecification(
  segment: WireSegment, specification: WireInstallationSpecification
): void {
  segment.cable = { ...segment.cable, fireClass: specification.fireClass }
  Object.assign(segment, fromWireRunRoute(specification.route), { inTube: specification.inTube })
  segment.wireRouteNone = specification.route === 'none'
}
