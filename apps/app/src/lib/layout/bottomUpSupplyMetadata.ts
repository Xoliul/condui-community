/** Paint-aware supply bounds, card placement, feed-stub reserves and lower label clearance. */
import { LAYOUT_CONSTANTS, SUPPLY_INFO_DEVICE_HORIZONTAL_REACH } from './bottomUpLayoutConstants'
import {
  estimateSupplyMetadataCalloutSize,
  getSupplyDcBusBranchBounds,
  getSupplyDeviceHorizontalPaintBounds,
  getSupplyDeviceTopExtent,
  getSupplyMetadataCalloutLines,
  type SupplyDcBusBranchBounds,
} from './bottomUpSupplyPaintBounds'

import type { TrunkDevice } from '@/types/schema'
import type { Point } from '@/types/ui'

import { getFeedStubFeederReserve } from './feedStubFeeders'

import { BUS_FEED_MARKER_STUB_BOTTOM } from './busFeedMarkerGeometry'

import { getProtectionOneWireLabelLines } from '@/lib/protectionLabels'

import { countSymbolLabelVisualLines } from '@/lib/symbolLabelMetrics'

import {
  getSupplyMetadataCalloutGroupPlacements,
  getSupplyMetadataCalloutClusters,
  getSupplyMetadataCalloutPlacementKind,
  isSupplyMetadataCalloutDevice,
  shouldUseSupplyDeviceMetadataCallout,
  type SupplyMetadataCalloutGroupPlacement,
} from '@/lib/supplyMetadataCallout'

import { getSupplyDeviceMultiplier } from '@/lib/supplyAssembly/inverterMultipliers'

import { hasExplicitPanelBusSections } from '@/lib/panel/panelBusSections'

import { getSupplyConverterDcConnectionIndex } from '@/lib/supplyAssembly/converterDcConnections'

import { isConverterGridLegPlacement } from '@/lib/supplyAssembly/changeoverGridSource'
import { getSupplyTopLabelPlacements } from './supplyTopLabelLayout'
import { panelHasMainBusProtection } from './supplyFrameDetachment'

import type { BottomUpPanelLayoutInput } from './bottomUpPanelLayoutInput'
import { getCircuitLabelVisualRect } from './bottomUpCircuitGeometry'
import { getChangeoverBackupLaneEndX } from './bottomUpSupplyGeometry'

import type { BottomUpCircuitLayoutPass } from './bottomUpCircuitLayout'
import type { BottomUpSupplyLayoutPass } from './bottomUpSupplyLayout'

type MeasurePanelSupplyMetadataInput =
  Pick<BottomUpPanelLayoutInput, 'panel' | 'parentMcbInfo' | 'options'> &
  Pick<
    BottomUpCircuitLayoutPass,
    | 'supplyTrunkNotesOrientation'
    | 'mainBusX'
    | 'mainBusWidth'
    | 'mainBusY'
    | 'minY'
    | 'maxY'
  > &
  Pick<
    BottomUpSupplyLayoutPass,
    | 'isSubPanel'
    | 'supplyY'
    | 'groundX'
    | 'groundY'
    | 'groundTrunkDevices'
    | 'groundDevicePositions'
    | 'supplyX'
    | 'supplyBendX'
    | 'panelLocalFeedStubStacks'
    | 'supplyTrunkDevices'
    | 'hasSupplyChangeover'
    | 'usesConverterInputTap'
    | 'supplyOrientationContext'
    | 'isVerticalPositionedSupplyDevice'
    | 'changeoverElbowLead'
    | 'hasDirectConverter'
    | 'backupOutputDeviceCount'
    | 'changeoverGridDeviceCount'
    | 'changeoverGridInputLegDeviceCount'
    | 'inlineSupplyConverter'
    | 'supplySourceY'
    | 'supplyDevicePositions'
    | 'supplyConverterInputTap'
  >

