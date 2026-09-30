import { buildWireBusIndex } from '@/lib/wires/wireBusIndex'
import { asRailCable, isSecondaryBusFeederAnchor, railRunByGroup } from '@/lib/wires/railWireRuns'
import {
  isProjectDefaultCableAnchor,
  isSeededCircuitCable,
  resolveProjectDefaultCableKind,
  withProjectDefaultCableKind,
} from '@/lib/wires/circuitWireDefaults'
import { circuitWireDomains } from '@/lib/wires/circuitWireIdentity'
import type { CableSpec } from '@/types/schema'
import type { ProjectV2, WireRun } from '@/types/projectV2'
import { deriveWireAnchorKey } from '@/lib/projectV2/wireRuns'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { buildCircuitCableIndex, deriveSeedConductors } from '@/lib/projectV2/wireRunSeed'
import { selectProjectWireRuns, WIRE_RUN_REF_PROPERTY } from '@/lib/projectV2/wireRuns'
import type { ElectricalStructureNode, ElectricalStructureRelationship } from './types'

/**
 * Stamp a wire/busbar summary on every structural edge for the Structural canvas. Authored data
 * wins: persisted {@link WireRun}s (or, before the `2.2.0` migration seeds them, the best-effort
 * legacy seed) are matched by anchor and carry their spec + `wireRef`. Every other edge is filled
 * with a derived default so the graph reads completely — the owning circuit's cable for circuit
 * runs, a busbar for bus taps, the panel root feed / main supply for cross-panel and supply wires,
 * and a PE representation for earthing. The derived defaults are display-only and never persisted.
 */
