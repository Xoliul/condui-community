import { isHouseholdInstallation } from '@/lib/installationProfile'

import { BusbarPhaseOrderProperties } from './BusbarPhaseOrderProperties'
import {
  editProperties,
  updateInstallationProperties,
  updatePanelProperties,
} from '@/handlers/properties/editProperties'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import CustomDropdown from '@/components/common/CustomDropdown'

import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import type { Panel } from '@/types/schema'

import {
  applyNominalVoltageSystem,
  hidesLineToNeutralField,
  normalizeNominalVoltageSystem,
  type SupplyVoltageSystem,
} from '@/constants/nominalVoltage'
import {
  findSupplyingMainPanel,
  getRootFeedNominalVoltage,
  getRootFeedTransformerOutputRating,
  installationSupportsFeedVoltages,
  resolvePanelNominalVoltage,
} from '@/lib/electrical/feedNominalVoltage'
import { focusBoardVoltage } from '@/handlers/properties/focusBoardVoltage'
import { Crosshair } from 'lucide-react'
import { TransformerOutputRatingFields } from '../shared/TransformerNameplateFields'
import { checkRootFeedNominalVoltage } from '@/lib/electrical/feedNominalVoltageEdit'

import { useEditionFeatureAvailability } from '@/hooks/useEditionFeatureAvailability'

import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectSupplyAssemblies,
} from '@/lib/projectV2/electrical'

import { selectClass } from '../shared/propertiesSharedUtils'

import { NominalVoltageSystemPicker } from '../NominalVoltageSystemPicker'
import { ConnectionCurrentField } from '../ConnectionCurrentField'

import { ChangeoverGridSourcePicker } from '../shared/ChangeoverGridSourcePicker'

import { getPanelIncomingPhaseState, supportsExplicitPhaseSelection } from '@/lib/wires/phaseAssignment'

import { findPanelById } from '@/lib/panel/panelTree'
import { resolveEffectiveEarthingSystem } from '@/lib/panel/panelEarthingSync'
import {
  getPanelBusFeedKind,
  getPanelFeedOrganization,
  panelCanConfigureBackupOutput,
  panelHasBackupOutput,
  panelHasModularChangeover,
  panelRequiresSplitFeed,
  type PanelFeedOrganization,
} from '@/lib/panel/panelFeedOrganization'
import { getPanelBusSections } from '@/lib/panel/panelBusSections'

