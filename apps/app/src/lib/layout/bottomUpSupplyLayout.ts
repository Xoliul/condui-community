/** Supply and earthing topology projected into positioned converter, changeover and DC devices. */
import type { TrunkDevice } from '@/types/schema'
import { withSupplyTransformerOutputs } from '@/lib/electrical/feedNominalVoltage'
import {
  LAYOUT_CONSTANTS,
  MAIN_BUS_RENDER_STROKE_WIDTH,
  SUPPLY_TOP_LABEL_FONT_SIZE,
  SUPPLY_TOP_LABEL_OFFSET_FROM_SYMBOL,
  SUPPLY_FRAME_TOP_CONTENT_GAP,
  SUPPLY_VERTICAL_NOTE_BUS_CLEARANCE,
} from './bottomUpLayoutConstants'
import { getSupplyDeviceTopExtent } from './bottomUpSupplyPaintBounds'
import { getProtectionAnchorOffset } from './bottomUpPanelTransforms'
import { getSupplyInlineLabelLines } from './supplyInlineDeviceLabels'

import { getPanelFeedProjection } from '@/lib/feedTopology'
import {
  getPrimaryPanelBusSectionId,
  hasExplicitPanelBusSections,
} from '@/lib/panel/panelBusSections'
import { getFeedStubSourcePanelId, type FeedStubFeeder } from './feedStubFeeders'

import { getPanelGroundTrunkDevices, panelRendersEarthingStem } from '@/lib/eendraad/panelGround'
import { selectProjectSupplyAssemblies } from '@/lib/projectV2/electrical'
import {
  getAssemblyReceivingPanelInputDevices,
  getPanelInputDeviceStartIndex,
  resolveAssemblyPanelInput,
} from '@/lib/supplyAssembly/electricalTopology'

import { isSymbolLabelVisible } from '@/lib/symbolLabels'

import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'

import type { SupplyMetadataCalloutRect } from '@/lib/supplyMetadataCallout'

import {
  CIRCUIT_CONVERTER_BLOCK_SIZE,
  CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD,
  CIRCUIT_CONVERTER_OUTPUT_ROW_SPACING,
  getCircuitConverterDcConnectionCount,
  getCircuitConverterOutputRowY,
  supportsCircuitConverterDcConnections,
} from './circuitConverterGeometry'
import { getSupplyConverterDcConnectionIndex } from '@/lib/supplyAssembly/converterDcConnections'

import {
  getHorizontalDcLaneDeviceIds,
  isVerticalSupplyDevice,
  type SupplyDeviceOrientationContext,
} from './supplyDeviceOrientation'
import {
  isConverterGridLegPlacement,
  orderConverterGridLegDevicesFromConverter,
  resolveSupplyLayoutChangeoverGridSource,
} from '@/lib/supplyAssembly/changeoverGridSource'
import { getSupplyTopLabelPlacements, type SupplyTopLabelPlacement } from './supplyTopLabelLayout'

import type { BottomUpPanelLayout } from './bottomUpLayout'
import type { BottomUpPanelLayoutInput } from './bottomUpPanelLayoutInput'
import { PROTECTION_TECHNICAL_LABEL_OFFSET_FROM_SYMBOL } from './bottomUpCircuitGeometry'
import {
  getSupplyConverterDcDeviceOffset,
  SUPPLY_CHANGEOVER_PORT_OFFSET,
  planConverterInputTap,
  planConverterInputTapLane,
  getChangeoverBackupLaneEndX,
  getChangeoverBackupLaneOffsets,
  getSupplyConverterEmptyTopPortY,
} from './bottomUpSupplyGeometry'

import type { BottomUpCircuitLayoutPass } from './bottomUpCircuitLayout'

export type SupplyDevicePosition = {
  device: TrunkDevice
  x: number
  y: number
  feedScope: 'shared' | 'root'
  feedIndex: number
  metadataCalloutRect?: SupplyMetadataCalloutRect
  topLabelPlacements?: SupplyTopLabelPlacement[]
}

type CalculatePanelSupplyLayoutInput =
  Pick<
    BottomUpPanelLayoutInput,
    | 'project'
    | 'panel'
    | 'parentMcbInfo'
    | 'installation'
    | 'rootPanels'
    | 'options'
  > &
  Pick<
    BottomUpCircuitLayoutPass,
    | 'supplyTrunkNotesOrientation'
    | 'circuitLayouts'
    | 'hostedFeedersBySection'
    | 'mainBusX'
    | 'mainBusY'
    | 'branches'
  >

const TOP_LANE_MIN_EXTRA_ROW_GAP = 20
const TOP_LANE_BELOW_LABEL_LINE_HEIGHT = 12
const TOP_LANE_ROW_CLEARANCE = 8

/**
 * Extra vertical room per row boundary for converter DC lanes drawn as horizontal chains. A
 * row's captions hang below its symbols while the next row's name labels sit above theirs, so
 * the standard row spacing is widened by whatever those need, never by less than the minimum.
 */
function getTopDcLaneRowExtraGap(
  devices: readonly TrunkDevice[],
  horizontalDeviceIds: ReadonlySet<string>,
  notesOrientation: 'horizontal' | 'vertical',
  orientationContext: SupplyDeviceOrientationContext | undefined
): number {
  if (horizontalDeviceIds.size === 0) return 0
  const laneDevices = devices.filter((device) => horizontalDeviceIds.has(device.id))
  const belowLabelHeight = Math.max(
    0,
    ...laneDevices.map(
      (device) => getSupplyInlineLabelLines(device).length * TOP_LANE_BELOW_LABEL_LINE_HEIGHT
    )
  )
  const aboveLabelHeight = Math.max(
    0,
    ...getSupplyTopLabelPlacements(
      laneDevices.map((device, index) => ({
        device,
        x: index * LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_DEVICE_SPACING,
        y: 0,
      })),
      'Figtree',
      notesOrientation,
      orientationContext
    ).map((placement) => placement.height + SUPPLY_TOP_LABEL_OFFSET_FROM_SYMBOL)
  )
  const requiredGap =
    LAYOUT_CONSTANTS.SYMBOL_SIZE +
    belowLabelHeight +
    aboveLabelHeight +
    TOP_LANE_ROW_CLEARANCE
  return Math.max(
    TOP_LANE_MIN_EXTRA_ROW_GAP,
    Math.ceil(requiredGap - CIRCUIT_CONVERTER_OUTPUT_ROW_SPACING)
  )
}

