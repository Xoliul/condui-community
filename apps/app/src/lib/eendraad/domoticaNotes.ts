import type { Endpoint } from '@/types/schema'
import { DOMOTICA_BASE_HEIGHT } from '@/lib/domoticaLayout'
import { getVisibleEndpointNoteText } from '@/lib/conversionLabels'
import { countSymbolLabelVisualLines } from '@/lib/symbolLabelMetrics'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import { getEndpointNoteMinimumLeftX, getCollisionSafeCenteredLabelLeftX } from './endpointNoteLabelCollision'

export const DOMOTICA_NOTE_FONT_SIZE = 8
export const DOMOTICA_NOTE_LINE_HEIGHT = 10
export const DOMOTICA_NOTE_GAP = 5
/** A nested module's output-row name is painted directly below its box. */
export const DOMOTICA_NOTE_ROW_LABEL_RESERVE = 23

export function getDomoticaNoteOffsetFromSymbol(endpoint: Pick<Endpoint, 'domoticaChildProps'>): number {
  return DOMOTICA_NOTE_GAP + (endpoint.domoticaChildProps ? DOMOTICA_NOTE_ROW_LABEL_RESERVE : 0)
}

/** Painted note rectangle relative to the module's bottom input row. */
export function getDomoticaNoteBounds(endpoint: Endpoint, inputX: number, inputY: number, trunkX: number) {
  if (endpoint.symbol !== 'domotica') return undefined
  const text = getVisibleEndpointNoteText(endpoint)
  if (!text) return undefined
  const width = measureSymbolLabelTextWidth(text, 'Figtree', DOMOTICA_NOTE_FONT_SIZE)
  const height = countSymbolLabelVisualLines(text) * DOMOTICA_NOTE_LINE_HEIGHT
  const left = inputX + getCollisionSafeCenteredLabelLeftX(width, getEndpointNoteMinimumLeftX(inputX, trunkX))
  const top = inputY + DOMOTICA_BASE_HEIGHT / 2 + getDomoticaNoteOffsetFromSymbol(endpoint)
  return { left, right: left + width, top, bottom: top + height }
}
