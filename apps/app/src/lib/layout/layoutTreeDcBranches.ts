import type { Circuit, Endpoint, TrunkDevice } from '@/types/schema'

import { getEndpointBranchLabelPrefix } from '@/lib/eendraad/automaticEndpointBranchNaming'
import { formatBranchLabel } from '@/lib/eendraad/labelScheme'
import { getActiveLabelScheme } from '@/lib/eendraad/labelSchemeContext'

import {
  CIRCUIT_CONVERTER_BLOCK_SIZE,
  CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD,
  getCircuitConverterBodyGeometry,
  getCircuitConverterDcConnectionCount,
  getCircuitConverterPrimaryBranch,
  getOrdinaryCircuitConverterOutputRowY,
  supportsCircuitConverterDcConnections,
  getCircuitConverterOutputChainXs,
} from './circuitConverterGeometry'
import { getConverterOutputDeviceSlots } from './circuitConverterOutputSlots'
import { getConverterOutputDevices } from '@/lib/eendraad/converterOutputDevices'
import { getEndpointXOffsets } from './bottomUpBranchWidths'

import {
  getCircuitConverterMetadataCallouts,
  type CircuitConverterMetadataCallout,
} from './circuitConverterMetadataCallouts'

import { translateLayoutNodeHorizontally } from './layoutTreeOrientation'
import { getDefaultSymbolForEndpointType } from './layoutTreeBranchNodes'
import type { BottomUpPanelLayout, BottomUpCircuitLayout } from './bottomUpLayout'

import { LAYOUT_CONSTANTS } from './bottomUpLayoutConstants'
import { getDcBusBranchHorizontalLayouts } from './circuitLayoutEnvelope'
import type { LayoutNode } from './layoutTree'

