/** Full git SHA baked into this bundle at build time (see `vite.config.ts`). */
export const APP_BUILD_COMMIT = (import.meta.env.VITE_APP_BUILD_COMMIT ?? '').trim()

/** Short label for display (typical 7-char prefix of a full SHA). */
export function getAppBuildCommitShortLabel(): string | null {
  if (!APP_BUILD_COMMIT) return null
  return APP_BUILD_COMMIT.length >= 7 ? APP_BUILD_COMMIT.slice(0, 7) : APP_BUILD_COMMIT
}

/** ISO commit date of {@link APP_BUILD_COMMIT}; identical for hosted and Community builds of one commit. */
export const APP_BUILD_DATE = (import.meta.env.VITE_APP_BUILD_DATE ?? '').trim()

/** Build date formatted for `locale`, or null when unknown or unparseable. */
export function formatAppBuildDate(locale: string): string | null {
  if (!APP_BUILD_DATE) return null
  const date = new Date(APP_BUILD_DATE)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
}
