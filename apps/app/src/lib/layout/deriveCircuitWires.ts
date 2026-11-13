/** Circuit-level wire derivation, keeping recursive DC-bus and branch traversal together. */
import { deriveWireAnchorKey } from '@/lib/projectV2/wireRuns'
import { deriveSavedForkWires } from './deriveSavedForkWires'
import { logger } from '@/lib/logger'
import { generateId } from '@/utils'
import type { LayoutNode } from './layoutTree'
import type {
  WireSegment,
  Point2,
  Circuit,
  Panel,
  Installation,
  Endpoint,
  ProtectionDevice,
  TrunkDevice,
} from '@/types/schema'
import { resolveSymbolPortsForWire, DEFAULT_ELECTRICAL_DOMAIN } from '@/lib/symbols'
import { getDomoticaEndpointInputDomain } from '@/lib/eendraad/domoticaOutputOrdering'
import { isDomoticaPanelFeedEndpoint } from '@/lib/eendraad/panelSupplyLink'
import { createDefaultAcCircuitCable, ensurePanelBusCableMinimum } from '@/lib/wires/circuitWireDefaults'
import {
  findSectionWireOverrideWithFeederFallback,
  findSubPanelFeederWireOverride,
  type CircuitSectionRef,
} from '@/lib/wires/sectionWireOverrides'
import { getMainBusProtectionPhaseAssignment } from '@/lib/wires/phaseAssignment'
import {
  LAYOUT_CONSTANTS,
  hasPanelAttachmentOnSecondaryBus,
  isPanelOnlySubPanelFeeder,
} from './bottomUpLayout'
import { applyWireInset } from './wireInsets'
import { CIRCUIT_WIRE_LABEL_BASE_SPAN, TERMINAL_STRIP_WIRE_LABEL_SPAN } from './trunkDeviceSpacing'
import { isSharedJunctionSymbol } from '@/lib/junctionIdentity'
import {
  DOMOTICA_BRANCH_LEAD,
  DOMOTICA_BOX_WIDTH,
  DOMOTICA_MAX_ENDPOINT_OUTPUTS,
  DOMOTICA_MIN_ENDPOINT_OUTPUTS,
  DOMOTICA_OUTPUT_SPACING,
} from '@/lib/domoticaLayout'
import {
  CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD,
  getCircuitConverterBodyGeometry,
  getCircuitConverterDcConnectionCount,
  supportsCircuitConverterDcConnections,
} from './circuitConverterGeometry'
import type { SupplyConnection } from '@/types/supplyAssembly'
import {
  shouldLabelSecondaryBusSegment,
  getCircuitDisplayLabel,
  applyNodeWireInset,
  getNodeConnectionAnchor,
  getTrunkDomainAfterNode,
  getCircuitWirePropertiesForDomain,
  getCircuitWirePropertiesFromResolvedOverride,
  resolveDomoticaOutputWireProperties,
  findCircuitForProtection,
  findCircuitByIdInPanel,
} from './circuitWireDerivationSupport'

/**
 * Derive wires for an RCD node
 */
export function deriveRcdWires(
  rcdNode: LayoutNode,
  panel: Panel,
  mainBusY: number,
  phaseSystem?: Installation['nominalVoltage']['system']
): WireSegment[] {
  const segments: WireSegment[] = []
  const rcdY = rcdNode.bounds.y
  // bounds.x IS the center of the RCD symbol (from bottomUpLayout position.x)
  const rcdX = rcdNode.bounds.x

  const protection = rcdNode.domainRef as ProtectionDevice | undefined
  const phaseAssignment = protection
    ? getMainBusProtectionPhaseAssignment(panel, protection, phaseSystem)
    : undefined
  const cable = ensurePanelBusCableMinimum(protection?.circuits?.[0]?.cable)

  // Vertical from main bus to RCD
  const busToRcd = { x: rcdX, y: mainBusY }
  const rcdPoint = { x: rcdX, y: rcdY }
  segments.push({
    id: generateId(),
    type: 'vertical',
    startPoint: busToRcd,
    endPoint: applyNodeWireInset(rcdPoint, busToRcd, rcdNode),
    cable,
    panelId: panel.id,
    domain: DEFAULT_ELECTRICAL_DOMAIN,
    phaseAssignment,
    fromElementType: 'mainBus',
    toElementType: 'rcd',
    toElementId: protection?.id,
  })

  // Find secondary bus (trunk) child
  const secondaryBusNode = rcdNode.children.find((c) => c.type === 'secondaryBus')
  if (secondaryBusNode) {
    const trunkY = secondaryBusNode.bounds.y

    // Vertical from RCD to trunk
    const rcdToTrunk = { x: rcdX, y: trunkY }
    segments.push({
      id: generateId(),
      type: 'vertical',
      startPoint: applyNodeWireInset({ x: rcdX, y: rcdY }, rcdToTrunk, rcdNode),
      endPoint: rcdToTrunk,
      cable,
      panelId: panel.id,
      domain: DEFAULT_ELECTRICAL_DOMAIN,
      phaseAssignment,
      fromElementType: 'rcd',
      fromElementId: protection?.id,
      toElementType: 'secondaryBus',
    })

    // Trunk wire (horizontal), split into sections between each MCB on the trunk
    const trunkStartX = secondaryBusNode.bounds.x
    const trunkEndX = secondaryBusNode.bounds.x + secondaryBusNode.bounds.width
    const mcbXs: number[] = secondaryBusNode.children
      .filter((child) => child.type === 'mcb')
      .map((child) => child.bounds.x)
      .sort((a, b) => a - b)
    const secondaryBusReferenceLabel = (protection?.label ?? '').trim()

    const trunkWaypoints: number[] = [trunkStartX, ...mcbXs, trunkEndX]

    for (let i = 0; i < trunkWaypoints.length - 1; i++) {
      const startX = trunkWaypoints[i]!
      const endX = trunkWaypoints[i + 1]!
      if (endX <= startX) continue

      segments.push({
        id: generateId(),
        type: 'trunk',
        startPoint: { x: startX, y: trunkY },
        endPoint: { x: endX, y: trunkY },
        cable,
        panelId: panel.id,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
        phaseAssignment,
        fromElementType: 'rcd',
        fromElementId: protection?.id,
        ...(secondaryBusReferenceLabel
          ? { secondaryBusReferenceExportLabel: secondaryBusReferenceLabel }
          : {}),
        ...(secondaryBusReferenceLabel && shouldLabelSecondaryBusSegment(i, mcbXs.length)
          ? { secondaryBusReferenceLabel }
          : {}),
      })
    }

    // Process MCB children of secondary bus
    for (const mcbChild of secondaryBusNode.children) {
      if (mcbChild.type === 'mcb') {
        const mcbSegments = deriveMcbWires(mcbChild, panel, mainBusY, secondaryBusNode)
        segments.push(...mcbSegments)
      }
    }
  }

  return segments
}

/**
 * Derive wires for an MCB node
 */
