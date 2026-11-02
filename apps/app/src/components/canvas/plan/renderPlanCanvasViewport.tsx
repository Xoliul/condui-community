import type { usePlanDragHandling } from '@/hooks/plan/usePlanDragHandling'
import type { usePlanWallGeometryActions } from '@/hooks/plan/usePlanWallGeometryActions'
import type { usePlanQuickPlacerPreview } from '@/hooks/plan/usePlanQuickPlacerPreview'
import type { usePlanOpeningGestures } from '@/hooks/plan/usePlanOpeningGestures'
import type { usePlanGeometryGestureState } from '@/hooks/plan/usePlanGeometryGestureState'
import type { usePlanGeometrySelectionDrag } from '@/hooks/plan/usePlanGeometrySelectionDrag'
import type { usePlanGeometrySnapping } from '@/hooks/plan/usePlanGeometrySnapping'
import type { usePlanGeometrySelection } from '@/hooks/plan/usePlanGeometrySelection'
import type { usePlanWallVertexGestures } from '@/hooks/plan/usePlanWallVertexGestures'
import type { usePlanCanvasSelectionBounds } from '@/hooks/plan/usePlanCanvasSelectionBounds'
import type { usePlanCanvasWiringModel } from '@/hooks/plan/usePlanCanvasWiringModel'
import type { usePlanCanvasMarqueeSelection } from '@/hooks/plan/usePlanCanvasMarqueeSelection'
import type { usePlanLibraryDropController } from '@/hooks/plan/usePlanLibraryDropController'
import type { usePlanCanvasGeometry } from '@/hooks/plan/usePlanCanvasGeometry'
import { renderPlanStairHandles } from '@/components/canvas/plan/renderPlanStairHandles'
import { renderPlanStairGeometry } from '@/components/canvas/plan/renderPlanStairGeometry'
import { renderPlanWallGeometry } from '@/components/canvas/plan/renderPlanWallGeometry'
import {
  PLAN_IMAGE_ROTATION_SNAPS,
  PlanCanvasInputEvent,
} from '@/components/canvas/plan/planCanvasBindings'
import { PlanDirectionalMoveHandles } from '@/components/canvas/plan/PlanDirectionalMoveHandles'
import { PlanWireWaypointPreviewLayer } from '@/components/canvas/plan/PlanWiresLayer'
import { PlanWirePointerPreview } from '@/components/canvas/plan/PlanWirePointerPreview'
import React from 'react'
import type Konva from 'konva'
import { Image, Group, Transformer, Line } from 'react-konva'

import { CatalogSymbolImage } from '@/components/canvas/eendraad/CatalogSymbolImage'
import type { Point } from '@/types/ui'
import type { Placement, Note } from '@/types/schema'
import BaseCanvas from '@/components/canvas/BaseCanvas'
import {
  PlanNote,
  PlanMultiSelectFrame,
  PlanPlacementLabelsLayer,
  PlanPlacementSymbolsLayer,
  PlacementSymbol,
  PlacementLabel,
  PlanWiresLayerWithDrag,
  FloorPlanMode,
  PlanFloorReferenceOverlays,
  PlanGraphicElementRenderer,
  PlanInsertPointPreview,
  PlanOpeningResizeHandles,
  PlanOpeningWidthEditor,
} from '@/components/canvas/plan'
import { PlanDebugOverlay } from '@/components/canvas/plan/PlanDebugOverlay'
import { PlanRemoteSelections } from '@/components/canvas/plan/PlanRemoteSelections'
import { PlanProjectionGuides } from '@/components/canvas/plan/PlanProjectionGuides'


import { PlanSelectedCableRoutes } from '@/components/cableRouting/PlanSelectedCableRoutes'
import { isCableRoutesEnabled } from '@/lib/cableRouting/availability'

import { calculatePxPerMeter } from '@/hooks/plan/usePlanScale'

import { PLAN_BACKGROUND_FLOOR_ATTR } from '@/lib/plan/graphicElements'
import { ZOOM_100, screenPxToCanvasUnits } from '@/constants/canvasConstants'
import { planWireActiveStroke } from '@/lib/plan/planWiring'

import { PlanScaleRulerCanvasLayer } from '@/components/canvas/plan/PlanScaleRulerCanvasLayer'

