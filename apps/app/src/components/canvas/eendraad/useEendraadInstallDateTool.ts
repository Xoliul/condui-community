import { createElement } from 'react'
import { resolveInstallDateAnchorSelection } from '@/lib/eendraad/installDateAnchorSelection'

import type { useViewportUIApi } from '@/components/viewport/ViewportUIStore'

import {
  useCallback,
  useEffect,
  useMemo,
} from 'react'

import type { useTranslation } from 'react-i18next'

import { useProjectStore, type ProjectState } from '@/stores/projectStore'

import type { useDialogStore } from '@/stores/dialogStore'

import type { Selection } from '@/types/ui'
import type {
  Endpoint,
  Circuit,
  Panel,
  ProtectionDevice,
  TrunkDevice,
} from '@/types/schema'

import { logger } from '@/lib/logger'
import { editProperties } from '@/handlers/properties/editProperties'
import { updateProjectProperties } from '@/handlers/properties/editGeneralProperties'

import type { useEendraadLayout } from '@/hooks/eendraad'

import {
  getExplicitInstallationDate,
  getExplicitInstallYear,
  installationDateFromYear,
  installYearColor,
  normalizeInstallationDate,
  normalizeInstallYear,
} from '@/lib/installDates'
import {
  buildCircuitInstallDateTargets,
  buildInstallDateInheritanceIndex,
  buildPanelInstallDateTargets,
  buildProtectionInstallDateTargets,
  getInstallDateTargetInheritedYear,
  protectionHasInstallDateChildren,
  type InstallDatePropagationMode,
  type InstallDateTarget,
} from '@/lib/installDatePropagation'

import { clamp } from '@/lib/geometry'

import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from 'react'

type ViewportUIState = ReturnType<ReturnType<typeof useViewportUIApi>['getState']>
type DateToolFrameSelection = {
  year: number
  bounds: { x: number; y: number; width: number; height: number }
  selectionKey: string
} | null
interface EendraadInstallDateToolOptions extends Pick<ProjectState,
  'getCircuitById' | 'getEndpointById' | 'getPanelById' | 'getProtectionById' |
  'getTrunkDeviceById'> {
  canUseInstallDates: boolean
  closedDateToolSelectionKey: string | null
  containerRef: RefObject<HTMLDivElement | null>
  currentProject: ProjectState['currentProject']
  dateToolCalendarOpen: boolean
  dateToolDay: number
  dateToolFrameSelection: DateToolFrameSelection
  dateToolInputRef: RefObject<HTMLInputElement | null>
  dateToolMonth: number
  dateToolYear: string
  eendraadDateMarkingMode: boolean
  eendraadView: ViewportUIState['eendraadView']
  handleGetSelectionBounds: (selection?: Selection) => { x: number; y: number; width: number; height: number } | null
  i18n: ReturnType<typeof useTranslation>['i18n']
  layout: ReturnType<typeof useEendraadLayout>
  openDialog: ReturnType<typeof useDialogStore.getState>['openDialog']
  selection: Selection
  setClosedDateToolSelectionKey: Dispatch<SetStateAction<string | null>>
  setDateToolCalendarOpen: Dispatch<SetStateAction<boolean>>
  setDateToolDay: Dispatch<SetStateAction<number>>
  setDateToolFrameSelection: Dispatch<SetStateAction<DateToolFrameSelection>>
  setDateToolMonth: Dispatch<SetStateAction<number>>
  setDateToolYear: Dispatch<SetStateAction<string>>
  t: ReturnType<typeof useTranslation>['t']
}