function deriveCircuitConverterDcConnectionWires(
  converterNode: LayoutNode,
  circuit: Circuit,
  panel: Panel
): WireSegment[] {
  const device = converterNode.domainRef as TrunkDevice | undefined
  if (!device || !supportsCircuitConverterDcConnections(device)) return []
  const anchor = converterNode.connectionAnchor ?? {
    x: converterNode.bounds.x,
    y: converterNode.bounds.y,
  }
  const geometry = getCircuitConverterBodyGeometry(device, anchor)
  const wireProps = getCircuitWirePropertiesForDomain(circuit, 'DC')
  const result: WireSegment[] = []

  for (const branchNode of converterNode.children.filter((child) => child.type === 'branch')) {
    const connection = branchNode.hitZone?.converterDcConnection
    if (!connection) continue
    const port = geometry.dcPorts[connection.connectionIndex]
    if (!port) continue
    const rowY = branchNode.bounds.y + branchNode.bounds.height / 2
    const endpointNodes = branchNode.children
      .filter((child) => child.type === 'endpoint' || child.type === 'trunkDevice')
      .sort((a, b) => a.bounds.x - b.bounds.x)
    const isSingleEndpoint = endpointNodes.length === 1
    const verticalEnd = { x: port.x, y: rowY }
    const directNode = endpointNodes[0]
    const directPoint = directNode ? getNodeConnectionAnchor(directNode) : undefined
    const directEndpointEnd = isSingleEndpoint
      ? directNode!.connectionAnchor
        ? directPoint!
        : applyNodeWireInset(directPoint!, port, directNode!)
      : verticalEnd
    result.push({
      id: generateId(),
      type: 'vertical',
      startPoint: port,
      endPoint: directEndpointEnd,
      cable: wireProps.cable,
      panelId: panel.id,
      circuitId: circuit.id,
      domain: 'DC',
      fromElementId: device.id,
      fromElementType: 'endpoint',
      toElementId: endpointNodes[0]?.domainId,
      toElementType: endpointNodes.length > 0 ? 'endpoint' : undefined,
      inTube: wireProps.inTube,
      inWall: wireProps.inWall,
      wireRoute: wireProps.wireRoute,
      hideWireLabel: true,
      converterDcConnection: connection,
    })

    for (const dcBusNode of branchNode.children.filter(
      (child) =>
        child.type === 'trunkDevice' &&
        (child.domainRef as TrunkDevice | undefined)?.type === 'dc_bus'
    )) {
      for (const childMcb of dcBusNode.children.filter((child) => child.type === 'mcb')) {
        result.push(...deriveMcbWires(childMcb, panel, rowY, dcBusNode))
      }
      result.push(...deriveOrdinaryDcBusEndpointBranchWires(dcBusNode, circuit, panel, connection))
    }

    // Empty output slots are straight preview stubs. A horizontal branch only
    // exists after a second endpoint turns the output into a chain.
    if (endpointNodes.length <= 1) continue

    const firstEndpoint = endpointNodes[0]
    const firstPoint = firstEndpoint ? getNodeConnectionAnchor(firstEndpoint) : undefined
    const firstTarget = firstEndpoint
      ? firstEndpoint.connectionAnchor
        ? firstPoint!
        : applyNodeWireInset(firstPoint!, verticalEnd, firstEndpoint)
      : { x: port.x + CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD, y: rowY }
    result.push({
      id: generateId(),
      type: 'branch',
      // Overlap the vertical by half the two-unit branch stroke. This closes
      // the butt-cap seam without asking the renderer to paint a junction dot.
      startPoint: { x: verticalEnd.x - 1, y: verticalEnd.y },
      endPoint: firstTarget,
      cable: wireProps.cable,
      panelId: panel.id,
      circuitId: circuit.id,
      domain: 'DC',
      fromElementId: device.id,
      fromElementType: 'endpoint',
      toElementId: firstEndpoint?.domainId,
      toElementType: firstEndpoint ? 'endpoint' : undefined,
      inTube: wireProps.inTube,
      inWall: wireProps.inWall,
      wireRoute: wireProps.wireRoute,
      hideWireLabel: wireProps.hideWireLabel,
      showFireClassLabel: wireProps.showFireClassLabel,
      wireLengthM: wireProps.wireLengthM,
      showWireLengthLabel: wireProps.showWireLengthLabel,
      converterDcConnection: connection,
    })

    for (let index = 0; index < endpointNodes.length - 1; index++) {
      const fromNode = endpointNodes[index]!
      const toNode = endpointNodes[index + 1]!
      const fromPoint = getNodeConnectionAnchor(fromNode)
      const toPoint = getNodeConnectionAnchor(toNode)
      result.push({
        id: generateId(),
        type: 'branch',
        startPoint: fromNode.connectionAnchor
          ? fromPoint
          : applyNodeWireInset(fromPoint, toPoint, fromNode),
        endPoint: toNode.connectionAnchor
          ? toPoint
          : applyNodeWireInset(toPoint, fromPoint, toNode),
        cable: wireProps.cable,
        panelId: panel.id,
        circuitId: circuit.id,
        domain: 'DC',
        fromElementId: fromNode.domainId,
        fromElementType: 'endpoint',
        toElementId: toNode.domainId,
        toElementType: 'endpoint',
        inTube: wireProps.inTube,
        inWall: wireProps.inWall,
        wireRoute: wireProps.wireRoute,
        hideWireLabel: true,
        converterDcConnection: connection,
      })
    }
  }

  return result
}

function deriveOrdinaryDcBusEndpointBranchWires(
  dcBusNode: LayoutNode,
  circuit: Circuit,
  panel: Panel,
  connection?: { converterId: string; connectionIndex: number }
): WireSegment[] {
  const wireProps = getCircuitWirePropertiesForDomain(circuit, 'DC')
  const result: WireSegment[] = []
  for (const branchNode of dcBusNode.children.filter((child) => child.type === 'branch')) {
    const orderedDevices = branchNode.children
      .filter((child) => child.type === 'endpoint' || child.type === 'trunkDevice')
      .sort((left, right) => right.bounds.y - left.bounds.y)
    let fromPoint = {
      x: branchNode.bounds.x + branchNode.bounds.width / 2,
      y: dcBusNode.bounds.y,
    }
    let fromNode: LayoutNode | undefined
    for (const endpointNode of orderedDevices) {
      const endpointPoint = getNodeConnectionAnchor(endpointNode)
      const fromElementType = fromNode
        ? fromNode.type === 'trunkDevice' &&
          (fromNode.domainRef as TrunkDevice | undefined)?.type === 'protection'
          ? 'protection'
          : 'endpoint'
        : 'secondaryBus'
      const toElementType =
        endpointNode.type === 'trunkDevice' &&
        (endpointNode.domainRef as TrunkDevice | undefined)?.type === 'protection'
          ? 'protection'
          : 'endpoint'
      result.push({
        id: generateId(),
        type: 'vertical',
        startPoint: fromNode ? applyNodeWireInset(fromPoint, endpointPoint, fromNode) : fromPoint,
        endPoint: applyNodeWireInset(endpointPoint, fromPoint, endpointNode),
        cable: wireProps.cable,
        panelId: panel.id,
        circuitId: circuit.id,
        domain: 'DC',
        fromElementId: fromNode?.domainId ?? (dcBusNode.domainId as string | undefined),
        fromElementType,
        toElementId: endpointNode.domainId,
        toElementType,
        inTube: wireProps.inTube,
        inWall: wireProps.inWall,
        wireRoute: wireProps.wireRoute,
        hideWireLabel: true,
        ...(connection ? { converterDcConnection: connection } : {}),
      })
      fromPoint = endpointPoint
      fromNode = endpointNode

      // Branch-local DC-bus converters live below the bus node rather than
      // in the MCB's direct trunk-device list. Derive their dedicated output
      // stubs here so empty A1…An lanes are painted as real conductors.
      if (
        endpointNode.type === 'trunkDevice' &&
        supportsCircuitConverterDcConnections(endpointNode.domainRef as TrunkDevice | undefined)
      ) {
        result.push(...deriveCircuitConverterDcConnectionWires(endpointNode, circuit, panel))
      }
    }
  }
  return result
}

