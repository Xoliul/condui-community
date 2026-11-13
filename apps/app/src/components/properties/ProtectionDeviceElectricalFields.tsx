/* eslint-disable react-refresh/only-export-components */
/**
 * Shared protection electrical/spec fields for panel-mounted {@link ProtectionDevice}
 * and supply/circuit {@link TrunkDevice} rows (type === 'protection').
 * Keeps dropdown behaviour and option lists in one place.
 */
import type { ReactNode } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useInstallationProfile } from '@/hooks/useInstallationProfile'
import { getProtectionCurveOptions } from './protectionCurveOptions'
import { getProtectionResidualTypeOptions } from './protectionResidualTypeOptions'
import type { TFunction } from 'i18next'
import type {
  CurveType,
  ProtectionDevice,
  ProtectionType,
  PolesConfig,
  ResidualCurrentType,
  SurgeProtectionKind,
} from '@/types/schema'
import CustomDropdown, { type CustomDropdownOption } from '@/components/common/CustomDropdown'
import { useAdjustableTrip } from '@/components/documents/documentsHostedFeatures'
import { getSymbolsByCategory } from '@/lib/symbols'
import {
  POLE_CONFIG_OPTIONS,
  POLE_CONFIG_OPTIONS_RCD,
  POLE_CONFIG_OPTIONS_RCBO,
  POLE_CONFIG_OPTIONS_MCB,
  polesFromConfig,
  polesConfigToDisplay,
} from '@/constants/poleConfig'
import type { ProtectionLabelKey } from '@/lib/protectionLabels'
import {
  getProtectionRatingOptions,
  breakingCapacityPatchFromSelectValue,
  getBreakerBreakingCapacityOptions,
  protectionBreakingCapacityKaOptions,
  resolveBreakingCapacitySelectValue,
} from '@/lib/protectionDefaults'
import {
  PROTECTION_SYMBOL_ID_TO_TYPE,
  PROTECTION_TYPE_TO_SYMBOL_ID,
  protectionTypeToSymbolKey,
} from '@/lib/protectionKind'
import {
  SPD_SPARK_GAP_SYMBOL_PATH,
  SPD_STANDARD_SYMBOL_PATH,
} from '@/lib/surgeProtectionSymbol'

export type { ProtectionLabelKey as ProtectionDiagramLabelKey } from '@/lib/protectionLabels'
export {
  PROTECTION_SYMBOL_ID_TO_TYPE,
  PROTECTION_TYPE_TO_SYMBOL_ID,
  protectionTypeToSymbolKey,
}

export function getProtectionTypeDropdownOptions(
  t: (key: string, defaultValue?: string) => string,
  variant: 'panel' | 'supplyTrunk',
): CustomDropdownOption[] {
  let devices = getSymbolsByCategory('protection')
  if (variant === 'supplyTrunk') {
    devices = devices.filter((sym) => sym.id !== 'main_switch')
  }
  return devices.map((device) => {
    const protectionType =
      PROTECTION_SYMBOL_ID_TO_TYPE[device.id] ?? (device.id.toUpperCase() as ProtectionType)
    return {
      value: protectionType,
      label: t(`symbols.${device.id}`, device.name),
    }
  })
}

/** The protection whose curve may become "Adjustable", and how it is edited. */
export interface AdjustableTripTarget {
  kind: 'protection' | 'trunkDevice'
  protection: ProtectionDevice
}

/** Hosted: "Adjustable" as one more curve, with its trip settings under the dropdown. */
export interface AdjustableTripControl {
  active: boolean
  label: string
  /** Switch to adjustable settings that start from the current curve. */
  select: () => void
  /** Leave adjustable settings for a curve, in one edit. */
  selectCurve: (curve: CurveType | undefined) => void
  fields: ReactNode
}

const ADJUSTABLE_CURVE = 'adjustable'

export interface ProtectionDeviceElectricalFieldsProps {
  t: TFunction
  selectClass: string
  labelClass: string
  visibilityToggleClass: (enabled: boolean) => string
  protectionType: ProtectionType
  ratingA?: number
  curve?: CurveType
  sensitivityMa?: number
  residualCurrentType?: ResidualCurrentType
  selective?: boolean
  superImmunized?: boolean
  breakingCapacityKa?: number
  breakingCapacityOption?: string
  surgeProtectionKind?: SurgeProtectionKind
  polesConfig?: PolesConfig
  poles?: number
  typeDropdownOptions: CustomDropdownOption[]
  onProtectionTypeChange: (nextType: ProtectionType) => void
  onPatch: (patch: {
    ratingA?: number
    curve?: CurveType | undefined
    sensitivityMa?: number
    residualCurrentType?: ResidualCurrentType | undefined
    selective?: boolean
    superImmunized?: boolean
    breakingCapacityKa?: number
    breakingCapacityOption?: string
    surgeProtectionKind?: SurgeProtectionKind
    polesConfig?: PolesConfig
    poles?: number
  }) => void
  isProtectionLabelVisible: (key: ProtectionLabelKey) => boolean
  toggleProtectionLabel: (key: ProtectionLabelKey) => void
  tripTarget?: AdjustableTripTarget
}

