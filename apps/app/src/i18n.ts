import de from './locales/de.json'
import pl from './locales/pl.json'
import ro from './locales/ro.json'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { applyCanonicalLanguagePathIfNeeded } from '@/utils/languageRouting'
import { resolveInitialLanguagePreference } from '@/utils/userPreferences'

if (typeof document !== 'undefined') {
  applyCanonicalLanguagePathIfNeeded()
}

import nlBE from './locales/nl-BE.json'
import frBE from './locales/fr-BE.json'
import en from './locales/en.json'
import { symbolCategoryLabels } from './locales/symbolCategoryLabels'
import { setDomainLanguage } from '@/lib/i18n/domainI18n'

function withSymbolCategoryLabels<T extends { symbols: Record<string, unknown> }>(
  locale: T,
  lang: keyof typeof symbolCategoryLabels
): T {
  return {
    ...locale,
    symbols: {
      ...locale.symbols,
      categories: symbolCategoryLabels[lang],
    },
  }
}

const resources = {
  de: { translation: withSymbolCategoryLabels(de, 'de') },
  pl: { translation: withSymbolCategoryLabels(pl, 'pl') },
  ro: { translation: withSymbolCategoryLabels(ro, 'ro') },
  'nl-BE': { translation: withSymbolCategoryLabels(nlBE, 'nl-BE') },
  'fr-BE': { translation: withSymbolCategoryLabels(frBE, 'fr-BE') },
  en: { translation: withSymbolCategoryLabels(en, 'en') },
}

const getInitialLanguage = () => {
  if (typeof document === 'undefined') {
    return 'nl-BE'
  }
  return resolveInitialLanguagePreference(window.location.hostname)
}

i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  fallbackLng: 'nl-BE',
  interpolation: {
    escapeValue: false, // React already escapes
  },
})

setDomainLanguage(i18n.language)
i18n.on('languageChanged', (language) => setDomainLanguage(language))

export default i18n
