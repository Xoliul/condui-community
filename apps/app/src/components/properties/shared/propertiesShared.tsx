import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff } from 'lucide-react'
import { DebouncedTextInput } from '@/components/forms'
import CustomDropdown from '@/components/common/CustomDropdown'
import type { CableSpec, CircuitPhaseAssignment, Installation } from '@/types/schema'
import {
  applyCableKindChange,
  COMB_BUSBAR_SECTION_OPTIONS,
  getAcWireTypeOptions,
  getDcWireTypeOptions,
  getWireSectionOptions,
} from '@/lib/wires/cableWireTypes'
import { getWireConductorOptions, resolveConductorDropdownValue } from '@/lib/wireConductorOptions'
import {
  formatPhaseAssignment,
  getPhaseAssignmentForOptionValue,
  getPhaseAssignmentLabel,
  getPhaseAssignmentOptionValue,
  getPhaseAssignmentOptions,
  supportsExplicitPhaseSelection,
  type PhaseAssignmentConstraint,
} from '@/lib/wires/phaseAssignment'
import {
  getProjectDefaultInstallYear,
  getExplicitInstallYear,
  installationDateFromYear,
  normalizeInstallYear,
  type InstallDateEntity,
} from '@/lib/installDates'
import type { ProjectState } from '@/stores/projectStore'
import { clamp } from '@/lib/geometry'
import { labelClass, selectClass, visibilityToggleClass } from './propertiesSharedUtils'

type Project = NonNullable<ProjectState['currentProject']>

export function InstallDateField({
  entity,
  project,
  inheritedYear,
  onUpdate,
}: {
  entity: InstallDateEntity
  project: Project | null
  inheritedYear?: number
  onUpdate: (updates: {
    installationDate?: string
    installationDateSuppressed?: boolean
    rulesetDateOverride?: number
  }) => void
}) {
  const { t } = useTranslation()
  const placeholderYear = inheritedYear ?? getProjectDefaultInstallYear(project)
  const currentYear = new Date().getFullYear()
  const explicitYear = getExplicitInstallYear(entity)
  const [draftYear, setDraftYear] = useState(explicitYear?.toString() ?? '')
  useEffect(() => {
    setDraftYear(getExplicitInstallYear(entity)?.toString() ?? '')
  }, [entity])
  const commitDraft = () => {
    const raw = draftYear.trim()
    if (!raw) {
      onUpdate({
        installationDate: undefined,
        installationDateSuppressed: true,
        rulesetDateOverride: undefined,
      })
      return
    }
    const normalized = normalizeInstallYear(raw)
    if (normalized == null) {
      setDraftYear(getExplicitInstallYear(entity)?.toString() ?? '')
      return
    }
    const clamped = clamp(normalized, 1900, currentYear)
    setDraftYear(String(clamped))
    onUpdate({
      installationDate: installationDateFromYear(clamped),
      installationDateSuppressed: undefined,
      rulesetDateOverride: undefined,
    })
  }
  return (
    <div>
      <label className={labelClass}>{t('installDates.installDate', 'Install date')}</label>
      <input
        type="number"
        min={1900}
        max={currentYear}
        value={draftYear}
        placeholder={String(placeholderYear)}
        onChange={(e) => setDraftYear(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commitDraft()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setDraftYear(getExplicitInstallYear(entity)?.toString() ?? '')
            e.currentTarget.blur()
          }
        }}
        className={selectClass}
      />
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {t('installDates.installDateHint', 'Leave empty to use the project construction year.')}
      </p>
    </div>
  )
}

// Shared wire route + tube + cable form (single source for domotica and circuit wire props)
export type WireRouteFormState = {
  inTube?: boolean
  wireRoute?: 'wall' | 'ground' | 'air'
  inWall?: boolean
  hideWireLabel?: boolean
  showFireClassLabel?: boolean
  wireLengthM?: number
  showWireLengthLabel?: boolean
  defaultWireLabelVisible?: boolean
  phaseAssignment?: CircuitPhaseAssignment
  phaseConstraint?: PhaseAssignmentConstraint
  showPhaseLabel?: boolean
  cable: CableSpec
}

