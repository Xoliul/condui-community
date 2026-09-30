import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { GripVertical, X } from 'lucide-react'
import { type SymbolMetadata } from '@/lib/symbols'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useUIStore, type UIState } from '@/stores/uiStore'
import { collectCircuits, flattenPanels } from '@/utils/eendraad/panelHelpers'
import {
  buildPlanDropAvailableCircuitCodeOptions,
  comparePlanDropCircuitCodes,
  endpointTypeToPlanDropKind,
  getPlanDropCircuitInsertIndexForCode,
  isEligiblePlanDropTarget,
  orderPlanDropCircuitsForDisplay,
  pickDefaultPlanDropCircuitId,
  planDropCircuitIssues,
  type PlanDropKind,
} from '@/lib/plan/planDropPicker'
import { getEndpointTypeFromSymbol } from '@/utils'
import { createEmptyCircuitOnPanel } from '@/handlers/plan/dropHandlers'
import type { Circuit } from '@/types/schema'
import {
  selectProjectElectricalInstallation,
  selectProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { APP_MODAL_BACKDROP_ATTR } from '@/lib/ui/appModalInteraction'
import { clamp } from '@/lib/geometry'
import {
  EDITOR_TOP_BAR_HEIGHT_PX,
  PLAN_DROP_CIRCUIT_PANEL_Z_INDEX,
} from '@/constants/layoutConstants'
import { flushPendingProjectHistory } from '@/stores/slices/projectStoreInternals'
import { finalizePlanDropCircuitPickerUndoGroup } from '@/lib/plan/planDropCircuitSession'

const CREATE_NEW_ID = '__plan_drop_create_new__'
const PANEL_WIDTH = 352
const PANEL_MIN_TOP_PX = EDITOR_TOP_BAR_HEIGHT_PX + 8

const PANEL_ESTIMATED_HEIGHT = 400
const VIEWPORT_MARGIN_PX = 8
/** Keeps the picker off the canvas toolbars along the plan's edges. */
const CANVAS_TOOLBAR_INSET_PX = 64
const ANCHOR_CLEARANCE_PX = 48

type PanelFrame = { left: number; top: number }
type ScreenRect = { left: number; top: number; right: number; bottom: number }

/** Where the user last dragged the picker this page session; reused for every later drop. */
let rememberedFrame: PanelFrame | null = null

function clampFrame(frame: PanelFrame, height: number): PanelFrame {
  return {
    left: clamp(
      frame.left,
      VIEWPORT_MARGIN_PX,
      window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN_PX
    ),
    top: clamp(frame.top, PANEL_MIN_TOP_PX, window.innerHeight - height - VIEWPORT_MARGIN_PX),
  }
}

/**
 * Opens in the corner of the plan canvas farthest from the drop, clear of the canvas
 * toolbars, so the symbol just placed (and the next spot to click) stays visible.
 */
export function initialPlanDropPanelFrame(
  anchor: { x: number; y: number },
  bounds: ScreenRect,
  height: number
): PanelFrame {
  const fitsInside = bounds.right - bounds.left >= PANEL_WIDTH + 2 * CANVAS_TOOLBAR_INSET_PX
  const area = fitsInside
    ? {
        left: bounds.left + CANVAS_TOOLBAR_INSET_PX,
        right: bounds.right - CANVAS_TOOLBAR_INSET_PX,
        top: bounds.top + CANVAS_TOOLBAR_INSET_PX,
        bottom: bounds.bottom - CANVAS_TOOLBAR_INSET_PX,
      }
    : {
        left: VIEWPORT_MARGIN_PX,
        right: window.innerWidth - VIEWPORT_MARGIN_PX,
        top: PANEL_MIN_TOP_PX,
        bottom: window.innerHeight - VIEWPORT_MARGIN_PX,
      }
  const lefts = [area.left, area.right - PANEL_WIDTH]
  const tops = [area.top, area.bottom - height]
  let best: { frame: PanelFrame; score: number } | null = null
  for (const left of lefts) {
    for (const top of tops) {
      const frame = clampFrame({ left, top }, height)
      const coversAnchor =
        anchor.x >= frame.left - ANCHOR_CLEARANCE_PX &&
        anchor.x <= frame.left + PANEL_WIDTH + ANCHOR_CLEARANCE_PX &&
        anchor.y >= frame.top - ANCHOR_CLEARANCE_PX &&
        anchor.y <= frame.top + height + ANCHOR_CLEARANCE_PX
      const distance = Math.hypot(
        frame.left + PANEL_WIDTH / 2 - anchor.x,
        frame.top + height / 2 - anchor.y
      )
      const score = distance - (coversAnchor ? 100_000 : 0)
      if (!best || score > best.score) best = { frame, score }
    }
  }
  return best?.frame ?? clampFrame({ left: anchor.x, top: anchor.y }, height)
}

export interface PlanDropCircuitPanelProps {
  /** Endpoints to assign (one after a plan drop, several from multi-select context menu). */
  endpointIds: string[]
  /** Panel / circuit baseline for the primary endpoint (first id). */
  assignedPanelId: string
  assignedCircuitId: string
  symbol: SymbolMetadata
  dropKind: PlanDropKind
  clientAnchor: { x: number; y: number }
  /** Screen rect of the plan canvas; the picker opens inside it, away from the drop. */
  avoidBounds?: ScreenRect
  /** The close (×) button was used, as opposed to Done, Esc or an outside click. */
  onCloseButton?: () => void
  /** Undo stack index where this picker session starts (collapse on close). */
  undoGroupStartIndex: number
  /** Circuits created for this drop that should be removed when abandoned. */
  provisionalCircuitIds?: string[]
  onDismiss: () => void
  /** Let clicks pass the backdrop (armed library placement keeps stamping while the picker is open). */
  nonModal?: boolean
  /** Called after endpoints were moved to `circuitId` (plan + one-wire split view uses this to fit the diagram). */
  onAfterCircuitAssignment?: (circuitId: string) => void
}

function PlanDropCircuitPanelInner({
  endpointIds,
  assignedPanelId,
  assignedCircuitId,
  symbol,
  dropKind,
  clientAnchor,
  avoidBounds,
  onCloseButton,
  undoGroupStartIndex,
  provisionalCircuitIds = [],
  onDismiss,
  nonModal = false,
  onAfterCircuitAssignment,
}: PlanDropCircuitPanelProps) {
  const { t } = useTranslation()
  const panelRootRef = useRef<HTMLDivElement>(null)
  const getDefaultBounds = () => ({
    left: 0,
    top: PANEL_MIN_TOP_PX,
    right: window.innerWidth,
    bottom: window.innerHeight,
  })
  const [frame, setFrame] = useState<PanelFrame>(() =>
    rememberedFrame
      ? clampFrame(rememberedFrame, PANEL_ESTIMATED_HEIGHT)
      : initialPlanDropPanelFrame(
          clientAnchor,
          avoidBounds ?? getDefaultBounds(),
          PANEL_ESTIMATED_HEIGHT
        )
  )
  const frameRef = useRef(frame)
  frameRef.current = frame

  // Re-fit with the measured height (the estimate can land it on the drop or off-screen).
  useLayoutEffect(() => {
    const height = panelRootRef.current?.offsetHeight
    if (!height) return
    setFrame(
      rememberedFrame
        ? clampFrame(rememberedFrame, height)
        : initialPlanDropPanelFrame(clientAnchor, avoidBounds ?? getDefaultBounds(), height)
    )
    // Only on open: later anchor changes remount the panel (keyed by endpoint).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dragRef = useRef<{
    startX: number
    startY: number
    origLeft: number
    origTop: number
  } | null>(null)

  const onDragPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const f = frameRef.current
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: f.left,
      origTop: f.top,
    }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])
  const draggedRef = useRef(false)

  const onDragPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const estH = panelRootRef.current?.offsetHeight ?? PANEL_ESTIMATED_HEIGHT
    const nextLeft = clamp(
      d.origLeft + (e.clientX - d.startX),
      8,
      window.innerWidth - PANEL_WIDTH - 8
    )
    const nextTop = clamp(
      d.origTop + (e.clientY - d.startY),
      PANEL_MIN_TOP_PX,
      window.innerHeight - estH - 8
    )
    draggedRef.current = true
    setFrame({ left: nextLeft, top: nextTop })
  }, [])

  const onDragPointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null
    if (draggedRef.current) {
      draggedRef.current = false
      rememberedFrame = frameRef.current
    }
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }, [])

  const currentProject = useProjectStore((s: ProjectState) => s.currentProject)
  const getCircuitIdentifier = useProjectStore((s: ProjectState) => s.getCircuitIdentifier)
  const getProtectionForCircuit = useProjectStore((s: ProjectState) => s.getProtectionForCircuit)
  const lastWorkedCircuitId = useProjectStore((s: ProjectState) => s.lastWorkedCircuitId)
  const findCircuitForEndpoint = useProjectStore((s: ProjectState) => s.findCircuitForEndpoint)
  const withSingleUndoEntry = useProjectStore((s: ProjectState) => s.withSingleUndoEntry)

  const planDropLastCircuitIdByDropKind = useUIStore((s: UIState) => s.planDropLastCircuitIdByDropKind)
  const setPlanDropPreference = useUIStore((s: UIState) => s.setPlanDropPreference)

  const endpointType = getEndpointTypeFromSymbol(symbol)
  const derivedDropKind: PlanDropKind = endpointType
    ? endpointTypeToPlanDropKind(endpointType)
    : dropKind

  const panelsFlat = useMemo(
    () => (currentProject ? flattenPanels(selectProjectElectricalPanels(currentProject)) : []),
    [currentProject]
  )

  const showPanelPicker = panelsFlat.length > 1

  const [selectedPanelId, setSelectedPanelId] = useState(assignedPanelId)
  const [selectedCircuitId, setSelectedCircuitId] = useState<string>(assignedCircuitId)
  const [newCircuitCodeDraft, setNewCircuitCodeDraft] = useState('')

  const sessionCreatedCircuitIdsRef = useRef(new Set(provisionalCircuitIds))
  const undoGroupFinalizedRef = useRef(false)

  const circuitKindLabel = useCallback(
    (derivedKind: string | undefined) => {
      if (!derivedKind) return ''
      if (derivedKind === 'empty') return t('planDrop.emptyKind', 'Empty')
      return t(`circuits.${derivedKind}`, derivedKind)
    },
    [t]
  )

  const circuitRows = useMemo(() => {
    const panel = panelsFlat.find((p) => p.id === selectedPanelId)
    if (!panel) return []
    const raw = collectCircuits(panel)
    return raw.filter((c) => c.code !== 'PANEL')
  }, [panelsFlat, selectedPanelId])

  const selectedPanel = useMemo(
    () => panelsFlat.find((p) => p.id === selectedPanelId),
    [panelsFlat, selectedPanelId]
  )

  const automaticCircuitNaming = Boolean(
    currentProject ? selectProjectElectricalInstallation(currentProject)?.eendraadAutomaticNaming : false
  )

  const ignoredEndpointIds = useMemo(() => new Set(endpointIds), [endpointIds])

  const eligibilityMap = useMemo(() => {
    const map = new Map<string, boolean>()
    const derivedMap = new Map<string, string>()
    for (const c of circuitRows) {
      const prot = getProtectionForCircuit(c.id)
      const { derivedKind, issues } = planDropCircuitIssues(c, prot, derivedDropKind, {
        ignoredEndpointIds,
      })
      derivedMap.set(c.id, derivedKind)
      map.set(c.id, isEligiblePlanDropTarget(issues))
    }
    return { eligibilityMap: map, derivedMap }
  }, [circuitRows, derivedDropKind, getProtectionForCircuit, ignoredEndpointIds])

  const orderedCircuitIds = useMemo(() => circuitRows.map((c) => c.id), [circuitRows])

  const selectedProvisionalCircuitId = sessionCreatedCircuitIdsRef.current.has(selectedCircuitId)
    ? selectedCircuitId
    : null

  const orderedCircuitRows = useMemo(() => {
    const stableRows = circuitRows.filter(
      (circuit) => !sessionCreatedCircuitIdsRef.current.has(circuit.id)
    )
    return orderPlanDropCircuitsForDisplay(
      stableRows,
      (id) => eligibilityMap.eligibilityMap.get(id) === true,
      (a, b) =>
        comparePlanDropCircuitCodes(getCircuitIdentifier(a.id), getCircuitIdentifier(b.id))
    )
  }, [circuitRows, eligibilityMap.eligibilityMap, getCircuitIdentifier])

  const preferredCircuitRows = orderedCircuitRows.preferred
  const otherCircuitRows = orderedCircuitRows.other

  const pickDefault = useCallback(() => {
    const lastFor = planDropLastCircuitIdByDropKind[derivedDropKind]
    return pickDefaultPlanDropCircuitId({
      orderedCircuitIds,
      isEligible: (id) => eligibilityMap.eligibilityMap.get(id) === true,
      lastForDropKind: lastFor,
      lastWorkedCircuitId,
    })
  }, [
    derivedDropKind,
    eligibilityMap.eligibilityMap,
    lastWorkedCircuitId,
    orderedCircuitIds,
    planDropLastCircuitIdByDropKind,
  ])

  const removeAbandonedProvisionalCircuits = useCallback((keepCircuitId: string) => {
    const { deleteCircuit, getCircuitById } = useProjectStore.getState()
    for (const circuitId of [...sessionCreatedCircuitIdsRef.current]) {
      if (circuitId === keepCircuitId) continue
      const circuit = getCircuitById(circuitId)
      if (!circuit) {
        sessionCreatedCircuitIdsRef.current.delete(circuitId)
        continue
      }
      const hasLoad = circuit.endpoints.some((e) => e.symbol !== 'panel_distribution')
      if (!hasLoad) {
        deleteCircuit(circuitId)
        sessionCreatedCircuitIdsRef.current.delete(circuitId)
      }
    }
  }, [])

  const moveCircuitToCodeSortedPosition = useCallback((panelId: string, circuitId: string) => {
    const store = useProjectStore.getState()
    const project = store.currentProject
    if (!project) return
    const panel = flattenPanels(selectProjectElectricalPanels(project)).find((p) => p.id === panelId)
    const circuit = store.getCircuitById(circuitId)
    const code = circuit?.code?.trim()
    if (!panel || !code) return
    const insertIndex = getPlanDropCircuitInsertIndexForCode(panel, circuitId, code)
    store.moveCircuitToMainBus(panelId, circuitId, insertIndex)
  }, [])

  const applyNewCircuitCode = useCallback(
    (rawCode: string) => {
      const targetCircuitId = selectedProvisionalCircuitId
      const panelId = selectedPanelId
      if (!targetCircuitId || !panelId) return
      const requestedCode = automaticCircuitNaming ? rawCode.trim().toUpperCase() : rawCode.trim()
      if (!requestedCode) return

      flushPendingProjectHistory()
      withSingleUndoEntry(() => {
        const store = useProjectStore.getState()
        const project = store.currentProject
        if (!project) return false
        const panel = flattenPanels(selectProjectElectricalPanels(project)).find((p) => p.id === panelId)
        if (!panel) return false
        const insertIndex = getPlanDropCircuitInsertIndexForCode(panel, targetCircuitId, requestedCode)
        store.updateCircuit(targetCircuitId, {
          code: requestedCode,
          ...(automaticCircuitNaming ? { eendraadManualCodeLock: true } : {}),
        })
        store.moveCircuitToMainBus(panelId, targetCircuitId, insertIndex)
        return true
      })
      setNewCircuitCodeDraft(requestedCode)
    },
    [automaticCircuitNaming, selectedPanelId, selectedProvisionalCircuitId, withSingleUndoEntry]
  )

  useEffect(() => {
    const primaryEndpointId = endpointIds[0]
    if (!primaryEndpointId) return
    const liveAssignment = findCircuitForEndpoint(primaryEndpointId)
    if (!liveAssignment) return
    setSelectedPanelId(liveAssignment.panel.id)
    setSelectedCircuitId(liveAssignment.circuit.id)
  }, [currentProject, endpointIds, findCircuitForEndpoint])

  const applyCircuitSelection = useCallback(
    (choice: string) => {
      if (!selectedPanelId) return

      flushPendingProjectHistory()

      let targetCircuitId = choice
      let anyMoved = false
      let applied = false

      const changed = withSingleUndoEntry(() => {
        if (choice === CREATE_NEW_ID) {
          if (selectedProvisionalCircuitId) {
            targetCircuitId = selectedProvisionalCircuitId
          } else {
            const newCircuitId = createEmptyCircuitOnPanel(selectedPanelId, derivedDropKind)
            if (!newCircuitId) return false
            sessionCreatedCircuitIdsRef.current.add(newCircuitId)
            targetCircuitId = newCircuitId
          }
        }

        const store = useProjectStore.getState()
        const primaryEndpointId = endpointIds[0]
        const currentCircuitId = primaryEndpointId
          ? store.findCircuitForEndpoint(primaryEndpointId)?.circuit.id
          : undefined

        for (const endpointId of endpointIds) {
          const cur = store.findCircuitForEndpoint(endpointId)?.circuit.id
          if (cur !== targetCircuitId) {
            store.moveEndpointToCircuit(endpointId, targetCircuitId)
            anyMoved = true
          }
        }

        removeAbandonedProvisionalCircuits(targetCircuitId)
        if (sessionCreatedCircuitIdsRef.current.has(targetCircuitId)) {
          moveCircuitToCodeSortedPosition(selectedPanelId, targetCircuitId)
        }
        applied = anyMoved || currentCircuitId !== targetCircuitId || choice === CREATE_NEW_ID
        return applied
      })

      if (!changed && !applied) return

      setSelectedCircuitId(targetCircuitId)

      if (applied) {
        setPlanDropPreference(selectedPanelId, derivedDropKind, targetCircuitId)
        onAfterCircuitAssignment?.(targetCircuitId)
      }
    },
    [
      derivedDropKind,
      endpointIds,
      onAfterCircuitAssignment,
      removeAbandonedProvisionalCircuits,
      moveCircuitToCodeSortedPosition,
      selectedProvisionalCircuitId,
      selectedPanelId,
      setPlanDropPreference,
      withSingleUndoEntry,
    ]
  )

  const finalizeUndoGroup = useCallback(() => {
    if (undoGroupFinalizedRef.current) return
    undoGroupFinalizedRef.current = true
    finalizePlanDropCircuitPickerUndoGroup(undoGroupStartIndex)
  }, [undoGroupStartIndex])

  const handleDismiss = useCallback(() => {
    finalizeUndoGroup()
    onDismiss()
  }, [finalizeUndoGroup, onDismiss])

  const skipPanelCircuitSyncRef = useRef(true)
  useEffect(() => {
    if (skipPanelCircuitSyncRef.current) {
      skipPanelCircuitSyncRef.current = false
      return
    }
    const d = pickDefault()
    if (d) applyCircuitSelection(d)
    else applyCircuitSelection(CREATE_NEW_ID)
    // Only when the user switches distribution board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPanelId])

  useEffect(() => () => finalizeUndoGroup(), [finalizeUndoGroup])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        handleDismiss()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleDismiss])

  const renderCircuitRow = (circuit: Circuit) => {
    const eligible = eligibilityMap.eligibilityMap.get(circuit.id) === true
    const derivedKind = eligibilityMap.derivedMap.get(circuit.id)
    const label = getCircuitIdentifier(circuit.id)
    const kindLabel = circuitKindLabel(derivedKind)
    const selected = selectedCircuitId === circuit.id

    return (
      <button
        key={circuit.id}
        type="button"
        data-testid="plan-drop-circuit-row"
        data-circuit-code={label}
        data-eligible={eligible ? 'true' : 'false'}
        data-selected={selected ? 'true' : 'false'}
        onClick={() => applyCircuitSelection(circuit.id)}
        className={`w-full cursor-pointer text-left rounded-md border px-3 py-2.5 transition-colors ${
          selected
            ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-500/70 dark:bg-sky-900/30'
            : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/40'
        } ${!eligible ? 'opacity-[0.72]' : ''}`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span
            className={`text-base font-semibold ${!eligible ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'}`}
          >
            {label}
          </span>
          {kindLabel && (
            <span className="text-xs text-gray-500 dark:text-gray-400">{kindLabel}</span>
          )}
        </div>
      </button>
    )
  }

  const newCircuitSelected = Boolean(selectedProvisionalCircuitId)
  const newCircuitIdentifier = selectedProvisionalCircuitId
    ? getCircuitIdentifier(selectedProvisionalCircuitId)
    : ''
  const newCircuitLabel = newCircuitIdentifier
    ? `${t('planDrop.newCircuit', 'New circuit')} (${newCircuitIdentifier})`
    : t('planDrop.newCircuit', 'New circuit')
  const newCircuitCodeOptions =
    selectedPanel && selectedProvisionalCircuitId
      ? buildPlanDropAvailableCircuitCodeOptions(selectedPanel, selectedProvisionalCircuitId)
      : []

  useEffect(() => {
    if (!selectedProvisionalCircuitId) {
      setNewCircuitCodeDraft('')
      return
    }
    setNewCircuitCodeDraft(getCircuitIdentifier(selectedProvisionalCircuitId))
  }, [getCircuitIdentifier, selectedProvisionalCircuitId])

  const shell = (
    <div
      {...(nonModal ? {} : { [APP_MODAL_BACKDROP_ATTR]: 'true' })}
      className={nonModal ? 'pointer-events-none fixed inset-0' : 'fixed inset-0'}
      style={{ zIndex: PLAN_DROP_CIRCUIT_PANEL_Z_INDEX }}
      onClick={nonModal ? undefined : handleDismiss}
    >
      <div
        {...(nonModal ? { [APP_MODAL_BACKDROP_ATTR]: 'true' } : {})}
        ref={panelRootRef}
        data-plan-circuit-panel
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-drop-circuit-heading"
        className="pointer-events-auto absolute flex max-h-[min(520px,92vh)] w-[min(100vw-16px,352px)] flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-800"
        style={{ left: frame.left, top: frame.top }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex cursor-grab items-center gap-2 border-b border-gray-100 bg-gray-50/90 px-2 py-2 active:cursor-grabbing dark:border-gray-700 dark:bg-gray-900/80"
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerUp}
          onPointerCancel={onDragPointerUp}
        >
          <span className="shrink-0 text-gray-400" aria-hidden>
            <GripVertical className="h-5 w-5" />
          </span>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-white shadow-inner dark:bg-gray-800">
            <img
              src={symbol.svgPath}
              alt=""
              className="max-h-9 max-w-9 object-contain dark:invert"
              draggable={false}
            />
          </div>
          <h2
            id="plan-drop-circuit-heading"
            className="min-w-0 flex-1 text-base font-semibold leading-tight text-gray-900 dark:text-white"
          >
            {t('planDrop.adjustHeadline', 'Circuit')}
          </h2>
          <button
            type="button"
            onClick={() => {
              onCloseButton?.()
              handleDismiss()
            }}
            className="shrink-0 rounded-md p-2 text-gray-500 hover:bg-gray-200/80 hover:text-gray-800 dark:hover:bg-gray-700 dark:hover:text-gray-100"
            aria-label={t('common.close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" data-library-scroll="true">
          <div className="space-y-4">
            {showPanelPicker && (
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('planDrop.panelLabel', 'Board')}
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {panelsFlat.map((p) => {
                    const active = p.id === selectedPanelId
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedPanelId(p.id)}
                        className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                          active
                            ? 'border-sky-500 bg-sky-50 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100'
                            : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700'
                        }`}
                      >
                        {p.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t('planDrop.circuitHeading', 'Circuit')}
              </h3>
              <div
                className="max-h-52 space-y-1.5 overflow-y-auto pr-0.5"
                data-library-scroll="true"
              >
                {preferredCircuitRows.map(renderCircuitRow)}
                <div
                  role="button"
                  tabIndex={0}
                  data-testid="plan-drop-new-circuit-row"
                  data-selected={newCircuitSelected ? 'true' : 'false'}
                  onClick={() => applyCircuitSelection(CREATE_NEW_ID)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    applyCircuitSelection(CREATE_NEW_ID)
                  }}
                  className={`w-full rounded-md border border-dashed px-3 py-2.5 text-left transition-colors ${
                    newCircuitSelected
                      ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-500/70 dark:bg-sky-900/30'
                      : 'border-gray-300 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700/40'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-base font-semibold italic text-gray-900 dark:text-white">
                      + {newCircuitLabel}
                    </span>
                    {newCircuitSelected && (
                      <>
                        {automaticCircuitNaming ? (
                          <select
                            aria-label={t('planDrop.newCircuitCodeLabel', 'Circuit code')}
                            value={newCircuitCodeDraft}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                            onChange={(event) => applyNewCircuitCode(event.target.value)}
                            className="min-w-20 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm font-semibold text-gray-900 shadow-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                          >
                            {newCircuitCodeOptions.map((code) => (
                              <option key={code} value={code}>
                                {code}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <>
                            <input
                              aria-label={t('planDrop.newCircuitCodeLabel', 'Circuit code')}
                              value={newCircuitCodeDraft}
                              list="plan-drop-new-circuit-code-options"
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => {
                                event.stopPropagation()
                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  applyNewCircuitCode(newCircuitCodeDraft)
                                }
                              }}
                              onChange={(event) => setNewCircuitCodeDraft(event.target.value)}
                              onBlur={() => applyNewCircuitCode(newCircuitCodeDraft)}
                              className="min-w-20 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm font-semibold text-gray-900 shadow-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                            />
                            <datalist id="plan-drop-new-circuit-code-options">
                              {newCircuitCodeOptions.map((code) => (
                                <option key={code} value={code} />
                              ))}
                            </datalist>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {otherCircuitRows.map(renderCircuitRow)}
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 bg-gray-50/90 px-3 py-3 dark:border-gray-700 dark:bg-gray-900/80">
          <button
            type="button"
            onClick={handleDismiss}
            className="w-full rounded-md bg-sky-600 px-4 py-2.5 text-base font-semibold text-white shadow-sm transition hover:bg-sky-700 dark:bg-sky-600 dark:hover:bg-sky-500"
          >
            {t('planDrop.done', 'Done')}
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(shell, document.body)
}

export default function PlanDropCircuitPanel(props: PlanDropCircuitPanelProps) {
  return <PlanDropCircuitPanelInner {...props} />
}
