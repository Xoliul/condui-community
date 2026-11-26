import { getLocalizedSymbolName } from '@/lib/symbolNames'
import { getDomainTranslator } from '@/lib/i18n/domainI18n'
import type { SymbolMetadata } from '@/lib/symbols'
import { isSymbolAvailableInLibrary } from '@/lib/supplyTopologyFeature'
import { createLiteralMatcher, filterBySearchRelevance } from '@/utils/search'
import {
  matchSearchPresetPhrases,
  normalizePresetQuery,
  searchPresets,
  withSearchPreset,
  type SearchPreset,
  type SearchPresetPhraseMatch,
} from './searchPresets'

/**
 * Library search. Every symbol is listed for its own names and tags. A search preset (a variant
 * such as a teleruptor or a wall light) is listed as a separate result, with its own name and
 * drawing, only when the query is one of its phrases or starts a word of one, in any language.
 * A variant never changes the generic symbol's result, and a word that already names the generic
 * symbol (for example "relay") does not list its variants.
 */

const NAME_LANGUAGES = ['nl-BE', 'en', 'fr-BE', 'de', 'pl', 'ro'] as const
const phraseCache = new Map<string, readonly string[]>()

/** Aliases plus the localized name in every supported language. */
function getPresetPhrases(preset: SearchPreset): readonly string[] {
  let phrases = phraseCache.get(preset.id)
  if (!phrases) {
    phrases = [
      ...preset.aliases,
      ...NAME_LANGUAGES.map((language) =>
        getDomainTranslator(language)(`symbols.searchPresets.${preset.id}`)
      ),
    ]
    phraseCache.set(preset.id, phrases)
  }
  return phrases
}

function findVariantMatches(query: string) {
  const matches: { preset: SearchPreset; match: SearchPresetPhraseMatch; order: number }[] = []
  searchPresets.forEach((preset, order) => {
    if (preset.libraryEntry) return
    const match = matchSearchPresetPhrases(query, getPresetPhrases(preset))
    if (match) matches.push({ preset, match, order })
  })
  // Of the whole phrases found for one symbol only the longest stay ("tl 3" is not also "tl").
  const longest = new Map<string, number>()
  for (const { preset, match } of matches)
    if (match.tier === 'phrase')
      longest.set(preset.symbolId, Math.max(longest.get(preset.symbolId) ?? 0, match.score))
  return matches
    .filter(
      ({ preset, match }) => match.tier !== 'phrase' || match.score === longest.get(preset.symbolId)
    )
    .sort(
      (a, b) =>
        Number(b.match.tier === 'phrase') - Number(a.match.tier === 'phrase') ||
        b.match.score - a.match.score ||
        a.order - b.order
    )
}

function symbolTexts(symbol: SymbolMetadata, locale: string): string[] {
  return [
    symbol.name,
    getLocalizedSymbolName(symbol, locale),
    symbol.nameNL,
    symbol.nameFR,
    ...symbol.tags,
  ]
}

/** The results for a non-empty query: variants (best match first), then generic symbols. */
export function searchLibrarySymbols(
  symbols: readonly SymbolMetadata[],
  query: string,
  locale = 'en'
): SymbolMetadata[] {
  const normalizedQuery = normalizePresetQuery(query)
  const available = symbols.filter(isSymbolAvailableInLibrary)
  const variants = findVariantMatches(query)

  // One or two letters only complete the start of a name; presets then need the exact alias.
  const shortPrefix =
    normalizedQuery.length > 0 && normalizedQuery.length <= 2 && !normalizedQuery.includes(' ')
  let generic: SymbolMetadata[]
  if (shortPrefix) {
    generic = available.filter((symbol) =>
      normalizePresetQuery(getLocalizedSymbolName(symbol, locale)).startsWith(normalizedQuery)
    )
  } else if (variants.length > 0) {
    // Variants answer the query; fuzzy fallback would only add noise next to them.
    const matches = createLiteralMatcher(query)
    generic = available.filter((symbol) => matches(symbolTexts(symbol, locale)))
  } else {
    generic = filterBySearchRelevance(available, query, (symbol) => symbolTexts(symbol, locale))
  }

  const namedIds = new Set(
    available
      .filter((symbol) =>
        [symbol.name, getLocalizedSymbolName(symbol, locale), symbol.nameNL, symbol.nameFR].some(
          (text) => ` ${normalizePresetQuery(text)}`.includes(` ${normalizedQuery}`)
        )
      )
      .map((symbol) => symbol.id)
  )
  const genericIds = new Set(generic.map((symbol) => symbol.id))
  const bySymbol = new Map(symbols.map((symbol) => [symbol.id, symbol]))
  const rows: SymbolMetadata[] = []
  for (const { preset, match } of variants) {
    const base = bySymbol.get(preset.symbolId)
    if (!base) continue
    // A word that already finds the generic symbol never also lists its variants.
    if (match.tier === 'prefix' && namedIds.has(base.id)) continue
    // A symbol hidden from the library stays reachable through an exact phrase, as before.
    if (!isSymbolAvailableInLibrary(base) && match.tier !== 'phrase') continue
    rows.push(withSearchPreset(base, preset.id))
  }
  // The plain symbol stays reachable right after the variants that were found for it.
  const plain = [...new Set(rows.map((row) => row.id))]
    .filter((id) => !genericIds.has(id) && isSymbolAvailableInLibrary(bySymbol.get(id)!))
    .map((id) => bySymbol.get(id)!)
  return [...rows, ...plain, ...generic]
}
