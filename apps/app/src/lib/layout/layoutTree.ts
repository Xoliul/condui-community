/**
 * Unified Layout Tree (Scene Graph)
 *
 * This module defines the LayoutNode tree structure that serves as the single
 * source of truth for layout, rendering, hit testing, and wire generation.
 *
 * Phase 0: Adapter from existing BottomUpLayoutResult
 * Phase 2+: Direct generation via NodeLayouter pattern
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
import { getEndpointBranchLabelPrefix } from '@/lib/eendraad/automaticEndpointBranchNaming'
import { resolvePanelSupplyLinkForProtectionInPanels } from '@/lib/eendraad/panelSupplyLink'
import {
  getCrowdedEndpointNoteLabelBounds,
  getEndpointNoteMinimumLeftX,
} from '@/lib/eendraad/endpointNoteLabelCollision'
import { getVisibleEndpointNoteText } from '@/lib/conversionLabels'
import {
  getProtectionOneWireAnchorLineIndex,
  getProtectionOneWireLabelLines,
} from '@/lib/protectionLabels'
import { getDomoticaRowLabelPlacement } from './domoticaRowLabelPlacement'
import { getSymbolLabelVerticalMetrics } from '@/lib/symbolLabelMetrics'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import {
  DOMOTICA_BASE_HEIGHT,
  DOMOTICA_BOX_WIDTH,
  DOMOTICA_BRANCH_LEAD,
  DOMOTICA_CHILD_ON_DROP_ZONE_SIZE,
  DOMOTICA_MAX_ENDPOINT_OUTPUTS,
  DOMOTICA_MIN_ENDPOINT_OUTPUTS,
  DOMOTICA_OUTPUT_SPACING,
} from '@/lib/domoticaLayout'
import {
  getPrimaryPanelBusSectionId,
  getProtectionBusSectionId,
  hasExplicitPanelBusSections,
} from '@/lib/panel/panelBusSections'
import { getLeftBiasedBusFeedStubX, PANEL_BUS_FEED_GAP } from '@/lib/panel/panelBusFeedPreview'
import {
  applyHostedFeederSectionCut,
  FEED_STUB_FEEDER_GEOMETRY,
  getFeedStubFeederLegHeight,
} from './feedStubFeeders'
import { getDirectConverterChangeoverInsertIndex } from '@/lib/supplyAssembly/directConverterBackupUpgrade'
import { getSupplyConverterDcConnectionIndex } from '@/lib/supplyAssembly/converterDcConnections'
import { getSymbolById, resolveSymbolPortsForWire } from '@/lib/symbols'
import { getSecondaryBusSectionBoundaryX } from './mainBusSectionBoundary'
import {
  CIRCUIT_CONVERTER_BLOCK_SIZE,
  CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD,
  CIRCUIT_CONVERTER_TOP_WIRE_INSET,
  getCircuitConverterBodyGeometry,
  getCircuitConverterDcConnectionCount,
  getCircuitConverterPrimaryBranch,
  getCircuitConverterPrimaryEndpointIds,
  getOrdinaryCircuitConverterOutputRowY,
  getSupplyConverterBodyGeometry,
  isCircuitConverterDcChild,
  supportsCircuitConverterDcConnections,
} from './circuitConverterGeometry'
import { getEndpointXOffsets } from './bottomUpBranchWidths'
import { runWithControlLinkNotes } from '@/lib/controlLink/controlLinkNoteContext'
import {
  getCircuitConverterMetadataCallouts,
  getBranchConverterMetadataCallouts,
  type CircuitConverterMetadataCallout,
} from './circuitConverterMetadataCallouts'
import { isVerticalSupplyDevice } from './supplyDeviceOrientation'

function getProtectionBusSectionIdForLayoutNode(panel: Panel, node: LayoutNode): string {
  const protection = node.domainRef as ProtectionDevice | undefined
  return protection
    ? getProtectionBusSectionId(panel, protection)
    : getPrimaryPanelBusSectionId(panel)
}

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
  converterGridPlacement?: 'inline' | 'input-leg'
  /** Geometry selected on the modular changeover grid-input path. */
  changeoverGridPlacement?: 'inline' | 'input-leg'
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
  domainId?: string // panel.id, circuit.id, endpoint.id, protection.id
  /** Unique frame identity when one electrical panel renders in multiple frames. */
  diagramId?: string
  domainRef?: Panel | Circuit | ProtectionDevice | Endpoint | TrunkDevice // Typed domain reference
  /** When set on an `mcb` node, wires for this column use this circuit (multi-circuit protections / merged sub-panel feed). */
  circuitIdForWires?: string
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
import type { BranchLayout } from './wireSegments'
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
import { getDcBusBranchHorizontalLayouts } from './circuitLayoutEnvelope'

/** Minimum vertical segment length on sub-panel incoming feeder (matches virtual MCB anchor math). */
export const MIN_SUBPANEL_INCOMING_SEGMENT_LENGTH = 60
/** Sub-panel incoming feeder: circuit code, then parent panel name (Y grows downward, from virtual MCB anchor). */
export const SUBPANEL_FEED_CIRCUIT_LABEL_Y = 0
export const SUBPANEL_FEED_PARENT_TAG_Y = 28

/**
 * Scene anchors for sub-panel feeder labels — same geometry as `buildPanelNode` parent-MCB branch
 * (export / PDF must not use raw `bottomUpLayout` element Y for these).
 */
