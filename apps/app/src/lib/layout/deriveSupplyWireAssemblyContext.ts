/** Supply section overrides, assembly connections and deferred enclosure-boundary marking. */

import type { LayoutNode } from './layoutTree'
import type {
  WireSegment,
  Panel,
  Installation,
  TrunkDevice,
  CircuitPhaseAssignment,
} from '@/types/schema'

import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import { resolveSupplyFeedScopeForDeviceId } from '@/lib/supplyWireCables'

import {
  panelGridModuleIsVisibleByDefault,
  trunkDeviceCanAppearInPanelGrid,
} from '@/lib/eendraad/projectElectricalDomain'
import type {
  OffGridSupplyAssembly,
  SupplyConnection,
  SupplyConnectionPathRole,
  ElectricalEnclosureRef,
} from '@/types/supplyAssembly'

export interface PanelWireDerivationInput {
  panelNode: LayoutNode
  panel: Panel
  panels: Panel[]
  installation?: Installation
  supplyAssemblies: OffGridSupplyAssembly[]
  resolveSupplyDeviceEnclosure?: (deviceId: string) => ElectricalEnclosureRef | undefined
  segments: WireSegment[]
}

export function getAcConnectionPhaseAssignment(
  connection: SupplyConnection | undefined
): CircuitPhaseAssignment | undefined {
  if (!connection || connection.domain !== 'AC') return undefined
  const phases = connection.conductors.filter(
    (conductor): conductor is 'L1' | 'L2' | 'L3' | 'N' =>
      conductor === 'L1' || conductor === 'L2' || conductor === 'L3' || conductor === 'N'
  )
  const uniquePhases = [...new Set(phases)]
  const linePhaseCount = uniquePhases.filter((phase) => phase !== 'N').length
  if (linePhaseCount === 0) return undefined
  return {
    kind:
      linePhaseCount >= 3
        ? 'three_phase'
        : linePhaseCount === 2
          ? 'phase_to_phase'
          : 'single_phase',
    phases: uniquePhases,
    neutral: uniquePhases.includes('N') ? 'used' : 'not_present',
    source: 'derived_from_busbar',
  }
}

/** Physical-section key of a supply wire; the persisted identity of its cable and label settings. */
export function buildSupplySectionKey(
  panelId: string,
  path: string,
  first: string,
  second: string
): string {
  const [left, right] = [first, second].sort()
  return `supply:${panelId}:${path}:${left}<>${right}`
}

/** The off-grid assembly that feeds a panel, if any. */
export function findPanelSupplyAssembly(
  supplyAssemblies: OffGridSupplyAssembly[],
  panelId: string
): OffGridSupplyAssembly | undefined {
  return supplyAssemblies.find(
    (assembly) =>
      ((assembly.incomingAttachment.kind === 'panel-input' ||
        assembly.incomingAttachment.kind === 'panel-bus-input') &&
        assembly.incomingAttachment.panelId === panelId) ||
      assembly.loadHandoffs.some(
        (handoff) =>
          (handoff.target.kind === 'panel-input' ||
            handoff.target.kind === 'panel-bus-input' ||
            handoff.target.kind === 'circuit-input') &&
          handoff.target.panelId === panelId
      )
  )
}