interface PlanCanvasViewportOptions {
  activeFloorId: string | null
  planView: import('@/types/ui').ViewState
  canvasRef: React.RefObject<import('@/components/canvas/BaseCanvas').BaseCanvasHandle | null>
  activeTool: import('@/types/ui').PlanToolMode
  planMinZoom: ReturnType<typeof usePlanCanvasGeometry>['planMinZoom']
  gridSize: ReturnType<typeof usePlanCanvasGeometry>['gridSize']
  handleZoomChange: (zoom: number) => void
  handlePanChange: (pan: { x: number; y: number }) => void
  handleViewTransformCommit: (patch: {
    pan?: import('@/types/ui').Point | undefined
    zoom?: number | undefined
  }) => void
  canPlaceSymbols: boolean
  handleDrop: ReturnType<typeof usePlanLibraryDropController>['handleDrop']
  handleLibraryDragOver: ReturnType<typeof usePlanLibraryDropController>['handleLibraryDragOver']
  handlePlanFilesDrop: ReturnType<typeof usePlanLibraryDropController>['handlePlanFilesDrop']
  handleFindElementsInRectangle: ReturnType<
    typeof usePlanCanvasMarqueeSelection
  >['handleFindElementsInRectangle']
  handleCaptureRectangle: ReturnType<typeof usePlanCanvasWiringModel>['handleCaptureRectangle']
  canDeleteItems: boolean
  canEditFloorPlan: boolean
  handleGetContextMenuItems: (
    position: import('@/types/ui').Point,
    elementId: string | null
  ) => import('@/components/common/ContextMenu').ContextMenuItem[]
  handleGetSelectionBounds: ReturnType<
    typeof usePlanCanvasSelectionBounds
  >['handleGetSelectionBounds']
  preparePlanFitToView: () => void
  onMultiFingerSwipe:
    | ((
        direction: 'left' | 'right' | 'up' | 'down',
        fingerCount: number,
        startClientX: number
      ) => void)
    | undefined
  handleViewportPanStateChange: (isPanning: boolean) => void
  applyPlanCanvasViewportPx: (size: { width: number; height: number } | null) => void
  

  

