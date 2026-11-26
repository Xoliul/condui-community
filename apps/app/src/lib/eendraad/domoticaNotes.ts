import type { Endpoint } from '@/types/schema'
import { DOMOTICA_BASE_HEIGHT, DOMOTICA_CHILD_NOTE_ROW_RESERVE } from '@/lib/domoticaLayout'
import { getControlButtonLabelLayout } from './controlButtonLabels'
import { getVisibleEndpointNoteText } from '@/lib/conversionLabels'
import { countSymbolLabelVisualLines } from '@/lib/symbolLabelMetrics'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import { getHorizontalDomoticaNoteOffset, isHorizontalDomotica } from '@/lib/layout/domoticaHorizontalGeometry'
import { getEndpointNoteMinimumLeftX, getCollisionSafeCenteredLabelLeftX } from './endpointNoteLabelCollision'

export const DOMOTICA_NOTE_FONT_SIZE = 8
export const DOMOTICA_NOTE_LINE_HEIGHT = 10
export const DOMOTICA_NOTE_GAP = 5
/** A nested module's output-row name is painted directly below its box. */
export const DOMOTICA_NOTE_ROW_LABEL_RESERVE = DOMOTICA_CHILD_NOTE_ROW_RESERVE

export function getDomoticaNoteOffsetFromSymbol(endpoint: Endpoint): number {
  return getControlButtonLabelLayout(endpoint)?.ownNoteOffset ??
    DOMOTICA_NOTE_GAP + (endpoint.domoticaChildProps ? DOMOTICA_NOTE_ROW_LABEL_RESERVE : 0)
}

/** Painted note rectangle relative to the module's bottom input row. */
export function getDomoticaNoteBounds(endpoint: Endpoint, inputX: number, inputY: number, trunkX: number) {
  if (endpoint.symbol !== 'domotica') return undefined
  const text = getVisibleEndpointNoteText(endpoint)
  if (!text) return undefined
  const width = measureSymbolLabelTextWidth(text, 'Figtree', DOMOTICA_NOTE_FONT_SIZE)
  const height = countSymbolLabelVisualLines(text) * DOMOTICA_NOTE_LINE_HEIGHT
  if (isHorizontalDomotica(endpoint)) {
    // Horizontal module: right of the feed wire, just below the body (input = the feed anchor).
    const offset = getHorizontalDomoticaNoteOffset()
    const left = inputX + offset.x
    const top = inputY + offset.y
    return { left, right: left + width, top, bottom: top + height }
  }
  const left = inputX + getCollisionSafeCenteredLabelLeftX(width, getEndpointNoteMinimumLeftX(inputX, trunkX))
  const top = inputY + DOMOTICA_BASE_HEIGHT / 2 + getDomoticaNoteOffsetFromSymbol(endpoint)
  return { left, right: left + width, top, bottom: top + height }
}