export function useEendraadInstallDateTool({
  canUseInstallDates,
  closedDateToolSelectionKey,
  containerRef,
  currentProject,
  dateToolCalendarOpen,
  dateToolDay,
  dateToolFrameSelection,
  dateToolInputRef,
  dateToolMonth,
  dateToolYear,
  eendraadDateMarkingMode,
  eendraadView,
  getCircuitById,
  getEndpointById,
  getPanelById,
  getProtectionById,
  getTrunkDeviceById,
  handleGetSelectionBounds,
  i18n,
  layout,
  openDialog,
  selection,
  setClosedDateToolSelectionKey,
  setDateToolCalendarOpen,
  setDateToolDay,
  setDateToolFrameSelection,
  setDateToolMonth,
  setDateToolYear,
  t,
}: EendraadInstallDateToolOptions) {
  const selectedDateToolTargets = useMemo(() => {
    if (!currentProject) return []
    const targets: Array<{
      id: string
      type: 'panel' | 'protection' | 'circuit' | 'endpoint' | 'trunkDevice'
      entity:
        | NonNullable<ReturnType<typeof getPanelById>>
        | NonNullable<ReturnType<typeof getProtectionById>>
        | NonNullable<ReturnType<typeof getCircuitById>>
        | NonNullable<ReturnType<typeof getEndpointById>>
        | TrunkDevice
    }> = []
    for (const id of selection.ids) {
      const panel = getPanelById(id)
      if (panel) {
        targets.push({ id, type: 'panel', entity: panel })
        continue
      }
      const protection = getProtectionById(id)
      if (protection) {
        targets.push({ id, type: 'protection', entity: protection })
        continue
      }
      const circuit = getCircuitById(id)
      if (circuit) {
        targets.push({ id, type: 'circuit', entity: circuit })
        continue
      }
      const trunkResult = getTrunkDeviceById(id)
      const trunkDevice = trunkResult?.device
      if (trunkDevice) {
        if (trunkResult?.isSupplyDevice && trunkResult.supplyFeedScope === 'shared') continue
        targets.push({ id, type: 'trunkDevice', entity: trunkDevice })
        continue
      }
      const endpoint = getEndpointById(id)
      if (endpoint) {
        if (endpoint.symbol === 'panel_distribution' && endpoint.panelId) {
          const linkedPanel = getPanelById(endpoint.panelId)
          if (linkedPanel) {
            targets.push({ id: linkedPanel.id, type: 'panel', entity: linkedPanel })
            continue
          }
        }
        targets.push({ id, type: 'endpoint', entity: endpoint })
      }
    }
    return targets
  }, [
    currentProject,
    getCircuitById,
    getEndpointById,
    getPanelById,
    getProtectionById,
    getTrunkDeviceById,
    selection.ids,
  ])
  const dateToolAnchorSelection = useMemo(
    () => resolveInstallDateAnchorSelection(currentProject, layout, selectedDateToolTargets, selection),
    [currentProject, layout, selectedDateToolTargets, selection]
  )

  const selectedDateToolYear = useMemo(() => {
    const selectedTarget = selectedDateToolTargets[0]
    if (!currentProject || !selectedTarget) return new Date().getFullYear()
    return (
      getExplicitInstallYear(selectedTarget.entity) ??
      getInstallDateTargetInheritedYear(currentProject, selectedTarget)
    )
  }, [currentProject, selectedDateToolTargets])

  const selectedDateToolDate = useMemo(() => {
    const selectedTarget = selectedDateToolTargets[0]
    return (
      getExplicitInstallationDate(selectedTarget?.entity) ??
      installationDateFromYear(selectedDateToolYear)
    )
  }, [selectedDateToolTargets, selectedDateToolYear])

  const dateToolHasExplicitDate = useMemo(
    () => selectedDateToolTargets.some((target) => getExplicitInstallYear(target.entity) != null),
    [selectedDateToolTargets]
  )

  const dateToolSelectionKey =
    eendraadDateMarkingMode && selectedDateToolTargets.length > 0
      ? selectedDateToolTargets.map((target) => `${target.type}:${target.id}`).join('|')
      : null

  const applyInstallYearTargets = useCallback(
    (targets: InstallDateTarget[], date: string | undefined) => {
      const year = date ? Number(date.slice(0, 4)) : undefined
      const getTargetEntity = (target: InstallDateTarget) => {
        const suppliedEntity = (
          target as InstallDateTarget & {
            entity?: TrunkDevice | Panel | ProtectionDevice | Circuit | Endpoint
          }
        ).entity
        if (suppliedEntity) return suppliedEntity
        if (target.type === 'panel') return getPanelById(target.id)
        if (target.type === 'protection') return getProtectionById(target.id)
        if (target.type === 'circuit') return getCircuitById(target.id)
        if (target.type === 'endpoint') return getEndpointById(target.id)
        return getTrunkDeviceById(target.id)?.device
      }
      const inheritance = currentProject
        ? buildInstallDateInheritanceIndex(currentProject)
        : undefined
      const edits: Array<{
        kind: InstallDateTarget['type']
        ids: string[]
        set: {
          installationDate: string | null
          installationDateSuppressed: boolean | null
          rulesetDateOverride: null
        }
      }> = []
      for (const target of targets) {
        const inheritedYear = currentProject
          ? getInstallDateTargetInheritedYear(currentProject, target, inheritance)
          : undefined
        const requestedYear = target.preserveYear ?? year
        const existingDate = getExplicitInstallationDate(getTargetEntity(target))
        const targetDate =
          target.clearOverride ||
          target.explicitlyUnmark ||
          requestedYear == null ||
          (!target.forceOverride && requestedYear === inheritedYear)
            ? undefined
            : target.preserveYear != null && existingDate?.startsWith(`${requestedYear}-`)
              ? existingDate
              : target.preserveYear != null
                ? installationDateFromYear(requestedYear)
                : date
        const targetYear =
          target.clearOverride ||
          target.explicitlyUnmark ||
          (!target.forceOverride && requestedYear === inheritedYear)
            ? undefined
            : requestedYear
        const installationDateSuppressed = target.explicitlyUnmark ? true : undefined
        logger.info('[install-date apply target]', {
          type: target.type,
          id: target.id,
          requestedYear,
          inheritedYear,
          clearOverride: target.clearOverride === true,
          forceOverride: target.forceOverride === true,
          preserveYear: target.preserveYear,
          targetYear,
          targetDate,
        })
        if (target.type === 'trunkDevice') {
          const result = getTrunkDeviceById(target.id)
          if (result?.isSupplyDevice && result.supplyFeedScope === 'shared') continue
          if (!result) continue
        }
        edits.push({
          kind: target.type,
          ids: [target.id],
          set: {
            installationDate: targetDate ?? null,
            installationDateSuppressed: installationDateSuppressed ?? null,
            rulesetDateOverride: null,
          },
        })
      }
      // Colors for newly used years and every target's date change commit as one undo step.
      editProperties({
        edits,
        seedInstallDateColors: {
          targets: targets.map(
            ({ id, type, clearOverride, explicitlyUnmark, preserveYear, forceOverride }) => ({
              id,
              type,
              clearOverride,
              explicitlyUnmark,
              preserveYear,
              forceOverride,
            })
          ),
          year,
        },
      })
        const projectAfter = useProjectStore.getState().currentProject
        if (projectAfter) {
          logger.debug(
            '[install-date post-apply inherited years]',
            targets.map((target) => ({
              type: target.type,
              id: target.id,
              inheritedAfter: getInstallDateTargetInheritedYear(projectAfter, target),
            }))
          )
        }
    },
    [
      currentProject,
      getCircuitById,
      getEndpointById,
      getPanelById,
      getProtectionById,
      getTrunkDeviceById,
    ]
  )

  const commitInstallYearToSelection = useCallback(
    (rawDate: string) => {
      const currentYear = new Date().getFullYear()
      const date = normalizeInstallationDate(rawDate)
      const parsed = date ? Number(date.slice(0, 4)) : undefined
      const year = parsed == null ? undefined : clamp(parsed, 1900, currentYear)
      if (!canUseInstallDates || year == null || selectedDateToolTargets.length === 0) return

      const selectedTarget =
        selectedDateToolTargets.length === 1 ? selectedDateToolTargets[0] : null
      const applyMode = (mode: InstallDatePropagationMode) => {
        logger.info('[install-date commit]', {
          source: 'canvas-date-tool',
          mode,
          year,
          selectedTarget: selectedTarget
            ? {
                id: selectedTarget.id,
                type: selectedTarget.type,
                hasEntity: !!selectedTarget.entity,
                entityKeys: selectedTarget.entity ? Object.keys(selectedTarget.entity) : [],
              }
            : null,
          selectionTargets: selectedDateToolTargets.map((target) => ({
            id: target.id,
            type: target.type,
            hasEntity: !!target.entity,
          })),
        })
        if (!currentProject || !selectedTarget) {
          applyInstallYearTargets(selectedDateToolTargets, date)
        } else if (selectedTarget.type === 'panel') {
          applyInstallYearTargets(
            buildPanelInstallDateTargets(currentProject, selectedTarget.id, mode),
            date
          )
        } else if (
          selectedTarget.type === 'circuit' &&
          selectedTarget.entity &&
          'endpoints' in selectedTarget.entity
        ) {
          const targets = buildCircuitInstallDateTargets(
            currentProject,
            selectedTarget.entity,
            mode
          )
          logger.info('[install-date commit targets]', {
            source: 'canvas-date-tool',
            selectedType: 'circuit',
            mode,
            year,
            targets,
          })
          applyInstallYearTargets(targets, date)
        } else if (selectedTarget.type === 'protection') {
          const targets = buildProtectionInstallDateTargets(currentProject, selectedTarget.id, mode)
          logger.info('[install-date commit targets]', {
            source: 'canvas-date-tool',
            selectedType: 'protection',
            mode,
            year,
            targets,
          })
          applyInstallYearTargets(targets, date)
        } else {
          applyInstallYearTargets(selectedDateToolTargets, date)
        }
        setClosedDateToolSelectionKey(dateToolSelectionKey)
      }

      if (selectedTarget?.type === 'panel') {
        openDialog({
          type: 'custom',
          title: t('installDates.propagatePanelTitle', 'Change all child devices too?'),
          content: (
            createElement("p", { className: "text-sm text-gray-600 dark:text-gray-300" }, t(
                'installDates.propagatePanelMessage',
                'Choose whether this install date should feed down from the panel.'
              ))
          ),
          buttons: [
            { label: t('common.no', 'No'), onClick: () => applyMode('self'), variant: 'secondary' },
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
        return
      }

      if (selectedTarget?.type === 'circuit') {
        openDialog({
          type: 'custom',
          title: t('installDates.propagateCircuitTitle', 'Change child devices too?'),
          content: (
            createElement("p", { className: "text-sm text-gray-600 dark:text-gray-300" }, t(
                'installDates.propagateCircuitMessage',
                'Choose whether this install date should feed down to the circuit consumers.'
              ))
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
        return
      }

      if (
        selectedTarget?.type === 'protection' &&
        selectedTarget.entity &&
        'type' in selectedTarget.entity &&
        protectionHasInstallDateChildren(selectedTarget.entity as ProtectionDevice)
      ) {
        openDialog({
          type: 'custom',
          title: t('installDates.propagateCircuitTitle', 'Change child devices too?'),
          content: (
            createElement("p", { className: "text-sm text-gray-600 dark:text-gray-300" }, t(
                'installDates.propagateCircuitMessage',
                'Choose whether this install date should feed down to the circuit consumers.'
              ))
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
        return
      }

      applyMode('self')
      setClosedDateToolSelectionKey(dateToolSelectionKey)
    },
    [
      applyInstallYearTargets,
      canUseInstallDates,
      currentProject,
      dateToolSelectionKey,
      openDialog,
      selectedDateToolTargets,
      t,
      setClosedDateToolSelectionKey,
    ]
  )

  const clearSelectedInstallDates = useCallback(() => {
    if (!canUseInstallDates) return
    const explicitTargets = selectedDateToolTargets
      .filter((target) => getExplicitInstallYear(target.entity) != null)
      .map((target) => ({
        id: target.id,
        type: target.type,
        clearOverride: true,
        explicitlyUnmark: true,
      }))
    if (explicitTargets.length === 0) return
    applyInstallYearTargets(explicitTargets, undefined)
    setClosedDateToolSelectionKey(dateToolSelectionKey)
  }, [applyInstallYearTargets, canUseInstallDates, dateToolSelectionKey, selectedDateToolTargets, setClosedDateToolSelectionKey])

  const updateInstallDateColor = useCallback(
    (year: number, color: string) => {
      if (!currentProject || !canUseInstallDates) return
      updateProjectProperties({
        installDateColors: {
          ...(currentProject.project.installDateColors ?? {}),
          [String(year)]: color,
        },
      })
    },
    [canUseInstallDates, currentProject]
  )

  useEffect(() => {
    if (!dateToolSelectionKey || closedDateToolSelectionKey === dateToolSelectionKey) return
    const initialDate = dateToolFrameSelection
      ? installationDateFromYear(dateToolFrameSelection.year)
      : selectedDateToolDate
    setDateToolYear(initialDate.slice(0, 4))
    setDateToolMonth(Number(initialDate.slice(5, 7)))
    setDateToolDay(Number(initialDate.slice(8, 10)))
    setDateToolCalendarOpen(false)
    requestAnimationFrame(() => {
      dateToolInputRef.current?.focus()
      dateToolInputRef.current?.select()
    })
  }, [
    closedDateToolSelectionKey,
    dateToolFrameSelection,
    dateToolInputRef,
    dateToolSelectionKey,
    selectedDateToolDate,
    setDateToolCalendarOpen,
    setDateToolDay,
    setDateToolMonth,
    setDateToolYear,
  ])

  useEffect(() => {
    setClosedDateToolSelectionKey(null)
    // A frame click sets the selection and the frame context together; keep that
    // context while the selection still matches the clicked frame.
    const selectionKey = selection.ids.join('|')
    setDateToolFrameSelection((previous) =>
      previous?.selectionKey === selectionKey ? previous : null
    )
  }, [selection.ids, selection.type, setClosedDateToolSelectionKey, setDateToolFrameSelection])

  const dateToolSelectionBounds = useMemo(() => {
    if (!eendraadDateMarkingMode || !canUseInstallDates) return null
    if (!dateToolSelectionKey || closedDateToolSelectionKey === dateToolSelectionKey) return null
    if (dateToolFrameSelection) return dateToolFrameSelection.bounds
    if (!dateToolAnchorSelection.type || dateToolAnchorSelection.ids.length === 0) return null
    return handleGetSelectionBounds(dateToolAnchorSelection)
  }, [
    canUseInstallDates,
    closedDateToolSelectionKey,
    dateToolAnchorSelection,
    dateToolFrameSelection,
    dateToolSelectionKey,
    eendraadDateMarkingMode,
    handleGetSelectionBounds,
  ])

  const dateToolHelperStyle = useMemo(() => {
    if (!dateToolSelectionBounds) return null
    const container = containerRef.current
    const helperWidth = Math.min(296, Math.max(0, (container?.clientWidth ?? 312) - 16))
    const helperHeight = dateToolCalendarOpen ? 326 : 82
    const rawLeft =
      eendraadView.pan.x +
      (dateToolSelectionBounds.x + dateToolSelectionBounds.width) * eendraadView.zoom +
      14
    const rawTop = eendraadView.pan.y + dateToolSelectionBounds.y * eendraadView.zoom
    const maxLeft = Math.max(8, (container?.clientWidth ?? 0) - helperWidth - 8)
    const maxTop = Math.max(8, (container?.clientHeight ?? 0) - helperHeight - 8)
    return {
      left: clamp(rawLeft, 8, maxLeft),
      top: clamp(rawTop, 8, maxTop),
      width: helperWidth,
    }
  }, [dateToolCalendarOpen, dateToolSelectionBounds, eendraadView.pan.x, eendraadView.pan.y, eendraadView.zoom, containerRef])

  const currentInstallYear = new Date().getFullYear()
  const dateToolDraftYear = normalizeInstallYear(dateToolYear) ?? selectedDateToolYear
  const dateToolStoredColor = currentProject
    ? installYearColor(dateToolDraftYear, false, currentProject.project.installDateColors)
    : '#4b5563'
  const dateToolDaysInMonth = new Date(Date.UTC(dateToolDraftYear, dateToolMonth, 0)).getUTCDate()
  const dateToolMonthLabels = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) =>
        new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
          month: 'short',
          timeZone: 'UTC',
        }).format(new Date(Date.UTC(2024, index, 1)))
      ),
    [i18n.language, i18n.resolvedLanguage]
  )
  const dateToolSafeDay = Math.min(dateToolDay, dateToolDaysInMonth)
  const dateToolDraftDate = `${String(dateToolDraftYear).padStart(4, '0')}-${String(dateToolMonth).padStart(2, '0')}-${String(dateToolSafeDay).padStart(2, '0')}`
  const commitDateToolDraft = useCallback(() => {
    const parsed = normalizeInstallYear(dateToolYear)
    const clamped = parsed == null ? selectedDateToolYear : clamp(parsed, 1900, currentInstallYear)
    setDateToolYear(String(clamped))
    const safeDay = Math.min(
      dateToolDay,
      new Date(Date.UTC(clamped, dateToolMonth, 0)).getUTCDate()
    )
    setDateToolDay(safeDay)
    commitInstallYearToSelection(
      `${String(clamped).padStart(4, '0')}-${String(dateToolMonth).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`
    )
  }, [
    commitInstallYearToSelection,
    currentInstallYear,
    dateToolDay,
    dateToolMonth,
    dateToolYear,
    selectedDateToolYear,
    setDateToolDay,
    setDateToolYear,
  ])

  return {
    selectedDateToolYear,
    dateToolHasExplicitDate,
    dateToolSelectionKey,
    clearSelectedInstallDates,
    updateInstallDateColor,
    dateToolHelperStyle,
    currentInstallYear,
    dateToolDraftYear,
    dateToolStoredColor,
    dateToolDaysInMonth,
    dateToolMonthLabels,
    dateToolSafeDay,
    dateToolDraftDate,
    commitDateToolDraft,
  }
}
