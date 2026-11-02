import type { CableSpec, Point2, WireSegment } from '@/types/schema'
import { clamp } from '@/lib/geometry'

export const WIRE_LABEL_FONT_SIZE = 7.2
export const WIRE_LABEL_DISTANCE_FROM_WIRE = 6
/** Vertical gap between stacked label lines (main + fire class) before −90° rotation. */
export const WIRE_LABEL_LINE_GAP = 1
export const WIRE_LABEL_DEFAULT_OFFSET_ALONG_WIRE = 5

/** Main supply drop (bus → horizontal): label sits at the bus end, not mid-span. */
export function isMainSupplyVerticalWireSegment(wireSegment: WireSegment): boolean {
  return wireSegment.type === 'vertical' && !wireSegment.circuitId && !wireSegment.fromElementType
}

export function isHorizontalSupplyTrunkSegment(wireSegment: WireSegment): boolean {
  return (
    (wireSegment.isSupplyTrunk === true ||
      wireSegment.supplySectionKey != null ||
      wireSegment.supplyConnectionId != null) &&
    wireSegment.startPoint.y === wireSegment.endPoint.y
  )
}

export function getWireLabelOrientationForSegment(
  wireSegment: WireSegment
): 'vertical' | 'horizontal' {
  return isHorizontalSupplyTrunkSegment(wireSegment) ? 'horizontal' : 'vertical'
}

export function getWireLabelAlignForSegment(wireSegment: WireSegment): WireLabelAlignment {
  if (isMainSupplyVerticalWireSegment(wireSegment)) return 'center'
  if (isHorizontalSupplyTrunkSegment(wireSegment)) return 'center'
  return 'center'
}

/** Placement anchor for horizontal supply labels (separator X for crossing spans). */
export function getSupplyWireLabelAnchor(wireSegment: WireSegment): Point2 | undefined {
  if (!isHorizontalSupplyTrunkSegment(wireSegment)) return undefined
  const y = wireSegment.startPoint.y
  const left = Math.min(wireSegment.startPoint.x, wireSegment.endPoint.x)
  const right = Math.max(wireSegment.startPoint.x, wireSegment.endPoint.x)
  if (wireSegment.supplyWireRole === 'crossing' && wireSegment.supplySeparatorX != null) {
    const x = clamp(wireSegment.supplySeparatorX, left, right)
    return { x, y }
  }
  return { x: (left + right) / 2, y }
}

export interface PhaseLabelTextLayout {
  x: number
  width: number
  align: 'left' | 'right'
}

/** Keep an explicitly anchored phase caption outside the horizontal wire it describes. */
export function getPhaseLabelTextLayout(
  wireSegment: WireSegment,
  width = 48,
  gap = 5
): PhaseLabelTextLayout {
  const anchor = wireSegment.phaseLabelAnchor
  const isHorizontal = wireSegment.startPoint.y === wireSegment.endPoint.y
  const wireLeft = Math.min(wireSegment.startPoint.x, wireSegment.endPoint.x)
  if (anchor && isHorizontal && anchor.x < wireLeft) {
    return { x: -width - gap, width, align: 'right' }
  }
  return { x: 0, width, align: 'left' }
}

export type WireLabelAlignment = 'origin' | 'center' | 'bottom'

export interface VerticalWireLabelLayoutInput {
  text: string
  startPoint: Point2
  endPoint: Point2
  fontFamily: string
  fontSize?: number
  align?: WireLabelAlignment
  distanceFromWire?: number
  offsetAlongWire?: number
}

export interface VerticalWireLabelLayout {
  renderedText: string
  textWidth: number
  textHeight: number
  anchorX: number
  anchorY: number
  topLeftX: number
  topLeftY: number
}

export interface VerticalWireLabelStackLine {
  renderedText: string
  textWidth: number
  /** Y position in the inner (pre-rotation) group, top of line. */
  y: number
}

export interface VerticalWireLabelStackLayout {
  anchorX: number
  anchorY: number
  stackHeight: number
  main: VerticalWireLabelStackLine
  fireClass?: VerticalWireLabelStackLine
  wireLength?: VerticalWireLabelStackLine
}

export type VerticalWireLabelStackLayoutInput = Omit<VerticalWireLabelLayoutInput, 'text'> & {
  mainText: string
  fireClassText?: string
  wireLengthText?: string
}

export interface HorizontalWireLabelStackLine {
  renderedText: string
  textWidth: number
  /** Y position above the wire; smaller values are higher on screen. */
  y: number
}

export interface HorizontalWireLabelStackLayout {
  main: HorizontalWireLabelStackLine
  fireClass?: HorizontalWireLabelStackLine
  wireLength?: HorizontalWireLabelStackLine
}

export type HorizontalWireLabelStackLayoutInput = {
  mainText: string
  fireClassText?: string
  wireLengthText?: string
  fontFamily: string
  fontSize?: number
}

