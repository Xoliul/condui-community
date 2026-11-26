/**
 * Bottom-up one-wire layout: public layout contracts and project-level panel placement.
 *
 * The panel pipeline measures circuit columns, positions supply devices, solves metadata
 * and circuit notes, materializes electrical elements, then packs the frame and info block.
 * Phases pass existing arrays, maps and closures through unchanged; scalar extents flow
 * explicitly between them.
 */
import { getSupplyDiagramId } from '@/lib/layout/supplyFrameRole'
import {
  getTopmostCircuitBranch,
  getCircuitLineTopY,
  hasPanelAttachmentOnSecondaryBus,
} from './bottomUpCircuitGeometry'
export {
  CIRCUIT_NOTES_VERTICAL_OFFSET,
  PROTECTION_LABEL_FONT_SIZE,
  PROTECTION_LABEL_CHAR_WIDTH,
  PROTECTION_LABEL_MIN_WIDTH,
  PROTECTION_LABEL_MAX_WIDTH,
  PROTECTION_LABEL_DEFAULT_BOX_WIDTH,
  PROTECTION_LABEL_X_OFFSET_FROM_MCB,
  SPD_PROTECTION_LABEL_X_OFFSET_FROM_TRUNK,
  SPD_PROTECTION_LABEL_Y_OFFSET,
  PROTECTION_TECHNICAL_LABEL_OFFSET_FROM_SYMBOL,
  estimateProtectionNameLabelWidth,
  getCircuitLabelVisualRect,
  isPanelOnlySubPanelFeeder,
  hasPanelAttachmentOnSecondaryBus,
  getProtectionLabelXOffset,
  getProtectionLabelYOffset,
} from './bottomUpCircuitGeometry'

export { SUPPLY_CHANGEOVER_PORT_OFFSET, planConverterInputTap } from './bottomUpSupplyGeometry'
import { DETACHED_SUPPLY_MAIN_BUS_TOP_OFFSET, LAYOUT_CONSTANTS } from './bottomUpLayoutConstants'
import type { BottomUpPanelLayoutOptions } from './bottomUpPanelLayoutInput'
import { calculatePanelCircuitLayout } from './bottomUpCircuitLayout'
import { calculatePanelSupplyLayout } from './bottomUpSupplyLayout'
import { measurePanelSupplyMetadata } from './bottomUpSupplyMetadata'
import { placePanelCircuitNotes } from './bottomUpCircuitNotes'
import { buildPanelCircuitElements } from './bottomUpCircuitElements'
import { buildPanelLayoutFrame } from './bottomUpPanelFrame'

export { LAYOUT_CONSTANTS, MAIN_BUS_RENDER_STROKE_WIDTH } from './bottomUpLayoutConstants'

import {
  alignCompactInlineSupplyBusWithAnchors,
  applyPanelFrameBottomAlignmentByRow,
  applyShiftToPanelLayout,
  expandPanelFrameLeftForMirroredSupply,
  getManualOverrideFrameShift,
  mirrorDetachedSupplyPanelLayoutHorizontally,
  mirrorInlineSupplyPanelLayoutHorizontally,
  reflowSupplyInfoBlockAfterMirror,
} from './bottomUpPanelTransforms'
export {
  mirrorDetachedSupplyPanelLayoutHorizontally,
  mirrorInlineSupplyPanelLayoutHorizontally,
} from './bottomUpPanelTransforms'

import { logger } from '@/lib/logger'
import { COMPACT_PANEL_THRESHOLD, packPanelGroup } from './compactPanelPacking'

import type {
  Circuit,
  ProtectionDevice,
  Panel,
  Installation,
  TrunkDevice,
  Endpoint,
} from '@/types/schema'
import type { Point } from '@/types/ui'
import type { TrunkLayout, BranchLayout } from './wireSegments'
import { isVirtualPanel } from '@/lib/supplyTaps/virtualPanel'
import {
  addSupplyTapsToDiagramPanel,
  getSupplyTapCircuitIds,
  getSupplyTapGroups,
  getSupplyTapPaintBlocks,
  measureSupplyTapGroups,
  splitSupplyTapCircuitLayouts,
  splitSupplyTapTrunks,
  splitSupplyTapLayouts,
  translateSupplyTapGeometry,
  type SupplyTapPlacement,
} from './supplyTapLayout'

import { getInfoBlockColumns } from '@/lib/infoBlockLayout'
import { getProjectInfoBlockHeight } from '@/lib/infoBlockContent'
import { ensureInstallationFeedTopology } from '@/lib/feedTopology'

import type { FeedStubFeeder } from './feedStubFeeders'
import { PANEL_BUS_FEED_GAP } from '@/lib/panel/panelBusFeedPreview'

import { getGroundElementId } from '@/lib/eendraad/panelGround'

import {
  type PanelSupplyLink,
  resolvePanelSupplyLinkForPanel,
  resolvePanelSupplyLinksForSourcePanel,
  isDomoticaPanelFeedEndpoint,
} from '@/lib/eendraad/panelSupplyLink'
import { getDomoticaEndpointOutputLabel } from '@/lib/eendraad/domoticaRowLabel'

import { buildControlLinkNoteMap } from '@/lib/controlLink/controlLink'
import { runWithControlLinkNotes } from '@/lib/controlLink/controlLinkNoteContext'

import type { SupplyMetadataCalloutRect } from '@/lib/supplyMetadataCallout'

import { hasExplicitPanelBusSections } from '@/lib/panel/panelBusSections'

import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

import { getCircuitNotesPaintBounds } from './circuitNoteMetrics'
import type { OneWireLayoutBlock } from './oneWireBlockLayout'

