/** Painted supply-device, DC branch and metadata envelopes used by layout and mirroring. */
import type { TrunkDevice } from '@/types/schema'
import { DOMOTICA_BASE_HEIGHT } from '@/lib/domoticaLayout'
import { getVisibleCertificationLabelParts } from '@/lib/certificationLabels'
import { getVisibleConversionLabelParts } from '@/lib/conversionLabels'
import { isSymbolLabelVisible } from '@/lib/symbolLabels'
import { getJunctionIdentity, isJunctionIdentityVisibleByDefault } from '@/lib/junctionIdentity'
import { countSymbolLabelVisualLines } from '@/lib/symbolLabelMetrics'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import {
  isSupplyMetadataCalloutDevice,
  shouldUseSupplyMetadataCallout,
} from '@/lib/supplyMetadataCallout'
import { getSupplyDeviceMultiplier } from '@/lib/supplyAssembly/inverterMultipliers'
import { applyMetadataCalloutMultiplier, getMetadataCalloutWidth } from '@/lib/metadataCalloutGrouping'
import { getProtectionOneWireAnchorLineIndex } from '@/lib/protectionLabels'
import { hasSupplyInlineLabels, getSupplyInlineLabelLines } from './supplyInlineDeviceLabels'
import {
  CIRCUIT_CONVERTER_BLOCK_SIZE,
  CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD,
  getCircuitConverterBodyGeometry,
  getCircuitConverterDcConnectionCount,
  supportsCircuitConverterDcConnections,
} from './circuitConverterGeometry'
import { isVerticalSupplyDevice } from './supplyDeviceOrientation'
import { getNestedLaneMaxSlot } from './supplyNestedConverterLanes'
import {
  LAYOUT_CONSTANTS,
  SUPPLY_TOP_LABEL_FONT_SIZE,
  SUPPLY_TOP_LABEL_LINE_SPACING,
  SUPPLY_TOP_LABEL_OFFSET_FROM_SYMBOL,
  SUPPLY_METADATA_CALLOUT_DEVICE_TOP_EXTRA,
  SUPPLY_METADATA_CALLOUT_INVERTER_TOP_EXTRA,
} from './bottomUpLayoutConstants'

export function getSupplyMetadataCalloutLines(device: TrunkDevice, multiplier = 1): string[] {
  const certificationParts = getVisibleCertificationLabelParts(device)
  const conversionParts =
    device.type === 'conversion' || device.symbol === 'solar_panel' || device.symbol === 'battery'
      ? getVisibleConversionLabelParts(device)
      : []
  const showNotes =
    (device.notes ?? '').trim().length > 0 &&
    isSymbolLabelVisible(device.symbolLabelDisplay, 'trunkDeviceNotes', true)
  return applyMetadataCalloutMultiplier(
    [
      ...conversionParts,
      ...certificationParts,
      ...(showNotes ? [{ key: 'trunkDeviceNotes', text: (device.notes ?? '').trim() }] : []),
    ],
    multiplier
  ).map((item) => item.text)
}

export interface SupplyDcBusBranchBounds {
  left: number
  right: number
  top: number
  bottom: number
  /**
   * Distance from the branch centre to the far edge of the strings on the further outputs of a
   * multi-port converter, away from the bus (the supply is always drawn mirrored, so that is the
   * visual left). Only the next branch outwards has to clear it; the strings' own positions
   * size the frame.
   */
  outwardLaneReach?: number
}

function getSupplyDcBusBranchTextWidth(text: string, fontSize: number): number {
  return Math.max(
    0,
    ...text.split(/\r?\n/).map((line) => measureSymbolLabelTextWidth(line, 'Figtree', fontSize))
  )
}