export function calculatePanelSupplyLayout(input: CalculatePanelSupplyLayoutInput) {
  const {
    project,
    panel,
    parentMcbInfo,
    installation,
    rootPanels,
    options,
    supplyTrunkNotesOrientation,
    circuitLayouts,
    hostedFeedersBySection,
    mainBusX,
    mainBusY,
    branches,
  } = input
  // Calculate ground and supply positions
  // Ground wire is at the very start of main bus, offset by 20px to the right
  // Supply wire is spaced from ground by the current SUPPLY_LEFT_OFFSET (30px)
  const isSubPanel = !!parentMcbInfo || panel.isMain === false
  const hasGround =
    options.includeGroundDevices !== false &&
    panelRendersEarthingStem(panel, installation, isSubPanel)

  // Supply Y: main panels show the actual supply bend below the main bus.
  // Sub‑panels use a slightly deeper parent‑MCB placeholder so their wire
  // is visibly longer, but not so deep that it collides with the info block.
  const SUBPANEL_EXTRA_SUPPLY_DROP = 20
  let supplyY = isSubPanel
    ? mainBusY + LAYOUT_CONSTANTS.SUPPLY_VERTICAL_DROP + SUBPANEL_EXTRA_SUPPLY_DROP
    : mainBusY + LAYOUT_CONSTANTS.SUPPLY_VERTICAL_DROP

  const groundX = mainBusX + 20 // 20px offset from start
  // Keep the earth stem the same length on every board. Sub-panels only lengthen
  // the incoming feeder, not the local electrode.
  const groundY = mainBusY + LAYOUT_CONSTANTS.SUPPLY_VERTICAL_DROP

  // Ground trunk devices — placed vertically between ground symbol and main bus
  const groundTrunkDevices =
    options.includeGroundDevices !== false
      ? getPanelGroundTrunkDevices(panel, installation, isSubPanel)
      : []
  const hasGroundDevices = groundTrunkDevices.length > 0

  // Calculate ground trunk device positions on the vertical wire
  // Device spacing along the vertical wire (from ground symbol upward to main bus)
  type GroundDevicePosition = { device: import('@/types/schema').TrunkDevice; x: number; y: number }
  const groundDevicePositions: GroundDevicePosition[] = []

  if (hasGroundDevices) {
    // Calculate positions: devices are evenly spaced on the vertical wire
    // from ground symbol (groundY) up to main bus (mainBusY)
    const totalVerticalDistance = groundY - mainBusY // Distance from bus to ground
    const deviceSpacing = totalVerticalDistance / (groundTrunkDevices.length + 1)

    groundTrunkDevices.forEach((device, index) => {
      const deviceY = groundY - (index + 1) * deviceSpacing // From ground upward
      groundDevicePositions.push({ device, x: groundX, y: deviceY })
    })
  }

  // Supply position: if ground exists, space it from ground; otherwise use original offset
  const supplyOffset = hasGround
    ? 20 + LAYOUT_CONSTANTS.SUPPLY_LEFT_OFFSET // Ground offset (20) + spacing (30) = 50
    : Math.min(LAYOUT_CONSTANTS.SUPPLY_LEFT_OFFSET, LAYOUT_CONSTANTS.SUPPLY_MAX_OFFSET)
  let supplyX = mainBusX + supplyOffset
  const supplyBendX = supplyX // The bend point X (where vertical meets horizontal), stays fixed

  // Supply trunk devices (root panel only) — placed horizontally between bend (main bus) and supply.
  // Array order = flow from supply to main bus: index 0 = next to supply, last = next to main bus.
  const feedProjection =
    !isSubPanel && installation && options.includeSupplyTopology !== false
      ? getPanelFeedProjection(installation, rootPanels ?? [panel], panel)
      : null
  const rootSupplyFeed = installation?.feedTopology?.rootFeeds.find(
    (feed) => feed.panelId === panel.id &&
      (feed.busSectionId ?? getPrimaryPanelBusSectionId(panel)) ===
        getPrimaryPanelBusSectionId(panel)
  )
  const rootSupplyDevices = rootSupplyFeed?.trunkDevices ?? []
  const panelInputStart = getPanelInputDeviceStartIndex(project, rootSupplyDevices)
  const panelLocalFeedStubStacks = !isSubPanel && hasExplicitPanelBusSections(panel)
    ? (panel.busSections ?? []).map((section) => {
        const feed = installation?.feedTopology?.rootFeeds.find((candidate) =>
          candidate.panelId === panel.id &&
          (candidate.busSectionId ?? getPrimaryPanelBusSectionId(panel)) === section.id
        )
        const devices = feed?.trunkDevices ?? []
        const insertBase = getPanelInputDeviceStartIndex(project, devices)
        const sourcePanelId = rootPanels
          ? getFeedStubSourcePanelId(project, rootPanels, panel, devices)
          : undefined
        return {
          busSectionId: section.id,
          role: section.role ?? 'normal',
          insertBase,
          devices: devices.slice(insertBase).filter((device) =>
            device.supplyPath == null || device.supplyPath === 'serial'
          ),
          feeders: [] as FeedStubFeeder[],
          sourcePanelId,
          sourcePanelName: sourcePanelId
            ? rootPanels?.find((candidate) => candidate.id === sourcePanelId)?.name
            : undefined,
        }
      })
    : undefined
  for (const stack of panelLocalFeedStubStacks ?? []) {
    stack.feeders.push(...(hostedFeedersBySection.get(stack.busSectionId) ?? []))
  }
  const receivingInputDevices =
    !isSubPanel && options.includeSupplyTopology === false
      ? [
          ...new Map(
            selectProjectSupplyAssemblies(project)
              .flatMap((assembly) =>
                assembly.loadHandoffs.flatMap((handoff) => {
                  const input = resolveAssemblyPanelInput(project, handoff.target)
                  return input?.panelId === panel.id &&
                    (input.busSectionId ?? getPrimaryPanelBusSectionId(panel)) ===
                      getPrimaryPanelBusSectionId(panel)
                    ? getAssemblyReceivingPanelInputDevices(project, assembly, handoff.target)
                    : []
                })
              )
              .map((device) => [device.id, device])
          ).values(),
        ]
      : []
  const panelLocalRootSupplyInsertBase =
    !isSubPanel &&
    options.includeSupplyTopology === false &&
    installation
      ? panelInputStart
      : undefined
  // Legacy supplies without a graph use the same handoff boundary.
  const panelLocalRootContinuationDevices =
    !isSubPanel &&
    options.includeSupplyTopology === false &&
    options.supplyEndpointKind === 'continuation' &&
    installation &&
    receivingInputDevices.length === 0
      ? rootSupplyDevices.slice(panelInputStart)
      : []
  const projectedFeedDevices =
    !isSubPanel && feedProjection?.devices
      ? options.frameRole === 'supply'
        ? feedProjection.devices.filter((_device, index) =>
            index < (feedProjection.sharedDeviceCount ?? 0) + panelInputStart)
        : feedProjection.devices
      : null
  const supplyTrunkDevices = withSupplyTransformerOutputs(
    projectedFeedDevices ||
    (receivingInputDevices.length > 0 ? receivingInputDevices : panelLocalRootContinuationDevices),
    installation,
    rootPanels ?? [panel]
  )
  const hasSupplyDevices = supplyTrunkDevices.length > 0
  const supplyChangeoverIndex = supplyTrunkDevices.findIndex(
    (device) => device.symbol === 'source_changeover'
  )
  const hasSupplyChangeover = supplyChangeoverIndex >= 0
  // Port 1 of the changeover may be tapped part-way up the inverter's grid-input leg
  // (`converter-input`). It is drawn on the grid-tap geometry; only the port-1 feed re-routes.
  const usesConverterInputTap =
    hasSupplyChangeover &&
    resolveSupplyLayoutChangeoverGridSource(supplyTrunkDevices, panel) === 'converter-input'
  // Port-1 devices then sit inline on the horizontal tap wire.
  const horizontalDcLaneDeviceIds = getHorizontalDcLaneDeviceIds(supplyTrunkDevices)
  const supplyOrientationContext: SupplyDeviceOrientationContext | undefined =
    usesConverterInputTap || horizontalDcLaneDeviceIds.size > 0
      ? {
          ...(usesConverterInputTap ? { changeoverGridSource: 'converter-input' as const } : {}),
          ...(horizontalDcLaneDeviceIds.size > 0 ? { horizontalDcLaneDeviceIds } : {}),
        }
      : undefined
  const isVerticalPositionedSupplyDevice = (
    device: Parameters<typeof isVerticalSupplyDevice>[0]
  ): boolean => isVerticalSupplyDevice(device, supplyOrientationContext)
  const changeoverAdjacentLabelWidth = Math.max(
    0,
    ...supplyTrunkDevices
      .filter(
        (device) =>
          (!usesConverterInputTap &&
            device.supplyPath === 'changeover-grid' &&
            device.changeoverGridPlacement === 'input-leg') ||
          (supplyTrunkDevices.indexOf(device) < supplyChangeoverIndex &&
            (device.supplyPath == null || device.supplyPath === 'serial'))
      )
      .flatMap((device) => getSupplyInlineLabelLines(device))
      .map((line) => measureSymbolLabelTextWidth(line.text, 'Figtree', 10))
  )
  const changeoverElbowLead = Math.max(
    LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_ELBOW_LEAD,
    changeoverAdjacentLabelWidth > 0
      ? LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 +
          PROTECTION_TECHNICAL_LABEL_OFFSET_FROM_SYMBOL +
          changeoverAdjacentLabelWidth +
          8
      : 0
  )
  const directConverterIndex = supplyTrunkDevices.findIndex(
    (device) => device.supplyPath === 'converter-branch'
  )
  const hasDirectConverter = !hasSupplyChangeover && directConverterIndex >= 0
  let directConverterBackup: BottomUpPanelLayout['supplyConverterBackup']
  const backupOutputDeviceCount = supplyTrunkDevices.filter(
    (device) => device.supplyPath === 'backup-output'
  ).length
  const changeoverGridDeviceCount = supplyTrunkDevices.filter(
    (device) =>
      device.supplyPath === 'changeover-grid' && device.changeoverGridPlacement !== 'input-leg'
  ).length
  const changeoverGridInputLegDeviceCount = supplyTrunkDevices.filter(
    (device) =>
      device.supplyPath === 'changeover-grid' && device.changeoverGridPlacement === 'input-leg'
  ).length
  const converterGridInlineDeviceCount = supplyTrunkDevices.filter(
    (device) =>
      device.supplyPath === 'converter-grid' &&
      !isConverterGridLegPlacement(device.converterGridPlacement)
  ).length
  const converterGridLegDevices = supplyTrunkDevices.filter(
    (device) =>
      device.supplyPath === 'converter-grid' &&
      isConverterGridLegPlacement(device.converterGridPlacement)
  )
  const converterGridInputLegDeviceCount = converterGridLegDevices.length
  if (hasSupplyChangeover) {
    supplyY += 48 + (LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_LANE_OFFSET - 44)
  }
  const hasTopConverterDcDevice = supplyTrunkDevices.some(
    (device) => device.supplyPath === 'converter-dc-top'
  )
  // Horizontal DC lanes caption their symbols below (ratings) and above (names), so their rows
  // are pushed apart by what those captions need beyond the standard row spacing.
  const topLaneRowExtraGap = getTopDcLaneRowExtraGap(
    supplyTrunkDevices,
    horizontalDcLaneDeviceIds,
    supplyTrunkNotesOrientation,
    supplyOrientationContext
  )
  const inlineSupplyConverter = supplyTrunkDevices.find(
    (device) =>
      supportsCircuitConverterDcConnections(device) &&
      (device.supplyPath === 'converter-branch' || device.supplyPath === 'backup')
  )
  const inlineSupplyConverterPortCount = inlineSupplyConverter
    ? getCircuitConverterDcConnectionCount(inlineSupplyConverter)
    : 0
  if (!options.feedOutput && (hasTopConverterDcDevice || inlineSupplyConverterPortCount > 1)) {
    // An inline supply assembly shares the panel frame with the full main bus.
    // Keep attached upper DC devices and configured empty port stubs below that
    // bus instead of using detached-frame geometry, where short rails leave the
    // area above the converter free.
    const topDcDevices = supplyTrunkDevices.filter(
      (device) => device.supplyPath === 'converter-dc-top'
    )
    const topConverterLaneOffset = hasSupplyChangeover
      ? LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_LANE_OFFSET
      : 0
    if (hasTopConverterDcDevice) {
      const provisionalTopDeviceY =
        supplyY - topConverterLaneOffset - LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_SLOT_LENGTH
      const provisionalTopExtent = Math.min(
        ...topDcDevices.map((device) =>
          getSupplyDeviceTopExtent(
            device,
            provisionalTopDeviceY,
            supplyTrunkDevices,
            supplyTrunkNotesOrientation
          )
        )
      )
      const inlineTopDcBusClearance =
        provisionalTopDeviceY -
        provisionalTopExtent +
        SUPPLY_FRAME_TOP_CONTENT_GAP +
        (inlineSupplyConverter
          ? topLaneRowExtraGap * getCircuitConverterDcConnectionCount(inlineSupplyConverter)
          : 0)
      supplyY = Math.max(
        supplyY,
        mainBusY +
          topConverterLaneOffset +
          LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_SLOT_LENGTH +
          inlineTopDcBusClearance
      )
    }
    if (inlineSupplyConverterPortCount > 1) {
      const highestEmptyPortOffset = -getSupplyConverterEmptyTopPortY(
        0,
        inlineSupplyConverterPortCount,
        1
      )
      supplyY = Math.max(
        supplyY,
        mainBusY + topConverterLaneOffset + highestEmptyPortOffset + SUPPLY_FRAME_TOP_CONTENT_GAP
      )
    }
  }
  const changeoverLaneOffset = hasSupplyChangeover
    ? LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_LANE_OFFSET
    : 0
  if (supplyTrunkNotesOrientation === 'vertical') {
    const tallestVisibleVerticalNote = Math.max(
      0,
      ...supplyTrunkDevices
        .filter(
          (device) =>
            !device.supplyDcBusId &&
            !isVerticalPositionedSupplyDevice(device) &&
            (device.notes ?? '').trim().length > 0 &&
            isSymbolLabelVisible(device.symbolLabelDisplay, 'trunkDeviceNotes', true)
        )
        .map((device) =>
          measureSymbolLabelTextWidth(
            (device.notes ?? '').trim(),
            'Figtree',
            SUPPLY_TOP_LABEL_FONT_SIZE
          )
        )
    )
    if (tallestVisibleVerticalNote > 0) {
      supplyY = Math.max(
        supplyY,
        mainBusY +
          changeoverLaneOffset +
          LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 +
          SUPPLY_TOP_LABEL_OFFSET_FROM_SYMBOL +
          tallestVisibleVerticalNote +
          SUPPLY_VERTICAL_NOTE_BUS_CLEARANCE
      )
    }
  }
  const directConverterLaneOffset = hasDirectConverter
    ? LAYOUT_CONSTANTS.SUPPLY_DIRECT_CONVERTER_OFFSET +
      Math.max(0, converterGridInputLegDeviceCount - 2) *
        LAYOUT_CONSTANTS.SUPPLY_DIRECT_CONVERTER_INPUT_LEG_EXPANSION
    : 0
  if (
    !options.feedOutput &&
    supplyTrunkDevices.some(
      (device) => device.symbol === 'transformer' && !isVerticalPositionedSupplyDevice(device)
    )
  ) {
    // Inline supply nameplates sit beneath the panel bus. Reserve their wrapped,
    // collision-solved height before positioning the supply rails and devices.
    const topLabels = getSupplyTopLabelPlacements(
      supplyTrunkDevices.map((device, index) => ({
        device,
        x: -index * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING,
        y: 0,
      })),
      'Figtree',
      supplyTrunkNotesOrientation,
      supplyOrientationContext
    )
    const transformerIds = new Set(
      supplyTrunkDevices.filter((device) => device.symbol === 'transformer').map((device) => device.id)
    )
    const nameplateHeight = Math.max(
      0,
      ...topLabels
        .filter((placement) => transformerIds.has(placement.deviceId))
        .map((placement) => -placement.y)
    )
    supplyY = Math.max(
      supplyY,
      mainBusY + MAIN_BUS_RENDER_STROKE_WIDTH / 2 + nameplateHeight + 8
    )
  }
  let supplySourceY = hasSupplyChangeover
    ? supplyY + changeoverLaneOffset
    : hasDirectConverter
      ? supplyY + directConverterLaneOffset
      : supplyY
  const supplyDevicePositions: SupplyDevicePosition[] = []
  let supplyChangeoverLowerY: number | undefined
  let supplyConverterInputTap: { x: number; y: number; riserX: number } | undefined

  if (hasSupplyDevices) {
    const n = supplyTrunkDevices.length
    const sharedDeviceCount = feedProjection?.sharedDeviceCount ?? 0
    const usesReceivingOnlySupplyDevices = feedProjection == null
    supplyTrunkDevices.forEach((device, index) => {
      // Index 0 = next to supply (rightmost), index n-1 = next to main bus (leftmost)
      const deviceX = supplyBendX + (n - index) * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
      const feedScope = index < sharedDeviceCount ? 'shared' : 'root'
      // Receiving-only continuation chains keep the persisted root-feed trunkPosition so
      // hit-zone insert indices stay aligned with addSupplyTrunkDevice splice positions.
      const feedIndex = usesReceivingOnlySupplyDevices
        ? (device.trunkPosition ?? index)
        : feedScope === 'shared'
          ? index
          : index - sharedDeviceCount
      const deviceY =
        hasSupplyChangeover &&
        (device.supplyPath === 'backup' || device.supplyPath === 'backup-output')
          ? supplyY - changeoverLaneOffset
          : hasSupplyChangeover && index < supplyChangeoverIndex
            ? supplySourceY
            : hasDirectConverter &&
                device.supplyPath !== 'converter-branch' &&
                device.supplyPath !== 'converter-dc' &&
                device.supplyPath !== 'converter-dc-top'
              ? supplySourceY
              : supplyY
      supplyDevicePositions.push({ device, x: deviceX, y: deviceY, feedScope, feedIndex })
    })
    const changeoverDevicePosition = supplyDevicePositions.find(
      ({ device }) => device.symbol === 'source_changeover'
    )
    if (changeoverDevicePosition) {
      const loadSideSerialPositions = supplyDevicePositions
        .filter(({ device }) => {
          const deviceIndex = supplyTrunkDevices.findIndex(
            (candidate) => candidate.id === device.id
          )
          return (
            deviceIndex > supplyChangeoverIndex &&
            (device.supplyPath == null || device.supplyPath === 'serial')
          )
        })
        .sort((left, right) => {
          const leftIndex = supplyTrunkDevices.findIndex(
            (candidate) => candidate.id === left.device.id
          )
          const rightIndex = supplyTrunkDevices.findIndex(
            (candidate) => candidate.id === right.device.id
          )
          return rightIndex - leftIndex
        })
      const loadSideSerialCount = loadSideSerialPositions.length
      // Branch-only devices must never move the source selector or its load-side devices.
      const loadSideExpansion =
        loadSideSerialCount * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING +
        (loadSideSerialCount > 0 ? LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_LOAD_BOUNDARY_CLEARANCE : 0)
      // One grid-input protection fits on the existing rail-to-selector span. Further
      // protections extend that span, sharing any expansion already required by load-side devices.
      const gridInputExpansion =
        Math.max(0, changeoverGridDeviceCount - 1) * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
      changeoverDevicePosition.x =
        supplyBendX +
        LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING +
        Math.max(loadSideExpansion, gridInputExpansion)
      // Keep load-side devices anchored from the panel handoff. Their initial array-based
      // positions also count devices on the independent changeover input branches, which can
      // otherwise push a load protection into the selector instead of the visible output span.
      loadSideSerialPositions.forEach((position, index) => {
        position.x = supplyBendX + (index + 1) * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
        position.y = changeoverDevicePosition.y
      })
      const upperY = changeoverDevicePosition.y - changeoverLaneOffset
      // Port-1 devices sit inline on the horizontal tap wire with the converter-input tap: they
      // never change the vertical geometry there.
      const riserDeviceCount = usesConverterInputTap ? 0 : changeoverGridInputLegDeviceCount
      const baseLowerY =
        changeoverDevicePosition.y +
        changeoverLaneOffset +
        Math.max(0, riserDeviceCount - 1) * LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_VERTICAL_EXPANSION
      const changeoverPortOffset = SUPPLY_CHANGEOVER_PORT_OFFSET
      const changeoverLegTopY = changeoverDevicePosition.y + changeoverPortOffset
      const changeoverLegRequiredLowerY =
        changeoverLegTopY +
        (riserDeviceCount + 1) * LAYOUT_CONSTANTS.SUPPLY_VERTICAL_LEG_DEVICE_SPACING
      const converterLegRequiredLowerY =
        upperY +
        (converterGridInputLegDeviceCount + 1) * LAYOUT_CONSTANTS.SUPPLY_VERTICAL_LEG_DEVICE_SPACING
      const gridTapLowerY = Math.max(
        baseLowerY,
        riserDeviceCount > 0 ? changeoverLegRequiredLowerY : baseLowerY,
        converterGridInputLegDeviceCount > 0 ? converterLegRequiredLowerY : baseLowerY
      )
      // Grid-tap positions of the leg and port-1 riser devices. The converter-input tap is
      // planned on this geometry so switching the source keeps everything else in place.
      const gridTapLegPositions = orderConverterGridLegDevicesFromConverter(
        supplyDevicePositions.filter(
          ({ device }) =>
            device.supplyPath === 'converter-grid' &&
            isConverterGridLegPlacement(device.converterGridPlacement)
        )
      )
      const converterInputTapPlan = usesConverterInputTap
        ? planConverterInputTap({
            port1Y: changeoverLegTopY,
            lowerY: gridTapLowerY,
            leg: gridTapLegPositions.map(({ device }, index) => ({
              id: device.id,
              device,
              y:
                upperY +
                ((index + 1) * (gridTapLowerY - upperY)) / (gridTapLegPositions.length + 1),
            })),
            // Port-1 devices are placed inline on the tap wire below, so they never move the T.
            portOne: [],
            gridLaneLabels: converterGridInlineDeviceCount > 0,
          })
        : undefined
      const lowerY = converterInputTapPlan?.lowerY ?? gridTapLowerY
      supplyChangeoverLowerY = lowerY
      // The source and lower grid rail are the physical endpoint of these vertical
      // legs. Keep that endpoint aligned with the expanded leg so canvas and PDF
      // wires grow along with the devices instead of stopping at the old lane height.
      supplySourceY = lowerY
      const elbowX =
        changeoverDevicePosition.x +
        LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE / 2 +
        changeoverElbowLead
      // With the converter-input tap the port-1 feed leaves the switch close by and runs
      // horizontally at the T's height; its devices sit inline on that wire.
      const tapRiserX =
        changeoverDevicePosition.x +
        LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE / 2 +
        LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_ELBOW_LEAD
      // The port-2 wire bends down at the port-1 riser only while that riser carries devices;
      // otherwise right beside the switch.
      const backupLaneStartX =
        !usesConverterInputTap && changeoverGridInputLegDeviceCount > 0 ? elbowX : tapRiserX
      const gridTapConverterX = getChangeoverBackupLaneEndX({
        elbowX,
        laneStartX: backupLaneStartX,
        backupOutputCount: backupOutputDeviceCount,
        otherLaneCount: converterGridInlineDeviceCount,
      })
      const tapLane = converterInputTapPlan
        ? planConverterInputTapLane({
            converterX: gridTapConverterX,
            riserX: tapRiserX,
            tapY: converterInputTapPlan.tapY,
            lowerY,
            legDevices: gridTapLegPositions.map(({ device }) => device),
            portOne: supplyDevicePositions
              .filter(
                ({ device }) =>
                  device.supplyPath === 'changeover-grid' &&
                  device.changeoverGridPlacement === 'input-leg'
              )
              .map(({ device }) => device),
            gridLaneDevices: supplyDevicePositions
              .filter(
                ({ device }) =>
                  device.supplyPath === 'converter-grid' &&
                  !isConverterGridLegPlacement(device.converterGridPlacement)
              )
              .map(({ device }, index) => ({
                device,
                x:
                  elbowX +
                  LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_SLOT_LENGTH +
                  index * LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_BRANCH_DEVICE_SPACING,
              })),
          })
        : undefined
      const converterX = tapLane?.converterX ?? gridTapConverterX
      const converterPosition = supplyDevicePositions.find(
        ({ device }) => device.supplyPath === 'backup'
      )
      if (converterPosition) {
        converterPosition.x = converterX
        converterPosition.y = upperY
        supplyDevicePositions
          .filter(({ device }) => device.supplyPath === 'converter-dc')
          .forEach((position, index) => {
            position.x =
              converterPosition.x +
              getSupplyConverterDcDeviceOffset(converterPosition.device, index)
            position.y = converterPosition.y
          })
        supplyDevicePositions
          .filter(({ device }) => device.supplyPath === 'converter-dc-top')
          .forEach((position) => {
            const connectionIndex = getSupplyConverterDcConnectionIndex(position.device) ?? 1
            const laneDevices = supplyDevicePositions.filter(
              ({ device }) => getSupplyConverterDcConnectionIndex(device) === connectionIndex
            )
            const laneIndex = laneDevices.findIndex(
              ({ device }) => device.id === position.device.id
            )
            position.x =
              converterPosition.x +
              (connectionIndex - 1) * CIRCUIT_CONVERTER_BLOCK_SIZE +
              (laneDevices.length === 1
                ? 0
                : CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD +
                  laneIndex * LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_DEVICE_SPACING)
            position.y = getCircuitConverterOutputRowY(
              converterPosition.device,
              converterPosition.y,
              connectionIndex - 1,
              topLaneRowExtraGap
            )
          })
      }

      const backupOutputPositions = supplyDevicePositions.filter(
        ({ device }) => device.supplyPath === 'backup-output'
      ).sort((a, b) => a.device.trunkPosition - b.device.trunkPosition || a.device.id.localeCompare(b.device.id))
      // Centred on the wire as drawn.
      const backupOutputOffsets = getChangeoverBackupLaneOffsets(
        backupOutputPositions.length,
        converterX - backupLaneStartX
      )
      backupOutputPositions.forEach((position, index) => {
        position.x = backupLaneStartX + backupOutputOffsets[index]!
        position.y = upperY
      })

      const changeoverGridPositions = supplyDevicePositions.filter(
        ({ device }) =>
          device.supplyPath === 'changeover-grid' && device.changeoverGridPlacement !== 'input-leg'
      )
      changeoverGridPositions.forEach((position, index) => {
        position.x = groundX + (index + 1) * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
        position.y = lowerY
      })
      const changeoverGridInputLegPositions = supplyDevicePositions.filter(
        ({ device }) =>
          device.supplyPath === 'changeover-grid' && device.changeoverGridPlacement === 'input-leg'
      )
      changeoverGridInputLegPositions.forEach((position, index) => {
        const inlineX = tapLane?.x.get(position.device.id)
        if (inlineX != null && converterInputTapPlan) {
          position.x = inlineX
          position.y = converterInputTapPlan.tapY
          return
        }
        position.x = elbowX
        position.y =
          changeoverDevicePosition.y +
            changeoverPortOffset +
            ((changeoverGridInputLegPositions.length - index) *
              (gridTapLowerY - changeoverDevicePosition.y - changeoverPortOffset)) /
              (changeoverGridInputLegPositions.length + 1)
      })

      const converterGridPositions = supplyDevicePositions.filter(
        ({ device }) =>
          device.supplyPath === 'converter-grid' &&
          !isConverterGridLegPlacement(device.converterGridPlacement)
      )
      converterGridPositions.forEach((position, index) => {
        position.x =
          elbowX +
          LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_SLOT_LENGTH +
          index * LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_BRANCH_DEVICE_SPACING
        position.y = lowerY
      })
      // Drawn from the converter down to the grid lane: converter-only devices first.
      const converterGridInputLegPositions = orderConverterGridLegDevicesFromConverter(
        supplyDevicePositions.filter(
          ({ device }) =>
            device.supplyPath === 'converter-grid' &&
            isConverterGridLegPlacement(device.converterGridPlacement)
        )
      )
      converterGridInputLegPositions.forEach((position, index) => {
        position.x = converterX
        position.y =
          converterInputTapPlan?.y.get(position.device.id) ??
          upperY +
            ((index + 1) * (gridTapLowerY - upperY)) / (converterGridInputLegPositions.length + 1)
      })
      if (converterInputTapPlan) {
        supplyConverterInputTap = {
          x: converterX,
          y: converterInputTapPlan.tapY,
          riserX: tapRiserX,
        }
      }

      const sourceSerialPositions = supplyDevicePositions
        .filter((position) => {
          const deviceIndex = supplyTrunkDevices.findIndex(
            (candidate) => candidate.id === position.device.id
          )
          return (
            deviceIndex < supplyChangeoverIndex &&
            (position.device.supplyPath == null || position.device.supplyPath === 'serial')
          )
        })
        .sort((left, right) => {
          const leftIndex = supplyTrunkDevices.findIndex(
            (candidate) => candidate.id === left.device.id
          )
          const rightIndex = supplyTrunkDevices.findIndex(
            (candidate) => candidate.id === right.device.id
          )
          return rightIndex - leftIndex
        })
      const minimumSourceSerialX = converterX + LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
      sourceSerialPositions.forEach((position, index) => {
        position.x = minimumSourceSerialX + index * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
        position.y = lowerY
      })
    }
    if (hasDirectConverter) {
      const converterPosition = supplyDevicePositions.find(
        ({ device }) => device.supplyPath === 'converter-branch'
      )
      if (converterPosition) {
        const backupCircuitLayout = circuitLayouts.find(
          ({ circuit }) =>
            circuit.supplySource?.kind === 'converter-backup' &&
            circuit.supplySource.converterId === converterPosition.device.id
        )
        const backupBranches = backupCircuitLayout
          ? branches.filter((branch) => branch.circuitId === backupCircuitLayout.circuit.id)
          : []
        const backupHasPanelEndpoint =
          backupCircuitLayout?.circuit.endpoints.some(
            (endpoint) => endpoint.symbol === 'panel_distribution'
          ) === true || !!backupCircuitLayout?.protection?.subPanelId
        const backupEndpointLeadExpansion =
          LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING - LAYOUT_CONSTANTS.BRANCH_LEAD_IN
        const backupHorizontalWidth = backupCircuitLayout
          ? Math.max(
              ...backupBranches.map((branch) =>
                branch.endpoints.some((endpoint) => endpoint.symbol !== 'panel_distribution')
                  ? branch.branchWidth + backupEndpointLeadExpansion
                  : branch.branchWidth
              ),
              backupHasPanelEndpoint ? LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING : 0,
              0
            ) +
            LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
          : 0
        const converterArrayIndex = supplyTrunkDevices.findIndex(
          (device) => device.id === converterPosition.device.id
        )
        const lowerSerialPositions = supplyDevicePositions.filter(
          ({ device }) => device.supplyPath == null || device.supplyPath === 'serial'
        )
        const sourceSerialPositions = lowerSerialPositions.filter(
          ({ device }) =>
            supplyTrunkDevices.findIndex((candidate) => candidate.id === device.id) <
            converterArrayIndex
        )
        const loadSerialPositions = lowerSerialPositions.filter(
          ({ device }) =>
            supplyTrunkDevices.findIndex((candidate) => candidate.id === device.id) >
            converterArrayIndex
        )
        const busSideDeviceClearance =
          LAYOUT_CONSTANTS.SUPPLY_DIRECT_CONVERTER_BACKUP_LEFT_CLEARANCE +
          LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 +
          (LAYOUT_CONSTANTS.SUPPLY_DIRECT_CONVERTER_PROTECTION_SPACING -
            LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING)
        const directGridPositions = supplyDevicePositions.filter(
          ({ device }) =>
            device.supplyPath === 'converter-grid' &&
            !isConverterGridLegPlacement(device.converterGridPlacement)
        )
        const directGridInputLegPositions = orderConverterGridLegDevicesFromConverter(
          supplyDevicePositions.filter(
            ({ device }) =>
              device.supplyPath === 'converter-grid' &&
              isConverterGridLegPlacement(device.converterGridPlacement)
          )
        )
        const lowerLanePositions = [...loadSerialPositions, ...directGridPositions].sort(
          (left, right) => {
            const leftIndex = supplyTrunkDevices.findIndex(
              (candidate) => candidate.id === left.device.id
            )
            const rightIndex = supplyTrunkDevices.findIndex(
              (candidate) => candidate.id === right.device.id
            )
            return leftIndex - rightIndex
          }
        )
        const lowerGridDeviceCount = lowerLanePositions.length
        const lowerLaneWidth =
          lowerGridDeviceCount > 0
            ? lowerGridDeviceCount * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING + busSideDeviceClearance
            : LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
        const upperBackupLaneWidth = backupCircuitLayout
          ? LAYOUT_CONSTANTS.SUPPLY_DIRECT_CONVERTER_PROTECTION_SPACING +
            backupHorizontalWidth +
            LAYOUT_CONSTANTS.SUPPLY_DIRECT_CONVERTER_BACKUP_LEFT_CLEARANCE
          : 0
        const hasSeparateAcPorts = converterPosition.device.converterAcConnection === 'separate'
        // Give the output protection's properties room beside the grid-input leg.
        const outputLaneWidth =
          Math.max(LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING * 2.88, upperBackupLaneWidth) +
          Math.max(0, loadSerialPositions.length - 1) * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
        // Shared-port lanes reserve their widest parallel run. Separate ports
        // size the output independently of protections on the grid input.
        converterPosition.x =
          supplyBendX +
          (hasSeparateAcPorts ? outputLaneWidth : Math.max(lowerLaneWidth, upperBackupLaneWidth))
        sourceSerialPositions.forEach((position, index) => {
          position.x =
            converterPosition.x +
            (sourceSerialPositions.length - index) * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
        })
        lowerLanePositions.forEach((position, index) => {
          position.x =
            converterPosition.x -
            (lowerLanePositions.length - index) * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
        })
        converterPosition.y = supplyY
        if (hasSeparateAcPorts) {
          // The load leaves the inverter's backup terminal, not its grid tap.
          // Keep the group centered on the complete output run. The first device
          // uses its existing space; only subsequent devices lengthen the run.
          loadSerialPositions.forEach((position, index) => {
            position.x =
              (supplyBendX + converterPosition.x) / 2 +
              ((loadSerialPositions.length - 1) / 2 - index) *
                LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
            position.y = converterPosition.y
          })
        }
        directGridPositions.forEach((position) => {
          position.y = supplySourceY
        })
        if (converterPosition.device.converterAcConnection === 'separate') {
          directGridPositions.forEach((position, index) => {
            position.x = converterPosition.x + (index + 1) * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
          })
          sourceSerialPositions.forEach((position) => {
            position.x += directGridPositions.length * LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
          })
        }
        directGridInputLegPositions.forEach((position, index) => {
          position.x = converterPosition.x
          position.y =
            converterPosition.y +
            ((index + 1) * (supplySourceY - converterPosition.y)) /
              (directGridInputLegPositions.length + 1)
        })
        supplyDevicePositions
          .filter(({ device }) => device.supplyPath === 'converter-dc')
          .forEach((position, index) => {
            position.x =
              converterPosition.x +
              getSupplyConverterDcDeviceOffset(converterPosition.device, index)
            position.y = converterPosition.y
          })
        supplyDevicePositions
          .filter(({ device }) => device.supplyPath === 'converter-dc-top')
          .forEach((position) => {
            const connectionIndex = getSupplyConverterDcConnectionIndex(position.device) ?? 1
            const laneDevices = supplyDevicePositions.filter(
              ({ device }) => getSupplyConverterDcConnectionIndex(device) === connectionIndex
            )
            const laneIndex = laneDevices.findIndex(
              ({ device }) => device.id === position.device.id
            )
            position.x =
              converterPosition.x +
              (connectionIndex - 1) * CIRCUIT_CONVERTER_BLOCK_SIZE +
              (laneDevices.length === 1
                ? 0
                : CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD +
                  laneIndex * LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_DEVICE_SPACING)
            position.y = getCircuitConverterOutputRowY(
              converterPosition.device,
              converterPosition.y,
              connectionIndex - 1,
              topLaneRowExtraGap
            )
          })

        const converterLeftX = converterPosition.x - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
        const protectionX =
          converterPosition.x - LAYOUT_CONSTANTS.SUPPLY_DIRECT_CONVERTER_PROTECTION_SPACING
        if (backupCircuitLayout) {
          const backupY =
            converterPosition.y -
            (converterPosition.device.converterAcConnection === 'separate'
              ? LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING * 2
              : 0)
          backupCircuitLayout.x =
            protectionX - getProtectionAnchorOffset(backupCircuitLayout.leftReserve)
          backupCircuitLayout.protectionY = backupY
          backupBranches.forEach((branch) => {
            if (branch.endpoints.some((endpoint) => endpoint.symbol !== 'panel_distribution')) {
              branch.branchWidth += backupEndpointLeadExpansion
            }
            if (backupHasPanelEndpoint) {
              branch.branchWidth = Math.max(
                branch.branchWidth,
                LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
              )
            }
            branch.trunkX = protectionX
            branch.trunkY = backupY
            branch.branchX = protectionX - branch.branchWidth
            branch.branchY = backupY
          })
          directConverterBackup = {
            converterId: converterPosition.device.id,
            x1: protectionX,
            x2:
              converterPosition.device.converterAcConnection === 'separate'
                ? (protectionX + converterLeftX) / 2
                : converterLeftX,
            y: backupY,
            circuitId: backupCircuitLayout.circuit.id,
            protectionId: backupCircuitLayout.protection?.id,
          }
        } else if (converterPosition.device.converterAcConnection !== 'separate') {
          directConverterBackup = {
            converterId: converterPosition.device.id,
            x1: converterPosition.x - LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_SLOT_LENGTH,
            x2: converterLeftX,
            y: converterPosition.y,
          }
        }
      }
    }
    // Supply symbol is right of the first device (index 0 = supply side)
    const lowerSupplyPositions = hasDirectConverter
      ? supplyDevicePositions.filter(
          ({ device }) =>
            // DC-bus children are positioned as fan-out branches below. They start
            // with a provisional serial position, which must not reserve source-side
            // rail length before that repositioning happens.
            !device.supplyDcBusId &&
            device.supplyPath !== 'converter-branch' &&
            device.supplyPath !== 'converter-dc' &&
            device.supplyPath !== 'converter-dc-top' &&
            (device.supplyPath !== 'converter-grid' ||
              supplyTrunkDevices[directConverterIndex]?.converterAcConnection === 'separate')
        )
      : hasSupplyChangeover
        ? supplyDevicePositions.filter(
            ({ device }) =>
              device.supplyPath == null ||
              device.supplyPath === 'serial' ||
              device.supplyPath === 'backup'
          )
        : supplyDevicePositions
    const lowerSupplyRightmostX =
      lowerSupplyPositions.length > 0
        ? Math.max(...lowerSupplyPositions.map((position) => position.x))
        : supplyBendX
    supplyX =
      lowerSupplyRightmostX +
      (hasSupplyChangeover
        ? LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_GRID_SOURCE_LEAD
        : LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING)
    if (hasDirectConverter) {
      const isolatedConverter = supplyDevicePositions.find(
        ({ device }) =>
          device.supplyPath === 'converter-branch' && device.converterGridInputConnected === false
      )
      if (isolatedConverter) {
        // The disconnected converter no longer contributes a vertical grid-input leg, but it
        // remains a waypoint in the split-feed drawing. Keep the source endpoint beyond its
        // expanded backup lane so the lower wire cannot continue through the supply symbol.
        supplyX = Math.max(supplyX, isolatedConverter.x + LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING)
      }
    }
  } else if (!isSubPanel) {
    // Minimum horizontal run before the supply symbol when the trunk is empty so the
    // diagram does not collapse (stable dashed separator, drop targets, and export).
    supplyX += LAYOUT_CONSTANTS.SUPPLY_DEVICE_SPACING
  }

  return {
    isSubPanel,
    hasGround,
    supplyY,
    groundX,
    groundY,
    groundTrunkDevices,
    groundDevicePositions,
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
    backupOutputDeviceCount,
    changeoverGridDeviceCount,
    changeoverGridInputLegDeviceCount,
    inlineSupplyConverter,
    changeoverLaneOffset,
    supplySourceY,
    supplyDevicePositions,
    supplyChangeoverLowerY,
    supplyConverterInputTap,
  }
}

export type BottomUpSupplyLayoutPass = ReturnType<typeof calculatePanelSupplyLayout>
