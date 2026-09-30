/**
 * Marking pages in the delete overview: a plain or Ctrl/Cmd click toggles one page, and
 * Shift+click marks the whole run between the last clicked page and this one.
 */
export interface PageSelectionState {
  marked: ReadonlySet<number>
  /** Page the next Shift+click extends from. */
  anchor: number | null
}

export const EMPTY_PAGE_SELECTION: PageSelectionState = { marked: new Set(), anchor: null }

export function clickPageSelection(
  state: PageSelectionState,
  page: number,
  modifiers: { shift: boolean }
): PageSelectionState {
  if (modifiers.shift && state.anchor !== null) {
    const marked = new Set(state.marked)
    const from = Math.min(state.anchor, page)
    const to = Math.max(state.anchor, page)
    for (let candidate = from; candidate <= to; candidate++) marked.add(candidate)
    return { marked, anchor: page }
  }
  const marked = new Set(state.marked)
  if (!marked.delete(page)) marked.add(page)
  return { marked, anchor: page }
}