export function buildCircuitConverterDcConnectionNodes(
  buildMcbNode: (panel: BottomUpPanelLayout, circuit: BottomUpCircuitLayout) => LayoutNode | null,
  panelLayout: BottomUpPanelLayout,
  circuit: Circuit,
  device: TrunkDevice,
  anchor: { x: number; y: number },
  metadataCallouts: Map<string, CircuitConverterMetadataCallout>
): LayoutNode[] {
  if (!supportsCircuitConverterDcConnections(device)) return []

  const count = getCircuitConverterDcConnectionCount(device)
  const geometry = getCircuitConverterBodyGeometry(device, anchor)
  const nestedConverterIds = getNestedDcBusConverterIds(circuit)
  const branchOrder = new Map<string, number>()
  let endpointOrder = 0
  for (const branch of circuit.branches ?? []) {
    for (const endpointId of branch.endpointIds) {
      branchOrder.set(endpointId, endpointOrder++)
    }
  }

  const owningConverterBranch = (circuit.branches ?? []).find((branch) =>
    branch.branchDevices?.some((candidate) => candidate.id === device.id)
  )
  if (count <= 1 && !owningConverterBranch) return []
  const primaryBranch = owningConverterBranch ?? getCircuitConverterPrimaryBranch(circuit, device)
  const primaryIds = new Set(primaryBranch?.endpointIds ?? [])

  const outputNodes = Array.from({ length: count }, (_, connectionIndex): LayoutNode => {
    const connection = { converterId: device.id, connectionIndex }
    const port = geometry.dcPorts[connectionIndex]!
    const rowY = getOrdinaryCircuitConverterOutputRowY(device, anchor.y, connectionIndex)
    const endpoints = circuit.endpoints
      .filter((endpoint) =>
        endpoint.converterDcConnection?.converterId === device.id &&
        endpoint.converterDcConnection.connectionIndex === connectionIndex
          ? true
          : connectionIndex === 0 && primaryIds.has(endpoint.id) && !endpoint.converterDcConnection
      )
      .sort(
        (a, b) =>
          (branchOrder.get(a.id) ?? circuit.endpoints.indexOf(a)) -
          (branchOrder.get(b.id) ?? circuit.endpoints.indexOf(b))
      )
    // The output's circuit devices in their order from the converter (a DC rail last).
    const linkedDevices = getConverterOutputDevices(
      [
        ...(circuit.trunkDevices ?? []),
        ...(circuit.branches ?? []).flatMap((branch) => branch.branchDevices ?? []),
      ],
      connection
    )
    const hasDcBus = linkedDevices.some((candidate) => candidate.type === 'dc_bus')
    // A converter-linked DC rail is the terminal of this output. Legacy data
    // may still contain endpoints attached to the parent output; do not render
    // those as a second chain beyond the rail.
    const renderedEndpoints = hasDcBus ? [] : endpoints
    const chainLength = linkedDevices.length + renderedEndpoints.length
    const endpointOffsets = getEndpointXOffsets(
      renderedEndpoints,
      CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD,
      LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING,
      LAYOUT_CONSTANTS.APPLIANCE_AFTER_SOCKET_GAP
    )
    // Devices one step apart behind the lead, endpoints behind them; an output ending in a DC
    // rail keeps its compact device spacing.
    const chainXs = getCircuitConverterOutputChainXs({
      portX: port.x,
      deviceCount: linkedDevices.length,
      endpointOffsets: renderedEndpoints.map(
        (_, endpointIndex) => endpointOffsets[endpointIndex] ?? CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD
      ),
      deviceStep: hasDcBus ? LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING : undefined,
    })
    const itemX = (index: number) => chainXs.deviceXs[index] ?? port.x
    const deviceNodes: LayoutNode[] = linkedDevices.map((linkedDevice, deviceIndex) => {
      const linkedBusCircuitIds =
        linkedDevice.type !== 'dc_bus'
          ? []
          : [
              ...(linkedDevice.dcBusProps?.branchCircuitIds ?? []),
              ...(circuit.subCircuitIds ?? []).filter((circuitId) => {
                if (linkedDevice.dcBusProps?.branchCircuitIds?.includes(circuitId)) return false
                const child = panelLayout.circuits.find((layout) => layout.circuit.id === circuitId)
                return child?.circuit.dcBusSource?.busId === linkedDevice.id
              }),
            ]
      const linkedBusLayouts = linkedBusCircuitIds
        .map((circuitId) => panelLayout.circuits.find((layout) => layout.circuit.id === circuitId))
        .filter((layout): layout is BottomUpCircuitLayout => !!layout)
      const linkedBusEntries = linkedBusLayouts.flatMap((layout) => {
        const node = buildMcbNode(panelLayout, layout)
        return node ? [{ layout, node }] : []
      })
      const linkedBusChildren = linkedBusEntries.map(({ node }) => node)
      // A converter-linked DC bus is anchored at the output it belongs to.
      // Using itemX(0) here made a bus persisted on the last output render from
      // the first converter port, even though its vertical row used the correct
      // connection index.
      const baseX = linkedDevice.type === 'dc_bus' ? port.x : itemX(deviceIndex)
      const dcBusBranches =
        linkedDevice.type === 'dc_bus'
          ? (circuit.branches ?? []).filter((branch) => branch.dcBusId === linkedDevice.id)
          : []
      const endpointById = new Map(circuit.endpoints.map((endpoint) => [endpoint.id, endpoint]))
      const dcBusBranchLayouts =
        linkedDevice.type === 'dc_bus'
          ? getDcBusBranchHorizontalLayouts(circuit, linkedDevice.id, {
              symbolSize: LAYOUT_CONSTANTS.SYMBOL_SIZE,
              protectionWidth: LAYOUT_CONSTANTS.PROTECTION_WIDTH,
              branchLeadIn: LAYOUT_CONSTANTS.BRANCH_LEAD_IN,
              endpointSpacing: LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING,
              applianceAfterSocketGap: LAYOUT_CONSTANTS.APPLIANCE_AFTER_SOCKET_GAP,
              endpointBranchSpacing: LAYOUT_CONSTANTS.ENDPOINT_BRANCH_SPACING,
              protectionLabelOffset: 0,
              spdProtectionLabelOffset: 0,
              protectionTechnicalLabelOffset: 0,
              secondaryBusPanelColumnWidth: 0,
              secondaryBusExtension: LAYOUT_CONSTANTS.SECONDARY_BUS_EXTENSION,
              dcBusMinWidth: LAYOUT_CONSTANTS.DC_BUS_MIN_WIDTH,
              dcBusBranchLeadIn: LAYOUT_CONSTANTS.DC_BUS_BRANCH_LEAD_IN,
              dcBusBranchMinSpacing: LAYOUT_CONSTANTS.SUPPLY_DC_BUS_BRANCH_MIN_SPACING,
              dcBusBranchLabelGap: LAYOUT_CONSTANTS.SUPPLY_DC_BUS_BRANCH_LABEL_GAP,
              nestedGutter: 0,
              circuitNotesOrientation: 'horizontal',
            })
          : []
      const dcBusBranchChildren: LayoutNode[] = dcBusBranches.map((branch, branchIndex) => {
        const branchX =
          baseX +
          (dcBusBranchLayouts[branchIndex]?.offset ?? LAYOUT_CONSTANTS.DC_BUS_BRANCH_LEAD_IN)
        const branchDevices = (branch.branchDevices ?? []).filter(
          (candidate) => !isNestedDcBusConverterOutput(candidate, nestedConverterIds)
        )
        const branchEndpoints = branch.endpointIds.flatMap((id) => {
          const endpoint = endpointById.get(id)
          return endpoint && !isNestedDcBusConverterOutput(endpoint, nestedConverterIds)
            ? [endpoint]
            : []
        })
        const verticalStep = LAYOUT_CONSTANTS.SYMBOL_SIZE + LAYOUT_CONSTANTS.TRUNK_DEVICE_SPACING
        const branchDeviceNodes: LayoutNode[] = branchDevices.map((branchDevice, deviceIndex) => {
          const branchAnchor = {
            x: branchX,
            y: rowY - (deviceIndex + 1) * verticalStep,
          }
          const hitZone: LayoutNode['hitZone'] = {
            type: 'circuit',
            padding: 15,
            converterDcConnection: connection,
            dcBusId: linkedDevice.id,
            branchDeviceInsertIndex: deviceIndex,
            wireDomain: 'DC',
          }
          return supportsCircuitConverterDcConnections(branchDevice)
            ? buildNestedDcBusConverterNode(
                buildMcbNode,
                panelLayout,
                circuit,
                branchDevice,
                branchAnchor,
                `dc-bus-branch-device-${linkedDevice.id}-${branch.id}-${branchDevice.id}`,
                hitZone
              )
            : {
                id: `dc-bus-branch-device-${linkedDevice.id}-${branch.id}-${branchDevice.id}`,
                type: 'trunkDevice',
                bounds: {
                  ...branchAnchor,
                  width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
                  height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
                },
                domainId: branchDevice.id,
                domainRef: branchDevice,
                visual: {
                  type: 'symbol',
                  symbolId: branchDevice.symbol,
                  label: branchDevice.label,
                  rotationDeg: branchDevice.symbol === 'relay' ? 90 : undefined,
                },
                hitZone,
                children: [],
              }
        })
        const endpointNodes = branchEndpoints.map((endpoint, endpointIndex): LayoutNode => {
          const endpointY = rowY - (branchDevices.length + endpointIndex + 1) * verticalStep
          const isResizableConverterEndpoint =
            endpoint.symbol === 'dc_dc_converter' || endpoint.symbol === 'inverter'
          return {
            id: `dc-bus-endpoint-${linkedDevice.id}-${branch.id}-${endpoint.id}`,
            type: 'endpoint',
            bounds: {
              x: branchX,
              y: endpointY,
              width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
              height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
            },
            connectionAnchor: isResizableConverterEndpoint
              ? { x: branchX, y: endpointY }
              : undefined,
            converterGrowthDirection: isResizableConverterEndpoint ? 'right' : undefined,
            domainId: endpoint.id,
            domainRef: endpoint,
            visual: {
              type: 'symbol',
              symbolId: endpoint.symbol || getDefaultSymbolForEndpointType(endpoint.type),
              label: endpoint.label,
              isEndpointAtBranchEnd: endpointIndex === branchEndpoints.length - 1,
            },
            hitZone: {
              type: 'endpoint',
              padding: 15,
              converterDcConnection: connection,
              dcBusId: linkedDevice.id,
              branchInsertAfterEndpointId: endpoint.id,
              wireDomain: 'DC',
            },
            children: [],
          }
        })
        const itemCount = branchDevices.length + branchEndpoints.length
        const wireNodes: LayoutNode[] = Array.from({ length: itemCount }, (_, itemIndex) => {
          const fromY = itemIndex === 0 ? rowY : rowY - itemIndex * verticalStep
          const toY = rowY - (itemIndex + 1) * verticalStep
          const endpointIndex = itemIndex - branchDevices.length
          const isBeforeEndpointChain = itemIndex <= branchDevices.length
          return {
            id: `dc-bus-branch-wire-${linkedDevice.id}-${branch.id}-${itemIndex}`,
            type: 'wire',
            bounds: {
              x: branchX - 9,
              y: Math.min(fromY, toY),
              width: 18,
              height: Math.abs(fromY - toY),
            },
            hitZone: {
              type: 'circuit',
              padding: 0,
              converterDcConnection: connection,
              dcBusId: linkedDevice.id,
              ...(isBeforeEndpointChain
                ? {
                    branchInsertAfterEndpointId:
                      endpointIndex <= 0 ? null : branchEndpoints[endpointIndex - 1]!.id,
                    branchDeviceInsertIndex: itemIndex,
                  }
                : {}),
              wireDomain: 'DC',
            },
            children: [],
          }
        })
        const topY = endpointNodes.at(-1)?.bounds.y ?? branchDeviceNodes.at(-1)?.bounds.y ?? rowY
        return {
          id: `dc-bus-branch-${linkedDevice.id}-${branch.id}`,
          type: 'branch',
          bounds: {
            x: branchX - 9,
            y: Math.min(topY, rowY),
            width: 18,
            height: Math.max(18, rowY - topY),
          },
          domainId: branch.id,
          hitZone: {
            type: 'circuit',
            padding: 0,
            converterDcConnection: connection,
            dcBusId: linkedDevice.id,
            branchInsertAfterEndpointId: branchEndpoints.at(-1)?.id ?? null,
            branchDeviceInsertIndex: branchDevices.length,
            wireDomain: 'DC',
          },
          children: [...wireNodes, ...branchDeviceNodes, ...endpointNodes],
        }
      })
      if (linkedDevice.type === 'dc_bus') {
        const baseWidth = Math.max(LAYOUT_CONSTANTS.PROTECTION_WIDTH, LAYOUT_CONSTANTS.SYMBOL_SIZE)
        let nextAnchorX = baseX + LAYOUT_CONSTANTS.DC_BUS_BRANCH_LEAD_IN
        linkedBusEntries.forEach(({ layout, node }, branchIndex) => {
          const anchorOffset = layout.leftReserve + baseWidth / 2
          const targetX = nextAnchorX
          translateLayoutNodeHorizontally(node, targetX - node.bounds.x)
          const rightReach = Math.max(0, layout.width - anchorOffset)
          const nextLayout = linkedBusEntries[branchIndex + 1]?.layout
          const nextLeftReach = nextLayout ? nextLayout.leftReserve + baseWidth / 2 : 0
          nextAnchorX =
            targetX + rightReach + LAYOUT_CONSTANTS.CIRCUIT_ENVELOPE_GUTTER + nextLeftReach
        })
      }
      const attachmentXs = [
        ...linkedBusChildren.map((node) => node.bounds.x),
        ...dcBusBranchChildren.map((node) => node.bounds.x + node.bounds.width / 2),
      ]
      const minX = baseX - LAYOUT_CONSTANTS.DC_BUS_LEFT_EXTENSION
      const maxX = Math.max(
        baseX + LAYOUT_CONSTANTS.DC_BUS_MIN_WIDTH,
        ...attachmentXs.map((x) => x + LAYOUT_CONSTANTS.SECONDARY_BUS_EXTENSION)
      )
      const busSegments: LayoutNode[] = []
      if (linkedDevice.type === 'dc_bus') {
        const waypoints = [minX, ...[...attachmentXs].sort((a, b) => a - b), maxX]
        for (let segmentIndex = 0; segmentIndex < waypoints.length - 1; segmentIndex += 1) {
          const startX = waypoints[segmentIndex]!
          const endX = waypoints[segmentIndex + 1]!
          if (endX <= startX) continue
          busSegments.push({
            id: `secondary-bus-segment-${circuit.id}-${linkedDevice.id}-${segmentIndex}`,
            type: 'wire',
            bounds: {
              x: startX,
              y: rowY - LAYOUT_CONSTANTS.BUS_THICKNESS / 2,
              width: endX - startX,
              height: LAYOUT_CONSTANTS.BUS_THICKNESS,
            },
            visual: { type: 'busBar', thickness: LAYOUT_CONSTANTS.BUS_THICKNESS },
            hitZone: {
              type: 'circuit',
              padding: 20,
              converterDcConnection: connection,
              dcBusId: linkedDevice.id,
            },
            children: [],
          })
        }
      }
      return {
        id: `converter-dc-device-${device.id}-${connectionIndex}-${linkedDevice.id}`,
        type: 'trunkDevice',
        bounds: {
          x: linkedDevice.type === 'dc_bus' ? (minX + maxX) / 2 : baseX,
          y: rowY,
          width:
            linkedDevice.type === 'dc_bus'
              ? Math.max(LAYOUT_CONSTANTS.DC_BUS_MIN_WIDTH, maxX - minX)
              : LAYOUT_CONSTANTS.SYMBOL_SIZE,
          height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
        },
        connectionAnchor: linkedDevice.type === 'dc_bus' ? { x: baseX, y: rowY } : undefined,
        domainId: linkedDevice.id,
        domainRef: linkedDevice,
        visual: {
          type: 'symbol',
          symbolId: linkedDevice.symbol,
          label: linkedDevice.label,
          rotationDeg: linkedDevice.symbol === 'relay' ? 90 : undefined,
        },
        hitZone: {
          type: 'circuit',
          padding: 15,
          converterDcConnection: connection,
          ...(linkedDevice.type === 'dc_bus' ? { dcBusId: linkedDevice.id } : {}),
        },
        children: [...busSegments, ...linkedBusChildren, ...dcBusBranchChildren],
        ...(attachmentXs.length > 0 ? { nestedChildXs: attachmentXs } : {}),
      }
    })
    const isSingleEndpoint = chainLength === 1
    const endpointNodes: LayoutNode[] = renderedEndpoints.map((endpoint, endpointIndex) => ({
      id: `converter-dc-endpoint-${device.id}-${connectionIndex}-${endpoint.id}`,
      type: 'endpoint',
      bounds: {
        x: chainXs.endpointXs[endpointIndex] ?? port.x,
        y: rowY,
        width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
        height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
      },
      domainId: endpoint.id,
      domainRef: endpoint,
      visual: {
        type: 'symbol',
        symbolId: endpoint.symbol || getDefaultSymbolForEndpointType(endpoint.type),
        label: endpoint.label,
        isEndpointAtBranchEnd: endpointIndex === endpoints.length - 1,
      },
      hitZone: {
        type: 'endpoint',
        padding: 15,
        converterDcConnection: connection,
        wireDomain: 'DC',
      },
      children: [],
    }))

    const chainNodes = [...deviceNodes, ...endpointNodes].sort((a, b) => a.bounds.x - b.bounds.x)
    const wireRight = chainNodes.at(-1)?.bounds.x ?? port.x
    const storedBranch = (circuit.branches ?? []).find((branch) =>
      branch.endpointIds.some((endpointId) =>
        renderedEndpoints.some((endpoint) => endpoint.id === endpointId)
      )
    )
    const labelText =
      connectionIndex === 0 || chainLength > 0
        ? formatBranchLabel(
            getActiveLabelScheme(),
            getEndpointBranchLabelPrefix(circuit),
            connectionIndex + 1
          ) ||
          storedBranch?.label?.trim() ||
          ''
        : ''
    const hitPadding = 9
    const verticalHitNode: LayoutNode = {
      id: `converter-dc-output-hit-${device.id}-${connectionIndex}-vertical`,
      type: 'wire',
      bounds: {
        x: port.x - hitPadding,
        y: Math.min(port.y, rowY) - hitPadding,
        width: hitPadding * 2,
        height: Math.abs(port.y - rowY) + hitPadding * 2,
      },
      domainId: device.id,
      domainRef: device,
      hitZone: {
        type: 'circuit',
        padding: 0,
        converterDcConnection: connection,
        suppressDropHint: true,
      },
      children: [],
    }
    const horizontalHitNode: LayoutNode = {
      id: `converter-dc-output-hit-${device.id}-${connectionIndex}-horizontal`,
      type: 'wire',
      bounds: {
        x: port.x - hitPadding,
        y: rowY - hitPadding,
        width: Math.max(hitPadding * 2, wireRight - port.x + hitPadding * 2),
        height: hitPadding * 2,
      },
      domainId: device.id,
      domainRef: device,
      hitZone: {
        type: 'circuit',
        padding: 0,
        converterDcConnection: connection,
        suppressDropHint: true,
      },
      children: [],
    }

    return {
      id: `converter-dc-output-${device.id}-${connectionIndex}`,
      type: 'branch',
      bounds: {
        x: isSingleEndpoint ? port.x - 14 : port.x,
        y: rowY - 10,
        width: isSingleEndpoint
          ? 28
          : Math.max(CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD, wireRight - port.x),
        height: 20,
      },
      domainId: `converter-dc-output-${device.id}-${connectionIndex}`,
      hitZone: { type: 'circuit', padding: 0, converterDcConnection: connection },
      children: [
        ...getConverterOutputDeviceSlots({
          circuitId: circuit.id,
          connection,
          port,
          rowY,
          deviceXs: chainXs.deviceXs.filter((_, index) => linkedDevices[index]?.type !== 'dc_bus'),
          firstEndpointX: chainXs.endpointXs[0],
        }),
        verticalHitNode,
        ...(chainLength <= 1 ? [] : [horizontalHitNode]),
        ...deviceNodes,
        ...endpointNodes,
        ...(labelText
          ? [
              {
                id: `converter-dc-output-label-${device.id}-${connectionIndex}`,
                type: 'label' as const,
                bounds: {
                  x: anchor.x - LAYOUT_CONSTANTS.LABEL_OFFSET,
                  y: rowY,
                  width: 100,
                  height: 20,
                },
                visual: {
                  type: 'label' as const,
                  text: labelText,
                  fontSize: 12,
                  align: 'right' as const,
                },
                children: [],
              },
            ]
          : []),
      ],
    }
  })

  const metadataCalloutByTargetId = new Map<string, CircuitConverterMetadataCallout>()
  metadataCallouts.forEach((callout) => {
    callout.sharedTargetIds.forEach((targetId) => metadataCalloutByTargetId.set(targetId, callout))
  })
  outputNodes.forEach((outputNode) => {
    outputNode.children.forEach((node) => {
      if (node.type !== 'endpoint' || node.visual?.type !== 'symbol' || !node.domainId) return
      const callout = metadataCalloutByTargetId.get(node.domainId)
      if (!callout) return
      if (callout.targetId !== node.domainId) {
        node.visual.suppressMetadataLabel = true
        return
      }
      node.visual.metadataCallout = {
        x: callout.x,
        y: callout.y,
        width: callout.width,
        height: callout.height,
        leaderPoints: callout.leaderPoints,
        leaderSegments: callout.leaderSegments,
        targetIds: callout.sharedTargetIds,
        totalMultiplier: callout.totalMultiplier,
      }
    })
  })
  return outputNodes
}

