import domainI18n from './i18n/domainI18n'
import type { SymbolMetadata } from './symbols'
import { normalizeSupportedLanguage } from '../utils/languageRouting'

/** Localized names also serve library search, exports and the public symbol reference. */
export function getLocalizedSymbolName(symbol: SymbolMetadata, language: string): string {
  const lng = normalizeSupportedLanguage(language) ?? 'nl-BE'
  if (lng === 'nl-BE') return symbol.nameNL
  if (lng === 'fr-BE') return symbol.nameFR
  if (lng === 'en') return symbol.name
  return domainI18n.t(`symbols.names.${symbol.id}`, { lng, defaultValue: symbol.nameNL })
}
