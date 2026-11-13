import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'

/** Font of endpoint notes painted below (or beside) one-wire symbols. */
export const ENDPOINT_NOTE_WRAP_FONT_FAMILY = 'Figtree'
export const ENDPOINT_NOTE_WRAP_FONT_SIZE = 8
/**
 * Widest single line of an endpoint note. Longer notes continue on the next line
 * instead of pushing the branch apart and running past user frames.
 */
export const ENDPOINT_NOTE_MAX_LINE_WIDTH = 100

/**
 * Break text into lines no wider than `maxWidth`. Authored line breaks are kept,
 * lines break between words, and a single word wider than the budget is split
 * between characters. A line that already fits is returned unchanged.
 */
export function wrapTextToWidth(
  text: string,
  maxWidth: number,
  measureWidth: (line: string) => number
): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r\n?|\n/)) {
    if (measureWidth(paragraph) <= maxWidth) {
      lines.push(paragraph)
      continue
    }
    const words = paragraph.split(/\s+/).filter(Boolean)
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (measureWidth(candidate) <= maxWidth) {
        current = candidate
        continue
      }
      if (current) lines.push(current)
      current = ''
      if (measureWidth(word) <= maxWidth) {
        current = word
        continue
      }
      for (const character of word) {
        const next = current + character
        if (current && measureWidth(next) > maxWidth) {
          lines.push(current)
          current = character
        } else {
          current = next
        }
      }
    }
    lines.push(current)
  }
  return lines
}

/** Endpoint note text with line breaks inserted where a line exceeds the note width. */
export function wrapEndpointNoteText(
  text: string,
  maxWidth = ENDPOINT_NOTE_MAX_LINE_WIDTH
): string {
  if (!text) return text
  const measure = (line: string) =>
    measureSymbolLabelTextWidth(line, ENDPOINT_NOTE_WRAP_FONT_FAMILY, ENDPOINT_NOTE_WRAP_FONT_SIZE)
  if (measure(text) <= maxWidth) return text
  return wrapTextToWidth(text, maxWidth, measure).join('\n')
}
