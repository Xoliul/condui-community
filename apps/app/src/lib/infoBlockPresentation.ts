/** Portable drawing preferences; entitlement is supplied by the edition/access adapter. */
export interface InfoBlockPresentationPreferences {
  showConduiBranding?: boolean
  installerHeading?: string
}

export function resolveInfoBlockPresentation(
  preferences: InfoBlockPresentationPreferences | undefined,
  defaults: { headerInstaller: string; madeWithText: string },
  canCustomize: boolean,
) {
  return {
    headerInstaller: canCustomize
      ? preferences?.installerHeading?.trim() || defaults.headerInstaller
      : defaults.headerInstaller,
    madeWithText: canCustomize && preferences?.showConduiBranding === false
      ? ''
      : defaults.madeWithText,
  }
}
