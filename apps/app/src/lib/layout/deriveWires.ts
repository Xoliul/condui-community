import { derivePanelGroundWires, deriveSubPanelIncomingWires } from './derivePanelIncomingWires'
import {
  alignSupplyDcBusConnectionLeads,
  alignInlineSplitBusRailsToFeedRisers,
  mirrorWireSegmentHorizontally,
  markSupplyTJunctions,
} from './supplyWireGeometry'
import { createSupplyWireAssemblyContext } from './deriveSupplyWireAssemblyContext'
import { derivePanelBusWires } from './derivePanelBusWires'
import { finalizePanelWires } from './finalizePanelWires'
import { deriveRcdWires, deriveMcbWires } from './deriveCircuitWires'
import {
  getNodeSymbolId,
  applyNodeWireInset,
  getNodeConnectionAnchor,
  findCircuitByIdInPanel,
} from './circuitWireDerivationSupport'
export { findCircuitByIdInPanel } from './circuitWireDerivationSupport'
import { deriveWireAnchorKey } from '@/lib/projectV2/wireRuns'
import { stampWireSegmentAnchors, applyWireRunsToSegments } from '@/lib/wires/wireIdentity'
import type { WireRun } from '@/types/projectV2'

/**
 * Derive wire segments from LayoutNode tree
 *
 * Walks the tree and generates wires based on parent-child connections.
 * This replaces the flat wireSegments.ts approach with a tree-based one.
 */

import { generateId } from '@/utils'
import {
  mirrorInlineSplitBusLayoutNodesHorizontally,
  mirrorLayoutNodeHorizontally,
  mirrorSupplyAssemblyLayoutNodesHorizontally,
  type LayoutNode,
  type LayoutTree,
} from './layoutTree'
import type {
  WireSegment,
  Panel,
  Installation,
  ProtectionDevice,
  TrunkDevice,
  CircuitPhaseAssignment,
} from '@/types/schema'
import { DEFAULT_ELECTRICAL_DOMAIN } from '@/lib/symbols'

import {
  getFullInstallationPhaseAssignment,
  getDownstreamProtectionPhaseAssignment,
  getPanelIncomingPhaseState,
  formatPhaseAssignment,
  supportsExplicitPhaseSelection,
} from '@/lib/wires/phaseAssignment'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import { LAYOUT_CONSTANTS } from './bottomUpLayout'

import { markCircuitEnclosureTransitions } from './circuitEnclosureTransitions'

import {
  CIRCUIT_CONVERTER_BLOCK_SIZE,
  CIRCUIT_CONVERTER_TOP_WIRE_INSET,
  getCircuitConverterBodyGeometry,
  getCircuitConverterDcConnectionCount,
  getOrdinaryCircuitConverterOutputRowY,
  getSupplyConverterBodyGeometry,
  getSupplyConverterHorizontalGrowth,
  supportsCircuitConverterDcConnections,
} from './circuitConverterGeometry'
import { getSupplyConverterDcConnectionIndex } from '@/lib/supplyAssembly/converterDcConnections'
import {
  converterInputSplitNodeId,
  isConverterGridLegPlacement,
  orderConverterGridLegDevicesFromConverter,
} from '@/lib/supplyAssembly/changeoverGridSource'
import {
  ensureInstallationFeedTopology,
  getSupplyWireHideWireLabelForRole,
} from '@/lib/feedTopology'
import {
  applySupplyWireRoleToSegment,
  cableForSupplyWireRole,
  shouldMergeSupplyCrossingWithBusDrop,
  computeSupplySeparatorX,
  resolveSupplySeparatorScope,
  splitHorizontalSpanAtSeparator,
  type SupplySpanEndpoint,
  type SupplyWireRole,
} from '@/lib/supplyWireCables'
import { findPanelById } from '@/lib/panel/panelTree'
import { hasExplicitPanelBusSections } from '@/lib/panel/panelBusSections'
import { getLeftBiasedBusFeedStubX } from '@/lib/panel/panelBusFeedPreview'

import type {
  OffGridSupplyAssembly,
  SupplyConnection,
  ElectricalEnclosureRef,
} from '@/types/supplyAssembly'

function findDescendantNode(
  roots: LayoutNode[],
  predicate: (node: LayoutNode) => boolean
): LayoutNode | undefined {
  for (const node of roots) {
    if (predicate(node)) return node
    const nested = findDescendantNode(node.children, predicate)
    if (nested) return nested
  }
  return undefined
}

/**
 * Derive all wire segments from the layout tree
 */
export function deriveWires(
  tree: LayoutTree,
  panels: Panel[],
  installation?: Installation,
  supplyAssemblies: OffGridSupplyAssembly[] = [],
  resolveSupplyDeviceEnclosure?: (deviceId: string) => ElectricalEnclosureRef | undefined,
  wireRuns: readonly WireRun[] = []
): WireSegment[] {
  const segments: WireSegment[] = []
  if (installation) ensureInstallationFeedTopology(installation, panels)

  for (const panelNode of tree.panels) {
    const panel = findPanelById(panels, panelNode.domainId)
    if (!panel) continue

    const mirrorAxisX = panelNode.horizontalMirrorAxisX
    const mirrorScope = panelNode.horizontalMirrorScope ?? 'panel'
    const converterBackupCircuitIds = new Set(
      panel.protections.flatMap((protection) =>
        (protection.circuits ?? [])
          .filter((circuit) => circuit.supplySource?.kind === 'converter-backup')
          .map((circuit) => circuit.id)
      )
    )
    const mirrorPanelNode = () => {
      if (mirrorAxisX == null) return
      if (mirrorScope === 'panel') mirrorLayoutNodeHorizontally(panelNode, mirrorAxisX, true)
      else {
        mirrorSupplyAssemblyLayoutNodesHorizontally(panelNode, mirrorAxisX, undefined, true)
        if (panelNode.horizontalMirrorInlineSplitBus) {
          mirrorInlineSplitBusLayoutNodesHorizontally(panelNode, mirrorAxisX)
        }
      }
    }
    mirrorPanelNode()
    let panelSegments: WireSegment[]
    try {
      panelSegments = derivePanelWires(
        panelNode,
        panel,
        panels,
        installation,
        supplyAssemblies,
        resolveSupplyDeviceEnclosure
      )
    } finally {
      mirrorPanelNode()
    }
    if (mirrorAxisX != null) {
      panelSegments.forEach((segment) => {
        const isPanelFeedStub =
          segment.id.startsWith('bus-feed-protection-wire-') ||
          (segment.id.startsWith('bus-feed-stub-') && segment.isSupplyTrunk === true)
        const belongsToSupplyAssembly =
          segment.isSupplyTrunk === true ||
          segment.fromElementType === 'ground' ||
          segment.supplySectionKey != null ||
          segment.supplyConnectionId != null ||
          segment.supplyAssemblyId != null ||
          segment.supplyWireRole != null ||
          (segment.circuitId != null && converterBackupCircuitIds.has(segment.circuitId))
        const belongsToInlineSplitBus =
          panelNode.horizontalMirrorInlineSplitBus === true &&
          (segment.type === 'mainBus' || segment.id.startsWith('bus-feed-stub-'))
        if (
          mirrorScope === 'panel' ||
          belongsToInlineSplitBus ||
          (belongsToSupplyAssembly && !isPanelFeedStub)
        ) {
          mirrorWireSegmentHorizontally(segment, mirrorAxisX)
        }
      })
    }
    alignSupplyDcBusConnectionLeads(panelNode, panelSegments)
    alignInlineSplitBusRailsToFeedRisers(panelSegments, mirrorScope)
    const diagramId = panelNode.diagramId ?? panel.id
    panelSegments.forEach((segment) => {
      segment.diagramId = diagramId
    })
    segments.push(...panelSegments)
  }

  stampWireSegmentAnchors(segments, panels, installation, supplyAssemblies)
  applyWireRunsToSegments(segments, wireRuns, installation?.defaultCableKind, panels, installation)
  markCircuitEnclosureTransitions(segments, panels)
  return segments
}

/**
 * Derive wires for a single panel
 */