/** The connection between two assembly nodes (multiplied inverter units merge into one run). */
export function findSupplyAssemblyConnection(
  supplyAssembly: OffGridSupplyAssembly | undefined,
  firstNodeId: string | undefined,
  secondNodeId: string | undefined,
  pathRole?: SupplyConnectionPathRole
): SupplyConnection | undefined {
  if (!supplyAssembly || !firstNodeId || !secondNodeId || firstNodeId === secondNodeId)
    return undefined
  const equivalentNodeIds = (nodeId: string): Set<string> => {
    const node = supplyAssembly.nodes.find((candidate) => candidate.id === nodeId)
    if (node?.kind !== 'inverter-unit' || !node.deviceId) return new Set([nodeId])
    return new Set(
      supplyAssembly.nodes
        .filter(
          (candidate) =>
            candidate.kind === 'inverter-unit' && candidate.deviceId === node.deviceId
        )
        .map((candidate) => candidate.id)
    )
  }
  const firstIds = equivalentNodeIds(firstNodeId)
  const secondIds = equivalentNodeIds(secondNodeId)
  const matches = supplyAssembly.connections.filter(
    (connection) =>
      (!pathRole || connection.pathRole === pathRole) &&
      connection.endpoints.some(({ nodeId }) => firstIds.has(nodeId)) &&
      connection.endpoints.some(({ nodeId }) => secondIds.has(nodeId))
  )
  const primary =
    matches.find(
      (connection) =>
        connection.endpoints.some(({ nodeId }) => nodeId === firstNodeId) &&
        connection.endpoints.some(({ nodeId }) => nodeId === secondNodeId)
    ) ?? matches[0]
  if (!primary || matches.length === 1) return primary
  const conductorOrder = ['L1', 'L2', 'L3', 'N', 'PE', 'DC+', 'DC-'] as const
  return {
    ...primary,
    // Multiplied inverter units are separate graph sources but share one collapsed
    // symbol and one physical one-wire run. Render that run with the union carried
    // by all equivalent unit connections, never the arbitrary first unit only.
    conductors: Array.from(new Set(matches.flatMap((connection) => connection.conductors))).sort(
      (left, right) => conductorOrder.indexOf(left) - conductorOrder.indexOf(right)
    ),
  }
}

type CreateSupplyWireAssemblyContextInput =
  PanelWireDerivationInput & {
    /** The panel node is bound after setup and read only during final boundary marking. */
    getDirectConverterNodeForBackup: () => LayoutNode | undefined
  }

