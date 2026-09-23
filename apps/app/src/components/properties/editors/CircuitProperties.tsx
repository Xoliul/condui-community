import React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Eye, EyeOff, SeparatorHorizontal, SeparatorVertical } from 'lucide-react'
import { DebouncedTextInput, DebouncedTextarea } from '@/components/forms'
import CustomDropdown from '@/components/common/CustomDropdown'
import { useDialogStore } from '@/stores/dialogStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import type { Circuit } from '@/types/schema'
import { getDerivedCircuitKind } from '@/lib/circuitKind'
import { getManualCircuitLabelWarnings } from '@/lib/eendraad/automaticMainBusNaming'
import { logger } from '@/lib/logger'
import {
  buildCircuitInstallDateTargets,
  getInstallDateTargetInheritedYear,
  type InstallDatePropagationMode,
  type InstallDateTarget,
} from '@/lib/installDatePropagation'
import { isProtectionOnSupplyPanel } from '@/components/canvas/panel/panelGridLayout'
import { InstallDateField } from '../shared/propertiesShared'
import { ensureInstallDateTargetColors, visibilityToggleClass } from '../shared/propertiesSharedUtils'
import { AutomaticNamingOverrideControl } from '../shared/AutomaticNamingOverrideControl'
import { installationDateUpdateFromYear } from '@/lib/installDates'
import { getProjectElectricalInstallation } from '@/lib/projectV2/electrical'
// Circuit kind options for dropdown (order: general first, then special)
const CIRCUIT_KIND_OPTIONS: Array<{ value: Circuit['kind']; labelKey: string }> = [
  { value: 'lighting', labelKey: 'circuits.lighting' },
  { value: 'sockets', labelKey: 'circuits.sockets' },
  { value: 'fixed_appliance', labelKey: 'circuits.fixed_appliance' },
  { value: 'mixed', labelKey: 'circuits.mixed' },
  { value: 'stove', labelKey: 'circuits.stove' },
  { value: 'solar', labelKey: 'circuits.solar' },
  { value: 'battery', labelKey: 'circuits.battery' },
  { value: 'doorbell', labelKey: 'circuits.doorbell' },
  { value: 'subpanel', labelKey: 'circuits.subpanel' },
  { value: 'hvac', labelKey: 'circuits.hvac' },
  { value: 'ev', labelKey: 'circuits.ev' },
  { value: 'boiler', labelKey: 'circuits.boiler' },
  { value: 'heating', labelKey: 'circuits.heating' },
  { value: 'empty', labelKey: 'circuits.empty' },
  { value: 'other', labelKey: 'circuits.other' },
]

