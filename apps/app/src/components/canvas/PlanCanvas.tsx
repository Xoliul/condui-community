import { usePlanGeometryContextMenu } from '@/hooks/plan/usePlanGeometryContextMenu'
import { createPlanWireSymbolHitRenderer } from '@/components/canvas/plan/createPlanWireSymbolHitRenderer'
import { usePlanImageInteractions } from '@/hooks/plan/usePlanImageInteractions'
import { usePlanQuickPlacerCanvasEvents } from '@/hooks/plan/usePlanQuickPlacerCanvasEvents'

import { usePlanQuickPlacerPreview } from '@/hooks/plan/usePlanQuickPlacerPreview'
import { usePlanGeometryGestureState } from '@/hooks/plan/usePlanGeometryGestureState'
import { usePlanCanvasGeometry } from '@/hooks/plan/usePlanCanvasGeometry'
import { usePlanCrossFloorDrag } from '@/hooks/plan/usePlanCrossFloorDrag'
import { usePlanFloorViewportFit } from '@/hooks/plan/usePlanFloorViewportFit'
import { usePlanGeometrySnapping } from '@/hooks/plan/usePlanGeometrySnapping'
import { usePlanGeometrySelection } from '@/hooks/plan/usePlanGeometrySelection'
import { renderPlanCanvasViewRail } from './plan/renderPlanCanvasViewRail'
import { renderPlanCanvasToolRail } from './plan/renderPlanCanvasToolRail'
import { renderPlanCanvasViewport } from './plan/renderPlanCanvasViewport'
import { usePlanCanvasWiringModel } from '@/hooks/plan/usePlanCanvasWiringModel'
import { usePlanLibraryDropController } from '@/hooks/plan/usePlanLibraryDropController'
import { usePlanCanvasSelectionBounds } from '@/hooks/plan/usePlanCanvasSelectionBounds'
import { usePlanCanvasMarqueeSelection } from '@/hooks/plan/usePlanCanvasMarqueeSelection'
import { usePlanWallGeometryActions } from '@/hooks/plan/usePlanWallGeometryActions'
import { usePlanQuickPlacerController } from '@/hooks/plan/usePlanQuickPlacerController'
import { usePlanGeometrySelectionDrag } from '@/hooks/plan/usePlanGeometrySelectionDrag'
import { usePlanOpeningGestures } from '@/hooks/plan/usePlanOpeningGestures'
import { usePlanWallVertexGestures } from '@/hooks/plan/usePlanWallVertexGestures'
import { CrossFloorDragSession, EMPTY_PLAN_OVERLAY_FLOOR_IDS } from './plan/planCanvasBindings'
import { usePlanFloorEditingState } from '@/hooks/plan/usePlanFloorEditingState'
import { usePlanDrawHitTestingCooldown } from '@/hooks/plan/usePlanDrawHitTestingCooldown'
import { PlanGraphicElementPicker } from './plan/PlanGraphicElementPicker'
import { usePlanWireWaypointPreview } from '@/hooks/plan/usePlanWireWaypointPreview'
import { isKeyboardTypingTarget } from '@/lib/ui/keyboardTypingTarget'
import { useCanvasWindow, useViewport } from '@/components/viewport/ViewportContext'
import {
  useIsActiveViewport,
  useViewportUIStore as useCanvasUIStore,
  useViewportUIApi,
} from '@/components/viewport/ViewportUIStore'
import { useCallback, useRef, useState, useEffect, useMemo, useLayoutEffect } from 'react'
import { useJunctionEditorMenu } from '@/components/junctionEditor/junctionEditorHostedFeatures'
import { useStoreWithEqualityFn } from 'zustand/traditional'

import type Konva from 'konva'

import { useTranslation } from 'react-i18next'
import { setPlanDragPreviewPositions, usePlanDragPositionsMap } from '@/stores/planDragVisualStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { updateSituationPlanNoteProperties } from '@/handlers/properties/editGeneralProperties'
import {
  updatePlanDoor,
  updatePlanGraphicElement,
  updatePlanPlacement,
  updatePlanStair,
  updatePlanWall,
  updatePlanWindow,
} from '@/handlers/plan/planCanvasCommandEdits'
import { useDialog } from '@/hooks/useDialog'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  useCanvasFontFamily,
  useClearSelectionStore,
  useEffectiveCanvasZoom,
  useSetSelectionStore,
  useTouchPrimaryDevice,
} from '@/editions/community/communityHooks'
import { planCanvasGeometrySelectionRenderKey } from '@/lib/plan/planCanvasSelectionRenderKey'

import { type FloorPlanClipboardPayload } from '@/lib/plan/floorPlanClipboard'
import { endpointSymbolVisibleOnSitplan } from '@/lib/plan/planSymbolVisibility'
import { canSymbolAppearOnSituationPlan } from '@/lib/plan/situationPlanSymbolEligibility'
import { getSymbolById, type SymbolMetadata } from '@/lib/symbols'
import type { Point, Selection } from '@/types/ui'
import type { Placement, Wall, Point2 } from '@/types/schema'
import { type BaseCanvasHandle } from './BaseCanvas'
import ViewNavigationToolbar from './ViewNavigationToolbar'
import ImportPlanImageDialog from '../plan/ImportPlanImageDialog'
import FloorPlanTools from '../plan/FloorPlanTools'
import ScaleIndicator from '../plan/ScaleIndicator'
import { useAwaitingPlanPlacementCount } from '../plan/QuickPlacerToolIcon'
import { getViewportCenterPlanSpaceIfApplicable } from '@/lib/plan/autoSitplanPlacement'
import { PlanCanvasSelectionBreadcrumb, PlanWiringCircuitBar } from './plan'
import { type PlanProjectionGuide } from './plan/PlanProjectionGuides'
import { WallScanBar, WallScanPreviewLayer } from './plan/WallScanReview'

import { isCableRoutesEnabled } from '@/lib/cableRouting/availability'
import { PlanWireLegend } from '@/components/cableRouting/PlanWireLegend'
import { FloorPlanDrawDimensionInput } from './plan/FloorPlanDrawDimensionInput'
import { CanvasOverlayScaleProvider } from '@/contexts/CanvasOverlayScaleContext'
import { usePlanDrawingElectricalSnapshot } from '@/hooks/plan/usePlanDrawingElectricalSnapshot'
import { useDialogStore } from '@/stores/dialogStore'
import { useCanvasRegistryStore } from '@/stores/canvasRegistryStore'
import PlanDropCircuitPanel from '@/components/plan/PlanDropCircuitPanel'
import type { PlanDropKind } from '@/lib/plan/planDropPicker'
import { endpointTypeToPlanDropKind } from '@/lib/plan/planDropPicker'
import { finalizePlanDropCircuitPickerUndoGroup } from '@/lib/plan/planDropCircuitSession'
import { requestEendraadCircuitFitThenRestoreSelection } from '@/lib/eendraad/focusCircuit'
import { getEndpointTypeFromSymbol } from '@/utils'
import AddElementPicker from '@/components/eendraad/AddElementPicker'
import { isFloorPlanTouchDragTool } from '@/lib/plan/planFloorDrawingKeyboardGate'

import { isCurvedWall } from '@/lib/plan/wallCurve'
import {
  resolvePlanCanvasPxPerMeter,
  usePlanLabelPositions,
  type PlanLabelWallCollisionInput,
  usePlanImage,
  usePlanKeyboard,
  usePlanDragHandling,
  usePlanWireInteractionState,
  usePlanWiringFocus,
  usePlanQuickPlacerState,
  usePlanScaleResetController,
  usePlanCanvasToolState,
  usePlanOpeningWidthEditor,
  type QuickPlacerCursorHint,
} from '@/hooks/plan'
import { resolvePanelForDistributionEndpoint } from '@/lib/plan/panelDistributionEndpoint'
import { pickPlanFloorForSelectionFit } from '@/lib/plan/planFocusFloorForSelection'
import { healEarthingSitplanPlacements } from '@/lib/plan/earthingSitplanPlacement'
import { healAuxiliaryEnclosurePlanPlacements } from '@/lib/plan/auxiliaryEnclosurePlanPlacement'

import { QuickPlacerPanel } from '@/components/plan/QuickPlacerPanel'

import type { EditorCapabilities } from '@/lib/viewerMode'
import { resolvePlanWiringVisibility } from '@/lib/plan/planWiring'
import { selectProjectPlanWiringProjection } from '@/lib/projectV2/planWiring'
import { querySitplanNotes } from '@/lib/projectV2/annotations'
import { selectProjectBuildingFloors, selectProjectFloorPlan } from '@/lib/projectV2/buildingFloors'


import { createPlanScaleReference, parsePlanMeters } from '@/lib/plan/planScale'
import { type ClientPoint } from '@/lib/plan/crossFloorDragContinuation'
import { normalizePlanImageRotationDeg } from '@/lib/plan/planImageRotation'

interface PlanCanvasProps {
  onMultiFingerSwipe?: (
    direction: 'left' | 'right' | 'up' | 'down',
    fingerCount: number,
    startClientX: number
  ) => void
  capabilities?: EditorCapabilities
}

