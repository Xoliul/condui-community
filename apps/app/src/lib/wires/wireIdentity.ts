import { buildWireBusIndex } from './wireBusIndex'
import type { Circuit, Installation, Panel, WireSegment } from '@/types/schema'
import type { WireRun } from '@/types/projectV2'
import type { OffGridSupplyAssembly } from '@/types/supplyAssembly'
import { deriveWireAnchorKey, findWireRunForAnchor } from '@/lib/projectV2/wireRuns'

function splitBusFeedAnchor(
  segment: WireSegment,
  installation: Installation | undefined,
  assemblies: readonly OffGridSupplyAssembly[]
): string | undefined {
  if (!segment.busSectionId || !segment.panelId ||
    (!segment.id.startsWith('bus-feed-protection-wire-') &&
      !segment.id.startsWith('bus-feed-stub-'))) return undefined
  const deviceId = segment.toElementId ?? segment.fromElementId
  if (!deviceId) return undefined
  const matchingFeeds = (installation?.feedTopology?.rootFeeds ?? []).filter((feed) =>
    feed.panelId === segment.panelId && feed.busSectionId === segment.busSectionId &&
    feed.trunkDevices?.some((device) => device.id === deviceId))
  if (matchingFeeds.length !== 1) return undefined
  const feed = matchingFeeds[0]!
  const handoffs = assemblies.flatMap((assembly) => assembly.loadHandoffs.flatMap((handoff) =>
    handoff.target.kind === 'panel-bus-input' &&
    handoff.target.panelId === segment.panelId &&
    handoff.target.busSectionId === segment.busSectionId
      ? [{ assembly, handoff }] : []))
  if (handoffs.length > 1) return undefined
  const owner = handoffs[0]
  const changeover = owner?.assembly.nodes.find((node) => node.kind === 'changeover-switch')
  const changeoverLoad = !!changeover && !!owner && owner.assembly.connections.some((connection) =>
    connection.domain === 'AC' && connection.pathRole === 'load-ac' &&
    connection.endpoints[1].nodeId === owner.handoff.handoffNodeId)
  const changeoverPanelFeed = changeoverLoad && !!changeover?.deviceId
  const feedRun = (role: string, ends: string[]) => deriveWireAnchorKey({
    kind: 'feed-run', feedPathId: feed.id,
    runKey: `supply:${segment.panelId}:${role}:${ends.sort().join('<>')}`,
  })
  // The upper piece is the physical device→bus connection. The lower piece
  // is its source→device connection, even though the drawing runs downward.
  if (segment.id.startsWith('bus-feed-stub-')) {
    if (changeoverLoad) return feedRun('changeover-load', [
      `changeover:${changeover!.deviceId ?? changeover!.id}:load`, `device:${deviceId}`,
    ])
    const incoming = owner?.assembly.connections.filter((connection) =>
      connection.endpoints.some((endpoint) => endpoint.nodeId === owner.handoff.handoffNodeId)) ?? []
    return incoming.length === 1
      ? deriveWireAnchorKey({ kind: 'supply-connection',
          assemblyId: owner!.assembly.id, connectionId: incoming[0]!.id })
      : undefined
  }
  if (segment.fromElementId && segment.toElementId) return feedRun(
    changeoverPanelFeed ? 'changeover-load' : 'serial',
    [`device:${segment.fromElementId}`, `device:${segment.toElementId}`]
  )
  return feedRun(changeoverPanelFeed ? 'changeover-load' : 'serial', [
    `device:${deviceId}`,
    changeoverPanelFeed ? `backup-bus:${segment.busSectionId}` : `panel-bus:${segment.panelId}`,
  ])
}

function assemblyHandoffWireAnchor(
  segment: WireSegment,
  installation: Installation | undefined
): string | undefined {
  if (!segment.busSectionId ||
    !segment.supplySectionKey?.includes(':changeover-load:')) return undefined
  const feeds = installation?.feedTopology?.rootFeeds.filter((feed) =>
    feed.panelId === segment.panelId && feed.busSectionId === segment.busSectionId) ?? []
  if (feeds.length !== 1) return undefined
  const receiving = [...(feeds[0]!.trunkDevices ?? [])]
    .filter((device) => device.supplyPanelInput)
    .sort((left, right) => left.trunkPosition - right.trunkPosition)[0]
  const changeoverId = segment.supplySectionKey.match(/<>changeover:([^:]+):load$/)?.[1]
  if (!receiving || !changeoverId) return undefined
  return deriveWireAnchorKey({ kind: 'feed-run', feedPathId: feeds[0]!.id,
    runKey: `supply:${segment.panelId}:changeover-load:${[
      `changeover:${changeoverId}:load`, `device:${receiving.id}`,
    ].sort().join('<>')}` })
}

