import type { Installation, InstallationProfile } from '@/types/schema'

export const DEFAULT_INSTALLATION_PROFILE: InstallationProfile = 'household'

export function resolveInstallationProfile(
  installation: Pick<Installation, 'installationProfile'> | null | undefined,
): InstallationProfile {
  return installation?.installationProfile === 'non_household'
    ? 'non_household'
    : DEFAULT_INSTALLATION_PROFILE
}

export function isHouseholdInstallation(
  installation: Pick<Installation, 'installationProfile'> | null | undefined,
): boolean {
  return resolveInstallationProfile(installation) === 'household'
}