function PlanCanvas({ onMultiFingerSwipe, capabilities }: PlanCanvasProps = {}) {
  const isActiveViewport = useIsActiveViewport()
  const window = useCanvasWindow()
  const document = window.document
  const viewportUI = useViewportUIApi()
  const { t, i18n } = useTranslation()
  const withJunctionEditorItem = useJunctionEditorMenu()
  const planView = useCanvasUIStore((s) => s.planView)
  const effectivePlanZoom = useEffectiveCanvasZoom(planView.zoom, 'plan')
  const applyPlanView = useCanvasUIStore((s) => s.setPlanView)
  const planCanvasViewportPx = useCanvasUIStore((s) => s.planCanvasViewportPx)
  const applyPlanCanvasViewportPx = useCanvasUIStore((s) => s.setPlanCanvasViewportPx)
  const planIsInLayout = useCanvasUIStore((s) =>
    s.viewportLayout.panels.some((panel) => panel.canvas === 'plan')
  )
  const activeFloorId = useCanvasUIStore((s) => s.activeFloorId)
  const planFloorOverlayIds = useProjectStore(
    useCallback(
      (s: ProjectState) => {
        if (!activeFloorId) return EMPTY_PLAN_OVERLAY_FLOOR_IDS
        const v = s.planFloorOverlayVisibleByBaseFloorId[activeFloorId]
        if (!v || v.length === 0) return EMPTY_PLAN_OVERLAY_FLOOR_IDS
        return v
      },
      [activeFloorId]
    )
  )
  const applyActiveFloor = useCanvasUIStore((s) => s.setActiveFloor)
  const requestFitToView = useCanvasUIStore((s) => s.requestFitToView)
  // Re-render PlanCanvas only for floor-plan geometry selection — symbol chrome is in child components.
  useStoreWithEqualityFn(
    viewportUI,
    (s) => planCanvasGeometrySelectionRenderKey(s.selection),
    (a, b) => a === b
  )
  const selection = useCanvasUIStore((s) => s.selection)
  const applySelection = useSetSelectionStore()
  const clearSelection = useClearSelectionStore()
  const applyHover = useCanvasUIStore((s) => s.setHover)
  const clearHover = useCanvasUIStore((s) => s.clearHover)
  const isExporting = useCanvasUIStore((s) => s.isExporting)
  const planVisibility = useCanvasUIStore((s) => s.planVisibility)
  const sitplanPanelFilterId = useCanvasUIStore((s) => s.sitplanPanelFilterId)
  const setSitplanPanelFilterId = useCanvasUIStore((s) => s.setSitplanPanelFilterId)
  const viewportPanelIndex = useViewport()?.panelIndex
  const ownsQuickPlacer = useCanvasUIStore(
    (s) =>
      viewportPanelIndex == null ||
      s.viewportLayout.panels.findIndex((panel) => panel.canvas === 'plan') === viewportPanelIndex
  )
  const quickPlacerWindowOpen = useCanvasUIStore((s) => s.quickPlacerWindowOpen)
  const quickPlacerOpen = quickPlacerWindowOpen && ownsQuickPlacer
  const quickPlacerDragSeed = useCanvasUIStore((s) =>
    s.floatingPanelDragSeed?.panel === 'quickPlacer' ? s.floatingPanelDragSeed : null
  )
  const applyLeftDockPreviewPanel = useCanvasUIStore((s) => s.setLeftDockPreviewPanel)
  const applyQuickPlacerOpen = useCanvasUIStore((s) => s.setQuickPlacerWindowOpen)
  const leftDockPanel = useCanvasUIStore((s) => s.leftDockPanel)
  const quickPlacerDocked = leftDockPanel === 'quickPlacer' && ownsQuickPlacer
  const leftDockCollapsed = useCanvasUIStore((s) => s.leftDockCollapsed)
  const applyLeftDockPanel = useCanvasUIStore((s) => s.setLeftDockPanel)
  const eendraadIsInLayout = useCanvasUIStore((s) =>
    s.viewportLayout.panels.some((p: { canvas: string }) => p.canvas === 'eendraad')
  )
  const currentProject = useProjectStore((s: ProjectState) => s.currentProject)
  const currentProjectFloors = useMemo(
    () => (currentProject ? selectProjectBuildingFloors(currentProject) : []),
    [currentProject]
  )
  const sitplanNotes = useMemo(
    () => (currentProject ? querySitplanNotes(currentProject) : []),
    [currentProject]
  )
  const projectId = currentProject?.project.id
  

  // Backfill earthing (Aarding) on sitplan for older projects already open in the editor.
  useEffect(
    function () {
      if (!projectId) return
      useProjectStore.setState((state: ProjectState) => {
        if (!state.currentProject || state.currentProject.project.id !== projectId) return
        if (healEarthingSitplanPlacements(state.currentProject)) {
          state.isDirty = true
        }
        // Supply enclosures (virtual panels) show on the plan, so their cables can be drawn.
        if (healAuxiliaryEnclosurePlanPlacements(state.currentProject)) {
          state.isDirty = true
        }
      })
    },
    [projectId]
  )
  const canPlaceSymbols = capabilities?.canPlaceSymbols ?? true
  const canDragItems = capabilities?.canDragItems ?? true
  const canDeleteItems = capabilities?.canDeleteItems ?? true
  const canEditFloorPlan = capabilities?.canEditFloorPlan ?? true
  const getFloorById = useProjectStore((s: ProjectState) => s.getFloorById)
  const getEndpointById = useProjectStore((s: ProjectState) => s.getEndpointById)
  const getCircuitById = useProjectStore((s: ProjectState) => s.getCircuitById)
  const getCircuitIdentifier = useProjectStore((s: ProjectState) => s.getCircuitIdentifier)
  const findCircuitForEndpoint = useProjectStore((s: ProjectState) => s.findCircuitForEndpoint)
  const findPanelForCircuit = useProjectStore((s: ProjectState) => s.findPanelForCircuit)
  const getAllEndpoints = useProjectStore((s: ProjectState) => s.getAllEndpoints)
  const getPanelById = useProjectStore((s: ProjectState) => s.getPanelById)
  const getPlacementsByFloor = useProjectStore((s: ProjectState) => s.getPlacementsByFloor)
  const getTrunkDeviceById = useProjectStore((s: ProjectState) => s.getTrunkDeviceById)
  const getPlanWireTrunkDeviceById = useCallback(
    (id: string) => getTrunkDeviceById(id)?.device,
    [getTrunkDeviceById]
  )
  const getPlacementById = useProjectStore((s: ProjectState) => s.getPlacementById)
  const getPanelPathFromRoot = useProjectStore((s: ProjectState) => s.getPanelPathFromRoot)
  const dialog = useDialog()
  const updatePlacement = updatePlanPlacement
  const updateWall = updatePlanWall
  const updateDoor = updatePlanDoor
  const updateWindow = updatePlanWindow
  const updateStair = updatePlanStair
  const openDialog = useDialogStore((s) => s.openDialog)
  const cancelResetScaleTrigger = useCanvasUIStore((s) => s.cancelPlanResetScaleTrigger)
  const canvasRef = useRef<BaseCanvasHandle>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pointerOverPlanRef = useRef(false)
  const lastPlanPointerClientRef = useRef<ClientPoint | null>(null)
  const crossFloorDragSessionRef = useRef<CrossFloorDragSession | null>(null)
  const floorPlanClipboardRef = useRef<FloorPlanClipboardPayload | null>(null)
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null)
  const palettePlanActionsRef = useRef<{
    importBackground: () => void
    calibrateScale: () => void
  } | null>(null)

  useEffect(() => {
    floorPlanClipboardRef.current = null
  }, [projectId])

  // Register canvas for export
  // Always return stage if available - export will handle switching floors as needed
  const registerSitplan = useCanvasRegistryStore((s) => s.registerSitplan)
  useEffect(
    function () {
      return registerSitplan(
        (_floorId: string) => {
          // Always return stage if available - export handles switching to the right floor
          // The stage will contain the currently active floor, which export will switch to match floorId
          return canvasRef.current?.getStage() ?? null
        },
        (_floorId: string) => {
          // Fit to view - export will ensure the right floor is active before calling this
          canvasRef.current?.fitToView()
        },
        {
          importBackground: () => palettePlanActionsRef.current?.importBackground(),
          calibrateScale: () => palettePlanActionsRef.current?.calibrateScale(),
          getPlacementTarget: () => {
            const ui = viewportUI.getState()
            const stage = canvasRef.current?.getStage()
            if (ui.isExporting || !ui.activeFloorId || !stage) return null
            const viewportCenter = getViewportCenterPlanSpaceIfApplicable(
              ui.viewportLayout,
              { width: stage.width(), height: stage.height() },
              ui.activeFloorId,
              ui.activeFloorId,
              ui.planView
            )
            return viewportCenter
              ? {
                  activeFloorId: ui.activeFloorId,
                  viewportCenter,
                  ownerDocument: stage.container().ownerDocument,
                }
              : null
          },
        },
        viewportUI
      )
    },
    [registerSitplan, viewportUI]
  )

  const preparePlanFitToView = useCallback(
    function () {
      const project = useProjectStore.getState().currentProject
      if (!project) return
      const { selection, activeFloorId, setActiveFloor: applyActiveFloor } = viewportUI.getState()
      const nextFloor = pickPlanFloorForSelectionFit(
        project,
        selection,
        activeFloorId,
        useProjectStore.getState().getTrunkDeviceById
      )
      if (nextFloor) applyActiveFloor(nextFloor)
    },
    [viewportUI]
  )

  // Drag handling is now managed by usePlanDragHandling hook
  const {
    isImportDialogOpen,
    setIsImportDialogOpen: applyIsImportDialogOpen,
    activeTool,
    setActiveTool: applyActiveTool,
    openingSelectionArmedTool,
    setOpeningSelectionArmedTool: applyOpeningSelectionArmedTool,
    setSelectedPlanImageId: applySelectedPlanImageId,
    isFloorPlanMode,
    setIsFloorPlanMode: applyIsFloorPlanMode,
    selectedGraphicAssetId,
    setSelectedGraphicAssetId: applySelectedGraphicAssetId,
    isViewportPanning,
    setIsViewportPanning: applyIsViewportPanning,
    openMenu,
    setOpenMenu: applyOpenMenu,
  } = usePlanCanvasToolState({ readOnly: !canEditFloorPlan })

  const electricalReadProject = usePlanDrawingElectricalSnapshot(
    currentProject,
    activeFloorId,
    isFloorPlanMode && !isExporting
  )
  const planWiring = useMemo(
    () =>
      electricalReadProject ? selectProjectPlanWiringProjection(electricalReadProject) : undefined,
    [electricalReadProject]
  )
  const planWiringVisibility = useMemo(() => resolvePlanWiringVisibility(planWiring), [planWiring])

  const movePlanOverlayFloorIds = useMemo(
    function () {
      if (activeTool !== 'move' || !activeFloorId || currentProjectFloors.length === 0) {
        return EMPTY_PLAN_OVERLAY_FLOOR_IDS
      }
      if (planFloorOverlayIds.length > 0) return planFloorOverlayIds
      const currentIndex = currentProjectFloors.findIndex((floor) => floor.id === activeFloorId)
      if (currentIndex < 0) return EMPTY_PLAN_OVERLAY_FLOOR_IDS
      const preferredBelow = currentProjectFloors[currentIndex - 1]
      const fallbackAbove = currentProjectFloors[currentIndex + 1]
      const adjacent = preferredBelow ?? fallbackAbove
      return adjacent ? [adjacent.id] : EMPTY_PLAN_OVERLAY_FLOOR_IDS
    },
    [activeTool, activeFloorId, currentProjectFloors, planFloorOverlayIds]
  )
  const {
    planWireDragSourcePlacementId,
    setPlanWireDragSourcePlacementId: applyPlanWireDragSourcePlacementId,
    planWireHoverPlacementId,
    setPlanWireHoverPlacementId: applyPlanWireHoverPlacementId,
    planWirePreviewPointStore,
    setPlanWirePreviewPoint: applyPlanWirePreviewPoint,
  } = usePlanWireInteractionState()
  const waypointPreviewStore = usePlanWireWaypointPreview()
  const wiringFocus = usePlanWiringFocus({
    wiringMode: activeTool === 'wiring',
    activeFloorId,
    currentProject,
    hoverPlacementId: planWireHoverPlacementId,
    dragSourcePlacementId: planWireDragSourcePlacementId,
  })
  const [planImageRef, setPlanImageRef] = useState<Konva.Image | null>(null)
  const [transformerRef, setTransformerRef] = useState<Konva.Transformer | null>(null)

  // Default reference underlay: floor immediately above in building floor order (index - 1), when overlays are still empty.
  useEffect(
    function () {
      if (!isFloorPlanMode || !activeFloorId || currentProjectFloors.length === 0) return
      useProjectStore.getState().ensurePlanReferenceOverlayAboveInList(activeFloorId)
    },
    [isFloorPlanMode, activeFloorId, currentProjectFloors]
  )

  const {
    quickPlacerMode,
    setQuickPlacerMode: applyQuickPlacerMode,
    quickPlacerSelectedCircuitId,
    setQuickPlacerSelectedCircuitId: applyQuickPlacerSelectedCircuitId,
    quickPlacerManualCircuitFocusToken,
    setQuickPlacerManualCircuitFocusToken: applyQuickPlacerManualCircuitFocusToken,
    quickPlacerFastIndex,
    setQuickPlacerFastIndex: applyQuickPlacerFastIndex,
    quickPlacerFastAutoSkipCustom,
    setQuickPlacerFastAutoSkipCustom: applyQuickPlacerFastAutoSkipCustom,
    quickPlacerDockHost,
    setQuickPlacerDockHost: applyQuickPlacerDockHost,
    quickPlacerDraggedPlacementId,
    setQuickPlacerDraggedPlacementId: applyQuickPlacerDraggedPlacementId,
    quickPlacerCursorHint,
    setQuickPlacerCursorHint: applyQuickPlacerCursorHint,
    quickPlacerFastPreviewClient,
    setQuickPlacerFastPreviewClient: applyQuickPlacerFastPreviewClient,
    quickPlacerFocusPlacementId,
    setQuickPlacerFocusPlacementId: applyQuickPlacerFocusPlacementId,
  } = usePlanQuickPlacerState({ open: quickPlacerOpen, docked: quickPlacerDocked })
  const [contentDrawingSnapGuides, applyContentDrawingSnapGuides] = useState<PlanProjectionGuide[]>(
    []
  )
  const [addElementDropPosition, applyAddElementDropPosition] = useState<Point | null>(null)
  const [graphicElementDropPicker, applyGraphicElementDropPicker] = useState<{
    planPosition: Point
    clientAnchor: Point
  } | null>(null)
  const [planDropCircuitPicker, applyPlanDropCircuitPicker] = useState<{
    endpointIds: string[]
    assignedPanelId: string
    assignedCircuitId: string
    symbol: SymbolMetadata
    clientAnchor: { x: number; y: number }
    dropKind: PlanDropKind
    undoGroupStartIndex: number
    provisionalCircuitIds: string[]
    avoidBounds: DOMRect | undefined
  } | null>(null)
  const planDropCircuitPickerOpenRef = useRef(false)
  useLayoutEffect(() => {
    planDropCircuitPickerOpenRef.current = planDropCircuitPicker != null
  }, [planDropCircuitPicker])
  const libraryArmed = useCanvasUIStore((state) => state.armedLibrarySymbol != null)
  const awaitingPlanPlacementCount = useAwaitingPlanPlacementCount()
  // Closing the circuit picker (×) during an armed session keeps it closed until disarm.
  const planDropPickerDismissedWhileArmedRef = useRef(false)
  useEffect(() => {
    if (!libraryArmed) planDropPickerDismissedWhileArmedRef.current = false
  }, [libraryArmed])
  // Armed library placement and Quick Placer fast mode both own canvas clicks: the newest wins.
  const quickPlacerModeRef = useRef(quickPlacerMode)
  useLayoutEffect(() => {
    quickPlacerModeRef.current = quickPlacerMode
  }, [quickPlacerMode])
  useEffect(() => {
    if (libraryArmed && quickPlacerModeRef.current === 'fast') applyQuickPlacerMode('slow')
  }, [libraryArmed, applyQuickPlacerMode])
  useEffect(() => {
    if (quickPlacerMode === 'fast') viewportUI.getState().setArmedLibrarySymbol(null)
  }, [quickPlacerMode, viewportUI])
  useEffect(() => {
    if (!import.meta.env.VITE_E2E) return
    const handleOpenPicker = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          endpointId?: string
          assignedPanelId?: string
          assignedCircuitId?: string
          symbolId?: string
          dropKind?: PlanDropKind
          clientAnchor?: { x: number; y: number }
        }>
      ).detail
      if (
        !detail?.endpointId ||
        !detail.assignedPanelId ||
        !detail.assignedCircuitId ||
        !detail.symbolId
      ) {
        return
      }
      const symbol = getSymbolById(detail.symbolId)
      if (!symbol) return
      applyPlanDropCircuitPicker({
        avoidBounds: containerRef.current?.getBoundingClientRect(),
        endpointIds: [detail.endpointId],
        assignedPanelId: detail.assignedPanelId,
        assignedCircuitId: detail.assignedCircuitId,
        symbol,
        dropKind:
          detail.dropKind ??
          endpointTypeToPlanDropKind(getEndpointTypeFromSymbol(symbol) ?? 'fixed_appliance'),
        clientAnchor: detail.clientAnchor ?? { x: window.innerWidth * 0.55, y: 120 },
        undoGroupStartIndex: useProjectStore.getState().undoStack.length,
        provisionalCircuitIds: [],
      })
    }
    window.addEventListener('eendra:e2e-open-plan-drop-circuit-picker', handleOpenPicker)
    return () =>
      window.removeEventListener('eendra:e2e-open-plan-drop-circuit-picker', handleOpenPicker)
  }, [window])
  const quickPlacerDraggedPlacementIdRef = useRef<string | null>(null)
  const quickPlacerHintTimeoutRef = useRef<number | null>(null)
  const quickPlacerPanelRef = useRef<HTMLDivElement | null>(null)
  const quickPlacerFastOverlayRef = useRef<HTMLDivElement | null>(null)
  const quickPlacerPreviousSelectionRef = useRef<Selection | null>(null)
  const quickPlacerWasFastRef = useRef(false)
  const suppressQuickPlacerPanelFocusRef = useRef(false)
  // Local preview walls while dragging (vertices or wall selections). Committed on drag end.
  const {
    previewWalls,
    applyPreviewWalls,
    previewDoors,
    applyPreviewDoors,
    previewWindows,
    applyPreviewWindows,
    wallDimensionDragRef,
    wallSelectionPreviewRef,
    stairSelectionPreviewRef,
    selectionPreview,
    applySelectionPreview,
    pointDragTargetsRef,
    vertexDragInitialOpeningsRef,
    doorHoverOpenSideRef,
    doorHoverWallIdRef,
    vertexDragAnchorRef,
    vertexDragInitialPointsRef,
    wallSelectionDragRef,
    stairSelectionDragRef,
    stairPointDragRef,
    doorDragRef,
    openingDimensionDragRef,
  } = usePlanGeometryGestureState()

  const handleZoomChange = useCallback(
    (zoom: number) => {
      applyPlanView({ zoom })
    },
    [applyPlanView]
  )

  const handlePanChange = useCallback(
    (pan: { x: number; y: number }) => {
      applyPlanView({ pan })
    },
    [applyPlanView]
  )

  const handleViewTransformCommit = useCallback(
    (patch: { pan?: Point; zoom?: number }) => {
      applyPlanView(patch)
    },
    [applyPlanView]
  )

  const handleFitToView = useCallback(
    function () {
      const viewportLayout = viewportUI.getState().viewportLayout
      const canvasesToFit =
        viewportLayout.panels.length === 1
          ? ['plan' as const]
          : Array.from(new Set(viewportLayout.panels.map((panel) => panel.canvas)))
      requestFitToView(canvasesToFit)
    },
    [requestFitToView, viewportUI]
  )

  const fitTrigger = useCanvasUIStore((s) => s.fitToViewTrigger.plan)
  useEffect(
    function () {
      if (fitTrigger === 0) return
      const id = requestAnimationFrame(() => {
        canvasRef.current?.fitToView()
      })
      return () => cancelAnimationFrame(id)
    },
    [fitTrigger]
  )

  const baseActiveFloor = activeFloorId ? getFloorById(activeFloorId) : null
  const activeFloor = useMemo(
    function () {
      if (!baseActiveFloor || !currentProject || !activeFloorId) return baseActiveFloor
      const floorPlan = selectProjectFloorPlan(currentProject, activeFloorId)
      return floorPlan === baseActiveFloor.floorPlan
        ? baseActiveFloor
        : {
            ...baseActiveFloor,
            floorPlan,
          }
    },
    [activeFloorId, baseActiveFloor, currentProject]
  )
  const shouldHandleWallHover =
    canEditFloorPlan &&
    isFloorPlanMode &&
    (activeTool === 'insertDoor' ||
      activeTool === 'insertWindow' ||
      activeTool === 'clipWall' ||
      activeTool === 'insertPoint' ||
      activeTool === 'select')
  const {
    hoveredWallId,
    applyHoveredWallId,
    hoveredDoorId,
    applyHoveredDoorId,
    hoveredWindowId,
    applyHoveredWindowId,
    hoveredStairId,
    applyHoveredStairId,
    selectedPointIndices,
    applySelectedPointIndices,
    selectedStairPointIndices,
    applySelectedStairPointIndices,
    selectedSegmentIndices,
    applySelectedSegmentIndices,
    mixedSelectedDoorIds,
    applyMixedSelectedDoorIds,
    mixedSelectedWindowIds,
    applyMixedSelectedWindowIds,
    clipPreviewPoints,
    applyClipPreviewPoints,
    openingPreview,
    applyOpeningPreview,
    insertPointPreview,
    applyInsertPointPreview,
    vertexMoveProjectedSnapGuides,
    applyVertexMoveProjectedSnapGuides,
  } = usePlanFloorEditingState({
    isFloorPlanMode,
    activeFloor,
    activeFloorId,
    activeTool,
    selection,
    shouldHandleWallHover,
    openingSelectionArmedTool,
  })
  const {
    isResettingScale,
    scaleRulerPoints,
    setScaleRulerPoints: applyScaleRulerPoints,
    scaleRulerMeters,
    setScaleRulerMeters: applyScaleRulerMeters,
    scaleRulerMetersInput,
    setScaleRulerMetersInput: applyScaleRulerMetersInput,
    scaleRulerCommitSignal,
    setScaleRulerCommitSignal: applyScaleRulerCommitSignal,
    handleResetScaleStart,
    handleScaleRulerComplete,
    handleScaleRulerCancel,
    tempPxPerMeter,
  } = usePlanScaleResetController({
    activeFloor,
    activeFloorId,
    activeTool,
    cancelResetScaleTrigger,
    getFloorById,
    getPlacementsByFloor,
    openDialog,
    setActiveTool: applyActiveTool,
    t,
  })
  useLayoutEffect(() => {
    palettePlanActionsRef.current = {
      importBackground: () => {
        if (canEditFloorPlan) applyIsImportDialogOpen(true)
      },
      calibrateScale: () => {
        if (canEditFloorPlan) handleResetScaleStart()
      },
    }
  }, [canEditFloorPlan, applyIsImportDialogOpen, handleResetScaleStart])
  const {
    baseWalls,
    baseDoors,
    baseWindows,
    graphicElementsForRender,
    pxPerMeter,
    baseSymbolSizePx,
    planLabelFontSize,
    planMinZoom,
    wallsForRender,
    doorsForRender,
    windowsForRender,
    stairsForRender,
    spiralRotationPreview,
    setSpiralRotationPreview,
    gridSize,
    resolveNearbyFloorLineSnap,
    snapPlacementPosition,
    stableSnapPlacementPosition,
  } = usePlanCanvasGeometry({
    activeFloor,
    tempPxPerMeter,
    previewWalls,
    selectionPreview,
    previewDoors,
    previewWindows,
    planView,
    isFloorPlanMode,
  })
  const canvasPxPerMeter = resolvePlanCanvasPxPerMeter(
    activeFloor ?? null,
    planView.gridSize,
    gridSize,
    tempPxPerMeter
  )
  const theme = useSettingsStore((state) => state.theme)
  const fontFamily = useCanvasFontFamily()
  const touchPrimary = useTouchPrimaryDevice()
  const {
    selectedWallIds,
    selectedDoorIds,
    selectedWindowIds,
    clearMixedOpeningSelection,
    retainDirectOpeningSelectionForMixed,
    toggleMixedOpeningSelection,
    selectedGraphicElementIds,

    selectedStairId,
    selectedStairPointIndex,
    selectedStair,
    selectedStairsForCopy,
    selectedWallsForCopy,

    selectedOpeningsForCopy,

    shouldKeepGeometryTouchSelection,
    handleGraphicElementSelect,
    handleGraphicElementMove,
    handleGraphicElementResize,
    handleCopySelectionToFloors,
    handleCopyFloorPlanSelection,
    handlePasteFloorPlanSelection,
    buildEncodedFloorPointIds,
    getCurrentMixedPointSelection,
    stairSelectionBounds,
  } = usePlanGeometrySelection({
    selection,
    mixedSelectedDoorIds,
    mixedSelectedWindowIds,
    applyMixedSelectedDoorIds,
    applyMixedSelectedWindowIds,
    applySelection,
    vertexMoveProjectedSnapGuides,

    applyVertexMoveProjectedSnapGuides,
    selectedStairPointIndices,
    stairSelectionDragRef,
    stairsForRender,
    wallsForRender,
    selectedSegmentIndices,
    graphicElementsForRender,
    doorsForRender,
    windowsForRender,
    activeFloorId,
    activeFloor,
    getPlacementsByFloor,
    planCanvasViewportPx,
    containerRef,
    planView,
    activeTool,
    viewportUI,
    isFloorPlanMode,
    updatePlanGraphicElement,
    floorPlanClipboardRef,
    selectedPointIndices,
  })
  const {
    openingWidthEditorActive,
    openingWidthText,
    selectedOpeningForWidthEditor,
    setOpeningWidthEditorActive,
  } = usePlanOpeningWidthEditor({
    activeFloor,
    activeTool,
    canvasPxPerMeter,
    canEditFloorPlan,
    doorsForRender,
    isFloorPlanMode,
    selection,
    updateDoor,
    updateWindow,
    windowsForRender,
    zoom: planView.zoom,
  })
  const toolMoveHandleColor = '#ffffff'
  const toolMoveHandleStrokeColor = '#0284c7'

  // Throttle state updates while dragging wall points / selections to avoid excessive
  // projectStore writes and React re-renders on every pointermove.
  const lastWallPointUpdateTimeRef = useRef<number>(0)
  const lastWallSelectionUpdateTimeRef = useRef<number>(0)

  const {
    softSnapToGrid,
    resolveProjectedFloorSnap,
    wallSelectionBounds,
    makeCanvasPointFromEvent,
    scopedWallIdForVertexSelection,
    resolveScopedPointTarget,
  } = usePlanGeometrySnapping({
    gridSize,
    planView,
    activeFloor,
    isFloorPlanMode,
    selectedPointIndices,
    selectedStairPointIndices,
    wallsForRender,
    stairsForRender,
    activeTool,
    selection,
    selectedWallIds,
    touchPrimary,
  })

  const clientToPlan = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return null
      return {
        x: (clientX - rect.left - planView.pan.x) / planView.zoom,
        y: (clientY - rect.top - planView.pan.y) / planView.zoom,
      }
    },
    [planView.pan.x, planView.pan.y, planView.zoom]
  )

  const planToClient = useCallback(
    (plan: Point): { x: number; y: number } => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return { x: window.innerWidth * 0.5, y: 120 }
      return {
        x: rect.left + planView.pan.x + plan.x * planView.zoom,
        y: rect.top + planView.pan.y + plan.y * planView.zoom,
      }
    },
    [planView.pan.x, planView.pan.y, planView.zoom, window]
  )

  const showQuickPlacerHint = useCallback(
    (
      message: string,
      clientX: number,
      clientY: number,
      tone: QuickPlacerCursorHint['tone'] = 'error'
    ) => {
      applyQuickPlacerCursorHint({ message, x: clientX, y: clientY, tone })
      if (quickPlacerHintTimeoutRef.current != null) {
        window.clearTimeout(quickPlacerHintTimeoutRef.current)
      }
      quickPlacerHintTimeoutRef.current = window.setTimeout(() => {
        applyQuickPlacerCursorHint((current) =>
          current?.message === message && current.x === clientX && current.y === clientY
            ? null
            : current
        )
        quickPlacerHintTimeoutRef.current = null
      }, 900)
    },
    [applyQuickPlacerCursorHint, window]
  )

  // Clear wall/door/window hover and point selection when exiting floor plan mode
  useEffect(
    function () {
      if (!isFloorPlanMode) {
        // Reset any in-progress wall selection drag without depending on callbacks declared later.
        wallSelectionDragRef.current = {
          start: null,
          initialPointsByWall: null,
          indicesByWall: null,
          initialPointsByStair: null,
          indicesByStair: null,
          mode: 'free',
          singlePointTarget: null,
          singlePointCurrentPos: null,
          isWholeShapeMove: false,
        }
        stairSelectionDragRef.current = {
          stairId: null,
          pointIndex: null,
          start: null,
          initialPoints: null,
          mode: 'free',
        }
      }
    },
    [isFloorPlanMode, stairSelectionDragRef, wallSelectionDragRef]
  )

  // Native gesture reset stays postcommit; local point maps are source-owned above.
  useEffect(() => {
    if (
      !isFloorPlanMode ||
      !activeFloor?.floorPlan ||
      (selection.type !== 'wall' && selection.type !== 'wallPoint') ||
      selection.ids.length === 0
    ) {
      wallSelectionDragRef.current = {
        start: null,
        initialPointsByWall: null,
        indicesByWall: null,
        initialPointsByStair: null,
        indicesByStair: null,
        mode: 'free',
        singlePointTarget: null,
        singlePointCurrentPos: null,
        isWholeShapeMove: false,
      }
    }
  }, [
    isFloorPlanMode,
    selection,
    activeFloor,
    selectedPointIndices,
    selectedStairPointIndices,
    selectedSegmentIndices,
    wallSelectionDragRef,
  ])

  const shouldListenToWalls =
    canEditFloorPlan &&
    isFloorPlanMode &&
    (activeTool === 'clipWall' || activeTool === 'insertPoint' || activeTool === 'select')
  const showCurvedWallOpeningHint =
    shouldHandleWallHover &&
    !isExporting &&
    (activeTool === 'insertDoor' || activeTool === 'insertWindow') &&
    hoveredWallId !== null &&
    activeFloor?.floorPlan?.walls.some(
      (wall: Wall) => wall.id === hoveredWallId && isCurvedWall(wall)
    )
  const canSelectDoorsInInsertMode =
    activeTool === 'insertDoor' && openingSelectionArmedTool === 'insertDoor'
  const canSelectWindowsInInsertMode =
    activeTool === 'insertWindow' && openingSelectionArmedTool === 'insertWindow'
  const doorsListening = shouldListenToWalls || canSelectDoorsInInsertMode
  const windowsListening = shouldListenToWalls || canSelectWindowsInInsertMode
  const isWallDrawingTool =
    isFloorPlanMode && (activeTool === 'drawWall' || activeTool === 'drawWallRect')
  const floorPlanTouchDragToolActive = isFloorPlanMode && isFloorPlanTouchDragTool(activeTool)
  const drawHitTestingCooldownActive = usePlanDrawHitTestingCooldown(isWallDrawingTool, window)
  const suppressPlanHitTesting = isWallDrawingTool || drawHitTestingCooldownActive
  const canSelectPlacements = !isFloorPlanMode || activeTool === 'none'
  const placementInteractivitySuppressed =
    suppressPlanHitTesting || activeTool === 'wiring' || !canSelectPlacements
  // Symbols and plan wires are intentionally non-interactive throughout draw mode.
  // Dim them together so the floor-plan editing surface is visually distinct.
  const planSymbolAndWireOpacity = isFloorPlanMode ? 0.25 : 1
  const enablePlanSingleFingerPan = !floorPlanTouchDragToolActive
  /** Sitplan notes stay clickable/draggable in floor-plan edit tools; only wall-draw hit-test suppression disables them. */
  const planNotesInteractive =
    canDragItems &&
    !suppressPlanHitTesting &&
    (isFloorPlanMode || !placementInteractivitySuppressed)

  const suppressHeavyLayersWhilePanning = isViewportPanning && isWallDrawingTool

  const handleViewportPanStateChange = useCallback(
    (isPanning: boolean) => {
      if (isWallDrawingTool) {
        applyIsViewportPanning(isPanning)
      } else if (isViewportPanning) {
        applyIsViewportPanning(false)
      }
    },
    [applyIsViewportPanning, isViewportPanning, isWallDrawingTool]
  )

  const hasPlanImage = !!(activeFloor?.planAsset || activeFloor?.planImportAsset)
  const canResetPlanScale = hasPlanImage || (activeFloor?.floorPlan?.walls.length ?? 0) > 0

  useEffect(() => {
    if (!shouldHandleWallHover) doorHoverWallIdRef.current = null
  }, [shouldHandleWallHover, doorHoverWallIdRef])

  useEffect(
    function () {
      if (activeTool !== 'insertDoor') {
        doorHoverOpenSideRef.current = 'right'
        doorHoverWallIdRef.current = null
      }
    },
    [activeTool, applyActiveTool, doorHoverOpenSideRef, doorHoverWallIdRef]
  )

  const {
    handleWallHover,
    handleOpeningPreviewOverrideChange,
    buildMergedPointTargets,
    snapGraphicFloorPoint,
    applyMergedPointMove,
  } = usePlanWallVertexGestures({
    shouldHandleWallHover,
    activeFloor,
    applyHoveredWallId,
    applyClipPreviewPoints,
    applyOpeningPreview,
    applyInsertPointPreview,
    activeTool,
    canvasPxPerMeter,
    pxPerMeter,
    planView,
    baseDoors,
    baseWindows,
    doorHoverWallIdRef,
    doorHoverOpenSideRef,
    gridSize,
    resolveNearbyFloorLineSnap,
    resolveProjectedFloorSnap,
    softSnapToGrid,
    pointDragTargetsRef,
    vertexDragAnchorRef,
    vertexDragInitialPointsRef,
    applyVertexMoveProjectedSnapGuides,
    vertexDragInitialOpeningsRef,
    applyPreviewWalls,
    applyPreviewDoors,
    applyPreviewWindows,
    updateWall,
  })

  const {
    applyOpeningMoveFromPointer,
    beginOpeningDimensionDrag,
    applyOpeningDimensionDrag,
    endOpeningDimensionDrag,
  } = usePlanOpeningGestures({
    doorDragRef,
    activeFloor,
    doorsForRender,
    windowsForRender,

    applyPreviewDoors,
    baseDoors,
    applyPreviewWindows,
    baseWindows,
    updateDoor,
    updateWindow,
    selectedOpeningForWidthEditor,
    openingDimensionDragRef,
    planView,
    canvasPxPerMeter,
    gridSize,
  })

  const {
    beginWallSelectionDrag,

    handleStairPointDragStart,
    handleStairPointMove,
    handleStairPointDragEnd,
    updateWallSelectionDrag,
    endWallSelectionDrag,
    beginStairSelectionDrag,
    updateStairSelectionDrag,
    endStairSelectionDrag,
  } = usePlanGeometrySelectionDrag({
    activeFloor,
    selectedWallIds,
    selectedStairPointIndices,
    wallSelectionPreviewRef,
    stairSelectionPreviewRef,
    selectedPointIndices,
    wallSelectionDragRef,
    vertexDragAnchorRef,
    vertexDragInitialPointsRef,
    pointDragTargetsRef,
    buildMergedPointTargets,
    baseDoors,
    baseWindows,
    vertexDragInitialOpeningsRef,
    updateStair,
    applySelectionPreview,
    resolveNearbyFloorLineSnap,
    resolveProjectedFloorSnap,
    softSnapToGrid,
    planView,
    stairPointDragRef,
    selection,
    applyVertexMoveProjectedSnapGuides,
    lastWallSelectionUpdateTimeRef,
    applyMergedPointMove,
    applyPreviewWalls,
    applyPreviewDoors,
    applyPreviewWindows,
    updateWall,
    selectedStair,
    stairSelectionDragRef,
    selectedStairPointIndex,
  })

  const {
    placements,
    visiblePlacements,
    planWireRoutes,
    selectedRiserRouteIds,
    junctionPanelPlanPlacements,
    planWireStrokeFor,
    planWireRiserPreview,
    applyPlanWireRiserPreview,
    hoveredPlanWireRouteIds,
    highlightedPlanWireRouteIds,
    raisedRiserRouteIds,
    raisedRiserRoutes,
    handleCaptureRectangle,
    getPlanWireTargetStatus,
    handleMovePlanWireWaypoint,
    handleMovePlanWireRiser,
    handleMovePlanWireRisers,
    handleRemovePlanWireWaypoint,
    handleInsertFocusedPlanWireWaypoint,
    wiringFocusTarget,
    wiringFocusScope,
    wiringPreviewRouteIds,
    wiringFocusPlacementIds,
    wiringRedrawProgress,
    wiringFocusPlacementIdSet,
    wiringCircuitOptions,
  } = usePlanCanvasWiringModel({
    activeFloorId,
    sitplanPanelFilterId,
    planVisibility,
    electricalReadProject,
    activeTool,
    planWiringVisibility,
    getEndpointById,
    selection,
    currentProject,
    planWireDragSourcePlacementId,
    wiringFocus,
    getCircuitIdentifier,
    isActiveViewport,
    applyActiveTool,
    window,
    isResettingScale,
    handleScaleRulerCancel,
    containerRef,
    applyPlanWireDragSourcePlacementId,
    planWireHoverPlacementId,
    applyPlanWireHoverPlacementId,
    planWirePreviewPointStore,
    applyPlanWirePreviewPoint,
    clientToPlan,
    planView,
    baseSymbolSizePx,
    planWiring,
  })
  const {
    quickPlacerCircuits,
    selectedQuickPlacerCircuit,
    quickPlacerSequence,
    currentQuickPlacerFastItem,
    quickPlacerFastPreviewPlacement,
    quickPlacerFastPreviewLabelPosition,
  } = usePlanQuickPlacerPreview({
    electricalReadProject,
    getCircuitIdentifier,
    quickPlacerSelectedCircuitId,
    quickPlacerFastAutoSkipCustom,
    quickPlacerMode,
    quickPlacerFastIndex,
    quickPlacerFastPreviewClient,
    clientToPlan,
    snapPlacementPosition,
    activeFloorId,
    getEndpointById,
    baseSymbolSizePx,
    fontFamily,
  })
  const { planImage, planImagePosition, setPlanImagePosition } = usePlanImage(
    activeFloor ?? null,
    canvasRef
  )
  const planImageDisplayWidth = activeFloor?.planImportAsset?.width ?? planImage?.width ?? 0
  const planImageDisplayHeight = activeFloor?.planImportAsset?.height ?? planImage?.height ?? 0
  const planImageRotationDeg = normalizePlanImageRotationDeg(activeFloor?.planImageRotationDeg)
  // Pixel-based wall sampling assumes an unrotated image; rotated plans fall back to vector walls.
  const planImageForAnalysis = planImageRotationDeg ? null : planImage
  usePlanFloorViewportFit({
    activeFloorId,
    activeFloor,
    planCanvasViewportPx,
    containerRef,
    viewportUI,
    planVisibility,
    planImage,
    planImagePosition,
    planImageDisplayWidth,
    planImageDisplayHeight,
    planImageRotationDeg,
    baseWalls,
    stairsForRender,
    visiblePlacements,
    baseSymbolSizePx,
    getEndpointById,
    sitplanNotes,
    requestFitToView,
    currentProject,
  })

  // Drag handling hook
  // Drag handling hook (will provide labelRecalcKey)
  const dragHandling = usePlanDragHandling(
    activeFloorId,
    baseSymbolSizePx,
    new Map(),
    planImageForAnalysis,
    planImagePosition,
    snapPlacementPosition
  )
  const {
    isDraggingRef,
    moveActiveDragToFloor,
    updateCrossFloorDragPreview,
    finishCrossFloorDrag,
    labelRecalcKey,
    setLabelRecalcKey,
    createMultiSelectDragHandlers,
    createSingleDragHandlers,
    createSelectionFrameDragHandlers,
  } = dragHandling

  const { handleBeforeFloorSwitch } = usePlanCrossFloorDrag({
    isDraggingRef,
    activeFloorId,
    lastPlanPointerClientRef,
    moveActiveDragToFloor,
    crossFloorDragSessionRef,
    planToClient,
    viewportUI,
    containerRef,
    snapPlacementPosition,
    updateCrossFloorDragPreview,
    planView,
    finishCrossFloorDrag,
    window,
  })

  const planDragPositions = usePlanDragPositionsMap()
  const planWirePreviewSource = visiblePlacements.find(
    (placement: Placement) => placement.id === planWireDragSourcePlacementId
  )
  const planWirePreviewTarget =
    planWireHoverPlacementId &&
    planWireHoverPlacementId !== planWireDragSourcePlacementId &&
    getPlanWireTargetStatus(planWireHoverPlacementId) === 'legal'
      ? visiblePlacements.find((placement: Placement) => placement.id === planWireHoverPlacementId)
      : null

  const planLabelWallCollision = useMemo((): PlanLabelWallCollisionInput | null => {
    if (wallsForRender.length === 0) return null
    const fp = activeFloor?.floorPlan
    if (!fp) return null
    return {
      walls: wallsForRender,
      masterWallThickness: fp.masterWallThickness,
      pxPerMeter: canvasPxPerMeter,
    }
  }, [wallsForRender, activeFloor?.floorPlan, canvasPxPerMeter])

  const planLabelWireCollision = useMemo(
    function () {
      if (planWireRoutes.length === 0) return null
      return {
        routes: planWireRoutes,
        routeStyle: planWiringVisibility.defaultStyle,
        placementPositionOverrides: planDragPositions,
      }
    },
    [planWireRoutes, planWiringVisibility.defaultStyle, planDragPositions]
  )

  // Calculate label positions (using labelRecalcKey from drag handling)
  const labelPositions = usePlanLabelPositions(
    placements,
    planImageForAnalysis,
    planImagePosition,
    baseSymbolSizePx,
    labelRecalcKey,
    !isFloorPlanMode || isExporting,
    planLabelWallCollision,
    planLabelWireCollision,
    tempPxPerMeter == null,
    isFloorPlanMode && !isExporting,
    `${projectId}:${activeFloorId}`
  )

  // Create drag handlers with latest label positions
  const multiSelectHandlers = useMemo(
    () => createMultiSelectDragHandlers(labelPositions, baseSymbolSizePx),
    [createMultiSelectDragHandlers, labelPositions, baseSymbolSizePx]
  )
  const latestMultiSelectHandlersRef = useRef(multiSelectHandlers)
  useLayoutEffect(() => {
    latestMultiSelectHandlersRef.current = multiSelectHandlers
  }, [multiSelectHandlers])
  const stableMultiSelectHandlers = useMemo(
    () => ({
      onMultiSelectDragStart: (endpointId: string) =>
        latestMultiSelectHandlersRef.current.onMultiSelectDragStart(endpointId),
      onMultiSelectDrag: (endpointId: string, position: Point2) =>
        latestMultiSelectHandlersRef.current.onMultiSelectDrag(endpointId, position),
      onMultiSelectDragEnd: () => latestMultiSelectHandlersRef.current.onMultiSelectDragEnd(),
    }),
    []
  )
  const latestSingleDragHandlersRef = useRef(
    new Map<string, ReturnType<typeof createSingleDragHandlers>>()
  )
  const stableSingleDragHandlersRef = useRef(
    new Map<string, ReturnType<typeof createSingleDragHandlers>>()
  )
  const getSingleDragHandlers = useCallback(
    (placement: Placement) => {
      const latest = createSingleDragHandlers(
        placement,
        labelPositions,
        baseSymbolSizePx,
        planImageForAnalysis,
        planImagePosition,
        activeFloorId
      )
      latestSingleDragHandlersRef.current.set(placement.id, latest)
      const cached = stableSingleDragHandlersRef.current.get(placement.id)
      if (cached) return cached
      const stable: ReturnType<typeof createSingleDragHandlers> = {
        onDragStart: () => {
          latestSingleDragHandlersRef.current.get(placement.id)?.onDragStart()
        },
        onDragMove: (event) => {
          latestSingleDragHandlersRef.current.get(placement.id)?.onDragMove(event)
        },
        onDragEnd: (position: Point2) => {
          latestSingleDragHandlersRef.current.get(placement.id)?.onDragEnd(position)
        },
      }
      stableSingleDragHandlersRef.current.set(placement.id, stable)
      return stable
    },
    [
      activeFloorId,
      baseSymbolSizePx,
      createSingleDragHandlers,
      labelPositions,
      planImageForAnalysis,
      planImagePosition,
    ]
  )
  const selectionFrameDragHandlers = createSelectionFrameDragHandlers(labelPositions)

  // Note: Panel selection sync is handled in PlacementSymbol component
  // When a panel is selected, the panel_distribution endpoint will check if its panel is selected
  // and highlight accordingly, without changing the selection type

  // Compute world-space axis-aligned bounding box for a placement,
  // accounting for scale, rotation, and multi-socket extra width
  const { getPlacementWorldBoundsMemo, handleFindElementsInRectangle } =
    usePlanCanvasMarqueeSelection({
      baseSymbolSizePx,
      activeTool,
      isFloorPlanMode,
      activeFloor,
      visiblePlacements,
      getEndpointById,
    })

  // Floor plan keyboard shortcuts are now handled by FloorPlanMode component

  // Image loading is now handled by usePlanImage hook

  // Handle tool changes
  const { handlePlanImageTransformEnd, handlePlanImageClick, handleDeleteSelectedPlanImage } =
    usePlanImageInteractions({
      activeTool,
      planImageRef,
      transformerRef,
      activeFloorId,
      planImagePosition,
      planImageRotationDeg,
      clearSelection,
      applySelectedPlanImageId,
      getFloorById,
      dialog,
      t,
      applyActiveTool,
    })

  // Update floor selector
  const floors = currentProjectFloors
  const defaultFloor = floors.length > 0 ? floors[0] : null

  useEffect(
    function () {
      const hasActiveFloorInProject = !!(
        activeFloorId && floors.some((floor) => floor.id === activeFloorId)
      )
      if (defaultFloor && !hasActiveFloorInProject) {
        applyActiveFloor(defaultFloor.id)
      }
    },
    [activeFloorId, defaultFloor, floors, applyActiveFloor]
  )

  // Keep sitplan panel filter project-local: clear stale panel IDs after project switches.
  useEffect(
    function () {
      if (sitplanPanelFilterId && !getPanelById(sitplanPanelFilterId)) {
        setSitplanPanelFilterId(null)
      }
    },
    [sitplanPanelFilterId, getPanelById, setSitplanPanelFilterId, currentProject]
  )

  useEffect(
    () => () => {
      if (quickPlacerHintTimeoutRef.current != null) {
        window.clearTimeout(quickPlacerHintTimeoutRef.current)
      }
    },
    [window]
  )

  const {
    closeQuickPlacer,
    quickPlacerVisible,
    handleQuickPlacerModeChange,
    handleQuickPlacerSelectedCircuitChange,
    openQuickPlacerAtFirstAwaiting,
    handleQuickPlacerSelectedPanelChange,
    handleQuickPlacerItemActivate,
    handleQuickPlacerItemHoverStart,
    handleQuickPlacerItemHoverEnd,
    handleQuickPlacerItemDragStart,
    handleQuickPlacerItemDragEnd,
    applyQuickPlacerPlacement,
    handleQuickPlacerFastSkip,
    handleQuickPlacerFastPlace,
    toggleQuickPlacerByShortcut,
  } = usePlanQuickPlacerController({
    applyQuickPlacerOpen,
    leftDockPanel,
    applyLeftDockPanel,
    applyQuickPlacerMode,
    applyQuickPlacerManualCircuitFocusToken,
    applyQuickPlacerFastIndex,
    applyQuickPlacerDraggedPlacementId,
    quickPlacerDraggedPlacementIdRef,
    applyQuickPlacerCursorHint,
    applyQuickPlacerFastPreviewClient,
    clearHover,
    planIsInLayout,
    quickPlacerOpen,
    quickPlacerDocked,
    leftDockCollapsed,
    applyQuickPlacerDockHost,
    document,
    window,
    quickPlacerCircuits,
    quickPlacerSelectedCircuitId,
    applyQuickPlacerSelectedCircuitId,
    quickPlacerFastIndex,
    quickPlacerMode,
    quickPlacerSequence,
    quickPlacerWasFastRef,
    quickPlacerPreviousSelectionRef,
    selection,
    applySelection,
    selectedQuickPlacerCircuit,
    quickPlacerManualCircuitFocusToken,
    requestFitToView,
    currentQuickPlacerFastItem,
    suppressQuickPlacerPanelFocusRef,
    applyHover,
    quickPlacerFastAutoSkipCustom,
    applyQuickPlacerFastAutoSkipCustom,
    applyQuickPlacerFocusPlacementId,
    eendraadIsInLayout,
    activeFloorId,
    getPlacementById,
    snapPlacementPosition,
    getEndpointById,
    planImageForAnalysis,
    planImagePosition,
    wallsForRender,
    baseSymbolSizePx,
    updatePlacement,
    showQuickPlacerHint,
    clientToPlan,
    isActiveViewport,
    floors,
    applyActiveFloor,
    quickPlacerPanelRef,
    containerRef,
  })

  const toggleWiringByShortcut = useCallback(
    function () {
      applyActiveTool(activeTool === 'wiring' ? 'none' : 'wiring')
    },
    [activeTool, applyActiveTool]
  )

  const applyFloorPlanModeAndClearSelection = useCallback(
    (enabled: boolean) => {
      applySelection({ type: null, ids: [] })
      applySelectedPointIndices(new Map())
      applySelectedSegmentIndices(new Map())
      applySelectedStairPointIndices(new Map())
      applyIsFloorPlanMode(enabled)
      applyActiveTool(enabled ? 'select' : 'none')
    },
    [
      applyActiveTool,
      applyIsFloorPlanMode,
      applySelectedPointIndices,
      applySelectedSegmentIndices,
      applySelectedStairPointIndices,
      applySelection,
    ]
  )

  const exitFloorPlanModeKeepSelection = useCallback(
    function () {
      applySelectedPointIndices(new Map())
      applySelectedSegmentIndices(new Map())
      applySelectedStairPointIndices(new Map())
      applyIsFloorPlanMode(false)
      applyActiveTool('none')
    },
    [
      applyActiveTool,
      applyIsFloorPlanMode,
      applySelectedPointIndices,
      applySelectedSegmentIndices,
      applySelectedStairPointIndices,
    ]
  )

  const selectionForDrawModeExit = useCanvasUIStore((s) => s.selection)

  // When a sitplan-visible symbol is selected while drawing walls, leave draw mode so it can be moved.
  useEffect(
    function () {
      if (!isFloorPlanMode || !activeFloorId || !planIsInLayout || !eendraadIsInLayout) return

      const floorPlacements = getPlacementsByFloor(activeFloorId)
      const hasEndpointPlacement = (endpointId: string): boolean =>
        floorPlacements.some(
          (placement: Placement & { endpointId?: string }) => placement.endpointId === endpointId
        )
      const isVisibleEndpointOnFloor = (endpointId: string): boolean => {
        const endpoint = getEndpointById(endpointId)
        return (
          !!endpoint && endpointSymbolVisibleOnSitplan(endpoint) && hasEndpointPlacement(endpointId)
        )
      }

      let selectedPlanVisibleSymbol = false
      if (selectionForDrawModeExit.type === 'endpoint') {
        selectedPlanVisibleSymbol = selectionForDrawModeExit.ids.some(isVisibleEndpointOnFloor)
      } else if (selectionForDrawModeExit.type === 'placement') {
        selectedPlanVisibleSymbol = selectionForDrawModeExit.ids.some((placementId) => {
          const placement = floorPlacements.find((candidate) => candidate.id === placementId)
          if (placement?.endpointId) return isVisibleEndpointOnFloor(placement.endpointId)
          if (!placement?.trunkDeviceId) return false

          const trunkDevice = getTrunkDeviceById(placement.trunkDeviceId)?.device
          return !!trunkDevice && canSymbolAppearOnSituationPlan(trunkDevice.symbol)
        })
      } else if (selectionForDrawModeExit.type === 'trunkDevice') {
        selectedPlanVisibleSymbol = selectionForDrawModeExit.ids.some((trunkDeviceId) => {
          const trunkDevice = getTrunkDeviceById(trunkDeviceId)?.device
          return (
            !!trunkDevice &&
            canSymbolAppearOnSituationPlan(trunkDevice.symbol) &&
            floorPlacements.some(
              (placement: Placement & { trunkDeviceId?: string }) =>
                placement.trunkDeviceId === trunkDeviceId
            )
          )
        })
      } else if (selectionForDrawModeExit.type === 'panel' && currentProject) {
        selectedPlanVisibleSymbol = selectionForDrawModeExit.ids.some((panelId) =>
          getAllEndpoints().some(
            (endpoint) =>
              endpoint.symbol === 'panel_distribution' &&
              resolvePanelForDistributionEndpoint(currentProject, endpoint)?.id === panelId &&
              hasEndpointPlacement(endpoint.id)
          )
        )
      }

      if (!selectedPlanVisibleSymbol) return

      exitFloorPlanModeKeepSelection()
    },
    [
      selectionForDrawModeExit,
      isFloorPlanMode,
      activeFloorId,
      planIsInLayout,
      eendraadIsInLayout,
      currentProject,
      getEndpointById,
      getPlacementsByFloor,
      getTrunkDeviceById,
      getAllEndpoints,
      exitFloorPlanModeKeepSelection,
    ]
  )

  const toggleDrawModeByShortcut = useCallback(
    function () {
      applyFloorPlanModeAndClearSelection(!isFloorPlanMode)
    },
    [isFloorPlanMode, applyFloorPlanModeAndClearSelection]
  )

  const planToolShortcuts = useMemo(
    () => ({
      onToggleQuickPlacer: toggleQuickPlacerByShortcut,
      onToggleWiring: toggleWiringByShortcut,
      onToggleDrawMode: toggleDrawModeByShortcut,
      canToggleQuickPlacerAndWiring: canPlaceSymbols && !isFloorPlanMode,
      canToggleDrawMode: canEditFloorPlan,
    }),
    [
      toggleQuickPlacerByShortcut,
      toggleWiringByShortcut,
      toggleDrawModeByShortcut,
      canPlaceSymbols,
      isFloorPlanMode,
      canEditFloorPlan,
    ]
  )

  const {
    deleteSelectedWallGeometry,
    commitWallSegmentLength,
    commitWallOpeningDistance,
    handleWallDimensionDrag,
  } = usePlanWallGeometryActions({
    isFloorPlanMode,
    activeFloor,
    viewportUI,
    selectedSegmentIndices,
    selectedPointIndices,
    applySelectedPointIndices,
    applySelectedSegmentIndices,
    clearSelection,
    canvasPxPerMeter,
    updateWall,
    wallDimensionDragRef,
    applyPreviewWalls,
    applyPreviewDoors,
    applyPreviewWindows,
    planView,
    gridSize,
  })

  // Keyboard shortcuts are now handled by usePlanKeyboard hook
  usePlanKeyboard(activeFloorId, {
    pointerOverPlanRef,
    suppressDigitFloorShortcuts: quickPlacerVisible && quickPlacerMode === 'fast',
    onBeforeSwitchFloor: handleBeforeFloorSwitch,
    disabled: !canDeleteItems,
    onDeleteFloorPlanSelection: deleteSelectedWallGeometry,
    floorPlanClipboard: {
      onCopy: handleCopyFloorPlanSelection,
      onPaste: handlePasteFloorPlanSelection,
    },
    toolShortcuts: planToolShortcuts,
    symbolNudge: {
      pxPerMeter,
      setPreviewPositions: setPlanDragPreviewPositions,
      isDraggingRef,
      onCommit: () => setLabelRecalcKey((key) => key + 1),
    },
  })

  useEffect(
    function () {
      const handleDeletePlanImageKey = (e: KeyboardEvent) => {
        if (!isActiveViewport()) return
        if (isKeyboardTypingTarget(e.target)) {
          return
        }
        const isDeleteKey = e.key === 'Delete' || e.code === 'Delete'
        if (!isDeleteKey) return
        // usePlanKeyboard runs first; only delete the plan image if it did not handle Delete.
        if (e.defaultPrevented) return
        const canDeletePlanImage =
          canDeleteItems && activeTool === 'move' && hasPlanImage && !!activeFloorId
        if (!canDeletePlanImage) return
        e.preventDefault()
        handleDeleteSelectedPlanImage()
      }
      window.addEventListener('keydown', handleDeletePlanImageKey)
      return () => window.removeEventListener('keydown', handleDeletePlanImageKey)
    },
    [
      activeTool,
      activeFloorId,
      canDeleteItems,
      hasPlanImage,
      handleDeleteSelectedPlanImage,
      window,
      isActiveViewport,
    ]
  )

  const {
    handleDrop,
    libraryDropPreview,
    handleLibraryDragOver,
    handlePlanFilesDrop,
    closeImportDialog,
    handleAddGraphicElementFromContextMenu,
    handleAddNoteFromContextMenu,
    baseGetContextMenuItems,
  } = usePlanLibraryDropController({
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
  })
  const getProjectState = useProjectStore.getState
  const getDialogState = useDialogStore.getState
  const { handleGetContextMenuItems } = usePlanGeometryContextMenu({
    withJunctionEditorItem,
    baseGetContextMenuItems,
    viewportUI,
    t,
    canDeleteItems,
    activeTool,
    hasPlanImage,
    activeFloorId,
    handleDeleteSelectedPlanImage,
    canEditFloorPlan,
    isFloorPlanMode,
    activeFloor,
    getProjectState,
    clearSelection,
    selectedPointIndices,
    selectedSegmentIndices,
    deleteSelectedWallGeometry,
    selectedWallsForCopy,
    selectedStairsForCopy,
    currentProjectFloors,
    selectedOpeningsForCopy,
    openDialog,
    handleCopySelectionToFloors,
    getDialogState,
  })

  // Get selection bounds for selection visual feedback (reads live drag overrides from planDragVisualStore)
  const { handleGetSelectionBounds } = usePlanCanvasSelectionBounds({
    viewportUI,
    getPlacementsByFloor,
    getPlacementWorldBoundsMemo,
    getEndpointById,
  })

  const handleAddElementSelect = useCallback(
    (symbol: SymbolMetadata, position: Point) => {
      handleDrop(position, symbol)
      applyAddElementDropPosition(null)
    },
    [handleDrop]
  )
  const {
    handleQuickPlacerDragOver,
    handleQuickPlacerDrop,
    handleQuickPlacerFastOverlayPointerDown,
    handleQuickPlacerFastOverlayPointerMove,
    handleQuickPlacerFastOverlayPointerLeave,
    handleQuickPlacerFastOverlayContextMenu,
  } = usePlanQuickPlacerCanvasEvents({
    quickPlacerVisible,
    quickPlacerMode,
    quickPlacerDraggedPlacementId,
    quickPlacerDraggedPlacementIdRef,
    clientToPlan,
    applyQuickPlacerPlacement,
    getPlacementById,
    getEndpointById,
    applySelection,
    showQuickPlacerHint,
    applyQuickPlacerDraggedPlacementId,
    containerRef,
    window,
    handleQuickPlacerFastPlace,
    applyQuickPlacerFastPreviewClient,
    handleQuickPlacerFastSkip,
  })

  // Each symbol takes wires in two parts: its core sits above the plan wires (the symbol wins),
  // while the outer ring sits below them, so a wire between close symbols stays grabbable.
  const { renderPlanWireSymbolHits } = createPlanWireSymbolHitRenderer({
    activeTool,
    isExporting,
    visiblePlacements,
    planDragPositions,
    baseSymbolSizePx,
    planView,
    planWireDragSourcePlacementId,
    planWireHoverPlacementId,
    getPlanWireTargetStatus,
    wiringRedrawProgress,
    wiringFocusPlacementIdSet,
    applyPlanWireHoverPlacementId,
    applyPlanWirePreviewPoint,
    applyPlanWireDragSourcePlacementId,
  })

  return (
    <CanvasOverlayScaleProvider containerRef={containerRef}>
      <div
        ref={containerRef}
        className="relative w-full h-full"
        data-canvas-overlay-root
        data-1p-ignore
        data-op-ignore
        onMouseEnter={() => {
          pointerOverPlanRef.current = true
        }}
        onMouseLeave={() => {
          pointerOverPlanRef.current = false
          applyHoveredWallId(null)
        }}
        onDragOverCapture={canPlaceSymbols ? handleQuickPlacerDragOver : undefined}
        onDropCapture={canPlaceSymbols ? handleQuickPlacerDrop : undefined}
      >
        {canPlaceSymbols && addElementDropPosition && (
          <AddElementPicker
            dropPosition={addElementDropPosition}
            scope="situatieplan"
            onSelect={handleAddElementSelect}
            onClose={() => applyAddElementDropPosition(null)}
          />
        )}
        {graphicElementDropPicker && (
          <PlanGraphicElementPicker
            clientAnchor={graphicElementDropPicker.clientAnchor}
            label={t('floorPlanTools.graphicElements')}
            onClose={() => applyGraphicElementDropPicker(null)}
            onAddNote={() => handleAddNoteFromContextMenu(graphicElementDropPicker.planPosition)}
            onAddGraphicElement={(assetId) =>
              handleAddGraphicElementFromContextMenu(graphicElementDropPicker.planPosition, assetId)
            }
          />
        )}
        {canPlaceSymbols && planDropCircuitPicker && (
          <PlanDropCircuitPanel
            key={planDropCircuitPicker.endpointIds.join(',')}
            nonModal={libraryArmed}
            avoidBounds={planDropCircuitPicker.avoidBounds}
            onCloseButton={() => {
              if (viewportUI.getState().armedLibrarySymbol != null) {
                planDropPickerDismissedWhileArmedRef.current = true
              }
            }}
            endpointIds={planDropCircuitPicker.endpointIds}
            assignedPanelId={planDropCircuitPicker.assignedPanelId}
            assignedCircuitId={planDropCircuitPicker.assignedCircuitId}
            symbol={planDropCircuitPicker.symbol}
            dropKind={planDropCircuitPicker.dropKind}
            undoGroupStartIndex={planDropCircuitPicker.undoGroupStartIndex}
            provisionalCircuitIds={planDropCircuitPicker.provisionalCircuitIds}
            clientAnchor={planDropCircuitPicker.clientAnchor}
            onDismiss={() => {
              finalizePlanDropCircuitPickerUndoGroup(planDropCircuitPicker.undoGroupStartIndex)
              applyPlanDropCircuitPicker(null)
            }}
            onAfterCircuitAssignment={
              eendraadIsInLayout
                ? (circuitId) => {
                    const sel = viewportUI.getState().selection
                    requestEendraadCircuitFitThenRestoreSelection({
                      circuitId,
                      restoreSelection: sel,
                      setSelection: applySelection,
                      requestFitToView,
                    })
                  }
                : undefined
            }
          />
        )}
        {renderPlanCanvasViewport({
          activeFloorId,
          planView,
          canvasRef,
          activeTool,
          planMinZoom,
          gridSize,
          handleZoomChange,
          handlePanChange,
          handleViewTransformCommit,
          canPlaceSymbols,
          handleDrop,
          handleLibraryDragOver,
          handlePlanFilesDrop,
          handleFindElementsInRectangle,
          handleCaptureRectangle,
          canDeleteItems,
          canEditFloorPlan,
          handleGetContextMenuItems,
          handleGetSelectionBounds,
          preparePlanFitToView,
          onMultiFingerSwipe,
          handleViewportPanStateChange,
          applyPlanCanvasViewportPx,
          
          
          enablePlanSingleFingerPan,
          floorPlanTouchDragToolActive,
          suppressPlanHitTesting,
          isExporting,
          waypointPreviewStore,
          planWiringVisibility,
          theme,
          canvasPxPerMeter,
          getEndpointById,
          getPlanWireTrunkDeviceById,
          junctionPanelPlanPlacements,
          planWireStrokeFor,
          clientToPlan,
          planWirePreviewSource,
          planWirePreviewPointStore,
          planDragPositions,
          planWirePreviewTarget,
          planWireHoverPlacementId,
          isFloorPlanMode,
          activeFloor,
          currentProject,
          tempPxPerMeter,
          applyActiveTool,
          applyFloorPlanModeAndClearSelection,
          selectedGraphicAssetId,
          handleWallHover,
          handleOpeningPreviewOverrideChange,
          applyOpeningSelectionArmedTool,
          planImage,
          planVisibility,
          planImagePosition,
          planImageRotationDeg,
          isResettingScale,
          clearSelection,
          applySelectedPlanImageId,
          setPlanImagePosition,
          handlePlanImageClick,
          setPlanImageRef,
          handlePlanImageTransformEnd,
          planImageDisplayWidth,
          planImageDisplayHeight,
          setTransformerRef,
          planFloorOverlayIds,
          movePlanOverlayFloorIds,
          pxPerMeter,
          applyContentDrawingSnapGuides,
          graphicElementsForRender,
          selectedGraphicElementIds,
          fontFamily,
          snapGraphicFloorPoint,
          applyVertexMoveProjectedSnapGuides,
          handleGraphicElementSelect,
          handleGraphicElementMove,
          handleGraphicElementResize,
          updatePlanGraphicElement,
          insertPointPreview,
          hoveredDoorId,
          hoveredWindowId,
          wallSelectionBounds,
          beginWallSelectionDrag,
          updateWallSelectionDrag,
          endWallSelectionDrag,
          stairSelectionBounds,
          beginStairSelectionDrag,
          updateStairSelectionDrag,
          endStairSelectionDrag,
          doorsForRender,
          makeCanvasPointFromEvent,
          selection,
          doorDragRef,
          applyOpeningMoveFromPointer,
          toolMoveHandleColor,
          toolMoveHandleStrokeColor,
          windowsForRender,
          openingWidthEditorActive,
          setOpeningWidthEditorActive,
          beginOpeningDimensionDrag,
          applyOpeningDimensionDrag,
          endOpeningDimensionDrag,
          selectedOpeningForWidthEditor,
          openingWidthText,
          clipPreviewPoints,
          renderPlanWireSymbolHits,
          suppressHeavyLayersWhilePanning,
          planWireRoutes,
          planSymbolAndWireOpacity,
          highlightedPlanWireRouteIds,
          hoveredPlanWireRouteIds,
          planWireDragSourcePlacementId,
          wiringFocusScope,
          wiringPreviewRouteIds,
          wiringFocus,
          handleInsertFocusedPlanWireWaypoint,
          handleMovePlanWireWaypoint,
          handleMovePlanWireRiser,
          handleRemovePlanWireWaypoint,
          raisedRiserRouteIds,
          planWireRiserPreview,
          applyPlanWireRiserPreview,
          selectedRiserRouteIds,
          handleMovePlanWireRisers,
          visiblePlacements,
          baseSymbolSizePx,
          effectivePlanZoom,
          placementInteractivitySuppressed,
          canDragItems,
          stableSnapPlacementPosition,
          currentQuickPlacerFastItem,
          stableMultiSelectHandlers,
          getSingleDragHandlers,
          labelPositions,
          planLabelFontSize,
          libraryDropPreview,
          quickPlacerFastPreviewPlacement,
          quickPlacerFastPreviewLabelPosition,
          raisedRiserRoutes,
          placements,
          getPlacementWorldBoundsMemo,
          sitplanNotes,
          planNotesInteractive,
          updateSitplanNote: updateSituationPlanNoteProperties,
          selectionFrameDragHandlers,
          contentDrawingSnapGuides,
          vertexMoveProjectedSnapGuides,
          getFloorById,
          handleScaleRulerCancel,
          handleScaleRulerComplete,
          scaleRulerCommitSignal,
          scaleRulerMeters,
          applyScaleRulerMeters,
          applyScaleRulerMetersInput,
          applyScaleRulerPoints,
          stairsForRender,
          spiralRotationPreview,
          selectedStairId,
          hoveredStairId,
          selectedStairPointIndices,
          shouldKeepGeometryTouchSelection,
          applySelection,
          applySelectedStairPointIndices,
          getCurrentMixedPointSelection,
          buildEncodedFloorPointIds,
          applyHoveredStairId,
          handleStairPointDragStart,
          handleStairPointMove,
          handleStairPointDragEnd,
          wallsForRender,
          selectedWallIds,
          selectedPointIndices,
          selectedSegmentIndices,
          commitWallSegmentLength,
          commitWallOpeningDistance,
          handleWallDimensionDrag,
          shouldHandleWallHover,
          hoveredWallId,
          openingPreview,
          retainDirectOpeningSelectionForMixed,
          clearMixedOpeningSelection,
          updateWall,
          applyClipPreviewPoints,
          viewportUI,
          applySelectedPointIndices,
          applySelectedSegmentIndices,
          resolveScopedPointTarget,
          scopedWallIdForVertexSelection,
          pointDragTargetsRef,
          vertexDragInitialOpeningsRef,
          vertexDragAnchorRef,
          vertexDragInitialPointsRef,
          buildMergedPointTargets,
          baseDoors,
          baseWindows,
          applyMergedPointMove,
          applyPreviewWalls,
          lastWallPointUpdateTimeRef,
          selectedDoorIds,
          selectedWindowIds,
          canSelectDoorsInInsertMode,
          toggleMixedOpeningSelection,
          applyHoveredDoorId,
          canSelectWindowsInInsertMode,
          applyHoveredWindowId,
          shouldListenToWalls,
          doorsListening,
          windowsListening,
          setSpiralRotationPreview,
          updateStair,

          

          WallScanPreviewLayer,
        })}

        <FloorPlanDrawDimensionInput pan={planView.pan} zoom={planView.zoom} />

        {quickPlacerVisible && quickPlacerMode === 'fast' && currentQuickPlacerFastItem && (
          <div
            ref={quickPlacerFastOverlayRef}
            className="pointer-events-none absolute inset-0 z-20"
            onPointerEnter={handleQuickPlacerFastOverlayPointerMove}
            onPointerMove={handleQuickPlacerFastOverlayPointerMove}
            onPointerLeave={handleQuickPlacerFastOverlayPointerLeave}
            onPointerDown={handleQuickPlacerFastOverlayPointerDown}
            onContextMenu={handleQuickPlacerFastOverlayContextMenu}
          />
        )}

        {/* Scale ruler distance input overlay (outside Konva to avoid React Konva DOM errors) */}
        {isResettingScale && (
          <div
            className="fixed z-[9999] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md p-4 shadow-lg"
            role="dialog"
            aria-label={t('plan.resetScale.distance')}
          >
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('plan.resetScale.distance')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={scaleRulerMetersInput}
                onChange={(e) => {
                  const normalized = e.target.value.replace(',', '.')
                  if (!/^\d*\.?\d*$/.test(normalized)) return
                  applyScaleRulerMetersInput(normalized)
                  applyScaleRulerMeters(parsePlanMeters(normalized))
                }}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                autoFocus
                onKeyDown={(e) => {
                  if (
                    e.key === 'Enter' &&
                    scaleRulerMeters != null &&
                    scaleRulerPoints.p1 &&
                    scaleRulerPoints.p2 &&
                    createPlanScaleReference(
                      scaleRulerPoints.p1,
                      scaleRulerPoints.p2,
                      scaleRulerMeters
                    )
                  ) {
                    applyScaleRulerCommitSignal((s) => s + 1)
                  } else if (e.key === 'Escape') {
                    handleScaleRulerCancel()
                  }
                }}
              />
              <button
                type="button"
                onClick={() => applyScaleRulerCommitSignal((s) => s + 1)}
                disabled={
                  scaleRulerMeters == null ||
                  !scaleRulerPoints.p1 ||
                  !scaleRulerPoints.p2 ||
                  !createPlanScaleReference(
                    scaleRulerPoints.p1,
                    scaleRulerPoints.p2,
                    scaleRulerMeters
                  )
                }
                className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-md"
              >
                {t('common.ok')}
              </button>
              <button
                type="button"
                onClick={handleScaleRulerCancel}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        <ViewNavigationToolbar
          zoom={planView.zoom}
          minZoom={planMinZoom}
          onZoomChange={handleZoomChange}
          onPanChange={handlePanChange}
          onFitToView={handleFitToView}
          canvasType="plan"
        />

        {/* Breadcrumb - positioned at top center, below toolbar
          Shows hierarchy for selected panel, circuit, or endpoint */}
        {activeTool === 'wiring' && wiringFocusTarget && !isExporting && (
          <PlanWiringCircuitBar
            circuits={wiringCircuitOptions}
            focusCircuitId={wiringFocusTarget.circuitId}
            onFocusCircuit={wiringFocus.focusCircuit}
            redrawProgress={wiringRedrawProgress}
            onStartRedraw={() =>
              wiringFocus.startRedraw(wiringFocusTarget.circuitId, wiringFocusPlacementIds)
            }
            onFinishRedraw={wiringFocus.finishRedraw}
          />
        )}
        {!(activeTool === 'wiring' && wiringFocusTarget) && (
          <PlanCanvasSelectionBreadcrumb
            themeMode={theme.mode}
            visiblePlacements={visiblePlacements}
            placements={placements}
            currentProject={currentProject}
            getEndpointById={getEndpointById}
            getCircuitById={getCircuitById}
            getCircuitIdentifier={getCircuitIdentifier}
            findCircuitForEndpoint={findCircuitForEndpoint}
            findPanelForCircuit={findPanelForCircuit}
            getAllEndpoints={getAllEndpoints}
            getPanelPathFromRoot={getPanelPathFromRoot}
            setHover={applyHover}
            clearHover={clearHover}
            setSelection={applySelection}
          />
        )}

        {/* Left-side tools for plan canvas (non-draw mode) */}
        {renderPlanCanvasToolRail({
          canPlaceSymbols,
          isFloorPlanMode,
          awaitingPlanPlacementCount,
          t,
          quickPlacerOpen,
          quickPlacerDocked,
          closeQuickPlacer,
          openQuickPlacerAtFirstAwaiting,
          activeTool,
          applyActiveTool,
          canEditFloorPlan,
          applyFloorPlanModeAndClearSelection,
          setPendingImportFile,
          applyIsImportDialogOpen,
          hasPlanImage,
          canResetPlanScale,
          isResettingScale,
          handleScaleRulerCancel,
          handleResetScaleStart,
        })}

        {/* Floor Plan Tools (DOM overlay; must stay outside Konva tree) */}
        {canEditFloorPlan && isFloorPlanMode && (
          <FloorPlanTools
            onToolChange={applyActiveTool}
            activeTool={activeTool}
            onToggleDrawMode={() => {
              applyFloorPlanModeAndClearSelection(false)
            }}
            selectedGraphicAssetId={selectedGraphicAssetId}
            onGraphicAssetChange={applySelectedGraphicAssetId}
          />
        )}

        {/* Scale Indicator */}
        <ScaleIndicator />
        {}
        {isCableRoutesEnabled() && activeTool === 'wiring' && !isExporting && (
          <PlanWireLegend readOnly={!canEditFloorPlan} />
        )}

        {/* Floating right-side controls: grid, floors, visibility */}
        {renderPlanCanvasViewRail({
          openMenu,
          t,
          applyOpenMenu,
          planView,
          applyPlanView,
          canEditFloorPlan,
          i18n,
          activeFloorId,
          isFloorPlanMode,
          applyActiveFloor,
          requestFitToView,
          activeTool,
        })}

        {canPlaceSymbols && ownsQuickPlacer && (
          <QuickPlacerPanel
            ref={quickPlacerPanelRef}
            open={quickPlacerOpen || quickPlacerDocked}
            circuits={quickPlacerCircuits}
            selectedCircuitId={quickPlacerSelectedCircuitId}
            onSelectedCircuitIdChange={handleQuickPlacerSelectedCircuitChange}
            onSelectedPanelIdChange={handleQuickPlacerSelectedPanelChange}
            mode={quickPlacerMode}
            onModeChange={handleQuickPlacerModeChange}
            fastAutoSkipCustom={quickPlacerFastAutoSkipCustom}
            onFastAutoSkipCustomChange={applyQuickPlacerFastAutoSkipCustom}
            currentFastItem={currentQuickPlacerFastItem}
            currentFastIndex={quickPlacerFastIndex}
            currentFastCount={quickPlacerSequence.length}
            onClose={closeQuickPlacer}
            renderMode={quickPlacerDocked ? 'docked' : 'floating'}
            dockHost={quickPlacerDockHost}
            onDockRequest={() => {
              applyQuickPlacerOpen(false)
              applyLeftDockPanel('quickPlacer')
            }}
            onDockPreviewChange={(active) => {
              applyLeftDockPreviewPanel(active ? 'quickPlacer' : null)
            }}
            externalDragStart={quickPlacerDragSeed}
            onItemActivate={handleQuickPlacerItemActivate}
            onItemHoverStart={handleQuickPlacerItemHoverStart}
            onItemHoverEnd={handleQuickPlacerItemHoverEnd}
            onItemDragStart={handleQuickPlacerItemDragStart}
            onItemDragEnd={handleQuickPlacerItemDragEnd}
            focusPlacementId={quickPlacerFocusPlacementId}
          />
        )}

        <style>{`
          @keyframes quick-placer-hint-fade {
            0% { opacity: 0; transform: translateY(6px) scale(0.96); }
            18% { opacity: 1; transform: translateY(0) scale(1); }
            72% { opacity: 0.92; transform: translateY(-1px) scale(1); }
            100% { opacity: 0; transform: translateY(-6px) scale(0.985); }
          }
        `}</style>
        {quickPlacerCursorHint && (
          <div
            className={`pointer-events-none fixed z-[130] rounded-full border px-3 py-1.5 text-xs font-semibold shadow-md ${
              quickPlacerCursorHint.tone === 'error'
                ? 'border-rose-500 bg-rose-600 text-white'
                : 'border-sky-300/70 bg-sky-200/50 text-sky-950'
            }`}
            style={{
              left: quickPlacerCursorHint.x + 14,
              top: quickPlacerCursorHint.y + 14,
              animation: 'quick-placer-hint-fade 900ms ease-out forwards',
            }}
          >
            {quickPlacerCursorHint.message}
          </div>
        )}

        {showCurvedWallOpeningHint && (
          <div className="pointer-events-none absolute inset-x-3 top-3 z-30 flex justify-center">
            <div
              role="status"
              className="max-w-sm rounded-md border border-gray-200 bg-white px-3 py-2 text-center text-xs text-gray-800 shadow-md dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            >
              {t('floorPlanTools.curvedWallOpeningHint')}
            </div>
          </div>
        )}

        <WallScanBar />

        {/* Import Dialog */}
        <ImportPlanImageDialog
          isOpen={isImportDialogOpen}
          initialFile={pendingImportFile}
          onClose={closeImportDialog}
        />
      </div>
    </CanvasOverlayScaleProvider>
  )
}

// PlacementSymbol and PlacementLabel are now in separate files
// See: src/components/canvas/plan/PlacementSymbol.tsx and PlacementLabel.tsx

export default PlanCanvas