export function getSubPanelIncomingFeedLabelAnchors(
  panelLayout: BottomUpPanelLayout
): { centerX: number; circuitAnchorY: number; parentTagAnchorY: number } | null {
  const parentMcbEl = panelLayout.elements.find((e) => e.id === 'parent-mcb')
  if (!parentMcbEl) return null

  const mainBusY = panelLayout.mainBus.y
  const parentMcbBaseY = parentMcbEl.position.y
  const parentMcbAnchorY = Math.max(
    parentMcbBaseY,
    mainBusY + MIN_SUBPANEL_INCOMING_SEGMENT_LENGTH * 2
  )

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

function layoutNodeUsesAnchorX(node: LayoutNode): boolean {
  return (
    (node.visual?.type === 'label' && node.visual.align === 'center') ||
    node.type === 'supply' ||
    node.type === 'ground' ||
    node.type === 'rcd' ||
    node.type === 'mcb' ||
    node.type === 'endpoint' ||
    node.type === 'trunkDevice'
  )
}

/** Mirror one positioned scene node while leaving its text and symbol artwork readable. */
function mirrorLayoutNodeSelfHorizontally(
  node: LayoutNode,
  axisX: number,
  mirrorSymbolRotation = false
): void {
  node.bounds.x = layoutNodeUsesAnchorX(node)
    ? axisX * 2 - node.bounds.x
    : axisX * 2 - node.bounds.x - node.bounds.width
  if (node.connectionAnchor) {
    node.connectionAnchor.x = axisX * 2 - node.connectionAnchor.x
  }
  if (node.hitZone?.dropHintAnchor) {
    node.hitZone.dropHintAnchor.x = axisX * 2 - node.hitZone.dropHintAnchor.x
  }
  if (node.converterGrowthDirection) {
    node.converterGrowthDirection = node.converterGrowthDirection === 'left' ? 'right' : 'left'
  }

  if (node.visual?.type === 'label') {
    if (node.visual.align === 'left') node.visual.align = 'right'
    else if (node.visual.align === 'right') node.visual.align = 'left'
  } else if (node.visual?.type === 'symbol') {
    if (mirrorSymbolRotation && node.visual.rotationDeg != null) {
      node.visual.rotationDeg = -node.visual.rotationDeg
    }
    if (node.visual.mirrorHorizontally != null) {
      node.visual.mirrorHorizontally = !node.visual.mirrorHorizontally
    }
    const oldMinimumLeftX = node.visual.bottomLabelMinimumLeftX
    const oldMaximumRightX = node.visual.bottomLabelMaximumRightX
    node.visual.bottomLabelMinimumLeftX =
      oldMaximumRightX == null ? undefined : axisX * 2 - oldMaximumRightX
    node.visual.bottomLabelMaximumRightX =
      oldMinimumLeftX == null ? undefined : axisX * 2 - oldMinimumLeftX
  }

  if (node.nestedChildXs) {
    node.nestedChildXs = node.nestedChildXs.map((x) => axisX * 2 - x)
  }
}

/** Mirror positioned scene nodes while leaving their text and symbol artwork readable. */
export function mirrorLayoutNodeHorizontally(
  node: LayoutNode,
  axisX: number,
  mirrorSymbolRotation = false
): void {
  mirrorLayoutNodeSelfHorizontally(node, axisX, mirrorSymbolRotation)
  node.children.forEach((child) => mirrorLayoutNodeHorizontally(child, axisX, mirrorSymbolRotation))
}

function isSupplyAssemblyLayoutNode(node: LayoutNode): boolean {
  if (node.id.includes('--feed-stub-') || node.id.startsWith('supply-wire-feed-stub-')) {
    return false
  }
  return (
    node.type === 'supply' ||
    node.type === 'ground' ||
    node.id.startsWith('supplyTrunkDevice-') ||
    node.id.startsWith('groundTrunkDevice-') ||
    node.id.startsWith('supply-wire-') ||
    node.id.startsWith('supply-changeover-') ||
    node.id.startsWith('supply-direct-converter-') ||
    node.id === 'supply-continuation-label' ||
    node.id.startsWith('feed-output-')
  )
}

function isConverterBackupCircuitRoot(node: LayoutNode): boolean {
  if (node.type !== 'mcb' && node.type !== 'rcd') return false
  const protection = node.domainRef as ProtectionDevice | undefined
  return (
    protection?.circuits?.some((circuit) => circuit.supplySource?.kind === 'converter-backup') ===
    true
  )
}

function normalizeSupplyConverterGrowth(node: LayoutNode): void {
  const device = node.domainRef as TrunkDevice | undefined
  if (
    node.connectionAnchor &&
    device &&
    supportsCircuitConverterDcConnections(device) &&
    getCircuitConverterDcConnectionCount(device) > 1 &&
    (device.supplyPath === 'converter-branch' || device.supplyPath === 'backup')
  ) {
    const geometry = getSupplyConverterBodyGeometry(device, node.connectionAnchor)
    node.bounds.x = geometry.center.x
    node.bounds.y = geometry.center.y
    node.converterGrowthDirection = 'left'
  }
  node.children.forEach(normalizeSupplyConverterGrowth)
}

function translateLayoutNodeHorizontally(node: LayoutNode, dx: number): void {
  node.bounds.x += dx
  if (node.connectionAnchor) node.connectionAnchor.x += dx
  if (node.hitZone?.dropHintAnchor) node.hitZone.dropHintAnchor.x += dx
  if (node.nestedChildXs) node.nestedChildXs = node.nestedChildXs.map((x) => x + dx)
  node.children.forEach((child) => translateLayoutNodeHorizontally(child, dx))
}

/** Keep a supply DC bus entirely left of its electrical connection after any frame mirroring. */
function normalizeSupplyDcBusGrowth(node: LayoutNode): void {
  const nodes: LayoutNode[] = []
  const visit = (candidate: LayoutNode) => {
    nodes.push(candidate)
    candidate.children.forEach(visit)
  }
  visit(node)
  const supplyConverterNode = nodes.find((candidate) => {
    const candidateDevice = candidate.domainRef as TrunkDevice | undefined
    return (
      !!candidateDevice &&
      supportsCircuitConverterDcConnections(candidateDevice) &&
      (candidateDevice.supplyPath === 'converter-branch' || candidateDevice.supplyPath === 'backup')
    )
  })
  for (const busNode of nodes) {
    const busDevice = busNode.domainRef as TrunkDevice | undefined
    if (!busNode.connectionAnchor || busDevice?.type !== 'dc_bus' || !busDevice.supplyPath) {
      continue
    }
    const branchXs = nodes
      .filter(
        (candidate) =>
          (candidate.domainRef as TrunkDevice | undefined)?.supplyDcBusId === busDevice.id &&
          !(candidate.domainRef as TrunkDevice | undefined)?.converterDcConnection
      )
      .map((candidate) => candidate.connectionAnchor?.x ?? candidate.bounds.x)
    const isSideConverterOutput = getSupplyConverterDcConnectionIndex(busDevice) === 0
    const converterSidePortX = isSideConverterOutput
      ? supplyConverterNode?.connectionAnchor
        ? getSupplyConverterBodyGeometry(
            supplyConverterNode.domainRef as TrunkDevice,
            supplyConverterNode.connectionAnchor
          ).left
        : supplyConverterNode
          ? supplyConverterNode.bounds.x - supplyConverterNode.bounds.width / 2
          : busNode.connectionAnchor.x
      : busNode.connectionAnchor.x
    const attachmentX = isSideConverterOutput
      ? (() => {
          const inlineLaneNodes = nodes.filter((candidate) => {
            const candidateDevice = candidate.domainRef as TrunkDevice | undefined
            return (
              candidateDevice != null &&
              candidateDevice.id !== busDevice.id &&
              candidateDevice.type !== 'dc_bus' &&
              !candidateDevice.supplyDcBusId &&
              getSupplyConverterDcConnectionIndex(candidateDevice) ===
                getSupplyConverterDcConnectionIndex(busDevice)
            )
          })
          if (inlineLaneNodes.length === 0) {
            return converterSidePortX - LAYOUT_CONSTANTS.SUPPLY_DC_BUS_CONNECTION_LEAD
          }

          // The inline lane is ordered from the converter toward the bus. The
          // bus must terminate on the far side of the last inline symbol, not
          // at the converter port; otherwise the bus-bar artwork is painted
          // underneath the wire and the inline device.
          const inlineAverageX =
            inlineLaneNodes.reduce((sum, candidate) => sum + candidate.bounds.x, 0) /
            inlineLaneNodes.length
          const converterIsRightOfInlineLane = converterSidePortX >= inlineAverageX
          const busSideInlineNode = inlineLaneNodes.reduce(
            (selected, candidate) => {
              if (!selected) return candidate
              return converterIsRightOfInlineLane
                ? candidate.bounds.x < selected.bounds.x
                  ? candidate
                  : selected
                : candidate.bounds.x > selected.bounds.x
                  ? candidate
                  : selected
            },
            undefined as LayoutNode | undefined
          )
          if (!busSideInlineNode) {
            return converterSidePortX - LAYOUT_CONSTANTS.SUPPLY_DC_BUS_CONNECTION_LEAD
          }

          const symbolHalfSize = LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
          return converterIsRightOfInlineLane
            ? busSideInlineNode.bounds.x -
                symbolHalfSize -
                LAYOUT_CONSTANTS.SUPPLY_DC_BUS_CONNECTION_LEAD
            : busSideInlineNode.bounds.x +
                symbolHalfSize +
                LAYOUT_CONSTANTS.SUPPLY_DC_BUS_CONNECTION_LEAD
        })()
      : converterSidePortX
    busNode.connectionAnchor.x = attachmentX
    const busStartX = Math.min(
      attachmentX - LAYOUT_CONSTANTS.DC_BUS_MIN_WIDTH,
      ...branchXs.map((branchX) => branchX - LAYOUT_CONSTANTS.SECONDARY_BUS_EXTENSION)
    )
    const busEndX = attachmentX
    busNode.bounds.x = (busStartX + busEndX) / 2
    busNode.bounds.width = busEndX - busStartX

    const branchGroups = new Map<
      string,
      { x: number; firstSupplyIndex: number; nodes: LayoutNode[] }
    >()
    for (const candidate of nodes) {
      const candidateDevice = candidate.domainRef as TrunkDevice | undefined
      if (candidateDevice?.supplyDcBusId !== busDevice.id || candidateDevice.converterDcConnection)
        continue
      const branchId = candidateDevice.supplyDcBusBranchId ?? candidateDevice.id
      const supplyIndex = candidate.hitZone?.supplyInsertIndex ?? Number.MAX_SAFE_INTEGER
      const existing = branchGroups.get(branchId)
      if (!existing) {
        branchGroups.set(branchId, {
          x: candidate.connectionAnchor?.x ?? candidate.bounds.x,
          firstSupplyIndex: supplyIndex,
          nodes: [candidate],
        })
      } else {
        existing.firstSupplyIndex = Math.min(existing.firstSupplyIndex, supplyIndex)
        existing.nodes.push(candidate)
      }
    }
    const visualGroups = [...branchGroups.entries()]
      .map(([branchId, group]) => ({ branchId, ...group }))
      .sort((a, b) => a.x - b.x)
    const finalSupplyIndex = Math.max(
      (busNode.hitZone?.supplyInsertIndex ?? -1) + 1,
      visualGroups.reduce((max, group) => Math.max(max, group.firstSupplyIndex), -1) + 1
    )
    const waypoints = [busStartX, ...visualGroups.map((group) => group.x), busEndX]
    busNode.children = busNode.children.filter(
      (child) =>
        !child.id.startsWith(`supply-dc-bus-segment-${busDevice.id}-`) &&
        !child.id.startsWith(`supply-dc-bus-branch-slot-${busDevice.id}-`)
    )
    for (let segmentIndex = 0; segmentIndex < waypoints.length - 1; segmentIndex += 1) {
      const startX = waypoints[segmentIndex]!
      const endX = waypoints[segmentIndex + 1]!
      if (endX <= startX) continue
      const insertIndex =
        segmentIndex === 0
          ? finalSupplyIndex
          : (visualGroups[segmentIndex - 1]?.firstSupplyIndex ?? finalSupplyIndex)
      busNode.children.push({
        id: `supply-dc-bus-segment-${busDevice.id}-${segmentIndex}`,
        type: 'wire',
        bounds: {
          x: startX,
          y: busNode.connectionAnchor.y - LAYOUT_CONSTANTS.BUS_THICKNESS / 2,
          width: endX - startX,
          height: LAYOUT_CONSTANTS.BUS_THICKNESS,
        },
        visual: { type: 'busBar', thickness: LAYOUT_CONSTANTS.BUS_THICKNESS },
        hitZone: {
          type: 'supplyConverterDcWire',
          padding: 20,
          supplyFeedScope: busNode.hitZone?.supplyFeedScope,
          supplyInsertIndex: insertIndex,
          supplyPanelId: busNode.hitZone?.supplyPanelId,
          supplyConverterDcBranch: busNode.hitZone?.supplyConverterDcBranch,
          supplyConverterDcConnectionIndex: busNode.hitZone?.supplyConverterDcConnectionIndex,
          supplyDcBusId: busDevice.id,
        },
        children: [],
      })
    }

    const branchSlotPadding = 12
    const symbolHalfSize = LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
    const pushBranchSlot = (
      group: (typeof visualGroups)[number],
      slotIndex: number,
      fromY: number,
      toY: number,
      insertIndex: number
    ) => {
      const top = Math.min(fromY, toY)
      const bottom = Math.max(fromY, toY)
      if (bottom <= top) return
      busNode.children.push({
        id: `supply-dc-bus-branch-slot-${busDevice.id}-${group.branchId}-${slotIndex}`,
        type: 'wire',
        bounds: {
          x: group.x - branchSlotPadding,
          y: top,
          width: branchSlotPadding * 2,
          height: bottom - top,
        },
        hitZone: {
          type: 'supplyConverterDcWire',
          padding: 0,
          supplyFeedScope: busNode.hitZone?.supplyFeedScope,
          supplyInsertIndex: insertIndex,
          supplyPanelId: busNode.hitZone?.supplyPanelId,
          supplyConverterDcBranch: busNode.hitZone?.supplyConverterDcBranch,
          supplyConverterDcConnectionIndex: busNode.hitZone?.supplyConverterDcConnectionIndex,
          supplyDcBusId: busDevice.id,
          supplyDcBusBranchId: group.branchId,
          dropHintAnchor: { x: group.x, y: (top + bottom) / 2 },
        },
        children: [],
      })
    }

    for (const group of visualGroups) {
      const ordered = [...group.nodes].sort((a, b) => b.bounds.y - a.bounds.y)
      const first = ordered[0]
      if (!first) continue
      pushBranchSlot(
        group,
        0,
        busNode.connectionAnchor.y,
        first.bounds.y + symbolHalfSize,
        first.hitZone?.supplyInsertIndex ?? group.firstSupplyIndex
      )
      for (let index = 0; index < ordered.length - 1; index += 1) {
        const lower = ordered[index]!
        const upper = ordered[index + 1]!
        pushBranchSlot(
          group,
          index + 1,
          lower.bounds.y - symbolHalfSize,
          upper.bounds.y + symbolHalfSize,
          upper.hitZone?.supplyInsertIndex ?? group.firstSupplyIndex + index + 1
        )
      }
      const last = ordered.at(-1)!
      const appendIndex =
        (last.hitZone?.supplyInsertIndex ?? group.firstSupplyIndex + ordered.length - 1) + 1
      pushBranchSlot(
        group,
        ordered.length,
        last.bounds.y - symbolHalfSize,
        last.bounds.y - LAYOUT_CONSTANTS.SUPPLY_DC_BUS_BRANCH_DEVICE_SPACING + symbolHalfSize,
        appendIndex
      )
    }

    // The bus node itself spans the complete rail, but it is not an insertion
    // slot. Its precise rail segments and vertical branch slots above are the
    // only valid drop targets; keeping the parent hit zone active makes a
    // padded full-width fallback win over those slots and inserts at the bus's
    // own feed position instead.
    if (busNode.hitZone) {
      busNode.hitZone = { ...busNode.hitZone, type: null }
    }
  }
}

function normalizeNestedSupplyDcConverterGrowth(node: LayoutNode): void {
  const nodes: LayoutNode[] = []
  const visit = (candidate: LayoutNode) => {
    nodes.push(candidate)
    candidate.children.forEach(visit)
  }
  visit(node)

  for (const converterNode of nodes) {
    const converter = converterNode.domainRef as TrunkDevice | undefined
    if (
      !converter?.supplyDcBusId ||
      !supportsCircuitConverterDcConnections(converter) ||
      getCircuitConverterDcConnectionCount(converter) <= 1
    )
      continue

    const anchor = converterNode.connectionAnchor ?? {
      x: converterNode.bounds.x,
      y: converterNode.bounds.y,
    }
    const growthDirection = converterNode.converterGrowthDirection ?? 'right'
    const geometry =
      growthDirection === 'left'
        ? getSupplyConverterBodyGeometry(converter, anchor)
        : getCircuitConverterBodyGeometry(converter, anchor)
    const directionSign = growthDirection === 'left' ? -1 : 1
    const dcPorts =
      growthDirection === 'left'
        ? Array.from({ length: geometry.count }, (_, index) => ({
            index,
            x: anchor.x - index * CIRCUIT_CONVERTER_BLOCK_SIZE,
            y: anchor.y - CIRCUIT_CONVERTER_TOP_WIRE_INSET,
          }))
        : getCircuitConverterBodyGeometry(converter, anchor).dcPorts
    converterNode.bounds.x = geometry.center.x
    converterNode.bounds.y = geometry.center.y
    converterNode.bounds.width =
      geometry.width + (LAYOUT_CONSTANTS.SYMBOL_SIZE - CIRCUIT_CONVERTER_BLOCK_SIZE)
    converterNode.connectionAnchor = { ...anchor }
    converterNode.converterGrowthDirection = growthDirection

    const outputNodes = nodes.filter((candidate) => {
      const device = candidate.domainRef as TrunkDevice | undefined
      return device?.converterDcConnection?.converterId === converter.id
    })
    const outputHitNodes: LayoutNode[] = []
    for (let connectionIndex = 0; connectionIndex < geometry.count; connectionIndex += 1) {
      const connection = { converterId: converter.id, connectionIndex }
      const port = dcPorts[connectionIndex]!
      const rowY = getOrdinaryCircuitConverterOutputRowY(converter, anchor.y, connectionIndex)
      const laneNodes = outputNodes
        .filter(
          (candidate) =>
            (candidate.domainRef as TrunkDevice).converterDcConnection?.connectionIndex ===
            connectionIndex
        )
        .sort(
          (left, right) =>
            ((left.domainRef as TrunkDevice).trunkPosition ?? 0) -
            ((right.domainRef as TrunkDevice).trunkPosition ?? 0)
        )
      laneNodes.forEach((candidate, index) => {
        candidate.bounds.x =
          laneNodes.length === 1
            ? port.x
            : port.x +
              directionSign *
                (CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD +
                  index * LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING)
        candidate.bounds.y = rowY
      })
      const wireEndX = laneNodes.at(-1)?.bounds.x ?? port.x
      const hitPadding = 9
      const sharedHitZone: LayoutNode['hitZone'] = {
        type: 'supplyConverterDcWire',
        padding: 0,
        supplyFeedScope: converterNode.hitZone?.supplyFeedScope,
        supplyInsertIndex:
          ((laneNodes.at(-1)?.domainRef as TrunkDevice | undefined)?.trunkPosition ??
            converter.trunkPosition) + 1,
        supplyPanelId: converterNode.hitZone?.supplyPanelId,
        supplyConverterDcBranch: converterNode.hitZone?.supplyConverterDcBranch,
        supplyConverterDcConnectionIndex: converterNode.hitZone?.supplyConverterDcConnectionIndex,
        supplyDcBusId: converter.supplyDcBusId,
        supplyDcBusBranchId: converter.supplyDcBusBranchId,
        converterDcConnection: connection,
      }
      outputHitNodes.push({
        id: `supply-nested-converter-output-${converter.id}-${connectionIndex}-vertical`,
        type: 'wire',
        bounds: {
          x: port.x - hitPadding,
          y: Math.min(port.y, rowY) - hitPadding,
          width: hitPadding * 2,
          height: Math.abs(port.y - rowY) + hitPadding * 2,
        },
        hitZone: { ...sharedHitZone, suppressDropHint: true },
        children: [],
      })
      outputHitNodes.push({
        id: `supply-nested-converter-output-${converter.id}-${connectionIndex}-horizontal`,
        type: 'wire',
        bounds: {
          x: Math.min(port.x, wireEndX) - hitPadding,
          y: rowY - hitPadding,
          width: Math.max(hitPadding * 2, Math.abs(wireEndX - port.x) + hitPadding * 2),
          height: hitPadding * 2,
        },
        hitZone: sharedHitZone,
        children: [],
      })
    }
    converterNode.children = [
      ...converterNode.children.filter(
        (child) => !child.id.startsWith(`supply-nested-converter-output-${converter.id}-`)
      ),
      ...outputHitNodes,
    ]
  }
}

export function mirrorSupplyAssemblyLayoutNodesHorizontally(
  node: LayoutNode,
  axisX: number,
  converterBackupCircuitIds?: Set<string>,
  mirrorSymbolRotation = false
): void {
  const backupCircuitIds =
    converterBackupCircuitIds ??
    (node.type === 'panel'
      ? new Set(
          ((node.domainRef as Panel | undefined)?.protections ?? []).flatMap((protection) =>
            (protection.circuits ?? [])
              .filter((circuit) => circuit.supplySource?.kind === 'converter-backup')
              .map((circuit) => circuit.id)
          )
        )
      : new Set<string>())
  if (isConverterBackupCircuitRoot(node)) {
    mirrorLayoutNodeHorizontally(node, axisX, mirrorSymbolRotation)
    return
  }
  if (
    isSupplyAssemblyLayoutNode(node) ||
    (node.id.startsWith('label-') && backupCircuitIds.has(node.id.slice('label-'.length)))
  ) {
    mirrorLayoutNodeSelfHorizontally(node, axisX, mirrorSymbolRotation)
  }
  node.children.forEach((child) =>
    mirrorSupplyAssemblyLayoutNodesHorizontally(
      child,
      axisX,
      backupCircuitIds,
      mirrorSymbolRotation
    )
  )
}

/** Mirror only the empty split rails and their panel-side drop targets. */
export function mirrorInlineSplitBusLayoutNodesHorizontally(
  panelNode: LayoutNode,
  axisX: number
): void {
  const bus = panelNode.children.find((node) => node.type === 'busBar')
  if (!bus) return
  mirrorLayoutNodeSelfHorizontally(bus, axisX)
  bus.children.forEach((node) => {
    if (
      node.id.startsWith('main-bus-segment-') ||
      node.id.startsWith('supply-wire-feed-stub-')
    ) {
      mirrorLayoutNodeHorizontally(node, axisX)
    }
  })
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

function getFeedStubDevicePaintRects(device: TrunkDevice, x: number, y: number): FeedStubPaintRect[] {
  const symbolHalf = LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
  const rects: FeedStubPaintRect[] = [
    { left: x - symbolHalf, right: x + symbolHalf, top: y - symbolHalf, bottom: y + symbolHalf },
  ]
  const leftLines = [device.label, device.notes].filter((value): value is string => !!value?.trim())
  if (leftLines.length > 0) {
    const metrics = getSymbolLabelVerticalMetrics(leftLines, 10)
    const width = Math.max(...leftLines.map((line) => measureSymbolLabelTextWidth(line, 'Figtree', 8)))
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
      const metrics = getSymbolLabelVerticalMetrics(lines.map((line) => line.text), 12)
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
    const y = previous < 0
      ? busY + Math.max(44, 25 - top)
      : Math.max(
          centers[previous]! + 50,
          Math.max(...rects.map((rect) => rect.bottom)) - top + 6
        )
    centers.push(y)
    rects.push(...relative.map((rect) => ({
      ...rect, top: rect.top + y, bottom: rect.bottom + y,
    })))
  }
  const lastY = centers.at(-1) ?? busY
  const lastBottom = Math.max(lastY + 15, ...rects.map((rect) => rect.bottom))
  // An empty stub is painted down to its feed marker (deriveWires), so its
  // insertion zone must cover that whole wire, not just the first few pixels.
  const ownEndY = centers.length === 0
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
      const isHorizontalSupplyDevice = !isVerticalSupplyDevice(supplyDevice)
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
          ...(supplyDeviceData.device.supplyPath === 'converter-grid'
            ? {
                converterGridPlacement: supplyDeviceData.device.converterGridPlacement ?? 'inline',
              }
            : {}),
          ...(supplyDeviceData.device.supplyPath === 'changeover-grid'
            ? {
                changeoverGridPlacement:
                  supplyDeviceData.device.changeoverGridPlacement ?? 'inline',
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
      ? Math.max(
          parentMcbElement.position.y,
          // Ensure the total feeder height can fit two minimum wire segments
          // (below + above inserted protection): 2 * minSegmentLength.
          mainBusElement.position.y + MIN_SUBPANEL_INCOMING_SEGMENT_LENGTH * 2
        )
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
    const mainBusNode = buildMainBusNode(panelLayout, mainBusElement, groundElement)
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
        panelLayout.frameRole === 'panel' && panelLayout.panel.isMain)) &&
    hasExplicitPanelBusSections(panelLayout.panel)
  ) {
    const bus = children.find((node) => node.type === 'busBar')
    const allRuns = bus?.children
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
        if (previous && previous.sectionId === sectionId &&
          Math.abs(previous.end - node.bounds.x) < 0.01) previous.end = end
        else result.push({ start: node.bounds.x, end, sectionId })
        return result
      }, []) ?? []
    const stacks = new Map(
      (panelLayout.panelLocalFeedStubStacks ?? [])
        .map((stack) => [stack.busSectionId, stack])
    )
    const runs = allRuns.filter((run) => stacks.has(run.sectionId))
    if (runs.length > 0 && bus) {
      const originalIds = new Set(runs.flatMap((run) =>
        stacks.get(run.sectionId)!.devices.map((device) => `supplyTrunkDevice-${device.id}`)
      ))
      const originals = new Map(
        children.filter((node) => originalIds.has(node.id)).map((node) => [node.id, node])
      )
      const busY = bus.bounds.y + bus.bounds.height / 2
      const stackLayouts = runs.map((run, runIndex) => {
        const stack = stacks.get(run.sectionId)!
        const x = getLeftBiasedBusFeedStubX(run.start, run.end)
        // A section repeated across runs hosts its feeders on its first stub only.
        const hostsFeeders = (stack.feeders?.length ?? 0) > 0 &&
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
              bounds: { x: branchX, y, width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
                height: LAYOUT_CONSTANTS.SYMBOL_SIZE },
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
          if (device.type !== 'protection' &&
            runs.findIndex((run) => run.sectionId === stack.busSectionId) !== runIndex) continue
          const original = originals.get(`supplyTrunkDevice-${device.id}`)
          const source: LayoutNode = original ?? {
            id: `supplyTrunkDevice-${device.id}`,
            type: 'trunkDevice',
            bounds: { x, y: centers[deviceIndex]!, width: LAYOUT_CONSTANTS.SYMBOL_SIZE,
              height: LAYOUT_CONSTANTS.SYMBOL_SIZE },
            domainId: device.id,
            domainRef: device,
            visual: { type: 'symbol', symbolId: device.symbol, label: device.label },
            hitZone: {
              type: 'supplyWire', padding: 10, supplyFeedScope: 'root',
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
        const centers = [
          busY,
          ...deviceCenters,
          endY,
        ]
        for (let gapIndex = 0; gapIndex < centers.length - 1; gapIndex++) {
          const fromY = centers[gapIndex]! + (gapIndex === 0 ? 9 : 13)
          const toY = centers[gapIndex + 1]! -
            (gapIndex === centers.length - 2 ? 0 : 13)
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
              supplyInsertIndex:
                stack.insertBase + stack.devices.length - gapIndex,
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
        node.hitZone.supplyPanelInput = node.hitZone.supplyPanelInput ||
          panelLayout.supplyEndpointKind === 'continuation'
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

function buildMainBusNode(
  panelLayout: BottomUpPanelLayout,
  mainBusElement: BottomUpLayoutElement,
  groundElement?: BottomUpLayoutElement
): LayoutNode {
  const children: LayoutNode[] = []

  // Group circuits by their parent RCD (if any)
  const rcdGroups = new Map<string, BottomUpCircuitLayout[]>()
  const directMcbs: BottomUpCircuitLayout[] = []

  for (const circuitLayout of panelLayout.circuits) {
    // Skip nested circuits - they'll be handled under their parent circuit
    if (circuitLayout.parentCircuit) {
      continue
    }

    if (circuitLayout.parentRcd) {
      const rcdId = circuitLayout.parentRcd.id
      if (!rcdGroups.has(rcdId)) {
        rcdGroups.set(rcdId, [])
      }
      rcdGroups.get(rcdId)!.push(circuitLayout)
    } else {
      directMcbs.push(circuitLayout)
    }
  }

  // Build RCD nodes (each RCD has a trunk/secondaryBus with MCBs)
  for (const [rcdId, circuits] of rcdGroups.entries()) {
    const rcdElement = panelLayout.elements.find(
      (e) => e.type === 'rcd' && e.protectionId === rcdId
    )
    if (rcdElement) {
      const rcdNode = buildRcdNode(panelLayout, rcdElement, circuits)
      children.push(rcdNode)
    }
  }

  // Build RCD nodes for RCDs with 0 circuits (freshly dropped, not yet populated)
  for (const protection of panelLayout.panel.protections) {
    if (
      (protection.type === 'RCD' || protection.type === 'RCBO') &&
      !rcdGroups.has(protection.id)
    ) {
      const rcdElement = panelLayout.elements.find(
        (e) => e.type === 'rcd' && e.protectionId === protection.id
      )
      if (rcdElement) {
        const rcdNode = buildRcdNode(panelLayout, rcdElement, [])
        children.push(rcdNode)
      }
    }
  }

  // Build direct MCB nodes (not under RCD)
  for (const circuitLayout of directMcbs) {
    const mcbNode = buildMcbNode(panelLayout, circuitLayout)
    if (mcbNode) {
      children.push(mcbNode)
    }
  }

  // Supply wire: drop target for inserting energy meters and protection devices.
  // The wire goes from main bus down to the bend point, then optionally horizontal to the supply symbol.
  // When devices exist, the supply symbol is at the END (rightmost) of the horizontal chain.
  const supply = panelLayout.supply
  const supplyBend = panelLayout.supplyBend
  if (supply && mainBusElement.position) {
    const pad = 10
    const supplyDevicesSorted = [...(panelLayout.supplyDevices ?? [])]
      .filter(({ device }) => {
        if (
          device.supplyPath === 'converter-branch' &&
          device.converterGridInputConnected === false
        ) {
          return false
        }
        return (
          panelLayout.supplyChangeoverBranches ||
          !panelLayout.supplyConverterBranch ||
          !['converter-grid', 'converter-dc', 'converter-dc-top'].includes(device.supplyPath ?? '')
        )
      })
      .sort((a, b) => a.x - b.x)
    const hasSupplyDevices = supplyDevicesSorted.length > 0

    if (supplyBend) {
      const bendX = supplyBend.x
      const bendY = supplyBend.y
      const rootDevices = hasSupplyDevices
        ? supplyDevicesSorted.filter((device) => device.feedScope === 'root')
        : []
      const sharedDevices = hasSupplyDevices
        ? supplyDevicesSorted.filter((device) => device.feedScope === 'shared')
        : []
      const rootCount = rootDevices.length
      const sharedCount = sharedDevices.length
      const directChangeoverInsertIndex = getDirectConverterChangeoverInsertIndex(
        (panelLayout.supplyDevices ?? [])
          .filter(({ feedScope }) => feedScope === 'root')
          .map(({ device }) => device)
      )
      const leftmostDevice = supplyDevicesSorted[0]
      const rightmostDevice = supplyDevicesSorted[supplyDevicesSorted.length - 1]
      const leftmostSharedDevice = sharedDevices[0]

      const diagramId = getPanelDiagramId(panelLayout)
      const separateConverter = !panelLayout.supplyChangeoverBranches
        ? panelLayout.supplyDevices?.find(
            ({ device }) =>
              device.supplyPath === 'converter-branch' &&
              device.converterAcConnection === 'separate'
          )
        : undefined
      const pushSupplySegment = (
        id: string,
        x1: number,
        x2: number,
        scope: 'shared' | 'root',
        insertIndex: number,
        supplyConverterChangeoverSlot = false
      ) => {
        // A changeover owns lane-aware hit zones below. Do not leave stale zones
        // behind on the former centerline after its source-side symbols move down.
        if (panelLayout.supplyChangeoverBranches) return
        if (x2 <= x1) return
        const isDirectChangeoverSlot =
          supplyConverterChangeoverSlot ||
          (scope === 'root' && insertIndex === directChangeoverInsertIndex)
        const compactChangeoverSlot = isDirectChangeoverSlot && !separateConverter
        const segmentX1 = compactChangeoverSlot
          ? Math.max(x1, x2 - LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE)
          : x1
        children.unshift({
          id,
          type: 'wire',
          bounds: {
            x: segmentX1 - pad - (compactChangeoverSlot ? 1 : 0),
            y:
              separateConverter &&
              Math.abs((x1 + x2) / 2 - bendX) < Math.abs(separateConverter.x - bendX)
                ? separateConverter.y - pad
                : bendY - pad,
            width: x2 - segmentX1 + pad * 2,
            height: pad * 2,
          },
          hitZone: {
            type: 'supplyWire',
            padding: 0,
            supplyFeedScope: scope,
            supplyInsertIndex: insertIndex,
            supplyPanelId: panelLayout.panel.id,
            supplyConverterChangeoverSlot: isDirectChangeoverSlot,
          },
          children: [],
        })
      }

      // Vertical segment from main bus down to bend point always belongs to the panel-local feed
      // when present; otherwise it is part of the shared path.
      const continuationRootInsertBase = panelLayout.panelLocalRootSupplyInsertBase
      children.unshift({
        id: `supply-wire-vertical-${diagramId}`,
        type: 'wire',
        bounds: {
          x: bendX - pad,
          y: mainBusElement.position.y,
          width: pad * 2,
          height: (separateConverter?.y ?? bendY) - mainBusElement.position.y,
        },
        hitZone: {
          type: 'supplyWire',
          padding: 0,
          supplyFeedScope: 'root',
          supplyInsertIndex:
            continuationRootInsertBase != null
              ? continuationRootInsertBase + rootCount
              : rootCount > 0 || sharedCount > 0
                ? rootCount
                : sharedCount,
          supplyPanelId: panelLayout.panel.id,
        },
        children: [],
      })

      if (hasSupplyDevices && panelLayout.supplyEndpointKind === 'continuation') {
        // Continuation rails never own shared/grid topology. Left and right of a
        // local protection must stay on this panel's root feed at/after insertBase,
        // never splice at the start of the assembly supply wire.
        const insertBase = continuationRootInsertBase ?? 0
        const supplyEndX = supply.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
        const supplyIsLeft = supplyEndX < bendX
        const alongFromSupply = [...supplyDevicesSorted].sort((a, b) =>
          supplyIsLeft ? a.x - b.x : b.x - a.x
        )
        const first = alongFromSupply[0]
        const last = alongFromSupply[alongFromSupply.length - 1]
        if (first) {
          pushSupplySegment(
            `supply-wire-segment-${diagramId}-supply`,
            Math.min(supplyEndX, first.x),
            Math.max(supplyEndX, first.x),
            'root',
            insertBase
          )
        }
        for (let i = 0; i < alongFromSupply.length - 1; i++) {
          const nearerSupply = alongFromSupply[i]!
          const nearerBus = alongFromSupply[i + 1]!
          pushSupplySegment(
            `supply-wire-segment-${diagramId}-${i}`,
            Math.min(nearerSupply.x, nearerBus.x),
            Math.max(nearerSupply.x, nearerBus.x),
            'root',
            Math.max(nearerSupply.feedIndex + 1, insertBase)
          )
        }
        if (last) {
          pushSupplySegment(
            `supply-wire-segment-${diagramId}-entry`,
            Math.min(bendX, last.x),
            Math.max(bendX, last.x),
            'root',
            Math.max(last.feedIndex + 1, insertBase)
          )
        }
      } else if (hasSupplyDevices) {
        if (leftmostDevice) {
          if (rootCount === 0 && leftmostSharedDevice) {
            const separatorX = (bendX + leftmostSharedDevice.x) / 2
            pushSupplySegment(
              `supply-wire-segment-${diagramId}-entry-root`,
              bendX,
              separatorX,
              'root',
              0
            )
            pushSupplySegment(
              `supply-wire-segment-${diagramId}-entry-shared`,
              separatorX,
              leftmostSharedDevice.x,
              'shared',
              sharedCount
            )
          } else {
            pushSupplySegment(
              `supply-wire-segment-${diagramId}-entry`,
              bendX,
              leftmostDevice.x,
              leftmostDevice.feedScope,
              leftmostDevice.feedIndex + 1,
              leftmostDevice.device.supplyPath === 'converter-branch'
            )
          }
        }

        for (let i = 0; i < supplyDevicesSorted.length - 1; i++) {
          const left = supplyDevicesSorted[i]!
          const right = supplyDevicesSorted[i + 1]!

          if (left.feedScope === right.feedScope) {
            pushSupplySegment(
              `supply-wire-segment-${diagramId}-${i}`,
              left.x,
              right.x,
              right.feedScope,
              right.feedIndex + 1,
              right.device.supplyPath === 'converter-branch'
            )
            continue
          }

          const separatorX = (left.x + right.x) / 2
          pushSupplySegment(
            `supply-wire-segment-${diagramId}-${i}-root`,
            left.x,
            separatorX,
            'root',
            0
          )
          pushSupplySegment(
            `supply-wire-segment-${diagramId}-${i}-shared`,
            separatorX,
            right.x,
            'shared',
            sharedCount
          )
        }

        const supplyEndX = supply.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
        if (rightmostDevice) {
          if (sharedCount === 0 && rightmostDevice.feedScope === 'root') {
            const separatorX = (rightmostDevice.x + supplyEndX) / 2
            pushSupplySegment(
              `supply-wire-segment-${diagramId}-supply-root`,
              rightmostDevice.x,
              separatorX,
              'root',
              0
            )
            pushSupplySegment(
              `supply-wire-segment-${diagramId}-supply-shared`,
              separatorX,
              supplyEndX,
              'shared',
              0
            )
          } else {
            pushSupplySegment(
              `supply-wire-segment-${diagramId}-supply`,
              rightmostDevice.x,
              supplyEndX,
              rightmostDevice.feedScope,
              0
            )
          }
        }
      } else if (panelLayout.supplyEndpointKind === 'continuation') {
        // Panel-only handoff frames still paint a horizontal rail to the Voeding
        // endpoint. Without a drop slot there, protections can only be added through
        // panel-canvas rewiring. The full rail is root-scoped: shared topology lives
        // in the detached supply frame.
        const supplyEndX = supply.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
        const handoffLeft = Math.min(bendX, supplyEndX)
        const handoffRight = Math.max(bendX, supplyEndX)
        pushSupplySegment(
          `supply-wire-segment-${diagramId}-handoff`,
          handoffLeft,
          handoffRight,
          'root',
          panelLayout.panelLocalRootSupplyInsertBase ?? 0
        )
      } else {
        const supplyEndX = supply.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
        const separatorX = (bendX + supplyEndX) / 2
        pushSupplySegment(
          `supply-wire-segment-${diagramId}-stub-root`,
          bendX,
          separatorX,
          'root',
          0
        )
        pushSupplySegment(
          `supply-wire-segment-${diagramId}-stub-shared`,
          separatorX,
          supplyEndX,
          'shared',
          0
        )
      }
    } else {
      // Sub-panel / no bend metadata: single vertical hit zone at the feeder X
      const wireY = Math.min(supply.y, mainBusElement.position.y)
      const wireHeight = Math.abs(supply.y - mainBusElement.position.y)
      children.unshift({
        id: `supply-wire-${panelLayout.panel.id}`,
        type: 'wire',
        bounds: {
          x: supply.x - pad,
          y: wireY,
          width: pad * 2,
          height: wireHeight,
        },
        hitZone: {
          type: 'supplyWire',
          padding: 0,
          supplyFeedScope: 'shared',
          supplyInsertIndex: 0,
          supplyPanelId: panelLayout.panel.id,
        },
        children: [],
      })
    }
  }

  const changeoverBranches = panelLayout.supplyChangeoverBranches
  if (changeoverBranches) {
    const pad = 10
    const devices = [...(panelLayout.supplyDevices ?? [])].sort((a, b) => a.x - b.x)
    const sharedCount = devices.filter((candidate) => candidate.feedScope === 'shared').length
    const changeover = devices.find(
      (candidate) => candidate.device.id === changeoverBranches.deviceId
    )
    const backupConverter = devices.find((candidate) => candidate.device.supplyPath === 'backup')
    const converterGridInputConnected =
      backupConverter?.device.converterGridInputConnected !== false
    const isBranchDevice = (candidate: (typeof devices)[number]) =>
      ['backup', 'backup-output', 'changeover-grid', 'converter-grid'].includes(
        candidate.device.supplyPath ?? ''
      )
    const pushLaneSegment = (
      id: string,
      x1: number,
      x2: number,
      y: number,
      insertIndex: number,
      feedScope: 'shared' | 'root',
      type:
        | 'supplyWire'
        | 'supplyBackupWire'
        | 'supplyBackupOutputWire'
        | 'supplyChangeoverGridWire'
        | 'supplyConverterGridWire' = 'supplyWire'
    ) => {
      if (x2 <= x1) return
      children.unshift({
        id,
        type: 'wire',
        bounds: { x: x1 - pad, y: y - pad, width: x2 - x1 + pad * 2, height: pad * 2 },
        hitZone: {
          type,
          padding: 0,
          supplyFeedScope: feedScope,
          supplyInsertIndex: insertIndex,
          supplyPanelId: panelLayout.panel.id,
          ...(type === 'supplyConverterGridWire'
            ? { converterGridPlacement: 'inline' as const }
            : {}),
        },
        children: [],
      })
    }

    if (changeover) {
      const outputDevices = devices.filter(
        (candidate) => candidate.x < changeover.x && !isBranchDevice(candidate)
      )
      let previousX = panelLayout.supplyBend?.x ?? changeover.x
      for (const candidate of [...outputDevices, changeover]) {
        pushLaneSegment(
          `supply-changeover-load-slot-${panelLayout.panel.id}-${candidate.device.id}`,
          previousX,
          candidate.x,
          changeoverBranches.y,
          candidate.feedIndex + 1,
          candidate.feedScope
        )
        previousX = candidate.x
      }

      const changeoverGridDevices = devices
        .filter(
          (candidate) =>
            candidate.device.supplyPath === 'changeover-grid' &&
            candidate.device.changeoverGridPlacement !== 'input-leg'
        )
        .sort((a, b) => a.x - b.x)
      const gridRailX = groundElement?.position.x ?? mainBusElement.position.x + 20
      previousX = gridRailX
      for (const candidate of changeoverGridDevices) {
        pushLaneSegment(
          `supply-changeover-grid-rail-slot-${panelLayout.panel.id}-${candidate.device.id}`,
          previousX,
          candidate.x,
          changeoverBranches.lowerY,
          candidate.feedIndex,
          'root',
          'supplyChangeoverGridWire'
        )
        previousX = candidate.x
      }
      pushLaneSegment(
        `supply-changeover-grid-rail-slot-${panelLayout.panel.id}-append`,
        previousX,
        changeoverBranches.elbowX,
        changeoverBranches.lowerY,
        Math.max(
          changeover.feedIndex + 1,
          ...changeoverGridDevices.map((candidate) => candidate.feedIndex + 1),
          ...devices
            .filter(
              (candidate) =>
                candidate.device.supplyPath === 'changeover-grid' &&
                candidate.device.changeoverGridPlacement === 'input-leg'
            )
            .map((candidate) => candidate.feedIndex + 1)
        ),
        'root',
        'supplyChangeoverGridWire'
      )
      const changeoverGridInputLegDevices = devices
        .filter(
          (candidate) =>
            candidate.device.supplyPath === 'changeover-grid' &&
            candidate.device.changeoverGridPlacement === 'input-leg'
        )
        .sort((a, b) => a.y - b.y)
      const changeoverGridInputLegWaypoints = [
        {
          y: changeover.y + (LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE * 7) / 24,
          index: changeover.feedIndex,
        },
        ...changeoverGridInputLegDevices.map((candidate) => ({
          y: candidate.y,
          index: candidate.feedIndex,
        })),
        { y: changeoverBranches.lowerY, index: changeover.feedIndex },
      ]
      for (let index = 0; index < changeoverGridInputLegWaypoints.length - 1; index++) {
        const from = changeoverGridInputLegWaypoints[index]!
        const to = changeoverGridInputLegWaypoints[index + 1]!
        if (to.y <= from.y) continue
        children.unshift({
          id: `supply-changeover-grid-input-slot-${panelLayout.panel.id}-${index}`,
          type: 'wire',
          bounds: {
            x: changeoverBranches.elbowX - pad,
            y: from.y - pad,
            width: pad * 2,
            height: to.y - from.y + pad * 2,
          },
          hitZone: {
            type: 'supplyChangeoverGridWire',
            padding: 0,
            supplyFeedScope: 'root',
            supplyInsertIndex: to.index,
            supplyPanelId: panelLayout.panel.id,
            changeoverGridPlacement: 'input-leg' as const,
          },
          children: [],
        })
      }
      const gridTapX = backupConverter?.x ?? changeoverBranches.slotEndX
      previousX = changeoverBranches.elbowX
      const converterGridDevices = converterGridInputConnected
        ? devices
            .filter(
              (candidate) =>
                candidate.device.supplyPath === 'converter-grid' &&
                candidate.device.converterGridPlacement !== 'input-leg'
            )
            .sort((a, b) => a.x - b.x)
        : []
      for (const candidate of converterGridDevices) {
        pushLaneSegment(
          `supply-changeover-converter-grid-slot-${panelLayout.panel.id}-${candidate.device.id}`,
          previousX,
          candidate.x,
          changeoverBranches.lowerY,
          candidate.feedIndex,
          'root',
          'supplyConverterGridWire'
        )
        previousX = candidate.x
      }
      if (backupConverter && converterGridInputConnected) {
        pushLaneSegment(
          `supply-changeover-converter-grid-slot-${panelLayout.panel.id}-tap`,
          previousX,
          gridTapX,
          changeoverBranches.lowerY,
          converterGridDevices.at(-1)?.feedIndex != null
            ? converterGridDevices.at(-1)!.feedIndex + 1
            : backupConverter.feedIndex,
          'root',
          'supplyConverterGridWire'
        )
        previousX = gridTapX
      }
      if (backupConverter && converterGridInputConnected) {
        const converterGridInputLegDevices = devices
          .filter(
            (candidate) =>
              candidate.device.supplyPath === 'converter-grid' &&
              candidate.device.converterGridPlacement === 'input-leg'
          )
          .sort((a, b) => a.y - b.y)
        const verticalWaypoints = [
          {
            y: backupConverter.y + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
            index: backupConverter.feedIndex,
          },
          ...converterGridInputLegDevices.map((candidate) => ({
            y: candidate.y,
            index: candidate.feedIndex,
          })),
          { y: changeoverBranches.lowerY, index: backupConverter.feedIndex },
        ]
        for (let index = 0; index < verticalWaypoints.length - 1; index++) {
          const from = verticalWaypoints[index]!
          const to = verticalWaypoints[index + 1]!
          if (to.y <= from.y) continue
          children.unshift({
            id: `supply-changeover-converter-grid-input-slot-${panelLayout.panel.id}-${index}`,
            type: 'wire',
            bounds: {
              x: backupConverter.x - pad,
              y: from.y - pad,
              width: pad * 2,
              height: to.y - from.y + pad * 2,
            },
            hitZone: {
              type: 'supplyConverterGridWire',
              padding: 0,
              supplyFeedScope: 'root',
              supplyInsertIndex: to.index,
              supplyPanelId: panelLayout.panel.id,
              converterGridPlacement: 'input-leg',
            },
            children: [],
          })
        }
      }

      const gridDevices = devices.filter(
        (candidate) => candidate.x > changeover.x && !isBranchDevice(candidate)
      )
      let previousScope: 'shared' | 'root' = 'root'
      for (const candidate of gridDevices) {
        if (previousScope !== candidate.feedScope) {
          const separatorX = (previousX + candidate.x) / 2
          pushLaneSegment(
            `supply-changeover-grid-slot-${panelLayout.panel.id}-${candidate.device.id}-root`,
            previousX,
            separatorX,
            changeoverBranches.lowerY,
            0,
            'root'
          )
          pushLaneSegment(
            `supply-changeover-grid-slot-${panelLayout.panel.id}-${candidate.device.id}-shared`,
            separatorX,
            candidate.x,
            changeoverBranches.lowerY,
            sharedCount,
            'shared'
          )
        } else {
          pushLaneSegment(
            `supply-changeover-grid-slot-${panelLayout.panel.id}-${candidate.device.id}`,
            previousX,
            candidate.x,
            changeoverBranches.lowerY,
            candidate.feedIndex + 1,
            candidate.feedScope
          )
        }
        previousX = candidate.x
        previousScope = candidate.feedScope
      }
      const supplyEndX = supply.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
      if (previousScope === 'root') {
        const separatorX = (previousX + supplyEndX) / 2
        pushLaneSegment(
          `supply-changeover-grid-slot-${panelLayout.panel.id}-supply-root`,
          previousX,
          separatorX,
          changeoverBranches.lowerY,
          0,
          'root'
        )
        pushLaneSegment(
          `supply-changeover-grid-slot-${panelLayout.panel.id}-supply-shared`,
          separatorX,
          supplyEndX,
          changeoverBranches.lowerY,
          0,
          'shared'
        )
      } else {
        pushLaneSegment(
          `supply-changeover-grid-slot-${panelLayout.panel.id}-supply`,
          previousX,
          supplyEndX,
          changeoverBranches.lowerY,
          0,
          'shared'
        )
      }

      const backupOutputDevices = devices
        .filter((candidate) => candidate.device.supplyPath === 'backup-output')
        .sort((a, b) => a.x - b.x)
      if (backupConverter) {
        previousX = changeoverBranches.elbowX
        for (const candidate of [...backupOutputDevices, backupConverter]) {
          pushLaneSegment(
            `supply-changeover-backup-output-slot-${panelLayout.panel.id}-${candidate.device.id}`,
            previousX,
            candidate.x,
            changeoverBranches.upperY,
            candidate.device.supplyPath === 'backup' ? changeover.feedIndex : candidate.feedIndex,
            'root',
            'supplyBackupOutputWire'
          )
          previousX = candidate.x
        }
      } else {
        previousX = changeoverBranches.elbowX
        for (const candidate of backupOutputDevices) {
          pushLaneSegment(
            `supply-changeover-backup-slot-${panelLayout.panel.id}-${candidate.device.id}`,
            previousX,
            candidate.x,
            changeoverBranches.upperY,
            candidate.feedIndex,
            'root',
            'supplyBackupOutputWire'
          )
          previousX = candidate.x
        }
        pushLaneSegment(
          `supply-changeover-backup-slot-${panelLayout.panel.id}-append`,
          previousX,
          changeoverBranches.slotEndX,
          changeoverBranches.upperY,
          backupOutputDevices.at(-1)?.feedIndex != null
            ? backupOutputDevices.at(-1)!.feedIndex + 1
            : (changeover?.feedIndex ?? 0) + 1,
          'root',
          'supplyBackupWire'
        )
      }
    }
  }

  const converterBranch = panelLayout.supplyConverterBranch
  if (converterBranch) {
    const pad = 10
    const devices = panelLayout.supplyDevices ?? []
    const converter = devices.find((candidate) => candidate.device.id === converterBranch.deviceId)
    const gridDevices = devices
      .filter(
        (candidate) =>
          candidate.device.supplyPath === 'converter-grid' &&
          candidate.device.converterGridPlacement !== 'input-leg'
      )
      .sort((a, b) => a.x - b.x)
    if (converter) {
      const converterGridInputConnected = converter.device.converterGridInputConnected !== false
      // Modular changeovers expose their own lane-aware AC hit zones above. The direct-converter
      // AC zones describe different sections and must not overlap those changeover targets.
      const backup = panelLayout.supplyConverterBackup
      if (!converterGridInputConnected) {
        children.unshift({
          id: `supply-direct-converter-load-slot-${panelLayout.panel.id}`,
          type: 'wire',
          bounds: {
            x: converter.x - pad,
            y: panelLayout.supply.y - pad,
            width: pad * 2,
            height: pad * 2,
          },
          hitZone: {
            type: 'supplyWire',
            padding: 0,
            supplyFeedScope: 'root',
            supplyInsertIndex: converter.feedIndex + 1,
            supplyPanelId: panelLayout.panel.id,
          },
          children: [],
        })
      }
      if (!changeoverBranches && backup && backup.x2 > backup.x1) {
        children.unshift({
          id: `supply-direct-converter-backup-slot-${panelLayout.panel.id}`,
          type: 'wire',
          bounds: {
            x: backup.x1 - pad,
            y: backup.y - pad,
            width: backup.x2 - backup.x1 + pad * 2,
            height: pad * 2,
          },
          hitZone: {
            type: 'supplyConverterBackupWire',
            padding: 0,
            supplyFeedScope: 'root',
            supplyPanelId: panelLayout.panel.id,
          },
          children: [],
        })
      }
      const directGridDevices =
        changeoverBranches || !converterGridInputConnected ? [] : gridDevices
      let previousGridX =
        converter.device.converterAcConnection === 'separate'
          ? converter.x
          : (panelLayout.supplyBend?.x ?? converter.x)
      for (const candidate of directGridDevices) {
        children.unshift({
          id: `supply-direct-converter-grid-slot-${panelLayout.panel.id}-${candidate.device.id}`,
          type: 'wire',
          bounds: {
            x: previousGridX - pad,
            y: converterBranch.lineY - pad,
            width: candidate.x - previousGridX + pad * 2,
            height: pad * 2,
          },
          hitZone: {
            type: 'supplyConverterGridWire',
            padding: 0,
            supplyFeedScope: 'root',
            supplyInsertIndex: candidate.feedIndex,
            supplyPanelId: panelLayout.panel.id,
            converterGridPlacement: 'inline',
          },
          children: [],
        })
        previousGridX = candidate.x
      }
      if (!changeoverBranches && converterGridInputConnected && converter.x > previousGridX) {
        const converterGridEndX = converter.x - LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE - 2
        if (converterGridEndX > previousGridX) {
          children.unshift({
            id: `supply-direct-converter-grid-slot-${panelLayout.panel.id}-append`,
            type: 'wire',
            bounds: {
              x: previousGridX - pad,
              y: converterBranch.lineY - pad,
              width: converterGridEndX - previousGridX + pad * 2,
              height: pad * 2,
            },
            hitZone: {
              type: 'supplyConverterGridWire',
              padding: 0,
              supplyFeedScope: 'root',
              supplyInsertIndex:
                directGridDevices.at(-1)?.feedIndex != null
                  ? directGridDevices.at(-1)!.feedIndex + 1
                  : converter.feedIndex,
              supplyPanelId: panelLayout.panel.id,
              converterGridPlacement: 'inline',
            },
            children: [],
          })
        }
      }
      const inputLegDevices =
        changeoverBranches || !converterGridInputConnected
          ? []
          : devices
              .filter(
                (candidate) =>
                  candidate.device.supplyPath === 'converter-grid' &&
                  candidate.device.converterGridPlacement === 'input-leg'
              )
              .sort((a, b) => a.y - b.y)
      const inputLegWaypoints =
        changeoverBranches || !converterGridInputConnected
          ? []
          : [
              { y: converter.y + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2, index: converter.feedIndex },
              ...inputLegDevices.map((candidate) => ({
                y: candidate.y,
                index: candidate.feedIndex,
              })),
              { y: converterBranch.lineY, index: converter.feedIndex },
            ]
      for (let index = 0; index < inputLegWaypoints.length - 1; index++) {
        const from = inputLegWaypoints[index]!
        const to = inputLegWaypoints[index + 1]!
        if (to.y <= from.y) continue
        children.unshift({
          id: `supply-direct-converter-grid-input-slot-${panelLayout.panel.id}-${index}`,
          type: 'wire',
          bounds: {
            x: converter.x - pad,
            y: from.y - pad,
            width: pad * 2,
            height: to.y - from.y + pad * 2,
          },
          hitZone: {
            type: 'supplyConverterGridWire',
            padding: 0,
            supplyFeedScope: 'root',
            supplyInsertIndex: to.index,
            supplyPanelId: panelLayout.panel.id,
            converterGridPlacement: 'input-leg',
          },
          children: [],
        })
      }

      const pushDcInsertionSegment = (
        branch: 'right' | 'top',
        connectionIndex: number,
        segmentIndex: number,
        x1: number,
        x2: number,
        y: number,
        insertIndex: number,
        dropHintAnchor?: { x: number; y: number }
      ) => {
        if (x2 <= x1) return
        const branchKey =
          branch === 'right' ? 'right' : connectionIndex === 1 ? 'top' : `top-${connectionIndex}`
        children.unshift({
          id: `supply-direct-converter-dc-${branchKey}-slot-${panelLayout.panel.id}-${segmentIndex}`,
          type: 'wire',
          bounds: {
            x: x1 - pad,
            y: y - pad,
            width: x2 - x1 + pad * 2,
            height: pad * 2,
          },
          hitZone: {
            type: 'supplyConverterDcWire',
            padding: 0,
            supplyFeedScope: 'root',
            supplyInsertIndex: insertIndex,
            supplyPanelId: panelLayout.panel.id,
            supplyConverterDcBranch: branch,
            supplyConverterDcConnectionIndex: connectionIndex,
            dropHintAnchor,
          },
          children: [],
        })
      }
      const pushDcLaneInsertionSegments = (
        branch: 'right' | 'top',
        connectionIndex: number,
        allBranchDevices: typeof devices,
        startX: number,
        endX: number,
        y: number
      ) => {
        // A DC bus terminates the converter's horizontal insertion lane. Its
        // outgoing devices are represented by the bus's vertical branch slots;
        // keeping a trailing horizontal slot here creates a floating
        // left-edge drop zone that is not electrically connected to the bus.
        const busDevice = allBranchDevices.find(({ device }) => device.type === 'dc_bus')
        const branchDevices = busDevice
          ? [
              ...allBranchDevices.filter(
                ({ device, x }) =>
                  device.id !== busDevice.device.id && !device.supplyDcBusId && x < busDevice.x
              ),
              busDevice,
            ].sort((a, b) => a.x - b.x)
          : allBranchDevices
        let previousX = startX
        branchDevices.forEach((candidate, index) => {
          const nextX = candidate.x - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
          pushDcInsertionSegment(
            branch,
            connectionIndex,
            index,
            previousX,
            nextX,
            y,
            candidate.feedIndex
          )
          previousX = candidate.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
        })
        if (!busDevice) {
          const appendIndex =
            branchDevices.at(-1)?.feedIndex != null
              ? branchDevices.at(-1)!.feedIndex + 1
              : converter.feedIndex + 1
          pushDcInsertionSegment(
            branch,
            connectionIndex,
            branchDevices.length,
            previousX,
            endX,
            y,
            appendIndex,
            { x: endX, y }
          )
        }
      }
      const dcPorts = converterBranch.dcPorts ?? []
      for (const port of dcPorts) {
        const branch = port.connectionIndex === 0 ? 'right' : 'top'
        const branchDevices = devices
          .filter(
            (candidate) =>
              getSupplyConverterDcConnectionIndex(candidate.device) === port.connectionIndex
          )
          .sort((a, b) => a.x - b.x)
        if (port.connectionIndex === 0) {
          pushDcLaneInsertionSegments(
            branch,
            port.connectionIndex,
            branchDevices,
            converter.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
            port.endX,
            port.y
          )
          continue
        }
        const converterTopY = getSupplyConverterBodyGeometry(converter.device, converter).top
        children.unshift({
          id: `supply-direct-converter-dc-top-${port.connectionIndex}-vertical-${panelLayout.panel.id}`,
          type: 'wire',
          bounds: {
            x: port.x - pad,
            y: Math.min(port.y, converterTopY) - pad,
            width: pad * 2,
            height: Math.abs(converterTopY - port.y) + pad * 2,
          },
          hitZone: {
            type: 'supplyConverterDcWire',
            padding: 0,
            supplyFeedScope: 'root',
            supplyInsertIndex: branchDevices[0]?.feedIndex ?? converter.feedIndex + 1,
            supplyPanelId: panelLayout.panel.id,
            supplyConverterDcBranch: 'top',
            supplyConverterDcConnectionIndex: port.connectionIndex,
            suppressDropHint: true,
          },
          children: [],
        })
        if (branchDevices.length === 0) {
          pushDcInsertionSegment(
            'top',
            port.connectionIndex,
            0,
            port.x - 1,
            port.x + 1,
            port.y,
            converter.feedIndex + 1,
            { x: port.x, y: port.y }
          )
        } else {
          pushDcLaneInsertionSegments(
            'top',
            port.connectionIndex,
            branchDevices,
            port.x,
            port.endX,
            port.y
          )
        }
      }
    }
  }

  // Add ground wire hit zone (vertical wire from main bus to ground symbol)
  // This must be added AFTER supply wire so it's checked first in hit detection
  if (groundElement && mainBusElement.position) {
    const pad = 10
    const wireY = Math.min(groundElement.position.y, mainBusElement.position.y)
    const wireHeight = Math.abs(groundElement.position.y - mainBusElement.position.y)
    children.unshift({
      id: `ground-wire-${panelLayout.panel.id}`,
      type: 'wire',
      bounds: {
        x: groundElement.position.x - pad,
        y: wireY,
        width: pad * 2,
        height: wireHeight,
      },
      hitZone: {
        type: 'groundWire',
        padding: 0,
      },
      children: [],
    })
  }

  // Add per-segment hit zones along the main bus so that hitboxes visually
  // match the segmented bus rendering in deriveWires. Segments span the gaps
  // between protections (RCD/MCB) on the main bus.
  if (mainBusElement.position) {
    const busYTop = mainBusElement.position.y
    const busThickness = mainBusElement.height || LAYOUT_CONSTANTS.BUS_THICKNESS
    const busStartX = mainBusElement.position.x
    const busEndX = busStartX + (mainBusElement.width || 0)

    const connectionEntries = children
      .filter((child) => {
        if (child.type !== 'rcd' && child.type !== 'mcb') return false
        const circuit = panelLayout.circuits.find(
          (candidate) => candidate.circuit.id === child.circuitIdForWires
        )?.circuit
        return circuit?.supplySource?.kind !== 'converter-backup'
      })
      .map((child) => ({
        x: child.bounds.x,
        busSectionId: getProtectionBusSectionIdForLayoutNode(panelLayout.panel, child),
      }))
      .sort((a, b) => a.x - b.x)
    const connectionXs = connectionEntries.map((entry) => entry.x)
    const secondaryBusSectionRanges = children.flatMap((node) => {
      if (node.type !== 'rcd' && node.type !== 'mcb') return []
      const sectionId = getProtectionBusSectionIdForLayoutNode(panelLayout.panel, node)
      if (!sectionId) return []
      return node.children
        .filter((child) => child.type === 'secondaryBus' && child.bounds.width > 0)
        .map((secondaryBus) => ({
          sectionId,
          startX: secondaryBus.bounds.x,
          endX: secondaryBus.bounds.x + secondaryBus.bounds.width,
        }))
    })

    const explicitEmptySections =
      connectionXs.length === 0 && hasExplicitPanelBusSections(panelLayout.panel)
        ? [...(panelLayout.panel.busSections ?? [])].sort((left, right) =>
            left.role === right.role ? 0 : left.role === 'backup' ? 1 : -1
          )
        : []
    if (explicitEmptySections.length > 0) {
      const sectionWidth =
        (busEndX - busStartX - PANEL_BUS_FEED_GAP * Math.max(0, explicitEmptySections.length - 1)) /
        explicitEmptySections.length
      explicitEmptySections.forEach((section, index) => {
        const startX = busStartX + index * (sectionWidth + PANEL_BUS_FEED_GAP)
        children.push({
          id: `main-bus-segment-${getPanelDiagramId(panelLayout)}-${section.id}-empty`,
          type: 'wire',
          bounds: { x: startX, y: busYTop, width: sectionWidth, height: busThickness },
          visual: { type: 'busBar', thickness: LAYOUT_CONSTANTS.BUS_THICKNESS },
          hitZone: {
            // Detached supply frames keep the two short grid/backup rail stubs as
            // first-class insertion points. The surrounding bus container remains
            // non-droppable, so only the explicit rail itself can create a circuit.
            type: 'mainBus',
            padding: panelLayout.frameRole === 'supply' ? 10 : 0,
            mainBusInsertIndex: 0,
            busSectionId: section.id,
          },
          children: [],
        })
      })
    } else if (hasExplicitPanelBusSections(panelLayout.panel) && connectionEntries.length > 0) {
      const splitGap = PANEL_BUS_FEED_GAP
      const drawsHostedFeeders =
        panelLayout.supplyEndpointKind === 'continuation' ||
        (panelLayout.supplyEndpointKind === 'mains' &&
          panelLayout.frameRole === 'panel' && panelLayout.panel.isMain)
      const hostedFeederCounts = new Map(drawsHostedFeeders
        ? (panelLayout.panelLocalFeedStubStacks ?? []).map((stack) =>
            [stack.busSectionId, stack.feeders?.length ?? 0] as const)
        : [])
      const sectionCut = (left: number, right: number) => {
        const previous = connectionEntries[left]!
        const entry = connectionEntries[right]!
        const boundaryX = getSecondaryBusSectionBoundaryX(
          secondaryBusSectionRanges,
          previous.busSectionId,
          entry.busSectionId,
          (previous.x + entry.x) / 2
        )
        const firstOfSection = connectionEntries.findIndex((candidate) =>
          candidate.busSectionId === entry.busSectionId) === right
        return applyHostedFeederSectionCut(
          { leftEndX: boundaryX - splitGap / 2, rightStartX: boundaryX + splitGap / 2 },
          previous.x,
          Math.min(entry.x, ...secondaryBusSectionRanges
            .filter((range) => range.sectionId === entry.busSectionId && range.startX > previous.x)
            .map((range) => range.startX)),
          firstOfSection ? hostedFeederCounts.get(entry.busSectionId) ?? 0 : 0
        )
      }
      connectionEntries.forEach((entry, index) => {
        const previous = connectionEntries[index - 1]
        const next = connectionEntries[index + 1]
        let startX = previous ? (previous.x + entry.x) / 2 : busStartX
        let endX = next ? (entry.x + next.x) / 2 : busEndX
        if (previous && previous.busSectionId !== entry.busSectionId) {
          startX = sectionCut(index - 1, index).rightStartX
        }
        if (next && next.busSectionId !== entry.busSectionId) {
          endX = sectionCut(index, index + 1).leftEndX
        }
        const pushSegment = (
          suffix: 'before' | 'after',
          x: number,
          width: number,
          insertIndex: number
        ) => {
          if (width <= 0) return
          children.push({
            id: `main-bus-segment-${panelLayout.panel.id}-${index}-${suffix}`,
            type: 'wire',
            bounds: { x, y: busYTop, width, height: busThickness },
            visual: { type: 'busBar', thickness: LAYOUT_CONSTANTS.BUS_THICKNESS },
            hitZone: {
              type: panelLayout.frameRole === 'supply' ? null : 'mainBus',
              // Keep the forgiving vertical target, but never expand it
              // horizontally into the neighboring insertion slot.
              padding: 0,
              paddingY: 12,
              mainBusInsertIndex: insertIndex,
              busSectionId: entry.busSectionId,
            },
            children: [],
          })
        }

        // Split-feed bus segments are centered around their protection in the
        // rendered wire layout. Split the hit surface at the protection stem
        // as well, so the two sides retain distinct before/after semantics.
        pushSegment('before', startX, entry.x - startX, index)
        pushSegment('after', entry.x, endX - entry.x, index + 1)
      })
    } else {
      const waypoints: number[] = [busStartX, ...connectionXs, busEndX]
      for (let i = 0; i < waypoints.length - 1; i++) {
        const startX = waypoints[i]!
        const endX = waypoints[i + 1]!
        if (endX <= startX) continue

        children.push({
          id: `main-bus-segment-${panelLayout.panel.id}-${i}`,
          type: 'wire',
          bounds: { x: startX, y: busYTop, width: endX - startX, height: busThickness },
          visual: { type: 'busBar', thickness: LAYOUT_CONSTANTS.BUS_THICKNESS },
          hitZone: {
            type: panelLayout.frameRole === 'supply' ? null : 'mainBus',
            padding: 0,
            paddingY: 12,
            mainBusInsertIndex: i,
          },
          children: [],
        })
      }
    }
  }

  return {
    id: mainBusElement.id,
    type: 'busBar',
    bounds: {
      x: mainBusElement.position.x,
      y: mainBusElement.position.y,
      width: mainBusElement.width || 0,
      height: mainBusElement.height || LAYOUT_CONSTANTS.BUS_THICKNESS,
    },
    visual: {
      type: 'busBar',
      thickness: LAYOUT_CONSTANTS.BUS_THICKNESS,
    },
    hitZone: {
      // Once the bus has explicit child slots, the parent is only a container.
      // Keeping its old full-width padded zone would swallow every precise
      // segment whenever the pointer is just below the rendered bar.
      type:
        panelLayout.frameRole === 'supply' ||
        children.some((child) => child.id?.startsWith('main-bus-segment-'))
          ? null
          : 'mainBus',
      padding: panelLayout.frameRole === 'supply' ? 0 : 12,
    },
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

function buildCircuitConverterDcConnectionNodes(
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
    const linkedDevices = [
      ...(circuit.trunkDevices ?? []),
      ...(circuit.branches ?? []).flatMap((branch) => branch.branchDevices ?? []),
    ].filter(
      (candidate) =>
        candidate.id !== device.id &&
        candidate.converterDcConnection?.converterId === device.id &&
        candidate.converterDcConnection.connectionIndex === connectionIndex
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
    const itemX = (index: number) =>
      chainLength === 1
        ? port.x
        : port.x +
          CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD +
          index * LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING
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
        x:
          linkedDevices.length === 0
            ? endpoints.length === 1
              ? port.x
              : port.x + (endpointOffsets[endpointIndex] ?? CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD)
            : itemX(linkedDevices.length + endpointIndex),
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
        ? `${getEndpointBranchLabelPrefix(circuit)}${connectionIndex + 1}` ||
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
    (b) => b.circuitId === circuitLayout.circuit.id
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

function buildBranchNode(
  panelLayout: BottomUpPanelLayout,
  branch: BranchLayout,
  metadataCallouts?: Map<string, CircuitConverterMetadataCallout>
): LayoutNode | null {
  const children: LayoutNode[] = []
  const constrainSingleEndpointLabel =
    branch.endpoints.length === 1 && branch.endpoints[0]?.type !== 'switch'
  const endpointXs = branch.endpoints.map(
    (endpoint) =>
      panelLayout.elements.find(
        (element) => element.type === 'endpoint' && element.endpointId === endpoint.id
      )?.position.x ?? branch.branchX
  )
  const bottomNoteEndpointIndexes = new Set(
    branch.endpoints.flatMap((endpoint, endpointIndex) => {
      const isRightLabel =
        endpointIndex === branch.endpoints.length - 1 &&
        (endpoint.symbol === 'solar_panel' ||
          endpoint.symbol === 'battery' ||
          endpoint.symbol === 'ev')
      return endpoint.symbol !== 'domotica' && !isRightLabel && getVisibleEndpointNoteText(endpoint) ? [endpointIndex] : []
    })
  )

  // Find branch visual element
  const branchElement = panelLayout.elements.find(
    (e) => e.type === 'branch' && e.branchId === branch.id
  )

  if (!branchElement) {
    return null
  }

  const endpointElements = branch.endpoints.flatMap((endpoint) => {
    const element = panelLayout.elements.find(
      (candidate) => candidate.type === 'endpoint' && candidate.endpointId === endpoint.id
    )
    return element ? [{ endpoint, element }] : []
  })
  const branchMetadataCallouts =
    metadataCallouts ??
    getBranchConverterMetadataCallouts({
      targets: endpointElements.map(({ endpoint, element }) => ({
        endpoint,
        position: element.position,
      })),
      symbolSize: LAYOUT_CONSTANTS.SYMBOL_SIZE,
      segments: [
        {
          startPoint: { x: branch.trunkX, y: branch.branchY },
          endPoint: { x: branch.branchX + branch.branchWidth, y: branch.branchY },
        },
      ],
    })

  // Add endpoints on this branch
  for (const [endpointIndex, endpoint] of branch.endpoints.entries()) {
    const endpointElement = panelLayout.elements.find(
      (e) => e.type === 'endpoint' && e.endpointId === endpoint.id
    )

    if (endpointElement) {
      const crowdedNoteLabelBounds = getCrowdedEndpointNoteLabelBounds(
        endpointIndex,
        endpointXs,
        bottomNoteEndpointIndexes,
        branch.branchX
      )
      const isDomoticaParent = endpoint.symbol === 'domotica'
      const isDomoticaChild = !!endpoint.domoticaChildProps
      const endpointMetadataCallout = branchMetadataCallouts.get(endpoint.id)
      const domoticaEndpointCount = isDomoticaParent
        ? Math.max(
            DOMOTICA_MIN_ENDPOINT_OUTPUTS,
            Math.min(
              DOMOTICA_MAX_ENDPOINT_OUTPUTS,
              Math.trunc(endpoint.domoticaProps?.endpointCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS)
            )
          )
        : DOMOTICA_MIN_ENDPOINT_OUTPUTS
      const domoticaHeight =
        DOMOTICA_BASE_HEIGHT + Math.max(0, domoticaEndpointCount - 1) * DOMOTICA_OUTPUT_SPACING

      // Domotica box is drawn with center at position (EndpointSymbol: x = position.x - BOX_WIDTH/2)
      const endpointNode: LayoutNode = {
        id: endpointElement.id,
        type: 'endpoint',
        bounds: {
          x: endpointElement.position.x,
          y: isDomoticaParent
            ? endpointElement.position.y - domoticaHeight / 2 + DOMOTICA_BASE_HEIGHT / 2
            : endpointElement.position.y,
          width: isDomoticaParent ? DOMOTICA_BOX_WIDTH : LAYOUT_CONSTANTS.SYMBOL_SIZE,
          height: isDomoticaParent ? domoticaHeight : LAYOUT_CONSTANTS.SYMBOL_SIZE,
        },
        domainId: endpoint.id,
        domainRef: endpoint,
        visual: {
          type: 'symbol',
          symbolId: endpoint.symbol || getDefaultSymbolForEndpointType(endpoint.type),
          label: endpoint.label,
          isEndpointAtBranchEnd: endpointIndex === branch.endpoints.length - 1,
          mirrorHorizontally: endpointElement.mirrorEndpointHorizontally,
          bottomLabelMinimumLeftX: constrainSingleEndpointLabel || isDomoticaParent
            ? getEndpointNoteMinimumLeftX(endpointElement.position.x, branch.branchX)
            : bottomNoteEndpointIndexes.has(endpointIndex)
              ? (crowdedNoteLabelBounds?.minimumLeftX ??
                getEndpointNoteMinimumLeftX(endpointElement.position.x, branch.branchX))
              : undefined,
          bottomLabelMaximumRightX: crowdedNoteLabelBounds?.maximumRightX,
          metadataCallout: endpointMetadataCallout
            ? {
                x: endpointMetadataCallout.x,
                y: endpointMetadataCallout.y,
                width: endpointMetadataCallout.width,
                height: endpointMetadataCallout.height,
                leaderPoints: endpointMetadataCallout.leaderPoints,
                leaderSegments: endpointMetadataCallout.leaderSegments,
                targetIds: endpointMetadataCallout.sharedTargetIds,
                totalMultiplier: endpointMetadataCallout.totalMultiplier,
              }
            : undefined,
        },
        hitZone: isDomoticaParent
          ? {
              // Domotica parent hitbox = just its box; wires have their own separate hit zones.
              type: 'endpoint',
              padding: 4,
            }
          : isDomoticaChild
            ? {
                type: 'endpoint',
                // The symbol body owns the center zone. Before/after have
                // narrow wire-aligned zones of their own below.
                padding: 0,
              }
            : {
              type: 'endpoint',
              // Generous padding for regular endpoints so dropping ON the socket (and nearby) reliably targets it.
              padding: 15,
            },
        children: [],
      }

      if (isDomoticaChild || isDomoticaParent) {
        const symbolLeft = endpointElement.position.x - DOMOTICA_CHILD_ON_DROP_ZONE_SIZE / 2
        const symbolRight = endpointElement.position.x + DOMOTICA_CHILD_ON_DROP_ZONE_SIZE / 2
        const sideZoneWidth = 15
        const sideZoneHeight = 20
        const previousEndpointId = branch.endpoints[endpointIndex - 1]?.id ?? null
        const sideZone = (
          id: string,
          x: number,
          intent: 'insertBefore' | 'insertAfter',
          insertAfterEndpointId: string | null
        ): LayoutNode => ({
          id,
          type: 'wire',
          bounds: {
            x,
            y: endpointElement.position.y - sideZoneHeight / 2,
            width: sideZoneWidth,
            height: sideZoneHeight,
          },
          domainId: endpoint.id,
          domainRef: endpoint,
          hitZone: {
            type: 'endpoint',
            padding: 0,
            domoticaChildDropIntent: intent,
            branchInsertAfterEndpointId: insertAfterEndpointId,
          },
          children: [],
        })

        endpointNode.children.push(
          sideZone(
            `${endpointElement.id}-drop-before`,
            symbolLeft - sideZoneWidth,
            'insertBefore',
            previousEndpointId
          )
        )
        if (isDomoticaChild) endpointNode.children.push(
          sideZone(
            `${endpointElement.id}-drop-after`,
            symbolRight,
            'insertAfter',
            endpoint.id
          )
        )
      }

      children.push(endpointNode)

      // Domotica child endpoints: label to the right of the symbol (A1.1, A1.2, …)
      const rowLabel = getDomoticaRowLabelPlacement(panelLayout, branch.endpoints, endpoint)
      if (rowLabel) {
        children.push({
          id: `${endpointElement.id}-label`,
          type: 'label',
          bounds: {
            x: rowLabel.x,
            y: rowLabel.y,
            width: 80,
            height: 20,
          },
          visual: {
            type: 'label',
            text: rowLabel.text,
            align: 'left',
          },
          children: [],
        })
      }

      if (isDomoticaParent) {
        // Match deriveWires: variable part only (no BASE_HEIGHT) for output Y positioning
        const domoticaVariableHeight =
          Math.max(0, domoticaEndpointCount - 1) * DOMOTICA_OUTPUT_SPACING
        // Box center = position.x (EndpointSymbol draws box centered at position)
        const boxRightX = endpointElement.position.x + DOMOTICA_BOX_WIDTH / 2

        // Same as deriveWires: firstOutputY = branchY - domoticaVariableHeight
        const firstOutputY = endpointElement.position.y - domoticaVariableHeight
        for (let index = 0; index < domoticaEndpointCount; index++) {
          const outputY = firstOutputY + index * DOMOTICA_OUTPUT_SPACING
          // Hit zone overlaps box right edge and extends right along the wire for reliable drop detection
          const zoneWidth = DOMOTICA_BRANCH_LEAD + 30
          children.push({
            id: `${endpointElement.id}-domotica-endpoint-output-${index}`,
            type: 'wire',
            bounds: {
              x: boxRightX,
              y: outputY - 7.5,
              width: zoneWidth,
              height: 15,
            },
            domainId: endpoint.id,
            domainRef: endpoint,
            hitZone: {
              type: 'endpoint',
              padding: 14,
              outputGroup: 'endpoint',
              outputIndex: index,
            },
            children: [],
          })
        }

        const endpointSlots = endpoint.domoticaProps?.endpointChildEndpointIds ?? []
        const currentSlotsAreFull = Array.from({ length: domoticaEndpointCount }).every(
          (_, index) => {
            const childId = endpointSlots[index]
            return typeof childId === 'string' && childId.trim().length > 0
          }
        )
        if (currentSlotsAreFull && domoticaEndpointCount < DOMOTICA_MAX_ENDPOINT_OUTPUTS) {
          children.push({
            id: `${endpointElement.id}-domotica-endpoint-output-expand`,
            type: 'wire',
            bounds: {
              x: boxRightX,
              y: endpointElement.position.y + DOMOTICA_OUTPUT_SPACING / 2 - 10,
              width: DOMOTICA_BRANCH_LEAD + 18,
              height: 20,
            },
            domainId: endpoint.id,
            domainRef: endpoint,
            hitZone: {
              type: 'endpoint',
              padding: 12,
              outputGroup: 'endpoint',
              outputIndex: domoticaEndpointCount,
              outputExpands: true,
            },
            children: [],
          })
        }
      }
    }
  }

  // Note: sub-panel symbols are handled in buildMcbNode (directly on MCB, not on a branch)

  // Add branch label
  const branchLabelElement = panelLayout.elements.find(
    (e) => e.type === 'label' && e.branchId === branch.id
  )
  if (branchLabelElement) {
    children.push({
      id: branchLabelElement.id,
      type: 'label',
      bounds: {
        x: branchLabelElement.position.x,
        y: branchLabelElement.position.y,
        width: 100,
        height: 20,
      },
      visual: {
        type: 'label',
        text: branchLabelElement.label || '',
        fontSize: 12,
        // Right-align branch labels so the right edge of the text box
        // sits at the layout-provided X (offset from trunk wire).
        align: 'right',
      },
      children: [],
    })
  }

  // Bounds include full horizontal wire: from trunk to end of branch (so drop on wire = circuit)
  const pad = 10
  const wireLeft = Math.min(branch.trunkX, branch.branchX)
  const wireRight = Math.max(branch.trunkX, branch.branchX + branch.branchWidth)
  const wireTop = branch.branchY - pad
  const wireHeight = pad * 2

  return {
    id: branchElement.id,
    type: 'branch',
    bounds: {
      x: wireLeft,
      y: wireTop,
      width: wireRight - wireLeft,
      height: wireHeight,
    },
    domainId: branch.id,
    hitZone: {
      type: 'circuit',
      padding: 0,
    },
    children,
  }
}

function getNestedDcBusConverterIds(circuit: Circuit): Set<string> {
  return new Set(
    (circuit.branches ?? []).flatMap((branch) =>
      (branch.branchDevices ?? []).flatMap((device) =>
        supportsCircuitConverterDcConnections(device) ? [device.id] : []
      )
    )
  )
}

function isNestedDcBusConverterOutput(
  item: Pick<Endpoint | TrunkDevice, 'converterDcConnection'>,
  nestedConverterIds: ReadonlySet<string>
): boolean {
  return (
    !!item.converterDcConnection && nestedConverterIds.has(item.converterDcConnection.converterId)
  )
}

function buildNestedDcBusConverterNode(
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
      panelLayout,
      circuit,
      device,
      anchor,
      metadataCallouts
    ),
  }
}

function buildOrdinaryDcBusEndpointBranchNodes(
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

function getDefaultSymbolForEndpointType(type: string): string {
  switch (type) {
    case 'socket':
      return 'socket_gnd_child'
    case 'light_point':
      return 'light_point'
    case 'switch':
      return 'switch'
    case 'fixed_appliance':
      return 'fixed_appliance_generic'
    case 'domotica':
      return 'domotica'
    default:
      return 'light_point'
  }
}
