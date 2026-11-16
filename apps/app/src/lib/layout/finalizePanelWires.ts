/** Final circuit wire overrides, phase inheritance, enclosure markers and supply section identities. */

import {
  getDomoticaOutputPhaseState,
  getCircuitWirePropertiesForDomain,
  findCircuitByIdInPanel,
} from './circuitWireDerivationSupport'

import type { LayoutNode } from './layoutTree'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import { hasSupplyInlineLabels } from './supplyInlineDeviceLabels'
import type {
  WireSegment,
  Circuit,
  ProtectionDevice,
  TrunkDevice,
  CircuitPhaseAssignment,
} from '@/types/schema'
import { DEFAULT_ELECTRICAL_DOMAIN } from '@/lib/symbols'

import {
  findSectionWireOverride,
  getSectionRefFromWireSegment,
} from '@/lib/wires/sectionWireOverrides'
import {
  formatPhaseAssignment,
  getEffectiveCircuitPhaseState,
  getFullInstallationPhaseAssignment,
  getDownstreamProtectionPhaseAssignment,
  getInheritedCircuitPhaseState,
  isPhaseAssignmentLabelVisible,
} from '@/lib/wires/phaseAssignment'

import { LAYOUT_CONSTANTS } from './bottomUpLayoutConstants'

import { getPrimaryPanelBusSectionId } from '@/lib/panel/panelBusSections'

import type { SupplyConnection } from '@/types/supplyAssembly'
import {
  getAcConnectionPhaseAssignment,
  type PanelWireDerivationInput,
  type SupplyWireAssemblyContext,
} from './deriveSupplyWireAssemblyContext'

type FinalizePanelWiresInput =
  Pick<
    PanelWireDerivationInput,
    | 'panelNode'
    | 'panel'
    | 'panels'
    | 'installation'
    | 'segments'
  > &
  Pick<
    SupplyWireAssemblyContext,
    | 'feedTopology'
    | 'rootFeed'
    | 'propagateSupplySectionsAcrossSimpleJoints'
    | 'supplyAssembly'
    | 'findAssemblyPortConnection'
    | 'getDeviceEnclosureKey'
    | 'explicitlyMarkedConnectionIds'
    | 'explicitlyMarkedBoundaryKeys'
    | 'getBoundaryKey'
    | 'markAssemblyEnclosureBoundaries'
  > &
  {
    supplyNode: LayoutNode | undefined
    renderedSupplyDeviceNodes: LayoutNode[]
    mainBusY: number
    parentMcbNode: LayoutNode | undefined
  }

