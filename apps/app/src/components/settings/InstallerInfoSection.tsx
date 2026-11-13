import { useTranslation } from 'react-i18next'
import { SignaturePreview } from './SignaturePreview'
import { useEffect, useState, useRef } from 'react'
import { EMPTY_INSTALLER_PROFILE } from '@/editions/community/communityInstallerProfileModel'
import {
  getInstallerProfile,
  setInstallerProfile,
  type InstallerProfile,
} from '@/lib/installerProfile'

import { useInstallerProfileStore } from '@/stores/installerProfileStore'
import { resizeImageDataUrl } from '@/lib/resizeImageDataUrl'

const AUTOSAVE_DEBOUNCE_MS = 400

export function InstallerInfoSection() {
  const { t } = useTranslation()
  let lockedEmail = ''
  
  const [name, setName] = useState('')
  const [companyNumber, setCompanyNumber] = useState('')
  const [phone, setPhone] = useState('')
  const [mobile, setMobile] = useState('')
  const [street, setStreet] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [city, setCity] = useState('')
  const [country, setCountry] = useState(EMPTY_INSTALLER_PROFILE.address.country)
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null)
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null)
  const initialLoadDone = useRef(false)
  const signatureInputRef = useRef<HTMLInputElement>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)

  const setProfileInStore = useInstallerProfileStore((s) => s.setProfile)
  let cloudProfileActive = false
  

  useEffect(() => {
    let cancelled = false
    void getInstallerProfile().then((profile) => {
      if (!cancelled) {
        setName(profile.name)
        setCompanyNumber(profile.companyNumber)
        setPhone(profile.phone)
        setMobile(profile.mobile)
        setStreet(profile.address.street)
        setPostalCode(profile.address.postalCode)
        setCity(profile.address.city)
        setCountry(profile.address.country)
        setSignatureDataUrl(profile.signatureDataUrl)
        setLogoDataUrl(profile.logoDataUrl)
        setTimeout(() => {
          initialLoadDone.current = true
        }, 0)
      }
    })
    return () => {
      cancelled = true
    }
  }, [lockedEmail])

  useEffect(() => {
    if (!initialLoadDone.current) return
    const timer = setTimeout(async () => {
      const profile: InstallerProfile = {
        name,
        companyNumber,
        email: lockedEmail,
        phone,
        mobile,
        address: {
          street,
          postalCode,
          city,
          country: country.trim() || EMPTY_INSTALLER_PROFILE.address.country,
        },
        signatureDataUrl,
        logoDataUrl,
      }
      await setInstallerProfile(profile)
      setProfileInStore(profile)
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [
    lockedEmail,
    name,
    companyNumber,
    phone,
    mobile,
    street,
    postalCode,
    city,
    country,
    signatureDataUrl,
    logoDataUrl,
    setProfileInStore,
  ])

  const handleImageUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    setDataUrl: (url: string | null) => void
  ) => {
    const file = e.target.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = reader.result
      if (typeof dataUrl !== 'string') return
      try {
        const resized = await resizeImageDataUrl(dataUrl)
        setDataUrl(resized)
      } catch {
        setDataUrl(dataUrl)
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const clearSignature = () => setSignatureDataUrl(null)
  const clearLogo = () => setLogoDataUrl(null)

  return (
    <div className="space-y-4 border-t border-gray-200 dark:border-gray-600 pt-4 mt-4">
      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
        {t('settings.installerInfo.title')}
      </h3>
      {}

      <div>
        <label
          htmlFor="installer-name"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {t('settings.installerInfo.name')}
        </label>
        <input
          id="installer-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          placeholder={t('settings.installerInfo.namePlaceholder')}
        />
      </div>

      <div>
        <label
          htmlFor="installer-company-number"
          className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
        >
          {cloudProfileActive
            ? t('settings.installerInfo.vatNumber')
            : t('settings.installerInfo.companyNumber')}
        </label>
        <input
          id="installer-company-number"
          type="text"
          value={companyNumber}
          onChange={(e) => setCompanyNumber(e.target.value)}
          readOnly={cloudProfileActive}
          aria-readonly={cloudProfileActive || undefined}
          title={cloudProfileActive ? t('settings.installerInfo.vatNumberAccountHint') : undefined}
          className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="installer-phone"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            {t('settings.installerInfo.phone')}
          </label>
          <input
            id="installer-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
        <div>
          <label
            htmlFor="installer-mobile"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            {t('settings.installerInfo.mobile')}
          </label>
          <input
            id="installer-mobile"
            type="tel"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
      </div>

      <div>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {t('settings.installerInfo.address')}
        </h4>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {t('installation.street', 'Street')}
            </label>
            <input
              type="text"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {t('installation.postalCode', 'Postal Code')}
              </label>
              <input
                type="text"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {t('installation.city', 'City')}
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {t('installation.country', 'Country')}
            </label>
            <input
              type="text"
              autoComplete="country-name"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('settings.installerInfo.signature')}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={signatureInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => handleImageUpload(e, setSignatureDataUrl)}
            className="hidden"
            aria-hidden
          />
          <button
            type="button"
            onClick={() => signatureInputRef.current?.click()}
            className="px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {t('settings.installerInfo.uploadSignature')}
          </button>
          {signatureDataUrl && (
            <>
              <div className="inline-flex items-center gap-2 border border-gray-200 dark:border-gray-600 rounded-md p-1 bg-gray-50 dark:bg-gray-800">
                <SignaturePreview
                  source={signatureDataUrl}
                  className="h-10 max-w-[120px] object-contain"
                />
              </div>
              <button
                type="button"
                onClick={clearSignature}
                className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600"
              >
                {t('settings.installerInfo.clearSignature')}
              </button>
            </>
          )}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('settings.installerInfo.logo')}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={logoInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => handleImageUpload(e, setLogoDataUrl)}
            className="hidden"
            aria-hidden
          />
          <button
            type="button"
            onClick={() => logoInputRef.current?.click()}
            className="px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {t('settings.installerInfo.uploadLogo')}
          </button>
          {logoDataUrl && (
            <>
              <div className="inline-flex items-center gap-2 border border-gray-200 dark:border-gray-600 rounded-md p-1 bg-gray-50 dark:bg-gray-800">
                <img
                  src={logoDataUrl}
                  alt=""
                  className="h-10 max-w-[120px] object-contain"
                  aria-hidden
                />
              </div>
              <button
                type="button"
                onClick={clearLogo}
                className="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-600"
              >
                {t('settings.installerInfo.clearLogo')}
              </button>
            </>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {t('settings.installerInfo.logoOptional')}
        </p>
      </div>
    </div>
  )
}
