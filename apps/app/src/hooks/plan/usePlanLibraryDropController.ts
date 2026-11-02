import type { usePlanCanvasMarqueeSelection } from '@/hooks/plan/usePlanCanvasMarqueeSelection'
import type { usePlanCanvasGeometry } from '@/hooks/plan/usePlanCanvasGeometry'
import type React from 'react'
import { useCallback, useState, useEffect } from 'react'
import { flushSync } from 'react-dom'
import { logger } from '@/lib/logger'
import { useProjectStore } from '@/stores/projectStore'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import { canSymbolAppearOnSituationPlan } from '@/lib/plan/situationPlanSymbolEligibility'
import { getSymbolById, type SymbolMetadata } from '@/lib/symbols'
import type { CanvasDropMeta, Point } from '@/types/ui'
import { usePendingImportStore } from '@/stores/pendingImportStore'
import { commitPlanSymbolDrop } from '@/handlers/plan/dropHandlers'
import {
  endpointTypeToPlanDropKind,
  resolveInitialPlanDropAssignment,
} from '@/lib/plan/planDropPicker'
import { finalizePlanDropCircuitPickerUndoGroup } from '@/lib/plan/planDropCircuitSession'
import { requestEendraadCircuitFitThenRestoreSelection } from '@/lib/eendraad/focusCircuit'
import { getEndpointTypeFromSymbol } from '@/utils'
import { usePlanContextMenu } from '@/hooks/plan'
import { collectCircuits, flattenPanels } from '@/utils/eendraad/panelHelpers'
import { createPlanGraphicElementDraft } from '@/lib/plan/graphicElements'
import { selectProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { isSupportedPlanImportFile } from '@/components/plan/planImportFiles'

interface PlanLibraryDropControllerOptions {
  currentProject: import('@/types/projectV2').ProjectV2 | null
  activeFloorId: string | null
  snapPlacementPosition: ReturnType<typeof usePlanCanvasGeometry>['snapPlacementPosition']
  getFloorById: (id: string) => import('@/types/schema').Floor | undefined
  applySelection: (selection: import('@/types/ui').Selection) => void
  containerRef: React.RefObject<HTMLDivElement | null>
  window: globalThis.Window
  viewportUI: import('zustand/vanilla').StoreApi<import('@/stores/uiStore').UIState>
  planDropCircuitPickerOpenRef: React.RefObject<boolean>
  applyPlanDropCircuitPicker: React.Dispatch<
    React.SetStateAction<{
      endpointIds: string[]
      assignedPanelId: string
      assignedCircuitId: string
      symbol: import('@/lib/symbols').SymbolMetadata
      clientAnchor: { x: number; y: number }
      dropKind: import('@/lib/plan/planDropPicker').PlanDropKind
      undoGroupStartIndex: number
      provisionalCircuitIds: string[]
      avoidBounds: DOMRect | undefined
    } | null>
  >
  eendraadIsInLayout: boolean
  planDropPickerDismissedWhileArmedRef: React.RefObject<boolean>
  requestFitToView: (canvases: import('@/types/ui').CanvasType[]) => void
  setPendingImportFile: React.Dispatch<React.SetStateAction<File | null>>
  applyIsImportDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
  canEditFloorPlan: boolean
  planToClient: (plan: import('@/types/ui').Point) => { x: number; y: number }
  canvasPxPerMeter: number
  applySelectedGraphicAssetId: React.Dispatch<React.SetStateAction<string>>
  applyGraphicElementDropPicker: React.Dispatch<
    React.SetStateAction<{
      planPosition: import('@/types/ui').Point
      clientAnchor: import('@/types/ui').Point
    } | null>
  >
  isFloorPlanMode: boolean
  applyAddElementDropPosition: React.Dispatch<
    React.SetStateAction<import('@/types/ui').Point | null>
  >
  getPlacementWorldBoundsMemo: ReturnType<
    typeof usePlanCanvasMarqueeSelection
  >['getPlacementWorldBoundsMemo']
}

export function usePlanLibraryDropController({
  currentProject,
  activeFloorId,
  snapPlacementPosition,
  getFloorById,
  applySelection,
  containerRef,
  window,
  viewportUI,
  planDropCircuitPickerOpenRef,
  applyPlanDropCircuitPicker,
  eendraadIsInLayout,
  planDropPickerDismissedWhileArmedRef,
  requestFitToView,
  setPendingImportFile,
  applyIsImportDialogOpen,
  canEditFloorPlan,
  planToClient,
  canvasPxPerMeter,
  applySelectedGraphicAssetId,
  applyGraphicElementDropPicker,
  isFloorPlanMode,
  applyAddElementDropPosition,
  getPlacementWorldBoundsMemo,
}: PlanLibraryDropControllerOptions) {
  const handleDrop = useCallback(
    (position: Point, symbolData: unknown, meta?: CanvasDropMeta) => {
      if (!currentProject) {
        logger.warn('PlanCanvas: No current project')
        return
      }

      if (!activeFloorId) {
        logger.warn('PlanCanvas: No active floor selected')
        return
      }

      const snappedPosition = snapPlacementPosition(position)

      const symbol = symbolData as SymbolMetadata
      if (!symbol || !symbol.id) {
        logger.warn('PlanCanvas: Invalid symbol data:', symbolData)
        return
      }

      if (!canSymbolAppearOnSituationPlan(symbol.id)) {
        logger.warn('PlanCanvas: Symbol is unavailable on the situation plan:', symbol.id)
        return
      }

      const activeFloor = getFloorById(activeFloorId)
      if (!activeFloor) return

      if (symbol.id === 'earthing') {
        const outcome = runProjectCommand(
          'plan.dropEarthing',
          {
            floorId: activeFloorId,
            layer: activeFloor.layers?.[0] || 'electrical',
            pos: snappedPosition,
          },
          { source: 'plan-library-drop' }
        )
        if (outcome) applySelection({ type: 'ground', ids: ['ground'] })
        return
      }

      if (symbol.id === 'note') {
        const outcome = runProjectCommand(
          'annotation.createNote',
          {
            scope: 'sitplan',
            floorId: activeFloorId,
            pos: snappedPosition,
          },
          { source: 'plan-library-drop' }
        )
        const noteId = outcome?.results[0]?.created[0]?.id
        if (noteId) applySelection({ type: 'note', ids: [noteId] })
        return
      }

      if (symbol.id === 'panel_distribution') {
        const outcome = runProjectCommand('plan.placeSymbol', {
          symbolId: symbol.id,
          floorId: activeFloorId,
          floorLayer: activeFloor.layers?.[0] || 'electrical',
          pos: snappedPosition,
        })
        const panelId = outcome?.results[0]?.select?.[0]?.id
        if (panelId) applySelection({ type: 'panel', ids: [panelId] })
        return
      }

      const endpointType = getEndpointTypeFromSymbol(symbol)
      if (!endpointType) return

      const floorLayer = activeFloor.layers?.[0] || 'electrical'

      const clientAnchor: { x: number; y: number } = meta
        ? { x: meta.clientX, y: meta.clientY }
        : (() => {
            const r = containerRef.current?.getBoundingClientRect()
            if (r) {
              return {
                x: r.left + Math.min(r.width * 0.72, r.width - 200),
                y: r.top + 88,
              }
            }
            return { x: window.innerWidth * 0.55, y: 96 }
          })()

      const ui = viewportUI.getState()
      const proj = useProjectStore.getState()
      const assignment = resolveInitialPlanDropAssignment(
        currentProject,
        symbol,
        {
          planDropLastPanelId: ui.planDropLastPanelId,
          planDropLastCircuitIdByDropKind: ui.planDropLastCircuitIdByDropKind,
          lastWorkedCircuitId: proj.lastWorkedCircuitId,
        },
        proj.getProtectionForCircuit
      )
      if (!assignment) return

      // An armed placement can land while the previous drop's picker is still open: close it
      // first so its unmount collapses only its own undo entries, not this drop's.
      if (planDropCircuitPickerOpenRef.current) {
        flushSync(() => applyPlanDropCircuitPicker(null))
      }

      const undoGroupStartIndex = useProjectStore.getState().undoStack.length

      const committed = commitPlanSymbolDrop({
        symbol,
        position: snappedPosition,
        floorId: activeFloorId,
        floorLayer,
        panelId: assignment.panelId,
        circuitChoice: assignment.circuitChoice,
        setSelection: applySelection,
      })
      if (!committed) return

      const cid = useProjectStore.getState().lastWorkedCircuitId
      if (cid) {
        ui.setPlanDropPreference(assignment.panelId, assignment.dropKind, cid)
      }

      if (eendraadIsInLayout) {
        requestEendraadCircuitFitThenRestoreSelection({
          circuitId: committed.circuitId,
          restoreSelection: { type: 'placement', ids: [committed.placementId] },
          setSelection: applySelection,
          requestFitToView,
        })
      }

      if (
        planDropPickerDismissedWhileArmedRef.current &&
        viewportUI.getState().armedLibrarySymbol != null
      ) {
        finalizePlanDropCircuitPickerUndoGroup(undoGroupStartIndex)
        return
      }

      applyPlanDropCircuitPicker({
        avoidBounds: containerRef.current?.getBoundingClientRect(),
        endpointIds: [committed.endpointId],
        assignedPanelId: committed.panelId,
        assignedCircuitId: committed.circuitId,
        symbol,
        clientAnchor,
        dropKind: assignment.dropKind,
        undoGroupStartIndex,
        provisionalCircuitIds: assignment.circuitChoice.mode === 'new' ? [committed.circuitId] : [],
      })
    },
    [
      activeFloorId,
      currentProject,
      eendraadIsInLayout,
      getFloorById,
      requestFitToView,
      applySelection,
      snapPlacementPosition,
      window,
      viewportUI,
      planDropCircuitPickerOpenRef,
      planDropPickerDismissedWhileArmedRef,
      applyPlanDropCircuitPicker,
      containerRef,
    ]
  )

  const [libraryDropPreview, setLibraryDropPreview] = useState<{
    symbolId: string
    pos: Point
  } | null>(null)
  const handleLibraryDragOver = useCallback(
    (position: Point, symbolData: unknown | null) => {
      const symbol = symbolData as SymbolMetadata | null
      if (
        !symbol?.id ||
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y) ||
        !canSymbolAppearOnSituationPlan(symbol.id)
      ) {
        setLibraryDropPreview(null)
        return
      }
      setLibraryDropPreview({ symbolId: symbol.id, pos: snapPlacementPosition(position) })
    },
    [snapPlacementPosition]
  )

  const handlePlanFilesDrop = useCallback(
    (files: File[]) => {
      const supportedFile = files.find(isSupportedPlanImportFile)
      if (!supportedFile) return
      setPendingImportFile(supportedFile)
      applyIsImportDialogOpen(true)
    },
    [applyIsImportDialogOpen, setPendingImportFile]
  )

  const closeImportDialog = useCallback(() => {
    applyIsImportDialogOpen(false)
    setPendingImportFile(null)
  }, [applyIsImportDialogOpen, setPendingImportFile])

  // Main menu Import > Floor plan: the menu reveals this canvas, then asks it to open the dialog.
  const pendingPlanImport = usePendingImportStore((state) => state.planImport)
  useEffect(() => {
    if (!pendingPlanImport || !canEditFloorPlan) return
    if (!usePendingImportStore.getState().takePlanImport()) return
    setPendingImportFile(null)
    applyIsImportDialogOpen(true)
  }, [pendingPlanImport, canEditFloorPlan, applyIsImportDialogOpen, setPendingImportFile])

  const openContextAssignCircuitPanel = useCallback(
    (endpointIds: string[], planAnchor: Point) => {
      const store = useProjectStore.getState()
      const project = store.currentProject
      const firstId = endpointIds[0]
      if (!firstId || !project) return

      const ep = store.getEndpointById(firstId)
      if (!ep) return

      const symbol = ep.symbol ? getSymbolById(ep.symbol) : undefined
      if (!symbol) return

      const dropKind = endpointTypeToPlanDropKind(ep.type)
      const info = store.findCircuitForEndpoint(firstId)

      let assignedPanelId: string
      let assignedCircuitId: string

      if (info) {
        assignedPanelId = info.panel.id
        assignedCircuitId = info.circuit.id
      } else {
        const panelsFlat = flattenPanels(selectProjectElectricalPanels(project))
        const panel = panelsFlat[0]
        if (!panel) return
        const circuits = collectCircuits(panel).filter((c) => c.code !== 'PANEL')
        if (circuits.length === 0) return
        assignedPanelId = panel.id
        assignedCircuitId = circuits[0]!.id
      }

      applyPlanDropCircuitPicker({
        avoidBounds: containerRef.current?.getBoundingClientRect(),
        endpointIds,
        assignedPanelId,
        assignedCircuitId,
        symbol,
        dropKind,
        clientAnchor: planToClient(planAnchor),
        undoGroupStartIndex: store.undoStack.length,
        provisionalCircuitIds: [],
      })
    },
    [planToClient, applyPlanDropCircuitPicker, containerRef]
  )

  const handleAddGraphicElementFromContextMenu = useCallback(
    (position: Point, assetId: string) => {
      if (!activeFloorId || canvasPxPerMeter <= 0) return
      const draft = createPlanGraphicElementDraft(
        activeFloorId,
        assetId,
        position,
        canvasPxPerMeter
      )
      if (!draft) return
      const { floorId, kind, ...element } = draft
      const outcome = runProjectCommand(
        'plan.createBuildingGeometry',
        {
          kind: 'graphicElement',
          floorId,
          elementKind: kind,
          ...element,
        },
        { label: 'add plan graphic', source: 'plan-canvas-context-menu' }
      )
      const createdId = outcome?.results[0]?.created[0]?.id
      applySelectedGraphicAssetId(assetId)
      if (createdId) applySelection({ type: 'graphicElement', ids: [createdId] })
      applyGraphicElementDropPicker(null)
    },
    [
      activeFloorId,
      applySelectedGraphicAssetId,
      applySelection,
      canvasPxPerMeter,
      applyGraphicElementDropPicker,
    ]
  )

  const handleAddNoteFromContextMenu = useCallback(
    (position: Point) => {
      applyGraphicElementDropPicker(null)
      if (!activeFloorId) return
      const outcome = runProjectCommand(
        'annotation.createNote',
        {
          scope: 'sitplan',
          floorId: activeFloorId,
          pos: position,
        },
        { source: 'plan-canvas-context-menu' }
      )
      const noteId = outcome?.results[0]?.created[0]?.id
      if (noteId) applySelection({ type: 'note', ids: [noteId] })
    },
    [activeFloorId, applySelection, applyGraphicElementDropPicker]
  )

  const handleContextAddElementClick = useCallback(
    (position: Point) => {
      if (canEditFloorPlan && isFloorPlanMode) {
        applyAddElementDropPosition(null)
        applyGraphicElementDropPicker({
          planPosition: position,
          clientAnchor: planToClient(position),
        })
        return
      }
      applyGraphicElementDropPicker(null)
      applyAddElementDropPosition(position)
    },
    [
      canEditFloorPlan,
      isFloorPlanMode,
      planToClient,
      applyAddElementDropPosition,
      applyGraphicElementDropPicker,
    ]
  )

  // Context menu: base from usePlanContextMenu, plus floor-plan "Merge Points" when 2 vertices selected
  const baseGetContextMenuItems = usePlanContextMenu(activeFloorId, getPlacementWorldBoundsMemo, {
    onAddElementClick: handleContextAddElementClick,
    openContextAssignCircuitPanel,
  })

  return {
    handleDrop,
    libraryDropPreview,
    handleLibraryDragOver,
    handlePlanFilesDrop,
    closeImportDialog,
    handleAddGraphicElementFromContextMenu,
    handleAddNoteFromContextMenu,
    baseGetContextMenuItems,
  }
}