export function WireLengthField({
  wireLengthM,
  showWireLengthLabel,
  onChange,
  placeholder,
  hint,
  t,
}: {
  wireLengthM?: number
  showWireLengthLabel?: boolean
  onChange: (updates: { wireLengthM?: number; showWireLengthLabel?: boolean }) => void
  /** Replaces the default placeholder, e.g. with a plan-based estimate. */
  placeholder?: string
  /** Quiet status or action shown under the field. */
  hint?: ReactNode
  t: (key: string, defaultValue?: string) => string
}) {
  const hasLength = wireLengthM != null && wireLengthM > 0
  const isVisible = showWireLengthLabel === true && hasLength

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('wires.length', 'Length')}
        </label>
        <button
          type="button"
          disabled={!hasLength}
          onClick={() =>
            onChange({
              showWireLengthLabel: isVisible ? false : true,
            })
          }
          className={visibilityToggleClass(isVisible)}
          title={
            isVisible
              ? t('wires.hideWireLengthLabel', 'Hide wire length on one-wire')
              : t('wires.showWireLengthLabel', 'Show wire length on one-wire')
          }
          aria-label={
            isVisible
              ? t('wires.hideWireLengthLabel', 'Hide wire length on one-wire')
              : t('wires.showWireLengthLabel', 'Show wire length on one-wire')
          }
        >
          {isVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
        </button>
      </div>
      <DebouncedTextInput
        type="number"
        min="0"
        step="0.1"
        value={wireLengthM != null ? String(wireLengthM) : ''}
        onCommit={(value) => {
          const trimmed = value.trim()
          if (!trimmed) {
            onChange({ wireLengthM: undefined, showWireLengthLabel: false })
            return
          }
          const parsed = parseFloat(trimmed.replace(',', '.'))
          if (Number.isFinite(parsed) && parsed > 0) {
            onChange({ wireLengthM: parsed })
          }
        }}
        placeholder={placeholder ?? t('wires.lengthPlaceholder', 'Length in meters')}
        className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
      />
      {hint && <div className="mt-1">{hint}</div>}
    </div>
  )
}