export function getSupplyDcBusBranchBounds(devices: TrunkDevice[]): SupplyDcBusBranchBounds {
  const halfSymbol = LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
  const domoticaDevices = devices.filter(
    (device) => device.symbol === 'domotica' && device.supplyDcBusId != null
  )
  // Supply-bus domotica is a single DC device. Its regular-panel endpoint
  // count is intentionally not part of the supply branch geometry.
  const maxDomoticaVariableHeight = 0
  let bounds: SupplyDcBusBranchBounds = {
    left: -halfSymbol,
    right: halfSymbol,
    top:
      domoticaDevices.length > 0
        ? -(DOMOTICA_BASE_HEIGHT / 2 + maxDomoticaVariableHeight)
        : -halfSymbol,
    bottom: domoticaDevices.length > 0 ? DOMOTICA_BASE_HEIGHT / 2 : halfSymbol,
  }

  const extend = (next: Partial<SupplyDcBusBranchBounds>) => {
    bounds = {
      ...bounds,
      left: Math.min(bounds.left, next.left ?? bounds.left),
      right: Math.max(bounds.right, next.right ?? bounds.right),
      top: Math.min(bounds.top, next.top ?? bounds.top),
      bottom: Math.max(bounds.bottom, next.bottom ?? bounds.bottom),
    }
  }

  for (const device of devices) {
    if (
      device.supplyDcBusId &&
      supportsCircuitConverterDcConnections(device) &&
      getCircuitConverterDcConnectionCount(device) > 1
    ) {
      const connectionCount = getCircuitConverterDcConnectionCount(device)
      // The strings fed by the outputs stack upright like any other branch; side by side they
      // are spaced so their captions fit (see getNestedConverterLaneSpacing).
      const lanes = devices.filter(
        (candidate) => candidate.converterDcConnection?.converterId === device.id
      )
      const outermostSlot = getNestedLaneMaxSlot(lanes, device.id)
      const laneReach =
        outermostSlot > 0
          ? outermostSlot * getNestedConverterLaneSpacing(lanes) -
            getSupplyDcBusBranchBounds(lanes).left
          : 0
      bounds.outwardLaneReach = Math.max(bounds.outwardLaneReach ?? 0, laneReach)
      extend({
        right: halfSymbol + (connectionCount - 1) * CIRCUIT_CONVERTER_BLOCK_SIZE,
        top:
          -halfSymbol -
          CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD -
          connectionCount * LAYOUT_CONSTANTS.ENDPOINT_BRANCH_SPACING,
      })
    }
    // These are the labels that TrunkDeviceSymbol renders beside a vertical
    // DC-bus branch. Names and notes use the separate left-side stack below.
    const rightLabelLines = hasSupplyInlineLabels(device)
      ? []
      : [
          ...(device.type === 'conversion' ||
          device.symbol === 'transformer' ||
          device.symbol === 'rectifier' ||
          device.symbol === 'inverter' ||
          device.symbol === 'dc_dc_converter' ||
          device.symbol === 'solar_panel' ||
          device.symbol === 'battery'
            ? getVisibleConversionLabelParts(device).map((part) => part.text)
            : []),
          ...getVisibleCertificationLabelParts(device).map((part) => part.text),
        ]
    const rightLabelWidth = Math.max(
      0,
      ...rightLabelLines.map((line) => getSupplyDcBusBranchTextWidth(line, 8))
    )
    if (rightLabelWidth > 0) {
      const lineHeight = 10
      const contentHeight = rightLabelLines.reduce(
        (height, line) => height + countSymbolLabelVisualLines(line) * lineHeight,
        0
      )
      const blockTop = -contentHeight / 2
      extend({
        right: halfSymbol + 5 + rightLabelWidth,
        top: blockTop,
        bottom: blockTop + contentHeight,
      })
    }

    if (device.type !== 'dc_bus') {
      // RenderNode gives every upright DC branch showDeviceLabelLeft. Its name
      // and visible notes are centered together beside the symbol, including
      // protection names; reserve that exact side before branches are mirrored.
      const sideLines = [
        device.label?.trim() ?? '',
        ...(isSymbolLabelVisible(device.symbolLabelDisplay, 'trunkDeviceNotes', true)
          ? [device.notes?.trim() ?? '']
          : []),
      ].filter(Boolean)
      const fontSize = hasSupplyInlineLabels(device) ? 11 : 8
      const sideWidth = Math.max(
        0,
        ...sideLines.map((line) => getSupplyDcBusBranchTextWidth(line, fontSize))
      )
      const sideHeight = sideLines.reduce(
        (height, line) => height + countSymbolLabelVisualLines(line) * (fontSize + 2),
        0
      )
      if (sideLines.length > 0) {
        extend({
          left: -(halfSymbol + 5) - sideWidth,
          top: -sideHeight / 2,
          bottom: sideHeight / 2,
        })
      }
    }

    if (hasSupplyInlineLabels(device)) {
      const topMetadataLines = [
        ...getVisibleCertificationLabelParts(device).map((part) => part.text),
      ]
      const metadataHeight = topMetadataLines.reduce(
        (height, line) => height + countSymbolLabelVisualLines(line) * 10,
        0
      )
      const metadataWidth = Math.max(
        0,
        ...topMetadataLines.map((line) => getSupplyDcBusBranchTextWidth(line, 8))
      )
      if (metadataHeight > 0)
        extend({
          left: -metadataWidth / 2,
          right: metadataWidth / 2,
          top: -(halfSymbol + 5 + metadataHeight),
        })
      const technicalLines = getSupplyInlineLabelLines(device)
      const technicalWidth = Math.max(
        0,
        ...technicalLines.map((line) => getSupplyDcBusBranchTextWidth(line.text, 10))
      )
      if (technicalLines.length > 0) {
        const lineHeight = 12
        const contentHeight = technicalLines.length * lineHeight
        const blockTop = -getProtectionOneWireAnchorLineIndex(technicalLines) * lineHeight - 10 / 2
        extend({
          right: halfSymbol + LAYOUT_CONSTANTS.PROTECTION_LABEL_GAP + technicalWidth,
          top: blockTop,
          bottom: blockTop + contentHeight,
        })
      }
    }
  }

  return bounds
}