export function getNestedDcBusConverterIds(circuit: Circuit): Set<string> {
  return new Set(
    (circuit.branches ?? []).flatMap((branch) =>
      (branch.branchDevices ?? []).flatMap((device) =>
        supportsCircuitConverterDcConnections(device) ? [device.id] : []
      )
    )
  )
}

export function isNestedDcBusConverterOutput(
  item: Pick<Endpoint | TrunkDevice, 'converterDcConnection'>,
  nestedConverterIds: ReadonlySet<string>
): boolean {
  return (
    !!item.converterDcConnection && nestedConverterIds.has(item.converterDcConnection.converterId)
  )
}

export function buildNestedDcBusConverterNode(
  buildMcbNode: (panel: BottomUpPanelLayout, circuit: BottomUpCircuitLayout) => LayoutNode | null,
  panelLayout: BottomUpPanelLayout,
  circuit: Circuit,
  device: TrunkDevice,
  anchor: { x: number; y: number },
  id: string,
  hitZone: LayoutNode['hitZone']
): LayoutNode {
  const geometry = getCircuitConverterBodyGeometry(device, anchor)
  const metadataCallouts = getCircuitConverterMetadataCallouts({
    circuit,
    device,
    anchor,
    symbolSize: LAYOUT_CONSTANTS.SYMBOL_SIZE,
    endpointSpacing: LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING,
    applianceAfterSocketGap: LAYOUT_CONSTANTS.APPLIANCE_AFTER_SOCKET_GAP,
  })
  const callout = metadataCallouts.get(device.id)
  return {
    id,
    type: 'trunkDevice',
    bounds: {
      x: geometry.center.x,
      y: geometry.center.y,
      width: geometry.width + (LAYOUT_CONSTANTS.SYMBOL_SIZE - CIRCUIT_CONVERTER_BLOCK_SIZE),
      height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
    },
    connectionAnchor: { ...anchor },
    converterGrowthDirection: 'right',
    domainId: device.id,
    domainRef: device,
    visual: {
      type: 'symbol',
      symbolId: device.symbol,
      label: device.label,
      metadataCallout: callout
        ? {
            x: callout.x,
            y: callout.y,
            width: callout.width,
            height: callout.height,
            leaderPoints: callout.leaderPoints,
            leaderSegments: callout.leaderSegments,
          }
        : undefined,
    },
    hitZone,
    children: buildCircuitConverterDcConnectionNodes(
      buildMcbNode,
      panelLayout,
      circuit,
      device,
      anchor,
      metadataCallouts
    ),
  }
}

