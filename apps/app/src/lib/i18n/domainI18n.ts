import de from '@/locales/de.json'
import pl from '@/locales/pl.json'
import ro from '@/locales/ro.json'
import { createInstance } from 'i18next'
import nlBE from '@/locales/nl-BE.json'
import frBE from '@/locales/fr-BE.json'
import en from '@/locales/en.json'

/**
 * React-free translation instance for domain code shared with web workers.
 * The browser i18n bootstrap and each worker request synchronize its language.
 */
const domainI18n = createInstance()

void domainI18n.init({
  resources: {
  de: { translation: de },
  pl: { translation: pl },
  ro: { translation: ro },
    'nl-BE': { translation: nlBE },
    'fr-BE': { translation: frBE },
    en: { translation: en },
  },
  lng: 'nl-BE',
  fallbackLng: 'nl-BE',
  initAsync: false,
  interpolation: { escapeValue: false },
})

export function setDomainLanguage(language: string | null | undefined): void {
  if (!language || domainI18n.language === language) return
  void domainI18n.changeLanguage(language)
}

export default domainI18n
