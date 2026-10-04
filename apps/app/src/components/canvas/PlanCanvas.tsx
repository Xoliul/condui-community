import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { Image, Group, Transformer, Line, Rect, Text, Circle, RegularPolygon } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores/uiStore'
import { logger } from '@/lib/logger'
import {
  setPlanDragPreviewPositions,
  usePlanDragPositionsMap,
  usePlanDragVisualStore,
} from '@/stores/planDragVisualStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
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
import {
  encodeStairPointId,
  encodeWallPointId,
  getPlanCanvasPointSelectionBounds,
  parseStairPointIds,
  parseWallPointIds,
  resolvePlanCanvasPointSelection,
  STAIR_POINT_ID_PREFIX,
} from '@/lib/plan/planCanvasPointSelection'
import {
  createFloorPlanClipboardPayload,
  pasteFloorPlanClipboardPayload,
  selectWallsForFloorPlanClipboard,
  type FloorPlanClipboardPayload,
} from '@/lib/plan/floorPlanClipboard'
import { endpointSymbolVisibleOnSitplan } from '@/lib/plan/planSymbolVisibility'
import { resolvePlanMarqueePlacementOwner } from '@/lib/plan/planMarqueeSelection'
import { canSymbolAppearOnSituationPlan } from '@/lib/plan/situationPlanSymbolEligibility'
import { CatalogSymbolImage } from './eendraad/CatalogSymbolImage'
import { getTouchPointHitRadiusCanvas } from '@/lib/canvas/touchHitZones'
import { getSymbolById, type SymbolMetadata } from '@/lib/symbols'
import type { CanvasDropMeta, Point, Selection } from '@/types/ui'
import type {
  Placement,
  Panel,
  Note,
  Wall,
  Point2,
  Door,
  Window,
  Stair,
  PlanGraphicElement,
  PlanWireKind,
  PlanWireRoute,
} from '@/types/schema'
import BaseCanvas, { type BaseCanvasHandle } from './BaseCanvas'
import ViewNavigationToolbar from './ViewNavigationToolbar'
import ImportPlanImageDialog from '../plan/ImportPlanImageDialog'
import FloorPlanTools from '../plan/FloorPlanTools'
import ScaleIndicator from '../plan/ScaleIndicator'
import { QuickPlacerToolIcon, useAwaitingPlanPlacementCount } from '../plan/QuickPlacerToolIcon'
import SitplanVisibilityPanel from '../plan/SitplanVisibilityPanel'
import CopyFloorPlanSelectionDialog from '../plan/CopyFloorPlanSelectionDialog'
import {
  PlanNote,
  PlanCanvasSelectionBreadcrumb,
  PlanMultiSelectFrame,
  PlanPlacementLabelsLayer,
  PlanPlacementSymbolsLayer,
  PlacementSymbol,
  PlacementLabel,
  PlanWireDragPreview,
  PlanWiresLayerWithDrag,
  FloorPlanMode,
  StairRenderer,
  WallRenderer,
  getStairBounds,
  PlanFloorReferenceOverlays,
  PlanGraphicElementRenderer,
  PlanInsertPointPreview,
  PlanOpeningResizeHandles,
  PlanOpeningWidthEditor,
} from './plan'
import { PlanDebugOverlay } from './plan/PlanDebugOverlay'
import { WallScanBar, WallScanPreviewLayer } from './plan/WallScanReview'

import { PlanSelectedCableRoutes } from '@/components/cableRouting/PlanSelectedCableRoutes'
import { isCableRoutesEnabled } from '@/lib/cableRouting/availability'
import {
  cableCategoryByCircuit,
  cableTraceColor,
  cableTraceInfoByAnchor,
  estimateCableRoutesCached,
  hasOwnCableToggle,
  isCableTraceShown,
  planWireRouteMatchesSelection,
} from '@/lib/cableRouting/cableRoutePlanWires'
import { selectedCableBounds } from '@/lib/cableRouting/cableRouteSelection'
import { PlanWireLegend } from '@/components/cableRouting/PlanWireLegend'
import { useCableHoverStore } from '@/components/cableRouting/cableHoverStore'
import { FloorPlanDrawDimensionInput } from './plan/FloorPlanDrawDimensionInput'
import type { PlanWireEndPlacement, PlanWireRiserPreview } from './plan/PlanWiresLayer'
import { planWireRiserRouteIdsInRect } from '@/lib/plan/planWiringRouteEdits'
import { CanvasOverlayScaleProvider } from '@/contexts/CanvasOverlayScaleContext'
import CanvasFloatingControlRail from './CanvasFloatingControlRail'
import { suggestRotationForPlacement } from '@/utils/planAutoOrient'
import { hasExplicitSituationPlanRotation } from '@/lib/plan/situationPlanRotation'
import FloorSelectionDialog from '../plan/FloorSelectionDialog'
import { useDialogStore } from '@/stores/dialogStore'
import { useCanvasRegistryStore } from '@/stores/canvasRegistryStore'
import { getPlacementWorldBounds } from '@/utils/plan/placementBounds'
import { calculateLabelPositions } from '@/utils/plan/labelPositioning'
import { createSitplanNote } from '@/lib/plan/sitplanNote'
import { commitPlanSymbolDrop } from '@/handlers/plan/dropHandlers'
import PlanDropCircuitPanel from '@/components/plan/PlanDropCircuitPanel'
import type { PlanDropKind } from '@/lib/plan/planDropPicker'
import { clamp, segmentIntersectsRect } from '@/lib/geometry'
import { isPrimaryPlanActivationEvent } from '@/lib/canvas/planPointerEvent'
import {
  endpointTypeToPlanDropKind,
  resolveInitialPlanDropAssignment,
} from '@/lib/plan/planDropPicker'
import { finalizePlanDropCircuitPickerUndoGroup } from '@/lib/plan/planDropCircuitSession'
import { requestEendraadCircuitFitThenRestoreSelection } from '@/lib/eendraad/focusCircuit'
import { getEndpointTypeFromSymbol } from '@/utils'
import AddElementPicker from '@/components/eendraad/AddElementPicker'
import { generateId } from '@/utils/project'
import {
  handleInsertPoint,
  getNearestSegmentIndex,
  handleClipWall,
  projectPointToWall,
  computeOpeningGeometry,
  getWallTotalLength,
  validateOpeningPlacement,
  resolveWindowInsertWidthPx,
  type WallOpeningGeometry,
} from '@/handlers/plan/wallDrawing'
import {
  constrainVertexMove,
  applyOpeningMoveOnSegment,
  getOpeningsBySegment,
  minSegmentLengthForOpenings,
  applyOpeningDistanceOnSegment,
  preserveOpeningPositionsAfterPointChange,
  sanitizeWallOpeningPositions,
  isRigidTranslation,
  adjustVerticesAndOpenings,
} from '@/lib/plan/constraints'
import {
  openingWallNormalDeadzoneCanvas,
  resolveDoorPlacementOrientation,
} from '@/lib/plan/doorSwingFromPointer'
import {
  fitOpeningPlacementForPreview,
  snapOpeningWidthToWholeCentimeters,
} from '@/lib/plan/openingPlacementDrag'
import {
  clampAnchoredDimensionResize,
  resizeDimensionFromDrag,
  resolveDimensionDrag,
  snapDimensionValue,
  type DimensionDragMode,
  type DimensionDragModifiers,
} from '@/lib/plan/dimensionDragGesture'
import { isFloorPlanTouchDragTool } from '@/lib/plan/planFloorDrawingKeyboardGate'
import {
  buildWallSelectionDeletionPlan,
  splitWallPointsAtDeletedSegments,
} from '@/lib/plan/wallSelectionDeletion'
import { resolveOpeningPositionSnap } from '@/lib/plan/openingPositionSnap'
import { dragWallShapeDimension, resizeWallShapeSegment } from '@/lib/plan/wallShapeResize'
import {
  getCurvedWallToolHoverFeedback,
  getWallPathPoints,
  isCurvedWall,
} from '@/lib/plan/wallCurve'
import type { OpeningOnSegment } from '@/lib/plan/constraints'
import { snapPlacementCenterToGrid, snapToGrid } from '@/utils/plan/gridSnap'
import {
  usePlanScale,
  usePlanGrid,
  resolvePlanCanvasPxPerMeter,
  usePlanPlacements,
  usePlanLabelPositions,
  type PlanLabelWallCollisionInput,
  usePlanImage,
  usePlanContextMenu,
  usePlanKeyboard,
  usePlanDragHandling,
  usePlanWireEditing,
  usePlanWireInteractionState,
  usePlanQuickPlacerState,
  usePlanScaleResetController,
  usePlanCanvasToolState,
  usePlanOpeningWidthEditor,
  type QuickPlacerMode,
  type QuickPlacerCursorHint,
} from '@/hooks/plan'
import { calculatePxPerMeter } from '@/hooks/plan/usePlanScale'
import { resolvePanelForDistributionEndpoint } from '@/lib/plan/panelDistributionEndpoint'
import { collectCircuits, flattenPanels } from '@/utils/eendraad/panelHelpers'
import { pickPlanFloorForSelectionFit } from '@/lib/plan/planFocusFloorForSelection'
import { healEarthingSitplanPlacements } from '@/lib/plan/earthingSitplanPlacement'
import { healAuxiliaryEnclosurePlanPlacements } from '@/lib/plan/auxiliaryEnclosurePlanPlacement'
import {
  buildQuickPlacerCircuits,
  findNextQuickPlacerCircuit,
  findFirstAwaitingQuickPlacerItem,
  flattenQuickPlacerCircuit,
  type QuickPlacerItem,
} from '@/lib/plan/quickPlacer'
import {
  PLAN_BACKGROUND_FLOOR_ATTR,
  PLAN_GRAPHIC_ELEMENT_ASSETS,
  createPlanGraphicElementDraft,
} from '@/lib/plan/graphicElements'
import {
  DRAW_TOOL_DASH_PX,
  DRAW_TOOL_HANDLE_OFFSET_PX,
  DRAW_TOOL_HANDLE_OFFSET_PX_MAX,
  DRAW_TOOL_HANDLE_OFFSET_PX_MIN,
  DRAW_TOOL_HANDLE_RADIUS_PX,
  DRAW_TOOL_HANDLE_RADIUS_PX_MAX,
  DRAW_TOOL_HANDLE_RADIUS_PX_MIN,
  DRAW_TOOL_POINT_RADIUS_PX,
  DRAW_TOOL_POINT_RADIUS_PX_MAX,
  DRAW_TOOL_POINT_RADIUS_PX_MIN,
  DRAW_TOOL_LINE_SNAP_ZONE_PX,
  DRAW_TOOL_LINE_SNAP_ZONE_PX_MAX,
  DRAW_TOOL_LINE_SNAP_ZONE_PX_MIN,
  OPENING_SPAN_CENTER_SNAP_ZONE_PX,
  OPENING_SPAN_CENTER_SNAP_ZONE_PX_MAX,
  OPENING_SPAN_CENTER_SNAP_ZONE_PX_MIN,
  DRAW_TOOL_PROJECTION_GUIDE_COLOR,
  DRAW_TOOL_PROJECTION_GUIDE_STROKE_PX,
  DRAW_TOOL_PROJECTION_GUIDE_STROKE_PX_MAX,
  DRAW_TOOL_PROJECTION_GUIDE_STROKE_PX_MIN,
  DRAW_TOOL_PROJECTION_SNAP_ZONE_PX,
  DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MAX,
  DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MIN,
  PROJECTED_SNAP_GUIDE_AUTO_CLEAR_MS,
  DRAW_TOOL_GRID_SNAP_BREAKAWAY_PX,
  DRAW_TOOL_GRID_SNAP_BREAKAWAY_PX_MAX,
  DRAW_TOOL_GRID_SNAP_BREAKAWAY_PX_MIN,
  DRAW_TOOL_STROKE_PX,
  DRAW_TOOL_STROKE_PX_MAX,
  DRAW_TOOL_STROKE_PX_MIN,
  ZOOM_100,
  screenPxToCanvasUnits,
} from '@/constants/canvasConstants'
import {
  snapNearbyLineToGrid,
  snapPointToNearbyLine,
  snapPointToNearbyLineOnAxis,
  type LineSnapSegment,
} from '@/lib/plan/lineSnap'
import { FloatingControl } from './FloatingControls'
import {
  DrawModeIcon,
  UploadFloorIcon,
  MoveFloorIcon,
  ScaleIcon,
  GridIcon,
  FloorIcon,
  VisibilityIcon,
  WiringIcon,
} from '@/components/icons/UiIcons'
import { QuickPlacerPanel } from '@/components/plan/QuickPlacerPanel'
import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'
import { applyEendraadCircuitFocus } from '@/lib/eendraad/focusCircuit'
import type { EditorCapabilities } from '@/lib/viewerMode'
import {
  buildManualOtherPlanWireRoute,
  buildManualPlanWireRoutesForPlacementMove,
  deriveAutoPlanWireRoutes,
  endpointCanStartPlanWire,
  filterPlanWireRoutesForPanel,
  filterPlanWireRoutesForSymbolVisibility,
  mergePlanWireRoutes,
  planWireKindsForVisibility,
  planWireActiveStroke,
  resolvePlanWiringVisibility,
} from '@/lib/plan/planWiring'
import { reusePlanWireRoutes } from '@/lib/plan/planWireRouteIdentity'
import { selectProjectPlanWiringProjection } from '@/lib/projectV2/planWiring'
import { querySitplanNotes } from '@/lib/projectV2/annotations'
import { selectProjectBuildingFloors, selectProjectFloorPlan } from '@/lib/projectV2/buildingFloors'
import {
  selectProjectAuxiliaryElectricalEnclosures,
  selectProjectElectricalInstallation,
  selectProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import {
  buildPlanWireVArrowHead,
  planWireIncomingAtEnd,
  planWireSplineIncomingAtEnd,
} from '@/lib/plan/planWireArrow'

import { PlanGridSizeControl } from './plan/PlanGridSizeControl'
import { PlanScaleRulerCanvasLayer } from './plan/PlanScaleRulerCanvasLayer'
import { createPlanScaleReference, parsePlanMeters } from '@/lib/plan/planScale'
import { isSupportedPlanImportFile } from '@/components/plan/planImportFiles'
import {
  captureCrossFloorDragClientOffsets,
  resolveCrossFloorDragPositions,
  type ClientPoint,
} from '@/lib/plan/crossFloorDragContinuation'
import {
  getPlanImageSceneBounds,
  normalizePlanImageRotationDeg,
  planImageLocalToScenePoint,
} from '@/lib/plan/planImageRotation'

const PLAN_IMAGE_ROTATION_SNAPS = [0, 45, 90, 135, 180, 225, 270, 315]

interface PlanCanvasProps {
  onMultiFingerSwipe?: (
    direction: 'left' | 'right' | 'up' | 'down',
    fingerCount: number,
    startClientX: number
  ) => void
  capabilities?: EditorCapabilities
}

type PlanCanvasInputEvent = KonvaEventObject<MouseEvent | TouchEvent | PointerEvent | DragEvent>

type CrossFloorDragSession = {
  floorId: string
  clientOffsets: Map<string, ClientPoint>
  lastPositions: Map<string, Point>
}

const QUICK_PLACER_FLOOR_KEYS = '123456789'

function isKeyboardTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLSelectElement) return true
  if (target.isContentEditable) return true
  return false
}

const EMPTY_WALL_SELECTION_IDS: string[] = []
const EMPTY_PLAN_OVERLAY_FLOOR_IDS: string[] = []
const EMPTY_POINT_SELECTION = new Map<string, number[]>()

type ContentBounds = { minX: number; minY: number; maxX: number; maxY: number }

function includePointInBounds(bounds: ContentBounds | null, x: number, y: number): ContentBounds {
  if (!bounds) return { minX: x, minY: y, maxX: x, maxY: y }
  return {
    minX: Math.min(bounds.minX, x),
    minY: Math.min(bounds.minY, y),
    maxX: Math.max(bounds.maxX, x),
    maxY: Math.max(bounds.maxY, y),
  }
}

function includeRectInBounds(
  bounds: ContentBounds | null,
  rect: { left: number; top: number; right: number; bottom: number }
): ContentBounds {
  let next = includePointInBounds(bounds, rect.left, rect.top)
  next = includePointInBounds(next, rect.right, rect.bottom)
  return next
}

function findQuickPlacerStartIndexForSelection(
  sequence: QuickPlacerItem[],
  selection: Selection
): number {
  if (sequence.length === 0) return -1
  if (selection.type !== 'placement' && selection.type !== 'endpoint') return -1

  const selectedIds = new Set(selection.ids)
  return sequence.findIndex((item) =>
    selection.type === 'placement'
      ? selectedIds.has(item.placement.id)
      : selectedIds.has(item.endpoint.id)
  )
}

