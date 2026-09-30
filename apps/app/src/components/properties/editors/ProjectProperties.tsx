import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Eye, EyeOff, MapPin } from 'lucide-react'
import { DebouncedTextInput, DebouncedTextarea } from '@/components/forms'
import { getProjectElectricalInstallation } from '@/lib/projectV2/electrical'
import {
  isGeoapifyConfigured,
  searchGeoapifyAddresses,
  type GeoapifyAddressSuggestion,
} from '@/lib/geocoding/geoapify'
import {
  inspectionAgencyContactFromEntry,
  type InspectionAgencyCatalogEntry,
} from '@/lib/inspectionAgencyCatalog'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import type { CableSpec, Installation } from '@/types/schema'
import {
  PROJECT_DEFAULT_CABLE_KINDS,
  resolveProjectDefaultCableKind,
} from '@/lib/wires/circuitWireDefaults'
import {
  applyNominalVoltageSystem,
  hidesLineToNeutralField,
  normalizeNominalVoltageSystem,
} from '@/constants/nominalVoltage'
import { InspectionAgencyPicker } from '../InspectionAgencyPicker'
import { NominalVoltageSystemPicker } from '../NominalVoltageSystemPicker'
import { useEditionFeatureAvailability } from '@/hooks/useEditionFeatureAvailability'
import { resolveInstallationProfile } from '@/lib/installationProfile'


const ADDRESS_AUTOCOMPLETE_DEBOUNCE_MS = 650