export function estimateSupplyMetadataCalloutSize(lines: string[]): { width: number; height: number } {
  const visualLineCount = lines.reduce(
    (total, line) => total + countSymbolLabelVisualLines(line),
    0
  )
  const longestLineWidth = Math.max(
    0,
    ...lines.flatMap((line) =>
      line
        .split(/\r?\n/)
        .map((visualLine) =>
          Math.max(visualLine.length * 5, measureSymbolLabelTextWidth(visualLine, 'Figtree', 8))
        )
    )
  )
  return {
    width: getMetadataCalloutWidth([longestLineWidth]),
    height: visualLineCount * 10 + 10,
  }
}

function getSupplyMetadataCalloutTopExtra(device: TrunkDevice, peers: TrunkDevice[] = []): number {
  const lines = getSupplyMetadataCalloutLines(device)
  if (!isSupplyMetadataCalloutDevice(device) || lines.length === 0) return 0
  if (shouldUseSupplyMetadataCallout(lines, getSupplyDeviceMultiplier(device))) {
    return device.symbol === 'inverter'
      ? SUPPLY_METADATA_CALLOUT_INVERTER_TOP_EXTRA
      : SUPPLY_METADATA_CALLOUT_DEVICE_TOP_EXTRA
  }
  // A short stack becomes a card only because a neighboring device needs one.
  // Reserve the shared device amount so grouping does not shift the established
  // supply row just to accommodate the inverter's upper-left leader.
  return peers.some(
    (peer) =>
      peer.id !== device.id &&
      isSupplyMetadataCalloutDevice(peer) &&
      shouldUseSupplyMetadataCallout(
        getSupplyMetadataCalloutLines(peer),
        getSupplyDeviceMultiplier(peer)
      )
  )
    ? SUPPLY_METADATA_CALLOUT_DEVICE_TOP_EXTRA
    : 0
}

