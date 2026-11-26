import type { Point2, WireSegment } from '@/types/schema'
import {
  isFireClassLabelVisibleForSegment,
  isRouteIndicatorVisibleForSegment,
  isWireLabelVisibleForSegment,
} from '@/lib/wireLabelVisibility'
import {
  WIRE_LABEL_DISTANCE_FROM_WIRE,
  WIRE_LABEL_FONT_SIZE,
  formatWireLabel,
  getWireFireClassLabel,
  getWireLabelOffsetAlongWire,
  measureTextWidth,
  truncateTextToWidth,
} from '@/lib/wireTextLabel'
import { getVerticalRouteIndicatorEndY } from '@/lib/wires/wireRouteIndicatorGeometry'
import { getSupplyEnclosureBoundaryCenter } from '@/lib/layout/supplyEnclosureBoundaryGeometry'

/** Half length of the dash drawn across the wire. */
export const ENCLOSURE_SEPARATOR_HALF_LENGTH = 16
/** Keep the separator off the symbol it enters. */
const END_INSET = 8
/** Free space kept between the dash and any wire text or route icon. */
const CLEARANCE = 3
/** Half height of a vertical route icon on the wire. */
const ROUTE_ICON_HALF_EXTENT = 10

export interface EnclosureSeparatorGeometry {
  /** One or two dashed pieces; the second appears only when a label splits the dash. */
  pieces: Array<[number, number, number, number]>
  center: Point2
  horizontal: boolean
}

interface Interval {
  low: number
  high: number
  /** Cross-axis extent, relative to the wire, that the dash must skip when it cannot move. */
  across?: { low: number; high: number }
}

/** Where the cable label and its extra lines sit along a vertical circuit wire. */
function verticalLabelInterval(segment: WireSegment, fontFamily: string): Interval | undefined {
  if (!isWireLabelVisibleForSegment(segment)) return undefined
  const labelEnd = segment.wireLabelBaseEndPoint ?? segment.wireLabelEndPoint ?? segment.endPoint
  const length = Math.abs(labelEnd.y - segment.startPoint.y)
  const available = Math.max(0, length - 2)
  const lines = [formatWireLabel(segment)]
  if (isFireClassLabelVisibleForSegment(segment)) {
    const fireClass = getWireFireClassLabel(segment.cable)
    if (fireClass) lines.push(fireClass)
  }
  if (segment.showWireLengthLabel && segment.wireLengthM != null)
    lines.push(`${segment.wireLengthM} m`)
  const width = Math.max(
    0,
    ...lines.map((line) =>
      measureTextWidth(
        truncateTextToWidth(line, available, fontFamily, WIRE_LABEL_FONT_SIZE),
        fontFamily,
        WIRE_LABEL_FONT_SIZE
      )
    )
  )
  if (width <= 0) return undefined
  const center = (segment.startPoint.y + labelEnd.y) / 2 + getWireLabelOffsetAlongWire(segment)
  const distance = WIRE_LABEL_DISTANCE_FROM_WIRE + (segment.wireRoute === 'air' ? 2 : 0)
  return {
    low: center - width / 2,
    high: center + width / 2,
    across: { low: distance - 1, high: distance + lines.length * (WIRE_LABEL_FONT_SIZE + 2) + 1 },
  }
}

/** Route icons (tube, wall, ground, air) sit centred on the first run of the wire. */
function verticalRouteIconInterval(segment: WireSegment): Interval | undefined {
  if (!isRouteIndicatorVisibleForSegment(segment)) return undefined
  if (!segment.inTube && !segment.wireRoute) return undefined
  const end = getVerticalRouteIndicatorEndY(segment)
  const center = segment.startPoint.y + (end - segment.startPoint.y) / 2
  const halfExtent =
    ROUTE_ICON_HALF_EXTENT + (segment.wireRoute === 'ground' && segment.inTube ? 4 : 0)
  return { low: center - halfExtent, high: center + halfExtent }
}

/**
 * Places the dashed panel-transition marker of a circuit wire. Wire text always wins: the
 * marker takes the free spot closest to the module it enters, and only when the wire has no
 * free spot left is the dash interrupted where it would cross the label.
 */
