import {
  buildCircuitConverterDcConnectionNodes,
  buildOrdinaryDcBusEndpointBranchNodes,
} from './layoutTreeDcBranches'
import { buildMainBusNode } from './layoutTreeMainBus'
import type { BranchLayout } from './wireSegments'
/**
 * Unified Layout Tree (Scene Graph)
 *
 * This module defines the LayoutNode tree structure that serves as the single
 * source of truth for layout, rendering, hit testing, and wire generation.
 *
 */

import type {
  Panel,
  Circuit,
  ProtectionDevice,
  Endpoint,
  CableSpec,
  TrunkDevice,
} from '@/types/schema'
import { getSubPanelMainBusFeedDevice } from '@/lib/panel/subPanelFeed'

import { resolvePanelSupplyLinkForProtectionInPanels } from '@/lib/eendraad/panelSupplyLink'
import {
  getProtectionOneWireAnchorLineIndex,
  getProtectionOneWireLabelLines,
} from '@/lib/protectionLabels'
import { getSymbolLabelVerticalMetrics } from '@/lib/symbolLabelMetrics'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import {
  DOMOTICA_BASE_HEIGHT,
  DOMOTICA_BOX_WIDTH,
  DOMOTICA_MIN_ENDPOINT_OUTPUTS,
  DOMOTICA_OUTPUT_SPACING,
} from '@/lib/domoticaLayout'
import { hasExplicitPanelBusSections } from '@/lib/panel/panelBusSections'
import { getLeftBiasedBusFeedStubX } from '@/lib/panel/panelBusFeedPreview'
import { FEED_STUB_FEEDER_GEOMETRY, getFeedStubFeederLegHeight } from './feedStubFeeders'
import { getSymbolById, resolveSymbolPortsForWire } from '@/lib/symbols'
import {
  CIRCUIT_CONVERTER_BLOCK_SIZE,
  getCircuitConverterBodyGeometry,
  getCircuitConverterDcConnectionCount,
  getCircuitConverterPrimaryEndpointIds,
  getSupplyConverterBodyGeometry,
  isCircuitConverterDcChild,
  supportsCircuitConverterDcConnections,
} from './circuitConverterGeometry'

import { runWithControlLinkNotes } from '@/lib/controlLink/controlLinkNoteContext'
import {
  getCircuitConverterMetadataCallouts,
  getBranchConverterMetadataCallouts,
  type CircuitConverterMetadataCallout,
} from './circuitConverterMetadataCallouts'
import { getPanelSupplyOrientationContext, isVerticalSupplyDevice } from './supplyDeviceOrientation'

import {
  mirrorInlineSplitBusLayoutNodesHorizontally,
  mirrorLayoutNodeHorizontally,
  mirrorSupplyAssemblyLayoutNodesHorizontally,
  normalizeNestedSupplyDcConverterGrowth,
  normalizeSupplyConverterGrowth,
  normalizeSupplyDcBusGrowth,
} from './layoutTreeOrientation'
import { buildBranchNode } from './layoutTreeBranchNodes'

export {
  mirrorInlineSplitBusLayoutNodesHorizontally,
  mirrorLayoutNodeHorizontally,
  mirrorSupplyAssemblyLayoutNodesHorizontally,
} from './layoutTreeOrientation'

/**
 * Node types in the layout tree
 */
export type LayoutNodeType =
  | 'panel'
  | 'busBar'
  | 'rcd'
  | 'mcb'
  | 'branch'
  | 'endpoint'
  | 'wire'
  | 'label'
  | 'supply'
  | 'ground'
  | 'trunk'
  | 'secondaryBus'
  | 'trunkDevice'

/**
 * Drop target types for hit testing
 */
export type DropTargetType =
  | 'circuit'
  | 'protection'
  | 'endpoint'
  | 'mainBus'
  | 'rcd'
  | 'supplyWire'
  | 'supplyBackupWire'
  | 'supplyBackupOutputWire'
  | 'supplyChangeoverGridWire'
  | 'supplyConverterGridWire'
  | 'supplyConverterBackupWire'
  | 'supplyConverterDcWire'
  | 'groundWire'
  | null

/**
 * Visual properties for different node types
 */
export interface SymbolVisual {
  type: 'symbol'
  symbolId: string
  /** Clockwise artwork rotation from the symbol library's upright orientation. */
  rotationDeg?: number
  label?: string
  opacity?: number
  /** Whether this endpoint is the final symbol on its horizontal branch. */
  isEndpointAtBranchEnd?: boolean
  /** Mirror artwork for an endpoint connected by a left-running branch. */
  mirrorHorizontally?: boolean
  /** For a bottom label, keep its left edge clear of a nearby branch wire. */
  bottomLabelMinimumLeftX?: number
  /** For a crowded branch, cap a bottom label before the next endpoint slot. */
  bottomLabelMaximumRightX?: number
  /** Detached metadata frame used when widened-converter output labels collide. */
  metadataCallout?: {
    x: number
    y: number
    width: number
    height: number
    leaderPoints: [number, number, number, number]
    leaderSegments?: Array<[number, number, number, number]>
    targetIds?: string[]
    totalMultiplier?: number
  }
  /** A matching endpoint shares the metadata frame rendered by another endpoint. */
  suppressMetadataLabel?: boolean
}

export interface WireVisual {
  type: 'wire'
  cable: CableSpec
  wireType: 'trunk' | 'branch' | 'vertical' | 'mainBus' | 'secondaryBus'
  inTube?: boolean
  inWall?: boolean
  wireRoute?: 'wall' | 'ground' | 'air'
  hideWireLabel?: boolean
}

export interface BusBarVisual {
  type: 'busBar'
  thickness: number
}

export interface LabelVisual {
  type: 'label'
  text: string
  translationKey?: string
  fontSize?: number
  /** Optional bus-row text box measured without the ordinary circuit-label wrapping cap. */
  unwrappedWidth?: number
  variant?: 'circuit-notes' | 'default' // 'circuit-notes' for italic, gray styling
  /** When 'left', label is drawn with left edge at bounds.x (e.g. to the right of domotica endpoints). */
  align?: 'left' | 'center' | 'right'
  /** For circuit-notes: draw text horizontal or vertical (90° rotated). */
  notesOrientation?: 'horizontal' | 'vertical'
  /** For circuit-notes: if false, do not draw (slot reserved for layout stability). */
  notesVisible?: boolean
}

export type NodeVisual = SymbolVisual | WireVisual | BusBarVisual | LabelVisual

/**
 * Hit zone configuration for drop target detection
 */
export interface HitZone {
  type: DropTargetType
  padding: number
  /** Optional axis-specific padding for narrow, non-overlapping drop slots. */
  paddingX?: number
  paddingY?: number
  /** Explicit insertion slot for a segmented main bus hit zone. */
  mainBusInsertIndex?: number
  outputGroup?: 'control' | 'endpoint'
  outputIndex?: number
  outputExpands?: boolean
  /** Drop region for chaining an existing Domotica child endpoint. */
  domoticaChildDropIntent?: 'insertBefore' | 'insertAfter'
  converterDcConnection?: { converterId: string; connectionIndex: number }
  /** Electrical domain immediately at this wire hit zone. */
  wireDomain?: 'AC' | 'DC'
  /** Selectable DC bus that owns this distribution hit zone. */
  dcBusId?: string
  /** Explicit serial insertion point for a vertical DC-bus endpoint branch. */
  branchInsertAfterEndpointId?: string | null
  /** Insertion point for a branch-local serial DC device, measured from the bus. */
  branchDeviceInsertIndex?: number
  /** Keep the hit target active without drawing an additional preview marker for it. */
  suppressDropHint?: boolean
  supplyFeedScope?: 'shared' | 'root'
  supplyPanelInput?: boolean
  supplyInsertIndex?: number
  supplyPanelId?: string
  supplyConverterDcBranch?: 'right' | 'top'
  supplyConverterDcConnectionIndex?: number
  /** Supply DC bus whose painted bar owns this drop zone. */
  supplyDcBusId?: string
  /** Existing outgoing branch on a selectable supply DC bus. */
  supplyDcBusBranchId?: string
  dropHintAnchor?: { x: number; y: number }
  /** Geometry selected on the converter grid-input path. */
  converterGridPlacement?: 'inline' | 'input-leg' | 'converter-leg'
  /** Geometry selected on the modular changeover grid-input path. */
  changeoverGridPlacement?: 'inline' | 'input-leg'
  /** Set when port-1 devices sit inline on the horizontal inverter-leg tap wire. */
  changeoverGridSource?: 'converter-input'
  horizontalDcLane?: boolean
  /** The single direct-converter junction where a source changeover may be inserted. */
  supplyConverterChangeoverSlot?: boolean
  /** Explicit bus rail represented by this hit zone (needed when a split bus has no items yet). */
  busSectionId?: string
}

function getCircuitTrunkSegmentDomain(circuit: Circuit, segmentIndex: number): 'AC' | 'DC' {
  let domain: 'AC' | 'DC' = circuit.dcBusSource ? 'DC' : 'AC'
  const devices = [...(circuit.trunkDevices ?? [])].sort(
    (left, right) => (left.trunkPosition ?? 0) - (right.trunkPosition ?? 0)
  )
  for (const device of devices.slice(0, segmentIndex)) {
    // Widened converters expose dedicated output lanes. A normal one-port
    // converter keeps the established trunk topology and changes the domain
    // of the ordinary segment above it.
    if (
      supportsCircuitConverterDcConnections(device) &&
      getCircuitConverterDcConnectionCount(device) > 1
    ) {
      continue
    }
    const resolved = resolveSymbolPortsForWire(device.symbol, domain)
    if (resolved.matched && resolved.oppositePortDomain) {
      domain = resolved.oppositePortDomain
    }
  }
  return domain
}