export function deriveMcbWires(
  mcbNode: LayoutNode,
  panel: Panel,
  mainBusY: number,
  parentSecondaryBus: LayoutNode | null,
  converterSource?: {
    node: LayoutNode
    assemblyId?: string
    connection?: SupplyConnection
  }
): WireSegment[] {
  const segments: WireSegment[] = []
  const protection = mcbNode.domainRef as ProtectionDevice | undefined
  const circuit =
    mcbNode.circuitIdForWires != null
      ? findCircuitByIdInPanel(panel, mcbNode.circuitIdForWires)
      : findCircuitForProtection(panel, protection?.id)

  if (!circuit) return segments
  const isHorizontalConverterBackup = circuit.supplySource?.kind === 'converter-backup'
  const circuitBaseDomain = circuit.dcBusSource ? ('DC' as const) : DEFAULT_ELECTRICAL_DOMAIN
  const emptyProtectionOutput = Boolean(
    protection && circuit.endpoints.length === 0 &&
    (circuit.trunkDevices?.length ?? 0) === 0 &&
    !circuit.branches?.some((branch) =>
      branch.endpointIds.length > 0 || (branch.branchDevices?.length ?? 0) > 0
    ) &&
    (circuit.subCircuitIds?.length ?? 0) === 0
  )
  const emptyOutputAnchor = emptyProtectionOutput
    ? deriveWireAnchorKey({
        kind: 'circuit-section',
        circuitId: circuit.id,
        nodeRef: `open-end:protection:${encodeURIComponent(protection!.id)}`,
        domain: circuitBaseDomain,
      })
    : undefined

  const protectionConnectionSectionRef: CircuitSectionRef = {
    fromElementType: parentSecondaryBus ? 'secondaryBus' : 'mainBus',
    toElementType: 'protection',
    toElementId: protection?.id,
    domain: circuitBaseDomain,
  }
  const defaultWireProps = getCircuitWirePropertiesForDomain(
    circuit,
    circuitBaseDomain,
    protectionConnectionSectionRef
  )
  const cable = defaultWireProps.cable || createDefaultAcCircuitCable()
  const panelBusCable = ensurePanelBusCableMinimum(cable)

  const mcbY = mcbNode.bounds.y
  // bounds.x IS the center of the MCB symbol (from bottomUpLayout position.x = cl.x + baseWidth/2)
  const mcbX = mcbNode.bounds.x

  // Determine connection point
  // Vertical wires are always at mcbX (the center of the MCB symbol) for both start and end
  let connectFromY: number
  let connectFromType: 'mainBus' | 'secondaryBus' | 'protection' = 'mainBus'

  if (parentSecondaryBus) {
    // Connected to secondary bus (RCD trunk)
    connectFromY = parentSecondaryBus.bounds.y
    connectFromType = 'secondaryBus'
  } else {
    // Connected directly to main bus
    connectFromY = mainBusY
    connectFromType = 'mainBus'
  }

  // Vertical wire from connection point to MCB (always at mcbX for both ends)
  const connStart = { x: mcbX, y: connectFromY }
  const connEnd = { x: mcbX, y: mcbY }
  const panelOnlyFeederStub =
    (mcbNode.id.includes('-nest-') || protection?.directPanelFeeder === true) &&
    isPanelOnlySubPanelFeeder(protection, circuit)
  const directDcBusFeeder = protection?.directDcBusFeeder === true

  // Find branches, trunk devices, direct endpoint children (sub-panel symbols), and parent wire end for this circuit
  const branchNodes = mcbNode.children.filter((c) => c.type === 'branch' && !c.branchLayout?.forkFrom && !c.branchLayout?.forkUnresolved)
  segments.push(...deriveSavedForkWires(mcbNode, circuit, panel))
  const trunkDeviceNodes = mcbNode.children
    .filter((c) => c.type === 'trunkDevice')
    .sort((a, b) => b.bounds.y - a.bounds.y) // Sort by Y descending (bottom to top = MCB to branches)
  // Sub-panel symbols sit directly on the MCB trunk (no branch)
  const directEndpointNodes = mcbNode.children.filter((c) => c.type === 'endpoint')
  const panelUsesSecondaryBusStem = hasPanelAttachmentOnSecondaryBus(protection, circuit)
  const secondaryBusEndpointNodes = panelUsesSecondaryBusStem ? directEndpointNodes : []
  const trunkEndpointNodes = panelUsesSecondaryBusStem ? [] : directEndpointNodes
  // When circuit has both endpoints and subcircuits, layout tree adds a node at secondary bus Y (above endpoints)
  const parentWireEndNodes = mcbNode.children.filter(
    (c) => c.type === 'secondaryBus' && c.id?.startsWith('parent-wire-end-')
  )

  const mergePanelOnlyFeederBusToEndpoint =
    panelOnlyFeederStub &&
    trunkEndpointNodes.length > 0 &&
    branchNodes.length === 0 &&
    trunkDeviceNodes.length === 0 &&
    parentWireEndNodes.length === 0

  if (!mergePanelOnlyFeederBusToEndpoint) {
    const sourcePoint = converterSource
      ? applyNodeWireInset(
          { x: converterSource.node.bounds.x, y: converterSource.node.bounds.y },
          connEnd,
          converterSource.node
        )
      : connStart
    const targetPoint = directDcBusFeeder
      ? connEnd
      : converterSource
        ? applyNodeWireInset(connEnd, sourcePoint, mcbNode)
        : applyNodeWireInset(connEnd, connStart, mcbNode)
    const sourceSegment: WireSegment = {
      id: generateId(),
      type: converterSource ? 'branch' : 'vertical',
      startPoint: sourcePoint,
      endPoint: targetPoint,
      cable: converterSource ? cable : directDcBusFeeder ? cable : panelBusCable,
      panelId: panel.id,
      domain: circuitBaseDomain,
      fromElementType: converterSource ? undefined : connectFromType,
      fromElementId: converterSource?.node.domainId,
      toElementType: 'protection',
      toElementId: protection?.id,
      circuitId: circuit.id,
      inTube: defaultWireProps.inTube,
      wireRoute: defaultWireProps.wireRoute,
      inWall: defaultWireProps.inWall,
      hideWireLabel: defaultWireProps.hideWireLabel,
      ...(panelOnlyFeederStub ? { showWireLabelOnBusStub: true } : {}),
    }
    if (converterSource?.assemblyId && converterSource.connection) {
      sourceSegment.supplyAssemblyId = converterSource.assemblyId
      sourceSegment.supplyConnectionId = converterSource.connection.id
      const properties = converterSource.connection.wireProperties
      if (properties) {
        sourceSegment.cable = properties.cable
        sourceSegment.wireRoute = properties.wireRoute
        sourceSegment.inTube = properties.inTube
        sourceSegment.inWall = properties.inWall
        sourceSegment.hideWireLabel = properties.hideWireLabel
        sourceSegment.showFireClassLabel = properties.showFireClassLabel
        sourceSegment.wireLengthM = properties.wireLengthM
        sourceSegment.showWireLengthLabel = properties.showWireLengthLabel
      }
    }
    if (converterSource && sourcePoint.y !== targetPoint.y) {
      const anchor = getNodeConnectionAnchor(converterSource.node)
      const elbowX = (anchor.x + connEnd.x) / 2
      const source = applyNodeWireInset(anchor, { x: elbowX, y: anchor.y }, converterSource.node)
      const target = applyNodeWireInset(connEnd, { x: elbowX, y: connEnd.y }, mcbNode)
      segments.push(
        { ...sourceSegment, startPoint: source, endPoint: { x: elbowX, y: anchor.y } },
        {
          ...sourceSegment,
          id: generateId(),
          type: 'vertical',
          startPoint: { x: elbowX, y: anchor.y },
          endPoint: { x: elbowX, y: target.y },
          hideWireLabel: true,
        },
        {
          ...sourceSegment,
          id: generateId(),
          startPoint: { x: elbowX, y: target.y },
          endPoint: target,
        }
      )
    } else {
      segments.push(sourceSegment)
    }
  }

  let verticalWireTopY = mcbY
  if (
    branchNodes.length > 0 ||
    trunkDeviceNodes.length > 0 ||
    trunkEndpointNodes.length > 0 ||
    parentWireEndNodes.length > 0
  ) {
    // Determine the top-most real connection point on this trunk.
    // If a trunk device is top-most, continue with a short stub above it so
    // spacing matches protection-like visuals and keeps room for future inserts.
    let topmostBranchWireY: number | null = null
    if (branchNodes.length > 0) {
      const topmostBranch = branchNodes.reduce((top, branch) =>
        branch.bounds.y < top.bounds.y ? branch : top
      )
      topmostBranchWireY = topmostBranch.bounds.y + topmostBranch.bounds.height / 2
    }

    let topmostEndpointInsetY: number | null = null
    if (trunkEndpointNodes.length > 0) {
      const topmostEndpoint = trunkEndpointNodes.reduce((top, ep) =>
        ep.bounds.y < top.bounds.y ? ep : top
      )
      const epInset = applyNodeWireInset(
        { x: mcbX, y: topmostEndpoint.bounds.y },
        { x: mcbX, y: mcbY },
        topmostEndpoint
      )
      topmostEndpointInsetY = epInset.y
    }

    const topmostDeviceY =
      trunkDeviceNodes.length > 0 ? trunkDeviceNodes[trunkDeviceNodes.length - 1]!.bounds.y : null

    const parentWireEndY = parentWireEndNodes.length > 0 ? parentWireEndNodes[0]!.bounds.y : null

    const topCandidates = [
      topmostBranchWireY,
      topmostEndpointInsetY,
      topmostDeviceY,
      parentWireEndY,
    ].filter((y): y is number => y !== null)

    if (topCandidates.length > 0) {
      const topmostContentY = Math.min(...topCandidates)
      const isTopmostTrunkDevice = topmostDeviceY !== null && topmostDeviceY === topmostContentY
      const topmostTrunkDevice = trunkDeviceNodes.at(-1)?.domainRef as TrunkDevice | undefined
      verticalWireTopY = isTopmostTrunkDevice
        ? topmostTrunkDevice?.type === 'dc_bus'
          ? topmostContentY
          : topmostContentY - LAYOUT_CONSTANTS.BRANCH_START_OFFSET
        : topmostContentY
    }

    const branchSymbolBottomY = Math.max(-Infinity, ...branchNodes.flatMap((branch) =>
      branch.children.filter((node) => node.type === 'endpoint')
        .map((node) => node.bounds.y + node.bounds.height / 2)))
    const baseWireLabelEndPoint = (start: Point2, end: Point2): Point2 => ({
      x: start.x,
      y: Math.min(start.y, Math.max(end.y, start.y - (mcbNode.circuitWireLabelSpan ?? CIRCUIT_WIRE_LABEL_BASE_SPAN), branchSymbolBottomY + 8)),
    })

    // Build vertical wire segments — wire passes THROUGH the trunk device center.
    // The device symbol renders on top and visually covers the wire.
    if (trunkDeviceNodes.length > 0) {
      // Collect waypoints on the vertical wire: MCB → trunk devices → top wire end
      // waypoints are sorted from MCB (high Y) to top (low Y)
      const waypoints: { y: number; deviceId?: string }[] = [
        { y: mcbY }, // Start at MCB
      ]

      // Add trunk devices as waypoints (already sorted high Y to low Y)
      for (const td of trunkDeviceNodes) {
        waypoints.push({ y: td.bounds.y, deviceId: td.domainId })
      }
      waypoints.push({ y: verticalWireTopY })

      // Create wire segments between consecutive waypoints
      // Apply wire insets at MCB and each trunk device
      // waypoint 0 = MCB, waypoints 1..n-1 = trunk devices, waypoint n = branch/endpoint
      const allTrunkNodes = [directDcBusFeeder ? undefined : mcbNode, ...trunkDeviceNodes]
      // Domain along the trunk: start at MCB (AC by default) and let conversion devices update it.
      let currentDomain: typeof DEFAULT_ELECTRICAL_DOMAIN = circuitBaseDomain
      // Only when the user explicitly sets hideWireLabel=true do we hide labels
      // on all trunk segments. By default (undefined/false), the first segment
      // after the protection can show a label; higher segments stay hidden.
      const hideAllWireLabels = (defaultWireProps.hideWireLabel ?? false) === true
      const firstTrunkDevice = trunkDeviceNodes[0]?.domainRef as TrunkDevice | undefined
      const terminalStripDirectlyAfterProtection = firstTrunkDevice?.symbol === 'terminal_strip'
      for (let i = 0; i < waypoints.length - 1; i++) {
        const from = waypoints[i]
        const to = waypoints[i + 1]
        if (!from || !to) continue
        if (from.y === to.y) continue
        const startPt = { x: mcbX, y: from.y }
        const endPt = { x: mcbX, y: to.y }

        const fromNode = allTrunkNodes[i]
        const toNode = allTrunkNodes[i + 1] // undefined for the last segment (→ branch/endpoint)
        const toEndpointRef = to.deviceId ?? toNode?.domainId
        const fromTrunkDevice = fromNode?.domainRef as TrunkDevice | undefined
        const toTrunkDevice = toNode?.domainRef as TrunkDevice | undefined
        const bordersSharedJunction =
          isSharedJunctionSymbol(fromTrunkDevice?.symbol) ||
          isSharedJunctionSymbol(toTrunkDevice?.symbol)

        const endsAtDedicatedConverterOutput =
          i === waypoints.length - 2 &&
          supportsCircuitConverterDcConnections(fromTrunkDevice) &&
          getCircuitConverterDcConnectionCount(fromTrunkDevice) > 1
        if (endsAtDedicatedConverterOutput) continue

        const adjustedStart = fromNode ? applyNodeWireInset(startPt, endPt, fromNode) : startPt
        const adjustedEnd = toNode ? applyNodeWireInset(endPt, startPt, toNode) : endPt

        const segmentSectionRef: CircuitSectionRef = {
          fromElementType: i === 0 ? 'protection' : 'endpoint',
          fromElementId: from.deviceId ?? fromNode?.domainId,
          toElementType: toEndpointRef ? 'endpoint' : undefined,
          toElementId: toEndpointRef,
          domain: currentDomain,
        }
        const segmentWireProps = getCircuitWirePropertiesForDomain(
          circuit,
          currentDomain,
          segmentSectionRef
        )
        segments.push({
          id: generateId(),
          type: 'vertical',
          startPoint: adjustedStart,
          endPoint: adjustedEnd,
          cable: segmentWireProps.cable,
          panelId: panel.id,
          domain: currentDomain,
          fromElementType: segmentSectionRef.fromElementType,
          fromElementId: segmentSectionRef.fromElementId,
          toElementType: segmentSectionRef.toElementType,
          toElementId: segmentSectionRef.toElementId,
          circuitId: circuit.id,
          inTube: segmentWireProps.inTube,
          wireRoute: segmentWireProps.wireRoute,
          inWall: segmentWireProps.inWall,
          ...(i === 0
            ? { wireLabelBaseEndPoint: baseWireLabelEndPoint(adjustedStart, adjustedEnd) }
            : terminalStripDirectlyAfterProtection && i === 1
            ? {
                wireLabelEndPoint: {
                  x: adjustedStart.x,
                  y: Math.max(adjustedEnd.y, adjustedStart.y - TERMINAL_STRIP_WIRE_LABEL_SPAN),
                },
              }
            : {}),
          // A shared junction creates a real wire-section boundary, so both
          // adjacent sections expose their own label by default. Other trunk
          // runs retain the single-label default. A section override always
          // wins, allowing either side to be hidden independently.
          hideWireLabel:
            segmentWireProps.hideWireLabel ??
            (hideAllWireLabels ? true : i === 0 || bordersSharedJunction ? undefined : true),
        })

        // After this segment, update domain if the next node is a conversion component
        currentDomain = getTrunkDomainAfterNode(currentDomain, toNode ?? null)
      }

      // Debug logging for suspiciously short trunk stubs above the last trunk device.
      // This helps diagnose cases where the wire above a trunk device is only a few pixels.
      if (typeof console !== 'undefined' && trunkDeviceNodes.length > 0) {
        const topDevice = trunkDeviceNodes[trunkDeviceNodes.length - 1]!
        const stubLen = Math.abs(verticalWireTopY - topDevice.bounds.y)
        if (stubLen > 0 && stubLen <= 20) {
          logger.info('[Eendraad Trunk Debug]', {
            circuitId: circuit.id,
            protectionId: protection?.id,
            panelId: panel.id,
            mcbY,
            mcbX,
            verticalWireTopY,
            topDeviceY: topDevice.bounds.y,
            stubLen,
            branchNodes: branchNodes.map((b) => ({
              id: b.id,
              y: b.bounds.y,
              height: b.bounds.height,
            })),
            parentWireEndNodes: parentWireEndNodes.map((n) => ({
              id: n.id,
              y: n.bounds.y,
              height: n.bounds.height,
            })),
            hasParentSecondaryBus: !!parentSecondaryBus,
            parentSecondaryBusY: parentSecondaryBus?.bounds.y,
          })
        }
      }
    } else if (branchNodes.length > 0 && !isHorizontalConverterBackup) {
      // No trunk devices, has branches: vertical wire from MCB up to wire top (branch level or secondary bus when present)
      const firstBranch = branchNodes.reduce((nearest, branch) =>
        branch.bounds.y > nearest.bounds.y ? branch : nearest
      )
      const firstBranchWireY = firstBranch.bounds.y + firstBranch.bounds.height / 2
      // When parent has endpoint + subcircuits, verticalWireTopY is above the branch (secondary bus); draw wire all the way to bus
      const wireEndY = verticalWireTopY
      const mcbToBranchStart = { x: mcbX, y: mcbY }
      const mcbToBranchEnd = { x: mcbX, y: wireEndY }
      const noTrunkSectionRef: CircuitSectionRef = {
        fromElementType: 'protection',
        fromElementId: protection?.id,
        domain: circuitBaseDomain,
      }
      const noTrunkWireProps = getCircuitWirePropertiesForDomain(
        circuit,
        circuitBaseDomain,
        noTrunkSectionRef
      )
      segments.push({
        id: generateId(),
        type: 'vertical',
        // The direct DC-bus feeder has no rendered protection symbol. Keep the
        // trunk continuous through its structural owner instead of leaving an
        // inset gap (or drawing through an invisible symbol).
        startPoint: directDcBusFeeder
          ? mcbToBranchStart
          : applyNodeWireInset(mcbToBranchStart, mcbToBranchEnd, mcbNode),
        endPoint: mcbToBranchEnd,
        cable: noTrunkWireProps.cable,
        panelId: panel.id,
        domain: circuitBaseDomain,
        fromElementType: 'protection',
        fromElementId: protection?.id,
        circuitId: circuit.id,
        inTube: noTrunkWireProps.inTube,
        wireRoute: noTrunkWireProps.wireRoute,
        inWall: noTrunkWireProps.inWall,
        wireLabelEndPoint: { x: mcbX, y: firstBranchWireY },
        wireLabelBaseEndPoint: baseWireLabelEndPoint(
          directDcBusFeeder ? mcbToBranchStart : applyNodeWireInset(mcbToBranchStart, mcbToBranchEnd, mcbNode),
          { x: mcbX, y: firstBranchWireY }
        ),
        // This vertical is directly above the protection; by default its label
        // is shown (hideWireLabel undefined/false). When the user explicitly
        // hides labels on the circuit, we respect that here too.
        hideWireLabel: emptyProtectionOutput
          ? (noTrunkWireProps.hideWireLabel ?? true)
          : noTrunkWireProps.hideWireLabel,
        ...(emptyOutputAnchor ? { wireAnchor: emptyOutputAnchor } : {}),
      })
    } else if (trunkEndpointNodes.length > 0) {
      // No trunk devices, no branches, has direct endpoint (panel symbol):
      // Single vertical from bus→MCB stub + MCB→endpoint merged into one bus→endpoint wire for panel-only feeders;
      // otherwise from MCB straight up to the panel symbol.
      const topmostEndpoint = trunkEndpointNodes.reduce((top, ep) =>
        ep.bounds.y < top.bounds.y ? ep : top
      )

      const mcbToEpEnd = { x: mcbX, y: topmostEndpoint.bounds.y }
      const directEndpointSectionRef: CircuitSectionRef = {
        fromElementType: 'protection',
        fromElementId: protection?.id,
        toElementType: 'endpoint',
        toElementId: topmostEndpoint.domainId,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
      }

      if (isHorizontalConverterBackup) {
        const mcbToEndpointStart = { x: mcbX, y: mcbY }
        const mcbToEndpointEnd = { x: topmostEndpoint.bounds.x, y: mcbY }
        const directEndpointWireProps = getCircuitWirePropertiesForDomain(
          circuit,
          DEFAULT_ELECTRICAL_DOMAIN,
          directEndpointSectionRef
        )
        segments.push({
          id: generateId(),
          type: 'branch',
          startPoint: applyNodeWireInset(mcbToEndpointStart, mcbToEndpointEnd, mcbNode),
          endPoint: applyNodeWireInset(mcbToEndpointEnd, mcbToEndpointStart, topmostEndpoint),
          cable: directEndpointWireProps.cable,
          panelId: panel.id,
          domain: DEFAULT_ELECTRICAL_DOMAIN,
          fromElementType: 'protection',
          fromElementId: protection?.id,
          toElementType: 'endpoint',
          toElementId: topmostEndpoint.domainId,
          circuitId: circuit.id,
          inTube: directEndpointWireProps.inTube,
          wireRoute: directEndpointWireProps.wireRoute,
          inWall: directEndpointWireProps.inWall,
          hideWireLabel: directEndpointWireProps.hideWireLabel,
          ...(emptyOutputAnchor ? { wireAnchor: emptyOutputAnchor } : {}),
        })
      } else if (mergePanelOnlyFeederBusToEndpoint) {
        const mergedEndpointRef: CircuitSectionRef = {
          fromElementType: connectFromType,
          toElementType: 'endpoint',
          toElementId: topmostEndpoint.domainId,
          domain: DEFAULT_ELECTRICAL_DOMAIN,
        }
        const resolvedSectionOverride =
          findSubPanelFeederWireOverride(
            circuit,
            protection?.id,
            topmostEndpoint.domainId ?? '',
            DEFAULT_ELECTRICAL_DOMAIN
          ) ?? findSectionWireOverrideWithFeederFallback(circuit, mergedEndpointRef, protection?.id)
        const mergedWireProps = getCircuitWirePropertiesFromResolvedOverride(
          circuit,
          DEFAULT_ELECTRICAL_DOMAIN,
          resolvedSectionOverride
        )
        const busInsetType = connectFromType === 'mainBus' ? 'mainBus' : 'secondaryBus'
        segments.push({
          id: generateId(),
          type: 'vertical',
          startPoint: applyWireInset(connStart, mcbToEpEnd, busInsetType),
          endPoint: applyNodeWireInset(mcbToEpEnd, connStart, topmostEndpoint),
          cable: mergedWireProps.cable ?? cable,
          panelId: panel.id,
          domain: DEFAULT_ELECTRICAL_DOMAIN,
          fromElementType: connectFromType,
          toElementType: 'endpoint',
          toElementId: topmostEndpoint.domainId,
          circuitId: circuit.id,
          inTube: mergedWireProps.inTube,
          wireRoute: mergedWireProps.wireRoute,
          inWall: mergedWireProps.inWall,
          hideWireLabel: mergedWireProps.hideWireLabel,
          feederProtectionId: protection?.id,
          ...(emptyOutputAnchor ? { wireAnchor: emptyOutputAnchor } : {}),
        })
      } else {
        const mcbToEpStart = { x: mcbX, y: mcbY }
        const directEndpointWireProps = getCircuitWirePropertiesForDomain(
          circuit,
          DEFAULT_ELECTRICAL_DOMAIN,
          directEndpointSectionRef
        )
        segments.push({
          id: generateId(),
          type: 'vertical',
          startPoint: applyNodeWireInset(mcbToEpStart, mcbToEpEnd, mcbNode),
          endPoint: applyNodeWireInset(mcbToEpEnd, mcbToEpStart, topmostEndpoint),
          cable: directEndpointWireProps.cable,
          panelId: panel.id,
          domain: DEFAULT_ELECTRICAL_DOMAIN,
          fromElementType: 'protection',
          fromElementId: protection?.id,
          toElementType: 'endpoint',
          toElementId: topmostEndpoint.domainId,
          circuitId: circuit.id,
          inTube: directEndpointWireProps.inTube,
          wireRoute: directEndpointWireProps.wireRoute,
          inWall: directEndpointWireProps.inWall,
          hideWireLabel: directEndpointWireProps.hideWireLabel,
          ...(emptyOutputAnchor ? { wireAnchor: emptyOutputAnchor } : {}),
        })
      }
    }

    for (const converterNode of trunkDeviceNodes) {
      segments.push(...deriveCircuitConverterDcConnectionWires(converterNode, circuit, panel))
    }
    for (const dcBusNode of trunkDeviceNodes.filter(
      (node) => (node.domainRef as TrunkDevice | undefined)?.type === 'dc_bus'
    )) {
      segments.push(...deriveOrdinaryDcBusEndpointBranchWires(dcBusNode, circuit, panel))
    }

    // Horizontal branch wires
    // Determine which branch is visually the last one (top-most on screen, smallest Y).
    const lastBranchNode =
      branchNodes.length > 0
        ? branchNodes.reduce(
            (top, branch) => (branch.bounds.y < top.bounds.y ? branch : top),
            branchNodes[0]!
          )
        : null

    for (const branchNode of branchNodes) {
      // A converter above this tap only converts the continuation of the trunk.
      // Earlier branches keep the domain and section of their actual feed.
      const upstreamDevices = trunkDeviceNodes.filter((node) => node.bounds.y > branchNode.bounds.y)
      let trunkDomainAtBranch: typeof DEFAULT_ELECTRICAL_DOMAIN = circuitBaseDomain
      for (const device of upstreamDevices) {
        trunkDomainAtBranch = getTrunkDomainAfterNode(trunkDomainAtBranch, device)
      }
      const trunkExitSectionRef: CircuitSectionRef = {
        fromElementType: upstreamDevices.length ? 'endpoint' : 'protection',
        fromElementId: upstreamDevices.at(-1)?.domainId ?? protection?.id,
        domain: trunkDomainAtBranch,
      }
      const trunkOriginWireProps = getCircuitWirePropertiesForDomain(circuit, trunkDomainAtBranch, trunkExitSectionRef)
      const branchSegments = deriveBranchWires(
        branchNode,
        circuit,
        panel,
        mcbX,
        trunkDomainAtBranch,
        trunkOriginWireProps,
        trunkExitSectionRef,
        !!lastBranchNode && branchNode.id === lastBranchNode.id
      )
      segments.push(...branchSegments)
    }
  }

  if (
    emptyProtectionOutput && protection &&
    branchNodes.length === 0 &&
    trunkDeviceNodes.length === 0 &&
    directEndpointNodes.length === 0 &&
    parentWireEndNodes.length === 0 &&
    (circuit.subCircuitIds?.length ?? 0) === 0
  ) {
    const endPoint = { x: mcbX, y: mcbY - LAYOUT_CONSTANTS.BRANCH_START_OFFSET / 2 }
    const wireProps = getCircuitWirePropertiesForDomain(circuit, circuitBaseDomain, {
      fromElementType: 'protection',
      fromElementId: protection.id,
      domain: circuitBaseDomain,
    })
    segments.push({
      id: generateId(),
      type: 'vertical',
      startPoint: applyNodeWireInset({ x: mcbX, y: mcbY }, endPoint, mcbNode),
      endPoint,
      cable: wireProps.cable,
      panelId: panel.id,
      circuitId: circuit.id,
      domain: circuitBaseDomain,
      fromElementType: 'protection',
      fromElementId: protection.id,
      inTube: wireProps.inTube,
      wireRoute: wireProps.wireRoute,
      inWall: wireProps.inWall,
      hideWireLabel: wireProps.hideWireLabel ?? true,
      wireAnchor: emptyOutputAnchor,
    })
  }

  // Process nested circuits (sub-circuits)
  const nestedMcbNodes = mcbNode.children.filter((c) => c.type === 'mcb')
  if (nestedMcbNodes.length > 0) {
    const nestedCircuitDomain = circuitBaseDomain
    // Connect nested circuits at the computed parent wire end, which now also
    // respects top-most trunk devices and direct endpoints.
    const explicitSecondaryBus = mcbNode.children.find(
      (child) => child.id === `secondary-bus-${circuit.id}`
    )
    const secondaryBusY = explicitSecondaryBus
      ? explicitSecondaryBus.bounds.y + explicitSecondaryBus.bounds.height / 2
      : verticalWireTopY

    const parentHasVisibleTrunkContent =
      branchNodes.length > 0 ||
      trunkDeviceNodes.length > 0 ||
      trunkEndpointNodes.length > 0 ||
      parentWireEndNodes.length > 0
    if (!parentHasVisibleTrunkContent && secondaryBusY !== mcbY) {
      const parentToBusWireProps = getCircuitWirePropertiesForDomain(circuit, nestedCircuitDomain, {
        fromElementType: 'protection',
        fromElementId: protection?.id,
        domain: nestedCircuitDomain,
      })
      segments.push({
        id: generateId(),
        type: 'vertical',
        startPoint: applyNodeWireInset(
          { x: mcbX, y: mcbY },
          { x: mcbX, y: secondaryBusY },
          mcbNode
        ),
        endPoint: { x: mcbX, y: secondaryBusY },
        cable: parentToBusWireProps.cable,
        panelId: panel.id,
        domain: nestedCircuitDomain,
        fromElementType: 'protection',
        fromElementId: protection?.id,
        circuitId: circuit.id,
        inTube: parentToBusWireProps.inTube,
        wireRoute: parentToBusWireProps.wireRoute,
        inWall: parentToBusWireProps.inWall,
        hideWireLabel: parentToBusWireProps.hideWireLabel,
      })
    }
    const secondaryBusAttachmentNodes = [...secondaryBusEndpointNodes, ...nestedMcbNodes]
    // If there are multiple attachments, draw a secondary busbar (horizontal line).
    if (secondaryBusAttachmentNodes.length > 1) {
      const nestedXPositions = secondaryBusAttachmentNodes
        .map((n) => n.bounds.x)
        .sort((a, b) => a - b)
      const leftmostX = Math.min(...nestedXPositions)
      const rightmostX = Math.max(...nestedXPositions)
      const extension = LAYOUT_CONSTANTS.SECONDARY_BUS_EXTENSION

      const busStartX = leftmostX - extension
      const busEndX = rightmostX + extension
      const busWaypoints: number[] = [busStartX, ...nestedXPositions, busEndX]
      const secondaryBusReferenceLabel = getCircuitDisplayLabel(circuit, protection)

      for (let i = 0; i < busWaypoints.length - 1; i++) {
        const startX = busWaypoints[i]!
        const endX = busWaypoints[i + 1]!
        if (endX <= startX) continue

        segments.push({
          id: generateId(),
          type: 'mainBus',
          startPoint: { x: startX, y: secondaryBusY },
          endPoint: { x: endX, y: secondaryBusY },
          cable: panelBusCable,
          panelId: panel.id,
          domain: nestedCircuitDomain,
          fromElementType: 'secondaryBus',
          toElementType: 'secondaryBus',
          circuitId: circuit.id,
          ...(secondaryBusReferenceLabel
            ? { secondaryBusReferenceExportLabel: secondaryBusReferenceLabel }
            : {}),
          ...(secondaryBusReferenceLabel &&
          shouldLabelSecondaryBusSegment(i, nestedXPositions.length)
            ? { secondaryBusReferenceLabel }
            : {}),
        })
      }
    }

    // Create a virtual secondary bus node so nested MCBs connect
    // from the correct Y position (parent wire end) instead of main bus
    const virtualSecondaryBus: LayoutNode = {
      id: `virtual-secondary-bus-${circuit.id}`,
      type: 'secondaryBus',
      bounds: {
        x: mcbX,
        y: secondaryBusY,
        width: 0,
        height: LAYOUT_CONSTANTS.BUS_THICKNESS,
      },
      children: [],
    }

    for (const nestedMcb of nestedMcbNodes) {
      const nestedSegments = deriveMcbWires(nestedMcb, panel, mainBusY, virtualSecondaryBus)
      segments.push(...nestedSegments)
    }

    for (const panelEndpoint of secondaryBusEndpointNodes) {
      const busPoint = { x: panelEndpoint.bounds.x, y: secondaryBusY }
      const endpointPoint = { x: panelEndpoint.bounds.x, y: panelEndpoint.bounds.y }
      const panelWireProps = getCircuitWirePropertiesForDomain(circuit, nestedCircuitDomain, {
        fromElementType: 'secondaryBus',
        toElementType: 'endpoint',
        toElementId: panelEndpoint.domainId,
        domain: nestedCircuitDomain,
      })
      segments.push({
        id: generateId(),
        type: 'vertical',
        startPoint: busPoint,
        endPoint: applyNodeWireInset(endpointPoint, busPoint, panelEndpoint),
        cable: panelWireProps.cable,
        panelId: panel.id,
        domain: nestedCircuitDomain,
        fromElementType: 'secondaryBus',
        toElementType: 'endpoint',
        toElementId: panelEndpoint.domainId,
        circuitId: circuit.id,
        inTube: panelWireProps.inTube,
        wireRoute: panelWireProps.wireRoute,
        inWall: panelWireProps.inWall,
        hideWireLabel: panelWireProps.hideWireLabel,
        feederProtectionId: protection?.id,
      })
    }
  }

  return segments
}

