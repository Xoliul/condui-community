import { mapTrikElementToNode, trikElementId } from '@/lib/import/trik/parseNodes'

/** Children of a breaker that are not loads of their own (protection, metering, boards, clamps, earthing). */
const NOT_A_DIRECT_LOAD = new Set([
  'Leiding', 'Nota', 'Aansluitklem', 'Teller', 'Verdeelbord', 'Beveiliging', 'Aardingsstrip', 'Aarding',
  'AutomatischeSchakelaar', 'Smeltveiligheid', 'Overspanningsbeveiliging',
])

export type TrikCircuitHead = {
  /** Where the walk of the circuit's loads starts: its first Leiding, or the breaker for loads hanging straight on it. */
  walkRoot?: Element
  /** The Leiding whose attributes are the circuit cable; absent for loads hanging straight on the breaker. */
  cableLeiding?: Element
  /** A connection clamp between the breaker and the Leiding: it sits on the shared trunk (position 0). */
  trunkClamp?: { id: string }
}

const childrenOf = (element: Element): Element[] =>
  Array.from(element.querySelectorAll(':scope > Children > *')).filter((child) => child.tagName !== 'Nota')

/**
 * What a TRiK breaker feeds. Normally its first Leiding. Without one, a clamp whose only child is a
 * Leiding becomes the trunk's terminal strip and that Leiding the circuit cable, and loads hanging
 * straight on the breaker (a light point, appliance or socket) become the circuit's rows.
 */
export function resolveTrikCircuitHead(breaker: Element): TrikCircuitHead {
  const leiding = breaker.querySelector(':scope > Children > Leiding')
  if (leiding) return { walkRoot: leiding, cableLeiding: leiding }
  const children = childrenOf(breaker)
  for (const clamp of children.filter((child) => child.tagName === 'Aansluitklem')) {
    const inner = childrenOf(clamp)
    if (inner.length === 1 && inner[0]!.tagName === 'Leiding') {
      return { walkRoot: inner[0], cableLeiding: inner[0], trunkClamp: { id: trikElementId(clamp) } }
    }
  }
  if (children.length > 0 && children.every((child) => !NOT_A_DIRECT_LOAD.has(child.tagName) && mapTrikElementToNode(child))) {
    return { walkRoot: breaker }
  }
  return {}
}