/** Top edge of labels that TrunkDeviceSymbol stacks above a horizontal supply device. */
export function getSupplyDeviceTopExtent(
  device: TrunkDevice,
  y: number,
  peers: TrunkDevice[] = [],
  notesOrientation: 'horizontal' | 'vertical' = 'horizontal'
): number {
  const domoticaHeight =
    device.symbol === 'domotica' && device.supplyDcBusId != null
      ? DOMOTICA_BASE_HEIGHT
      : LAYOUT_CONSTANTS.SYMBOL_SIZE
  let top = y - domoticaHeight / 2
  // Devices mounted on a DC-bus riser render their conversion details and notes
  // to the right of the vertical trunk. They do not own the horizontal rail's
  // top label stack, so those lines must not move the frame upward or alter the
  // horizontal collision geometry. Top-port devices are different: they still
  // use the established metadata card above their symbol.
  if (device.supplyDcBusId) return top
  const certificationParts = getVisibleCertificationLabelParts(device)
  const conversionParts =
    device.type === 'conversion' || device.symbol === 'solar_panel' || device.symbol === 'battery'
      ? getVisibleConversionLabelParts(device)
      : []
  const certificationLineCount = certificationParts.reduce(
    (total, part) => total + countSymbolLabelVisualLines(part.text),
    0
  )
  const conversionLineCount = conversionParts.reduce(
    (total, part) => total + countSymbolLabelVisualLines(part.text),
    0
  )
  const showNotes =
    (device.notes ?? '').trim().length > 0 &&
    isSymbolLabelVisible(device.symbolLabelDisplay, 'trunkDeviceNotes', true)
  const notesAreVertical =
    notesOrientation === 'vertical' && !isVerticalSupplyDevice(device) && !device.supplyDcBusId
  const topLineCount =
    conversionLineCount + certificationLineCount + (showNotes && !notesAreVertical ? 1 : 0)
  if (topLineCount > 0) {
    const labelHeight = topLineCount * (SUPPLY_TOP_LABEL_FONT_SIZE + SUPPLY_TOP_LABEL_LINE_SPACING)
    top -= SUPPLY_TOP_LABEL_OFFSET_FROM_SYMBOL + labelHeight
    if (getSupplyMetadataCalloutTopExtra(device, peers) > 0) {
      // The callout frame and its leader sit a little farther above the symbol than
      // the old unframed label stack.
      // Inverter callouts use the upper-left placement (40px leader offset), while
      // solar and battery callouts use the centered top placement (28px offset).
      // Reserve the latter too; otherwise a detached supply frame can cut through
      // the new solar/battery metadata card at its top edge.
      top -= getSupplyMetadataCalloutTopExtra(device, peers)
    }
  }
  if (showNotes && notesAreVertical) {
    top = Math.min(
      top,
      y -
        domoticaHeight / 2 -
        SUPPLY_TOP_LABEL_OFFSET_FROM_SYMBOL -
        measureSymbolLabelTextWidth(
          (device.notes ?? '').trim(),
          'Figtree',
          SUPPLY_TOP_LABEL_FONT_SIZE
        )
    )
  }
  const showHorizontalTerminalStripIdentity =
    device.symbol === 'terminal_strip' &&
    !device.supplyDcBusId &&
    getJunctionIdentity(device).length > 0 &&
    isSymbolLabelVisible(
      device.symbolLabelDisplay,
      'junctionIdentityLabel',
      isJunctionIdentityVisibleByDefault(device.symbol)
    )
  if (showHorizontalTerminalStripIdentity) {
    // TrunkDeviceSymbol places a horizontal terminal-strip identity above the
    // symbol with a 5px gap and a 10px font at 12px line height.
    top -= 5 + 12
  }
  return top
}

export function getSupplyDeviceHorizontalPaintBounds(device: TrunkDevice, x: number, y: number) {
  if (
    device.supplyDcBusId &&
    supportsCircuitConverterDcConnections(device) &&
    getCircuitConverterDcConnectionCount(device) > 1
  ) {
    return getCircuitConverterBodyGeometry(device, { x, y })
  }
  if (
    supportsCircuitConverterDcConnections(device) &&
    (device.supplyPath === 'converter-branch' || device.supplyPath === 'backup')
  ) {
    // Supply layouts are measured in their canonical left-to-right direction
    // and mirrored only after all collision blocks have been created. Measure
    // the converter growing right here so that the mirrored block grows left
    // with the rendered supply converter.
    return getCircuitConverterBodyGeometry(device, { x, y })
  }
  if (device.type === 'dc_bus') {
    return {
      left: x - 20,
      right: x + LAYOUT_CONSTANTS.DC_BUS_MIN_WIDTH,
      center: { x: x + LAYOUT_CONSTANTS.DC_BUS_MIN_WIDTH / 2, y },
    }
  }
  return {
    left: x - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
    right: x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
    center: { x, y },
  }
}

/** Distance between two strings fed by neighbouring outputs of one converter, wide enough for the captions of both. */
export function getNestedConverterLaneSpacing(laneDevices: TrunkDevice[]): number {
  const bounds = getSupplyDcBusBranchBounds(laneDevices)
  return Math.max(
    CIRCUIT_CONVERTER_BLOCK_SIZE,
    Math.ceil(bounds.right - bounds.left + LAYOUT_CONSTANTS.SUPPLY_DC_BUS_BRANCH_LABEL_GAP)
  )
}
