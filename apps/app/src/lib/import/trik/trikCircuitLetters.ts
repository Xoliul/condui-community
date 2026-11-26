import { trikElementId } from '@/lib/import/trik/parseNodes'
import type { TrikCircuit } from '@/lib/import/trik/shared'

/** TRiK automatic letters: A..Z, then AA, AB, ... */
function trikAutomaticLetter(index: number): string {
  let letters = ''
  let rest = index
  do {
    letters = String.fromCharCode(65 + (rest % 26)) + letters
    rest = Math.floor(rest / 26) - 1
  } while (rest >= 0)
  return letters
}

/**
 * TRiK names unlettered circuits automatically as the board number plus the next free letter,
 * in drawing order, skipping letters that are already fixed on another circuit of the board
 * (board 1: 1A, [1B fixed], 1C, ...). Only applied when the board carries a number.
 */
export function assignTrikAutomaticCircuitLetters(circuits: TrikCircuit[], boardNumber: string): void {
  const used = new Set(circuits.map((circuit) => circuit.fixedLetter?.trim().toUpperCase()).filter(Boolean))
  let next = 0
  for (const circuit of circuits) {
    if (circuit.fixedLetter?.trim()) continue
    let code: string
    do {
      code = `${boardNumber}${trikAutomaticLetter(next)}`
      next += 1
    } while (used.has(code.toUpperCase()))
    used.add(code.toUpperCase())
    circuit.fixedLetter = code
  }
}

/**
 * Breakers TRiK letters: an ordinary circuit breaker (also one feeding another rail) and a fuse. A pure residual
 * current device (no trip curve), a contactor, a rotating switch and the other typed devices have no letter.
 */
function takesAutomaticLetter(element: Element): boolean {
  if (element.tagName === 'Smeltveiligheid') return true
  if (element.tagName !== 'AutomatischeSchakelaar' || element.getAttribute('Type')?.trim()) return false
  return !element.getAttribute('VerliesStroomsterkte')?.trim() || !!element.getAttribute('Uitschakelcurve')?.trim()
}

/**
 * Letters of boards without a number. TRiK runs them through the whole file in drawing order, nested rails
 * included, and skips every letter that is fixed anywhere: with R fixed, Q is followed by S.
 */
export function assignTrikDocumentCircuitLetters(doc: Document, circuits: readonly TrikCircuit[]): void {
  const byId = new Map(circuits.map((circuit) => [circuit.id, circuit]))
  const breakers = Array.from(doc.querySelectorAll('*'))
    .filter((element) => element.tagName === 'AutomatischeSchakelaar' || element.tagName === 'Smeltveiligheid')
  const used = new Set(breakers.map((element) => element.getAttribute('VasteLetter')?.trim().toUpperCase()).filter(Boolean))
  let next = 0
  for (const element of breakers) {
    if (element.getAttribute('VasteLetter')?.trim() || !takesAutomaticLetter(element)) continue
    const circuit = byId.get(trikElementId(element))
    if (!circuit || circuit.fixedLetter?.trim()) continue // not a circuit of its own, or named after its numbered board
    let code: string
    do {
      code = trikAutomaticLetter(next)
      next += 1
    } while (used.has(code))
    circuit.fixedLetter = code
  }
}