/** Horizontal labels above the wire: length (top), fire class, main properties (bottom). */
export function computeHorizontalWireLabelStackLayout({
  mainText,
  fireClassText,
  wireLengthText,
  fontFamily,
  fontSize = WIRE_LABEL_FONT_SIZE,
}: HorizontalWireLabelStackLayoutInput): HorizontalWireLabelStackLayout | null {
  const mainRendered = mainText.trim()
  if (!mainRendered) return null

  const fireRendered = fireClassText?.trim() ?? ''
  const lengthRendered = wireLengthText?.trim() ?? ''
  const stackOffset = fontSize + WIRE_LABEL_LINE_GAP
  const mainY = -fontSize / 2

  const main: HorizontalWireLabelStackLine = {
    renderedText: mainRendered,
    textWidth: measureTextWidth(mainRendered, fontFamily, fontSize),
    y: mainY,
  }

  let fireClass: HorizontalWireLabelStackLine | undefined
  let wireLength: HorizontalWireLabelStackLine | undefined

  if (lengthRendered && fireRendered) {
    wireLength = {
      renderedText: lengthRendered,
      textWidth: measureTextWidth(lengthRendered, fontFamily, fontSize),
      y: mainY - stackOffset * 2,
    }
    fireClass = {
      renderedText: fireRendered,
      textWidth: measureTextWidth(fireRendered, fontFamily, fontSize),
      y: mainY - stackOffset,
    }
  } else if (lengthRendered) {
    wireLength = {
      renderedText: lengthRendered,
      textWidth: measureTextWidth(lengthRendered, fontFamily, fontSize),
      y: mainY - stackOffset,
    }
  } else if (fireRendered) {
    fireClass = {
      renderedText: fireRendered,
      textWidth: measureTextWidth(fireRendered, fontFamily, fontSize),
      y: mainY - stackOffset,
    }
  }

  return { main, fireClass, wireLength }
}

export interface FormatWireLabelOptions {
  /** Localized fallback when `cable.kind` is `other` and no `customKind` is set. */
  otherLabel?: string
  /** Localized label for the built-in battery cable kind. */
  batteryCableLabel?: string
}

export function formatCableTypeLabel(cable: CableSpec, options?: FormatWireLabelOptions): string {
  if ((cable.kind as string) === 'VOB_in_conduit') return 'VOB'
  if (cable.kind === 'battery-cable') return options?.batteryCableLabel ?? 'Battery cable'
  if (cable.kind === 'twinflex') return 'Twinflex'
  if (cable.kind === 'other') {
    const custom = cable.customKind?.trim()
    if (custom) return custom
    return options?.otherLabel ?? 'Other'
  }
  return cable.kind
}

export function formatWireLabel(
  wire: Pick<WireSegment, 'cable'> & Partial<Pick<WireSegment, 'wireMaterial'>>,
  options?: FormatWireLabelOptions
): string {
  const cable = wire.cable
  const type = `${formatCableTypeLabel(cable, options)}${wire.wireMaterial === 'aluminium' ? ' Al' : ''}`
  const conductors = cable.conductors
  const hasPE = cable.hasPE ?? false
  const thickness = cable.sectionMm2

  if (hasPE) {
    return `${type} ${conductors}G${thickness}`
  }
  return `${type} ${conductors}x${thickness}`
}

export function getWireFireClassLabel(cable: CableSpec): string | undefined {
  return cable.fireClass
}

let measureCanvas: HTMLCanvasElement | null = null

export function measureTextWidth(text: string, fontFamily: string, fontSize: number): number {
  if (typeof document === 'undefined') {
    return text.length * fontSize * 0.6
  }
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas')
  }
  const context = measureCanvas.getContext('2d')
  if (!context) {
    return text.length * fontSize * 0.6
  }
  context.font = `${fontSize}px ${fontFamily}`
  return Math.ceil(context.measureText(text).width)
}

export function truncateTextToWidth(
  text: string,
  maxWidth: number,
  fontFamily: string,
  fontSize: number
): string {
  if (maxWidth <= 0) return ''
  if (measureTextWidth(text, fontFamily, fontSize) <= maxWidth) return text

  const ellipsis = '...'
  const ellipsisWidth = measureTextWidth(ellipsis, fontFamily, fontSize)
  if (ellipsisWidth > maxWidth) return ''

  let low = 0
  let high = text.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const candidate = `${text.slice(0, mid)}${ellipsis}`
    if (measureTextWidth(candidate, fontFamily, fontSize) <= maxWidth) {
      low = mid
    } else {
      high = mid - 1
    }
  }

  return `${text.slice(0, low)}${ellipsis}`
}

export function getWireLabelOffsetAlongWire(wireSegment: WireSegment): number {
  if (isMainSupplyVerticalWireSegment(wireSegment) || isHorizontalSupplyTrunkSegment(wireSegment)) {
    return 0
  }
  return WIRE_LABEL_DEFAULT_OFFSET_ALONG_WIRE
}

