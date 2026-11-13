import { getDomainTranslator } from './i18n/domainI18n'
import type { SymbolMetadata } from './symbols'
import { normalizeSupportedLanguage } from '../utils/languageRouting'

/** Localized names also serve library search, exports and the public symbol reference. */
export function getLocalizedSymbolName(symbol: SymbolMetadata, language: string): string {
  const lng = normalizeSupportedLanguage(language) ?? 'nl-BE'
  if (symbol.searchPreset) return getDomainTranslator(lng)(`symbols.searchPresets.${symbol.searchPreset}`)
  if (lng === 'nl-BE') return symbol.nameNL
  if (lng === 'fr-BE') return symbol.nameFR
  if (lng === 'en') return symbol.name
  return getDomainTranslator(lng)(`symbols.names.${symbol.id}`, { defaultValue: symbol.nameNL })
}
