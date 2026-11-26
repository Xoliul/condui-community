/** Converter/changeover lane planners and shared supply port geometry. */
import { LAYOUT_CONSTANTS } from './bottomUpLayoutConstants'

import { hasSupplyInlineLabels, getSupplyInlineLabelLines } from './supplyInlineDeviceLabels'

import type { TrunkDevice } from '@/types/schema'

import { countSymbolLabelVisualLines } from '@/lib/symbolLabelMetrics'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'

import { getSupplyConverterHorizontalGrowth } from './circuitConverterGeometry'

import { PROTECTION_TECHNICAL_LABEL_OFFSET_FROM_SYMBOL } from './bottomUpCircuitGeometry'

export function getSupplyConverterDcDeviceOffset(device: TrunkDevice, index: number): number {
  return (
    getSupplyConverterHorizontalGrowth(device) +
    LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_FIRST_DEVICE_OFFSET +
    index * LAYOUT_CONSTANTS.SUPPLY_CONVERTER_DC_DEVICE_SPACING
  )
}

export const SUPPLY_CONVERTER_EMPTY_DC_STUB_LENGTH = 24

export const SUPPLY_CONVERTER_EMPTY_DC_ROW_SPACING = 12

/** Half the height of the side texts beside a device on a vertical supply leg. */
export function getVerticalSupplySideLabelHalfHeight(device: TrunkDevice): number {
  const technicalLines = hasSupplyInlineLabels(device)
    ? getSupplyInlineLabelLines(device).reduce(
        (count, line) => count + countSymbolLabelVisualLines(line.text),
        0
      )
    : 0
  const label = (device.label ?? '').trim()
  const nameLines = label ? countSymbolLabelVisualLines(label) : 0
  return Math.max(LAYOUT_CONSTANTS.SYMBOL_SIZE / 2, (Math.max(technicalLines, nameLines) * 12) / 2)
}

/** Canonical changeover port offset from its center (ports 1 and 2 sit below/above it). */
export const SUPPLY_CHANGEOVER_PORT_OFFSET = (LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE * 7) / 24

export type PlannedLegDevice = { id: string; y: number; device: TrunkDevice }

/**
 * Where the port-1 tap joins the inverter grid-input leg (`converter-input`), drawn on the
 * geometry of the historical grid tap so switching between both only re-routes the port-1
 * feed. Port 1 keeps its riser; the riser ends at the T instead of the grid lane, and a
 * horizontal wire joins the leg there. The T must sit below the converter-only devices,
 * above the shared ones, below the port-1 devices, at or below port 1, and clear of all their
 * side texts. Positions only change when that is impossible: first the port-1 devices are
 * spread over the shorter riser, then the shared devices move down, and only as a last
 * resort the grid lane drops by the remaining shortfall.
 */