// Circuit Properties Component
export function CircuitProperties({
  circuitId,
  circuit,
  onUpdate,
}: {
  circuitId: string
  circuit: Circuit | undefined
  onUpdate: (id: string, updates: Partial<Circuit>) => void
}) {
  const { t } = useTranslation()
  const openDialog = useDialogStore((state) => state.openDialog)
  const currentProject = useProjectStore((state: ProjectState) => state.currentProject)
  const installation = useProjectStore((state: ProjectState) =>
    state.currentProject ? getProjectElectricalInstallation(state.currentProject) : undefined
  )
  const findPanelForCircuit = useProjectStore((state: ProjectState) => state.findPanelForCircuit)
  const getProtectionForCircuit = useProjectStore(
    (state: ProjectState) => state.getProtectionForCircuit
  )
  const updateEndpoint = useProjectStore((state: ProjectState) => state.updateEndpoint)
  const updateInstallation = useProjectStore((state: ProjectState) => state.updateInstallation)
  const withSingleUndoEntry = useProjectStore((state: ProjectState) => state.withSingleUndoEntry)
  const applyAutomaticNaming = useProjectStore(
    (state: ProjectState) => state.applyAutomaticEendraadNamingAllPanels
  )
  const [localCode, setLocalCode] = React.useState(circuit?.code || '')
  const codeInputRef = React.useRef<HTMLInputElement>(null)
  const [focusCustomLabel, setFocusCustomLabel] = React.useState(false)
  const derivedKind = circuit
    ? getDerivedCircuitKind(circuit, getProtectionForCircuit(circuitId))
    : 'other'

  const protectionForCircuit = getProtectionForCircuit(circuitId)
  const panelForCircuit = findPanelForCircuit(circuitId)
  const circuitNotesOrientation = installation?.circuitNotesOrientation ?? 'horizontal'
  const manualLabelOverride =
    (protectionForCircuit?.circuits?.some(
      (rowCircuit) => rowCircuit.eendraadManualCodeLock === true
    ) ?? false) || circuit?.eendraadManualCodeLock === true
  const automaticNamingRow =
    !!installation?.eendraadAutomaticNaming &&
    circuit?.code !== 'PANEL' &&
    !(
      protectionForCircuit &&
      panelForCircuit &&
      isProtectionOnSupplyPanel(panelForCircuit, protectionForCircuit.id)
    )
  const labelWarnings =
    manualLabelOverride && currentProject
      ? getManualCircuitLabelWarnings(panelForCircuit, circuitId, currentProject, localCode)
      : { nonStandard: false, duplicate: false }
  const labelWarningText = labelWarnings.nonStandard
    ? labelWarnings.duplicate
      ? t(
          'canvas.eendraadNaming.customLabelBothWarnings',
          'This custom label is outside the A, B, C… sequence and is also used by another circuit on this panel.'
        )
      : t(
          'canvas.eendraadNaming.customLabelNonStandardWarning',
          'This custom label is outside the A, B, C… sequence.'
        )
    : labelWarnings.duplicate
      ? t(
          'canvas.eendraadNaming.customLabelDuplicateWarning',
          'This label is also used by another circuit on this panel.'
        )
      : undefined

  React.useEffect(() => {
    if (circuit?.code !== localCode) {
      setLocalCode(circuit?.code || '')
    }
  }, [circuit?.code, localCode])

  React.useEffect(() => {
    if (!focusCustomLabel || !manualLabelOverride) return
    codeInputRef.current?.focus()
    codeInputRef.current?.select()
    setFocusCustomLabel(false)
  }, [focusCustomLabel, manualLabelOverride])

  const setCustomLabel = (focusInput = true) => {
    const rowCircuits = protectionForCircuit?.circuits ?? (circuit ? [circuit] : [])
    withSingleUndoEntry(() => {
      for (const rowCircuit of rowCircuits) {
        onUpdate(rowCircuit.id, { eendraadManualCodeLock: true })
      }
      return true
    })
    if (focusInput) setFocusCustomLabel(true)
  }

  const useAutomaticLabel = () => {
    const rowCircuits = protectionForCircuit?.circuits ?? (circuit ? [circuit] : [])
    withSingleUndoEntry(() => {
      for (const rowCircuit of rowCircuits) {
        onUpdate(rowCircuit.id, { eendraadManualCodeLock: undefined })
      }
      applyAutomaticNaming()
      return true
    })
  }

  const handleCodeChange = (value: string) => {
    // Don't trim here - preserve user input until they commit
    setLocalCode(value)
    if (automaticNamingRow && !manualLabelOverride) {
      setCustomLabel(false)
    }
  }

  const commitCodeChange = (raw = localCode) => {
    if (!circuit || !currentProject) {
      return
    }

    const newCode = raw.trim()

    // If code didn't change, do nothing
    if (newCode === circuit.code) {
      return
    }

    // Check if code is empty
    if (!newCode) {
      setLocalCode(circuit.code) // Revert to original
      return
    }

    if (!automaticNamingRow && !manualLabelOverride) {
      onUpdate(circuitId, { code: newCode })
      return
    }

    withSingleUndoEntry(() => {
      onUpdate(circuitId, { code: newCode })
      applyAutomaticNaming()
      return true
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitCodeChange()
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      // Revert to original on Escape
      e.preventDefault()
      setLocalCode(circuit?.code || '')
      e.currentTarget.blur()
    }
  }

  if (!circuit) {
    return (
      <div className="p-4 text-center text-gray-500">
        {t('circuits.notFound', 'Circuit not found')}
      </div>
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
        if (target.type === 'circuit') onUpdate(target.id, dateUpdate)
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
    if (year == null) {
      withSingleUndoEntry(() => {
        onUpdate(circuitId, updates)
        return true
      })
      return
    }
    const applyMode = (mode: InstallDatePropagationMode) => {
      logger.info('[install-date commit]', {
        source: 'circuit-properties',
        mode,
        year,
        circuitId,
        circuitCode: circuit.code,
        endpointIds: circuit.endpoints.map((endpoint) => endpoint.id),
        subCircuitIds: circuit.subCircuitIds ?? [],
        trunkDeviceIds: (circuit.trunkDevices ?? []).map((device) => device.id),
      })
      const targets = currentProject
        ? buildCircuitInstallDateTargets(currentProject, circuit, mode)
        : [{ id: circuitId, type: 'circuit' } as InstallDateTarget]
      logger.info('[install-date commit targets]', {
        source: 'circuit-properties',
        mode,
        year,
        circuitId,
        targets,
      })
      applyInstallDateTargets(targets, year)
    }
    openDialog({
      type: 'custom',
      title: t('installDates.propagateCircuitTitle', 'Change child devices too?'),
      content: (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t(
            'installDates.propagateCircuitMessage',
            'Choose whether this install date should feed down to the circuit consumers.'
          )}
        </p>
      ),
      buttons: [
        { label: t('common.no', 'No'), onClick: () => applyMode('self'), variant: 'secondary' },
        {
          label: t('installDates.propagateConsumers', 'Yes - consumers too'),
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
        entity={circuit}
        project={currentProject}
        inheritedYear={
          currentProject
            ? getInstallDateTargetInheritedYear(currentProject, { id: circuitId, type: 'circuit' })
            : undefined
        }
        onUpdate={handleInstallDateUpdate}
      />
      <div>
        <div className="flex items-center gap-2 mb-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-0 flex-1">
            {t('circuits.code', 'Code')}
          </label>
          {automaticNamingRow ? (
            <AutomaticNamingOverrideControl
              custom={manualLabelOverride}
              automaticLabel={t('canvas.eendraadNaming.automaticStatus', 'Automatic')}
              customLabel={t('canvas.eendraadNaming.customStatus', 'Custom')}
              setCustomLabel={t('canvas.eendraadNaming.setCustomLabel', 'Set custom label')}
              useAutomaticLabel={t(
                'canvas.eendraadNaming.useAutomaticLabel',
                'Use automatic label'
              )}
              onSetCustom={() => setCustomLabel()}
              onUseAutomatic={useAutomaticLabel}
            />
          ) : null}
          <button
            type="button"
            onClick={() =>
              onUpdate(circuitId, {
                eendraadLetterVisible: circuit.eendraadLetterVisible !== false ? false : true,
              })
            }
            className={visibilityToggleClass(circuit.eendraadLetterVisible !== false) + ' shrink-0'}
            title={t('canvas.eendraadNaming.toggleLetterOnOneWire')}
          >
            {circuit.eendraadLetterVisible !== false ? (
              <Eye className="w-4 h-4" />
            ) : (
              <EyeOff className="w-4 h-4" />
            )}
          </button>
        </div>
        <div className="relative">
          <DebouncedTextInput
            ref={codeInputRef}
            type="text"
            value={localCode}
            onDraftChange={handleCodeChange}
            onCommit={(v) => commitCodeChange(v)}
            onKeyDown={handleKeyDown}
            className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500 ${
              manualLabelOverride && (labelWarnings.nonStandard || labelWarnings.duplicate)
                ? 'pr-10'
                : ''
            }`}
            placeholder={t('circuits.code', 'Code')}
          />
          {manualLabelOverride && (labelWarnings.nonStandard || labelWarnings.duplicate) ? (
            <span
              className="absolute right-3 top-1/2 -translate-y-1/2"
              title={labelWarningText}
              aria-label={labelWarningText}
              role="img"
              onMouseDown={(event) => {
                event.preventDefault()
                codeInputRef.current?.focus()
              }}
            >
              <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
            </span>
          ) : null}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('circuits.kind', 'Type')}
        </label>
        <CustomDropdown
          value={circuit.kind}
          onChange={(nextValue) => onUpdate(circuitId, { kind: nextValue as Circuit['kind'] })}
          options={CIRCUIT_KIND_OPTIONS.map(({ value, labelKey }) => ({
            value,
            label: t(labelKey, value),
          }))}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
        />
        {derivedKind !== circuit.kind && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t('circuits.derivedHint', 'Suggested from circuit')}:{' '}
            {t(`circuits.${derivedKind}`, derivedKind)}
          </p>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('circuits.notes', 'Notes')}
          </label>
          <button
            type="button"
            onClick={() =>
              onUpdate(circuitId, { notesVisible: circuit.notesVisible !== false ? false : true })
            }
            className={visibilityToggleClass(circuit.notesVisible !== false)}
            title={
              circuit.notesVisible !== false
                ? t('circuits.notesHide', 'Hide on diagram')
                : t('circuits.notesShow', 'Show on diagram')
            }
          >
            {circuit.notesVisible !== false ? (
              <Eye className="w-4 h-4" />
            ) : (
              <EyeOff className="w-4 h-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() =>
              updateInstallation({
                circuitNotesOrientation:
                  circuitNotesOrientation === 'horizontal' ? 'vertical' : 'horizontal',
              })
            }
            className="one-wire-visibility-toggle p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-400"
            title={
              circuitNotesOrientation === 'horizontal'
                ? t('circuits.notesVertical', 'Draw notes vertically')
                : t('circuits.notesHorizontal', 'Draw notes horizontally')
            }
          >
            {circuitNotesOrientation === 'horizontal' ? (
              <SeparatorHorizontal className="w-4 h-4" />
            ) : (
              <SeparatorVertical className="w-4 h-4" />
            )}
          </button>
        </div>
        <DebouncedTextarea
          value={circuit.notes || ''}
          onCommit={(v) => onUpdate(circuitId, { notes: v })}
          delayMs={500}
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500 resize-none"
          placeholder={t('circuits.notes', 'Notes')}
        />
      </div>
    </div>
  )
}