  enablePlanSingleFingerPan: boolean
  floorPlanTouchDragToolActive: boolean
  suppressPlanHitTesting: boolean
  isExporting: boolean
  waypointPreviewStore: import('zustand/vanilla').StoreApi<{
    preview: import('@/hooks/plan/usePlanWireWaypointPreview').PlanWireWaypointPreview | null
  }>
  planWiringVisibility: import('@/lib/plan/planWiring').ResolvedPlanWiringVisibility
  theme: import('@/types/ui').Theme
  canvasPxPerMeter: number
  getEndpointById: (id: string) => import('@/types/schema').Endpoint | undefined
  getPlanWireTrunkDeviceById: (id: string) => import('@/types/schema').TrunkDevice | undefined
  junctionPanelPlanPlacements: ReturnType<
    typeof usePlanCanvasWiringModel
  >['junctionPanelPlanPlacements']
  planWireStrokeFor: ReturnType<typeof usePlanCanvasWiringModel>['planWireStrokeFor']
  clientToPlan: (clientX: number, clientY: number) => import('@/types/ui').Point | null
  planWirePreviewSource:
    | (import('@/types/schema').Placement & {
        endpointId?: string | undefined
        trunkDeviceId?: string | undefined
        enclosureId?: string | undefined
        planLabel?: string | undefined
        junctionPanelLabel?: string | undefined
        isEarthing?: boolean | undefined
      })
    | undefined
  planWirePreviewPointStore: import('zustand/vanilla').StoreApi<{ point: Point | null }>
  planDragPositions: Map<string, import('@/types/ui').Point>
  planWirePreviewTarget:
    | (import('@/types/schema').Placement & {
        endpointId?: string | undefined
        trunkDeviceId?: string | undefined
        enclosureId?: string | undefined
        planLabel?: string | undefined
        junctionPanelLabel?: string | undefined
        isEarthing?: boolean | undefined
      })
    | null
    | undefined
  planWireHoverPlacementId: string | null
  isFloorPlanMode: boolean
  activeFloor: import('@/types/schema').Floor | null | undefined
  currentProject: import('@/types/projectV2').ProjectV2 | null
  tempPxPerMeter: number | null
  applyActiveTool: (tool: import('@/types/ui').PlanToolMode) => void
  applyFloorPlanModeAndClearSelection: (enabled: boolean) => void
  selectedGraphicAssetId: string
  handleWallHover: ReturnType<typeof usePlanWallVertexGestures>['handleWallHover']
  handleOpeningPreviewOverrideChange: ReturnType<
    typeof usePlanWallVertexGestures
  >['handleOpeningPreviewOverrideChange']
  applyOpeningSelectionArmedTool: React.Dispatch<
    React.SetStateAction<import('@/hooks/plan/usePlanCanvasToolState').OpeningSelectionArmedTool>
  >
  planImage: HTMLImageElement | null
  planVisibility: import('@/types/ui').PlanVisibilityState
  planImagePosition: import('@/types/schema').Point2
  planImageRotationDeg: number
  isResettingScale: boolean
  clearSelection: () => void
  applySelectedPlanImageId: React.Dispatch<React.SetStateAction<string | null>>
  setPlanImagePosition: (update: React.SetStateAction<{ x: number; y: number }>) => void
  handlePlanImageClick: () => void
  setPlanImageRef: React.Dispatch<React.SetStateAction<Konva.Image | null>>
  handlePlanImageTransformEnd: (event: Konva.KonvaEventObject<Event>) => void
  planImageDisplayWidth: number
  planImageDisplayHeight: number
  setTransformerRef: React.Dispatch<React.SetStateAction<Konva.Transformer | null>>
  planFloorOverlayIds: string[]
  movePlanOverlayFloorIds: string[]
  pxPerMeter: ReturnType<typeof usePlanCanvasGeometry>['pxPerMeter']
  applyContentDrawingSnapGuides: React.Dispatch<
    React.SetStateAction<
      import('@/components/canvas/plan/PlanProjectionGuides').PlanProjectionGuide[]
    >
  >
  graphicElementsForRender: ReturnType<typeof usePlanCanvasGeometry>['graphicElementsForRender']
  selectedGraphicElementIds: ReturnType<
    typeof usePlanGeometrySelection
  >['selectedGraphicElementIds']
  fontFamily: string
  snapGraphicFloorPoint: ReturnType<typeof usePlanWallVertexGestures>['snapGraphicFloorPoint']
  applyVertexMoveProjectedSnapGuides: React.Dispatch<
    React.SetStateAction<
      {
        from: import('@/types/schema').Point2
        to: import('@/types/schema').Point2
        hideDistanceLabel?: boolean | undefined
      }[]
    >
  >
  handleGraphicElementSelect: ReturnType<
    typeof usePlanGeometrySelection
  >['handleGraphicElementSelect']
  handleGraphicElementMove: ReturnType<typeof usePlanGeometrySelection>['handleGraphicElementMove']
  handleGraphicElementResize: ReturnType<
    typeof usePlanGeometrySelection
  >['handleGraphicElementResize']
  updatePlanGraphicElement: (
    elementId: string,
    updates: Partial<import('@/types/schema').PlanGraphicElement>
  ) => void
  insertPointPreview: import('@/types/schema').Point2 | null
  hoveredDoorId: string | null
  hoveredWindowId: string | null
  wallSelectionBounds: ReturnType<typeof usePlanGeometrySnapping>['wallSelectionBounds']
  beginWallSelectionDrag: ReturnType<typeof usePlanGeometrySelectionDrag>['beginWallSelectionDrag']
  updateWallSelectionDrag: ReturnType<
    typeof usePlanGeometrySelectionDrag
  >['updateWallSelectionDrag']
  endWallSelectionDrag: ReturnType<typeof usePlanGeometrySelectionDrag>['endWallSelectionDrag']
  stairSelectionBounds: ReturnType<typeof usePlanGeometrySelection>['stairSelectionBounds']
  beginStairSelectionDrag: ReturnType<
    typeof usePlanGeometrySelectionDrag
  >['beginStairSelectionDrag']
  updateStairSelectionDrag: ReturnType<
    typeof usePlanGeometrySelectionDrag
  >['updateStairSelectionDrag']
  endStairSelectionDrag: ReturnType<typeof usePlanGeometrySelectionDrag>['endStairSelectionDrag']
  doorsForRender: ReturnType<typeof usePlanCanvasGeometry>['doorsForRender']
  makeCanvasPointFromEvent: ReturnType<typeof usePlanGeometrySnapping>['makeCanvasPointFromEvent']
  selection: import('@/types/ui').Selection
  doorDragRef: ReturnType<typeof usePlanGeometryGestureState>['doorDragRef']
  applyOpeningMoveFromPointer: ReturnType<
    typeof usePlanOpeningGestures
  >['applyOpeningMoveFromPointer']
  toolMoveHandleColor: '#ffffff'
  toolMoveHandleStrokeColor: '#0284c7'
  windowsForRender: ReturnType<typeof usePlanCanvasGeometry>['windowsForRender']
  openingWidthEditorActive: boolean
  setOpeningWidthEditorActive: React.Dispatch<React.SetStateAction<boolean>>
  beginOpeningDimensionDrag: ReturnType<typeof usePlanOpeningGestures>['beginOpeningDimensionDrag']
  applyOpeningDimensionDrag: ReturnType<typeof usePlanOpeningGestures>['applyOpeningDimensionDrag']
  endOpeningDimensionDrag: ReturnType<typeof usePlanOpeningGestures>['endOpeningDimensionDrag']
  selectedOpeningForWidthEditor:
    import('@/hooks/plan/usePlanOpeningWidthEditor').PlanOpeningWidthEditorModel | null
  openingWidthText: string
  clipPreviewPoints: import('@/types/schema').Point2[] | null
  renderPlanWireSymbolHits: (core: boolean) => false | React.JSX.Element[]
  suppressHeavyLayersWhilePanning: boolean
  planWireRoutes: ReturnType<typeof usePlanCanvasWiringModel>['planWireRoutes']
  planSymbolAndWireOpacity: 1 | 0.25
  highlightedPlanWireRouteIds: ReturnType<
    typeof usePlanCanvasWiringModel
  >['highlightedPlanWireRouteIds']
  hoveredPlanWireRouteIds: ReturnType<typeof usePlanCanvasWiringModel>['hoveredPlanWireRouteIds']
  planWireDragSourcePlacementId: string | null
  wiringFocusScope: ReturnType<typeof usePlanCanvasWiringModel>['wiringFocusScope']
  wiringPreviewRouteIds: ReturnType<typeof usePlanCanvasWiringModel>['wiringPreviewRouteIds']
  wiringFocus: {
    focus: import('@/hooks/plan/usePlanWiringFocus').PlanWiringTarget | null
    preview: import('@/hooks/plan/usePlanWiringFocus').PlanWiringTarget | null
    redraw: import('@/lib/plan/planWiringFocus').PlanWireRedraw | null
    frozen: import('@/lib/plan/planWiringFocus').FrozenPlanWireCircuit | null
    circuitIdForPlacement: (placementId: string | null | undefined) => string | null
    focusCircuit: (circuitId: string) => void
    focusPlacement: (
      placementId: string | null | undefined,
      circuitId?: string | null | undefined
    ) => void
    onHoverRoute: React.Dispatch<
      React.SetStateAction<import('@/types/schema').PlanWireRoute | null>
    >
    holdCircuitBeforeDraw: (
      circuitId: string | null,
      routes: import('@/types/schema').PlanWireRoute[]
    ) => void
    startRedraw: (circuitId: string, placementIds: Iterable<string>) => void
    finishRedraw: () => void
  }
  handleInsertFocusedPlanWireWaypoint: ReturnType<
    typeof usePlanCanvasWiringModel
  >['handleInsertFocusedPlanWireWaypoint']
  handleMovePlanWireWaypoint: ReturnType<
    typeof usePlanCanvasWiringModel
  >['handleMovePlanWireWaypoint']
  handleMovePlanWireRiser: ReturnType<typeof usePlanCanvasWiringModel>['handleMovePlanWireRiser']
  handleRemovePlanWireWaypoint: ReturnType<
    typeof usePlanCanvasWiringModel
  >['handleRemovePlanWireWaypoint']
  raisedRiserRouteIds: ReturnType<typeof usePlanCanvasWiringModel>['raisedRiserRouteIds']
  planWireRiserPreview: ReturnType<typeof usePlanCanvasWiringModel>['planWireRiserPreview']
  applyPlanWireRiserPreview: ReturnType<
    typeof usePlanCanvasWiringModel
  >['applyPlanWireRiserPreview']
  selectedRiserRouteIds: ReturnType<typeof usePlanCanvasWiringModel>['selectedRiserRouteIds']
  handleMovePlanWireRisers: ReturnType<typeof usePlanCanvasWiringModel>['handleMovePlanWireRisers']
  visiblePlacements: ReturnType<typeof usePlanCanvasWiringModel>['visiblePlacements']
  baseSymbolSizePx: ReturnType<typeof usePlanCanvasGeometry>['baseSymbolSizePx']
  effectivePlanZoom: number
  placementInteractivitySuppressed: boolean
  canDragItems: boolean
  stableSnapPlacementPosition: ReturnType<
    typeof usePlanCanvasGeometry
  >['stableSnapPlacementPosition']
  currentQuickPlacerFastItem: ReturnType<
    typeof usePlanQuickPlacerPreview
  >['currentQuickPlacerFastItem']
  stableMultiSelectHandlers: {
    onMultiSelectDragStart: (endpointId: string) => void
    onMultiSelectDrag: (endpointId: string, position: import('@/types/schema').Point2) => void
    onMultiSelectDragEnd: () => void
  }
  getSingleDragHandlers: (
    placement: import('@/types/schema').Placement
  ) => ReturnType<ReturnType<typeof usePlanDragHandling>['createSingleDragHandlers']>
  labelPositions: Map<string, { x: number; y: number }>
  planLabelFontSize: ReturnType<typeof usePlanCanvasGeometry>['planLabelFontSize']
  libraryDropPreview: ReturnType<typeof usePlanLibraryDropController>['libraryDropPreview']
  quickPlacerFastPreviewPlacement: ReturnType<
    typeof usePlanQuickPlacerPreview
  >['quickPlacerFastPreviewPlacement']
  quickPlacerFastPreviewLabelPosition: ReturnType<
    typeof usePlanQuickPlacerPreview
  >['quickPlacerFastPreviewLabelPosition']
  raisedRiserRoutes: ReturnType<typeof usePlanCanvasWiringModel>['raisedRiserRoutes']
  placements: ReturnType<typeof usePlanCanvasWiringModel>['placements']
  getPlacementWorldBoundsMemo: ReturnType<
    typeof usePlanCanvasMarqueeSelection
  >['getPlacementWorldBoundsMemo']
  sitplanNotes: import('@/types/schema').Note[]
  planNotesInteractive: boolean
  updateSitplanNote: (id: string, updates: Partial<import('@/types/schema').Note>) => void
  selectionFrameDragHandlers: {
    onSelectionFrameDragStart: () => void
    onSelectionFrameDragMove: (delta: import('@/types/ui').Point) => void
    onSelectionFrameDragEnd: (
      overrideDeltaInPlanSpace?: import('@/types/ui').Point | undefined
    ) => void
  }
  contentDrawingSnapGuides: import('@/components/canvas/plan/PlanProjectionGuides').PlanProjectionGuide[]
  vertexMoveProjectedSnapGuides: {
    from: import('@/types/schema').Point2
    to: import('@/types/schema').Point2
    hideDistanceLabel?: boolean | undefined
  }[]
  getFloorById: (id: string) => import('@/types/schema').Floor | undefined
  handleScaleRulerCancel: () => void
  handleScaleRulerComplete: (
    p1World: import('@/types/schema').Point2,
    p2World: import('@/types/schema').Point2,
    meters: number,
    currentPlanImagePosition: import('@/types/schema').Point2
  ) => void
  scaleRulerCommitSignal: number
  scaleRulerMeters: number | null
  applyScaleRulerMeters: React.Dispatch<React.SetStateAction<number | null>>
  applyScaleRulerMetersInput: React.Dispatch<React.SetStateAction<string>>
  applyScaleRulerPoints: React.Dispatch<
    React.SetStateAction<{
      p1: import('@/types/schema').Point2 | null
      p2: import('@/types/schema').Point2 | null
    }>
  >

