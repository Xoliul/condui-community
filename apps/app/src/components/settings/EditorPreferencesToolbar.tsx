import { LANGUAGE_OPTIONS } from '@/utils/languageRouting'
import { startTransition } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  buildPathForLanguageForHostname,
  normalizeSupportedLanguage,
  stripLanguagePrefixFromPath,
} from '@/utils/languageRouting'
import { ThemeToggleButton } from './ThemeToggleButton'



export function EditorPreferencesToolbar() {
  const { t } = useTranslation()
  const language = useSettingsStore((state) => state.language)
  const setLanguage = useSettingsStore((state) => state.setLanguage)

  const changeLanguage = (value: string) => {
    const nextLanguage = normalizeSupportedLanguage(value) ?? 'nl-BE'
    setLanguage(nextLanguage)
    startTransition(() => {
      void i18n.changeLanguage(nextLanguage)
    })

    if (typeof window === 'undefined') return
    const pathWithoutLanguage = stripLanguagePrefixFromPath(window.location.pathname)
    const nextPath = buildPathForLanguageForHostname(
      pathWithoutLanguage,
      nextLanguage,
      window.location.hostname,
    )
    window.history.replaceState(
      window.history.state,
      '',
      `${nextPath}${window.location.search}${window.location.hash}`,
    )
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  return (
    <div className="inline-flex items-center gap-2">
      <label className="sr-only" htmlFor="editor-language">
        {t('settings.interface.language')}
      </label>
      <select
        id="editor-language"
        value={language}
        onChange={(event) => changeLanguage(event.target.value)}
        aria-label={t('settings.interface.language')}
        className="min-w-14 max-w-16 cursor-pointer rounded-md border border-slate-300 bg-white px-[0.3rem] py-[0.38rem] text-center text-xs font-semibold text-slate-900 shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 dark:focus-visible:ring-offset-gray-900"
      >
        {LANGUAGE_OPTIONS.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </select>
      <ThemeToggleButton />
    </div>
  )
}