type Project = NonNullable<ProjectState['currentProject']>
type ProjectWithOptionalSite = Project & {
  site?: {
    address?: Installation['address']
    geocoding?: GeoapifyAddressSuggestion['geocoding']
    location?: GeoapifyAddressSuggestion['location']
  }
}
function InstallationStreetAutocomplete({
  disabled,
  value,
  onStreetCommit,
  onSelect,
}: {
  disabled?: boolean
  value: string
  onStreetCommit: (street: string) => void
  onSelect: (suggestion: GeoapifyAddressSuggestion) => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState(value)
  const [suggestions, setSuggestions] = useState<GeoapifyAddressSuggestion[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedQuery, setSelectedQuery] = useState<string | null>(null)
  const lastCommittedStreet = useRef(value)
  const configured = isGeoapifyConfigured()

  const commitStreet = useCallback(() => {
    if (query !== lastCommittedStreet.current) {
      lastCommittedStreet.current = query
      onStreetCommit(query)
    }
  }, [onStreetCommit, query])

  useEffect(() => {
    setQuery(value)
    lastCommittedStreet.current = value
    setSelectedQuery(value ? value.trim() : null)
  }, [value])

  useEffect(() => {
    const trimmed = query.trim()
    if (!configured || disabled || trimmed.length < 3 || trimmed === selectedQuery) {
      setSuggestions([])
      setIsLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      setIsLoading(true)
      setError(null)
      void searchGeoapifyAddresses(trimmed, {
        signal: controller.signal,
        countryCode: 'be',
        limit: 3,
      })
        .then((next) => {
          setSuggestions(next)
          setIsLoading(false)
        })
        .catch((err) => {
          if (controller.signal.aborted) return
          setSuggestions([])
          setIsLoading(false)
          setError(err instanceof Error ? err.message : 'Address lookup failed')
        })
    }, ADDRESS_AUTOCOMPLETE_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [configured, disabled, query, selectedQuery])

  return (
    <div className="relative">
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
        {t('installation.street', 'Street')}
      </label>
      <input
        type="text"
        value={query}
        disabled={disabled}
        onChange={(event) => {
          setSelectedQuery(null)
          setQuery(event.target.value)
        }}
        onBlur={commitStreet}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commitStreet()
            setSuggestions([])
          }
        }}
        placeholder={t('installation.streetPlaceholder', 'Street and number')}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500 disabled:opacity-60"
      />
      {configured && (suggestions.length > 0 || isLoading || error) && (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {isLoading && (
            <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
              {t('common.loading', 'Loading...')}
            </div>
          )}
          {error && !isLoading && (
            <div className="px-3 py-2 text-xs text-red-600 dark:text-red-300">{error}</div>
          )}
          {!isLoading &&
            suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-gray-800 hover:bg-sky-50 dark:text-gray-100 dark:hover:bg-gray-700"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelect(suggestion)
                  setQuery(suggestion.address.street)
                  setSelectedQuery(suggestion.address.street.trim())
                  lastCommittedStreet.current = suggestion.address.street
                  setSuggestions([])
                }}
              >
                {suggestion.formatted}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}

// Project Properties Component (when nothing is selected)
export function ProjectProperties({
  project,
  updateProject: applyProjectUpdate,
  updateInstallation: applyInstallationUpdate,
  readOnly = false,
  isTemplate = false,
}: {
  project: Project | null
  updateProject: (updates: Partial<Project['project']>) => void
  updateInstallation: (updates: Partial<Installation>) => void
  readOnly?: boolean
  isTemplate?: boolean
}) {
  const { t } = useTranslation()
  const {
    inspectionAgencyCatalog: showInspectionAgencyCatalog,
    installationProfileSelection: showInstallationProfile,
  } = useEditionFeatureAvailability(project?.project.id)
  const installation = project ? getProjectElectricalInstallation(project) : undefined
  const projectInfo = project?.project
  const siteLocation = (
    project as
      | (Project & {
          site?: { location?: { latitude?: number; longitude?: number } }
        })
      | null
  )?.site?.location
  const customer = projectInfo?.customer
  const inspectionAgency = projectInfo?.inspectionAgency
  const updateProject = useCallback(
    (updates: Partial<Project['project']>) => {
      if (!readOnly) applyProjectUpdate(updates)
    },
    [applyProjectUpdate, readOnly]
  )
  const updateInstallation = useCallback(
    (updates: Partial<Installation>) => {
      if (!readOnly) applyInstallationUpdate(updates)
    },
    [applyInstallationUpdate, readOnly]
  )
  const googleMapsUrl =
    typeof siteLocation?.latitude === 'number' && typeof siteLocation?.longitude === 'number'
      ? `https://www.google.com/maps/search/?api=1&query=${siteLocation.latitude},${siteLocation.longitude}`
      : undefined
  const hasCustomerData = Boolean(
    projectInfo?.name ||
    projectInfo?.yearOfConstruction ||
    installation?.address.street ||
    installation?.address.postalCode ||
    installation?.address.city ||
    customer?.companyNumber ||
    customer?.email ||
    customer?.mobile ||
    customer?.phone
  )
  const hasInspectionAgencyData = Boolean(
    inspectionAgency?.name ||
    inspectionAgency?.companyNumber ||
    inspectionAgency?.email ||
    inspectionAgency?.mobile ||
    inspectionAgency?.phone ||
    inspectionAgency?.address?.street ||
    inspectionAgency?.address?.number ||
    inspectionAgency?.address?.postalCode ||
    inspectionAgency?.address?.city ||
    inspectionAgency?.address?.country
  )
  const hasInstallationData = Boolean(
    installation?.nominalVoltage.system ||
    installation?.nominalVoltage.uLineToNeutral ||
    installation?.nominalVoltage.uLineToLine ||
    projectInfo?.meterEanCode
  )
  const [customerExpanded, setCustomerExpanded] = useState(hasCustomerData)
  const [installationExpanded, setInstallationExpanded] = useState(hasInstallationData)
  const [inspectionExpanded, setInspectionExpanded] = useState(hasInspectionAgencyData)
  const [inspectionAgencyPickerOpen, setInspectionAgencyPickerOpen] = useState(false)
  
  const applyInspectionAgencyEntry = useCallback(
    (entry: InspectionAgencyCatalogEntry) => {
      updateProject({ inspectionAgency: inspectionAgencyContactFromEntry(entry) })
      setInspectionExpanded(true)
    },
    [updateProject]
  )

  useEffect(() => {
    if (hasCustomerData) setCustomerExpanded(true)
    if (hasInstallationData) setInstallationExpanded(true)
    if (hasInspectionAgencyData) setInspectionExpanded(true)
  }, [hasCustomerData, hasInstallationData, hasInspectionAgencyData])

  

  if (!project || !installation) {
    return (
      <div className="p-4 text-center text-gray-500">
        {t('project.notFound', 'No project loaded')}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Customer metadata (project core) */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-md">
        <button
          type="button"
          data-readonly-allow="true"
          onClick={() => setCustomerExpanded((open) => !open)}
          className="w-full px-3 py-2 flex items-center justify-between text-left"
        >
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {isTemplate ? t('project.template', 'Template') : t('project.customer', 'Customer')}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-gray-500 transition-transform ${customerExpanded ? 'rotate-180' : ''}`}
          />
        </button>
        {customerExpanded && (
          <div className="px-3 pb-3 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {t('project.name', 'Project Name')}
              </label>
              <DebouncedTextInput
                type="text"
                value={project.project.name ?? ''}
                onCommit={(v) =>
                  updateProject({
                    name: v,
                    customer: {
                      name: v,
                      companyNumber: customer?.companyNumber,
                      email: customer?.email,
                      mobile: customer?.mobile,
                      phone: customer?.phone,
                      meterEanCode: customer?.meterEanCode,
                      address: customer?.address,
                      siteAddress: customer?.siteAddress,
                    },
                  })
                }
                delayMs={500}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
              />
            </div>
            {}
            {!isTemplate && (
              <>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {t('project.yearOfConstruction', 'Year of construction')}
              </label>
              <input
                type="number"
                min={1500}
                max={2100}
                value={project.project.yearOfConstruction ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '') {
                    updateProject({ yearOfConstruction: undefined })
                    return
                  }
                  const n = parseInt(v, 10)
                  updateProject({ yearOfConstruction: Number.isNaN(n) ? undefined : n })
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                placeholder="e.g. 1995"
              />
            </div>
            <div>
              <div className="mb-1.5 flex min-h-4 items-center justify-between gap-2">
                <h4 className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  {t('installation.address', 'Address')}
                </h4>
                {googleMapsUrl && (
                  <button
                    type="button"
                    className="flex h-5 w-5 items-center justify-center rounded border border-gray-300 bg-white text-gray-600 hover:border-sky-300 hover:text-sky-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:text-sky-300"
                    title={t('installation.openInGoogleMaps', 'Open in Google Maps')}
                    aria-label={t('installation.openInGoogleMaps', 'Open in Google Maps')}
                    onClick={() => window.open(googleMapsUrl, '_blank', 'noopener,noreferrer')}
                  >
                    <MapPin className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="space-y-3">
                <InstallationStreetAutocomplete
                  disabled={readOnly}
                  value={installation.address.street}
                  onStreetCommit={(street) => {
                    updateInstallation({
                      address: { ...installation.address, street },
                    })
                    useProjectStore.setState((state: ProjectState) => {
                      const current = state.currentProject as ProjectWithOptionalSite | null
                      if (!current?.site) return
                      delete current.site.location
                      delete current.site.geocoding
                      state.isDirty = true
                    })
                  }}
                  onSelect={(suggestion) => {
                    updateInstallation({
                      address: suggestion.address,
                    })
                    useProjectStore.setState((state: ProjectState) => {
                      const current = state.currentProject as ProjectWithOptionalSite | null
                      if (!current) return
                      current.site = {
                        ...(current.site ?? {}),
                        address: suggestion.address,
                        geocoding: suggestion.geocoding,
                        location: suggestion.location,
                      }
                      state.isDirty = true
                    })
                  }}
                />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      {t('installation.postalCode', 'Postal Code')}
                    </label>
                    <DebouncedTextInput
                      type="text"
                      value={installation.address.postalCode}
                      onCommit={(v) =>
                        updateInstallation({
                          address: { ...installation.address, postalCode: v },
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      {t('installation.city', 'City')}
                    </label>
                    <DebouncedTextInput
                      type="text"
                      value={installation.address.city}
                      onCommit={(v) =>
                        updateInstallation({
                          address: { ...installation.address, city: v },
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    {t('installation.country', 'Country')}
                  </label>
                  <select
                    value={installation.address.country}
                    disabled={readOnly}
                    onChange={(e) => updateInstallation({ address: { ...installation.address, country: e.target.value } })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="BE">{t('installation.countryBelgium', 'Belgium')}</option>
                    <option value="FR">{t('installation.countryFrance', 'France')}</option>
                    <option value="NL">{t('installation.countryNetherlands', 'Netherlands')}</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <label
                htmlFor="customer-company-number"
                className="block text-xs font-medium text-gray-600 dark:text-gray-400"
              >
                {t('project.companyNumber', 'Company number')}
              </label>
              <label
                htmlFor="customer-email"
                className="block text-xs font-medium text-gray-600 dark:text-gray-400"
              >
                {t('project.customerEmail', 'Email')}
              </label>
              <DebouncedTextInput
                id="customer-company-number"
                type="text"
                value={customer?.companyNumber ?? ''}
                onCommit={(v) =>
                  updateProject({
                    customer: {
                      name: project.project.name ?? '',
                      companyNumber: v.trim() === '' ? undefined : v,
                      email: customer?.email,
                      mobile: customer?.mobile,
                      phone: customer?.phone,
                      meterEanCode: customer?.meterEanCode,
                      address: customer?.address,
                      siteAddress: customer?.siteAddress,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
              />
              <DebouncedTextInput
                id="customer-email"
                type="email"
                value={customer?.email ?? ''}
                onCommit={(v) =>
                  updateProject({
                    customer: {
                      name: project.project.name ?? '',
                      companyNumber: customer?.companyNumber,
                      email: v.trim() === '' ? undefined : v,
                      mobile: customer?.mobile,
                      phone: customer?.phone,
                      meterEanCode: customer?.meterEanCode,
                      address: customer?.address,
                      siteAddress: customer?.siteAddress,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {t('project.customerMobile', 'Mobile')}
                </label>
                <DebouncedTextInput
                  type="text"
                  value={customer?.mobile ?? ''}
                  onCommit={(v) =>
                    updateProject({
                      customer: {
                        name: project.project.name ?? '',
                        companyNumber: customer?.companyNumber,
                        email: customer?.email,
                        mobile: v.trim() === '' ? undefined : v,
                        phone: customer?.phone,
                        meterEanCode: customer?.meterEanCode,
                        address: customer?.address,
                        siteAddress: customer?.siteAddress,
                      },
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {t('project.customerPhone', 'Phone')}
                </label>
                <DebouncedTextInput
                  type="text"
                  value={customer?.phone ?? ''}
                  onCommit={(v) =>
                    updateProject({
                      customer: {
                        name: project.project.name ?? '',
                        companyNumber: customer?.companyNumber,
                        email: customer?.email,
                        mobile: customer?.mobile,
                        phone: v.trim() === '' ? undefined : v,
                        meterEanCode: customer?.meterEanCode,
                        address: customer?.address,
                        siteAddress: customer?.siteAddress,
                      },
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                />
              </div>
            </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Installation metadata */}
      <div className="border border-gray-200 dark:border-gray-700 rounded-md">
        <button
          type="button"
          data-readonly-allow="true"
          onClick={() => setInstallationExpanded((open) => !open)}
          className="w-full px-3 py-2 flex items-center justify-between text-left"
        >
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('installation.title', 'Installation')}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-gray-500 transition-transform ${installationExpanded ? 'rotate-180' : ''}`}
          />
        </button>
        {installationExpanded && (
          <div className="px-3 pb-3 space-y-4">
            {showInstallationProfile && (
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {t('installation.profile', 'Profile')}
                </label>
                <select
                  value={resolveInstallationProfile(installation)}
                  disabled={readOnly}
                  onChange={(event) =>
                    updateInstallation({
                      installationProfile: event.target
                        .value as Installation['installationProfile'],
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500 disabled:opacity-60"
                >
                  <option value="household">
                    {t('installation.profileHousehold', 'Domestic')}
                  </option>
                  <option value="non_household">
                    {t('installation.profileNonHousehold', 'Non-domestic')}
                  </option>
                </select>
              </div>
            )}
            <div>
              <h4 className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                {t('installation.voltage', 'Nominal Voltage')}
              </h4>
              <div className="space-y-3">
                <div>
                  <NominalVoltageSystemPicker
                    value={installation.nominalVoltage.system}
                    readOnly={readOnly}
                    onChange={(system) =>
                      updateInstallation({
                        nominalVoltage: applyNominalVoltageSystem(
                          installation.nominalVoltage,
                          system
                        ),
                      })
                    }
                  />
                </div>
                <div
                  className={`grid gap-3 ${hidesLineToNeutralField(normalizeNominalVoltageSystem(installation.nominalVoltage.system)) ? 'grid-cols-1' : 'grid-cols-2'}`}
                >
                  {!hidesLineToNeutralField(
                    normalizeNominalVoltageSystem(installation.nominalVoltage.system)
                  ) && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                        {t('installation.lineToNeutral', 'Line-to-Neutral (V)')}
                      </label>
                      <input
                        type="number"
                        value={installation.nominalVoltage.uLineToNeutral}
                        disabled
                        min="0"
                        step="1"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400 cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      {t('installation.lineToLine', 'Line-to-Line (V)')}
                    </label>
                    <input
                      type="number"
                      value={installation.nominalVoltage.uLineToLine}
                      disabled
                      min="0"
                      step="1"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400 cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div>
              <label
                htmlFor="project-default-cable"
                className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
              >
                {t('installation.defaultCable', 'Default cable')}
              </label>
              <select
                id="project-default-cable"
                value={resolveProjectDefaultCableKind(installation)}
                disabled={readOnly}
                onChange={(event) =>
                  updateInstallation({
                    defaultCableKind: event.target.value as CableSpec['kind'],
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500 disabled:opacity-60"
              >
                {PROJECT_DEFAULT_CABLE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </div>
            {!isTemplate && (
              <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {t('project.meterEanCode', 'Meter EAN code')}
              </label>
              <DebouncedTextInput
                type="text"
                value={project.project.meterEanCode ?? ''}
                onCommit={(v) =>
                  updateProject({
                    meterEanCode: v.trim() === '' ? undefined : v,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                placeholder={t('project.meterEanCodePlaceholder', 'e.g. 5412345678901234')}
              />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Inspection agency metadata (collapsed by default when empty) */}
      {!isTemplate && (
      <div className="border border-gray-200 dark:border-gray-700 rounded-md">
        <button
          type="button"
          data-readonly-allow="true"
          onClick={() => setInspectionExpanded((open) => !open)}
          className="w-full px-3 py-2 flex items-center justify-between text-left"
        >
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('project.inspectionAgency', 'Inspection agency')}
          </span>
          <ChevronDown
            className={`h-4 w-4 text-gray-500 transition-transform ${inspectionExpanded ? 'rotate-180' : ''}`}
          />
        </button>
        {inspectionExpanded && (
          <div className="px-3 pb-3 space-y-3">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() =>
                  updateProject({
                    showInspectionAgencyInInfoBlock:
                      projectInfo?.showInspectionAgencyInInfoBlock !== true,
                  })
                }
                disabled={readOnly}
                aria-pressed={projectInfo?.showInspectionAgencyInInfoBlock === true}
                aria-label={
                  projectInfo?.showInspectionAgencyInInfoBlock === true
                    ? t('project.hideInspectionAgencyInInfoBlock', 'Hide in drawing info blocks')
                    : t('project.showInspectionAgencyInInfoBlock', 'Show in drawing info blocks')
                }
                title={
                  projectInfo?.showInspectionAgencyInInfoBlock === true
                    ? t('project.hideInspectionAgencyInInfoBlock', 'Hide in drawing info blocks')
                    : t('project.showInspectionAgencyInInfoBlock', 'Show in drawing info blocks')
                }
                className={`rounded-md border p-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${
                  projectInfo?.showInspectionAgencyInInfoBlock === true
                    ? 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200'
                    : 'border-gray-300 text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800'
                }`}
              >
                {projectInfo?.showInspectionAgencyInInfoBlock === true ? (
                  <Eye className="h-4 w-4" />
                ) : (
                  <EyeOff className="h-4 w-4" />
                )}
              </button>
              {showInspectionAgencyCatalog ? (
                <button
                  type="button"
                  onClick={() => setInspectionAgencyPickerOpen(true)}
                  disabled={readOnly}
                  className="rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200 dark:hover:bg-sky-900/60 dark:disabled:border-gray-700 dark:disabled:bg-gray-800 dark:disabled:text-gray-500"
                >
                  {t('inspectionAgencies.fillButton', 'Fill from approved list')}
                </button>
              ) : null}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {t('project.inspectionAgencyName', 'Agency name')}
              </label>
              <DebouncedTextInput
                type="text"
                value={inspectionAgency?.name ?? ''}
                onCommit={(v) =>
                  updateProject({
                    inspectionAgency: {
                      name: v,
                      companyNumber: inspectionAgency?.companyNumber,
                      email: inspectionAgency?.email,
                      mobile: inspectionAgency?.mobile,
                      phone: inspectionAgency?.phone,
                      address: inspectionAgency?.address,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
              />
            </div>
            <div>
              <h4 className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                {t('installation.address', 'Address')}
              </h4>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    {t('installation.street', 'Street')}
                  </label>
                  <DebouncedTextInput
                    type="text"
                    value={inspectionAgency?.address?.street ?? ''}
                    onCommit={(v) =>
                      updateProject({
                        inspectionAgency: {
                          name: inspectionAgency?.name ?? '',
                          companyNumber: inspectionAgency?.companyNumber,
                          email: inspectionAgency?.email,
                          mobile: inspectionAgency?.mobile,
                          phone: inspectionAgency?.phone,
                          address: {
                            street: v,
                            number: inspectionAgency?.address?.number,
                            postalCode: inspectionAgency?.address?.postalCode ?? '',
                            city: inspectionAgency?.address?.city ?? '',
                            country: inspectionAgency?.address?.country ?? '',
                          },
                        },
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      {t('installation.postalCode', 'Postal Code')}
                    </label>
                    <DebouncedTextInput
                      type="text"
                      value={inspectionAgency?.address?.postalCode ?? ''}
                      onCommit={(v) =>
                        updateProject({
                          inspectionAgency: {
                            name: inspectionAgency?.name ?? '',
                            companyNumber: inspectionAgency?.companyNumber,
                            email: inspectionAgency?.email,
                            mobile: inspectionAgency?.mobile,
                            phone: inspectionAgency?.phone,
                            address: {
                              street: inspectionAgency?.address?.street ?? '',
                              number: inspectionAgency?.address?.number,
                              postalCode: v,
                              city: inspectionAgency?.address?.city ?? '',
                              country: inspectionAgency?.address?.country ?? '',
                            },
                          },
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      {t('installation.city', 'City')}
                    </label>
                    <DebouncedTextInput
                      type="text"
                      value={inspectionAgency?.address?.city ?? ''}
                      onCommit={(v) =>
                        updateProject({
                          inspectionAgency: {
                            name: inspectionAgency?.name ?? '',
                            companyNumber: inspectionAgency?.companyNumber,
                            email: inspectionAgency?.email,
                            mobile: inspectionAgency?.mobile,
                            phone: inspectionAgency?.phone,
                            address: {
                              street: inspectionAgency?.address?.street ?? '',
                              number: inspectionAgency?.address?.number,
                              postalCode: inspectionAgency?.address?.postalCode ?? '',
                              city: v,
                              country: inspectionAgency?.address?.country ?? '',
                            },
                          },
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                    {t('installation.country', 'Country')}
                  </label>
                  <DebouncedTextInput
                    type="text"
                    value={inspectionAgency?.address?.country ?? ''}
                    onCommit={(v) =>
                      updateProject({
                        inspectionAgency: {
                          name: inspectionAgency?.name ?? '',
                          companyNumber: inspectionAgency?.companyNumber,
                          email: inspectionAgency?.email,
                          mobile: inspectionAgency?.mobile,
                          phone: inspectionAgency?.phone,
                          address: {
                            street: inspectionAgency?.address?.street ?? '',
                            number: inspectionAgency?.address?.number,
                            postalCode: inspectionAgency?.address?.postalCode ?? '',
                            city: inspectionAgency?.address?.city ?? '',
                            country: v,
                          },
                        },
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <label
                htmlFor="inspection-agency-company-number"
                className="block text-xs font-medium text-gray-600 dark:text-gray-400"
              >
                {t('project.companyNumber', 'Company number')}
              </label>
              <label
                htmlFor="inspection-agency-email"
                className="block text-xs font-medium text-gray-600 dark:text-gray-400"
              >
                {t('project.customerEmail', 'Email')}
              </label>
              <DebouncedTextInput
                id="inspection-agency-company-number"
                type="text"
                value={inspectionAgency?.companyNumber ?? ''}
                onCommit={(v) =>
                  updateProject({
                    inspectionAgency: {
                      name: inspectionAgency?.name ?? '',
                      companyNumber: v.trim() === '' ? undefined : v,
                      email: inspectionAgency?.email,
                      mobile: inspectionAgency?.mobile,
                      phone: inspectionAgency?.phone,
                      address: inspectionAgency?.address,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
              />
              <DebouncedTextInput
                id="inspection-agency-email"
                type="email"
                value={inspectionAgency?.email ?? ''}
                onCommit={(v) =>
                  updateProject({
                    inspectionAgency: {
                      name: inspectionAgency?.name ?? '',
                      companyNumber: inspectionAgency?.companyNumber,
                      email: v.trim() === '' ? undefined : v,
                      mobile: inspectionAgency?.mobile,
                      phone: inspectionAgency?.phone,
                      address: inspectionAgency?.address,
                    },
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {t('project.customerMobile', 'Mobile')}
                </label>
                <DebouncedTextInput
                  type="text"
                  value={inspectionAgency?.mobile ?? ''}
                  onCommit={(v) =>
                    updateProject({
                      inspectionAgency: {
                        name: inspectionAgency?.name ?? '',
                        companyNumber: inspectionAgency?.companyNumber,
                        email: inspectionAgency?.email,
                        mobile: v.trim() === '' ? undefined : v,
                        phone: inspectionAgency?.phone,
                        address: inspectionAgency?.address,
                      },
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {t('project.customerPhone', 'Phone')}
                </label>
                <DebouncedTextInput
                  type="text"
                  value={inspectionAgency?.phone ?? ''}
                  onCommit={(v) =>
                    updateProject({
                      inspectionAgency: {
                        name: inspectionAgency?.name ?? '',
                        companyNumber: inspectionAgency?.companyNumber,
                        email: inspectionAgency?.email,
                        mobile: inspectionAgency?.mobile,
                        phone: v.trim() === '' ? undefined : v,
                        address: inspectionAgency?.address,
                      },
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                />
              </div>
            </div>
            {showInspectionAgencyCatalog ? (
              <InspectionAgencyPicker
                open={inspectionAgencyPickerOpen}
                onClose={() => setInspectionAgencyPickerOpen(false)}
                onFill={applyInspectionAgencyEntry}
              />
            ) : null}
          </div>
        )}
      </div>
      )}

      {/* Notes */}
      {!isTemplate && (
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('installation.notes', 'Notes')}
        </label>
        <DebouncedTextarea
          value={installation.notes || ''}
          onCommit={(v) => updateInstallation({ notes: v })}
          delayMs={500}
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500 resize-none"
          placeholder={t('installation.notes', 'Notes')}
        />
      </div>
      )}
    </div>
  )
}