  stairsForRender: ReturnType<typeof usePlanCanvasGeometry>['stairsForRender']
  spiralRotationPreview: ReturnType<typeof usePlanCanvasGeometry>['spiralRotationPreview']
  selectedStairId: ReturnType<typeof usePlanGeometrySelection>['selectedStairId']
  hoveredStairId: string | null
  selectedStairPointIndices: Map<string, number[]>
  shouldKeepGeometryTouchSelection: ReturnType<
    typeof usePlanGeometrySelection
  >['shouldKeepGeometryTouchSelection']
  applySelection: (selection: import('@/types/ui').Selection) => void
  applySelectedStairPointIndices: React.Dispatch<React.SetStateAction<Map<string, number[]>>>
  getCurrentMixedPointSelection: ReturnType<
    typeof usePlanGeometrySelection
  >['getCurrentMixedPointSelection']
  buildEncodedFloorPointIds: ReturnType<
    typeof usePlanGeometrySelection
  >['buildEncodedFloorPointIds']
  applyHoveredStairId: React.Dispatch<React.SetStateAction<string | null>>
  handleStairPointDragStart: ReturnType<
    typeof usePlanGeometrySelectionDrag
  >['handleStairPointDragStart']
  handleStairPointMove: ReturnType<typeof usePlanGeometrySelectionDrag>['handleStairPointMove']
  handleStairPointDragEnd: ReturnType<
    typeof usePlanGeometrySelectionDrag
  >['handleStairPointDragEnd']
  wallsForRender: ReturnType<typeof usePlanCanvasGeometry>['wallsForRender']
  selectedWallIds: ReturnType<typeof usePlanGeometrySelection>['selectedWallIds']
  selectedPointIndices: Map<string, number[]>
  selectedSegmentIndices: Map<string, number[]>
  commitWallSegmentLength: ReturnType<typeof usePlanWallGeometryActions>['commitWallSegmentLength']
  commitWallOpeningDistance: ReturnType<
    typeof usePlanWallGeometryActions
  >['commitWallOpeningDistance']
  handleWallDimensionDrag: ReturnType<typeof usePlanWallGeometryActions>['handleWallDimensionDrag']
  shouldHandleWallHover: boolean
  hoveredWallId: string | null
  openingPreview: {
    wallId: string
    position: number
    width: number
    kind: 'door' | 'window'
    valid: boolean
    doorSwing?: 'left' | 'right' | undefined
    doorDirection?: 'in' | 'out' | undefined
  } | null
  retainDirectOpeningSelectionForMixed: ReturnType<
    typeof usePlanGeometrySelection
  >['retainDirectOpeningSelectionForMixed']
  clearMixedOpeningSelection: ReturnType<
    typeof usePlanGeometrySelection
  >['clearMixedOpeningSelection']
  updateWall: (
    wallId: string,
    updates: Partial<import('@/types/schema').Wall> & {
      doorUpdates?: { id: string; position: number }[] | undefined
      windowUpdates?: { id: string; position: number }[] | undefined
    }
  ) => void
  applyClipPreviewPoints: React.Dispatch<
    React.SetStateAction<import('@/types/schema').Point2[] | null>
  >
  viewportUI: import('zustand/vanilla').StoreApi<import('@/stores/uiStore').UIState>
  applySelectedPointIndices: React.Dispatch<React.SetStateAction<Map<string, number[]>>>
  applySelectedSegmentIndices: React.Dispatch<React.SetStateAction<Map<string, number[]>>>
  resolveScopedPointTarget: ReturnType<typeof usePlanGeometrySnapping>['resolveScopedPointTarget']
  scopedWallIdForVertexSelection: ReturnType<
    typeof usePlanGeometrySnapping
  >['scopedWallIdForVertexSelection']
  pointDragTargetsRef: ReturnType<typeof usePlanGeometryGestureState>['pointDragTargetsRef']
  vertexDragInitialOpeningsRef: ReturnType<
    typeof usePlanGeometryGestureState
  >['vertexDragInitialOpeningsRef']
  vertexDragAnchorRef: ReturnType<typeof usePlanGeometryGestureState>['vertexDragAnchorRef']
  vertexDragInitialPointsRef: ReturnType<
    typeof usePlanGeometryGestureState
  >['vertexDragInitialPointsRef']
  buildMergedPointTargets: ReturnType<typeof usePlanWallVertexGestures>['buildMergedPointTargets']
  baseDoors: ReturnType<typeof usePlanCanvasGeometry>['baseDoors']
  baseWindows: ReturnType<typeof usePlanCanvasGeometry>['baseWindows']
  applyMergedPointMove: ReturnType<typeof usePlanWallVertexGestures>['applyMergedPointMove']
  applyPreviewWalls: ReturnType<typeof usePlanGeometryGestureState>['applyPreviewWalls']
  lastWallPointUpdateTimeRef: React.RefObject<number>
  selectedDoorIds: ReturnType<typeof usePlanGeometrySelection>['selectedDoorIds']
  selectedWindowIds: ReturnType<typeof usePlanGeometrySelection>['selectedWindowIds']
  canSelectDoorsInInsertMode: boolean
  toggleMixedOpeningSelection: ReturnType<
    typeof usePlanGeometrySelection
  >['toggleMixedOpeningSelection']
  applyHoveredDoorId: React.Dispatch<React.SetStateAction<string | null>>
  canSelectWindowsInInsertMode: boolean
  applyHoveredWindowId: React.Dispatch<React.SetStateAction<string | null>>
  shouldListenToWalls: boolean
  doorsListening: boolean
  windowsListening: boolean
  setSpiralRotationPreview: ReturnType<typeof usePlanCanvasGeometry>['setSpiralRotationPreview']
  updateStair: (stairId: string, updates: Partial<import('@/types/schema').Stair>) => void

  