export function createSupplyWireAssemblyContext(input: CreateSupplyWireAssemblyContextInput) {
  const {
    panelNode,
    panel,
    panels,
    installation,
    supplyAssemblies,
    resolveSupplyDeviceEnclosure,
    segments,
    getDirectConverterNodeForBackup,
  } = input
  const feedTopology = installation
    ? ensureInstallationFeedTopology(installation, panels)
    : undefined
  const rootFeed = feedTopology?.rootFeeds.find((feed) => feed.panelId === panel.id)
  const applySupplySection = (segment: WireSegment, sectionKey?: string): WireSegment => {
    if (!sectionKey) return segment
    segment.supplySectionKey = sectionKey
    const properties = rootFeed?.wireSections?.[sectionKey]
    if (!properties) return segment
    segment.cable = properties.cable
    segment.wireRoute = properties.wireRoute
    segment.inTube = properties.inTube
    segment.inWall = properties.inWall
    segment.hideWireLabel = properties.hideWireLabel
    segment.showFireClassLabel = properties.showFireClassLabel
    segment.wireLengthM = properties.wireLengthM
    segment.showWireLengthLabel = properties.showWireLengthLabel
    return segment
  }
  const propagateSupplySectionsAcrossSimpleJoints = (): void => {
    const supplySegments = segments.filter(
      (segment) =>
        segment.isSupplyTrunk === true ||
        segment.supplyConnectionId != null ||
        segment.supplySectionKey != null
    )
    if (supplySegments.length < 2) return

    const endpointKey = (segment: WireSegment, point: { x: number; y: number }) =>
      `${segment.domain ?? 'AC'}:${Math.round(point.x * 10)}:${Math.round(point.y * 10)}`
    const endpointIncidence = new Map<string, number[]>()
    supplySegments.forEach((segment, index) => {
      for (const point of [segment.startPoint, segment.endPoint]) {
        const key = endpointKey(segment, point)
        endpointIncidence.set(key, [...(endpointIncidence.get(key) ?? []), index])
      }
    })

    const parents = supplySegments.map((_, index) => index)
    const find = (index: number): number => {
      let root = index
      while (parents[root] !== root) root = parents[root]!
      while (parents[index] !== index) {
        const next = parents[index]!
        parents[index] = root
        index = next
      }
      return root
    }
    const unite = (left: number, right: number) => {
      const leftRoot = find(left)
      const rightRoot = find(right)
      if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot
    }
    for (const incident of endpointIncidence.values()) {
      // A simple two-piece joint is one physical run (including a 90-degree bend).
      // A T-junction remains a boundary between independently configurable wires.
      if (incident.length === 2) unite(incident[0]!, incident[1]!)
    }

    const groups = new Map<number, WireSegment[]>()
    supplySegments.forEach((segment, index) => {
      const root = find(index)
      groups.set(root, [...(groups.get(root) ?? []), segment])
    })
    for (const group of groups.values()) {
      const sectionKeys = new Set(
        group.map((segment) => segment.supplySectionKey).filter((key): key is string => !!key)
      )
      if (sectionKeys.size !== 1) continue
      const [sectionKey] = sectionKeys
      for (const segment of group) {
        if (!segment.supplySectionKey) applySupplySection(segment, sectionKey)
      }
    }
  }
  const supplySectionKey = (path: string, first: string, second: string): string =>
    buildSupplySectionKey(panel.id, path, first, second)

  const supplyAssembly = findPanelSupplyAssembly(supplyAssemblies, panel.id)
  const findAssemblyConnection = (
    firstNodeId: string | undefined,
    secondNodeId: string | undefined,
    pathRole?: SupplyConnectionPathRole
  ): SupplyConnection | undefined =>
    findSupplyAssemblyConnection(supplyAssembly, firstNodeId, secondNodeId, pathRole)
  const findAssemblyPortConnection = (
    nodeId: string | undefined,
    portId: string
  ): SupplyConnection | undefined => {
    if (!supplyAssembly || !nodeId) return undefined
    const node = supplyAssembly.nodes.find((candidate) => candidate.id === nodeId)
    const equivalentIds =
      node?.kind === 'inverter-unit' && node.deviceId
        ? new Set(
            supplyAssembly.nodes
              .filter(
                (candidate) =>
                  candidate.kind === 'inverter-unit' && candidate.deviceId === node.deviceId
              )
              .map((candidate) => candidate.id)
          )
        : new Set([nodeId])
    const matches = supplyAssembly.connections.filter((connection) =>
      connection.endpoints.some(
        (endpoint) => equivalentIds.has(endpoint.nodeId) && endpoint.portId === portId
      )
    )
    const primary =
      matches.find((connection) =>
        connection.endpoints.some(
          (endpoint) => endpoint.nodeId === nodeId && endpoint.portId === portId
        )
      ) ?? matches[0]
    if (!primary || matches.length === 1) return primary
    const conductorOrder = ['L1', 'L2', 'L3', 'N', 'PE', 'DC+', 'DC-'] as const
    return {
      ...primary,
      conductors: Array.from(new Set(matches.flatMap((connection) => connection.conductors))).sort(
        (left, right) => conductorOrder.indexOf(left) - conductorOrder.indexOf(right)
      ),
    }
  }
  const applyAssemblyConnection = (
    segment: WireSegment,
    connection: SupplyConnection | undefined
  ): WireSegment => {
    if (!supplyAssembly || !connection) return segment
    segment.supplyAssemblyId = supplyAssembly.id
    segment.supplyConnectionId = connection.id
    const connectionPhaseAssignment = getAcConnectionPhaseAssignment(connection)
    if (connectionPhaseAssignment) segment.phaseAssignment = connectionPhaseAssignment
    const properties = connection.wireProperties
    if (properties) {
      segment.cable = properties.cable
      segment.wireRoute = properties.wireRoute
      segment.inTube = properties.inTube
      segment.inWall = properties.inWall
      segment.hideWireLabel = properties.hideWireLabel
      segment.showFireClassLabel = properties.showFireClassLabel
      segment.wireLengthM = properties.wireLengthM
      segment.showWireLengthLabel = properties.showWireLengthLabel
    }
    // A physical section is the most specific editable identity. Connection defaults may seed it,
    // but must never overwrite its independently persisted cable, route, or label visibility.
    if (segment.supplySectionKey && rootFeed?.wireSections?.[segment.supplySectionKey]) {
      applySupplySection(segment, segment.supplySectionKey)
    }
    return segment
  }

  const enclosureKey = (enclosure: import('@/types/supplyAssembly').ElectricalEnclosureRef) =>
    enclosure.kind === 'grid'
      ? 'grid'
      : enclosure.kind === 'panel'
        ? `panel:${enclosure.panelId}`
        : `auxiliary:${enclosure.enclosureId}`

  const getDeviceEnclosureKey = (device: TrunkDevice): string | undefined => {
    if (!trunkDeviceCanAppearInPanelGrid(device)) return undefined
    const ref = { kind: 'trunkDevice' as const, id: device.id, scope: 'supply' as const }
    const refKey = `trunkDevice:${device.id}:supply`
    let hidden = false
    let explicitlyShown = false
    const visitPanels = (candidates: Panel[]): void => {
      for (const candidate of candidates) {
        hidden ||= candidate.gridView?.hiddenModuleKeys?.includes(refKey) === true
        explicitlyShown ||=
          candidate.gridView?.shownModuleKeys?.includes(refKey) === true ||
          candidate.gridView?.slots.some((slot) => {
            const module = slot.module
            return (
              module.kind === 'trunkDevice' && module.id === device.id && module.scope === 'supply'
            )
          }) === true ||
          candidate.gridView?.supplyPanelSlots?.some((slot) => {
            const module = slot.module
            return (
              module.kind === 'trunkDevice' && module.id === device.id && module.scope === 'supply'
            )
          }) === true
        visitPanels(candidate.subPanels ?? [])
      }
    }
    visitPanels(panels)
    if (hidden) return undefined
    if (
      !device.panelMounting &&
      !explicitlyShown &&
      !panelGridModuleIsVisibleByDefault(ref, panel, installation, panels)
    ) {
      return undefined
    }
    const resolvedEnclosure = resolveSupplyDeviceEnclosure?.(device.id) ?? device.panelMounting
    if (resolvedEnclosure) return enclosureKey(resolvedEnclosure)
    if (!installation) return 'grid'
    return resolveSupplyFeedScopeForDeviceId(installation, panels, panel, device.id) === 'shared'
      ? 'grid'
      : `panel:${panel.id}`
  }

  const getAssemblyNodeEnclosureKey = (nodeId: string): string | undefined => {
    const node = supplyAssembly?.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return undefined
    if (node.kind === 'utility-source') return 'grid'
    if (node.kind === 'panel-handoff') return `panel:${panel.id}`

    const deviceNode = node.deviceId
      ? panelNode.children.find(
          (candidate) => candidate.type === 'trunkDevice' && candidate.domainId === node.deviceId
        )
      : undefined
    const device = deviceNode?.domainRef as TrunkDevice | undefined
    if (device) return getDeviceEnclosureKey(device)
    if (node.mounting?.enclosure) return enclosureKey(node.mounting.enclosure)
    if (!node.deviceId || !installation) return undefined
    return resolveSupplyFeedScopeForDeviceId(installation, panels, panel, node.deviceId) ===
      'shared'
      ? 'grid'
      : `panel:${panel.id}`
  }

  const explicitlyMarkedConnectionIds = new Set<string>()
  const explicitlyMarkedBoundaryKeys = new Set<string>()
  const getBoundaryKey = (firstEnclosure: string, secondEnclosure: string) =>
    [firstEnclosure, secondEnclosure].sort().join('|')
  const markAssemblyEnclosureBoundaries = (): void => {
    if (!supplyAssembly) return
    // Distance from the utility source orients each separator in the direction of supply.
    const supplyDepth = new Map<string, number>()
    const queue = supplyAssembly.nodes
      .filter((node) => node.kind === 'utility-source')
      .map((node) => node.id)
    for (const id of queue) supplyDepth.set(id, 0)
    for (let index = 0; index < queue.length; index++) {
      const nodeId = queue[index]!
      for (const candidate of supplyAssembly.connections) {
        const [first, second] = candidate.endpoints
        const next =
          first.nodeId === nodeId ? second.nodeId : second.nodeId === nodeId ? first.nodeId : undefined
        if (!next || supplyDepth.has(next)) continue
        supplyDepth.set(next, supplyDepth.get(nodeId)! + 1)
        queue.push(next)
      }
    }
    for (const connection of supplyAssembly.connections) {
      const endpointNodes = connection.endpoints.map(({ nodeId }) =>
        supplyAssembly.nodes.find((candidate) => candidate.id === nodeId)
      )
      if (endpointNodes.some((node) => node?.kind === 'panel-handoff')) continue
      const fromEnclosure = getAssemblyNodeEnclosureKey(connection.endpoints[0].nodeId)
      const toEnclosure = getAssemblyNodeEnclosureKey(connection.endpoints[1].nodeId)
      if (!fromEnclosure || !toEnclosure || fromEnclosure === toEnclosure) continue
      if (explicitlyMarkedBoundaryKeys.has(getBoundaryKey(fromEnclosure, toEnclosure))) continue
      if (explicitlyMarkedConnectionIds.has(connection.id)) continue
      const candidates = segments.filter((segment) => segment.supplyConnectionId === connection.id)
      const markerSegment = candidates.reduce<WireSegment | undefined>((best, candidate) => {
        const length = Math.hypot(
          candidate.endPoint.x - candidate.startPoint.x,
          candidate.endPoint.y - candidate.startPoint.y
        )
        if (length <= 0) return best
        if (!best) return candidate
        const bestLength = Math.hypot(
          best.endPoint.x - best.startPoint.x,
          best.endPoint.y - best.startPoint.y
        )
        // Keep the enclosure marker local to the boundary device. Long elbow/T legs
        // tend to push it away from the actual ownership transition and can make one
        // transition look like two independent splits.
        return length < bestLength ? candidate : best
      }, undefined)
      if (markerSegment) {
        markerSegment.supplyEnclosureBoundary = true
        const reversed =
          (supplyDepth.get(connection.endpoints[0].nodeId) ?? 0) >
          (supplyDepth.get(connection.endpoints[1].nodeId) ?? 0)
        markerSegment.enclosureTransition = reversed
          ? { from: toEnclosure, to: fromEnclosure }
          : { from: fromEnclosure, to: toEnclosure }
        // A direct converter's grid and load paths meet at one visible T. Collapse
        // repeated ownership transitions there, while retaining both genuinely
        // independent inputs of a source changeover.
        if (getDirectConverterNodeForBackup()) {
          explicitlyMarkedBoundaryKeys.add(getBoundaryKey(fromEnclosure, toEnclosure))
        }
        explicitlyMarkedConnectionIds.add(connection.id)
      }
    }
  }

  return {
    feedTopology,
    rootFeed,
    applySupplySection,
    propagateSupplySectionsAcrossSimpleJoints,
    supplySectionKey,
    supplyAssembly,
    findAssemblyConnection,
    findAssemblyPortConnection,
    applyAssemblyConnection,
    getDeviceEnclosureKey,
    explicitlyMarkedConnectionIds,
    explicitlyMarkedBoundaryKeys,
    getBoundaryKey,
    markAssemblyEnclosureBoundaries,
  }
}

export type SupplyWireAssemblyContext = ReturnType<typeof createSupplyWireAssemblyContext>