/**
 * Bounds rectangle for a layout node
 */
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The unified layout tree node
 *
 * This is the single source of truth for:
 * - Element positions (bounds)
 * - Visual properties (visual)
 * - Hit testing zones (hitZone)
 * - Domain references (domainId, domainRef)
 * - Hierarchical structure (children)
 */
export interface LayoutNode {
  id: string
  type: LayoutNodeType
  bounds: Bounds
  /** Electrical anchor when it differs from the center of asymmetric painted bounds. */
  connectionAnchor?: { x: number; y: number }
  /** Supply-stub tap of a hosted feeder branch (see `feedStubFeeders.ts`). */
  feedStubTap?: { x: number; y: number; busSectionId: string }
  /** Direction occupied by extra converter blocks relative to connectionAnchor. */
  converterGrowthDirection?: 'left' | 'right'
  /** Height of the converter-input T where the port-1 riser joins (mirror-invariant). */
  supplyConverterInputTapY?: number
  circuitWireLabelSpan?: number
  domainId?: string // panel.id, circuit.id, endpoint.id, protection.id
  /** Unique frame identity when one electrical panel renders in multiple frames. */
  diagramId?: string
  domainRef?: Panel | Circuit | ProtectionDevice | Endpoint | TrunkDevice // Typed domain reference
  branchLayout?: BranchLayout
  /** When set on an `mcb` node, wires for this column use this circuit (multi-circuit protections / merged sub-panel feed). */
  circuitIdForWires?: string
  /** Precise module-output occurrence feeding a sub-panel; upstream protection stays separate. */
  sourceEndpointForWires?: Endpoint
  visual?: NodeVisual
  hitZone?: HitZone
  children: LayoutNode[]
  /** Nested child X positions on secondary bus nodes (insertion logic metadata). */
  nestedChildXs?: number[]
  /** Horizontal mirror axis for a left-to-right supply layout. Present on its panel root. */
  horizontalMirrorAxisX?: number
  /** Whole detached frame or only the supply assembly of an ordinary panel. */
  horizontalMirrorScope?: 'panel' | 'supply'
  /** The empty split bus is mirrored with its inline supply risers. */
  horizontalMirrorInlineSplitBus?: boolean
}

/** Stable semantic identity for reconciliation and React scene keys. */
export function getLayoutNodeIdentityKey(node: LayoutNode): string {
  return [
    node.type,
    node.id,
    node.domainId ?? '',
    node.diagramId ?? '',
    node.circuitIdForWires ?? '',
  ].join(':')
}

/**
 * Root layout tree structure
 * Contains all panels as top-level nodes
 */
export interface LayoutTree {
  panels: LayoutNode[] // Each panel is a LayoutNode with type='panel'
  totalWidth: number
  totalHeight: number
}

/**
 * Adapter: Convert flat BottomUpLayoutResult to hierarchical LayoutTree
 *
 * This is a pure mapping function - no layout math, just restructuring.
 * Used in Phase 0-1 as a bridge while we migrate to direct tree generation.
 */
import type {
  BottomUpLayoutResult,
  BottomUpPanelLayout,
  BottomUpLayoutElement,
  BottomUpCircuitLayout,
} from './bottomUpLayout'
import { clamp } from '@/lib/geometry'
import {
  LAYOUT_CONSTANTS,
  PROTECTION_LABEL_DEFAULT_BOX_WIDTH,
  estimateProtectionNameLabelWidth,
  getPanelDiagramId,
  hasPanelAttachmentOnSecondaryBus,
  isPanelOnlySubPanelFeeder,
  mirrorDetachedSupplyPanelLayoutHorizontally,
  mirrorInlineSupplyPanelLayoutHorizontally,
} from './bottomUpLayout'

/** Minimum vertical segment length on sub-panel incoming feeder (matches virtual MCB anchor math). */
export const MIN_SUBPANEL_INCOMING_SEGMENT_LENGTH = 70
/** Sub-panel incoming feeder: circuit code, then parent panel name (Y grows downward, from virtual MCB anchor). */
export const SUBPANEL_FEED_CIRCUIT_LABEL_Y = 0
export const SUBPANEL_FEED_PARENT_TAG_Y = 28

/**
 * Y of the virtual parent-MCB anchor on a sub-panel's incoming feeder. The total feeder height fits
 * two minimum wire segments (below and above an inserted protection), unless the layout asked for
 * a compact feeder.
 */
function subPanelFeedAnchorY(panelLayout: BottomUpPanelLayout, parentMcbBaseY: number): number {
  if (panelLayout.compactSubPanelFeed) return parentMcbBaseY
  return Math.max(parentMcbBaseY, panelLayout.mainBus.y + MIN_SUBPANEL_INCOMING_SEGMENT_LENGTH * 2)
}

/**
 * Scene anchors for sub-panel feeder labels — same geometry as `buildPanelNode` parent-MCB branch
 * (export / PDF must not use raw `bottomUpLayout` element Y for these).
 */
export function getSubPanelIncomingFeedLabelAnchors(
  panelLayout: BottomUpPanelLayout
): { centerX: number; circuitAnchorY: number; parentTagAnchorY: number } | null {
  const parentMcbEl = panelLayout.elements.find((e) => e.id === 'parent-mcb')
  if (!parentMcbEl) return null

  const parentMcbAnchorY = subPanelFeedAnchorY(panelLayout, parentMcbEl.position.y)

  return {
    centerX: parentMcbEl.position.x,
    circuitAnchorY: parentMcbAnchorY + SUBPANEL_FEED_CIRCUIT_LABEL_Y,
    parentTagAnchorY: parentMcbAnchorY + SUBPANEL_FEED_PARENT_TAG_Y,
  }
}

/** Map ProtectionType enum to the canvas symbol ID used for rendering & wire insets */
function protectionTypeToSymbolId(type?: string): string {
  switch (type) {
    case 'RCBO':
      return 'rcbo'
    case 'RCD':
      return 'rcd'
    case 'FUSE':
      return 'fuse'
    case 'MAIN_SWITCH':
      return 'main_switch'
    case 'ROTATING_SWITCH':
      return 'rotating_switch'
    case 'SPD':
      return 'spd'
    default:
      return 'mcb'
  }
}

export function buildLayoutTree(layout: BottomUpLayoutResult): LayoutTree {
  // Re-enter the layout pass's control-link note scope so labels, offsets and
  // minimum-left constraints use the same text as the measurement pass.
  return runWithControlLinkNotes(layout.controlLinkNotes ?? new Map(), () =>
    buildLayoutTreeScoped(layout)
  )
}

function buildLayoutTreeScoped(layout: BottomUpLayoutResult): LayoutTree {
  const panelNodes: LayoutNode[] = layout.panels.map((panelLayout) =>
    buildPanelNodeForVisualDirection(panelLayout)
  )

  return {
    panels: panelNodes,
    totalWidth: layout.totalWidth,
    totalHeight: layout.totalHeight,
  }
}

function buildPanelNodeForVisualDirection(panelLayout: BottomUpPanelLayout): LayoutNode {
  if (panelLayout.supplyFlowDirection !== 'left-to-right') {
    const panelNode = buildPanelNode(panelLayout)
    normalizeSupplyConverterGrowth(panelNode)
    normalizeNestedSupplyDcConverterGrowth(panelNode)
    normalizeSupplyDcBusGrowth(panelNode)
    return panelNode
  }

  const scope = panelLayout.frameRole === 'supply' ? 'panel' : 'supply'
  const axisX = panelLayout.supplyMirrorAxisX ?? panelLayout.frame.x + panelLayout.frame.width / 2
  const mirrorPanelLayout =
    scope === 'panel'
      ? mirrorDetachedSupplyPanelLayoutHorizontally
      : mirrorInlineSupplyPanelLayoutHorizontally
  mirrorPanelLayout(panelLayout)
  try {
    const panelNode = buildPanelNode(panelLayout)
    if (scope === 'panel') mirrorLayoutNodeHorizontally(panelNode, axisX)
    else {
      mirrorSupplyAssemblyLayoutNodesHorizontally(panelNode, axisX)
      if (panelLayout.inlineEmptySplitRails) {
        mirrorInlineSplitBusLayoutNodesHorizontally(panelNode, axisX)
        panelNode.horizontalMirrorInlineSplitBus = true
      }
    }
    normalizeSupplyConverterGrowth(panelNode)
    normalizeNestedSupplyDcConverterGrowth(panelNode)
    normalizeSupplyDcBusGrowth(panelNode)
    panelNode.horizontalMirrorAxisX = axisX
    panelNode.horizontalMirrorScope = scope
    return panelNode
  } finally {
    mirrorPanelLayout(panelLayout)
  }
}

type FeedStubPaintRect = { left: number; right: number; top: number; bottom: number }

function getFeedStubDevicePaintRects(
  device: TrunkDevice,
  x: number,
  y: number
): FeedStubPaintRect[] {
  const symbolHalf = LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
  const rects: FeedStubPaintRect[] = [
    { left: x - symbolHalf, right: x + symbolHalf, top: y - symbolHalf, bottom: y + symbolHalf },
  ]
  const leftLines = [device.label, device.notes].filter((value): value is string => !!value?.trim())
  if (leftLines.length > 0) {
    const metrics = getSymbolLabelVerticalMetrics(leftLines, 10)
    const width = Math.max(
      ...leftLines.map((line) => measureSymbolLabelTextWidth(line, 'Figtree', 8))
    )
    rects.push({
      left: x - symbolHalf - 5 - width - 4,
      right: x - symbolHalf - 1,
      top: y - metrics.totalHeight / 2 - 3,
      bottom: y + metrics.totalHeight / 2 + 3,
    })
  }
  if (device.type === 'protection') {
    const lines = getProtectionOneWireLabelLines(device)
    if (lines.length > 0) {
      const metrics = getSymbolLabelVerticalMetrics(
        lines.map((line) => line.text),
        12
      )
      const top = -getProtectionOneWireAnchorLineIndex(lines) * 12 - 5
      const width = Math.max(
        ...lines.map((line) => measureSymbolLabelTextWidth(line.text, 'Figtree', 10))
      )
      rects.push({
        left: x + symbolHalf + 1,
        right: x + symbolHalf + 5 + width + 4,
        top: y + top - 3,
        bottom: y + top + metrics.totalHeight + 3,
      })
    }
  }
  return rects
}

