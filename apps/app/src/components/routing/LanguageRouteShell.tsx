import { useEffect } from 'react'
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom'
import i18n from '@/i18n'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  persistLanguagePreference,
  resolveUnprefixedLanguagePreference,
} from '@/utils/userPreferences'
import {
  getCanonicalizedPathForDomain,
  isLanguageCanonicalizationExcluded,
  normalizeSupportedLanguage,
  type SupportedLanguage,
} from '@/utils/languageRouting'

function LanguageRouteContent({ language }: { language: SupportedLanguage }) {
  const currentLanguage = useSettingsStore((state) => state.language)
  const setLanguage = useSettingsStore((state) => state.setLanguage)

  useEffect(() => {
    if (currentLanguage !== language) {
      setLanguage(language)
      return
    }
    if (i18n.language !== language) {
      void i18n.changeLanguage(language)
    }
    persistLanguagePreference(language, ['eendra-language'])
  }, [currentLanguage, language, setLanguage])

  return <Outlet />
}

export function LanguageRouteShell() {
  const { lang } = useParams()
  const location = useLocation()
  const language = normalizeSupportedLanguage(lang)

  if (!language) {
    const canonicalPath =
      getCanonicalizedPathForDomain(
        location.pathname,
        window.location.hostname,
        resolveUnprefixedLanguagePreference(window.location.hostname),
      ) ?? '/nl'
    return <Navigate to={`${canonicalPath}${location.search}${location.hash}`} replace />
  }

  return <LanguageRouteContent language={language} />
}

export function UnprefixedLanguageRedirect() {
  const location = useLocation()

  if (isLanguageCanonicalizationExcluded(location.pathname)) {
    return null
  }

  const canonicalPath =
    getCanonicalizedPathForDomain(
      location.pathname,
      window.location.hostname,
      resolveUnprefixedLanguagePreference(window.location.hostname),
    ) ?? '/nl'

  return <Navigate to={`${canonicalPath}${location.search}${location.hash}`} replace />
}