function sharedGridWireAnchor(
  segment: WireSegment,
  panels: readonly Panel[],
  installation: Installation | undefined
): string | undefined {
  const section = segment.supplySectionKey?.split(':changeover-shared-grid:')[1]
  if (!section || !installation?.feedTopology) return undefined
  const feeds = installation.feedTopology.rootFeeds.filter((feed) => feed.panelId === segment.panelId)
  if (feeds.length !== installation.feedTopology.rootFeeds.length) return undefined
  const primarySectionId = panels.find((panel) => panel.id === segment.panelId)?.primaryBusSectionId
  const feed = feeds.find((candidate) => candidate.busSectionId === primarySectionId) ?? feeds[0]
  if (!feed) return undefined
  const endpoints = section.split('<>')
  if (endpoints.length !== 2 || !endpoints.every((token) =>
    token.startsWith('device:') || token.startsWith('utility:'))) return undefined
  const tokens = endpoints.map((token) => token.startsWith('utility:')
    ? `utility:${segment.panelId}` : token).sort()
  return deriveWireAnchorKey({ kind: 'feed-run', feedPathId: feed.id,
    runKey: `supply:${segment.panelId}:serial:${tokens.join('<>')}` })
}

/** Resolve electrical identity, never geometry or a generated segment id. */
export function stampWireSegmentAnchors(
  segments: WireSegment[],
  panels: Panel[],
  installation?: Installation,
  supplyAssemblies: readonly OffGridSupplyAssembly[] = []
): void {
  const buses = buildWireBusIndex(panels)
  const trunks = new Set<string>()
  const circuits = new Map<string, Circuit>()
  const visit = (panel: Panel) => {
    for (const circuit of [
      ...(panel.circuits ?? []),
      ...panel.protections.flatMap((p) => p.circuits ?? []),
    ]) {
      circuits.set(circuit.id, circuit)
      for (const device of [
        ...(circuit.trunkDevices ?? []),
        ...(circuit.branches ?? []).flatMap((b) => b.branchDevices ?? []),
      ]) {
        trunks.add(`${circuit.id}:${device.id}`)
      }
    }
    panel.subPanels?.forEach(visit)
  }
  panels.forEach(visit)
  for (const segment of segments) {
    segment.wireAnchor ??= splitBusFeedAnchor(segment, installation, supplyAssemblies)
    segment.wireAnchor ??= assemblyHandoffWireAnchor(segment, installation)
    segment.wireAnchor ??= sharedGridWireAnchor(segment, panels, installation)
    const busGroup =
      segment.type === 'mainBus' && segment.busSectionId
        ? `panel-bus:${segment.panelId}:${segment.busSectionId}`
        : segment.type === 'mainBus' && segment.circuitId
          ? `circuit-bus:${segment.circuitId}`
          : (segment.type === 'trunk' || segment.toElementType === 'secondaryBus') &&
              segment.fromElementType === 'rcd' &&
              segment.fromElementId
            ? `protection-bus:${segment.fromElementId}`
            : undefined
    if (busGroup) {
      const defaultCable = buses.cableByGroup.get(busGroup)
      if (defaultCable) segment.cable = defaultCable
      segment.wireBusGroup = busGroup
      segment.wireAnchors = buses.membersByGroup.get(busGroup) ?? []
      continue
    }
    const tapGroup = segment.toElementId
      ? buses.groupByProtection.get(segment.toElementId)
      : undefined
    if (tapGroup && !segment.isSubPanelSupply) {
      const defaultCable = buses.cableByGroup.get(tapGroup)
      const override = segment.circuitId
        ? circuits
            .get(segment.circuitId)
            ?.sectionWireOverrides?.find(
              (candidate) =>
                candidate.toElementId === segment.toElementId &&
                candidate.toElementType === segment.toElementType &&
                (candidate.domain ?? 'AC') === (segment.domain ?? 'AC')
            )
        : undefined
      if (defaultCable && !override?.cable) segment.cable = defaultCable
    }
    if (segment.wireAnchor) {
      segment.wireAnchors = [segment.wireAnchor]
      continue
    }
    if (segment.supplyAssemblyId && segment.supplyConnectionId) {
      segment.wireAnchor = deriveWireAnchorKey({
        kind: 'supply-connection',
        assemblyId: segment.supplyAssemblyId,
        connectionId: segment.supplyConnectionId,
      })
    } else if (
      !segment.circuitId &&
      segment.fromElementType !== 'ground' &&
      segment.type !== 'mainBus' &&
      (segment.isSupplyTrunk || segment.supplyWireRole) &&
      !segment.supplySectionKey
    ) {
      const feed = installation?.feedTopology?.rootFeeds.find((f) => f.panelId === segment.panelId)
      if (feed) {
        const ends = [`panel-bus:${segment.panelId}`, `utility:${segment.panelId}`].sort()
        segment.wireAnchor = deriveWireAnchorKey({
          kind: 'feed-run',
          feedPathId: feed.id,
          runKey: `supply:${segment.panelId}:serial:${ends.join('<>')}`,
        })
      }
    } else if (segment.supplySectionKey) {
      const feed = installation?.feedTopology?.rootFeeds.find((f) => f.panelId === segment.panelId)
      if (feed)
        segment.wireAnchor = deriveWireAnchorKey({
          kind: 'feed-run',
          feedPathId: feed.id,
          runKey: segment.supplySectionKey,
        })
    } else if (segment.circuitId && segment.toElementId &&
      trunks.has(`${segment.circuitId}:${segment.toElementId}`)) {
      segment.wireAnchor = deriveWireAnchorKey({
        kind: 'circuit-section',
        circuitId: segment.circuitId,
        nodeRef: `trunk-device:${segment.toElementId}`,
        domain: segment.domain,
      })
    } else if (segment.circuitId && segment.converterDcConnection && !segment.toElementId) {
      const { converterId, connectionIndex } = segment.converterDcConnection
      segment.wireAnchor = deriveWireAnchorKey({
        kind: 'circuit-section',
        circuitId: segment.circuitId,
        nodeRef: `open-end:converter:${converterId}:dc-${connectionIndex}`,
        domain: 'DC',
      })
    } else if (
      segment.toElementId &&
      (segment.toElementType === 'protection' || segment.toElementType === 'rcd')
    ) {
      segment.wireAnchor = deriveWireAnchorKey({
        kind: 'protection-input',
        panelId: segment.panelId,
        protectionId: segment.toElementId,
        domain: segment.domain,
      })
    } else if (segment.circuitId && segment.toElementId && segment.toElementType === 'endpoint') {
      const kind = trunks.has(`${segment.circuitId}:${segment.toElementId}`)
        ? 'trunk-device'
        : 'endpoint'
      segment.wireAnchor = deriveWireAnchorKey({
        kind: 'circuit-section',
        circuitId: segment.circuitId,
        nodeRef: `${kind}:${segment.toElementId}`,
        domain: segment.domain,
      })
    }
    if (segment.wireAnchor) segment.wireAnchors = [segment.wireAnchor]
    // A shared vertical stem may depict several outgoing connections. Retain ALL identities;
    // never select or edit an arbitrary first branch.
    if (
      !segment.wireAnchor &&
      segment.circuitId &&
      segment.type === 'vertical' &&
      !segment.toElementId &&
      segment.fromElementId
    ) {
      const circuit = circuits.get(segment.circuitId)
      if (!circuit) continue
      const lastTrunk = [...(circuit.trunkDevices ?? [])]
        .sort((a, b) => a.trunkPosition - b.trunkPosition)
        .at(-1)
      if (lastTrunk && segment.fromElementId !== lastTrunk.id) continue
      const sharedBranches = (circuit.branches?.length ?? 0) > 1
      const targets = (circuit.branches ?? [])
        .filter((b) => !b.dcBusId)
        .flatMap((b) => {
          const all = [
            ...(b.branchDevices ?? []).map((device) => `trunk-device:${device.id}`),
            ...b.endpointIds.map((id) => `endpoint:${id}`),
          ]
          return sharedBranches ? all : all.slice(0, 1)
        })
      if (circuit.subCircuitIds?.length) targets.push(`bus-section:secondary-bus:${circuit.id}`)
      segment.wireAnchors = [...new Set(targets)].map((nodeRef) =>
        deriveWireAnchorKey({
          kind: 'circuit-section',
          circuitId: circuit.id,
          nodeRef,
          domain: segment.domain,
        })
      )
      if (segment.wireAnchors.length === 1) segment.wireAnchor = segment.wireAnchors[0]
    }
  }
}

/** Authored run values apply to every visual piece of the connection, including export. */
export function applyWireRunsToSegments(segments: WireSegment[], runs: readonly WireRun[]): void {
  for (const segment of segments) {
    const anchors = segment.wireAnchor
      ? [segment.wireAnchor]
      : segment.wireAnchors ?? []
    if (!anchors.length) continue
    const run = findWireRunForAnchor(runs, anchors[0]!)
    if (!run || !anchors.every((anchor) => findWireRunForAnchor(runs, anchor)?.id === run.id))
      continue
    segment.cable = { ...run.cable }
    segment.wireRoute = run.route
    segment.inTube = run.inTube
    segment.inWall = run.route === 'wall' && run.inWall !== false
    segment.wireLengthM = segment.wireAnchor ? run.segmentLengths?.[segment.wireAnchor] : undefined
    if (run.labels?.hideWireLabel !== undefined) segment.hideWireLabel = run.labels.hideWireLabel
    if (run.labels?.showFireClassLabel !== undefined)
      segment.showFireClassLabel = run.labels.showFireClassLabel
    if (run.labels?.showWireLengthLabel !== undefined)
      segment.showWireLengthLabel = run.labels.showWireLengthLabel
  }
}
