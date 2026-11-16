/** Final painted obstacles, information-block packing and positioned panel result assembly. */
import {
  LAYOUT_CONSTANTS,
  MAIN_BUS_RENDER_STROKE_WIDTH,
  SUPPLY_FRAME_TOP_CONTENT_GAP,
  SUPPLY_INFO_DEVICE_HORIZONTAL_REACH,
  SUPPLY_VOLTAGE_LABEL_X_OFFSET,
  SUPPLY_VOLTAGE_LABEL_FONT_SIZE,
  SUPPLY_VOLTAGE_LABEL_PADDING,
} from './bottomUpLayoutConstants'
import {
  getSupplyDcBusBranchBounds,
  getSupplyDeviceHorizontalPaintBounds,
  getSupplyDeviceTopExtent,
  getSupplyMetadataCalloutLines,
} from './bottomUpSupplyPaintBounds'

import { hasSupplyInlineLabels, getSupplyInlineLabelLines } from './supplyInlineDeviceLabels'

import type { Circuit, ProtectionDevice, TrunkDevice, Endpoint } from '@/types/schema'
import type { Point } from '@/types/ui'

import {
  EENDRAAD_PANEL_SYMBOL_HEIGHT,
  EENDRAAD_PANEL_SYMBOL_WIDTH,
} from '@/lib/canvas/symbolGeometry'
import {
  getInfoBlockMinFrameSize,
  getInfoBlockTotalWidth,
  hasOptionalInfoBlockColumns,
  INFO_BLOCK_FRAME_MARGIN,
  INFO_BLOCK_HEIGHT,
} from '@/lib/infoBlockLayout'

import {
  getPrimaryPanelBusSectionId,
  hasExplicitPanelBusSections,
} from '@/lib/panel/panelBusSections'
import { FEED_STUB_FEEDER_GEOMETRY } from './feedStubFeeders'
import { PANEL_BUS_FEED_GAP } from '@/lib/panel/panelBusFeedPreview'
import { getSplitSupplyRailPaintBounds } from './busFeedMarkerGeometry'

import { getDomoticaEndpointOutputLabel } from '@/lib/eendraad/domoticaRowLabel'
import { getProtectionOneWireLabelLines } from '@/lib/protectionLabels'

import { isSymbolLabelVisible } from '@/lib/symbolLabels'
import { countSymbolLabelVisualLines } from '@/lib/symbolLabelMetrics'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'

import { placeSupplyMetadataCards } from './supplyMetadataLayout'
import {
  getMultiplierBadgeWidth,
  MULTIPLIER_BADGE_HEIGHT,
} from '@/lib/eendraad/multiplierBadgeGeometry'

import { getSupplyDeviceMultiplier } from '@/lib/supplyAssembly/inverterMultipliers'
import { getSupplySourceSummaryLabel } from '@/lib/electrical/supplyConnection'
import { getPanelFrameTitlePadding } from '@/lib/panel/panelDiagramLabels'

import { getSubPanelMainBusFeedDevice } from '@/lib/panel/subPanelFeed'

import { arrangeBottomRightBlock, type OneWireLayoutBlock } from './oneWireBlockLayout'

import {
  CIRCUIT_CONVERTER_BLOCK_SIZE,
  getCircuitConverterDcConnectionCount,
  getSupplyConverterBodyGeometry,
  getSupplyConverterHorizontalGrowth,
  supportsCircuitConverterDcConnections,
} from './circuitConverterGeometry'
import { getSupplyConverterDcConnectionIndex } from '@/lib/supplyAssembly/converterDcConnections'
import {
  getBranchConverterMetadataCallouts,
  getCircuitConverterMetadataCallouts,
} from './circuitConverterMetadataCallouts'

import type { BottomUpLayoutElement, BottomUpPanelLayout } from './bottomUpLayout'
import type { BottomUpPanelLayoutInput, BottomUpSupplyElements } from './bottomUpPanelLayoutInput'
import {
  PROTECTION_LABEL_FONT_SIZE,
  PROTECTION_LABEL_CHAR_WIDTH,
  estimateTextLineWidth,
  estimateProtectionNameLabelWidth,
} from './bottomUpCircuitGeometry'
import { getSupplyConverterEmptyTopPortY } from './bottomUpSupplyGeometry'

import type { BottomUpCircuitLayoutPass } from './bottomUpCircuitLayout'
import type { BottomUpSupplyLayoutPass, SupplyDevicePosition } from './bottomUpSupplyLayout'
import type { BottomUpSupplyMetadataPass } from './bottomUpSupplyMetadata'
import type { BottomUpCircuitNotesPass } from './bottomUpCircuitNotes'
import type { BottomUpCircuitElementsPass } from './bottomUpCircuitElements'

/**
 * Apply frameOffset to all element positions (helper function)
 */
function createElementsWithFrameOffset(
  elements: BottomUpLayoutElement[],
  frameOffset: Point
): BottomUpLayoutElement[] {
  return elements.map((element) => ({
    ...element,
    position: {
      x: element.position.x + frameOffset.x,
      y: element.position.y + frameOffset.y,
    },
  }))
}

type BuildPanelLayoutFrameInput =
  Pick<
    BottomUpPanelLayoutInput,
    | 'panel'
    | 'frameOffset'
    | 'parentMcbInfo'
    | 'installation'
    | 'rootPanels'
    | 'options'
  > &
  Pick<
    BottomUpCircuitLayoutPass,
    | 'supplyTrunkNotesOrientation'
    | 'circuitLayouts'
    | 'totalWidth'
    | 'mainBusX'
    | 'mainBusY'
    | 'trunks'
    | 'branches'
  > &
  Pick<BottomUpCircuitElementsPass, 'minY'> &
  Pick<
    BottomUpSupplyMetadataPass,
    | 'maxY'
    | 'supplyX'
    | 'changeoverPosition'
    | 'usesInlineEmptySplitRails'
    | 'usesCompactPanelMainBus'
    | 'usesInlineSupplyOnlyCompactRail'
    | 'renderedMainBusY'
    | 'usesSplitSupplyGround'
    | 'renderedGroundY'
    | 'renderedGroundDevicePositions'
    | 'changeoverSlotEndX'
    | 'supplyMetadataClusters'
    | 'supplyFeedOutputLabelRect'
    | 'getMeasuredSupplyDeviceTop'
    | 'supplyTopLabelPlacements'
    | 'supplyMetadataItems'
    | 'supplyMetadataCalloutPlacements'
    | 'supplyMetadataCalloutRects'
    | 'supplyRightExtent'
    | 'feedStubStackHeight'
  > &
  Pick<
    BottomUpSupplyLayoutPass,
    | 'isSubPanel'
    | 'hasGround'
    | 'supplyY'
    | 'groundX'
    | 'groundTrunkDevices'
    | 'supplyBendX'
    | 'rootSupplyFeed'
    | 'panelLocalFeedStubStacks'
    | 'panelLocalRootSupplyInsertBase'
    | 'supplyTrunkDevices'
    | 'hasSupplyChangeover'
    | 'usesConverterInputTap'
    | 'supplyOrientationContext'
    | 'isVerticalPositionedSupplyDevice'
    | 'changeoverElbowLead'
    | 'directConverterIndex'
    | 'hasDirectConverter'
    | 'directConverterBackup'
    | 'changeoverLaneOffset'
    | 'supplySourceY'
    | 'supplyDevicePositions'
    | 'supplyChangeoverLowerY'
    | 'supplyConverterInputTap'
  > &
  Pick<BottomUpSupplyElements, 'elements' | 'renderedMainBusWidth'> &
  Pick<BottomUpCircuitNotesPass, 'circuitNotesLocal'>

