import { editProperties, updatePanelGridProperties } from '@/handlers/properties/editProperties'
import { buildPanelCodeById } from '@/lib/panel/panelDiagramLabels'
import { openLabelSchemeDialog } from '@/handlers/eendraad/openLabelSchemeDialog'
import { AutomaticNamingOverrideControl } from '@/components/properties/shared/AutomaticNamingOverrideControl'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DebouncedTextInput } from '@/components/forms'
import CustomDropdown from '@/components/common/CustomDropdown'
import { useDialogStore } from '@/stores/dialogStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import type { Panel } from '@/types/schema'
import { useEditionFeatureAvailability } from '@/hooks/useEditionFeatureAvailability'
import { findMainPanel } from '@/lib/panel/panelTree'
import { panelHasBackupOutput } from '@/lib/panel/panelFeedOrganization'
import {
  panelEarthingFollowsMain,
  resolveEffectiveEarthingSystem,
} from '@/lib/panel/panelEarthingSync'
import {
  buildPanelInstallDateTargets,
  getInstallDateTargetInheritedYear,
  type InstallDatePropagationMode,
  type InstallDateTarget,
} from '@/lib/installDatePropagation'
import { InstallDateField, OptionalNumberField } from '../shared/propertiesShared'
import { isHouseholdInstallation } from '@/lib/installationProfile'
import { selectClass } from '../shared/propertiesSharedUtils'
import { installationDateUpdateFromYear } from '@/lib/installDates'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { DEFAULT_PANEL_GRID_COLUMNS, DEFAULT_PANEL_GRID_ROWS } from '@/lib/panel/panelGridDefaults'
import { getPanelGridFields, MAX_PANEL_GRID_FIELDS } from '@/lib/panel/panelGridFields'
import { PanelGridDimensionInput } from '../shared/PanelGridDimensionInput'
// Panel Properties Component
export function PanelProperties({
  panelId,
  panel,
  onUpdate,
}: {
  panelId: string
  panel: Panel | undefined
  onUpdate: (id: string, updates: Partial<Panel>) => void
}) {
  const { t, i18n } = useTranslation()
  const currentProject = useProjectStore((s: ProjectState) => s.currentProject)
  const updatePanelGrid = updatePanelGridProperties
  const openDialog = useDialogStore((s) => s.openDialog)
  const { advancedPanelLabels } = useEditionFeatureAvailability(currentProject?.project.id)

  const projectLocale = currentProject?.project.locale ?? i18n.language
  const displayName = panel?.nameByLocale?.[projectLocale] ?? panel?.name ?? ''
  const installation = currentProject ? getProjectElectricalInstallation(currentProject) : undefined
  const panelNumberingEnabled = !!installation?.panelNumberingEnabled
  const panelCode = currentProject
    ? buildPanelCodeById(getProjectElectricalPanels(currentProject), installation).get(panelId)
    : undefined
  const panelNumberInputRef = useRef<HTMLInputElement>(null)
  const [panelNumberReset, setPanelNumberReset] = useState(0)
  const setPanelNumberOverride = (numberOverride: string | null) =>
    editProperties({
      edits: [{ kind: 'panel', ids: [panelId], set: { numberOverride } }],
      refreshAutomaticNaming: true,
    })
  const panelNetTypeLabelsEnabled = !!installation?.panelNetTypeLabelsEnabled
  const netTypeLabelsAvailable = !!installation && !isHouseholdInstallation(installation)
  const hasBackupFeed =
    currentProject != null && panel != null && panelHasBackupOutput(currentProject, panel.id)
  const mainPanel = currentProject
    ? findMainPanel(getProjectElectricalPanels(currentProject))
    : null
  const earthingValue =
    panel && currentProject
      ? (resolveEffectiveEarthingSystem(panel, getProjectElectricalPanels(currentProject)) ?? '')
      : ''
  const earthingSyncedWithMain =
    !!panel &&
    !!mainPanel &&
    panel.id !== mainPanel.id &&
    panelEarthingFollowsMain(panel, mainPanel.earthingSystem)

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

  const handlePanelNetTypeLabelsChange = (enabled: boolean) =>
    editProperties({
      installation: { panelNetTypeLabelsEnabled: enabled },
      ...(enabled && !earthingValue
        ? { edits: [{ kind: 'panel', ids: [panelId], set: { earthingSystem: 'TT' } }] }
        : {}),
    })

  if (!panel) {
    return (
      <div className="p-4 text-center text-gray-500">{t('panels.notFound', 'Panel not found')}</div>
    )
  }

  const applyInstallDateTargets = (targets: InstallDateTarget[], year: number | undefined) => {
    const edits = targets.map((target) => {
      const inheritedYear = currentProject
        ? getInstallDateTargetInheritedYear(currentProject, target)
        : undefined
      const requestedYear = target.preserveYear ?? year
      const targetYear =
        target.clearOverride || (!target.forceOverride && requestedYear === inheritedYear)
          ? undefined
          : requestedYear
      return {
        kind: target.type,
        ids: [target.id],
        set: installationDateUpdateFromYear(targetYear),
      }
    })
    editProperties({ edits, seedInstallDateColors: { targets, year } })
  }

  const handleInstallDateUpdate = (updates: {
    installationDate?: string
    installationDateSuppressed?: boolean
    rulesetDateOverride?: number
  }) => {
    const year = updates.installationDate
      ? Number(updates.installationDate.slice(0, 4))
      : updates.rulesetDateOverride
    if (year == null || !currentProject) {
      onUpdate(panelId, updates)
      return
    }
    const applyPanelOnly = () =>
      applyInstallDateTargets([{ id: panelId, type: 'panel', forceOverride: true }], year)
    const applyMode = (mode: InstallDatePropagationMode) =>
      applyInstallDateTargets(buildPanelInstallDateTargets(currentProject, panelId, mode), year)
    openDialog({
      type: 'custom',
      title: t('installDates.propagatePanelTitle', 'Change all child devices too?'),
      content: (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t(
            'installDates.propagatePanelMessage',
            'Choose whether this install date should feed down from the panel.'
          )}
        </p>
      ),
      buttons: [
        { label: t('common.no', 'No'), onClick: applyPanelOnly, variant: 'secondary' },
        {
          label: t('installDates.propagateProtections', 'Yes - only protections'),
          onClick: () => applyMode('protections'),
          variant: 'secondary',
        },
        {
          label: t('installDates.propagateAll', 'Yes - all'),
          onClick: () => applyMode('all'),
          variant: 'primary',
          autoFocus: true,
        },
      ],
    })
  }

  return (
    <div className="space-y-4">
      <InstallDateField
        entity={panel}
        project={currentProject}
        inheritedYear={
          currentProject
            ? getInstallDateTargetInheritedYear(currentProject, { id: panelId, type: 'panel' })
            : undefined
        }
        onUpdate={handleInstallDateUpdate}
      />
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('panels.name', 'Name')}
        </label>
        <DebouncedTextInput
          type="text"
          value={displayName}
          resetKey={panelId}
          onCommit={(v) => {
            if (v.trim().length === 0) return
            onUpdate(panelId, {
              nameByLocale: {
                [projectLocale]: v,
              },
              name:
                projectLocale === (currentProject?.project.locale ?? projectLocale)
                  ? v
                  : panel.name,
            })
          }}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('panels.location', 'Location')}
        </label>
        <DebouncedTextInput
          type="text"
          value={panel.location || ''}
          resetKey={panelId}
          onCommit={(v) => onUpdate(panelId, { location: v })}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
          placeholder={t('panels.location', 'Location')}
        />
      </div>
      {installation && !isHouseholdInstallation(installation) ? (
        <OptionalNumberField
          label={t('panels.expectedShortCircuit', 'Expected max. short-circuit current')}
          propertyField={`expectedShortCircuitKa:${panelId}`}
          unit="kA"
          value={panel.expectedShortCircuitKa}
          resetKey={panelId}
          onChange={(expectedShortCircuitKa) => onUpdate(panelId, { expectedShortCircuitKa })}
        />
      ) : null}
      {advancedPanelLabels ? (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={panelNumberingEnabled}
                onChange={(e) =>
                  // Project-wide, like the setting in the automatic labels dialog; circuit labels
                  // that include the panel number follow at once.
                  editProperties({
                    installation: { panelNumberingEnabled: e.target.checked },
                    refreshAutomaticNaming: true,
                  })
                }
              />
              {t('panels.panelNumbering', 'Panel numbering')}
            </label>
            <button
              type="button"
              onClick={() => openLabelSchemeDialog(t)}
              className="text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
            >
              {t('canvas.eendraadNaming.scheme.customize', 'Customize…')}
            </button>
          </div>
          {panelNumberingEnabled && panel ? (
            <div>
              <div className="mb-1 flex items-center gap-2">
                <label
                  htmlFor="panel-number-override"
                  className="flex-1 text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  {t('panels.panelNumber', 'Panel number')}
                </label>
                <AutomaticNamingOverrideControl
                  custom={!!panel.numberOverride}
                  automaticLabel={t('canvas.eendraadNaming.automaticStatus', 'Automatic')}
                  customLabel={t('canvas.eendraadNaming.customStatus', 'Custom')}
                  setCustomLabel={t('canvas.eendraadNaming.setCustomLabel', 'Set custom label')}
                  useAutomaticLabel={t('canvas.eendraadNaming.useAutomaticLabel', 'Use automatic label')}
                  onSetCustom={() => {
                    setPanelNumberOverride(panelCode ?? '')
                    panelNumberInputRef.current?.focus()
                    panelNumberInputRef.current?.select()
                  }}
                  onUseAutomatic={() => setPanelNumberOverride(null)}
                />
              </div>
              {/* Like circuit codes: always editable, and typing a different number makes it custom. */}
              <DebouncedTextInput
                ref={panelNumberInputRef}
                id="panel-number-override"
                type="text"
                value={panelCode ?? ''}
                resetKey={`${panelId}:${panelNumberReset}`}
                maxLength={12}
                onCommit={(value) => {
                  const typed = value.trim()
                  // An emptied field goes back to the current number, as circuit codes do.
                  if (!typed || typed === panelCode) setPanelNumberReset((count) => count + 1)
                  else setPanelNumberOverride(typed)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
              />
            </div>
          ) : null}

          {netTypeLabelsAvailable ? (
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={panelNetTypeLabelsEnabled}
                onChange={(e) => handlePanelNetTypeLabelsChange(e.target.checked)}
              />
              {t('panels.panelNetTypeLabels', 'Net type on diagram')}
            </label>
          ) : null}

          {netTypeLabelsAvailable && panelNetTypeLabelsEnabled ? (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t(
                  hasBackupFeed ? 'panels.earthingSystemGridLabel' : 'panels.earthingSystemLabel',
                  hasBackupFeed ? 'Earthing system (grid)' : 'Earthing system'
                )}
              </label>
              <CustomDropdown
                value={earthingValue}
                onChange={(nextValue) =>
                  onUpdate(panelId, {
                    earthingSystem:
                      nextValue === '' ? undefined : (nextValue as Panel['earthingSystem']),
                  })
                }
                options={earthingOptions}
                className={selectClass}
              />
              {hasBackupFeed ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('panels.earthingSystemBackupLabel', 'Earthing system (backup)')}
                  </label>
                  <CustomDropdown
                    value={panel.backupEarthingSystem ?? ''}
                    onChange={(nextValue) =>
                      onUpdate(panelId, {
                        backupEarthingSystem:
                          nextValue === ''
                            ? undefined
                            : (nextValue as Panel['backupEarthingSystem']),
                      })
                    }
                    options={earthingOptions}
                    className={selectClass}
                  />
                </div>
              ) : null}
              {panel.id !== mainPanel?.id && !earthingSyncedWithMain ? (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t(
                    'panels.earthingSystemCustom',
                    'Custom value — no longer synced with the main panel until set to the same system again.'
                  )}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-3">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t('panelCanvas.panelLayout', 'Panel layout')}
        </h4>
        <button
          type="button"
          aria-pressed={panel.gridView?.terminalStripTopRail ?? false}
          onClick={() =>
            updatePanelGrid(panelId, {
              terminalStripTopRail: !(panel.gridView?.terminalStripTopRail ?? false),
            })
          }
          className={`flex w-full items-center justify-center gap-3 rounded-md border-2 px-3 py-2 text-xs font-medium transition-colors ${
            panel.gridView?.terminalStripTopRail
              ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300'
              : 'border-gray-300 bg-white text-gray-700 hover:border-sky-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
          }`}
        >
          <img
            src="/symbols/junction/terminal_strip.svg"
            alt=""
            aria-hidden="true"
            className="h-8 w-8 opacity-90 dark:invert"
          />
          <span>{t('panelCanvas.topTerminalStripRail', 'Top clamp rail')}</span>
        </button>
        <PanelGridDimensionInput
          label={t('panelCanvas.rows')}
          value={panel.gridView?.rows ?? DEFAULT_PANEL_GRID_ROWS}
          min={1}
          max={32}
          onChange={(rows) => updatePanelGrid(panelId, { rows })}
        />
        <PanelGridDimensionInput
          label={t('panelCanvas.columns')}
          value={panel.gridView?.columns ?? DEFAULT_PANEL_GRID_COLUMNS}
          min={1}
          max={48}
          onChange={(columns) => updatePanelGrid(panelId, { columns })}
        />
        <PanelGridDimensionInput
          label={t('panelCanvas.fields')}
          value={getPanelGridFields(panel.gridView)}
          min={1}
          max={MAX_PANEL_GRID_FIELDS}
          onChange={(fields) => updatePanelGrid(panelId, { fields })}
        />
        <button
          type="button"
          aria-pressed={panel.gridView?.terminalStripBottomRail ?? false}
          onClick={() =>
            updatePanelGrid(panelId, {
              terminalStripBottomRail: !(panel.gridView?.terminalStripBottomRail ?? false),
            })
          }
          className={`flex w-full items-center justify-center gap-3 rounded-md border-2 px-3 py-2 text-xs font-medium transition-colors ${
            panel.gridView?.terminalStripBottomRail
              ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300'
              : 'border-gray-300 bg-white text-gray-700 hover:border-sky-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
          }`}
        >
          <img
            src="/symbols/junction/terminal_strip.svg"
            alt=""
            aria-hidden="true"
            className="h-8 w-8 opacity-90 dark:invert"
          />
          <span>{t('panelCanvas.bottomTerminalStripRail', 'Bottom clamp rail')}</span>
        </button>
      </div>
    </div>
  )
}
