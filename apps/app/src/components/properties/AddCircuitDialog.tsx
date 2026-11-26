/**
 * Dialog to add a new circuit (with protection) from the endpoint properties circuit dropdown.
 * Creates protection + circuit on the given panel at the end of the main bus, then assigns the endpoint.
 */
import React, { useState } from 'react'
import { useInstallationProfile } from '@/hooks/useInstallationProfile'
import { getProtectionCurveOptions } from './protectionCurveOptions'
import { getProtectionResidualTypeOptions } from './protectionResidualTypeOptions'
import { useTranslation } from 'react-i18next'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import {
  getVoltagePolesConfig,
  getProtectionCreationProps,
  DEFAULT_RCBO_SENSITIVITY_MA,
  getProtectionRatingOptions,
  OTHER_PROTECTION_RATING_OPTION,
  parsePositiveProtectionRating,
} from '@/lib/protectionDefaults'
import CustomDropdown from '@/components/common/CustomDropdown'
import {
  POLE_CONFIG_OPTIONS_RCD,
  POLE_CONFIG_OPTIONS_RCBO,
  POLE_CONFIG_OPTIONS_MCB,
  polesFromConfig,
  polesConfigToDisplay,
} from '@/constants/poleConfig'
import type { ProtectionType, PolesConfig } from '@/types/schema'
import { flattenBoardPanels } from '@/lib/panel/panelTree'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'

const labelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'
const selectClass =
  'w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500'

const PROTECTION_TYPES: Array<{ value: ProtectionType; labelKey: string }> = [
  { value: 'MCB', labelKey: 'symbols.mcb' },
  { value: 'RCD', labelKey: 'symbols.rcd' },
  { value: 'RCBO', labelKey: 'symbols.rcbo' },
]

export interface AddCircuitDialogProps {
  /** Default panel to add the circuit to (e.g. main panel). */
  panelId: string
  endpointId: string
  onCreated: (circuitId: string) => void
  onCancel: () => void
}