function layoutFeedStubStack(
  devicesFromBus: readonly TrunkDevice[],
  x: number,
  busY: number,
  /** Height of the tallest hosted feeder leg, from the distribution bar to the bus level. */
  feederLegHeight?: number
): { centers: number[]; endY: number; tapY?: number } {
  const centers: number[] = []
  const rects: FeedStubPaintRect[] = []
  for (const device of devicesFromBus) {
    const relative = getFeedStubDevicePaintRects(device, x, 0)
    const top = Math.min(...relative.map((rect) => rect.top))
    const previous = centers.length - 1
    const y =
      previous < 0
        ? busY + Math.max(44, 25 - top)
        : Math.max(centers[previous]! + 50, Math.max(...rects.map((rect) => rect.bottom)) - top + 6)
    centers.push(y)
    rects.push(
      ...relative.map((rect) => ({
        ...rect,
        top: rect.top + y,
        bottom: rect.bottom + y,
      }))
    )
  }
  const lastY = centers.at(-1) ?? busY
  const lastBottom = Math.max(lastY + 15, ...rects.map((rect) => rect.bottom))
  // An empty stub is painted down to its feed marker (deriveWires), so its
  // insertion zone must cover that whole wire, not just the first few pixels.
  const ownEndY =
    centers.length === 0
      ? busY + LAYOUT_CONSTANTS.SUPPLY_VERTICAL_DROP
      : Math.max(lastY + 42, lastBottom + 18)
  if (feederLegHeight == null) return { centers, endY: ownEndY }
  // The distribution bar sits on the supply side, below every device of this
  // stub and low enough for the feeder legs to reach up to the bus level.
  const tapY = Math.max(
    centers.length === 0
      ? busY + FEED_STUB_FEEDER_GEOMETRY.firstTapOffset
      : Math.max(lastY + FEED_STUB_FEEDER_GEOMETRY.tapBelowDevice, lastBottom + 10),
    busY + feederLegHeight
  )
  return {
    centers,
    endY: Math.max(ownEndY, tapY + FEED_STUB_FEEDER_GEOMETRY.stubBelowTap),
    tapY,
  }
}

