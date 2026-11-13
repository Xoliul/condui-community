import type { symbolCategories } from '@/lib/symbols'

export type SymbolCategoryKey = keyof typeof symbolCategories

export type LibraryRailGroupKey =
  | 'grid'
  | 'protection'
  | 'outlets'
  | 'switches'
  | 'lighting'
  | 'appliances'
  | 'hvac'
  | 'sound'
  | 'energyConversion'
  | 'other'

export interface LibraryRailGroup {
  key: LibraryRailGroupKey
  /** Symbol categories listed under this group. A UI grouping only; symbol data keeps its category. */
  categories: readonly SymbolCategoryKey[]
  iconPath: string
}

/** Library rail groups in display order. The one-item categories merge into `other`. */
export const LIBRARY_RAIL_GROUPS: readonly LibraryRailGroup[] = [
  { key: 'grid', categories: ['grid'], iconPath: '/symbols/grid/mains.svg' },
  { key: 'protection', categories: ['protection'], iconPath: '/symbols/protection/mcb.svg' },
  { key: 'outlets', categories: ['outlets'], iconPath: '/symbols/outlets/socket_gnd_child.svg' },
  { key: 'switches', categories: ['switches'], iconPath: '/symbols/switches/switch_1p_icon.svg' },
  { key: 'lighting', categories: ['lighting'], iconPath: '/symbols/lighting/light_point.svg' },
  { key: 'appliances', categories: ['appliances'], iconPath: '/symbols/appliances/washer.svg' },
  { key: 'hvac', categories: ['hvac'], iconPath: '/symbols/hvac/furnace_heatpump.svg' },
  { key: 'energyConversion', categories: ['energyConversion'], iconPath: '/symbols/energy-conversion/inverter.svg' },
  { key: 'sound', categories: ['sound'], iconPath: '/symbols/sound/bell.svg' },
  {
    key: 'other',
    categories: ['domotica', 'metering', 'notes'],
    iconPath: '/symbols/domotica/domotica_icon.svg',
  },
]

export type LibraryRailEntry = 'all' | 'recent' | 'favorites'

export type LibraryRailSelection =
  | { kind: LibraryRailEntry }
  | { kind: 'groups'; groups: ReadonlySet<LibraryRailGroupKey> }

export const LIBRARY_RAIL_ALL: LibraryRailSelection = { kind: 'all' }

/** Selection after a plain click on All, Recent or Favourites. */
export function selectRailEntry(entry: LibraryRailEntry): LibraryRailSelection {
  return { kind: entry }
}

/**
 * Selection after clicking a group. A plain click shows only that group; an additive
 * click toggles it in the multi-selection, starting from the clicked group when the
 * current selection is All, Recent or Favourites. Removing the last group returns to All.
 */
export function selectRailGroup(
  current: LibraryRailSelection,
  key: LibraryRailGroupKey,
  additive: boolean
): LibraryRailSelection {
  if (!additive) return { kind: 'groups', groups: new Set([key]) }
  const groups = new Set(current.kind === 'groups' ? current.groups : [])
  if (groups.has(key)) groups.delete(key)
  else groups.add(key)
  return groups.size === 0 ? LIBRARY_RAIL_ALL : { kind: 'groups', groups }
}

/** Selection limited to groups that currently have symbols; All when none of the selected remain. */
export function effectiveRailSelection(
  selection: LibraryRailSelection,
  availableKeys: readonly LibraryRailGroupKey[]
): LibraryRailSelection {
  if (selection.kind !== 'groups') return selection
  const groups = new Set(availableKeys.filter((key) => selection.groups.has(key)))
  return groups.size === 0 ? LIBRARY_RAIL_ALL : { kind: 'groups', groups }
}

/** Groups listed as sections, in display order. Empty for Recent and Favourites. */
export function getVisibleRailGroupKeys(
  selection: LibraryRailSelection,
  availableKeys: readonly LibraryRailGroupKey[]
): LibraryRailGroupKey[] {
  if (selection.kind === 'all') return [...availableKeys]
  if (selection.kind === 'groups') return availableKeys.filter((key) => selection.groups.has(key))
  return []
}

/** The group whose section is at the top of the scrolled list: the last one starting at or above `offset`. */
export function resolveCurrentRailGroup(
  sections: ReadonlyArray<{ key: LibraryRailGroupKey; top: number }>,
  offset: number
): LibraryRailGroupKey | null {
  let current: LibraryRailGroupKey | null = null
  for (const section of sections) if (section.top <= offset) current = section.key
  return current ?? sections[0]?.key ?? null
}

export function getRailGroupForCategory(category: string): LibraryRailGroup | undefined {
  return LIBRARY_RAIL_GROUPS.find((group) => (group.categories as readonly string[]).includes(category))
}