  WallScanPreviewLayer: React.ComponentType<{
    floorId: string | null
    pxPerMeter: number | null
    zoom: number
    theme: 'light' | 'dark'
  }>
}

export function renderPlanCanvasViewport({
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
  updateSitplanNote,
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
}: PlanCanvasViewportOptions) {
  return (
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
      minZoom={planMinZoom}
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
      
      selectionFitMaxZoom={ZOOM_100}
      enableSingleFingerPan={enablePlanSingleFingerPan}
      enableLongPressContextMenu={!(canEditFloorPlan && floorPlanTouchDragToolActive)}
      backgroundColor="#fafafa"
      gridInTransformedLayer={true}
      // Treat 75 as “full” intensity; anything above is clamped visually.
      gridOpacity={(Math.min(planView.gridIntensity ?? 75, 75) / 75) * 0.75}
      disableContentHitGraph={suppressPlanHitTesting}
      overlayChildren={
        activeTool === 'wiring' && !isExporting ? (
          <>
            <PlanWireWaypointPreviewLayer
              store={waypointPreviewStore}
              routeStyle={planWiringVisibility.defaultStyle}
              theme={theme.mode}
              zoom={planView.zoom}
              pxPerMeter={canvasPxPerMeter}
              getEndpointById={getEndpointById}
              getTrunkDeviceById={getPlanWireTrunkDeviceById}
              junctionPanelPlacements={junctionPanelPlanPlacements}
              routeStrokeFor={planWireStrokeFor}
              clientToPlan={clientToPlan}
            />
            {planWirePreviewSource && (
              <PlanWirePointerPreview
                pointStore={planWirePreviewPointStore}
                source={
                  planDragPositions.get(planWirePreviewSource.id) ?? planWirePreviewSource.pos
                }
                target={
                  planWirePreviewTarget
                    ? (planDragPositions.get(planWirePreviewTarget.id) ?? planWirePreviewTarget.pos)
                    : null
                }
                illegalTarget={!!planWireHoverPlacementId && !planWirePreviewTarget}
                routeStyle={planWiringVisibility.defaultStyle}
                stroke={planWireActiveStroke(theme.mode)}
                zoom={planView.zoom}
                pxPerMeter={canvasPxPerMeter}
              />
            )}
          </>
        ) : isFloorPlanMode && suppressPlanHitTesting && !isExporting ? (
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
              onProjectedSnapGuidesChange={applyContentDrawingSnapGuides}
              onOpeningPreviewOverrideChange={handleOpeningPreviewOverrideChange}
              onOpeningInserted={(kind) => {
                applyOpeningSelectionArmedTool(kind === 'door' ? 'insertDoor' : 'insertWindow')
              }}
            />
          )}

          {/* Floor plan geometry: always visible when floor has floorPlan */}
          {renderPlanStairGeometry({
            activeFloor,
            stairsForRender,
            isExporting,
            activeTool,
            theme,
            planView,
            canvasPxPerMeter,
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
            makeCanvasPointFromEvent,
            beginStairSelectionDrag,
            updateStairSelectionDrag,
            endStairSelectionDrag,
            handleStairPointDragStart,
            handleStairPointMove,
            handleStairPointDragEnd,
          })}
          {!isExporting && (
            <WallScanPreviewLayer
              floorId={activeFloor?.id ?? null}
              pxPerMeter={canvasPxPerMeter}
              zoom={planView.zoom}
              theme={theme.mode}
            />
          )}
          {renderPlanWallGeometry({
            activeFloor,
            wallsForRender,
            doorsForRender,
            windowsForRender,
            canvasPxPerMeter,
            activeTool,
            planView,
            isExporting,
            selectedWallIds,
            selectedPointIndices,
            selectedSegmentIndices,
            isFloorPlanMode,
            commitWallSegmentLength,
            commitWallOpeningDistance,
            handleWallDimensionDrag,
            shouldHandleWallHover,
            hoveredWallId,
            hoveredDoorId,
            hoveredWindowId,
            openingPreview,
            shouldKeepGeometryTouchSelection,
            retainDirectOpeningSelectionForMixed,
            clearMixedOpeningSelection,
            gridSize,
            updateWall,
            activeFloorId,
            applySelection,
            applyClipPreviewPoints,
            viewportUI,
            applySelectedPointIndices,
            applySelectedSegmentIndices,
            getCurrentMixedPointSelection,
            applySelectedStairPointIndices,
            buildEncodedFloorPointIds,
            selection,
            beginWallSelectionDrag,
            updateWallSelectionDrag,
            endWallSelectionDrag,
            handleWallHover,
            resolveScopedPointTarget,
            selectedStairPointIndices,
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
            theme,
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
          })}

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

          {renderPlanStairHandles({
            activeFloor,
            stairsForRender,
            isExporting,
            activeTool,
            theme,
            planView,
            canvasPxPerMeter,
            spiralRotationPreview,
            setSpiralRotationPreview,
            selectedStairId,
            hoveredStairId,
            selectedStairPointIndices,
            shouldKeepGeometryTouchSelection,
            applySelection,
            applySelectedStairPointIndices,
            getCurrentMixedPointSelection,
            buildEncodedFloorPointIds,
            applyHoveredStairId,
            makeCanvasPointFromEvent,
            beginStairSelectionDrag,
            updateStairSelectionDrag,
            endStairSelectionDrag,
            handleStairPointDragStart,
            handleStairPointMove,
            handleStairPointDragEnd,
            updateStair,
          })}

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
          {isFloorPlanMode && !isExporting && activeTool === 'select' && wallSelectionBounds && (
            <PlanDirectionalMoveHandles
              bounds={wallSelectionBounds}
              pan={planView.pan}
              zoom={planView.zoom}
              onBegin={(anchor, mode) => beginWallSelectionDrag(anchor, mode)}
              onUpdate={updateWallSelectionDrag}
              onEnd={(point) => {
                if (point) updateWallSelectionDrag(point)
                endWallSelectionDrag()
              }}
            />
          )}
          {isFloorPlanMode && !isExporting && activeTool === 'select' && stairSelectionBounds && (
            <PlanDirectionalMoveHandles
              bounds={stairSelectionBounds}
              pan={planView.pan}
              zoom={planView.zoom}
              onBegin={(anchor, mode) => beginStairSelectionDrag(anchor, mode)}
              onUpdate={updateStairSelectionDrag}
              onEnd={(point) => {
                if (point) updateStairSelectionDrag(point)
                endStairSelectionDrag()
              }}
            />
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
                pxPerMeter={canvasPxPerMeter}
                routes={planWireRoutes}
                junctionPanelPlacements={junctionPanelPlanPlacements}
                highlightedRouteIds={highlightedPlanWireRouteIds}
                hoveredRouteIds={hoveredPlanWireRouteIds}
                routeStrokeFor={planWireStrokeFor}
                routeStyle={planWiringVisibility.defaultStyle}
                theme={theme.mode}
                clientToPlan={clientToPlan}
                getEndpointById={getEndpointById}
                getTrunkDeviceById={getPlanWireTrunkDeviceById}
                active={activeTool === 'wiring' && !isExporting}
                focusMode={activeTool === 'wiring' && !isExporting}
                drawingWire={planWireDragSourcePlacementId != null}
                waypointPreviewStore={waypointPreviewStore}
                focusRouteIds={wiringFocusScope?.routeIds}
                previewRouteIds={wiringPreviewRouteIds}
                onHoverRoute={wiringFocus.onHoverRoute}
                onInsertWaypoint={handleInsertFocusedPlanWireWaypoint}
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
          {isCableRoutesEnabled() && activeFloorId && !isExporting && (
            <PlanSelectedCableRoutes
              floorId={activeFloorId}
              zoom={planView.zoom}
              pxPerMeter={canvasPxPerMeter}
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
            <Group listening={false} name="plan-symbol-labels" opacity={planSymbolAndWireOpacity}>
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
                !currentQuickPlacerFastItem.trunkDeviceId &&
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
              pxPerMeter={canvasPxPerMeter}
              routes={raisedRiserRoutes}
              riserHandlesOnly
              junctionPanelPlacements={junctionPanelPlanPlacements}
              routeStyle={planWiringVisibility.defaultStyle}
              theme={theme.mode}
              clientToPlan={clientToPlan}
              getEndpointById={getEndpointById}
              getTrunkDeviceById={getPlanWireTrunkDeviceById}
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

          {!isExporting && (
            <PlanRemoteSelections
              activeFloorId={activeFloorId}
              activeFloor={activeFloor}
              notes={sitplanNotes}
              placements={visiblePlacements}
              getEndpointById={getEndpointById}
              getPlacementWorldBounds={getPlacementWorldBoundsMemo}
              zoom={effectivePlanZoom}
            />
          )}

          {/* Main-layer tools and vertex moves keep guides above editable geometry. */}
          {!isExporting && (
            <PlanProjectionGuides
              guides={[...contentDrawingSnapGuides, ...vertexMoveProjectedSnapGuides]}
              zoom={planView.zoom}
              pxPerMeter={canvasPxPerMeter}
              fontFamily={fontFamily}
              themeMode={theme.mode}
            />
          )}

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
  )
}