function PlanCanvas({ onMultiFingerSwipe, capabilities }: PlanCanvasProps = {}) {
  const { t, i18n } = useTranslation()
  const planView = useUIStore((s) => s.planView)
  const effectivePlanZoom = useEffectiveCanvasZoom(planView.zoom, 'plan')
  const applyPlanView = useUIStore((s) => s.setPlanView)
  const planCanvasViewportPx = useUIStore((s) => s.planCanvasViewportPx)
  const applyPlanCanvasViewportPx = useUIStore((s) => s.setPlanCanvasViewportPx)
  const planIsInLayout = useUIStore((s) =>
    s.viewportLayout.panels.some((panel) => panel.canvas === 'plan')
  )
  const activeFloorId = useUIStore((s) => s.activeFloorId)
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
  const applyActiveFloor = useUIStore((s) => s.setActiveFloor)
  const requestFitToView = useUIStore((s) => s.requestFitToView)
  // Re-render PlanCanvas only for floor-plan geometry selection — symbol chrome is in child components.
  useStoreWithEqualityFn(
    useUIStore,
    (s) => planCanvasGeometrySelectionRenderKey(s.selection),
    (a, b) => a === b
  )
  const selection = useUIStore((s) => s.selection)
  const applySelection = useSetSelectionStore()
  const clearSelection = useClearSelectionStore()
  const applyHover = useUIStore((s) => s.setHover)
  const clearHover = useUIStore((s) => s.clearHover)
  const isExporting = useUIStore((s) => s.isExporting)
  const planVisibility = useUIStore((s) => s.planVisibility)
  const sitplanPanelFilterId = useUIStore((s) => s.sitplanPanelFilterId)
  const setSitplanPanelFilterId = useUIStore((s) => s.setSitplanPanelFilterId)
  const quickPlacerOpen = useUIStore((s) => s.quickPlacerWindowOpen)
  const quickPlacerDragSeed = useUIStore((s) =>
    s.floatingPanelDragSeed?.panel === 'quickPlacer' ? s.floatingPanelDragSeed : null
  )
  const applyLeftDockPreviewPanel = useUIStore((s) => s.setLeftDockPreviewPanel)
  const applyQuickPlacerOpen = useUIStore((s) => s.setQuickPlacerWindowOpen)
  const leftDockPanel = useUIStore((s) => s.leftDockPanel)
  const leftDockCollapsed = useUIStore((s) => s.leftDockCollapsed)
  const applyLeftDockPanel = useUIStore((s) => s.setLeftDockPanel)
  const eendraadIsInLayout = useUIStore((s) =>
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
  const planWiring = useMemo(
    () => (currentProject ? selectProjectPlanWiringProjection(currentProject) : undefined),
    [currentProject]
  )
  const planWiringVisibility = useMemo(() => resolvePlanWiringVisibility(planWiring), [planWiring])
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
  const getPlacementById = useProjectStore((s: ProjectState) => s.getPlacementById)
  const getPanelPathFromRoot = useProjectStore((s: ProjectState) => s.getPanelPathFromRoot)
  const updateFloor = useProjectStore((s: ProjectState) => s.updateFloor)
  const removeFloorPlan = useProjectStore((s: ProjectState) => s.removeFloorPlan)
  const dialog = useDialog()
  const applyPlanRescale = useProjectStore((s: ProjectState) => s.applyPlanRescale)
  const updatePlacement = useProjectStore((s: ProjectState) => s.updatePlacement)
  const addPlacement = useProjectStore((s: ProjectState) => s.addPlacement)
  const updateSitplanNote = useProjectStore((s: ProjectState) => s.updateSitplanNote)
  const updateWall = useProjectStore((s: ProjectState) => s.updateWall)
  const deleteWall = useProjectStore((s: ProjectState) => s.deleteWall)
  const addWall = useProjectStore((s: ProjectState) => s.addWall)
  const withSingleUndoEntry = useProjectStore((s: ProjectState) => s.withSingleUndoEntry)
  const updateDoor = useProjectStore((s: ProjectState) => s.updateDoor)
  const updateWindow = useProjectStore((s: ProjectState) => s.updateWindow)
  const updateStair = useProjectStore((s: ProjectState) => s.updateStair)
  const addPlanGraphicElement = useProjectStore((s: ProjectState) => s.addPlanGraphicElement)
  const updatePlanGraphicElement = useProjectStore((s: ProjectState) => s.updatePlanGraphicElement)
  const openDialog = useDialogStore((s) => s.openDialog)
  const cancelResetScaleTrigger = useUIStore((s) => s.cancelPlanResetScaleTrigger)
  const canvasRef = useRef<BaseCanvasHandle>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pointerOverPlanRef = useRef(false)
  const lastPlanPointerClientRef = useRef<ClientPoint | null>(null)
  const crossFloorDragSessionRef = useRef<CrossFloorDragSession | null>(null)
  const floorPlanClipboardRef = useRef<FloorPlanClipboardPayload | null>(null)
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null)

  useEffect(() => {
    floorPlanClipboardRef.current = null
  }, [projectId])

  // Register canvas for export
  // Always return stage if available - export will handle switching floors as needed
  const registerSitplan = useCanvasRegistryStore((s) => s.registerSitplan)
  const unregisterSitplan = useCanvasRegistryStore((s) => s.unregisterSitplan)
  useEffect(
    function () {
      registerSitplan(
        (_floorId: string) => {
          // Always return stage if available - export handles switching to the right floor
          // The stage will contain the currently active floor, which export will switch to match floorId
          return canvasRef.current?.getStage() ?? null
        },
        (_floorId: string) => {
          // Fit to view - export will ensure the right floor is active before calling this
          canvasRef.current?.fitToView()
        }
      )
      return () => unregisterSitplan()
    },
    [registerSitplan, unregisterSitplan]
  )

  const preparePlanFitToView = useCallback(function () {
    const project = useProjectStore.getState().currentProject
    if (!project) return
    const { selection, activeFloorId, setActiveFloor: applyActiveFloor } = useUIStore.getState()
    const nextFloor = pickPlanFloorForSelectionFit(
      project,
      selection,
      activeFloorId,
      useProjectStore.getState().getTrunkDeviceById
    )
    if (nextFloor) applyActiveFloor(nextFloor)
  }, [])

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
  } = usePlanCanvasToolState()
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
    planWirePreviewPoint,
    setPlanWirePreviewPoint: applyPlanWirePreviewPoint,
  } = usePlanWireInteractionState()
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
  } = usePlanQuickPlacerState()
  const [projectedSnapGuides, applyProjectedSnapGuides] = useState<
    Array<{ from: Point2; to: Point2; hideDistanceLabel?: boolean }>
  >([])
  const [vertexMoveProjectedSnapGuides, applyVertexMoveProjectedSnapGuides] = useState<
    Array<{ from: Point2; to: Point2; hideDistanceLabel?: boolean }>
  >([])
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
  } | null>(null)
  const planDropCircuitPickerOpenRef = useRef(false)
  planDropCircuitPickerOpenRef.current = planDropCircuitPicker != null
  const libraryArmed = useUIStore((state) => state.armedLibrarySymbol != null)
  const awaitingPlanPlacementCount = useAwaitingPlanPlacementCount()
  // Closing the circuit picker (×) during an armed session keeps it closed until disarm.
  const planDropPickerDismissedWhileArmedRef = useRef(false)
  useEffect(() => {
    if (!libraryArmed) planDropPickerDismissedWhileArmedRef.current = false
  }, [libraryArmed])
  // Armed library placement and Quick Placer fast mode both own canvas clicks: the newest wins.
  const quickPlacerModeRef = useRef(quickPlacerMode)
  quickPlacerModeRef.current = quickPlacerMode
  useEffect(() => {
    if (libraryArmed && quickPlacerModeRef.current === 'fast') applyQuickPlacerMode('slow')
  }, [libraryArmed, applyQuickPlacerMode])
  useEffect(() => {
    if (quickPlacerMode === 'fast') useUIStore.getState().setArmedLibrarySymbol(null)
  }, [quickPlacerMode])
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
  }, [])
  // Wall hover for always-visible WallRenderer; reported by FloorPlanMode when in edit mode
  const [hoveredWallId, applyHoveredWallId] = useState<string | null>(null)
  const [hoveredDoorId, applyHoveredDoorId] = useState<string | null>(null)
  const [hoveredWindowId, applyHoveredWindowId] = useState<string | null>(null)
  const [hoveredStairId, applyHoveredStairId] = useState<string | null>(null)
  const [selectedStairPointIndices, applySelectedStairPointIndices] = useState<
    Map<string, number[]>
  >(new Map())
  // Selected wall point(s) for floor plan editing (wallId -> point indices)
  const [selectedPointIndices, applySelectedPointIndices] = useState<Map<string, number[]>>(
    new Map()
  )
  const quickPlacerDraggedPlacementIdRef = useRef<string | null>(null)
  const quickPlacerHintTimeoutRef = useRef<number | null>(null)
  const quickPlacerPanelRef = useRef<HTMLDivElement | null>(null)
  const quickPlacerFastOverlayRef = useRef<HTMLDivElement | null>(null)
  const quickPlacerPreviousSelectionRef = useRef<Selection | null>(null)
  const quickPlacerWasFastRef = useRef(false)
  const suppressQuickPlacerPanelFocusRef = useRef(false)
  const [selectedSegmentIndices, applySelectedSegmentIndices] = useState<Map<string, number[]>>(
    new Map()
  )
  const [mixedSelectedDoorIds, applyMixedSelectedDoorIds] = useState<string[]>([])
  const [mixedSelectedWindowIds, applyMixedSelectedWindowIds] = useState<string[]>([])
  // Red preview for clip tool: segment that would be removed
  const [clipPreviewPoints, applyClipPreviewPoints] = useState<Point2[] | null>(null)
  // Ghost door/window preview when hovering with insert door/window tool (only when placement valid)
  const [openingPreview, applyOpeningPreview] = useState<{
    wallId: string
    position: number
    width: number
    kind: 'door' | 'window'
    valid: boolean
    doorSwing?: 'left' | 'right'
    doorDirection?: 'in' | 'out'
  } | null>(null)
  // Insert-point tool: preview the point that would be inserted (hidden when over door/window)
  const [insertPointPreview, applyInsertPointPreview] = useState<Point2 | null>(null)
  // Local preview walls while dragging (vertices or wall selections). Committed on drag end.
  const [previewWalls, applyPreviewWalls] = useState<Map<string, Wall> | null>(null)
  const [previewDoors, applyPreviewDoors] = useState<Map<string, Door> | null>(null)
  const [previewWindows, applyPreviewWindows] = useState<Map<string, Window> | null>(null)
  const wallDimensionDragRef = useRef<{
    wall: Wall
    doors: Door[]
    windows: Window[]
    segmentIndex: number
    minimumSegmentLength: number
    parallelDragDirection: -1 | 1 | null
  } | null>(null)
  // Selection-drag preview (whole walls moved together) stored outside the store.
  const wallSelectionPreviewRef = useRef<Map<string, Point2[]>>(new Map())
  const stairSelectionPreviewRef = useRef<Map<string, Point2[]>>(new Map())
  const [wallSelectionPreviewTick, applyWallSelectionPreviewTick] = useState(0)
  const pointDragTargetsRef = useRef<Array<{ wallId: string; pointIndex: number }>>([])
  const vertexDragInitialOpeningsRef = useRef<{
    wallId: string
    pointIndex: number
    bySegment: Map<number, OpeningOnSegment[]>
  } | null>(null)
  const doorHoverOpenSideRef = useRef<'left' | 'right'>('right')
  const doorHoverWallIdRef = useRef<string | null>(null)
  const vertexDragAnchorRef = useRef<{ wallId: string; pointIndex: number } | null>(null)
  const vertexDragInitialPointsRef = useRef<Map<string, Point2[]> | null>(null)
  const wallSelectionDragRef = useRef<{
    start: Point2 | null
    initialPointsByWall: Map<string, Point2[]> | null
    indicesByWall: Map<string, Set<number>> | null
    initialPointsByStair: Map<string, Point2[]> | null
    indicesByStair: Map<string, Set<number>> | null
    mode: 'free' | 'horizontal' | 'vertical'
    singlePointTarget: { wallId: string; pointIndex: number } | null
    singlePointCurrentPos: Point2 | null
    /** True only when every affected wall has all its points selected (rigid move). */
    isWholeShapeMove: boolean
  }>({
    start: null,
    initialPointsByWall: null,
    indicesByWall: null,
    initialPointsByStair: null,
    indicesByStair: null,
    mode: 'free',
    singlePointTarget: null,
    singlePointCurrentPos: null,
    isWholeShapeMove: false,
  })
  const stairSelectionDragRef = useRef<{
    stairId: string | null
    pointIndex: number | null
    start: Point2 | null
    initialPoints: Point2[] | null
    mode: 'free' | 'horizontal' | 'vertical'
  }>({
    stairId: null,
    pointIndex: null,
    start: null,
    initialPoints: null,
    mode: 'free',
  })
  const stairPointDragRef = useRef<{
    stairId: string
    pointIndex: number
    initialPoints: Point2[]
    selectedIndices: number[]
  } | null>(null)

  const doorDragRef = useRef<{
    kind: 'door' | 'window'
    entityId: string
    wallId: string
    geom: WallOpeningGeometry
    width: number
    /** Which end of the opening is being dragged so the handle stays under the cursor */
    handleEnd: 'start' | 'end'
    /** Distance from opening center to the visual handle (halfWidth + handleOffset) so we use actual handle position */
    handleOffsetFromCenter: number
  } | null>(null)
  const openingDimensionDragRef = useRef<{
    kind: 'door' | 'window'
    entityId: string
    wall: Wall
    geom: WallOpeningGeometry
    start: Point2
    outwardNormal: Point2
    mode: DimensionDragMode | null
    baseWidth: number
    basePosition: number
    lastResult: { width: number; position: number } | null
  } | null>(null)

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
      const viewportLayout = useUIStore.getState().viewportLayout
      const canvasesToFit =
        viewportLayout.panels.length === 1
          ? ['plan' as const]
          : Array.from(new Set(viewportLayout.panels.map((panel) => panel.canvas)))
      requestFitToView(canvasesToFit)
    },
    [requestFitToView]
  )

  const fitTrigger = useUIStore((s) => s.fitToViewTrigger.plan)
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
    applyPlanRescale,
    cancelResetScaleTrigger,
    getFloorById,
    getPlacementsByFloor,
    openDialog,
    setActiveTool: applyActiveTool,
    t,
    updateFloor,
  })
  const baseWalls: Wall[] = useMemo(
    () => activeFloor?.floorPlan?.walls ?? [],
    [activeFloor?.floorPlan?.walls]
  )
  const baseDoors: Door[] = useMemo(
    () => activeFloor?.floorPlan?.doors ?? [],
    [activeFloor?.floorPlan?.doors]
  )
  const baseWindows: Window[] = useMemo(
    () => activeFloor?.floorPlan?.windows ?? [],
    [activeFloor?.floorPlan?.windows]
  )
  const graphicElementsForRender = useMemo<PlanGraphicElement[]>(
    () => activeFloor?.floorPlan?.graphicElements ?? [],
    [activeFloor?.floorPlan?.graphicElements]
  )

  // Use hooks for scale, placements, labels, image, and grid
  const { pxPerMeter, baseSymbolSizePx, planLabelFontSize } = usePlanScale(activeFloor ?? null)

  const wallsForRender = useMemo(
    function () {
      void wallSelectionPreviewTick
      let walls: Wall[] = baseWalls
      if (previewWalls && previewWalls.size > 0) {
        walls = walls.map((w) => previewWalls.get(w.id) ?? w)
      }
      const previewMap = wallSelectionPreviewRef.current
      if (previewMap.size > 0) {
        walls = walls.map((w) => {
          const pts = previewMap.get(w.id)
          return pts ? { ...w, points: pts } : w
        })
      }
      return walls
    },
    [baseWalls, previewWalls, wallSelectionPreviewTick]
  )

  const doorsForRender = useMemo(
    function () {
      if (!previewDoors || previewDoors.size === 0) return baseDoors
      return baseDoors.map((d) => previewDoors.get(d.id) ?? d)
    },
    [baseDoors, previewDoors]
  )

  const windowsForRender = useMemo(
    function () {
      if (!previewWindows || previewWindows.size === 0) return baseWindows
      return baseWindows.map((w) => previewWindows.get(w.id) ?? w)
    },
    [baseWindows, previewWindows]
  )
  const stairsForRender: Stair[] = useMemo(
    function () {
      void wallSelectionPreviewTick
      const base: Stair[] = activeFloor?.floorPlan?.stairs ?? []
      const previewMap = stairSelectionPreviewRef.current
      if (previewMap.size === 0) return base
      return base.map((stair) => {
        const pts = previewMap.get(stair.id)
        return pts ? { ...stair, points: pts } : stair
      })
    },
    [activeFloor?.floorPlan?.stairs, wallSelectionPreviewTick]
  )
  const [spiralRotationPreview, setSpiralRotationPreview] = useState<{
    stairId: string
    rotationDeg: number
  } | null>(null)

  const gridSize = usePlanGrid(activeFloor ?? null, planView, isFloorPlanMode, tempPxPerMeter)
  const resolveNearbyFloorLineSnap = useCallback(
    (point: Point2, excludedKeys: Set<string> = new Set(), axis?: 'x' | 'y') => {
      if (!activeFloor?.floorPlan) return null
      const radius = screenPxToCanvasUnits(
        planView.zoom,
        DRAW_TOOL_LINE_SNAP_ZONE_PX,
        DRAW_TOOL_LINE_SNAP_ZONE_PX_MIN,
        DRAW_TOOL_LINE_SNAP_ZONE_PX_MAX
      )
      const segments: LineSnapSegment[] = []
      const appendSegments = (kind: 'w' | 's', id: string, points: Point2[]) => {
        for (let index = 0; index < points.length - 1; index += 1) {
          if (
            excludedKeys.has(`${kind}:${id}:${index}`) ||
            excludedKeys.has(`${kind}:${id}:${index + 1}`)
          ) {
            continue
          }
          const a = points[index]
          const b = points[index + 1]
          if (a && b) segments.push({ a, b })
        }
      }

      for (const wall of activeFloor.floorPlan.walls) {
        const excludesWallPoint = wall.points.some((_point, index) =>
          excludedKeys.has(`w:${wall.id}:${index}`)
        )
        if (isCurvedWall(wall) && excludesWallPoint) continue
        appendSegments('w', wall.id, getWallPathPoints(wall))
      }
      for (const stair of activeFloor.floorPlan.stairs ?? []) {
        appendSegments('s', stair.id, stair.points)
      }

      const nearbyLine = axis
        ? snapPointToNearbyLineOnAxis(point, segments, radius, axis)
        : snapPointToNearbyLine(point, segments, radius)
      if (!nearbyLine) return null
      // A constrained move has no spare axis for grid snap: the line owns the
      // moving coordinate and the movement rail owns the locked coordinate.
      return axis ? nearbyLine : snapNearbyLineToGrid(nearbyLine, gridSize, planView.snapToGrid)
    },
    [activeFloor?.floorPlan, gridSize, planView.snapToGrid, planView.zoom]
  )
  const snapPlacementPosition = useCallback(
    (point: Point2) =>
      resolveNearbyFloorLineSnap(point)?.point ??
      snapPlacementCenterToGrid(point, gridSize, planView.snapToGrid),
    [gridSize, planView.snapToGrid, resolveNearbyFloorLineSnap]
  )
  const latestSnapPlacementPositionRef = useRef(snapPlacementPosition)
  latestSnapPlacementPositionRef.current = snapPlacementPosition
  const stableSnapPlacementPosition = useCallback(
    (point: Point2) => latestSnapPlacementPositionRef.current(point),
    []
  )
  const canvasPxPerMeter = resolvePlanCanvasPxPerMeter(
    activeFloor ?? null,
    planView.gridSize,
    gridSize,
    tempPxPerMeter
  )
  const theme = useSettingsStore((state) => state.theme)
  const fontFamily = useCanvasFontFamily()
  const touchPrimary = useTouchPrimaryDevice()
  const selectedWallIds = useMemo(
    function () {
      if (selection.type === 'wall') return selection.ids
      if (selection.type === 'wallPoint' && selection.ids.length > 0) {
        const parsed = parseWallPointIds(selection.ids)
        return Array.from(parsed.keys())
      }
      return EMPTY_WALL_SELECTION_IDS
    },
    [selection.type, selection.ids]
  )
  const selectedDoorIds = useMemo(
    () =>
      Array.from(
        new Set([...(selection.type === 'door' ? selection.ids : []), ...mixedSelectedDoorIds])
      ),
    [selection.type, selection.ids, mixedSelectedDoorIds]
  )
  const selectedWindowIds = useMemo(
    () =>
      Array.from(
        new Set([...(selection.type === 'window' ? selection.ids : []), ...mixedSelectedWindowIds])
      ),
    [selection.type, selection.ids, mixedSelectedWindowIds]
  )
  const clearMixedOpeningSelection = useCallback(() => {
    applyMixedSelectedDoorIds([])
    applyMixedSelectedWindowIds([])
  }, [])
  const retainDirectOpeningSelectionForMixed = useCallback(() => {
    if (selection.type === 'door') {
      applyMixedSelectedDoorIds((current) => Array.from(new Set([...current, ...selection.ids])))
    }
    if (selection.type === 'window') {
      applyMixedSelectedWindowIds((current) => Array.from(new Set([...current, ...selection.ids])))
    }
  }, [selection.type, selection.ids])
  const toggleMixedOpeningSelection = useCallback(
    (kind: 'door' | 'window', openingId: string) => {
      const doors = new Set(selectedDoorIds)
      const windows = new Set(selectedWindowIds)
      const target = kind === 'door' ? doors : windows
      if (target.has(openingId)) target.delete(openingId)
      else target.add(openingId)

      const hasGeometrySelection =
        selection.type === 'wall' ||
        selection.type === 'wallPoint' ||
        selection.type === 'stair' ||
        selection.type === 'stairPoint'

      if (hasGeometrySelection) {
        applyMixedSelectedDoorIds(Array.from(doors))
        applyMixedSelectedWindowIds(Array.from(windows))
        return
      }

      if (kind === 'door' && doors.size > 0) {
        applySelection({ type: 'door', ids: Array.from(doors) })
        applyMixedSelectedDoorIds([])
        applyMixedSelectedWindowIds(Array.from(windows))
        return
      }
      if (kind === 'window' && windows.size > 0) {
        applySelection({ type: 'window', ids: Array.from(windows) })
        applyMixedSelectedDoorIds(Array.from(doors))
        applyMixedSelectedWindowIds([])
        return
      }
      if (doors.size > 0) {
        applySelection({ type: 'door', ids: Array.from(doors) })
        applyMixedSelectedDoorIds([])
        applyMixedSelectedWindowIds(Array.from(windows))
        return
      }
      if (windows.size > 0) {
        applySelection({ type: 'window', ids: Array.from(windows) })
        applyMixedSelectedDoorIds(Array.from(doors))
        applyMixedSelectedWindowIds([])
        return
      }

      clearMixedOpeningSelection()
      applySelection({ type: null, ids: [] })
    },
    [selectedDoorIds, selectedWindowIds, selection.type, applySelection, clearMixedOpeningSelection]
  )
  useEffect(() => {
    const keepsFloorPlanSelection =
      selection.type === 'wall' ||
      selection.type === 'wallPoint' ||
      selection.type === 'stair' ||
      selection.type === 'stairPoint' ||
      selection.type === 'door' ||
      selection.type === 'window'
    if (!isFloorPlanMode || !keepsFloorPlanSelection) {
      clearMixedOpeningSelection()
    }
  }, [isFloorPlanMode, selection.type, activeFloorId, clearMixedOpeningSelection])
  const selectedGraphicElementIds = useMemo(
    () => (selection.type === 'graphicElement' ? selection.ids : []),
    [selection.ids, selection.type]
  )
  useEffect(
    function () {
      if (selection.type !== 'graphicElement') {
        applyVertexMoveProjectedSnapGuides([])
      }
    },
    [selection.type]
  )
  useEffect(
    function () {
      if (vertexMoveProjectedSnapGuides.length === 0) return
      const timer = window.setTimeout(() => {
        applyVertexMoveProjectedSnapGuides([])
      }, PROJECTED_SNAP_GUIDE_AUTO_CLEAR_MS)
      return () => window.clearTimeout(timer)
    },
    [vertexMoveProjectedSnapGuides]
  )
  const selectedStairIds = useMemo(
    function () {
      if (selection.type === 'stair') return selection.ids
      if (selection.type === 'stairPoint')
        return selection.ids.length > 0 ? [selection.ids[0]!] : []
      if (selection.type === 'wallPoint' && selection.ids.length > 0) {
        const parsed = parseStairPointIds(selection.ids)
        return Array.from(parsed.keys())
      }
      return []
    },
    [selection.type, selection.ids]
  )
  const selectedStairId = useMemo(
    function () {
      if (selection.type === 'stair' || selection.type === 'stairPoint') {
        return selection.ids[0] ?? null
      }
      if (selection.type === 'wallPoint' && selection.ids.length > 0) {
        const parsed = parseStairPointIds(selection.ids)
        return parsed.size === 1 && selectedWallIds.length === 0
          ? (Array.from(parsed.keys())[0] ?? null)
          : null
      }
      return null
    },
    [selection.type, selection.ids, selectedWallIds]
  )
  const selectedStairPointIndex = useMemo(
    function () {
      if (selection.type === 'stairPoint') {
        const parsed = Number(selection.ids[1])
        return Number.isFinite(parsed) ? parsed : null
      }
      if (selection.type === 'wallPoint' && selectedWallIds.length === 0 && selectedStairId) {
        const indices = selectedStairPointIndices.get(selectedStairId) ?? []
        return indices.length === 1 ? indices[0]! : null
      }
      return null
    },
    [selection.type, selection.ids, selectedWallIds, selectedStairId, selectedStairPointIndices]
  )
  useEffect(
    function () {
      if (selection.type !== 'stairPoint' && selection.type !== 'wallPoint') {
        applySelectedStairPointIndices(new Map())
      }
    },
    [selection.type]
  )
  useEffect(
    function () {
      if (selection.type === 'stair' || selection.type === 'stairPoint') return
      stairSelectionDragRef.current = {
        stairId: null,
        pointIndex: null,
        start: null,
        initialPoints: null,
        mode: 'free',
      }
    },
    [selection.type]
  )
  const selectedStair = useMemo(
    () =>
      selectedStairId
        ? (stairsForRender.find((stair: Stair) => stair.id === selectedStairId) ?? null)
        : null,
    [selectedStairId, stairsForRender]
  )
  const selectedStairsForCopy = useMemo(
    () => stairsForRender.filter((stair) => selectedStairIds.includes(stair.id)),
    [stairsForRender, selectedStairIds]
  )
  const selectedWallsForCopy = useMemo(
    () =>
      selectWallsForFloorPlanClipboard({
        walls: wallsForRender,
        selectedWallIds,
        selectedSegmentIndices,
      }),
    [wallsForRender, selectedWallIds, selectedSegmentIndices]
  )
  const selectedGraphicElementsForCopy = useMemo(
    () =>
      graphicElementsForRender.filter((element) => selectedGraphicElementIds.includes(element.id)),
    [graphicElementsForRender, selectedGraphicElementIds]
  )
  const selectedOpeningsForCopy = useMemo(
    function () {
      const selectedWallIdSet = new Set(selectedWallsForCopy.map((wall) => wall.id))
      return {
        doors: doorsForRender.filter((door) => selectedWallIdSet.has(door.wallId)),
        windows: windowsForRender.filter((window) => selectedWallIdSet.has(window.wallId)),
      }
    },
    [selectedWallsForCopy, doorsForRender, windowsForRender]
  )
  const createClipboardPayloadFromSelection = useCallback(() => {
    if (!activeFloorId || !activeFloor) return null
    const selectedPlacementIds = new Set(selection.type === 'placement' ? selection.ids : [])
    const selectedPlacementsForCopy = getPlacementsByFloor(activeFloorId).flatMap(
      (row: Placement & { endpointId?: string }) => {
        if (!selectedPlacementIds.has(row.id) || !row.endpointId) return []
        return [
          {
            endpointId: row.endpointId,
            placement: {
              id: row.id,
              floorId: row.floorId,
              layer: row.layer,
              pos: row.pos,
              rotationDeg: row.rotationDeg,
              rotationMode: row.rotationMode,
              scale: row.scale,
              locked: row.locked,
              style: row.style,
            },
          },
        ]
      }
    )
    return createFloorPlanClipboardPayload({
      sourceFloorId: activeFloorId,
      sourcePxPerMeter: calculatePxPerMeter(activeFloor) ?? 100,
      sourceMasterWallThickness: activeFloor.floorPlan?.masterWallThickness ?? 20,
      walls: selectedWallsForCopy,
      doors: selectedOpeningsForCopy.doors,
      windows: selectedOpeningsForCopy.windows,
      stairs: selectedStairsForCopy,
      graphicElements: selectedGraphicElementsForCopy,
      placements: selectedPlacementsForCopy,
    })
  }, [
    activeFloor,
    activeFloorId,
    selectedGraphicElementsForCopy,
    selectedOpeningsForCopy.doors,
    selectedOpeningsForCopy.windows,
    selectedStairsForCopy,
    selectedWallsForCopy,
    getPlacementsByFloor,
    selection.ids,
    selection.type,
  ])

  const getPlanViewportCenter = useCallback((): Point2 | undefined => {
    const width = planCanvasViewportPx?.width ?? containerRef.current?.clientWidth ?? 0
    const height = planCanvasViewportPx?.height ?? containerRef.current?.clientHeight ?? 0
    if (width <= 0 || height <= 0 || planView.zoom <= 0) return undefined
    return {
      x: (width / 2 - planView.pan.x) / planView.zoom,
      y: (height / 2 - planView.pan.y) / planView.zoom,
    }
  }, [planCanvasViewportPx?.height, planCanvasViewportPx?.width, planView.pan, planView.zoom])

  const pasteClipboardPayloadToFloor = useCallback(
    (
      payload: FloorPlanClipboardPayload,
      targetFloorId: string,
      copyOpenings = true,
      targetCenter?: Point2
    ) => {
      const targetFloor = getFloorById(targetFloorId)
      if (!targetFloor) return null
      const result = pasteFloorPlanClipboardPayload({
        payload,
        targetFloorId,
        targetPxPerMeter: calculatePxPerMeter(targetFloor) ?? 100,
        targetFloorPlan: targetFloor.floorPlan,
        generateId,
        copyOpenings,
        targetCenter,
      })
      updateFloor(targetFloorId, { floorPlan: result.floorPlan })
      result.placements.forEach(({ endpointId, placement }) => addPlacement(endpointId, placement))
      return result
    },
    [addPlacement, getFloorById, updateFloor]
  )

  const handleGraphicElementSelect = useCallback(
    (elementId: string, event?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
      if (!isFloorPlanMode || activeTool !== 'select') return
      const isMultiSelect = !!(event && (event.shiftKey || event.ctrlKey || event.metaKey))
      if (!isMultiSelect || selection.type !== 'graphicElement') {
        applySelection({ type: 'graphicElement', ids: [elementId] })
        return
      }
      const existing = new Set(selection.ids)
      if (existing.has(elementId)) existing.delete(elementId)
      else existing.add(elementId)
      const ids = Array.from(existing)
      applySelection(ids.length > 0 ? { type: 'graphicElement', ids } : { type: null, ids: [] })
    },
    [activeTool, isFloorPlanMode, selection.ids, selection.type, applySelection]
  )

  const handleGraphicElementMove = useCallback(
    (elementId: string, pos: Point2) => {
      if (!isFloorPlanMode || activeTool !== 'select') return
      updatePlanGraphicElement(elementId, { pos })
    },
    [activeTool, isFloorPlanMode, updatePlanGraphicElement]
  )

  const handleGraphicElementResize = useCallback(
    (elementId: string, size: { width: number; height: number }) => {
      if (!isFloorPlanMode || activeTool !== 'select') return
      updatePlanGraphicElement(elementId, size)
    },
    [activeTool, isFloorPlanMode, updatePlanGraphicElement]
  )

  const handleCopySelectionToFloors = useCallback(
    (targetFloorIds: string[], options: { copyOpenings: boolean }) => {
      if (targetFloorIds.length === 0) return
      const payload = createClipboardPayloadFromSelection()
      if (!payload) return
      targetFloorIds.forEach((targetFloorId) =>
        pasteClipboardPayloadToFloor(payload, targetFloorId, options.copyOpenings)
      )
    },
    [createClipboardPayloadFromSelection, pasteClipboardPayloadToFloor]
  )

  const handleCopyFloorPlanSelection = useCallback(() => {
    const payload = createClipboardPayloadFromSelection()
    if (!payload) return false
    floorPlanClipboardRef.current = payload
    return true
  }, [createClipboardPayloadFromSelection])

  const handlePasteFloorPlanSelection = useCallback(() => {
    if (!activeFloorId || !floorPlanClipboardRef.current) return false
    const resultRef: {
      current: ReturnType<typeof pasteFloorPlanClipboardPayload> | null
    } = { current: null }
    withSingleUndoEntry(
      () => {
        resultRef.current = pasteClipboardPayloadToFloor(
          floorPlanClipboardRef.current!,
          activeFloorId,
          true,
          floorPlanClipboardRef.current!.sourceFloorId === activeFloorId
            ? getPlanViewportCenter()
            : undefined
        )
        return resultRef.current != null
      },
      { sessionLabel: 'paste-floor-plan-selection' }
    )
    const result = resultRef.current
    if (!result) return false
    if (result.wallIds.length > 0) applySelection({ type: 'wall', ids: result.wallIds })
    else if (result.stairIds.length > 0) applySelection({ type: 'stair', ids: result.stairIds })
    else if (result.graphicElementIds.length > 0) {
      applySelection({ type: 'graphicElement', ids: result.graphicElementIds })
    } else if (result.placementIds.length > 0) {
      applySelection({ type: 'placement', ids: result.placementIds })
    }
    return true
  }, [
    activeFloorId,
    applySelection,
    getPlanViewportCenter,
    pasteClipboardPayloadToFloor,
    withSingleUndoEntry,
  ])
  const buildEncodedFloorPointIds = useCallback(
    (wallPoints: Map<string, number[]>, stairPoints: Map<string, number[]>): string[] => {
      const ids: string[] = []
      for (const [wallId, indices] of wallPoints.entries()) {
        for (const index of indices) ids.push(encodeWallPointId(wallId, index))
      }
      for (const [stairId, indices] of stairPoints.entries()) {
        for (const index of indices) ids.push(encodeStairPointId(stairId, index))
      }
      return ids
    },
    []
  )
  const getCurrentMixedPointSelection = useCallback(
    () =>
      resolvePlanCanvasPointSelection({
        selection,
        selectedWallPointIndices: selectedPointIndices,
        selectedStairPointIndices,
        walls: activeFloor?.floorPlan?.walls ?? [],
        stairs: stairsForRender,
      }),
    [
      activeFloor?.floorPlan?.walls,
      selection,
      selectedPointIndices,
      selectedStairPointIndices,
      stairsForRender,
    ]
  )
  const stairSelectionBounds = useMemo(
    function () {
      if (!selectedStair) return null
      if (selection.type === 'wallPoint') return null
      if (selection.type === 'stairPoint' && selectedStairPointIndex != null) {
        const point = selectedStair.points[selectedStairPointIndex]
        if (!point) return null
        return {
          x: point.x,
          y: point.y,
          width: 0,
          height: 0,
        }
      }
      return getStairBounds(selectedStair)
    },
    [selectedStair, selection.type, selectedStairPointIndex]
  )
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

  function beginStairSelectionDrag(
    start: Point2,
    mode: 'free' | 'horizontal' | 'vertical' = 'free'
  ) {
    if (!selectedStair) return
    stairSelectionPreviewRef.current = new Map()
    stairSelectionDragRef.current = {
      stairId: selectedStair.id,
      pointIndex: selection.type === 'stairPoint' ? selectedStairPointIndex : null,
      start,
      initialPoints: selectedStair.points.map((point) => ({ x: point.x, y: point.y })),
      mode,
    }
  }

  function updateStairSelectionDrag(current: Point2) {
    const { stairId, pointIndex, start, initialPoints, mode } = stairSelectionDragRef.current
    if (!stairId || !start || !initialPoints || initialPoints.length === 0) return

    const now =
      typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
    if (now - lastWallSelectionUpdateTimeRef.current < 16) return
    lastWallSelectionUpdateTimeRef.current = now

    let dx = current.x - start.x
    let dy = current.y - start.y
    if (mode === 'horizontal') {
      dy = 0
    } else if (mode === 'vertical') {
      dx = 0
    }

    const anchor =
      pointIndex != null ? (initialPoints[pointIndex] ?? initialPoints[0]!) : initialPoints[0]!
    const movedAnchor = { x: anchor.x + dx, y: anchor.y + dy }
    const selectedIndices =
      pointIndex != null ? [pointIndex] : initialPoints.map((_, index) => index)
    const excludedKeys = new Set(selectedIndices.map((index) => `s:${stairId}:${index}`))
    const movementAxis = mode === 'horizontal' ? 'x' : mode === 'vertical' ? 'y' : undefined
    const nearbyLine = resolveNearbyFloorLineSnap(movedAnchor, excludedKeys, movementAxis)
    const projected = nearbyLine ? null : resolveProjectedFloorSnap(movedAnchor, excludedKeys)
    const projectedPoint = projected?.snappedPoint ?? movedAnchor
    const axisConstrainedProjectedPoint =
      movementAxis === 'x'
        ? { x: projectedPoint.x, y: movedAnchor.y }
        : movementAxis === 'y'
          ? { x: movedAnchor.x, y: projectedPoint.y }
          : projectedPoint
    const snappedAnchor =
      nearbyLine?.point ??
      softSnapToGrid(axisConstrainedProjectedPoint, planView.snapToGrid, movementAxis)
    const snappedDx = snappedAnchor.x - anchor.x
    const snappedDy = snappedAnchor.y - anchor.y
    applyVertexMoveProjectedSnapGuides(projected?.guides ?? [])

    const nextPoints = initialPoints.map((point, index) => {
      if (pointIndex != null && index !== pointIndex) {
        return point
      }
      return {
        x: point.x + snappedDx,
        y: point.y + snappedDy,
      }
    })
    const nextPreview = new Map(stairSelectionPreviewRef.current)
    nextPreview.set(stairId, nextPoints)
    stairSelectionPreviewRef.current = nextPreview
    applyWallSelectionPreviewTick((t) => t + 1)
  }

  function endStairSelectionDrag() {
    applyVertexMoveProjectedSnapGuides([])
    commitStairPreviewGeometry()
    lastWallSelectionUpdateTimeRef.current = 0
    stairSelectionDragRef.current = {
      stairId: null,
      pointIndex: null,
      start: null,
      initialPoints: null,
      mode: 'free',
    }
  }

  const renderDirectionalMoveHandles = useCallback(
    (
      bounds: { x: number; y: number; width: number; height: number },
      onBegin: (anchor: Point2, mode: 'horizontal' | 'vertical') => void,
      onUpdate: (point: Point2) => void,
      onEnd: (point: Point2 | null) => void
    ) => {
      const { x, y, width, height } = bounds
      const cx = x + width / 2
      const cy = y + height / 2
      const handleRadius = screenPxToCanvasUnits(
        planView.zoom,
        DRAW_TOOL_HANDLE_RADIUS_PX,
        DRAW_TOOL_HANDLE_RADIUS_PX_MIN,
        DRAW_TOOL_HANDLE_RADIUS_PX_MAX
      )
      const offset = screenPxToCanvasUnits(
        planView.zoom,
        DRAW_TOOL_HANDLE_OFFSET_PX,
        DRAW_TOOL_HANDLE_OFFSET_PX_MIN,
        DRAW_TOOL_HANDLE_OFFSET_PX_MAX
      )
      const handleStrokeWidth = screenPxToCanvasUnits(
        planView.zoom,
        DRAW_TOOL_STROKE_PX,
        DRAW_TOOL_STROKE_PX_MIN,
        DRAW_TOOL_STROKE_PX_MAX
      )

      const createHandle = (anchor: Point2, rotation: number, mode: 'horizontal' | 'vertical') => (
        <RegularPolygon
          x={anchor.x}
          y={anchor.y}
          sides={3}
          radius={handleRadius}
          rotation={rotation}
          fill={toolMoveHandleColor}
          stroke={toolMoveHandleStrokeColor}
          strokeWidth={handleStrokeWidth}
          draggable
          onDragStart={(e) => {
            onBegin(anchor, mode)
            e.target.x(anchor.x)
            e.target.y(anchor.y)
          }}
          onDragMove={(e) => {
            const stage = e.target.getStage()
            const pointer = stage?.getPointerPosition()
            const point =
              stage && pointer
                ? {
                    x: (pointer.x - planView.pan.x) / planView.zoom,
                    y: (pointer.y - planView.pan.y) / planView.zoom,
                  }
                : null
            if (!point) return
            onUpdate(point)
            e.target.x(anchor.x)
            e.target.y(anchor.y)
          }}
          onDragEnd={(e) => {
            const stage = e.target.getStage()
            const pointer = stage?.getPointerPosition()
            const point =
              stage && pointer
                ? {
                    x: (pointer.x - planView.pan.x) / planView.zoom,
                    y: (pointer.y - planView.pan.y) / planView.zoom,
                  }
                : null
            onEnd(point)
            e.target.x(anchor.x)
            e.target.y(anchor.y)
          }}
        />
      )

      return (
        <Group listening>
          {createHandle({ x: cx, y: y - offset }, 0, 'vertical')}
          {createHandle({ x: cx, y: y + height + offset }, 180, 'vertical')}
          {createHandle({ x: x - offset, y: cy }, 270, 'horizontal')}
          {createHandle({ x: x + width + offset, y: cy }, 90, 'horizontal')}
        </Group>
      )
    },
    [planView.pan.x, planView.pan.y, planView.zoom]
  )

  const wallSelectionBounds = useMemo(() => {
    if (!isFloorPlanMode || !activeFloor?.floorPlan) return null
    if (selectedPointIndices.size === 0 && selectedStairPointIndices.size === 0) return null
    // Render bounds use preview geometry so the handles remain aligned during a drag.
    return getPlanCanvasPointSelectionBounds({
      wallPointIndices: selectedPointIndices,
      stairPointIndices: selectedStairPointIndices,
      walls: wallsForRender,
      stairs: stairsForRender,
    })
  }, [
    isFloorPlanMode,
    activeFloor,
    selectedPointIndices,
    selectedStairPointIndices,
    wallsForRender,
    stairsForRender,
  ])

  const makeCanvasPointFromEvent = useCallback(
    (e: PlanCanvasInputEvent): Point2 | null => {
      const stage = e.target.getStage()
      const pointer = stage?.getPointerPosition()
      if (!stage || !pointer) return null
      return {
        x: (pointer.x - planView.pan.x) / planView.zoom,
        y: (pointer.y - planView.pan.y) / planView.zoom,
      }
    },
    [planView.pan.x, planView.pan.y, planView.zoom]
  )
  const scopedWallIdForVertexSelection = useMemo(
    function () {
      if (activeTool !== 'select') return null
      if (selection.type === 'wall' && selection.ids.length === 1) {
        return selection.ids[0] ?? null
      }
      if (
        selection.type === 'wallPoint' &&
        selectedWallIds.length === 1 &&
        selectedStairPointIndices.size === 0
      ) {
        return selectedWallIds[0] ?? null
      }
      return null
    },
    [activeTool, selection.type, selection.ids, selectedWallIds, selectedStairPointIndices]
  )

  const resolveScopedPointTarget = useCallback(
    (
      wallId: string,
      pointIndex: number,
      e: PlanCanvasInputEvent
    ): { wallId: string; pointIndex: number } | null => {
      if (!scopedWallIdForVertexSelection) {
        return { wallId, pointIndex }
      }
      if (wallId === scopedWallIdForVertexSelection) {
        return { wallId, pointIndex }
      }
      const scopedWall = wallsForRender.find((w) => w.id === scopedWallIdForVertexSelection)
      if (!scopedWall || scopedWall.points.length === 0) return null
      const canvasPoint = makeCanvasPointFromEvent(e)
      if (!canvasPoint) return null
      const visualPickRadius = screenPxToCanvasUnits(
        planView.zoom,
        DRAW_TOOL_POINT_RADIUS_PX,
        DRAW_TOOL_POINT_RADIUS_PX_MIN,
        DRAW_TOOL_POINT_RADIUS_PX_MAX
      )
      const pointPickRadius = touchPrimary
        ? getTouchPointHitRadiusCanvas(planView.zoom, visualPickRadius)
        : visualPickRadius * 1.5
      const pointPickRadiusSq = pointPickRadius * pointPickRadius
      let nearestIndex = -1
      let nearestDistSq = Number.POSITIVE_INFINITY
      scopedWall.points.forEach((p, idx) => {
        const dx = p.x - canvasPoint.x
        const dy = p.y - canvasPoint.y
        const distSq = dx * dx + dy * dy
        if (distSq <= pointPickRadiusSq && distSq < nearestDistSq) {
          nearestDistSq = distSq
          nearestIndex = idx
        }
      })
      if (nearestIndex < 0) return null
      return { wallId: scopedWall.id, pointIndex: nearestIndex }
    },
    [
      scopedWallIdForVertexSelection,
      wallsForRender,
      makeCanvasPointFromEvent,
      planView.zoom,
      touchPrimary,
    ]
  )

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
    [planView.pan.x, planView.pan.y, planView.zoom]
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
    [applyQuickPlacerCursorHint]
  )

  // Clear wall/door/window hover and point selection when exiting floor plan mode
  useEffect(
    function () {
      if (!isFloorPlanMode) {
        applyHoveredWallId(null)
        applyHoveredDoorId(null)
        applyHoveredWindowId(null)
        applyHoveredStairId(null)
        applySelectedPointIndices(new Map())
        applySelectedSegmentIndices(new Map())
        applyClipPreviewPoints(null)
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
    [isFloorPlanMode]
  )

  // Keep point selection in sync when walls are (multi-)selected externally (e.g. via drag-rect).
  useEffect(
    function () {
      // Helper: shallow structural equality for Map<string, number[]>
      const mapsEqual = (a: Map<string, number[]>, b: Map<string, number[]>) => {
        if (a.size !== b.size) return false
        for (const [key, aVals] of a.entries()) {
          const bVals = b.get(key)
          if (!bVals || aVals.length !== bVals.length) return false
          for (let i = 0; i < aVals.length; i++) {
            if (aVals[i] !== bVals[i]) return false
          }
        }
        return true
      }

      if (!isFloorPlanMode || !activeFloor?.floorPlan) {
        if (selectedPointIndices.size !== 0) {
          applySelectedPointIndices(new Map())
        }
        if (selectedSegmentIndices.size !== 0) {
          applySelectedSegmentIndices(new Map())
        }
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
        return
      }

      if (
        (selection.type !== 'wall' && selection.type !== 'wallPoint') ||
        selection.ids.length === 0
      ) {
        if (selectedPointIndices.size !== 0) {
          applySelectedPointIndices(new Map())
        }
        if (selectedSegmentIndices.size !== 0) {
          applySelectedSegmentIndices(new Map())
        }
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
        return
      }

      // Drag-rect / mixed point selection: sync explicit point selections from encoded ids.
      if (selection.type === 'wallPoint') {
        const parsedWalls = parseWallPointIds(selection.ids)
        const parsedStairs = parseStairPointIds(selection.ids)
        if (!mapsEqual(parsedWalls, selectedPointIndices)) {
          applySelectedPointIndices(parsedWalls)
        }
        if (!mapsEqual(parsedStairs, selectedStairPointIndices)) {
          applySelectedStairPointIndices(parsedStairs)
        }
        if (selectedSegmentIndices.size !== 0) {
          applySelectedSegmentIndices(new Map())
        }
        return
      }

      if (selectedStairPointIndices.size > 0) {
        applySelectedStairPointIndices(new Map())
      }

      // selection.type === 'wall': when there is already an explicit point selection, keep it as-is so
      // single-vertex selections are not overridden by the default behavior.
      if (selectedPointIndices.size > 0) {
        return
      }

      const selectedIds = selection.ids

      // Build desired default selection: all points on each selected wall.
      const desired = new Map<string, number[]>()
      for (const wallId of selectedIds) {
        const wall = activeFloor.floorPlan.walls.find((w: Wall) => w.id === wallId)
        if (!wall) continue
        desired.set(
          wallId,
          wall.points.map((_: Point2, idx: number) => idx)
        )
      }

      // If current selection already matches the desired one, do nothing.
      if (mapsEqual(selectedPointIndices, desired)) {
        return
      }

      applySelectedPointIndices(desired)
    },
    [
      isFloorPlanMode,
      selection,
      activeFloor,
      selectedPointIndices,
      selectedStairPointIndices,
      selectedSegmentIndices,
    ]
  )

  const shouldHandleWallHover =
    canEditFloorPlan &&
    isFloorPlanMode &&
    (activeTool === 'insertDoor' ||
      activeTool === 'insertWindow' ||
      activeTool === 'clipWall' ||
      activeTool === 'insertPoint' ||
      activeTool === 'select')
  const shouldListenToWalls =
    canEditFloorPlan &&
    isFloorPlanMode &&
    (activeTool === 'clipWall' || activeTool === 'insertPoint' || activeTool === 'select')
  const canSelectDoorsInInsertMode =
    activeTool === 'insertDoor' && openingSelectionArmedTool === 'insertDoor'
  const canSelectWindowsInInsertMode =
    activeTool === 'insertWindow' && openingSelectionArmedTool === 'insertWindow'
  const doorsListening = shouldListenToWalls || canSelectDoorsInInsertMode
  const windowsListening = shouldListenToWalls || canSelectWindowsInInsertMode
  const isWallDrawingTool =
    isFloorPlanMode && (activeTool === 'drawWall' || activeTool === 'drawWallRect')
  const floorPlanTouchDragToolActive = isFloorPlanMode && isFloorPlanTouchDragTool(activeTool)
  const drawHitTestingCooldownTimeoutRef = useRef<number | null>(null)
  const wasWallDrawingToolRef = useRef(false)
  const [drawHitTestingCooldownActive, applyDrawHitTestingCooldownActive] = useState(false)
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

  useEffect(
    function () {
      if (activeTool === 'insertDoor' || activeTool === 'insertWindow') {
        if (openingSelectionArmedTool !== activeTool) {
          applyOpeningSelectionArmedTool(null)
        }
        return
      }
      if (openingSelectionArmedTool != null) {
        applyOpeningSelectionArmedTool(null)
      }
      applyOpeningPreview(null)
    },
    [activeTool, applyOpeningSelectionArmedTool, openingSelectionArmedTool]
  )

  useEffect(
    function () {
      const wasDrawing = wasWallDrawingToolRef.current
      if (drawHitTestingCooldownTimeoutRef.current != null) {
        clearTimeout(drawHitTestingCooldownTimeoutRef.current)
        drawHitTestingCooldownTimeoutRef.current = null
      }
      if (isWallDrawingTool) {
        applyDrawHitTestingCooldownActive(true)
      } else if (wasDrawing) {
        // Keep hit-testing suppressed briefly after ESC/finish to avoid
        // an immediate expensive hit-graph rebuild burst on pointermove.
        applyDrawHitTestingCooldownActive(true)
        drawHitTestingCooldownTimeoutRef.current = window.setTimeout(() => {
          applyDrawHitTestingCooldownActive(false)
          drawHitTestingCooldownTimeoutRef.current = null
        }, 180)
      } else {
        applyDrawHitTestingCooldownActive(false)
      }
      wasWallDrawingToolRef.current = isWallDrawingTool
    },
    [isWallDrawingTool]
  )

  useEffect(function () {
    return () => {
      if (drawHitTestingCooldownTimeoutRef.current != null) {
        clearTimeout(drawHitTestingCooldownTimeoutRef.current)
        drawHitTestingCooldownTimeoutRef.current = null
      }
    }
  }, [])
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

  useEffect(
    function () {
      if (!isWallDrawingTool && isViewportPanning) {
        applyIsViewportPanning(false)
      }
    },
    [applyIsViewportPanning, isViewportPanning, isWallDrawingTool]
  )

  const hasPlanImage = !!(activeFloor?.planAsset || activeFloor?.planImportAsset)

  useEffect(
    function () {
      if (!shouldHandleWallHover) {
        applyHoveredWallId(null)
        applyClipPreviewPoints(null)
        applyOpeningPreview(null)
        applyInsertPointPreview(null)
        doorHoverWallIdRef.current = null
      }
    },
    [shouldHandleWallHover]
  )

  useEffect(
    function () {
      if (activeTool !== 'insertDoor') {
        doorHoverOpenSideRef.current = 'right'
        doorHoverWallIdRef.current = null
      }
    },
    [activeTool, applyActiveTool]
  )

  const handleWallHover = useCallback(
    (wallId: string | null, pointer: Point2 | null) => {
      if (!shouldHandleWallHover) return

      if (!wallId || !pointer || !activeFloor?.floorPlan) {
        applyHoveredWallId((prev) => (prev === null ? prev : null))
        applyClipPreviewPoints((prev) => (prev === null ? prev : null))
        applyOpeningPreview(null)
        applyInsertPointPreview(null)
        return
      }

      const wall = activeFloor.floorPlan.walls.find((w: Wall) => w.id === wallId)
      if (!wall) {
        applyHoveredWallId((prev) => (prev === null ? prev : null))
        applyClipPreviewPoints((prev) => (prev === null ? prev : null))
        applyOpeningPreview(null)
        applyInsertPointPreview(null)
        return
      }

      const curvedHoverFeedback = isCurvedWall(wall)
        ? getCurvedWallToolHoverFeedback(activeTool)
        : 'default'
      const nextHoveredWallId = curvedHoverFeedback === 'suppressed' ? null : wallId
      applyHoveredWallId((prev) => (prev === nextHoveredWallId ? prev : nextHoveredWallId))

      // Select tool only needs hover highlight — skip preview work on every pointer move.
      if (activeTool === 'select') return

      if (isCurvedWall(wall)) {
        applyClipPreviewPoints((prev) => (prev === null ? prev : null))
        applyOpeningPreview(null)
        applyInsertPointPreview(null)
        return
      }

      if (activeTool === 'clipWall') {
        const preview =
          handleClipWall(wall, activeFloor.floorPlan.walls, pointer).trimmedSegment ?? null
        applyClipPreviewPoints(preview && preview.length >= 2 ? preview : null)
        applyOpeningPreview(null)
        applyInsertPointPreview(null)
        return
      }

      if (activeTool === 'insertDoor' || activeTool === 'insertWindow') {
        applyClipPreviewPoints((prev) => (prev === null ? prev : null))
        applyInsertPointPreview(null)
        const doorWidthPx = snapOpeningWidthToWholeCentimeters(
          0.83 * canvasPxPerMeter,
          canvasPxPerMeter
        )
        const clickWindowWidthPx = 0.5 * canvasPxPerMeter
        const previewWindowWidthPx = pxPerMeter != null ? 0.5 * pxPerMeter : 100
        const windowWidthPx = snapOpeningWidthToWholeCentimeters(
          resolveWindowInsertWidthPx(clickWindowWidthPx, previewWindowWidthPx),
          canvasPxPerMeter
        )
        const width = activeTool === 'insertDoor' ? doorWidthPx : windowWidthPx
        const snappedCenter = resolveOpeningPositionSnap({
          wall,
          walls: activeFloor.floorPlan.walls,
          pointer,
          spanCenterRadius: screenPxToCanvasUnits(
            planView.zoom,
            OPENING_SPAN_CENTER_SNAP_ZONE_PX,
            OPENING_SPAN_CENTER_SNAP_ZONE_PX_MIN,
            OPENING_SPAN_CENTER_SNAP_ZONE_PX_MAX
          ),
          snapToGrid: planView.snapToGrid,
          gridSize,
        })
        const result = validateOpeningPlacement(
          wall,
          snappedCenter.point,
          width,
          baseDoors,
          baseWindows
        )
        const doorOrientation =
          activeTool === 'insertDoor' && result.valid
            ? (() => {
                const geom = computeOpeningGeometry(wall.points, result.position)
                if (!geom) return null
                if (doorHoverWallIdRef.current !== wallId) {
                  doorHoverWallIdRef.current = wallId
                  doorHoverOpenSideRef.current = 'right'
                }
                return resolveDoorPlacementOrientation({
                  hingeSwing: null,
                  center: geom.center,
                  tangent: geom.tangent,
                  pointer,
                  walls: activeFloor.floorPlan!.walls,
                  wall,
                  masterWallThickness: activeFloor.floorPlan!.masterWallThickness,
                  pxPerMeter: canvasPxPerMeter,
                  deadzonePx: openingWallNormalDeadzoneCanvas(planView.zoom),
                  lastOpenSide: doorHoverOpenSideRef.current,
                })
              })()
            : null
        if (doorOrientation) {
          doorHoverOpenSideRef.current = doorOrientation.openSide
        }
        applyOpeningPreview({
          wallId,
          position: result.position,
          width: result.width,
          kind: activeTool === 'insertDoor' ? 'door' : 'window',
          valid: result.valid,
          ...(doorOrientation
            ? {
                doorSwing: doorOrientation.swing,
                doorDirection: doorOrientation.direction,
              }
            : {}),
        })
        return
      }

      if (activeTool === 'insertPoint') {
        applyClipPreviewPoints((prev) => (prev === null ? prev : null))
        applyOpeningPreview(null)
        // Preview = point on wall (project cursor onto wall, like opening preview). Keeps preview on the line.
        const { t } = projectPointToWall(wall.points, pointer)
        const geom = computeOpeningGeometry(wall.points, t)
        applyInsertPointPreview(geom?.center ?? null)
        return
      }

      applyClipPreviewPoints((prev) => (prev === null ? prev : null))
      applyOpeningPreview(null)
      applyInsertPointPreview(null)
    },
    [
      shouldHandleWallHover,
      activeTool,
      activeFloor,
      baseDoors,
      baseWindows,
      canvasPxPerMeter,
      pxPerMeter,
      planView.zoom,
      planView.snapToGrid,
      gridSize,
    ]
  )

  const handleOpeningPreviewOverrideChange = useCallback(
    (
      preview: {
        wallId: string
        position: number
        width: number
        kind: 'door' | 'window'
        valid: boolean
        doorSwing?: 'left' | 'right'
        doorDirection?: 'in' | 'out'
      } | null
    ) => {
      applyOpeningPreview(preview)
    },
    []
  )

  const pointsEqual = useCallback((a: Point2, b: Point2, epsilon = 1e-4) => {
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= epsilon
  }, [])

  const pointKey = useCallback(
    (p: Point2) => `${Math.round(p.x * 1000)}:${Math.round(p.y * 1000)}`,
    []
  )

  const segmentKey = useCallback(
    (a: Point2, b: Point2) => {
      const k1 = pointKey(a)
      const k2 = pointKey(b)
      return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`
    },
    [pointKey]
  )

  const getSegmentConnectedWallIds = useCallback(
    (walls: Wall[], startWallId: string): Set<string> => {
      const wallSegments = new Map<string, Set<string>>()
      const segmentToWalls = new Map<string, Set<string>>()
      for (const w of walls) {
        const segs = new Set<string>()
        for (let i = 0; i < w.points.length - 1; i++) {
          const key = segmentKey(w.points[i]!, w.points[i + 1]!)
          segs.add(key)
          let owners = segmentToWalls.get(key)
          if (!owners) {
            owners = new Set<string>()
            segmentToWalls.set(key, owners)
          }
          owners.add(w.id)
        }
        wallSegments.set(w.id, segs)
      }

      const connected = new Set<string>([startWallId])
      const queue: string[] = [startWallId]
      while (queue.length > 0) {
        const current = queue.shift()!
        const segs = wallSegments.get(current)
        if (!segs) continue
        for (const seg of segs) {
          const owners = segmentToWalls.get(seg)
          if (!owners) continue
          for (const otherWallId of owners) {
            if (!connected.has(otherWallId)) {
              connected.add(otherWallId)
              queue.push(otherWallId)
            }
          }
        }
      }
      return connected
    },
    [segmentKey]
  )

  const buildMergedPointTargets = useCallback(
    (walls: Wall[], wallId: string, pointIndex: number) => {
      const sourceWall = walls.find((w) => w.id === wallId)
      const sourcePoint = sourceWall?.points[pointIndex]
      if (!sourceWall || !sourcePoint) return []
      if (isCurvedWall(sourceWall) && pointIndex === 1) {
        return [{ wallId, pointIndex }]
      }

      const connectedWallIds = getSegmentConnectedWallIds(walls, wallId)
      const targets: Array<{ wallId: string; pointIndex: number }> = []
      for (const w of walls) {
        if (!connectedWallIds.has(w.id)) continue
        w.points.forEach((p, idx) => {
          if (isCurvedWall(w) && idx === 1) return
          if (pointsEqual(p, sourcePoint)) {
            targets.push({ wallId: w.id, pointIndex: idx })
          }
        })
      }
      return targets
    },
    [getSegmentConnectedWallIds, pointsEqual]
  )

  // Throttle state updates while dragging wall points / selections to avoid excessive
  // projectStore writes and React re-renders on every pointermove.
  const lastWallPointUpdateTimeRef = useRef<number>(0)
  const lastWallSelectionUpdateTimeRef = useRef<number>(0)
  const lastDoorUpdateTimeRef = useRef<number>(0)
  const lastWindowUpdateTimeRef = useRef<number>(0)
  const softSnapToGrid = useCallback(
    (point: Point2, enabled: boolean, axis?: 'x' | 'y'): Point2 => {
      if (!enabled) return point
      const gridPoint = snapToGrid(point, gridSize, planView.snapToGrid)
      const snapped =
        axis === 'x'
          ? { x: gridPoint.x, y: point.y }
          : axis === 'y'
            ? { x: point.x, y: gridPoint.y }
            : gridPoint
      const breakawayThreshold = screenPxToCanvasUnits(
        planView.zoom,
        DRAW_TOOL_GRID_SNAP_BREAKAWAY_PX,
        DRAW_TOOL_GRID_SNAP_BREAKAWAY_PX_MIN,
        DRAW_TOOL_GRID_SNAP_BREAKAWAY_PX_MAX
      )
      const dx = snapped.x - point.x
      const dy = snapped.y - point.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      return dist <= breakawayThreshold ? snapped : point
    },
    [gridSize, planView.snapToGrid, planView.zoom]
  )

  const resolveProjectedFloorSnap = useCallback(
    (
      point: Point2,
      excludedKeys: Set<string>
    ): { snappedPoint: Point2; guides: Array<{ from: Point2; to: Point2 }> } | null => {
      if (!activeFloor?.floorPlan || planView.snapToProjection === false) return null
      const projectionSnapZone = screenPxToCanvasUnits(
        planView.zoom,
        DRAW_TOOL_PROJECTION_SNAP_ZONE_PX,
        DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MIN,
        DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MAX
      )

      const anchors: Point2[] = []
      for (const wall of activeFloor.floorPlan.walls) {
        for (let pointIndex = 0; pointIndex < wall.points.length; pointIndex++) {
          if (excludedKeys.has(`w:${wall.id}:${pointIndex}`)) continue
          if (isCurvedWall(wall) && pointIndex === 1) continue
          const anchor = wall.points[pointIndex]
          if (anchor) anchors.push(anchor)
        }
      }
      for (const stair of activeFloor.floorPlan.stairs ?? []) {
        for (let pointIndex = 0; pointIndex < stair.points.length; pointIndex++) {
          if (excludedKeys.has(`s:${stair.id}:${pointIndex}`)) continue
          const anchor = stair.points[pointIndex]
          if (anchor) anchors.push(anchor)
        }
      }

      let bestVertical: { offset: number; anchor: Point2 } | null = null
      let bestHorizontal: { offset: number; anchor: Point2 } | null = null

      for (const anchor of anchors) {
        const dx = Math.abs(point.x - anchor.x)
        const dy = Math.abs(point.y - anchor.y)
        if (dx <= projectionSnapZone && (!bestVertical || dx < bestVertical.offset)) {
          bestVertical = { offset: dx, anchor }
        }
        if (dy <= projectionSnapZone && (!bestHorizontal || dy < bestHorizontal.offset)) {
          bestHorizontal = { offset: dy, anchor }
        }
      }

      if (!bestVertical && !bestHorizontal) return null

      const snappedPoint: Point2 = {
        x: bestVertical ? bestVertical.anchor.x : point.x,
        y: bestHorizontal ? bestHorizontal.anchor.y : point.y,
      }
      const guides: Array<{ from: Point2; to: Point2 }> = []
      if (bestVertical)
        guides.push({
          from: bestVertical.anchor,
          to: { x: bestVertical.anchor.x, y: snappedPoint.y },
        })
      if (bestHorizontal)
        guides.push({
          from: bestHorizontal.anchor,
          to: { x: snappedPoint.x, y: bestHorizontal.anchor.y },
        })
      return { snappedPoint, guides: guides.slice(0, 2) }
    },
    [activeFloor, planView.snapToProjection, planView.zoom]
  )

  const snapGraphicFloorPoint = useCallback(
    (point: Point2): { point: Point2; guides: Array<{ from: Point2; to: Point2 }> } => {
      const nearbyLine = resolveNearbyFloorLineSnap(point)
      if (nearbyLine) return { point: nearbyLine.point, guides: [] }
      const projected = resolveProjectedFloorSnap(point, new Set())
      const snapped = softSnapToGrid(projected?.snappedPoint ?? point, true)
      return { point: snapped, guides: projected?.guides ?? [] }
    },
    [resolveNearbyFloorLineSnap, resolveProjectedFloorSnap, softSnapToGrid]
  )

  const applyMergedPointMove = useCallback(
    (
      walls: Wall[],
      newPos: Point2,
      snapToGridEnabled: boolean,
      mode: 'preview' | 'commit' = 'commit',
      movementAxis?: 'x' | 'y'
    ): { overridePositions: Map<string, Point2> } | void => {
      const targets = pointDragTargetsRef.current
      if (targets.length === 0) return

      const pointsMatch = (a: Point2, b: Point2, epsilon = 1e-4) =>
        Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon
      const segmentIntersectionPoint = (
        a: Point2,
        b: Point2,
        c: Point2,
        d: Point2
      ): Point2 | null => {
        const r = { x: b.x - a.x, y: b.y - a.y }
        const s = { x: d.x - c.x, y: d.y - c.y }
        const rxs = r.x * s.y - r.y * s.x
        const cma = { x: c.x - a.x, y: c.y - a.y }
        const qpxr = cma.x * r.y - cma.y * r.x
        const epsilon = 1e-8
        if (Math.abs(rxs) <= epsilon) return null
        const t = (cma.x * s.y - cma.y * s.x) / rxs
        const u = qpxr / rxs
        if (t < -epsilon || t > 1 + epsilon || u < -epsilon || u > 1 + epsilon) return null
        return { x: a.x + t * r.x, y: a.y + t * r.y }
      }
      const isProjectionPathObstructed = (
        from: Point2,
        to: Point2,
        segments: Array<{ a: Point2; b: Point2 }>
      ) => {
        for (const seg of segments) {
          const hit = segmentIntersectionPoint(from, to, seg.a, seg.b)
          if (!hit) continue
          if (pointsMatch(hit, from) || pointsMatch(hit, to)) continue
          return true
        }
        return false
      }
      const resolveProjectedSnap = (point: Point2) => {
        const projectionSnapZone = screenPxToCanvasUnits(
          planView.zoom,
          DRAW_TOOL_PROJECTION_SNAP_ZONE_PX,
          DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MIN,
          DRAW_TOOL_PROJECTION_SNAP_ZONE_PX_MAX
        )
        const excludedAnchorKeys = new Set(targets.map((t) => `${t.wallId}:${t.pointIndex}`))
        const anchors: Array<{ wallId: string; pointIndex: number; point: Point2 }> = []
        for (const wall of walls) {
          for (let pointIndex = 0; pointIndex < wall.points.length; pointIndex++) {
            const p = wall.points[pointIndex]
            if (!p) continue
            if (isCurvedWall(wall) && pointIndex === 1) continue
            const key = `${wall.id}:${pointIndex}`
            // Never project-snap against vertices that are currently being dragged.
            if (excludedAnchorKeys.has(key)) continue
            anchors.push({ wallId: wall.id, pointIndex, point: p })
          }
        }
        const segments: Array<{ a: Point2; b: Point2 }> = []
        for (const wall of walls) {
          const pathPoints = getWallPathPoints(wall)
          for (let i = 0; i < pathPoints.length - 1; i++) {
            const a = pathPoints[i]
            const b = pathPoints[i + 1]
            if (!a || !b) continue
            segments.push({ a, b })
          }
        }
        let bestVertical: { offset: number; distanceToAnchor: number; anchor: Point2 } | null = null
        let bestHorizontal: { offset: number; distanceToAnchor: number; anchor: Point2 } | null =
          null
        for (const anchor of anchors) {
          if (pointsMatch(anchor.point, point)) continue
          const dx = Math.abs(point.x - anchor.point.x)
          const dy = Math.abs(point.y - anchor.point.y)
          if (dx <= projectionSnapZone) {
            const snapped = { x: anchor.point.x, y: point.y }
            if (!isProjectionPathObstructed(snapped, anchor.point, segments)) {
              const distanceToAnchor = Math.hypot(
                snapped.x - anchor.point.x,
                snapped.y - anchor.point.y
              )
              const isBetter =
                !bestVertical ||
                dx < bestVertical.offset ||
                (Math.abs(dx - bestVertical.offset) <= 1e-6 &&
                  distanceToAnchor < bestVertical.distanceToAnchor)
              if (isBetter) bestVertical = { offset: dx, distanceToAnchor, anchor: anchor.point }
            }
          }
          if (dy <= projectionSnapZone) {
            const snapped = { x: point.x, y: anchor.point.y }
            if (!isProjectionPathObstructed(snapped, anchor.point, segments)) {
              const distanceToAnchor = Math.hypot(
                snapped.x - anchor.point.x,
                snapped.y - anchor.point.y
              )
              const isBetter =
                !bestHorizontal ||
                dy < bestHorizontal.offset ||
                (Math.abs(dy - bestHorizontal.offset) <= 1e-6 &&
                  distanceToAnchor < bestHorizontal.distanceToAnchor)
              if (isBetter) bestHorizontal = { offset: dy, distanceToAnchor, anchor: anchor.point }
            }
          }
        }
        if (!bestVertical && !bestHorizontal) return null
        const snappedPoint: Point2 = {
          x: bestVertical ? bestVertical.anchor.x : point.x,
          y: bestHorizontal ? bestHorizontal.anchor.y : point.y,
        }
        const guides: Array<{ from: Point2; to: Point2 }> = []
        if (bestVertical)
          guides.push({
            from: bestVertical.anchor,
            to: { x: bestVertical.anchor.x, y: snappedPoint.y },
          })
        if (bestHorizontal)
          guides.push({
            from: bestHorizontal.anchor,
            to: { x: snappedPoint.x, y: bestHorizontal.anchor.y },
          })
        return { snappedPoint, guides: guides.slice(0, 2) }
      }

      const anchor = vertexDragAnchorRef.current
      const initialPointsByWall = vertexDragInitialPointsRef.current
      let hasDelta = false
      let dx = 0
      let dy = 0
      if (anchor && initialPointsByWall) {
        const initialPoints = initialPointsByWall.get(anchor.wallId)
        const anchorInitial = initialPoints?.[anchor.pointIndex]
        if (anchorInitial) {
          dx = newPos.x - anchorInitial.x
          dy = newPos.y - anchorInitial.y
          hasDelta = true
        }
      }

      const isSingleVertexMove = targets.length === 1
      let snappedDx = dx
      let snappedDy = dy
      let targetPos = newPos
      const nextVertexGuides: Array<{ from: Point2; to: Point2 }> = []
      const excludedLineKeys = new Set(
        targets.map((target) => `w:${target.wallId}:${target.pointIndex}`)
      )
      const nearbyLine = hasDelta
        ? resolveNearbyFloorLineSnap(newPos, excludedLineKeys, movementAxis)
        : null
      if (nearbyLine && anchor && initialPointsByWall) {
        const anchorInitial = initialPointsByWall.get(anchor.wallId)?.[anchor.pointIndex]
        if (anchorInitial) {
          snappedDx = nearbyLine.point.x - anchorInitial.x
          snappedDy = nearbyLine.point.y - anchorInitial.y
          targetPos = nearbyLine.point
        }
      }

      type AxisCandidate = {
        snappedDelta: number
        offset: number
        guides: Array<{ from: Point2; to: Point2 }>
      }
      const xCandidates: AxisCandidate[] = []
      const yCandidates: AxisCandidate[] = []

      if (!nearbyLine && hasDelta && initialPointsByWall && planView.snapToProjection !== false) {
        for (const target of targets) {
          const basePoint = initialPointsByWall.get(target.wallId)?.[target.pointIndex]
          if (!basePoint) continue
          const rawMovedPos = { x: basePoint.x + dx, y: basePoint.y + dy }
          const projected = resolveProjectedSnap(rawMovedPos)
          if (!projected) continue
          const candidateDx = projected.snappedPoint.x - basePoint.x
          const candidateDy = projected.snappedPoint.y - basePoint.y
          if (movementAxis !== 'y' && Math.abs(candidateDx - dx) > 1e-6) {
            xCandidates.push({
              snappedDelta: candidateDx,
              offset: Math.abs(candidateDx - dx),
              guides: projected.guides,
            })
          }
          if (movementAxis !== 'x' && Math.abs(candidateDy - dy) > 1e-6) {
            yCandidates.push({
              snappedDelta: candidateDy,
              offset: Math.abs(candidateDy - dy),
              guides: projected.guides,
            })
          }
        }
      }

      if (xCandidates.length > 0) {
        xCandidates.sort((a, b) => a.offset - b.offset)
        snappedDx = xCandidates[0]!.snappedDelta
        nextVertexGuides.push(...xCandidates[0]!.guides)
      }
      if (yCandidates.length > 0) {
        yCandidates.sort((a, b) => a.offset - b.offset)
        snappedDy = yCandidates[0]!.snappedDelta
        nextVertexGuides.push(...yCandidates[0]!.guides)
      }

      if (anchor && initialPointsByWall) {
        const anchorInitial = initialPointsByWall.get(anchor.wallId)?.[anchor.pointIndex]
        if (anchorInitial) {
          targetPos = {
            x: anchorInitial.x + snappedDx,
            y: anchorInitial.y + snappedDy,
          }
        }
      }

      const shouldApplyGrid =
        (isSingleVertexMove && planView.snapToGrid) || (!isSingleVertexMove && snapToGridEnabled)
      if (!nearbyLine && shouldApplyGrid && anchor && initialPointsByWall) {
        const anchorInitial = initialPointsByWall.get(anchor.wallId)?.[anchor.pointIndex]
        if (anchorInitial) {
          const snappedAnchor = softSnapToGrid(
            {
              x: anchorInitial.x + snappedDx,
              y: anchorInitial.y + snappedDy,
            },
            planView.snapToGrid,
            movementAxis
          )
          snappedDx = snappedAnchor.x - anchorInitial.x
          snappedDy = snappedAnchor.y - anchorInitial.y
          targetPos = snappedAnchor
        }
      }

      if (mode === 'preview') {
        applyVertexMoveProjectedSnapGuides(nextVertexGuides)
      } else {
        applyVertexMoveProjectedSnapGuides([])
      }

      const byWall = new Map<string, Set<number>>()
      for (const target of targets) {
        let indices = byWall.get(target.wallId)
        if (!indices) {
          indices = new Set<number>()
          byWall.set(target.wallId, indices)
        }
        indices.add(target.pointIndex)
      }

      let overridePositions: Map<string, Point2> | null = null

      for (const [targetWallId, indices] of byWall) {
        const targetWall = walls.find((w) => w.id === targetWallId)
        if (!targetWall) continue

        const initialWallPoints = initialPointsByWall?.get(targetWallId) ?? null
        const wallDoors = baseDoors.filter((d) => d.wallId === targetWallId)
        const wallWindows = baseWindows.filter((w) => w.wallId === targetWallId)
        let currentPoints = targetWall.points
        const currentDoors = wallDoors.map((d) => ({ ...d }))
        const currentWindows = wallWindows.map((w) => ({ ...w }))
        const allDoorUpdates: Array<{ id: string; position: number }> = []
        const allWindowUpdates: Array<{ id: string; position: number }> = []
        const constraintResultsByPoint: Array<{
          pointIndex: number
          wasClamped: boolean
          doorUpdates: number
          windowUpdates: number
        }> = []

        const sortedIndices = Array.from(indices).sort((a, b) => a - b)

        if (sortedIndices.length === 1) {
          const pointIndex = sortedIndices[0]!
          const basePoint = initialWallPoints?.[pointIndex]
          const candidatePos =
            hasDelta && basePoint
              ? { x: basePoint.x + snappedDx, y: basePoint.y + snappedDy }
              : targetPos
          const initialOpenings =
            vertexDragInitialOpeningsRef.current?.wallId === targetWallId &&
            vertexDragInitialOpeningsRef.current?.pointIndex === pointIndex
              ? vertexDragInitialOpeningsRef.current.bySegment
              : undefined
          const result = constrainVertexMove(
            currentPoints,
            pointIndex,
            candidatePos,
            currentDoors,
            currentWindows,
            initialOpenings ? { initialOpeningsBySegment: initialOpenings } : undefined
          )
          constraintResultsByPoint.push({
            pointIndex,
            wasClamped: result.wasClamped,
            doorUpdates: result.doorUpdates.length,
            windowUpdates: result.windowUpdates.length,
          })
          currentPoints = result.points
          for (const u of result.doorUpdates) {
            const d = currentDoors.find((x) => x.id === u.id)
            if (d) d.position = u.position
          }
          for (const u of result.windowUpdates) {
            const w = currentWindows.find((x) => x.id === u.id)
            if (w) w.position = u.position
          }
          allDoorUpdates.push(...result.doorUpdates)
          allWindowUpdates.push(...result.windowUpdates)
        } else {
          if (!initialWallPoints || !hasDelta) {
            continue
          }
          const basePoints = initialWallPoints
          const movedSet = new Set(sortedIndices)
          const candidatePoints = basePoints.map((p, idx) =>
            movedSet.has(idx) ? { x: p.x + snappedDx, y: p.y + snappedDy } : p
          )
          const result = adjustVerticesAndOpenings(
            basePoints,
            candidatePoints,
            currentDoors,
            currentWindows,
            sortedIndices
          )
          currentPoints = result.points
          for (const u of result.doorUpdates) {
            const d = currentDoors.find((x) => x.id === u.id)
            if (d) d.position = u.position
          }
          for (const u of result.windowUpdates) {
            const w = currentWindows.find((x) => x.id === u.id)
            if (w) w.position = u.position
          }
          allDoorUpdates.push(...result.doorUpdates)
          allWindowUpdates.push(...result.windowUpdates)
          constraintResultsByPoint.push({
            pointIndex: -1,
            wasClamped: result.wasClamped,
            doorUpdates: result.doorUpdates.length,
            windowUpdates: result.windowUpdates.length,
          })
        }

        const doorUpdateById = new Map<string, number>()
        for (const u of allDoorUpdates) {
          doorUpdateById.set(u.id, u.position)
        }
        const windowUpdateById = new Map<string, number>()
        for (const u of allWindowUpdates) {
          windowUpdateById.set(u.id, u.position)
        }

        const excludeIds = new Set<string>([...doorUpdateById.keys(), ...windowUpdateById.keys()])
        const { doorUpdates: preservedDoorUpdates, windowUpdates: preservedWindowUpdates } =
          preserveOpeningPositionsAfterPointChange(
            targetWall.points,
            currentPoints,
            currentDoors,
            currentWindows,
            excludeIds
          )

        for (const u of preservedDoorUpdates) {
          doorUpdateById.set(u.id, u.position)
          const d = currentDoors.find((x) => x.id === u.id)
          if (d) d.position = u.position
        }
        for (const u of preservedWindowUpdates) {
          windowUpdateById.set(u.id, u.position)
          const w = currentWindows.find((x) => x.id === u.id)
          if (w) w.position = u.position
        }

        const finalDoorUpdates = Array.from(doorUpdateById, ([id, position]) => ({
          id,
          position,
        }))
        const finalWindowUpdates = Array.from(windowUpdateById, ([id, position]) => ({
          id,
          position,
        }))

        if (mode === 'preview') {
          if (!overridePositions) overridePositions = new Map()
          for (const pointIndex of indices) {
            const pt = currentPoints[pointIndex]
            if (pt) overridePositions.set(`${targetWallId}:${pointIndex}`, pt)
          }
        }

        if (mode === 'preview') {
          applyPreviewWalls((prev) => {
            const next = new Map(prev ?? undefined)
            next.set(targetWallId, { ...targetWall, points: currentPoints })
            return next
          })
          if (finalDoorUpdates.length > 0 || finalWindowUpdates.length > 0) {
            applyPreviewDoors((prev) => {
              const next = new Map(prev ?? undefined)
              for (const u of finalDoorUpdates) {
                const base =
                  baseDoors.find((d) => d.id === u.id) ?? (prev?.get(u.id) as Door | undefined)
                if (base) next.set(u.id, { ...base, position: u.position })
              }
              return next
            })
            applyPreviewWindows((prev) => {
              const next = new Map(prev ?? undefined)
              for (const u of finalWindowUpdates) {
                const base =
                  baseWindows.find((w) => w.id === u.id) ?? (prev?.get(u.id) as Window | undefined)
                if (base) next.set(u.id, { ...base, position: u.position })
              }
              return next
            })
          }
        } else {
          vertexDragInitialOpeningsRef.current = null
          updateWall(targetWallId, {
            points: currentPoints,
            doorUpdates: finalDoorUpdates,
            windowUpdates: finalWindowUpdates,
          })
          vertexDragAnchorRef.current = null
          vertexDragInitialPointsRef.current = null
        }
      }
      if (mode === 'preview' && overridePositions && overridePositions.size > 0)
        return { overridePositions }
    },
    [
      planView.snapToGrid,
      planView.snapToProjection,
      planView.zoom,
      updateWall,
      baseDoors,
      baseWindows,
      resolveNearbyFloorLineSnap,
      softSnapToGrid,
    ]
  )

  const applyOpeningMoveFromPointer = useCallback(
    (pointer: Point2, mode: 'preview' | 'commit') => {
      const dragState = doorDragRef.current
      if (!dragState || !activeFloor?.floorPlan) return

      const { kind, entityId, wallId, geom, handleEnd, handleOffsetFromCenter } = dragState
      const wall = (activeFloor.floorPlan.walls ?? []).find((w: Wall) => w.id === wallId)
      if (!wall || wall.points.length < 2) return

      const totalLength = getWallTotalLength(wall.points)
      if (totalLength < 1e-10) return

      // Collect all openings (doors + windows) on this wall, using the
      // current render state so previews are respected while dragging.
      type OpeningOnWall = {
        kind: 'door' | 'window'
        id: string
        width: number
        position: number
      }

      const wallDoors = (doorsForRender ?? []).filter((d) => d.wallId === wallId)
      const wallWindows = (windowsForRender ?? []).filter((w) => w.wallId === wallId)
      const allOpenings: OpeningOnWall[] = [
        ...wallDoors.map((d) => ({
          kind: 'door' as const,
          id: d.id,
          width: d.width,
          position: d.position,
        })),
        ...wallWindows.map((w) => ({
          kind: 'window' as const,
          id: w.id,
          width: w.width,
          position: w.position,
        })),
      ]

      if (!allOpenings.length) return

      // Constrain movement to the single wall segment where the drag
      // started, so openings cannot slide over corners.
      const segmentStart = geom.segmentStartDist
      const segmentEnd = geom.segmentEndDist
      const segmentLength = segmentEnd - segmentStart
      if (segmentLength <= 1e-6) return

      // Openings that live on this same segment, ordered along the segment.
      const segmentOpenings: Array<OpeningOnWall & { centerAlongSegment: number }> = []
      for (const o of allOpenings) {
        const g = computeOpeningGeometry(wall.points, o.position)
        if (!g || g.segmentIndex !== geom.segmentIndex) continue
        const centerAlongSegment = g.centerDist - segmentStart
        segmentOpenings.push({
          ...o,
          centerAlongSegment,
        })
      }

      if (!segmentOpenings.length) return

      segmentOpenings.sort((a, b) => a.centerAlongSegment - b.centerAlongSegment)

      const movingIndex = segmentOpenings.findIndex((o) => o.kind === kind && o.id === entityId)
      if (movingIndex === -1) return

      const moving = segmentOpenings[movingIndex]!

      // Project pointer onto the specific wall segment where the drag
      // started, so movement is strictly along that segment and cannot
      // jump across corners.
      const segStartPoint = wall.points[geom.segmentIndex]!
      const segEndPoint = wall.points[geom.segmentIndex + 1]!
      const segDx = segEndPoint.x - segStartPoint.x
      const segDy = segEndPoint.y - segStartPoint.y
      const segLenSq = segDx * segDx + segDy * segDy
      const segLen = Math.sqrt(segLenSq)
      let desiredCenterOnSegmentRaw = moving.centerAlongSegment
      if (segLenSq > 1e-10) {
        const t = Math.max(
          0,
          Math.min(
            1,
            ((pointer.x - segStartPoint.x) * segDx + (pointer.y - segStartPoint.y) * segDy) /
              segLenSq
          )
        )
        const projectedDist = t * segLen
        // Keep the grabbed handle under the cursor using actual visual handle offset (halfWidth + handleOffset).
        if (handleEnd === 'start') {
          desiredCenterOnSegmentRaw = projectedDist + handleOffsetFromCenter
        } else {
          desiredCenterOnSegmentRaw = projectedDist - handleOffsetFromCenter
        }
      }

      const segmentOpeningsForEngine = segmentOpenings.map((o) => ({
        id: o.id,
        kind: o.kind,
        width: o.width,
        centerDist: segmentStart + o.centerAlongSegment,
        centerAlongSegment: o.centerAlongSegment,
      }))
      const moveResult = applyOpeningMoveOnSegment({
        openingId: entityId,
        kind,
        width: moving.width,
        segmentIndex: geom.segmentIndex,
        segmentStartDist: segmentStart,
        segmentEndDist: segmentEnd,
        segmentLength,
        segmentOpenings: segmentOpeningsForEngine,
        desiredCenterAlongSegment: desiredCenterOnSegmentRaw,
      })

      const updatedPositions = new Map<string, number>()
      for (const [openingId, centerAlongSegment] of moveResult.positionsByOpeningId) {
        const centerAlongWall = segmentStart + centerAlongSegment
        const pos = totalLength > 0 ? centerAlongWall / totalLength : 0
        updatedPositions.set(openingId, pos)
      }

      const now =
        typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
      const lastRef = kind === 'door' ? lastDoorUpdateTimeRef : lastWindowUpdateTimeRef
      if (mode === 'preview' && now - lastRef.current < 16) {
        return
      }
      lastRef.current = now

      if (mode === 'preview') {
        applyPreviewDoors((prev) => {
          const next = new Map(prev ?? undefined)
          for (const o of allOpenings) {
            if (o.kind !== 'door') continue
            const newPos = updatedPositions.get(o.id)
            const base =
              baseDoors.find((d) => d.id === o.id) ??
              (prev ? (prev.get(o.id) as Door | undefined) : undefined)
            if (!base) continue
            next.set(o.id, {
              ...base,
              position: newPos != null ? newPos : base.position,
            })
          }
          return next
        })
        applyPreviewWindows((prev) => {
          const next = new Map(prev ?? undefined)
          for (const o of allOpenings) {
            if (o.kind !== 'window') continue
            const newPos = updatedPositions.get(o.id)
            const base =
              baseWindows.find((w) => w.id === o.id) ??
              (prev ? (prev.get(o.id) as Window | undefined) : undefined)
            if (!base) continue
            next.set(o.id, {
              ...base,
              position: newPos != null ? newPos : base.position,
            })
          }
          return next
        })
      } else {
        applyPreviewDoors(null)
        applyPreviewWindows(null)
        for (const o of allOpenings) {
          const newPos = updatedPositions.get(o.id)
          if (newPos == null) continue
          if (o.kind === 'door') {
            updateDoor(o.id, { position: newPos })
          } else {
            updateWindow(o.id, { position: newPos })
          }
        }
        lastDoorUpdateTimeRef.current = 0
        lastWindowUpdateTimeRef.current = 0
      }
    },
    [
      activeFloor,
      baseDoors,
      baseWindows,
      doorsForRender,
      windowsForRender,
      updateDoor,
      updateWindow,
    ]
  )

  const beginOpeningDimensionDrag = useCallback(
    (start: Point2, outwardNormal: Point2) => {
      if (!activeFloor?.floorPlan || !selectedOpeningForWidthEditor) return
      const { kind, id } = selectedOpeningForWidthEditor
      const opening =
        kind === 'door'
          ? baseDoors.find((door) => door.id === id)
          : baseWindows.find((window) => window.id === id)
      if (!opening) return
      const wall = activeFloor.floorPlan.walls.find(
        (candidate: Wall) => candidate.id === opening.wallId
      )
      if (!wall) return
      const geom = computeOpeningGeometry(wall.points, opening.position)
      if (!geom) return
      openingDimensionDragRef.current = {
        kind,
        entityId: id,
        wall,
        geom,
        start,
        outwardNormal,
        mode: null,
        baseWidth: opening.width,
        basePosition: opening.position,
        lastResult: null,
      }
    },
    [activeFloor, baseDoors, baseWindows, selectedOpeningForWidthEditor]
  )

  const applyOpeningDimensionDrag = useCallback(
    (
      pointer: Point2,
      mode: 'preview' | 'commit',
      modifiers: DimensionDragModifiers = { precise: false, quantize: false }
    ) => {
      const drag = openingDimensionDragRef.current
      if (!drag) return
      const { wall, geom } = drag
      const effectivePointer = modifiers.precise
        ? {
            x: drag.start.x + (pointer.x - drag.start.x) * 0.1,
            y: drag.start.y + (pointer.y - drag.start.y) * 0.1,
          }
        : pointer
      const resolution = resolveDimensionDrag(
        drag.start,
        effectivePointer,
        geom.tangent,
        drag.outwardNormal,
        drag.mode,
        screenPxToCanvasUnits(planView.zoom, 5, 3, 10)
      )
      drag.mode = resolution.mode
      if (!resolution.mode) return

      const minimumWidth = Math.max(1, canvasPxPerMeter / 100)
      const rawResize = resizeDimensionFromDrag(drag.baseWidth, resolution, minimumWidth)
      const dimensionSnapStep = planView.snapToGrid
        ? gridSize
        : modifiers.quantize
          ? canvasPxPerMeter / 10
          : 0
      const width =
        dimensionSnapStep > 0
          ? snapDimensionValue(rawResize.width, dimensionSnapStep, minimumWidth)
          : snapOpeningWidthToWholeCentimeters(rawResize.width, canvasPxPerMeter)
      const segmentLength = geom.segmentEndDist - geom.segmentStartDist
      const boundedWidth = Math.min(width, Math.max(minimumWidth, segmentLength))
      const totalLength = getWallTotalLength(wall.points)
      const otherDoors =
        drag.kind === 'door' ? baseDoors.filter((door) => door.id !== drag.entityId) : baseDoors
      const otherWindows =
        drag.kind === 'window'
          ? baseWindows.filter((window) => window.id !== drag.entityId)
          : baseWindows
      let fitted: { width: number; position: number }

      if (resolution.mode === 'centered') {
        const halfWidth = boundedWidth / 2
        const desiredCenterDist = clamp(
          geom.segmentEndDist - halfWidth,
          geom.segmentStartDist + halfWidth,
          geom.centerDist
        )
        const segmentStart = wall.points[geom.segmentIndex]!
        const centerPoint = {
          x: segmentStart.x + geom.tangent.x * (desiredCenterDist - geom.segmentStartDist),
          y: segmentStart.y + geom.tangent.y * (desiredCenterDist - geom.segmentStartDist),
        }
        fitted = fitOpeningPlacementForPreview(
          wall,
          {
            width: boundedWidth,
            centerPoint,
            centerPosition: totalLength > 0 ? desiredCenterDist / totalLength : drag.basePosition,
            doorSwing: null,
            isDraggingAlongWall: false,
          },
          otherDoors,
          otherWindows
        )
      } else {
        const obstacleSpans = [...otherDoors, ...otherWindows].flatMap((opening) => {
          if (opening.wallId !== wall.id) return []
          const openingGeom = computeOpeningGeometry(wall.points, opening.position)
          if (!openingGeom || openingGeom.segmentIndex !== geom.segmentIndex) return []
          return [
            {
              start: openingGeom.centerDist - opening.width / 2,
              end: openingGeom.centerDist + opening.width / 2,
            },
          ]
        })
        const anchored = clampAnchoredDimensionResize(
          geom.centerDist,
          drag.baseWidth,
          boundedWidth,
          resolution.mode,
          minimumWidth,
          geom.segmentStartDist,
          geom.segmentEndDist,
          obstacleSpans
        )
        fitted = {
          width: anchored.width,
          position: totalLength > 0 ? anchored.center / totalLength : drag.basePosition,
        }
      }
      drag.lastResult = fitted

      if (mode === 'preview') {
        if (drag.kind === 'door') {
          const base = baseDoors.find((door) => door.id === drag.entityId)
          if (base) applyPreviewDoors(new Map([[base.id, { ...base, ...fitted }]]))
        } else {
          const base = baseWindows.find((window) => window.id === drag.entityId)
          if (base) applyPreviewWindows(new Map([[base.id, { ...base, ...fitted }]]))
        }
        return
      }

      applyPreviewDoors(null)
      applyPreviewWindows(null)
      if (drag.kind === 'door') updateDoor(drag.entityId, fitted)
      else updateWindow(drag.entityId, fitted)
    },
    [
      baseDoors,
      baseWindows,
      canvasPxPerMeter,
      gridSize,
      planView.snapToGrid,
      planView.zoom,
      updateDoor,
      updateWindow,
    ]
  )

  const endOpeningDimensionDrag = useCallback(
    (pointer: Point2 | null, modifiers: DimensionDragModifiers) => {
      const drag = openingDimensionDragRef.current
      if (!drag) return
      if (pointer) applyOpeningDimensionDrag(pointer, 'commit', modifiers)
      else if (drag.lastResult) {
        applyPreviewDoors(null)
        applyPreviewWindows(null)
        if (drag.kind === 'door') updateDoor(drag.entityId, drag.lastResult)
        else updateWindow(drag.entityId, drag.lastResult)
      }
      openingDimensionDragRef.current = null
    },
    [applyOpeningDimensionDrag, updateDoor, updateWindow]
  )

  const beginWallSelectionDrag = useCallback(
    (start: Point2, mode: 'free' | 'horizontal' | 'vertical' = 'free') => {
      if (!activeFloor?.floorPlan) return
      if (selectedWallIds.length === 0 && selectedStairPointIndices.size === 0) return
      // Start fresh selection preview geometry.
      wallSelectionPreviewRef.current = new Map()
      stairSelectionPreviewRef.current = new Map()
      const wallsById = new Map<string, Wall>(
        activeFloor.floorPlan.walls.map((w: Wall) => [w.id, w as Wall])
      )
      const stairsById = new Map<string, Stair>(
        (activeFloor.floorPlan.stairs ?? []).map((stair: Stair) => [stair.id, stair as Stair])
      )
      const initialPointsByWall = new Map<string, Point2[]>()
      const indicesByWall = new Map<string, Set<number>>()
      const initialPointsByStair = new Map<string, Point2[]>()
      const indicesByStair = new Map<string, Set<number>>()

      for (const wallId of selectedWallIds) {
        const wall = wallsById.get(wallId)
        if (!wall) continue
        initialPointsByWall.set(
          wallId,
          wall.points.map((p: Point2) => ({ x: p.x, y: p.y }))
        )
        const explicit = selectedPointIndices.get(wallId)
        const indices =
          explicit && explicit.length
            ? new Set<number>(explicit)
            : new Set<number>(wall.points.map((_, idx) => idx))
        indicesByWall.set(wallId, indices)
      }

      for (const [stairId, explicit] of selectedStairPointIndices.entries()) {
        const stair = stairsById.get(stairId)
        if (!stair || explicit.length === 0) continue
        initialPointsByStair.set(
          stairId,
          stair.points.map((p: Point2) => ({ x: p.x, y: p.y }))
        )
        indicesByStair.set(stairId, new Set<number>(explicit))
      }

      // Whole-shape move = rigid delta (no constraints) only when all points of every affected wall are selected.
      let isWholeShapeMove = true
      for (const [wallId, indices] of indicesByWall.entries()) {
        const wall = wallsById.get(wallId)
        if (wall && indices.size !== wall.points.length) {
          isWholeShapeMove = false
          break
        }
      }

      wallSelectionDragRef.current = {
        start,
        initialPointsByWall,
        indicesByWall,
        initialPointsByStair,
        indicesByStair,
        mode,
        singlePointTarget: null,
        singlePointCurrentPos: null,
        isWholeShapeMove,
      }

      const singlePointSelections: Array<{ wallId: string; pointIndex: number }> = []
      for (const [wallId, indices] of indicesByWall.entries()) {
        for (const pointIndex of indices.values()) {
          singlePointSelections.push({ wallId, pointIndex })
        }
      }

      // Blue single-axis handles and wall selection drags should route through
      // the same constraint path as free vertex drag. When exactly one vertex
      // is selected we additionally capture opening snapshots around it.
      if (singlePointSelections.length === 1) {
        const target = singlePointSelections[0]!
        wallSelectionDragRef.current.singlePointTarget = target
        const wall = activeFloor.floorPlan.walls.find((w: Wall) => w.id === target.wallId)
        const point = wall?.points[target.pointIndex]
        wallSelectionDragRef.current.singlePointCurrentPos = point
          ? { x: point.x, y: point.y }
          : null
        vertexDragAnchorRef.current = target
        if (activeFloor.floorPlan.walls.length > 0) {
          const initialByWall = new Map<string, Point2[]>()
          for (const w of activeFloor.floorPlan.walls) {
            initialByWall.set(
              w.id,
              w.points.map((p: Point2) => ({ x: p.x, y: p.y }))
            )
          }
          vertexDragInitialPointsRef.current = initialByWall
        } else {
          vertexDragInitialPointsRef.current = null
        }
        pointDragTargetsRef.current = buildMergedPointTargets(
          activeFloor.floorPlan.walls,
          target.wallId,
          target.pointIndex
        )
        if (
          pointDragTargetsRef.current.length === 1 &&
          pointDragTargetsRef.current[0]!.wallId === target.wallId &&
          pointDragTargetsRef.current[0]!.pointIndex === target.pointIndex &&
          wall &&
          wall.points.length >= 2
        ) {
          const wallDoors = baseDoors.filter((d) => d.wallId === target.wallId)
          const wallWindows = baseWindows.filter((w) => w.wallId === target.wallId)
          const bySegment = getOpeningsBySegment(wall.points, wallDoors, wallWindows)
          const leftIdx = target.pointIndex - 1
          const rightIdx = target.pointIndex
          const snapshot = new Map<number, OpeningOnSegment[]>()
          if (leftIdx >= 0 && bySegment.has(leftIdx)) snapshot.set(leftIdx, bySegment.get(leftIdx)!)
          if (rightIdx < wall.points.length && bySegment.has(rightIdx))
            snapshot.set(rightIdx, bySegment.get(rightIdx)!)
          vertexDragInitialOpeningsRef.current = {
            wallId: target.wallId,
            pointIndex: target.pointIndex,
            bySegment: snapshot,
          }
        } else {
          vertexDragInitialOpeningsRef.current = null
        }
      } else {
        // Multi-vertex: use the same constraint path as freeform (applyMergedPointMove
        // + constrainVertexMove per vertex). Build merged targets and snapshot all walls.
        const walls = activeFloor.floorPlan.walls
        const mergedByWall = new Map<string, Set<number>>()
        for (const [wid, indices] of indicesByWall.entries()) {
          for (const idx of indices) {
            const merged = buildMergedPointTargets(walls, wid, idx)
            if (merged.length === 0) {
              let set = mergedByWall.get(wid)
              if (!set) {
                set = new Set<number>()
                mergedByWall.set(wid, set)
              }
              set.add(idx)
            } else {
              for (const m of merged) {
                let set = mergedByWall.get(m.wallId)
                if (!set) {
                  set = new Set<number>()
                  mergedByWall.set(m.wallId, set)
                }
                set.add(m.pointIndex)
              }
            }
          }
        }
        const multiTargets: Array<{ wallId: string; pointIndex: number }> = []
        for (const [wid, set] of mergedByWall.entries()) {
          for (const idx of set) {
            multiTargets.push({ wallId: wid, pointIndex: idx })
          }
        }
        pointDragTargetsRef.current = multiTargets
        vertexDragInitialOpeningsRef.current = null

        const firstSelected = singlePointSelections[0]
        if (firstSelected) {
          vertexDragAnchorRef.current = firstSelected
          const initialByWall = new Map<string, Point2[]>()
          for (const w of walls) {
            initialByWall.set(
              w.id,
              w.points.map((p: Point2) => ({ x: p.x, y: p.y }))
            )
          }
          vertexDragInitialPointsRef.current = initialByWall
        } else {
          vertexDragAnchorRef.current = null
          vertexDragInitialPointsRef.current = null
        }
      }
    },
    [
      activeFloor,
      selectedWallIds,
      selectedPointIndices,
      selectedStairPointIndices,
      buildMergedPointTargets,
      baseDoors,
      baseWindows,
    ]
  )

  const commitStairPreviewGeometry = useCallback(
    function () {
      const preview = stairSelectionPreviewRef.current
      if (preview.size === 0) return
      for (const [stairId, newPoints] of preview) {
        const baseStair = activeFloor?.floorPlan?.stairs?.find((s: Stair) => s.id === stairId)
        if (!baseStair || baseStair.points.length !== newPoints.length) continue
        const changed = newPoints.some(
          (p, i) => p.x !== baseStair.points[i]!.x || p.y !== baseStair.points[i]!.y
        )
        if (changed) updateStair(stairId, { points: newPoints })
      }
      stairSelectionPreviewRef.current = new Map()
      applyWallSelectionPreviewTick((t) => t + 1)
    },
    [activeFloor?.floorPlan?.stairs, updateStair]
  )

  const applySelectedStairPointDelta = useCallback(
    (
      initialPointsByStair: Map<string, Point2[]> | null,
      indicesByStair: Map<string, Set<number>> | null,
      dx: number,
      dy: number
    ) => {
      if (!initialPointsByStair || !indicesByStair) return
      const nextPreview = new Map(stairSelectionPreviewRef.current)
      for (const [stairId, originalPoints] of initialPointsByStair.entries()) {
        const indices = indicesByStair.get(stairId)
        if (!indices || indices.size === 0) continue
        nextPreview.set(
          stairId,
          originalPoints.map((point, index) =>
            indices.has(index) ? { x: point.x + dx, y: point.y + dy } : point
          )
        )
      }
      stairSelectionPreviewRef.current = nextPreview
      applyWallSelectionPreviewTick((t) => t + 1)
    },
    []
  )

  const computeStairPointDragPoints = useCallback(
    (
      stairId: string,
      pointIndex: number,
      x: number,
      y: number,
      initialPoints: Point2[],
      selectedIndices: number[],
      shouldMoveSelection: boolean
    ): { points: Point2[]; guides: Array<{ from: Point2; to: Point2 }> } => {
      if (!shouldMoveSelection) {
        const rawTarget = { x, y }
        const excludedKeys = new Set([`s:${stairId}:${pointIndex}`])
        const nearbyLine = resolveNearbyFloorLineSnap(rawTarget, excludedKeys)
        const projected = nearbyLine ? null : resolveProjectedFloorSnap(rawTarget, excludedKeys)
        const snappedTarget =
          nearbyLine?.point ??
          softSnapToGrid(projected?.snappedPoint ?? rawTarget, planView.snapToGrid)
        return {
          points: initialPoints.map((p, idx) => (idx === pointIndex ? snappedTarget : p)),
          guides: projected?.guides ?? [],
        }
      }
      const basePoint = initialPoints[pointIndex]
      if (!basePoint) return { points: initialPoints, guides: [] }
      const rawTarget = { x, y }
      const excludedKeys = new Set(selectedIndices.map((index) => `s:${stairId}:${index}`))
      const nearbyLine = resolveNearbyFloorLineSnap(rawTarget, excludedKeys)
      const projected = nearbyLine ? null : resolveProjectedFloorSnap(rawTarget, excludedKeys)
      const snappedTarget =
        nearbyLine?.point ??
        softSnapToGrid(projected?.snappedPoint ?? rawTarget, planView.snapToGrid)
      const dx = snappedTarget.x - basePoint.x
      const dy = snappedTarget.y - basePoint.y
      return {
        points: initialPoints.map((p, idx) =>
          selectedIndices.includes(idx) ? { x: p.x + dx, y: p.y + dy } : p
        ),
        guides: projected?.guides ?? [],
      }
    },
    [resolveNearbyFloorLineSnap, resolveProjectedFloorSnap, softSnapToGrid, planView.snapToGrid]
  )

  const handleStairPointDragStart = useCallback(
    (stairId: string, pointIndex: number) => {
      const baseStair = activeFloor?.floorPlan?.stairs?.find((s: Stair) => s.id === stairId)
      if (!baseStair) return
      const selectedIndices = selectedStairPointIndices.get(stairId) ?? [pointIndex]
      stairPointDragRef.current = {
        stairId,
        pointIndex,
        initialPoints: baseStair.points.map((p: Point2) => ({ x: p.x, y: p.y })),
        selectedIndices: [...selectedIndices],
      }
    },
    [activeFloor?.floorPlan?.stairs, selectedStairPointIndices]
  )

  const handleStairPointMove = useCallback(
    (stairId: string, pointIndex: number, x: number, y: number) => {
      let drag = stairPointDragRef.current
      if (!drag || drag.stairId !== stairId) {
        handleStairPointDragStart(stairId, pointIndex)
        drag = stairPointDragRef.current
      }
      if (!drag) return

      const selectedIndices = drag.selectedIndices
      const shouldMoveSelection =
        (selection.type === 'stairPoint' || selection.type === 'wallPoint') &&
        selectedIndices.includes(pointIndex) &&
        selectedPointIndices.size === 0
      const { points, guides } = computeStairPointDragPoints(
        stairId,
        pointIndex,
        x,
        y,
        drag.initialPoints,
        selectedIndices,
        shouldMoveSelection
      )
      applyVertexMoveProjectedSnapGuides(guides)
      const nextPreview = new Map(stairSelectionPreviewRef.current)
      nextPreview.set(stairId, points)
      stairSelectionPreviewRef.current = nextPreview
      applyWallSelectionPreviewTick((t) => t + 1)
    },
    [
      computeStairPointDragPoints,
      handleStairPointDragStart,
      selectedPointIndices.size,
      selection.type,
    ]
  )

  const handleStairPointDragEnd = useCallback(
    (stairId: string, pointIndex: number, x: number, y: number) => {
      handleStairPointMove(stairId, pointIndex, x, y)
      applyVertexMoveProjectedSnapGuides([])
      commitStairPreviewGeometry()
      stairPointDragRef.current = null
    },
    [commitStairPreviewGeometry, handleStairPointMove]
  )

  const updateWallSelectionDrag = useCallback(
    (current: Point2) => {
      const {
        start,
        initialPointsByWall,
        indicesByWall,
        initialPointsByStair,
        indicesByStair,
        mode,
        singlePointTarget,
        isWholeShapeMove,
      } = wallSelectionDragRef.current
      if (!start || !initialPointsByWall || !indicesByWall) return

      const now =
        typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
      const isSinglePoint = singlePointTarget != null
      // Single-point (blue handle) path: no throttle so bounds stay at clamped position and don't flicker.
      if (!isSinglePoint && now - lastWallSelectionUpdateTimeRef.current < 16) return
      if (!isSinglePoint) lastWallSelectionUpdateTimeRef.current = now
      let dx = current.x - start.x
      let dy = current.y - start.y
      if (mode === 'horizontal') {
        dy = 0
      } else if (mode === 'vertical') {
        dx = 0
      }
      if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return

      // Compute a uniform snapped delta for the whole selection so shapes stay rigid.
      // Use the first selected point across all walls as the snap anchor.
      let anchorInitial: Point2 | null = null
      outer: for (const [wallId, originalPoints] of initialPointsByWall.entries()) {
        const indices = indicesByWall.get(wallId)
        if (!indices || !indices.size) continue
        for (const idx of indices) {
          const p = originalPoints[idx]
          if (p) {
            anchorInitial = p
            break outer
          }
        }
      }
      if (!anchorInitial && initialPointsByStair && indicesByStair) {
        outerStair: for (const [stairId, originalPoints] of initialPointsByStair.entries()) {
          const indices = indicesByStair.get(stairId)
          if (!indices || !indices.size) continue
          for (const idx of indices) {
            const p = originalPoints[idx]
            if (p) {
              anchorInitial = p
              break outerStair
            }
          }
        }
      }

      let snappedDx = dx
      let snappedDy = dy
      const movementAxis = mode === 'horizontal' ? 'x' : mode === 'vertical' ? 'y' : undefined
      if (anchorInitial) {
        const movedAnchor = { x: anchorInitial.x + dx, y: anchorInitial.y + dy }
        const excludedLineKeys = new Set<string>()
        for (const [wallId, indices] of indicesByWall) {
          for (const index of indices) excludedLineKeys.add(`w:${wallId}:${index}`)
        }
        if (indicesByStair) {
          for (const [stairId, indices] of indicesByStair) {
            for (const index of indices) excludedLineKeys.add(`s:${stairId}:${index}`)
          }
        }
        const nearbyLine = resolveNearbyFloorLineSnap(movedAnchor, excludedLineKeys, movementAxis)
        const snappedAnchor =
          nearbyLine?.point ?? softSnapToGrid(movedAnchor, planView.snapToGrid, movementAxis)
        snappedDx = snappedAnchor.x - anchorInitial.x
        snappedDy = snappedAnchor.y - anchorInitial.y
      }

      // Use vertex path (constraints) when a single vertex is dragged, or when multiple vertices are
      // dragged but not all points are selected (partial selection deforms the shape → constraints must apply).
      // Only use rigid delta path when every affected wall has all points selected (whole-shape move).
      const useVertexPath =
        pointDragTargetsRef.current.length > 0 &&
        anchorInitial != null &&
        (singlePointTarget != null || !isWholeShapeMove)

      if (activeFloor?.floorPlan && useVertexPath) {
        const anchor = anchorInitial!
        const targetPos = {
          x: anchor.x + snappedDx,
          y: anchor.y + snappedDy,
        }
        wallSelectionDragRef.current.singlePointCurrentPos = targetPos
        applyMergedPointMove(activeFloor.floorPlan.walls, targetPos, false, 'preview', movementAxis)
        applySelectedStairPointDelta(initialPointsByStair, indicesByStair, snappedDx, snappedDy)
        return
      }

      const nextPreview = new Map(wallSelectionPreviewRef.current)
      for (const [wallId, originalPoints] of initialPointsByWall.entries()) {
        const indices = indicesByWall.get(wallId)
        if (!indices || !indices.size) continue
        const nextPoints = originalPoints.map((p, idx) => {
          if (!indices.has(idx)) return p
          return {
            x: p.x + snappedDx,
            y: p.y + snappedDy,
          }
        })
        nextPreview.set(wallId, nextPoints)
      }
      wallSelectionPreviewRef.current = nextPreview
      applySelectedStairPointDelta(initialPointsByStair, indicesByStair, snappedDx, snappedDy)
      applyWallSelectionPreviewTick((t) => t + 1)
    },
    [
      planView.snapToGrid,
      activeFloor,
      applyMergedPointMove,
      applySelectedStairPointDelta,
      resolveNearbyFloorLineSnap,
      softSnapToGrid,
    ]
  )

  const endWallSelectionDrag = useCallback(
    function () {
      const { singlePointCurrentPos, mode } = wallSelectionDragRef.current
      if (
        pointDragTargetsRef.current.length > 0 &&
        singlePointCurrentPos &&
        activeFloor?.floorPlan
      ) {
        const movementAxis = mode === 'horizontal' ? 'x' : mode === 'vertical' ? 'y' : undefined
        applyMergedPointMove(
          activeFloor.floorPlan.walls,
          singlePointCurrentPos,
          true,
          'commit',
          movementAxis
        )
        pointDragTargetsRef.current = []
        vertexDragInitialOpeningsRef.current = null
        vertexDragAnchorRef.current = null
        vertexDragInitialPointsRef.current = null
        applyPreviewWalls(null)
        applyPreviewDoors(null)
        applyPreviewWindows(null)
        applyVertexMoveProjectedSnapGuides([])
        wallSelectionPreviewRef.current = new Map()
        applyWallSelectionPreviewTick((t) => t + 1)
        commitStairPreviewGeometry()
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
        lastWallSelectionUpdateTimeRef.current = 0
        return
      }

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
      // Commit preview geometry (delta path: whole-shape move only).
      if (wallSelectionPreviewRef.current.size > 0 && activeFloor?.floorPlan) {
        const floorPlan = activeFloor.floorPlan
        wallSelectionPreviewRef.current.forEach((newPoints, wallId) => {
          const wall = floorPlan.walls.find((w: Wall) => w.id === wallId)
          if (!wall || wall.points.length !== newPoints.length) return
          const oldPoints = wall.points
          if (isRigidTranslation(oldPoints, newPoints)) {
            updateWall(wallId, { points: newPoints })
          } else {
            const wallDoors = floorPlan.doors.filter((d: Door) => d.wallId === wallId)
            const wallWindows = floorPlan.windows.filter((w: Window) => w.wallId === wallId)
            const preserved = preserveOpeningPositionsAfterPointChange(
              oldPoints,
              newPoints,
              wallDoors,
              wallWindows
            )
            // Apply preserved positions to temp copies, then sanitize so openings fit (no overlap, no out-of-bounds).
            const doorsWithPreserved = wallDoors.map((d: Door) => {
              const u = preserved.doorUpdates.find((x) => x.id === d.id)
              return u ? { ...d, position: u.position } : d
            })
            const windowsWithPreserved = wallWindows.map((w: Window) => {
              const u = preserved.windowUpdates.find((x) => x.id === w.id)
              return u ? { ...w, position: u.position } : w
            })
            const sanitized = sanitizeWallOpeningPositions(
              newPoints,
              doorsWithPreserved,
              windowsWithPreserved
            )
            // Use sanitized where it adjusted, otherwise preserved (so all openings get a final position).
            const doorUpdates = preserved.doorUpdates.map((u) => {
              const s = sanitized.doorUpdates.find((x) => x.id === u.id)
              return { id: u.id, position: s?.position ?? u.position }
            })
            const windowUpdates = preserved.windowUpdates.map((u) => {
              const s = sanitized.windowUpdates.find((x) => x.id === u.id)
              return { id: u.id, position: s?.position ?? u.position }
            })
            updateWall(wallId, { points: newPoints, doorUpdates, windowUpdates })
          }
        })
        wallSelectionPreviewRef.current = new Map()
        applyWallSelectionPreviewTick((t) => t + 1)
        pointDragTargetsRef.current = []
        vertexDragInitialOpeningsRef.current = null
        vertexDragAnchorRef.current = null
        vertexDragInitialPointsRef.current = null
      }
      commitStairPreviewGeometry()
      applyVertexMoveProjectedSnapGuides([])
      lastWallSelectionUpdateTimeRef.current = 0
    },
    [updateWall, activeFloor, applyMergedPointMove, commitStairPreviewGeometry]
  )

  const { placements, visiblePlacements } = usePlanPlacements(
    activeFloorId,
    sitplanPanelFilterId,
    planVisibility
  )
  const visiblePlanPlacementIds = useMemo(
    () => new Set(visiblePlacements.map((placement: Placement) => placement.id)),
    [visiblePlacements]
  )
  const visiblePlanEndpointIds = useMemo(
    () =>
      new Set(
        visiblePlacements.flatMap((placement) => {
          const row = placement as Placement & { endpointId?: string }
          return row.endpointId ? [row.endpointId] : []
        })
      ),
    [visiblePlacements]
  )
  const visiblePlanTrunkDeviceIds = useMemo(
    () =>
      new Set(
        visiblePlacements.flatMap((placement) => {
          const row = placement as Placement & { trunkDeviceId?: string }
          return row.trunkDeviceId ? [row.trunkDeviceId] : []
        })
      ),
    [visiblePlacements]
  )
  const previousPlanWireRoutesRef = useRef<PlanWireRoute[]>([])
  // Cables hovered in the cable list show on the plan, like the selected one.
  const hoveredCableAnchors = useCableHoverStore((s) => s.anchors)
  const planWireRoutes = useMemo(
    function () {
      const wiringMode = activeTool === 'wiring'
      let includeKinds = planWireKindsForVisibility(planWiringVisibility)
      // Wire mode shows every cable, colour-coded, so it can be edited.
      if (isCableRoutesEnabled() && wiringMode) {
        includeKinds = ['lighting-control', 'sockets', 'other']
      }
      // Edited supply and earthing cables keep their own toggle, like their automatic traces.
      const cableInfo =
        isCableRoutesEnabled() && currentProject ? cableTraceInfoByAnchor(currentProject) : null
      const mergedRoutesFor = (kinds: PlanWireKind[]) =>
        kinds.length === 0
          ? []
          : mergePlanWireRoutes(
              deriveAutoPlanWireRoutes(currentProject, activeFloorId, kinds),
              planWiring?.routes.filter(
                (route: PlanWireRoute) =>
                  route.floorId === activeFloorId &&
                  (kinds.includes(route.kind) ||
                    (cableInfo !== null && hasOwnCableToggle(route, cableInfo)))
              )
            )
      let routes = mergedRoutesFor(includeKinds)
      // The selected cable always shows, even when its kind of wire is hidden.
      if (isCableRoutesEnabled()) {
        if (!wiringMode && currentProject) {
          const info = cableTraceInfoByAnchor(currentProject)
          routes = routes.filter((route) => isCableTraceShown(route, info, planWiringVisibility))
        }
        const shown = new Set(routes.map((route) => route.id))
        const selected = mergedRoutesFor(['lighting-control', 'sockets', 'other']).filter(
          (route) =>
            !shown.has(route.id) &&
            (planWireRouteMatchesSelection(route, selection) ||
              (route.wireAnchor != null && hoveredCableAnchors.has(route.wireAnchor)))
        )
        if (selected.length > 0) routes = [...routes, ...selected]
      }
      if (routes.length === 0) return []
      const panelFilteredRoutes = sitplanPanelFilterId
        ? filterPlanWireRoutesForPanel(routes, sitplanPanelFilterId, {
            allowedPlacementIds: new Set<string>(
              placements.map((placement: Placement) => placement.id)
            ),
            project: currentProject,
          })
        : routes
      const visibleRoutes = filterPlanWireRoutesForSymbolVisibility(panelFilteredRoutes, {
        visiblePlacementIds: visiblePlanPlacementIds,
        visibleEndpointIds: visiblePlanEndpointIds,
        visibleTrunkDeviceIds: visiblePlanTrunkDeviceIds,
      })
      const stableRoutes = reusePlanWireRoutes(previousPlanWireRoutesRef.current, visibleRoutes)
      previousPlanWireRoutesRef.current = stableRoutes
      return stableRoutes
    },
    [
      activeFloorId,
      activeTool,
      currentProject,
      
      planWiring,
      planWiringVisibility,
      selection,
      sitplanPanelFilterId,
      placements,
      visiblePlanEndpointIds,
      visiblePlanPlacementIds,
      visiblePlanTrunkDeviceIds,
    ]
  )
  // Junction panels, earth electrodes and supply enclosures sit on the plan through their own
  // placements, not device placements; wires end on them by placement id.
  const junctionPanelPlanPlacements = useMemo(() => {
    const installation = currentProject
      ? selectProjectElectricalInstallation(currentProject)
      : undefined
    const entry = (
      placement: Pick<Placement, 'id' | 'floorId' | 'pos'> &
        Partial<Pick<Placement, 'layer' | 'rotationDeg' | 'scale'>>,
      nodeType: string
    ): [string, PlanWireEndPlacement] => [
      placement.id,
      {
        id: placement.id,
        floorId: placement.floorId,
        layer: placement.layer ?? 'default',
        pos: placement.pos,
        rotationDeg: (placement.rotationDeg ?? 0) as Placement['rotationDeg'],
        scale: placement.scale ?? 1,
        nodeType,
      },
    ]
    return new Map<string, PlanWireEndPlacement>([
      ...(installation?.junctionPanelPlacements ?? []).map((placement) =>
        entry(placement, 'junction_panel')
      ),
      ...(installation?.earthingPlacements ?? []).map((placement) => entry(placement, 'earthing')),
      ...(currentProject ? selectProjectAuxiliaryElectricalEnclosures(currentProject) : []).flatMap(
        (enclosure) =>
          (enclosure.placements ?? []).map((placement) => entry(placement, 'panel_distribution'))
      ),
    ])
  }, [currentProject])
  // Wire mode always colours wires by group; the plan does too when chosen in its settings.
  const planWiresColorCoded =
    isCableRoutesEnabled() && (activeTool === 'wiring' || planWiringVisibility.colorCoded === true)
  const planWireStrokeFor = useMemo(() => {
    if (planWiresColorCoded && currentProject) {
      const info = cableTraceInfoByAnchor(currentProject)
      const byCircuit = cableCategoryByCircuit(currentProject)
      return (route: PlanWireRoute) => cableTraceColor(route, info, byCircuit)
    }
    return undefined
  }, [currentProject, planWiresColorCoded])
  // Shared by the wire layer and the raised floor-passage handles of the selected cable.
  const [planWireRiserPreview, applyPlanWireRiserPreview] =
    useState<PlanWireRiserPreview | null>(null)
  const hoveredPlanWireRouteIds = useMemo(() => {
    const ids = new Set<string>()
    for (const route of planWireRoutes) {
      if (route.wireAnchor && hoveredCableAnchors.has(route.wireAnchor)) ids.add(route.id)
    }
    return ids
  }, [planWireRoutes, hoveredCableAnchors])
  const highlightedPlanWireRouteIds = useMemo(() => {
    const ids = new Set<string>()
    if (isCableRoutesEnabled()) {
      for (const route of planWireRoutes) {
        if (planWireRouteMatchesSelection(route, selection)) ids.add(route.id)
      }
    }
    return ids
  }, [planWireRoutes, selection])
  // Floor passages picked with a drag rectangle in wire mode (symbols are not selectable there).
  const [selectedRiserRouteIds, applySelectedRiserRouteIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  useEffect(() => {
    if (activeTool !== 'wiring') applySelectedRiserRouteIds(new Set())
  }, [activeTool, activeFloorId])
  // The selected cable's and the selected passages' handles sit above the symbols.
  const raisedRiserRouteIds = useMemo(
    () => new Set([...highlightedPlanWireRouteIds, ...selectedRiserRouteIds]),
    [highlightedPlanWireRouteIds, selectedRiserRouteIds]
  )
  const raisedRiserRoutes = useMemo(
    () =>
      planWireRoutes.filter(
        (route: PlanWireRoute) =>
          raisedRiserRouteIds.has(route.id) && (route.riser || route.riserExit)
      ),
    [planWireRoutes, raisedRiserRouteIds]
  )
  const handleCaptureRectangle = useCallback(
    (
      rect: { x: number; y: number; width: number; height: number },
      modifiers: { shiftKey: boolean; altKey: boolean }
    ): boolean => {
      if (activeTool !== 'wiring') return false
      // A click on empty plan clears the passages; the app selection clears as usual.
      if (rect.width <= 5 || rect.height <= 5) {
        applySelectedRiserRouteIds(new Set())
        return false
      }
      const inside = planWireRiserRouteIdsInRect(planWireRoutes, rect)
      applySelectedRiserRouteIds((current) => {
        if (modifiers.altKey) return new Set([...current].filter((id) => !inside.includes(id)))
        if (modifiers.shiftKey) return new Set([...current, ...inside])
        return new Set(inside)
      })
      return true
    },
    [activeTool, planWireRoutes]
  )
  const planWireRoutablePlacementIds = useMemo(
    function () {
      const ids = new Set<string>()
      for (const route of planWireRoutes) {
        if (route.from.placementId) ids.add(route.from.placementId)
        if (route.to.placementId) ids.add(route.to.placementId)
      }
      return ids
    },
    [planWireRoutes]
  )
  const getPlanWireTargetStatus = useCallback(
    (targetPlacementId: string): 'legal' | 'illegal' | null => {
      if (!activeFloorId || !currentProject) return null
      const sourcePlacementId = planWireDragSourcePlacementId
      if (!sourcePlacementId) {
        if (planWireRoutablePlacementIds.has(targetPlacementId)) return 'legal'
        const placement = visiblePlacements.find(
          (candidate: Placement & { endpointId?: string; trunkDeviceId?: string }) =>
            candidate.id === targetPlacementId
        )
        if (placement?.trunkDeviceId) return 'legal'
        const endpoint = placement?.endpointId ? getEndpointById(placement.endpointId) : null
        return endpointCanStartPlanWire(endpoint) ? 'legal' : 'illegal'
      }
      if (sourcePlacementId === targetPlacementId) return 'illegal'
      return (buildManualOtherPlanWireRoute(
        currentProject,
        activeFloorId,
        sourcePlacementId,
        targetPlacementId
      ) ??
        buildManualPlanWireRoutesForPlacementMove(
          currentProject,
          activeFloorId,
          sourcePlacementId,
          targetPlacementId
        ))
        ? 'legal'
        : 'illegal'
    },
    [
      activeFloorId,
      currentProject,
      getEndpointById,
      planWireDragSourcePlacementId,
      planWireRoutablePlacementIds,
      visiblePlacements,
    ]
  )
  const {
    insertPlanWireWaypoint: handleInsertPlanWireWaypoint,
    movePlanWireWaypoint: handleMovePlanWireWaypoint,
    movePlanWireRiser: handleMovePlanWireRiser,
    movePlanWireRisers: handleMovePlanWireRisers,
    removePlanWireWaypoint: handleRemovePlanWireWaypoint,
    drawPlanWire: handleDrawPlanWire,
    removeManualOtherPlanWiresFromOrigin,
    hideSocketWireRouteForPlacementDrop,
  } = usePlanWireEditing({ activeFloorId, currentProject })
  useEffect(
    function () {
      if (activeTool !== 'wiring') return
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return
        if (isKeyboardTypingTarget(event.target)) return
        event.preventDefault()
        applyActiveTool('none')
      }
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    },
    [activeTool, applyActiveTool]
  )
  useEffect(
    function () {
      const canCancelWithShortcut =
        activeTool === 'wiring' || activeTool === 'move' || activeTool === 'resetScale'
      if (!canCancelWithShortcut) return
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return
        if (isKeyboardTypingTarget(event.target)) return
        event.preventDefault()
        if (activeTool === 'resetScale' && isResettingScale) {
          handleScaleRulerCancel()
          return
        }
        applyActiveTool('none')
      }
      const handleContextMenu = (event: MouseEvent) => {
        if (event.button !== 2) return
        const target = event.target
        if (target instanceof Element && target.closest('[data-floor-selection-row]')) return
        const insidePlan = target instanceof Node && !!containerRef.current?.contains(target)
        if (!insidePlan) return
        event.preventDefault()
        event.stopPropagation()
        if (activeTool === 'resetScale' && isResettingScale) {
          handleScaleRulerCancel()
          return
        }
        applyActiveTool('none')
      }
      window.addEventListener('keydown', handleKeyDown)
      window.addEventListener('contextmenu', handleContextMenu, true)
      return () => {
        window.removeEventListener('keydown', handleKeyDown)
        window.removeEventListener('contextmenu', handleContextMenu, true)
      }
    },
    [activeTool, applyActiveTool, handleScaleRulerCancel, isResettingScale]
  )
  useEffect(
    function () {
      if (activeTool !== 'wiring') {
        if (planWireDragSourcePlacementId !== null) {
          applyPlanWireDragSourcePlacementId(null)
        }
        if (planWireHoverPlacementId !== null) {
          applyPlanWireHoverPlacementId(null)
        }
        if (planWirePreviewPoint !== null) {
          applyPlanWirePreviewPoint(null)
        }
        return
      }
      const handlePointerMove = (event: PointerEvent) => {
        if (!planWireDragSourcePlacementId) return
        const point = clientToPlan(event.clientX, event.clientY)
        if (point) applyPlanWirePreviewPoint(point)
      }
      const handlePointerUp = () => {
        const sourcePlacementId = planWireDragSourcePlacementId
        if (sourcePlacementId && !planWireHoverPlacementId && currentProject && activeFloorId) {
          const sourcePlacement = visiblePlacements.find(
            (placement: Placement & { endpointId?: string }) => placement.id === sourcePlacementId
          )
          const endpoint = sourcePlacement?.endpointId
            ? getEndpointById(sourcePlacement.endpointId)
            : null
          if (
            !removeManualOtherPlanWiresFromOrigin(sourcePlacementId) &&
            endpoint?.type === 'socket'
          ) {
            hideSocketWireRouteForPlacementDrop(sourcePlacementId)
          }
        }
        applyPlanWireDragSourcePlacementId(null)
        applyPlanWireHoverPlacementId(null)
        applyPlanWirePreviewPoint(null)
      }
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
      return () => {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
      }
    },
    [
      activeFloorId,
      activeTool,
      applyPlanWireDragSourcePlacementId,
      applyPlanWireHoverPlacementId,
      applyPlanWirePreviewPoint,
      clientToPlan,
      currentProject,
      getEndpointById,
      hideSocketWireRouteForPlacementDrop,
      removeManualOtherPlanWiresFromOrigin,
      planWireDragSourcePlacementId,
      planWireHoverPlacementId,
      planWirePreviewPoint,
      visiblePlacements,
    ]
  )
  const quickPlacerCircuits = useMemo(
    () => buildQuickPlacerCircuits(currentProject, getCircuitIdentifier),
    [currentProject, getCircuitIdentifier]
  )
  const selectedQuickPlacerCircuit =
    quickPlacerCircuits.find((circuit) => circuit.id === quickPlacerSelectedCircuitId) ??
    quickPlacerCircuits[0] ??
    null
  const quickPlacerSequence = useMemo(
    () =>
      flattenQuickPlacerCircuit(selectedQuickPlacerCircuit, {
        autoSkipCustom: quickPlacerFastAutoSkipCustom,
      }),
    [selectedQuickPlacerCircuit, quickPlacerFastAutoSkipCustom]
  )
  const currentQuickPlacerFastItem =
    quickPlacerMode === 'fast' && quickPlacerSequence.length > 0
      ? (quickPlacerSequence[Math.min(quickPlacerFastIndex, quickPlacerSequence.length - 1)] ??
        null)
      : null
  const quickPlacerFastPreviewPos = useMemo(
    function () {
      if (quickPlacerMode !== 'fast' || !quickPlacerFastPreviewClient) return null
      const raw = clientToPlan(quickPlacerFastPreviewClient.x, quickPlacerFastPreviewClient.y)
      return raw ? snapPlacementPosition(raw) : null
    },
    [quickPlacerMode, quickPlacerFastPreviewClient, clientToPlan, snapPlacementPosition]
  )
  const quickPlacerFastPreviewPlacement = useMemo(
    function () {
      if (!currentQuickPlacerFastItem || !quickPlacerFastPreviewPos) return null
      return {
        ...currentQuickPlacerFastItem.placement,
        id: `quick-placer-preview-${currentQuickPlacerFastItem.placement.id}`,
        endpointId: currentQuickPlacerFastItem.endpoint.id,
        floorId: activeFloorId ?? currentQuickPlacerFastItem.placement.floorId,
        pos: quickPlacerFastPreviewPos,
      }
    },
    [activeFloorId, currentQuickPlacerFastItem, quickPlacerFastPreviewPos]
  )
  const quickPlacerFastPreviewLabelPosition = useMemo(
    function () {
      if (!quickPlacerFastPreviewPlacement || !currentQuickPlacerFastItem?.endpoint?.label)
        return undefined
      return calculateLabelPositions(
        [
          quickPlacerFastPreviewPlacement as Placement & {
            endpointId?: string
            junctionPanelLabel?: string
          },
        ],
        getEndpointById,
        null,
        baseSymbolSizePx,
        fontFamily
      ).get(quickPlacerFastPreviewPlacement.id)
    },
    [
      quickPlacerFastPreviewPlacement,
      currentQuickPlacerFastItem?.endpoint?.label,
      getEndpointById,
      baseSymbolSizePx,
      fontFamily,
    ]
  )
  const { planImage, planImagePosition, setPlanImagePosition } = usePlanImage(
    activeFloor ?? null,
    canvasRef
  )
  const planImageDisplayWidth = activeFloor?.planImportAsset?.width ?? planImage?.width ?? 0
  const planImageDisplayHeight = activeFloor?.planImportAsset?.height ?? planImage?.height ?? 0
  const planImageRotationDeg = normalizePlanImageRotationDeg(activeFloor?.planImageRotationDeg)
  // Pixel-based wall sampling assumes an unrotated image; rotated plans fall back to vector walls.
  const planImageForAnalysis = planImageRotationDeg ? null : planImage
  const pendingFloorViewportAutoFitRef = useRef<string | null>(null)

  // On floor switch, keep current zoom/pan only if the new floor still has visible content in view.
  // If the viewport lands on "empty space" for that floor, auto-fit once to reorient the user.
  useEffect(
    function () {
      pendingFloorViewportAutoFitRef.current = activeFloorId
    },
    [activeFloorId]
  )

  useEffect(
    function () {
      const pendingFloorId = pendingFloorViewportAutoFitRef.current
      if (!activeFloorId || pendingFloorId !== activeFloorId || !activeFloor) return

      const viewportWidth = planCanvasViewportPx?.width ?? containerRef.current?.clientWidth ?? 0
      const viewportHeight = planCanvasViewportPx?.height ?? containerRef.current?.clientHeight ?? 0
      const { planView: currentPlanView } = useUIStore.getState()
      if (
        viewportWidth <= 0 ||
        viewportHeight <= 0 ||
        !Number.isFinite(currentPlanView.zoom) ||
        currentPlanView.zoom <= 0
      )
        return

      if (planVisibility.groundPlansVisible) {
        const hasImageAsset = !!(activeFloor.planAsset || activeFloor.planImportAsset)
        if (hasImageAsset && !planImage) return
      }

      let contentBounds: ContentBounds | null = null

      if (planVisibility.groundPlansVisible && planImage) {
        contentBounds = includeRectInBounds(
          contentBounds,
          getPlanImageSceneBounds(
            planImagePosition,
            planImageDisplayWidth,
            planImageDisplayHeight,
            planImageRotationDeg
          )
        )
      }

      for (const wall of baseWalls) {
        for (const p of wall.points) {
          contentBounds = includePointInBounds(contentBounds, p.x, p.y)
        }
      }

      for (const stair of stairsForRender) {
        const bounds = getStairBounds(stair)
        if (!bounds) continue
        contentBounds = includeRectInBounds(contentBounds, {
          left: bounds.x,
          top: bounds.y,
          right: bounds.x + bounds.width,
          bottom: bounds.y + bounds.height,
        })
      }

      for (const placement of visiblePlacements) {
        if (placement.isEarthing) {
          const b = getPlacementWorldBounds(
            placement.pos,
            placement.rotationDeg,
            placement.scale,
            1,
            'earthing',
            baseSymbolSizePx
          )
          contentBounds = includeRectInBounds(contentBounds, b)
          continue
        }
        if (placement.junctionPanelLabel != null) {
          const b = getPlacementWorldBounds(
            placement.pos,
            placement.rotationDeg,
            placement.scale,
            1,
            'junction_panel',
            baseSymbolSizePx
          )
          contentBounds = includeRectInBounds(contentBounds, b)
          continue
        }
        const endpoint = placement.endpointId ? getEndpointById(placement.endpointId) : undefined
        if (!endpoint) continue
        const socketCount =
          (endpoint.type === 'socket' ? endpoint.socketProps?.socketCount : undefined) || 1
        const b = getPlacementWorldBounds(
          placement.pos,
          placement.rotationDeg,
          placement.scale,
          socketCount,
          endpoint.symbol,
          baseSymbolSizePx
        )
        contentBounds = includeRectInBounds(contentBounds, b)
      }

      const floorNotes = sitplanNotes.filter((note: Note) => note.floorId === activeFloorId)
      for (const note of floorNotes) {
        contentBounds = includePointInBounds(contentBounds, note.pos.x, note.pos.y)
      }

      if (!contentBounds) {
        pendingFloorViewportAutoFitRef.current = null
        return
      }

      const viewLeft = Math.min(
        -currentPlanView.pan.x / currentPlanView.zoom,
        (viewportWidth - currentPlanView.pan.x) / currentPlanView.zoom
      )
      const viewRight = Math.max(
        -currentPlanView.pan.x / currentPlanView.zoom,
        (viewportWidth - currentPlanView.pan.x) / currentPlanView.zoom
      )
      const viewTop = Math.min(
        -currentPlanView.pan.y / currentPlanView.zoom,
        (viewportHeight - currentPlanView.pan.y) / currentPlanView.zoom
      )
      const viewBottom = Math.max(
        -currentPlanView.pan.y / currentPlanView.zoom,
        (viewportHeight - currentPlanView.pan.y) / currentPlanView.zoom
      )

      const overlapWidth = Math.max(
        0,
        Math.min(contentBounds.maxX, viewRight) - Math.max(contentBounds.minX, viewLeft)
      )
      const overlapHeight = Math.max(
        0,
        Math.min(contentBounds.maxY, viewBottom) - Math.max(contentBounds.minY, viewTop)
      )
      const overlapScreenArea =
        overlapWidth * overlapHeight * currentPlanView.zoom * currentPlanView.zoom
      const hasVisibleReference = overlapScreenArea > 64

      pendingFloorViewportAutoFitRef.current = null
      if (!hasVisibleReference) {
        requestAnimationFrame(() => requestFitToView(['plan']))
      }
    },
    [
      activeFloorId,
      activeFloor,
      baseWalls,
      stairsForRender,
      visiblePlacements,
      currentProject,
      planVisibility.groundPlansVisible,
      planImage,
      planImageDisplayWidth,
      planImageDisplayHeight,
      planImagePosition,
      planImageRotationDeg,
      planCanvasViewportPx,
      sitplanNotes,
      baseSymbolSizePx,
      getEndpointById,
      requestFitToView,
    ]
  )

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

  const handleBeforeFloorSwitch = useCallback(
    (floorId: string): boolean => {
      if (!isDraggingRef.current || floorId === activeFloorId) return true
      const cursorClient = lastPlanPointerClientRef.current
      if (!cursorClient) return false

      const positions = moveActiveDragToFloor(floorId)
      if (!positions) return false
      if (positions.size === 0) return true

      crossFloorDragSessionRef.current = {
        floorId,
        clientOffsets: captureCrossFloorDragClientOffsets(positions, cursorClient, planToClient),
        lastPositions: new Map(positions),
      }
      return true
    },
    [activeFloorId, isDraggingRef, moveActiveDragToFloor, planToClient]
  )

  const updateCrossFloorDragFromClient = useCallback(
    (cursorClient: ClientPoint): Map<string, Point> | null => {
      const session = crossFloorDragSessionRef.current
      const uiState = useUIStore.getState()
      if (!session || session.floorId !== uiState.activeFloorId) return null
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return null
      const positions = resolveCrossFloorDragPositions(
        session.clientOffsets,
        cursorClient,
        (clientX, clientY) => ({
          x: (clientX - rect.left - uiState.planView.pan.x) / uiState.planView.zoom,
          y: (clientY - rect.top - uiState.planView.pan.y) / uiState.planView.zoom,
        }),
        snapPlacementPosition
      )
      if (!positions) return null
      session.lastPositions = positions
      updateCrossFloorDragPreview(positions)
      return positions
    },
    [snapPlacementPosition, updateCrossFloorDragPreview]
  )

  useEffect(
    function continueDragAcrossFloorAndViewportChanges() {
      const session = crossFloorDragSessionRef.current
      const cursorClient = lastPlanPointerClientRef.current
      if (!session || !cursorClient || session.floorId !== activeFloorId) return
      updateCrossFloorDragFromClient(cursorClient)
    },
    [activeFloorId, planView.pan.x, planView.pan.y, planView.zoom, updateCrossFloorDragFromClient]
  )

  useEffect(
    function trackAndFinishCrossFloorDrag() {
      const rememberPointer = (event: PointerEvent) => {
        const cursorClient = { x: event.clientX, y: event.clientY }
        lastPlanPointerClientRef.current = cursorClient
        if (crossFloorDragSessionRef.current) {
          updateCrossFloorDragFromClient(cursorClient)
        }
      }
      const finishPointerDrag = (event: PointerEvent) => {
        const session = crossFloorDragSessionRef.current
        if (!session) return
        const cursorClient = { x: event.clientX, y: event.clientY }
        lastPlanPointerClientRef.current = cursorClient
        const positions = updateCrossFloorDragFromClient(cursorClient) ?? session.lastPositions
        crossFloorDragSessionRef.current = null

        // Let the now-cancelled Konva drag-end event run while the continuation guard is still
        // active, then make the pointer-driven positions authoritative.
        queueMicrotask(() => {
          useProjectStore.getState().movePlanPlacementsToFloor(
            Array.from(positions, ([id, pos]) => ({ id, pos })),
            session.floorId
          )
          finishCrossFloorDrag()
        })
      }

      window.addEventListener('pointerdown', rememberPointer, true)
      window.addEventListener('pointermove', rememberPointer, true)
      window.addEventListener('pointerup', finishPointerDrag, true)
      window.addEventListener('pointercancel', finishPointerDrag, true)
      return () => {
        window.removeEventListener('pointerdown', rememberPointer, true)
        window.removeEventListener('pointermove', rememberPointer, true)
        window.removeEventListener('pointerup', finishPointerDrag, true)
        window.removeEventListener('pointercancel', finishPointerDrag, true)
      }
    },
    [finishCrossFloorDrag, updateCrossFloorDragFromClient]
  )

  const planDragPositions = usePlanDragPositionsMap()
  const planWirePreview = useMemo(
    function () {
      if (!planWireDragSourcePlacementId) return null
      const sourcePlacement = visiblePlacements.find(
        (placement: Placement) => placement.id === planWireDragSourcePlacementId
      )
      if (!sourcePlacement) return null
      const source = planDragPositions.get(sourcePlacement.id) ?? sourcePlacement.pos
      const hoveredPlacement =
        planWireHoverPlacementId &&
        getPlanWireTargetStatus(planWireHoverPlacementId) === 'legal' &&
        planWireHoverPlacementId !== planWireDragSourcePlacementId
          ? visiblePlacements.find(
              (placement: Placement) => placement.id === planWireHoverPlacementId
            )
          : null
      const end =
        hoveredPlacement != null
          ? (planDragPositions.get(hoveredPlacement.id) ?? hoveredPlacement.pos)
          : planWirePreviewPoint
      if (!end) return null
      const dx = end.x - source.x
      const dy = end.y - source.y
      const previewDistance = Math.hypot(dx, dy)
      if (previewDistance <= 1e-6) return null
      const stroke =
        hoveredPlacement || !planWireHoverPlacementId ? planWireActiveStroke(theme.mode) : '#ef4444'
      if (planWiringVisibility.defaultStyle === 'spline') {
        const handle = Math.min(previewDistance * 0.44, 180)
        const horizontal = Math.abs(dx) >= Math.abs(dy)
        const dir = horizontal ? (dx >= 0 ? 1 : -1) : dy >= 0 ? 1 : -1
        const controlA = horizontal
          ? { x: source.x + dir * handle, y: source.y }
          : { x: source.x, y: source.y + dir * handle }
        const controlB = horizontal
          ? { x: end.x - dir * handle, y: end.y }
          : { x: end.x, y: end.y - dir * handle }
        const incoming = planWireSplineIncomingAtEnd(end, controlB)
        return {
          stroke,
          path: `M ${source.x} ${source.y} C ${controlA.x} ${controlA.y} ${controlB.x} ${controlB.y} ${end.x} ${end.y}`,
          points: null,
          arrowHead: incoming != null ? buildPlanWireVArrowHead(end, incoming) : null,
        }
      }
      const elbow =
        Math.abs(dy) >= Math.abs(dx) ? { x: source.x, y: end.y } : { x: end.x, y: source.y }
      const incoming = planWireIncomingAtEnd(end, elbow)
      return {
        stroke,
        path: null,
        points: [source.x, source.y, elbow.x, elbow.y, end.x, end.y],
        arrowHead: incoming != null ? buildPlanWireVArrowHead(end, incoming) : null,
      }
    },
    [
      getPlanWireTargetStatus,
      planWiringVisibility.defaultStyle,
      planWireDragSourcePlacementId,
      planWireHoverPlacementId,
      planWirePreviewPoint,
      planDragPositions,
      theme,
      visiblePlacements,
    ]
  )

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
    !isFloorPlanMode,
    planLabelWallCollision,
    planLabelWireCollision
  )

  // Create drag handlers with latest label positions
  const multiSelectHandlers = useMemo(
    () => createMultiSelectDragHandlers(labelPositions, baseSymbolSizePx),
    [createMultiSelectDragHandlers, labelPositions, baseSymbolSizePx]
  )
  const latestMultiSelectHandlersRef = useRef(multiSelectHandlers)
  latestMultiSelectHandlersRef.current = multiSelectHandlers
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
      planImage,
      planImagePosition,
    ]
  )
  const selectionFrameDragHandlers = createSelectionFrameDragHandlers(labelPositions)

  // Note: Panel selection sync is handled in PlacementSymbol component
  // When a panel is selected, the panel_distribution endpoint will check if its panel is selected
  // and highlight accordingly, without changing the selection type

  // Compute world-space axis-aligned bounding box for a placement,
  // accounting for scale, rotation, and multi-socket extra width
  const getPlacementWorldBoundsMemo = useCallback(
    (pos: Point, rotationDeg: number, scale: number, socketCount: number, symbolType?: string) => {
      return getPlacementWorldBounds(
        pos,
        rotationDeg,
        scale,
        socketCount,
        symbolType,
        baseSymbolSizePx
      )
    },
    [baseSymbolSizePx]
  )

  // Find placements that intersect with selection rectangle
  const handleFindElementsInRectangle = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      // Wire mode edits wires: a drag rectangle picks floor passages, never symbols.
      if (activeTool === 'wiring') return []
      // In floor plan draw mode, drag-rect selects walls/vertices; otherwise it selects placements/endpoints/panels.
      if (isFloorPlanMode && activeFloor?.floorPlan) {
        type WallDragResult =
          | { type: 'wall'; id: string }
          | { type: 'vertex'; wallId: string; pointIndex: number }
          | { type: 'graphicElement'; id: string }

        const rectRight = rect.x + rect.width
        const rectBottom = rect.y + rect.height

        // Avoid selecting everything: a very small rect (e.g. accidental click-drag)
        // should not select by bbox intersection, which would hit almost every wall.
        const minRectSize = 8
        const rectIsTiny = rect.width < minRectSize || rect.height < minRectSize

        const results: WallDragResult[] = []
        let hasVertexSelection = false

        for (const wall of activeFloor.floorPlan.walls) {
          if (!wall.points.length) continue
          const sourcePoints = wall.points
          const pts = getWallPathPoints(wall)

          // Check which vertices fall inside the rectangle.
          const vertexIndicesInRect: number[] = []
          sourcePoints.forEach((p: Point2, idx: number) => {
            if (p.x >= rect.x && p.x <= rectRight && p.y >= rect.y && p.y <= rectBottom) {
              vertexIndicesInRect.push(idx)
            }
          })

          if (vertexIndicesInRect.length > 0) {
            hasVertexSelection = true
            vertexIndicesInRect.forEach((idx) => {
              results.push({ type: 'vertex', wallId: wall.id, pointIndex: idx })
            })
            continue
          }

          // No vertices inside the rect for this wall. Decide if the wall stroke itself
          // should be selected, based on polyline–rectangle intersection (stroke hit),
          // not the filled polygon area.
          if (!rectIsTiny) {
            let hit = false
            for (let i = 0; i < pts.length - 1; i++) {
              const p1 = pts[i]!
              const p2 = pts[i + 1]!
              if (segmentIntersectsRect(p1, p2, rect)) {
                hit = true
                break
              }
            }
            if (hit) {
              results.push({ id: wall.id, type: 'wall' })
            }
          }
        }

        const stairs = activeFloor.floorPlan.stairs ?? []
        for (const stair of stairs) {
          if (!stair.points.length) continue
          const vertexIndicesInRect: number[] = []
          stair.points.forEach((p: Point2, idx: number) => {
            if (p.x >= rect.x && p.x <= rectRight && p.y >= rect.y && p.y <= rectBottom) {
              vertexIndicesInRect.push(idx)
            }
          })
          if (vertexIndicesInRect.length > 0) {
            hasVertexSelection = true
            vertexIndicesInRect.forEach((idx) => {
              results.push({
                type: 'vertex',
                wallId: encodeStairPointId(stair.id, idx),
                pointIndex: idx,
              })
            })
          }
        }

        for (const element of activeFloor.floorPlan.graphicElements ?? []) {
          const left = element.pos.x - element.width / 2
          const right = element.pos.x + element.width / 2
          const top = element.pos.y - element.height / 2
          const bottom = element.pos.y + element.height / 2
          const intersects =
            left < rectRight && right > rect.x && top < rectBottom && bottom > rect.y
          if (intersects) {
            results.push({ id: element.id, type: 'graphicElement' })
          }
        }

        if (hasVertexSelection) {
          // Encode vertices so BaseCanvas can store them.
          return results
            .filter(
              (r): r is { type: 'vertex'; wallId: string; pointIndex: number } =>
                r.type === 'vertex'
            )
            .map((r) => ({
              id: r.wallId.startsWith(STAIR_POINT_ID_PREFIX)
                ? r.wallId
                : encodeWallPointId(r.wallId, r.pointIndex),
              type: 'wallPoint' as const,
            }))
        }

        return results.filter(
          (r): r is { type: 'wall' | 'graphicElement'; id: string } =>
            r.type === 'wall' || r.type === 'graphicElement'
        )
      }

      const results: Array<{ id: string; type: 'placement' | 'panel' | 'trunkDevice' }> = []

      const store = useProjectStore.getState()
      const inst = store.currentProject
        ? selectProjectElectricalInstallation(store.currentProject)
        : undefined

      visiblePlacements.forEach(
        (
          placementRow: Placement & {
            endpointId?: string
            trunkDeviceId?: string
            junctionPanelLabel?: string
            isEarthing?: boolean
          }
        ) => {
          const rectRight = rect.x + rect.width
          const rectBottom = rect.y + rect.height

          if (placementRow.isEarthing) {
            const bounds = getPlacementWorldBoundsMemo(
              placementRow.pos,
              placementRow.rotationDeg,
              placementRow.scale,
              1,
              'earthing'
            )
            const intersects =
              bounds.left < rectRight &&
              bounds.right > rect.x &&
              bounds.top < rectBottom &&
              bounds.bottom > rect.y
            if (intersects) results.push({ id: 'ground', type: 'panel' })
            return
          }

          // Junction panels: placement with junctionPanelLabel but no endpoint
          if (placementRow.junctionPanelLabel != null) {
            const pos = placementRow.pos
            const bounds = getPlacementWorldBoundsMemo(
              pos,
              placementRow.rotationDeg,
              placementRow.scale,
              1,
              'junction_panel'
            )

            const intersects =
              bounds.left < rectRight &&
              bounds.right > rect.x &&
              bounds.top < rectBottom &&
              bounds.bottom > rect.y

            if (!intersects) return

            const label = placementRow.junctionPanelLabel
            const junctionIds: string[] = []

            if (inst) {
              const labelMatchesJunction = (d: { type: string; label: string }) =>
                d.type === 'junction_panel' && d.label === label

              inst.mainSupply?.supplyTrunkDevices
                ?.filter(labelMatchesJunction)
                .forEach((d: { id: string }) => junctionIds.push(d.id))
              inst.groundTrunkDevices
                ?.filter(labelMatchesJunction)
                .forEach((d: { id: string }) => junctionIds.push(d.id))
              ;(store.currentProject
                ? selectProjectElectricalPanels(store.currentProject)
                : []
              ).forEach((panel: Panel) => {
                const circuits = [
                  ...(panel.circuits ?? []),
                  ...(panel.protections?.flatMap((pr) => pr.circuits ?? []) ?? []),
                ]
                circuits.forEach((c) =>
                  c.trunkDevices
                    ?.filter(labelMatchesJunction)
                    .forEach((d: { id: string }) => junctionIds.push(d.id))
                )
              })
            }

            if (junctionIds.length > 0) {
              junctionIds.forEach((id) => results.push({ id, type: 'trunkDevice' }))
            } else {
              // Fallback: at least select the placement itself
              results.push({ id: placementRow.id, type: 'trunkDevice' })
            }
            return
          }

          // Regular endpoint- and trunk-device-backed placements
          const owner = resolvePlanMarqueePlacementOwner(
            placementRow,
            getEndpointById,
            (id) => store.getTrunkDeviceById(id)?.device
          )
          if (!owner) return

          const { endpoint, socketCount, symbol } = owner

          const bounds = getPlacementWorldBoundsMemo(
            placementRow.pos,
            placementRow.rotationDeg,
            placementRow.scale,
            socketCount,
            symbol
          )

          const intersects =
            bounds.left < rectRight &&
            bounds.right > rect.x &&
            bounds.top < rectBottom &&
            bounds.bottom > rect.y

          if (!intersects) {
            return
          }

          // Panels: any endpoint whose label matches a panel name should be treated
          // as a panel (same behavior as single-click selection via panel-* Konva name).
          if (endpoint) {
            const panel = store.getPanelByName(endpoint.label)
            if (panel) {
              results.push({ id: panel.id, type: 'panel' })
              return
            }
          }

          // Placement id matches single-click / shift-click selection (one row per symbol)
          results.push({ id: placementRow.id, type: 'placement' })
        }
      )

      return results
    },
    [
      activeTool,
      visiblePlacements,
      getPlacementWorldBoundsMemo,
      getEndpointById,
      isFloorPlanMode,
      activeFloor,
    ]
  )

  // Floor plan keyboard shortcuts are now handled by FloorPlanMode component

  // Image loading is now handled by usePlanImage hook

  // Handle tool changes
  useEffect(
    function () {
      if (activeTool === 'move' && planImageRef && transformerRef) {
        transformerRef.nodes([planImageRef])
        transformerRef.getLayer()?.batchDraw()
      } else if (activeTool !== 'move' && transformerRef) {
        transformerRef.nodes([])
        transformerRef.getLayer()?.batchDraw()
      }
    },
    [activeTool, planImageRef, transformerRef]
  )

  // The transformer rotates the image node inside the plan image group. Fold that
  // into the floor's persisted origin and rotation as a single undoable update.
  const handlePlanImageTransformEnd = useCallback(
    (event: KonvaEventObject<Event>) => {
      const node = event.target
      if (!activeFloorId) return
      const origin = planImageLocalToScenePoint(
        { x: node.x(), y: node.y() },
        planImagePosition,
        planImageRotationDeg
      )
      const rotationDeg = normalizePlanImageRotationDeg(planImageRotationDeg + node.rotation())
      node.position({ x: 0, y: 0 })
      node.rotation(0)
      node.scale({ x: 1, y: 1 })
      updateFloor(activeFloorId, { planImageOffset: origin, planImageRotationDeg: rotationDeg })
      useProjectStore.getState().setPlanCanvasPlanImageOffset(activeFloorId, origin)
    },
    [activeFloorId, planImagePosition, planImageRotationDeg, updateFloor]
  )

  // Handle plan image click: treat floor plan as empty space for deselection;
  // in move tool, also allow selecting the plan image for repositioning.
  const handlePlanImageClick = useCallback(
    function () {
      clearSelection()
      if (activeTool === 'move') {
        applySelectedPlanImageId(activeFloorId || null)
      } else {
        applySelectedPlanImageId(null)
      }
    },
    [activeTool, activeFloorId, applySelectedPlanImageId, clearSelection]
  )

  const handleDeleteSelectedPlanImage = useCallback(
    function () {
      if (!activeFloorId) return
      const floorId = activeFloorId
      const floor = getFloorById(floorId)
      const hasImage = !!(floor?.planAsset || floor?.planImportAsset)
      if (!hasImage) return
      dialog.confirm({
        title: t('contextMenu.deletePlanImageConfirmTitle'),
        message: t('contextMenu.deletePlanImageConfirmMessage', { floor: floor?.name ?? '' }),
        variant: 'danger',
        confirmLabel: t('contextMenu.deletePlanImage'),
        onConfirm: () => {
          // Shared with the Documents canvas: off this floor, and the image file leaves the
          // project once no other floor shows it.
          removeFloorPlan({ planAssetId: floor?.planImportAsset?.id, floorIds: [floorId] })
          applySelectedPlanImageId(null)
          // Deleting the image disables the move-tool button, so leave move mode here instead
          // of stranding its adjacent-floor ghost overlay on the canvas.
          applyActiveTool('none')
        },
      })
    },
    [activeFloorId, applyActiveTool, applySelectedPlanImageId, dialog, getFloorById, removeFloorPlan, t]
  )

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
    []
  )

  const closeQuickPlacer = useCallback(
    function () {
      applyQuickPlacerOpen(false)
      if (leftDockPanel === 'quickPlacer') {
        applyLeftDockPanel('library')
      }
      applyQuickPlacerMode('slow')
      applyQuickPlacerManualCircuitFocusToken(0)
      applyQuickPlacerFastIndex(0)
      applyQuickPlacerDraggedPlacementId(null)
      quickPlacerDraggedPlacementIdRef.current = null
      applyQuickPlacerCursorHint(null)
      applyQuickPlacerFastPreviewClient(null)
      clearHover()
    },
    [
      applyLeftDockPanel,
      applyQuickPlacerCursorHint,
      applyQuickPlacerDraggedPlacementId,
      applyQuickPlacerFastIndex,
      applyQuickPlacerFastPreviewClient,
      applyQuickPlacerManualCircuitFocusToken,
      applyQuickPlacerMode,
      applyQuickPlacerOpen,
      clearHover,
      leftDockPanel,
    ]
  )

  useEffect(
    function () {
      if (planIsInLayout) return
      closeQuickPlacer()
    },
    [closeQuickPlacer, planIsInLayout]
  )

  const quickPlacerDocked = leftDockPanel === 'quickPlacer'
  const quickPlacerVisible = quickPlacerOpen || quickPlacerDocked

  const openFloatingQuickPlacer = useCallback(
    function () {
      if (quickPlacerDocked) {
        applyLeftDockPanel('library')
      }
      applyQuickPlacerOpen(true)
      applyQuickPlacerMode('slow')
      applyQuickPlacerFastIndex(0)
    },
    [
      applyLeftDockPanel,
      applyQuickPlacerFastIndex,
      applyQuickPlacerMode,
      applyQuickPlacerOpen,
      quickPlacerDocked,
    ]
  )

  useEffect(
    function () {
      if (!quickPlacerDocked || leftDockCollapsed) {
        applyQuickPlacerDockHost(null)
        return
      }

      const syncDockHost = () => {
        applyQuickPlacerDockHost(document.getElementById('left-dock-quick-placer-host'))
      }

      syncDockHost()
      const frameId = window.requestAnimationFrame(syncDockHost)
      return () => window.cancelAnimationFrame(frameId)
    },
    [applyQuickPlacerDockHost, quickPlacerDocked, leftDockCollapsed]
  )

  useEffect(
    function () {
      if (quickPlacerCircuits.length === 0) {
        if (quickPlacerSelectedCircuitId !== null) {
          applyQuickPlacerSelectedCircuitId(null)
        }
        if (quickPlacerFastIndex !== 0) {
          applyQuickPlacerFastIndex(0)
        }
        if (quickPlacerMode === 'fast') {
          applyQuickPlacerMode('slow')
        }
        return
      }
      if (
        !quickPlacerSelectedCircuitId ||
        !quickPlacerCircuits.some((circuit) => circuit.id === quickPlacerSelectedCircuitId)
      ) {
        const nextCircuitId = quickPlacerCircuits[0]!.id
        if (quickPlacerSelectedCircuitId !== nextCircuitId) {
          applyQuickPlacerSelectedCircuitId(nextCircuitId)
        }
      }
    },
    [
      applyQuickPlacerFastIndex,
      applyQuickPlacerMode,
      applyQuickPlacerSelectedCircuitId,
      quickPlacerCircuits,
      quickPlacerFastIndex,
      quickPlacerMode,
      quickPlacerSelectedCircuitId,
    ]
  )

  useEffect(
    function () {
      if (quickPlacerSequence.length === 0) {
        if (quickPlacerFastIndex !== 0) applyQuickPlacerFastIndex(0)
        if (quickPlacerMode === 'fast') applyQuickPlacerMode('slow')
        return
      }
      if (quickPlacerFastIndex >= quickPlacerSequence.length) {
        applyQuickPlacerFastIndex(quickPlacerSequence.length - 1)
      }
    },
    [
      applyQuickPlacerFastIndex,
      applyQuickPlacerMode,
      quickPlacerFastIndex,
      quickPlacerMode,
      quickPlacerSequence.length,
    ]
  )

  useEffect(
    function () {
      const isFast = quickPlacerVisible && quickPlacerMode === 'fast'
      if (isFast && !quickPlacerWasFastRef.current) {
        quickPlacerPreviousSelectionRef.current = selection
        quickPlacerWasFastRef.current = true
        return
      }
      if (!isFast && quickPlacerWasFastRef.current) {
        const previousSelection = quickPlacerPreviousSelectionRef.current
        if (previousSelection) {
          applySelection(previousSelection)
        }
        quickPlacerPreviousSelectionRef.current = null
        quickPlacerWasFastRef.current = false
      }
    },
    [quickPlacerVisible, quickPlacerMode, selection, applySelection]
  )

  useEffect(
    function () {
      if (
        !quickPlacerVisible ||
        !selectedQuickPlacerCircuit ||
        quickPlacerManualCircuitFocusToken === 0
      )
        return
      applyEendraadCircuitFocus({
        circuitId: selectedQuickPlacerCircuit.id,
        setSelection: applySelection,
        requestFitToView,
      })
    },
    [
      quickPlacerVisible,
      quickPlacerManualCircuitFocusToken,
      selectedQuickPlacerCircuit,
      selectedQuickPlacerCircuit?.id,
      applySelection,
      requestFitToView,
    ]
  )

  useEffect(
    function () {
      if (
        !quickPlacerVisible ||
        quickPlacerMode !== 'fast' ||
        !currentQuickPlacerFastItem ||
        !selectedQuickPlacerCircuit
      )
        return
      if (suppressQuickPlacerPanelFocusRef.current) {
        suppressQuickPlacerPanelFocusRef.current = false
        return
      }
      applyEendraadCircuitFocus({
        circuitId: selectedQuickPlacerCircuit.id,
        setSelection: applySelection,
        requestFitToView,
      })
    },
    [
      quickPlacerVisible,
      quickPlacerMode,
      currentQuickPlacerFastItem?.placement.id,
      currentQuickPlacerFastItem,
      selectedQuickPlacerCircuit,
      selectedQuickPlacerCircuit?.id,
      applySelection,
      requestFitToView,
    ]
  )

  useEffect(
    function () {
      if (!quickPlacerVisible || quickPlacerMode !== 'fast' || !currentQuickPlacerFastItem) return
      applyHover({ type: 'endpoint', ids: [currentQuickPlacerFastItem.endpoint.id] })
    },
    [
      quickPlacerVisible,
      quickPlacerMode,
      currentQuickPlacerFastItem,
      currentQuickPlacerFastItem?.placement.id,
      applyHover,
    ]
  )

  const advanceQuickPlacerFastTarget = useCallback(
    function (options?: { placedItemLeavesSequence?: boolean }) {
      if (quickPlacerSequence.length === 0) {
        applyQuickPlacerFastIndex(0)
        return
      }

      // With auto-skip, a just-placed default item drops out of the sequence and the next
      // item slides into the current index; stepping forward would skip it.
      const step = options?.placedItemLeavesSequence ? 0 : 1
      const remaining = quickPlacerSequence.length - (options?.placedItemLeavesSequence ? 1 : 0)
      if (quickPlacerFastIndex + step < remaining) {
        applyQuickPlacerFastIndex(quickPlacerFastIndex + step)
        return
      }

      if (!selectedQuickPlacerCircuit) {
        applyQuickPlacerFastIndex(0)
        return
      }

      const nextCircuit = findNextQuickPlacerCircuit(
        quickPlacerCircuits,
        selectedQuickPlacerCircuit.id,
        {
          autoSkipCustom: quickPlacerFastAutoSkipCustom,
        }
      )
      if (nextCircuit) {
        applyQuickPlacerSelectedCircuitId(nextCircuit.id)
        applyQuickPlacerFastIndex(0)
        return
      }

      applyQuickPlacerFastIndex(0)
    },
    [
      quickPlacerFastAutoSkipCustom,
      quickPlacerFastIndex,
      quickPlacerSequence.length,
      quickPlacerCircuits,
      selectedQuickPlacerCircuit,
      applyQuickPlacerFastIndex,
      applyQuickPlacerSelectedCircuitId,
    ]
  )

  const handleQuickPlacerModeChange = useCallback(
    (mode: QuickPlacerMode) => {
      if (mode !== quickPlacerMode) {
        trackGoogleAnalyticsEvent('quick_placer_mode_change', {
          from_mode: quickPlacerMode,
          to_mode: mode,
          circuit_count: quickPlacerCircuits.length,
          item_count: quickPlacerSequence.length,
          auto_skip_custom: quickPlacerFastAutoSkipCustom,
        })
      }
      applyQuickPlacerMode(mode)
      if (mode === 'fast') {
        if (quickPlacerSequence.length === 0 && quickPlacerFastAutoSkipCustom) {
          const selectedCircuitHasItemsWithoutSkipping = selectedQuickPlacerCircuit
            ? flattenQuickPlacerCircuit(selectedQuickPlacerCircuit, {
                autoSkipCustom: false,
              }).length > 0
            : false
          const firstCircuitWithItemsWithoutSkipping = selectedCircuitHasItemsWithoutSkipping
            ? null
            : (quickPlacerCircuits.find(
                (circuit) =>
                  flattenQuickPlacerCircuit(circuit, {
                    autoSkipCustom: false,
                  }).length > 0
              ) ?? null)

          if (selectedCircuitHasItemsWithoutSkipping || firstCircuitWithItemsWithoutSkipping) {
            applyQuickPlacerFastAutoSkipCustom(false)
            if (firstCircuitWithItemsWithoutSkipping) {
              applyQuickPlacerSelectedCircuitId(firstCircuitWithItemsWithoutSkipping.id)
            }
          }
        }
        const selectedStartIndex = findQuickPlacerStartIndexForSelection(
          quickPlacerSequence,
          selection
        )
        applyQuickPlacerFastIndex(selectedStartIndex >= 0 ? selectedStartIndex : 0)
      } else {
        applyQuickPlacerDraggedPlacementId(null)
        quickPlacerDraggedPlacementIdRef.current = null
        applyQuickPlacerFastPreviewClient(null)
        clearHover()
      }
    },
    [
      clearHover,
      applyQuickPlacerDraggedPlacementId,
      applyQuickPlacerFastAutoSkipCustom,
      applyQuickPlacerFastIndex,
      applyQuickPlacerFastPreviewClient,
      applyQuickPlacerMode,
      applyQuickPlacerSelectedCircuitId,
      quickPlacerMode,
      quickPlacerCircuits,
      quickPlacerFastAutoSkipCustom,
      quickPlacerSequence,
      selection,
      selectedQuickPlacerCircuit,
    ]
  )

  const handleQuickPlacerSelectedCircuitChange = useCallback(
    (circuitId: string) => {
      applyQuickPlacerSelectedCircuitId(circuitId)
      applyQuickPlacerManualCircuitFocusToken((value) => value + 1)
      applyQuickPlacerFastIndex(0)
      trackGoogleAnalyticsEvent('quick_placer_circuit_select', {
        mode: quickPlacerMode,
      })
    },
    [
      applyQuickPlacerFastIndex,
      applyQuickPlacerManualCircuitFocusToken,
      applyQuickPlacerSelectedCircuitId,
      quickPlacerMode,
    ]
  )

  // Tool bubble: open on the first symbol that is not on the plan yet, if any.
  const [quickPlacerFocusPlacementId, applyQuickPlacerFocusPlacementId] = useState<
    string | null
  >(null)
  useEffect(() => {
    if (!quickPlacerOpen && !quickPlacerDocked) applyQuickPlacerFocusPlacementId(null)
  }, [quickPlacerOpen, quickPlacerDocked])
  const openQuickPlacerAtFirstAwaiting = useCallback(() => {
    openFloatingQuickPlacer()
    const first = findFirstAwaitingQuickPlacerItem(quickPlacerCircuits)
    if (!first) return
    applyQuickPlacerSelectedCircuitId(first.circuit.id)
    applyQuickPlacerManualCircuitFocusToken((value) => value + 1)
    const sequence = flattenQuickPlacerCircuit(first.circuit, {
      autoSkipCustom: quickPlacerFastAutoSkipCustom,
    })
    const index = sequence.findIndex((item) => item.placement.id === first.item.placement.id)
    applyQuickPlacerFastIndex(Math.max(0, index))
    applyQuickPlacerFocusPlacementId(first.item.placement.id)
  }, [
    applyQuickPlacerFastIndex,
    applyQuickPlacerManualCircuitFocusToken,
    applyQuickPlacerSelectedCircuitId,
    openFloatingQuickPlacer,
    quickPlacerCircuits,
    quickPlacerFastAutoSkipCustom,
  ])

  const handleQuickPlacerSelectedPanelChange = useCallback(
    (panelId: string) => {
      const firstCircuit = quickPlacerCircuits.find((circuit) => circuit.panelId === panelId)
      if (!firstCircuit) return
      if (quickPlacerMode === 'fast') suppressQuickPlacerPanelFocusRef.current = true
      applyQuickPlacerSelectedCircuitId(firstCircuit.id)
      applyQuickPlacerFastIndex(0)
      trackGoogleAnalyticsEvent('quick_placer_panel_select', {
        mode: quickPlacerMode,
      })
    },
    [
      applyQuickPlacerFastIndex,
      applyQuickPlacerSelectedCircuitId,
      quickPlacerCircuits,
      quickPlacerMode,
    ]
  )

  const handleQuickPlacerItemActivate = useCallback(
    (item: QuickPlacerItem) => {
      applySelection({ type: 'placement', ids: [item.placement.id] })
      trackGoogleAnalyticsEvent('quick_placer_item_select', {
        canvas: 'plan',
        mode: quickPlacerMode,
        endpoint_type: item.endpoint.type,
        symbol_id: item.endpoint.symbol,
        is_custom_placement: item.isCustomPlacement,
      })
      if (eendraadIsInLayout) {
        requestFitToView(['eendraad'])
      }
      if (quickPlacerMode === 'fast') {
        const index = quickPlacerSequence.findIndex(
          (candidate) => candidate.placement.id === item.placement.id
        )
        if (index >= 0) {
          applyQuickPlacerFastIndex(index)
        }
      }
    },
    [
      applyQuickPlacerFastIndex,
      applySelection,
      eendraadIsInLayout,
      quickPlacerMode,
      quickPlacerSequence,
      requestFitToView,
    ]
  )

  const handleQuickPlacerItemHoverStart = useCallback(
    (item: QuickPlacerItem) => {
      applyHover({ type: 'endpoint', ids: [item.endpoint.id] })
    },
    [applyHover]
  )

  const handleQuickPlacerItemHoverEnd = useCallback(
    function () {
      if (quickPlacerMode === 'fast' && currentQuickPlacerFastItem) {
        applyHover({ type: 'endpoint', ids: [currentQuickPlacerFastItem.endpoint.id] })
        return
      }
      clearHover()
    },
    [clearHover, currentQuickPlacerFastItem, quickPlacerMode, applyHover]
  )

  const handleQuickPlacerItemDragStart = useCallback(
    (item: QuickPlacerItem) => {
      applyQuickPlacerDraggedPlacementId(item.placement.id)
      quickPlacerDraggedPlacementIdRef.current = item.placement.id
    },
    [applyQuickPlacerDraggedPlacementId]
  )

  const handleQuickPlacerItemDragEnd = useCallback(
    function () {
      applyQuickPlacerDraggedPlacementId(null)
      quickPlacerDraggedPlacementIdRef.current = null
    },
    [applyQuickPlacerDraggedPlacementId]
  )

  const applyQuickPlacerPlacement = useCallback(
    (placementId: string, targetPos: Point): boolean => {
      if (!activeFloorId) return false

      const placement = getPlacementById(placementId)
      if (!placement) return false

      const snappedPos = snapPlacementPosition(targetPos)

      const endpoint = placement.endpointId ? getEndpointById(placement.endpointId) : null
      const patch: Partial<Placement> = {
        floorId: activeFloorId,
        pos: snappedPos,
      }

      if (
        endpoint &&
        !hasExplicitSituationPlanRotation(placement) &&
        (endpoint.type === 'socket' || endpoint.symbol === 'panel_distribution')
      ) {
        const wallFacingSide = endpoint.symbol === 'panel_distribution' ? 'top' : 'left'
        const suggestedRotation = suggestRotationForPlacement(
          { ...placement, pos: snappedPos },
          {
            image: planImageForAnalysis,
            imagePosition: planImagePosition,
            walls: wallsForRender,
            symbolBaseSizePx: baseSymbolSizePx,
            ...(endpoint.type === 'socket'
              ? { socketCount: endpoint.socketProps?.socketCount ?? 1 }
              : {}),
          },
          wallFacingSide
        )
        if (suggestedRotation != null) {
          patch.rotationDeg = suggestedRotation
        }
      }

      updatePlacement(placementId, patch)
      return true
    },
    [
      activeFloorId,
      getPlacementById,
      getEndpointById,
      planImageForAnalysis,
      planImagePosition,
      wallsForRender,
      baseSymbolSizePx,
      updatePlacement,
      snapPlacementPosition,
    ]
  )

  const handleQuickPlacerFastSkip = useCallback(
    (clientX: number, clientY: number) => {
      if (!currentQuickPlacerFastItem) return
      trackGoogleAnalyticsEvent('quick_placer_skip', {
        canvas: 'plan',
        mode: 'fast',
        endpoint_type: currentQuickPlacerFastItem.endpoint.type,
        symbol_id: currentQuickPlacerFastItem.endpoint.symbol,
        is_custom_placement: currentQuickPlacerFastItem.isCustomPlacement,
      })
      showQuickPlacerHint('Skipped!', clientX, clientY, 'info')
      advanceQuickPlacerFastTarget()
    },
    [currentQuickPlacerFastItem, showQuickPlacerHint, advanceQuickPlacerFastTarget]
  )

  const handleQuickPlacerFastPlace = useCallback(
    (clientX: number, clientY: number) => {
      const currentItem = currentQuickPlacerFastItem
      if (!currentItem) return
      const nextPos = clientToPlan(clientX, clientY)
      if (!nextPos) {
        showQuickPlacerHint('Situation Plan only', clientX, clientY, 'error')
        return
      }
      const applied = applyQuickPlacerPlacement(currentItem.placement.id, nextPos)
      if (!applied) return
      trackGoogleAnalyticsEvent('quick_placer_place', {
        canvas: 'plan',
        placement_method: 'quick_placer',
        mode: 'fast',
        endpoint_type: currentItem.endpoint.type,
        symbol_id: currentItem.endpoint.symbol,
        is_custom_placement: currentItem.isCustomPlacement,
      })
      applySelection({ type: 'placement', ids: [currentItem.placement.id] })
      advanceQuickPlacerFastTarget({
        placedItemLeavesSequence: quickPlacerFastAutoSkipCustom && !currentItem.isCustomPlacement,
      })
    },
    [
      quickPlacerFastAutoSkipCustom,
      currentQuickPlacerFastItem,
      clientToPlan,
      applyQuickPlacerPlacement,
      applySelection,
      advanceQuickPlacerFastTarget,
      showQuickPlacerHint,
    ]
  )

  useEffect(
    function () {
      if (!quickPlacerVisible) return
      const handleQuickPlacerKeyDown = (event: KeyboardEvent) => {
        if (isKeyboardTypingTarget(event.target)) return

        if (event.key === 'Escape') {
          event.preventDefault()
          if (quickPlacerMode === 'fast') {
            applyQuickPlacerMode('slow')
          } else {
            closeQuickPlacer()
          }
          return
        }

        if (quickPlacerMode !== 'fast' || event.ctrlKey || event.metaKey || event.altKey) return

        const normalizedKey = event.key.length === 1 ? event.key.toUpperCase() : ''
        const floorIndex = QUICK_PLACER_FLOOR_KEYS.indexOf(normalizedKey)
        if (floorIndex === -1) return
        const floor = floors[floorIndex]
        if (!floor) return

        event.preventDefault()
        applyActiveFloor(floor.id)
      }

      window.addEventListener('keydown', handleQuickPlacerKeyDown)
      return () => window.removeEventListener('keydown', handleQuickPlacerKeyDown)
    },
    [
      applyActiveFloor,
      applyQuickPlacerMode,
      closeQuickPlacer,
      floors,
      quickPlacerMode,
      quickPlacerVisible,
    ]
  )

  useEffect(
    function () {
      if (!quickPlacerVisible || quickPlacerMode !== 'fast') return
      const handlePointerDown = (event: PointerEvent) => {
        const target = event.target
        const insidePanel =
          target instanceof Node && !!quickPlacerPanelRef.current?.contains(target)
        const insidePlan = target instanceof Node && !!containerRef.current?.contains(target)
        if (insidePanel) return

        if (insidePlan) {
          if (event.button === 0) {
            event.preventDefault()
            event.stopPropagation()
            handleQuickPlacerFastPlace(event.clientX, event.clientY)
            return
          }
          if (event.button === 2) {
            event.preventDefault()
            event.stopPropagation()
            handleQuickPlacerFastSkip(event.clientX, event.clientY)
          }
          return
        }

        if (target instanceof Element && target.closest('[data-viewport-panel]') && !insidePlan) {
          showQuickPlacerHint('Situation Plan only', event.clientX, event.clientY, 'error')
        }

        applyQuickPlacerMode('slow')
      }

      const handlePointerMove = (event: PointerEvent) => {
        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect) {
          applyQuickPlacerFastPreviewClient(null)
          return
        }
        const insidePlan =
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        if (insidePlan) {
          applyQuickPlacerFastPreviewClient({ x: event.clientX, y: event.clientY })
        } else {
          applyQuickPlacerFastPreviewClient(null)
        }
      }

      const handleContextMenu = (event: MouseEvent) => {
        const target = event.target
        if (target instanceof Element && target.closest('[data-floor-selection-row]')) return
        const insidePlan = target instanceof Node && !!containerRef.current?.contains(target)
        if (!insidePlan) return
        event.preventDefault()
        event.stopPropagation()
      }

      window.addEventListener('pointerdown', handlePointerDown, true)
      window.addEventListener('pointermove', handlePointerMove, true)
      window.addEventListener('contextmenu', handleContextMenu, true)
      return () => {
        window.removeEventListener('pointerdown', handlePointerDown, true)
        window.removeEventListener('pointermove', handlePointerMove, true)
        window.removeEventListener('contextmenu', handleContextMenu, true)
      }
    },
    [
      quickPlacerVisible,
      quickPlacerMode,
      showQuickPlacerHint,
      handleQuickPlacerFastPlace,
      handleQuickPlacerFastSkip,
      applyQuickPlacerFastPreviewClient,
      applyQuickPlacerMode,
    ]
  )

  useEffect(
    function () {
      const handleWindowDrop = (event: DragEvent) => {
        if (!quickPlacerDraggedPlacementIdRef.current) return
        const target = event.target
        if (target instanceof Node && containerRef.current?.contains(target)) return
        showQuickPlacerHint('Situation Plan only', event.clientX, event.clientY, 'error')
        applyQuickPlacerDraggedPlacementId(null)
        quickPlacerDraggedPlacementIdRef.current = null
      }

      window.addEventListener('drop', handleWindowDrop)
      return () => window.removeEventListener('drop', handleWindowDrop)
    },
    [applyQuickPlacerDraggedPlacementId, showQuickPlacerHint]
  )

  const toggleQuickPlacerByShortcut = useCallback(
    function () {
      if (quickPlacerOpen || quickPlacerDocked) {
        closeQuickPlacer()
      } else {
        openFloatingQuickPlacer()
      }
    },
    [quickPlacerOpen, quickPlacerDocked, closeQuickPlacer, openFloatingQuickPlacer]
  )

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
    [applyActiveTool, applyIsFloorPlanMode, applySelection]
  )

  const exitFloorPlanModeKeepSelection = useCallback(
    function () {
      applySelectedPointIndices(new Map())
      applySelectedSegmentIndices(new Map())
      applySelectedStairPointIndices(new Map())
      applyIsFloorPlanMode(false)
      applyActiveTool('none')
    },
    [applyActiveTool, applyIsFloorPlanMode]
  )

  const selectionForDrawModeExit = useUIStore((s) => s.selection)

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

  const deleteSelectedWallGeometry = useCallback((): boolean => {
    if (!isFloorPlanMode || !activeFloor?.floorPlan) return false
    const activeFloorPlan = activeFloor.floorPlan
    const activeFloorIdForDeletion = activeFloor.id
    const selectionState = useUIStore.getState().selection
    const hasGlobalWallSelection =
      selectionState.type === 'wall' || selectionState.type === 'wallPoint'
    // A segment click updates canvas-local state and global selection separately. Honor the
    // local segment immediately even if the global selection update has not rendered yet.
    if (!hasGlobalWallSelection && selectedSegmentIndices.size === 0) return false

    const selectedWallIds =
      selectionState.type === 'wall' ? selectionState.ids : Array.from(selectedPointIndices.keys())
    const deletionPlan = buildWallSelectionDeletionPlan({
      walls: activeFloorPlan.walls,
      selectedWallIds,
      selectedPointIndices,
      selectedSegmentIndices,
    })
    if (
      deletionPlan.wholeWallIds.length === 0 &&
      deletionPlan.pointIndicesByWall.size === 0 &&
      deletionPlan.segmentIndicesByWall.size === 0
    ) {
      return false
    }

    withSingleUndoEntry(
      () => {
        deletionPlan.wholeWallIds.forEach((wallId) => deleteWall(wallId))
        for (const [wallId, indices] of deletionPlan.pointIndicesByWall.entries()) {
          const wall = activeFloorPlan.walls.find((entry: Wall) => entry.id === wallId)
          if (!wall) continue
          const indexSet = new Set(indices)
          const nextPoints = wall.points.filter((_: Point2, index: number) => !indexSet.has(index))
          if (nextPoints.length >= 2) updateWall(wallId, { points: nextPoints })
          else deleteWall(wallId)
        }
        for (const [wallId, indices] of deletionPlan.segmentIndicesByWall.entries()) {
          const wall = activeFloorPlan.walls.find((entry: Wall) => entry.id === wallId)
          if (!wall) continue
          const remainingSplines = splitWallPointsAtDeletedSegments(wall.points, indices)
          deleteWall(wallId)
          remainingSplines.forEach((points) => {
            addWall(activeFloorIdForDeletion, {
              floorId: activeFloorIdForDeletion,
              points,
              thickness: wall.thickness,
            })
          })
        }
        return true
      },
      { sessionLabel: 'delete-wall-selection' }
    )

    applySelectedPointIndices(new Map())
    applySelectedSegmentIndices(new Map())
    clearSelection()
    return true
  }, [
    activeFloor,
    addWall,
    clearSelection,
    deleteWall,
    isFloorPlanMode,
    selectedPointIndices,
    selectedSegmentIndices,
    updateWall,
    withSingleUndoEntry,
  ])

  const commitWallSegmentLength = useCallback(
    (wallId: string, segmentIndex: number, lengthCm: number) => {
      const floorPlan = activeFloor?.floorPlan
      if (!floorPlan || !Number.isFinite(lengthCm) || lengthCm <= 0 || canvasPxPerMeter <= 0) {
        return
      }
      const wall = floorPlan.walls.find((entry: Wall) => entry.id === wallId)
      if (!wall) return
      const wallDoors = floorPlan.doors.filter((door: Door) => door.wallId === wallId)
      const wallWindows = floorPlan.windows.filter((window: Window) => window.wallId === wallId)
      const lengthSnapStep = canvasPxPerMeter / 1000
      const openingMinimum = minSegmentLengthForOpenings(
        getOpeningsBySegment(wall.points, wallDoors, wallWindows).get(segmentIndex) ?? []
      )
      const snappedLengthCm = Math.round(lengthCm * 10) / 10
      const requestedLength = (snappedLengthCm / 100) * canvasPxPerMeter
      const targetLength = Math.max(
        requestedLength,
        Math.ceil(openingMinimum / lengthSnapStep) * lengthSnapStep
      )
      const resize = resizeWallShapeSegment(wall.points, segmentIndex, targetLength, lengthSnapStep)
      if (!resize) return

      const constrained = adjustVerticesAndOpenings(
        wall.points,
        resize.points,
        wallDoors,
        wallWindows,
        resize.movedPointIndices
      )
      const constrainedOpeningIds = new Set([
        ...constrained.doorUpdates.map((update) => update.id),
        ...constrained.windowUpdates.map((update) => update.id),
      ])
      const preserved = preserveOpeningPositionsAfterPointChange(
        wall.points,
        constrained.points,
        wallDoors,
        wallWindows,
        constrainedOpeningIds
      )
      const doorUpdates = [...constrained.doorUpdates, ...preserved.doorUpdates]
      const windowUpdates = [...constrained.windowUpdates, ...preserved.windowUpdates]

      withSingleUndoEntry(
        () => {
          updateWall(wallId, { points: constrained.points, doorUpdates, windowUpdates })
          return true
        },
        { sessionLabel: 'resize-wall-segment' }
      )
    },
    [activeFloor?.floorPlan, canvasPxPerMeter, updateWall, withSingleUndoEntry]
  )

  const commitWallOpeningDistance = useCallback(
    (wallId: string, openingId: string, side: 'start' | 'end', lengthCm: number) => {
      const floorPlan = activeFloor?.floorPlan
      if (!floorPlan || !Number.isFinite(lengthCm) || lengthCm < 0 || canvasPxPerMeter <= 0) {
        return
      }

      const wall = floorPlan.walls.find((entry: Wall) => entry.id === wallId)
      if (!wall) return
      const doors = floorPlan.doors.filter((door: Door) => door.wallId === wallId)
      const windows = floorPlan.windows.filter((window: Window) => window.wallId === wallId)
      const opening =
        doors.find((door) => door.id === openingId) ??
        windows.find((window) => window.id === openingId)
      if (!opening) return

      const geom = computeOpeningGeometry(wall.points, opening.position)
      if (!geom) return
      const segmentLength = geom.segmentEndDist - geom.segmentStartDist
      if (segmentLength <= 1e-6) return
      const segmentOpenings = getOpeningsBySegment(wall.points, doors, windows).get(
        geom.segmentIndex
      )
      if (!segmentOpenings) return

      const requestedDistance = (lengthCm / 100) * canvasPxPerMeter
      const openingIndex = segmentOpenings.findIndex((entry) => entry.id === openingId)
      if (openingIndex < 0) return
      const previous = segmentOpenings[openingIndex - 1]
      const next = segmentOpenings[openingIndex + 1]
      const leftBoundary = previous ? previous.centerAlongSegment + previous.width / 2 : 0
      const rightBoundary = next ? next.centerAlongSegment - next.width / 2 : segmentLength
      // The displayed interval can start/end at another opening, not only at a
      // wall vertex. Convert that interval-relative value to a segment-edge value
      // before applying the shared train-of-carts constraint.
      const distanceFromSegmentEdge =
        side === 'start'
          ? leftBoundary + requestedDistance
          : segmentLength - rightBoundary + requestedDistance
      const result = applyOpeningDistanceOnSegment({
        openingId,
        kind: doors.some((door) => door.id === openingId) ? 'door' : 'window',
        width: opening.width,
        segmentIndex: geom.segmentIndex,
        segmentStartDist: geom.segmentStartDist,
        segmentEndDist: geom.segmentEndDist,
        segmentLength,
        segmentOpenings,
        side,
        distance: distanceFromSegmentEdge,
      })

      const doorUpdates: Array<{ id: string; position: number }> = []
      const windowUpdates: Array<{ id: string; position: number }> = []
      const totalLength = getWallTotalLength(wall.points)
      if (totalLength <= 1e-6) return
      for (const [id, centerAlongSegment] of result.positionsByOpeningId) {
        const position = (geom.segmentStartDist + centerAlongSegment) / totalLength
        const existingDoor = doors.find((door) => door.id === id)
        const existingWindow = windows.find((window) => window.id === id)
        if (existingDoor && Math.abs(existingDoor.position - position) > 1e-6) {
          doorUpdates.push({ id, position })
        } else if (existingWindow && Math.abs(existingWindow.position - position) > 1e-6) {
          windowUpdates.push({ id, position })
        }
      }
      if (doorUpdates.length === 0 && windowUpdates.length === 0) return

      withSingleUndoEntry(
        () => {
          for (const update of doorUpdates) updateDoor(update.id, { position: update.position })
          for (const update of windowUpdates) updateWindow(update.id, { position: update.position })
          return true
        },
        { sessionLabel: 'move-opening-by-distance' }
      )
    },
    [activeFloor?.floorPlan, canvasPxPerMeter, updateDoor, updateWindow, withSingleUndoEntry]
  )

  const handleWallDimensionDrag = useCallback(
    (
      wallId: string,
      segmentIndex: number,
      delta: Point2,
      phase: 'start' | 'preview' | 'commit' | 'cancel',
      modifiers: DimensionDragModifiers
    ) => {
      const floorPlan = activeFloor?.floorPlan
      if (!floorPlan) return

      if (phase === 'start') {
        const wall = floorPlan.walls.find((entry: Wall) => entry.id === wallId)
        if (!wall) return
        wallDimensionDragRef.current = {
          wall: { ...wall, points: wall.points.map((point) => ({ ...point })) },
          doors: floorPlan.doors
            .filter((door: Door) => door.wallId === wallId)
            .map((door: Door) => ({ ...door })),
          windows: floorPlan.windows
            .filter((window: Window) => window.wallId === wallId)
            .map((window: Window) => ({ ...window })),
          segmentIndex,
          minimumSegmentLength: minSegmentLengthForOpenings(
            getOpeningsBySegment(
              wall.points,
              floorPlan.doors.filter((door: Door) => door.wallId === wallId),
              floorPlan.windows.filter((window: Window) => window.wallId === wallId)
            ).get(segmentIndex) ?? []
          ),
          parallelDragDirection: null,
        }
        applyPreviewWalls(null)
        applyPreviewDoors(null)
        applyPreviewWindows(null)
        return
      }

      const drag = wallDimensionDragRef.current
      if (!drag || drag.wall.id !== wallId || drag.segmentIndex !== segmentIndex) return
      if (phase === 'cancel') {
        wallDimensionDragRef.current = null
        applyPreviewWalls(null)
        applyPreviewDoors(null)
        applyPreviewWindows(null)
        return
      }

      const segmentStart = drag.wall.points[segmentIndex]
      const segmentEnd = drag.wall.points[segmentIndex + 1]
      if (drag.parallelDragDirection == null && segmentStart && segmentEnd) {
        const segmentX = segmentEnd.x - segmentStart.x
        const segmentY = segmentEnd.y - segmentStart.y
        const segmentLength = Math.hypot(segmentX, segmentY)
        if (segmentLength > 1e-6) {
          const parallelDelta = (delta.x * segmentX + delta.y * segmentY) / segmentLength
          if (Math.abs(parallelDelta) > 1e-6) {
            drag.parallelDragDirection = parallelDelta < 0 ? -1 : 1
          }
        }
      }

      const resize = dragWallShapeDimension(
        drag.wall.points,
        segmentIndex,
        delta,
        planView.snapToGrid
          ? gridSize
          : modifiers.quantize
            ? canvasPxPerMeter / 10
            : canvasPxPerMeter / 1000,
        drag.minimumSegmentLength,
        drag.parallelDragDirection ?? undefined
      )
      if (!resize) return
      const constrained = adjustVerticesAndOpenings(
        drag.wall.points,
        resize.points,
        drag.doors,
        drag.windows,
        resize.movedPointIndices
      )
      const constrainedOpeningIds = new Set([
        ...constrained.doorUpdates.map((update) => update.id),
        ...constrained.windowUpdates.map((update) => update.id),
      ])
      const preserved = preserveOpeningPositionsAfterPointChange(
        drag.wall.points,
        constrained.points,
        drag.doors,
        drag.windows,
        constrainedOpeningIds
      )
      const doorUpdates = [...constrained.doorUpdates, ...preserved.doorUpdates]
      const windowUpdates = [...constrained.windowUpdates, ...preserved.windowUpdates]

      if (phase === 'preview') {
        applyPreviewWalls(new Map([[wallId, { ...drag.wall, points: constrained.points }]]))
        applyPreviewDoors(
          new Map(
            drag.doors.map((door) => {
              const update = doorUpdates.find((entry) => entry.id === door.id)
              return [door.id, update ? { ...door, position: update.position } : door]
            })
          )
        )
        applyPreviewWindows(
          new Map(
            drag.windows.map((window) => {
              const update = windowUpdates.find((entry) => entry.id === window.id)
              return [window.id, update ? { ...window, position: update.position } : window]
            })
          )
        )
        return
      }

      withSingleUndoEntry(
        () => {
          updateWall(wallId, { points: constrained.points, doorUpdates, windowUpdates })
          return true
        },
        { sessionLabel: 'drag-wall-dimension' }
      )
      wallDimensionDragRef.current = null
      applyPreviewWalls(null)
      applyPreviewDoors(null)
      applyPreviewWindows(null)
    },
    [
      activeFloor?.floorPlan,
      canvasPxPerMeter,
      gridSize,
      planView.snapToGrid,
      updateWall,
      withSingleUndoEntry,
    ]
  )

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
        if (
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          (e.target instanceof HTMLElement && e.target.isContentEditable)
        ) {
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
    [activeTool, activeFloorId, canDeleteItems, hasPlanImage, handleDeleteSelectedPlanImage]
  )

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
        const store = useProjectStore.getState()
        const installation = store.currentProject
          ? selectProjectElectricalInstallation(store.currentProject)
          : undefined
        if (installation?.hasGround === false) {
          store.updateInstallation({ hasGround: true })
        }
        const existing = installation?.earthingPlacements?.find(
          (p: { floorId?: string }) => p.floorId === activeFloorId
        )
        let placementId: string
        if (existing) {
          store.updateEarthingPlacement(existing.id, { pos: snappedPosition })
          placementId = existing.id
        } else {
          const floorLayer = activeFloor.layers?.[0] || 'electrical'
          placementId = generateId()
          store.addEarthingPlacement({
            id: placementId,
            floorId: activeFloorId,
            pos: snappedPosition,
            rotationDeg: 0,
            scale: 1,
            layer: floorLayer,
          })
        }
        applySelection({ type: 'ground', ids: ['ground'] })
        return
      }

      if (symbol.id === 'note') {
        const noteId = `note-${Date.now()}`
        useProjectStore.getState().addSitplanNote({
          id: noteId,
          text: 'New note',
          fontSize: 14,
          pos: snappedPosition,
          floorId: activeFloorId,
        })
        applySelection({ type: 'note', ids: [noteId] })
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

      const ui = useUIStore.getState()
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
        useUIStore.getState().armedLibrarySymbol != null
      ) {
        finalizePlanDropCircuitPickerUndoGroup(undoGroupStartIndex)
        return
      }

      applyPlanDropCircuitPicker({
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
    [applyIsImportDialogOpen]
  )

  const closeImportDialog = useCallback(() => {
    applyIsImportDialogOpen(false)
    setPendingImportFile(null)
  }, [applyIsImportDialogOpen])

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
    [planToClient]
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
      addPlanGraphicElement(activeFloorId, draft)
      applySelectedGraphicAssetId(assetId)
      const latestElements =
        useProjectStore.getState().getFloorById(activeFloorId)?.floorPlan?.graphicElements ?? []
      const inserted = latestElements[latestElements.length - 1]
      if (inserted) applySelection({ type: 'graphicElement', ids: [inserted.id] })
      applyGraphicElementDropPicker(null)
    },
    [
      activeFloorId,
      addPlanGraphicElement,
      applySelectedGraphicAssetId,
      applySelection,
      canvasPxPerMeter,
    ]
  )

  const handleAddNoteFromContextMenu = useCallback(
    (position: Point) => {
      applyGraphicElementDropPicker(null)
      if (!activeFloorId) return
      const note = createSitplanNote(activeFloorId, position)
      useProjectStore.getState().addSitplanNote(note)
      applySelection({ type: 'note', ids: [note.id] })
    },
    [activeFloorId, applySelection]
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
    [canEditFloorPlan, isFloorPlanMode, planToClient]
  )

  // Context menu: base from usePlanContextMenu, plus floor-plan "Merge Points" when 2 vertices selected
  const baseGetContextMenuItems = usePlanContextMenu(activeFloorId, getPlacementWorldBoundsMemo, {
    onAddElementClick: handleContextAddElementClick,
    openContextAssignCircuitPanel,
  })
  const handleGetContextMenuItems = useCallback(
    (position: Point, elementId: string | null) => {
      const items = baseGetContextMenuItems(position, elementId)
      const canDeletePlanImage =
        canDeleteItems && activeTool === 'move' && hasPlanImage && !!activeFloorId
      if (canDeletePlanImage) {
        items.unshift({
          label: t('contextMenu.deletePlanImage'),
          onClick: () => handleDeleteSelectedPlanImage(),
          variant: 'danger',
        })
      }
      if (canEditFloorPlan && isFloorPlanMode && activeFloor?.floorPlan && activeFloorId) {
        const selectionState = useUIStore.getState().selection
        const selectedDirectStairIds =
          selectionState.type === 'stair'
            ? selectionState.ids
            : selectionState.type === 'stairPoint'
              ? selectionState.ids.slice(0, 1)
              : []
        const hitStairId =
          elementId && activeFloor.floorPlan.stairs?.some((stair: Stair) => stair.id === elementId)
            ? elementId
            : null
        if (hitStairId && !selectedDirectStairIds.includes(hitStairId)) {
          selectedDirectStairIds.push(hitStairId)
        }
        const selectedEncodedStairPoints =
          selectionState.type === 'wallPoint'
            ? parseStairPointIds(selectionState.ids)
            : selectionState.type === 'stairPoint' && selectionState.ids.length >= 2
              ? new Map([
                  [
                    selectionState.ids[0]!,
                    Number.isFinite(Number(selectionState.ids[1]))
                      ? [Number(selectionState.ids[1])]
                      : [],
                  ],
                ])
              : new Map<string, number[]>()
        const hasStairSelection =
          selectedDirectStairIds.length > 0 || selectedEncodedStairPoints.size > 0
        if (hasStairSelection) {
          items.unshift({ label: '', onClick: () => {}, separator: true })
          items.unshift({
            label: t('contextMenu.delete', 'Delete'),
            onClick: () => {
              const { deleteStair, updateStair, currentProject } = useProjectStore.getState()
              selectedDirectStairIds.forEach((stairId) => deleteStair(stairId))
              for (const [stairId, indices] of selectedEncodedStairPoints.entries()) {
                if (!indices.length) continue
                const stair = (
                  currentProject
                    ? selectProjectBuildingFloors(currentProject).flatMap((floor) =>
                        'floorPlan' in floor ? (floor.floorPlan?.stairs ?? []) : []
                      )
                    : []
                ).find((entry: Stair) => entry.id === stairId)
                if (!stair) continue
                const nextPoints = stair.points.filter(
                  (_: Point2, idx: number) => !indices.includes(idx)
                )
                if (nextPoints.length >= 2) updateStair(stairId, { points: nextPoints })
                else deleteStair(stairId)
              }
              clearSelection()
            },
            variant: 'danger',
          })
        }

        const wallDeletionPlan = buildWallSelectionDeletionPlan({
          walls: activeFloor.floorPlan.walls,
          selectedWallIds: selectionState.type === 'wall' ? selectionState.ids : [],
          selectedPointIndices,
          selectedSegmentIndices,
        })
        if (
          wallDeletionPlan.wholeWallIds.length > 0 ||
          wallDeletionPlan.pointIndicesByWall.size > 0 ||
          wallDeletionPlan.segmentIndicesByWall.size > 0
        ) {
          items.unshift({ label: '', onClick: () => {}, separator: true })
          items.unshift({
            label: t('contextMenu.delete', 'Delete'),
            onClick: deleteSelectedWallGeometry,
            variant: 'danger',
          })
        }

        const canCopyFloorPlanSelection =
          selectedWallsForCopy.length > 0 || selectedStairsForCopy.length > 0
        if (canCopyFloorPlanSelection) {
          const sourceFloors = currentProjectFloors
          const hasTargetFloor = sourceFloors.some((floor) => floor.id !== activeFloorId)
          const openingCount =
            selectedOpeningsForCopy.doors.length + selectedOpeningsForCopy.windows.length
          items.unshift({ label: '', onClick: () => {}, separator: true })
          items.unshift({
            label: t('contextMenu.copyToFloor', 'Copy to floor...'),
            disabled: !hasTargetFloor,
            onClick: () => {
              if (!hasTargetFloor) return
              openDialog({
                type: 'custom',
                title: t('contextMenu.copyToFloor', 'Copy to floor...'),
                content: (
                  <CopyFloorPlanSelectionDialog
                    currentFloorId={activeFloorId}
                    floors={sourceFloors}
                    wallCount={selectedWallsForCopy.length}
                    stairCount={selectedStairsForCopy.length}
                    openingCount={openingCount}
                    onConfirm={(targetFloorIds, options) => {
                      handleCopySelectionToFloors(targetFloorIds, options)
                      useDialogStore.getState().closeDialog()
                    }}
                    onCancel={() => useDialogStore.getState().closeDialog()}
                  />
                ),
              })
            },
          })
        }

        const vertices: Array<{ wallId: string; pointIndex: number; point: Point2 }> = []
        for (const [wallId, indices] of selectedPointIndices.entries()) {
          const wall = activeFloor.floorPlan.walls.find((w: Wall) => w.id === wallId)
          if (!wall) continue
          for (const idx of indices) {
            const p = wall.points[idx]
            if (p) vertices.push({ wallId, pointIndex: idx, point: p })
          }
        }
        if (vertices.length === 2) {
          const a = vertices[0]!
          const b = vertices[1]!
          const dist = Math.sqrt((b.point.x - a.point.x) ** 2 + (b.point.y - a.point.y) ** 2)
          const MERGE_THRESHOLD = 1.0
          if (dist <= MERGE_THRESHOLD) {
            items.unshift({ label: '', onClick: () => {}, separator: true })
            items.unshift({
              label: t('contextMenu.mergePoints', 'Merge Points'),
              onClick: () => {
                const ok = useProjectStore
                  .getState()
                  .mergeWallPoints(activeFloorId, a.wallId, a.pointIndex, b.wallId, b.pointIndex)
                if (ok) useUIStore.getState().setSelection({ type: null, ids: [] })
              },
            })
          }
        }
      }
      return items
    },
    [
      baseGetContextMenuItems,
      isFloorPlanMode,
      activeFloor,
      activeFloorId,
      activeTool,
      hasPlanImage,
      selectedPointIndices,
      selectedSegmentIndices,
      deleteSelectedWallGeometry,
      selectedWallsForCopy,
      selectedStairsForCopy,
      selectedOpeningsForCopy.doors,
      selectedOpeningsForCopy.windows,
      openDialog,
      handleCopySelectionToFloors,
      t,
      handleDeleteSelectedPlanImage,
      canDeleteItems,
      canEditFloorPlan,
      clearSelection,
      currentProjectFloors,
    ]
  )

  // Get selection bounds for selection visual feedback (reads live drag overrides from planDragVisualStore)
  const handleGetSelectionBounds = useCallback(
    function () {
      const { selection } = useUIStore.getState()
      if (selection.ids.length === 0) return null
      // A selected cable: frame its runs on this floor, so F finds it.
      const project = useProjectStore.getState().currentProject
      const floorId = useUIStore.getState().activeFloorId
      if (isCableRoutesEnabled() && project && floorId) {
        const cableBounds = selectedCableBounds(
          selection,
          estimateCableRoutesCached(project).routes,
          floorId
        )
        if (cableBounds) return cableBounds
      }
      const tempDragPositions = usePlanDragVisualStore.getState().positions

      const floorIdForPlacements = useUIStore.getState().activeFloorId ?? ''
      const floorPlacements = getPlacementsByFloor(floorIdForPlacements)
      const store = useProjectStore.getState()
      const currentInst = store.currentProject
        ? selectProjectElectricalInstallation(store.currentProject)
        : undefined

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      let found = false

      if (selection.type === 'graphicElement') {
        const floor = store.getFloorById(floorIdForPlacements)
        for (const element of floor?.floorPlan?.graphicElements ?? []) {
          if (!selection.ids.includes(element.id)) continue
          minX = Math.min(minX, element.pos.x - element.width / 2)
          minY = Math.min(minY, element.pos.y - element.height / 2)
          maxX = Math.max(maxX, element.pos.x + element.width / 2)
          maxY = Math.max(maxY, element.pos.y + element.height / 2)
          found = true
        }
        if (!found) return null
        return {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
        }
      }

      if (selection.type === 'ground' && selection.ids.includes('ground')) {
        const earthingRow = floorPlacements.find(
          (row: Placement) => (row as Placement & { isEarthing?: boolean }).isEarthing
        )
        if (earthingRow) {
          const pos = tempDragPositions.get(earthingRow.id) ?? earthingRow.pos
          const bounds = getPlacementWorldBoundsMemo(
            pos,
            earthingRow.rotationDeg,
            earthingRow.scale,
            1,
            'earthing'
          )
          const width = bounds.right - bounds.left
          const height = bounds.bottom - bounds.top
          if (width > 0 && height > 0) {
            return { x: bounds.left, y: bounds.top, width, height }
          }
        }
        return null
      }

      // Helper: true if any of the candidateIds is in the current selection
      const isAnyIdSelected = (candidateIds: string[]) =>
        candidateIds.some((id) => id && selection.ids.includes(id))

      floorPlacements.forEach((row: Placement) => {
        const placement = row as Placement & {
          endpointId?: string
          trunkDeviceId?: string
          junctionPanelLabel?: string
          isEarthing?: boolean
        }
        const pos = tempDragPositions.get(placement.id) ?? placement.pos

        if (placement.isEarthing) {
          if (!selection.ids.includes('ground')) return
          const bounds = getPlacementWorldBoundsMemo(
            pos,
            placement.rotationDeg,
            placement.scale,
            1,
            'earthing'
          )
          minX = Math.min(minX, bounds.left)
          minY = Math.min(minY, bounds.top)
          maxX = Math.max(maxX, bounds.right)
          maxY = Math.max(maxY, bounds.bottom)
          found = true
          return
        }

        // Junction panels: selection may contain trunkDevice ids (device ids) and/or the placement id.
        if (placement.junctionPanelLabel != null) {
          const jpLabel = placement.junctionPanelLabel
          const candidateIds: string[] = [placement.id]

          if (currentInst) {
            const labelMatchesJunction = (d: { type: string; label: string }) =>
              d.type === 'junction_panel' && d.label === jpLabel

            currentInst.mainSupply?.supplyTrunkDevices
              ?.filter(labelMatchesJunction)
              .forEach((d: { id: string }) => candidateIds.push(d.id))
            currentInst.groundTrunkDevices
              ?.filter(labelMatchesJunction)
              .forEach((d: { id: string }) => candidateIds.push(d.id))
            ;(store.currentProject
              ? selectProjectElectricalPanels(store.currentProject)
              : []
            ).forEach((panel: Panel) => {
              const circuits = [
                ...(panel.circuits ?? []),
                ...(panel.protections?.flatMap((pr) => pr.circuits ?? []) ?? []),
              ]
              circuits.forEach((c) =>
                c.trunkDevices
                  ?.filter(labelMatchesJunction)
                  .forEach((d: { id: string }) => candidateIds.push(d.id))
              )
            })
          }

          if (!isAnyIdSelected(candidateIds)) return

          const bounds = getPlacementWorldBoundsMemo(
            pos,
            placement.rotationDeg,
            placement.scale,
            1,
            'junction_panel'
          )
          minX = Math.min(minX, bounds.left)
          minY = Math.min(minY, bounds.top)
          maxX = Math.max(maxX, bounds.right)
          maxY = Math.max(maxY, bounds.bottom)
          found = true
          return
        }

        // Keep persistent selection bounds in sync with marquee hit-testing for
        // both endpoint- and trunk-device-backed placements.
        const owner = resolvePlanMarqueePlacementOwner(
          placement,
          getEndpointById,
          (id) => store.getTrunkDeviceById(id)?.device
        )
        if (!owner) return

        const { endpoint, selectionIds, socketCount, symbol } = owner
        const candidateIds = [...selectionIds]

        // Panel symbols: also include panel id so panel selection contributes to bounds
        if (endpoint?.symbol === 'panel_distribution' && store.currentProject) {
          const panel = resolvePanelForDistributionEndpoint(store.currentProject, endpoint)
          if (panel) candidateIds.push(panel.id)
        }

        if (!isAnyIdSelected(candidateIds)) return

        const bounds = getPlacementWorldBoundsMemo(
          pos,
          placement.rotationDeg,
          placement.scale,
          socketCount,
          symbol
        )
        minX = Math.min(minX, bounds.left)
        minY = Math.min(minY, bounds.top)
        maxX = Math.max(maxX, bounds.right)
        maxY = Math.max(maxY, bounds.bottom)
        found = true
      })

      if (!found) return null
      return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      }
    },
    [getPlacementWorldBoundsMemo, getEndpointById, getPlacementsByFloor]
  )

  const handleAddElementSelect = useCallback(
    (symbol: SymbolMetadata, position: Point) => {
      handleDrop(position, symbol)
      applyAddElementDropPosition(null)
    },
    [handleDrop]
  )
  const handleQuickPlacerDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!quickPlacerVisible || quickPlacerMode !== 'slow' || !quickPlacerDraggedPlacementId)
        return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
    },
    [quickPlacerVisible, quickPlacerMode, quickPlacerDraggedPlacementId]
  )
  const handleQuickPlacerDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const placementId =
        event.dataTransfer.getData('application/x-eendra-quick-placer') ||
        event.dataTransfer.getData('text/plain') ||
        quickPlacerDraggedPlacementIdRef.current
      if (!quickPlacerVisible || quickPlacerMode !== 'slow' || !placementId) return

      event.preventDefault()
      event.stopPropagation()
      const nextPos = clientToPlan(event.clientX, event.clientY)
      const didApply = nextPos ? applyQuickPlacerPlacement(placementId, nextPos) : false
      if (didApply) {
        const placement = getPlacementById(placementId)
        const endpoint = placement?.endpointId ? getEndpointById(placement.endpointId) : null
        trackGoogleAnalyticsEvent('quick_placer_place', {
          canvas: 'plan',
          placement_method: 'quick_placer',
          mode: 'slow',
          endpoint_type: endpoint?.type,
          symbol_id: endpoint?.symbol,
        })
        applySelection({ type: 'placement', ids: [placementId] })
      } else {
        showQuickPlacerHint('Situation Plan only', event.clientX, event.clientY, 'error')
      }
      applyQuickPlacerDraggedPlacementId(null)
      quickPlacerDraggedPlacementIdRef.current = null
    },
    [
      quickPlacerVisible,
      quickPlacerMode,
      clientToPlan,
      applyQuickPlacerPlacement,
      getEndpointById,
      getPlacementById,
      applySelection,
      showQuickPlacerHint,
      applyQuickPlacerDraggedPlacementId,
    ]
  )

  useEffect(
    function () {
      if (!quickPlacerVisible || quickPlacerMode !== 'slow') return

      const clearQuickPlacerTouchDrag = () => {
        applyQuickPlacerDraggedPlacementId(null)
        quickPlacerDraggedPlacementIdRef.current = null
      }

      const handleTouchDragEnd = (event: Event) => {
        const customEvent = event as CustomEvent<{
          placementId: string
          x: number
          y: number
        }>
        const { placementId, x, y } = customEvent.detail
        if (!placementId) return

        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect) {
          clearQuickPlacerTouchDrag()
          return
        }

        const insidePlan = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
        if (!insidePlan) {
          showQuickPlacerHint('Situation Plan only', x, y, 'error')
          clearQuickPlacerTouchDrag()
          return
        }

        const nextPos = clientToPlan(x, y)
        const didApply = nextPos ? applyQuickPlacerPlacement(placementId, nextPos) : false
        if (didApply) {
          const placement = getPlacementById(placementId)
          const endpoint = placement?.endpointId ? getEndpointById(placement.endpointId) : null
          trackGoogleAnalyticsEvent('quick_placer_place', {
            canvas: 'plan',
            placement_method: 'quick_placer',
            mode: 'slow',
            endpoint_type: endpoint?.type,
            symbol_id: endpoint?.symbol,
            input_type: 'touch',
          })
          applySelection({ type: 'placement', ids: [placementId] })
        } else {
          showQuickPlacerHint('Situation Plan only', x, y, 'error')
        }
        clearQuickPlacerTouchDrag()
      }

      window.addEventListener('quickplacertouchdragend', handleTouchDragEnd)
      return () => window.removeEventListener('quickplacertouchdragend', handleTouchDragEnd)
    },
    [
      quickPlacerVisible,
      quickPlacerMode,
      clientToPlan,
      applyQuickPlacerPlacement,
      getEndpointById,
      getPlacementById,
      applySelection,
      showQuickPlacerHint,
      applyQuickPlacerDraggedPlacementId,
    ]
  )
  const handleQuickPlacerFastOverlayPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      handleQuickPlacerFastPlace(event.clientX, event.clientY)
    },
    [handleQuickPlacerFastPlace]
  )
  const handleQuickPlacerFastOverlayPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      applyQuickPlacerFastPreviewClient({ x: event.clientX, y: event.clientY })
    },
    [applyQuickPlacerFastPreviewClient]
  )
  const handleQuickPlacerFastOverlayPointerLeave = useCallback(
    function () {
      applyQuickPlacerFastPreviewClient(null)
    },
    [applyQuickPlacerFastPreviewClient]
  )
  const handleQuickPlacerFastOverlayContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      handleQuickPlacerFastSkip(event.clientX, event.clientY)
    },
    [handleQuickPlacerFastSkip]
  )
  const projectionGuideStrokeCanvas = screenPxToCanvasUnits(
    planView.zoom,
    DRAW_TOOL_PROJECTION_GUIDE_STROKE_PX,
    DRAW_TOOL_PROJECTION_GUIDE_STROKE_PX_MIN,
    DRAW_TOOL_PROJECTION_GUIDE_STROKE_PX_MAX
  )
  const projectionGuideDashCanvas = screenPxToCanvasUnits(planView.zoom, DRAW_TOOL_DASH_PX, 2, 10)
  const projectionGuideLabelFontSize = 13 / planView.zoom
  const projectionGuideLabelPaddingX = 8 / planView.zoom
  const projectionGuideLabelPaddingY = 4 / planView.zoom
  const projectionGuideLabelOffsetY = 10 / planView.zoom

  // Each symbol takes wires in two parts: its core sits above the plan wires (the symbol wins),
  // while the outer ring sits below them, so a wire between close symbols stays grabbable.
  const renderPlanWireSymbolHits = (core: boolean) =>
    activeTool === 'wiring' &&
    !isExporting &&
    visiblePlacements.map(
      (
        placement: Placement & {
          endpointId?: string
          trunkDeviceId?: string
          junctionPanelLabel?: string
          isEarthing?: boolean
        }
      ) => {
        const placementPos = planDragPositions.get(placement.id) ?? placement.pos
        const symbolHalf = (baseSymbolSizePx * (placement.scale ?? 1)) / 2
        const fullRadius = Math.max(screenPxToCanvasUnits(planView.zoom, 14, 8, 28), symbolHalf)
        const radius = core
          ? Math.min(fullRadius, Math.max(symbolHalf, screenPxToCanvasUnits(planView.zoom, 7, 4, 14)))
          : fullRadius
        const armed = planWireDragSourcePlacementId === placement.id
        const hovered = planWireHoverPlacementId === placement.id
        const status = hovered || armed ? getPlanWireTargetStatus(placement.id) : null
        const stroke =
          !core && (armed || status === 'legal')
            ? '#0ea5e9'
            : !core && status === 'illegal'
              ? '#ef4444'
              : undefined
        return (
          <Circle
            key={`plan-wire-symbol-hit-${core ? 'core' : 'ring'}-${placement.id}`}
            x={placementPos.x}
            y={placementPos.y}
            radius={radius}
            fill="rgba(14,165,233,0.001)"
            stroke={stroke}
            strokeWidth={stroke ? screenPxToCanvasUnits(planView.zoom, 2, 1, 4) : 0}
            listening
            onMouseEnter={() => {
              applyPlanWireHoverPlacementId(placement.id)
              applyPlanWirePreviewPoint(placementPos)
            }}
            onMouseLeave={() => {
              applyPlanWireHoverPlacementId((current) =>
                current === placement.id ? null : current
              )
            }}
            onPointerDown={(event) => {
              event.cancelBubble = true
              if (event.evt.button != null && event.evt.button !== 0) return
              if (getPlanWireTargetStatus(placement.id) !== 'legal') return
              applyPlanWireDragSourcePlacementId(placement.id)
              applyPlanWirePreviewPoint(placementPos)
            }}
            onPointerUp={(event) => {
              event.cancelBubble = true
              if (event.evt.button != null && event.evt.button !== 0) return
              const sourcePlacementId = planWireDragSourcePlacementId
              applyPlanWireDragSourcePlacementId(null)
              applyPlanWirePreviewPoint(null)
              if (!sourcePlacementId || sourcePlacementId === placement.id) return
              if (getPlanWireTargetStatus(placement.id) !== 'legal') return
              handleDrawPlanWire(sourcePlacementId, placement.id)
            }}
          />
        )
      }
    )

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
          <div
            data-app-modal-backdrop="true"
            className="fixed inset-0 z-[100]"
            onClick={() => applyGraphicElementDropPicker(null)}
            onContextMenu={(event) => {
              event.preventDefault()
              applyGraphicElementDropPicker(null)
            }}
          >
            <div
              className="absolute w-48 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-800"
              style={{
                left: Math.max(
                  8,
                  Math.min(graphicElementDropPicker.clientAnchor.x, window.innerWidth - 208)
                ),
                top: Math.max(
                  8,
                  Math.min(graphicElementDropPicker.clientAnchor.y, window.innerHeight - 300)
                ),
                maxHeight: 'min(18rem, calc(100vh - 1rem))',
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                onClick={() => handleAddNoteFromContextMenu(graphicElementDropPicker.planPosition)}
              >
                <span className="w-5 shrink-0 text-center text-[0.6rem] font-bold leading-none">
                  Aa
                </span>
                <span>{t('floorPlanTools.placeNote')}</span>
              </button>
              {PLAN_GRAPHIC_ELEMENT_ASSETS.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                  onClick={() =>
                    handleAddGraphicElementFromContextMenu(
                      graphicElementDropPicker.planPosition,
                      asset.id
                    )
                  }
                >
                  <img
                    src={asset.svgPath}
                    alt=""
                    className="h-5 w-5 shrink-0 object-contain dark:invert"
                  />
                  <span>{t(asset.labelKey, asset.label)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {canPlaceSymbols && planDropCircuitPicker && (
          <PlanDropCircuitPanel
            key={planDropCircuitPicker.endpointIds.join(',')}
            nonModal={libraryArmed}
            avoidBounds={containerRef.current?.getBoundingClientRect()}
            onCloseButton={() => {
              if (useUIStore.getState().armedLibrarySymbol != null) {
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
                    const sel = useUIStore.getState().selection
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
        <BaseCanvas
          key={`plan-base-canvas-${activeFloorId ?? 'none'}-${planView.gridSize}`}
          ref={canvasRef}
          gestureZoomCanvas="plan"
          cursor={
            activeTool !== 'none' &&
            activeTool !== 'select' &&
            activeTool !== 'move' &&
            activeTool !== 'movePoint'
              ? 'crosshair'
              : undefined
          }
          zoom={planView.zoom}
          pan={planView.pan}
          showGrid={planView.showGrid}
          gridSize={gridSize}
          onZoomChange={handleZoomChange}
          onPanChange={handlePanChange}
          onViewTransformCommit={handleViewTransformCommit}
          onDrop={canPlaceSymbols ? handleDrop : undefined}
          onDragOver={canPlaceSymbols ? handleLibraryDragOver : undefined}
          onFilesDrop={canPlaceSymbols ? handlePlanFilesDrop : undefined}
          onFindElementsInRectangle={handleFindElementsInRectangle}
          onCaptureRectangle={handleCaptureRectangle}
          onGetContextMenuItems={
            canDeleteItems || canEditFloorPlan || canPlaceSymbols
              ? handleGetContextMenuItems
              : undefined
          }
          onGetSelectionBounds={handleGetSelectionBounds}
          onPrepareFitToView={preparePlanFitToView}
          onMultiFingerSwipe={onMultiFingerSwipe}
          onViewportPanStateChange={handleViewportPanStateChange}
          onViewportPixelSizeChange={applyPlanCanvasViewportPx}
          
          gridInTransformedLayer={true}
          // Treat 75 as “full” intensity; anything above is clamped visually.
          gridOpacity={(Math.min(planView.gridIntensity ?? 75, 75) / 75) * 0.75}
          disableContentHitGraph={suppressPlanHitTesting}
          overlayChildren={
            isFloorPlanMode && suppressPlanHitTesting && !isExporting ? (
              <FloorPlanMode
                activeFloorId={activeFloorId}
                activeFloor={activeFloor}
                currentProject={currentProject}
                planView={planView}
                gridSize={gridSize}
                tempPxPerMeter={tempPxPerMeter}
                activeTool={isExporting ? 'none' : activeTool}
                setActiveTool={applyActiveTool}
                onExitDrawMode={() => applyFloorPlanModeAndClearSelection(false)}
                selectedGraphicAssetId={selectedGraphicAssetId}
                onWallHover={handleWallHover}
                onProjectedSnapGuidesChange={applyProjectedSnapGuides}
                onOpeningPreviewOverrideChange={handleOpeningPreviewOverrideChange}
                onOpeningInserted={(kind) => {
                  applyOpeningSelectionArmedTool(kind === 'door' ? 'insertDoor' : 'insertWindow')
                }}
              />
            ) : null
          }
        >
          <>
            <Group name="canvas-content">
              {/* Plan Image (visibility and opacity from SitplanVisibilityPanel) */}
              {planImage && planVisibility.groundPlansVisible && (
                <Group
                  x={planImagePosition.x}
                  y={planImagePosition.y}
                  rotation={planImageRotationDeg}
                  listening={activeTool === 'move' && !isResettingScale}
                  draggable={canEditFloorPlan && activeTool === 'move'}
                  onDragStart={() => {
                    clearSelection()
                    if (activeFloorId) applySelectedPlanImageId(activeFloorId)
                  }}
                  onDragEnd={(e) => {
                    setPlanImagePosition({
                      x: e.target.x(),
                      y: e.target.y(),
                    })
                  }}
                  onClick={(e: PlanCanvasInputEvent) => {
                    if ('button' in e.evt && e.evt.button != null && e.evt.button !== 0) return
                    handlePlanImageClick()
                  }}
                  onContextMenu={handlePlanImageClick}
                  onTap={handlePlanImageClick}
                >
                  <Image
                    ref={setPlanImageRef}
                    onTransformEnd={handlePlanImageTransformEnd}
                    image={planImage}
                    width={planImageDisplayWidth}
                    height={planImageDisplayHeight}
                    {...{ [PLAN_BACKGROUND_FLOOR_ATTR]: activeFloorId ?? undefined }}
                    opacity={
                      isResettingScale
                        ? 0.5
                        : (activeFloor?.planImageOpacity ?? planVisibility.groundPlansOpacity) / 100
                    }
                  />

                  {/* Show old scale reference if exists - only when resetting scale, inside the plan image group so it transforms with it */}
                  {activeFloor?.scale?.reference && isResettingScale && !isExporting && (
                    <Line
                      points={[
                        activeFloor.scale.reference.p1.x,
                        activeFloor.scale.reference.p1.y,
                        activeFloor.scale.reference.p2.x,
                        activeFloor.scale.reference.p2.y,
                      ]}
                      stroke="#9ca3af"
                      strokeWidth={2}
                      dash={[5, 5]}
                      opacity={0.5}
                    />
                  )}

                  {activeTool === 'move' && !isExporting && (
                    <Transformer
                      ref={setTransformerRef}
                      // Plan size comes from scale calibration; move mode only rotates.
                      resizeEnabled={false}
                      rotationSnaps={PLAN_IMAGE_ROTATION_SNAPS}
                      rotationSnapTolerance={5}
                    />
                  )}
                </Group>
              )}

              {/* Reference underlay: other floors (plan image + walls), draw mode and plan-image move mode.
                  Editing aid only: never part of an export. */}
              {!isExporting &&
                ((isFloorPlanMode && planFloorOverlayIds.length > 0) ||
                  (!isFloorPlanMode &&
                    activeTool === 'move' &&
                    movePlanOverlayFloorIds.length > 0)) && (
                <PlanFloorReferenceOverlays
                  overlayFloorIds={isFloorPlanMode ? planFloorOverlayIds : movePlanOverlayFloorIds}
                  zoom={planView.zoom}
                  themeMode={theme.mode}
                  targetPxPerMeter={calculatePxPerMeter(activeFloor ?? null)}
                  planVisibility={planVisibility}
                  customWallColors={theme.wallColors}
                />
              )}

              {/* Floor Plan Mode - interactive overlays and drawing tools */}
              {isFloorPlanMode && !suppressPlanHitTesting && !isExporting && (
                <FloorPlanMode
                  activeFloorId={activeFloorId}
                  activeFloor={activeFloor}
                  currentProject={currentProject}
                  planView={planView}
                  gridSize={gridSize}
                  tempPxPerMeter={tempPxPerMeter}
                  previewPxPerMeter={pxPerMeter}
                  activeTool={isExporting ? 'none' : activeTool}
                  setActiveTool={applyActiveTool}
                  onExitDrawMode={() => applyFloorPlanModeAndClearSelection(false)}
                  selectedGraphicAssetId={selectedGraphicAssetId}
                  onWallHover={handleWallHover}
                  onProjectedSnapGuidesChange={applyProjectedSnapGuides}
                  onOpeningPreviewOverrideChange={handleOpeningPreviewOverrideChange}
                  onOpeningInserted={(kind) => {
                    applyOpeningSelectionArmedTool(kind === 'door' ? 'insertDoor' : 'insertWindow')
                  }}
                />
              )}

              {/* Floor plan geometry: always visible when floor has floorPlan */}
              {activeFloor?.floorPlan && (
                <StairRenderer
                  stairs={stairsForRender}
                  activeTool={isExporting ? 'none' : activeTool}
                  themeMode={theme.mode}
                  zoom={planView.zoom}
                  pxPerMeter={canvasPxPerMeter}
                  renderMode="geometry"
                  spiralRotationPreview={spiralRotationPreview}
                  selectedStairId={isExporting ? null : selectedStairId}
                  hoveredStairId={isExporting ? null : hoveredStairId}
                  selectedPointIndices={
                    isExporting ? EMPTY_POINT_SELECTION : selectedStairPointIndices
                  }
                  onStairSelect={(stairId, event) => {
                    const isMultiSelect = !!(
                      event &&
                      (event.shiftKey || event.ctrlKey || event.metaKey)
                    )
                    if (!isMultiSelect) {
                      applySelection({ type: 'stair', ids: [stairId] })
                      applySelectedStairPointIndices(new Map())
                      return
                    }
                    const { wallPoints: nextWalls, stairPoints: nextStairs } =
                      getCurrentMixedPointSelection()
                    const existing = nextStairs.get(stairId) ?? []
                    const allPoints =
                      stairsForRender.find((s) => s.id === stairId)?.points.map((_, idx) => idx) ??
                      []
                    const alreadyWhole =
                      existing.length === allPoints.length &&
                      existing.every((idx) => allPoints.includes(idx))
                    if (alreadyWhole) {
                      nextStairs.delete(stairId)
                    } else if (allPoints.length > 0) {
                      nextStairs.set(stairId, allPoints)
                    }
                    const ids = buildEncodedFloorPointIds(nextWalls, nextStairs)
                    applySelectedStairPointIndices(nextStairs)
                    applySelection(
                      ids.length > 0 ? { type: 'wallPoint', ids } : { type: null, ids: [] }
                    )
                  }}
                  onStairHover={applyHoveredStairId}
                  onStairDragStart={(_stairId, e) => {
                    const canvasPoint = makeCanvasPointFromEvent(e)
                    if (!canvasPoint) return
                    beginStairSelectionDrag(canvasPoint, 'free')
                  }}
                  onStairDragMove={(_stairId, e) => {
                    const canvasPoint = makeCanvasPointFromEvent(e)
                    if (!canvasPoint) return
                    updateStairSelectionDrag(canvasPoint)
                  }}
                  onStairDragEnd={(_stairId, e) => {
                    const canvasPoint = makeCanvasPointFromEvent(e)
                    if (canvasPoint) updateStairSelectionDrag(canvasPoint)
                    endStairSelectionDrag()
                  }}
                  onStairPointSelect={(stairId, pointIndex, event) => {
                    const isMultiSelect = !!(
                      event &&
                      (event.shiftKey || event.ctrlKey || event.metaKey)
                    )
                    if (!isMultiSelect) {
                      applySelection({ type: 'stairPoint', ids: [stairId, String(pointIndex)] })
                      applySelectedStairPointIndices(new Map([[stairId, [pointIndex]]]))
                      return
                    }
                    const { wallPoints: nextWalls, stairPoints: nextStairs } =
                      getCurrentMixedPointSelection()
                    const existing = nextStairs.get(stairId) ?? []
                    const alreadySelected = existing.includes(pointIndex)
                    if (alreadySelected) {
                      const updated = existing.filter((idx) => idx !== pointIndex)
                      if (updated.length > 0) nextStairs.set(stairId, updated)
                      else nextStairs.delete(stairId)
                    } else {
                      nextStairs.set(
                        stairId,
                        [...existing, pointIndex].sort((a, b) => a - b)
                      )
                    }
                    const ids = buildEncodedFloorPointIds(nextWalls, nextStairs)
                    applySelectedStairPointIndices(nextStairs)
                    applySelection(
                      ids.length > 0 ? { type: 'wallPoint', ids } : { type: null, ids: [] }
                    )
                  }}
                  onStairPointDragStart={handleStairPointDragStart}
                  onStairPointMove={handleStairPointMove}
                  onStairPointDragEnd={handleStairPointDragEnd}
                />
              )}
              {!isExporting && (
                <WallScanPreviewLayer
                  floorId={activeFloor?.id ?? null}
                  pxPerMeter={canvasPxPerMeter}
                  zoom={planView.zoom}
                  theme={theme.mode}
                />
              )}
              {activeFloor?.floorPlan && (
                <WallRenderer
                  walls={wallsForRender}
                  doors={doorsForRender}
                  windows={windowsForRender}
                  // Interpret master wall thickness as centimeters and convert to px in WallRenderer using pxPerMeter.
                  masterWallThickness={activeFloor.floorPlan.masterWallThickness}
                  pxPerMeter={canvasPxPerMeter}
                  interactionMode={activeTool}
                  zoom={planView.zoom}
                  selectedWallIds={isExporting ? EMPTY_WALL_SELECTION_IDS : selectedWallIds}
                  selectedPointIndices={isExporting ? EMPTY_POINT_SELECTION : selectedPointIndices}
                  selectedSegmentIndices={
                    isExporting ? EMPTY_POINT_SELECTION : selectedSegmentIndices
                  }
                  showSegmentMeasurements={isFloorPlanMode && activeTool !== 'none' && !isExporting}
                  onSegmentLengthCommit={commitWallSegmentLength}
                  onOpeningDistanceCommit={commitWallOpeningDistance}
                  onSegmentDimensionDrag={handleWallDimensionDrag}
                  hoveredWallId={shouldHandleWallHover && !isExporting ? hoveredWallId : null}
                  hoveredDoorId={isFloorPlanMode && !isExporting ? hoveredDoorId : null}
                  hoveredWindowId={isFloorPlanMode && !isExporting ? hoveredWindowId : null}
                  previewOpening={
                    isFloorPlanMode && !isExporting && openingPreview?.valid
                      ? {
                          wallId: openingPreview.wallId,
                          position: openingPreview.position,
                          width: openingPreview.width,
                          kind: openingPreview.kind,
                          doorSwing: openingPreview.doorSwing,
                          doorDirection: openingPreview.doorDirection,
                        }
                      : null
                  }
                  onWallClick={(wallId, e) => {
                    if (!isPrimaryPlanActivationEvent(e.evt)) return
                    e.cancelBubble = true
                    const stage = e.target.getStage()
                    const pointer = stage?.getPointerPosition()
                    const isMultiSelect = !!(
                      e.evt &&
                      (e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey)
                    )
                    if (activeTool === 'select') {
                      if (isMultiSelect) retainDirectOpeningSelectionForMixed()
                      else clearMixedOpeningSelection()
                    }
                    const canvasPoint: Point2 | null =
                      stage && pointer
                        ? {
                            x: (pointer.x - planView.pan.x) / planView.zoom,
                            y: (pointer.y - planView.pan.y) / planView.zoom,
                          }
                        : null
                    if (activeTool === 'insertPoint' && activeFloor?.floorPlan) {
                      if (canvasPoint) {
                        const walls = activeFloor.floorPlan.walls
                        const wall = walls.find((w: Wall) => w.id === wallId)
                        if (wall && !isCurvedWall(wall)) {
                          const segmentIndex = getNearestSegmentIndex(wall, canvasPoint)
                          const newPoints = handleInsertPoint(
                            wall,
                            segmentIndex,
                            canvasPoint,
                            gridSize,
                            planView.snapToGrid
                          )
                          updateWall(wallId, { points: newPoints })
                        }
                      }
                    } else if (
                      activeTool === 'clipWall' &&
                      activeFloorId &&
                      activeFloor?.floorPlan
                    ) {
                      const walls = activeFloor.floorPlan.walls
                      const wall = walls.find((w: Wall) => w.id === wallId)
                      if (wall && !isCurvedWall(wall)) {
                        const { walls: newWalls } = handleClipWall(
                          wall,
                          walls,
                          canvasPoint ?? undefined
                        )
                        const isNoOp = newWalls.length === 1 && newWalls[0]?.id === wall.id
                        if (!isNoOp) {
                          withSingleUndoEntry(
                            () => {
                              deleteWall(wallId)
                              const minLengthSq = 100
                              newWalls.forEach((w) => {
                                const pts = w.points
                                let degenerate = pts.length < 2
                                if (!degenerate && pts.length === 2) {
                                  const dx = pts[1]!.x - pts[0]!.x
                                  const dy = pts[1]!.y - pts[0]!.y
                                  degenerate = dx * dx + dy * dy < minLengthSq
                                }
                                if (!degenerate) {
                                  addWall(activeFloorId, {
                                    floorId: activeFloorId,
                                    points: w.points,
                                    thickness: w.thickness,
                                  })
                                }
                              })
                              return true
                            },
                            { sessionLabel: 'clip wall' }
                          )
                          applySelection({ type: null, ids: [] })
                          applyClipPreviewPoints(null)
                        }
                        return
                      }
                    }
                    const liveSelection = useUIStore.getState().selection
                    const isWallScopedOrSelected =
                      liveSelection.type === 'wall'
                        ? liveSelection.ids.includes(wallId)
                        : liveSelection.type === 'wallPoint'
                          ? parseWallPointIds(liveSelection.ids).has(wallId)
                          : false
                    if (
                      activeTool === 'select' &&
                      activeFloor?.floorPlan &&
                      canvasPoint &&
                      (isWallScopedOrSelected || isMultiSelect)
                    ) {
                      const wall = activeFloor.floorPlan.walls.find((w: Wall) => w.id === wallId)
                      if (wall && !isCurvedWall(wall) && wall.points.length >= 2) {
                        const segmentIndex = getNearestSegmentIndex(wall, canvasPoint)
                        if (segmentIndex >= 0 && segmentIndex < wall.points.length - 1) {
                          const endpointIndices = [segmentIndex, segmentIndex + 1]
                          if (!isMultiSelect) {
                            applySelectedPointIndices(new Map([[wallId, endpointIndices]]))
                            applySelectedSegmentIndices(new Map([[wallId, [segmentIndex]]]))
                            applySelection({ type: 'wall', ids: [wallId] })
                            return
                          }
                          const { wallPoints: nextPoints, stairPoints: nextStairs } =
                            getCurrentMixedPointSelection()
                          const nextSegments = new Map(selectedSegmentIndices)
                          const existingPoints = nextPoints.get(wallId) ?? []
                          const mergedPoints = Array.from(
                            new Set([...existingPoints, ...endpointIndices])
                          ).sort((a, b) => a - b)
                          nextPoints.set(wallId, mergedPoints)
                          const existingSegments = nextSegments.get(wallId) ?? []
                          const mergedSegments = Array.from(
                            new Set([...existingSegments, segmentIndex])
                          ).sort((a, b) => a - b)
                          nextSegments.set(wallId, mergedSegments)
                          applySelectedPointIndices(nextPoints)
                          applySelectedStairPointIndices(nextStairs)
                          applySelectedSegmentIndices(nextSegments)
                          if (nextStairs.size > 0) {
                            const ids = buildEncodedFloorPointIds(nextPoints, nextStairs)
                            applySelection(
                              ids.length > 0 ? { type: 'wallPoint', ids } : { type: null, ids: [] }
                            )
                          } else {
                            applySelection({ type: 'wall', ids: Array.from(nextPoints.keys()) })
                          }
                          return
                        }
                      }
                    }
                    // Default wall selection: select the wall and all of its points for movement.
                    if (activeFloor?.floorPlan) {
                      const wall = activeFloor.floorPlan.walls.find((w: Wall) => w.id === wallId)
                      if (wall) {
                        const wallPointIndices = wall.points.map((_: Point2, idx: number) => idx)
                        if (isMultiSelect) {
                          const { wallPoints: nextWalls, stairPoints: nextStairs } =
                            getCurrentMixedPointSelection()
                          nextWalls.set(wallId, wallPointIndices)
                          applySelectedPointIndices(nextWalls)
                          applySelectedStairPointIndices(nextStairs)
                          applySelectedSegmentIndices(new Map())
                          if (nextStairs.size > 0 || selection.type === 'wallPoint') {
                            const ids = buildEncodedFloorPointIds(nextWalls, nextStairs)
                            applySelection(
                              ids.length > 0 ? { type: 'wallPoint', ids } : { type: null, ids: [] }
                            )
                          } else {
                            applySelection({ type: 'wall', ids: Array.from(nextWalls.keys()) })
                          }
                          return
                        }
                        applySelectedPointIndices(new Map([[wallId, wallPointIndices]]))
                        applySelectedSegmentIndices(new Map())
                      }
                    }
                    applySelection({ type: 'wall', ids: [wallId] })
                  }}
                  onWallDragStart={(_wallId, e) => {
                    const stage = e.target.getStage()
                    const pointer = stage?.getPointerPosition()
                    if (!stage || !pointer) return
                    const canvasPoint: Point2 = {
                      x: (pointer.x - planView.pan.x) / planView.zoom,
                      y: (pointer.y - planView.pan.y) / planView.zoom,
                    }
                    beginWallSelectionDrag(canvasPoint)
                  }}
                  onWallDragMove={(_wallId, e) => {
                    const stage = e.target.getStage()
                    const pointer = stage?.getPointerPosition()
                    if (!stage || !pointer) return
                    const canvasPoint: Point2 = {
                      x: (pointer.x - planView.pan.x) / planView.zoom,
                      y: (pointer.y - planView.pan.y) / planView.zoom,
                    }
                    updateWallSelectionDrag(canvasPoint)
                  }}
                  onWallDragEnd={(_wallId, e) => {
                    const stage = e.target.getStage()
                    const pointer = stage?.getPointerPosition()
                    if (stage && pointer) {
                      const canvasPoint: Point2 = {
                        x: (pointer.x - planView.pan.x) / planView.zoom,
                        y: (pointer.y - planView.pan.y) / planView.zoom,
                      }
                      updateWallSelectionDrag(canvasPoint)
                    }
                    endWallSelectionDrag()
                  }}
                  onWallMouseMove={
                    shouldHandleWallHover
                      ? (wallId, e) => {
                          const stage = e.target.getStage()
                          const pointer = stage?.getPointerPosition()
                          const canvasPoint: Point2 | null =
                            stage && pointer
                              ? {
                                  x: (pointer.x - planView.pan.x) / planView.zoom,
                                  y: (pointer.y - planView.pan.y) / planView.zoom,
                                }
                              : null
                          handleWallHover(wallId, canvasPoint)
                        }
                      : undefined
                  }
                  onWallMouseLeave={
                    shouldHandleWallHover
                      ? () => {
                          handleWallHover(null, null)
                        }
                      : undefined
                  }
                  onPointClick={(wallId, pointIndex, e) => {
                    if (!isPrimaryPlanActivationEvent(e.evt)) return
                    e.cancelBubble = true
                    applySelectedSegmentIndices(new Map())
                    const resolvedTarget = resolveScopedPointTarget(wallId, pointIndex, e)
                    if (!resolvedTarget) return
                    const targetWallId = resolvedTarget.wallId
                    const targetPointIndex = resolvedTarget.pointIndex
                    const isMultiSelect = !!(
                      e.evt &&
                      (e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey)
                    )
                    if (isMultiSelect) retainDirectOpeningSelectionForMixed()
                    else clearMixedOpeningSelection()
                    const currentMixedSelection = isMultiSelect
                      ? getCurrentMixedPointSelection()
                      : null

                    const baseWallPoints =
                      currentMixedSelection?.wallPoints ??
                      (selection.type === 'wallPoint'
                        ? parseWallPointIds(selection.ids)
                        : selectedPointIndices)
                    let next = new Map(baseWallPoints)
                    const nextStairs =
                      currentMixedSelection?.stairPoints ?? new Map<string, number[]>()

                    if (!isMultiSelect) {
                      next = new Map([[targetWallId, [targetPointIndex]]])
                    } else {
                      const existing = next.get(targetWallId) ?? []
                      const alreadySelected = existing.includes(targetPointIndex)
                      if (alreadySelected) {
                        const updated = existing.filter((i) => i !== targetPointIndex)
                        if (updated.length > 0) {
                          next.set(targetWallId, updated)
                        } else {
                          next.delete(targetWallId)
                        }
                      } else {
                        next.set(
                          targetWallId,
                          [...existing, targetPointIndex].sort((a, b) => a - b)
                        )
                      }
                    }

                    if (nextStairs.size > 0) {
                      applySelectedStairPointIndices(nextStairs)
                    } else if (selectedStairPointIndices.size > 0) {
                      applySelectedStairPointIndices(new Map())
                    }

                    const floorPointIds = buildEncodedFloorPointIds(next, nextStairs)
                    const wallIds = Array.from(next.keys())
                    if (floorPointIds.length === 0) {
                      applySelection({ type: null, ids: [] })
                    } else if (nextStairs.size === 0 && wallIds.length > 0) {
                      applySelection({ type: 'wallPoint', ids: floorPointIds })
                    } else {
                      applySelection({ type: 'wallPoint', ids: floorPointIds })
                    }
                  }}
                  onPointDragStart={(wallId, pointIndex) => {
                    if (
                      scopedWallIdForVertexSelection &&
                      wallId !== scopedWallIdForVertexSelection
                    ) {
                      return
                    }
                    const walls = activeFloor?.floorPlan?.walls ?? []
                    if (!walls.length) {
                      pointDragTargetsRef.current = []
                      vertexDragInitialOpeningsRef.current = null
                      vertexDragAnchorRef.current = null
                      vertexDragInitialPointsRef.current = null
                      return
                    }

                    const activeWallPoints =
                      selection.type === 'wallPoint'
                        ? parseWallPointIds(selection.ids)
                        : selectedPointIndices
                    const isAlreadySelected =
                      activeWallPoints.get(wallId)?.includes(pointIndex) ?? false

                    let dragTargets: Array<{ wallId: string; pointIndex: number }> = []

                    if (activeWallPoints.size > 0 && isAlreadySelected) {
                      const mergedByWall = new Map<string, Set<number>>()
                      for (const [wid, indices] of activeWallPoints.entries()) {
                        for (const idx of indices) {
                          const merged = buildMergedPointTargets(walls, wid, idx)
                          if (merged.length === 0) {
                            let set = mergedByWall.get(wid)
                            if (!set) {
                              set = new Set<number>()
                              mergedByWall.set(wid, set)
                            }
                            set.add(idx)
                          } else {
                            for (const m of merged) {
                              let set = mergedByWall.get(m.wallId)
                              if (!set) {
                                set = new Set<number>()
                                mergedByWall.set(m.wallId, set)
                              }
                              set.add(m.pointIndex)
                            }
                          }
                        }
                      }
                      for (const [wid, set] of mergedByWall.entries()) {
                        for (const idx of set) {
                          dragTargets.push({ wallId: wid, pointIndex: idx })
                        }
                      }
                    } else {
                      dragTargets = buildMergedPointTargets(walls, wallId, pointIndex)
                    }

                    pointDragTargetsRef.current = dragTargets

                    if (!isAlreadySelected || activeWallPoints.size === 0) {
                      const nextPoints = new Map([[wallId, [pointIndex]]])
                      applySelection({
                        type: 'wallPoint',
                        ids: buildEncodedFloorPointIds(nextPoints, new Map()),
                      })
                    }

                    vertexDragAnchorRef.current = { wallId, pointIndex }
                    const initialByWall = new Map<string, Point2[]>()
                    for (const w of walls) {
                      initialByWall.set(
                        w.id,
                        w.points.map((p: Point2) => ({ x: p.x, y: p.y }))
                      )
                    }
                    vertexDragInitialPointsRef.current = initialByWall

                    const targets = pointDragTargetsRef.current
                    if (
                      targets.length === 1 &&
                      targets[0]!.wallId === wallId &&
                      targets[0]!.pointIndex === pointIndex
                    ) {
                      const wall = walls.find((w: Wall) => w.id === wallId)
                      if (wall && wall.points.length >= 2) {
                        const wallDoors = baseDoors.filter((d) => d.wallId === wallId)
                        const wallWindows = baseWindows.filter((w: Window) => w.wallId === wallId)
                        const bySegment = getOpeningsBySegment(wall.points, wallDoors, wallWindows)
                        const leftIdx = pointIndex - 1
                        const rightIdx = pointIndex
                        const snapshot = new Map<number, OpeningOnSegment[]>()
                        if (leftIdx >= 0 && bySegment.has(leftIdx))
                          snapshot.set(leftIdx, bySegment.get(leftIdx)!)
                        if (rightIdx < wall.points.length && bySegment.has(rightIdx))
                          snapshot.set(rightIdx, bySegment.get(rightIdx)!)
                        vertexDragInitialOpeningsRef.current = {
                          wallId,
                          pointIndex,
                          bySegment: snapshot,
                        }
                      } else {
                        vertexDragInitialOpeningsRef.current = null
                      }
                    } else {
                      vertexDragInitialOpeningsRef.current = null
                    }
                  }}
                  onPointDragMove={(wallId, pointIndex, newPos) => {
                    if (
                      scopedWallIdForVertexSelection &&
                      wallId !== scopedWallIdForVertexSelection
                    ) {
                      return
                    }
                    const walls = activeFloor?.floorPlan?.walls ?? []
                    if (!walls.length) return
                    if (pointDragTargetsRef.current.length === 0) {
                      pointDragTargetsRef.current = buildMergedPointTargets(
                        walls,
                        wallId,
                        pointIndex
                      )
                    }
                    // Run constraint every frame and return clamped position so handle stays at limit (no flicker).
                    const result = applyMergedPointMove(walls, newPos, false, 'preview')
                    return result?.overridePositions.get(`${wallId}:${pointIndex}`)
                  }}
                  onPointDragEnd={(wallId, pointIndex, newPos) => {
                    if (
                      scopedWallIdForVertexSelection &&
                      wallId !== scopedWallIdForVertexSelection
                    ) {
                      return
                    }
                    const walls = activeFloor?.floorPlan?.walls ?? []
                    if (!walls.length) return
                    if (pointDragTargetsRef.current.length === 0) {
                      pointDragTargetsRef.current = buildMergedPointTargets(
                        walls,
                        wallId,
                        pointIndex
                      )
                    }
                    // On release, snap the final position to the grid for all merged points.
                    applyMergedPointMove(walls, newPos, true, 'commit')
                    pointDragTargetsRef.current = []
                    vertexDragAnchorRef.current = null
                    vertexDragInitialPointsRef.current = null
                    applyPreviewWalls(null)
                    lastWallPointUpdateTimeRef.current = 0
                  }}
                  // In floor plan mode, always show wall points; only allow dragging when using the implicit select+move tool.
                  showPointHandles={isFloorPlanMode}
                  pointHandlesDraggable={isFloorPlanMode && activeTool === 'select'}
                  draggableSelectedWalls={isFloorPlanMode && activeTool === 'select'}
                  theme={theme.mode}
                  customWallColors={theme.wallColors}
                  selectedDoorIds={selectedDoorIds}
                  selectedWindowIds={selectedWindowIds}
                  onDoorClick={(doorId, e) => {
                    if (!isPrimaryPlanActivationEvent(e.evt)) return
                    // In insert-point mode, openings should not be selectable.
                    if (activeTool === 'insertPoint') {
                      e.cancelBubble = true
                      return
                    }
                    if (activeTool === 'insertDoor' && !canSelectDoorsInInsertMode) {
                      return
                    }
                    if (activeTool === 'insertWindow') {
                      return
                    }
                    e.cancelBubble = true
                    const isMultiSelect = !!(
                      e.evt &&
                      (e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey)
                    )
                    if (isMultiSelect) {
                      toggleMixedOpeningSelection('door', doorId)
                      return
                    }
                    clearMixedOpeningSelection()
                    applySelection({ type: 'door', ids: [doorId] })
                  }}
                  onDoorMouseEnter={(doorId) => applyHoveredDoorId(doorId)}
                  onDoorMouseLeave={() => applyHoveredDoorId(null)}
                  onWindowClick={(windowId, e) => {
                    if (!isPrimaryPlanActivationEvent(e.evt)) return
                    if (activeTool === 'insertPoint') {
                      e.cancelBubble = true
                      return
                    }
                    if (activeTool === 'insertWindow' && !canSelectWindowsInInsertMode) {
                      return
                    }
                    if (activeTool === 'insertDoor') {
                      return
                    }
                    e.cancelBubble = true
                    const isMultiSelect = !!(
                      e.evt &&
                      (e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey)
                    )
                    if (isMultiSelect) {
                      toggleMixedOpeningSelection('window', windowId)
                      return
                    }
                    clearMixedOpeningSelection()
                    applySelection({ type: 'window', ids: [windowId] })
                  }}
                  onWindowMouseEnter={(windowId) => applyHoveredWindowId(windowId)}
                  onWindowMouseLeave={() => applyHoveredWindowId(null)}
                  listening={shouldListenToWalls || doorsListening || windowsListening}
                  wallsListening={shouldListenToWalls}
                  doorsListening={doorsListening}
                  windowsListening={windowsListening}
                />
              )}

              {activeFloor?.floorPlan && graphicElementsForRender.length > 0 && (
                <PlanGraphicElementRenderer
                  elements={graphicElementsForRender}
                  selectedIds={selectedGraphicElementIds}
                  active={isFloorPlanMode && activeTool === 'select' && !isExporting}
                  zoom={planView.zoom}
                  canvasPxPerMeter={canvasPxPerMeter}
                  themeMode={theme.mode}
                  fontFamily={fontFamily}
                  snapFloorPoint={snapGraphicFloorPoint}
                  onSnapGuidesChange={applyVertexMoveProjectedSnapGuides}
                  onSelect={handleGraphicElementSelect}
                  onMove={handleGraphicElementMove}
                  onResize={handleGraphicElementResize}
                  onRotate={(elementId, rotationDeg) =>
                    updatePlanGraphicElement(elementId, { rotationDeg })
                  }
                />
              )}

              {activeFloor?.floorPlan && (
                <StairRenderer
                  stairs={stairsForRender}
                  activeTool={isExporting ? 'none' : activeTool}
                  themeMode={theme.mode}
                  zoom={planView.zoom}
                  pxPerMeter={canvasPxPerMeter}
                  renderMode="handles"
                  spiralRotationPreview={spiralRotationPreview}
                  onSpiralRotationPreviewChange={setSpiralRotationPreview}
                  selectedStairId={isExporting ? null : selectedStairId}
                  hoveredStairId={isExporting ? null : hoveredStairId}
                  selectedPointIndices={
                    isExporting ? EMPTY_POINT_SELECTION : selectedStairPointIndices
                  }
                  onStairSelect={(stairId, event) => {
                    const isMultiSelect = !!(
                      event &&
                      (event.shiftKey || event.ctrlKey || event.metaKey)
                    )
                    if (!isMultiSelect) {
                      applySelection({ type: 'stair', ids: [stairId] })
                      applySelectedStairPointIndices(new Map())
                      return
                    }
                    const { wallPoints: nextWalls, stairPoints: nextStairs } =
                      getCurrentMixedPointSelection()
                    const existing = nextStairs.get(stairId) ?? []
                    const allPoints =
                      stairsForRender.find((s) => s.id === stairId)?.points.map((_, idx) => idx) ??
                      []
                    const alreadyWhole =
                      existing.length === allPoints.length &&
                      existing.every((idx) => allPoints.includes(idx))
                    if (alreadyWhole) {
                      nextStairs.delete(stairId)
                    } else if (allPoints.length > 0) {
                      nextStairs.set(stairId, allPoints)
                    }
                    const ids = buildEncodedFloorPointIds(nextWalls, nextStairs)
                    applySelectedStairPointIndices(nextStairs)
                    applySelection(
                      ids.length > 0 ? { type: 'wallPoint', ids } : { type: null, ids: [] }
                    )
                  }}
                  onStairHover={applyHoveredStairId}
                  onStairDragStart={(_stairId, e) => {
                    const canvasPoint = makeCanvasPointFromEvent(e)
                    if (!canvasPoint) return
                    beginStairSelectionDrag(canvasPoint, 'free')
                  }}
                  onStairDragMove={(_stairId, e) => {
                    const canvasPoint = makeCanvasPointFromEvent(e)
                    if (!canvasPoint) return
                    updateStairSelectionDrag(canvasPoint)
                  }}
                  onStairDragEnd={(_stairId, e) => {
                    const canvasPoint = makeCanvasPointFromEvent(e)
                    if (canvasPoint) updateStairSelectionDrag(canvasPoint)
                    endStairSelectionDrag()
                  }}
                  onStairPointSelect={(stairId, pointIndex, event) => {
                    const isMultiSelect = !!(
                      event &&
                      (event.shiftKey || event.ctrlKey || event.metaKey)
                    )
                    if (!isMultiSelect) {
                      applySelection({ type: 'stairPoint', ids: [stairId, String(pointIndex)] })
                      applySelectedStairPointIndices(new Map([[stairId, [pointIndex]]]))
                      return
                    }
                    const { wallPoints: nextWalls, stairPoints: nextStairs } =
                      getCurrentMixedPointSelection()
                    const existing = nextStairs.get(stairId) ?? []
                    const alreadySelected = existing.includes(pointIndex)
                    if (alreadySelected) {
                      const updated = existing.filter((idx) => idx !== pointIndex)
                      if (updated.length > 0) nextStairs.set(stairId, updated)
                      else nextStairs.delete(stairId)
                    } else {
                      nextStairs.set(
                        stairId,
                        [...existing, pointIndex].sort((a, b) => a - b)
                      )
                    }
                    const ids = buildEncodedFloorPointIds(nextWalls, nextStairs)
                    applySelectedStairPointIndices(nextStairs)
                    applySelection(
                      ids.length > 0 ? { type: 'wallPoint', ids } : { type: null, ids: [] }
                    )
                  }}
                  onStairPointDragStart={handleStairPointDragStart}
                  onStairPointMove={handleStairPointMove}
                  onStairPointDragEnd={handleStairPointDragEnd}
                  getCanvasPointFromEvent={makeCanvasPointFromEvent}
                  onSpiralRotationChange={(stairId, rotationDeg) =>
                    updateStair(stairId, { spiralRotationDeg: rotationDeg })
                  }
                />
              )}

              <PlanInsertPointPreview
                insertPointPreview={insertPointPreview}
                isVisible={
                  !isExporting &&
                  isFloorPlanMode &&
                  activeTool === 'insertPoint' &&
                  !hoveredDoorId &&
                  !hoveredWindowId
                }
                themeMode={theme.mode}
                zoom={planView.zoom}
              />

              {/* Selection move handles for walls/points in draw mode */}
              {isFloorPlanMode &&
                !isExporting &&
                activeTool === 'select' &&
                wallSelectionBounds &&
                renderDirectionalMoveHandles(
                  wallSelectionBounds,
                  (anchor, mode) => beginWallSelectionDrag(anchor, mode),
                  updateWallSelectionDrag,
                  (point) => {
                    if (point) updateWallSelectionDrag(point)
                    endWallSelectionDrag()
                  }
                )}
              {isFloorPlanMode &&
                !isExporting &&
                activeTool === 'select' &&
                stairSelectionBounds &&
                renderDirectionalMoveHandles(
                  stairSelectionBounds,
                  (anchor, mode) => beginStairSelectionDrag(anchor, mode),
                  updateStairSelectionDrag,
                  (point) => {
                    if (point) updateStairSelectionDrag(point)
                    endStairSelectionDrag()
                  }
                )}
              <PlanOpeningResizeHandles
                activeFloor={activeFloor}
                doorsForRender={doorsForRender}
                getCanvasPointFromEvent={makeCanvasPointFromEvent}
                isVisible={
                  !isExporting &&
                  isFloorPlanMode &&
                  activeTool === 'select' &&
                  (selection.type === 'door' || selection.type === 'window') &&
                  selection.ids.length === 1
                }
                onDragStart={(drag) => {
                  doorDragRef.current = drag
                }}
                onDragMove={(pointer) => {
                  applyOpeningMoveFromPointer(pointer, 'preview')
                }}
                onDragEnd={(pointer) => {
                  if (pointer) {
                    applyOpeningMoveFromPointer(pointer, 'commit')
                  }
                  doorDragRef.current = null
                }}
                selection={selection}
                toolMoveHandleColor={toolMoveHandleColor}
                toolMoveHandleStrokeColor={toolMoveHandleStrokeColor}
                windowsForRender={windowsForRender}
                zoom={planView.zoom}
              />
              <PlanOpeningWidthEditor
                fontFamily={fontFamily}
                getCanvasPointFromEvent={makeCanvasPointFromEvent}
                isActive={openingWidthEditorActive && !isExporting}
                onActivate={() => {
                  if (canEditFloorPlan) setOpeningWidthEditorActive(true)
                }}
                onDimensionDragStart={beginOpeningDimensionDrag}
                onDimensionDragMove={(pointer, modifiers) =>
                  applyOpeningDimensionDrag(pointer, 'preview', modifiers)
                }
                onDimensionDragEnd={endOpeningDimensionDrag}
                opening={selectedOpeningForWidthEditor}
                themeMode={theme.mode}
                valueText={openingWidthText || ''}
                zoom={planView.zoom}
              />

              {isFloorPlanMode &&
                !isExporting &&
                activeTool === 'clipWall' &&
                clipPreviewPoints &&
                clipPreviewPoints.length >= 2 && (
                  <Line
                    points={clipPreviewPoints.flatMap((p) => [p.x, p.y])}
                    stroke="#ef4444"
                    strokeWidth={screenPxToCanvasUnits(planView.zoom, 4, 2, 8)}
                    dash={[
                      screenPxToCanvasUnits(planView.zoom, 8, 4, 14),
                      screenPxToCanvasUnits(planView.zoom, 6, 3, 12),
                    ]}
                    lineCap="round"
                    lineJoin="round"
                    listening={false}
                  />
                )}

              {renderPlanWireSymbolHits(false)}

              {!suppressHeavyLayersWhilePanning && planWireRoutes.length > 0 && (
                <Group name="plan-wires-opacity" opacity={planSymbolAndWireOpacity}>
                  <PlanWiresLayerWithDrag
                    // Exports keep the plan-scaled wire width; only the live view keeps a screen minimum.
                    zoom={isExporting ? undefined : planView.zoom}
                    routes={planWireRoutes}
                    junctionPanelPlacements={junctionPanelPlanPlacements}
                    highlightedRouteIds={highlightedPlanWireRouteIds}
                    hoveredRouteIds={hoveredPlanWireRouteIds}
                    routeStrokeFor={planWireStrokeFor}
                    routeStyle={planWiringVisibility.defaultStyle}
                    theme={theme.mode}
                    clientToPlan={clientToPlan}
                    getEndpointById={getEndpointById}
                    getTrunkDeviceById={(id) =>
                      useProjectStore.getState().getTrunkDeviceById(id)?.device
                    }
                    active={activeTool === 'wiring' && !isExporting}
                    onInsertWaypoint={handleInsertPlanWireWaypoint}
                    onMoveWaypoint={handleMovePlanWireWaypoint}
                    onMoveRiser={handleMovePlanWireRiser}
                    onRemoveWaypoint={handleRemovePlanWireWaypoint}
                    raisedRiserRouteIds={raisedRiserRouteIds}
                    riserPreview={planWireRiserPreview}
                    onRiserPreviewChange={applyPlanWireRiserPreview}
                    selectedRiserRouteIds={selectedRiserRouteIds}
                    onMoveRisers={handleMovePlanWireRisers}
                  />
                </Group>
              )}
              {activeTool === 'wiring' && planWirePreview && !isExporting && (
                <PlanWireDragPreview preview={planWirePreview} zoom={planView.zoom} />
              )}
              {isCableRoutesEnabled() && activeFloorId && !isExporting && (
                <PlanSelectedCableRoutes
                  floorId={activeFloorId}
                  zoom={planView.zoom}
                  theme={theme.mode}
                />
              )}
              {}

              {/* Render placements (symbols) - only visible by category */}
              {!suppressHeavyLayersWhilePanning && (
                <Group name="plan-symbols-opacity" opacity={planSymbolAndWireOpacity}>
                  <PlanPlacementSymbolsLayer
                    placements={visiblePlacements}
                    baseSymbolSizePx={baseSymbolSizePx}
                    currentZoom={effectivePlanZoom}
                    isDrawingToolActive={placementInteractivitySuppressed}
                    canDrag={canDragItems}
                    snapPosition={stableSnapPlacementPosition}
                    quickPlacerPlacementId={currentQuickPlacerFastItem?.placement.id}
                    multiSelectHandlers={stableMultiSelectHandlers}
                    getSingleDragHandlers={getSingleDragHandlers}
                    fontFamily={fontFamily}
                  />
                </Group>
              )}

              {/* Symbol labels above wires and symbols */}
              {!suppressHeavyLayersWhilePanning && planVisibility.labelsVisible && (
                <Group
                  listening={false}
                  name="plan-symbol-labels"
                  opacity={planSymbolAndWireOpacity}
                >
                  <PlanPlacementLabelsLayer
                    placements={visiblePlacements}
                    labelPositions={labelPositions}
                    labelFontSize={planLabelFontSize}
                  />
                </Group>
              )}

              {!isExporting && libraryDropPreview && (
                <Group
                  x={libraryDropPreview.pos.x}
                  y={libraryDropPreview.pos.y}
                  opacity={0.6}
                  listening={false}
                >
                  <CatalogSymbolImage
                    symbolId={libraryDropPreview.symbolId}
                    width={baseSymbolSizePx}
                    height={baseSymbolSizePx}
                    fallbackStroke="#0284c7"
                  />
                </Group>
              )}

              {!isExporting && quickPlacerFastPreviewPlacement && currentQuickPlacerFastItem && (
                <>
                  <PlacementSymbol
                    placement={quickPlacerFastPreviewPlacement}
                    baseSymbolSizePx={baseSymbolSizePx}
                    currentZoom={effectivePlanZoom}
                    isDrawingToolActive
                  />
                  {planVisibility.labelsVisible &&
                    currentQuickPlacerFastItem.endpoint.label &&
                    quickPlacerFastPreviewLabelPosition && (
                      <PlacementLabel
                        endpoint={currentQuickPlacerFastItem.endpoint}
                        labelPosition={quickPlacerFastPreviewLabelPosition}
                        labelFontSize={planLabelFontSize}
                      />
                    )}
                </>
              )}

              {renderPlanWireSymbolHits(true)}

              {/* The selected cable's floor passages sit above the symbols: dragging one of them
                  wins over rewiring from the symbol it overlaps. */}
              {!suppressHeavyLayersWhilePanning && raisedRiserRoutes.length > 0 && (
                <PlanWiresLayerWithDrag
                  // Exports keep the plan-scaled wire width; only the live view keeps a screen minimum.
                  zoom={isExporting ? undefined : planView.zoom}
                  routes={raisedRiserRoutes}
                  riserHandlesOnly
                  junctionPanelPlacements={junctionPanelPlanPlacements}
                  routeStyle={planWiringVisibility.defaultStyle}
                  theme={theme.mode}
                  clientToPlan={clientToPlan}
                  getEndpointById={getEndpointById}
                  getTrunkDeviceById={(id) =>
                    useProjectStore.getState().getTrunkDeviceById(id)?.device
                  }
                  active={activeTool === 'wiring' && !isExporting}
                  onMoveRiser={handleMovePlanWireRiser}
                  riserPreview={planWireRiserPreview}
                  onRiserPreviewChange={applyPlanWireRiserPreview}
                  selectedRiserRouteIds={selectedRiserRouteIds}
                  onMoveRisers={handleMovePlanWireRisers}
                />
              )}

              {/* Plan debug overlay: centers, bounds, labels, orientation helpers (dev builds only) */}
              {process.env.NODE_ENV !== 'production' && (
                <PlanDebugOverlay
                  placements={
                    placements as Array<
                      Placement & { endpointId?: string; junctionPanelLabel?: string }
                    >
                  }
                  visiblePlacements={
                    visiblePlacements as Array<
                      Placement & { endpointId?: string; junctionPanelLabel?: string }
                    >
                  }
                  labelPositions={labelPositions}
                  baseSymbolSizePx={baseSymbolSizePx}
                  planLabelFontSize={planLabelFontSize}
                  getEndpointById={getEndpointById}
                  getPlacementWorldBoundsMemo={getPlacementWorldBoundsMemo}
                />
              )}

              {/* Notes layer - render last so they appear on top of everything */}
              {!suppressHeavyLayersWhilePanning &&
                sitplanNotes
                  .filter((note: Note) => note.floorId === activeFloorId)
                  .map((note: Note) => (
                    <PlanNote
                      key={note.id}
                      note={note}
                      interactive={planNotesInteractive}
                      onDragEnd={(noteId, newPos) => {
                        updateSitplanNote(noteId, { pos: newPos })
                      }}
                    />
                  ))}

              <PlanMultiSelectFrame
                canDrag={canDragItems && !placementInteractivitySuppressed && !isExporting}
                effectivePlanZoom={effectivePlanZoom}
                getSelectionBounds={handleGetSelectionBounds}
                frameDragHandlers={selectionFrameDragHandlers}
              />

              {/* Projection guides on top of all canvas content */}
              {!isExporting &&
                [...projectedSnapGuides, ...vertexMoveProjectedSnapGuides].map((guide, index) => {
                  const dx = guide.to.x - guide.from.x
                  const dy = guide.to.y - guide.from.y
                  const lengthPx = Math.sqrt(dx * dx + dy * dy)
                  const lengthCentimeters = (lengthPx / canvasPxPerMeter) * 100
                  const label = `${lengthCentimeters.toFixed(1)} cm`
                  const midX = (guide.from.x + guide.to.x) / 2
                  const midY = (guide.from.y + guide.to.y) / 2
                  const approxCharWidth = projectionGuideLabelFontSize * 0.6
                  const textWidth = Math.max(24 / planView.zoom, label.length * approxCharWidth)
                  const boxWidth = textWidth + projectionGuideLabelPaddingX * 2
                  const boxHeight = projectionGuideLabelFontSize + projectionGuideLabelPaddingY * 2
                  const boxX = midX - boxWidth / 2
                  const boxY = midY - boxHeight / 2 - projectionGuideLabelOffsetY

                  return (
                    <Group key={`top-projected-snap-guide-${index}`} listening={false}>
                      <Line
                        points={[guide.from.x, guide.from.y, guide.to.x, guide.to.y]}
                        stroke={DRAW_TOOL_PROJECTION_GUIDE_COLOR}
                        strokeWidth={projectionGuideStrokeCanvas}
                        dash={[projectionGuideDashCanvas, projectionGuideDashCanvas]}
                        lineCap="round"
                        lineJoin="round"
                      />
                      {!guide.hideDistanceLabel && (
                        <>
                          <Rect
                            x={boxX}
                            y={boxY}
                            width={boxWidth}
                            height={boxHeight}
                            fill={
                              theme.mode === 'dark'
                                ? 'rgba(17,24,39,0.9)'
                                : 'rgba(243,244,246,0.95)'
                            }
                            stroke={DRAW_TOOL_PROJECTION_GUIDE_COLOR}
                            strokeWidth={projectionGuideStrokeCanvas}
                            cornerRadius={screenPxToCanvasUnits(planView.zoom, 4, 2, 8)}
                          />
                          <Text
                            x={boxX}
                            y={boxY}
                            width={boxWidth}
                            height={boxHeight}
                            align="center"
                            verticalAlign="middle"
                            text={label}
                            fontSize={projectionGuideLabelFontSize}
                            fontFamily={fontFamily}
                            fill={DRAW_TOOL_PROJECTION_GUIDE_COLOR}
                          />
                        </>
                      )}
                    </Group>
                  )
                })}

              {/* Scale Ruler Drawing (when resetting scale) - render last so it stays on top of all canvas content */}
              <PlanScaleRulerCanvasLayer
                activeFloorId={activeFloorId}
                getFloorById={getFloorById}
                handleScaleRulerCancel={handleScaleRulerCancel}
                handleScaleRulerComplete={(p1, p2, meters) =>
                  handleScaleRulerComplete(p1, p2, meters, planImagePosition)
                }
                isResettingScale={isResettingScale && !isExporting}
                planImage={planImage}
                planImagePosition={planImagePosition}
                scaleRulerCommitSignal={scaleRulerCommitSignal}
                scaleRulerMeters={scaleRulerMeters}
                setScaleRulerMeters={applyScaleRulerMeters}
                setScaleRulerMetersInput={applyScaleRulerMetersInput}
                setScaleRulerPoints={applyScaleRulerPoints}
                zoom={planView.zoom}
              />
              {}
            </Group>
          </>
        </BaseCanvas>

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
                  if (e.key === 'Enter' && scaleRulerMeters != null && scaleRulerPoints.p1 && scaleRulerPoints.p2 && createPlanScaleReference(scaleRulerPoints.p1, scaleRulerPoints.p2, scaleRulerMeters)) {
                    applyScaleRulerCommitSignal((s) => s + 1)
                  } else if (e.key === 'Escape') {
                    handleScaleRulerCancel()
                  }
                }}
              />
              <button
                type="button"
                onClick={() => applyScaleRulerCommitSignal((s) => s + 1)}
                disabled={scaleRulerMeters == null || !scaleRulerPoints.p1 || !scaleRulerPoints.p2 || !createPlanScaleReference(scaleRulerPoints.p1, scaleRulerPoints.p2, scaleRulerMeters)}
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
          onZoomChange={handleZoomChange}
          onPanChange={handlePanChange}
          onFitToView={handleFitToView}
          canvasType="plan"
        />

        {/* Breadcrumb - positioned at top center, below toolbar
          Shows hierarchy for selected panel, circuit, or endpoint */}
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

        {/* Left-side tools for plan canvas (non-draw mode) */}
        {canPlaceSymbols && !isFloorPlanMode && (
          <CanvasFloatingControlRail
            side="left"
            verticalAlign="center"
            topOverlayInsetPx={68}
            zIndex={30}
            dataCanvasOverlayAnchor="left"
          >
            <>
              <FloatingControl
                icon={<QuickPlacerToolIcon awaitingCount={awaitingPlanPlacementCount} />}
                label={t('quickPlacer.title')}
                tooltipDescription={
                  awaitingPlanPlacementCount > 0
                    ? t('quickPlacer.unplaced.count', { count: awaitingPlanPlacementCount })
                    : undefined
                }
                variant="tool"
                side="left"
                active={quickPlacerOpen || quickPlacerDocked}
                primary={false}
                onClick={() => {
                  if (quickPlacerOpen) {
                    closeQuickPlacer()
                  } else {
                    openQuickPlacerAtFirstAwaiting()
                  }
                }}
              />

              <FloatingControl
                icon={<WiringIcon className="w-6 h-6" />}
                label={t('planWiring.tool')}
                tooltipDescription={t('planWiring.toolDescription')}
                variant="tool"
                side="left"
                active={activeTool === 'wiring'}
                primary
                onClick={() => {
                  applyActiveTool(activeTool === 'wiring' ? 'none' : 'wiring')
                }}
              />

              {/* Draw mode toggle */}
              <FloatingControl
                icon={<DrawModeIcon className="w-6 h-6" />}
                label={t('floorPlanTools.drawMode')}
                variant="tool"
                side="left"
                primary={false}
                triggerTestId="e2e-plan-enter-draw-mode"
                onClick={() => {
                  applyFloorPlanModeAndClearSelection(true)
                }}
              />

              <>
                {/* Upload floorplan */}
                <FloatingControl
                  icon={<UploadFloorIcon className="w-6 h-6" />}
                  label={t('canvas.uploadFloorPlan')}
                  variant="tool"
                  side="left"
                  triggerTestId="e2e-plan-upload-floor"
                  onClick={() => {
                    setPendingImportFile(null)
                    applyIsImportDialogOpen(true)
                  }}
                />

                {/* Move floor (plan image) */}
                <FloatingControl
                  icon={<MoveFloorIcon className="w-6 h-6" />}
                  label={t('planTools.movePlanImage')}
                  tooltipDescription={
                    hasPlanImage ? undefined : t('planTools.uploadFloorPlanFirst')
                  }
                  variant="tool"
                  side="left"
                  active={hasPlanImage && activeTool === 'move'}
                  disabled={!hasPlanImage}
                  onClick={() => {
                    if (!hasPlanImage) return
                    applyActiveTool(activeTool === 'move' ? 'none' : 'move')
                  }}
                />

                {/* Change scale */}
                <FloatingControl
                  icon={<ScaleIcon className="w-6 h-6" />}
                  label={t('planTools.resetScale')}
                  tooltipDescription={
                    hasPlanImage ? undefined : t('planTools.uploadFloorPlanFirst')
                  }
                  variant="tool"
                  side="left"
                  active={hasPlanImage && activeTool === 'resetScale'}
                  disabled={!hasPlanImage}
                  onClick={() => {
                    if (!hasPlanImage) return
                    if (activeTool === 'resetScale') {
                      if (isResettingScale) {
                        handleScaleRulerCancel()
                      } else {
                        applyActiveTool('none')
                      }
                    } else {
                      handleResetScaleStart()
                    }
                  }}
                />
              </>
            </>
          </CanvasFloatingControlRail>
        )}

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
        {planWiresColorCoded && !isExporting && <PlanWireLegend />}

        {/* Floating right-side controls: grid, floors, visibility */}
        <CanvasFloatingControlRail
          side="right"
          verticalAlign="top"
          offsetPx={12}
          topOffsetPx={12}
          zIndex={30}
          menuOpen={openMenu !== null}
          dataCanvasOverlayAnchor="right"
          dataCanvasOverlayPosition="top-right"
        >
          <>
            {/* Grid menu (rounded square) */}
            <FloatingControl
              icon={<GridIcon className="w-6 h-6 text-gray-700 dark:text-gray-200" />}
              label={t('canvas.grid')}
              variant="menu"
              side="right"
              open={openMenu === 'grid'}
              onOpenChange={(next) => applyOpenMenu(next ? 'grid' : null)}
            >
              <div className="rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg p-3 min-w-[220px] space-y-3 text-xs">
                <div className="space-y-1">
                  <label className="flex items-center gap-2 text-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={planView.showGrid}
                      onChange={(e) => applyPlanView({ showGrid: e.target.checked })}
                      className="rounded border-gray-400"
                    />
                    <span>{t('canvas.grid')}</span>
                  </label>
                  {canEditFloorPlan && (
                    <>
                      <label className="flex items-center gap-2 text-gray-700 dark:text-gray-200">
                        <input
                          type="checkbox"
                          checked={planView.snapToGrid}
                          onChange={(e) => applyPlanView({ snapToGrid: e.target.checked })}
                          className="rounded border-gray-400"
                        />
                        <span>{t('canvas.snap')}</span>
                      </label>
                      <label className="flex items-center gap-2 text-gray-700 dark:text-gray-200">
                        <input
                          type="checkbox"
                          checked={planView.snapToProjection ?? true}
                          onChange={(e) => applyPlanView({ snapToProjection: e.target.checked })}
                          className="rounded border-gray-400"
                        />
                        <span>{t('canvas.projectedSnap')}</span>
                      </label>
                    </>
                  )}
                </div>
                <div className="space-y-1">
                  <PlanGridSizeControl
                    gridSize={planView.gridSize}
                    language={i18n.language}
                    label={t('canvas.gridSize')}
                    onGridSizeChange={(gridSize) => applyPlanView({ gridSize })}
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-gray-600 dark:text-gray-300">
                    <span>{t('canvas.gridOpacity')}</span>
                    <span className="tabular-nums">
                      {Math.round((Math.min(planView.gridIntensity ?? 75, 75) / 75) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={planView.gridIntensity ?? 75}
                    onChange={(e) => applyPlanView({ gridIntensity: Number(e.target.value) })}
                    className="w-full h-1.5 rounded appearance-none bg-gray-300 dark:bg-gray-600"
                  />
                </div>
              </div>
            </FloatingControl>

            {/* Floor selector (rounded square) */}
            <FloatingControl
              icon={<FloorIcon className="w-6 h-6 text-gray-700 dark:text-gray-200" />}
              label={t('floorSelection.selectFloor')}
              variant="menu"
              side="right"
              open={openMenu === 'floor'}
              onOpenChange={(next) => applyOpenMenu(next ? 'floor' : null)}
            >
              <div className="rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg p-3 min-w-[360px] max-w-[min(92vw,460px)] text-xs">
                <FloorSelectionDialog
                  currentFloorId={activeFloorId}
                  showReferenceOverlayToggles={isFloorPlanMode}
                  allowFloorDuplication
                  readOnly={!canEditFloorPlan}
                  onSelect={(floorId, options) => {
                    applyActiveFloor(floorId)
                    if (options?.fitToView) {
                      requestAnimationFrame(() => {
                        requestFitToView(['plan'])
                      })
                    }
                    if (options?.closeMenu ?? true) {
                      applyOpenMenu(null)
                    }
                  }}
                  onCancel={() => applyOpenMenu(null)}
                />
              </div>
            </FloatingControl>

            {/* Visibility (rounded square) */}
            <FloatingControl
              icon={<VisibilityIcon className="w-6 h-6 text-gray-700 dark:text-gray-200" />}
              label={t('sitplanVisibility.title')}
              variant="menu"
              side="right"
              mobileMenuFitCanvas
              open={openMenu === 'visibility'}
              onOpenChange={(next) => applyOpenMenu(next ? 'visibility' : null)}
            >
              <SitplanVisibilityPanel readOnly={!canEditFloorPlan} />
            </FloatingControl>
          </>
        </CanvasFloatingControlRail>

        {canPlaceSymbols && (
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