export function ProtectionDeviceElectricalFields({
  t,
  selectClass,
  labelClass,
  visibilityToggleClass,
  protectionType,
  ratingA,
  curve,
  sensitivityMa,
  residualCurrentType,
  selective,
  superImmunized,
  breakingCapacityKa,
  breakingCapacityOption,
  surgeProtectionKind,
  polesConfig,
  poles,
  typeDropdownOptions,
  onProtectionTypeChange,
  onPatch,
  isProtectionLabelVisible,
  toggleProtectionLabel,
  tripTarget,
}: ProtectionDeviceElectricalFieldsProps) {
  const installationProfile = useInstallationProfile()
  const adjustableTrip = useAdjustableTrip(tripTarget)
  const isRCD = protectionType === 'RCD'
  const isRCBO = protectionType === 'RCBO'
  const isMCB = protectionType === 'MCB'
  const isSPD = protectionType === 'SPD'
  const isRotatingSwitch = protectionType === 'ROTATING_SWITCH'
  const hasResidual = isRCD || isRCBO
  const hasCurve = isMCB || isRCBO
  const hasBreakingCapacity = isMCB || isRCBO || isSPD

  const poleOptions = isRCD
    ? POLE_CONFIG_OPTIONS_RCD
    : isRCBO
      ? POLE_CONFIG_OPTIONS_RCBO
      : isMCB || isSPD
        ? POLE_CONFIG_OPTIONS_MCB
        : POLE_CONFIG_OPTIONS

  const ratingOptions = getProtectionRatingOptions(protectionType, installationProfile)

  const sensitivityOptions = isRCD
    ? [10, 30, 100, 300, 500]
    : isRCBO
      ? [10, 30, 100, 300]
      : [10, 30, 100, 300, 500]

  const breakingCapacityOptions = protectionBreakingCapacityKaOptions(isSPD)

  const handlePolesConfigChange = (config: string) => {
    onPatch({
      polesConfig: (config ? config : undefined) as PolesConfig | undefined,
      poles: config ? polesFromConfig(config) : undefined,
    })
  }

  return (
    <>
      <div>
        <label className={labelClass}>{t('protections.type', 'Type')}</label>
        <CustomDropdown
          value={protectionType}
          onChange={(next) => onProtectionTypeChange(next as ProtectionType)}
          options={typeDropdownOptions}
          className={selectClass}
        />
      </div>

      {isSPD && (
        <div>
          <label className={labelClass}>{t('protections.spdKind', 'SPD type')}</label>
          <div className="mt-1 grid grid-cols-2 gap-2" role="radiogroup">
            {([
              {
                value: 'standard' as const,
                label: t('protections.spdStandard', 'Lightning protection'),
                symbolPath: SPD_STANDARD_SYMBOL_PATH,
              },
              {
                value: 'sparkGap' as const,
                label: t('protections.spdSparkGap', 'Spark gap'),
                symbolPath: SPD_SPARK_GAP_SYMBOL_PATH,
              },
            ] satisfies Array<{
              value: SurgeProtectionKind
              label: string
              symbolPath: string
            }>).map((option) => {
              const selected = (surgeProtectionKind ?? 'standard') === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onPatch({ surgeProtectionKind: option.value })}
                  className={`flex min-w-0 flex-col items-center justify-center rounded-md border-2 px-2 py-2 text-xs font-medium transition-colors ${
                    selected
                      ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300'
                      : 'border-gray-300 text-gray-700 hover:border-sky-300 dark:border-gray-600 dark:text-gray-300'
                  }`}
                >
                  <span className="flex h-11 items-center justify-center" aria-hidden="true">
                    <img src={option.symbolPath} alt="" className="h-10 w-10 dark:invert" />
                  </span>
                  <span className="mt-1 text-center text-[10px] leading-tight">
                    {option.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {(isRCD || isRCBO || isMCB || isSPD || isRotatingSwitch) && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className={labelClass + ' mb-0'}>
              {t('protections.polesConfig', 'Pole configuration')}
            </label>
            <button
              type="button"
              onClick={() => toggleProtectionLabel('protectionPoles')}
              className={visibilityToggleClass(isProtectionLabelVisible('protectionPoles'))}
              title={
                isProtectionLabelVisible('protectionPoles') ? t('common.hide', 'Hide') : t('common.show', 'Show')
              }
            >
              {isProtectionLabelVisible('protectionPoles') ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
          </div>
          <CustomDropdown
            value={polesConfigToDisplay(polesConfig) || ''}
            onChange={(v) => handlePolesConfigChange(v)}
            options={[{ value: '', label: '-' }, ...poleOptions.map((opt) => ({ value: opt, label: opt }))]}
            className={selectClass}
          />
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-1">
          <label className={labelClass + ' mb-0'}>
            {t('protections.rating', 'Rated current')} (A)
          </label>
          <button
            type="button"
            onClick={() => toggleProtectionLabel('protectionCurrent')}
            className={visibilityToggleClass(isProtectionLabelVisible('protectionCurrent'))}
            title={
              isProtectionLabelVisible('protectionCurrent') ? t('common.hide', 'Hide') : t('common.show', 'Show')
            }
          >
            {isProtectionLabelVisible('protectionCurrent') ? (
              <Eye className="w-4 h-4" />
            ) : (
              <EyeOff className="w-4 h-4" />
            )}
          </button>
        </div>
        {ratingOptions ? (
          <CustomDropdown
            value={ratingA == null ? '' : String(ratingA)}
            onChange={(nextValue) => onPatch({ ratingA: nextValue ? Number(nextValue) : undefined })}
            options={[
              ...(isMCB || isRCBO ? [] : [{ value: '', label: '-' }]),
              ...ratingOptions.map((r) => ({ value: String(r), label: `${r} A` })),
            ]}
            placeholder={t('common.select', 'Select')}
            className={selectClass}
          />
        ) : (
          <input
            type="number"
            value={ratingA ?? ''}
            onChange={(e) => onPatch({ ratingA: e.target.value ? Number(e.target.value) : undefined })}
            min="1"
            step="1"
            className={selectClass}
          />
        )}
      </div>

      {hasCurve && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className={labelClass + ' mb-0'}>{t('protections.curve', 'Tripping curve')}</label>
            <button
              type="button"
              onClick={() => toggleProtectionLabel('protectionCharacteristic')}
              className={visibilityToggleClass(isProtectionLabelVisible('protectionCharacteristic'))}
              title={
                isProtectionLabelVisible('protectionCharacteristic')
                  ? t('common.hide', 'Hide')
                  : t('common.show', 'Show')
              }
            >
              {isProtectionLabelVisible('protectionCharacteristic') ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
          </div>
          <CustomDropdown
            value={adjustableTrip?.active ? ADJUSTABLE_CURVE : curve || ''}
            onChange={(v) => {
              if (v === ADJUSTABLE_CURVE) adjustableTrip?.select()
              else if (adjustableTrip?.active) adjustableTrip.selectCurve((v as CurveType) || undefined)
              else onPatch({ curve: (v as CurveType) || undefined })
            }}
            ariaLabel={t('protections.curve', 'Tripping curve')}
            options={[
              ...getProtectionCurveOptions(['', 'B', 'C', 'D', 'F', 'K', 'MA', 'Z'], installationProfile, t),
              ...(adjustableTrip ? [{ value: ADJUSTABLE_CURVE, label: adjustableTrip.label }] : []),
            ]}
            className={selectClass}
          />
          {adjustableTrip?.active && <div className="mt-2">{adjustableTrip.fields}</div>}
        </div>
      )}

      {hasBreakingCapacity && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className={labelClass + ' mb-0'}>
              {t('protections.breakingCapacity', 'Breaking capacity')}
            </label>
            <button
              type="button"
              onClick={() => toggleProtectionLabel('protectionShortCircuit')}
              className={visibilityToggleClass(isProtectionLabelVisible('protectionShortCircuit'))}
              title={
                isProtectionLabelVisible('protectionShortCircuit')
                  ? t('common.hide', 'Hide')
                  : t('common.show', 'Show')
              }
            >
              {isProtectionLabelVisible('protectionShortCircuit') ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
          </div>
          <CustomDropdown
            value={
              isSPD
                ? String(breakingCapacityKa ?? '')
                : resolveBreakingCapacitySelectValue(
                    breakingCapacityOption,
                    breakingCapacityKa,
                  )
            }
            ariaLabel={t('protections.breakingCapacity', 'Breaking capacity')}
            onChange={(v) => {
              if (isSPD) {
                onPatch({
                  breakingCapacityKa: v ? Number(v) : undefined,
                  breakingCapacityOption: undefined,
                })
                return
              }
              const patch = breakingCapacityPatchFromSelectValue(v)
              onPatch(
                patch ?? {
                  breakingCapacityKa: undefined,
                  breakingCapacityOption: undefined,
                },
              )
            }}
            options={[
              { value: '', label: '-' },
              ...(isSPD
                ? breakingCapacityOptions.map((kA) => ({
                    value: String(kA),
                    label: `${kA} kA`,
                  }))
                : getBreakerBreakingCapacityOptions(
                    installationProfile,
                    resolveBreakingCapacitySelectValue(breakingCapacityOption, breakingCapacityKa),
                  ).map(({ value, label }) => ({
                    value,
                    label,
                  }))),
            ]}
            className={selectClass}
          />
        </div>
      )}

      {hasResidual && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className={labelClass + ' mb-0'}>
              {t('protections.sensitivity', 'Residual trip current IΔn')}
            </label>
            <button
              type="button"
              onClick={() => toggleProtectionLabel('protectionResidualCurrent')}
              className={visibilityToggleClass(isProtectionLabelVisible('protectionResidualCurrent'))}
              title={
                isProtectionLabelVisible('protectionResidualCurrent')
                  ? t('common.hide', 'Hide')
                  : t('common.show', 'Show')
              }
            >
              {isProtectionLabelVisible('protectionResidualCurrent') ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
          </div>
          <CustomDropdown
            value={sensitivityMa != null ? String(sensitivityMa) : ''}
            ariaLabel={t('protections.sensitivity', 'Residual trip current IΔn')}
            onChange={(nextValue) => {
              const next = nextValue ? Number(nextValue) : undefined
              onPatch({
                sensitivityMa: next,
              })
            }}
            options={[
              { value: '', label: '-' },
              ...sensitivityOptions.map((mA) => ({
                value: String(mA),
                label: `${mA} mA`,
              })),
            ]}
            className={selectClass}
          />
        </div>
      )}

      {hasResidual && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className={labelClass + ' mb-0'}>
              {t('protections.residualCurrentType', 'Residual current type')}
            </label>
            <button
              type="button"
              onClick={() => toggleProtectionLabel('protectionResidualCurrentType')}
              className={visibilityToggleClass(
                isProtectionLabelVisible('protectionResidualCurrentType'),
              )}
              title={
                isProtectionLabelVisible('protectionResidualCurrentType')
                  ? t('common.hide', 'Hide')
                  : t('common.show', 'Show')
              }
            >
              {isProtectionLabelVisible('protectionResidualCurrentType') ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
          </div>
          <CustomDropdown
            value={residualCurrentType ?? ''}
            ariaLabel={t('protections.residualCurrentType', 'Residual current type')}
            onChange={(v) =>
              onPatch({
                residualCurrentType: (v as ResidualCurrentType) || undefined,
              })
            }
            options={[
              { value: '', label: '-' },
              ...getProtectionResidualTypeOptions(t),
            ]}
            wrapLabels
            className={selectClass}
          />
        </div>
      )}

      {hasResidual && (
        <div className="flex flex-wrap gap-2">
          {([
            { key: 'selective', label: t('protections.selective', 'Selective (S)'), active: selective },
            { key: 'superImmunized', label: t('protections.superImmunized', 'Super immunized (SI)'), active: superImmunized },
          ] as const).map(({ key, label, active }) => (
            <button
              key={key}
              type="button"
              aria-label={label}
              title={label}
              aria-pressed={active === true}
              onClick={() => onPatch({ [key]: active !== true })}
              className={`max-w-full rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300'
                  : 'border-gray-300 text-gray-700 hover:border-sky-300 dark:border-gray-600 dark:text-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {!isRCD && !isRCBO && !isMCB && !isSPD && !isRotatingSwitch && (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className={labelClass + ' mb-0'}>{t('protections.poles', 'Poles')}</label>
            <button
              type="button"
              onClick={() => toggleProtectionLabel('protectionPoles')}
              className={visibilityToggleClass(isProtectionLabelVisible('protectionPoles'))}
              title={
                isProtectionLabelVisible('protectionPoles') ? t('common.hide', 'Hide') : t('common.show', 'Show')
              }
            >
              {isProtectionLabelVisible('protectionPoles') ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
          </div>
          <input
            type="number"
            value={poles ?? ''}
            onChange={(e) => onPatch({ poles: e.target.value ? Number(e.target.value) : undefined })}
            min="1"
            max="4"
            step="1"
            className={selectClass}
          />
        </div>
      )}
    </>
  )
}
