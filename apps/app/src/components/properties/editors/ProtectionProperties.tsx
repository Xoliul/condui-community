import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Eye, EyeOff, SeparatorHorizontal, SeparatorVertical } from 'lucide-react'
import { DebouncedTextInput, DebouncedTextarea } from '@/components/forms'
import { useDialogStore } from '@/stores/dialogStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import type { Circuit, ProtectionDevice } from '@/types/schema'
import { getManualCircuitLabelWarnings } from '@/lib/eendraad/automaticMainBusNaming'
import {
  buildProtectionInstallDateTargets,
  getInstallDateTargetInheritedYear,
  protectionHasInstallDateChildren,
  type InstallDatePropagationMode,
  type InstallDateTarget,
} from '@/lib/installDatePropagation'
import { getVoltagePolesConfig } from '@/lib/protectionDefaults'
import {
  getProtectionTypeChangePatch,
  isProtectionLabelPartVisible,
  toggleProtectionLabelVisibility,
  type ProtectionLabelKey,
} from '@/lib/protectionLabels'
import { isProtectionOnSupplyPanel } from '@/lib/panel/panelGridLayout'
import { AutomaticNamingOverrideControl } from '../shared/AutomaticNamingOverrideControl'
import {
  ProtectionDeviceElectricalFields,
  getProtectionTypeDropdownOptions,
} from '../ProtectionDeviceElectricalFields'
import { InstallDateField } from '../shared/propertiesShared'
import { installationDateUpdateFromYear } from '@/lib/installDates'
import {
  labelClass,
  panelStringT,
  selectClass,
  visibilityToggleClass,
} from '../shared/propertiesSharedUtils'
import { getProjectElectricalInstallation } from '@/lib/projectV2/electrical'
import { editProperties } from '@/handlers/properties/editProperties'
// Protection Properties Component
export function ProtectionProperties({
  protectionId,
  protection,
  onUpdate,
  updateCircuit,
  getCircuitById,
}: {
  protectionId: string
  protection: ProtectionDevice | undefined
  onUpdate: (id: string, updates: Partial<ProtectionDevice>) => void
  updateCircuit: (id: string, updates: Partial<Circuit>) => void
  getCircuitById: (id: string) => Circuit | undefined
}) {
  const { t } = useTranslation()
  const currentProject = useProjectStore((state: ProjectState) => state.currentProject)
  const installation = currentProject
    ? getProjectElectricalInstallation(currentProject)
    : undefined
  const openDialog = useDialogStore((state) => state.openDialog)
  const panelForProtection = useProjectStore((state: ProjectState) =>
    state.getPanelForProtection(protectionId)
  )

  // For protections with circuits (like MCB), we edit the circuit notes, not protection notes
  const circuitsOfProtection = protection?.circuits
  const hasCircuits = Boolean(circuitsOfProtection?.length)
  const firstCircuit = circuitsOfProtection?.[0] ? getCircuitById(circuitsOfProtection[0].id) : null
  const labelInputRef = useRef<HTMLInputElement>(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const consumedFocusRequest = useRef(0)
  const [customLabelDraft, setCustomLabelDraft] = useState(false)
  const [labelDraft, setLabelDraft] = useState(protection?.label ?? '')
  const protectionTypeOptions = useMemo(() => getProtectionTypeDropdownOptions(panelStringT(t), 'panel'), [t])

  const autoNaming = !!installation?.eendraadAutomaticNaming
  const manualLabelOverride =
    circuitsOfProtection?.some(
      (circuit) => getCircuitById(circuit.id)?.eendraadManualCodeLock === true
    ) === true
  /** Supply-strip protections stay manually editable; main-bus rows with circuits support automatic/custom naming. */
  const automaticNamingRow =
    autoNaming &&
    hasCircuits &&
    !isProtectionOnSupplyPanel(panelForProtection, protectionId)
  const labelWarnings =
    manualLabelOverride && currentProject && firstCircuit
      ? getManualCircuitLabelWarnings(
          panelForProtection,
          firstCircuit.id,
          currentProject,
          labelDraft
        )
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

  useEffect(() => {
    if (focusRequest === consumedFocusRequest.current || !manualLabelOverride) return
    labelInputRef.current?.focus()
    labelInputRef.current?.select()
    consumedFocusRequest.current = focusRequest
  }, [focusRequest, manualLabelOverride])

  const [labelSource, setLabelSource] = useState({ protectionId, label: protection?.label })
  if (labelSource.protectionId !== protectionId || labelSource.label !== protection?.label) {
    setLabelSource({ protectionId, label: protection?.label })
    setLabelDraft(protection?.label ?? '')
    setCustomLabelDraft(false)
  }

  const setCustomLabel = (focusInput = true) => {
    const ids = (circuitsOfProtection ?? []).map((circuit) => circuit.id)
    if (ids.length > 0) {
      editProperties({
        edits: [{ kind: 'circuit', ids, set: { eendraadManualCodeLock: true } }],
      })
    }
    if (focusInput) setFocusRequest((request) => request + 1)
  }

  const useAutomaticLabel = () => {
    const ids = (circuitsOfProtection ?? []).map((circuit) => circuit.id)
    if (ids.length > 0) {
      editProperties({
        edits: [{ kind: 'circuit', ids, set: { eendraadManualCodeLock: undefined } }],
        refreshAutomaticNaming: true,
      })
    }
  }

  const commitProtectionLabel = (value: string) => {
    if (customLabelDraft && firstCircuit) {
      editProperties({
        edits: [{ kind: 'protection', ids: [protectionId], set: { label: value } }],
        actions: [{ kind: 'lockCircuitRowForCode', circuitId: firstCircuit.id }],
        refreshAutomaticNaming: true,
      })
      setCustomLabelDraft(false)
      return
    }
    if (!automaticNamingRow && !manualLabelOverride) {
      onUpdate(protectionId, { label: value })
      return
    }
    editProperties({
      edits: [{ kind: 'protection', ids: [protectionId], set: { label: value } }],
      refreshAutomaticNaming: true,
    })
  }

  if (!protection) {
    return (
      <div className="p-4 text-center text-gray-500">
        {t('protections.notFound', 'Protection device not found')}
      </div>
    )
  }

  const isProtectionLabelVisible = (key: ProtectionLabelKey) =>
    isProtectionLabelPartVisible(protection, key)

  const toggleProtectionLabel = (key: ProtectionLabelKey) => {
    onUpdate(protectionId, {
      symbolLabelDisplay: toggleProtectionLabelVisibility(protection, key),
    })
  }

  const applyInstallDateTargets = (targets: InstallDateTarget[], year: number | undefined) => {
    const grouped = new Map<
      string,
      { kind: 'protection' | 'circuit' | 'endpoint' | 'trunkDevice'; ids: string[]; set: ReturnType<typeof installationDateUpdateFromYear> }
    >()
    for (const target of targets) {
      if (target.type === 'panel') continue
      if (
        target.type === 'trunkDevice' &&
        useProjectStore.getState().getTrunkDeviceById(target.id)?.supplyFeedScope === 'shared'
      ) continue
      const inheritedYear = currentProject
        ? getInstallDateTargetInheritedYear(currentProject, target)
        : undefined
      const requestedYear = target.preserveYear ?? year
      const targetYear =
        target.clearOverride || (!target.forceOverride && requestedYear === inheritedYear)
          ? undefined
          : requestedYear
      const set = installationDateUpdateFromYear(targetYear)
      const key = `${target.type}:${JSON.stringify(set)}`
      const existing = grouped.get(key)
      if (existing) existing.ids.push(target.id)
      else grouped.set(key, { kind: target.type, ids: [target.id], set })
    }
    editProperties({
      edits: [...grouped.values()].map(({ kind, ids, set }) => ({ kind, ids, set })),
      seedInstallDateColors: currentProject
        ? { targets: targets.filter((target) => target.type !== 'panel'), year }
        : undefined,
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
      onUpdate(protectionId, updates)
      return
    }
    const applyMode = (mode: InstallDatePropagationMode) =>
      applyInstallDateTargets(
        buildProtectionInstallDateTargets(currentProject, protectionId, mode),
        year
      )

    if (!protectionHasInstallDateChildren(protection)) {
      applyMode('self')
      return
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
        entity={protection}
        project={currentProject}
        inheritedYear={
          currentProject
            ? getInstallDateTargetInheritedYear(currentProject, {
                id: protectionId,
                type: 'protection',
              })
            : undefined
        }
        onUpdate={handleInstallDateUpdate}
      />
      <div>
        <div className="flex items-center gap-2 mb-1">
          <label className={`${labelClass} mb-0 flex-1`}>
            {t('protections.label', 'Label')}
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
          {firstCircuit ? (
            <button
              type="button"
              onClick={() => {
                const hide = firstCircuit.eendraadLetterVisible !== false
                const ids = (circuitsOfProtection ?? []).map((r) => r.id)
                if (ids.length > 0) {
                  editProperties({
                    edits: [{ kind: 'circuit', ids, set: { eendraadLetterVisible: !hide } }],
                  })
                }
              }}
              className={visibilityToggleClass(firstCircuit.eendraadLetterVisible !== false)}
              title={t('canvas.eendraadNaming.toggleLetterOnOneWire')}
            >
              {firstCircuit.eendraadLetterVisible !== false ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
          ) : null}
        </div>
        <div className="relative">
          <DebouncedTextInput
            ref={labelInputRef}
            type="text"
            value={protection.label}
            onDraftChange={(value) => {
              setLabelDraft(value)
              if (automaticNamingRow && !manualLabelOverride) {
                setCustomLabelDraft(true)
              }
            }}
            onCommit={commitProtectionLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
            className={`${selectClass} ${
              manualLabelOverride && (labelWarnings.nonStandard || labelWarnings.duplicate)
                ? 'pr-10'
                : ''
            }`}
            placeholder={t('protections.label', 'Label')}
          />
          {manualLabelOverride && (labelWarnings.nonStandard || labelWarnings.duplicate) ? (
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 border-0 bg-transparent p-0"
              title={labelWarningText}
              aria-label={labelWarningText}
              onClick={() => labelInputRef.current?.focus()}
              onMouseDown={(event) => {
                event.preventDefault()
                labelInputRef.current?.focus()
              }}
            >
              <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
      <ProtectionDeviceElectricalFields
        t={t}
        selectClass={selectClass}
        labelClass={labelClass}
        visibilityToggleClass={visibilityToggleClass}
        protectionType={protection.type}
        ratingA={protection.ratingA}
        curve={protection.curve}
        sensitivityMa={protection.sensitivityMa}
        residualCurrentType={protection.residualCurrentType}
        selective={protection.selective}
        superImmunized={protection.superImmunized}
        breakingCapacityKa={protection.breakingCapacityKa}
        breakingCapacityOption={protection.breakingCapacityOption}
        surgeProtectionKind={protection.surgeProtectionKind}
        polesConfig={protection.polesConfig}
        poles={protection.poles}
        typeDropdownOptions={protectionTypeOptions}
        onProtectionTypeChange={(nextType) => {
          const next = nextType as ProtectionDevice['type']
          const polesConfig = protection.polesConfig ?? getVoltagePolesConfig(currentProject)
          onUpdate(protectionId, {
            type: next,
            ...getProtectionTypeChangePatch(protection, next, polesConfig),
          })
        }}
        onPatch={(patch) => onUpdate(protectionId, patch)}
        isProtectionLabelVisible={isProtectionLabelVisible}
        toggleProtectionLabel={toggleProtectionLabel}
        tripTarget={{ kind: 'protection', protection }}
      />

      {/* Notes - for protections with circuits, edit circuit notes (with show/orientation toggles); otherwise edit protection notes */}
      {hasCircuits && firstCircuit ? (
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label
              className={labelClass + ' mb-0 cursor-help'}
              title={t('circuits.notesHint', 'What this circuit feeds, shown on the one-wire diagram.')}
            >
              {t('circuits.notes', 'Notes')}
            </label>
            <button
              type="button"
              onClick={() =>
                updateCircuit(firstCircuit.id, {
                  notesVisible: firstCircuit.notesVisible !== false ? false : true,
                })
              }
              className={visibilityToggleClass(firstCircuit.notesVisible !== false)}
              title={
                firstCircuit.notesVisible !== false
                  ? t('circuits.notesHide', 'Hide on diagram')
                  : t('circuits.notesShow', 'Show on diagram')
              }
            >
              {firstCircuit.notesVisible !== false ? (
                <Eye className="w-4 h-4" />
              ) : (
                <EyeOff className="w-4 h-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() =>
                editProperties({
                  installation: {
                    circuitNotesOrientation:
                      (installation?.circuitNotesOrientation ?? 'horizontal') === 'horizontal'
                        ? 'vertical'
                        : 'horizontal',
                  },
                })
              }
              className="one-wire-visibility-toggle p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-400"
              title={
                (installation?.circuitNotesOrientation ?? 'horizontal') === 'horizontal'
                  ? t('circuits.notesVertical', 'Draw notes vertically')
                  : t('circuits.notesHorizontal', 'Draw notes horizontally')
              }
            >
              {(installation?.circuitNotesOrientation ?? 'horizontal') === 'horizontal' ? (
                <SeparatorHorizontal className="w-4 h-4" />
              ) : (
                <SeparatorVertical className="w-4 h-4" />
              )}
            </button>
          </div>
          <DebouncedTextarea
            value={firstCircuit.notes || ''}
            onCommit={(v) => updateCircuit(firstCircuit.id, { notes: v })}
            delayMs={500}
            rows={4}
            className={`${selectClass} resize-none`}
            placeholder={t('circuits.notes', 'Notes')}
          />
        </div>
      ) : (
        <div>
          <label
            className={labelClass + ' cursor-help'}
            title={t('circuits.notesHint', 'What this circuit feeds, shown on the one-wire diagram.')}
          >
            {t('protections.description', 'Description')}
          </label>
          <DebouncedTextarea
            value={protection.notes || ''}
            onCommit={(v) => onUpdate(protectionId, { notes: v })}
            delayMs={500}
            rows={4}
            className={`${selectClass} resize-none`}
            placeholder={t('protections.description', 'Description')}
          />
        </div>
      )}

      {/* Short text for the cabinet label; when filled, the notes stay off the label. */}
      <div>
        <label
          className={labelClass + ' cursor-help'}
          title={t('protections.labelTextHint', 'Short text for the cabinet label; replaces the notes on the label.')}
        >
          {t('protections.labelText', 'Label text')}
        </label>
        <DebouncedTextarea
          value={protection.labelNotes || ''}
          onCommit={(v) => onUpdate(protectionId, { labelNotes: v })}
          delayMs={500}
          rows={2}
          className={`${selectClass} resize-none`}
          placeholder={t('protections.labelText', 'Label text')}
        />
      </div>
    </div>
  )
}