export function getCircuitEnclosureSeparatorGeometry(
  segment: WireSegment,
  fontFamily = 'Arial'
): EnclosureSeparatorGeometry {
  const { startPoint: start, endPoint: end } = segment
  const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
  const half = ENCLOSURE_SEPARATOR_HALF_LENGTH
  const axisStart = horizontal ? start.x : start.y
  const axisEnd = horizontal ? end.x : end.y
  const towardStart = Math.sign(axisStart - axisEnd) || 1
  const low = Math.min(axisStart, axisEnd)
  const high = Math.max(axisStart, axisEnd)
  const inset = Math.min(END_INSET, (high - low) / 2)
  const preferred = axisEnd + towardStart * inset
  const cross = horizontal ? start.y : start.x

  const occupied = horizontal
    ? []
    : [verticalLabelInterval(segment, fontFamily), verticalRouteIconInterval(segment)].filter(
        (interval): interval is Interval => interval != null
      )
  const isFree = (axis: number) =>
    occupied.every(
      (interval) => axis < interval.low - CLEARANCE || axis > interval.high + CLEARANCE
    )

  let axis: number | undefined
  const span = Math.abs(axisStart - axisEnd) - inset * 2
  for (let step = 0; step <= span; step += 1) {
    const candidate = preferred + towardStart * step
    if (isFree(candidate)) {
      axis = candidate
      break
    }
  }

  const point = (along: number, across: number): Point2 =>
    horizontal ? { x: along, y: cross + across } : { x: cross + across, y: along }
  const piece = (along: number, from: number, to: number): [number, number, number, number] => {
    const a = point(along, from)
    const b = point(along, to)
    return [a.x, a.y, b.x, b.y]
  }

  if (axis != null) {
    return { pieces: [piece(axis, -half, half)], center: point(axis, 0), horizontal }
  }

  // No free spot on this wire: keep the text whole and interrupt the dash around it.
  axis = preferred
  const blocking = occupied.filter(
    (interval) =>
      interval.across && axis! >= interval.low - CLEARANCE && axis! <= interval.high + CLEARANCE
  )
  let pieces: Array<[number, number]> = [[-half, half]]
  for (const interval of blocking) {
    const gapLow = interval.across!.low - CLEARANCE
    const gapHigh = interval.across!.high + CLEARANCE
    pieces = pieces.flatMap(([from, to]): Array<[number, number]> => {
      if (to <= gapLow || from >= gapHigh) return [[from, to]]
      return [
        ...(from < gapLow ? [[from, gapLow] as [number, number]] : []),
        ...(to > gapHigh ? [[gapHigh, to] as [number, number]] : []),
      ]
    })
  }
  return {
    pieces: pieces.map(([from, to]) => piece(axis!, from, to)),
    center: point(axis, 0),
    horizontal,
  }
}

/** Separator geometry for any marked wire: supply-assembly or circuit transition. */
export function getEnclosureSeparatorGeometry(
  segment: WireSegment,
  fontFamily = 'Arial'
): EnclosureSeparatorGeometry {
  const verticalWire =
    Math.abs(segment.endPoint.y - segment.startPoint.y) >
    Math.abs(segment.endPoint.x - segment.startPoint.x)
  // A vertical supply wire (a DC-bus string) carries its cable caption and route icons beside
  // and on the wire, like a circuit wire: take the free spot instead of the bare midpoint.
  if (segment.supplyEnclosureBoundary && !verticalWire) {
    const center = getSupplyEnclosureBoundaryCenter(segment, fontFamily)
    const horizontal =
      Math.abs(segment.endPoint.x - segment.startPoint.x) >=
      Math.abs(segment.endPoint.y - segment.startPoint.y)
    const half = ENCLOSURE_SEPARATOR_HALF_LENGTH
    return {
      pieces: [
        horizontal
          ? [center.x, center.y - half, center.x, center.y + half]
          : [center.x - half, center.y, center.x + half, center.y],
      ],
      center,
      horizontal,
    }
  }
  return getCircuitEnclosureSeparatorGeometry(segment, fontFamily)
}
