import type { InstallerProfileData } from '@/editions/community/communityInstallerProfileModel'
import { EMPTY_INSTALLER_PROFILE } from '@/editions/community/communityInstallerProfileModel'
import { db } from '@/lib/db'

export const LEGACY_INSTALLER_PROFILE_KEY = 'installerProfile'

export type InstallerProfileLocalRecord = {
  /** Auth user that owns this local copy; null = signed-out / anonymous device cache. */
  ownerUserId: string | null
  profile: InstallerProfileData
}

export type InstallerAddress = InstallerProfileData['address']

export type InstallerProfile = InstallerProfileData

const defaultProfile = EMPTY_INSTALLER_PROFILE

export function installerProfileStorageKey(userId: string | null | undefined): string {
  if (userId) return `${LEGACY_INSTALLER_PROFILE_KEY}:${userId}`
  return LEGACY_INSTALLER_PROFILE_KEY
}

function parseLegacyProfileValue(v: Record<string, unknown>): InstallerProfile {
  const parseAddress = (raw: unknown): InstallerAddress => {
    if (raw && typeof raw === 'object' && 'street' in raw && typeof (raw as { street: unknown }).street === 'string') {
      const a = raw as Record<string, unknown>
      return {
        street: typeof a.street === 'string' ? a.street : '',
        postalCode: typeof a.postalCode === 'string' ? a.postalCode : '',
        city: typeof a.city === 'string' ? a.city : '',
        country: typeof a.country === 'string' ? a.country : 'BE',
      }
    }
    if (typeof raw === 'string' && raw.trim() !== '') {
      return { street: raw, postalCode: '', city: '', country: 'BE' }
    }
    return { ...defaultProfile.address }
  }

  return {
    name: typeof v.name === 'string' ? v.name : '',
    address: parseAddress(v.address),
    companyNumber: typeof v.companyNumber === 'string' ? v.companyNumber : '',
    email: typeof v.email === 'string' ? v.email : '',
    mobile: typeof v.mobile === 'string' ? v.mobile : '',
    phone: typeof v.phone === 'string' ? v.phone : '',
    signatureDataUrl:
      v.signatureDataUrl === null || typeof v.signatureDataUrl === 'string'
        ? (v.signatureDataUrl as string | null)
        : null,
    logoDataUrl:
      v.logoDataUrl === null || typeof v.logoDataUrl === 'string' ? (v.logoDataUrl as string | null) : null,
  }
}

function emptyInstallerProfile(): InstallerProfile {
  return { ...defaultProfile, address: { ...defaultProfile.address } }
}

function normalizeProfile(profile: InstallerProfile): InstallerProfile {
  return {
    ...profile,
    address: {
      ...defaultProfile.address,
      ...profile.address,
      country: profile.address.country?.trim() || 'BE',
    },
  }
}

export function parseInstallerProfileLocalRecord(raw: unknown): InstallerProfileLocalRecord | null {
  if (!raw || typeof raw !== 'object') return null

  const value = raw as Record<string, unknown>
  if ('profile' in value && value.profile && typeof value.profile === 'object') {
    return {
      ownerUserId: typeof value.ownerUserId === 'string' ? value.ownerUserId : null,
      profile: parseLegacyProfileValue(value.profile as Record<string, unknown>),
    }
  }

  return {
    ownerUserId: null,
    profile: parseLegacyProfileValue(value),
  }
}

export function isLocalInstallerProfileOwnedByUser(
  record: InstallerProfileLocalRecord,
  userId: string,
): boolean {
  return record.ownerUserId === userId
}

export async function readLocalInstallerProfileRecord(
  scopedUserId: string | null | undefined,
): Promise<InstallerProfileLocalRecord | null> {
  const key = installerProfileStorageKey(scopedUserId)
  const row = await db.settings.get(key)
  if (!row) return null
  return parseInstallerProfileLocalRecord(row.value)
}

export async function getLocalInstallerProfile(
  scopedUserId: string | null | undefined,
): Promise<InstallerProfile> {
  const record = await readLocalInstallerProfileRecord(scopedUserId)
  if (!record) return emptyInstallerProfile()

  if (scopedUserId && record.ownerUserId != null && record.ownerUserId !== scopedUserId) {
    return emptyInstallerProfile()
  }

  return record.profile
}

export async function setLocalInstallerProfile(
  profile: InstallerProfile,
  scopedUserId: string | null | undefined,
): Promise<void> {
  await db.settings.put({
    key: installerProfileStorageKey(scopedUserId),
    value: toInstallerProfileLocalRecord(profile, scopedUserId),
  })
}

export function toInstallerProfileLocalRecord(
  profile: InstallerProfile,
  scopedUserId: string | null | undefined,
): InstallerProfileLocalRecord {
  const normalized = normalizeProfile(profile)
  return {
    ownerUserId: scopedUserId ?? null,
    profile: {
      name: normalized.name,
      address: normalized.address,
      companyNumber: normalized.companyNumber,
      email: normalized.email,
      mobile: normalized.mobile,
      phone: normalized.phone,
      signatureDataUrl: normalized.signatureDataUrl,
      logoDataUrl: normalized.logoDataUrl,
    },
  }
}