export function buildOrdinaryDcBusEndpointBranchNodes(
  buildMcbNode: (panel: BottomUpPanelLayout, circuit: BottomUpCircuitLayout) => LayoutNode | null,
  panelLayout: BottomUpPanelLayout,
  circuit: Circuit,
  bus: TrunkDevice,
  rowY: number,
  baseX: number,
  connection?: { converterId: string; connectionIndex: number }
): LayoutNode[] {
  const endpointById = new Map(circuit.endpoints.map((endpoint) => [endpoint.id, endpoint]))
  const nestedConverterIds = getNestedDcBusConverterIds(circuit)
  const branchLayouts = getDcBusBranchHorizontalLayouts(circuit, bus.id, {
    symbolSize: LAYOUT_CONSTANTS.SYMBOL_SIZE,
    protectionWidth: LAYOUT_CONSTANTS.PROTECTION_WIDTH,
    branchLeadIn: LAYOUT_CONSTANTS.BRANCH_LEAD_IN,
    endpointSpacing: LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING,
    applianceAfterSocketGap: LAYOUT_CONSTANTS.APPLIANCE_AFTER_SOCKET_GAP,
    endpointBranchSpacing: LAYOUT_CONSTANTS.ENDPOINT_BRANCH_SPACING,
    protectionLabelOffset: 0,
    spdProtectionLabelOffset: 0,
    protectionTechnicalLabelOffset: 0,
    secondaryBusPanelColumnWidth: 0,
    secondaryBusExtension: LAYOUT_CONSTANTS.SECONDARY_BUS_EXTENSION,
    dcBusMinWidth: LAYOUT_CONSTANTS.DC_BUS_MIN_WIDTH,
    dcBusBranchLeadIn: LAYOUT_CONSTANTS.DC_BUS_BRANCH_LEAD_IN,
    dcBusBranchMinSpacing: LAYOUT_CONSTANTS.SUPPLY_DC_BUS_BRANCH_MIN_SPACING,
    dcBusBranchLabelGap: LAYOUT_CONSTANTS.SUPPLY_DC_BUS_BRANCH_LABEL_GAP,
    nestedGutter: 0,
    circuitNotesOrientation: 'horizontal',
  })
  return (circuit.branches ?? [])
    .filter((branch) => branch.dcBusId === bus.id)
    .filter((branch) => branchLayouts.some((layout) => layout.branchId === branch.id))
    .map((branch) => {
      const branchLayout = branchLayouts.find((layout) => layout.branchId === branch.id)
      const branchX = baseX + (branchLayout?.offset ?? LAYOUT_CONSTANTS.DC_BUS_BRANCH_LEAD_IN)
      const branchDevices = (branch.branchDevices ?? []).filter(
        (device) => !isNestedDcBusConverterOutput(device, nestedConverterIds)
      )
      const ownsImplicitConverterOutput = branchDevices.some((device) =>
        supportsCircuitConverterDcConnections(device)
      )
      const endpoints = branch.endpointIds.flatMap((id) => {
        const endpoint = endpointById.get(id)
        return endpoint &&
          !isNestedDcBusConverterOutput(endpoint, nestedConverterIds) &&
          !(ownsImplicitConverterOutput && !endpoint.converterDcConnection)
          ? [endpoint]
          : []
      })
      const step = LAYOUT_CONSTANTS.SYMBOL_SIZE + LAYOUT_CONSTANTS.TRUNK_DEVICE_SPACING
      const branchDeviceNodes: LayoutNode[] = branchDevices.map((device, deviceIndex) => {
        const anchor = { x: branchX, y: rowY - (deviceIndex + 1) * step }
        const hitZone: LayoutNode['hitZone'] = {
          type: 'circuit',
          padding: 15,
          ...(connection ? { converterDcConnection: connection } : {}),
          dcBusId: bus.id,
          branchDeviceInsertIndex: deviceIndex,
          wireDomain: 'DC',
        }
        return supportsCircuitConverterDcConnections(device)
          ? buildNestedDcBusConverterNode(
              buildMcbNode,
              panelLayout,
              circuit,
              device,
              anchor,
              `dc-bus-branch-device-${bus.id}-${branch.id}-${device.id}`,
              hitZone
            )
          : {
              id: `dc-bus-branch-device-${bus.id}-${branch.id}-${device.id}`,
              type: 'trunkDevice',
              bounds: {
                ...anchor,
                width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
                height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
              },
              domainId: device.id,
              domainRef: device,
              visual: {
                type: 'symbol',
                symbolId: device.symbol,
                label: device.label,
                rotationDeg: device.symbol === 'relay' ? 90 : undefined,
              },
              hitZone,
              children: [],
            }
      })
      const endpointNodes: LayoutNode[] = endpoints.map((endpoint, index) => {
        const endpointY = rowY - (branchDevices.length + index + 1) * step
        const isResizableConverterEndpoint =
          endpoint.symbol === 'dc_dc_converter' || endpoint.symbol === 'inverter'
        return {
          id: `dc-bus-endpoint-${bus.id}-${branch.id}-${endpoint.id}`,
          type: 'endpoint',
          bounds: {
            x: branchX,
            y: endpointY,
            width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
            height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
          },
          connectionAnchor: isResizableConverterEndpoint ? { x: branchX, y: endpointY } : undefined,
          converterGrowthDirection: isResizableConverterEndpoint ? 'right' : undefined,
          domainId: endpoint.id,
          domainRef: endpoint,
          visual: {
            type: 'symbol',
            symbolId: endpoint.symbol || getDefaultSymbolForEndpointType(endpoint.type),
            label: endpoint.label,
            isEndpointAtBranchEnd: index === endpoints.length - 1,
          },
          hitZone: {
            type: 'endpoint',
            padding: 15,
            ...(connection ? { converterDcConnection: connection } : {}),
            dcBusId: bus.id,
            branchInsertAfterEndpointId: endpoint.id,
            wireDomain: 'DC',
          },
          children: [],
        }
      })
      const itemCount = branchDevices.length + endpoints.length
      const wireNodes: LayoutNode[] = Array.from({ length: itemCount }, (_, itemIndex) => {
        const endpointIndex = itemIndex - branchDevices.length
        const isBeforeEndpointChain = itemIndex <= branchDevices.length
        return {
          id: `dc-bus-branch-wire-${bus.id}-${branch.id}-${itemIndex}`,
          type: 'wire',
          bounds: {
            x: branchX - 9,
            y: rowY - (itemIndex + 1) * step,
            width: 18,
            height: step,
          },
          hitZone: {
            type: 'circuit',
            padding: 0,
            ...(connection ? { converterDcConnection: connection } : {}),
            dcBusId: bus.id,
            ...(isBeforeEndpointChain
              ? {
                  branchInsertAfterEndpointId:
                    endpointIndex <= 0 ? null : endpoints[endpointIndex - 1]!.id,
                  branchDeviceInsertIndex: itemIndex,
                }
              : {}),
            wireDomain: 'DC',
          },
          children: [],
        }
      })
      const topY = endpointNodes.at(-1)?.bounds.y ?? branchDeviceNodes.at(-1)?.bounds.y ?? rowY
      return {
        id: `dc-bus-branch-${bus.id}-${branch.id}`,
        type: 'branch',
        bounds: {
          x: branchX - 9,
          y: topY,
          width: 18,
          height: Math.max(18, rowY - topY),
        },
        domainId: branch.id,
        hitZone: {
          type: 'circuit',
          padding: 0,
          ...(connection ? { converterDcConnection: connection } : {}),
          dcBusId: bus.id,
          branchInsertAfterEndpointId: endpoints.at(-1)?.id ?? null,
          branchDeviceInsertIndex: branchDevices.length,
          wireDomain: 'DC',
        },
        children: [...wireNodes, ...branchDeviceNodes, ...endpointNodes],
      } satisfies LayoutNode
    })
}