export function measurePanelSupplyMetadata(input: MeasurePanelSupplyMetadataInput) {
  const {
    panel,
    parentMcbInfo,
    options,
    supplyTrunkNotesOrientation,
    mainBusX,
    mainBusWidth,
    mainBusY,
    isSubPanel,
    supplyY,
    groundX,
    groundY,
    groundTrunkDevices,
    groundDevicePositions,
    supplyBendX,
    panelLocalFeedStubStacks,
    supplyTrunkDevices,
    hasSupplyChangeover,
    usesConverterInputTap,
    supplyOrientationContext,
    isVerticalPositionedSupplyDevice,
    changeoverElbowLead,
    hasDirectConverter,
    backupOutputDeviceCount,
    changeoverGridDeviceCount,
    changeoverGridInputLegDeviceCount,
    inlineSupplyConverter,
    supplySourceY,
    supplyDevicePositions,
    supplyConverterInputTap,
  } = input
  let {
    minY,
    maxY,
    supplyX,
  } = input
  // Calculate the rightmost extent of the supply wire (for frame width)
  // Supply is always the rightmost element (either at bend point with no devices, or after all devices)
  const changeoverPosition = supplyDevicePositions.find(
    ({ device }) => device.symbol === 'source_changeover'
  )
  const hasMultipleExplicitPanelBusSections = (panel.busSections?.length ?? 0) > 1
  const usesInlineEmptySplitRails =
    !options.feedOutput && hasMultipleExplicitPanelBusSections && !panelHasMainBusProtection(panel)
  const usesCompactPanelMainBus =
    !options.feedOutput &&
    options.frameRole === 'panel' &&
    options.includeSupplyTopology === false &&
    options.includeGroundDevices === false &&
    options.continuationRail !== true &&
    !panelHasMainBusProtection(panel)
  const usesInlineSupplyOnlyCompactRail =
    !options.feedOutput &&
    !hasMultipleExplicitPanelBusSections &&
    !panelHasMainBusProtection(panel) &&
    inlineSupplyConverter != null
  const renderedMainBusY =
    mainBusY
  const usesSplitSupplyGround =
    (options.feedOutput === true || usesInlineEmptySplitRails) &&
    (panel.busSections?.length ?? 0) > 1
  const renderedGroundY = usesSplitSupplyGround
    ? supplySourceY + LAYOUT_CONSTANTS.SUPPLY_VERTICAL_DROP
    : groundY
  const renderedGroundDevicePositions = usesSplitSupplyGround
    ? groundTrunkDevices.map((device, index) => ({
        device,
        x: groundX,
        y:
          renderedGroundY -
          ((index + 1) * (renderedGroundY - supplySourceY)) / (groundTrunkDevices.length + 1),
      }))
    : groundDevicePositions
  const changeoverSlotEndX = changeoverPosition
    ? getChangeoverBackupLaneEndX({
        elbowX:
          changeoverPosition.x +
          LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE / 2 +
          changeoverElbowLead,
        laneStartX:
          changeoverPosition.x +
          LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE / 2 +
          (!usesConverterInputTap && changeoverGridInputLegDeviceCount > 0
            ? changeoverElbowLead
            : LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_ELBOW_LEAD),
        backupOutputCount: backupOutputDeviceCount,
        otherLaneCount: changeoverGridDeviceCount,
      })
    : undefined
  if (changeoverSlotEndX != null) {
    supplyX = Math.max(supplyX, changeoverSlotEndX + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2)
  }
  if (options.feedOutput) {
    // Keep the normal source-side lead length in the detached feed frame.
    // Right-edge breathing room belongs to the frame, not to compressed content geometry.
    supplyX += 36
  }
  // Devices dropped on a selectable supply DC bus are independent outgoing
  // branches, not additional serial devices on the converter lane.
  for (const busPosition of supplyDevicePositions.filter(
    ({ device }) => device.type === 'dc_bus'
  )) {
    const branchPositions = supplyDevicePositions.filter(
      ({ device }) => device.supplyDcBusId === busPosition.device.id
    )
    const branchGroups = new Map<string, typeof branchPositions>()
    branchPositions.forEach((position) => {
      const branchId = position.device.supplyDcBusBranchId ?? position.device.id
      const group = branchGroups.get(branchId) ?? []
      group.push(position)
      branchGroups.set(branchId, group)
    })
    const groups = [...branchGroups.values()]
    // Supply layouts are mirrored into their final left-to-right presentation after
    // this canonical pass. Place branches to the right here so they finish to the
    // left of the bus attachment and the bus can grow left like a normal busbar.
    const sideConnectionLeadAdjustment =
      getSupplyConverterDcConnectionIndex(busPosition.device) === 0
        ? LAYOUT_CONSTANTS.SUPPLY_DC_BUS_CONNECTION_LEAD +
          LAYOUT_CONSTANTS.SUPPLY_DC_BUS_SIDE_TERMINAL_TRIM
        : 0
    let branchOffset = 0
    let previousBounds: SupplyDcBusBranchBounds | null = null
    groups.forEach((group, branchIndex) => {
      const branchBounds = getSupplyDcBusBranchBounds(group.map(({ device }) => device))
      const branchRightReach = Math.max(SUPPLY_INFO_DEVICE_HORIZONTAL_REACH, branchBounds.right)
      branchOffset =
        branchIndex === 0
          ? Math.max(
              LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
              branchRightReach +
                LAYOUT_CONSTANTS.SUPPLY_DC_BUS_TERMINAL_GAP -
                sideConnectionLeadAdjustment
            )
          : branchOffset +
            Math.max(
              LAYOUT_CONSTANTS.SUPPLY_DC_BUS_BRANCH_MIN_SPACING,
              // The detached supply is mirrored after this pass, while DC-bus
              // labels keep their readable side. The branch currently placed
              // to the right becomes the visual left neighbor after mirroring.
              Math.ceil(
                Math.max(
                  previousBounds!.right - branchBounds.left,
                  branchBounds.right - previousBounds!.left
                ) + LAYOUT_CONSTANTS.SUPPLY_DC_BUS_BRANCH_LABEL_GAP
              )
            )
      group.forEach((position, deviceIndex) => {
        position.x = busPosition.x + branchOffset
        position.y =
          busPosition.y - 72 - deviceIndex * LAYOUT_CONSTANTS.SUPPLY_DC_BUS_BRANCH_DEVICE_SPACING
        minY = Math.min(minY, position.y + branchBounds.top - 8)
      })
      previousBounds = branchBounds
    })
  }
  const converterRightExtent =
    hasDirectConverter || hasSupplyChangeover
      ? Math.max(
          ...supplyDevicePositions.map(
            ({ device, x, y }) => getSupplyDeviceHorizontalPaintBounds(device, x, y).right
          ),
          Number.NEGATIVE_INFINITY
        )
      : Number.NEGATIVE_INFINITY
  // Metadata cards are rendered by TrunkDeviceSymbol, but their bounds must
  // also participate in the frame calculation. Use the same deterministic
  // group solver as the canvas with a conservative text-width estimate; the
  // small extra breathing room covers font-metric differences between layout
  // and the canvas renderer.
  const supplyMetadataPeers = supplyDevicePositions.filter(({ device }) => {
    return (
      isSupplyMetadataCalloutDevice(device) &&
      !(
        device.supplyPath === 'converter-grid' &&
        isConverterGridLegPlacement(device.converterGridPlacement)
      )
    )
  })
  const supplyMetadataHasLongPeer = supplyMetadataPeers.some(({ device }) => {
    const lines = getSupplyMetadataCalloutLines(device)
    return shouldUseSupplyDeviceMetadataCallout(device, lines, getSupplyDeviceMultiplier(device))
  })
  const supplyMetadataClusters = getSupplyMetadataCalloutClusters(
    supplyMetadataPeers.map(({ device }) => ({
      device,
      lines: getSupplyMetadataCalloutLines(device),
    }))
  )

  // Metadata cards are allowed to move, but never through a conductor. Build
  // the supply geometry here instead of relying on the later derived-wire
  // pass; the frame and the canvas must solve against the same hard obstacles.
  const supplyMetadataCollisionSegments: Array<{
    startPoint: Point
    endPoint: Point
  }> = [
    {
      startPoint: { x: mainBusX, y: renderedMainBusY },
      endPoint: {
        x: mainBusX + Math.max(mainBusWidth, Math.max(groundX, supplyBendX) - mainBusX + 15),
        y: renderedMainBusY,
      },
    },
    {
      startPoint: { x: supplyBendX, y: renderedMainBusY },
      endPoint: { x: supplyBendX, y: supplyY },
    },
    {
      startPoint: { x: supplyBendX, y: supplyY },
      endPoint: { x: supplyX, y: supplyY },
    },
  ]
  if (supplySourceY !== supplyY) {
    supplyMetadataCollisionSegments.push({
      startPoint: { x: supplyX, y: supplyY },
      endPoint: { x: supplyX, y: supplySourceY },
    })
  }

  const addSupplyRailSegment = (y: number, xs: number[]) => {
    if (xs.length < 2) return
    supplyMetadataCollisionSegments.push({
      startPoint: { x: Math.min(...xs), y },
      endPoint: { x: Math.max(...xs), y },
    })
  }
  const supplyRailXsByY = new Map<number, number[]>()
  const addSupplyRailPoint = (y: number, x: number) => {
    const points = supplyRailXsByY.get(y) ?? []
    points.push(x)
    supplyRailXsByY.set(y, points)
  }
  addSupplyRailPoint(supplyY, supplyBendX)
  addSupplyRailPoint(supplyY, supplyX)
  addSupplyRailPoint(supplySourceY, supplyX)
  if (supplyConverterInputTap && changeoverPosition) {
    // The horizontal tap wire from the inverter leg to changeover port 1.
    addSupplyRailPoint(supplyConverterInputTap.y, changeoverPosition.x)
    addSupplyRailPoint(supplyConverterInputTap.y, supplyConverterInputTap.x)
  }
  supplyDevicePositions.forEach(({ device, x, y }) => {
    if (device.type === 'dc_bus' || !isVerticalPositionedSupplyDevice(device)) {
      addSupplyRailPoint(y, x)
    }
  })
  supplyRailXsByY.forEach((xs, y) => addSupplyRailSegment(y, xs))

  supplyDevicePositions
    .filter(({ device }) => device.type === 'dc_bus')
    .forEach((busPosition) => {
      const branchXs = supplyDevicePositions
        .filter(({ device }) => device.supplyDcBusId === busPosition.device.id)
        .map(({ x }) => x + LAYOUT_CONSTANTS.SECONDARY_BUS_EXTENSION)
      addSupplyRailSegment(busPosition.y, [
        busPosition.x,
        busPosition.x + LAYOUT_CONSTANTS.DC_BUS_MIN_WIDTH,
        ...branchXs,
      ])
    })

  const supplyMetadataSymbolRects = supplyDevicePositions.map(({ device, x, y }) => {
    const branchBounds =
      device.supplyDcBusId && device.type !== 'dc_bus' ? getSupplyDcBusBranchBounds([device]) : null
    const paintBounds = getSupplyDeviceHorizontalPaintBounds(device, x, y)
    return {
      left: (branchBounds ? x + branchBounds.left : paintBounds.left) - 4,
      top: (branchBounds ? y + branchBounds.top : y - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2) - 4,
      right: (branchBounds ? x + branchBounds.right : paintBounds.right) + 4,
      bottom: (branchBounds ? y + branchBounds.bottom : y + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2) + 4,
    }
  })
  const supplyFeedOutputLabelRect = options.feedOutput
    ? getCircuitLabelVisualRect({
        x: mainBusX + (Math.max(groundX, supplyBendX) - mainBusX + 15) / 2,
        y: mainBusY - 10,
        label: panel.name,
      })
    : null

  const getMeasuredSupplyDeviceTop = (device: TrunkDevice, y: number): number => {
    const cluster = supplyMetadataClusters.get(device.id)
    const metadataRenderedByPeer =
      cluster != null && cluster.targetIds.length > 1 && cluster.representativeId !== device.id
    return metadataRenderedByPeer
      ? y - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
      : getSupplyDeviceTopExtent(device, y, supplyTrunkDevices, supplyTrunkNotesOrientation)
  }
  const supplyTopLabelPlacements = getSupplyTopLabelPlacements(
    supplyDevicePositions,
    'Figtree',
    supplyTrunkNotesOrientation,
    supplyOrientationContext
  )
  if (changeoverPosition) {
    // The port elbow rises right beside the switch (the port-1 riser, or the fixed lead when
    // there is none). Keep the switch's centered name on the near side of that wire.
    const portOneRiser = usesConverterInputTap ? undefined : supplyDevicePositions.find(
      ({ device }) =>
        device.supplyPath === 'changeover-grid' && device.changeoverGridPlacement === 'input-leg'
    )
    const wireElbowX =
      portOneRiser?.x ??
      changeoverPosition.x +
        LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE / 2 +
        LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_ELBOW_LEAD
    for (const placement of supplyTopLabelPlacements) {
      if (placement.deviceId !== changeoverPosition.device.id || placement.kind !== 'name') continue
      const overlap = placement.x + placement.width - (wireElbowX - 4)
      if (overlap <= 0) continue
      // Never push it onto the load-side drop or devices on the other side of the switch.
      const loadSideLimit = Math.max(
        supplyBendX,
        ...supplyDevicePositions
          .filter(({ x, y }) => x < changeoverPosition.x && Math.abs(y - changeoverPosition.y) < 1)
          .map(({ x }) => x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2)
      )
      const shift = Math.max(0, Math.min(overlap, placement.x - (loadSideLimit + 4)))
      placement.x -= shift
      placement.offsetX -= shift
    }
  }
  supplyDevicePositions.forEach((position) => {
    position.topLabelPlacements = supplyTopLabelPlacements.filter(
      (placement) => placement.deviceId === position.device.id
    )
  })
  const supplyMetadataItems = supplyMetadataHasLongPeer
    ? supplyMetadataPeers.flatMap(({ device, x, y }) => {
        const cluster = supplyMetadataClusters.get(device.id)
        const lines = getSupplyMetadataCalloutLines(device, cluster?.totalMultiplier)
        if (lines.length === 0) return []
        if (cluster && cluster.representativeId !== device.id) return []
        const clusterPositions = cluster
          ? supplyMetadataPeers.filter(({ device: peer }) => cluster.targetIds.includes(peer.id))
          : [{ device, x, y }]
        const clusterX =
          clusterPositions.reduce((total, peer) => total + peer.x, 0) / clusterPositions.length
        const clusterY = Math.min(...clusterPositions.map((peer) => peer.y))
        const { width, height } = estimateSupplyMetadataCalloutSize(lines)
        const paintBounds = getSupplyDeviceHorizontalPaintBounds(device, clusterX, clusterY)
        return [
          {
            id: device.id,
            symbolPosition: paintBounds.center,
            symbolWidth: paintBounds.right - paintBounds.left,
            symbolHeight: LAYOUT_CONSTANTS.SYMBOL_SIZE,
            width,
            height,
            placement: getSupplyMetadataCalloutPlacementKind({
              symbol: device.symbol,
              peerCount: supplyMetadataPeers.length,
              stackVertically: supplyMetadataPeers.length > 1,
            }),
          },
        ]
      })
    : []
  const supplyMetadataCalloutPlacements =
    !options.feedOutput && supplyMetadataHasLongPeer
      ? getSupplyMetadataCalloutGroupPlacements({
          items: supplyMetadataItems,
          segments: supplyMetadataCollisionSegments,
          symbolRects: [
            ...supplyMetadataSymbolRects,
            ...(supplyFeedOutputLabelRect ? [supplyFeedOutputLabelRect] : []),
          ],
          // Root supply layouts are mirrored after this pass. Prefer the
          // canonical right side so cards land on the rendered left, and keep
          // each card near its own device instead of centering a distant row.
          packRows: false,
          preferRightNudges: true,
          stackVertically: supplyMetadataPeers.length > 1,
          stackBelowY: renderedMainBusY,
        })
      : new Map<string, SupplyMetadataCalloutGroupPlacement>()
  const supplyMetadataCalloutRects = [...supplyMetadataCalloutPlacements.values()].map(
    ({ rect }) => rect
  )
  // Detached supply frames already reserve their top card space through
  // `getSupplyMetadataCalloutTopExtra` below. Including the card in min/maxY
  // here would move the whole detached row instead of just growing its frame.
  if (supplyMetadataCalloutRects.length > 0 && !options.feedOutput) {
    minY = Math.min(...supplyMetadataCalloutRects.map(({ top }) => top - 12), minY)
    maxY = Math.max(...supplyMetadataCalloutRects.map(({ bottom }) => bottom + 12), maxY)
  }
  const supplyMetadataRightExtent =
    supplyMetadataCalloutRects.length > 0
      ? Math.max(...supplyMetadataCalloutRects.map(({ right }) => right + 8))
      : Number.NEGATIVE_INFINITY
  const supplyRightExtent = Math.max(
    supplyX + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
    changeoverSlotEndX ?? Number.NEGATIVE_INFINITY,
    converterRightExtent,
    supplyMetadataRightExtent
  )

  // maxY must account for the supply/ground position
  maxY = Math.max(maxY, supplySourceY + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2)
  if (usesSplitSupplyGround) {
    maxY = Math.max(maxY, renderedGroundY + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2)
  }
  if (options.supplyEndpointKind === 'continuation') {
    maxY = Math.max(maxY, supplySourceY + 24)
  }
  const feedStubDevices = panelLocalFeedStubStacks?.flatMap((stack) => stack.devices) ?? []
  const longestFeedStubStack = Math.max(
    0, ...(panelLocalFeedStubStacks ?? []).map((stack) => stack.devices.length)
  )
  // Wires start at the bus centre, while the collision reserve starts 8 px
  // above its top. Include the terminal icon and caption beneath the wire.
  const emptyFeedStubStackHeight =
    LAYOUT_CONSTANTS.BUS_THICKNESS / 2 +
    LAYOUT_CONSTANTS.SUPPLY_VERTICAL_DROP +
    BUS_FEED_MARKER_STUB_BOTTOM +
    8
  const ownFeedStubStackHeights = (panelLocalFeedStubStacks ?? []).map((stack) => {
      if (stack.devices.length === 0) return emptyFeedStubStackHeight
      const extraLabelHeight = stack.devices.reduce((total, device) => {
        const leftLines = [device.label, device.notes]
          .filter((line): line is string => !!line?.trim())
        const technicalLines = device.type === 'protection'
          ? getProtectionOneWireLabelLines(device).map((line) => line.text)
          : []
        const visualLines = Math.max(
          leftLines.reduce((count, line) => count + countSymbolLabelVisualLines(line), 0),
          technicalLines.reduce((count, line) => count + countSymbolLabelVisualLines(line), 0)
        )
        return total + Math.max(0, visualLines - 2) * 24
      }, 0)
      return 44 + (stack.devices.length - 1) * 50 + 42 + 41 + 12 + extraLabelHeight
    })
  const feedStubFeederReserves = (panelLocalFeedStubStacks ?? []).map((stack) => {
    const extraLabelHeight = stack.devices.reduce((total, device) => {
      const lines = [device.label, device.notes].filter((line): line is string => !!line?.trim())
      return total + Math.max(0, lines.length - 2) * 24
    }, 0)
    return getFeedStubFeederReserve(stack.devices.length, extraLabelHeight, stack.feeders)
  })
  const feedStubStackHeight = Math.max(
    usesInlineEmptySplitRails ? LAYOUT_CONSTANTS.SUPPLY_VERTICAL_DROP + 38 : emptyFeedStubStackHeight,
    ...ownFeedStubStackHeights,
    ...feedStubFeederReserves
  )
  if (
    (options.supplyEndpointKind === 'continuation' ||
      ((options.supplyEndpointKind ?? 'mains') === 'mains' &&
        (options.frameRole ?? 'panel') === 'panel' && panel.isMain)) &&
    hasExplicitPanelBusSections(panel) &&
    (usesInlineEmptySplitRails ||
      (longestFeedStubStack > 0 && feedStubDevices.some((device) => device.type === 'protection')) ||
      (panelLocalFeedStubStacks ?? []).some((stack) => stack.feeders.length > 0))
  ) {
    // Repeated panel-feed instances stand upright on their bus stubs. Reserve
    // the last symbol, terminal marker and caption below the main bus.
    maxY = Math.max(
      maxY,
      renderedMainBusY + feedStubStackHeight
    )
  }

  // Supply-chain protections on the horizontal trunk render `ProtectionOneWireLabels` below
  // the symbol (see TrunkDeviceSymbol). Layout previously stopped at symbol half-height only,
  // so technical labels and wire captions clipped past the panel frame on large boards.
  const hasSupplyProtectionBottomLabels =
    !isSubPanel &&
    supplyTrunkDevices.some((d) => {
      if (d.type !== 'protection') return false
      const pos = d.symbolLabelDisplay?.position ?? 'bottom'
      return pos === 'bottom'
    })
  /** Matches order-of-magnitude height used by SymbolTextLabels / ProtectionOneWireLabels under the symbol. */
  // Four-line residual-current labels reach just past the previous reserve.
  // Keep a small breathing gap before the detached frame's info block.
  const SUPPLY_HORIZONTAL_PROTECTION_LABEL_CLEARANCE = 60
  if (hasSupplyProtectionBottomLabels) {
    maxY = Math.max(
      maxY,
      supplyY + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 + SUPPLY_HORIZONTAL_PROTECTION_LABEL_CLEARANCE
    )
  }

  // Sub-panels: keep frame bottom in sync with layoutTree parent-MCB anchor + feeder labels
  // (see getSubPanelIncomingFeedLabelAnchors / buildPanelNode in layoutTree.ts).
  if (isSubPanel && parentMcbInfo) {
    const MIN_SUBPANEL_INCOMING_SEGMENT_LENGTH = 70 // keep in sync with layoutTree.ts export
    const SUBPANEL_FEED_PARENT_TAG_Y = 28 // keep in sync with layoutTree.ts export
    const SUBPANEL_FEED_LABEL_HEIGHT = 20
    const parentMcbAnchorY = options.compactSubPanelFeed
      ? supplyY
      : Math.max(supplyY, mainBusY + MIN_SUBPANEL_INCOMING_SEGMENT_LENGTH * 2)
    maxY = Math.max(
      maxY,
      parentMcbAnchorY + SUBPANEL_FEED_PARENT_TAG_Y + SUBPANEL_FEED_LABEL_HEIGHT
    )
  }

  return {
    changeoverPosition,
    usesInlineEmptySplitRails,
    usesCompactPanelMainBus,
    usesInlineSupplyOnlyCompactRail,
    renderedMainBusY,
    usesSplitSupplyGround,
    renderedGroundY,
    renderedGroundDevicePositions,
    changeoverSlotEndX,
    supplyMetadataClusters,
    supplyFeedOutputLabelRect,
    getMeasuredSupplyDeviceTop,
    supplyTopLabelPlacements,
    supplyMetadataItems,
    supplyMetadataCalloutPlacements,
    supplyMetadataCalloutRects,
    supplyRightExtent,
    feedStubStackHeight,
    minY,
    maxY,
    supplyX,
  }
}

export type BottomUpSupplyMetadataPass = ReturnType<typeof measurePanelSupplyMetadata>