export function finalizePanelWires(input: FinalizePanelWiresInput): WireSegment[] {
  const {
    panelNode,
    panel,
    panels,
    installation,
    segments,
    feedTopology,
    rootFeed,
    propagateSupplySectionsAcrossSimpleJoints,
    supplyAssembly,
    findAssemblyPortConnection,
    getDeviceEnclosureKey,
    explicitlyMarkedConnectionIds,
    explicitlyMarkedBoundaryKeys,
    getBoundaryKey,
    markAssemblyEnclosureBoundaries,
    supplyNode,
    renderedSupplyDeviceNodes,
    mainBusY,
    parentMcbNode,
  } = input
  // Final pass: enforce per-section overrides on all vertical circuit segments.
  for (const segment of segments) {
    if (segment.type !== 'vertical' || !segment.circuitId) continue
    const circuit =
      findCircuitByIdInPanel(panel, segment.circuitId) ??
      panels
        .map((candidatePanel) => findCircuitByIdInPanel(candidatePanel, segment.circuitId))
        .find((candidate): candidate is Circuit => candidate !== null)
    if (!circuit) continue
    const sectionRef = getSectionRefFromWireSegment(segment)
    const sectionOverride = findSectionWireOverride(circuit, sectionRef)
    if (!sectionOverride) continue
    if (sectionOverride.cable) segment.cable = sectionOverride.cable
    if (sectionOverride.inTube !== undefined) segment.inTube = sectionOverride.inTube
    if (sectionOverride.wireRoute !== undefined) segment.wireRoute = sectionOverride.wireRoute
    if (sectionOverride.inWall !== undefined) segment.inWall = sectionOverride.inWall
    if (sectionOverride.hideWireLabel !== undefined)
      segment.hideWireLabel = sectionOverride.hideWireLabel
    if (sectionOverride.showFireClassLabel !== undefined)
      segment.showFireClassLabel = sectionOverride.showFireClassLabel
    if (sectionOverride.wireLengthM !== undefined) segment.wireLengthM = sectionOverride.wireLengthM
    if (sectionOverride.showWireLengthLabel !== undefined)
      segment.showWireLengthLabel = sectionOverride.showWireLengthLabel
  }

  // Sync fire-class and wire-length label visibility from merged circuit wire properties.
  for (const segment of segments) {
    if (segment.type !== 'vertical' || !segment.circuitId) continue
    const circuit = findCircuitByIdInPanel(panel, segment.circuitId)
    if (!circuit) continue
    const sectionRef = getSectionRefFromWireSegment(segment)
    const wireProps = getCircuitWirePropertiesForDomain(
      circuit,
      segment.domain ?? DEFAULT_ELECTRICAL_DOMAIN,
      sectionRef
    )
    segment.showFireClassLabel = wireProps.showFireClassLabel
    segment.wireLengthM = wireProps.wireLengthM
    segment.showWireLengthLabel = wireProps.showWireLengthLabel
  }

  // Carry the effective phase assignment and label visibility onto every derived
  // segment. Explicit child assignments win; otherwise a concrete lock from a
  // parent circuit feeds the complete nested/secondary-panel chain.
  for (const segment of segments) {
    if (!segment.circuitId) continue
    const circuit =
      findCircuitByIdInPanel(panel, segment.circuitId) ??
      panels
        .map((candidatePanel) => findCircuitByIdInPanel(candidatePanel, segment.circuitId))
        .find((candidate): candidate is Circuit => candidate !== null)
    if (!circuit) continue
    const sectionRef = getSectionRefFromWireSegment(segment)
    const wireProps = getCircuitWirePropertiesForDomain(
      circuit,
      segment.domain ?? DEFAULT_ELECTRICAL_DOMAIN,
      sectionRef
    )
    const inheritedPhaseState = getInheritedCircuitPhaseState(
      circuit,
      panels,
      installation?.nominalVoltage.system,
      installation
    )
    const effectivePhaseState = getEffectiveCircuitPhaseState(
      circuit,
      panels,
      installation?.nominalVoltage.system,
      installation
    )
    const outputPhaseState = getDomoticaOutputPhaseState(circuit, segment,
      segment.isSubPanelSupply ? parentMcbNode?.sourceEndpointForWires : undefined)
    const crossesProtectionBoundary =
      segment.fromElementType === 'protection' || segment.toElementType === 'protection'
    segment.phaseAssignment =
      inheritedPhaseState.assignment ??
      outputPhaseState?.phaseAssignment ??
      (crossesProtectionBoundary
        ? effectivePhaseState.assignment
        : (wireProps.phaseAssignment ?? effectivePhaseState.assignment))
    segment.showPhaseLabel = outputPhaseState?.showPhaseLabel ?? circuit.showPhaseLabel
  }

  // A panel-distribution endpoint is an electrical boundary, so a narrowed
  // phase set must be visible on the feeder that reaches it. Keep this
  // independent from the user's ordinary phase-label preference: on a
  // three-phase installation the annotation is required to make the supplied
  // phases of the downstream panel unambiguous.
  const downstreamPanelFeeders = panel.protections.flatMap((protection) =>
    protection.subPanelId
      ? (protection.circuits ?? []).map((circuit) => ({
          circuitId: circuit.id,
          protectionId: protection.id,
          endpointIds: new Set(
            circuit.endpoints
              .filter((endpoint) => endpoint.symbol === 'panel_distribution')
              .map((endpoint) => endpoint.id)
          ),
        }))
      : []
  )
  for (const feeder of downstreamPanelFeeders) {
    const candidates = segments.filter(
      (segment) =>
        segment.panelId === panel.id &&
        segment.circuitId === feeder.circuitId &&
        segment.toElementType !== 'protection'
    )
    const feederSegment =
      candidates.find(
        (segment) =>
          segment.toElementType === 'endpoint' &&
          !!segment.toElementId &&
          feeder.endpointIds.has(segment.toElementId)
      ) ??
      candidates.find(
        (segment) =>
          segment.toElementType === 'endpoint' ||
          (segment.fromElementType === 'protection' &&
            segment.fromElementId === feeder.protectionId)
      )
    if (feederSegment) {
      feederSegment.forcePhaseLabel = isPhaseAssignmentLabelVisible(
        feederSegment.phaseAssignment,
        installation?.nominalVoltage.system
      )
    }
  }

  // Final pass: normalize sub-panel incoming feeder tagging.
  // In some layout paths the incoming feeder can be derived through the generic
  // vertical-circuit flow, which may omit `isSubPanelSupply`. Mark it
  // consistently so validation/focus can reliably target this wire.
  const parentMcbNodeForTagging = panelNode.children.find((c) => c.id === 'parent-mcb')
  const parentProtection = parentMcbNodeForTagging?.domainRef as ProtectionDevice | undefined
  const parentProtectionId: string | undefined = parentProtection?.id
  const parentSourceEndpointId = parentMcbNodeForTagging?.sourceEndpointForWires?.id
  const parentFeedCircuitId = parentMcbNodeForTagging?.circuitIdForWires ?? parentProtection?.circuits?.[0]?.id
  if (parentProtectionId && parentFeedCircuitId) {
    for (const segment of segments) {
      if (
        segment.type === 'vertical' &&
        segment.panelId === panel.id &&
        segment.circuitId === parentFeedCircuitId &&
        ((segment.fromElementType === 'protection' && segment.fromElementId === parentProtectionId) ||
          (segment.fromElementType === 'endpoint' && segment.fromElementId === parentSourceEndpointId))
      ) {
        segment.isSubPanelSupply = true
        segment.feederProtectionId = parentProtectionId
      }
    }
  }
  for (const segment of segments) {
    if (!segment.isSubPanelSupply) continue
    // Moving the feeder into another enclosure does not select new phases.
    // The source-side protection already identifies the phase set. Only an
    // explicitly enabled caption belongs on the incoming physical cable;
    // do not repeat it on the internal run from a local device to the bus.
    segment.showPhaseLabel = segment.showPhaseLabel === true &&
      (segment.fromElementId === segment.feederProtectionId ||
        (parentSourceEndpointId != null && segment.fromElementId === parentSourceEndpointId))
  }

  if (supplyNode && renderedSupplyDeviceNodes.length > 0) {
    const horizontalDeviceLanes: Array<{
      y: number
      devices: Array<{ x: number; enclosure: string; order: number }>
    }> = []
    for (const node of renderedSupplyDeviceNodes) {
      const device = node.domainRef as TrunkDevice | undefined
      const enclosure = device ? getDeviceEnclosureKey(device) : undefined
      if (!enclosure) continue
      let lane = horizontalDeviceLanes.find(
        (candidate) => Math.abs(candidate.y - node.bounds.y) < 1
      )
      if (!lane) {
        lane = { y: node.bounds.y, devices: [] }
        horizontalDeviceLanes.push(lane)
      }
      lane.devices.push({
        x: node.bounds.x,
        enclosure,
        order: device?.trunkPosition ?? lane.devices.length,
      })
    }
    for (const lane of horizontalDeviceLanes) {
      lane.devices.sort((left, right) => left.x - right.x)
      for (let index = 0; index < lane.devices.length - 1; index++) {
        const left = lane.devices[index]!
        const right = lane.devices[index + 1]!
        if (left.enclosure === right.enclosure) continue
        const candidates = segments.filter((segment) => {
          if (!segment.isSupplyTrunk || segment.type !== 'branch') return false
          if (
            Math.abs(segment.startPoint.y - lane.y) >= 1 ||
            Math.abs(segment.endPoint.y - lane.y) >= 1
          ) {
            return false
          }
          const centerX = (segment.startPoint.x + segment.endPoint.x) / 2
          return centerX > left.x && centerX < right.x
        })
        const markerSegment = candidates.reduce<WireSegment | undefined>((best, candidate) => {
          if (!best) return candidate
          const candidateCenter = (candidate.startPoint.x + candidate.endPoint.x) / 2
          const bestCenter = (best.startPoint.x + best.endPoint.x) / 2
          return candidateCenter > bestCenter ? candidate : best
        }, undefined)
        if (markerSegment) {
          markerSegment.supplyEnclosureBoundary = true
          // Lower trunk positions sit closer to the grid connection.
          const [upstream, downstream] = left.order <= right.order ? [left, right] : [right, left]
          markerSegment.enclosureTransition = {
            from: upstream.enclosure,
            to: downstream.enclosure,
          }
          const midpointX = (left.x + right.x) / 2
          markerSegment.supplySeparatorX = Math.max(
            midpointX,
            right.x - LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
          )
          explicitlyMarkedBoundaryKeys.add(getBoundaryKey(left.enclosure, right.enclosure))
          if (markerSegment.supplyConnectionId) {
            explicitlyMarkedConnectionIds.add(markerSegment.supplyConnectionId)
          }
        }
      }
    }
  }
  markAssemblyEnclosureBoundaries()
  propagateSupplySectionsAcrossSimpleJoints()
  if (installation) {
    // The shared utility run is physically upstream of the assembly graph. Its serial
    // protections therefore need a geometry-ordered phase pass of their own. Derive a
    // device's center from the wire gaps on both sides so this also covers shared-feed
    // devices that are not represented as ordinary panel layout children.
    const allSupplyDevices = new Map(
      [
        ...(installation.mainSupply.supplyTrunkDevices ?? []),
        ...(feedTopology?.sharedFeed.trunkDevices ?? []),
        ...(rootFeed?.trunkDevices ?? []),
      ].map((device) => [device.id, device])
    )
    const serialProtectionPositions = Array.from(allSupplyDevices.values())
      .filter(
        (device) =>
          device.type === 'protection' &&
          (device.supplyPath == null || device.supplyPath === 'serial')
      )
      .map((device) => {
        const adjacentXs = segments
          .filter(
            (segment) =>
              segment.domain !== 'DC' && segment.supplySectionKey?.includes(`device:${device.id}`)
          )
          .flatMap((segment) => [segment.startPoint.x, segment.endPoint.x])
          .sort((left, right) => left - right)
        if (adjacentXs.length === 0) return undefined
        const middle = adjacentXs.length / 2
        const x =
          adjacentXs.length % 2 === 0
            ? (adjacentXs[middle - 1]! + adjacentXs[middle]!) / 2
            : adjacentXs[Math.floor(middle)]!
        return { device, x }
      })
      .filter((candidate): candidate is { device: TrunkDevice; x: number } => !!candidate)
      .sort((left, right) => right.x - left.x)
    // The changeover's output carries only the conductors it switches.
    const changeoverSwitchNode = supplyAssembly?.nodes.find(
      (node) => node.kind === 'changeover-switch'
    )
    const changeoverLoadConnection = changeoverSwitchNode
      ? findAssemblyPortConnection(changeoverSwitchNode.id, 'load')
      : undefined
    const changeoverLoadAssignment =
      (changeoverLoadConnection && getAcConnectionPhaseAssignment(changeoverLoadConnection)) ??
      getFullInstallationPhaseAssignment(installation.nominalVoltage.system)
    for (const segment of segments) {
      const isChangeoverLoadSegment = segment.supplySectionKey?.includes(':changeover-load:')
      if (segment.supplyConnectionId && !isChangeoverLoadSegment) continue
      if (
        !segment.supplySectionKey?.includes(':changeover-shared-grid:') &&
        !segment.supplySectionKey?.includes(':direct-grid:') &&
        !segment.supplySectionKey?.includes(':changeover-load:')
      ) {
        continue
      }
      const sampleX = (segment.startPoint.x + segment.endPoint.x) / 2
      segment.phaseAssignment = serialProtectionPositions
        .filter((candidate) =>
          isChangeoverLoadSegment
            ? candidate.x < sampleX ||
              segment.supplySectionKey?.includes(`device:${candidate.device.id}`) === true
            : candidate.x > sampleX
        )
        .reduce(
          (assignment, candidate) =>
            getDownstreamProtectionPhaseAssignment(
              candidate.device,
              installation.nominalVoltage.system,
              assignment
            ),
          isChangeoverLoadSegment
            ? changeoverLoadAssignment
            : getFullInstallationPhaseAssignment(installation.nominalVoltage.system)
        )
    }

    const phaseSignature = (assignment: CircuitPhaseAssignment | undefined) =>
      assignment?.phases.filter((phase) => phase !== 'PE').join('|') ?? ''
    const connectionSignature = (connection: SupplyConnection | undefined) =>
      connection?.conductors
        .filter(
          (phase): phase is 'L1' | 'L2' | 'L3' | 'N' =>
            phase === 'L1' || phase === 'L2' || phase === 'L3' || phase === 'N'
        )
        .join('|') ?? ''
    const distanceToPoint = (segment: WireSegment, point: { x: number; y: number }) =>
      Math.min(
        Math.hypot(segment.startPoint.x - point.x, segment.startPoint.y - point.y),
        Math.hypot(segment.endPoint.x - point.x, segment.endPoint.y - point.y)
      )
    // Text is drawn rightwards from the anchor, which is mirrored with the wires afterwards:
    // in a mirrored frame the anchor must be the label's far edge for it to stay beside the device.
    const phaseLabelLeftX = (nearX: number, labelBeforeDevice: boolean, segment: WireSegment) => {
      if (panelNode.horizontalMirrorAxisX == null) return labelBeforeDevice ? nearX - 53 : nearX + 5
      const width = measureSymbolLabelTextWidth(
        formatPhaseAssignment(segment.phaseAssignment!),
        'Figtree',
        8
      )
      return labelBeforeDevice ? nearX - 5 : nearX + 5 + width
    }
    const markPhaseTransition = (
      candidates: WireSegment[],
      devicePoint: { x: number; y: number }
    ) => {
      const labelSegment = candidates
        .filter((segment) => !!phaseSignature(segment.phaseAssignment))
        .sort(
          (left, right) => distanceToPoint(left, devicePoint) - distanceToPoint(right, devicePoint)
        )[0]
      if (!labelSegment) return
      const startDistance = Math.hypot(
        labelSegment.startPoint.x - devicePoint.x,
        labelSegment.startPoint.y - devicePoint.y
      )
      const endDistance = Math.hypot(
        labelSegment.endPoint.x - devicePoint.x,
        labelSegment.endPoint.y - devicePoint.y
      )
      const near = startDistance <= endDistance ? labelSegment.startPoint : labelSegment.endPoint
      const far = startDistance <= endDistance ? labelSegment.endPoint : labelSegment.startPoint
      const horizontal = Math.abs(far.y - near.y) < 0.01
      labelSegment.forcePhaseLabel = true
      // Devices without a caption under them (meters, inverters) carry their name and
      // notes above the wire, so the transition label goes below it. Protections caption
      // their ratings below, which keeps their transition label above.
      const transitionDevice = renderedSupplyDeviceNodes.find(
        (layoutNode) =>
          layoutNode.bounds.x === devicePoint.x && layoutNode.bounds.y === devicePoint.y
      )?.domainRef as TrunkDevice | undefined
      const labelBelowWire = transitionDevice != null && !hasSupplyInlineLabels(transitionDevice)
      // Keep the mandatory transition label beside the device, never in the middle of
      // the run where cable and routing properties are drawn.
      labelSegment.phaseLabelAnchor = horizontal
        ? {
            x: phaseLabelLeftX(near.x, far.x < near.x, labelSegment),
            y: labelBelowWire ? near.y + 6 : near.y - 20,
          }
        : {
            x: near.x - 53,
            y: far.y < near.y ? near.y - 12 : near.y + 4,
          }
    }

    // Shared/root serial protections are not always graph nodes. Mark only the first
    // section after the device when that device itself changes the available phases.
    let serialInputAssignment = getFullInstallationPhaseAssignment(
      installation.nominalVoltage.system
    )
    for (const candidate of serialProtectionPositions) {
      const serialOutputAssignment = getDownstreamProtectionPhaseAssignment(
        candidate.device,
        installation.nominalVoltage.system,
        serialInputAssignment
      )
      if (phaseSignature(serialOutputAssignment) !== phaseSignature(serialInputAssignment)) {
        const node = renderedSupplyDeviceNodes.find(
          (layoutNode) => layoutNode.domainId === candidate.device.id
        )
        const downstreamSegments = segments.filter(
          (segment) =>
            segment.supplySectionKey?.includes(`device:${candidate.device.id}`) === true &&
            segment.domain !== 'DC' &&
            phaseSignature(segment.phaseAssignment) === phaseSignature(serialOutputAssignment) &&
            (segment.startPoint.x + segment.endPoint.x) / 2 < candidate.x
        )
        markPhaseTransition(downstreamSegments, {
          x: node?.bounds.x ?? candidate.x,
          y: node?.bounds.y ?? downstreamSegments[0]?.startPoint.y ?? mainBusY,
        })
      }
      serialInputAssignment = serialOutputAssignment
    }

    // Graph-backed protections and inverters have explicit input/output connections.
    // A phase annotation belongs to the outgoing physical section only when the node
    // changes the phase set (narrowing or widening).
    if (supplyAssembly) {
      // Multiplied inverter units are rendered as one collapsed physical device. Use
      // the same unioned connection that renders that device when deciding whether a
      // phase transition exists; comparing one internal unit at a time creates false
      // full-phase labels on otherwise unchanged three-phase runs.
      const connectionAtPort = (nodeId: string, portId: string) =>
        findAssemblyPortConnection(nodeId, portId)
      const markConnectionTransition = (connection: SupplyConnection, nodeId: string) => {
        const node = renderedSupplyDeviceNodes.find((candidate) => candidate.domainId === nodeId)
        const candidates = segments.filter(
          (segment) => segment.supplyConnectionId === connection.id
        )
        markPhaseTransition(candidates, {
          x: node?.bounds.x ?? candidates[0]?.startPoint.x ?? 0,
          y: node?.bounds.y ?? candidates[0]?.startPoint.y ?? 0,
        })
      }
      // A changeover switching fewer conductors than the grid names them right after it.
      const fullAssignment = getFullInstallationPhaseAssignment(installation.nominalVoltage.system)
      if (
        changeoverSwitchNode &&
        fullAssignment &&
        changeoverLoadConnection &&
        connectionSignature(changeoverLoadConnection) &&
        connectionSignature(changeoverLoadConnection) !== phaseSignature(fullAssignment)
      ) {
        const loadEndpoint = `changeover:${changeoverSwitchNode.deviceId ?? changeoverSwitchNode.id}:load`
        const node = renderedSupplyDeviceNodes.find(
          (candidate) => candidate.domainId === (changeoverSwitchNode.deviceId ?? changeoverSwitchNode.id)
        )
        const candidates = segments.filter(
          (segment) =>
            segment.supplySectionKey?.includes(':changeover-load:') === true &&
            segment.supplySectionKey.includes(loadEndpoint) &&
            segment.domain !== 'DC'
        )
        if (node) markPhaseTransition(candidates, { x: node.bounds.x, y: node.bounds.y })
      }
      for (const node of supplyAssembly.nodes) {
        if (node.kind === 'protection') {
          const input = connectionAtPort(node.id, 'source')
          const output = connectionAtPort(node.id, 'load')
          if (input && output && connectionSignature(input) !== connectionSignature(output)) {
            markConnectionTransition(output, node.deviceId ?? node.id)
          }
          continue
        }
        if (node.kind !== 'inverter-unit') continue
        const gridPort = node.ports.find((port) => port.role === 'inverter-grid-ac')
        const backupPort = node.ports.find((port) => port.role === 'inverter-backup-ac')
        const input = gridPort ? connectionAtPort(node.id, gridPort.id) : undefined
        const output = backupPort ? connectionAtPort(node.id, backupPort.id) : undefined
        if (input && output && connectionSignature(input) !== connectionSignature(output)) {
          markConnectionTransition(output, node.deviceId ?? node.id)
        }
      }
    }

    // Do not force labels merely because a downstream section remains limited. The
    // actual transition above is mandatory; subsequent wires retain the electrical
    // phase assignment without repeatedly annotating it. Explicit bus, panel-handoff,
    // and differing changeover-input labels are assigned at their own boundaries.
  }
  const primaryBusSectionId = getPrimaryPanelBusSectionId(panel)
  for (const segment of segments) {
    if (
      !segment.busSectionId &&
      segment.supplyWireRole === 'downstream' &&
      segment.supplyFeedScope === 'root'
    ) {
      segment.busSectionId = primaryBusSectionId
    }
    if (!supplyAssembly || !segment.supplyConnectionId) continue
    const connection = supplyAssembly.connections.find(
      (candidate) => candidate.id === segment.supplyConnectionId
    )
    const handoff = supplyAssembly.loadHandoffs.find((candidate) =>
      connection?.endpoints.some(({ nodeId }) => nodeId === candidate.handoffNodeId)
    )
    if (handoff?.target.kind === 'panel-bus-input' && handoff.target.panelId === panel.id) {
      segment.busSectionId = handoff.target.busSectionId
    }
  }
  return segments
}