export function planConverterInputTap(input: {
  port1Y: number
  lowerY: number
  /** Leg devices from the converter down, at their grid-tap positions. */
  leg: PlannedLegDevice[]
  /** Port-1 riser devices at their grid-tap positions. */
  portOne: PlannedLegDevice[]
  /** Horizontal grid-lane devices whose name labels sit above the lane under the tap wire. */
  gridLaneLabels: boolean
}): { tapY: number; lowerY: number; y: Map<string, number> } {
  const clearance = 4
  const half = (entry: PlannedLegDevice) => getVerticalSupplySideLabelHalfHeight(entry.device)
  const above = input.leg.filter(({ device }) => device.converterGridPlacement === 'converter-leg')
  const below = input.leg.filter(({ device }) => device.converterGridPlacement !== 'converter-leg')
  // Below the T the tap wire may carry inline port-1 devices with a two-line caption; keep
  // room for it even while the wire is empty, so adding one never moves anything vertically.
  const tapGridReserve = LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 + 5 + 2 * 12 + clearance
  const gridReserve =
    (input.gridLaneLabels
      ? LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 + 5 + 12
      : LAYOUT_CONSTANTS.SYMBOL_SIZE / 2) + clearance
  const lowest = Math.max(
    input.port1Y,
    ...above.map((entry) => entry.y + half(entry) + clearance)
  )
  const highest = (lowerY: number, shared: PlannedLegDevice[]) =>
    Math.min(
      lowerY - Math.max(gridReserve, tapGridReserve),
      ...shared.map((entry) => entry.y - half(entry) - clearance)
    )
  const portOneHalf = Math.max(0, ...input.portOne.map(half))
  // Riser devices sit beside the leg devices above the T, whose ratings face the riser: they
  // must not share a height with them.
  const clashesWithAbove = (y: number) =>
    above.some((entry) => Math.abs(entry.y - y) < half(entry) + portOneHalf + clearance)
  const riserStart = Math.max(
    input.port1Y,
    ...above.map((entry) => entry.y + half(entry) + clearance)
  )
  const keepPortOne =
    input.portOne.length > 0 && !input.portOne.some((entry) => clashesWithAbove(entry.y))
      ? Math.max(...input.portOne.map((entry) => entry.y)) + portOneHalf + clearance
      : Number.POSITIVE_INFINITY
  const portOnePitch = Math.max(2 * portOneHalf + clearance, 30)
  const spreadPortOne =
    input.portOne.length > 0
      ? (above.length > 0 ? riserStart : input.port1Y) +
        (input.portOne.length + 1) * portOnePitch
      : Number.NEGATIVE_INFINITY
  const y = new Map<string, number>()
  const spreadRiser = (tapY: number) => {
    const start = above.length > 0 ? riserStart : input.port1Y
    input.portOne.forEach((entry, index) => {
      y.set(
        entry.id,
        start + ((input.portOne.length - index) * (tapY - start)) / (input.portOne.length + 1)
      )
    })
  }
  const hi = highest(input.lowerY, below)
  const keepAll = Math.max(lowest, input.portOne.length > 0 ? keepPortOne : lowest)
  if (keepAll <= hi) return { tapY: keepAll, lowerY: input.lowerY, y }
  const withSpreadRiser = Math.max(lowest, spreadPortOne)
  if (withSpreadRiser <= hi) {
    const tapY = Math.max(withSpreadRiser, Math.min(keepPortOne, hi))
    if (tapY < keepPortOne) spreadRiser(tapY)
    return { tapY, lowerY: input.lowerY, y }
  }
  // The shared devices have to move below the T.
  const tapY = withSpreadRiser
  if (tapY < keepPortOne) spreadRiser(tapY)
  const sharedHalf = Math.max(LAYOUT_CONSTANTS.SYMBOL_SIZE / 2, ...below.map(half))
  const gap = Math.max(
    2 * sharedHalf + clearance,
    sharedHalf + gridReserve,
    LAYOUT_CONSTANTS.SUPPLY_VERTICAL_LEG_DEVICE_SPACING / 2 + clearance
  )
  const lowerY =
    below.length === 0
      ? Math.max(input.lowerY, tapY + Math.max(gridReserve, tapGridReserve))
      : Math.max(input.lowerY, tapY + (below.length + 1) * gap, tapY + tapGridReserve)
  below.forEach((entry, index) => {
    y.set(entry.id, tapY + ((index + 1) * (lowerY - tapY)) / (below.length + 1))
  })
  return { tapY, lowerY, y }
}

/**
 * Inline port-1 devices on the horizontal tap wire, at the T's height. The first stored device
 * sits in the middle of the wire, further ones step towards the switch; none ever sits nearer
 * the T than the middle. Their texts must clear the leg devices' ratings beside the T and the
 * name labels of grid-lane devices below. Only the horizontal span grows: when the devices need
 * more room the inverter leg moves away from the switch.
 */