function buildPanelNode(panelLayout: BottomUpPanelLayout): LayoutNode {
  const children: LayoutNode[] = []

  // Find supply and ground elements
  const supplyElement = panelLayout.elements.find((e) => e.type === 'supply')
  const groundElement = panelLayout.elements.find((e) => e.type === 'ground')
  const mainBusElement = panelLayout.elements.find((e) => e.type === 'mainBus')

  // Add supply
  if (supplyElement) {
    children.push({
      id: supplyElement.id,
      type: 'supply',
      bounds: {
        x: supplyElement.position.x,
        y: supplyElement.position.y,
        width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
        height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
      },
      visual: {
        type: 'symbol',
        symbolId: 'mains',
        opacity: panelLayout.supplyEndpointKind === 'continuation' ? 0 : undefined,
      },
      hitZone: {
        type: panelLayout.supplyEndpointKind === 'continuation' ? null : 'supplyWire',
        padding: 0,
        supplyFeedScope: 'shared',
        supplyInsertIndex: 0,
        supplyPanelId: panelLayout.panel.id,
      },
      children: [],
    })
  }

  const supplyContinuationLabel = panelLayout.elements.find(
    (element) => element.id === 'supply-continuation-label'
  )
  if (supplyContinuationLabel) {
    children.push({
      id: supplyContinuationLabel.id,
      type: 'label',
      bounds: {
        x: supplyContinuationLabel.position.x,
        y: supplyContinuationLabel.position.y,
        width: 120,
        height: 20,
      },
      visual: {
        type: 'label',
        text: supplyContinuationLabel.label ?? '',
        translationKey: supplyContinuationLabel.translationKey,
        align: 'center',
      },
      children: [],
    })
  }

  // Add supply trunk device nodes (energy meters, protections on the supply wire)
  const supplyTrunkDeviceElements = panelLayout.elements.filter(
    (e) => e.type === 'trunkDevice' && e.id?.startsWith('supplyTrunkDevice-')
  )
  for (const stdElement of supplyTrunkDeviceElements) {
    const supplyDeviceData = panelLayout.supplyDevices?.find(
      (sd) => sd.device.id === stdElement.trunkDeviceId
    )
    if (supplyDeviceData) {
      const supplyDevice = supplyDeviceData.device
      const scalableSupplyConverter =
        supportsCircuitConverterDcConnections(supplyDevice) &&
        getCircuitConverterDcConnectionCount(supplyDevice) > 1 &&
        (supplyDevice.supplyPath === 'converter-branch' || supplyDevice.supplyPath === 'backup')
      const scalableNestedDcBusConverter =
        supportsCircuitConverterDcConnections(supplyDevice) && supplyDevice.supplyDcBusId != null
      const converterGeometry = scalableSupplyConverter
        ? getSupplyConverterBodyGeometry(supplyDevice, stdElement.position)
        : scalableNestedDcBusConverter
          ? getCircuitConverterBodyGeometry(supplyDevice, stdElement.position)
          : undefined
      const dcBusWidth = LAYOUT_CONSTANTS.DC_BUS_MIN_WIDTH
      const nodeCenter =
        converterGeometry?.center ??
        (supplyDevice.type === 'dc_bus'
          ? {
              x: stdElement.position.x - dcBusWidth / 2,
              y: stdElement.position.y,
            }
          : stdElement.position)
      const isDomoticaSupplyDevice =
        supplyDevice.symbol === 'domotica' && supplyDevice.supplyDcBusId != null
      const domoticaEndpointCount = DOMOTICA_MIN_ENDPOINT_OUTPUTS
      const domoticaHeight =
        DOMOTICA_BASE_HEIGHT + Math.max(0, domoticaEndpointCount - 1) * DOMOTICA_OUTPUT_SPACING
      const nodeBoundsY = isDomoticaSupplyDevice
        ? stdElement.position.y - domoticaHeight / 2 + DOMOTICA_BASE_HEIGHT / 2
        : nodeCenter.y
      const isHorizontalSupplyDevice = !isVerticalSupplyDevice(supplyDevice, getPanelSupplyOrientationContext(panelLayout))
      const rotatesProtectionArtwork =
        isHorizontalSupplyDevice &&
        supplyDevice.type === 'protection' &&
        getSymbolById(supplyDevice.symbol)?.category !== 'switches'
      children.push({
        id: stdElement.id,
        type: 'trunkDevice',
        bounds: {
          x: nodeCenter.x,
          y: nodeBoundsY,
          width: converterGeometry
            ? converterGeometry.width +
              (LAYOUT_CONSTANTS.SYMBOL_SIZE - CIRCUIT_CONVERTER_BLOCK_SIZE)
            : supplyDevice.type === 'dc_bus'
              ? dcBusWidth
              : isDomoticaSupplyDevice
                ? DOMOTICA_BOX_WIDTH
                : LAYOUT_CONSTANTS.SYMBOL_SIZE,
          height: isDomoticaSupplyDevice ? domoticaHeight : LAYOUT_CONSTANTS.SYMBOL_SIZE,
        },
        connectionAnchor:
          converterGeometry || supplyDevice.type === 'dc_bus'
            ? { ...stdElement.position }
            : undefined,
        converterGrowthDirection: converterGeometry
          ? scalableSupplyConverter
            ? 'left'
            : 'right'
          : undefined,
        ...(panelLayout.supplyChangeoverBranches?.converterInputTap &&
        panelLayout.supplyChangeoverBranches.deviceId === supplyDevice.id
          ? { supplyConverterInputTapY: panelLayout.supplyChangeoverBranches.converterInputTap.y }
          : {}),
        domainId: supplyDeviceData.device.id,
        domainRef: supplyDeviceData.device,
        visual: {
          type: 'symbol',
          symbolId: supplyDevice.symbol || 'energy_meter',
          label: supplyDevice.label,
          // Relay SVGs are intrinsically wide; protections are intrinsically upright.
          rotationDeg:
            supplyDevice.symbol === 'relay'
              ? isHorizontalSupplyDevice
                ? 0
                : 90
              : rotatesProtectionArtwork
                ? 90
                : undefined,
        },
        hitZone: {
          // Branch devices keep their own insertion lane. The converter itself remains
          // selectable, but is not another insertion slot.
          type:
            supplyDeviceData.device.supplyPath === 'backup'
              ? null
              : supplyDeviceData.device.supplyPath === 'converter-branch' ||
                  supplyDeviceData.device.supplyPath === 'converter-dc' ||
                  supplyDeviceData.device.supplyPath === 'converter-dc-top'
                ? supplyDevice.type === 'dc_bus' || !!supplyDevice.supplyDcBusId
                  ? 'supplyConverterDcWire'
                  : null
                : supplyDeviceData.device.supplyPath === 'backup-output'
                  ? 'supplyBackupOutputWire'
                  : supplyDeviceData.device.supplyPath === 'changeover-grid'
                    ? 'supplyChangeoverGridWire'
                    : supplyDeviceData.device.supplyPath === 'converter-grid'
                      ? 'supplyConverterGridWire'
                      : 'supplyWire',
          // Make supply trunk devices easy to hit while dragging/dropping.
          padding: 10,
          supplyFeedScope: supplyDeviceData.feedScope,
          supplyInsertIndex:
            panelLayout.supplyEndpointKind === 'continuation'
              ? Math.max(
                  supplyDeviceData.feedIndex,
                  panelLayout.panelLocalRootSupplyInsertBase ?? 0
                )
              : supplyDeviceData.feedIndex,
          supplyPanelId: panelLayout.panel.id,
          ...(supplyDevice.type === 'dc_bus'
            ? {
                supplyConverterDcBranch:
                  supplyDevice.supplyPath === 'converter-dc-top'
                    ? ('top' as const)
                    : ('right' as const),
                supplyConverterDcConnectionIndex:
                  supplyDevice.supplyConverterDcConnectionIndex ??
                  (supplyDevice.supplyPath === 'converter-dc-top' ? 1 : 0),
                supplyDcBusId: supplyDevice.id,
              }
            : {}),
          ...(supplyDevice.supplyDcBusId
            ? {
                supplyConverterDcBranch:
                  supplyDevice.supplyPath === 'converter-dc-top'
                    ? ('top' as const)
                    : ('right' as const),
                supplyConverterDcConnectionIndex:
                  supplyDevice.supplyConverterDcConnectionIndex ??
                  (supplyDevice.supplyPath === 'converter-dc-top' ? 1 : 0),
                supplyDcBusId: supplyDevice.supplyDcBusId,
                supplyDcBusBranchId: supplyDevice.supplyDcBusBranchId,
              }
            : {}),
          ...(panelLayout.supplyHorizontalDcLaneDeviceIds?.has(supplyDevice.id) ? { horizontalDcLane: true } : {}),
          ...(supplyDeviceData.device.supplyPath === 'converter-grid'
            ? {
                converterGridPlacement: supplyDeviceData.device.converterGridPlacement ?? 'inline',
              }
            : {}),
          ...(supplyDeviceData.device.supplyPath === 'changeover-grid'
            ? {
                changeoverGridPlacement:
                  supplyDeviceData.device.changeoverGridPlacement ?? 'inline',
                ...(panelLayout.supplyChangeoverGridSource
                  ? { changeoverGridSource: panelLayout.supplyChangeoverGridSource }
                  : {}),
              }
            : {}),
        },
        children: [],
      })
    }
  }

  // Add ground
  if (groundElement) {
    children.push({
      id: groundElement.id,
      type: 'ground',
      bounds: {
        x: groundElement.position.x,
        y: groundElement.position.y,
        width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
        height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
      },
      visual: {
        type: 'symbol',
        symbolId: 'earthing',
      },
      hitZone: {
        type: null,
        padding: 0,
      },
      children: [],
    })
  }

  // Add ground trunk device nodes (earthing separators on the ground wire)
  const groundTrunkDeviceElements = panelLayout.elements.filter(
    (e) => e.type === 'trunkDevice' && e.id?.startsWith('groundTrunkDevice-')
  )
  for (const gtdElement of groundTrunkDeviceElements) {
    const groundDeviceData = panelLayout.groundDevices?.find(
      (gd) => gd.device.id === gtdElement.trunkDeviceId
    )
    if (groundDeviceData) {
      children.push({
        id: gtdElement.id,
        type: 'trunkDevice',
        bounds: {
          x: gtdElement.position.x,
          y: gtdElement.position.y,
          width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
          height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
        },
        domainId: groundDeviceData.device.id,
        domainRef: groundDeviceData.device,
        visual: {
          type: 'symbol',
          symbolId: groundDeviceData.device.symbol || 'earthing_separator',
          label: groundDeviceData.device.label,
        },
        hitZone: {
          type: 'groundWire', // Trunk devices on ground wire target the ground wire
          // Slightly larger hit zone for easier selection.
          padding: 10,
        },
        children: [],
      })
    }
  }

  // For sub-panels: add parent MCB node (instead of supply)
  // This is the mirrored copy of the MCB from the parent panel that feeds this sub-panel.
  const parentMcbElement = panelLayout.elements.find((e) => e.id === 'parent-mcb')
  const panelFeed = getSubPanelMainBusFeedDevice(panelLayout.panel)
  const panelSupplyDevices = panelFeed ? [panelFeed.device] : []
  if (parentMcbElement) {
    const parentMcbLabelElement = panelLayout.elements.find((e) => e.id === 'parent-mcb-label')
    // Sub-panel feeder geometry notes:
    // - `parentMcbElement.position.y` comes from bottomUpLayout (legacy fixed supply root depth).
    // - For local feeder protection rendering we need a taller incoming wire so we can draw 1A2.
    // - We therefore define a virtual/visual MCB anchor (`parentMcbAnchorY`) used by
    //   the mirrored parent MCB, its label, and the incoming wire hit zone in this tree.
    // - This does not mutate panel data; it only affects layout-tree rendering/hit-testing.
    const parentMcbAnchorY = mainBusElement
      ? subPanelFeedAnchorY(panelLayout, parentMcbElement.position.y)
      : parentMcbElement.position.y

    // Resolve the protection type for correct symbol rendering
    const parentMcbProtection = panelLayout.parentMcb?.protection
    const protectionSymbolId = protectionTypeToSymbolId(parentMcbProtection?.type)

    children.push({
      id: 'parent-mcb',
      type: 'mcb',
      bounds: {
        x: parentMcbElement.position.x,
        y: parentMcbAnchorY,
        width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
        height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
      },
      domainId: parentMcbElement.protectionId,
      domainRef: parentMcbProtection,
      circuitIdForWires: parentMcbElement.circuitId,
      sourceEndpointForWires: panelLayout.parentMcb?.sourceEndpoint,
      visual: {
        type: 'symbol',
        symbolId: protectionSymbolId,
        label: parentMcbProtection?.label || '',
      },
      hitZone: {
        // Parent feeder protection is only a mirrored reference from the parent panel.
        // It should not be selectable/editable inside the sub-panel canvas.
        type: null,
        padding: 0,
      },
      children: [],
    })

    // Sub-panel incoming supply trunk devices:
    // use the sub-panel's local PANEL circuit trunkDevices so they only exist/appear in this panel.
    if (panelSupplyDevices.length > 0 && mainBusElement) {
      // Keep the local feeder device between parent MCB and busbar (1A2),
      // with enough wire length on both sides for regular wire labels.
      const mcbY = parentMcbAnchorY
      const busY = mainBusElement.position.y
      const minSegmentLength = MIN_SUBPANEL_INCOMING_SEGMENT_LENGTH
      const midpointY = (mcbY + busY) / 2
      // Clamp insertion zone so both wire segments stay >= minSegmentLength.
      const minY = busY + minSegmentLength
      const maxY = mcbY - minSegmentLength
      const pinnedDeviceY = minY <= maxY ? clamp(maxY, minY, midpointY) : midpointY
      // Show at most one local feeder protection/device on sub-panel incoming wire.
      panelSupplyDevices.forEach((device) => {
        children.push({
          id: `subpanelSupplyTrunkDevice-${device.id}`,
          type: 'trunkDevice',
          bounds: {
            x: parentMcbElement.position.x,
            y: pinnedDeviceY,
            width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
            height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
          },
          domainId: device.id,
          domainRef: device,
          visual: {
            type: 'symbol',
            symbolId: device.symbol || 'energy_meter',
            label: device.label,
            rotationDeg: device.symbol === 'relay' ? 90 : undefined,
          },
          hitZone: {
            type: 'supplyWire',
            padding: 10,
          },
          children: [],
        })
      })
    }

    // Add parent MCB label. If the panel has a local incoming protection, keep
    // the feeder label near that visible device instead of the hidden mirrored
    // parent MCB anchor.
    if (parentMcbLabelElement) {
      children.push({
        id: 'parent-mcb-label',
        type: 'label',
        bounds: {
          x: parentMcbElement.position.x,
          y: parentMcbAnchorY + SUBPANEL_FEED_CIRCUIT_LABEL_Y,
          width: 100,
          height: 20,
        },
        visual: {
          type: 'label',
          text: parentMcbLabelElement.label || '',
          fontSize: 12,
          align: 'center',
        },
        children: [],
      })
    }
  }

  // For sub-panels: add parent panel tag label (e.g. "← Main Panel")
  const parentTagElement = panelLayout.elements.find((e) => e.id?.startsWith('parent-tag-'))
  if (parentTagElement) {
    const parentMcbNode = children.find((c) => c.id === 'parent-mcb')
    const parentMcbAnchorY = parentMcbNode?.bounds.y
    const localFeederDeviceNode = children.find((c) =>
      c.id?.startsWith('subpanelSupplyTrunkDevice-')
    )
    const parentTagY =
      localFeederDeviceNode?.bounds.y != null
        ? parentMcbAnchorY != null
          ? parentMcbAnchorY + SUBPANEL_FEED_CIRCUIT_LABEL_Y
          : localFeederDeviceNode.bounds.y + SUBPANEL_FEED_PARENT_TAG_Y + 20
        : parentMcbAnchorY != null
          ? parentMcbAnchorY + SUBPANEL_FEED_CIRCUIT_LABEL_Y
          : parentTagElement.position.y
    const parentMcbX = parentMcbElement?.position.x ?? parentTagElement.position.x
    children.push({
      id: parentTagElement.id,
      type: 'label',
      bounds: {
        x: parentMcbX,
        y: parentTagY,
        width: 150,
        height: 20,
      },
      visual: {
        type: 'label',
        text: parentTagElement.label || '',
        fontSize: 10,
        align: 'center',
      },
      children: [],
    })
  }

  // Build main bus node with all its children (RCDs, MCBs, etc.)
  if (mainBusElement) {
    const mainBusNode = buildMainBusNode(
      panelLayout,
      mainBusElement,
      groundElement,
      buildRcdNode,
      buildMcbNode
    )
    children.push(mainBusNode)
  }

  const outputLabel = panelLayout.elements.find((element) => element.id === 'feed-output-label')
  if (panelLayout.feedOutput) {
    children.push({
      id: `feed-output-wire-${panelLayout.panel.id}`,
      type: 'wire',
      bounds: {
        x: panelLayout.feedOutput.x - 4,
        y: panelLayout.feedOutput.endY,
        width: 8,
        height: panelLayout.feedOutput.busY - panelLayout.feedOutput.endY,
      },
      hitZone: { type: null, padding: 0 },
      children: [],
    })
  }
  if (outputLabel) {
    children.push({
      id: outputLabel.id,
      type: 'label',
      bounds: {
        x: outputLabel.position.x,
        y: outputLabel.position.y,
        width: 140,
        height: 20,
      },
      visual: {
        type: 'label',
        text: outputLabel.label ?? '',
        translationKey: outputLabel.translationKey,
        align: 'center',
      },
      children: [],
    })
  }

  // Sub-panel incoming feeder wire hit zone (parent MCB -> child panel main bus).
  // This enables drop/preview for protections and trunk devices on that local wire.
  if (parentMcbElement && mainBusElement) {
    const pad = 10
    const parentMcbNode = children.find((c) => c.id === 'parent-mcb')
    const incomingWireEndY = parentMcbNode?.bounds.y ?? parentMcbElement.position.y
    const wireTop = Math.min(mainBusElement.position.y, incomingWireEndY)
    const wireHeight = Math.abs(incomingWireEndY - mainBusElement.position.y)
    children.unshift({
      id: `subpanel-supply-wire-${panelLayout.panel.id}`,
      type: 'wire',
      bounds: {
        x: parentMcbElement.position.x - pad,
        y: wireTop,
        width: pad * 2,
        height: wireHeight,
      },
      hitZone: {
        type: 'supplyWire',
        padding: 0,
      },
      children: [],
    })
  }

  // Each bus section has one panel-side device chain. A section can appear in
  // several runs; those runs repeat views of the same persisted devices.
  if (
    (panelLayout.supplyEndpointKind === 'continuation' ||
      (panelLayout.supplyEndpointKind === 'mains' &&
        panelLayout.frameRole === 'panel' &&
        panelLayout.panel.isMain)) &&
    hasExplicitPanelBusSections(panelLayout.panel)
  ) {
    const bus = children.find((node) => node.type === 'busBar')
    const allRuns =
      bus?.children
        .filter(
          (node) =>
            node.type === 'wire' &&
            node.hitZone?.busSectionId != null &&
            node.id.startsWith('main-bus-segment-')
        )
        .sort((a, b) => a.bounds.x - b.bounds.x)
        .reduce<Array<{ start: number; end: number; sectionId: string }>>((result, node) => {
          const end = node.bounds.x + node.bounds.width
          const previous = result.at(-1)
          const sectionId = node.hitZone!.busSectionId!
          if (
            previous &&
            previous.sectionId === sectionId &&
            Math.abs(previous.end - node.bounds.x) < 0.01
          )
            previous.end = end
          else result.push({ start: node.bounds.x, end, sectionId })
          return result
        }, []) ?? []
    const stacks = new Map(
      (panelLayout.panelLocalFeedStubStacks ?? []).map((stack) => [stack.busSectionId, stack])
    )
    const runs = allRuns.filter((run) => stacks.has(run.sectionId))
    if (runs.length > 0 && bus) {
      const originalIds = new Set(
        runs.flatMap((run) =>
          stacks.get(run.sectionId)!.devices.map((device) => `supplyTrunkDevice-${device.id}`)
        )
      )
      const originals = new Map(
        children.filter((node) => originalIds.has(node.id)).map((node) => [node.id, node])
      )
      const busY = bus.bounds.y + bus.bounds.height / 2
      const stackLayouts = runs.map((run, runIndex) => {
        const stack = stacks.get(run.sectionId)!
        const x = getLeftBiasedBusFeedStubX(run.start, run.end)
        // A section repeated across runs hosts its feeders on its first stub only.
        const hostsFeeders =
          (stack.feeders?.length ?? 0) > 0 &&
          runs.findIndex((candidate) => candidate.sectionId === run.sectionId) === runIndex
        const layout = layoutFeedStubStack(
          [...stack.devices].reverse(),
          x,
          busY,
          hostsFeeders ? getFeedStubFeederLegHeight(stack.feeders!) : undefined
        )
        return { x, stack, ...layout }
      })
      // Every supply marker of a panel ends at one height.
      const alignedEndY = Math.max(...stackLayouts.map((layout) => layout.endY))
      for (const layout of stackLayouts) layout.endY = alignedEndY
      for (const [runIndex, run] of runs.entries()) {
        const { x, endY, tapY, stack } = stackLayouts[runIndex]!
        if (stack.sourcePanelId) {
          children.push({
            id: `feed-stub-source-label-${panelLayout.panel.id}-${run.sectionId}-${runIndex}`,
            type: 'label',
            bounds: { x, y: endY + 6, width: 150, height: 20 },
            visual: {
              type: 'label',
              text: `← ${stack.sourcePanelName ?? ''}`,
              fontSize: 10,
              align: 'center',
            },
            children: [],
          })
        }
        if (tapY == null) continue
        // Feeders stick out to the left, away from the other stubs, and rise
        // to the fed panel's symbol beside the main bus.
        for (const [feederIndex, feeder] of (stack.feeders ?? []).entries()) {
          const branchX = x - FEED_STUB_FEEDER_GEOMETRY.columnSpacing * (feederIndex + 1)
          // Supply-side device sits nearest the bar; the fed panel tops the leg.
          let y = tapY - FEED_STUB_FEEDER_GEOMETRY.protectionRise
          for (const device of feeder.devices) {
            children.push({
              id: `supplyTrunkDevice-${device.id}--feed-stub-feeder-${panelLayout.panel.id}`,
              type: 'trunkDevice',
              bounds: {
                x: branchX,
                y,
                width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
                height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
              },
              domainId: device.id,
              domainRef: device,
              visual: { type: 'symbol', symbolId: device.symbol, label: device.label },
              // The device belongs to the fed panel's stub; edit its chain there.
              hitZone: { type: null, padding: 0 },
              children: [],
            })
            y -= FEED_STUB_FEEDER_GEOMETRY.deviceSpacing
          }
          children.push({
            id: `feed-stub-feeder-panel-${feeder.panelId}-${feeder.busSectionId}`,
            type: 'endpoint',
            bounds: {
              x: branchX,
              y: busY,
              width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
              height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
            },
            domainId: feeder.panelId,
            feedStubTap: { x, y: tapY, busSectionId: run.sectionId },
            visual: { type: 'symbol', symbolId: 'panel_distribution', label: feeder.panelName },
            hitZone: { type: null, padding: 5 },
            children: [],
          })
        }
      }
      for (const runIndex of runs.keys()) {
        const { x, centers, stack } = stackLayouts[runIndex]!
        for (const [deviceIndex, device] of [...stack.devices].reverse().entries()) {
          if (
            device.type !== 'protection' &&
            runs.findIndex((run) => run.sectionId === stack.busSectionId) !== runIndex
          )
            continue
          const original = originals.get(`supplyTrunkDevice-${device.id}`)
          const source: LayoutNode = original ?? {
            id: `supplyTrunkDevice-${device.id}`,
            type: 'trunkDevice',
            bounds: {
              x,
              y: centers[deviceIndex]!,
              width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
              height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
            },
            domainId: device.id,
            domainRef: device,
            visual: { type: 'symbol', symbolId: device.symbol, label: device.label },
            hitZone: {
              type: 'supplyWire',
              padding: 10,
              supplyFeedScope: 'root',
              supplyPanelId: panelLayout.panel.id,
              supplyInsertIndex: stack.insertBase + stack.devices.length - 1 - deviceIndex,
            },
            children: [],
          }
          children.push({
            ...source,
            id: `${source.id}--feed-stub-${runIndex}`,
            bounds: { ...source.bounds, x, y: centers[deviceIndex]! },
            hitZone: source.hitZone
              ? { ...source.hitZone, busSectionId: stack.busSectionId }
              : { type: null, padding: 0, busSectionId: stack.busSectionId },
            visual:
              source.visual?.type === 'symbol'
                ? { ...source.visual, rotationDeg: undefined }
                : source.visual,
          })
        }
      }
      for (let index = children.length - 1; index >= 0; index--) {
        if (originalIds.has(children[index]!.id)) children.splice(index, 1)
      }
      // The old horizontal continuation has no painted counterpart now. Keep
      // only the upright, panel-local insertion zones beside each instance.
      bus.children = bus.children.filter((node) => !node.id.startsWith('supply-wire-'))
      for (const runIndex of runs.keys()) {
        const { x, centers: deviceCenters, endY, stack } = stackLayouts[runIndex]!
        const centers = [busY, ...deviceCenters, endY]
        for (let gapIndex = 0; gapIndex < centers.length - 1; gapIndex++) {
          const fromY = centers[gapIndex]! + (gapIndex === 0 ? 9 : 13)
          const toY = centers[gapIndex + 1]! - (gapIndex === centers.length - 2 ? 0 : 13)
          if (toY <= fromY) continue
          bus.children.push({
            id: `supply-wire-feed-stub-${panelLayout.panel.id}-${runIndex}-${gapIndex}`,
            type: 'wire',
            bounds: { x: x - 10, y: fromY, width: 20, height: toY - fromY },
            hitZone: {
              type: 'supplyWire',
              padding: 0,
              supplyFeedScope: 'root',
              supplyPanelInput: true,
              supplyPanelId: panelLayout.panel.id,
              busSectionId: stack.busSectionId,
              supplyInsertIndex: stack.insertBase + stack.devices.length - gapIndex,
            },
            children: [],
          })
        }
      }
    }
  }

  const markPanelInput = (nodes: LayoutNode[]) => {
    for (const node of nodes) {
      if (node.hitZone?.type === 'supplyWire') {
        node.hitZone.supplyPanelInput =
          node.hitZone.supplyPanelInput || panelLayout.supplyEndpointKind === 'continuation'
      }
      markPanelInput(node.children)
    }
  }
  markPanelInput(children)

  return {
    id: `panel-${getPanelDiagramId(panelLayout)}`,
    type: 'panel',
    bounds: {
      x: panelLayout.frame.x,
      y: panelLayout.frame.y,
      width: panelLayout.frame.width,
      height: panelLayout.frame.height,
    },
    domainId: panelLayout.panel.id,
    diagramId: getPanelDiagramId(panelLayout),
    domainRef: panelLayout.panel,
    children,
  }
}