export function computeVerticalWireLabelLayout({
  text,
  startPoint,
  endPoint,
  fontFamily,
  fontSize = WIRE_LABEL_FONT_SIZE,
  align = 'origin',
  distanceFromWire = WIRE_LABEL_DISTANCE_FROM_WIRE,
  offsetAlongWire = 0,
}: VerticalWireLabelLayoutInput): VerticalWireLabelLayout | null {
  if (startPoint.x !== endPoint.x) return null

  const maxY = Math.max(startPoint.y, endPoint.y)
  const centerY = (startPoint.y + endPoint.y) / 2
  const segmentLength = Math.abs(endPoint.y - startPoint.y)
  const maxVerticalTextLength = Math.max(0, segmentLength - 2)
  const renderedText = truncateTextToWidth(text, maxVerticalTextLength, fontFamily, fontSize)
  const textWidth = measureTextWidth(renderedText, fontFamily, fontSize)
  const textHeight = fontSize

  const anchorYBase = align === 'center' ? centerY : align === 'bottom' ? maxY : startPoint.y
  /** Konva Group position: for `center`, the wire midpoint (label rotates around its own center). */
  const anchorY = anchorYBase + offsetAlongWire
  const anchorX = startPoint.x + distanceFromWire

  return {
    renderedText,
    textWidth,
    textHeight,
    anchorX,
    anchorY,
    topLeftX: anchorX,
    // Legacy top-left hint for non-centered layouts; export uses anchor + baseline for center.
    topLeftY: align === 'center' ? anchorY : anchorY - textHeight,
  }
}

export function computeVerticalWireLabelStackLayout({
  mainText,
  fireClassText,
  wireLengthText,
  startPoint,
  endPoint,
  fontFamily,
  fontSize = WIRE_LABEL_FONT_SIZE,
  align = 'center',
  distanceFromWire = WIRE_LABEL_DISTANCE_FROM_WIRE,
  offsetAlongWire = 0,
}: VerticalWireLabelStackLayoutInput): VerticalWireLabelStackLayout | null {
  if (startPoint.x !== endPoint.x) return null

  const maxY = Math.max(startPoint.y, endPoint.y)
  const centerY = (startPoint.y + endPoint.y) / 2
  const segmentLength = Math.abs(endPoint.y - startPoint.y)
  const maxVerticalTextLength = Math.max(0, segmentLength - 2)

  const mainRendered = truncateTextToWidth(mainText, maxVerticalTextLength, fontFamily, fontSize)
  if (!mainRendered) return null

  const mainWidth = measureTextWidth(mainRendered, fontFamily, fontSize)
  const fireRendered = fireClassText?.trim()
    ? truncateTextToWidth(fireClassText.trim(), maxVerticalTextLength, fontFamily, fontSize)
    : ''
  const fireWidth = fireRendered ? measureTextWidth(fireRendered, fontFamily, fontSize) : 0
  const lengthRendered = wireLengthText?.trim()
    ? truncateTextToWidth(wireLengthText.trim(), maxVerticalTextLength, fontFamily, fontSize)
    : ''
  const lengthWidth = lengthRendered ? measureTextWidth(lengthRendered, fontFamily, fontSize) : 0

  const lineStep = fontSize + WIRE_LABEL_LINE_GAP

  // After −90° rotation, local +y extends away from the wire. Pin main (and fire class)
  // to the two-line centered positions so adding wire length grows outward only.
  let mainY: number
  let fireY: number | undefined
  let lengthY: number | undefined
  let stackClearanceFromWire = 0

  if (fireRendered) {
    const twoLineStackHeight = fontSize + lineStep
    const twoLineStackTop = -twoLineStackHeight / 2
    mainY = twoLineStackTop
    fireY = twoLineStackTop + lineStep
    stackClearanceFromWire = twoLineStackHeight / 4
    if (lengthRendered) {
      lengthY = fireY + lineStep
    }
  } else if (lengthRendered) {
    mainY = 0
    lengthY = lineStep
  } else {
    mainY = 0
  }

  const extraLines = (fireRendered ? 1 : 0) + (lengthRendered ? 1 : 0)
  const stackHeight = fontSize + extraLines * lineStep
  const stackTop = mainY

  const anchorYBase = align === 'center' ? centerY : align === 'bottom' ? maxY : startPoint.y
  const anchorY = anchorYBase + offsetAlongWire
  const anchorX = startPoint.x + distanceFromWire + stackClearanceFromWire

  const fireClass = fireRendered
    ? {
        renderedText: fireRendered,
        textWidth: fireWidth,
        y: fireY!,
      }
    : undefined
  const wireLength = lengthRendered
    ? {
        renderedText: lengthRendered,
        textWidth: lengthWidth,
        y: lengthY!,
      }
    : undefined

  return {
    anchorX,
    anchorY,
    stackHeight,
    main: {
      renderedText: mainRendered,
      textWidth: mainWidth,
      y: stackTop,
    },
    fireClass,
    wireLength,
  }
}
