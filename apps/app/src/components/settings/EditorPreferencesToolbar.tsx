import { LANGUAGE_OPTIONS } from '@/utils/languageRouting'
import { useTranslation } from 'react-i18next'
import { switchEditorLanguage } from '@/lib/preferences/switchEditorLanguage'
import { useSettingsStore } from '@/stores/settingsStore'
import { ThemeToggleButton } from './ThemeToggleButton'



export function EditorPreferencesToolbar() {
  const { t } = useTranslation()
  const language = useSettingsStore((state) => state.language)

  const changeLanguage = switchEditorLanguage

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
