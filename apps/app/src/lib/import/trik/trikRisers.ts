import { getTraversalChildren } from '@/lib/import/trik/parseNodes'
import { parseBooleanJaNee, parseNumber } from '@/lib/import/trik/shared'
import type { TrikRiserCable } from '@/lib/import/trik/shared'

export type TrikRiserPlan = {
  /** Leidingen that start a one-wire stem (0 = the trunk's own rows, 1.. = risers). */
  stemByRoot: Map<Element, number>
  /** Cable attributes TRiK gave a riser's Leiding (inherited by riser Leidingen below it); absent = shared cable. */
  cableByStem: Map<number, TrikRiserCable>
}

const contentOf = (element: Element): Element[] => getTraversalChildren(element).filter((child) => child.tagName !== 'Nota')

/** Rows below a Leiding: each load is a row, each Leiding adds the rows below it (an empty one adds none). */
function rowCount(leiding: Element): number {
  return contentOf(leiding).reduce((sum, child) => sum + (child.tagName === 'Leiding' ? rowCount(child) : 1), 0)
}

/** A Leiding whose only content is another Leiding is the same cable; follow it to the one that holds the rows. */
function followSingleChain(leiding: Element): Element[] {
  const chain = [leiding]
  for (;;) {
    const content = contentOf(chain[chain.length - 1]!)
    if (content.length !== 1 || content[0]!.tagName !== 'Leiding') return chain
    chain.push(content[0]!)
  }
}

function readCable(chain: readonly Element[], inherited: TrikRiserCable | undefined): TrikRiserCable | undefined {
  const attribute = (name: string) => chain.map((element) => element.getAttribute(name)).find((value) => value != null && value.trim() !== '')
  const own: TrikRiserCable = {
    kind: attribute('GeleiderType')?.trim(),
    sectionMm2: parseNumber(attribute('GeleiderDoorsnede')),
    conductors: parseNumber(attribute('AantalGeleiders')),
    hasPe: parseBooleanJaNee(attribute('Beschermingsgeleider')),
    inTube: parseBooleanJaNee(attribute('InBuis')),
  }
  const merged: TrikRiserCable = { ...inherited }
  for (const [key, value] of Object.entries(own)) if (value !== undefined) (merged as Record<string, unknown>)[key] = value
  return Object.keys(merged).length > 0 ? merged : undefined
}

/**
 * Risers of a circuit's trunk Leiding. When a direct Leiding child holds two or more rows, the trunk
 * splits into stems: if every child is a Leiding each is its own stem (the first is the trunk's own),
 * otherwise loads and single-row Leidingen stay on the trunk and each multi-row Leiding is a riser.
 * A riser that splits the same way contributes further stems (no nesting: its first child keeps its
 * stem). Empty Leidingen directly on a trunk are ignored. Without such a child there are no risers.
 */
export function planTrikRisers(trunk: Element): TrikRiserPlan | undefined {
  const stemByRoot = new Map<Element, number>()
  const cableByStem = new Map<number, TrikRiserCable>()
  let lastStem = 0
  const expand = (leiding: Element, stem: number, inherited: TrikRiserCable | undefined): void => {
    const chain = followSingleChain(leiding)
    const content = contentOf(chain[chain.length - 1]!).filter((child) => child.tagName !== 'Leiding' || rowCount(child) > 0)
    if (!content.some((child) => child.tagName === 'Leiding' && rowCount(child) >= 2)) return
    const allLeidingen = content.every((child) => child.tagName === 'Leiding')
    let first = true
    for (const child of content) {
      if (child.tagName !== 'Leiding') continue
      const asStem = allLeidingen ? (first ? stem : ++lastStem) : rowCount(child) >= 2 ? ++lastStem : undefined
      first = false
      if (asStem === undefined) continue
      stemByRoot.set(child, asStem)
      const cable = asStem === stem ? inherited : readCable(followSingleChain(child), inherited)
      if (asStem > 0 && cable && asStem !== stem) cableByStem.set(asStem, cable)
      expand(child, asStem, cable)
    }
  }
  expand(trunk, 0, undefined)
  return stemByRoot.size > 0 ? { stemByRoot, cableByStem } : undefined
}

/** The stem a TRiK element belongs to: that of its nearest ancestor that starts one (0 = the trunk). */
export function trikStemOf(element: Element, plan: TrikRiserPlan | undefined): number {
  if (!plan) return 0
  for (let cursor: Element | null = element; cursor; cursor = cursor.parentElement) {
    const stem = plan.stemByRoot.get(cursor)
    if (stem !== undefined) return stem
  }
  return 0
}
