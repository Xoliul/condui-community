import type { InstallerProfileData } from '@/editions/community/communityInstallerProfileModel'
import { EMPTY_INSTALLER_PROFILE, isInstallerProfileEmpty } from '@/editions/community/communityInstallerProfileModel'
import {
  getLocalInstallerProfile,
  LEGACY_INSTALLER_PROFILE_KEY,
  parseInstallerProfileLocalRecord,
  setLocalInstallerProfile,
  toInstallerProfileLocalRecord,
  type InstallerAddress,
  type InstallerProfile,
} from '@/lib/installerProfileLocalStorage'
import { getServerSetting, isServerStorageEnabled, putServerSetting } from './communityServerStorage'

export type { InstallerAddress, InstallerProfile, InstallerProfileData }

export function resetInstallerProfileSessionState(): void {}

export async function getInstallerProfile(): Promise<InstallerProfile> {
  if (!(await isServerStorageEnabled())) return getLocalInstallerProfile(null)
  const stored = await getServerSetting<unknown>(LEGACY_INSTALLER_PROFILE_KEY)
  if (stored === undefined) {
    // First use of server storage: start from the profile this browser already had.
    const browserProfile = await getLocalInstallerProfile(null)
    if (!isInstallerProfileEmpty(browserProfile)) await setInstallerProfile(browserProfile)
    return browserProfile
  }
  return (
    parseInstallerProfileLocalRecord(stored)?.profile ?? {
      ...EMPTY_INSTALLER_PROFILE,
      address: { ...EMPTY_INSTALLER_PROFILE.address },
    }
  )
}

export async function setInstallerProfile(profile: InstallerProfile): Promise<void> {
  if (await isServerStorageEnabled()) {
    await putServerSetting(LEGACY_INSTALLER_PROFILE_KEY, toInstallerProfileLocalRecord(profile, null))
    return
  }
  await setLocalInstallerProfile(profile, null)
}