function buildRcdNode(
  panelLayout: BottomUpPanelLayout,
  rcdElement: BottomUpLayoutElement,
  circuits: BottomUpCircuitLayout[]
): LayoutNode {
  const children: LayoutNode[] = []
  const protection = panelLayout.panel.protections.find((p) => p.id === rcdElement.protectionId)

  // Find trunk for this RCD
  const trunk = panelLayout.trunks.find((t) => t.protectionId === rcdElement.protectionId)

  if (trunk) {
    // Build trunk/secondaryBus node
    const trunkElement = panelLayout.elements.find(
      (e) => e.type === 'trunk' && e.trunkId === trunk.id
    )

    if (trunkElement) {
      const trunkNode: LayoutNode = {
        id: `trunk-${trunk.id}`,
        type: 'secondaryBus',
        bounds: {
          x: trunkElement.position.x,
          y: trunkElement.position.y,
          width: trunkElement.width || 0,
          height: trunkElement.height || LAYOUT_CONSTANTS.BUS_THICKNESS,
        },
        visual: {
          type: 'busBar',
          thickness: LAYOUT_CONSTANTS.BUS_THICKNESS,
        },
        hitZone: {
          type: 'rcd',
          padding: 0,
        },
        domainId: protection?.id,
        domainRef: protection,
        children: circuits
          .map((cl) => buildMcbNode(panelLayout, cl))
          .filter((n): n is LayoutNode => n !== null),
      }
      children.push(trunkNode)
    }
  }

  return {
    id: rcdElement.id,
    type: 'rcd',
    bounds: {
      x: rcdElement.position.x,
      y: rcdElement.position.y,
      width: LAYOUT_CONSTANTS.RCD_WIDTH,
      height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
    },
    domainId: rcdElement.protectionId,
    domainRef: protection,
    visual: {
      type: 'symbol',
      symbolId: protection?.type === 'RCBO' ? 'rcbo' : 'rcd',
      label: protection?.label,
    },
    hitZone: {
      type: 'rcd',
      padding: 5,
    },
    children,
  }
}