export function buildPanelLayoutFrame(input: BuildPanelLayoutFrameInput): BottomUpPanelLayout {
  const {
    panel,
    frameOffset,
    parentMcbInfo,
    installation,
    rootPanels,
    options,
    supplyTrunkNotesOrientation,
    circuitLayouts,
    totalWidth,
    mainBusX,
    mainBusY,
    trunks,
    branches,
    isSubPanel,
    hasGround,
    supplyY,
    groundX,
    groundTrunkDevices,
    supplyX,
    supplyBendX,
    rootSupplyFeed,
    panelLocalFeedStubStacks,
    panelLocalRootSupplyInsertBase,
    supplyTrunkDevices,
    hasSupplyChangeover,
    usesConverterInputTap,
    supplyOrientationContext,
    isVerticalPositionedSupplyDevice,
    changeoverElbowLead,
    directConverterIndex,
    hasDirectConverter,
    directConverterBackup,
    changeoverLaneOffset,
    supplySourceY,
    supplyDevicePositions,
    supplyChangeoverLowerY,
    supplyConverterInputTap,
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
    elements,
    renderedMainBusWidth,
    circuitNotesLocal,
  } = input
  let {
    minY,
    maxY,
  } = input
  // Total height is from top (minY, lowest number) to bottom (frameBottomY, highest number).
  // Use max(maxY, baseline) so we never shrink the content box below the true bottom extent
  // (sub-panels used to use Math.min and truncated below the mirrored parent MCB / labels).
  const FRAME_BASELINE_Y =
    mainBusY + LAYOUT_CONSTANTS.SUPPLY_VERTICAL_DROP + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
  const frameBottomY = Math.max(FRAME_BASELINE_Y, maxY)

  // Converter endpoint cards are rendered later by the scene tree. Measure
  // them here with the same solver so the panel frame and info-block collision
  // pass see their real painted bounds.
  const circuitConverterMetadataRects: Array<{
    id: string
    rect: { left: number; top: number; right: number; bottom: number }
  }> = []
  circuitLayouts.forEach((circuitLayout) => {
    for (const device of circuitLayout.circuit.trunkDevices ?? []) {
      if (
        !supportsCircuitConverterDcConnections(device) ||
        getCircuitConverterDcConnectionCount(device) <= 1
      ) {
        continue
      }
      const element = elements.find(
        (candidate) => candidate.type === 'trunkDevice' && candidate.trunkDeviceId === device.id
      )
      if (!element) continue
      const callouts = getCircuitConverterMetadataCallouts({
        circuit: circuitLayout.circuit,
        device,
        anchor: element.position,
        symbolSize: LAYOUT_CONSTANTS.SYMBOL_SIZE,
        endpointSpacing: LAYOUT_CONSTANTS.ENDPOINT_HORIZONTAL_SPACING,
        applianceAfterSocketGap: LAYOUT_CONSTANTS.APPLIANCE_AFTER_SOCKET_GAP,
      })
      for (const callout of callouts.values()) {
        circuitConverterMetadataRects.push({
          id: `${device.id}-${callout.targetId}`,
          rect: callout.rect,
        })
        minY = Math.min(minY, callout.rect.top - 8)
        maxY = Math.max(maxY, callout.rect.bottom + 8)
      }
    }

    const circuitBranches = branches.filter(
      (candidate) => candidate.circuitId === circuitLayout.circuit.id
    )
    const branchMetadataTargets = circuitBranches.flatMap((branch) =>
      branch.endpoints.flatMap((endpoint) => {
        const element = elements.find(
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
    const branchMetadataTrunkYs = circuitBranches.flatMap((branch) => [
      branch.trunkY,
      branch.branchY,
    ])
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
    for (const callout of branchMetadataCallouts.values()) {
      const branch = circuitBranches.find((candidate) =>
        candidate.endpoints.some((endpoint) => endpoint.id === callout.targetId)
      )
      circuitConverterMetadataRects.push({
        id: `${branch?.id ?? circuitLayout.circuit.id}-${callout.targetId}`,
        rect: callout.rect,
      })
      minY = Math.min(minY, callout.rect.top - 8)
      maxY = Math.max(maxY, callout.rect.bottom + 8)
    }
  })

  // Apply frame offset to trunks and branches
  const offsetTrunks = trunks.map((t) => ({
    ...t,
    x: t.x + frameOffset.x,
    y: t.y + frameOffset.y,
  }))

  const offsetBranches = branches.map((b) => ({
    ...b,
    trunkX: b.trunkX + frameOffset.x,
    trunkY: b.trunkY + frameOffset.y,
    branchX: b.branchX + frameOffset.x,
    branchY: b.branchY + frameOffset.y,
  }))

  // Calculate frame
  // Frame should encompass all content from minY (top) to maxY (bottom)
  // Account for supply device horizontal extent
  const totalWidthWithSupply = Math.max(
    totalWidth,
    supplyRightExtent + LAYOUT_CONSTANTS.LEFT_MARGIN
  )
  const FRAME_PADDING = 20
  let frameX = frameOffset.x - FRAME_PADDING
  const frameTopTitlePadding =
    installation && rootPanels
      ? getPanelFrameTitlePadding(panel, installation, rootPanels, {
          frameRole: options.frameRole,
          backupFeedActive: panel.backupEarthingSystem != null,
        })
      : 28
  let frameY = minY - frameTopTitlePadding
  let frameWidth = totalWidthWithSupply + FRAME_PADDING * 2
  const infoBlockHeight = options.infoBlockHeight ?? INFO_BLOCK_HEIGHT
  const infoBlockWidth = getInfoBlockTotalWidth(options.infoBlockColumns)
  const { minWidth: minFrameWidth, minHeight: minFrameHeight } = getInfoBlockMinFrameSize(
    options.infoBlockColumns, infoBlockHeight
  )
  frameWidth = Math.max(frameWidth, minFrameWidth) + (options.feedOutput ? 36 : 0)

  const supplyDeviceBottomExtent = ({
    device,
    y,
  }: Pick<SupplyDevicePosition, 'device' | 'y'>): number => {
    const lineCount =
      hasSupplyInlineLabels(device) &&
      !isVerticalPositionedSupplyDevice(device) &&
      (device.symbolLabelDisplay?.position ?? 'bottom') === 'bottom'
        ? getSupplyInlineLabelLines(device).reduce(
            (count, line) => count + countSymbolLabelVisualLines(line.text),
            0
          )
        : 0
    // ProtectionOneWireLabels can carry a dense residual-current stack. Keep
    // the historical 65 px center-to-bottom reserve as a floor, then grow for
    // unusually long descriptions instead of letting the generic symbol box
    // under-measure them.
    return lineCount > 0
      ? y + Math.max(65, LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 + 5 + lineCount * 12)
      : y + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 + 18
  }
  const supplyTop = Math.min(
    supplySourceY - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
    ...supplyDevicePositions.map(({ device, y }) => getMeasuredSupplyDeviceTop(device, y)),
    ...supplyMetadataCalloutRects.map(({ top }) => top),
    ...supplyTopLabelPlacements.map(({ y }) => y),
    Number.POSITIVE_INFINITY
  )
  const supplyBottom = Math.max(
    supplySourceY + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 + 18,
    ...supplyDevicePositions.map(supplyDeviceBottomExtent),
    ...supplyMetadataCalloutRects.map(({ bottom }) => bottom),
    usesSplitSupplyGround ? renderedGroundY + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 : 0
  )
  const voltageLabel = installation?.nominalVoltage
    ? getSupplySourceSummaryLabel(installation)
    : ''
  const voltageLabelRight = voltageLabel
    ? supplyX +
      SUPPLY_VOLTAGE_LABEL_X_OFFSET +
      measureSymbolLabelTextWidth(voltageLabel, 'Figtree', SUPPLY_VOLTAGE_LABEL_FONT_SIZE) +
      SUPPLY_VOLTAGE_LABEL_PADDING
    : Number.NEGATIVE_INFINITY
  const supplyLeft = Math.min(
    supplyBendX,
    supplyX - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
    ...supplyDevicePositions.map(({ device, x, y }) =>
      Math.min(
        x - SUPPLY_INFO_DEVICE_HORIZONTAL_REACH,
        getSupplyDeviceHorizontalPaintBounds(device, x, y).left
      )
    ),
    ...(hasGround ? [groundX - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2] : []),
    ...renderedGroundDevicePositions.map(({ x }) => x - SUPPLY_INFO_DEVICE_HORIZONTAL_REACH)
  )
  const fullSupplyTop = Math.min(
    supplyTop,
    renderedMainBusY - LAYOUT_CONSTANTS.BUS_THICKNESS / 2,
    ...renderedGroundDevicePositions.map(({ y }) => y - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2)
  )
  const fullSupplyBottom = Math.max(
    supplyBottom,
    ...(hasGround ? [renderedGroundY + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2] : []),
    ...renderedGroundDevicePositions.map(({ y }) => y + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2)
  )
  const fullSupplyRight = Math.max(
    supplyRightExtent,
    voltageLabelRight,
    ...(hasGround ? [groundX + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2] : []),
    ...renderedGroundDevicePositions.map(({ x }) => x + SUPPLY_INFO_DEVICE_HORIZONTAL_REACH)
  )
  const layoutObstacles: OneWireLayoutBlock[] = []
  layoutObstacles.push({
    id: `${options.diagramId ?? panel.id}-main-bus`,
    kind: 'main-bus',
    label: 'main bus',
    x: mainBusX - MAIN_BUS_RENDER_STROKE_WIDTH / 2,
    y: renderedMainBusY - MAIN_BUS_RENDER_STROKE_WIDTH / 2,
    width: renderedMainBusWidth + MAIN_BUS_RENDER_STROKE_WIDTH,
    height: MAIN_BUS_RENDER_STROKE_WIDTH,
  })
  if (supplyFeedOutputLabelRect) {
    layoutObstacles.push({
      id: `${options.diagramId ?? panel.id}-feed-output-label`,
      kind: 'supply-assembly',
      label: 'main panel bus label',
      clearance: 0,
      x: supplyFeedOutputLabelRect.left,
      y: supplyFeedOutputLabelRect.top,
      width: supplyFeedOutputLabelRect.right - supplyFeedOutputLabelRect.left,
      height: supplyFeedOutputLabelRect.bottom - supplyFeedOutputLabelRect.top,
    })
  }
  circuitConverterMetadataRects.forEach(({ id, rect }) => {
    layoutObstacles.push({
      id: `${options.diagramId ?? panel.id}-converter-metadata-${id}`,
      kind: 'converter-metadata',
      label: 'converter endpoint metadata',
      x: rect.left,
      y: rect.top,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
    })
  })
  // A continuation endpoint in the panel-only frame is an invisible handoff,
  // not the detached supply assembly. The real assembly has its own layout.
  if (
    !isSubPanel &&
    (options.supplyEndpointKind == null || options.supplyEndpointKind === 'mains')
  ) {
    const supplyBlockId = options.diagramId ?? panel.id
    const pushSupplyBlock = (
      suffix: string,
      label: string,
      left: number,
      top: number,
      right: number,
      bottom: number
    ) => {
      layoutObstacles.push({
        id: `${supplyBlockId}-supply-${suffix}`,
        kind: 'supply-assembly',
        label,
        // The info block may share an edge with measured supply content. The
        // rectangles already describe the full painted bounds, so another
        // generic gutter here creates a needlessly large panel frame.
        clearance: 0,
        x: left,
        y: top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
      })
    }

    if (!options.feedOutput) {
      pushSupplyBlock(
        'assembly',
        'supply assembly',
        supplyLeft,
        fullSupplyTop,
        fullSupplyRight,
        fullSupplyBottom
      )
    } else {
      // A detached supply drawing is a sparse 2D assembly, not one solid
      // rectangle. Keep its actual rails, risers, symbols, and text separate so
      // the info block and frame can use the empty pockets between them.
      const WIRE_TEXT_RESERVE = 10
      const VERTICAL_WIRE_TEXT_RESERVE = 12
      const devicePaintRect = (
        position: Pick<SupplyDevicePosition, 'device' | 'x' | 'y'>,
        peers: TrunkDevice[]
      ) => {
        const metadataPlacement = supplyMetadataItems.some((item) => item.id === position.device.id)
        const metadataCluster = supplyMetadataClusters.get(position.device.id)
        const metadataRenderedByPeer =
          metadataCluster != null &&
          metadataCluster.targetIds.length > 1 &&
          metadataCluster.representativeId !== position.device.id
        const symbolBounds =
          position.device.type === 'dc_bus'
            ? (() => {
                const branchXs = supplyDevicePositions
                  .filter(({ device }) => device.supplyDcBusId === position.device.id)
                  .map(({ x }) => x)
                const right = Math.max(
                  position.x + LAYOUT_CONSTANTS.DC_BUS_MIN_WIDTH,
                  ...branchXs.map((branchX) => branchX + LAYOUT_CONSTANTS.SECONDARY_BUS_EXTENSION)
                )
                return {
                  left: position.x,
                  right,
                  center: { x: (position.x + right) / 2, y: position.y },
                }
              })()
            : getSupplyDeviceHorizontalPaintBounds(position.device, position.x, position.y)
        if (metadataPlacement || metadataRenderedByPeer) {
          const multiplier = getSupplyDeviceMultiplier(position.device)
          const badgeOverhang = multiplier > 1 ? getMultiplierBadgeWidth(multiplier) / 2 : 0
          const sideLines = isVerticalPositionedSupplyDevice(position.device)
            ? [
                position.device.label ?? '',
                ...(isSymbolLabelVisible(
                  position.device.symbolLabelDisplay,
                  'trunkDeviceNotes',
                  true
                )
                  ? [position.device.notes ?? '']
                  : []),
              ].filter((line) => line.trim())
            : []
          const sideWidth = Math.max(
            0,
            ...sideLines.map((line) =>
              measureSymbolLabelTextWidth(
                line,
                'Figtree',
                hasSupplyInlineLabels(position.device) && isVerticalPositionedSupplyDevice(position.device)
                  ? PROTECTION_LABEL_FONT_SIZE
                  : 8
              )
            )
          )
          const sideHeight =
            sideLines.reduce((count, line) => count + countSymbolLabelVisualLines(line), 0) *
            (hasSupplyInlineLabels(position.device) && isVerticalPositionedSupplyDevice(position.device)
              ? PROTECTION_LABEL_FONT_SIZE + 2
              : 10)
          // Text stays upright after mirroring. Reserve both side-label directions
          // and the multiplier above the symbol, not just the symbol body.
          return {
            left: symbolBounds.left - Math.max(4, badgeOverhang, sideWidth > 0 ? sideWidth + 5 : 0),
            top: Math.min(
              position.y -
                LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 -
                (multiplier > 1 ? MULTIPLIER_BADGE_HEIGHT : 4),
              position.y - sideHeight / 2
            ),
            right:
              symbolBounds.right + Math.max(4, badgeOverhang, sideWidth > 0 ? sideWidth + 5 : 0),
            bottom: Math.max(
              position.y + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 + 4,
              position.y + sideHeight / 2
            ),
          }
        }
        if (position.device.supplyDcBusId && position.device.type !== 'dc_bus') {
          const branchBounds = getSupplyDcBusBranchBounds([position.device])
          return {
            left: position.x + branchBounds.left - 4,
            top: position.y + branchBounds.top - 4,
            right: position.x + branchBounds.right + 4,
            bottom: position.y + branchBounds.bottom + 4,
          }
        }
        const labelLines = [
          position.device.label ?? '',
          ...getSupplyMetadataCalloutLines(position.device, metadataCluster?.totalMultiplier),
          ...(hasSupplyInlineLabels(position.device)
            ? getSupplyInlineLabelLines(position.device).map((line) => line.text)
            : []),
        ].filter((line) => line.trim().length > 0)
        const measureLines = (lines: string[]) =>
          Math.max(
            0,
            ...lines.flatMap((line) =>
              line
                .split(/\r?\n/)
                .map((visualLine) => estimateTextLineWidth(visualLine, PROTECTION_LABEL_CHAR_WIDTH))
            )
          )
        const verticalSideLabelWidth = measureLines([
          position.device.label ?? '',
          ...(isSymbolLabelVisible(position.device.symbolLabelDisplay, 'trunkDeviceNotes', true)
            ? [position.device.notes ?? '']
            : []),
        ])
        const technicalLabelWidth = hasSupplyInlineLabels(position.device)
          ? measureLines(getSupplyInlineLabelLines(position.device).map((line) => line.text))
          : 0
        const labelWidth = Math.max(0, measureLines(labelLines))
        const halfWidth = Math.max(SUPPLY_INFO_DEVICE_HORIZONTAL_REACH, labelWidth / 2 + 5)
        const isVerticalProtection =
          hasSupplyInlineLabels(position.device) && isVerticalPositionedSupplyDevice(position.device)
        const hasVerticalSideLabel =
          isVerticalPositionedSupplyDevice(position.device) && verticalSideLabelWidth > 0
        return {
          left: Math.min(
            position.x - halfWidth,
            symbolBounds.left - 4,
            hasVerticalSideLabel
              ? position.x - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 - 5 - verticalSideLabelWidth
              : Number.POSITIVE_INFINITY
          ),
          top:
            metadataPlacement || metadataRenderedByPeer
              ? position.y - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 - 4
              : getSupplyDeviceTopExtent(
                  position.device,
                  position.y,
                  peers,
                  supplyTrunkNotesOrientation
                ),
          right: Math.max(
            position.x + halfWidth,
            symbolBounds.right + 4,
            isVerticalProtection
              ? position.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 + 5 + technicalLabelWidth
              : Number.NEGATIVE_INFINITY
          ),
          bottom: supplyDeviceBottomExtent(position),
        }
      }

      pushSupplyBlock(
        'bus-riser',
        'supply bus riser',
        supplyBendX - VERTICAL_WIRE_TEXT_RESERVE,
        Math.min(renderedMainBusY, supplyY),
        supplyBendX + VERTICAL_WIRE_TEXT_RESERVE,
        Math.max(renderedMainBusY, supplyY)
      )

      if (hasGround) {
        pushSupplyBlock(
          'earthing',
          'earthing riser and symbol',
          groundX - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
          Math.min(renderedMainBusY, renderedGroundY),
          groundX + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
          Math.max(renderedMainBusY, renderedGroundY) + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
        )
      }

      const railPoints = new Map<number, number[]>()
      const addRailPoint = (y: number, x: number) => {
        const points = railPoints.get(y) ?? []
        points.push(x)
        railPoints.set(y, points)
      }
      addRailPoint(supplyY, supplyBendX)
      addRailPoint(supplySourceY, supplyX)
      if (supplyConverterInputTap && changeoverPosition) {
        addRailPoint(supplyConverterInputTap.y, changeoverPosition.x)
        addRailPoint(supplyConverterInputTap.y, supplyConverterInputTap.x)
      }
      for (const { device, x, y } of supplyDevicePositions) {
        // Devices mounted on inverter/DC-bus risers contribute vertical collision
        // blocks below. Treating their Y coordinate as a supply rail invents a
        // full-width horizontal obstacle that does not exist in the drawing.
        // A DC bus itself remains horizontal even when connected to a top port.
        if (device.type === 'dc_bus' || !isVerticalPositionedSupplyDevice(device)) {
          addRailPoint(y, x)
        }
      }
      for (const [y, xs] of railPoints) {
        const left = Math.min(...xs, supplyBendX)
        const right = Math.max(...xs, y === supplySourceY ? supplyX : supplyBendX)
        pushSupplyBlock(
          `rail-${Math.round(y)}`,
          'supply horizontal rail and wire text',
          left,
          y - WIRE_TEXT_RESERVE,
          right,
          y + WIRE_TEXT_RESERVE
        )
      }

      for (const position of supplyDevicePositions) {
        const rect = devicePaintRect(position, supplyTrunkDevices)
        pushSupplyBlock(
          `device-${position.device.id}`,
          `supply device ${position.device.symbol} and text`,
          rect.left,
          rect.top,
          rect.right,
          rect.bottom
        )
      }
      for (const position of renderedGroundDevicePositions) {
        const rect = devicePaintRect(position, groundTrunkDevices)
        pushSupplyBlock(
          `ground-device-${position.device.id}`,
          `ground device ${position.device.symbol} and text`,
          rect.left,
          rect.top,
          rect.right,
          rect.bottom
        )
      }

      for (const label of supplyTopLabelPlacements) {
        if (
          label.kind === 'metadata' &&
          supplyMetadataItems.some((item) => item.id === label.deviceId)
        )
          continue
        pushSupplyBlock(
          `label-${label.id}`,
          'supply device top label',
          label.x,
          label.y,
          label.x + label.width,
          label.y + label.height
        )
      }

      for (const [deviceId, { rect }] of supplyMetadataCalloutPlacements) {
        pushSupplyBlock(
          `metadata-${deviceId}`,
          'supply metadata text',
          rect.left,
          rect.top,
          rect.right,
          rect.bottom
        )
      }

      const changeover = supplyDevicePositions.find(
        ({ device }) => device.symbol === 'source_changeover'
      )
      if (changeover) {
        const elbowX =
          changeover.x +
          LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE / 2 +
          changeoverElbowLead
        pushSupplyBlock(
          'changeover-riser',
          'modular switch branch riser',
          elbowX - VERTICAL_WIRE_TEXT_RESERVE,
          changeover.y - changeoverLaneOffset,
          elbowX + VERTICAL_WIRE_TEXT_RESERVE,
          changeover.y + changeoverLaneOffset
        )
      }

      const converter = supplyDevicePositions.find(
        ({ device }) => device.supplyPath === 'converter-branch' || device.supplyPath === 'backup'
      )
      if (converter) {
        const converterBody = getSupplyConverterBodyGeometry(converter.device, converter)
        const topPortCount = getCircuitConverterDcConnectionCount(converter.device)
        for (let connectionIndex = 1; connectionIndex <= topPortCount; connectionIndex++) {
          const laneDevices = supplyDevicePositions.filter(
            ({ device }) => getSupplyConverterDcConnectionIndex(device) === connectionIndex
          )
          const portX = converter.x + (connectionIndex - 1) * CIRCUIT_CONVERTER_BLOCK_SIZE
          const portY =
            laneDevices[0]?.y ??
            getSupplyConverterEmptyTopPortY(converter.y, topPortCount, connectionIndex)
          pushSupplyBlock(
            `converter-dc-port-${connectionIndex}`,
            `inverter DC port ${connectionIndex}`,
            portX - VERTICAL_WIRE_TEXT_RESERVE,
            Math.min(converterBody.top, portY),
            portX + VERTICAL_WIRE_TEXT_RESERVE,
            Math.max(converterBody.top, portY)
          )
        }
        const connectedYs = supplyDevicePositions
          .filter(
            ({ device }) =>
              device.supplyPath === 'converter-grid' || device.supplyPath === 'converter-dc-top'
          )
          .map(({ y }) => y)
        if (
          (hasDirectConverter || converter.device.supplyPath === 'backup') &&
          converter.device.converterGridInputConnected !== false &&
          supplySourceY !== converter.y
        ) {
          connectedYs.push(supplySourceY)
        }
        if (connectedYs.length > 0) {
          pushSupplyBlock(
            'converter-riser',
            'inverter vertical connection and wire text',
            converter.x - VERTICAL_WIRE_TEXT_RESERVE,
            Math.min(converter.y, ...connectedYs),
            converter.x + VERTICAL_WIRE_TEXT_RESERVE,
            Math.max(converter.y, ...connectedYs)
          )
        }
      }

      pushSupplyBlock(
        'source',
        'supply source symbol and voltage text',
        supplyX - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
        supplySourceY - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 - 4,
        Math.max(supplyX + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2, voltageLabelRight),
        supplySourceY + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 + 18
      )
    }
  } else if (
    !isSubPanel &&
    options.supplyEndpointKind === 'continuation' &&
    !hasExplicitPanelBusSections(panel)
  ) {
    // Panel-only handoff frames still paint a short feed riser/rail (and optional
    // receiving-input devices / "Voeding" caption). Those primitives used to sit
    // outside the info-block obstacle set, so compact bottom-right placement
    // could land on top of the wire. Measure the same ink the renderer draws.
    const WIRE_TEXT_RESERVE = 10
    const VERTICAL_WIRE_TEXT_RESERVE = 12
    const CONTINUATION_LABEL_WIDTH = 120
    const CONTINUATION_LABEL_HEIGHT = 24
    const pushContinuationBlock = (
      suffix: string,
      label: string,
      left: number,
      top: number,
      right: number,
      bottom: number
    ) => {
      layoutObstacles.push({
        id: `${options.diagramId ?? panel.id}-supply-${suffix}`,
        kind: 'supply-assembly',
        label,
        x: left,
        y: top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
      })
    }

    pushContinuationBlock(
      'bus-riser',
      'panel feed riser',
      supplyBendX - VERTICAL_WIRE_TEXT_RESERVE,
      Math.min(renderedMainBusY, supplyY),
      supplyBendX + VERTICAL_WIRE_TEXT_RESERVE,
      Math.max(renderedMainBusY, supplyY)
    )

    const continuationRailXs = [supplyBendX, supplyX, ...supplyDevicePositions.map(({ x }) => x)]
    pushContinuationBlock(
      'rail',
      'panel feed rail and wire text',
      Math.min(...continuationRailXs) - WIRE_TEXT_RESERVE,
      Math.min(supplyY, supplySourceY) - WIRE_TEXT_RESERVE,
      Math.max(...continuationRailXs) + WIRE_TEXT_RESERVE,
      Math.max(supplyY, supplySourceY) + WIRE_TEXT_RESERVE
    )

    if (!usesCompactPanelMainBus && !hasExplicitPanelBusSections(panel)) {
      const labelCenterX = supplyBendX + 34
      pushContinuationBlock(
        'label',
        'panel feed label',
        labelCenterX - CONTINUATION_LABEL_WIDTH / 2,
        supplySourceY - 12,
        labelCenterX + CONTINUATION_LABEL_WIDTH / 2,
        supplySourceY - 8 + CONTINUATION_LABEL_HEIGHT
      )
    }

    for (const position of supplyDevicePositions) {
      const symbolHalf = LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
      const labelWidth = Math.max(
        estimateProtectionNameLabelWidth(position.device.label),
        ...getProtectionOneWireLabelLines(position.device).map((line) =>
          estimateTextLineWidth(line.text, PROTECTION_LABEL_CHAR_WIDTH)
        ),
        SUPPLY_INFO_DEVICE_HORIZONTAL_REACH
      )
      pushContinuationBlock(
        `device-${position.device.id}`,
        `panel feed device ${position.device.symbol} and text`,
        position.x - Math.max(symbolHalf, labelWidth / 2) - 4,
        position.y - symbolHalf - 4,
        position.x + Math.max(symbolHalf, labelWidth / 2) + 4,
        supplyDeviceBottomExtent(position)
      )
    }
  }
  const drawsPopulatedPanelFeedStubs =
    !options.feedOutput &&
    (options.supplyEndpointKind === 'continuation' || panel.isMain) &&
    panel.protections.some((protection) => (protection.circuits?.length ?? 0) > 0)
  if (options.feedOutput && hasExplicitPanelBusSections(panel)) {
    const sections = [...(panel.busSections ?? [])].sort((left, right) =>
      left.role === right.role ? 0 : left.role === 'backup' ? 1 : -1
    )
    const sectionWidth = (renderedMainBusWidth - PANEL_BUS_FEED_GAP * (sections.length - 1)) /
      sections.length
    sections.forEach((section, index) => {
      const startX = mainBusX + index * (sectionWidth + PANEL_BUS_FEED_GAP)
      const bounds = getSplitSupplyRailPaintBounds(
        startX, startX + sectionWidth,
        renderedMainBusY + LAYOUT_CONSTANTS.BUS_THICKNESS / 2,
        section.role === 'backup' ? 'backup' : 'grid',
        true
      )
      layoutObstacles.push({
        id: `${options.diagramId ?? panel.id}-${section.id}-rail-clearance`,
        kind: 'supply-stub',
        label: `${section.role === 'backup' ? 'backup' : 'grid'} rail clearance`,
        ...bounds,
        debugVisible: false,
      })
    })
  } else if (usesInlineEmptySplitRails || drawsPopulatedPanelFeedStubs) {
    // Reserve the whole painted stub stack before packing the info block. The
    // exact per-run marker boxes are produced later from generated wires.
    layoutObstacles.push({
      id: `${options.diagramId ?? panel.id}-stub-clearance`,
      kind: 'supply-stub',
      label: 'feed stub clearance',
      x: mainBusX - 30,
      y: renderedMainBusY - 8,
      width: renderedMainBusWidth + 60,
      height: feedStubStackHeight,
      debugVisible: true,
    })
  }
  // Hosted feeder legs stick out left of their stub (mirrors layoutTree), with
  // the fed panel's name above its symbol beside the main bus. Reserving them
  // grows the frame to the left.
  const drawsFeedStubStacks =
    options.supplyEndpointKind === 'continuation' ||
    ((options.supplyEndpointKind ?? 'mains') === 'mains' &&
      (options.frameRole ?? 'panel') === 'panel' && panel.isMain)
  for (const stack of drawsFeedStubStacks ? panelLocalFeedStubStacks ?? [] : []) {
    if (stack.feeders.length === 0) continue
    const hostColumns = circuitLayouts.filter((layout) => !layout.parentCircuit &&
      (layout.protection?.busSectionId ?? getPrimaryPanelBusSectionId(panel)) ===
        stack.busSectionId)
    const hostStubX = Math.max(mainBusX,
      hostColumns.length > 0 ? Math.min(...hostColumns.map((layout) => layout.x)) : mainBusX) + 20
    const leftLegX = hostStubX - FEED_STUB_FEEDER_GEOMETRY.columnSpacing * stack.feeders.length
    const nameHalfWidth = Math.max(...stack.feeders.map((feeder) =>
      measureSymbolLabelTextWidth(feeder.panelName, 'Figtree', 11) / 2))
    const left = leftLegX - Math.max(EENDRAAD_PANEL_SYMBOL_WIDTH / 2, nameHalfWidth) - 8
    layoutObstacles.push({
      id: `${options.diagramId ?? panel.id}-hosted-feeders-${stack.busSectionId}`,
      kind: 'supply-stub',
      label: 'hosted panel feeders',
      x: left,
      y: renderedMainBusY - EENDRAAD_PANEL_SYMBOL_HEIGHT - 16,
      width: hostStubX - left,
      height: feedStubStackHeight + EENDRAAD_PANEL_SYMBOL_HEIGHT + 8,
      debugVisible: true,
    })
  }
  if (isSubPanel && parentMcbInfo) {
    const parentMcbAnchorY = Math.max(supplyY, mainBusY + 60 * 2)
    const localFeedDevice = getSubPanelMainBusFeedDevice(panel)?.device
    const localFeedLabelWidth = localFeedDevice
      ? Math.max(
          estimateProtectionNameLabelWidth(localFeedDevice.label),
          ...getProtectionOneWireLabelLines(localFeedDevice).map((line) =>
            estimateTextLineWidth(line.text, PROTECTION_LABEL_CHAR_WIDTH)
          )
        )
      : 0
    const labelWidth = Math.max(
      60,
      estimateProtectionNameLabelWidth(parentMcbInfo.sourceEndpoint
        ? getDomoticaEndpointOutputLabel(parentMcbInfo.circuit, parentMcbInfo.sourceEndpoint)
        : parentMcbInfo.protection.label) + 20,
      localFeedLabelWidth + 20
    )
    layoutObstacles.push({
      id: `${options.diagramId ?? panel.id}-secondary-feed`,
      kind: 'secondary-feed',
      label: 'secondary panel feed',
      x: supplyX - labelWidth / 2,
      y: mainBusY,
      width: labelWidth,
      height: parentMcbAnchorY - mainBusY + 48,
    })
  }

  // Circuit labels and protection ink occupy a shallow band around the bus.
  // Keep it collision-only because the cyan circuit envelopes already expose
  // the exact horizontal layout in the debug overlay.
  for (const circuitLayout of circuitLayouts.filter((layout) => !layout.parentCircuit)) {
    layoutObstacles.push({
      id: `${options.diagramId ?? panel.id}-circuit-band-${circuitLayout.circuit.id}`,
      kind: 'main-bus',
      label: 'circuit lower band',
      x: circuitLayout.x,
      y: renderedMainBusY - LAYOUT_CONSTANTS.SYMBOL_SIZE,
      width: circuitLayout.width,
      height: LAYOUT_CONSTANTS.SYMBOL_SIZE * 1.5,
      debugVisible: false,
    })
  }

  if (options.feedOutput && supplyMetadataItems.length > 0) {
    const placements = placeSupplyMetadataCards(supplyMetadataItems, layoutObstacles)
    for (const [id, placement] of placements) {
      supplyMetadataCalloutPlacements.set(id, placement)
      supplyMetadataCalloutRects.push(placement.rect)
      const { left, top, right, bottom } = placement.rect
      layoutObstacles.push({
        id: `${options.diagramId ?? panel.id}-supply-metadata-${id}`,
        kind: 'supply-assembly',
        label: 'supply metadata text',
        clearance: 0,
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      })
    }
  }
  for (const position of supplyDevicePositions) {
    position.metadataCalloutRect = supplyMetadataCalloutPlacements.get(position.device.id)?.rect
  }

  const measuredLayoutLeft = Math.min(
    frameX + FRAME_PADDING,
    ...layoutObstacles.map((block) => block.x)
  )
  if (measuredLayoutLeft < frameX + FRAME_PADDING) {
    const leftExpansion = frameX + FRAME_PADDING - measuredLayoutLeft
    frameX -= leftExpansion
    frameWidth += leftExpansion
  }
  const measuredLayoutRight = Math.max(
    frameX + frameWidth - FRAME_PADDING,
    ...layoutObstacles.map((block) => block.x + block.width)
  )
  frameWidth = Math.max(frameWidth, measuredLayoutRight + FRAME_PADDING - frameX)

  const collisionClearance = 10
  const compactInfoTop = renderedMainBusY + LAYOUT_CONSTANTS.BUS_THICKNESS / 2 + collisionClearance
  const compactFrameBottom = compactInfoTop + infoBlockHeight + INFO_BLOCK_FRAME_MARGIN
  const measuredLayoutBottom = Math.max(
    frameBottomY,
    ...layoutObstacles.map((block) => block.y + block.height)
  )
  const contentFrameBottom = measuredLayoutBottom + FRAME_PADDING
  const infoArrangement = arrangeBottomRightBlock({
    frameLeft: frameX,
    frameTop: frameY,
    initialFrameRight: frameX + frameWidth,
    initialFrameBottom: Math.max(compactFrameBottom, contentFrameBottom),
    frameMargin: INFO_BLOCK_FRAME_MARGIN,
    blockWidth: infoBlockWidth,
    blockHeight: infoBlockHeight,
    obstacles: layoutObstacles,
    clearance: collisionClearance,
    // A panel-side supply arrangement may sit directly beside the info block;
    // prefer that compact row over pushing the entire info block underneath.
    sideStepLimitRatio: layoutObstacles.some(
      (block) => block.kind === 'supply-assembly' && block.clearance === 0
    )
      ? 1
      : undefined,
    // Detached supply drawings are mirrored after this pass. Side-stepping the
    // info block here would turn that temporary right-side growth into empty
    // space on the rendered left. Resolve those collisions with a lower row;
    // wide optional info blocks and short feed stubs use that same visual rule.
    preferBelow:
      options.feedOutput === true ||
      options.supplyEndpointKind === 'continuation' ||
      hasOptionalInfoBlockColumns(options.infoBlockColumns) ||
      layoutObstacles.some((block) => block.kind === 'supply-stub'),
  })
  frameWidth = infoArrangement.frameRight - frameX
  const baseFrameHeight = infoArrangement.frameBottom - frameY

  // Respect minimum frame height required by the info block, but keep all panel
  // bottoms aligned: when we increase the height, shift the frame upward so the
  // bottom edge (baseline) stays at the same Y for every panel.
  let frameHeight = Math.max(baseFrameHeight, minFrameHeight)
  if (options.feedOutput) {
    const supplyTopContentY = Math.min(
      ...layoutObstacles.map((block) => block.y),
      Number.POSITIVE_INFINITY
    )
    const requiredFrameY = supplyTopContentY - frameTopTitlePadding
    if (Number.isFinite(requiredFrameY) && frameY > requiredFrameY) {
      const extraTopHeight = frameY - requiredFrameY
      frameY = requiredFrameY
      frameHeight += extraTopHeight
    }
  } else if (frameHeight !== baseFrameHeight) {
    const baseBottom = frameY + baseFrameHeight
    frameY = baseBottom - frameHeight
  }

  // Empty configured converter exits are real interactive content too. They do
  // not occur in supplyDevicePositions as separate devices, so explicitly grow
  // the panel around the highest preview stub (supply converters grow left and
  // expose exits 1..count along their top edge).
  const highestSupplyConverterStubY = Math.min(
    ...supplyDevicePositions
      .filter(
        ({ device }) => device.supplyPath === 'backup' || device.supplyPath === 'converter-branch'
      )
      .map(({ device, y }) =>
        getSupplyConverterEmptyTopPortY(y, getCircuitConverterDcConnectionCount(device), 1)
      ),
    Number.POSITIVE_INFINITY
  )
  const requiredConverterFrameY = highestSupplyConverterStubY - SUPPLY_FRAME_TOP_CONTENT_GAP
  if (Number.isFinite(requiredConverterFrameY) && frameY > requiredConverterFrameY) {
    const extraTopHeight = frameY - requiredConverterFrameY
    frameY = requiredConverterFrameY
    frameHeight += extraTopHeight
  }

  // The detached supply frame used to reserve a fixed amount above converter
  // labels. That reserve is not enough when a card is nudged around a busbar,
  // so the card could cross the frame border. Keep the electrical content in
  // place and grow the frame around the final solved card bounds instead.
  if (supplyMetadataCalloutRects.length > 0) {
    const frameBottom = frameY + frameHeight
    const requiredMetadataFrameTop =
      Math.min(...supplyMetadataCalloutRects.map(({ top }) => top)) - frameTopTitlePadding
    const requiredMetadataFrameBottom =
      Math.max(...supplyMetadataCalloutRects.map(({ bottom }) => bottom)) + FRAME_PADDING
    if (requiredMetadataFrameTop < frameY) {
      frameY = requiredMetadataFrameTop
      frameHeight = frameBottom - frameY
    }
    frameHeight = Math.max(frameHeight, requiredMetadataFrameBottom - frameY)
  }

  // Wrapped and staggered protection names can exceed the original supply
  // envelope, including when the assembly lives inside an empty main panel.
  if (supplyTopLabelPlacements.length > 0) {
    const frameBottom = frameY + frameHeight
    const frameRight = frameX + frameWidth
    frameY = Math.min(
      frameY,
      ...supplyTopLabelPlacements.map((label) => label.y - frameTopTitlePadding)
    )
    frameX = Math.min(
      frameX,
      ...supplyTopLabelPlacements.map((label) => label.x - FRAME_PADDING)
    )
    frameHeight = frameBottom - frameY
    frameWidth = Math.max(
      frameRight,
      ...supplyTopLabelPlacements.map((label) => label.x + label.width + FRAME_PADDING)
    ) - frameX
  }

  const infoBlockBounds: OneWireLayoutBlock = {
    id: `${options.diagramId ?? panel.id}-info`,
    kind: 'info-block',
    label: `info block (${infoArrangement.placement})`,
    x: frameX + frameWidth - infoBlockWidth - INFO_BLOCK_FRAME_MARGIN,
    y: frameY + frameHeight - infoBlockHeight - INFO_BLOCK_FRAME_MARGIN,
    width: infoBlockWidth,
    height: infoBlockHeight,
  }
  const layoutBlocks = [
    ...layoutObstacles.map((block) => ({
      ...block,
      x: block.x + frameOffset.x,
      y: block.y + frameOffset.y,
    })),
    infoBlockBounds,
  ]

  // Apply frameOffset to all elements automatically (invisible transformation)
  const offsetElements = createElementsWithFrameOffset(elements, frameOffset)

  // Calculate parent MCB position if this is a sub-panel (LOCAL coordinates, will be offset in return)
  let parentMcbPosition:
    { protection: ProtectionDevice; circuit: Circuit; position: Point; sourceEndpoint?: Endpoint } | undefined
  if (parentMcbInfo) {
    parentMcbPosition = {
      protection: parentMcbInfo.protection,
      circuit: parentMcbInfo.circuit,
      sourceEndpoint: parentMcbInfo.sourceEndpoint,
      position: { x: supplyX, y: supplyY }, // LOCAL coordinates
    }
    // Apply frameOffset to parent MCB position
    parentMcbPosition.position.x += frameOffset.x
    parentMcbPosition.position.y += frameOffset.y
  }

  const circuitNotes =
    circuitNotesLocal.length > 0
      ? circuitNotesLocal.map((n) => ({
          ...n,
          x: n.x + frameOffset.x,
          y: n.y + frameOffset.y,
        }))
      : undefined

  return {
    panel,
    diagramId: options.diagramId ?? panel.id,
    frameRole: options.frameRole ?? 'panel',
    ownerPanelId: options.ownerPanelId ?? panel.id,
    ...(options.compactSubPanelFeed ? { compactSubPanelFeed: true } : {}),
    supplyEndpointKind: options.supplyEndpointKind ?? 'mains',
    panelLocalRootSupplyInsertBase,
    panelLocalRootBusSectionId: rootSupplyFeed?.busSectionId ?? getPrimaryPanelBusSectionId(panel),
    panelLocalFeedStubStacks,
    inlineEmptySplitRails: usesInlineEmptySplitRails || undefined,
    compactInlineSupplyBus: usesInlineSupplyOnlyCompactRail || undefined,
    elements: offsetElements, // Elements already have frameOffset applied
    circuitNotes,
    circuits: circuitLayouts.map((cl) => ({
      ...cl,
      x: cl.x + frameOffset.x, // Apply frameOffset to circuit X positions
    })),
    trunks: offsetTrunks, // Already has frameOffset applied
    branches: offsetBranches, // Already has frameOffset applied
    mainBus: {
      x: mainBusX + frameOffset.x, // Apply frameOffset
      y: renderedMainBusY + frameOffset.y,
      width: renderedMainBusWidth,
    },
    supply: {
      x: supplyX + frameOffset.x, // Apply frameOffset
      y: supplySourceY + frameOffset.y,
    },
    supplyBend: !isSubPanel
      ? {
          x: supplyBendX + frameOffset.x,
          y: (hasDirectConverter ? supplySourceY : supplyY) + frameOffset.y,
        }
      : undefined,
    supplyDevices:
      supplyDevicePositions.length > 0
        ? supplyDevicePositions.map((sd) => ({
            ...sd,
            x: sd.x + frameOffset.x,
            y: sd.y + frameOffset.y,
            metadataCalloutRect: sd.metadataCalloutRect
              ? {
                  left: sd.metadataCalloutRect.left + frameOffset.x,
                  right: sd.metadataCalloutRect.right + frameOffset.x,
                  top: sd.metadataCalloutRect.top + frameOffset.y,
                  bottom: sd.metadataCalloutRect.bottom + frameOffset.y,
                }
              : undefined,
            topLabelPlacements: sd.topLabelPlacements?.map((placement) => ({
              ...placement,
              x: placement.x + frameOffset.x,
              y: placement.y + frameOffset.y,
            })),
          }))
        : undefined,
    supplyChangeoverBranches: changeoverPosition
      ? {
          deviceId: changeoverPosition.device.id,
          x: changeoverPosition.x + frameOffset.x,
          y: changeoverPosition.y + frameOffset.y,
          elbowX:
            changeoverPosition.x +
            LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE / 2 +
            changeoverElbowLead +
            frameOffset.x,
          upperY: changeoverPosition.y - changeoverLaneOffset + frameOffset.y,
          lowerY:
            (supplyChangeoverLowerY ?? changeoverPosition.y + changeoverLaneOffset) + frameOffset.y,
          slotEndX: (changeoverSlotEndX ?? changeoverPosition.x) + frameOffset.x,
          ...(supplyConverterInputTap
            ? {
                converterInputTap: {
                  x: supplyConverterInputTap.x + frameOffset.x,
                  y: supplyConverterInputTap.y + frameOffset.y,
                  riserX: supplyConverterInputTap.riserX + frameOffset.x,
                },
              }
            : {}),
        }
      : undefined,
    ...(usesConverterInputTap ? { supplyChangeoverGridSource: 'converter-input' as const } : {}),
    ...(supplyOrientationContext?.horizontalDcLaneDeviceIds
      ? { supplyHorizontalDcLaneDeviceIds: supplyOrientationContext.horizontalDcLaneDeviceIds }
      : {}),
    supplyConverterBranch:
      (hasDirectConverter || hasSupplyChangeover) &&
      (directConverterIndex >= 0 ||
        supplyTrunkDevices.some((device) => device.supplyPath === 'backup'))
        ? (() => {
            const converter = supplyDevicePositions.find(
              ({ device }) =>
                device.supplyPath === 'converter-branch' || device.supplyPath === 'backup'
            )
            if (!converter) return undefined
            const dcDevices = supplyDevicePositions.filter(
              ({ device }) => device.supplyPath === 'converter-dc'
            )
            const dcTopDevices = supplyDevicePositions.filter(
              ({ device }) => device.supplyPath === 'converter-dc-top'
            )
            const occupiedTopPortCount = Math.max(
              1,
              ...dcTopDevices
                .map(({ device }) => getSupplyConverterDcConnectionIndex(device))
                .filter((index): index is number => index != null)
            )
            const topPortCount = Math.max(
              getCircuitConverterDcConnectionCount(converter.device),
              occupiedTopPortCount
            )
            const dcPorts = Array.from({ length: topPortCount + 1 }, (_, connectionIndex) => {
              const laneDevices = supplyDevicePositions.filter(
                ({ device }) => getSupplyConverterDcConnectionIndex(device) === connectionIndex
              )
              const portX =
                connectionIndex === 0
                  ? converter.x
                  : converter.x + (connectionIndex - 1) * CIRCUIT_CONVERTER_BLOCK_SIZE
              const portY =
                connectionIndex === 0
                  ? converter.y
                  : (laneDevices[0]?.y ??
                    getSupplyConverterEmptyTopPortY(converter.y, topPortCount, connectionIndex))
              return {
                connectionIndex,
                x: portX + frameOffset.x,
                y: portY + frameOffset.y,
                endX:
                  (laneDevices.at(-1)?.x ?? portX) +
                  (laneDevices.length > 0
                    ? LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_DEVICE_SPACING
                    : LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_SLOT_LENGTH +
                      (connectionIndex === 0
                        ? getSupplyConverterHorizontalGrowth(converter.device)
                        : 0)) +
                  frameOffset.x,
              }
            })
            return {
              deviceId: converter.device.id,
              x: converter.x + frameOffset.x,
              y: converter.y + frameOffset.y,
              lineY: supplySourceY + frameOffset.y,
              dcEndX:
                (dcDevices.at(-1)?.x ?? converter.x) +
                (dcDevices.length > 0
                  ? LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_DEVICE_SPACING
                  : LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_SLOT_LENGTH +
                    getSupplyConverterHorizontalGrowth(converter.device)) +
                frameOffset.x,
              dcTopY: dcPorts[1]?.y,
              dcTopEndX:
                (dcTopDevices.at(-1)?.x ?? converter.x) +
                (dcTopDevices.length > 0
                  ? LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_DEVICE_SPACING
                  : LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_SLOT_LENGTH) +
                frameOffset.x,
              dcPorts,
            }
          })()
        : undefined,
    supplyConverterBackup: directConverterBackup
      ? {
          ...directConverterBackup,
          x1: directConverterBackup.x1 + frameOffset.x,
          x2: directConverterBackup.x2 + frameOffset.x,
          y: directConverterBackup.y + frameOffset.y,
        }
      : undefined,
    feedOutput: undefined,
    ground: hasGround
      ? {
          x: groundX + frameOffset.x, // Apply frameOffset
          y: renderedGroundY + frameOffset.y,
        }
      : undefined,
    groundDevices:
      renderedGroundDevicePositions.length > 0
        ? renderedGroundDevicePositions.map((gd) => ({
            ...gd,
            x: gd.x + frameOffset.x,
            y: gd.y + frameOffset.y,
          }))
        : undefined,
    frame: {
      x: frameX, // frameX already includes frameOffset.x
      y: frameY,
      width: frameWidth,
      height: frameHeight,
    },
    layoutBlocks,
    isSubPanel: isSubPanel,
    parentMcb: parentMcbPosition,
  }

}
