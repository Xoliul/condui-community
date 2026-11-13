import type { KeyboardLayout } from '@/types/ui'
import { LIBRARY_RAIL_GROUPS, type LibraryRailGroupKey } from './libraryRailGroups'

/**
 * Physical top-row letter keys, left to right. Matching on `KeyboardEvent.code` keeps the same
 * physical key per group on every layout; the layout preference only changes the letter shown.
 */
const TOP_ROW_CODES = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'] as const

const TOP_ROW_LETTERS: Record<KeyboardLayout, string> = {
  azerty: 'AZERTYUIOP',
  qwerty: 'QWERTYUIOP',
}

/** Rail group for a top-row key, by fixed rail order, or null when the key is not a rail hotkey. */
export function libraryRailGroupForKeyCode(code: string): LibraryRailGroupKey | null {
  const index = (TOP_ROW_CODES as readonly string[]).indexOf(code)
  return index >= 0 ? (LIBRARY_RAIL_GROUPS[index]?.key ?? null) : null
}

/** Letter printed on the physical key for a rail group in the chosen layout. */
export function libraryRailHotkeyLabel(key: LibraryRailGroupKey, layout: KeyboardLayout): string | null {
  const index = LIBRARY_RAIL_GROUPS.findIndex((group) => group.key === key)
  return index >= 0 && index < TOP_ROW_CODES.length ? (TOP_ROW_LETTERS[layout][index] ?? null) : null
}
