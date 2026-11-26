import type { Endpoint } from '@/types/schema'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'

/** Largest and smallest font of the text inside a horizontal module body. */
export const HORIZONTAL_DOMOTICA_BODY_FONT_MAX = 9
export const HORIZONTAL_DOMOTICA_BODY_FONT_MIN = 6
/** Free space kept left and right of the body text. */
export const HORIZONTAL_DOMOTICA_BODY_TEXT_PADDING = 3

/**
 * Text drawn inside a horizontal module body: the module's extra label (`labelNotes`, the "Label
 * text" field every endpoint already has) when the user entered one, otherwise `defaultText`
 * (the localized word for the module). The module's own identity (F1) stays on the output labels.
 * A multi-line entry is joined to one line, because the body is a single-line plate.
 */
export function getHorizontalDomoticaBodyText(
  endpoint: Pick<Endpoint, 'labelNotes'>,
  defaultText: string
): string {
  const entered = (endpoint.labelNotes ?? '').split(/\r\n?|\n/).map((line) => line.trim()).filter(Boolean).join(' ')
  return entered || defaultText
}

export interface FittedBodyText {
  text: string
  fontSize: number
}

/**
 * Largest font (down to the minimum) at which `text` fits `bodyWidth`; below the minimum the text
 * is truncated with an ellipsis, so the body text never leaves the body.
 */
export function fitHorizontalDomoticaBodyText(
  text: string,
  bodyWidth: number,
  fontFamily: string,
  measure: (value: string, fontSize: number) => number = (value, fontSize) =>
    measureSymbolLabelTextWidth(value, fontFamily, fontSize, 'normal')
): FittedBodyText {
  const available = Math.max(0, bodyWidth - 2 * HORIZONTAL_DOMOTICA_BODY_TEXT_PADDING)
  for (let size = HORIZONTAL_DOMOTICA_BODY_FONT_MAX; size >= HORIZONTAL_DOMOTICA_BODY_FONT_MIN; size -= 1) {
    if (measure(text, size) <= available) return { text, fontSize: size }
  }
  const fontSize = HORIZONTAL_DOMOTICA_BODY_FONT_MIN
  const characters = Array.from(text)
  for (let length = characters.length - 1; length > 0; length -= 1) {
    const candidate = `${characters.slice(0, length).join('').trimEnd()}…`
    if (measure(candidate, fontSize) <= available) return { text: candidate, fontSize }
  }
  return { text: '…', fontSize }
}
