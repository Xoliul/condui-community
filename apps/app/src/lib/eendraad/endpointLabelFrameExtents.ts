import { getVisibleConversionLabelParts, getVisibleEndpointNoteText } from '@/lib/conversionLabels'
import { getVisibleCertificationLabelParts } from '@/lib/certificationLabels'
import { countSymbolLabelVisualLines } from '@/lib/symbolLabelMetrics'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import { getControlButtonAnnotationBounds, getControlButtonLabelLayout } from './controlButtonLabels'
import { getDomoticaNoteBounds } from './domoticaNotes'
import { getEndpointNoteMinimumLeftX } from './endpointNoteLabelCollision'
import type { Endpoint } from '@/types/schema'

export interface EndpointLabelExtents {
  left: number
  right: number
  top: number
  bottom: number
}

/** Matches the endpoint metadata labels drawn by EndpointSymbol (8px, 2px line spacing). */
const LABEL_FONT_FAMILY = 'Figtree'
const LABEL_FONT_SIZE = 8
const LABEL_LINE_HEIGHT = 10
const LABEL_OFFSET_FROM_SYMBOL = 5
const RIGHT_LABEL_SYMBOLS = new Set(['solar_panel', 'battery', 'ev'])

export interface EndpointLabelPlacement {
  /** Symbol centre (or a domotica module's bottom input row). */
  x: number
  y: number
  symbolSize: number
  /** Extra width of multi-gang socket arcs painted right of the first socket. */
  socketExtra: number
  /** Branch wire x; bottom text is kept clear of the wire label beside it. */
  branchWireX?: number
  isBranchEnd: boolean
  /** The branch holds only this endpoint, which always keeps its text clear of the wire. */
  isSingleEndpointBranch: boolean
}

/**
 * Painted extents of an endpoint's notes and metadata text (conversion, certification,
 * control addresses) on the one-wire, so a user frame can enclose them.
 */
export function getEndpointLabelExtents(
  endpoint: Endpoint,
  placement: EndpointLabelPlacement
): EndpointLabelExtents | null {
  const { x, y, symbolSize, socketExtra, branchWireX } = placement
  const trunkX = branchWireX ?? x - symbolSize

  if (endpoint.symbol === 'domotica') {
    const note = getDomoticaNoteBounds(endpoint, x, y, trunkX)
    const buttons = getControlButtonAnnotationBounds(endpoint, x, y, trunkX)
    return unionExtents([note, buttons])
  }

  const buttons = getControlButtonAnnotationBounds(endpoint, x, y, trunkX)
  if (buttons) return buttons

  const lines = [
    ...getVisibleConversionLabelParts(endpoint).map((part) => part.text),
    ...getVisibleCertificationLabelParts(endpoint).map((part) => part.text),
    getVisibleEndpointNoteText(endpoint),
  ].filter((line) => line.length > 0)
  if (lines.length === 0) return null

  const widths = lines.map((line) =>
    measureSymbolLabelTextWidth(line, LABEL_FONT_FAMILY, LABEL_FONT_SIZE)
  )
  const height =
    lines.reduce((total, line) => total + countSymbolLabelVisualLines(line), 0) * LABEL_LINE_HEIGHT
  const halfSymbol = symbolSize / 2
  const labelCenterX = x + socketExtra / 2

  if (placement.isBranchEnd && RIGHT_LABEL_SYMBOLS.has(endpoint.symbol ?? '')) {
    const left = labelCenterX + halfSymbol + LABEL_OFFSET_FROM_SYMBOL
    return { left, right: left + Math.max(...widths), top: y - height / 2, bottom: y + height / 2 }
  }

  const keepsClearOfWire =
    branchWireX != null &&
    (placement.isSingleEndpointBranch ||
      getVisibleEndpointNoteText(endpoint).length > 0 ||
      getControlButtonLabelLayout(endpoint) != null)
  const minimumLeftX = keepsClearOfWire ? getEndpointNoteMinimumLeftX(x, branchWireX) : undefined
  const lefts = widths.map((width) =>
    minimumLeftX == null
      ? labelCenterX - width / 2
      : x + Math.max(socketExtra / 2 - width / 2, minimumLeftX)
  )
  const top = y + halfSymbol + LABEL_OFFSET_FROM_SYMBOL
  return {
    left: Math.min(...lefts),
    right: Math.max(...lefts.map((left, index) => left + (widths[index] ?? 0))),
    top,
    bottom: top + height,
  }
}

function unionExtents(
  extents: Array<EndpointLabelExtents | null | undefined>
): EndpointLabelExtents | null {
  const present = extents.filter((extent): extent is EndpointLabelExtents => extent != null)
  if (present.length === 0) return null
  return {
    left: Math.min(...present.map((extent) => extent.left)),
    right: Math.max(...present.map((extent) => extent.right)),
    top: Math.min(...present.map((extent) => extent.top)),
    bottom: Math.max(...present.map((extent) => extent.bottom)),
  }
}
