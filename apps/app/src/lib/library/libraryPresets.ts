import type { SymbolMetadata } from '@/lib/symbols'
import { getSymbolById } from '@/lib/symbols'
import { getSearchPreset, searchPresets, type SearchPreset } from './searchPresets'

/**
 * Library presets: a catalog entry of its own (own name, icon, favourite, recent) that creates a
 * base symbol with explicit defaults. Only the base symbol and its defaults are stored in the
 * project; the entry ID never is. A preset reaches every placement route (drag, armed click,
 * Ctrl/Cmd+K, agents) as the base symbol plus `searchPreset`, so the existing transport and the
 * `electrical.placeSymbol` command apply the defaults inside the placement's own draft.
 */

/** Catalog entry that creates a Domotica module with the horizontal one-wire layout. */
export const DOMOTICA_HORIZONTAL_PRESET_ID = 'domotica_horizontal'

export interface ResolvedLibraryPreset {
  presetId: string
  baseSymbol: SymbolMetadata
  defaultProps: SearchPreset['defaults']
}

function findLibraryEntryPreset(entryId: string | undefined): SearchPreset | undefined {
  return entryId ? searchPresets.find((preset) => preset.libraryEntry && preset.id === entryId) : undefined
}

/** Whether `id` is a library entry that resolves through the preset resolver. */
export function isLibraryPresetEntryId(id: string | undefined): boolean {
  return !!findLibraryEntryPreset(id)
}

/** Entry ID -> base symbol and defaults; `null` for anything else, including a stale entry ID. */
export function resolveLibraryPreset(entryId: string | undefined): ResolvedLibraryPreset | null {
  const preset = findLibraryEntryPreset(entryId)
  const baseSymbol = preset && getSymbolById(preset.symbolId)
  return preset && baseSymbol ? { presetId: preset.id, baseSymbol, defaultProps: preset.defaults } : null
}

/**
 * The symbol every placement route works with: a preset entry becomes its base symbol carrying
 * the preset, any other symbol is returned unchanged.
 */
export function toPlaceableSymbol(symbol: SymbolMetadata): SymbolMetadata {
  const resolved = resolveLibraryPreset(symbol.id)
  return resolved ? { ...resolved.baseSymbol, searchPreset: resolved.presetId } : symbol
}

/** Placement input as agents and the command palette give it: an entry ID resolves to base + preset. */
export function resolveLibraryPresetInput<T extends { symbolId: string; searchPreset?: string }>(
  input: T
): T {
  const resolved = resolveLibraryPreset(input.symbolId)
  if (!resolved) return input
  if (input.searchPreset && input.searchPreset !== resolved.presetId) return input
  return { ...input, symbolId: resolved.baseSymbol.id, searchPreset: resolved.presetId }
}

/** Whether the placement creates a horizontal Domotica module. */
export function isHorizontalDomoticaPreset(symbolId: string, searchPreset: string | undefined): boolean {
  return (
    symbolId === 'domotica' &&
    getSearchPreset(symbolId, searchPreset)?.defaults.domoticaProps?.oneWireLayout === 'horizontal'
  )
}