export function planConverterInputTapLane(input: {
  converterX: number
  riserX: number
  tapY: number
  lowerY: number
  legDevices: TrunkDevice[]
  portOne: TrunkDevice[]
  gridLaneDevices: Array<{ device: TrunkDevice; x: number }>
}): { converterX: number; x: Map<string, number> } {
  const x = new Map<string, number>()
  if (input.portOne.length === 0) return { converterX: input.converterX, x }
  const clearance = 4
  const ratingsWidth = (device: TrunkDevice) =>
    hasSupplyInlineLabels(device)
      ? Math.max(
          0,
          ...getSupplyInlineLabelLines(device).map((line) =>
            // Rendered ratings run about as wide as 10 px Figtree in the browser metric.
            measureSymbolLabelTextWidth(line.text, 'Figtree', 10)
          )
        )
      : 0
  const ratingsLines = (device: TrunkDevice) =>
    hasSupplyInlineLabels(device)
      ? getSupplyInlineLabelLines(device).reduce(
          (count, line) => count + countSymbolLabelVisualLines(line.text),
          0
        )
      : 0
  const nameWidth = (device: TrunkDevice) =>
    (device.label ?? '').trim()
      ? measureSymbolLabelTextWidth((device.label ?? '').trim(), 'Figtree', 11)
      : 0
  const half = LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
  const portOneHalf = Math.max(
    half,
    ...input.portOne.map((device) => Math.max(ratingsWidth(device), nameWidth(device)) / 2)
  )
  const legReach = Math.max(
    0,
    ...input.legDevices.map((device) => {
      const width = ratingsWidth(device)
      return width > 0 ? half + PROTECTION_TECHNICAL_LABEL_OFFSET_FROM_SYMBOL + width : 0
    })
  )
  const firstOffset = Math.max(
    LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_BRANCH_DEVICE_SPACING,
    legReach + portOneHalf + clearance
  )
  const pitch = Math.max(
    LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_BRANCH_DEVICE_SPACING,
    2 * portOneHalf + clearance
  )
  const riserGap = portOneHalf + 10
  // Grid-lane name labels reach up towards the port-1 captions when the lanes are close.
  const captionBottom =
    input.tapY + half + 5 + Math.max(0, ...input.portOne.map(ratingsLines)) * 12 + clearance
  const blocked =
    input.lowerY - (half + 5 + 12) < captionBottom
      ? input.gridLaneDevices.map(({ device, x: deviceX }) => {
          const reach = Math.max(half, nameWidth(device) / 2) + portOneHalf + clearance
          return [deviceX - reach, deviceX + reach] as const
        })
      : []
  // The middle must leave the leg's ratings beside the T clear.
  let converterX = Math.max(input.converterX, input.riserX + 2 * firstOffset)
  for (let attempt = 0; attempt < 16; attempt++) {
    x.clear()
    let cursor = (converterX + input.riserX) / 2
    for (const device of input.portOne) {
      for (const [left, right] of [...blocked].sort((a, b) => b[0] - a[0])) {
        if (cursor > left && cursor < right) cursor = left
      }
      x.set(device.id, cursor)
      cursor -= pitch
    }
    const nearestSwitch = Math.min(...x.values())
    const shortfall = input.riserX + riserGap - nearestSwitch
    if (shortfall <= 0.01) break
    // Widening moves the middle by only half as much.
    converterX += 2 * shortfall
  }
  return { converterX, x }
}

/**
 * X of the inverter on the changeover's port-2 wire, which bends down at `laneStartX`. The
 * historical slot past `elbowX` stays the minimum; backup-output devices sit centred on the drawn
 * wire, so it only grows once they no longer fit.
 */
export function getChangeoverBackupLaneEndX(input: {
  elbowX: number
  laneStartX: number
  backupOutputCount: number
  otherLaneCount: number
}): number {
  const spacing = LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_BRANCH_DEVICE_SPACING
  const slotEndX =
    input.elbowX + LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_SLOT_LENGTH + input.otherLaneCount * spacing
  // One centred device needs the historical one-device slot; each further one adds one spacing.
  return input.backupOutputCount > 0
    ? Math.max(
        slotEndX,
        input.laneStartX +
          LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_SLOT_LENGTH +
          input.backupOutputCount * spacing
      )
    : slotEndX
}

/**
 * Backup-output positions on that wire, as offsets from the elbow: the devices a spacing apart,
 * centred on the wire (stored order runs from the switch to the inverter).
 */
export function getChangeoverBackupLaneOffsets(count: number, laneLength: number): number[] {
  const spacing = LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_BRANCH_DEVICE_SPACING
  return Array.from(
    { length: count },
    (_, index) => laneLength / 2 + (index - (count - 1) / 2) * spacing
  )
}

export function getSupplyConverterEmptyTopPortY(
  converterY: number,
  topPortCount: number,
  connectionIndex: number
): number {
  return (
    converterY -
    LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 -
    SUPPLY_CONVERTER_EMPTY_DC_STUB_LENGTH -
    (topPortCount - connectionIndex) * SUPPLY_CONVERTER_EMPTY_DC_ROW_SPACING
  )
}