import type { SupplyTopLabelPlacement } from './supplyTopLabelLayout'
import {
  getSupplyAssemblyPanelRole,
  isPanelBehindSharedSupplyTransformer,
  isPanelSupplyFrameDetached,
  ownsDetachedSupplyFrame,
} from './supplyFrameDetachment'
import { collectConductorMarkGaps } from './conductorMarkSpacing'
import { selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
import { clonePanelForDiagramRole } from './clonePanelForDiagramRole'
export { estimateCircuitNotesWidth } from './circuitNoteMetrics'

/**
 * A feeder note belongs above the secondary-panel symbol that caps its trunk.
 * The symbol is attached after the initial circuit-note pass because its exact
 * position can depend on nested-panel routing. Keep the note and frame in sync
 * once that final position is known.
 */
function placeCircuitNoteAboveSecondaryPanel(
  panelLayout: BottomUpPanelLayout,
  circuitId: string,
  panelSymbolY: number
): void {
  const note = panelLayout.circuitNotes?.find((candidate) => candidate.circuitId === circuitId)
  if (!note) return

  const paintBounds = getCircuitNotesPaintBounds(note.label, note.notesOrientation)
  const noteTopBeforeMove = note.y + paintBounds.top
  const panelTopY = panelSymbolY - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
  const NOTE_TO_PANEL_GAP = 4
  const desiredNoteY = panelTopY - NOTE_TO_PANEL_GAP - paintBounds.bottom

  // Leave an already-higher note alone; it may have been lifted to make room
  // for another note sharing the same trunk.
  if (note.y <= desiredNoteY) return

  note.y = desiredNoteY
  const noteElement = panelLayout.elements.find(
    (element) => element.id === `circuit-notes-${circuitId}`
  )
  if (noteElement) {
    noteElement.position.y = desiredNoteY
  }

  // Preserve the frame's existing clearance above this label as it moves up.
  // Without this, the canvas frame and exported scene can clip a long rotated
  // note even though its anchor correctly clears the secondary panel.
  const noteTopAfterMove = desiredNoteY + paintBounds.top
  const existingTopClearance = Math.max(0, noteTopBeforeMove - panelLayout.frame.y)
  const desiredFrameY = noteTopAfterMove - existingTopClearance
  if (desiredFrameY < panelLayout.frame.y) {
    panelLayout.frame.height += panelLayout.frame.y - desiredFrameY
    panelLayout.frame.y = desiredFrameY
  }
}

export interface BottomUpLayoutElement {
  id: string
  type:
    | 'supply'
    | 'ground'
    | 'mainBus'
    | 'protection'
    | 'rcd'
    | 'endpoint'
    | 'label'
    | 'trunk'
    | 'branch'
    | 'trunkDevice'
  position: Point
  width?: number
  height?: number
  circuitId?: string
  protectionId?: string
  endpointId?: string
  trunkDeviceId?: string
  label?: string
  trunkId?: string
  branchId?: string
  /** Mirror endpoint artwork on branches that run left instead of right. */
  mirrorEndpointHorizontally?: boolean
  /** Resolve this user-facing label through i18n at render/export time. */
  translationKey?: string
  /** For circuit-notes labels: draw horizontal or vertical. */
  notesOrientation?: 'horizontal' | 'vertical'
  /** For circuit-notes labels: if false, do not draw (slot still reserved for stable layout). */
  notesVisible?: boolean
}

export interface BottomUpCircuitLayout {
  circuit: Circuit
  protection: ProtectionDevice | null
  parentRcd: ProtectionDevice | null
  parentCircuit: Circuit | null // Parent circuit if this is a nested circuit
  x: number
  width: number
  /** Space reserved to the left of the protection/wire anchor for left-side labels. */
  leftReserve: number
  /** Riser x of each column from the circuit anchor, for a circuit drawn in columns (circuitColumns.ts). */
  columnAnchorOffsets?: number[]
  protectionY: number
  trunkY?: number
  branch: BranchLayout | null
  secondaryBusY?: number // Y position of secondary bus bar (for nested circuits)
  wireLabelSpan?: number
}

export interface BottomUpPanelLayout {
  panel: Panel
  /** Unique render/export identity. Virtual frames share the owning panel id. */
  diagramId?: string
  /** Ordinary electrical panel frame or a non-persisted detached supply frame. */
  frameRole?: 'panel' | 'supply'
  /** Electrical panel that owns interactions and persisted supply topology. */
  ownerPanelId?: string
  /** Sub-panel feeder drawn at its natural length (previews); see `subPanelFeedAnchorY`. */
  compactSubPanelFeed?: boolean
  /** How the lower supply endpoint is represented in this frame. */
  supplyEndpointKind?: 'mains' | 'continuation'
  /**
   * Splice index into this panel's root feed for the first panel-local device on a
   * continuation handoff wire. Skips assembly-owned upstream devices that live in the
   * detached supply frame so one-wire drops append into the panel-only chain.
   */
  panelLocalRootSupplyInsertBase?: number
  /** Bus section receiving the panel-local root-feed devices. */
  panelLocalRootBusSectionId?: string
  /** Panel-side device chains on each split-bus feed stub, including empty sections. */
  panelLocalFeedStubStacks?: Array<{
    busSectionId: string
    insertBase: number
    devices: TrunkDevice[]
    /** Other main panels' stub devices mounted in this panel, tapped from this stub. */
    feeders?: FeedStubFeeder[]
    /** Panel feeding this stub when its supply-side device is mounted there. */
    sourcePanelId?: string
    sourcePanelName?: string
  }>
  /** Empty inline split rails follow the mirrored supply risers. */
  inlineEmptySplitRails?: boolean
  /** Visual direction of the supply chain. */
  supplyFlowDirection?: 'right-to-left' | 'left-to-right'
  /** Stable axis used to mirror supply geometry without mirroring symbol artwork or text. */
  supplyMirrorAxisX?: number
  /** The implicit supply-only rail follows the mirrored supply connection. */
  compactInlineSupplyBus?: boolean
  /** Horizontal room reserved during panel placement, applied to the frame after placement. */
  supplyFrameLeftExpansion?: number
  elements: BottomUpLayoutElement[]
  /** Circuit notes labels for eendraad canvas + export overlay (single source of truth). */
  circuitNotes?: Array<{
    circuitId: string
    x: number
    y: number
    label: string
    notesOrientation: 'horizontal' | 'vertical'
    notesVisible: boolean
  }>
  circuits: BottomUpCircuitLayout[]
  trunks: TrunkLayout[]
  branches: BranchLayout[]
  mainBus: {
    x: number
    y: number
    width: number
  }
  supply: {
    x: number
    y: number
  }
  /** Bend point where supply wire turns from vertical to horizontal (main panel; includes empty-trunk minimum stub) */
  supplyBend?: {
    x: number
    y: number
  }
  /** Positioned supply trunk device elements (energy meters, protections on supply wire) */
  supplyDevices?: Array<{
    device: import('@/types/schema').TrunkDevice
    x: number
    y: number
    feedScope: 'shared' | 'root'
    feedIndex: number
    /** Final card bounds in the same coordinate system as the measured layout blocks. */
    metadataCalloutRect?: SupplyMetadataCalloutRect
    /** Wrapped and collision-solved labels anchored above this supply device. */
    topLabelPlacements?: SupplyTopLabelPlacement[]
  }>
  /**
   * Taps of the owner's supply-taps board, drawn on the grid lane of a detached supply frame.
   * Canonical geometry: where each tap leaves the lane and how high it reaches.
   */
  supplyTaps?: SupplyTapPlacement[]
  /** Orthogonal upper backup and lower grid lanes exposed by a modular source changeover. */
  supplyChangeoverBranches?: {
    deviceId: string
    x: number
    y: number
    elbowX: number
    upperY: number
    lowerY: number
    slotEndX: number
    /**
     * Present when changeover port 1 is fed from the inverter's grid-input leg: the T junction
     * on that leg (`x`, `y`) and the port-1 riser (`riserX`) that now ends at the T's height.
     * Devices above the T feed only the inverter, devices below it are shared by the inverter
     * and port 1; port-1 devices stay on the riser.
     */
    converterInputTap?: { x: number; y: number; riserX: number }
  }
  /** Effective changeover grid source when it differs from the historical main-grid tap. */
  supplyChangeoverGridSource?: 'converter-input'
  /** Supply devices on a multi-device converter DC top lane, drawn as a horizontal chain. */
  supplyHorizontalDcLaneDeviceIds?: ReadonlySet<string>
  /** Grid-connected converter branch without a source changeover. */
  supplyConverterBranch?: {
    deviceId: string
    x: number
    y: number
    lineY: number
    dcEndX: number
    dcTopY?: number
    dcTopEndX?: number
    dcPorts?: Array<{
      connectionIndex: number
      x: number
      y: number
      endX: number
    }>
  }
  /** Optional protected load circuit leaving the left AC backup port of a direct converter. */
  supplyConverterBackup?: {
    converterId: string
    x1: number
    x2: number
    y: number
    circuitId?: string
    protectionId?: string
  }
  /** @deprecated Detached feed frames now use a nearby text-only destination label. */
  feedOutput?: {
    x: number
    busY: number
    endY: number
  }
  ground?: {
    x: number
    y: number
  }
  /** Positioned ground trunk device elements (earthing separators on ground wire) */
  groundDevices?: Array<{
    device: import('@/types/schema').TrunkDevice
    x: number
    y: number
  }>
  frame: {
    x: number
    y: number
    width: number
    height: number
  }
  /** Measured non-circuit blocks used by collision layout and the dev debug overlay. */
  layoutBlocks?: OneWireLayoutBlock[]
  // Sub-panel information
  isSubPanel?: boolean
  parentMcb?: {
    protection: ProtectionDevice
    circuit: Circuit
    position: Point
    sourceEndpoint?: Endpoint
  }
}

export function getPanelDiagramId(panelLayout: BottomUpPanelLayout): string {
  return panelLayout.diagramId ?? panelLayout.panel.id
}

/** Inputs that live outside the project but change the drawing's geometry. */
export interface BottomUpLayoutOptions {
  /** Effective profile geometry must match the rendered info block. */
  infoBlockLogo?: boolean
  infoBlockHeight?: number
  /**
   * Draw a sub-panel's incoming feeder at its natural length instead of reserving room for an
   * inserted feeder device. For small read-only previews only; the editor keeps the default.
   */
  compactSubPanelFeed?: boolean
}

export interface BottomUpLayoutResult {
  panels: BottomUpPanelLayout[]
  totalWidth: number
  totalHeight: number
  /** Resolved control-link note text per endpoint id; lets later passes re-enter the same scope. */
  controlLinkNotes?: ReadonlyMap<string, string>
  /** Laid out with the installer logo column; derived previews must reuse it. */
  infoBlockLogo?: boolean
  infoBlockHeight?: number
}

/**
 * Flatten panels for rendering
 */
interface FlatPanelInfo {
  panel: Panel
  parentPanel?: Panel
  depth: number
}

function flattenPanelsForRendering(panels: Panel[]): FlatPanelInfo[] {
  const result: FlatPanelInfo[] = []
  const flatten = (panelList: Panel[], parent?: Panel, depth = 0) => {
    for (const panel of panelList) {
      // A virtual board has no frame of its own; boards it feeds hang from its owner.
      if (isVirtualPanel(panel)) {
        flatten(panel.subPanels, parent, depth)
        continue
      }
      result.push({ panel, parentPanel: parent, depth })
      flatten(panel.subPanels, panel, depth + 1)
    }
  }
  flatten(panels)
  return result
}

function getPanelSupplyLinkSortX(
  sourcePanelLayout: BottomUpPanelLayout | undefined,
  link: PanelSupplyLink
): number {
  if (!sourcePanelLayout) return Number.POSITIVE_INFINITY

  if (link.feederCircuit) {
    const branchXs = sourcePanelLayout.branches
      .filter((branch) => branch.circuitId === link.feederCircuit!.id)
      .map((branch) => branch.trunkX)
    if (branchXs.length > 0) return Math.min(...branchXs)

    const circuitLayout = sourcePanelLayout.circuits.find(
      (circuit) => circuit.circuit.id === link.feederCircuit!.id
    )
    if (circuitLayout) return circuitLayout.x
  }

  const protectionElement = sourcePanelLayout.elements.find(
    (element) => element.protectionId === link.protection.id
  )
  return protectionElement?.position.x ?? Number.POSITIVE_INFINITY
}

function createOrderedPanelChildrenResolver(
  project: ProjectWithOptionalV2Electrical,
  panelLayoutById: Map<string, BottomUpPanelLayout>
): (panel: Panel) => Panel[] {
  return (panel: Panel): Panel[] => {
    const children = (panel.subPanels ?? []).filter((child) => !isVirtualPanel(child))
    if (children.length <= 1) return children

    const fallbackIndexById = new Map(children.map((child, index) => [child.id, index]))
    const childIdSet = new Set(children.map((child) => child.id))
    const sourcePanelLayout = panelLayoutById.get(panel.id)
    const orderedLinks = resolvePanelSupplyLinksForSourcePanel(project, panel)
      .filter((link) => childIdSet.has(link.targetPanel.id))
      .sort((a, b) => {
        const ax = getPanelSupplyLinkSortX(sourcePanelLayout, a)
        const bx = getPanelSupplyLinkSortX(sourcePanelLayout, b)
        if (ax !== bx) return ax - bx
        return (
          (fallbackIndexById.get(a.targetPanel.id) ?? Number.POSITIVE_INFINITY) -
          (fallbackIndexById.get(b.targetPanel.id) ?? Number.POSITIVE_INFINITY)
        )
      })

    const orderByChildId = new Map(orderedLinks.map((link, index) => [link.targetPanel.id, index]))

    return [...children].sort((a, b) => {
      const ai = orderByChildId.get(a.id)
      const bi = orderByChildId.get(b.id)
      if (ai != null && bi != null) return ai - bi
      if (ai != null) return -1
      if (bi != null) return 1
      return (fallbackIndexById.get(a.id) ?? 0) - (fallbackIndexById.get(b.id) ?? 0)
    })
  }
}

function flattenPanelsForPlacement(
  panels: Panel[],
  getOrderedChildren: (panel: Panel) => Panel[]
): FlatPanelInfo[] {
  const result: FlatPanelInfo[] = []
  const flatten = (panelList: Panel[], parent?: Panel, depth = 0) => {
    for (const panel of panelList) {
      result.push({ panel, parentPanel: parent, depth })
      flatten(getOrderedChildren(panel), panel, depth + 1)
    }
  }
  flatten(panels)
  return result
}
/**
 * Find parent MCB protection device for a sub-panel
 */
function findParentMcbForSubPanel(
  project: ProjectWithOptionalV2Electrical,
  subPanel: Panel
): {
  protection: ProtectionDevice
  circuit: Circuit
  parentPanel: Panel
  sourceEndpoint?: Endpoint
} | null {
  const link = resolvePanelSupplyLinkForPanel(project, subPanel.id)
  if (link?.feederCircuit) {
    return {
      protection: link.protection,
      circuit: link.feederCircuit,
      parentPanel: link.sourcePanel,
      sourceEndpoint: isDomoticaPanelFeedEndpoint(link.sourcePanelEndpoint)
        ? link.sourcePanelEndpoint
        : undefined,
    }
  }

  if (link) {
    logger.warn('findParentMcbForSubPanel: Protection found but no circuit', {
      subPanelId: subPanel.id,
      protectionId: link.protection.id,
      circuits: link.protection.circuits,
    })
    return null
  }

  logger.warn('findParentMcbForSubPanel: No MCB found for sub-panel', {
    subPanelId: subPanel.id,
    subPanelName: subPanel.name,
  })
  return null
}

function calculateBottomUpPanelLayout(
  project: ProjectWithOptionalV2Electrical,
  panel: Panel,
  manualOverrides?: Map<string, Point>,
  frameOffset: Point = { x: 0, y: 0 },
  parentMcbInfo?: {
    protection: ProtectionDevice
    circuit: Circuit
    parentPanel: Panel
    sourceEndpoint?: Endpoint
  } | null,
  installation?: Installation,
  rootPanels?: Panel[],
  options: BottomUpPanelLayoutOptions = {}
): BottomUpPanelLayout {
  const circuitLayout = calculatePanelCircuitLayout({
    project,
    panel,
    manualOverrides,
    parentMcbInfo,
    installation,
    rootPanels,
    options,
  })
  // Taps of the owner's supply-taps board (detached supply frame only) are measured on the
  // provisional bus, positioned by the supply pass and then moved onto the grid lane.
  const tapGroups = getSupplyTapGroups(panel)
  const tapMeasures = measureSupplyTapGroups(
    tapGroups,
    circuitLayout.circuitLayouts,
    circuitLayout.trunks,
    circuitLayout.branches,
    circuitLayout.mainBusY
  )
  const supplyLayout = calculatePanelSupplyLayout({
    supplyTaps: tapMeasures,
    project,
    panel,
    parentMcbInfo,
    installation,
    rootPanels,
    options,
    supplyTrunkNotesOrientation: circuitLayout.supplyTrunkNotesOrientation,
    circuitLayouts: circuitLayout.circuitLayouts,
    hostedFeedersBySection: circuitLayout.hostedFeedersBySection,
    mainBusX: circuitLayout.mainBusX,
    mainBusY: circuitLayout.mainBusY,
    branches: circuitLayout.branches,
  })
  const supplyMetadata = measurePanelSupplyMetadata({
    project,
    installation,
    rootPanels,
    panel,
    parentMcbInfo,
    options,
    supplyTrunkNotesOrientation: circuitLayout.supplyTrunkNotesOrientation,
    mainBusX: circuitLayout.mainBusX,
    mainBusWidth: circuitLayout.mainBusWidth,
    mainBusY: circuitLayout.mainBusY,
    minY: circuitLayout.minY,
    maxY: circuitLayout.maxY,
    isSubPanel: supplyLayout.isSubPanel,
    supplyY: supplyLayout.supplyY,
    groundX: supplyLayout.groundX,
    groundY: supplyLayout.groundY,
    groundTrunkDevices: supplyLayout.groundTrunkDevices,
    groundDevicePositions: supplyLayout.groundDevicePositions,
    supplyX: supplyLayout.supplyX,
    supplyBendX: supplyLayout.supplyBendX,
    panelLocalFeedStubStacks: supplyLayout.panelLocalFeedStubStacks,
    supplyTrunkDevices: supplyLayout.supplyTrunkDevices,
    hasSupplyChangeover: supplyLayout.hasSupplyChangeover,
    usesConverterInputTap: supplyLayout.usesConverterInputTap,
    supplyOrientationContext: supplyLayout.supplyOrientationContext,
    isVerticalPositionedSupplyDevice: supplyLayout.isVerticalPositionedSupplyDevice,
    changeoverElbowLead: supplyLayout.changeoverElbowLead,
    hasDirectConverter: supplyLayout.hasDirectConverter,
    backupOutputDeviceCount: supplyLayout.backupOutputDeviceCount,
    changeoverGridDeviceCount: supplyLayout.changeoverGridDeviceCount,
    changeoverGridInputLegDeviceCount: supplyLayout.changeoverGridInputLegDeviceCount,
    inlineSupplyConverter: supplyLayout.inlineSupplyConverter,
    supplySourceY: supplyLayout.supplySourceY,
    supplyDevicePositions: supplyLayout.supplyDevicePositions,
    supplyConverterInputTap: supplyLayout.supplyConverterInputTap,
  })
  const { mainBusX, mainBusWidth, mainBusY } = circuitLayout
  const {
    isSubPanel,
    hasGround,
    supplyY,
    groundX,
    supplyBendX,
    supplySourceY,
    supplyDevicePositions,
  } = supplyLayout
  const {
    supplyX,
    usesInlineEmptySplitRails,
    usesCompactPanelMainBus,
    usesInlineSupplyOnlyCompactRail,
    renderedMainBusY,
    renderedGroundY,
    renderedGroundDevicePositions,
    supplyRightExtent,
  } = supplyMetadata
  // Build layout elements
  const elements: BottomUpLayoutElement[] = []
  // A protection can temporarily own both a parent circuit and a preserved
  // nested feeder after a linked-panel protection is removed. Those circuit
  // rows share one physical protection, so its user-facing label must be
  // emitted only once.
  const renderedProtectionLabelIds = new Set<string>()

  // Ground - show for main panels from installation, or for secondary boards with a local stem
  if (hasGround) {
    elements.push({
      id: getGroundElementId(panel),
      type: 'ground',
      position: { x: groundX, y: renderedGroundY }, // LOCAL coordinates
    })

    // Ground trunk device elements
    renderedGroundDevicePositions.forEach(({ device, x, y }) => {
      elements.push({
        id: `groundTrunkDevice-${device.id}`,
        type: 'trunkDevice',
        position: { x, y }, // LOCAL coordinates
        trunkDeviceId: device.id,
        label: device.label,
      })
    })
  }

  // Supply - only show for main panels, not sub-panels
  if (!isSubPanel) {
    elements.push({
      id: 'supply',
      type: 'supply',
      position: { x: supplyX, y: supplySourceY }, // LOCAL coordinates
    })
    // Compact panel-only handoff frames use the bus stubs themselves as the
    // supply indicator. Repeating the generic "Voeding" label there makes the
    // two stub markers look like a third feed and collides with their labels.
    if (
      options.supplyEndpointKind === 'continuation' &&
      !supplyDevicePositions.some(({ device }) => device.type === 'protection') &&
      !usesCompactPanelMainBus &&
      !hasExplicitPanelBusSections(panel)
    ) {
      elements.push({
        id: 'supply-continuation-label',
        type: 'label',
        position: { x: supplyBendX + 34, y: supplySourceY - 8 },
        translationKey: 'canvas.supplyFrame.supplyLabel',
      })
    }

    // Supply trunk device elements
    supplyDevicePositions.forEach(({ device, x, y }) => {
      elements.push({
        id: `supplyTrunkDevice-${device.id}`,
        type: 'trunkDevice',
        position: { x, y }, // LOCAL coordinates
        trunkDeviceId: device.id,
        label: device.label,
      })
    })
  } else {
    // For sub-panels, show the parent MCB symbol instead of supply
    // Position it where supply would be (at the bottom)
    if (parentMcbInfo) {
      elements.push({
        id: 'parent-mcb',
        type: 'protection',
        position: { x: supplyX, y: supplyY }, // LOCAL coordinates
        protectionId: parentMcbInfo.protection.id,
        circuitId: parentMcbInfo.circuit.id,
      })

      const upstreamProtectionLabel = parentMcbInfo.sourceEndpoint
        ? getDomoticaEndpointOutputLabel(parentMcbInfo.circuit, parentMcbInfo.sourceEndpoint)
        : (parentMcbInfo.protection.label ?? '').trim()
      if (upstreamProtectionLabel) {
        elements.push({
          id: 'parent-mcb-label',
          type: 'label',
          position: {
            x: supplyX,
            y: supplyY,
          },
          label: `← ${upstreamProtectionLabel}`,
          circuitId: parentMcbInfo.circuit.id,
        })
      }
    }
  }

  // Include the receiving chain even in detached panels: mirroring that chain
  // places its bus connection beyond the compact bend used by empty rails.
  const compactSupplyRailWidth = Math.max(groundX, supplyBendX) - mainBusX + 15
  const inlineSplitRailWidth = 32
  const inlineSplitBusWidth =
    (panel.busSections?.length ?? 2) * inlineSplitRailWidth +
    Math.max(0, (panel.busSections?.length ?? 2) - 1) * PANEL_BUS_FEED_GAP
  const mainBusWidthWithSupply = Math.max(
    mainBusWidth,
    supplyRightExtent - mainBusX + LAYOUT_CONSTANTS.SUPPLY_RIGHT_FRAME_PADDING
  )
  const renderedMainBusWidth = usesInlineEmptySplitRails
    ? inlineSplitBusWidth
    : options.feedOutput || usesCompactPanelMainBus || usesInlineSupplyOnlyCompactRail
      ? compactSupplyRailWidth
      : mainBusWidthWithSupply
  elements.push({
    id: `mainBus-${panel.id}`,
    type: 'mainBus',
    position: { x: mainBusX, y: renderedMainBusY }, // LOCAL coordinates
    width: renderedMainBusWidth,
    height: LAYOUT_CONSTANTS.BUS_THICKNESS,
  })
  if (options.feedOutput) {
    elements.push({
      id: 'feed-output-label',
      type: 'label',
      position: {
        x: mainBusX + renderedMainBusWidth / 2,
        // CircuitLabel renders from y - 7 with an 11 px font, so this leaves
        // roughly four pixels between the visible text bottom and the bus.
        y: mainBusY - 10,
      },
      label: options.feedOutputLabel ?? panel.name,
    })
  }

  // Tap items leave the ordinary board pass: they are translated onto the grid lane and laid
  // out against that lane instead of the bus. Taps the supply cannot host are not drawn.
  const tapPlacements = supplyLayout.supplyTapPlacements
  const tapCircuitIds = getSupplyTapCircuitIds(panel)
  const placedTapMeasures = tapMeasures.filter((measure) =>
    tapPlacements.some((placement) => placement.id === measure.id)
  )
  const drawnTapCircuitIds = new Set(placedTapMeasures.flatMap((measure) => [...measure.circuitIds]))
  const drawnTapProtectionIds = new Set(
    placedTapMeasures.flatMap((measure) => (measure.protectionId ? [measure.protectionId] : []))
  )
  const allTapProtectionIds = new Set(
    tapGroups.flatMap((group) => (group.protectionId ? [group.protectionId] : []))
  )
  const layoutSplit = splitSupplyTapCircuitLayouts(tapCircuitIds, circuitLayout.circuitLayouts)
  const trunkSplit = splitSupplyTapTrunks(tapCircuitIds, circuitLayout.trunks, allTapProtectionIds)
  const branchSplit = splitSupplyTapLayouts(tapCircuitIds, circuitLayout.branches)
  const tapParts = {
    circuitLayouts: layoutSplit.tap.filter((layout) => drawnTapCircuitIds.has(layout.circuit.id)),
    trunks: trunkSplit.tap.filter(
      (trunk) =>
        drawnTapProtectionIds.has(trunk.protectionId) ||
        trunk.circuits.some((circuit) => drawnTapCircuitIds.has(circuit.id))
    ),
    branches: branchSplit.tap.filter((branch) => drawnTapCircuitIds.has(branch.circuitId)),
  }
  for (const placement of tapPlacements) {
    const measure = placedTapMeasures.find((candidate) => candidate.id === placement.id)
    if (!measure) continue
    translateSupplyTapGeometry(
      measure,
      tapParts,
      placement.x - measure.anchorX,
      placement.laneY - circuitLayout.mainBusY
    )
  }
  const frameCircuitLayouts = [...layoutSplit.main, ...tapParts.circuitLayouts]
  const frameTrunks = [...trunkSplit.main, ...tapParts.trunks]
  const frameBranches = [...branchSplit.main, ...tapParts.branches]

  const circuitNotes = placePanelCircuitNotes({
    installation,
    circuitLayouts: layoutSplit.main,
    mainBusY: circuitLayout.mainBusY,
    trunks: trunkSplit.main,
    branches: branchSplit.main,
    minY: supplyMetadata.minY,
    elements,
  })
  const circuitElements = buildPanelCircuitElements({
    panel,
    circuitMap: circuitLayout.circuitMap,
    circuitLayouts: layoutSplit.main,
    mainBusY: circuitLayout.mainBusY,
    trunks: trunkSplit.main,
    branches: branchSplit.main,
    minY: circuitNotes.minY,
    elements,
    renderedProtectionLabelIds,
    notesPositionMap: circuitNotes.notesPositionMap,
    circuitNotesLocal: circuitNotes.circuitNotesLocal,
  })
  let tapMinY = Number.POSITIVE_INFINITY
  if (tapPlacements.length > 0) {
    // The pass types its bus y as the layout constant; the lane stands in for the bus here.
    const laneY = tapPlacements[0]!.laneY as typeof circuitLayout.mainBusY
    const tapNotes = placePanelCircuitNotes({
      installation,
      circuitLayouts: tapParts.circuitLayouts,
      mainBusY: laneY,
      trunks: tapParts.trunks,
      branches: tapParts.branches,
      minY: Number.POSITIVE_INFINITY,
      elements,
    })
    const tapElements = buildPanelCircuitElements({
      panel,
      circuitMap: circuitLayout.circuitMap,
      circuitLayouts: tapParts.circuitLayouts,
      mainBusY: laneY,
      trunks: tapParts.trunks,
      branches: tapParts.branches,
      minY: tapNotes.minY,
      elements,
      renderedProtectionLabelIds,
      notesPositionMap: tapNotes.notesPositionMap,
      circuitNotesLocal: tapNotes.circuitNotesLocal,
    })
    circuitNotes.circuitNotesLocal.push(...tapNotes.circuitNotesLocal)
    tapMinY = tapElements.minY
  }
  const layoutWithFrame = buildPanelLayoutFrame({
    panel,
    frameOffset,
    parentMcbInfo,
    installation,
    rootPanels,
    options,
    supplyTrunkNotesOrientation: circuitLayout.supplyTrunkNotesOrientation,
    circuitLayouts: frameCircuitLayouts,
    totalWidth: circuitLayout.totalWidth,
    mainBusX: circuitLayout.mainBusX,
    mainBusY: circuitLayout.mainBusY,
    trunks: frameTrunks,
    branches: frameBranches,
    minY: Math.min(circuitElements.minY, tapMinY),
    maxY: supplyMetadata.maxY,
    isSubPanel: supplyLayout.isSubPanel,
    hasGround: supplyLayout.hasGround,
    supplyY: supplyLayout.supplyY,
    groundX: supplyLayout.groundX,
    groundTrunkDevices: supplyLayout.groundTrunkDevices,
    supplyX: supplyMetadata.supplyX,
    supplyBendX: supplyLayout.supplyBendX,
    rootSupplyFeed: supplyLayout.rootSupplyFeed,
    panelLocalFeedStubStacks: supplyLayout.panelLocalFeedStubStacks,
    panelLocalRootSupplyInsertBase: supplyLayout.panelLocalRootSupplyInsertBase,
    supplyTrunkDevices: supplyLayout.supplyTrunkDevices,
    hasSupplyChangeover: supplyLayout.hasSupplyChangeover,
    usesConverterInputTap: supplyLayout.usesConverterInputTap,
    supplyOrientationContext: supplyLayout.supplyOrientationContext,
    isVerticalPositionedSupplyDevice: supplyLayout.isVerticalPositionedSupplyDevice,
    changeoverElbowLead: supplyLayout.changeoverElbowLead,
    directConverterIndex: supplyLayout.directConverterIndex,
    hasDirectConverter: supplyLayout.hasDirectConverter,
    directConverterBackup: supplyLayout.directConverterBackup,
    changeoverLaneOffset: supplyLayout.changeoverLaneOffset,
    supplySourceY: supplyLayout.supplySourceY,
    supplyDevicePositions: supplyLayout.supplyDevicePositions,
    supplyChangeoverLowerY: supplyLayout.supplyChangeoverLowerY,
    supplyConverterInputTap: supplyLayout.supplyConverterInputTap,
    changeoverPosition: supplyMetadata.changeoverPosition,
    usesInlineEmptySplitRails: supplyMetadata.usesInlineEmptySplitRails,
    usesCompactPanelMainBus: supplyMetadata.usesCompactPanelMainBus,
    usesInlineSupplyOnlyCompactRail: supplyMetadata.usesInlineSupplyOnlyCompactRail,
    renderedMainBusY: supplyMetadata.renderedMainBusY,
    usesSplitSupplyGround: supplyMetadata.usesSplitSupplyGround,
    renderedGroundY: supplyMetadata.renderedGroundY,
    renderedGroundDevicePositions: supplyMetadata.renderedGroundDevicePositions,
    changeoverSlotEndX: supplyMetadata.changeoverSlotEndX,
    supplyMetadataClusters: supplyMetadata.supplyMetadataClusters,
    supplyFeedOutputLabelRect: supplyMetadata.supplyFeedOutputLabelRect,
    getMeasuredSupplyDeviceTop: supplyMetadata.getMeasuredSupplyDeviceTop,
    supplyTopLabelPlacements: supplyMetadata.supplyTopLabelPlacements,
    supplyMetadataItems: supplyMetadata.supplyMetadataItems,
    supplyMetadataCalloutPlacements: supplyMetadata.supplyMetadataCalloutPlacements,
    supplyMetadataCalloutRects: supplyMetadata.supplyMetadataCalloutRects,
    supplyRightExtent: supplyMetadata.supplyRightExtent,
    feedStubStackHeight: supplyMetadata.feedStubStackHeight,
    elements,
    renderedMainBusWidth,
    circuitNotesLocal: circuitNotes.circuitNotesLocal,
    supplyTapBlocks: getSupplyTapPaintBlocks(tapPlacements, placedTapMeasures),
  })
  if (tapPlacements.length > 0) layoutWithFrame.supplyTaps = tapPlacements
  return layoutWithFrame
}

/**
 * Calculate bottom-up layout for entire project
 */
export function calculateBottomUpLayout(
  project: ProjectWithOptionalV2Electrical,
  manualOverrides?: Map<string, Point>,
  layoutOptions: BottomUpLayoutOptions = {}
): BottomUpLayoutResult {
  return runInLayoutScope(project, () =>
    calculateBottomUpLayoutScoped(project, manualOverrides, layoutOptions)
  )
}

function runInLayoutScope(
  project: ProjectWithOptionalV2Electrical,
  calculate: () => BottomUpLayoutResult
): BottomUpLayoutResult {
  // Linked endpoints replace their notes with the resolved link text; measurement,
  // envelopes and layout elements all read it through this one scope.
  const controlLinkNotes = buildControlLinkNoteMap(getProjectElectricalPanels(project))
  // Wires showing conductor marks widen their branch spacing through the same scope.
  for (const [key, value] of collectConductorMarkGaps(
    getProjectElectricalPanels(project),
    new Map(
      selectProjectWireRuns(project).flatMap((run) =>
        run.members.map((anchor) => [anchor, run] as const)
      )
    )
  ))
    controlLinkNotes.set(key, value)
  const result = runWithControlLinkNotes(controlLinkNotes, calculate)
  return controlLinkNotes.size > 0 ? { ...result, controlLinkNotes } : result
}

/**
 * Only the detached supply frame of one main board, without the cost of every board. Its contents
 * match the full layout; its position on the sheet does not.
 */
export function calculateSupplyFrameLayout(
  project: ProjectWithOptionalV2Electrical,
  ownerPanelId: string
): BottomUpLayoutResult {
  return runInLayoutScope(project, () => {
    const panels = getProjectElectricalPanels(project)
    const installation = getProjectElectricalInstallation(project)
    if (!installation) {
      throw new Error('Cannot calculate bottom-up layout without electrical installation data')
    }
    ensureInstallationFeedTopology(installation, panels)
    const owner = panels.find((panel) => panel.id === ownerPanelId && panel.isMain === true)
    const frame =
      owner &&
      isPanelSupplyFrameDetached(project, ownerPanelId) &&
      ownsDetachedSupplyFrame(project, ownerPanelId)
        ? calculateDetachedSupplyLayout(project, owner, undefined, installation, panels, {})
        : null
    return { panels: frame ? [frame] : [], totalWidth: 0, totalHeight: 0 }
  })
}

function calculateDetachedSupplyLayout(
  project: ProjectWithOptionalV2Electrical,
  panel: Panel,
  manualOverrides: Map<string, Point> | undefined,
  installation: NonNullable<ReturnType<typeof getProjectElectricalInstallation>>,
  panels: Panel[],
  layoutOptions: BottomUpLayoutOptions
): BottomUpPanelLayout {
  const supplyDiagramPanel = addSupplyTapsToDiagramPanel(
    clonePanelForDiagramRole(panel, 'supply'),
    panel
  )
  const layout = calculateBottomUpPanelLayout(
    project,
    supplyDiagramPanel,
    manualOverrides,
    { x: 0, y: 0 },
    null,
    installation,
    panels,
    {
      infoBlockColumns: getInfoBlockColumns(project, { hasLogo: layoutOptions.infoBlockLogo }),
      infoBlockHeight: layoutOptions.infoBlockHeight ?? getProjectInfoBlockHeight(project),
      diagramId: getSupplyDiagramId(panel.id),
      ownerPanelId: panel.id,
      frameRole: 'supply',
      supplyEndpointKind: 'mains',
      feedOutput: true,
      // One shared feed serves every main board behind the site transformer.
      ...(isPanelBehindSharedSupplyTransformer(project, panel.id)
        ? {
            feedOutputLabel: panels
              .filter((candidate) => isPanelBehindSharedSupplyTransformer(project, candidate.id))
              .map((candidate) => candidate.name)
              .join(', '),
          }
        : {}),
    }
  )
  mirrorDetachedSupplyPanelLayoutHorizontally(layout)
  reflowSupplyInfoBlockAfterMirror(layout, true)
  return layout
}

function calculateBottomUpLayoutScoped(
  project: ProjectWithOptionalV2Electrical,
  manualOverrides: Map<string, Point> | undefined,
  layoutOptions: BottomUpLayoutOptions
): BottomUpLayoutResult {
  const panels = getProjectElectricalPanels(project)
  const installation = getProjectElectricalInstallation(project)
  if (!installation) {
    throw new Error('Cannot calculate bottom-up layout without electrical installation data')
  }
  const infoBlockColumns = getInfoBlockColumns(project, { hasLogo: layoutOptions.infoBlockLogo })
  ensureInstallationFeedTopology(installation, panels)

  const PANEL_SPACING = 125
  const ROW_SPACING = 120
  const panelLayouts: BottomUpPanelLayout[] = []
  const detachedSupplyLayouts: BottomUpPanelLayout[] = []
  const panelLayoutById = new Map<string, BottomUpPanelLayout>()
  const originalFrameYByPanelId = new Map<string, number>()

  // Map to store parent MCB info for each sub-panel
  const subPanelMcbMap = new Map<
    string,
    {
      protection: ProtectionDevice
      circuit: Circuit
      parentPanel: Panel
      sourceEndpoint?: Endpoint
    }
  >()

  const flatPanels = flattenPanelsForRendering(panels)
  flatPanels.forEach((flatPanel) => {
    let parentMcbInfo: {
      protection: ProtectionDevice
      circuit: Circuit
      parentPanel: Panel
      sourceEndpoint?: Endpoint
    } | null = null
    const isSubPanel = flatPanel.parentPanel !== undefined || flatPanel.panel.isMain !== true

    if (isSubPanel) {
      parentMcbInfo = findParentMcbForSubPanel(project, flatPanel.panel)
      if (parentMcbInfo) {
        subPanelMcbMap.set(flatPanel.panel.id, parentMcbInfo)
      } else {
        logger.warn('calculateBottomUpLayout: Sub-panel but no parent MCB found', {
          panelId: flatPanel.panel.id,
          panelName: flatPanel.panel.name,
          hasParentPanel: !!flatPanel.parentPanel,
          isMain: flatPanel.panel.isMain,
        })
      }
    }

    const rootPanelCount = panels.length
    const supplyAssemblyRole = !isSubPanel
      ? getSupplyAssemblyPanelRole(project, installation, panels, flatPanel.panel.id)
      : { linked: false, ownsAssembly: false, ownsVisualTopology: false }
    const detachSupply = !isSubPanel && isPanelSupplyFrameDetached(project, flatPanel.panel.id)
    // A root panel that is only a load handoff of an existing assembly still
    // needs its own short, selectable panel frame. It must not render the
    // source-side feed rail or earthing, and it must not create a duplicate
    // detached supply frame of its own.
    const renderPanelOnly =
      !isSubPanel && rootPanelCount > 1 && supplyAssemblyRole.linked && !detachSupply
    const suppressInlineSupplyTopology = detachSupply || renderPanelOnly
    const panelForMainDiagram = detachSupply
      ? clonePanelForDiagramRole(flatPanel.panel, 'panel')
      : flatPanel.panel
    const panelLayout = calculateBottomUpPanelLayout(
      project,
      panelForMainDiagram,
      manualOverrides,
      { x: 0, y: 0 },
      parentMcbInfo,
      installation,
      panels,
      {
        infoBlockColumns,
        infoBlockHeight: layoutOptions.infoBlockHeight ?? getProjectInfoBlockHeight(project),
        compactSubPanelFeed: layoutOptions.compactSubPanelFeed,
        ...(suppressInlineSupplyTopology
          ? ({
              includeSupplyTopology: false,
              includeGroundDevices: false,
              diagramId: flatPanel.panel.id,
              ownerPanelId: flatPanel.panel.id,
              frameRole: 'panel',
              supplyEndpointKind: 'continuation',
              // Behind the shared transformer an empty board still meets its feed wire.
              ...(detachSupply && isPanelBehindSharedSupplyTransformer(project, flatPanel.panel.id)
                ? { continuationRail: true }
                : {}),
            } as const)
          : {}),
      }
    )

    if (!isSubPanel) {
      // Empty continuation rails use the same leftward Voeding stub as occupied
      // ones. Skipping the mirror here made the first drop look like the feed
      // flipped from right to left.
      mirrorInlineSupplyPanelLayoutHorizontally(panelLayout)
      reflowSupplyInfoBlockAfterMirror(
        panelLayout,
        panelLayout.supplyEndpointKind === 'continuation'
      )
      expandPanelFrameLeftForMirroredSupply(panelLayout)
    }

    if (detachSupply && ownsDetachedSupplyFrame(project, flatPanel.panel.id)) {
      detachedSupplyLayouts.push(
        calculateDetachedSupplyLayout(
          project,
          flatPanel.panel,
          manualOverrides,
          installation,
          panels,
          layoutOptions
        )
      )
    }

    const upstreamProtectionLabel = parentMcbInfo?.sourceEndpoint
      ? getDomoticaEndpointOutputLabel(parentMcbInfo.circuit, parentMcbInfo.sourceEndpoint)
      : (parentMcbInfo?.protection.label ?? '').trim()
    // Parent panel fallback below the incoming feeder. Only show this when the
    // immediate upstream protection has no own label; otherwise that protection
    // label is the reference and the parent-panel name is redundant/noisy.
    if (flatPanel.parentPanel && !upstreamProtectionLabel) {
      panelLayout.elements.push({
        id: `parent-tag-${flatPanel.panel.id}`,
        type: 'label',
        position: {
          x: panelLayout.supply.x,
          y: panelLayout.supply.y,
        },
        label: `← ${(parentMcbInfo?.parentPanel.name ?? flatPanel.parentPanel.name).trim()}`,
      })
    }

    panelLayouts.push(panelLayout)
    panelLayoutById.set(flatPanel.panel.id, panelLayout)
    originalFrameYByPanelId.set(flatPanel.panel.id, panelLayout.frame.y)
  })

  applyPanelFrameBottomAlignmentByRow(panelLayouts, () => 0)

  const getOrderedChildren = createOrderedPanelChildrenResolver(project, panelLayoutById)
  const placementPanels = flattenPanelsForPlacement(panels, getOrderedChildren)
  // Keep all main panels together, followed by their feeder-ordered descendants.
  // A second main panel must not push sub-panels into the detached supply row.
  const orderedPanels = [
    ...placementPanels.filter(({ depth }) => depth === 0),
    ...placementPanels.filter(({ depth }) => depth > 0),
  ]
  if (orderedPanels.length >= COMPACT_PANEL_THRESHOLD) {
    const measure = (panel: Panel): CompactNode => {
      const layout = panelLayoutById.get(panel.id)!
      const children: CompactNode[] = getOrderedChildren(panel).map(measure)
      const packing = packPanelGroup(children, PANEL_SPACING, ROW_SPACING)
      return {
        layout,
        children,
        packing,
        width: Math.max(layout.frame.width, packing.width),
        height: layout.frame.height + (children.length ? ROW_SPACING + packing.height : 0),
      }
    }
    type CompactNode = {
      layout: BottomUpPanelLayout
      children: CompactNode[]
      packing: ReturnType<typeof packPanelGroup>
      width: number
      height: number
    }
    const roots = panels.map(measure)
    const forest = packPanelGroup(roots, PANEL_SPACING, ROW_SPACING)
    const place = (node: CompactNode, x: number, bottom: number) => {
      const { layout } = node
      applyShiftToPanelLayout(
        layout,
        x +
          (node.width - layout.frame.width) / 2 +
          (layout.supplyFrameLeftExpansion ?? 0) +
          getManualOverrideFrameShift(layout, manualOverrides) -
          layout.frame.x,
        bottom - layout.frame.height - layout.frame.y
      )
      node.children.forEach((child, index) => {
        const position = node.packing.positions[index]!
        place(
          child,
          x + (node.width - node.packing.width) / 2 + position.x,
          bottom - layout.frame.height - ROW_SPACING - position.y
        )
      })
    }
    const top = 50
    roots.forEach((root, index) => {
      const position = forest.positions[index]!
      place(root, LAYOUT_CONSTANTS.LEFT_MARGIN + position.x, top + forest.height - position.y)
    })
  } else {
    let currentX = LAYOUT_CONSTANTS.LEFT_MARGIN
    for (const flatPanel of orderedPanels) {
      const layout = panelLayoutById.get(flatPanel.panel.id)
      if (!layout) continue
      const previewFrameShift = getManualOverrideFrameShift(layout, manualOverrides)
      const targetFrameX = currentX + previewFrameShift
      const targetFrameY = originalFrameYByPanelId.get(flatPanel.panel.id) ?? layout.frame.y
      applyShiftToPanelLayout(layout, targetFrameX - layout.frame.x, targetFrameY - layout.frame.y)
      currentX += layout.frame.width + PANEL_SPACING
    }

    if (panels.length > 1) {
      // Primary panels share one electrical row. Their local frame tops vary with
      // circuit content, so align the bus anchor and carry each root's sub-panels
      // with it instead of leaving empty roots lower than populated roots.
      const referenceMainBusY = panelLayoutById.get(panels[0]?.id ?? '')?.mainBus.y
      if (referenceMainBusY != null) {
        const shiftSubtree = (panel: Panel, dy: number) => {
          const layout = panelLayoutById.get(panel.id)
          if (layout) applyShiftToPanelLayout(layout, 0, dy)
          getOrderedChildren(panel).forEach((child) => shiftSubtree(child, dy))
        }
        panels.slice(1).forEach((panel) => {
          const layout = panelLayoutById.get(panel.id)
          if (layout) shiftSubtree(panel, referenceMainBusY - layout.mainBus.y)
        })
      }
    }
  }

  panelLayouts.forEach((layout) => {
    if (!layout.supplyFrameLeftExpansion) return
    layout.frame.x -= layout.supplyFrameLeftExpansion
  })

  panelLayouts.forEach(alignCompactInlineSupplyBusWithAnchors)

  const framesOverlap = (
    left: { x: number; y: number; width: number; height: number },
    right: { x: number; y: number; width: number; height: number }
  ) =>
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y

  for (const supplyLayout of detachedSupplyLayouts) {
    const ownerLayout = panelLayoutById.get(supplyLayout.ownerPanelId ?? supplyLayout.panel.id)
    if (!ownerLayout) continue
    // Keep the electrical handoff stable as the detached assembly changes width.
    // The mirrored supply rail terminates at its right edge, while the owner's
    // main bus starts at its left edge. Align those two perceived anchors instead
    // of the frames: DC branches can then grow the supply frame to the left without
    // making the existing assembly jump to the right.
    const supplyBusHandoffX = supplyLayout.mainBus.x + supplyLayout.mainBus.width
    const targetFrameX = ownerLayout.mainBus.x - (supplyBusHandoffX - supplyLayout.frame.x)
    // Anchor the electrical assembly rather than the variable frame top. Exact
    // port, label, and branch bounds may grow the frame upward, but adding one
    // of those items must not push the existing supply drawing downward.
    const targetMainBusY =
      (orderedPanels.length >= COMPACT_PANEL_THRESHOLD
        ? Math.max(...panelLayouts.map((layout) => layout.frame.y + layout.frame.height))
        : ownerLayout.frame.y + ownerLayout.frame.height) +
      ROW_SPACING +
      DETACHED_SUPPLY_MAIN_BUS_TOP_OFFSET
    let targetFrameY = targetMainBusY - (supplyLayout.mainBus.y - supplyLayout.frame.y)
    if (orderedPanels.length >= COMPACT_PANEL_THRESHOLD) {
      targetFrameY = Math.max(
        targetFrameY,
        ...panelLayouts.map((layout) => layout.frame.y + layout.frame.height + ROW_SPACING)
      )
    }
    let candidateFrame = {
      x: targetFrameX,
      y: targetFrameY,
      width: supplyLayout.frame.width,
      height: supplyLayout.frame.height,
    }
    let moved = true
    while (moved) {
      moved = false
      for (const existing of panelLayouts) {
        if (!framesOverlap(candidateFrame, existing.frame)) continue
        targetFrameY = existing.frame.y + existing.frame.height + ROW_SPACING
        candidateFrame = { ...candidateFrame, y: targetFrameY }
        moved = true
      }
    }
    applyShiftToPanelLayout(
      supplyLayout,
      targetFrameX - supplyLayout.frame.x,
      targetFrameY - supplyLayout.frame.y
    )
    panelLayouts.push(supplyLayout)
  }

  // Add panel symbols for protections that connect to sub-panels
  // These should appear at the end of the circuit's trunk (centered), not on a branch
  panelLayouts.forEach((mainPanelLayout) => {
    resolvePanelSupplyLinksForSourcePanel(project, mainPanelLayout.panel).forEach((link) => {
      // Output-fed boards are real endpoints drawn on their module row already.
      // Adding the ordinary trunk cap would draw a second, incorrect board feed.
      if (link.sourcePanelEndpoint?.domoticaChildProps) return
      const feederIsConverterBackup = link.feederCircuit?.supplySource?.kind === 'converter-backup'
      const hasDetachedSupplyFrame = panelLayouts.some(
        (candidate) =>
          candidate.panel.id === mainPanelLayout.panel.id && candidate.frameRole === 'supply'
      )
      if (
        hasDetachedSupplyFrame &&
        (mainPanelLayout.frameRole === 'supply') !== feederIsConverterBackup
      ) {
        return
      }
      const subPanelLayout = panelLayouts.find(
        (pl) => pl.frameRole !== 'supply' && pl.panel.id === link.targetPanel.id
      )
      if (subPanelLayout) {
        const circuit = link.feederCircuit
        if (circuit) {
          const panelEndpoint = link.sourcePanelEndpoint
          // Find all branches for this feeder circuit in the panel layout.
          const circuitBranches = mainPanelLayout.branches.filter((b) => b.circuitId === circuit.id)
          if (circuitBranches.length > 0) {
            const topmostBranch = getTopmostCircuitBranch(circuitBranches)
            if (!topmostBranch) {
              return
            }
            const mcbY = mainPanelLayout.mainBus.y - LAYOUT_CONSTANTS.MCB_Y_OFFSET
            const panelSharesSecondaryBus = hasPanelAttachmentOnSecondaryBus(
              link.protection,
              circuit
            )
            // A feeder can terminate directly at a panel, or share a secondary bus
            // with nested protections. In the latter case, the unprotected panel
            // is another direct bus attachment and belongs beside those protections,
            // not at the top of their consumer branches.
            const isHorizontalConverterBackup = circuit.supplySource?.kind === 'converter-backup'
            const symbolX = isHorizontalConverterBackup
              ? topmostBranch.branchX + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
              : topmostBranch.trunkX // Centered on vertical trunk
            const nestedCircuitIds = new Set(circuit.subCircuitIds ?? [])
            const nestedProtectionYs = panelSharesSecondaryBus
              ? mainPanelLayout.elements
                  .filter(
                    (element) =>
                      element.type === 'protection' &&
                      !!element.circuitId &&
                      nestedCircuitIds.has(element.circuitId)
                  )
                  .map((element) => element.position.y)
              : []
            const sourcePanelEndpointY = panelEndpoint
              ? mainPanelLayout.elements.find((element) => element.endpointId === panelEndpoint.id)
                  ?.position.y
              : undefined
            const feederProtectionElement = mainPanelLayout.elements.find(
              (element) =>
                element.type === 'protection' &&
                element.protectionId === link.protection.id &&
                element.circuitId === circuit.id
            )
            const feederCircuitIsNested = mainPanelLayout.panel.protections.some((protection) =>
              (protection.circuits ?? []).some((candidate) =>
                (candidate.subCircuitIds ?? []).includes(circuit.id)
              )
            )
            const isEmptyPanelFeeder =
              !!link.protection.subPanelId &&
              circuit.endpoints.length === 0 &&
              (circuit.branches?.length ?? 0) === 0 &&
              (circuit.subCircuitIds?.length ?? 0) === 0 &&
              (circuit.trunkDevices?.length ?? 0) === 0
            const nestedPanelOnlyFeederY =
              feederProtectionElement && feederCircuitIsNested && isEmptyPanelFeeder
                ? feederProtectionElement.position.y -
                  LAYOUT_CONSTANTS.NESTED_PANEL_FEEDER_VERTICAL_OFFSET
                : undefined
            const symbolY = isHorizontalConverterBackup
              ? topmostBranch.branchY
              : panelSharesSecondaryBus && nestedProtectionYs.length > 0
                ? Math.min(...nestedProtectionYs) -
                  LAYOUT_CONSTANTS.SECONDARY_BUS_PANEL_VERTICAL_OFFSET
                : (nestedPanelOnlyFeederY ??
                  sourcePanelEndpointY ??
                  getCircuitLineTopY(circuitBranches, mcbY, true))

            placeCircuitNoteAboveSecondaryPanel(mainPanelLayout, circuit.id, symbolY)

            mainPanelLayout.elements.push({
              id: `subpanel-symbol-${link.protection.id}`,
              type: 'endpoint',
              position: { x: symbolX, y: symbolY },
              endpointId: panelEndpoint?.id,
              circuitId: circuit.id,
            })
          } else {
            logger.warn('calculateBottomUpLayout: MCB branch not found for sub-panel', {
              protectionId: link.protection.id,
              circuitId: circuit.id,
              availableBranches: mainPanelLayout.branches.map((b) => ({
                circuitId: b.circuitId,
                branchX: b.branchX,
                branchY: b.branchY,
              })),
            })
          }
        }
      }
    })
  })

  // Calculate total dimensions
  let totalWidth: number = LAYOUT_CONSTANTS.LEFT_MARGIN
  let totalHeight: number = 0

  panelLayouts.forEach((pl) => {
    totalWidth = Math.max(totalWidth, pl.frame.x + pl.frame.width + LAYOUT_CONSTANTS.LEFT_MARGIN)
    totalHeight = Math.max(totalHeight, pl.frame.y + pl.frame.height + 50)
  })

  return {
    panels: panelLayouts,
    totalWidth,
    totalHeight,
    ...(infoBlockColumns.logo ? { infoBlockLogo: true } : {}),
    infoBlockHeight: layoutOptions.infoBlockHeight ?? getProjectInfoBlockHeight(project),
  }
}
