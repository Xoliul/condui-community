import i18n, { type BackendModule } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { applyCanonicalLanguagePathIfNeeded } from '@/utils/languageRouting'
import {
  resolveInitialLanguagePreference,
  resolveUnprefixedLanguagePreference,
} from '@/utils/userPreferences'

if (typeof document !== 'undefined') {
  applyCanonicalLanguagePathIfNeeded(resolveUnprefixedLanguagePreference(window.location.hostname))
}

import { symbolCategoryLabels } from './locales/symbolCategoryLabels'
import { setDomainLanguage } from '@/lib/i18n/domainI18n'
import {
  DOMAIN_LANGUAGES,
  getLoadedLocaleCatalog,
  loadLocaleCatalog,
  normalizeDomainLanguage,
  type LocaleCatalog,
} from '@/lib/i18n/localeCatalogs'

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

// Bundle catalogs that are already in memory (nl-BE, or every language in tests); the
// backend downloads the others the first time `changeLanguage` asks for them.
const resources = Object.fromEntries(
  DOMAIN_LANGUAGES.flatMap((language) => {
    const catalog = getLoadedLocaleCatalog(language)
    return catalog ? [[language, { translation: withSymbolCategoryLabels(catalog, language) }]] : []
  })
)

const lazyLocaleBackend: BackendModule = {
  type: 'backend',
  init() {},
  read(language, _namespace, callback) {
    const normalized = normalizeDomainLanguage(language)
    void loadLocaleCatalog(normalized).then(
      (catalog: LocaleCatalog) => callback(null, withSymbolCategoryLabels(catalog, normalized)),
      (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), false)
    )
  },
}

const getInitialLanguage = () => {
  if (typeof document === 'undefined') {
    return 'nl-BE'
  }
  return resolveInitialLanguagePreference(window.location.hostname)
}

/** Resolves once the initial language's catalog is loaded; render after it to avoid fallback text. */
export const i18nReady = i18n
  .use(lazyLocaleBackend)
  .use(initReactI18next)
  .init({
    resources,
    partialBundledLanguages: true,
    load: 'currentOnly',
    lng: getInitialLanguage(),
    fallbackLng: 'nl-BE',
    interpolation: {
      escapeValue: false, // React already escapes
    },
  })

function syncActiveLanguage(language: string | undefined): void {
  const normalizedLanguage = normalizeDomainLanguage(language)
  setDomainLanguage(normalizedLanguage)
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = normalizedLanguage
  }
}

syncActiveLanguage(i18n.language)
i18n.on('languageChanged', syncActiveLanguage)
void i18nReady.then(() => syncActiveLanguage(i18n.language))

export default i18n
