import { startTransition } from 'react'
import i18n from '@/i18n'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  buildPathForLanguageForHostname,
  normalizeSupportedLanguage,
  stripLanguagePrefixFromPath,
} from '@/utils/languageRouting'

/**
 * Switches the editor language, including the language prefix in the URL. The route prefix
 * decides the language, so changing only the stored setting would be undone by the router.
 */
export function switchEditorLanguage(value: string): void {
  const nextLanguage = normalizeSupportedLanguage(value) ?? 'nl-BE'
  useSettingsStore.getState().setLanguage(nextLanguage)
  startTransition(() => {
    void i18n.changeLanguage(nextLanguage)
  })

  if (typeof window === 'undefined') return
  const pathWithoutLanguage = stripLanguagePrefixFromPath(window.location.pathname)
  const nextPath = buildPathForLanguageForHostname(pathWithoutLanguage, nextLanguage, window.location.hostname)
  window.history.replaceState(window.history.state, '', `${nextPath}${window.location.search}${window.location.hash}`)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
