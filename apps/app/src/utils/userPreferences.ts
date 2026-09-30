import { readLanguageCookie, writeLanguageCookie } from './language'
import { getPathLanguagePrefix, normalizeSupportedLanguage, resolveDomainDefaultLanguage } from './languageRouting'

export type ThemeMode = 'light' | 'dark'
export type TutorialOnboardingVariant = 'desktop' | 'mobile' | 'tablet'
export type TouchOnboardingVariant = 'mobile' | 'tablet'

export type TutorialOnboardingStatus = {
  seenAt?: string
  dismissedAt?: string
  clickedAt?: string
}

export type TouchOnboardingStatus = {
  seenAt?: string
  dismissedAt?: string
  shortcutsOpenedAt?: string
}

export type EditorOnboardingState = {
  tutorial?: Partial<Record<TutorialOnboardingVariant, TutorialOnboardingStatus>>
  touch?: Partial<Record<TouchOnboardingVariant, TouchOnboardingStatus>>
}

export const DEFAULT_THEME_MODE: ThemeMode = 'dark'

export interface UserPreferences {
  language: string
  themeMode: ThemeMode
  editorOnboardingState?: EditorOnboardingState
}

export interface PreferencePersistenceAdapter {
  loadPreferences: () => Promise<Partial<UserPreferences> | null>
  savePreferences: (preferences: Partial<UserPreferences>) => Promise<void>
}

const THEME_COOKIE_NAME = 'eendra-theme'
const ONE_YEAR_IN_SECONDS = 365 * 24 * 60 * 60

let preferencePersistenceAdapter: PreferencePersistenceAdapter | null = null

export const registerPreferencePersistenceAdapter = (
  adapter: PreferencePersistenceAdapter | null,
): void => {
  preferencePersistenceAdapter = adapter
}

const readCookie = (name: string): string | null => {
  if (typeof document === 'undefined') return null

  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return typeof match?.[1] === 'string' ? decodeURIComponent(match[1]) : null
}

const writeCookie = (name: string, value: string): void => {
  if (typeof document === 'undefined') return

  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${ONE_YEAR_IN_SECONDS};samesite=lax`
}

export const readThemeCookie = (): ThemeMode | null => {
  const value = readCookie(THEME_COOKIE_NAME)
  return value === 'dark' ? 'dark' : value === 'light' ? 'light' : null
}

export const writeThemeCookie = (themeMode: ThemeMode): void => {
  writeCookie(THEME_COOKIE_NAME, themeMode)
}

const readLocalStorage = (keys: string[]): string | null => {
  if (typeof window === 'undefined') return null

  for (const key of keys) {
    const value = window.localStorage.getItem(key)
    if (value) return value
  }

  return null
}

const writeLocalStorage = (keys: string[], value: string): void => {
  if (typeof window === 'undefined') return

  for (const key of keys) {
    window.localStorage.setItem(key, value)
  }
}

export const resolveInitialLanguagePreference = (hostname: string): string => {
  if (typeof window !== 'undefined') {
    const pathLanguage = getPathLanguagePrefix(window.location.pathname)
    if (pathLanguage) return pathLanguage
  }

  const cookieLanguage = normalizeSupportedLanguage(readLanguageCookie())
  if (cookieLanguage) return cookieLanguage

  try {
    const settings = window.localStorage.getItem('eendra-settings')
    if (settings) {
      const parsed = JSON.parse(settings)
      const storedLanguage = normalizeSupportedLanguage(parsed?.state?.language)
      if (storedLanguage) {
        return storedLanguage
      }
    }
  } catch {
    // Ignore malformed persisted data and continue with fallback sources.
  }

  const legacyLanguage = normalizeSupportedLanguage(readLocalStorage(['eendra-language']))
  if (legacyLanguage) return legacyLanguage

  return resolveDomainDefaultLanguage(hostname)
}

export const resolveInitialThemePreference = (legacyStorageKeys: string[] = []): ThemeMode => {
  const cookieTheme = readThemeCookie()
  if (cookieTheme) return cookieTheme

  const legacyTheme = readLocalStorage(legacyStorageKeys)
  if (legacyTheme === 'dark' || legacyTheme === 'light') return legacyTheme

  return DEFAULT_THEME_MODE
}

export const persistLanguagePreference = (language: string, legacyStorageKeys: string[] = []): void => {
  writeLanguageCookie(language)
  if (legacyStorageKeys.length > 0) {
    writeLocalStorage(legacyStorageKeys, language)
  }
  void persistPreferences({ language })
}

export const persistThemePreference = (themeMode: ThemeMode, legacyStorageKeys: string[] = []): void => {
  writeThemeCookie(themeMode)
  if (legacyStorageKeys.length > 0) {
    writeLocalStorage(legacyStorageKeys, themeMode)
  }
  void persistPreferences({ themeMode })
}

export const applyThemeToDocument = (themeMode: ThemeMode): void => {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', themeMode === 'dark')
}

export const loadPersistedPreferences = async (): Promise<Partial<UserPreferences> | null> => {
  if (!preferencePersistenceAdapter) return null

  try {
    return await preferencePersistenceAdapter.loadPreferences()
  } catch {
    return null
  }
}

export const loadPersistedOnboardingState = async (): Promise<EditorOnboardingState | null> => {
  const prefs = await loadPersistedPreferences()
  return prefs?.editorOnboardingState ?? null
}

export const persistPreferences = async (
  preferences: Partial<UserPreferences>
): Promise<void> => {
  if (!preferencePersistenceAdapter) return

  try {
    await preferencePersistenceAdapter.savePreferences(preferences)
  } catch {
    // Keep local preference UX resilient if optional persistence is unavailable.
  }
}

export const persistOnboardingState = async (
  editorOnboardingState: EditorOnboardingState
): Promise<void> => {
  await persistPreferences({ editorOnboardingState })
}