function buildMcbNode(
  panelLayout: BottomUpPanelLayout,
  circuitLayout: BottomUpCircuitLayout
): LayoutNode | null {
  if (!circuitLayout.protection) {
    return null
  }
  const circuitProtection = circuitLayout.protection

  const subPanelSymbolElement = panelLayout.elements.find(
    (e) =>
      e.type === 'endpoint' &&
      e.id?.startsWith('subpanel-symbol-') &&
      e.circuitId === circuitLayout.circuit.id
  )

  const protectionElement =
    panelLayout.elements.find(
      (e) =>
        e.type === 'protection' &&
        e.protectionId === circuitProtection.id &&
        e.circuitId === circuitLayout.circuit.id
    ) ??
    panelLayout.elements.find(
      (e) =>
        e.type === 'protection' &&
        e.protectionId === circuitProtection.id &&
        e.id === `protection-${circuitProtection.id}-nest-${circuitLayout.circuit.id}`
    )

  if (!protectionElement) {
    if (subPanelSymbolElement) {
      const protectionId = subPanelSymbolElement.id.replace('subpanel-symbol-', '')
      const linkedProtection = panelLayout.panel.protections.find((p) => p.id === protectionId)
      const link = linkedProtection
        ? resolvePanelSupplyLinkForProtectionInPanels(
            [panelLayout.panel],
            panelLayout.panel,
            linkedProtection
          )
        : null
      const subPanel = link?.targetPanel
      const panelEndpoint = subPanelSymbolElement.endpointId
        ? circuitLayout.circuit.endpoints.find(
            (endpoint) => endpoint.id === subPanelSymbolElement.endpointId
          )
        : undefined

      return {
        id: subPanelSymbolElement.id,
        type: 'endpoint',
        bounds: {
          x: subPanelSymbolElement.position.x,
          y: subPanelSymbolElement.position.y,
          width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
          height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
        },
        domainId: panelEndpoint?.id ?? subPanel?.id,
        domainRef: panelEndpoint,
        visual: {
          type: 'symbol',
          symbolId: 'panel_distribution',
          label: subPanel?.name ?? panelEndpoint?.label ?? '',
        },
        hitZone: {
          type: null,
          padding: 5,
        },
        children: [],
      }
    }
    return null
  }

  const children: LayoutNode[] = []
  const isHorizontalConverterBackup =
    circuitLayout.circuit.supplySource?.kind === 'converter-backup'
  const trunkDeviceElements = panelLayout.elements.filter(
    (e) => e.type === 'trunkDevice' && e.circuitId === circuitLayout.circuit.id
  )

  // Circuit trunk wire (vertical from MCB up to first branch/device top) — drop on wire = circuit target.
  // Keep this in sync with deriveWires/top-of-trunk behavior so hitboxes match rendered wire length.
  const circuitBranchesForWire = panelLayout.branches.filter(
    (b) => b.circuitId === circuitLayout.circuit.id && !b.forkFrom && !b.forkUnresolved
  )
  const baseWidth = Math.max(LAYOUT_CONSTANTS.PROTECTION_WIDTH, LAYOUT_CONSTANTS.SYMBOL_SIZE)
  const protectionAnchorX = circuitLayout.x + circuitLayout.leftReserve + baseWidth / 2
  const wireX = circuitBranchesForWire[0]?.trunkX ?? protectionAnchorX
  // Use actual MCB element position (not circuitLayout.protectionY which is wrong for nested circuits)
  const mcbActualY = protectionElement.position.y
  const topBranchY =
    circuitBranchesForWire.length > 0
      ? Math.min(...circuitBranchesForWire.map((b) => b.branchY))
      : mcbActualY - LAYOUT_CONSTANTS.BRANCH_START_OFFSET
  const sortedTrunkDeviceElements = [...trunkDeviceElements].sort(
    (a, b) => b.position.y - a.position.y
  ) // bottom -> top
  const topTrunkDeviceY =
    sortedTrunkDeviceElements.length > 0
      ? (sortedTrunkDeviceElements[sortedTrunkDeviceElements.length - 1]?.position.y ?? null)
      : null
  const topTrunkDeviceElement = sortedTrunkDeviceElements.at(-1)
  const topTrunkDevice = topTrunkDeviceElement?.trunkDeviceId
    ? circuitLayout.circuit.trunkDevices?.find(
        (device) => device.id === topTrunkDeviceElement.trunkDeviceId
      )
    : undefined
  const topmostTerminalDcBus = topTrunkDevice?.type === 'dc_bus'
  const topCandidates = [topBranchY, topTrunkDeviceY].filter((y): y is number => y !== null)
  const topmostContentY =
    topCandidates.length > 0
      ? Math.min(...topCandidates)
      : mcbActualY - LAYOUT_CONSTANTS.BRANCH_START_OFFSET
  let topWireY =
    topTrunkDeviceY !== null && topTrunkDeviceY === topmostContentY
      ? topmostTerminalDcBus
        ? topmostContentY
        : topmostContentY - LAYOUT_CONSTANTS.BRANCH_START_OFFSET
      : topmostContentY
  // Only when parent has both endpoints and subcircuits: extend wire to secondary bus above endpoints
  const hasEndpointBranches = circuitBranchesForWire.some((b) => b.endpoints.length > 0)
  if (
    hasEndpointBranches &&
    circuitLayout.secondaryBusY != null &&
    (circuitLayout.circuit.subCircuitIds?.length ?? 0) > 0
  ) {
    topWireY = Math.min(topWireY, circuitLayout.secondaryBusY)
  }
  const wirePad = 10
  // Build one hit zone per visible trunk segment so drop targeting aligns with rendered wire pieces.
  const trunkWaypointsY = [
    mcbActualY,
    ...sortedTrunkDeviceElements.map((td) => td.position.y),
    topWireY,
  ]
  if (isHorizontalConverterBackup) {
    if (subPanelSymbolElement) {
      const panelX = subPanelSymbolElement.position.x
      const left = Math.min(panelX, protectionElement.position.x)
      const right = Math.max(panelX, protectionElement.position.x)
      children.push({
        id: `circuit-trunk-${circuitLayout.circuit.id}-horizontal`,
        type: 'wire',
        bounds: {
          x: left,
          y: protectionElement.position.y - wirePad,
          width: right - left,
          height: wirePad * 2,
        },
        hitZone: {
          type: 'circuit',
          padding: 0,
        },
        children: [],
      })
    }
  } else {
    for (let i = 0; i < trunkWaypointsY.length - 1; i++) {
      const startY = trunkWaypointsY[i]
      const endY = trunkWaypointsY[i + 1]
      if (startY == null || endY == null) continue
      const segmentTopY = Math.min(startY, endY)
      const segmentHeight = Math.abs(startY - endY)
      if (segmentHeight <= 0) continue
      const fromDevice = sortedTrunkDeviceElements[i - 1]?.trunkDeviceId
        ? circuitLayout.circuit.trunkDevices?.find(
            (device) => device.id === sortedTrunkDeviceElements[i - 1]!.trunkDeviceId
          )
        : undefined
      const endsAtDedicatedConverterOutput =
        i === trunkWaypointsY.length - 2 &&
        supportsCircuitConverterDcConnections(fromDevice) &&
        getCircuitConverterDcConnectionCount(fromDevice) > 1
      if (endsAtDedicatedConverterOutput) continue
      children.push({
        id: `circuit-trunk-${circuitLayout.circuit.id}-segment-${i}`,
        type: 'wire',
        bounds: {
          x: wireX - wirePad,
          y: segmentTopY,
          width: wirePad * 2,
          height: segmentHeight,
        },
        hitZone: {
          type: 'circuit',
          padding: 0,
          wireDomain: getCircuitTrunkSegmentDomain(circuitLayout.circuit, i),
        },
        children: [],
      })
    }

    // Single nest slot at the top of the trunk (nested MCB / secondary-bus insertion).
    // Trunk segment hit zones remain for trunk devices; this zone is prioritized for protection drops.
    if (!topmostTerminalDcBus) {
      const nestZoneHeight = 40
      children.push({
        id: `circuit-nest-${circuitLayout.circuit.id}`,
        type: 'wire',
        bounds: {
          x: wireX - wirePad,
          y: topWireY - nestZoneHeight / 2,
          width: wirePad * 2,
          height: nestZoneHeight,
        },
        hitZone: {
          type: 'circuit',
          padding: 10,
        },
        children: [],
      })
    }
  }

  // Add circuit label (exclude circuit-notes, they're handled separately)
  const labelElement = panelLayout.elements.find(
    (e) =>
      e.type === 'label' &&
      e.circuitId === circuitLayout.circuit.id &&
      !e.branchId &&
      !e.id?.startsWith('circuit-notes-')
  )
  const circuitLetterVisibleOnOneWire = circuitLayout.circuit.eendraadLetterVisible !== false
  if (labelElement && circuitLetterVisibleOnOneWire) {
    const isProtectionLabel = !!circuitLayout.protection
    const labelWidth = isProtectionLabel
      ? Math.max(
          PROTECTION_LABEL_DEFAULT_BOX_WIDTH,
          estimateProtectionNameLabelWidth(labelElement.label)
        )
      : 100
    children.push({
      id: labelElement.id,
      type: 'label',
      bounds: {
        x: labelElement.position.x,
        y: labelElement.position.y,
        width: labelWidth,
        height: 20,
      },
      visual: {
        type: 'label',
        text: labelElement.label || circuitLayout.circuit.code,
        fontSize: 12,
        align: isHorizontalConverterBackup ? 'center' : isProtectionLabel ? 'right' : 'center',
      },
      domainRef: circuitLayout.circuit,
      circuitIdForWires: circuitLayout.circuit.id,
      children: [],
    })
  }

  // Add circuit notes (if any) — use dedicated panelLayout.circuitNotes (single source of truth).
  const circuitNotes = panelLayout.circuitNotes?.find(
    (n) => n.circuitId === circuitLayout.circuit.id
  )
  if (circuitNotes && (circuitNotes.label ?? '').trim() && circuitNotes.notesVisible !== false) {
    const orientation = circuitNotes.notesOrientation ?? 'horizontal'
    const isVertical = orientation === 'vertical'
    const notesVisible = true

    children.push({
      id: `circuit-notes-${circuitLayout.circuit.id}`,
      type: 'label',
      bounds: {
        x: circuitNotes.x,
        y: circuitNotes.y,
        width: isVertical ? 80 : 200,
        height: isVertical ? 200 : 20,
      },
      visual: {
        type: 'label',
        text: circuitNotes.label || '',
        fontSize: 10,
        variant: 'circuit-notes',
        notesOrientation: orientation,
        notesVisible,
      },
      children: [],
    })
  }

  // Check if this circuit connects to a sub-panel (panel symbol goes directly on MCB, not on a branch)
  if (subPanelSymbolElement) {
    // Sub-panel symbol: add directly as child of MCB (no branch needed)
    const protectionId = subPanelSymbolElement.id.replace('subpanel-symbol-', '')
    const linkedProtection = panelLayout.panel.protections.find((p) => p.id === protectionId)
    const link = linkedProtection
      ? resolvePanelSupplyLinkForProtectionInPanels(
          [panelLayout.panel],
          panelLayout.panel,
          linkedProtection
        )
      : null
    const subPanel = link?.targetPanel

    children.push({
      id: subPanelSymbolElement.id,
      type: 'endpoint',
      bounds: {
        x: subPanelSymbolElement.position.x,
        y: subPanelSymbolElement.position.y,
        width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
        height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
      },
      domainId: subPanelSymbolElement.endpointId ?? subPanel?.id,
      domainRef: subPanelSymbolElement.endpointId
        ? circuitLayout.circuit.endpoints.find(
            (endpoint) => endpoint.id === subPanelSymbolElement.endpointId
          )
        : undefined,
      visual: {
        type: 'symbol',
        symbolId: 'panel_distribution',
        label: subPanel?.name ?? '',
      },
      hitZone: {
        type: null,
        padding: 5,
      },
      children: [],
    })
  }

  // Add branches for this circuit (skip branches that only exist for sub-panel wiring)
  const circuitBranches = panelLayout.branches.filter(
    (b) => b.circuitId === circuitLayout.circuit.id
  )
  const converterPrimaryEndpointIds = getCircuitConverterPrimaryEndpointIds(circuitLayout.circuit)
  const branchMetadataTargets = circuitBranches.flatMap((branch) =>
    branch.endpoints.flatMap((endpoint) => {
      const element = panelLayout.elements.find(
        (candidate) => candidate.type === 'endpoint' && candidate.endpointId === endpoint.id
      )
      return element ? [{ endpoint, position: element.position }] : []
    })
  )
  const branchMetadataSegments = circuitBranches.map((branch) => ({
    startPoint: { x: branch.trunkX, y: branch.branchY },
    endPoint: { x: branch.branchX + branch.branchWidth, y: branch.branchY },
  }))
  const branchMetadataTrunkX = circuitBranches[0]?.trunkX
  const branchMetadataTrunkYs = circuitBranches.flatMap((branch) => [branch.trunkY, branch.branchY])
  if (branchMetadataTrunkX != null && branchMetadataTrunkYs.length > 1) {
    branchMetadataSegments.push({
      startPoint: {
        x: branchMetadataTrunkX,
        y: Math.min(...branchMetadataTrunkYs),
      },
      endPoint: {
        x: branchMetadataTrunkX,
        y: Math.max(...branchMetadataTrunkYs),
      },
    })
  }
  const branchMetadataCallouts = getBranchConverterMetadataCallouts({
    targets: branchMetadataTargets,
    symbolSize: LAYOUT_CONSTANTS.SYMBOL_SIZE,
    segments: branchMetadataSegments,
  })
  for (const branch of circuitBranches) {
    // Skip empty branches for sub-panel circuits (the vertical wire is handled via the MCB → panel symbol)
    if (subPanelSymbolElement && branch.endpoints.length === 0) {
      continue
    }
    if (
      branch.endpoints.some(
        (endpoint) =>
          isCircuitConverterDcChild(endpoint) || converterPrimaryEndpointIds.has(endpoint.id)
      )
    ) {
      continue
    }
    const branchNode = buildBranchNode(panelLayout, branch, branchMetadataCallouts)
    if (branchNode) {
      children.push(branchNode)
    }
  }

  // Add trunk device nodes (energy meters etc. on the vertical wire)
  for (const tdElement of trunkDeviceElements) {
    const trunkDevice = circuitLayout.circuit.trunkDevices?.find(
      (d) => d.id === tdElement.trunkDeviceId
    )
    if (trunkDevice) {
      const scalableConverter = supportsCircuitConverterDcConnections(trunkDevice)
      const converterGeometry = scalableConverter
        ? getCircuitConverterBodyGeometry(trunkDevice, tdElement.position)
        : undefined
      const nodeCenter = converterGeometry?.center ?? tdElement.position
      const converterMetadataCallouts = converterGeometry
        ? getCircuitConverterMetadataCallouts({
            circuit: circuitLayout.circuit,
            device: trunkDevice,
            anchor: tdElement.position,
            symbolSize: LAYOUT_CONSTANTS.SYMBOL_SIZE,
            endpointSpacing: LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING,
            applianceAfterSocketGap: LAYOUT_CONSTANTS.APPLIANCE_AFTER_SOCKET_GAP,
          })
        : new Map<string, CircuitConverterMetadataCallout>()
      const converterChildren = converterGeometry
        ? buildCircuitConverterDcConnectionNodes(
            buildMcbNode,
            panelLayout,
            circuitLayout.circuit,
            trunkDevice,
            tdElement.position,
            converterMetadataCallouts
          )
        : []
      const converterCallout = converterMetadataCallouts.get(trunkDevice.id)
      children.push({
        id: tdElement.id,
        type: 'trunkDevice',
        bounds: {
          x: nodeCenter.x,
          y: nodeCenter.y,
          width: converterGeometry
            ? converterGeometry.width +
              (LAYOUT_CONSTANTS.SYMBOL_SIZE - CIRCUIT_CONVERTER_BLOCK_SIZE)
            : trunkDevice.type === 'dc_bus'
              ? LAYOUT_CONSTANTS.DC_BUS_MIN_WIDTH
              : LAYOUT_CONSTANTS.SYMBOL_SIZE,
          height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
        },
        connectionAnchor: converterGeometry ? { ...tdElement.position } : undefined,
        converterGrowthDirection: converterGeometry ? 'right' : undefined,
        domainId: trunkDevice.id,
        domainRef: trunkDevice,
        visual: {
          type: 'symbol',
          symbolId: trunkDevice.symbol || 'energy_meter',
          label: trunkDevice.label,
          // Branch switches sit on horizontal wires; a series trunk switch turns a
          // quarter counter-clockwise so its lever leans along the rising trunk.
          rotationDeg:
            trunkDevice.symbol === 'relay' ? 90 : trunkDevice.type === 'switch' ? -90 : undefined,
          metadataCallout: converterCallout
            ? {
                x: converterCallout.x,
                y: converterCallout.y,
                width: converterCallout.width,
                height: converterCallout.height,
                leaderPoints: converterCallout.leaderPoints,
                leaderSegments: converterCallout.leaderSegments,
              }
            : undefined,
        },
        hitZone: {
          type: 'circuit', // Clicking a trunk device targets the circuit
          // Larger padding so trunk devices (energy conversion, meters) are easy to click.
          padding: 10,
        },
        children: converterChildren,
      })
    }
  }

  // Only when circuit has both endpoint branches and subcircuits: add node at secondary bus Y so
  // deriveWires extends the vertical wire above endpoints (avoids overlap; no change when subcircuits only).
  const hasEndpointBranchesForWireEnd = circuitBranchesForWire.some((b) => b.endpoints.length > 0)
  if (
    hasEndpointBranchesForWireEnd &&
    circuitLayout.secondaryBusY != null &&
    (circuitLayout.circuit.subCircuitIds?.length ?? 0) > 0
  ) {
    children.push({
      id: `parent-wire-end-${circuitLayout.circuit.id}`,
      type: 'secondaryBus',
      bounds: {
        x: wireX,
        y: circuitLayout.secondaryBusY,
        width: 0,
        height: 0,
      },
      hitZone: { type: null, padding: 0 },
      children: [],
    })
  }

  // Add nested circuits (sub-circuits) — look up by ID, not duplicated objects.
  // A DC bus remains visible and droppable before it has its first outgoing branch.
  const circuitDcBusDevice = (circuitLayout.circuit.trunkDevices ?? []).find(
    (device) => device.type === 'dc_bus' && !device.converterDcConnection
  )
  if ((circuitLayout.circuit.subCircuitIds?.length ?? 0) > 0 || circuitDcBusDevice) {
    const converterLinkedDcBusIds = new Set(
      (circuitLayout.circuit.trunkDevices ?? [])
        .filter((device) => device.type === 'dc_bus' && !!device.converterDcConnection)
        .map((device) => device.id)
    )
    // When there are multiple nested circuits, create a secondary bus node for them.
    // Use the subCircuitIds list itself to find their layouts, so this works even
    // when parentCircuit metadata is missing or not set.
    const nestedLayouts = (circuitLayout.circuit.subCircuitIds ?? [])
      .map((nestedId) => panelLayout.circuits.find((cl) => cl.circuit.id === nestedId))
      .filter((cl): cl is (typeof panelLayout.circuits)[number] => cl !== undefined)
      .filter(
        (cl) =>
          !cl.circuit.dcBusSource || !converterLinkedDcBusIds.has(cl.circuit.dcBusSource.busId)
      )

    const dcBusDevice = circuitDcBusDevice
    if (nestedLayouts.length > 1 || dcBusDevice) {
      const baseWidth = Math.max(LAYOUT_CONSTANTS.PROTECTION_WIDTH, LAYOUT_CONSTANTS.SYMBOL_SIZE)
      const nestedCircuitXs = nestedLayouts.map((cl) => {
        const protEl =
          panelLayout.elements.find(
            (e) =>
              e.type === 'protection' &&
              e.protectionId === cl.protection?.id &&
              e.circuitId === cl.circuit.id
          ) ??
          (cl.protection
            ? panelLayout.elements.find(
                (e) =>
                  e.type === 'protection' &&
                  e.protectionId === cl.protection!.id &&
                  e.id === `protection-${cl.protection!.id}-nest-${cl.circuit.id}`
              )
            : undefined)
        return protEl ? protEl.position.x : cl.x + cl.leftReserve + baseWidth / 2
      })
      const dcBusBranchNodes = dcBusDevice
        ? buildOrdinaryDcBusEndpointBranchNodes(
            buildMcbNode,
            panelLayout,
            circuitLayout.circuit,
            dcBusDevice,
            topWireY,
            wireX
          )
        : []
      const nestedXs = [
        ...nestedCircuitXs,
        ...dcBusBranchNodes.map((node) => node.bounds.x + node.bounds.width / 2),
      ]

      if (nestedXs.length > 0 || dcBusDevice) {
        const secondaryBusAttachmentXs =
          hasPanelAttachmentOnSecondaryBus(circuitLayout.protection, circuitLayout.circuit) &&
          subPanelSymbolElement
            ? [subPanelSymbolElement.position.x, ...nestedXs]
            : nestedXs.length > 0
              ? nestedXs
              : [wireX]
        const leftmostX = Math.min(...secondaryBusAttachmentXs)
        const rightmostX = Math.max(...secondaryBusAttachmentXs)
        const extension = LAYOUT_CONSTANTS.SECONDARY_BUS_EXTENSION
        const busStartX = dcBusDevice
          ? wireX - LAYOUT_CONSTANTS.DC_BUS_LEFT_EXTENSION
          : leftmostX - extension
        const busEndX = dcBusDevice
          ? Math.max(wireX + LAYOUT_CONSTANTS.DC_BUS_MIN_WIDTH, rightmostX + extension)
          : rightmostX + extension

        const busThickness = LAYOUT_CONSTANTS.BUS_THICKNESS
        const busYTop = topWireY - busThickness / 2

        // Build per-segment hit zones for the secondary bus so they align with
        // the segmented bus rendering in deriveWires.
        const busWaypoints: number[] = [
          busStartX,
          ...[...secondaryBusAttachmentXs].sort((a, b) => a - b),
          busEndX,
        ]
        const secondaryBusSegments: LayoutNode[] = []
        for (let i = 0; i < busWaypoints.length - 1; i++) {
          const startX = busWaypoints[i]!
          const endX = busWaypoints[i + 1]!
          if (endX <= startX) continue

          secondaryBusSegments.push({
            id: `secondary-bus-segment-${circuitLayout.circuit.id}-${secondaryBusSegments.length}`,
            type: 'wire',
            bounds: {
              x: startX,
              // Core hitbox exactly matches the visual bus segment thickness.
              y: busYTop,
              width: endX - startX,
              height: busThickness,
            },
            visual: {
              type: 'busBar',
              thickness: LAYOUT_CONSTANTS.BUS_THICKNESS,
            },
            hitZone: {
              type: 'circuit',
              // Per-segment safety margin around the visual core, rendered as
              // the dashed outline in hitbox debug (like other hit zones).
              padding: 20,
              ...(dcBusDevice ? { dcBusId: dcBusDevice.id } : {}),
            },
            children: [],
          })
        }

        const secondaryBusNode: LayoutNode = {
          id: `secondary-bus-${circuitLayout.circuit.id}`,
          type: 'secondaryBus',
          bounds: {
            x: busStartX,
            // Align hitbox so that the bus wire (at topWireY) runs through
            // the vertical CENTER of the rectangle, mirroring the main bus.
            y: topWireY - busThickness / 2,
            width: busEndX - busStartX,
            height: busThickness,
          },
          visual: {
            type: 'busBar',
            thickness: LAYOUT_CONSTANTS.BUS_THICKNESS,
          },
          hitZone: {
            // Parent secondaryBus node is just a container; per-segment wire
            // children carry the actual hit zones so padding is applied per
            // segment instead of one big padded box.
            type: null,
            padding: 0,
            ...(dcBusDevice ? { dcBusId: dcBusDevice.id } : {}),
          },
          // Child wire segments model the individual visual bus sections.
          // Store nested child X positions as metadata for insertion logic.
          children: secondaryBusSegments,
          nestedChildXs: nestedXs,
        }

        children.push(secondaryBusNode)

        if (dcBusDevice) {
          const dcBusNode = children.find(
            (candidate) => candidate.type === 'trunkDevice' && candidate.domainId === dcBusDevice.id
          )
          if (dcBusNode) {
            dcBusNode.bounds.x = (busStartX + busEndX) / 2
            dcBusNode.bounds.y = topWireY
            dcBusNode.bounds.width = busEndX - busStartX
            dcBusNode.connectionAnchor = { x: wireX, y: topWireY }
            dcBusNode.hitZone = {
              type: 'circuit',
              padding: 20,
              dcBusId: dcBusDevice.id,
            }
            dcBusNode.children.push(...dcBusBranchNodes)
          }
        }
      }
    }

    for (const nestedId of circuitLayout.circuit.subCircuitIds ?? []) {
      const nestedLayout = panelLayout.circuits.find((cl) => cl.circuit.id === nestedId)
      if (!nestedLayout) continue
      if (
        nestedLayout.circuit.dcBusSource &&
        converterLinkedDcBusIds.has(nestedLayout.circuit.dcBusSource.busId)
      ) {
        continue
      }

      const mergeNestedFeederOntoParentMcb =
        !!nestedLayout.protection &&
        !!circuitLayout.protection &&
        nestedLayout.protection.id === circuitLayout.protection.id &&
        (circuitLayout.circuit.subCircuitIds?.length ?? 0) === 1 &&
        isPanelOnlySubPanelFeeder(nestedLayout.protection, nestedLayout.circuit)

      if (mergeNestedFeederOntoParentMcb) {
        const nestedMcb = buildMcbNode(panelLayout, nestedLayout)
        if (nestedMcb && nestedMcb.type === 'mcb' && nestedMcb.children.length > 0) {
          for (const c of nestedMcb.children) {
            if (c.type === 'endpoint' && c.visual?.type === 'symbol') {
              children.push(c)
            }
          }
        }
        continue
      }

      const nestedMcb = buildMcbNode(panelLayout, nestedLayout)
      if (nestedMcb) {
        children.push(nestedMcb)
      }
    }
  }

  // Resolve symbol ID from protection type
  const protectionSymbolId = protectionTypeToSymbolId(circuitLayout.protection.type)

  return {
    id: protectionElement.id,
    type: 'mcb',
    bounds: {
      x: protectionElement.position.x,
      y: protectionElement.position.y,
      width: LAYOUT_CONSTANTS.PROTECTION_WIDTH,
      height: LAYOUT_CONSTANTS.SYMBOL_SIZE,
    },
    domainId: circuitLayout.protection.id,
    domainRef: circuitLayout.protection,
    circuitIdForWires: circuitLayout.circuit.id,
    circuitWireLabelSpan: circuitLayout.wireLabelSpan,
    visual: {
      type: 'symbol',
      symbolId: protectionSymbolId,
      label: circuitLayout.protection.label,
      rotationDeg: isHorizontalConverterBackup ? 90 : undefined,
    },
    hitZone: {
      type: 'protection',
      padding: 5,
    },
    children,
  }
}