function derivePanelWires(
  panelNode: LayoutNode,
  panel: Panel,
  panels: Panel[],
  installation?: Installation,
  supplyAssemblies: OffGridSupplyAssembly[] = [],
  resolveSupplyDeviceEnclosure?: (deviceId: string) => ElectricalEnclosureRef | undefined
): WireSegment[] {
  const segments: WireSegment[] = []

  const {
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
  } = createSupplyWireAssemblyContext({
    panelNode,
    panel,
    panels,
    installation,
    supplyAssemblies,
    resolveSupplyDeviceEnclosure,
    segments,
    getDirectConverterNodeForBackup: () => directConverterNodeForBackup,
  })

  // Find supply, ground, and main bus nodes
  const supplyNode = panelNode.children.find((c) => c.type === 'supply')
  const groundNode = panelNode.children.find((c) => c.type === 'ground')
  const mainBusNode = panelNode.children.find((c) => c.type === 'busBar')
  const directConverterNodeForBackup = panelNode.children.find(
    (node) =>
      node.type === 'trunkDevice' &&
      (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'converter-branch'
  )
  let renderedSupplyDeviceNodes: LayoutNode[] = []

  if (!mainBusNode) return segments

  const mainBusY = mainBusNode.bounds.y + mainBusNode.bounds.height / 2
  const mainBusX = mainBusNode.bounds.x
  const mainBusWidth = mainBusNode.bounds.width
  const diagramKey = panelNode.diagramId ?? panel.id
  const isSupplyDiagram = panelNode.diagramId?.endsWith('--supply') ?? false
  const panelIncomingPhaseState = getPanelIncomingPhaseState(
    installation,
    panels,
    panel,
    undefined,
    supplyAssemblies
  )
  const hasMainBusConnections = mainBusNode.children.some((child) => {
    if (child.type !== 'rcd' && child.type !== 'mcb') return false
    const circuit = child.circuitIdForWires
      ? findCircuitByIdInPanel(panel, child.circuitIdForWires)
      : null
    return circuit?.supplySource?.kind !== 'converter-backup'
  })
  const usesInlineEmptySplitAssembly =
    !isSupplyDiagram &&
    panel.isMain === true &&
    hasExplicitPanelBusSections(panel) &&
    !hasMainBusConnections
  const detachedGridGroundY =
    (isSupplyDiagram || usesInlineEmptySplitAssembly) && hasExplicitPanelBusSections(panel)
      ? supplyNode?.bounds.y
      : undefined

  // 1. Ground wire (vertical from ground to main bus) when this board draws an earth electrode
  if (groundNode) {
    derivePanelGroundWires(
      panelNode,
      panel,
      groundNode,
      installation,
      mainBusY,
      detachedGridGroundY,
      segments
    )
  }

  const { busRunForRole, hasPanelFeedStubProtections } = derivePanelBusWires({
    panelNode,
    panel,
    panels,
    installation,
    supplyAssemblies,
    segments,
    getDeviceEnclosureKey,
    mainBusNode,
    mainBusY,
    mainBusX,
    mainBusWidth,
    diagramKey,
    isSupplyDiagram,
    panelIncomingPhaseState,
    hasMainBusConnections,
    usesInlineEmptySplitAssembly,
  })

  // 3. Supply wire (vertical + optional horizontal with trunk devices)
  // For sub-panels: vertical supply wire from main bus down to parent MCB
  const parentMcbNode = panelNode.children.find((c) => c.id === 'parent-mcb')
  if (!supplyNode && parentMcbNode) {
    deriveSubPanelIncomingWires(panelNode, panel, parentMcbNode, mainBusY, segments)
  }

  if (supplyNode && !hasPanelFeedStubProtections) {
    const fallbackCable = {
      kind: 'XVB' as const,
      conductors: 3,
      sectionMm2: 6,
      hasPE: true,
    }
    const downstreamCable = installation
      ? cableForSupplyWireRole(installation, panels, panel, 'downstream')
      : fallbackCable

    const supplyTrunkDeviceNodes = panelNode.children
      .filter((c) => c.type === 'trunkDevice' && c.id?.startsWith('supplyTrunkDevice-'))
      .sort((a, b) => a.bounds.x - b.bounds.x)
    renderedSupplyDeviceNodes = supplyTrunkDeviceNodes
    const verticalSupplyWireNode = findDescendantNode(
      panelNode.children,
      (node) =>
        node.id === `supply-wire-vertical-${panelNode.diagramId ?? panel.id}` ||
        node.id === `supply-wire-vertical-${panel.id}`
    )
    const resolvedSupplyBendX = verticalSupplyWireNode
      ? verticalSupplyWireNode.bounds.x + verticalSupplyWireNode.bounds.width / 2
      : supplyTrunkDeviceNodes[0]?.bounds.x != null
        ? supplyTrunkDeviceNodes[0].bounds.x - LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
        : supplyNode.bounds.x
    const fullSupplyPhaseAssignment = getFullInstallationPhaseAssignment(
      installation?.nominalVoltage.system
    )
    const supplyDeviceById = new Map(
      [
        ...(installation?.mainSupply.supplyTrunkDevices ?? []),
        ...(feedTopology?.sharedFeed.trunkDevices ?? []),
        ...(rootFeed?.trunkDevices ?? []),
      ].map((device) => [device.id, device])
    )
    const resolveSupplyNodeDevice = (node: LayoutNode): TrunkDevice | undefined => {
      const candidate = node.domainRef as TrunkDevice | undefined
      const idFromLayout = node.id?.replace(/^supplyTrunkDevice-/, '')
      return (
        (node.domainId ? supplyDeviceById.get(node.domainId) : undefined) ??
        (idFromLayout ? supplyDeviceById.get(idFromLayout) : undefined) ??
        candidate
      )
    }
    const serialSupplyProtectionNodes = supplyTrunkDeviceNodes
      .filter((node) => {
        const device = resolveSupplyNodeDevice(node)
        return (
          device?.type === 'protection' &&
          (device.supplyPath == null || device.supplyPath === 'serial')
        )
      })
      .sort((left, right) => right.bounds.x - left.bounds.x)
    const applySupplyPhaseState = (segment: WireSegment, role: SupplyWireRole) => {
      const sampleX = (segment.startPoint.x + segment.endPoint.x) / 2
      const serialAssignment = serialSupplyProtectionNodes
        .filter((node) => node.bounds.x > sampleX)
        .reduce(
          (assignment, node) =>
            getDownstreamProtectionPhaseAssignment(
              resolveSupplyNodeDevice(node)!,
              installation?.nominalVoltage.system,
              assignment
            ),
          fullSupplyPhaseAssignment
        )
      const hasSerialReduction =
        serialAssignment?.phases.join('|') !== fullSupplyPhaseAssignment?.phases.join('|')
      segment.phaseAssignment =
        role === 'downstream' && !hasSerialReduction
          ? (panelIncomingPhaseState.assignment ?? serialAssignment)
          : serialAssignment
      segment.showPhaseLabel = hasSerialReduction && panelIncomingPhaseState.showPhaseLabel === true
    }

    const applySupplyLabelVisibility = (
      verticalSeg: WireSegment | undefined,
      mergeCrossingWithBusDrop: boolean
    ) => {
      if (!installation || !verticalSeg) return
      const hasSectionVisibilityOverride = (segment: WireSegment) =>
        segment.supplySectionKey != null &&
        rootFeed?.wireSections?.[segment.supplySectionKey]?.hideWireLabel !== undefined
      const downstreamHidden = getSupplyWireHideWireLabelForRole(
        installation,
        panels,
        panel,
        'downstream'
      )
      const crossingHidden = getSupplyWireHideWireLabelForRole(
        installation,
        panels,
        panel,
        'crossing'
      )
      const upstreamHidden = getSupplyWireHideWireLabelForRole(
        installation,
        panels,
        panel,
        'upstream'
      )
      if (mergeCrossingWithBusDrop) {
        verticalSeg.supplyMergesCrossingToBus = true
        if (!hasSectionVisibilityOverride(verticalSeg)) {
          verticalSeg.hideWireLabel = downstreamHidden
        }
      } else if (!hasSectionVisibilityOverride(verticalSeg)) {
        verticalSeg.hideWireLabel = true
      }
      for (const seg of segments) {
        if (!seg.isSupplyTrunk || seg.type !== 'branch') continue
        if (seg.supplyMergedIntoBusDrop) {
          if (!hasSectionVisibilityOverride(seg)) seg.hideWireLabel = true
          continue
        }
        if (seg.supplyWireRole === 'upstream') {
          if (!hasSectionVisibilityOverride(seg)) seg.hideWireLabel = upstreamHidden
          continue
        }
        if (seg.supplyWireRole === 'crossing' && !mergeCrossingWithBusDrop) {
          if (!hasSectionVisibilityOverride(seg)) seg.hideWireLabel = crossingHidden
          continue
        }
        if (seg.supplyWireRole === 'downstream' && !mergeCrossingWithBusDrop) {
          if (!hasSectionVisibilityOverride(seg)) seg.hideWireLabel = downstreamHidden
        }
      }
    }

    const pushConverterDcWires = (converterNode: LayoutNode) => {
      const { x: converterX, y: converterY } = getNodeConnectionAnchor(converterNode)
      const byDistanceFromConverter = (a: LayoutNode, b: LayoutNode) => {
        const aDistance = (a.bounds.x - converterX) ** 2 + (a.bounds.y - converterY) ** 2
        const bDistance = (b.bounds.x - converterX) ** 2 + (b.bounds.y - converterY) ** 2
        if (aDistance !== bDistance) return aDistance - bDistance
        return a.bounds.x - b.bounds.x
      }
      const dcDeviceNodes = supplyTrunkDeviceNodes
        .filter((node) => {
          if (node === converterNode) return false
          const device = node.domainRef as TrunkDevice | undefined
          return device
            ? getSupplyConverterDcConnectionIndex(device) === 0 && !device.supplyDcBusId
            : false
        })
        .sort(byDistanceFromConverter)
      const sideDcLaneGrowth = getSupplyConverterHorizontalGrowth(
        converterNode.domainRef as TrunkDevice
      )
      const converterRight = applyNodeWireInset(
        { x: converterX, y: converterY },
        {
          x:
            dcDeviceNodes[0]?.bounds.x ??
            converterX + LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_SLOT_LENGTH + sideDcLaneGrowth,
          y: converterY,
        },
        converterNode
      )
      const dcWaypoints = [
        { point: converterRight, node: undefined as LayoutNode | undefined },
        ...dcDeviceNodes.map((node) => ({ point: getNodeConnectionAnchor(node), node })),
        ...(dcDeviceNodes.length === 0
          ? [
              {
                point: {
                  x:
                    converterX +
                    LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_SLOT_LENGTH +
                    sideDcLaneGrowth,
                  y: converterY,
                },
                node: undefined as LayoutNode | undefined,
              },
            ]
          : []),
      ]
      const dcPathNodeIds = [
        converterNode.domainId,
        ...dcDeviceNodes.map((node) => node.domainId),
      ].filter((id): id is string => !!id)
      const dcSectionEndpoints = [
        `converter:${converterNode.domainId ?? panel.id}:dc-right`,
        ...dcDeviceNodes.map((node) => `device:${node.domainId ?? node.id}`),
        ...(dcDeviceNodes.length === 0
          ? [`dc-open:${converterNode.domainId ?? panel.id}:right`]
          : []),
      ]
      for (let index = 0; index < dcWaypoints.length - 1; index++) {
        const from = dcWaypoints[index]!
        const to = dcWaypoints[index + 1]!
        const start = from.node
          ? from.node.connectionAnchor
            ? from.point
            : applyNodeWireInset(from.point, to.point, from.node)
          : from.point
        const end = to.node
          ? to.node.connectionAnchor
            ? to.point
            : applyNodeWireInset(to.point, from.point, to.node)
          : to.point
        const sectionKey = supplySectionKey(
          'converter-dc-right',
          dcSectionEndpoints[index]!,
          dcSectionEndpoints[index + 1]!
        )
        const connection = findAssemblyConnection(dcPathNodeIds[index], dcPathNodeIds[index + 1])
        const points =
          start.x !== end.x && start.y !== end.y
            ? [start, { x: end.x, y: start.y }, end]
            : [start, end]
        for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex++) {
          const segmentStart = points[pointIndex]!
          const segmentEnd = points[pointIndex + 1]!
          segments.push(
            applyAssemblyConnection(
              applySupplySection(
                {
                  id: generateId(),
                  type: segmentStart.x === segmentEnd.x ? 'vertical' : 'branch',
                  startPoint: segmentStart,
                  endPoint: segmentEnd,
                  cable: fallbackCable,
                  panelId: panel.id,
                  domain: 'DC',
                  hideWireLabel: true,
                },
                sectionKey
              ),
              connection
            )
          )
        }
      }

      const converterDevice = converterNode.domainRef as TrunkDevice
      const occupiedTopPortCount = Math.max(
        1,
        ...supplyTrunkDeviceNodes
          .map((node) => {
            const device = node.domainRef as TrunkDevice | undefined
            return device ? getSupplyConverterDcConnectionIndex(device) : undefined
          })
          .filter((index): index is number => index != null)
      )
      const visibleTopPortCount = Math.max(
        getCircuitConverterDcConnectionCount(converterDevice),
        occupiedTopPortCount
      )
      const converterGeometry =
        converterNode.converterGrowthDirection === 'left'
          ? getSupplyConverterBodyGeometry(converterDevice, { x: converterX, y: converterY })
          : getCircuitConverterBodyGeometry(converterDevice, { x: converterX, y: converterY })
      for (let connectionIndex = 1; connectionIndex <= visibleTopPortCount; connectionIndex++) {
        const verticalNode = findDescendantNode(
          panelNode.children,
          (node) =>
            node.id === `supply-direct-converter-dc-top-${connectionIndex}-vertical-${panel.id}`
        )
        if (!verticalNode) continue
        const portX = verticalNode.bounds.x + verticalNode.bounds.width / 2
        const topY =
          verticalNode.bounds.y +
          (verticalNode.bounds.y < converterY ? 10 : verticalNode.bounds.height - 10)
        const converterTop = {
          x: portX,
          y:
            converterGeometry.top +
            (CIRCUIT_CONVERTER_BLOCK_SIZE / 2 - CIRCUIT_CONVERTER_TOP_WIRE_INSET),
        }
        const laneNodes = supplyTrunkDeviceNodes
          .filter((node) => {
            const device = node.domainRef as TrunkDevice | undefined
            return device
              ? getSupplyConverterDcConnectionIndex(device) === connectionIndex &&
                  !device.supplyDcBusId
              : false
          })
          .sort(byDistanceFromConverter)
        // A one-slot supply converter keeps its top port as an invisible drop
        // target. Paint the wire only after that port is occupied; configured
        // multi-slot converters continue to advertise their empty lanes with
        // visible stubs.
        if (visibleTopPortCount === 1 && laneNodes.length === 0) continue
        const sectionKind =
          connectionIndex === 1 ? 'converter-dc-top' : `converter-dc-top-${connectionIndex}`
        const pathNodeIds = [
          converterNode.domainId,
          ...laneNodes.map((node) => node.domainId),
        ].filter((id): id is string => !!id)
        const sectionEndpoints = [
          `converter:${converterNode.domainId ?? panel.id}:dc-top-${connectionIndex}`,
          ...laneNodes.map((node) => `device:${node.domainId ?? node.id}`),
        ]
        const firstSectionKey = supplySectionKey(
          sectionKind,
          sectionEndpoints[0]!,
          sectionEndpoints[1] ??
            `dc-open:${converterNode.domainId ?? panel.id}:top-${connectionIndex}`
        )
        const firstConnection = findAssemblyConnection(pathNodeIds[0], pathNodeIds[1])
        const singleLaneNode = laneNodes.length === 1 ? laneNodes[0] : undefined
        const verticalEnd = singleLaneNode
          ? (singleLaneNode.connectionAnchor ??
            applyNodeWireInset(
              { x: singleLaneNode.bounds.x, y: singleLaneNode.bounds.y },
              converterTop,
              singleLaneNode
            ))
          : { x: portX, y: topY }
        const verticalCorner = { x: portX, y: verticalEnd.y }
        segments.push(
          applyAssemblyConnection(
            applySupplySection(
              {
                id: generateId(),
                type: 'vertical',
                startPoint: converterTop,
                endPoint: verticalCorner,
                cable: fallbackCable,
                panelId: panel.id,
                domain: 'DC',
                hideWireLabel: true,
              },
              firstSectionKey
            ),
            firstConnection
          )
        )
        if (singleLaneNode && verticalCorner.x !== verticalEnd.x) {
          segments.push(
            applyAssemblyConnection(
              applySupplySection(
                {
                  id: generateId(),
                  type: 'branch',
                  startPoint: verticalCorner,
                  endPoint: verticalEnd,
                  cable: fallbackCable,
                  panelId: panel.id,
                  domain: 'DC',
                  hideWireLabel: true,
                },
                firstSectionKey
              ),
              firstConnection
            )
          )
        }

        // Match ordinary converter outputs: one device terminates the vertical
        // directly. Only a second device turns the lane into a horizontal chain.
        if (laneNodes.length <= 1) continue

        const firstNode = laneNodes[0]!
        const branchOrigin = { x: portX, y: topY }
        const firstPoint = getNodeConnectionAnchor(firstNode)
        const firstTarget = firstNode.connectionAnchor
          ? firstPoint
          : applyNodeWireInset(firstPoint, branchOrigin, firstNode)
        const branchDirection = Math.sign(firstTarget.x - branchOrigin.x) || -1
        const branchCorner = { x: branchOrigin.x, y: firstTarget.y }
        if (branchCorner.y !== branchOrigin.y) {
          segments.push(
            applyAssemblyConnection(
              applySupplySection(
                {
                  id: generateId(),
                  type: 'vertical',
                  startPoint: branchOrigin,
                  endPoint: branchCorner,
                  cable: fallbackCable,
                  panelId: panel.id,
                  domain: 'DC',
                  hideWireLabel: true,
                },
                firstSectionKey
              ),
              firstConnection
            )
          )
        }
        segments.push(
          applyAssemblyConnection(
            applySupplySection(
              {
                id: generateId(),
                type: 'branch',
                startPoint: { x: branchCorner.x - branchDirection, y: branchCorner.y },
                endPoint: firstTarget,
                cable: fallbackCable,
                panelId: panel.id,
                domain: 'DC',
                hideWireLabel: true,
              },
              firstSectionKey
            ),
            firstConnection
          )
        )

        for (let index = 0; index < laneNodes.length - 1; index++) {
          const fromNode = laneNodes[index]!
          const toNode = laneNodes[index + 1]!
          const fromPoint = getNodeConnectionAnchor(fromNode)
          const toPoint = getNodeConnectionAnchor(toNode)
          const start = fromNode.connectionAnchor
            ? fromPoint
            : applyNodeWireInset(fromPoint, toPoint, fromNode)
          const end = toNode.connectionAnchor
            ? toPoint
            : applyNodeWireInset(toPoint, fromPoint, toNode)
          const sectionKey = supplySectionKey(
            sectionKind,
            sectionEndpoints[index + 1]!,
            sectionEndpoints[index + 2]!
          )
          const connection = findAssemblyConnection(pathNodeIds[index + 1], pathNodeIds[index + 2])
          const points =
            start.x !== end.x && start.y !== end.y
              ? [start, { x: end.x, y: start.y }, end]
              : [start, end]
          for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex++) {
            const segmentStart = points[pointIndex]!
            const segmentEnd = points[pointIndex + 1]!
            segments.push(
              applyAssemblyConnection(
                applySupplySection(
                  {
                    id: generateId(),
                    type: segmentStart.x === segmentEnd.x ? 'vertical' : 'branch',
                    startPoint: segmentStart,
                    endPoint: segmentEnd,
                    cable: fallbackCable,
                    panelId: panel.id,
                    domain: 'DC',
                    hideWireLabel: true,
                  },
                  sectionKey
                ),
                connection
              )
            )
          }
        }
      }

      for (const busNode of supplyTrunkDeviceNodes.filter(
        (node) => (node.domainRef as TrunkDevice | undefined)?.type === 'dc_bus'
      )) {
        const busDevice = busNode.domainRef as TrunkDevice
        const branchNodes = supplyTrunkDeviceNodes.filter(
          (node) => (node.domainRef as TrunkDevice | undefined)?.supplyDcBusId === busDevice.id
        )
        const branchGroups = new Map<string, LayoutNode[]>()
        branchNodes.forEach((node) => {
          const device = node.domainRef as TrunkDevice
          const branchId = device.supplyDcBusBranchId ?? device.id
          const group = branchGroups.get(branchId) ?? []
          group.push(node)
          branchGroups.set(branchId, group)
        })
        for (const [branchId, group] of branchGroups) {
          const ordered = group
            .filter((node) => !(node.domainRef as TrunkDevice).converterDcConnection)
            .sort((left, right) => right.bounds.y - left.bounds.y)
          let fromNode = busNode
          let fromDevice = busDevice
          for (const branchNode of ordered) {
            const branchDevice = branchNode.domainRef as TrunkDevice
            const incomingPortX = branchNode.connectionAnchor?.x ?? branchNode.bounds.x
            const fromPoint = {
              x: incomingPortX,
              y: fromNode === busNode ? busNode.bounds.y : fromNode.bounds.y,
            }
            const devicePoint = { x: incomingPortX, y: branchNode.bounds.y }
            const connection = findAssemblyConnection(fromDevice.id, branchDevice.id)
            segments.push(
              applyAssemblyConnection(
                applySupplySection(
                  {
                    id: generateId(),
                    type: 'vertical',
                    startPoint:
                      fromNode === busNode
                        ? fromPoint
                        : applyNodeWireInset(fromPoint, devicePoint, fromNode),
                    endPoint: applyNodeWireInset(devicePoint, fromPoint, branchNode),
                    cable: fallbackCable,
                    panelId: panel.id,
                    domain: 'DC',
                    hideWireLabel: true,
                  },
                  supplySectionKey(
                    `dc-bus-${busDevice.id}-${branchId}`,
                    `device:${fromDevice.id}`,
                    `device:${branchDevice.id}`
                  )
                ),
                connection
              )
            )
            fromNode = branchNode
            fromDevice = branchDevice
          }

          const nestedConverterNode = ordered.find((candidate) => {
            const candidateDevice = candidate.domainRef as TrunkDevice
            return (
              supportsCircuitConverterDcConnections(candidateDevice) &&
              getCircuitConverterDcConnectionCount(candidateDevice) > 1
            )
          })
          const nestedConverter = nestedConverterNode?.domainRef as TrunkDevice | undefined
          if (!nestedConverterNode || !nestedConverter) continue
          const anchor = nestedConverterNode.connectionAnchor ?? {
            x: nestedConverterNode.bounds.x,
            y: nestedConverterNode.bounds.y,
          }
          const growthDirection = nestedConverterNode.converterGrowthDirection ?? 'right'
          const geometry =
            growthDirection === 'left'
              ? getSupplyConverterBodyGeometry(nestedConverter, anchor)
              : getCircuitConverterBodyGeometry(nestedConverter, anchor)
          const dcPorts =
            growthDirection === 'left'
              ? Array.from({ length: geometry.count }, (_, index) => ({
                  index,
                  x: anchor.x - index * CIRCUIT_CONVERTER_BLOCK_SIZE,
                  y: anchor.y - CIRCUIT_CONVERTER_TOP_WIRE_INSET,
                }))
              : getCircuitConverterBodyGeometry(nestedConverter, anchor).dcPorts
          for (let connectionIndex = 0; connectionIndex < geometry.count; connectionIndex += 1) {
            const laneNodes = group
              .filter(
                (candidate) =>
                  (candidate.domainRef as TrunkDevice).converterDcConnection?.converterId ===
                    nestedConverter.id &&
                  (candidate.domainRef as TrunkDevice).converterDcConnection?.connectionIndex ===
                    connectionIndex
              )
              .sort((left, right) => left.bounds.x - right.bounds.x)
            const port = dcPorts[connectionIndex]!
            const rowY = getOrdinaryCircuitConverterOutputRowY(
              nestedConverter,
              anchor.y,
              connectionIndex
            )
            const rowPoint = { x: port.x, y: rowY }
            const firstLaneNode = laneNodes[0]
            const firstLaneCenter = firstLaneNode
              ? { x: firstLaneNode.bounds.x, y: firstLaneNode.bounds.y }
              : undefined
            const firstLaneTarget =
              firstLaneNode && firstLaneCenter
                ? applyNodeWireInset(
                    firstLaneCenter,
                    firstLaneCenter.x === port.x ? port : rowPoint,
                    firstLaneNode
                  )
                : undefined
            const points =
              firstLaneTarget && firstLaneTarget.x === port.x
                ? [port, firstLaneTarget]
                : firstLaneTarget
                  ? [port, rowPoint, firstLaneTarget]
                  : [port, rowPoint]
            for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex += 1) {
              const startPoint = points[pointIndex]!
              const endPoint = points[pointIndex + 1]!
              segments.push(
                applySupplySection(
                  {
                    id: generateId(),
                    type: startPoint.x === endPoint.x ? 'vertical' : 'branch',
                    startPoint,
                    endPoint,
                    cable: fallbackCable,
                    panelId: panel.id,
                    domain: 'DC',
                    hideWireLabel: true,
                  },
                  supplySectionKey(
                    `dc-bus-${busDevice.id}-${branchId}-converter-${nestedConverter.id}-${connectionIndex}`,
                    `device:${nestedConverter.id}`,
                    laneNodes.length > 0
                      ? `device:${(laneNodes[0]!.domainRef as TrunkDevice).id}`
                      : `output:${connectionIndex}`
                  )
                )
              )
            }
            let previousNode = nestedConverterNode
            let previousDevice = nestedConverter
            for (const laneNode of laneNodes) {
              const laneDevice = laneNode.domainRef as TrunkDevice
              const rawStart =
                previousNode === nestedConverterNode
                  ? { x: laneNode.bounds.x, y: rowY }
                  : { x: previousNode.bounds.x, y: previousNode.bounds.y }
              const rawEnd = { x: laneNode.bounds.x, y: laneNode.bounds.y }
              if (rawStart.x !== rawEnd.x || rawStart.y !== rawEnd.y) {
                const connection = findAssemblyConnection(previousDevice.id, laneDevice.id)
                segments.push(
                  applyAssemblyConnection(
                    applySupplySection(
                      {
                        id: generateId(),
                        type: rawStart.x === rawEnd.x ? 'vertical' : 'branch',
                        startPoint:
                          previousNode === nestedConverterNode
                            ? rawStart
                            : applyNodeWireInset(rawStart, rawEnd, previousNode),
                        endPoint: applyNodeWireInset(rawEnd, rawStart, laneNode),
                        cable: fallbackCable,
                        panelId: panel.id,
                        domain: 'DC',
                        hideWireLabel: true,
                      },
                      supplySectionKey(
                        `dc-bus-${busDevice.id}-${branchId}-converter-${nestedConverter.id}-${connectionIndex}`,
                        `device:${previousDevice.id}`,
                        `device:${laneDevice.id}`
                      )
                    ),
                    connection
                  )
                )
              }
              previousNode = laneNode
              previousDevice = laneDevice
            }
          }
        }
      }
    }

    const pushSupplyHorizontal = (
      supplyBendX: number,
      start: { x: number; y: number },
      end: { x: number; y: number },
      separatorX: number | null,
      fromEndpoint?: SupplySpanEndpoint,
      toEndpoint?: SupplySpanEndpoint,
      mergeCrossingWithBusDrop?: boolean,
      connection?: SupplyConnection,
      sectionKey?: string
    ) => {
      const spans = splitHorizontalSpanAtSeparator(
        start.x,
        end.x,
        separatorX,
        fromEndpoint,
        toEndpoint
      )
      for (const span of spans) {
        const spanLeft = Math.min(span.x1, span.x2)
        const touchesBend = Math.abs(spanLeft - supplyBendX) < 1
        const mergeThisCrossing =
          mergeCrossingWithBusDrop === true && span.role === 'crossing' && touchesBend

        const seg: WireSegment = {
          id: generateId(),
          type: 'branch',
          startPoint: { x: span.x1, y: start.y },
          endPoint: { x: span.x2, y: end.y },
          cable: installation
            ? cableForSupplyWireRole(
                installation,
                panels,
                panel,
                mergeThisCrossing ? 'downstream' : span.role
              )
            : fallbackCable,
          panelId: panel.id,
          domain: DEFAULT_ELECTRICAL_DOMAIN,
          hideWireLabel: true,
          isSupplyTrunk: true,
          supplyWireRole: span.role,
        }
        if (span.role === 'crossing' && separatorX != null) {
          // Keep the visual panel-boundary anchor on the actual crossing span.
          // Canvas and preview rendering consume this coordinate instead of
          // independently reconstructing it from layout-device positions.
          seg.supplySeparatorX = separatorX
        }
        if (mergeThisCrossing) {
          seg.supplyMergedIntoBusDrop = true
        }
        if (installation) {
          applySupplyWireRoleToSegment(
            seg,
            mergeThisCrossing ? 'downstream' : span.role,
            installation,
            panels,
            panel
          )
          applySupplyPhaseState(seg, mergeThisCrossing ? 'downstream' : span.role)
        } else if (span.role !== 'downstream') {
          seg.hideWireLabel = true
        }
        segments.push(applyAssemblyConnection(applySupplySection(seg, sectionKey), connection))
      }
    }

    const sourceChangeoverNode = supplyTrunkDeviceNodes.find(
      (node) => getNodeSymbolId(node) === 'source_changeover'
    )
    const directConverterNode = supplyTrunkDeviceNodes.find(
      (node) => (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'converter-branch'
    )
    const utilityAssemblyNodeId = supplyAssembly?.nodes.find(
      (node) => node.kind === 'utility-source'
    )?.id
    const changeoverGridSourceNodeId =
      supplyAssembly?.nodes.find((node) => node.id === `${supplyAssembly.id}-grid-distribution`)
        ?.id ?? utilityAssemblyNodeId
    const inverterGridSplitNodeId =
      supplyAssembly?.nodes.find(
        (node) => node.id === `${supplyAssembly.id}-inverter-grid-distribution`
      )?.id ?? changeoverGridSourceNodeId
    // Assemblies may fan out to multiple main panels. Select the handoff that
    // targets the panel currently being rendered; using the first handoff made
    // every additional main panel inherit the original panel's wire path.
    const handoffAssemblyNodeId =
      supplyAssembly?.loadHandoffs.find(
        (handoff) =>
          ((handoff.target.kind === 'panel-input' ||
            handoff.target.kind === 'panel-bus-input' ||
            handoff.target.kind === 'circuit-input') &&
            handoff.target.panelId === panel.id) ||
          (handoff.target.kind === 'root-feed' &&
            installation?.feedTopology?.rootFeeds.some(
              (feed) =>
                handoff.target.kind === 'root-feed' &&
                feed.id === handoff.target.rootFeedId &&
                feed.panelId === panel.id
            ))
      )?.handoffNodeId ?? supplyAssembly?.nodes.find((node) => node.kind === 'panel-handoff')?.id
    const currentPanelHandoffConnection = supplyAssembly?.connections.find((connection) =>
      connection.endpoints.some(({ nodeId }) => nodeId === handoffAssemblyNodeId)
    )

    if (sourceChangeoverNode) {
      const changeoverSegmentStart = segments.length
      const changeoverX = sourceChangeoverNode.bounds.x
      const changeoverY = sourceChangeoverNode.bounds.y
      const backupBusRun = busRunForRole('backup')
      const gridBusRun = busRunForRole('normal')
      const bendX = backupBusRun
        ? getLeftBiasedBusFeedStubX(backupBusRun.startPoint.x, backupBusRun.endPoint.x)
        : resolvedSupplyBendX
      const portOffset = (LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE * 7) / 24
      const rightPortX = changeoverX + LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE / 2
      let elbowX = rightPortX + LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_ELBOW_LEAD
      const backupConverterNode = supplyTrunkDeviceNodes.find(
        (node) => (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'backup'
      )
      const converterGridInputConnected =
        (backupConverterNode?.domainRef as TrunkDevice | undefined)?.converterGridInputConnected !==
        false
      const backupOutputNodes = supplyTrunkDeviceNodes
        .filter(
          (node) => (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'backup-output'
        )
        .sort((a, b) => a.bounds.x - b.bounds.x)
      const converterGridNodes = supplyTrunkDeviceNodes
        .filter(
          (node) =>
            (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'converter-grid' &&
            !isConverterGridLegPlacement(
              (node.domainRef as TrunkDevice | undefined)?.converterGridPlacement
            )
        )
        .sort((a, b) => a.bounds.x - b.bounds.x)
      const converterGridInputLegNodes = supplyTrunkDeviceNodes
        .filter(
          (node) =>
            (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'converter-grid' &&
            isConverterGridLegPlacement(
              (node.domainRef as TrunkDevice | undefined)?.converterGridPlacement
            )
        )
        .sort((a, b) => a.bounds.y - b.bounds.y)
      // Port 1 tapped from the inverter's grid-input leg (`converter-input`), as planned by the
      // layout on the grid-tap geometry.
      const usesConverterInputTap =
        backupConverterNode != null && sourceChangeoverNode.supplyConverterInputTapY != null
      // The layout can widen this riser to clear the protection's side text.
      // Derive the conductor from that positioned leg instead of the fixed lead. With the
      // converter-input tap the port-1 devices are inline on the tap wire instead.
      if (!usesConverterInputTap)
        elbowX =
          supplyTrunkDeviceNodes.find(
            (node) =>
              (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'changeover-grid' &&
              (node.domainRef as TrunkDevice | undefined)?.changeoverGridPlacement === 'input-leg'
          )?.bounds.x ?? elbowX
      const upperY =
        backupConverterNode?.bounds.y ??
        changeoverY - LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_LANE_OFFSET
      const lowerY = supplyNode.bounds.y
      // Height of the T where the port-1 riser joins the inverter leg (`converter-input`).
      const converterInputTapY =
        sourceChangeoverNode.supplyConverterInputTapY ?? changeoverY + portOffset
      const slotEndX =
        backupConverterNode?.bounds.x ??
        (backupOutputNodes.at(-1)?.bounds.x ?? elbowX) +
          LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_SLOT_LENGTH

      const pushChangeoverWire = (
        startPoint: { x: number; y: number },
        endPoint: { x: number; y: number },
        role: SupplyWireRole,
        connection?: SupplyConnection,
        busFeed?: {
          busSectionId: string
          kind: 'grid' | 'backup'
        },
        sectionKey?: string
      ): WireSegment | undefined => {
        if (startPoint.x === endPoint.x && startPoint.y === endPoint.y) return undefined
        const segment: WireSegment = {
          id: generateId(),
          type: startPoint.x === endPoint.x ? 'vertical' : 'branch',
          startPoint,
          endPoint,
          cable: installation
            ? cableForSupplyWireRole(installation, panels, panel, role)
            : fallbackCable,
          panelId: panel.id,
          domain: DEFAULT_ELECTRICAL_DOMAIN,
          hideWireLabel: true,
          isSupplyTrunk: true,
          supplyWireRole: role,
          supplyFeedScope: role === 'downstream' ? 'root' : 'shared',
          ...(busFeed
            ? {
                busSectionId: busFeed.busSectionId,
                busFeedKind: busFeed.kind,
                fromElementType: 'mainBus' as const,
              }
            : {}),
        }
        if (installation) {
          applySupplyWireRoleToSegment(segment, role, installation, panels, panel)
          applySupplyPhaseState(segment, role)
        }
        const connectedSegment = applyAssemblyConnection(
          applySupplySection(segment, sectionKey),
          connection
        )
        segments.push(connectedSegment)
        return connectedSegment
      }

      /**
       * The inverter leg usually carries fewer conductors than the grid. Name them where the leg
       * narrows: just above the first protection (from the grid lane up) that drops conductors,
       * or at the leg start when the leg itself is already narrower. The text sits on the
       * device-name side of the riser, which stays free of the ratings text.
       */
      const labelConverterLegNarrowing = (
        legSegments: Array<{ segment: WireSegment; lowerNode?: LayoutNode }>
      ) => {
        const system = installation?.nominalVoltage.system
        if (!system || !supportsExplicitPhaseSelection(system) || legSegments.length === 0) return
        const full = getFullInstallationPhaseAssignment(system)
        const signature = (assignment: CircuitPhaseAssignment | undefined) =>
          assignment?.phases.filter((phase) => phase !== 'PE').join('|') ?? ''
        let assignment = full
        let target: (typeof legSegments)[number] | undefined
        // Walk the leg devices up from the grid lane: the segment above the first device that
        // drops conductors carries the label.
        const devicesFromGrid = legSegments
          .flatMap(({ lowerNode }) => (lowerNode ? [lowerNode] : []))
          .reverse()
        for (const node of devicesFromGrid) {
          const device = node.domainRef as TrunkDevice | undefined
          if (!device || device.type !== 'protection') continue
          const next = getDownstreamProtectionPhaseAssignment(device, system, assignment)
          if (signature(next) !== signature(assignment)) {
            target = legSegments.find(({ lowerNode }) => lowerNode === node)
            break
          }
          assignment = next
        }
        const legStart = legSegments.at(-1)!
        if (!target && signature(legStart.segment.phaseAssignment) !== signature(full)) {
          target = legStart
        }
        if (!target || !target.segment.phaseAssignment) return
        if (signature(target.segment.phaseAssignment) === signature(full)) return
        const { startPoint, endPoint } = target.segment
        const near = startPoint.y > endPoint.y ? startPoint : endPoint
        const text = formatPhaseAssignment(target.segment.phaseAssignment)
        const width = measureSymbolLabelTextWidth(text, 'Figtree', 8)
        const mirrored = panelNode.horizontalMirrorAxisX != null
        target.segment.forcePhaseLabel = true
        target.segment.phaseLabelAnchor = {
          // Readable left of the riser in the final drawing, mirrored or not.
          x: mirrored ? near.x + 5 + width : near.x - 5 - width,
          y: near.y - 12,
        }
      }

      const outputNodes = supplyTrunkDeviceNodes.filter((node) => {
        const supplyPath = (node.domainRef as TrunkDevice | undefined)?.supplyPath
        return node.bounds.x < changeoverX && (supplyPath == null || supplyPath === 'serial')
      })
      const outputPathNodeIds = [
        handoffAssemblyNodeId,
        ...outputNodes.map((node) => node.domainId),
        sourceChangeoverNode.domainId,
      ]
      const outputConnection = (index: number) =>
        findAssemblyConnection(outputPathNodeIds[index], outputPathNodeIds[index + 1], 'load-ac')
      const loadBusDropSegment = pushChangeoverWire(
        { x: bendX, y: mainBusY },
        { x: bendX, y: changeoverY },
        'downstream',
        outputConnection(0),
        backupBusRun?.busSectionId
          ? {
              busSectionId: backupBusRun.busSectionId,
              kind: 'backup',
            }
          : undefined
      )
      const outputWaypoints = [
        { point: { x: bendX, y: changeoverY }, node: undefined as LayoutNode | undefined },
        ...outputNodes.map((node) => ({ point: { x: node.bounds.x, y: changeoverY }, node })),
        { point: { x: changeoverX, y: changeoverY }, node: sourceChangeoverNode },
      ]
      const outputSectionEndpoints = [
        `backup-bus:${backupBusRun?.busSectionId ?? panel.id}`,
        ...outputNodes.map((node) => `device:${node.domainId ?? node.id}`),
        `changeover:${sourceChangeoverNode.domainId ?? sourceChangeoverNode.id}:load`,
      ]
      const outputSectionKey = (index: number) =>
        supplySectionKey(
          'changeover-load',
          outputSectionEndpoints[index]!,
          outputSectionEndpoints[index + 1]!
        )
      if (loadBusDropSegment) applySupplySection(loadBusDropSegment, outputSectionKey(0))
      for (let index = 0; index < outputWaypoints.length - 1; index++) {
        const from = outputWaypoints[index]!
        const to = outputWaypoints[index + 1]!
        const start = from.node ? applyNodeWireInset(from.point, to.point, from.node) : from.point
        const end = to.node ? applyNodeWireInset(to.point, from.point, to.node) : to.point
        pushChangeoverWire(
          start,
          end,
          'downstream',
          outputConnection(index),
          undefined,
          outputSectionKey(index)
        )
      }

      const upperPortY = changeoverY - portOffset
      const backupPathNodeIds = [
        sourceChangeoverNode.domainId,
        ...backupOutputNodes.map((node) => node.domainId),
        backupConverterNode?.domainId,
      ].filter((id): id is string => !!id)
      const firstBackupConnection =
        findAssemblyPortConnection(sourceChangeoverNode.domainId, 'backup') ??
        findAssemblyConnection(backupPathNodeIds[0], backupPathNodeIds[1], 'inverter-backup-ac')
      const backupSectionEndpoints = [
        `changeover:${sourceChangeoverNode.domainId ?? sourceChangeoverNode.id}:backup`,
        ...backupOutputNodes.map((node) => `device:${node.domainId ?? node.id}`),
        backupConverterNode
          ? `converter:${backupConverterNode.domainId ?? backupConverterNode.id}:backup`
          : `backup-slot:${panel.id}`,
      ]
      const backupSectionKey = (index: number) =>
        supplySectionKey(
          'changeover-backup',
          backupSectionEndpoints[index]!,
          backupSectionEndpoints[index + 1]!
        )
      const firstBackupSectionKey = backupSectionKey(0)
      const openBackupAnchor = (index: number) => {
        const feed = installation?.feedTopology?.rootFeeds.find(
          (candidate) => candidate.panelId === panel.id
        )
        if (!feed) return undefined
        const fromId = backupPathNodeIds[index]!
        const toId = backupPathNodeIds[index + 1]
        const runKey = toId
          ? `supply:${panel.id}:serial:${[`device:${fromId}`, `device:${toId}`].sort().join('<>')}`
          : `supply:${panel.id}:open-backup:device:${fromId}<>terminal:${sourceChangeoverNode.domainId}`
        return deriveWireAnchorKey({ kind: 'feed-run', feedPathId: feed.id, runKey })
      }
      const backupChangeoverInputSegment = pushChangeoverWire(
        { x: rightPortX, y: upperPortY },
        { x: elbowX, y: upperPortY },
        'upstream',
        firstBackupConnection,
        undefined,
        firstBackupSectionKey
      )
      const backupChangeoverElbowSegment = pushChangeoverWire(
        { x: elbowX, y: upperPortY },
        { x: elbowX, y: upperY },
        'upstream',
        firstBackupConnection,
        undefined,
        firstBackupSectionKey
      )
      if (!backupConverterNode) {
        const anchor = openBackupAnchor(0)
        if (backupChangeoverInputSegment) backupChangeoverInputSegment.wireAnchor = anchor
        if (backupChangeoverElbowSegment) backupChangeoverElbowSegment.wireAnchor = anchor
      }
      if (backupConverterNode) {
        const backupWaypoints = [
          { point: { x: elbowX, y: upperY }, node: undefined as LayoutNode | undefined },
          ...backupOutputNodes.map((node) => ({ point: { x: node.bounds.x, y: upperY }, node })),
          {
            point: { x: getNodeConnectionAnchor(backupConverterNode).x, y: upperY },
            node: backupConverterNode,
          },
        ]
        for (let index = 0; index < backupWaypoints.length - 1; index++) {
          const from = backupWaypoints[index]!
          const to = backupWaypoints[index + 1]!
          const start = from.node ? applyNodeWireInset(from.point, to.point, from.node) : from.point
          const end = to.node ? applyNodeWireInset(to.point, from.point, to.node) : to.point
          pushChangeoverWire(
            start,
            end,
            'upstream',
            findAssemblyConnection(
              backupPathNodeIds[index],
              backupPathNodeIds[index + 1],
              'inverter-backup-ac'
            ),
            undefined,
            backupSectionKey(index)
          )
        }

        // The converter's grid AC connection is its bottom port. The right-hand port is
        // deliberately left free for the shared battery/PV DC connection.
        if (converterGridInputConnected) {
          const converterLegX = getNodeConnectionAnchor(backupConverterNode).x
          const converterBottom = applyNodeWireInset(
            getNodeConnectionAnchor(backupConverterNode),
            { x: converterLegX, y: lowerY },
            backupConverterNode
          )
          const converterIdForKeys = backupConverterNode.domainId ?? backupConverterNode.id
          // Converter-only devices sit nearest the converter, shared devices below them. With the
          // converter-input tap the T junction sits between both groups at the port-1 height.
          const orderedLegNodes = orderConverterGridLegDevicesFromConverter(
            converterGridInputLegNodes.map((node) => ({
              node,
              device: node.domainRef as TrunkDevice,
            }))
          ).map(({ node }) => node)
          const aboveTapNodes = usesConverterInputTap
            ? orderedLegNodes.filter(
                (node) =>
                  (node.domainRef as TrunkDevice | undefined)?.converterGridPlacement ===
                  'converter-leg'
              )
            : orderedLegNodes
          const belowTapNodes = usesConverterInputTap
            ? orderedLegNodes.filter((node) => !aboveTapNodes.includes(node))
            : []
          const tapWaypoints = usesConverterInputTap
            ? [
                {
                  point: { x: converterLegX, y: converterInputTapY },
                  node: undefined as LayoutNode | undefined,
                },
              ]
            : []
          const inputLegWaypoints = [
            { point: converterBottom, node: undefined as LayoutNode | undefined },
            ...aboveTapNodes.map((node) => ({
              point: { x: node.bounds.x, y: node.bounds.y },
              node,
            })),
            ...tapWaypoints,
            ...belowTapNodes.map((node) => ({
              point: { x: node.bounds.x, y: node.bounds.y },
              node,
            })),
            {
              point: { x: converterLegX, y: lowerY },
              node: undefined as LayoutNode | undefined,
            },
          ]
          const inputLegNodeIds = [
            backupConverterNode.domainId,
            ...aboveTapNodes.map((node) => node.domainId),
            ...(usesConverterInputTap && supplyAssembly
              ? [converterInputSplitNodeId(supplyAssembly.id)]
              : []),
            ...belowTapNodes.map((node) => node.domainId),
            inverterGridSplitNodeId,
          ].filter((id): id is string => !!id)
          const inputLegSectionEndpoints = [
            `converter:${converterIdForKeys}:grid`,
            ...aboveTapNodes.map((node) => `device:${node.domainId ?? node.id}`),
            ...(usesConverterInputTap ? [`converter-input-tap:${converterIdForKeys}`] : []),
            ...belowTapNodes.map((node) => `device:${node.domainId ?? node.id}`),
            `converter-grid-tap:${converterIdForKeys}`,
          ]
          const legSegments: Array<{ segment: WireSegment; lowerNode?: LayoutNode }> = []
          for (let index = 0; index < inputLegWaypoints.length - 1; index++) {
            const from = inputLegWaypoints[index]!
            const to = inputLegWaypoints[index + 1]!
            const segment = pushChangeoverWire(
              from.node ? applyNodeWireInset(from.point, to.point, from.node) : from.point,
              to.node ? applyNodeWireInset(to.point, from.point, to.node) : to.point,
              'upstream',
              findAssemblyConnection(
                inputLegNodeIds[index],
                inputLegNodeIds[index + 1],
                'inverter-grid-ac'
              ) ?? findAssemblyPortConnection(backupConverterNode.domainId, 'grid'),
              undefined,
              supplySectionKey(
                'changeover-converter-input',
                inputLegSectionEndpoints[index]!,
                inputLegSectionEndpoints[index + 1]!
              )
            )
            if (segment) legSegments.push({ segment, lowerNode: to.node })
          }
          labelConverterLegNarrowing(legSegments)
        }
        pushConverterDcWires(backupConverterNode)
      } else {
        const backupWaypoints = [
          { point: { x: elbowX, y: upperY }, node: undefined as LayoutNode | undefined },
          ...backupOutputNodes.map((node) => ({ point: { x: node.bounds.x, y: upperY }, node })),
          { point: { x: slotEndX, y: upperY }, node: undefined as LayoutNode | undefined },
        ]
        for (let index = 0; index < backupWaypoints.length - 1; index++) {
          const from = backupWaypoints[index]!
          const to = backupWaypoints[index + 1]!
          const start = from.node ? applyNodeWireInset(from.point, to.point, from.node) : from.point
          const end = to.node ? applyNodeWireInset(to.point, from.point, to.node) : to.point
          const segment = pushChangeoverWire(
            start,
            end,
            'upstream',
            undefined,
            undefined,
            backupSectionKey(index)
          )
          if (segment) segment.wireAnchor = openBackupAnchor(index)
        }
      }

      const lowerPortY = changeoverY + portOffset
      const changeoverGridInlineNodes = supplyTrunkDeviceNodes
        .filter(
          (node) =>
            (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'changeover-grid' &&
            (node.domainRef as TrunkDevice | undefined)?.changeoverGridPlacement !== 'input-leg'
        )
        .sort((a, b) => a.bounds.x - b.bounds.x)
      const changeoverGridInputLegNodes = supplyTrunkDeviceNodes
        .filter(
          (node) =>
            (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'changeover-grid' &&
            (node.domainRef as TrunkDevice | undefined)?.changeoverGridPlacement === 'input-leg'
        )
        .sort((a, b) => a.bounds.y - b.bounds.y)
      const changeoverGridPathNodeIds = [
        sourceChangeoverNode.domainId,
        ...changeoverGridInputLegNodes.map((node) => node.domainId),
        ...(gridBusRun
          ? []
          : [...changeoverGridInlineNodes].reverse().map((node) => node.domainId)),
        changeoverGridSourceNodeId,
      ].filter((id): id is string => !!id)
      const changeoverGridConnections = changeoverGridPathNodeIds
        .slice(0, -1)
        .map((nodeId, index) =>
          findAssemblyConnection(nodeId, changeoverGridPathNodeIds[index + 1], 'grid-ac')
        )
      const firstChangeoverGridConnection =
        findAssemblyPortConnection(sourceChangeoverNode.domainId, 'grid') ??
        changeoverGridConnections[0]
      const changeoverGridSectionEndpoints = [
        `utility:${utilityAssemblyNodeId ?? panel.id}`,
        ...changeoverGridInlineNodes.map((node) => `device:${node.domainId ?? node.id}`),
        ...[...changeoverGridInputLegNodes]
          .reverse()
          .map((node) => `device:${node.domainId ?? node.id}`),
        `changeover:${sourceChangeoverNode.domainId ?? sourceChangeoverNode.id}:grid`,
      ]
      const changeoverGridSectionKey = (index: number) =>
        supplySectionKey(
          'changeover-grid',
          changeoverGridSectionEndpoints[index]!,
          changeoverGridSectionEndpoints[index + 1]!
        )
      const changeoverGridSwitchSectionKey = changeoverGridSectionKey(
        changeoverGridSectionEndpoints.length - 2
      )
      const converterTapX = backupConverterNode
        ? getNodeConnectionAnchor(backupConverterNode).x
        : undefined
      // With the converter-input tap the port-1 riser ends at the T's height and a horizontal
      // wire joins the inverter leg there. Everything else stays on the grid-tap geometry.
      const tapsConverterInput = usesConverterInputTap && converterTapX != null
      const tapNodeId =
        tapsConverterInput && supplyAssembly
          ? converterInputSplitNodeId(supplyAssembly.id)
          : undefined
      const riserBottomY = converterInputTapY
      let gridChangeoverInputSegment: WireSegment | undefined
      if (tapsConverterInput) {
        // Port 1 is fed from the T on the inverter leg: a horizontal wire at the T's height with
        // its devices inline (nearest the switch first), rising to the port when the T is lower.
        const lane = [...changeoverGridInputLegNodes].sort(
          (a, b) => Math.abs(b.bounds.x - converterTapX!) - Math.abs(a.bounds.x - converterTapX!)
        )
        const electricalIds = [
          sourceChangeoverNode.domainId,
          ...lane.map((node) => node.domainId),
          tapNodeId,
        ]
        const sectionEndpoints = [
          `changeover:${sourceChangeoverNode.domainId ?? sourceChangeoverNode.id}:grid`,
          ...lane.map((node) => `device:${node.domainId ?? node.id}`),
          `converter-input-tap:${backupConverterNode?.domainId ?? backupConverterNode?.id}`,
        ]
        const points: Array<{ point: { x: number; y: number }; node?: LayoutNode }> = [
          { point: { x: rightPortX, y: lowerPortY } },
          ...(riserBottomY > lowerPortY + 0.01
            ? [{ point: { x: elbowX, y: lowerPortY } }, { point: { x: elbowX, y: riserBottomY } }]
            : []),
          ...lane.map((node) => ({ point: { x: node.bounds.x, y: riserBottomY }, node })),
          { point: { x: converterTapX!, y: riserBottomY } },
        ]
        let section = 0
        for (let index = 0; index < points.length - 1; index++) {
          const from = points[index]!
          const to = points[index + 1]!
          const fromId = electricalIds[section]
          const toId = electricalIds[section + 1]
          const segment = pushChangeoverWire(
            from.node ? applyNodeWireInset(from.point, to.point, from.node) : from.point,
            to.node ? applyNodeWireInset(to.point, from.point, to.node) : to.point,
            'upstream',
            (section === 0 ? firstChangeoverGridConnection : undefined) ??
              (fromId && toId ? findAssemblyConnection(fromId, toId, 'grid-ac') : undefined) ??
              firstChangeoverGridConnection,
            undefined,
            supplySectionKey(
              'changeover-grid',
              sectionEndpoints[section]!,
              sectionEndpoints[section + 1]!
            )
          )
          if (index === 0) gridChangeoverInputSegment = segment
          if (to.node) section++
        }
      } else {
        gridChangeoverInputSegment = pushChangeoverWire(
          { x: rightPortX, y: lowerPortY },
          { x: elbowX, y: lowerPortY },
          'upstream',
          firstChangeoverGridConnection,
          undefined,
          changeoverGridSwitchSectionKey
        )
        const changeoverGridInputLegWaypoints = [
          { point: { x: elbowX, y: lowerPortY }, node: undefined as LayoutNode | undefined },
          ...changeoverGridInputLegNodes.map((node) => ({
            point: { x: elbowX, y: node.bounds.y },
            node,
          })),
          { point: { x: elbowX, y: lowerY }, node: undefined as LayoutNode | undefined },
        ]
        for (let index = 0; index < changeoverGridInputLegWaypoints.length - 1; index++) {
          const from = changeoverGridInputLegWaypoints[index]!
          const to = changeoverGridInputLegWaypoints[index + 1]!
          const start = from.node ? applyNodeWireInset(from.point, to.point, from.node) : from.point
          const end = to.node ? applyNodeWireInset(to.point, from.point, to.node) : to.point
          const fromId =
            index === 0
              ? sourceChangeoverNode.domainId
              : changeoverGridInputLegNodes[index - 1]?.domainId
          const toId =
            index < changeoverGridInputLegNodes.length
              ? changeoverGridInputLegNodes[index]?.domainId
              : changeoverGridSourceNodeId
          const sectionIndex = changeoverGridSectionEndpoints.length - 2 - index
          pushChangeoverWire(
            start,
            end,
            'upstream',
            (fromId && toId ? findAssemblyConnection(fromId, toId, 'grid-ac') : undefined) ??
              firstChangeoverGridConnection,
            undefined,
            changeoverGridSectionKey(sectionIndex)
          )
        }
      }

      const backupInputAssignment = backupChangeoverInputSegment?.phaseAssignment
      const gridInputAssignment = gridChangeoverInputSegment?.phaseAssignment
      if (
        gridChangeoverInputSegment &&
        backupInputAssignment &&
        gridInputAssignment &&
        backupInputAssignment.phases.join('|') !== gridInputAssignment.phases.join('|')
      ) {
        backupChangeoverInputSegment.forcePhaseLabel = true
        backupChangeoverInputSegment.phaseLabelAnchor = {
          x: elbowX + 5,
          y: upperPortY - 20,
        }
        gridChangeoverInputSegment.forcePhaseLabel = true
        gridChangeoverInputSegment.phaseLabelAnchor = {
          x: elbowX + 5,
          y: lowerPortY + 4,
        }
      }

      if (gridBusRun?.busSectionId) {
        const gridBusX = getLeftBiasedBusFeedStubX(gridBusRun.startPoint.x, gridBusRun.endPoint.x)
        const normalGridHandoffNodeId = supplyAssembly?.loadHandoffs.find(
          (handoff) =>
            handoff.target.kind === 'panel-bus-input' &&
            handoff.target.busSectionId === gridBusRun.busSectionId
        )?.handoffNodeId
        const gridBusConnection = findAssemblyConnection(
          changeoverGridInlineNodes.at(-1)?.domainId ?? changeoverGridSourceNodeId,
          normalGridHandoffNodeId,
          'grid-only-bypass-ac'
        )
        pushChangeoverWire(
          { x: gridBusX, y: mainBusY },
          { x: gridBusX, y: lowerY },
          'upstream',
          gridBusConnection,
          {
            busSectionId: gridBusRun.busSectionId,
            kind: 'grid',
          },
          changeoverGridSectionKey(0)
        )
        const gridRailWaypoints = [
          {
            point: { x: gridBusX, y: lowerY },
            node: undefined as LayoutNode | undefined,
          },
          ...changeoverGridInlineNodes.map((node) => ({
            point: { x: node.bounds.x, y: lowerY },
            node,
          })),
          {
            point: { x: elbowX, y: lowerY },
            node: undefined as LayoutNode | undefined,
          },
        ]
        const gridRailPathNodeIds = [
          normalGridHandoffNodeId,
          ...[...changeoverGridInlineNodes].reverse().map((node) => node.domainId),
          changeoverGridSourceNodeId,
        ].filter((id): id is string => !!id)
        for (let index = 0; index < gridRailWaypoints.length - 1; index++) {
          const from = gridRailWaypoints[index]!
          const to = gridRailWaypoints[index + 1]!
          const start = from.node ? applyNodeWireInset(from.point, to.point, from.node) : from.point
          const end = to.node ? applyNodeWireInset(to.point, from.point, to.node) : to.point
          pushChangeoverWire(
            start,
            end,
            'upstream',
            findAssemblyConnection(
              gridRailPathNodeIds[index],
              gridRailPathNodeIds[index + 1],
              'grid-only-bypass-ac'
            ),
            undefined,
            changeoverGridSectionKey(index)
          )
        }
      }

      const gridNodes = supplyTrunkDeviceNodes
        .filter(
          (node) =>
            node.bounds.x > changeoverX &&
            ![
              'backup',
              'backup-output',
              'changeover-grid',
              'converter-grid',
              'converter-dc',
              'converter-dc-top',
            ].includes((node.domainRef as TrunkDevice | undefined)?.supplyPath ?? '')
        )
        .sort((left, right) => left.bounds.x - right.bounds.x)
      const supplyInset = applyNodeWireInset(
        { x: supplyNode.bounds.x, y: lowerY },
        { x: gridNodes.at(-1)?.bounds.x ?? elbowX, y: lowerY },
        supplyNode
      )
      const gridWaypoints = [
        {
          point: { x: elbowX, y: lowerY },
          node: undefined as LayoutNode | undefined,
          assemblyNodeId: changeoverGridSourceNodeId,
          sectionEndpointId: `changeover-grid-tap:${sourceChangeoverNode.domainId ?? sourceChangeoverNode.id}`,
        },
        ...converterGridNodes.map((node) => ({
          point: { x: node.bounds.x, y: lowerY },
          node,
          assemblyNodeId: node.domainId,
          sectionEndpointId: `device:${node.domainId ?? node.id}`,
        })),
        ...gridNodes.map((node) => ({
          point: { x: node.bounds.x, y: lowerY },
          node,
          assemblyNodeId: utilityAssemblyNodeId,
          sectionEndpointId: `device:${node.domainId ?? node.id}`,
        })),
        ...(backupConverterNode && converterGridInputConnected
          ? [
              {
                point: { x: getNodeConnectionAnchor(backupConverterNode).x, y: lowerY },
                node: undefined as LayoutNode | undefined,
                assemblyNodeId: inverterGridSplitNodeId,
                sectionEndpointId: `converter-grid-tap:${backupConverterNode.domainId ?? backupConverterNode.id}`,
              },
            ]
          : []),
        {
          point: supplyInset,
          node: undefined as LayoutNode | undefined,
          assemblyNodeId: utilityAssemblyNodeId,
          sectionEndpointId: `utility:${utilityAssemblyNodeId ?? panel.id}`,
        },
      ].sort((a, b) => a.point.x - b.point.x)
      for (let index = 0; index < gridWaypoints.length - 1; index++) {
        const from = gridWaypoints[index]!
        const to = gridWaypoints[index + 1]!
        const start = from.node ? applyNodeWireInset(from.point, to.point, from.node) : from.point
        const end = to.node ? applyNodeWireInset(to.point, from.point, to.node) : to.point
        pushChangeoverWire(
          start,
          end,
          'upstream',
          findAssemblyConnection(from.assemblyNodeId, to.assemblyNodeId, 'grid-ac'),
          undefined,
          supplySectionKey('changeover-shared-grid', from.sectionEndpointId, to.sectionEndpointId)
        )
      }
      markSupplyTJunctions(segments.slice(changeoverSegmentStart))
    } else if (directConverterNode) {
      const rootBranchOutput =
        supplyAssembly?.loadHandoffs.some(
          (handoff) => handoff.id === `${supplyAssembly.id}-root-input-${panel.id}`
        ) === true
      const supplyY = supplyNode.bounds.y
      const bendX = resolvedSupplyBendX
      const { x: converterX, y: converterY } = getNodeConnectionAnchor(directConverterNode)
      const hasSeparateAcPorts =
        (directConverterNode.domainRef as TrunkDevice | undefined)?.converterAcConnection ===
        'separate'
      const converterGridInputConnected =
        (directConverterNode.domainRef as TrunkDevice | undefined)?.converterGridInputConnected !==
        false
      const backupBusRun = busRunForRole('backup')
      const gridBusRun = busRunForRole('normal')
      const usesDirectSplitFeed = Boolean(backupBusRun && gridBusRun)
      const directGridBusX =
        usesDirectSplitFeed && gridBusRun
          ? getLeftBiasedBusFeedStubX(gridBusRun.startPoint.x, gridBusRun.endPoint.x)
          : undefined
      const converterGridNodes = supplyTrunkDeviceNodes
        .filter(
          (node) =>
            (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'converter-grid' &&
            !isConverterGridLegPlacement(
              (node.domainRef as TrunkDevice | undefined)?.converterGridPlacement
            )
        )
        .sort((a, b) => a.bounds.x - b.bounds.x)
      const converterGridInputLegNodes = supplyTrunkDeviceNodes
        .filter(
          (node) =>
            (node.domainRef as TrunkDevice | undefined)?.supplyPath === 'converter-grid' &&
            isConverterGridLegPlacement(
              (node.domainRef as TrunkDevice | undefined)?.converterGridPlacement
            )
        )
        .sort((a, b) => a.bounds.y - b.bounds.y)
      const serialNodes = supplyTrunkDeviceNodes.filter(
        (node) =>
          !['converter-branch', 'converter-grid', 'converter-dc', 'converter-dc-top'].includes(
            (node.domainRef as TrunkDevice | undefined)?.supplyPath ?? ''
          )
      )
      const backupOutputNodes = hasSeparateAcPorts
        ? serialNodes.filter((node) => Math.abs(node.bounds.y - converterY) < 1)
        : []
      const gridSerialNodes = serialNodes.filter((node) => !backupOutputNodes.includes(node))
      // Only devices that actually touch the shared/root supply run may influence
      // its enclosure boundary. DC branch devices move independently.
      const horizontalSupplyNodes = [
        ...serialNodes,
        ...(converterGridInputConnected ? [directConverterNode] : []),
      ]
      const supplyInset = applyNodeWireInset(
        { x: supplyNode.bounds.x, y: supplyY },
        { x: serialNodes.at(-1)?.bounds.x ?? converterX, y: supplyY },
        supplyNode
      )
      const devicePositions = horizontalSupplyNodes.map((node) => ({
        x: node.bounds.x,
        feedScope: installation
          ? resolveSupplySeparatorScope(installation, panels, panel, node.domainId ?? '', node.domainRef as TrunkDevice | undefined)
          : ('shared' as const),
      }))
      const separatorX = computeSupplySeparatorX(devicePositions, supplyInset.x, bendX)
      const mergeCrossingWithBusDrop = installation
        ? shouldMergeSupplyCrossingWithBusDrop(bendX, separatorX, devicePositions)
        : false

      const vertical: WireSegment | undefined =
        usesDirectSplitFeed || hasSeparateAcPorts
          ? undefined
          : {
              id: generateId(),
              type: 'vertical',
              startPoint: { x: bendX, y: mainBusY },
              endPoint: { x: bendX, y: supplyY },
              cable: downstreamCable,
              panelId: panel.id,
              domain: DEFAULT_ELECTRICAL_DOMAIN,
              hideWireLabel: true,
              supplyWireRole: 'downstream',
              supplyFeedScope: 'root',
            }
      if (vertical) {
        if (installation) {
          applySupplyWireRoleToSegment(vertical, 'downstream', installation, panels, panel)
          applySupplyPhaseState(vertical, 'downstream')
        }
        segments.push(vertical)
      }

      const horizontalWaypoints: Array<{
        point: { x: number; y: number }
        node?: LayoutNode
        assemblyNodeId?: string
        sectionEndpointId?: string
      }> = [
        ...(directGridBusX != null
          ? [
              {
                point: { x: directGridBusX, y: supplyY },
                sectionEndpointId: `grid-bus:${gridBusRun?.busSectionId ?? panel.id}`,
              },
            ]
          : hasSeparateAcPorts
            ? []
            : [
                {
                  point: { x: bendX, y: supplyY },
                  assemblyNodeId:
                    rootBranchOutput ||
                    currentPanelHandoffConnection?.pathRole === 'grid-only-bypass-ac'
                      ? handoffAssemblyNodeId
                      : undefined,
                  sectionEndpointId: `panel-bus:${panel.id}`,
                },
              ]),
        ...gridSerialNodes.map((node) => ({
          point: { x: node.bounds.x, y: supplyY },
          node,
          assemblyNodeId: supplyAssembly?.nodes.some(({ id }) => id === node.domainId)
            ? node.domainId
            : undefined,
          sectionEndpointId: node.domainId ? `device:${node.domainId}` : undefined,
        })),
        ...converterGridNodes.map((node) => ({
          point: { x: node.bounds.x, y: supplyY },
          node,
          assemblyNodeId: node.domainId,
          sectionEndpointId: node.domainId ? `device:${node.domainId}` : undefined,
        })),
        ...(converterGridInputConnected
          ? [
              {
                point: { x: converterX, y: supplyY },
                // The horizontal main path passes the grid tap, not the inverter's AC port.
                assemblyNodeId: rootBranchOutput
                  ? supplyAssembly?.connections.find(
                      (edge) =>
                        edge.pathRole === 'inverter-grid-ac' &&
                        edge.endpoints[1].nodeId === directConverterNode.domainId
                    )?.endpoints[0].nodeId
                  : currentPanelHandoffConnection?.pathRole === 'grid-only-bypass-ac'
                    ? utilityAssemblyNodeId
                    : directConverterNode.domainId,
                sectionEndpointId: `converter:${directConverterNode.domainId}`,
              },
            ]
          : []),
        {
          point: supplyInset,
          assemblyNodeId: utilityAssemblyNodeId,
          sectionEndpointId: `utility:${utilityAssemblyNodeId ?? panel.id}`,
        },
      ].sort((a, b) => a.point.x - b.point.x)
      const directGridSectionKey = (index: number): string | undefined => {
        let leftIndex = index
        while (leftIndex >= 0 && !horizontalWaypoints[leftIndex]?.sectionEndpointId) leftIndex--
        let rightIndex = index + 1
        while (
          rightIndex < horizontalWaypoints.length &&
          !horizontalWaypoints[rightIndex]?.sectionEndpointId
        ) {
          rightIndex++
        }
        const left = horizontalWaypoints[leftIndex]?.sectionEndpointId
        const right = horizontalWaypoints[rightIndex]?.sectionEndpointId
        return left && right ? supplySectionKey('direct-grid', left, right) : undefined
      }
      const handoffConnection = findAssemblyConnection(
        directConverterNode.domainId,
        handoffAssemblyNodeId,
        'load-ac'
      )
      const gridHandoffConnection =
        rootBranchOutput || currentPanelHandoffConnection?.pathRole === 'grid-only-bypass-ac'
          ? currentPanelHandoffConnection
          : findAssemblyConnection(
              utilityAssemblyNodeId,
              handoffAssemblyNodeId,
              'grid-only-bypass-ac'
            )
      const utilityConnection = findAssemblyConnection(
        directConverterNode.domainId,
        utilityAssemblyNodeId,
        'inverter-grid-ac'
      )
      for (let index = 0; index < horizontalWaypoints.length - 1; index++) {
        const from = horizontalWaypoints[index]!
        const to = horizontalWaypoints[index + 1]!
        const start = from.node ? applyNodeWireInset(from.point, to.point, from.node) : from.point
        const end = to.node ? applyNodeWireInset(to.point, from.point, to.node) : to.point
        const touchesGridBus =
          from.sectionEndpointId?.startsWith('grid-bus:') === true ||
          to.sectionEndpointId?.startsWith('grid-bus:') === true
        const exactConnection = findAssemblyConnection(from.assemblyNodeId, to.assemblyNodeId)
        const touchesUnmodeledDevice = [from, to].some(
          (waypoint) =>
            waypoint.sectionEndpointId?.startsWith('device:') === true && !waypoint.assemblyNodeId
        )
        const connection =
          exactConnection ??
          (touchesGridBus || touchesUnmodeledDevice
            ? undefined
            : usesDirectSplitFeed
              ? utilityConnection
              : (start.x + end.x) / 2 < converterX
                ? (handoffConnection ?? gridHandoffConnection)
                : utilityConnection)
        pushSupplyHorizontal(
          bendX,
          start,
          end,
          separatorX,
          index === 0 ? 'bend' : undefined,
          index === horizontalWaypoints.length - 2 ? 'supply' : undefined,
          mergeCrossingWithBusDrop,
          connection,
          directGridSectionKey(index)
        )
      }
      if (vertical) {
        if (gridHandoffConnection) applyAssemblyConnection(vertical, gridHandoffConnection)
        const bendWaypointIndex = horizontalWaypoints.findIndex(
          ({ point }) => Math.abs(point.x - bendX) < 1
        )
        applySupplySection(
          vertical,
          bendWaypointIndex >= 0 ? directGridSectionKey(bendWaypointIndex) : undefined
        )
      }

      const pushDirectAcWire = (
        startPoint: { x: number; y: number },
        endPoint: { x: number; y: number },
        connection?: SupplyConnection,
        options?: {
          role?: SupplyWireRole
          busSectionId?: string
          busFeedKind?: 'grid' | 'backup'
          sectionKey?: string
        }
      ): WireSegment | undefined => {
        if (startPoint.x === endPoint.x && startPoint.y === endPoint.y) return undefined
        const role = options?.role ?? 'upstream'
        const segment: WireSegment = {
          id: generateId(),
          type: startPoint.x === endPoint.x ? 'vertical' : 'branch',
          startPoint,
          endPoint,
          cable: installation
            ? cableForSupplyWireRole(installation, panels, panel, role)
            : fallbackCable,
          panelId: panel.id,
          domain: DEFAULT_ELECTRICAL_DOMAIN,
          hideWireLabel: true,
          isSupplyTrunk: true,
          supplyWireRole: role,
          supplyFeedScope: 'root',
          ...(options?.busSectionId
            ? {
                busSectionId: options.busSectionId,
                busFeedKind: options.busFeedKind,
                fromElementType: 'mainBus' as const,
              }
            : {}),
        }
        if (installation) {
          applySupplyWireRoleToSegment(segment, role, installation, panels, panel)
          applySupplyPhaseState(segment, role)
        }
        const connectedSegment = applyAssemblyConnection(
          applySupplySection(segment, options?.sectionKey),
          connection
        )
        segments.push(connectedSegment)
        return connectedSegment
      }
      if (hasSeparateAcPorts && !usesDirectSplitFeed) {
        const outputWaypoints = [
          {
            point: { x: bendX, y: converterY },
            node: undefined as LayoutNode | undefined,
            assemblyNodeId: handoffAssemblyNodeId,
            sectionEndpointId: `panel-bus:${panel.id}`,
          },
          ...backupOutputNodes.map((node) => ({
            point: { x: node.bounds.x, y: converterY },
            node,
            assemblyNodeId: node.domainId,
            sectionEndpointId: `device:${node.domainId}`,
          })),
          {
            point: { x: converterX, y: converterY },
            node: directConverterNode,
            assemblyNodeId: directConverterNode.domainId,
            sectionEndpointId: `converter:${directConverterNode.domainId}`,
          },
        ].sort((left, right) => Math.abs(left.point.x - bendX) - Math.abs(right.point.x - bendX))
        for (let index = 0; index < outputWaypoints.length - 1; index++) {
          const from = outputWaypoints[index]!
          const to = outputWaypoints[index + 1]!
          const connection = findAssemblyConnection(from.assemblyNodeId, to.assemblyNodeId)
          const sectionKey = supplySectionKey(
            'direct-backup',
            from.sectionEndpointId,
            to.sectionEndpointId
          )
          if (index === 0) {
            pushDirectAcWire({ x: bendX, y: mainBusY }, from.point, connection, {
              role: 'downstream',
              sectionKey,
            })
          }
          pushDirectAcWire(
            from.node ? applyNodeWireInset(from.point, to.point, from.node) : from.point,
            to.node ? applyNodeWireInset(to.point, from.point, to.node) : to.point,
            connection,
            { role: 'downstream', sectionKey }
          )
        }
      }
      if (usesDirectSplitFeed && backupBusRun && gridBusRun) {
        const backupBusX = getLeftBiasedBusFeedStubX(
          backupBusRun.startPoint.x,
          backupBusRun.endPoint.x
        )
        const gridBusX = getLeftBiasedBusFeedStubX(gridBusRun.startPoint.x, gridBusRun.endPoint.x)
        const backupConnection = findAssemblyConnection(
          directConverterNode.domainId,
          handoffAssemblyNodeId,
          'inverter-backup-ac'
        )
        const converterBackupInset = applyNodeWireInset(
          { x: converterX, y: converterY },
          { x: backupBusX, y: converterY },
          directConverterNode
        )
        const directBackupProtectionNode = mainBusNode.children.find((child) => {
          if (child.type !== 'mcb' || !child.circuitIdForWires) return false
          const circuit = findCircuitByIdInPanel(panel, child.circuitIdForWires)
          return (
            circuit?.supplySource?.kind === 'converter-backup' &&
            circuit.supplySource.converterId === directConverterNode.domainId
          )
        })
        const backupLaneBusSideEnd = directBackupProtectionNode
          ? applyNodeWireInset(
              {
                x: directBackupProtectionNode.bounds.x,
                y: directBackupProtectionNode.bounds.y,
              },
              { x: backupBusX, y: converterY },
              directBackupProtectionNode
            )
          : converterBackupInset
        const backupSectionEnd = directBackupProtectionNode?.domainId
          ? `protection:${directBackupProtectionNode.domainId}`
          : `converter:${directConverterNode.domainId}`
        const backupSectionKey = supplySectionKey(
          'direct-backup',
          `backup-bus:${backupBusRun.busSectionId}`,
          backupSectionEnd
        )
        const backupBusSideConnection = directBackupProtectionNode ? undefined : backupConnection
        pushDirectAcWire(
          { x: backupBusX, y: mainBusY },
          { x: backupBusX, y: converterY },
          backupBusSideConnection,
          {
            role: 'downstream',
            busSectionId: backupBusRun.busSectionId,
            busFeedKind: 'backup',
            sectionKey: backupSectionKey,
          }
        )
        pushDirectAcWire(
          { x: backupBusX, y: converterY },
          backupLaneBusSideEnd,
          backupBusSideConnection,
          {
            role: 'downstream',
            sectionKey: backupSectionKey,
          }
        )
        const gridWaypointIndex = horizontalWaypoints.reduce(
          (closestIndex, waypoint, index) =>
            Math.abs(waypoint.point.x - gridBusX) <
            Math.abs(horizontalWaypoints[closestIndex]!.point.x - gridBusX)
              ? index
              : closestIndex,
          0
        )
        const gridAdjacentSegmentIndex = Math.min(gridWaypointIndex, horizontalWaypoints.length - 2)
        pushDirectAcWire({ x: gridBusX, y: mainBusY }, { x: gridBusX, y: supplyY }, undefined, {
          busSectionId: gridBusRun.busSectionId,
          busFeedKind: 'grid',
          sectionKey: directGridSectionKey(gridAdjacentSegmentIndex),
        })
      }
      if (converterGridInputConnected) {
        const converterBottom = applyNodeWireInset(
          { x: converterX, y: converterY },
          { x: converterX, y: supplyY },
          directConverterNode
        )
        const inputLegWaypoints = [
          { point: converterBottom, node: undefined as LayoutNode | undefined },
          ...converterGridInputLegNodes.map((node) => ({
            point: { x: node.bounds.x, y: node.bounds.y },
            node,
          })),
          { point: { x: converterX, y: supplyY }, node: undefined as LayoutNode | undefined },
        ]
        const inputLegNodeIds = [
          directConverterNode.domainId,
          ...converterGridInputLegNodes.map((node) => node.domainId),
          utilityAssemblyNodeId,
        ].filter((id): id is string => !!id)
        for (let index = 0; index < inputLegWaypoints.length - 1; index++) {
          const from = inputLegWaypoints[index]!
          const to = inputLegWaypoints[index + 1]!
          pushDirectAcWire(
            from.node ? applyNodeWireInset(from.point, to.point, from.node) : from.point,
            to.node ? applyNodeWireInset(to.point, from.point, to.node) : to.point,
            findAssemblyConnection(
              inputLegNodeIds[index],
              inputLegNodeIds[index + 1],
              'inverter-grid-ac'
            ) ?? findAssemblyPortConnection(directConverterNode.domainId, 'grid')
          )
        }
      }

      pushConverterDcWires(directConverterNode)
      if (vertical) applySupplyLabelVisibility(vertical, mergeCrossingWithBusDrop)
    } else if (supplyTrunkDeviceNodes.length > 0) {
      const supplyY = supplyNode.bounds.y
      const firstSupplyTrunkNode = supplyTrunkDeviceNodes[0]
      if (!firstSupplyTrunkNode) return segments
      const bendX = firstSupplyTrunkNode.bounds.x - LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
      const lastSupplyTrunkNode = supplyTrunkDeviceNodes[supplyTrunkDeviceNodes.length - 1]
      if (!lastSupplyTrunkNode) return segments
      const supplyInset = applyNodeWireInset(
        { x: supplyNode.bounds.x, y: supplyY },
        { x: lastSupplyTrunkNode.bounds.x, y: supplyY },
        supplyNode
      )

      const devicePositions = supplyTrunkDeviceNodes.map((node) => ({
        x: node.bounds.x,
        feedScope: installation
          ? resolveSupplySeparatorScope(installation, panels, panel, node.domainId ?? '', node.domainRef as TrunkDevice | undefined)
          : ('shared' as const),
      }))
      const separatorX = computeSupplySeparatorX(devicePositions, supplyInset.x, bendX)
      const mergeCrossingWithBusDrop = installation
        ? shouldMergeSupplyCrossingWithBusDrop(bendX, separatorX, devicePositions)
        : false
      const busEndpointId = `panel-bus:${panel.id}`
      const firstSupplyEndpointId = firstSupplyTrunkNode.domainId
        ? `device:${firstSupplyTrunkNode.domainId}`
        : `utility:${panel.id}`
      const busSideSectionKey = supplySectionKey('serial', busEndpointId, firstSupplyEndpointId)

      const vertical: WireSegment = {
        id: generateId(),
        type: 'vertical',
        startPoint: { x: bendX, y: mainBusY },
        endPoint: { x: bendX, y: supplyY },
        cable: downstreamCable,
        panelId: panel.id,
        domain: DEFAULT_ELECTRICAL_DOMAIN,
        hideWireLabel: true,
        supplyWireRole: 'downstream',
        supplyFeedScope: 'root',
      }
      if (installation) {
        applySupplyWireRoleToSegment(vertical, 'downstream', installation, panels, panel)
        applySupplyPhaseState(vertical, 'downstream')
      }
      applySupplySection(vertical, busSideSectionKey)
      segments.push(vertical)

      const waypoints: { x: number; deviceId?: string }[] = [{ x: bendX }]
      for (const td of supplyTrunkDeviceNodes) {
        waypoints.push({ x: td.bounds.x, deviceId: td.domainId })
      }
      waypoints.push({ x: supplyInset.x })

      const waypointScopes: SupplySpanEndpoint[] = ['bend']
      for (const node of supplyTrunkDeviceNodes) {
        const pos = devicePositions.find((p) => p.x === node.bounds.x)
        waypointScopes.push(pos?.feedScope ?? 'root')
      }
      waypointScopes.push('supply')

      const allSupplyNodes = [...supplyTrunkDeviceNodes]
      for (let i = 0; i < waypoints.length - 1; i++) {
        const from = waypoints[i]!
        const to = waypoints[i + 1]!
        const startPt = { x: from.x, y: supplyY }
        const endPt = { x: to.x, y: supplyY }
        const fromDevice = allSupplyNodes[i - 1]
        const toDevice = allSupplyNodes[i]
        const adjustedStart = fromDevice ? applyNodeWireInset(startPt, endPt, fromDevice) : startPt
        const adjustedEnd = toDevice ? applyNodeWireInset(endPt, startPt, toDevice) : endPt
        const fromSectionEndpoint = from.deviceId ? `device:${from.deviceId}` : busEndpointId
        const toSectionEndpoint = to.deviceId ? `device:${to.deviceId}` : `utility:${panel.id}`
        pushSupplyHorizontal(
          bendX,
          adjustedStart,
          adjustedEnd,
          separatorX,
          waypointScopes[i],
          waypointScopes[i + 1],
          mergeCrossingWithBusDrop,
          !to.deviceId ? currentPanelHandoffConnection : undefined,
          supplySectionKey('serial', fromSectionEndpoint, toSectionEndpoint)
        )
      }
      applySupplyLabelVisibility(vertical, mergeCrossingWithBusDrop)
    } else {
      const supplyY = supplyNode.bounds.y
      const isTextOnlyContinuation =
        supplyNode.visual?.type === 'symbol' && supplyNode.visual.opacity === 0
      const bendX = isTextOnlyContinuation
        ? resolvedSupplyBendX
        : supplyNode.bounds.x - LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
      const supplyInset = !isTextOnlyContinuation
        ? applyNodeWireInset(
            { x: supplyNode.bounds.x, y: supplyY },
            { x: bendX, y: supplyY },
            supplyNode
          )
        : undefined
      const separatorX = computeSupplySeparatorX([], supplyInset?.x ?? bendX, bendX)
      const mergeCrossingWithBusDrop = installation
        ? shouldMergeSupplyCrossingWithBusDrop(bendX, separatorX, [])
        : false

      const suppressDetachedSplitContinuation =
        isTextOnlyContinuation && hasExplicitPanelBusSections(panel) && !isSupplyDiagram
      if (!suppressDetachedSplitContinuation) {
        const vertical: WireSegment = {
          id: generateId(),
          type: 'vertical',
          startPoint: { x: bendX, y: mainBusY },
          endPoint: { x: bendX, y: supplyY },
          cable: downstreamCable,
          panelId: panel.id,
          domain: DEFAULT_ELECTRICAL_DOMAIN,
          hideWireLabel: true,
          isSupplyTrunk: true,
          supplyWireRole: 'downstream',
          supplyFeedScope: 'root',
        }
        if (installation) {
          applySupplyWireRoleToSegment(vertical, 'downstream', installation, panels, panel)
          applySupplyPhaseState(vertical, 'downstream')
        }
        if (currentPanelHandoffConnection)
          applyAssemblyConnection(vertical, currentPanelHandoffConnection)
        segments.push(vertical)

        // Continuation frames hide the mains symbol (opacity 0) but still paint a short
        // handoff rail to the Voeding caption. Without that horizontal, empty stubs only
        // expose a vertical hit target and library drops on the visible elbow/label miss.
        const horizontalEndX = isTextOnlyContinuation
          ? supplyNode.bounds.x + supplyNode.bounds.width / 2
          : supplyInset!.x
        if (Math.abs(horizontalEndX - bendX) > 1) {
          pushSupplyHorizontal(
            bendX,
            { x: bendX, y: supplyY },
            { x: horizontalEndX, y: supplyY },
            separatorX,
            'bend',
            'supply',
            mergeCrossingWithBusDrop,
            currentPanelHandoffConnection
          )
        }
        applySupplyLabelVisibility(vertical, mergeCrossingWithBusDrop)
      }
    }
  }

  // 4. Process main bus children (RCDs, MCBs)
  for (const child of mainBusNode.children) {
    if (child.type === 'rcd') {
      const rcdSegments = deriveRcdWires(
        child,
        panel,
        mainBusY,
        installation?.nominalVoltage.system
      )
      segments.push(...rcdSegments)
    } else if (child.type === 'mcb') {
      const circuit = child.circuitIdForWires
        ? findCircuitByIdInPanel(panel, child.circuitIdForWires)
        : null
      const converterSource =
        circuit?.supplySource?.kind === 'converter-backup' &&
        directConverterNodeForBackup?.domainId === circuit.supplySource.converterId
          ? {
              node: directConverterNodeForBackup,
              assemblyId: supplyAssembly?.id,
              connection: findAssemblyConnection(
                directConverterNodeForBackup.domainId,
                `converter-backup-protection-${(child.domainRef as ProtectionDevice | undefined)?.id}`,
                'inverter-backup-ac'
              ),
            }
          : undefined
      const mcbSegments = deriveMcbWires(child, panel, mainBusY, null, converterSource)
      segments.push(...mcbSegments)
    }
  }

  return finalizePanelWires({
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
  })
}