export function stampTransitionWires(
  project: ProjectV2,
  relationships: ElectricalStructureRelationship[],
  nodes: readonly ElectricalStructureNode[]
): void {
  const authoredRuns = selectProjectWireRuns(project)
  const runByAnchor = new Map<string, WireRun>()
  for (const run of authoredRuns) {
    for (const member of run.members) if (!runByAnchor.has(member)) runByAnchor.set(member, run)
  }

  const panels = getProjectElectricalPanels(project)
  const buses = buildWireBusIndex(panels)
  const rails = railRunByGroup(buses, authoredRuns)
  const domains = circuitWireDomains(panels)
  const circuitCableById = buildCircuitCableIndex(project)
  const installation = getProjectElectricalInstallation(project)
  const mainSupplyCable = installation?.mainSupply?.cable
  const defaultCableKind = resolveProjectDefaultCableKind(installation)
  const rootFeedCableByPanel = new Map<string, CableSpec>()
  for (const feed of installation?.feedTopology?.rootFeeds ?? []) {
    if (feed.cable) rootFeedCableByPanel.set(feed.panelId, feed.cable)
  }
  const groundCable: CableSpec = installation?.groundCable ?? {
    kind: 'VOB',
    conductors: 1,
    sectionMm2: 6,
    hasPE: true,
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const protectionForCircuit = new Map<string, ElectricalStructureNode>()
  for (const rel of relationships) {
    if (rel.kind === 'protects') {
      const protection = nodeById.get(rel.from)
      if (protection) protectionForCircuit.set(rel.to, protection)
    }
  }
  const rootFeeds = installation?.feedTopology?.rootFeeds ?? []
  const sharedDeviceIds = new Set(installation?.feedTopology?.sharedFeed.trunkDevices?.map((device) => device.id) ?? [])
  const serialSupplyAnchor = (
    relationship: ElectricalStructureRelationship
  ): string | undefined => {
    const from = nodeById.get(relationship.from)
    const to = nodeById.get(relationship.to)
    if (!from || !to || from.kind === 'installation') return undefined
    const sharedFeedEdge = (from.kind === 'supply-source' ||
      (from.kind === 'trunk-device' && !!from.source.entityId && sharedDeviceIds.has(from.source.entityId))) &&
      to.kind === 'trunk-device' &&
      !!to.source.entityId &&
      (sharedDeviceIds.has(to.source.entityId) || rootFeeds.some((candidate) =>
        candidate.trunkDevices?.some((device) => device.id === to.source.entityId)))
    const sharedPanelId = rootFeeds.length > 0 && rootFeeds.every((candidate) =>
      candidate.panelId === rootFeeds[0]!.panelId) ? rootFeeds[0]!.panelId : undefined
    const panel = panels.find((candidate) => candidate.id === sharedPanelId)
    const sharedPanelFeed = sharedFeedEdge && sharedPanelId
      ? rootFeeds.find((candidate) => candidate.busSectionId === panel?.primaryBusSectionId) ?? rootFeeds[0]
      : undefined
    const feed =
      rootFeeds.find((f) => f.panelId === to.panelId || f.panelId === from.panelId) ??
      sharedPanelFeed ?? (rootFeeds.length === 1 ? rootFeeds[0] : undefined)
    if (!feed) return undefined
    const token = (node: ElectricalStructureNode) =>
      node.kind === 'supply-source'
        ? `utility:${feed.panelId}`
        : node.kind === 'panel' || node.kind === 'bus-section'
          ? `panel-bus:${feed.panelId}`
          : node.kind === 'trunk-device' && node.source.entityId
            ? `device:${node.source.entityId}`
            : undefined
    const first = token(from),
      second = token(to)
    return first && second
      ? deriveWireAnchorKey({
          kind: 'feed-run',
          feedPathId: feed.id,
          runKey: `supply:${feed.panelId}:serial:${[first, second].sort().join('<>')}`,
        })
      : undefined
  }

  // Every node on the earthing chain (earthing source → separators → main), so the whole chain
  // reads as the PE conductor rather than only the final `grounds` edge.
  const groundNodeIds = new Set<string>()
  for (const node of nodes) if (node.kind === 'ground-source') groundNodeIds.add(node.id)
  for (let changed = true; changed; ) {
    changed = false
    for (const relationship of relationships) {
      if (
        relationship.kind === 'ordered-before' &&
        groundNodeIds.has(relationship.from) &&
        !groundNodeIds.has(relationship.to)
      ) {
        groundNodeIds.add(relationship.to)
        changed = true
      }
    }
  }

  // Placeholder busbar spec for bus taps until real bus authoring exists.
  const busbarCable: CableSpec | undefined = mainSupplyCable
    ? {
        kind: 'other',
        customKind: 'busbar',
        conductors: mainSupplyCable.conductors,
        sectionMm2: mainSupplyCable.sectionMm2 >= 16 ? 16 : 10,
        hasPE: false,
      }
    : undefined

  const stampWire = (
    relationship: ElectricalStructureRelationship,
    spec: {
      cable: CableSpec
      conductorCount: number
      anchor: string
      medium?: 'cable' | 'busbar'
      material?: 'copper' | 'aluminium'
      lengthM?: number
      lengthEstimated?: boolean
      wireRefId?: string
      followsDefaultCable?: boolean
    }
  ): void => {
    relationship.properties = {
      ...relationship.properties,
      ...(spec.wireRefId ? { [WIRE_RUN_REF_PROPERTY]: spec.wireRefId } : {}),
      wireAnchor: spec.anchor,
      conductorCount: spec.conductorCount,
      wire: {
        cable: spec.cable,
        conductorCount: spec.conductorCount,
        anchor: spec.anchor,
        ...(spec.medium ? { medium: spec.medium } : {}),
        ...(spec.material ? { material: spec.material } : {}),
        ...(typeof spec.lengthM === 'number' ? { lengthM: spec.lengthM } : {}),
        ...(typeof spec.lengthM === 'number' && spec.lengthEstimated
          ? { lengthEstimated: true }
          : {}),
        ...(spec.followsDefaultCable ? { followsDefaultCable: true } : {}),
      },
    }
  }

  // Precomputed once: scanning every relationship per membership edge is quadratic on large projects.
  const seriallyFedNodeIds = new Set<string>()
  for (const relationship of relationships) {
    if (relationship.kind === 'ordered-before' || relationship.kind === 'branches-to')
      seriallyFedNodeIds.add(relationship.to)
  }

  for (const relationship of relationships) {
    const to = nodeById.get(relationship.to)
    const from = nodeById.get(relationship.from)
    if (!to) continue

    // The breaker→circuit link is not a wire; everything after the breaker is the circuit itself.
    if (relationship.kind === 'protects' || relationship.kind === 'protected-by') continue

    // The in-circuit device this wire feeds. For `belongs-to-circuit` the endpoint is the `from`
    // side (raw edge is endpoint→circuit); for ordered/branch runs it is the `to` side.
    const deviceNode =
      relationship.kind === 'belongs-to-circuit' ? nodeById.get(relationship.from) : to
    const isCircuitWire =
      (relationship.kind === 'ordered-before' ||
        relationship.kind === 'branches-to' ||
        relationship.kind === 'belongs-to-circuit') &&
      Boolean(deviceNode?.circuitId) &&
      Boolean(deviceNode?.source.entityId) &&
      (deviceNode?.kind === 'endpoint' || deviceNode?.kind === 'trunk-device' ||
        (deviceNode?.kind === 'bus-section' && deviceNode.source.entityId?.startsWith('secondary-bus:')))

    // Bus tap — a breaker or a bussed/grouped circuit reached across a primary or secondary bus.
    const isBusTap =
      (relationship.kind === 'feeds' || relationship.kind === 'branches-to') &&
      from?.kind === 'bus-section' &&
      (to.kind === 'protection' || to.kind === 'circuit')

    const isOtherWire =
      relationship.kind === 'ordered-before' ||
      relationship.kind === 'panel-feed' ||
      relationship.kind === 'grounds' ||
      relationship.kind === 'supply-assembly-connection' ||
      relationship.kind === 'supply-handoff'

    if (!isCircuitWire && !isBusTap && !isOtherWire) continue // containment/identity/control: not a wire

    // Membership is not an additional incoming conductor when a serial edge already feeds it.
    if (
      relationship.kind === 'belongs-to-circuit' &&
      seriallyFedNodeIds.has(relationship.from)
    )
      continue

    const inputProtection =
      to.kind === 'circuit'
        ? protectionForCircuit.get(to.id)
        : to.kind === 'protection'
          ? to
          : undefined
    if (isBusTap && inputProtection?.source.entityId)
      relationship.properties = {
        ...relationship.properties,
        wireBusGroup: buses.groupByProtection.get(inputProtection.source.entityId),
      }
    const isGroundWire = relationship.kind === 'grounds' || groundNodeIds.has(relationship.from)
    const isPanelInput =
      relationship.kind === 'panel-feed' &&
      (from?.kind === 'protection' || (from?.kind === 'trunk-device' && from.circuitId))

    // Every wire edge gets a stable anchor so it can be authored as a persisted run. Circuit wires
    // use the canonical circuit-section anchor; other wires use their endpoint node pair.
    const anchorKey =
      isCircuitWire && deviceNode
        ? deriveWireAnchorKey({
            kind: 'circuit-section',
            circuitId: deviceNode.circuitId!,
            nodeRef: `${deviceNode.kind}:${deviceNode.source.entityId}`,
            domain: domains.get(`${deviceNode.circuitId}:${deviceNode.source.entityId}`) ?? 'AC',
          })
        : isBusTap && inputProtection?.panelId && inputProtection.source.entityId
          ? deriveWireAnchorKey({
              kind: 'protection-input',
              panelId: inputProtection.panelId,
              protectionId: inputProtection.source.entityId,
              domain:
                typeof relationship.properties?.domain === 'string'
                  ? relationship.properties.domain
                  : 'AC',
            })
          : isGroundWire
            ? deriveWireAnchorKey({
                kind: 'ground-input',
                nodeRef:
                  to.kind === 'trunk-device'
                    ? `device:${to.source.entityId}`
                    : `panel:${to.panelId ?? to.source.entityId}`,
              })
            : isPanelInput && to.panelId
              ? deriveWireAnchorKey({
                  kind: 'panel-input',
                  panelId: to.panelId,
                  deviceId: to.kind === 'trunk-device' ? to.source.entityId : undefined,
                })
              : typeof relationship.properties?.wireAnchor === 'string'
                ? relationship.properties.wireAnchor
                : (serialSupplyAnchor(relationship) ??
                  `wire:${relationship.from}>${relationship.to}`)

    if (isCircuitWire && deviceNode)
      relationship.properties = {
        ...relationship.properties,
        domain: domains.get(`${deviceNode.circuitId}:${deviceNode.source.entityId}`) ?? 'AC',
      }
    // A persisted run wins for any edge.
    const ownRun = runByAnchor.get(anchorKey)
    const railGroup = buses.groupByAnchor.get(anchorKey)
    if (railGroup) relationship.properties = { ...relationship.properties, wireBusGroup: railGroup }
    const run = railGroup && ownRun?.medium !== 'cable'
      ? rails.get(railGroup) ?? ownRun : ownRun
    const defaultCableEdge = !isBusTap && isProjectDefaultCableAnchor(anchorKey)
    if (run) {
      const railMedium = run.medium === 'busbar' && (isBusTap || isSecondaryBusFeederAnchor(anchorKey))
      const followsDefaultCable = defaultCableEdge && run.followsDefaultCable === true
      stampWire(relationship, {
        cable: followsDefaultCable
          ? withProjectDefaultCableKind(run.cable, defaultCableKind)
          : run.cable,
        followsDefaultCable,
        conductorCount: run.conductors.length,
        anchor: anchorKey,
        medium: railMedium ? 'busbar' : run.medium === 'busbar' ? 'cable' : run.medium,
        material: railMedium ? run.material : undefined,
        lengthM: run.segmentLengthSources?.[anchorKey] === 'estimated-stale' ? undefined : run.segmentLengths?.[anchorKey],
        lengthEstimated: run.segmentLengthSources?.[anchorKey] === 'estimated',
        wireRefId: run.id,
      })
      continue
    }

    // Otherwise derive a default cable/medium for the edge.
    let cable: CableSpec | undefined
    let medium: 'cable' | 'busbar' | undefined
    let material: 'copper' | 'aluminium' | undefined
    if (isBusTap) {
      const group = inputProtection?.source.entityId
        ? buses.groupByProtection.get(inputProtection.source.entityId)
        : undefined
      cable = (group ? buses.cableByGroup.get(group) : undefined) ?? busbarCable
      medium = 'busbar'
      material = 'copper'
    } else if (isSecondaryBusFeederAnchor(anchorKey)) {
      const feederCable = (railGroup ? buses.cableByGroup.get(railGroup) : undefined) ?? circuitCableById.get(deviceNode!.circuitId!)
      cable = feederCable ? asRailCable(feederCable) : undefined
      medium = 'busbar'
      material = 'copper'
    } else if (isCircuitWire && deviceNode) {
      cable = circuitCableById.get(deviceNode.circuitId!)
    } else if (relationship.kind === 'ordered-before' && groundNodeIds.has(relationship.from)) {
      cable = groundCable // Earthing chain (earthing → separators → main): PE conductor.
    } else if (relationship.properties?.emptyCircuitWire === true && to.circuitId) {
      cable = circuitCableById.get(to.circuitId)
    } else if (relationship.kind === 'ordered-before') {
      cable = mainSupplyCable // Supply trunk chain (meter, etc.) upstream of any panel.
    } else if (isPanelInput && from) {
      cable =
        (from.kind === 'protection' && from.source.entityId
          ? buses.cableByProtection.get(from.source.entityId)
          : from.circuitId
            ? circuitCableById.get(from.circuitId)
            : undefined) ?? mainSupplyCable
    } else if (relationship.kind === 'panel-feed') {
      cable = (to.panelId ? rootFeedCableByPanel.get(to.panelId) : undefined) ?? mainSupplyCable
    } else if (relationship.kind === 'grounds') {
      cable = groundCable
    } else {
      cable = mainSupplyCable // supply-assembly connection / handoff
    }
    if (!cable) continue
    const followsDefaultCable = defaultCableEdge && isSeededCircuitCable(cable)

    stampWire(relationship, {
      cable: followsDefaultCable ? withProjectDefaultCableKind(cable, defaultCableKind) : cable,
      followsDefaultCable,
      conductorCount: deriveSeedConductors(cable).length,
      anchor: anchorKey,
      medium,
      material,
    })
  }
}
