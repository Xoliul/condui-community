import { useEffect } from 'react'
import { startEditorPreferenceSync } from '@/lib/preferences/editorPreferenceSync'
import {
  COMMUNITY_EDITOR_PREFERENCE_FIELDS,
  subscribeToSettingsChanges,
} from '@/lib/preferences/editorPreferenceFields'
import { getServerSetting, isServerStorageEnabled, putServerSetting } from './communityServerStorage'

const EDITOR_PREFERENCES_SETTING_KEY = 'editorPreferences'

/** With server storage, language, theme and workflow preferences live in the server settings. */
export function useCommunityEditorPreferencesSync(): void {
  useEffect(() => {
    let stop: (() => void) | null = null
    let cancelled = false
    void isServerStorageEnabled().then((enabled) => {
      if (!enabled || cancelled) return
      stop = startEditorPreferenceSync(
        {
          load: async () => {
            const value = await getServerSetting<unknown>(EDITOR_PREFERENCES_SETTING_KEY)
            return value && typeof value === 'object' && !Array.isArray(value)
              ? (value as Record<string, unknown>)
              : null
          },
          save: (values) => putServerSetting(EDITOR_PREFERENCES_SETTING_KEY, values),
        },
        COMMUNITY_EDITOR_PREFERENCE_FIELDS,
        subscribeToSettingsChanges,
      )
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [])
}
