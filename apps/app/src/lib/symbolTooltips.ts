import { normalizeSupportedLanguage, type SupportedLanguage } from '@/utils/languageRouting'
import { symbolTooltipsDE } from '@/locales/symbolTooltips.de'
import { symbolTooltipsPL } from '@/locales/symbolTooltips.pl'
import { symbolTooltipsRo } from '@/locales/symbolTooltips.ro'
import { symbolTooltipsEn } from '@/locales/symbolTooltips.en'
import { symbolTooltipsFrBE } from '@/locales/symbolTooltips.fr-BE'
import { symbolTooltipsNlBE, type SymbolTooltipId } from '@/locales/symbolTooltips.nl-BE'

type SymbolTooltipCatalog = Record<SymbolTooltipId, string>

const symbolTooltipsByLanguage: Record<SupportedLanguage, SymbolTooltipCatalog> = {
  'nl-BE': symbolTooltipsNlBE,
  'fr-BE': symbolTooltipsFrBE,
  en: symbolTooltipsEn,
  de: symbolTooltipsDE, pl: symbolTooltipsPL, ro: symbolTooltipsRo,
}

function resolveTooltipCatalog(language: string | undefined): SymbolTooltipCatalog | undefined {
  const lang = normalizeSupportedLanguage(language ?? 'nl-BE')
  return lang ? symbolTooltipsByLanguage[lang] : undefined
}

/** Library hover description for a symbol. */
export function getSymbolLibraryTooltip(
  symbolId: string,
  language: string | undefined,
): string | undefined {
  const catalog = resolveTooltipCatalog(language)
  if (!catalog) return undefined
  return catalog[symbolId as keyof SymbolTooltipCatalog]
}