export default function AddCircuitDialog({
  panelId,
  endpointId,
  onCreated,
  onCancel,
}: AddCircuitDialogProps) {
  const { t } = useTranslation()
  const currentProject = useProjectStore((s: ProjectState) => s.currentProject)
  const installationProfile = useInstallationProfile()

  const panels = flattenBoardPanels(currentProject ? getProjectElectricalPanels(currentProject) : [])
  const polesConfig = getVoltagePolesConfig(currentProject)
  const defaultProtectionProps = getProtectionCreationProps(currentProject, 'MCB')

  const [label, setLabel] = useState('')
  const [selectedPanelId, setSelectedPanelId] = useState(() => {
    if (panels.some((p) => p.id === panelId)) return panelId
    return panels[0]?.id ?? panelId
  })
  const [protectionType, setProtectionType] = useState<ProtectionType>('MCB')
  const [ratingA, setRatingA] = useState<number | ''>(defaultProtectionProps.ratingA ?? '')
  const [curve, setCurve] = useState<string>(defaultProtectionProps.curve ?? 'C')
  const [sensitivityMa, setSensitivityMa] = useState<number | ''>(
    (defaultProtectionProps as { sensitivityMa?: number }).sensitivityMa ?? 30
  )
  const [residualCurrentType, setResidualCurrentType] = useState<string>(
    (defaultProtectionProps as { residualCurrentType?: string }).residualCurrentType ?? 'A'
  )
  const [breakingCapacityKa, setBreakingCapacityKa] = useState<number | undefined>(
    defaultProtectionProps.breakingCapacityKa
  )
  const [breakingCapacityOption, setBreakingCapacityOption] = useState<string | undefined>(
    defaultProtectionProps.breakingCapacityOption
  )
  const [polesConfigLocal, setPolesConfigLocal] = useState<PolesConfig>(
    defaultProtectionProps.polesConfig ?? polesConfig
  )

  const isRCD = protectionType === 'RCD'
  const isRCBO = protectionType === 'RCBO'
  const isMCB = protectionType === 'MCB'
  const hasCurve = isMCB || isRCBO
  const hasResidual = isRCD || isRCBO

  const poleOptions = isRCD
    ? POLE_CONFIG_OPTIONS_RCD
    : isRCBO
      ? POLE_CONFIG_OPTIONS_RCBO
      : POLE_CONFIG_OPTIONS_MCB

  const ratingOptions = getProtectionRatingOptions(protectionType, installationProfile)

  const sensitivityOptions = isRCBO ? [10, 30, 100, 300] : [10, 30, 100, 300, 500]

  const [defaultSource, setDefaultSource] = useState({ protectionType, polesConfig })
  if (defaultSource.protectionType !== protectionType || defaultSource.polesConfig !== polesConfig) {
    setDefaultSource({ protectionType, polesConfig })
    const defaults = getProtectionCreationProps(
      currentProject,
      protectionType
    )
    setRatingA((defaults.ratingA as number) ?? '')
    setCurve((defaults.curve as string) ?? 'C')
    setSensitivityMa((defaults as { sensitivityMa?: number }).sensitivityMa ?? 30)
    setResidualCurrentType(
      (defaults as { residualCurrentType?: string }).residualCurrentType ?? 'A'
    )
    setBreakingCapacityKa(defaults.breakingCapacityKa)
    setBreakingCapacityOption(defaults.breakingCapacityOption)
    setPolesConfigLocal(defaults.polesConfig ?? polesConfig)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const poles = polesFromConfig(polesConfigLocal)

    const labelTrimmed = label.trim()
    const outcome = runProjectCommand('electrical.createCircuitAndAssign', {
      panelId: selectedPanelId,
      endpointId,
      protection: {
        type: protectionType,
        label: labelTrimmed,
        polesConfig: polesConfigLocal,
        poles,
        ratingA: typeof ratingA === 'number' ? ratingA : undefined,
        curve: hasCurve ? (curve as 'B' | 'C' | 'D' | 'K' | 'Z') : undefined,
        sensitivityMa: hasResidual
          ? typeof sensitivityMa === 'number'
            ? sensitivityMa
            : protectionType === 'RCBO'
              ? DEFAULT_RCBO_SENSITIVITY_MA
              : undefined
          : undefined,
        residualCurrentType: hasResidual
          ? (residualCurrentType as 'AC' | 'A' | 'F' | 'B')
          : undefined,
        breakingCapacityKa: hasCurve ? breakingCapacityKa : undefined,
        breakingCapacityOption: hasCurve ? breakingCapacityOption : undefined,
      },
    }, { label: 'Create circuit and assign endpoint' })
    const circuitId = outcome?.results[0]?.created.find((entity) => entity.kind === 'circuit')?.id
    if (circuitId) onCreated(circuitId)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {t(
          'circuits.addNewDialogDescription',
          'Create a new circuit on the main bus and assign this endpoint to it.'
        )}
      </p>

      <div>
        <label className={labelClass}>{t('circuits.addNewLabel', 'Label')}</label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className={selectClass}
          placeholder={t('circuits.addNewLabelPlaceholder', 'e.g. A, B, Kitchen')}
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {t('circuits.addNewLabelHint', 'Leave empty to auto-label.')}
        </p>
      </div>

      {panels.length > 1 && (
        <div>
          <label className={labelClass}>{t('circuits.addNewPanel', 'Panel')}</label>
          <CustomDropdown
            value={selectedPanelId}
            onChange={setSelectedPanelId}
            options={panels.map((panel) => ({
              value: panel.id,
              label: `${panel.name}${panel.isMain ? ` (${t('panels.mainPanel', 'Main')})` : ''}`,
            }))}
            className={selectClass}
          />
        </div>
      )}

      <div>
        <label className={labelClass}>{t('protections.type', 'Type')}</label>
        <CustomDropdown
          value={protectionType}
          onChange={(nextValue) => setProtectionType(nextValue as ProtectionType)}
          options={PROTECTION_TYPES.map((opt) => ({
            value: opt.value,
            label: t(opt.labelKey, opt.value),
          }))}
          className={selectClass}
        />
      </div>

      <div>
        <label className={labelClass}>{t('protections.polesConfig', 'Pole configuration')}</label>
        <CustomDropdown
          value={polesConfigToDisplay(polesConfigLocal) || polesConfigLocal}
          onChange={(nextValue) => setPolesConfigLocal(nextValue as PolesConfig)}
          options={poleOptions.map((opt) => ({ value: opt, label: opt }))}
          className={selectClass}
        />
      </div>

      <div>
        <label className={labelClass}>{t('protections.rating', 'Rated current')} (A)</label>
        {ratingOptions ? (
          <>
            {isMCB || isRCBO ? (
              <>
                <CustomDropdown
                  value={
                    typeof ratingA === 'number' && ratingOptions.includes(ratingA)
                      ? String(ratingA)
                      : OTHER_PROTECTION_RATING_OPTION
                  }
                  onChange={(nextValue) =>
                    setRatingA(
                      nextValue === OTHER_PROTECTION_RATING_OPTION
                        ? ''
                        : nextValue
                          ? Number(nextValue)
                          : ''
                    )
                  }
                  options={[
                    ...ratingOptions.map((r) => ({ value: String(r), label: `${r} A` })),
                    { value: OTHER_PROTECTION_RATING_OPTION, label: t('protections.otherRating', 'Other…') },
                  ]}
                  placeholder={t('common.select', 'Select')}
                  className={selectClass}
                />
                {typeof ratingA !== 'number' || !ratingOptions.includes(ratingA) ? (
                  <input
                    type="number"
                    value={ratingA === '' ? '' : ratingA}
                    onChange={(e) =>
                      setRatingA(parsePositiveProtectionRating(e.target.value) ?? '')
                    }
                    min="0.01"
                    step="any"
                    aria-label={t('protections.rating', 'Rated current')}
                    className={`${selectClass} mt-2`}
                  />
                ) : null}
              </>
            ) : (
              <CustomDropdown
                value={ratingA === '' ? '' : String(ratingA)}
                onChange={(nextValue) => setRatingA(nextValue ? Number(nextValue) : '')}
                options={ratingOptions.map((r) => ({ value: String(r), label: `${r} A` }))}
                className={selectClass}
              />
            )}
          </>
        ) : (
          <input
            type="number"
            value={ratingA === '' ? '' : ratingA}
            onChange={(e) => setRatingA(e.target.value ? Number(e.target.value) : '')}
            min={1}
            step={1}
            className={selectClass}
          />
        )}
      </div>

      {hasCurve && (
        <div>
          <label className={labelClass}>{t('protections.curve', 'Tripping curve')}</label>
          <CustomDropdown
            value={curve}
            onChange={setCurve}
            ariaLabel={t('protections.curve', 'Tripping curve')}
            options={getProtectionCurveOptions(
              isMCB ? ['B', 'C', 'D', 'K', 'Z'] : ['B', 'C', 'D'], installationProfile, t,
            )}
            className={selectClass}
          />
        </div>
      )}

      {hasResidual && (
        <>
          <div>
            <label className={labelClass}>
              {t('protections.sensitivity', 'Residual trip current IΔn')} (mA)
            </label>
            <CustomDropdown
              value={sensitivityMa === '' ? '' : String(sensitivityMa)}
              onChange={(nextValue) => setSensitivityMa(nextValue ? Number(nextValue) : '')}
              options={sensitivityOptions.map((mA) => ({ value: String(mA), label: `${mA} mA` }))}
              className={selectClass}
            />
          </div>
          <div>
            <label className={labelClass}>
              {t('protections.residualCurrentType', 'Residual current type')}
            </label>
            <CustomDropdown
              value={residualCurrentType}
              onChange={setResidualCurrentType}
              options={getProtectionResidualTypeOptions(t)}
              wrapLabels
              className={selectClass}
            />
          </div>
        </>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          className="px-4 py-2 bg-sky-600 text-white font-medium rounded-md hover:bg-sky-700 transition-colors"
        >
          {t('circuits.addNewConfirm', 'Add circuit')}
        </button>
      </div>
    </form>
  )
}
