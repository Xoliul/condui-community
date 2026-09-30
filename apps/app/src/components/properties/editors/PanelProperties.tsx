import { useMemo } from 'react'
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
import { InstallDateField } from '../shared/propertiesShared'
import { ensureInstallDateTargetColors, selectClass } from '../shared/propertiesSharedUtils'
import { installationDateUpdateFromYear } from '@/lib/installDates'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { DEFAULT_PANEL_GRID_COLUMNS, DEFAULT_PANEL_GRID_ROWS } from '@/lib/panel/panelGridDefaults'
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
  const updateInstallation = useProjectStore((s: ProjectState) => s.updateInstallation)
  const updatePanelGrid = useProjectStore((s: ProjectState) => s.updatePanelGrid)
  const updateProtection = useProjectStore((s: ProjectState) => s.updateProtection)
  const updateCircuit = useProjectStore((s: ProjectState) => s.updateCircuit)
  const updateEndpoint = useProjectStore((s: ProjectState) => s.updateEndpoint)
  const withSingleUndoEntry = useProjectStore((s: ProjectState) => s.withSingleUndoEntry)
  const openDialog = useDialogStore((s) => s.openDialog)
  const { advancedPanelLabels } = useEditionFeatureAvailability(currentProject?.project.id)

  const projectLocale = currentProject?.project.locale ?? i18n.language
  const displayName = panel?.nameByLocale?.[projectLocale] ?? panel?.name ?? ''
  const installation = currentProject ? getProjectElectricalInstallation(currentProject) : undefined
  const panelNumberingEnabled = !!installation?.panelNumberingEnabled
  const panelNetTypeLabelsEnabled = !!installation?.panelNetTypeLabelsEnabled
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

  const handlePanelNetTypeLabelsChange = (enabled: boolean) => {
    updateInstallation({ panelNetTypeLabelsEnabled: enabled })
    if (enabled && !earthingValue) {
      onUpdate(panelId, { earthingSystem: 'TT' })
    }
  }

  if (!panel) {
    return (
      <div className="p-4 text-center text-gray-500">{t('panels.notFound', 'Panel not found')}</div>
    )
  }

  const applyInstallDateTargets = (targets: InstallDateTarget[], year: number | undefined) => {
    withSingleUndoEntry(() => {
      ensureInstallDateTargetColors(currentProject, targets, year)
      for (const target of targets) {
        const inheritedYear = currentProject
          ? getInstallDateTargetInheritedYear(currentProject, target)
          : undefined
        const requestedYear = target.preserveYear ?? year
        const targetYear =
          target.clearOverride || (!target.forceOverride && requestedYear === inheritedYear)
            ? undefined
            : requestedYear
        const dateUpdate = installationDateUpdateFromYear(targetYear)
        if (target.type === 'panel') onUpdate(target.id, dateUpdate)
        else if (target.type === 'protection') updateProtection(target.id, dateUpdate)
        else if (target.type === 'circuit') updateCircuit(target.id, dateUpdate)
        else if (target.type === 'endpoint') updateEndpoint(target.id, dateUpdate)
        else if (target.type === 'trunkDevice') {
          const result = useProjectStore.getState().getTrunkDeviceById(target.id)
          if (result?.isSupplyDevice) {
            if (result.supplyFeedScope === 'shared') continue
            useProjectStore.getState().updateSupplyTrunkDevice(target.id, dateUpdate)
          } else if (result?.isGroundDevice) {
            useProjectStore.getState().updateGroundTrunkDevice(target.id, dateUpdate)
          } else if (result?.circuit) {
            useProjectStore.getState().updateTrunkDevice(result.circuit.id, target.id, dateUpdate)
          }
        }
      }
      return true
    })
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
      withSingleUndoEntry(() => {
        onUpdate(panelId, updates)
        return true
      })
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
                ...(panel.nameByLocale ?? {}),
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
      {advancedPanelLabels ? (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-4">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={panelNumberingEnabled}
              onChange={(e) => updateInstallation({ panelNumberingEnabled: e.target.checked })}
            />
            {t('panels.panelNumbering', 'Panel numbering')}
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2">
            {t(
              'panels.panelNumberingHint',
              'Adds B01, B02, … in order from the main panel through sub-panels on the one-wire diagram.'
            )}
          </p>

          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={panelNetTypeLabelsEnabled}
              onChange={(e) => handlePanelNetTypeLabelsChange(e.target.checked)}
            />
            {t('panels.panelNetTypeLabels', 'Net type on diagram')}
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 -mt-2">
            {t(
              'panels.panelNetTypeLabelsHint',
              'Adds supply, voltage, and earthing lines on the one-wire panel header when an earthing system is set.'
            )}
          </p>

          {panelNetTypeLabelsEnabled ? (
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