/**
 * Derive wires for a branch node
 *
 * Creates individual wire segments between each pair of adjacent elements on
 * the endpoint chain:  trunk → endpoint1 → endpoint2 → ... → endpointN
 *
 * Each segment references the endpoints it connects (fromElementId/toElementId),
 * enabling precise detection of insertion position when adding symbols to the chain.
 *
 * For the visually last (top-most) branch on a circuit we extend the horizontal
 * start point slightly to the left so that the butt-capped corner overlaps the
 * vertical trunk and avoids a tiny gap.
 */
function deriveBranchWires(
  branchNode: LayoutNode,
  circuit: Circuit,
  panel: Panel,
  trunkX: number,
  trunkDomainAtBranch: typeof DEFAULT_ELECTRICAL_DOMAIN = DEFAULT_ELECTRICAL_DOMAIN,
  trunkOriginWireProps?: ReturnType<typeof getCircuitWirePropertiesForDomain>,
  trunkOriginSectionRef?: CircuitSectionRef,
  isLastBranchOnCircuit = false,
  includeDomoticaOutputs = true
): WireSegment[] {
  const segments: WireSegment[] = []
  const inheritedBranchWireProps =
    trunkOriginWireProps ?? getCircuitWirePropertiesForDomain(circuit, trunkDomainAtBranch)

  // Branch bounds.y is the TOP of the hit area (branchY - padding).
  // The actual wire Y is at the CENTER of the branch bounds.
  const branchY = branchNode.bounds.y + branchNode.bounds.height / 2

  // Follow the visual flow away from the protection. Ordinary circuits run right;
  // standalone converter-backup circuits are mirrored and run left.
  const isHorizontalConverterBackup = circuit.supplySource?.kind === 'converter-backup'
  const endpointNodes = branchNode.children
    .filter((c) => c.type === 'endpoint')
    .sort((a, b) =>
      isHorizontalConverterBackup ? b.bounds.x - a.bounds.x : a.bounds.x - b.bounds.x
    )

  if (endpointNodes.length === 0) return segments
  const domoticaNode = includeDomoticaOutputs && endpointNodes.find((node) => {
    const endpoint = node.domainRef as Endpoint | undefined
    return endpoint?.symbol === 'domotica' && !endpoint?.domoticaChildProps
  })
  if (domoticaNode) {
    const domotica = domoticaNode.domainRef as Endpoint | undefined
    const endpointCount = Math.max(
      DOMOTICA_MIN_ENDPOINT_OUTPUTS,
      Math.min(
        DOMOTICA_MAX_ENDPOINT_OUTPUTS,
        Math.trunc(domotica?.domoticaProps?.endpointCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS)
      )
    )
    const endpointOutputWires = domotica?.domoticaProps?.endpointOutputWires ?? []
    const domoticaHeight = Math.max(0, endpointCount - 1) * DOMOTICA_OUTPUT_SPACING
    const firstOutputY = branchY - domoticaHeight

    const addDomoticaOutputChain = (
      sourceNode: LayoutNode,
      group: 'endpoint',
      index: number,
      outputY: number,
      fallbackLead: number,
      wireProps: Partial<ReturnType<typeof getCircuitWirePropertiesForDomain>> | undefined,
      baseProps: ReturnType<typeof getCircuitWirePropertiesForDomain>,
      domain: typeof DEFAULT_ELECTRICAL_DOMAIN
    ) => {
      const childrenOnRow = endpointNodes
        .filter((n) => {
          const ep = n.domainRef as {
            domoticaChildProps?: {
              parentEndpointId?: string
              outputGroup?: string
              outputIndex?: number
            }
          }
          const childProps = ep?.domoticaChildProps
          return (
            childProps?.parentEndpointId === sourceNode.domainId &&
            (childProps?.outputGroup === group || childProps?.outputGroup === 'control') &&
            childProps?.outputIndex === index
          )
        })
        .sort((a, b) => a.bounds.x - b.bounds.x)

      // A board's receiving copy resolves the physical output independently of
      // the wire before the module. Keep both copies on the same exact row
      // section/circuit defaults; ordinary rows retain their existing fallback.
      const rowBaseProps = childrenOnRow.some((node) => isDomoticaPanelFeedEndpoint(node.domainRef as Endpoint))
        ? getCircuitWirePropertiesForDomain(circuit, domain, {
            fromElementType: 'endpoint', fromElementId: sourceNode.domainId,
            toElementType: 'endpoint', toElementId: childrenOnRow[0]?.domainId, domain,
          })
        : baseProps
      const {
        cable: segmentCable, wireRoute: baseRoute, inTube: segmentInTube, inWall: segmentInWall,
        hideWireLabel: segmentHideWireLabel, showFireClassLabel: segmentShowFireClassLabel,
        wireLengthM: segmentWireLengthM, showWireLengthLabel: segmentShowWireLengthLabel,
      } = resolveDomoticaOutputWireProperties(rowBaseProps, wireProps)

      const sourceBoxRightX = sourceNode.bounds.x + DOMOTICA_BOX_WIDTH / 2
      const start = { x: sourceBoxRightX, y: outputY }
      const firstNode = childrenOnRow[0]
      const firstEnd = firstNode
        ? { x: firstNode.bounds.x, y: outputY }
        : { x: sourceBoxRightX + fallbackLead, y: outputY }

      segments.push({
        id: generateId(),
        type: 'branch',
        startPoint: start,
        endPoint: firstNode ? applyNodeWireInset(firstEnd, start, firstNode) : firstEnd,
        cable: segmentCable,
        panelId: panel.id,
        domain,
        circuitId: circuit.id,
        fromElementId: sourceNode.domainId,
        fromElementType: 'endpoint',
        toElementId: firstNode?.domainId,
        toElementType: firstNode ? 'endpoint' : undefined,
        inTube: segmentInTube,
        inWall: segmentInWall,
        wireRoute: baseRoute,
        hideWireLabel: segmentHideWireLabel,
        showFireClassLabel: segmentShowFireClassLabel,
        wireLengthM: segmentWireLengthM,
        showWireLengthLabel: segmentShowWireLengthLabel,
        domoticaOutputGroup: group,
        domoticaOutputIndex: index,
      })

      let currentDomain = domain
      for (let childIndex = 0; childIndex < childrenOnRow.length - 1; childIndex++) {
        const fromNode = childrenOnRow[childIndex]!
        const toNode = childrenOnRow[childIndex + 1]!
        const fromEndpoint = fromNode.domainRef as Endpoint | undefined
        const resolved = fromEndpoint?.symbol ? resolveSymbolPortsForWire(fromEndpoint.symbol, currentDomain) : null
        if (resolved?.matched && resolved.oppositePortDomain) currentDomain = resolved.oppositePortDomain
        const fromPt = { x: fromNode.bounds.x, y: outputY }
        const toPt = { x: toNode.bounds.x, y: outputY }
        segments.push({
          id: generateId(),
          type: 'branch',
          startPoint: applyNodeWireInset(fromPt, toPt, fromNode),
          endPoint: applyNodeWireInset(toPt, fromPt, toNode),
          cable: segmentCable,
          panelId: panel.id,
          domain: currentDomain,
          circuitId: circuit.id,
          fromElementId: fromNode.domainId,
          fromElementType: 'endpoint',
          toElementId: toNode.domainId,
          toElementType: 'endpoint',
          inTube: segmentInTube,
          inWall: segmentInWall,
          wireRoute: baseRoute,
          hideWireLabel: segmentHideWireLabel,
          showFireClassLabel: segmentShowFireClassLabel,
          wireLengthM: segmentWireLengthM,
          showWireLengthLabel: segmentShowWireLengthLabel,
          domoticaOutputGroup: group,
          domoticaOutputIndex: index,
        })
      }
    }

    // The module's input remains an ordinary serial branch. Reuse its wire
    // derivation so inline converters before the module retain their domains,
    // section overrides and symbol insets.
    const inputNodes = endpointNodes.slice(0, endpointNodes.indexOf(domoticaNode))
      .filter((node) => !(node.domainRef as Endpoint | undefined)?.domoticaChildProps)
    segments.push(...deriveBranchWires(
      { ...branchNode, children: [...inputNodes, domoticaNode] },
      circuit, panel, trunkX, trunkDomainAtBranch, trunkOriginWireProps,
      trunkOriginSectionRef, isLastBranchOnCircuit, false
    ))
    const moduleInputDomain = getDomoticaEndpointInputDomain(circuit, domoticaNode.domainId!, trunkDomainAtBranch)

    for (let i = 0; i < endpointCount; i++) {
      const outputY = firstOutputY + i * DOMOTICA_OUTPUT_SPACING
      addDomoticaOutputChain(
        domoticaNode,
        'endpoint',
        i,
        outputY,
        DOMOTICA_BRANCH_LEAD,
        endpointOutputWires[i],
        inheritedBranchWireProps,
        moduleInputDomain
      )
    }

    const addNestedDomoticaOutputs = (sourceNode: LayoutNode, ancestry: Set<string>) => {
      const sourceId = sourceNode.domainId
      if (!sourceId || ancestry.has(sourceId)) return
      const source = sourceNode.domainRef as Endpoint | undefined
      if (source?.symbol !== 'domotica') return

      const nextAncestry = new Set(ancestry).add(sourceId)
      const nestedCount = Math.max(
        DOMOTICA_MIN_ENDPOINT_OUTPUTS,
        Math.min(
          DOMOTICA_MAX_ENDPOINT_OUTPUTS,
          Math.trunc(source.domoticaProps?.endpointCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS)
        )
      )
      const nestedVariableHeight = Math.max(0, nestedCount - 1) * DOMOTICA_OUTPUT_SPACING
      const nestedInputY = sourceNode.bounds.y + nestedVariableHeight / 2
      const nestedFirstOutputY = nestedInputY - nestedVariableHeight
      const nestedOutputWires = source.domoticaProps?.endpointOutputWires ?? []

      for (let index = 0; index < nestedCount; index++) {
        addDomoticaOutputChain(
          sourceNode,
          'endpoint',
          index,
          nestedFirstOutputY + index * DOMOTICA_OUTPUT_SPACING,
          DOMOTICA_BRANCH_LEAD,
          nestedOutputWires[index],
          inheritedBranchWireProps,
          getDomoticaEndpointInputDomain(circuit, sourceId, trunkDomainAtBranch)
        )
      }

      for (const childNode of endpointNodes) {
        const child = childNode.domainRef as Endpoint | undefined
        if (
          child?.symbol === 'domotica' &&
          child.domoticaChildProps?.parentEndpointId === sourceId
        ) {
          addNestedDomoticaOutputs(childNode, nextAncestry)
        }
      }
    }

    for (const childNode of endpointNodes) {
      const child = childNode.domainRef as Endpoint | undefined
      if (
        child?.symbol === 'domotica' &&
        child.domoticaChildProps?.parentEndpointId === domoticaNode.domainId
      ) {
        addNestedDomoticaOutputs(childNode, new Set([domoticaNode.domainId ?? '']))
      }
    }
    return segments
  }

  // First segment: trunk (vertical wire) to first endpoint
  const firstNode = endpointNodes[0]! // Safe: checked length === 0 above
  const firstEndpointX = firstNode.bounds.x
  if (
    (isHorizontalConverterBackup && trunkX > firstEndpointX) ||
    (!isHorizontalConverterBackup && trunkX < firstEndpointX)
  ) {
    // For the last (top-most) branch, nudge the horizontal start a tiny
    // bit to the left so the corner visually overlaps the vertical trunk.
    const trunkStartX = isLastBranchOnCircuit
      ? trunkX + ((isHorizontalConverterBackup ? 1 : -1) * LAYOUT_CONSTANTS.BRANCH_LINE_WIDTH) / 2
      : trunkX
    const trunkStart = { x: trunkStartX, y: branchY }
    const firstEnd = { x: firstEndpointX, y: branchY }
    const firstBranchWireProps = inheritedBranchWireProps
    segments.push({
      id: generateId(),
      type: 'branch',
      startPoint: trunkStart,
      endPoint: applyNodeWireInset(firstEnd, trunkStart, firstNode),
      cable: firstBranchWireProps.cable,
      panelId: panel.id,
      domain: trunkDomainAtBranch,
      circuitId: circuit.id,
      fromElementId: trunkOriginSectionRef?.fromElementId,
      fromElementType: trunkOriginSectionRef?.fromElementType,
      toElementId: firstNode.domainId,
      toElementType: 'endpoint',
      inTube: firstBranchWireProps.inTube,
      wireRoute: firstBranchWireProps.wireRoute,
      inWall: firstBranchWireProps.inWall,
      hideWireLabel: firstBranchWireProps.hideWireLabel,
    })
  }
  // Segments between each consecutive pair of endpoints
  let currentBranchDomain = getTrunkDomainAfterNode(trunkDomainAtBranch, firstNode)
  for (let i = 0; i < endpointNodes.length - 1; i++) {
    const fromNode = endpointNodes[i]!
    const toNode = endpointNodes[i + 1]!

    const fromPt = { x: fromNode.bounds.x, y: branchY }
    const toPt = { x: toNode.bounds.x, y: branchY }
    const betweenSectionRef: CircuitSectionRef = {
      fromElementType: 'endpoint',
      fromElementId: fromNode.domainId,
      toElementType: 'endpoint',
      toElementId: toNode.domainId,
      domain: currentBranchDomain,
    }
    const betweenBranchWireProps = getCircuitWirePropertiesForDomain(
      circuit,
      currentBranchDomain,
      betweenSectionRef
    )
    segments.push({
      id: generateId(),
      type: 'branch',
      startPoint: applyNodeWireInset(fromPt, toPt, fromNode),
      endPoint: applyNodeWireInset(toPt, fromPt, toNode),
      cable: betweenBranchWireProps.cable,
      panelId: panel.id,
      domain: currentBranchDomain,
      circuitId: circuit.id,
      fromElementId: fromNode.domainId,
      fromElementType: 'endpoint',
      toElementId: toNode.domainId,
      toElementType: 'endpoint',
      inTube: betweenBranchWireProps.inTube,
      wireRoute: betweenBranchWireProps.wireRoute,
      inWall: betweenBranchWireProps.inWall,
      hideWireLabel: betweenBranchWireProps.hideWireLabel,
    })
    currentBranchDomain = getTrunkDomainAfterNode(currentBranchDomain, toNode)
  }

  return segments
}