export function WireRouteAndCableForm({
  showLength = true,
  groundConductor = false,
  busbar = false,
  onMediumChange,
  state,
  onChange,
  isDC,
  phaseSystem,
  showPhaseAssignment = false,
  phaseOnly = false,
  phaseLocked = false,
  cableHint,
  lengthPlaceholder,
  lengthHint,
  t,
}: {
  busbar?: boolean
  onMediumChange?: (medium: 'cable' | 'busbar', cable: CableSpec) => void
  groundConductor?: boolean
  showLength?: boolean
  state: WireRouteFormState
  onChange: (u: Partial<WireRouteFormState>) => void
  isDC: boolean
  phaseSystem?: Installation['nominalVoltage']['system']
  showPhaseAssignment?: boolean
  /** Connection stubs expose only their shared phase assignment/visibility. */
  phaseOnly?: boolean
  /** Render the effective phase without an editable choice. */
  phaseLocked?: boolean
  /** Quiet status or action shown directly under the cable fields. */
  cableHint?: ReactNode
  /** Length field placeholder and hint, e.g. a plan-based estimate with an accept action. */
  lengthPlaceholder?: string
  lengthHint?: ReactNode
  t: (key: string, defaultValue?: string) => string
}) {
  const phaseFeatureEnabled =
    showPhaseAssignment && !isDC && !!phaseSystem && supportsExplicitPhaseSelection(phaseSystem)
  const phaseOptions =
    phaseFeatureEnabled && phaseSystem
      ? getPhaseAssignmentOptions(phaseSystem, state.phaseConstraint)
      : []
  const phaseSelectionValue =
    phaseFeatureEnabled && phaseSystem
      ? getPhaseAssignmentOptionValue(state.phaseAssignment, phaseSystem, state.phaseConstraint)
      : ''
  const effectivePhaseAssignment = phaseFeatureEnabled
    ? phaseSelectionValue === 'inherit'
      ? state.phaseConstraint?.inheritedAssignment
      : (state.phaseAssignment ?? state.phaseConstraint?.inheritedAssignment)
    : undefined
  const effectivePhaseConstraint = phaseFeatureEnabled ? state.phaseConstraint : undefined
  const phaseLabelAvailable =
    !!phaseSystem &&
    !!effectivePhaseAssignment &&
    !!getPhaseAssignmentLabel(effectivePhaseAssignment, phaseSystem)
  const conductorOptions = busbar
    ? [...new Set([1, 2, 3, 4, state.cable.conductors])]
        .filter((count) => Number.isInteger(count) && count > 0)
        .sort((a, b) => a - b)
        .map((count) => ({ value: String(count), label: String(count), conductors: count, hasPE: false }))
    : groundConductor ? [{ value: '1G', label: 'PE', conductors: 1, hasPE: true }] : getWireConductorOptions(isDC)
  const selectedConductorValue = busbar
    ? String(state.cable.conductors)
    : resolveConductorDropdownValue(state.cable, isDC)

  const cableTypes = isDC
    ? getDcWireTypeOptions(t('wires.other', 'Other'), {
        batteryCable: t('wires.batteryCable', 'Battery cable'),
      })
    : getAcWireTypeOptions(t('wires.other', 'Other'))
  const wireTypes = onMediumChange
    ? [...cableTypes, { value: 'busbar', label: t('structure.busbar', 'Busbar') }]
    : busbar ? [{ value: 'busbar', label: t('structure.busbar', 'Busbar') }] : cableTypes
  const changeCableType = (value: string) => {
    if (value === 'busbar') {
      onMediumChange?.('busbar', { ...state.cable, kind: 'other', customKind: 'busbar' })
    } else {
      const cable = applyCableKindChange(state.cable, value as CableSpec['kind'])
      if (onMediumChange) onMediumChange('cable', cable)
      else onChange({ cable })
    }
  }
  const thicknessOptions = busbar
    ? [...new Set([...COMB_BUSBAR_SECTION_OPTIONS, state.cable.sectionMm2])].sort((a, b) => a - b)
    : getWireSectionOptions(isDC)
  const fireClassOptions: Array<NonNullable<CableSpec['fireClass']>> = [
    'Aca',
    'B1ca',
    'B2ca',
    'Cca',
    'Dca',
    'Eca',
    'Fca',
  ]

  const selectedRoute: 'none' | 'inWall' | 'onWall' | 'ground' | 'air' =
    state.wireRoute === 'ground'
      ? 'ground'
      : state.wireRoute === 'wall'
        ? state.inWall
          ? 'inWall'
          : 'onWall'
        : state.wireRoute === 'air'
          ? 'air'
          : 'none'

  const routeLabels: Record<'none' | 'inWall' | 'onWall' | 'ground' | 'air', string> = {
    none: t('wires.routeNone', 'None'),
    onWall: t('wires.onWall', 'On wall'),
    inWall: t('wires.inWall', 'In wall'),
    ground: t('wires.inGround', 'Ground'),
    air: t('wires.inAir', 'Air'),
  }

  const setRoute = (route: 'none' | 'inWall' | 'onWall' | 'ground' | 'air') => {
    if (route === 'none' || selectedRoute === route) {
      onChange({ wireRoute: undefined, inWall: false })
      return
    }
    if (route === 'onWall') onChange({ wireRoute: 'wall', inWall: false })
    else if (route === 'inWall') onChange({ wireRoute: 'wall', inWall: true })
    else if (route === 'ground') onChange({ wireRoute: 'ground', inWall: false })
    else onChange({ wireRoute: 'air', inWall: false })
  }

  const isWireLabelVisible =
    state.hideWireLabel === true
      ? false
      : state.hideWireLabel === false
        ? true
        : (state.defaultWireLabelVisible ?? true)

  const isFireClassLabelVisible =
    (isDC ? state.showFireClassLabel === true : state.showFireClassLabel !== false) &&
    !!state.cable.fireClass

  if (phaseOnly && phaseOptions.length === 0) return null

  if (busbar) return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2 text-xs font-medium text-gray-600 dark:text-gray-400">
        <div>{t('wires.type', 'Type')}</div>
        <div>{t('wires.conductors', 'Geleiders')}</div>
        <div>{t('wires.thickness', 'Dikte')}</div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <CustomDropdown
          value="busbar"
          onChange={changeCableType}
          options={wireTypes}
        />
        <CustomDropdown
          value={selectedConductorValue}
          onChange={(value) => onChange({ cable: {
            ...state.cable, kind: 'other', customKind: 'busbar',
            conductors: Number(value), hasPE: false,
          } })}
          options={conductorOptions.map(({ value, label }) => ({ value, label }))}
        />
        <CustomDropdown
          value={String(state.cable.sectionMm2)}
          onChange={(value) => onChange({ cable: {
            ...state.cable, kind: 'other', customKind: 'busbar',
            sectionMm2: Number(value), hasPE: false,
          } })}
          options={thicknessOptions.map((section) => ({ value: String(section), label: `${section} mm²` }))}
        />
      </div>
    </div>
  )

  return (
    <div className={phaseOnly ? 'space-y-4 [&>div:not(:first-child)]:hidden' : 'space-y-4'}>
      {phaseOptions.length > 0 && phaseSystem && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('wires.phase', 'Phase')}
            </label>
            <button
              type="button"
              disabled={!phaseLabelAvailable}
              onClick={() => onChange({ showPhaseLabel: !(state.showPhaseLabel === true) })}
              className={visibilityToggleClass(
                phaseLabelAvailable && state.showPhaseLabel === true
              )}
              title={
                state.showPhaseLabel === true
                  ? t('wires.hidePhaseLabel', 'Hide phase on one-wire')
                  : t('wires.showPhaseLabel', 'Show phase on one-wire')
              }
              aria-label={
                state.showPhaseLabel === true
                  ? t('wires.hidePhaseLabel', 'Hide phase on one-wire')
                  : t('wires.showPhaseLabel', 'Show phase on one-wire')
              }
            >
              {state.showPhaseLabel === true ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
          </div>
          {phaseLocked ? (
            <div className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
              {formatPhaseAssignment(effectivePhaseAssignment)}
            </div>
          ) : (
            <CustomDropdown
              value={phaseSelectionValue}
              onChange={(nextValue) => {
                onChange({
                  phaseAssignment: getPhaseAssignmentForOptionValue(
                    nextValue,
                    phaseSystem,
                    effectivePhaseConstraint
                  ),
                })
              }}
              options={phaseOptions.map((option) => ({
                value: option.value,
                label:
                  option.assignment == null
                    ? state.phaseConstraint?.inheritedAssignment
                      ? `${t(
                          state.phaseConstraint.inheritedAssignment.source === 'derived_from_busbar'
                            ? 'wires.phaseAutomatic'
                            : 'wires.phaseInherited',
                          state.phaseConstraint.inheritedAssignment.source === 'derived_from_busbar'
                            ? 'Automatic'
                            : 'Inherited'
                        )} ${formatPhaseAssignment(state.phaseConstraint.inheritedAssignment)}`
                      : t('wires.phaseAll', 'All phases')
                    : formatPhaseAssignment(option.assignment),
              }))}
              placeholder={t('wires.phaseSelect', 'Select phase')}
              className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            />
          )}
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {t('wires.inTube', 'Tube')}
        </label>
        <div>
          <button
            type="button"
            onClick={() => onChange({ inTube: !(state.inTube ?? false) })}
            className={`flex flex-col items-center justify-center px-2 py-2 rounded-md border-2 text-xs font-medium transition-colors ${
              state.inTube
                ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300'
                : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-sky-300'
            }`}
            title={t('wires.inTube', 'Tube')}
          >
            <div
              className="h-5 w-5 rounded-full border-2 border-current flex items-center justify-center"
              style={{ borderWidth: 1.25 }}
            />
            <span className="mt-0.5">{t('wires.inTube', 'Tube')}</span>
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          {t('wires.routeLabel', 'Wire route')}
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {(['none', 'inWall', 'onWall', 'ground', 'air'] as const).map((route) => (
            <button
              key={route}
              type="button"
              onClick={() => setRoute(route)}
              className={`flex flex-col items-center justify-center px-2 py-2 rounded-md border-2 text-xs font-medium transition-colors ${
                selectedRoute === route
                  ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300'
                  : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-sky-300'
              }`}
              title={routeLabels[route]}
            >
              <div className="h-6 w-6 flex items-center justify-center">
                {route === 'none' && null}
                {route === 'onWall' && (
                  <svg
                    viewBox="0 0 16 16"
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                  >
                    <line x1="10" y1="2" x2="10" y2="14" />
                    <line x1="2" y1="2" x2="10" y2="2" />
                    <line x1="2" y1="8" x2="10" y2="8" />
                    <line x1="2" y1="14" x2="10" y2="14" />
                  </svg>
                )}
                {route === 'inWall' && (
                  <svg
                    viewBox="0 0 16 16"
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                  >
                    <line x1="2" y1="2" x2="2" y2="14" />
                    <line x1="2" y1="2" x2="10" y2="2" />
                    <line x1="2" y1="8" x2="10" y2="8" />
                    <line x1="2" y1="14" x2="10" y2="14" />
                  </svg>
                )}
                {route === 'ground' && (
                  <svg
                    viewBox="0 0 16 16"
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                  >
                    <line x1="0" y1="4" x2="16" y2="4" />
                    <line x1="4" y1="8" x2="12" y2="8" />
                    <line x1="6" y1="12" x2="10" y2="12" />
                  </svg>
                )}
                {route === 'air' && (
                  <svg
                    viewBox="0 0 16 16"
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                  >
                    <circle cx="8" cy="8" r="6" />
                    <line x1="2.5" y1="8" x2="13.5" y2="8" />
                  </svg>
                )}
              </div>
              <span className="mt-0.5">{routeLabels[route]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('wires.wireTypeLabel', 'Wire type')}
        </label>
        <button
          type="button"
          onClick={() => onChange({ hideWireLabel: isWireLabelVisible ? true : false })}
          className={visibilityToggleClass(isWireLabelVisible)}
          title={
            isWireLabelVisible
              ? t('wires.hideLabel', 'Hide Wire Label')
              : t('wires.showLabel', 'Show Wire Label')
          }
          aria-label={
            isWireLabelVisible
              ? t('wires.hideLabel', 'Hide Wire Label')
              : t('wires.showLabel', 'Show Wire Label')
          }
        >
          {isWireLabelVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
        </button>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2 text-xs font-medium text-gray-600 dark:text-gray-400">
          <div>{t('wires.type', 'Type')}</div>
          <div>{t('wires.conductors', 'Geleiders')}</div>
          <div>{t('wires.thickness', 'Dikte')}</div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <CustomDropdown
            value={state.cable.kind}
            onChange={changeCableType}
            options={wireTypes.map((type) => ({ value: type.value, label: type.label }))}
            className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
          />

          <CustomDropdown
            value={selectedConductorValue}
            onChange={(nextValue) => {
              const opt = conductorOptions.find((o) => o.value === nextValue)
              if (!opt) return
              const next: CableSpec = {
                ...state.cable,
                conductors: opt.conductors,
                hasPE: opt.hasPE,
              }
              onChange({ cable: next })
            }}
            options={conductorOptions.map((opt) => ({ value: opt.value, label: opt.label }))}
            className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
          />

          <CustomDropdown
            value={String(state.cable.sectionMm2)}
            onChange={(nextValue) => {
              const next: CableSpec = {
                ...state.cable,
                sectionMm2: parseFloat(nextValue),
              }
              onChange({ cable: next })
            }}
            options={thicknessOptions.map((th) => ({ value: String(th), label: `${th} mm²` }))}
            className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
          />
        </div>
        {!busbar && state.cable.kind === 'other' && (
          <DebouncedTextInput
            type="text"
            value={state.cable.customKind ?? ''}
            onCommit={(v) => {
              const customKind = v.trim() || undefined
              onChange({ cable: { ...state.cable, customKind } })
            }}
            placeholder={t('wires.customTypePlaceholder', 'Custom type name')}
            className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
          />
        )}
        {cableHint}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('wires.fireClass', 'Brandklasse')}
          </label>
          <button
            type="button"
            disabled={!state.cable.fireClass}
            onClick={() =>
              onChange({
                showFireClassLabel: isFireClassLabelVisible ? false : true,
              })
            }
            className={visibilityToggleClass(isFireClassLabelVisible)}
            title={
              isFireClassLabelVisible
                ? t('wires.hideFireClassLabel', 'Hide fire class on one-wire')
                : t('wires.showFireClassLabel', 'Show fire class on one-wire')
            }
            aria-label={
              isFireClassLabelVisible
                ? t('wires.hideFireClassLabel', 'Hide fire class on one-wire')
                : t('wires.showFireClassLabel', 'Show fire class on one-wire')
            }
          >
            {isFireClassLabelVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
        </div>
        <CustomDropdown
          value={state.cable.fireClass ?? ''}
          onChange={(nextValue) => {
            const fireClass = nextValue
              ? (nextValue as NonNullable<CableSpec['fireClass']>)
              : undefined
            const next: CableSpec = {
              ...state.cable,
              fireClass,
            }
            onChange({
              cable: next,
              ...(fireClass ? {} : { showFireClassLabel: false }),
            })
          }}
          options={[
            { value: '', label: t('common.none', 'None') },
            ...fireClassOptions.map((fireClass) => ({ value: fireClass, label: fireClass })),
          ]}
          className="w-full px-2 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
        />
      </div>

      {showLength && <WireLengthField
        wireLengthM={state.wireLengthM}
        showWireLengthLabel={state.showWireLengthLabel}
        onChange={onChange}
        placeholder={lengthPlaceholder}
        hint={lengthHint}
        t={t}
      />}
    </div>
  )
}
