import type { Installation, Panel } from '@/types/schema'
import { buildPanelCodesById, resolveLabelScheme } from '@/lib/eendraad/labelScheme'

/**
 * Board order for lists and exports. Automatic numbers follow the panel tree, but typed
 * numbers (`numberOverride`) can break that, so with panel numbering on, boards are listed
 * by their displayed number instead. A board is never listed before the board feeding it.
 * With numbering off the tree order is kept. The persisted panel order is never changed.
 */
export type PanelNumberOrderInstallation =
  | Pick<Installation, 'labelScheme' | 'panelNumberingEnabled'>
  | undefined

export interface OrderedPanelTreeEntry {
  panel: Panel
  depth: number
  parent: Panel | null
}

const DIGITS = /^\d+$/
/** Letter sequences of the `upper` style (A … Z, AA): shorter sorts first. */
const SEQUENCE_LETTERS = /^[A-Z]{1,3}$/

function compareDigitRuns(left: string, right: string): number {
  const a = left.replace(/^0+(?=\d)/, '')
  const b = right.replace(/^0+(?=\d)/, '')
  if (a.length !== b.length) return a.length - b.length
  return a < b ? -1 : a > b ? 1 : 0
}

function compareTextRuns(left: string, right: string): number {
  if (SEQUENCE_LETTERS.test(left) && SEQUENCE_LETTERS.test(right) && left.length !== right.length) {
    return left.length - right.length
  }
  return left.localeCompare(right, 'en', { sensitivity: 'base' })
}

/** Natural comparison of board codes: `B2` < `B10`, `1` < `1.1` < `2`, `Z` < `AA`. */
export function comparePanelCodes(left: string, right: string): number {
  const a = left.trim().split(/(\d+)/).filter(Boolean)
  const b = right.trim().split(/(\d+)/).filter(Boolean)
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const x = a[index]!
    const y = b[index]!
    const xDigits = DIGITS.test(x)
    const yDigits = DIGITS.test(y)
    const result =
      xDigits && yDigits
        ? compareDigitRuns(x, y)
        : xDigits !== yDigits
          ? xDigits ? -1 : 1
          : compareTextRuns(x, y)
    if (result !== 0) return result
  }
  return a.length - b.length
}

function treeEntries(rootPanels: readonly Panel[]): OrderedPanelTreeEntry[] {
  const entries: OrderedPanelTreeEntry[] = []
  const visit = (panels: readonly Panel[], parent: Panel | null, depth: number) => {
    for (const panel of panels) {
      entries.push({ panel, depth, parent })
      visit(panel.subPanels ?? [], panel, depth + 1)
    }
  }
  visit(rootPanels, null, 0)
  return entries
}

/** Comparator by displayed number with the tree order as stable tiebreak, or null when numbering is off. */
function createPanelNumberComparator(
  rootPanels: readonly Panel[],
  installation: PanelNumberOrderInstallation
): ((left: Panel, right: Panel) => number) | null {
  if (!installation?.panelNumberingEnabled) return null
  const codes = buildPanelCodesById(rootPanels, resolveLabelScheme(installation.labelScheme))
  const treeIndex = new Map(treeEntries(rootPanels).map(({ panel }, index) => [panel.id, index]))
  return (left, right) =>
    comparePanelCodes(codes.get(left.id)?.code ?? '', codes.get(right.id)?.code ?? '') ||
    (treeIndex.get(left.id) ?? 0) - (treeIndex.get(right.id) ?? 0)
}

/**
 * Tree order with the boards of each level sorted by number, for indented board lists.
 * Each board's sub-boards stay directly below it.
 */
export function orderPanelTreeByNumber(
  rootPanels: readonly Panel[],
  installation: PanelNumberOrderInstallation
): OrderedPanelTreeEntry[] {
  const compare = createPanelNumberComparator(rootPanels, installation)
  if (!compare) return treeEntries(rootPanels)
  const entries: OrderedPanelTreeEntry[] = []
  const visit = (panels: readonly Panel[], parent: Panel | null, depth: number) => {
    for (const panel of [...panels].sort(compare)) {
      entries.push({ panel, depth, parent })
      visit(panel.subPanels ?? [], panel, depth + 1)
    }
  }
  visit(rootPanels, null, 0)
  return entries
}

/**
 * All boards in displayed-number order, for flat lists such as export pages. A board whose
 * number sorts before its parent's still follows that parent.
 */
export function orderPanelsByNumber(
  rootPanels: readonly Panel[],
  installation: PanelNumberOrderInstallation
): Panel[] {
  const compare = createPanelNumberComparator(rootPanels, installation)
  if (!compare) return treeEntries(rootPanels).map(({ panel }) => panel)
  const ordered: Panel[] = []
  const available = [...rootPanels]
  while (available.length > 0) {
    let next = 0
    for (let index = 1; index < available.length; index += 1) {
      if (compare(available[index]!, available[next]!) < 0) next = index
    }
    const [panel] = available.splice(next, 1)
    ordered.push(panel!)
    available.push(...(panel!.subPanels ?? []))
  }
  return ordered
}

/** Position of each board in {@link orderPanelsByNumber}, for sorting derived per-board items. */
export function panelNumberRankById(
  rootPanels: readonly Panel[],
  installation: PanelNumberOrderInstallation
): Map<string, number> {
  return new Map(orderPanelsByNumber(rootPanels, installation).map((panel, index) => [panel.id, index]))
}