export function SupplyProperties({
  readOnly = false,
  panelId,
  selectedBusSectionId,
}: {
  readOnly?: boolean
  panelId?: string
  selectedBusSectionId?: string
}) {
  const { t } = useTranslation()
  const currentProject = useProjectStore((state: ProjectState) => state.currentProject)
  const updateInstallation = updateInstallationProperties
  const setPanelFeedOrganization = (panelId: string, organization: PanelFeedOrganization) =>
    editProperties({ actions: [{ kind: 'panelFeedOrganization', panelId, organization }] })
  const updatePanel = updatePanelProperties
  const { advancedPanelLabels } = useEditionFeatureAvailability(currentProject?.project.id)
  const earthingOptions = useMemo(
    () => [
      { value: '', label: t('panels.earthingSystem.none', 'None') },
      { value: 'TT', label: t('panels.earthingSystem.TT', 'TT') },
      { value: 'TN-S', label: t('panels.earthingSystem.TN-S', 'TN-S') },
      { value: 'TN-C', label: t('panels.earthingSystem.TN-C', 'TN-C') },
      { value: 'TN-C-S', label: t('panels.earthingSystem.TN-C-S', 'TN-C-S') },
      { value: 'IT', label: t('panels.earthingSystem.IT', 'IT') },
    ],
    [t]
  )

  const installation = currentProject ? getProjectElectricalInstallation(currentProject) : undefined
  if (!installation) {
    return (
      <div className="p-4 text-center text-gray-500">
        {t('installation.notFound', 'Installation not found')}
      </div>
    )
  }
  const panels = currentProject ? getProjectElectricalPanels(currentProject) : []
  const panel = panelId
    ? findPanelById(panels, panelId)
    : panels.find((candidate) => candidate.isMain !== false)
  const panelNumberingEnabled = !!installation.panelNumberingEnabled
  const panelNetTypeLabelsEnabled = !!installation.panelNetTypeLabelsEnabled
  const netTypeLabelsAvailable = !isHouseholdInstallation(installation)
  const hasBackupFeed =
    currentProject != null && panel != null && panelHasBackupOutput(currentProject, panel.id)
  const earthingValue =
    panel && currentProject ? (resolveEffectiveEarthingSystem(panel, panels) ?? '') : ''
  const organization =
    currentProject && panel ? getPanelFeedOrganization(currentProject, panel) : 'single'
  const hasChangeover = Boolean(
    currentProject && panel && panelHasModularChangeover(currentProject, panel.id)
  )
  const hasBackup = Boolean(
    currentProject && panel && panelCanConfigureBackupOutput(currentProject, panel.id)
  )
  const requiresSplitFeed = Boolean(
    currentProject && panel && panelRequiresSplitFeed(currentProject, panel.id)
  )
  const splitOrganization: PanelFeedOrganization = hasChangeover
    ? 'split-switchable'
    : 'split-backup'
  const selectedSection = panel
    ? getPanelBusSections(panel).find((section) => section.id === selectedBusSectionId)
    : undefined
  const selectedSectionPhaseAssignment =
    currentProject && panel && selectedSection
      ? getPanelIncomingPhaseState(
          installation,
          panels,
          panel,
          selectedSection.id,
          selectProjectSupplyAssemblies(currentProject)
        ).assignment
      : undefined

  // A main board on its own transformer output edits that output, not the project voltage.
  const boardVoltageEditable = Boolean(
    currentProject && panel && checkRootFeedNominalVoltage(currentProject, panel.id).ok
  )
  // Behind an own transformer only a board directly after it chooses a voltage; others go to that board.
  const inheritedFrom =
    panel && !boardVoltageEditable && installationSupportsFeedVoltages(installation)
      ? findSupplyingMainPanel(panels, panel.id)
      : undefined
  const nominalVoltage = panel
    ? resolvePanelNominalVoltage(installation, panels, panel.id)
    : installation.nominalVoltage
  const nominalSystem = normalizeNominalVoltageSystem(nominalVoltage.system)
  // Only a board on its own output needs its own winding nameplate.
  const outputRating =
    boardVoltageEditable && panel && getRootFeedNominalVoltage(installation, panels, panel)
      ? getRootFeedTransformerOutputRating(installation, panels, panel)
      : undefined
  const setNominalVoltageSystem = (system: SupplyVoltageSystem) =>
    boardVoltageEditable && panel
      ? editProperties({ actions: [{ kind: 'rootFeedNominalVoltage', panelId: panel.id, system }] })
      : updateInstallation({
          nominalVoltage: applyNominalVoltageSystem(installation.nominalVoltage, system),
        })

  return (
    <div className="space-y-6">
      {panel && advancedPanelLabels ? (
        <div className="border-b border-gray-200 pb-4 dark:border-gray-700">
          <h4 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('panels.diagramLabels', 'Diagram labels')}
          </h4>
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={panelNumberingEnabled}
                disabled={readOnly}
                onChange={(e) =>
                  editProperties({
                    installation: { panelNumberingEnabled: e.target.checked },
                    refreshAutomaticNaming: true,
                  })
                }
              />
              {t('panels.panelNumbering', 'Panel numbering')}
            </label>
            {netTypeLabelsAvailable ? (
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={panelNetTypeLabelsEnabled}
                  disabled={readOnly}
                  onChange={(e) => {
                    editProperties({
                      installation: { panelNetTypeLabelsEnabled: e.target.checked },
                      ...(e.target.checked && !earthingValue
                        ? {
                            edits: [
                              { kind: 'panel', ids: [panel.id], set: { earthingSystem: 'TT' } },
                            ],
                          }
                        : {}),
                    })
                  }}
                />
                {t('panels.panelNetTypeLabels', 'Net type on diagram')}
              </label>
            ) : null}
            {netTypeLabelsAvailable && panelNetTypeLabelsEnabled ? (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t(
                      hasBackupFeed
                        ? 'panels.earthingSystemGridLabel'
                        : 'panels.earthingSystemLabel',
                      hasBackupFeed ? 'Earthing system (grid)' : 'Earthing system'
                    )}
                  </label>
                  <CustomDropdown
                    value={earthingValue}
                    onChange={(nextValue) =>
                      updatePanel(panel.id, {
                        earthingSystem:
                          nextValue === '' ? undefined : (nextValue as Panel['earthingSystem']),
                      })
                    }
                    options={earthingOptions}
                    disabled={readOnly}
                    className={selectClass}
                  />
                </div>
                {hasBackupFeed ? (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('panels.earthingSystemBackupLabel', 'Earthing system (backup)')}
                    </label>
                    <CustomDropdown
                      value={panel.backupEarthingSystem ?? ''}
                      onChange={(nextValue) =>
                        updatePanel(panel.id, {
                          backupEarthingSystem:
                            nextValue === ''
                              ? undefined
                              : (nextValue as Panel['backupEarthingSystem']),
                        })
                      }
                      options={earthingOptions}
                      disabled={readOnly}
                      className={selectClass}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {panel && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            {t('feedOrganization.title', 'Feed organization')}
          </h4>
          <div className="grid grid-cols-1 gap-2">
            {[
              {
                value: 'single' as const,
                label: t('feedOrganization.single', 'Single feed'),
              },
              {
                value: splitOrganization,
                label: hasChangeover
                  ? t('feedOrganization.splitSwitchable', 'Grid + switched backup')
                  : t('feedOrganization.splitBackup', 'Grid + backup'),
              },
            ].map((option) => {
              const active = organization === option.value
              const disabled =
                readOnly ||
                (option.value === 'single' && requiresSplitFeed) ||
                (option.value !== 'single' && !hasBackup)
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => setPanelFeedOrganization(panel.id, option.value)}
                  className={`rounded-md border px-3 py-2 text-left text-sm font-medium ${
                    active
                      ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
                      : 'border-gray-300 bg-white text-gray-700 hover:border-sky-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
                  } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
          {organization === 'split-switchable' && (
            <ChangeoverGridSourcePicker panelId={panel.id} readOnly={readOnly} />
          )}
          {selectedSection && (
            <div className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {t('feedOrganization.bus', 'Busbar')}: {selectedSection.label} ·{' '}
              {getPanelBusFeedKind(panel, selectedSection.id) === 'backup'
                ? t('feedOrganization.backupFeed', 'Backup feed')
                : t('feedOrganization.gridFeed', 'Grid feed')}
              {selectedSectionPhaseAssignment?.phases.length
                ? ` · ${selectedSectionPhaseAssignment.phases.join(' + ')}`
                : ''}
            </div>
          )}
        </div>
      )}

      {panel && selectedSection && supportsExplicitPhaseSelection(nominalSystem) && (
        <BusbarPhaseOrderProperties panel={panel} busSectionId={selectedSection.id} readOnly={readOnly} />
      )}

      {/* Nominal Voltage */}
      <div>
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          {t('installation.voltage', 'Nominal Voltage')}
        </h4>
        <div className="space-y-3">
          <NominalVoltageSystemPicker
            value={nominalSystem}
            readOnly={readOnly || (installationSupportsFeedVoltages(installation) && !boardVoltageEditable)}
            onChange={setNominalVoltageSystem}
          />
          {inheritedFrom && (
            <button
              type="button"
              onClick={() => focusBoardVoltage(inheritedFrom.id)}
              className="flex w-full items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-left text-sm text-gray-800 hover:border-sky-400 dark:border-gray-600 dark:text-gray-200"
            >
              <span className="min-w-0 flex-1 truncate">{inheritedFrom.name}</span>
              <Crosshair aria-hidden className="h-3.5 w-3.5 shrink-0 text-gray-500" />
            </button>
          )}
          {outputRating && panel && (
            <TransformerOutputRatingFields
              ratedKva={outputRating.ratedKva}
              ukPercent={outputRating.ukPercent}
              readOnly={readOnly}
              onChange={(patch) =>
                editProperties({
                  actions: [{ kind: 'rootFeedTransformerOutput', panelId: panel.id, ...patch }],
                })
              }
            />
          )}
          <div
            className={`grid gap-3 ${hidesLineToNeutralField(nominalSystem) ? 'grid-cols-1' : 'grid-cols-2'}`}
          >
            {!hidesLineToNeutralField(nominalSystem) && (
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {t('installation.lineToNeutral', 'Line-to-Neutral (V)')}
                </label>
                <input
                  type="number"
                  value={nominalVoltage.uLineToNeutral}
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
                value={nominalVoltage.uLineToLine}
                disabled
                min="0"
                step="1"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400 cursor-not-allowed [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>
        </div>
      </div>
      <ConnectionCurrentField
        value={installation.connectionCurrentA}
        readOnly={readOnly}
        onChange={(connectionCurrentA) => updateInstallation({ connectionCurrentA })}
      />
    </div>
  )
}
