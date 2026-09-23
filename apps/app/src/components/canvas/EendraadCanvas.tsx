import { memo, useCallback, useRef, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { Circle, Group, Line, Rect } from 'react-konva'
import type Konva from 'konva'
import { useTranslation } from 'react-i18next'
import { CalendarDays, CornerDownLeft, RotateCcw, Trash2 } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useDialogStore } from '@/stores/dialogStore'
import { useCanvasRegistryStore } from '@/stores/canvasRegistryStore'
import { generateId } from '@/utils'
import { isDemoProjectId } from '@/lib/demoProject'
import { ensurePanelPlacement } from '@/utils/panelPlacement'
import type { CanvasDropMeta, CanvasSize, Point, Selection } from '@/types/ui'
import type {
  Endpoint,
  Circuit,
  Panel,
  ProtectionDevice,
  Placement,
  TrunkDevice,
  Frame,
  WireSegment,
} from '@/types/schema'
import BaseCanvas, { type BaseCanvasHandle } from './BaseCanvas'
import ViewNavigationToolbar from './ViewNavigationToolbar'
import CanvasFloatingControlRail from './CanvasFloatingControlRail'
import { FloatingControl } from './FloatingControls'
import { CanvasOverlayScaleProvider } from '@/contexts/CanvasOverlayScaleContext'
import { WireSegments } from './WireSegment'
import { logger } from '@/lib/logger'
import { trackSymbolPlace } from '@/lib/analytics/editorEventAnalytics'
import {
  DragCursorSymbol,
  DragPreview,
  DropZoneHintsOverlay,
  HitZoneDebugOverlay,
  OffscreenPreviewIndicator,
  TrunkLayoutDebugOverlay,
} from './eendraad'
import { FrameComponent } from './eendraad/FrameComponent'
import RenderNode from './eendraad/RenderNode'
import InstallDateOverlay from './eendraad/InstallDateOverlay'
import { NoteSymbol } from './eendraad/NoteSymbol'
import { SYMBOL_SIZE } from './eendraad/canvasSymbols'
import { CanvasPanOrClickProvider } from './eendraad/CanvasPanOrClickProvider'
import { ConverterResizeViewportContext } from './eendraad/ConverterResizeViewportContext'
import { linkedSubPanelDisplayNamesForProtectionIds } from '@/lib/panel/linkedSubPanelDeleteWarning'
import { createLinkedProtectionDeleteDialog } from '@/lib/panel/linkedProtectionDeleteDialog'
import { panelHasModularChangeover } from '@/lib/panel/panelFeedOrganization'
import { canCreateSupplyTopologyFromDrop } from '@/lib/supplyTopologyFeature'
import { getMainBusInsertionSectionId } from '@/lib/panel/panelBusSections'
import { panelHasContent, isLastMainPanel } from '@/utils/eendraad'
import { endpointSupportsMultiplier } from '@/utils/endpointMultipliers'
import { supportsSupplyDeviceMultiplier } from '@/lib/supplyAssembly/inverterMultipliers'
import {
  findSameSymbolAddMoreLayoutTargets,
  incrementSameSymbolAddMoreTargetWithUndo,
  positionHitsMultiplierBadge,
  type SameSymbolAddMoreTarget,
} from '@/lib/eendraad/sameSymbolAddMore'
import {
  createSyncEndpointMultiplierDeps,
  syncEndpointMultiplierCount,
} from '@/lib/eendraad/syncEndpointMultiplierCount'
import {
  createSyncSupplyInverterMultiplierDeps,
  syncSupplyDeviceMultiplierCount,
} from '@/lib/eendraad/syncSupplyInverterMultiplier'
import {
  openAddMoreDialogForEndpoint,
  openSupplyDeviceAddMoreDialog,
} from '@/components/endpoints/AddMoreCountDialog'
import {
  useEendraadLayout,
  useEendraadWireSegments,
  useDropTargetDetection,
  useEendraadDragPreview,
  useLayoutTree,
  useEendraadCircuitLetterHotkeys,
} from '@/hooks/eendraad'
import { computeEendraadCircuitFocusBounds } from '@/lib/eendraad/focusCircuit'
import { pickRepresentativeCircuitIdForMainBusMove } from '@/lib/eendraad/mainBusOrder'
import { resolveSecondaryBusEjectSelection } from '@/lib/eendraad/secondaryBusEjectEligibility'
import { normalizeProtectionPlacementDropTarget } from '@/lib/eendraad/protectionPlacementDropTarget'
import {
  getEendraadPreviewIntentKey,
  useEendraadPreviewGraph,
} from '@/hooks/eendraad/useEendraadPreviewGraph'
import { resolveOffscreenSupplyPreviewDirection } from '@/lib/layout/offscreenSupplyPreviewIndicator'
import type { LayoutNode, LayoutTree } from '@/lib/layout/layoutTree'
import {
  findClosestLayoutNodeAnchor,
  getPanPreservingWorldAnchor,
} from '@/lib/canvas/viewportAnchor'
import { resizeConverterDcConnections } from '@/lib/eendraad/resizeConverterDcConnections'
import { getEendraadRenderProjectRevision } from '@/lib/layout/eendraadDerivedLayout'
import type { DropZoneHintRelocation } from '@/lib/layout/collectDropZoneHints'
import {
  findDomoticaOutputDropTarget,
  findDropTarget,
  findDropTargetWithDebug,
  ensureCircuitTrunkWireSegmentOnDropTarget,
  getHitZoneBounds,
  type DropTarget,
  type FindDropTargetOptions,
} from '@/lib/layout/findDropTarget'
import { createFindElementsInRectangleHandler } from '@/handlers/eendraad'
import { executeDropBehavior, type DropBehaviorCallbacks } from '@/handlers/eendraad/dropBehaviors'
import { PROTECTION_SYMBOL_IDS, protectionTypeToSymbolKey } from '@/lib/protectionKind'
import { getSupplyEnclosureBoundaryCenter } from '@/lib/layout/supplyEnclosureBoundaryGeometry'
import { getSymbolById, type SymbolMetadata } from '@/lib/symbols'
import AddElementPicker from '@/components/eendraad/AddElementPicker'
import { endpointIdsForPlacementSelection } from '@/lib/ui/crossCanvasSelection'
import { OPEN_EENDRAAD_NAMING_GUIDANCE_EVENT } from '@/lib/ui/eendraadNamingGuidance'
import {
  buildFrameFieldsFromClassifiedSelection,
  resolveEendraadFramePanelIdForSelection,
} from '@/lib/eendraad/frameContent'
import {
  logTrunkDnD,
  trunkDnDCommitLogEnabled,
  logTrunkDnDCommit,
  serializeTrunkDevices,
  summarizeDropTarget,
  summarizeHitDebugPath,
  trunkDnDVerboseLogEnabled,
} from '@/lib/eendraad/trunkDeviceDnDLog'
import type { ContextMenuItem } from '@/components/common/ContextMenu'
import { getContextMenuIcon } from '@/components/common/ContextMenuIcons'
import FloorSelectionDialog from '@/components/plan/FloorSelectionDialog'
import {
  buildAutoSitplanPlacement,
  getViewportCenterPlanSpaceIfApplicable,
} from '@/lib/plan/autoSitplanPlacement'
import { resolveSitplanTargetFloorId } from '@/lib/plan/sitplanTargetFloor'
import { ensureEarthingSitplanPlacement } from '@/lib/plan/earthingSitplanPlacement'
import { confirmDeleteEarthing, performDeleteEarthingLocations } from '@/lib/installation/deleteEarthing'
import {
  findGroundTrunkDeviceOwner,
  isGroundElementId,
  parseGroundElementId,
} from '@/lib/eendraad/panelGround'
import {
  reconcileDirectConverterDcDevices,
  reconcileSupplyAssemblyBranchProtections,
} from '@/lib/supplyAssembly/editorIntegration'
import { confirmDeleteSupplyTrunkDevice } from '@/lib/supplyAssembly/deleteSupplyTrunkDevice'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  getEditableProjectElectricalPanels,
  selectProjectSupplyAssemblies,
} from '@/lib/projectV2/electrical'
import { collectDomoticaEndpointIdsForDeletion } from '@/lib/eendraad/projectElectricalDomain'
import {
  canDuplicateEendraadSelection,
  doEendraadDuplicate,
} from '@/lib/eendraad/contextMenuActions'
import {
  deleteEendraadAnnotationTarget,
  hasEendraadAnnotationDeleteTarget,
  resolveEendraadAnnotationDeleteTarget,
} from '@/lib/eendraad/deleteSelection'
import { isEendraadDeleteKey } from '@/lib/eendraad/deleteKeyboardKey'
import {
  isPanelAttachmentDropTargetTerminal,
  movePanelAttachmentOnRcdBus,
  movePanelAttachmentOnSecondaryBus,
  movePanelAttachmentToMainBus,
} from '@/lib/eendraad/panelAttachmentMove'
import { resolvePanelSupplyLinkForPanel } from '@/lib/eendraad/panelSupplyLink'
import {
  duplicateCircuitDcBranchDeviceAtDropTarget,
  repositionDuplicatedProtectionToDropTarget,
  protectionDropTargetHitsSource,
  resolveProtectionDropTargetForPosition,
  runEendraadEndpointAltDragDuplicate,
} from '@/lib/eendraad/eendraadAltDragDuplicate'
import { clonePlacementsForDuplicate } from '@/lib/eendraad/duplicateSitplanHelpers'
import { reorderDomoticaChildEndpoint } from '@/lib/eendraad/domoticaOutputOrdering'
import {
  moveEndpointSelectionBetweenCircuits,
  moveEndpointSelectionOnCircuit,
} from '@/lib/eendraad/moveEndpointSelection'
import {
  circuitClosureContains,
  classifyEendraadMoveSelection,
  collapseProtectionMoveRoots,
  planEndpointSelectionMove,
  resolveEendraadMultiMoveKind,
} from '@/lib/eendraad/multiSelectionMove'
import { mutateTrunkDeviceRelocation } from '@/lib/layout/eendraadPreviewSimulation'
import {
  moveEndpointToSupplyDcBus,
  isSupplyTrunkDeviceDropTarget,
  moveSupplyTrunkDeviceAtDropTarget,
  resolveSupplyDropMounting,
} from '@/lib/eendraad/supplyTrunkDeviceMove'
import { resolvePlacementForFloorMove } from '@/lib/eendraad/floorMoveFromEendraad'
import { ZOOM_100 } from '@/constants/canvasConstants'
import { getPanelDiagramId, type BottomUpPanelLayout } from '@/lib/layout/bottomUpLayout'
import {
  filterProtectionRelocationPreviewWires,
  getChangedPreviewWireSegments,
  getPreviewPanelTranslation,
} from '@/lib/layout/eendraadPreviewWires'
import { resolvePanelAttachmentPreviewGeometry } from '@/lib/layout/panelAttachmentPreview'
import { resolveProtectionNestPreviewCircuitId } from '@/lib/layout/eendraadPreviewTarget'
import {
  DOMOTICA_BRANCH_LEAD,
  DOMOTICA_MAX_ENDPOINT_OUTPUTS,
  DOMOTICA_OUTPUT_SPACING,
} from '@/lib/domoticaLayout'

import {
  applyAutomaticMainBusNamingToPanel,
  automaticMainBusNamingWouldChangeProject,
  projectHasManualEendraadLabelOverrides,
  resolveAutomaticNamingOptsFromInstallation,
} from '@/lib/eendraad/automaticMainBusNaming'
import { installationHideFeederLetters } from '@/lib/eendraad/eendraadNamingInstall'
import {
  dedupePanelProtectionsInPanelTree,
  getMainBusOrder,
  getMainBusItemsWithIndices,
} from '@/lib/eendraad/mainBusOrder'
import type { EditorCapabilities } from '@/lib/viewerMode'

import { useEditionFeatureAvailability } from '@/hooks/useEditionFeatureAvailability'
import {
  getExplicitInstallationDate,
  getExplicitInstallYear,
  getInstallYearColorKey,
  installationDateFromYear,
  installYearColor,
  normalizeInstallationDate,
  normalizeInstallYear,
  pickInstallYearColor,
} from '@/lib/installDates'
import {
  buildCircuitInstallDateTargets,
  buildPanelInstallDateTargets,
  buildProtectionInstallDateTargets,
  getInstallDateTargetInheritedYear,
  protectionHasInstallDateChildren,
  type InstallDatePropagationMode,
  type InstallDateTarget,
} from '@/lib/installDatePropagation'
import { queryOneWireNotes } from '@/lib/projectV2/annotations'
import { clamp } from '@/lib/geometry'
import {
  resolveCircuitWireSegmentByMetadata,
  resolveSupplyWireSegmentByMetadata,
} from '@/lib/eendraad/wireSelectionIdentity'

function findProtectionDragTarget(tree: LayoutTree, position: Point): { target: DropTarget } {
  return {
    target: findDropTarget(tree, position, {
      preferMainBusOverGroundWire: true,
      preferMainBusOverSupplyWire: false,
      preferSecondaryBusForNestedProtection: true,
    }),
  }
}

type ViewportHitBounds = { left: number; top: number; right: number; bottom: number }

const VIEWPORT_HIT_CULLABLE_SELECTOR = '.eendraad-hit-cullable'
const VIEWPORT_HIT_BOUNDS_ATTRIBUTE = 'eendraadViewportHitBounds'
// Keep a generous screen-space gutter interactive while the camera is moving.
const VIEWPORT_HIT_OVERSCAN_PX = 160

function boundsIntersect(left: ViewportHitBounds, right: ViewportHitBounds): boolean {
  return !(
    left.right < right.left ||
    left.left > right.right ||
    left.bottom < right.top ||
    left.top > right.bottom
  )
}

const EMPTY_PANELS: Panel[] = []

type KonvaPointerEventLike = {
  target?: {
    getStage?: () => {
      getPointerPosition?: () => Point | null
    } | null
  }
}

function isKonvaPointerEventLike(value: unknown): value is KonvaPointerEventLike {
  if (!value || typeof value !== 'object') return false
  const target = (value as { target?: unknown }).target
  return !!target && typeof target === 'object' && 'getStage' in target
}

type PanelLayoutWithElements = BottomUpPanelLayout & {
  elements?: Array<{ type?: string; trunkDeviceId?: string }>
}

type EendraadLongPressDuplicateDrag = {
  elementTypes: Selection['type'][]
  onStart: (params: {
    elementId: string
    elementType: Selection['type']
    clientX: number
    clientY: number
  }) => void
}

/** Apply plan-consistent floor moves for one or more endpoints (one-wire context menu). */
function applyEendraadEndpointsToFloor(endpointIds: string[], floorId: string): void {
  const state = useProjectStore.getState()
  const actFloor = useUIStore.getState().activeFloorId
  for (const endpointId of endpointIds) {
    const latest = state.getEndpointById(endpointId)
    if (!latest) continue
    const placement = resolvePlacementForFloorMove(latest, actFloor)
    if (placement) {
      state.updatePlacement(placement.id, { floorId })
    } else {
      const project = state.currentProject
      if (!project) continue
      const circuitInfo = state.findCircuitForEndpoint(latest.id)
      if (!circuitInfo) continue
      const placementId = generateId()
      const uiSnap = useUIStore.getState()
      const preferredPlanPos =
        getViewportCenterPlanSpaceIfApplicable(
          uiSnap.viewportLayout,
          uiSnap.planCanvasViewportPx,
          uiSnap.activeFloorId,
          floorId,
          uiSnap.planView
        ) ?? undefined
      const built = buildAutoSitplanPlacement(project, {
        circuitId: circuitInfo.circuit.id,
        floorId,
        placementId,
        ...(preferredPlanPos ? { preferredPlanPos } : {}),
      })
      if (built) state.addPlacement(latest.id, built)
    }
  }
}

interface EendraadCanvasProps {
  onMultiFingerSwipe?: (
    direction: 'left' | 'right' | 'up' | 'down',
    fingerCount: number,
    startClientX: number
  ) => void
  capabilities?: EditorCapabilities
}

function findEndpointRenderTarget(
  panelNodes: LayoutNode[],
  endpointId: string
): { node: LayoutNode; panelNode: LayoutNode } | null {
  const findInNode = (node: LayoutNode): LayoutNode | null => {
    if (node.type === 'endpoint' && node.domainId === endpointId) return node
    for (const child of node.children) {
      const found = findInNode(child)
      if (found) return found
    }
    return null
  }
  for (const panelNode of panelNodes) {
    const node = findInNode(panelNode)
    if (node) return { node, panelNode }
  }
  return null
}

function EendraadCanvasInner({ onMultiFingerSwipe, capabilities }: EendraadCanvasProps = {}) {
  const { t, i18n } = useTranslation()
  const eendraadView = useUIStore((s) => s.eendraadView)
  const requestFitToView = useUIStore((s) => s.requestFitToView)
  const activePanelId = useUIStore((s) => s.activePanelId)
  const eendraadViewRef = useRef(eendraadView)
  eendraadViewRef.current = eendraadView
  const setEendraadView = useUIStore((s) => s.setEendraadView)
  const setSelection = useUIStore((s) => s.setSelection)
  const currentProject = useProjectStore((s: ProjectState) =>
    s.currentProject ? getEendraadRenderProjectRevision(s.currentProject) : null
  )
  const eendraadNotes = useMemo(
    () => (currentProject ? queryOneWireNotes(currentProject) : []),
    [currentProject]
  )
  const currentProjectStorageMode = useProjectStore(
    (s: ProjectState) => s.currentProjectStorageMode
  )
  const selection = useUIStore((s) => s.selection)
  const eendraadDateMarkingMode = useUIStore((s) => s.eendraadDateMarkingMode)
  const setEendraadDateMarkingMode = useUIStore((s) => s.setEendraadDateMarkingMode)
  const eendraadDateMarkingVisibility = useUIStore((s) => s.eendraadDateMarkingVisibility)
  const setEendraadDateMarkingVisibility = useUIStore((s) => s.setEendraadDateMarkingVisibility)
  
  const canEditProject = capabilities?.canEditProject ?? true
  const canPlaceSymbols = capabilities?.canPlaceSymbols ?? true
  const canDragItems = capabilities?.canDragItems ?? true
  const canDeleteItems = capabilities?.canDeleteItems ?? true
  const addCircuit = useProjectStore((s: ProjectState) => s.addCircuit)
  const addCircuitToProtection = useProjectStore((s: ProjectState) => s.addCircuitToProtection)
  const addEndpoint = useProjectStore((s: ProjectState) => s.addEndpoint)
  const addPlacement = useProjectStore((s: ProjectState) => s.addPlacement)
  const addProtection = useProjectStore((s: ProjectState) => s.addProtection)
  const addPanel = useProjectStore((s: ProjectState) => s.addPanel)
  const addTrunkDevice = useProjectStore((s: ProjectState) => s.addTrunkDevice)
  const updateTrunkDevice = useProjectStore((s: ProjectState) => s.updateTrunkDevice)
  const addSupplyTrunkDevice = useProjectStore((s: ProjectState) => s.addSupplyTrunkDevice)
  const updateSupplyTrunkDevice = useProjectStore((s: ProjectState) => s.updateSupplyTrunkDevice)
  const addGroundTrunkDevice = useProjectStore((s: ProjectState) => s.addGroundTrunkDevice)
  const updateGroundTrunkDevice = useProjectStore((s: ProjectState) => s.updateGroundTrunkDevice)
  const insertProtectionAfter = useProjectStore((s: ProjectState) => s.insertProtectionAfter)
  const getProtectionById = useProjectStore((s: ProjectState) => s.getProtectionById)
  const getPanelById = useProjectStore((s: ProjectState) => s.getPanelById)
  const getFloorById = useProjectStore((s: ProjectState) => s.getFloorById)
  const updateFloor = useProjectStore((s: ProjectState) => s.updateFloor)
  const getCircuitById = useProjectStore((s: ProjectState) => s.getCircuitById)
  const getEndpointById = useProjectStore((s: ProjectState) => s.getEndpointById)
  const getTrunkDeviceById = useProjectStore((s: ProjectState) => s.getTrunkDeviceById)
  const updateCircuit = useProjectStore((s: ProjectState) => s.updateCircuit)
  const updatePanel = useProjectStore((s: ProjectState) => s.updatePanel)
  const updateProtection = useProjectStore((s: ProjectState) => s.updateProtection)
  const updateEndpoint = useProjectStore((s: ProjectState) => s.updateEndpoint)
  const updateProject = useProjectStore((s: ProjectState) => s.updateProject)
  const moveCircuitToMainBus = useProjectStore((s: ProjectState) => s.moveCircuitToMainBus)
  const moveCircuitOnMainBus = useProjectStore((s: ProjectState) => s.moveCircuitOnMainBus)
  const ejectSecondaryBusProtectionsToNewPanel = useProjectStore(
    (s: ProjectState) => s.ejectSecondaryBusProtectionsToNewPanel
  )
  const moveCircuitToSecondaryBus = useProjectStore(
    (s: ProjectState) => s.moveCircuitToSecondaryBus
  )
  const moveCircuitsToRcdBus = useProjectStore((s: ProjectState) => s.moveCircuitsToRcdBus)
  const withSingleUndoEntry = useProjectStore((s: ProjectState) => s.withSingleUndoEntry)
  const relocateCircuitTrunkDevice = useProjectStore(
    (s: ProjectState) => s.relocateCircuitTrunkDevice
  )
  const updateInstallation = useProjectStore((s: ProjectState) => s.updateInstallation)
  const ensureJunctionPanelPlacementForLabel = useProjectStore(
    (s: ProjectState) => s.ensureJunctionPanelPlacementForLabel
  )
  const deleteEndpoint = useProjectStore((s: ProjectState) => s.deleteEndpoint)
  const addEendraadNote = useProjectStore((s: ProjectState) => s.addEendraadNote)
  const applyAutomaticEendraadNamingAllPanels = useProjectStore(
    (s: ProjectState) => s.applyAutomaticEendraadNamingAllPanels
  )
  const resetAllEendraadLabelOverrides = useProjectStore(
    (s: ProjectState) => s.resetAllEendraadLabelOverrides
  )
  const updateEendraadNote = useProjectStore((s: ProjectState) => s.updateEendraadNote)
  const getFramesByPanel = useProjectStore((s: ProjectState) => s.getFramesByPanel)
  const openDialog = useDialogStore((s) => s.openDialog)
  const canvasRef = useRef<BaseCanvasHandle>(null)
  const pendingConverterResizeAnchorRef = useRef<{
    deviceId: string
    previousAnchor: Point
    previousView: { pan: Point; zoom: number }
  } | null>(null)
  const viewportHitRefreshTimerRef = useRef<number | null>(null)
  const viewportHitNeedsRemeasureRef = useRef(false)
  const viewportHitViewRef = useRef({
    pan: eendraadView.pan,
    zoom: eendraadView.zoom,
    viewport: { width: 0, height: 0 } as CanvasSize,
  })
  const beginInteractiveOverlayPan = useCallback((clientX: number, clientY: number) => {
    canvasRef.current?.beginDeferredMousePan(clientX, clientY)
  }, [])
  const containerRef = useRef<HTMLDivElement>(null)
  const pointerOverEendraadRef = useRef(false)
  const contextMenuItemsResolverRef = useRef<
    ((position: Point, elementId: string | null) => ContextMenuItem[]) | null
  >(null)
  /** First trunk drag-move per gesture logs [TrunkDeviceDnD] canvas:drag-start; cleared on drag end. */
  const trunkDnDLoggedStartRef = useRef(false)
  /** Set on drag start from Alt/Option; cleared when drag ends. */
  const elementDragModeRef = useRef<'move' | 'duplicate'>('move')
  /** Alt-duplicate uses window pointer events; Konva drag-end must be ignored. */
  const suppressKonvaDragEndRef = useRef(false)
  const altDuplicatePointerCleanupRef = useRef<(() => void) | null>(null)
  const draggingProtectionIdRef = useRef<string | null>(null)
  const movingPanelAttachmentIdRef = useRef<string | null>(null)
  const internalDragElementIdRef = useRef<string | null>(null)
  const [internalDragPlacement, setInternalDragPlacement] = useState<
    (DropZoneHintRelocation & { symbol: SymbolMetadata }) | null
  >(null)
  const [altDuplicatePointerDragActive, setAltDuplicatePointerDragActive] = useState(false)
  const [addElementDropPosition, setAddElementDropPosition] = useState<Point | null>(null)
  const [openEendraadMenu, setOpenEendraadMenu] = useState<'naming' | null>(null)
  const [namingGuidanceHighlighted, setNamingGuidanceHighlighted] = useState(false)
  const currentInstallation = currentProject
    ? getProjectElectricalInstallation(currentProject)
    : undefined
  const currentPanels = currentProject ? getProjectElectricalPanels(currentProject) : EMPTY_PANELS
  const eendraadAutoNaming = !!currentInstallation?.eendraadAutomaticNaming
  const hasCustomEendraadLabels = useMemo(
    () => !!currentProject && projectHasManualEendraadLabelOverrides(currentProject),
    [currentProject]
  )

  useEffect(() => {
    let highlightTimeout: number | undefined
    const openNamingGuidance = () => {
      setOpenEendraadMenu('naming')
      setNamingGuidanceHighlighted(true)
      window.clearTimeout(highlightTimeout)
      highlightTimeout = window.setTimeout(() => setNamingGuidanceHighlighted(false), 1800)
    }
    window.addEventListener(OPEN_EENDRAAD_NAMING_GUIDANCE_EVENT, openNamingGuidance)
    return () => {
      window.removeEventListener(OPEN_EENDRAAD_NAMING_GUIDANCE_EVENT, openNamingGuidance)
      window.clearTimeout(highlightTimeout)
    }
  }, [])
  
  const eendraadHideFeederLetters = installationHideFeederLetters(currentInstallation)
  const { advancedPanelLabels, installationDates } = useEditionFeatureAvailability(
    currentProject?.project.id,
    {
      storageMode: currentProjectStorageMode,
    }
  )
  const isDemoProject = isDemoProjectId(currentProject?.project.id)
  const canUseInstallDates = canEditProject && (isDemoProject || installationDates)
  const installDatesVisible =
    canUseInstallDates &&
    (eendraadDateMarkingMode || eendraadDateMarkingVisibility.installDatesVisible)
  const [dateToolYear, setDateToolYear] = useState('')
  const [dateToolMonth, setDateToolMonth] = useState(1)
  const [dateToolDay, setDateToolDay] = useState(1)
  const [dateToolCalendarOpen, setDateToolCalendarOpen] = useState(false)
  const [viewportPixelSize, setViewportPixelSize] = useState<CanvasSize>({ width: 0, height: 0 })
  viewportHitViewRef.current = {
    pan: eendraadView.pan,
    zoom: eendraadView.zoom,
    viewport: viewportPixelSize,
  }
  const [closedDateToolSelectionKey, setClosedDateToolSelectionKey] = useState<string | null>(null)
  const [dateToolFrameSelection, setDateToolFrameSelection] = useState<{
    year: number
    bounds: { x: number; y: number; width: number; height: number }
  } | null>(null)
  const dateToolInputRef = useRef<HTMLInputElement>(null)
  const suppressDateFrameSelectionRef = useRef(false)
  const clearDateFrameSelectionSuppressionRef = useRef<number | null>(null)

  const exitDateMarkingMode = useCallback(() => {
    setEendraadDateMarkingMode(false)
    setDateToolCalendarOpen(false)
    setDateToolFrameSelection(null)
    setClosedDateToolSelectionKey(null)
  }, [setEendraadDateMarkingMode])

  useEffect(() => {
    if (!eendraadDateMarkingMode) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      exitDateMarkingMode()
    }

    window.addEventListener('keydown', handleEscape, true)
    return () => window.removeEventListener('keydown', handleEscape, true)
  }, [eendraadDateMarkingMode, exitDateMarkingMode])

  const handleViewportPanStateChange = useCallback((isPanning: boolean) => {
    if (clearDateFrameSelectionSuppressionRef.current != null) {
      window.clearTimeout(clearDateFrameSelectionSuppressionRef.current)
      clearDateFrameSelectionSuppressionRef.current = null
    }
    if (isPanning) {
      suppressDateFrameSelectionRef.current = true
      return
    }
    // Konva can emit click after mouseup. Keep suppression through that event turn.
    clearDateFrameSelectionSuppressionRef.current = window.setTimeout(() => {
      suppressDateFrameSelectionRef.current = false
      clearDateFrameSelectionSuppressionRef.current = null
    }, 0)
  }, [])

  useEffect(
    () => () => {
      if (clearDateFrameSelectionSuppressionRef.current != null) {
        window.clearTimeout(clearDateFrameSelectionSuppressionRef.current)
      }
    },
    []
  )

  const setEendraadClipboard = useUIStore((s) => s.setEendraadClipboard)
  const libraryDragSymbol = useUIStore((s) => s.libraryDragSymbol)

  // Register canvas for export
  const registerEendraad = useCanvasRegistryStore((s) => s.registerEendraad)
  const unregisterEendraad = useCanvasRegistryStore((s) => s.unregisterEendraad)
  useEffect(() => {
    registerEendraad(
      () => canvasRef.current?.getStage() ?? null,
      () => canvasRef.current?.fitToView()
    )
    return () => unregisterEendraad()
  }, [registerEendraad, unregisterEendraad])

  // Calculate layout and wire segments
  const layout = useEendraadLayout()
  const layoutTree = useLayoutTree() // Tree-based rendering and operations
  const wireSegments = useEendraadWireSegments() // Tree-based wire generation

  const resizeConverterWithViewportAnchor = useCallback(
    (deviceId: string, connectionCount: number, previousAnchor: Point): boolean => {
      const previousView = useUIStore.getState().eendraadView
      pendingConverterResizeAnchorRef.current = {
        deviceId,
        previousAnchor,
        previousView: { pan: { ...previousView.pan }, zoom: previousView.zoom },
      }
      const resized = resizeConverterDcConnections(deviceId, connectionCount)
      if (!resized) pendingConverterResizeAnchorRef.current = null
      return resized
    },
    []
  )

  useLayoutEffect(() => {
    const pending = pendingConverterResizeAnchorRef.current
    if (!pending || !layoutTree) return
    const nextAnchor = findClosestLayoutNodeAnchor(
      layoutTree.panels,
      pending.deviceId,
      pending.previousAnchor
    )
    pendingConverterResizeAnchorRef.current = null
    if (!nextAnchor) return
    setEendraadView({
      zoom: pending.previousView.zoom,
      pan: getPanPreservingWorldAnchor(
        pending.previousView.pan,
        pending.previousView.zoom,
        pending.previousAnchor,
        nextAnchor
      ),
    })
  }, [layoutTree, setEendraadView])

  const refreshViewportHitGraph = useCallback((remeasure: boolean) => {
    const stage = canvasRef.current?.getStage()
    const contentGroup = stage?.findOne('.canvas-content')
    if (!stage || !contentGroup) return

    const { pan, zoom, viewport } = viewportHitViewRef.current
    if (viewport.width <= 0 || viewport.height <= 0 || !Number.isFinite(zoom) || zoom <= 0) {
      return
    }

    const overscan = VIEWPORT_HIT_OVERSCAN_PX / zoom
    const visibleBounds: ViewportHitBounds = {
      left: -pan.x / zoom - overscan,
      top: -pan.y / zoom - overscan,
      right: (viewport.width - pan.x) / zoom + overscan,
      bottom: (viewport.height - pan.y) / zoom + overscan,
    }
    let changed = false

    stage.find(VIEWPORT_HIT_CULLABLE_SELECTOR).forEach((node) => {
      let hitBounds = remeasure
        ? undefined
        : (node.getAttr(VIEWPORT_HIT_BOUNDS_ATTRIBUTE) as ViewportHitBounds | undefined)
      if (!hitBounds) {
        const rect = node.getClientRect({ relativeTo: contentGroup as Konva.Container })
        if (
          !Number.isFinite(rect.x) ||
          !Number.isFinite(rect.y) ||
          !Number.isFinite(rect.width) ||
          !Number.isFinite(rect.height)
        ) {
          return
        }
        hitBounds = {
          left: rect.x,
          top: rect.y,
          right: rect.x + rect.width,
          bottom: rect.y + rect.height,
        }
        node.setAttr(VIEWPORT_HIT_BOUNDS_ATTRIBUTE, hitBounds)
      }

      const shouldListen = boundsIntersect(hitBounds, visibleBounds)
      if (node.listening() === shouldListen) return
      node.listening(shouldListen)
      changed = true
    })

    // Only the pixel hit canvas changed; avoid repainting the visible scene.
    if (changed) contentGroup.getLayer()?.drawHit()
  }, [])

  const scheduleViewportHitGraphRefresh = useCallback(
    (remeasure: boolean) => {
      viewportHitNeedsRemeasureRef.current ||= remeasure
      if (viewportHitRefreshTimerRef.current != null) {
        window.clearTimeout(viewportHitRefreshTimerRef.current)
      }
      viewportHitRefreshTimerRef.current = window.setTimeout(() => {
        viewportHitRefreshTimerRef.current = null
        const needsRemeasure = viewportHitNeedsRemeasureRef.current
        viewportHitNeedsRemeasureRef.current = false
        refreshViewportHitGraph(needsRemeasure)
      }, 100)
    },
    [refreshViewportHitGraph]
  )

  useEffect(() => {
    scheduleViewportHitGraphRefresh(true)
  }, [layoutTree, scheduleViewportHitGraphRefresh, wireSegments])

  useEffect(() => {
    scheduleViewportHitGraphRefresh(false)
  }, [
    eendraadView.pan.x,
    eendraadView.pan.y,
    eendraadView.zoom,
    scheduleViewportHitGraphRefresh,
    viewportPixelSize.height,
    viewportPixelSize.width,
  ])

  useEffect(
    () => () => {
      if (viewportHitRefreshTimerRef.current != null) {
        window.clearTimeout(viewportHitRefreshTimerRef.current)
      }
    },
    []
  )

  // Ensure the main panel is visible on first render when no saved view exists.
  // This runs from layout data alone — no Konva dependency — so it fires
  // immediately without waiting for the canvas scene graph to populate.
  const hasSetInitialView = useRef(false)
  useEffect(() => {
    if (hasSetInitialView.current || !layout || layout.panels.length === 0) return
    const view = useUIStore.getState().eendraadView
    if (view.pan.x !== 0 || view.pan.y !== 0) {
      hasSetInitialView.current = true
      return
    }
    hasSetInitialView.current = true
    const frame = layout.panels[0]!.frame
    const contentCenterX = frame.x + frame.width / 2
    const contentCenterY = frame.y + frame.height / 2
    const el = canvasRef.current?.getStage()?.container()
    const rect = el?.getBoundingClientRect()
    const vpW = rect?.width ?? 800
    const vpH = rect?.height ?? 600
    const padding = Math.min(vpW, vpH) * 0.1
    const fitZoom = Math.min(
      (vpW - padding * 2) / frame.width,
      (vpH - padding * 2) / frame.height,
      2
    )
    const zoom = Math.max(0.1, fitZoom)
    setEendraadView({
      zoom,
      pan: {
        x: vpW / 2 - contentCenterX * zoom,
        y: vpH / 2 - contentCenterY * zoom,
      },
    })
  }, [layout, setEendraadView])

  useEendraadCircuitLetterHotkeys(currentProject, pointerOverEendraadRef)

  // Convert pointer position from a Konva drag event to canvas/layout coordinates (for correct drop target).
  // Uses cursor position so drop target matches where the user released, not where the dragged symbol is.
  const getCanvasPositionFromEvent = useCallback((e: unknown) => {
    if (!isKonvaPointerEventLike(e)) return null
    const stage = e.target?.getStage?.()
    const pointer = stage?.getPointerPosition?.()
    if (!pointer) return null
    const view = eendraadViewRef.current
    return {
      x: (pointer.x - view.pan.x) / view.zoom,
      y: (pointer.y - view.pan.y) / view.zoom,
    }
  }, [])

  /** Match handleDrop / endpoint drag: resolve vertical trunk wire domain from segments under the cursor. */
  const augmentCircuitVerticalWireDomain = useCallback(
    (rawTarget: DropTarget, position: Point): DropTarget => {
      let dropTarget = rawTarget
      if (
        rawTarget.type === 'circuit' &&
        rawTarget.circuitId &&
        rawTarget.panelId &&
        typeof rawTarget.circuitTrunkSegmentIndex !== 'number'
      ) {
        const panelWires = wireSegments.filter(
          (ws) => ws.panelId === rawTarget.panelId && ws.circuitId === rawTarget.circuitId
        )
        const verticalCandidates = panelWires.filter(
          (ws) => ws.type === 'vertical' && ws.startPoint.x === ws.endPoint.x
        )
        const hitVertical = verticalCandidates.find((ws) => {
          const x = ws.startPoint.x
          const minY = Math.min(ws.startPoint.y, ws.endPoint.y)
          const maxY = Math.max(ws.startPoint.y, ws.endPoint.y)
          const withinX = Math.abs(position.x - x) <= 15
          const withinY = position.y >= minY - 10 && position.y <= maxY + 10
          return withinX && withinY
        })
        if (hitVertical) {
          dropTarget = { ...rawTarget, wireDomain: hitVertical.domain as DropTarget['wireDomain'] }
        }
      }
      return dropTarget
    },
    [wireSegments]
  )

  /** Circuit trunk device drag: ignore other trunk device symbols; resolve segment from wire geometry. */
  const resolveTrunkRelocateDropTarget = useCallback(
    (position: Point): DropTarget | null => {
      if (!layoutTree) return null
      const { target: rawTarget } = findDropTargetWithDebug(layoutTree, position, {
        ignoreCircuitTrunkDeviceSymbolHits: true,
      })
      const augmented = augmentCircuitVerticalWireDomain(rawTarget, position)
      return ensureCircuitTrunkWireSegmentOnDropTarget(layoutTree, position, augmented)
    },
    [augmentCircuitVerticalWireDomain, layoutTree]
  )

  // When wire segments are regenerated or a selection arrives from another surface (such as
  // validation), re-sync it so the same logical wire uses this canvas instance's generated ID.
  useEffect(() => {
    if (selection.type !== 'wire' || selection.ids.length === 0 || !selection.wireMetadata?.length)
      return
    const resolveByMetadata = (metadata: NonNullable<typeof selection.wireMetadata>[number]) => {
      if (metadata.wireAnchor) return wireSegments.find(wire => wire.wireAnchor === metadata.wireAnchor) ?? null
      let matched = null as (typeof wireSegments)[number] | null
      if (
        metadata.supplySectionKey ||
        (metadata.supplyAssemblyId && metadata.supplyConnectionId) ||
        metadata.isSupply
      ) {
        matched = resolveSupplyWireSegmentByMetadata(wireSegments, metadata)
      } else if (
        metadata.domoticaOutputGroup &&
        typeof metadata.domoticaOutputIndex === 'number' &&
        metadata.circuitId
      ) {
        matched =
          wireSegments.find(
            (ws) =>
              ws.type === 'branch' &&
              ws.circuitId === metadata.circuitId &&
              ws.panelId === metadata.panelId &&
              ws.domoticaOutputGroup === metadata.domoticaOutputGroup &&
              ws.domoticaOutputIndex === metadata.domoticaOutputIndex
          ) ?? null
      } else if (metadata.isGround) {
        matched =
          wireSegments.find(
            (ws) =>
              ws.type === 'vertical' &&
              ws.fromElementType === 'ground' &&
              ws.panelId === metadata.panelId
          ) ?? null
      } else if (metadata.circuitId) {
        matched = resolveCircuitWireSegmentByMetadata(wireSegments, metadata)
      }
      return matched
    }
    const updatedIds: string[] = []
    const updatedMetadata: NonNullable<typeof selection.wireMetadata> = []
    for (const selectedId of selection.ids) {
      if (wireSegments.some((ws) => ws.id === selectedId)) {
        const metadata = selection.wireMetadata.find((m) => m.id === selectedId)
        updatedIds.push(selectedId)
        if (metadata) updatedMetadata.push(metadata)
        continue
      }
      const metadata = selection.wireMetadata.find((m) => m.id === selectedId)
      if (!metadata) continue
      const matched = resolveByMetadata(metadata)
      logger.info('[Wire Selection Debug][canvas rematch]', {
        requestedId: selectedId,
        metadata,
        matched: matched
          ? {
              id: matched.id,
              type: matched.type,
              domain: matched.domain,
              circuitId: matched.circuitId,
              panelId: matched.panelId,
              fromElementType: matched.fromElementType,
              fromElementId: matched.fromElementId,
              toElementType: matched.toElementType,
              toElementId: matched.toElementId,
              startPoint: matched.startPoint,
              endPoint: matched.endPoint,
            }
          : null,
      })
      if (!matched) continue
      updatedIds.push(matched.id)
      updatedMetadata.push({ ...metadata, id: matched.id })
    }
    const sameIds =
      updatedIds.length === selection.ids.length &&
      updatedIds.every((id, idx) => id === selection.ids[idx])
    if (sameIds) return
    if (updatedIds.length > 0) {
      setSelection({
        ...selection,
        ids: Array.from(new Set(updatedIds)),
        wireMetadata: updatedMetadata,
      })
    }
  }, [selection, wireSegments, setSelection])

  // Drop target detection
  const detectDropTargetCallback = useDropTargetDetection() // Tree-based hit testing

  // Drag preview state and handler
  const { dragPreview, setDragPreview, handleDragOver } = useEendraadDragPreview(
    detectDropTargetCallback,
    {
      draggingProtectionIdRef,
      getProtectionById: (id) => getProtectionById(id),
      movingPanelAttachmentIdRef,
      isPanelAttachmentDropAllowed: (panelId, target) =>
        currentProject
          ? isPanelAttachmentDropTargetTerminal(
              getProjectElectricalPanels(currentProject),
              panelId,
              target
            )
          : false,
      resolveSameSymbolAddMore: (position, symbol) => {
        if (!layoutTree) return null
        const target = findSameSymbolAddMoreLayoutTargets(symbol.id, layoutTree, position)[0]
        if (!target) return null
        const targetId = target.target.endpoint?.id ?? target.target.trunkDevice?.id
        return targetId === internalDragElementIdRef.current ? null : target
      },
      isBlockedDropPosition: (position) =>
        layoutTree ? positionHitsMultiplierBadge(layoutTree, position) : false,
    }
  )
  const protectionMainBusCursorRef = useRef<Konva.Circle | null>(null)

  // Keep an internally dragged symbol active independently from the currently
  // hovered target. Relocation may clear dragPreview while the pointer is
  // between wires, but the legal drop-zone hints should remain visible.
  const activePlacementSymbol =
    dragPreview?.symbolData ?? internalDragPlacement?.symbol ?? libraryDragSymbol
  const activePlacementSymbolId = activePlacementSymbol?.id

  const activeDropTargetNodeId = useMemo(() => {
    if (!layoutTree || !dragPreview?.dropTarget || dragPreview.position.x === -Infinity) {
      return null
    }
    const hitTestOptions: FindDropTargetOptions = {
      ...(dragPreview.relocatingTrunkDevice ? { ignoreCircuitTrunkDeviceSymbolHits: true } : {}),
      ...(activePlacementSymbolId !== 'earthing_separator'
        ? { preferMainBusOverGroundWire: true }
        : {}),
      ...(activePlacementSymbolId &&
      PROTECTION_SYMBOL_IDS.includes(
        activePlacementSymbolId as (typeof PROTECTION_SYMBOL_IDS)[number]
      )
        ? { preferSecondaryBusForNestedProtection: true }
        : {}),
    }
    const { debug } = findDropTargetWithDebug(layoutTree, dragPreview.position, hitTestOptions)
    const matched = debug.path.find((step) => step.matched && step.nodeId)
    return matched?.nodeId ?? null
  }, [activePlacementSymbolId, layoutTree, dragPreview])

  // Layout + wires preview graph based on simulated drop
  const previewGraph = useEendraadPreviewGraph(
    dragPreview?.sameSymbolAddMore ? null : dragPreview,
    layout
  )

  useEffect(() => {
    if (!import.meta.env.VITE_E2E) return
    ;(
      window as Window & {
        __eendraNestedPreviewDebug?: {
          dropTarget: DropTarget | null
          createdProtectionIds: string[]
          affectedPanelIds: string[]
        }
      }
    ).__eendraNestedPreviewDebug = {
      dropTarget: dragPreview?.dropTarget ?? null,
      createdProtectionIds: previewGraph?.createdProtectionIds ?? [],
      affectedPanelIds: previewGraph?.affectedPanelIds ?? [],
    }
  }, [dragPreview?.dropTarget, previewGraph])

  useEffect(() => {
    if (!import.meta.env.VITE_E2E || !layoutTree) return

    const showNestedProtectionPreview = (event: Event) => {
      const {
        circuitId,
        symbolId = 'mcb',
        secondaryBusInsertIndex,
        secondaryBusItemCount,
        targetRegion = 'tip-upper',
      } = (
        event as CustomEvent<{
          circuitId?: string
          symbolId?: string
          secondaryBusInsertIndex?: number
          secondaryBusItemCount?: number
          targetRegion?:
            | 'tip-upper'
            | 'tip-center'
            | 'tip-outer'
            | 'body-center'
            | 'body-outer'
            | 'feeder-center'
        }>
      ).detail ?? { circuitId: undefined }
      if (!circuitId) return

      let nestNode: LayoutNode | null = null
      let protectionNode: LayoutNode | null = null
      let feederNode: LayoutNode | null = null
      const visit = (node: LayoutNode) => {
        if (node.id === `circuit-nest-${circuitId}`) {
          nestNode = node
        }
        if (node.type === 'mcb' && node.circuitIdForWires === circuitId) protectionNode = node
        if (!feederNode && node.id?.startsWith(`circuit-trunk-${circuitId}-segment-`)) {
          feederNode = node
        }
        node.children?.forEach(visit)
      }
      layoutTree.panels.forEach(visit)
      const targetNode = targetRegion.startsWith('body')
        ? protectionNode
        : targetRegion === 'feeder-center'
          ? feederNode
          : nestNode
      if (!targetNode) return

      const symbol = getSymbolById(symbolId)
      if (!symbol) return
      if (typeof secondaryBusInsertIndex === 'number') {
        const findNodeById = (node: LayoutNode, id: string): LayoutNode | undefined => {
          if (node.id === id) return node
          for (const child of node.children) {
            const match = findNodeById(child, id)
            if (match) return match
          }
          return undefined
        }
        const secondaryBusNode = layoutTree.panels
          .map((panel) => findNodeById(panel, `secondary-bus-${circuitId}`))
          .find((node): node is LayoutNode => !!node)
        if (!secondaryBusNode) return

        const childXs = [...(secondaryBusNode.nestedChildXs ?? [])].sort((a, b) => a - b)
        const slotX =
          secondaryBusInsertIndex <= 0
            ? secondaryBusNode.bounds.x + 1
            : secondaryBusInsertIndex >= childXs.length
              ? secondaryBusNode.bounds.x + secondaryBusNode.bounds.width - 1
              : ((childXs[secondaryBusInsertIndex - 1] ?? secondaryBusNode.bounds.x) +
                  (childXs[secondaryBusInsertIndex] ??
                    secondaryBusNode.bounds.x + secondaryBusNode.bounds.width)) /
                2
        const panelNode = layoutTree.panels.find((panel) =>
          Boolean(findNodeById(panel, secondaryBusNode.id))
        )
        if (!panelNode?.domainId) return

        setDragPreview({
          position: {
            x: slotX,
            y: secondaryBusNode.bounds.y + secondaryBusNode.bounds.height / 2,
          },
          symbolData: symbol,
          dropTarget: {
            type: 'circuit',
            panelId: panelNode.domainId,
            circuitId,
            secondaryBusInsertIndex,
            secondaryBusItemCount: secondaryBusItemCount ?? childXs.length,
          },
        })
        return
      }
      const bounds = getHitZoneBounds(targetNode, 'core')
      const paddedBounds = getHitZoneBounds(targetNode, 'padded')
      handleDragOver(
        targetRegion === 'tip-outer' || targetRegion === 'body-outer'
          ? {
              x: bounds.right + Math.min(5, (paddedBounds.right - bounds.right) / 2),
              y: (bounds.top + bounds.bottom) / 2,
            }
          : {
              x: (bounds.left + bounds.right) / 2,
              y: targetRegion === 'tip-upper' ? bounds.top + 8 : (bounds.top + bounds.bottom) / 2,
            },
        symbol
      )
    }

    window.addEventListener(
      'eendra:e2e-show-nested-protection-preview',
      showNestedProtectionPreview
    )
    return () =>
      window.removeEventListener(
        'eendra:e2e-show-nested-protection-preview',
        showNestedProtectionPreview
      )
  }, [handleDragOver, layoutTree, setDragPreview])

  const preferLegacyDragPreview = false
  const isEmptyDomoticaOutputPreview =
    !!dragPreview?.dropTarget?.domoticaOutput &&
    !!dragPreview.dropTarget.panelId &&
    !!dragPreview.dropTarget.circuitId &&
    !!dragPreview.dropTarget.endpointId &&
    wireSegments.some(
      (ws) =>
        ws.panelId === dragPreview.dropTarget?.panelId &&
        ws.circuitId === dragPreview.dropTarget?.circuitId &&
        ws.type === 'branch' &&
        ws.fromElementId === dragPreview.dropTarget?.endpointId &&
        ws.domoticaOutputGroup === dragPreview.dropTarget?.domoticaOutput?.group &&
        ws.domoticaOutputIndex === dragPreview.dropTarget?.domoticaOutput?.index &&
        !ws.toElementId
    )
  const hasSimulatedPreviewVisuals =
    !!previewGraph &&
    !isEmptyDomoticaOutputPreview &&
    previewGraph.layout != null &&
    previewGraph.layoutTree != null &&
    previewGraph.affectedPanelIds.length > 0 &&
    (previewGraph.wireSegments.length > 0 ||
      previewGraph.createdEndpointIds.length > 0 ||
      previewGraph.createdProtectionIds.length > 0 ||
      previewGraph.createdTrunkDeviceIds.length > 0)
  const showLegacyDragPreview =
    !!dragPreview &&
    activePlacementSymbolId !== 'dc_bus' &&
    (preferLegacyDragPreview || !hasSimulatedPreviewVisuals)
  const showSimulatedDragPreview = hasSimulatedPreviewVisuals && !preferLegacyDragPreview
  const offscreenSupplyPreviewDirection = useMemo(() => {
    if (!layout || !previewGraph || !showSimulatedDragPreview) return null
    return resolveOffscreenSupplyPreviewDirection({
      currentLayout: layout,
      previewLayout: previewGraph.layout,
      pan: eendraadView.pan,
      zoom: eendraadView.zoom,
      viewport: viewportPixelSize,
    })
  }, [
    eendraadView.pan,
    eendraadView.zoom,
    layout,
    previewGraph,
    showSimulatedDragPreview,
    viewportPixelSize,
  ])

  const handleZoomChange = useCallback(
    (zoom: number) => {
      setEendraadView({ zoom })
    },
    [setEendraadView]
  )

  const handlePanChange = useCallback(
    (pan: { x: number; y: number }) => {
      setEendraadView({ pan })
    },
    [setEendraadView]
  )

  const handleViewTransformCommit = useCallback(
    (patch: { pan?: Point; zoom?: number }) => {
      setEendraadView(patch)
    },
    [setEendraadView]
  )

  // Selection bounds in 1‑wire view (used by BaseCanvas fit-to-selection)
  const handleGetSelectionBounds = useCallback(
    (selectionOverride?: Selection) => {
      const selection = selectionOverride ?? useUIStore.getState().selection
      if (!selection.type || !selection.ids || selection.ids.length === 0) {
        return null
      }

      if (selection.type === 'circuit' && selection.ids.length > 0) {
        const rootId = selection.ids[0]
        if (!rootId) return null
        const st = useProjectStore.getState()
        if (!st.currentProject) return null
        return computeEendraadCircuitFocusBounds({
          rootCircuitId: rootId,
          wireSegments,
          layoutTree,
          getCircuitById: st.getCircuitById,
          getProtectionForCircuit: st.getProtectionForCircuit,
          findPanelForCircuit: st.findPanelForCircuit,
        })
      }

      // Wires: use generated wireSegments (more precise than generic node bounds)
      if (selection.type === 'wire' || (selection.type === 'structuralConnection' && selection.wireAnchor)) {
        const selectedIds = new Set(selection.ids)
        const selectedAnchors = new Set(selection.wireMetadata?.flatMap(meta => meta.wireAnchors ?? (meta.wireAnchor ? [meta.wireAnchor] : [])) ?? [])
        if (selection.wireAnchor) selectedAnchors.add(selection.wireAnchor)
        let selectedSegments = wireSegments.filter((ws) => selectedIds.has(ws.id) || ws.wireAnchors?.some(anchor => selectedAnchors.has(anchor)))
        if (selectedSegments.length === 0 && selectedAnchors.size === 0 && selection.wireMetadata?.length) {
          const resolved = new Map<string, (typeof wireSegments)[number]>()
          for (const metadata of selection.wireMetadata) {
            let matched = null as (typeof wireSegments)[number] | null
            if (
              metadata.domoticaOutputGroup &&
              typeof metadata.domoticaOutputIndex === 'number' &&
              metadata.circuitId
            ) {
              matched =
                wireSegments.find(
                  (ws) =>
                    ws.type === 'branch' &&
                    ws.circuitId === metadata.circuitId &&
                    ws.panelId === metadata.panelId &&
                    ws.domoticaOutputGroup === metadata.domoticaOutputGroup &&
                    ws.domoticaOutputIndex === metadata.domoticaOutputIndex
                ) ?? null
            } else if (metadata.isGround) {
              matched =
                wireSegments.find(
                  (ws) =>
                    ws.type === 'vertical' &&
                    ws.fromElementType === 'ground' &&
                    ws.panelId === metadata.panelId
                ) ?? null
            } else if (
              metadata.supplySectionKey ||
              (metadata.supplyAssemblyId && metadata.supplyConnectionId) ||
              metadata.isSupply
            ) {
              matched = resolveSupplyWireSegmentByMetadata(wireSegments, metadata)
            } else if (metadata.circuitId) {
              if (metadata.fromElementId !== undefined || metadata.toElementId !== undefined) {
                matched =
                  wireSegments.find(
                    (ws) =>
                      ws.type === 'vertical' &&
                      ws.circuitId === metadata.circuitId &&
                      ws.panelId === metadata.panelId &&
                      (metadata.fromElementId === undefined ||
                        ws.fromElementId === metadata.fromElementId) &&
                      (metadata.toElementId === undefined ||
                        ws.toElementId === metadata.toElementId)
                  ) ?? null
              }
              if (!matched) {
                matched =
                  wireSegments.find(
                    (ws) =>
                      ws.type === 'vertical' &&
                      ws.circuitId === metadata.circuitId &&
                      ws.panelId === metadata.panelId
                  ) ?? null
              }
            }
            if (matched) resolved.set(matched.id, matched)
          }
          selectedSegments = Array.from(resolved.values())
        }
        if (selectedSegments.length === 0) return null

        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        let found = false

        for (const ws of selectedSegments) {
          const pts = [ws.startPoint, ws.endPoint]
          for (const p of pts) {
            if (!p) continue
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
            minX = Math.min(minX, p.x)
            minY = Math.min(minY, p.y)
            maxX = Math.max(maxX, p.x)
            maxY = Math.max(maxY, p.y)
            found = true
          }
        }

        if (
          !found ||
          !Number.isFinite(minX) ||
          !Number.isFinite(minY) ||
          !Number.isFinite(maxX) ||
          !Number.isFinite(maxY)
        ) {
          return null
        }

        const padding = 10
        return {
          x: minX - padding,
          y: minY - padding,
          width: maxX - minX + padding * 2,
          height: maxY - minY + padding * 2,
        }
      }

      // Other 1‑wire selections (endpoint, protection, trunkDevice, supply, panel)
      // Use layoutTree as the single source of truth for element bounds.
      if (!layoutTree) return null

      type LayoutNode = import('@/lib/layout/layoutTree').LayoutNode

      let selectedIds = new Set(selection.ids)
      const acceptableTypes: Array<import('@/lib/layout/layoutTree').LayoutNodeType> = []

      if (selection.type === 'endpoint') {
        acceptableTypes.push('endpoint')
      } else if (selection.type === 'placement') {
        acceptableTypes.push('endpoint')
        selectedIds = endpointIdsForPlacementSelection(
          () => useProjectStore.getState().getAllEndpoints(),
          selection.ids
        )
        if (selectedIds.size === 0) return null
      } else if (selection.type === 'protection') {
        acceptableTypes.push('mcb', 'rcd')
      } else if (selection.type === 'trunkDevice') {
        acceptableTypes.push('trunkDevice')
      } else if (selection.type === 'supply') {
        acceptableTypes.push('supply')
      } else if (selection.type === 'panel') {
        acceptableTypes.push('panel')
      }

      if (acceptableTypes.length === 0) return null

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      let found = false

      const visitNode = (node: LayoutNode) => {
        if (
          node.domainId &&
          selectedIds.has(node.domainId) &&
          acceptableTypes.includes(node.type)
        ) {
          const { x, y, width, height } = node.bounds
          if (
            Number.isFinite(x) &&
            Number.isFinite(y) &&
            Number.isFinite(width) &&
            Number.isFinite(height) &&
            width > 0 &&
            height > 0
          ) {
            minX = Math.min(minX, x)
            minY = Math.min(minY, y)
            maxX = Math.max(maxX, x + width)
            maxY = Math.max(maxY, y + height)
            found = true
          }
        }
        if (node.children && node.children.length > 0) {
          for (const child of node.children) {
            visitNode(child)
          }
        }
      }

      for (const panelNode of layoutTree.panels) {
        visitNode(panelNode)
      }

      if (
        !found ||
        !Number.isFinite(minX) ||
        !Number.isFinite(minY) ||
        !Number.isFinite(maxX) ||
        !Number.isFinite(maxY)
      ) {
        return null
      }

      const padding = 10
      return {
        x: minX - padding,
        y: minY - padding,
        width: maxX - minX + padding * 2,
        height: maxY - minY + padding * 2,
      }
    },
    [wireSegments, layoutTree]
  )

  const handleFitToView = useCallback(() => {
    const viewportLayout = useUIStore.getState().viewportLayout
    const canvasesToFit =
      viewportLayout.panels.length === 1
        ? ['eendraad' as const]
        : Array.from(new Set(viewportLayout.panels.map((panel) => panel.canvas)))
    requestFitToView(canvasesToFit)
  }, [requestFitToView])

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
  const dateToolAnchorSelection = useMemo(() => {
    if (!layout || selectedDateToolTargets.length !== 1) return selection
    const target = selectedDateToolTargets[0]
    if (target?.type !== 'panel') return selection
    for (const panelLayout of layout.panels) {
      for (const element of panelLayout.elements) {
        if (element.type !== 'endpoint' || !element.endpointId) continue
        const endpoint = getEndpointById(element.endpointId)
        if (endpoint?.symbol === 'panel_distribution' && endpoint.panelId === target.id) {
          return { type: 'endpoint' as const, ids: [endpoint.id] }
        }
      }
    }
    return selection
  }, [getEndpointById, layout, selectedDateToolTargets, selection])

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
      withSingleUndoEntry(() => {
        if (currentProject) {
          let nextColors = currentProject.project.installDateColors ?? {}
          let changedColors = false
          for (const target of targets) {
            const inheritedYear = getInstallDateTargetInheritedYear(currentProject, target)
            const requestedYear = target.preserveYear ?? year
            if (
              target.clearOverride ||
              requestedYear == null ||
              (!target.forceOverride && requestedYear === inheritedYear)
            )
              continue
            const key = getInstallYearColorKey(requestedYear)
            if (nextColors[key]) continue
            nextColors = {
              ...nextColors,
              [key]: pickInstallYearColor(nextColors),
            }
            changedColors = true
          }
          if (changedColors) {
            updateProject({ installDateColors: nextColors })
          }
        }
        for (const target of targets) {
          const inheritedYear = currentProject
            ? getInstallDateTargetInheritedYear(currentProject, target)
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
          if (target.type === 'panel') {
            updatePanel(target.id, {
              installationDate: targetDate,
              installationDateSuppressed,
              rulesetDateOverride: undefined,
            })
          } else if (target.type === 'protection') {
            updateProtection(target.id, {
              installationDate: targetDate,
              installationDateSuppressed,
              rulesetDateOverride: undefined,
            })
          } else if (target.type === 'circuit') {
            updateCircuit(target.id, {
              installationDate: targetDate,
              installationDateSuppressed,
              rulesetDateOverride: undefined,
            })
          } else if (target.type === 'endpoint') {
            updateEndpoint(target.id, {
              installationDate: targetDate,
              installationDateSuppressed,
              rulesetDateOverride: undefined,
            })
          } else if (target.type === 'trunkDevice') {
            const result = getTrunkDeviceById(target.id)
            if (result?.isSupplyDevice) {
              if (result.supplyFeedScope === 'shared') continue
              updateSupplyTrunkDevice(target.id, {
                installationDate: targetDate,
                installationDateSuppressed,
                rulesetDateOverride: undefined,
              })
            } else if (result?.isGroundDevice) {
              updateGroundTrunkDevice(target.id, {
                installationDate: targetDate,
                installationDateSuppressed,
                rulesetDateOverride: undefined,
              })
            } else if (result?.circuit) {
              updateTrunkDevice(result.circuit.id, target.id, {
                installationDate: targetDate,
                installationDateSuppressed,
                rulesetDateOverride: undefined,
              })
            }
          }
        }
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
        return true
      })
    },
    [
      currentProject,
      getCircuitById,
      getEndpointById,
      getPanelById,
      getProtectionById,
      getTrunkDeviceById,
      updateCircuit,
      updateEndpoint,
      updateGroundTrunkDevice,
      updatePanel,
      updateProtection,
      updateProject,
      updateSupplyTrunkDevice,
      updateTrunkDevice,
      withSingleUndoEntry,
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
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t(
                'installDates.propagatePanelMessage',
                'Choose whether this install date should feed down from the panel.'
              )}
            </p>
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
  }, [applyInstallYearTargets, canUseInstallDates, dateToolSelectionKey, selectedDateToolTargets])

  const updateInstallDateColor = useCallback(
    (year: number, color: string) => {
      if (!currentProject || !canUseInstallDates) return
      updateProject({
        installDateColors: {
          ...(currentProject.project.installDateColors ?? {}),
          [String(year)]: color,
        },
      })
    },
    [canUseInstallDates, currentProject, updateProject]
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
    dateToolSelectionKey,
    selectedDateToolDate,
  ])

  useEffect(() => {
    setClosedDateToolSelectionKey(null)
    setDateToolFrameSelection(null)
  }, [selection.ids, selection.type])

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
  }, [
    dateToolCalendarOpen,
    dateToolSelectionBounds,
    eendraadView.pan.x,
    eendraadView.pan.y,
    eendraadView.zoom,
  ])

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
    const clamped = parsed == null ? selectedDateToolYear : clamp(currentInstallYear, 1900, parsed)
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
  ])

  const fitTrigger = useUIStore((s) => s.fitToViewTrigger.eendraad)
  useEffect(() => {
    if (fitTrigger === 0) return
    let canceled = false
    let raf = 0
    const attempt = (remaining: number) => {
      raf = requestAnimationFrame(() => {
        if (canceled) return
        const ok = canvasRef.current?.fitToView()
        if (!ok && remaining > 0) {
          attempt(remaining - 1)
        }
      })
    }
    // First rAF lets react-konva reconcile the scene graph; up to 4 retries
    // cover cases where the Konva stage is still empty right after mount.
    raf = requestAnimationFrame(() => {
      if (canceled) return
      attempt(4)
    })
    return () => {
      canceled = true
      cancelAnimationFrame(raf)
    }
  }, [fitTrigger])

  // Find elements that intersect with selection rectangle
  const handleFindElementsInRectangle = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) =>
      createFindElementsInRectangleHandler(layoutTree)(rect),
    [layoutTree]
  )

  const handleDrop = useCallback(
    (position: Point, symbolData: unknown, _meta?: CanvasDropMeta) => {
      // Clear preview immediately when drop happens
      setDragPreview(null)

      if (!currentProject || !symbolData) return

      const symbol = symbolData as SymbolMetadata
      const protectionIds = [...PROTECTION_SYMBOL_IDS]
      const isProtectionPlacement = protectionIds.includes(
        symbol.id as (typeof PROTECTION_SYMBOL_IDS)[number]
      )

      // Use debug version to get tree walk information
      if (!layoutTree) {
        logger.warn('No layout tree available for drop target detection')
        return
      }

      if (positionHitsMultiplierBadge(layoutTree, position)) return

      const directSameSymbolTarget = findSameSymbolAddMoreLayoutTargets(
        symbol.id,
        layoutTree,
        position
      )[0]

      const { target: rawTarget, debug: dropDebug } = findDropTargetWithDebug(
        layoutTree,
        position,
        symbol.id === 'earthing_separator'
          ? undefined
          : {
              preferMainBusOverGroundWire: true,
              preferMainBusOverSupplyWire: Boolean(symbol.busFeedKind) || isProtectionPlacement,
              preferSecondaryBusForNestedProtection: isProtectionPlacement,
              ...(symbol.id === 'dc_bus' ? { preferCircuitTrunkWire: true } : {}),
              ...(symbol.id === 'source_changeover'
                ? { normalizeDirectConverterChangeoverDrop: true }
                : {}),
            }
      )

      const matchedDomainId = dropDebug.path.find((step) => step.matched)?.domainId
      const sameSymbolEndpointId =
        directSameSymbolTarget?.target.endpoint?.id ?? rawTarget.endpointId ?? matchedDomainId
      const sameSymbolEndpoint = sameSymbolEndpointId
        ? getEndpointById(sameSymbolEndpointId)
        : undefined
      const sameSymbolTrunkDevice =
        directSameSymbolTarget?.target.trunkDevice ??
        (matchedDomainId ? getTrunkDeviceById(matchedDomainId)?.device : undefined)
      const sameSymbolTarget: SameSymbolAddMoreTarget | null = sameSymbolEndpoint
        ? { endpoint: sameSymbolEndpoint }
        : sameSymbolTrunkDevice
          ? { trunkDevice: sameSymbolTrunkDevice }
          : null
      const sameSymbolAddMoreResult = incrementSameSymbolAddMoreTargetWithUndo(
        symbol.id,
        sameSymbolTarget,
        {
          syncEndpointCount: (endpointId, count) =>
            syncEndpointMultiplierCount(createSyncEndpointMultiplierDeps(), endpointId, count),
          syncSupplyDeviceCount: (deviceId, count) =>
            syncSupplyDeviceMultiplierCount(
              createSyncSupplyInverterMultiplierDeps(),
              deviceId,
              count
            ),
          withSingleUndoEntry,
        }
      )
      if (sameSymbolAddMoreResult === 'incremented') {
        trackSymbolPlace({
          canvas: 'eendraad',
          symbol,
          placementMethod: 'library_drop',
          targetType: sameSymbolEndpoint ? 'endpoint' : 'trunkDevice',
        })
        return
      }
      if (sameSymbolAddMoreResult === 'blocked') {
        logger.warn(`[drop-diag] Add-more blocked for symbol=${symbol.id}`)
        return
      }
      if (!canCreateSupplyTopologyFromDrop(symbol, null)) {
        logger.warn(`[drop-diag] Supply topology gate (null target) blocked symbol=${symbol.id}`)
        return
      }

      // Augment drop target with wire-domain information from the actual wire segments under the cursor.
      let dropTarget = rawTarget
      if (
        symbol.busFeedKind &&
        rawTarget.type === null &&
        rawTarget.panelId &&
        rawTarget.diagramId?.endsWith('--supply')
      ) {
        dropTarget = { ...rawTarget, type: 'mainBus', mainBusInsertIndex: 0 }
      }
      if (
        rawTarget.type === 'circuit' &&
        rawTarget.circuitId &&
        rawTarget.panelId &&
        // For explicit trunk segment hit zones, domain is resolved from segment index
        // in drop behavior; avoid overriding with a potentially wrong vertical segment.
        typeof rawTarget.circuitTrunkSegmentIndex !== 'number'
      ) {
        const panelWires = wireSegments.filter(
          (ws) => ws.panelId === rawTarget.panelId && ws.circuitId === rawTarget.circuitId
        )
        // Find the vertical circuit wire segment nearest to the cursor.
        const verticalCandidates = panelWires.filter(
          (ws) => ws.type === 'vertical' && ws.startPoint.x === ws.endPoint.x
        )
        const hitVertical = verticalCandidates.find((ws) => {
          const x = ws.startPoint.x
          const minY = Math.min(ws.startPoint.y, ws.endPoint.y)
          const maxY = Math.max(ws.startPoint.y, ws.endPoint.y)
          const withinX = Math.abs(position.x - x) <= 15
          const withinY = position.y >= minY - 10 && position.y <= maxY + 10
          return withinX && withinY
        })
        if (hitVertical) {
          dropTarget = { ...rawTarget, wireDomain: hitVertical.domain as DropTarget['wireDomain'] }
        }
      }

      // Normalize generic panel-frame drops (type:null with panelId) for protection
      // devices so they behave exactly like drops on the main bus of that panel.
      if (
        dropTarget.type === null &&
        dropTarget.panelId &&
        symbol &&
        protectionIds.includes(symbol.id as (typeof PROTECTION_SYMBOL_IDS)[number])
      ) {
        dropTarget = { ...dropTarget, type: 'mainBus' }
      }

      if (symbol.busFeedKind) {
        const panel = dropTarget.panelId ? getPanelById(dropTarget.panelId) : undefined
        if (!panel) return
        const isSupplyFrameDrop = dropTarget.diagramId?.endsWith('--supply') ?? false
        if (isSupplyFrameDrop) {
          const didEnableSplit = panel.busSections?.length
            ? true
            : withSingleUndoEntry(
                () =>
                  useProjectStore
                    .getState()
                    .setPanelFeedOrganization(
                      panel.id,
                      panelHasModularChangeover(currentProject, panel.id)
                        ? 'split-switchable'
                        : 'split-backup'
                    ),
                { sessionLabel: 'enable split panel feed' }
              )
          if (didEnableSplit) {
            const busSectionId =
              symbol.busFeedKind === 'backup' ? `bus-backup-${panel.id}` : `bus-grid-${panel.id}`
            setSelection({
              type: 'busSection',
              ids: [busSectionId],
              busSectionMetadata: { panelId: panel.id, busSectionId },
            })
          }
          return
        }
        const order = getMainBusOrder(panel)
        const referencedId = dropTarget.protectionId ?? dropTarget.circuitId
        const referencedIndex = referencedId
          ? order.findIndex((item) => item.id === referencedId)
          : -1
        const insertIndex =
          dropTarget.type === 'mainBus' && typeof dropTarget.mainBusInsertIndex === 'number'
            ? dropTarget.mainBusInsertIndex
            : referencedIndex >= 0
              ? referencedIndex
              : undefined
        if (insertIndex == null) return
        const didPlaceFeedBoundary = withSingleUndoEntry(
          () =>
            useProjectStore
              .getState()
              .setPanelBusFeedBoundary(panel.id, symbol.busFeedKind!, insertIndex),
          { sessionLabel: 'split main bus feed' }
        )
        if (didPlaceFeedBoundary) {
          const busSectionId =
            symbol.busFeedKind === 'backup' ? `bus-backup-${panel.id}` : `bus-grid-${panel.id}`
          setSelection({
            type: 'busSection',
            ids: [busSectionId],
            busSectionMetadata: { panelId: panel.id, busSectionId },
          })
          trackSymbolPlace({
            canvas: 'eendraad',
            symbol,
            placementMethod: 'library_drop',
            targetType: 'mainBus',
          })
        }
        return
      }

      dropTarget = normalizeProtectionPlacementDropTarget(symbol, dropTarget)

      if (isProtectionPlacement && dropTarget.type === 'circuit' && dropTarget.circuitId) {
        const targetCircuit = getCircuitById(dropTarget.circuitId)
        const orderedDevices = [...(targetCircuit?.trunkDevices ?? [])].sort(
          (left, right) => (left.trunkPosition ?? 0) - (right.trunkPosition ?? 0)
        )
        const junctionPanelIndex = orderedDevices.findIndex(
          (device) => device.type === 'junction_panel' || device.symbol === 'junction_panel'
        )
        const isRotatingSwitchBranch =
          symbol.id === 'rotating_switch' && (dropTarget.branchEndpoints?.length ?? 0) > 0
        const insertsBeforeBoundary =
          typeof dropTarget.circuitTrunkSegmentIndex === 'number' &&
          dropTarget.circuitTrunkSegmentIndex <= junctionPanelIndex
        if (junctionPanelIndex >= 0 && !isRotatingSwitchBranch && !insertsBeforeBoundary) {
          logger.info('[EendraadCanvas] blocked protection after junction-panel boundary', {
            symbolId: symbol.id,
            circuitId: dropTarget.circuitId,
          })
          return
        }
      }

      logger.info(
        `[drop-diag] Executing drop: symbol=${symbol.id}, target=${JSON.stringify({ type: dropTarget.type, panelId: dropTarget.panelId, circuitId: dropTarget.circuitId, protectionId: dropTarget.protectionId })}`
      )
      // Execute drop behavior
      const { openDialog } = useDialogStore.getState()
      const runDropBehavior = () =>
        executeDropBehavior(
          symbol,
          dropTarget,
          currentProject,
          t,
          {
            addPanel,
            addProtection,
            addCircuit,
            addCircuitToProtection,
            addEndpoint,
            updateEndpoint,
            addPlacement,
            setSelection,
            dropCanvasPosition: position,
            getFloorById: (floorId: string) => {
              const floor = getFloorById(floorId)
              return floor
                ? {
                    id: floor.id,
                    layers: floor.layers,
                    hiddenSitplanPlacementIds: floor.hiddenSitplanPlacementIds,
                  }
                : null
            },
            updateFloor,
            getCircuitById: (circuitId: string) => getCircuitById(circuitId) || null,
            getProtectionById: (protectionId: string) => getProtectionById(protectionId) || null,
            addTrunkDevice,
            addSupplyTrunkDevice,
            updateSupplyTrunkDevice,
            addGroundTrunkDevice,
            ensureJunctionPanelPlacementForLabel,
            ensureSecondaryPanelEarthingStem: useProjectStore.getState().ensureSecondaryPanelEarthingStem,
            updateCircuit,
            updateProtection,
            updateInstallation,
            addSupplyAssembly: useProjectStore.getState().addSupplyAssembly,
            replaceSupplyAssembly: useProjectStore.getState().replaceSupplyAssembly,
            moveCircuitOnMainBus,
            moveCircuitToSecondaryBus,
            deleteEndpoint,
            deleteProtection: useProjectStore.getState().deleteProtection,
            addEendraadNote,
            onDropRejected: (message) => {
              openDialog({
                type: 'info',
                title: t('wires.domainMismatchTitle', { defaultValue: 'Cannot connect here' }),
                message,
                confirmLabel: t('common.ok', { defaultValue: 'OK' }),
                variant: 'warning',
              })
            },
          },
          false
        )
      const didPlaceSymbol = withSingleUndoEntry(
        () => {
          const before = useProjectStore.getState().currentProject
          runDropBehavior()
          const after = useProjectStore.getState().currentProject
          return before !== after
        },
        { sessionLabel: 'drop symbol from library onto installation plan' }
      )
      if (didPlaceSymbol) {
        trackSymbolPlace({
          canvas: 'eendraad',
          symbol,
          placementMethod: 'library_drop',
          targetType: dropTarget.type ?? 'empty',
        })
      }
    },
    [
      currentProject,
      t,
      layoutTree,
      setDragPreview,
      setSelection,
      addCircuit,
      addEndpoint,
      addPlacement,
      getFloorById,
      updateFloor,
      getProtectionById,
      wireSegments,
      addPanel,
      addProtection,
      addCircuitToProtection,
      addTrunkDevice,
      addSupplyTrunkDevice,
      updateSupplyTrunkDevice,
      addGroundTrunkDevice,
      ensureJunctionPanelPlacementForLabel,
      getCircuitById,
      getEndpointById,
      getTrunkDeviceById,
      updateCircuit,
      updateEndpoint,
      updateProtection,
      updateInstallation,
      moveCircuitOnMainBus,
      moveCircuitToSecondaryBus,
      deleteEndpoint,
      addEendraadNote,
      getPanelById,
      withSingleUndoEntry,
    ]
  )

  const pointerClientToCanvasPoint = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const stage = canvasRef.current?.getStage()
      const container = stage?.container()
      if (!stage || !container) return null
      const rect = container.getBoundingClientRect()
      const stageX = clientX - rect.left
      const stageY = clientY - rect.top
      const view = eendraadViewRef.current
      return {
        x: (stageX - view.pan.x) / view.zoom,
        y: (stageY - view.pan.y) / view.zoom,
      }
    },
    []
  )

  const endAltDuplicatePointerDrag = useCallback(() => {
    altDuplicatePointerCleanupRef.current?.()
    altDuplicatePointerCleanupRef.current = null
    draggingProtectionIdRef.current = null
    movingPanelAttachmentIdRef.current = null
    suppressKonvaDragEndRef.current = false
    setAltDuplicatePointerDragActive(false)
    internalDragElementIdRef.current = null
    setInternalDragPlacement(null)
    setDragPreview(null)
    trunkDnDLoggedStartRef.current = false
    elementDragModeRef.current = 'move'
  }, [setDragPreview])

  useEffect(
    () => () => {
      endAltDuplicatePointerDrag()
    },
    [endAltDuplicatePointerDrag]
  )

  const handleElementDragMoveRef = useRef<
    (elementId: string, elementType: string, newPos: Point) => void
  >(() => {})
  const handleElementDragEndRef = useRef<
    (elementId: string, elementType: string, position: Point) => boolean | void
  >(() => false)
  const handleElementDragStartRef = useRef<
    (elementId: string, elementType: string, altKey: boolean, nativeEvt?: MouseEvent) => boolean
  >(() => false)
  const endpointDragStartSelectionIdsRef = useRef<string[] | null>(null)
  const handleGroundDragEndRef = useRef<() => void>(() => {})
  const handleNoteDragEndRef = useRef<(noteId: string, newPos: Point) => void>(() => {})

  const stableElementDragMove = useCallback(
    (elementId: string, elementType: string, newPos: Point) =>
      handleElementDragMoveRef.current(elementId, elementType, newPos),
    []
  )

  const stableElementDragEnd = useCallback(
    (elementId: string, elementType: string, position: Point) =>
      handleElementDragEndRef.current(elementId, elementType, position),
    []
  )

  const stableElementDragStart = useCallback(
    (elementId: string, elementType: string, altKey: boolean, nativeEvt: MouseEvent) =>
      handleElementDragStartRef.current(elementId, elementType, altKey, nativeEvt),
    []
  )

  const stableGroundDragEnd = useCallback(() => {
    handleGroundDragEndRef.current()
  }, [])

  const stableNoteDragEnd = useCallback((noteId: string, newPos: Point) => {
    handleNoteDragEndRef.current(noteId, newPos)
  }, [])

  // Internal 1‑draad drag pipeline for existing symbols
  // Live drag: feed internal drags into the existing preview system so we get
  // the same ghost wires/rectangles as when adding a new symbol from the library.
  const handleElementDragMove = useCallback(
    (elementId: string, elementType: string, newPos: Point) => {
      if (elementType === 'panelAttachment') {
        movingPanelAttachmentIdRef.current = elementId
        const symbolMeta = getSymbolById('panel_distribution')
        if (!symbolMeta) return
        handleDragOver(newPos, symbolMeta)
        return
      }

      if (elementType === 'endpoint') {
        const endpoint = getEndpointById(elementId)
        if (!endpoint || !endpoint.symbol) return
        const symbolMeta = getSymbolById(endpoint.symbol)
        if (!symbolMeta) return
        handleDragOver(newPos, symbolMeta)
        const store = useProjectStore.getState()
        const selectionIds = endpointDragStartSelectionIdsRef.current
        const sourceCircuitId = store.findCircuitForEndpoint(elementId)?.circuit.id
        const selectedEndpointIds = (selectionIds ?? useUIStore.getState().selection.ids).filter(
          (id) => !!store.getEndpointById(id)
        )
        if (
          sourceCircuitId &&
          selectedEndpointIds.length > 1 &&
          selectedEndpointIds.includes(elementId)
        ) {
          setDragPreview((preview) =>
            preview
              ? {
                  ...preview,
                  movingEndpointSelection: {
                    draggedEndpointId: elementId,
                    sourceCircuitId,
                    endpointIds: selectedEndpointIds,
                  },
                }
              : preview
          )
        }
        return
      }

      if (elementType === 'protection') {
        const protection = getProtectionById(elementId)
        if (!protection) return
        draggingProtectionIdRef.current = elementId

        const typeMap: Record<string, string> = {
          MCB: 'mcb',
          RCD: 'rcd',
          RCBO: 'rcbo',
          FUSE: 'fuse',
          MAIN_SWITCH: 'main_switch',
          SPD: 'spd',
        }
        const symbolId = typeMap[protection.type]
        if (!symbolId) return
        const symbolMeta = getSymbolById(symbolId)
        if (!symbolMeta) return

        const sourcePanel = useProjectStore.getState().getPanelForProtection(elementId)
        const circuitId = sourcePanel
          ? pickRepresentativeCircuitIdForMainBusMove(sourcePanel, protection)
          : protection.circuits?.[0]?.id
        if (circuitId) {
          const resolvedTarget = layoutTree
            ? resolveProtectionDropTargetForPosition(
                layoutTree,
                newPos,
                findProtectionDragTarget,
                (panelId) => getPanelById(panelId),
                elementId,
                (id) => getProtectionById(id),
                { nestOnRcd: true }
              )
            : null
          if (layoutTree && !resolvedTarget) {
            setDragPreview(null)
            return
          }
          if (!resolvedTarget) return
          protectionMainBusCursorRef.current?.position(newPos)
          protectionMainBusCursorRef.current?.getLayer()?.batchDraw()
          const nextPreview = {
            position: newPos,
            symbolData: symbolMeta,
            dropTarget: resolvedTarget,
            movingProtection: { protectionId: elementId, circuitId },
          }
          setDragPreview((preview) =>
            getEendraadPreviewIntentKey(preview) === getEendraadPreviewIntentKey(nextPreview)
              ? { ...preview!, position: newPos, dropTarget: resolvedTarget }
              : nextPreview
          )
        }
        return
      }

      if (elementType === 'trunkDevice') {
        const info = getTrunkDeviceById(elementId)
        if (!info || info.isGroundDevice) return
        const meta = getSymbolById(info.device.symbol)
        if (!meta) return
        if (info.isSupplyDevice) {
          if (!layoutTree) return
          const { target } = findDropTargetWithDebug(layoutTree, newPos)
          if (!isSupplyTrunkDeviceDropTarget(info.device, target)) {
            setDragPreview(null)
            return
          }
          const targetPanelLayout = layout?.panels.find(
            (candidate) =>
              getPanelDiagramId(candidate) === target.diagramId ||
              (!target.diagramId && candidate.panel.id === target.panelId)
          )
          const targetMounting =
            currentProject && targetPanelLayout
              ? resolveSupplyDropMounting(
                  currentProject,
                  targetPanelLayout,
                  target,
                  newPos,
                  wireSegments
                )
              : undefined
          setDragPreview({
            position: newPos,
            symbolData: meta,
            dropTarget: target,
            relocatingSupplyTrunkDevice: { id: elementId, targetMounting },
          })
          return
        }
        if (!info.circuit) return
        if (trunkDnDVerboseLogEnabled() && !trunkDnDLoggedStartRef.current) {
          trunkDnDLoggedStartRef.current = true
          const st = useProjectStore.getState()
          const srcCircuit = st.getCircuitById(info.circuit.id)
          logTrunkDnD('canvas:drag-start', {
            deviceId: elementId,
            deviceSymbol: info.device.symbol,
            deviceType: info.device.type,
            sourceCircuitId: info.circuit.id,
            sourceCircuitCode: info.circuit.code,
            sourceTrunkOrderBottomToTop: serializeTrunkDevices(srcCircuit?.trunkDevices),
            pointerCanvas: newPos,
          })
        }
        const dropTarget = resolveTrunkRelocateDropTarget(newPos)
        if (!dropTarget) return
        setDragPreview({
          position: newPos,
          symbolData: meta,
          dropTarget,
          relocatingTrunkDevice: { id: elementId, sourceCircuitId: info.circuit.id },
        })
      }
    },
    [
      getEndpointById,
      getPanelById,
      getProtectionById,
      getTrunkDeviceById,
      handleDragOver,
      currentProject,
      layout,
      layoutTree,
      resolveTrunkRelocateDropTarget,
      setDragPreview,
      wireSegments,
    ]
  )

  // Drag end: treat as "add new at drop target, then delete original". Return
  // a boolean so the symbol can snap back when the drop was invalid.
  const handleElementDragEnd = useCallback(
    (elementId: string, elementType: string, position: Point) => {
      movingPanelAttachmentIdRef.current = null
      internalDragElementIdRef.current = null
      setInternalDragPlacement(null)
      const isDuplicateDrag = elementDragModeRef.current === 'duplicate'
      // Clear any preview once the drop is committed (pointer-drag path clears in endAltDuplicatePointerDrag)
      if (!altDuplicatePointerCleanupRef.current) {
        setDragPreview(null)
        trunkDnDLoggedStartRef.current = false
        elementDragModeRef.current = 'move'
      }

      const dragSelectionIds = (() => {
        const currentIds = useUIStore.getState().selection.ids
        const capturedIds = endpointDragStartSelectionIdsRef.current
        if (capturedIds?.includes(elementId)) return capturedIds
        return currentIds.includes(elementId) ? currentIds : [elementId]
      })()

      // A rectangle selection can contain mixed domain types while Selection.type is
      // only its compatibility/majority type. Resolve one accepted family from the
      // physical drop target before entering any single-symbol behavior.
      if (!isDuplicateDrag && dragSelectionIds.length > 1 && currentProject && layoutTree) {
        const store = useProjectStore.getState()
        const classified = classifyEendraadMoveSelection(dragSelectionIds, {
          isProtection: (id) => !!store.getProtectionById(id),
          isEndpoint: (id) => !!store.getEndpointById(id),
          isTrunkDevice: (id) => !!getTrunkDeviceById(id),
        })
        const { target: rawMultiTarget } = findDropTargetWithDebug(layoutTree, position, {
          preferMainBusOverGroundWire: true,
          preferMainBusOverSupplyWire: true,
          preferSecondaryBusForNestedProtection: classified.protectionIds.length > 0,
          ignoreCircuitTrunkDeviceSymbolHits: elementType === 'trunkDevice',
        })
        const multiKind = resolveEendraadMultiMoveKind(classified, rawMultiTarget)

        if (multiKind === 'endpoint') {
          const endpointTarget = augmentCircuitVerticalWireDomain(rawMultiTarget, position)
          if (classified.endpointIds.some((id) => store.getEndpointById(id)?.domoticaChildProps)) {
            return false
          }
          const plan = planEndpointSelectionMove(
            classified.endpointIds,
            endpointTarget,
            (id) => store.findCircuitForEndpoint(id)?.circuit,
            (id) => store.getCircuitById(id)
          )
          if (!plan) return false
          return withSingleUndoEntry(
            () => {
              for (const update of plan.updates) {
                updateCircuit(update.circuitId, {
                  endpoints: update.endpoints,
                  branches: update.branches,
                })
              }
              setSelection({ type: 'endpoint', ids: plan.movedEndpointIds })
              return true
            },
            { sessionLabel: 'move endpoint selection on installation plan' }
          )
        }

        if (multiKind === 'protection') {
          const target = resolveProtectionDropTargetForPosition(
            layoutTree,
            position,
            findProtectionDragTarget,
            (panelId) => store.getPanelById(panelId),
            undefined,
            undefined,
            { nestOnRcd: true }
          )
          if (!target?.panelId) return false
          const selectedProtections = classified.protectionIds
            .map((id) => {
              const protection = store.getProtectionById(id)
              const panel = store.getPanelForProtection(id)
              const circuitId =
                protection && panel
                  ? pickRepresentativeCircuitIdForMainBusMove(panel, protection)
                  : undefined
              return protection && panel && circuitId ? { id, circuitId } : null
            })
            .filter((item): item is { id: string; circuitId: string } => !!item)
          if (selectedProtections.length !== classified.protectionIds.length) return false
          const movable = collapseProtectionMoveRoots(selectedProtections, (circuitId) =>
            store.getCircuitById(circuitId)
          )
          if (
            movable.some((item) =>
              protectionDropTargetHitsSource(item.id, target, (id) => store.getProtectionById(id))
            )
          ) {
            return false
          }

          if (
            target.type !== 'mainBus' &&
            !(
              target.type === 'circuit' &&
              target.circuitId &&
              typeof target.secondaryBusInsertIndex === 'number'
            )
          ) {
            return false
          }
          if (
            target.type === 'circuit' &&
            target.circuitId &&
            movable.some((item) =>
              circuitClosureContains(item.circuitId, target.circuitId!, (circuitId) =>
                store.getCircuitById(circuitId)
              )
            )
          ) {
            return false
          }

          if (
            target.type === 'circuit' &&
            movable.some((item) => store.getPanelForProtection(item.id)?.id !== target.panelId)
          ) {
            return false
          }

          return withSingleUndoEntry(
            () => {
              if (target.type === 'mainBus') {
                const baseIndex = target.mainBusInsertIndex ?? 0
                movable.forEach((item, index) => {
                  useProjectStore
                    .getState()
                    .moveCircuitToMainBus(target.panelId!, item.circuitId, baseIndex + index)
                })
              } else if (target.protectionId) {
                const moved = useProjectStore.getState().moveCircuitsToRcdBus(
                  target.panelId!,
                  target.protectionId,
                  movable.map((item) => item.circuitId),
                  target.secondaryBusInsertIndex ?? 0
                )
                if (!moved) return false
              } else {
                const baseIndex = target.secondaryBusInsertIndex ?? 0
                movable.forEach((item, index) => {
                  useProjectStore
                    .getState()
                    .moveCircuitToSecondaryBus(
                      target.panelId!,
                      target.circuitId!,
                      item.circuitId,
                      baseIndex + index
                    )
                })
              }
              setSelection({ type: 'protection', ids: classified.protectionIds })
              return true
            },
            { sessionLabel: 'move protection selection on installation plan' }
          )
        }

        if (multiKind === 'trunkDevice') {
          const target = resolveTrunkRelocateDropTarget(position)
          if (!target?.circuitId) return false
          const movable = classified.trunkDeviceIds.flatMap((id) => {
            const info = getTrunkDeviceById(id)
            return info?.circuit && !info.isGroundDevice && !info.isSupplyDevice
              ? [{ id, sourceCircuitId: info.circuit.id, symbol: info.device.symbol }]
              : []
          })
          if (movable.length !== classified.trunkDeviceIds.length) return false
          const baseSegment = target.circuitTrunkSegmentIndex
          const previewProject = structuredClone(currentProject)
          const preflightOk = movable.every((item, index) => {
            const symbol = getSymbolById(item.symbol)
            if (!symbol) return false
            const itemTarget =
              typeof baseSegment === 'number'
                ? { ...target, circuitTrunkSegmentIndex: baseSegment + index }
                : target
            return mutateTrunkDeviceRelocation(
              previewProject,
              { id: item.id, sourceCircuitId: item.sourceCircuitId },
              itemTarget,
              symbol
            )
          })
          if (!preflightOk) return false
          return withSingleUndoEntry(
            () => {
              for (let index = 0; index < movable.length; index += 1) {
                const item = movable[index]
                if (!item) return false
                const itemTarget =
                  typeof baseSegment === 'number'
                    ? { ...target, circuitTrunkSegmentIndex: baseSegment + index }
                    : target
                if (!useProjectStore.getState().relocateCircuitTrunkDevice(item.id, itemTarget)) {
                  return false
                }
              }
              setSelection({ type: 'trunkDevice', ids: movable.map((item) => item.id) })
              return true
            },
            { sessionLabel: 'move trunk device selection on installation plan' }
          )
        }

        // The target accepts none of the selected families. Do not fall through and
        // accidentally move only the symbol under the pointer.
        return false
      }

      if (elementType === 'panelAttachment') {
        if (!currentProject || !layoutTree) return false
        // Resolve from the release position first. The last drag-preview state
        // may lag one pointer event or may have selected an overlapping supply
        // hit zone, which made a visibly valid main-bus drop snap back.
        const releaseTarget = findDropTargetWithDebug(layoutTree, position, {
          preferMainBusOverGroundWire: true,
          preferMainBusOverSupplyWire: true,
        }).target
        const target =
          releaseTarget.type === 'mainBus' ||
          releaseTarget.type === 'circuit' ||
          releaseTarget.type === 'rcd' ||
          releaseTarget.type === 'endpoint'
            ? releaseTarget
            : (dragPreview?.dropTarget ?? releaseTarget)
        const canMoveToEndpoint =
          target.type === 'endpoint' &&
          !!target.endpointId &&
          !!target.circuitId
        const canMoveToCircuitTop =
          target.type === 'circuit' &&
          !!target.circuitId &&
          target.insertAfterCircuitContent === true &&
          typeof target.secondaryBusInsertIndex !== 'number'
        const canMoveToSecondary =
          target.type === 'circuit' &&
          !!target.circuitId &&
          typeof target.secondaryBusInsertIndex === 'number'
        const canMoveToMain =
          target.type === 'mainBus' &&
          !!target.panelId &&
          typeof target.mainBusInsertIndex === 'number'
        const canMoveToRcd =
          target.type === 'rcd' &&
          !!target.protectionId &&
          typeof target.secondaryBusInsertIndex === 'number'
        if (
          !canMoveToSecondary &&
          !canMoveToMain &&
          !canMoveToRcd &&
          !canMoveToEndpoint &&
          !canMoveToCircuitTop
        ) {
          return false
        }
        if (
          !isPanelAttachmentDropTargetTerminal(
            getProjectElectricalPanels(currentProject),
            elementId,
            target
          )
        ) {
          return false
        }

        if (canMoveToEndpoint || canMoveToCircuitTop) {
          return withSingleUndoEntry(
            () => {
              const before = resolvePanelSupplyLinkForPanel(currentProject, elementId)
              if (!before) return false
              useProjectStore.getState().movePanelSupply(elementId, {
                type: 'circuit',
                circuitId: target.circuitId!,
              })
              const afterProject = useProjectStore.getState().currentProject
              const after = afterProject
                ? resolvePanelSupplyLinkForPanel(afterProject, elementId)
                : null
              const moved =
                !!after &&
                (after.sourcePanel.id !== before.sourcePanel.id ||
                  after.protection.id !== before.protection.id)
              if (moved) setSelection({ type: 'panel', ids: [elementId] })
              return moved
            },
            { sessionLabel: 'move distribution board to circuit endpoint' }
          )
        }

        return withSingleUndoEntry(
          () => {
            let moved = false
            useProjectStore.setState((state: ProjectState) => {
              if (!state.currentProject) return
              const panels = getEditableProjectElectricalPanels(state.currentProject)
              const result = canMoveToSecondary
                ? movePanelAttachmentOnSecondaryBus(
                    panels,
                    elementId,
                    target.circuitId!,
                    target.secondaryBusInsertIndex!
                  )
                : canMoveToRcd
                  ? movePanelAttachmentOnRcdBus(
                      panels,
                      elementId,
                      target.protectionId!,
                      target.secondaryBusInsertIndex!
                    )
                  : movePanelAttachmentToMainBus(
                      panels,
                      elementId,
                      target.panelId!,
                      target.mainBusInsertIndex!
                    )
              if (!result) return
              state.isDirty = true
              moved = true
            })
            if (moved) setSelection({ type: 'panel', ids: [elementId] })
            return moved
          },
          { sessionLabel: 'move distribution board on secondary bus' }
        )
      }

      if (elementType === 'endpoint') {
        if (isDuplicateDrag) {
          if (!currentProject || !layoutTree) return false
          return withSingleUndoEntry(
            () =>
              runEendraadEndpointAltDragDuplicate(elementId, position, {
                project: currentProject,
                layoutTree,
                wireSegments,
                findDropTarget: (tree, pos) =>
                  findDropTargetWithDebug(tree, pos, { preferMainBusOverGroundWire: true }),
                t,
                addCircuit,
                addEndpoint,
                addPlacement,
                updateCircuit,
                setSelection,
                getFloorById: (floorId) => {
                  const floor = getFloorById(floorId)
                  return floor
                    ? {
                        id: floor.id,
                        layers: floor.layers,
                        hiddenSitplanPlacementIds: floor.hiddenSitplanPlacementIds,
                      }
                    : null
                },
                getProtectionById: (protectionId) => getProtectionById(protectionId) || null,
                syncEndpointMultiplierCount: (endpointId, count) =>
                  syncEndpointMultiplierCount(
                    createSyncEndpointMultiplierDeps(),
                    endpointId,
                    count,
                  ),
              }),
            { sessionLabel: 'duplicate endpoint via alt-drag' }
          )
        }

        return withSingleUndoEntry(
          () => {
            const store = useProjectStore.getState()
            const sourceEndpoint = store.getEndpointById(elementId)
            if (!sourceEndpoint || !sourceEndpoint.symbol) return false

            // Remember the source circuit so we can detect inter‑circuit moves.
            const sourceCircuitInfo = store.findCircuitForEndpoint(elementId)
            const sourceCircuitId = sourceCircuitInfo?.circuit.id ?? null

            if (!currentProject || !layoutTree) {
              logger.warn(
                '[EendraadCanvas] Cannot handle element drag end without project/layoutTree'
              )
              return false
            }

            const symbolMeta = getSymbolById(sourceEndpoint.symbol)
            if (!symbolMeta) return false

            // Reuse the same drop target detection as handleDrop (including wire-domain augmentation)
            const { target: rawTarget } = findDropTargetWithDebug(layoutTree, position, {
              preferMainBusOverGroundWire: true,
            })

            logger.info('[EendraadCanvas] endpoint drag dropTarget raw', rawTarget)
            let dropTarget = rawTarget

            // If there is no meaningful drop target at all, treat this as an invalid drop.
            if (!dropTarget || dropTarget.type === null) {
              return false
            }
            if (
              rawTarget.type === 'circuit' &&
              rawTarget.circuitId &&
              rawTarget.panelId &&
              // For explicit trunk segment hit zones, domain is resolved from segment index
              // in drop behavior; avoid overriding with a potentially wrong vertical segment.
              typeof rawTarget.circuitTrunkSegmentIndex !== 'number'
            ) {
              const panelWires = wireSegments.filter(
                (ws) => ws.panelId === rawTarget.panelId && ws.circuitId === rawTarget.circuitId
              )
              const verticalCandidates = panelWires.filter(
                (ws) => ws.type === 'vertical' && ws.startPoint.x === ws.endPoint.x
              )
              const hitVertical = verticalCandidates.find((ws) => {
                const x = ws.startPoint.x
                const minY = Math.min(ws.startPoint.y, ws.endPoint.y)
                const maxY = Math.max(ws.startPoint.y, ws.endPoint.y)
                const withinX = Math.abs(position.x - x) <= 15
                const withinY = position.y >= minY - 10 && position.y <= maxY + 10
                return withinX && withinY
              })
              if (hitVertical) {
                dropTarget = {
                  ...rawTarget,
                  wireDomain: hitVertical.domain as DropTarget['wireDomain'],
                }
              }
            }

            logger.info('[EendraadCanvas] endpoint drag dropTarget final', dropTarget)

            if (dropTarget.type === 'supplyConverterDcWire' && sourceCircuitId) {
              let movedToSupplyDcBus = false
              useProjectStore.setState((state) => {
                const project = state.currentProject
                if (!project) return
                const result = moveEndpointToSupplyDcBus(
                  project,
                  elementId,
                  sourceCircuitId,
                  dropTarget
                )
                if (!result) return
                for (const panelId of new Set([result.sourcePanelId, result.targetPanelId])) {
                  if (!panelId) continue
                  reconcileDirectConverterDcDevices(project, panelId)
                  reconcileSupplyAssemblyBranchProtections(project, panelId)
                }
                state.isDirty = true
                movedToSupplyDcBus = true
              })
              if (movedToSupplyDcBus) {
                setSelection({ type: 'trunkDevice', ids: [elementId] })
                return true
              }
              return false
            }

            const targetEndpoint = dropTarget.endpointId
              ? store.getEndpointById(dropTarget.endpointId)
              : null
            const isDomoticaParentMove =
              sourceEndpoint.symbol === 'domotica' && !sourceEndpoint.domoticaChildProps
            const domoticaGroupEndpointIds = isDomoticaParentMove && sourceCircuitInfo?.circuit
              ? [
                  ...collectDomoticaEndpointIdsForDeletion(
                    sourceCircuitInfo.circuit,
                    [elementId]
                  ),
                ].filter((id) => !!store.getEndpointById(id))
              : []
            if (isDomoticaParentMove && !sourceCircuitId) {
              // Never send a domotica parent without a resolvable owning circuit
              // through the single-endpoint fallback.
              return false
            }
            if (
              isDomoticaParentMove &&
              (targetEndpoint?.domoticaChildProps || dropTarget.domoticaOutput)
            ) {
              dropTarget = {
                ...dropTarget,
                domoticaOutput: undefined,
                domoticaChildDropIntent: undefined,
                insertAfterEndpointId: targetEndpoint?.id ?? dropTarget.insertAfterEndpointId,
              }
            }
            if (
              sourceEndpoint.domoticaChildProps &&
              !dropTarget.domoticaOutput &&
              !targetEndpoint?.domoticaChildProps
            ) {
              const domoticaSlotTarget = findDomoticaOutputDropTarget(layoutTree, position)
              if (domoticaSlotTarget?.domoticaOutput) {
                dropTarget = domoticaSlotTarget

                logger.info(
                  '[EendraadCanvas] endpoint drag resolved domotica slot fallback',
                  dropTarget
                )
              }
            }

            if (
              sourceEndpoint.domoticaChildProps &&
              dropTarget.domoticaOutput &&
              dropTarget.endpointId &&
              dropTarget.circuitId &&
              sourceCircuitId === dropTarget.circuitId
            ) {
              const circuit = store.getCircuitById(dropTarget.circuitId)
              if (!circuit) return false
              const reorderedCircuit = reorderDomoticaChildEndpoint(
                circuit,
                elementId,
                dropTarget.endpointId,
                dropTarget.domoticaOutput.group,
                dropTarget.domoticaOutput.index
              )
              if (!reorderedCircuit) return false
              updateCircuit(dropTarget.circuitId, {
                endpoints: reorderedCircuit.endpoints,
                branches: reorderedCircuit.branches,
              })
              setSelection({ type: 'endpoint', ids: [elementId] })
              return true
            }

            if (isDomoticaParentMove) {
              if (!sourceCircuitId || !dropTarget.circuitId) {
                // A parent with children must never be handled as a standalone
                // endpoint when the target is not a circuit-aware drop.
                return false
              }
              const sourceCircuit = store.getCircuitById(sourceCircuitId)
              const targetCircuit = store.getCircuitById(dropTarget.circuitId)
              if (!sourceCircuit || !targetCircuit) return false

              const groupEndpointIds = domoticaGroupEndpointIds
              const groupEndpointIdSet = new Set(groupEndpointIds)
              const sourceGroupBranch = (sourceCircuit.branches ?? []).find((branch) =>
                groupEndpointIds.some((id) => branch.endpointIds.includes(id))
              )
              const targetBranchIds =
                dropTarget.branchEndpoints ??
                (targetEndpoint?.id ? [targetEndpoint.id] : undefined)
              const targetBranch = (targetCircuit.branches ?? []).find((branch) =>
                targetBranchIds?.some((id) => branch.endpointIds.includes(id))
              )

              // Dropping a parent back onto its own branch is a no-op. Do not
              // fall through to the single-endpoint move, which cascades its
              // children when the original parent is deleted.
              if (
                sourceCircuitId === targetCircuit.id &&
                ((targetEndpoint?.id && groupEndpointIdSet.has(targetEndpoint.id)) ||
                  (sourceGroupBranch && targetBranch?.id === sourceGroupBranch.id))
              ) {
                setSelection({ type: 'endpoint', ids: [elementId] })
                return false
              }

              if (groupEndpointIds.length > 0) {
                if (sourceCircuitId === targetCircuit.id) {
                  const movedGroup = moveEndpointSelectionOnCircuit(
                    sourceCircuit,
                    elementId,
                    groupEndpointIds,
                    dropTarget,
                    { allowSingle: true }
                  )
                  if (movedGroup) {
                    updateCircuit(sourceCircuit.id, {
                      endpoints: movedGroup.endpoints,
                      branches: movedGroup.branches,
                    })
                    setSelection({ type: 'endpoint', ids: [elementId] })
                    return true
                  }

                  // A circuit-area drop can resolve to the same branch without
                  // carrying branchEndpoints/endpointId. The group mover quite
                  // correctly reports that as unchanged; never fall through to
                  // the legacy single-endpoint move, which deletes the children.
                  setSelection({ type: 'endpoint', ids: groupEndpointIds })
                  return false
                }

                const movedGroup = moveEndpointSelectionBetweenCircuits(
                  sourceCircuit,
                  targetCircuit,
                  elementId,
                  groupEndpointIds,
                  dropTarget,
                  { allowSingle: true }
                )
                if (movedGroup) {
                  updateCircuit(sourceCircuit.id, {
                    endpoints: movedGroup.source.endpoints,
                    branches: movedGroup.source.branches,
                  })
                  updateCircuit(targetCircuit.id, {
                    endpoints: movedGroup.target.endpoints,
                    branches: movedGroup.target.branches,
                  })
                  setSelection({ type: 'endpoint', ids: [elementId] })
                  return true
                }

                // This was a complete domotica group, so a failed grouped
                // move must not be retried as a destructive single-endpoint
                // move.
                return false
              }
            }

            if (!sourceEndpoint.domoticaChildProps && !!sourceCircuitId && dropTarget.circuitId) {
              const selection = useUIStore.getState().selection
              const selectedEndpointIds = (
                endpointDragStartSelectionIdsRef.current ?? selection.ids
              ).filter((id) => !!store.getEndpointById(id))
              if (selectedEndpointIds.length > 1 && selectedEndpointIds.includes(elementId)) {
                const sourceCircuit = store.getCircuitById(sourceCircuitId)
                const targetCircuit = store.getCircuitById(dropTarget.circuitId)
                if (sourceCircuit && targetCircuit && sourceCircuitId === dropTarget.circuitId) {
                  const movedSelection = moveEndpointSelectionOnCircuit(
                    sourceCircuit,
                    elementId,
                    selectedEndpointIds,
                    dropTarget
                  )
                  if (movedSelection) {
                    updateCircuit(sourceCircuitId, {
                      endpoints: movedSelection.endpoints,
                      branches: movedSelection.branches,
                    })
                    setSelection({ type: 'endpoint', ids: movedSelection.movedEndpointIds })
                    return true
                  }
                } else if (sourceCircuit && targetCircuit) {
                  const movedSelection = moveEndpointSelectionBetweenCircuits(
                    sourceCircuit,
                    targetCircuit,
                    elementId,
                    selectedEndpointIds,
                    dropTarget
                  )
                  if (movedSelection) {
                    updateCircuit(sourceCircuit.id, {
                      endpoints: movedSelection.source.endpoints,
                      branches: movedSelection.source.branches,
                    })
                    updateCircuit(targetCircuit.id, {
                      endpoints: movedSelection.target.endpoints,
                      branches: movedSelection.target.branches,
                    })
                    setSelection({ type: 'endpoint', ids: movedSelection.target.movedEndpointIds })
                    return true
                  }
                }
              }
            }

            const { openDialog } = useDialogStore.getState()

            // Track created endpoint IDs so we can delete the original after insertion,
            // and track whether the drop was explicitly rejected (e.g. domain mismatch).
            const createdEndpointIds: string[] = []
            let dropRejected = false

            const dropCallbacks: DropBehaviorCallbacks = {
              addPanel,
              addProtection,
              addCircuit,
              addCircuitToProtection,
              updateEndpoint,
              // Preserve existing placements on move, but if the moved endpoint has no
              // plan placement at all, allow a single auto-placement to avoid orphans.
              addPlacement: (endpointId: string, placement: Placement) => {
                const existing = store.getEndpointById(endpointId)
                if (!existing) return
                if ((existing.placements?.length ?? 0) > 0) return
                addPlacement(endpointId, placement)
              },
              setSelection,
              getFloorById: (floorId: string) => {
                const floor = getFloorById(floorId)
                return floor
                  ? {
                      id: floor.id,
                      layers: floor.layers,
                      hiddenSitplanPlacementIds: floor.hiddenSitplanPlacementIds,
                    }
                  : null
              },
              updateFloor,
              getCircuitById: (circuitId: string) => store.getCircuitById(circuitId) || null,
              getProtectionById: (protectionId: string) => getProtectionById(protectionId) || null,
              addTrunkDevice,
              addSupplyTrunkDevice,
              updateSupplyTrunkDevice: store.updateSupplyTrunkDevice,
              addGroundTrunkDevice,
              ensureJunctionPanelPlacementForLabel,
              updateCircuit,
              updateProtection,
              updateInstallation,
              addSupplyAssembly: store.addSupplyAssembly,
              replaceSupplyAssembly: store.replaceSupplyAssembly,
              moveCircuitOnMainBus,
              moveCircuitToSecondaryBus,
              deleteEndpoint,
              deleteProtection: store.deleteProtection,
              addEendraadNote,
              addEndpoint: (
                circuitId: string,
                endpoint: Endpoint,
                insertAfterEndpointId?: string | null,
                branchOpts?: {
                  branchId?: string | null
                  branchInsertIndex?: number
                  forceNewBranch?: boolean
                }
              ) => {
                // Reuse all properties from the original endpoint, but keep the new ID generated
                // by the drop behavior so wiring/branch logic stays consistent.
                const latestSource = store.getEndpointById(elementId) ?? sourceEndpoint
                const clonedSource = JSON.parse(JSON.stringify(latestSource)) as Endpoint
                const isInterCircuitMove = !!sourceCircuitId && circuitId !== sourceCircuitId
                // Keep source endpoint properties (especially placements/multiplier),
                // but let drop behavior win for slot-specific fields (domotica child refs, etc.).
                const merged: Endpoint = {
                  ...clonedSource,
                  ...endpoint,
                  placements: clonedSource.placements,
                  // Important: if drop behavior did not set domoticaChildProps (i.e. this
                  // is a normal branch/circuit drop), explicitly clear any old domotica
                  // child link from the source endpoint.
                  domoticaChildProps: endpoint.domoticaChildProps,
                  converterDcConnection: endpoint.converterDcConnection,
                  id: endpoint.id,
                }
                const isDomoticaChildDrop = !!endpoint.domoticaChildProps

                if (isInterCircuitMove) {
                  // Moving to another circuit: clear any old label and let the
                  // store's addEndpoint() logic assign a fresh branch-based label
                  // for the target circuit. Also ignore the suggested
                  // insertAfterEndpointId so we don't inherit another branch's label.
                  if (!isDomoticaChildDrop) {
                    delete (merged as Partial<Endpoint>).label
                  }
                  store.addEndpoint(circuitId, merged, undefined, branchOpts)
                } else {
                  // Intra-circuit move: clear label so addEndpoint() re-derives it from target branch.
                  // This avoids stale labels when dragging between branches (e.g. 05 -> 04).
                  if (!isDomoticaChildDrop) {
                    delete (merged as Partial<Endpoint>).label
                  }
                  store.addEndpoint(circuitId, merged, insertAfterEndpointId, branchOpts)
                }
                createdEndpointIds.push(merged.id)
                setSelection({ type: 'endpoint', ids: [merged.id] })
              },
              onDropRejected: (message: string) => {
                dropRejected = true
                openDialog({
                  type: 'info',
                  title: t('wires.domainMismatchTitle', { defaultValue: 'Cannot connect here' }),
                  message,
                  confirmLabel: t('common.ok', { defaultValue: 'OK' }),
                  variant: 'warning',
                })
              },
            }

            // This is a move of an existing endpoint, not a new symbol placement.
            executeDropBehavior(symbolMeta, dropTarget, currentProject, t, dropCallbacks, false)

            // If nothing was created or the drop was rejected, signal "invalid drop".
            if (dropRejected || createdEndpointIds.length === 0) {
              return false
            }

            // If a new endpoint was created, remove the original one to complete the move.
            if (!createdEndpointIds.includes(elementId)) {
              store.deleteEndpoint(elementId)
            }

            return true
          },
          { sessionLabel: 'move endpoint on installation plan' }
        )
      }

      if (elementType === 'protection') {
        try {
          if (isDuplicateDrag) {
            if (!layoutTree) return false
            const dropTarget =
              dragPreview?.dropTarget ??
              resolveProtectionDropTargetForPosition(
                layoutTree,
                position,
                findProtectionDragTarget,
                (panelId) => getPanelById(panelId),
                elementId,
                (id) => getProtectionById(id),
                { nestOnRcd: true }
              )
            return withSingleUndoEntry(
              () => {
                const store = useProjectStore.getState()
                const mainBusPlacement =
                  dropTarget?.type === 'mainBus' &&
                  dropTarget.panelId &&
                  typeof dropTarget.mainBusInsertIndex === 'number'
                    ? {
                        panelId: dropTarget.panelId,
                        mainBusInsertIndex: dropTarget.mainBusInsertIndex,
                      }
                    : undefined
                const newProtId = store.duplicateProtectionLeft(elementId, mainBusPlacement)
                if (!newProtId) return false
                if (dropTarget && !mainBusPlacement) {
                  repositionDuplicatedProtectionToDropTarget(
                    newProtId,
                    dropTarget,
                    (panelId) => store.getPanelById(panelId),
                    (id) => store.getProtectionById(id),
                    (panelId, circuitId, direction) =>
                      store.moveCircuitOnMainBus(panelId, circuitId, direction),
                    (panelId, parentCircuitId, circuitId, insertIndex) =>
                      store.moveCircuitToSecondaryBus(
                        panelId,
                        parentCircuitId,
                        circuitId,
                        insertIndex
                      )
                  )
                } else if (dropTarget && mainBusPlacement) {
                  repositionDuplicatedProtectionToDropTarget(
                    newProtId,
                    dropTarget,
                    (panelId) => store.getPanelById(panelId),
                    (id) => store.getProtectionById(id),
                    (panelId, circuitId, direction) =>
                      store.moveCircuitOnMainBus(panelId, circuitId, direction),
                    (panelId, parentCircuitId, circuitId, insertIndex) =>
                      store.moveCircuitToSecondaryBus(
                        panelId,
                        parentCircuitId,
                        circuitId,
                        insertIndex
                      ),
                    { skipMainBus: true }
                  )
                }
                setSelection({ type: 'protection', ids: [newProtId] })
                return true
              },
              { sessionLabel: 'duplicate protection via alt-drag' }
            )
          }

          return withSingleUndoEntry(
            () => {
              if (!currentProject || !layoutTree) {
                logger.warn(
                  '[EendraadCanvas] Cannot handle protection drag end without project/layoutTree'
                )
                return false
              }

              const protection = getProtectionById(elementId)
              const sourcePanel = useProjectStore.getState().getPanelForProtection(elementId)
              const busCircuitId =
                sourcePanel && protection
                  ? pickRepresentativeCircuitIdForMainBusMove(sourcePanel, protection)
                  : undefined
              if (!protection || !busCircuitId) {
                logger.warn('[EendraadCanvas] protection drag end: no protection/circuit found', {
                  protectionId: elementId,
                })
                return false
              }

              const target = resolveProtectionDropTargetForPosition(
                layoutTree,
                position,
                findProtectionDragTarget,
                (panelId) => getPanelById(panelId),
                undefined,
                undefined,
                { nestOnRcd: true }
              ) ?? { type: null }

              if (
                protectionDropTargetHitsSource(elementId, target, (id) => getProtectionById(id))
              ) {
                return false
              }
              if (target.type === 'circuit' && target.circuitId) {
                const targetCircuit = getCircuitById(target.circuitId)
                const orderedDevices = [...(targetCircuit?.trunkDevices ?? [])].sort(
                  (left, right) => (left.trunkPosition ?? 0) - (right.trunkPosition ?? 0)
                )
                const junctionPanelIndex = orderedDevices.findIndex(
                  (device) => device.type === 'junction_panel' || device.symbol === 'junction_panel'
                )
                const isRotatingSwitchBranch =
                  protection.type === 'ROTATING_SWITCH' && (target.branchEndpoints?.length ?? 0) > 0
                const insertsBeforeBoundary =
                  typeof target.circuitTrunkSegmentIndex === 'number' &&
                  target.circuitTrunkSegmentIndex <= junctionPanelIndex
                if (junctionPanelIndex >= 0 && !isRotatingSwitchBranch && !insertsBeforeBoundary) {
                  return false
                }
              }
              let moved = false

              const isOwnUpperContentTarget =
                target.type === 'circuit' &&
                target.panelId &&
                target.circuitId === busCircuitId &&
                target.insertAfterCircuitContent === true
              if (isOwnUpperContentTarget) {
                moved = useProjectStore
                  .getState()
                  .liftCircuitContentAboveOwnProtection(target.panelId!, busCircuitId)
              }

              if (target.type === 'supplyWire' && target.panelId) {
                moved = useProjectStore
                  .getState()
                  .moveProtectionToPanelSupplyWire(elementId, target.panelId)
                if (moved) {
                  setSelection({ type: 'trunkDevice', ids: [elementId] })
                }
              }

              if (
                !moved &&
                target.type === 'mainBus' &&
                typeof target.mainBusInsertIndex === 'number' &&
                target.panelId
              ) {
                const panelId = target.panelId
                const mainBusInsertIndex = target.mainBusInsertIndex
                const panel = getPanelById(panelId)

                if (panel) {
                  const mainBusItemsCheck = getMainBusItemsWithIndices(panel)

                  const currentItemCheck = mainBusItemsCheck.find(
                    (item) =>
                      (item.type === 'circuit' && item.id === busCircuitId) ||
                      (item.type === 'protection' && item.id === protection.id)
                  )

                  // Sub-circuit dropped on main bus: promote from secondary to main (same or other panel)
                  if (!currentItemCheck) {
                    moveCircuitToMainBus(panelId, busCircuitId, mainBusInsertIndex)
                    moved =
                      useProjectStore.getState().getPanelForProtection(elementId)?.id === panelId
                  }
                }

                if (!moved) {
                  useProjectStore.setState((state: ProjectState) => {
                    const project = state.currentProject
                    if (!project) return

                    const findPanelForCircuitInDraft = (panels: Panel[]): Panel | undefined => {
                      for (const p of panels) {
                        if (p.circuits.some((c: Circuit) => c.id === busCircuitId)) return p
                        for (const prot of p.protections) {
                          if (
                            prot.circuits &&
                            prot.circuits.some((c: Circuit) => c.id === busCircuitId)
                          )
                            return p
                        }
                        const found = findPanelForCircuitInDraft(p.subPanels)
                        if (found) return found
                      }
                      return undefined
                    }

                    const panel = findPanelForCircuitInDraft(getProjectElectricalPanels(project))
                    if (!panel) {
                      logger.warn(
                        '[EendraadCanvas] protection mainBus: panel not found for circuit',
                        {
                          circuitId: busCircuitId,
                        }
                      )
                      return
                    }

                    const maxIndex = mainBusInsertIndex
                    const simulateMoveCircuitOnMainBusDraft = (
                      p: Panel,
                      cid: string,
                      direction: 'left' | 'right'
                    ) => {
                      let circuitDraft: Circuit | undefined
                      let protectionDraft: ProtectionDevice | undefined
                      let array: Circuit[] | undefined
                      let index = -1

                      circuitDraft = p.circuits.find((c) => c.id === cid)
                      if (circuitDraft) {
                        array = p.circuits
                        index = p.circuits.indexOf(circuitDraft)
                      } else if (p.protections) {
                        for (const prot of p.protections) {
                          if (prot.circuits) {
                            const found = prot.circuits.find((c) => c.id === cid)
                            if (found) {
                              circuitDraft = found
                              protectionDraft = prot
                              array = prot.circuits
                              index = prot.circuits.indexOf(found)
                              break
                            }
                          }
                        }
                      }

                      if (!circuitDraft || !array || index === -1) {
                        return
                      }

                      const mainBusItems = getMainBusItemsWithIndices(p)

                      const currentItem = mainBusItems.find(
                        (item) =>
                          (item.type === 'circuit' && item.id === cid) ||
                          (item.type === 'protection' &&
                            protectionDraft &&
                            item.id === protectionDraft.id)
                      )
                      if (!currentItem) return

                      const currentPos = mainBusItems.indexOf(currentItem)
                      if (direction === 'left' && currentPos > 0) {
                        const prevItem = mainBusItems[currentPos - 1]
                        if (!prevItem) return
                        if (currentItem.type === 'circuit' && prevItem.type === 'circuit') {
                          const currentCircuit = p.circuits[currentItem.index]
                          const prevCircuit = p.circuits[prevItem.index]
                          if (!currentCircuit || !prevCircuit) return
                          p.circuits[currentItem.index] = prevCircuit
                          p.circuits[prevItem.index] = currentCircuit
                        } else if (
                          currentItem.type === 'protection' &&
                          prevItem.type === 'protection' &&
                          p.protections
                        ) {
                          const currentProtection = p.protections[currentItem.index]
                          const prevProtection = p.protections[prevItem.index]
                          if (!currentProtection || !prevProtection) return
                          p.protections[currentItem.index] = prevProtection
                          p.protections[prevItem.index] = currentProtection
                        }
                      } else if (direction === 'right' && currentPos < mainBusItems.length - 1) {
                        const nextItem = mainBusItems[currentPos + 1]
                        if (!nextItem) return
                        if (currentItem.type === 'circuit' && nextItem.type === 'circuit') {
                          const currentCircuit = p.circuits[currentItem.index]
                          const nextCircuit = p.circuits[nextItem.index]
                          if (!currentCircuit || !nextCircuit) return
                          p.circuits[currentItem.index] = nextCircuit
                          p.circuits[nextItem.index] = currentCircuit
                        } else if (
                          currentItem.type === 'protection' &&
                          nextItem.type === 'protection' &&
                          p.protections
                        ) {
                          const currentProtection = p.protections[currentItem.index]
                          const nextProtection = p.protections[nextItem.index]
                          if (!currentProtection || !nextProtection) return
                          p.protections[currentItem.index] = nextProtection
                          p.protections[nextItem.index] = currentProtection
                        }
                      }
                    }

                    const mainBusItems = getMainBusItemsWithIndices(panel)

                    const currentItem = mainBusItems.find(
                      (item) =>
                        (item.type === 'circuit' && item.id === busCircuitId) ||
                        (item.type === 'protection' && item.id === protection.id)
                    )
                    if (!currentItem) return

                    const currentIndex = mainBusItems.indexOf(currentItem)
                    const N = mainBusItems.length
                    const insertIndex = clamp(maxIndex, 0, N)
                    const rawDesired = insertIndex > currentIndex ? insertIndex - 1 : insertIndex
                    const desiredIndex = clamp(rawDesired, 0, N - 1)
                    const destinationBusSectionId = getMainBusInsertionSectionId(
                      panel,
                      desiredIndex,
                      new Set([currentItem.id])
                    )
                    const direction: 'left' | 'right' =
                      desiredIndex > currentIndex ? 'right' : 'left'
                    const steps = Math.abs(desiredIndex - currentIndex)

                    if (steps > 0 && destinationBusSectionId) {
                      if (currentItem.type === 'protection') {
                        const movedProtection = panel.protections.find(
                          (candidate) => candidate.id === currentItem.id
                        )
                        if (movedProtection) movedProtection.busSectionId = destinationBusSectionId
                      } else {
                        const movedCircuit = panel.circuits.find(
                          (candidate) => candidate.id === currentItem.id
                        )
                        if (movedCircuit) movedCircuit.busSectionId = destinationBusSectionId
                      }
                    }

                    for (let i = 0; i < steps; i++) {
                      simulateMoveCircuitOnMainBusDraft(panel, busCircuitId, direction)
                    }

                    if (steps > 0) {
                      dedupePanelProtectionsInPanelTree(panel)
                    }

                    state.isDirty = true
                    moved = steps > 0
                    const installation = getProjectElectricalInstallation(project)
                    if (steps > 0 && installation?.eendraadAutomaticNaming) {
                      applyAutomaticMainBusNamingToPanel(
                        panel,
                        resolveAutomaticNamingOptsFromInstallation(installation),
                        project
                      )
                    }
                  })
                }
              }

              if (!moved && target.type === 'circuit' && target.panelId && target.circuitId) {
                const parentCircuit = getCircuitById(target.circuitId)
                const alreadyOnSecondary = parentCircuit?.subCircuitIds?.includes(busCircuitId)
                const rawInsertIndex =
                  typeof target.secondaryBusInsertIndex === 'number' &&
                  target.secondaryBusInsertIndex >= 0
                    ? target.secondaryBusInsertIndex
                    : (parentCircuit?.subCircuitIds?.length ?? 0)
                const siblingCount = parentCircuit?.subCircuitIds?.length ?? 0
                const targetItemCount =
                  typeof target.secondaryBusItemCount === 'number'
                    ? target.secondaryBusItemCount
                    : siblingCount
                const insertIndex =
                  targetItemCount > 0 && targetItemCount !== siblingCount
                    ? Math.floor((rawInsertIndex * siblingCount) / targetItemCount)
                    : rawInsertIndex
                const insertBeforeCircuitContent =
                  target.insertAfterCircuitContent !== true &&
                  typeof target.circuitTrunkSegmentIndex === 'number'

                if (!alreadyOnSecondary || insertBeforeCircuitContent) {
                  if (target.protectionId) {
                    moved = moveCircuitsToRcdBus(
                      target.panelId,
                      target.protectionId,
                      [busCircuitId],
                      insertIndex
                    )
                  } else {
                    moveCircuitToSecondaryBus(
                      target.panelId,
                      target.circuitId,
                      busCircuitId,
                      insertIndex,
                      { insertBeforeCircuitContent }
                    )
                    moved = true
                  }
                }
              }

              if (
                !moved &&
                target.type === 'circuit' &&
                typeof target.secondaryBusInsertIndex === 'number' &&
                target.secondaryBusInsertIndex >= 0
              ) {
                const secondaryBusInsertIndex = target.secondaryBusInsertIndex
                const secondaryBusItemCount = target.secondaryBusItemCount
                useProjectStore.setState((state: ProjectState) => {
                  const project = state.currentProject
                  if (!project) return

                  const panels: Panel[] = []
                  const stack: Panel[] = [...getProjectElectricalPanels(project)]
                  while (stack.length) {
                    const p = stack.pop()!
                    panels.push(p)
                    if (p.subPanels?.length) stack.push(...p.subPanels)
                  }

                  for (const p of panels) {
                    const allCircuits: Circuit[] = []
                    allCircuits.push(...p.circuits)
                    for (const prot of p.protections) {
                      if (prot.circuits) allCircuits.push(...prot.circuits)
                    }

                    for (const parentCircuit of allCircuits) {
                      if (
                        parentCircuit.subCircuitIds &&
                        parentCircuit.subCircuitIds.includes(busCircuitId)
                      ) {
                        const index = parentCircuit.subCircuitIds.indexOf(busCircuitId)
                        const N = parentCircuit.subCircuitIds.length
                        const sourceInsertIndex = secondaryBusInsertIndex
                        const targetItemCount =
                          typeof secondaryBusItemCount === 'number' ? secondaryBusItemCount : N
                        const normalizedInsertIndex =
                          targetItemCount > 0 && targetItemCount !== N
                            ? Math.floor((sourceInsertIndex * N) / targetItemCount)
                            : sourceInsertIndex
                        const insertIndex = clamp(normalizedInsertIndex, 0, N)
                        const rawDesired = insertIndex > index ? insertIndex - 1 : insertIndex
                        const desiredIndex = clamp(rawDesired, 0, N - 1)

                        logger.info('[EendraadCanvas] protection secondaryBus current/desired', {
                          parentCircuitId: parentCircuit.id,
                          currentIndex: index,
                          sourceInsertIndex,
                          targetItemCount,
                          normalizedInsertIndex,
                          insertIndex,
                          desiredIndex,
                          subCircuitIds: [...parentCircuit.subCircuitIds],
                        })

                        if (desiredIndex === index) return

                        const [movedCircuitId] = parentCircuit.subCircuitIds.splice(index, 1)
                        if (!movedCircuitId) return
                        parentCircuit.subCircuitIds.splice(desiredIndex, 0, movedCircuitId)

                        logger.info('[EendraadCanvas] protection secondaryBus reordered', {
                          parentCircuitId: parentCircuit.id,
                          newOrder: [...parentCircuit.subCircuitIds],
                        })
                        state.isDirty = true
                        moved = true
                        const installation = getProjectElectricalInstallation(project)
                        if (installation?.eendraadAutomaticNaming) {
                          applyAutomaticMainBusNamingToPanel(
                            p,
                            resolveAutomaticNamingOptsFromInstallation(installation),
                            project
                          )
                        }
                        return
                      }
                    }
                  }
                })
              }

              if (!moved) {
                logger.warn(
                  '[EendraadCanvas] protection drop not handled — release over main bus bar or secondary bus',
                  {
                    targetType: target.type,
                    panelId: target.panelId,
                    mainBusInsertIndex: target.mainBusInsertIndex,
                    secondaryBusInsertIndex: target.secondaryBusInsertIndex,
                    position,
                  }
                )
              }
              return moved
            },
            { sessionLabel: 'move protection on installation plan' }
          )
        } finally {
          if (!isDuplicateDrag) {
            draggingProtectionIdRef.current = null
          }
        }
      }

      if (elementType === 'trunkDevice') {
        const info = getTrunkDeviceById(elementId)
        if (!info || info.isGroundDevice || !layoutTree || !currentProject) return false

        if (info.isSupplyDevice) {
          const { target, debug: hitDebug } = findDropTargetWithDebug(layoutTree, position)
          const targetFeedScope = target.supplyFeedScope ?? 'shared'
          const targetPanelId = target.panelId
          let moved = false
          const targetPanelLayout = layout?.panels.find(
            (candidate) =>
              getPanelDiagramId(candidate) === target.diagramId ||
              (!target.diagramId && candidate.panel.id === target.panelId)
          )
          const targetMounting = targetPanelLayout
            ? resolveSupplyDropMounting(
                currentProject,
                targetPanelLayout,
                target,
                position,
                wireSegments
              )
              : undefined

          if (isDuplicateDrag) {
            if (target.type === null) return false
            return withSingleUndoEntry(
              () => {
                const sourcePosition = info.device.trunkPosition ?? 0
                const clone: TrunkDevice = {
                  ...JSON.parse(JSON.stringify(info.device)),
                  id: generateId(),
                  trunkPosition: sourcePosition + 1,
                  placements: info.device.placements?.length
                    ? clonePlacementsForDuplicate(info.device.placements, {
                        symbolType: info.device.symbol,
                      })
                    : [],
                }
                // Alt-drag is a single-device operation. Detach the clone from
                // the source DC branch before the normal supply mover places it
                // at the requested target, otherwise a branch-head conversion
                // would bring its serial descendants along as well.
                delete clone.supplyDcBusId
                delete clone.supplyDcBusBranchId
                addSupplyTrunkDevice(clone, sourcePosition + 1, {
                  panelId: info.supplyPanelId,
                  feedScope: info.supplyFeedScope,
                })

                const project = useProjectStore.getState().currentProject
                if (!project) return false
                const result = moveSupplyTrunkDeviceAtDropTarget(
                  project,
                  clone.id,
                  target,
                  targetMounting,
                )
                if (!result) {
                  useProjectStore.getState().deleteSupplyTrunkDevice(clone.id)
                  return false
                }
                for (const panelId of new Set([result.sourcePanelId, result.targetPanelId])) {
                  if (!panelId) continue
                  reconcileDirectConverterDcDevices(project, panelId)
                  reconcileSupplyAssemblyBranchProtections(project, panelId)
                }
                useProjectStore.setState((state) => {
                  state.isDirty = true
                })
                setSelection({ type: 'trunkDevice', ids: [clone.id] })
                return true
              },
              { sessionLabel: 'duplicate supply device via alt-drag' },
            )
          }

          useProjectStore.setState((state: ProjectState) => {
            const project = state.currentProject
            if (!project) return
            const result = moveSupplyTrunkDeviceAtDropTarget(
              project,
              elementId,
              target,
              targetMounting
            )
            if (!result) return
            for (const panelId of new Set([result.sourcePanelId, result.targetPanelId])) {
              if (!panelId) continue
              reconcileDirectConverterDcDevices(project, panelId)
              reconcileSupplyAssemblyBranchProtections(project, panelId)
            }
            state.isDirty = true
            moved = true
          })

          if (!moved) return false
          if (trunkDnDCommitLogEnabled()) {
            logTrunkDnDCommit('relocateSupplyTrunkDevice', {
              deviceId: elementId,
              targetPanelId,
              targetFeedScope,
              targetType: target.type,
              targetSupplyDcBusId: target.supplyDcBusId,
              targetSupplyDcBusBranchId: target.supplyDcBusBranchId,
              targetSupplyConverterDcBranch: target.supplyConverterDcBranch,
              targetSupplyConverterDcConnectionIndex:
                target.supplyConverterDcConnectionIndex,
              supplyDeviceInsertIndex: target.supplyDeviceInsertIndex,
              hitPathMatchedTail: summarizeHitDebugPath(hitDebug.path),
            })
          }
          if (moved) {
            setSelection({ type: 'trunkDevice', ids: [elementId] })
            return true
          }
          return false
        }

        if (!info.circuit) return false
        const meta = getSymbolById(info.device.symbol)
        if (!meta) return false

        const sourceCircuitId = info.circuit.id
        const dropTarget = resolveTrunkRelocateDropTarget(position)

        if (trunkDnDVerboseLogEnabled()) {
          const storeSnap = useProjectStore.getState()
          const { debug: hitDebug } = findDropTargetWithDebug(layoutTree, position, {
            ignoreCircuitTrunkDeviceSymbolHits: true,
          })
          const srcC = storeSnap.getCircuitById(sourceCircuitId)
          const tgtC =
            dropTarget?.circuitId != null
              ? storeSnap.getCircuitById(dropTarget.circuitId)
              : undefined
          logTrunkDnD('canvas:drop-end:before-commit', {
            deviceId: elementId,
            deviceSymbol: info.device.symbol,
            pointerCanvas: position,
            sourceCircuitId,
            sourceTrunkOrderBottomToTop: serializeTrunkDevices(srcC?.trunkDevices),
            targetCircuitId: dropTarget?.circuitId ?? null,
            targetTrunkOrderBottomToTop: tgtC ? serializeTrunkDevices(tgtC.trunkDevices) : null,
            resolvedDropTarget: summarizeDropTarget(dropTarget),
            hitPathMatchedTail: summarizeHitDebugPath(hitDebug.path),
          })
        }

        if (!dropTarget || dropTarget.type === null) {
          logTrunkDnDCommit('drop-aborted', {
            reason: 'no-valid-drop-target',
            deviceId: elementId,
            pointerCanvas: position,
          })
          return false
        }

        if (isDuplicateDrag) {
          return withSingleUndoEntry(
            () => {
              const sourceCircuit = useProjectStore.getState().getCircuitById(sourceCircuitId)
              const sourceDevice = sourceCircuit?.branches
                ?.flatMap((branch) => branch.branchDevices ?? [])
                .find((device) => device.id === elementId)
              if (!sourceCircuit || !sourceDevice) return false
              const newDeviceId = duplicateCircuitDcBranchDeviceAtDropTarget(
                sourceDevice,
                sourceCircuit,
                dropTarget,
                updateCircuit,
              )
              if (!newDeviceId) return false
              setSelection({ type: 'trunkDevice', ids: [newDeviceId] })
              return true
            },
            { sessionLabel: 'duplicate DC-rail device via alt-drag' },
          )
        }

        const moved = relocateCircuitTrunkDevice(elementId, dropTarget)

        if (trunkDnDVerboseLogEnabled()) {
          const stAfter = useProjectStore.getState()
          const srcAfter = stAfter.getCircuitById(sourceCircuitId)
          const tgtAfter =
            dropTarget.circuitId != null ? stAfter.getCircuitById(dropTarget.circuitId) : undefined
          logTrunkDnD('canvas:drop-end:after-commit', {
            deviceId: elementId,
            relocateOk: moved,
            sourceCircuitId,
            targetCircuitId: dropTarget.circuitId,
            sourceTrunkOrderBottomToTop: serializeTrunkDevices(srcAfter?.trunkDevices),
            targetTrunkOrderBottomToTop: tgtAfter
              ? serializeTrunkDevices(tgtAfter.trunkDevices)
              : null,
          })
        }

        if (!moved) return false
        setSelection({ type: 'trunkDevice', ids: [elementId] })
        return true
      }

      return false
    },
    [
      addCircuit,
      addCircuitToProtection,
      addEndpoint,
      addEendraadNote,
      addGroundTrunkDevice,
      addPlacement,
      addPanel,
      addProtection,
      addSupplyTrunkDevice,
      addTrunkDevice,
      augmentCircuitVerticalWireDomain,
      currentProject,
      deleteEndpoint,
      dragPreview,
      ensureJunctionPanelPlacementForLabel,
      getCircuitById,
      getFloorById,
      getPanelById,
      getProtectionById,
      getTrunkDeviceById,
      layout?.panels,
      layoutTree,
      moveCircuitOnMainBus,
      moveCircuitToMainBus,
      moveCircuitToSecondaryBus,
      moveCircuitsToRcdBus,
      relocateCircuitTrunkDevice,
      resolveTrunkRelocateDropTarget,
      setDragPreview,
      setSelection,
      t,
      updateCircuit,
      updateEndpoint,
      updateFloor,
      updateInstallation,
      updateProtection,
      withSingleUndoEntry,
      wireSegments,
    ]
  )

  handleElementDragMoveRef.current = handleElementDragMove
  handleElementDragEndRef.current = handleElementDragEnd

  const readPointerClient = useCallback(
    (ev: MouseEvent | TouchEvent): { clientX: number; clientY: number } | null => {
      if ('touches' in ev) {
        const t = ev.touches[0] ?? ev.changedTouches[0]
        return t ? { clientX: t.clientX, clientY: t.clientY } : null
      }
      return { clientX: ev.clientX, clientY: ev.clientY }
    },
    []
  )

  const beginAltDuplicatePointerDrag = useCallback(
    (elementId: string, elementType: string, nativeEvt: { clientX: number; clientY: number }) => {
      endAltDuplicatePointerDrag()
      elementDragModeRef.current = 'duplicate'
      suppressKonvaDragEndRef.current = true
      setAltDuplicatePointerDragActive(true)

      const onMove = (ev: MouseEvent | TouchEvent) => {
        if ('touches' in ev) ev.preventDefault()
        const client = readPointerClient(ev)
        if (!client) return
        const pos = pointerClientToCanvasPoint(client.clientX, client.clientY)
        if (pos) handleElementDragMoveRef.current(elementId, elementType, pos)
      }
      const onUp = (ev: MouseEvent | TouchEvent) => {
        const client = readPointerClient(ev)
        const pos = client ? pointerClientToCanvasPoint(client.clientX, client.clientY) : null
        if (pos) handleElementDragEndRef.current(elementId, elementType, pos)
        else {
          setDragPreview(null)
          elementDragModeRef.current = 'move'
        }
        endAltDuplicatePointerDrag()
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp, true)
      window.addEventListener('touchmove', onMove, { capture: true, passive: false })
      window.addEventListener('touchend', onUp, true)
      window.addEventListener('touchcancel', onUp, true)

      altDuplicatePointerCleanupRef.current = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp, true)
        window.removeEventListener('touchmove', onMove, true)
        window.removeEventListener('touchend', onUp, true)
        window.removeEventListener('touchcancel', onUp, true)
      }

      const initial = pointerClientToCanvasPoint(nativeEvt.clientX, nativeEvt.clientY)
      if (initial) handleElementDragMoveRef.current(elementId, elementType, initial)
    },
    [endAltDuplicatePointerDrag, pointerClientToCanvasPoint, readPointerClient, setDragPreview]
  )

  const handleElementDragStart = useCallback(
    (elementId: string, elementType: string, altKey: boolean, nativeEvt?: MouseEvent): boolean => {
      internalDragElementIdRef.current = elementId
      setInternalDragPlacement(null)
      if (elementType === 'panelAttachment') {
        movingPanelAttachmentIdRef.current = elementId
        const symbol = getSymbolById('panel_distribution')
        if (symbol) setInternalDragPlacement({ elementId, symbol })
      } else if (elementType === 'trunkDevice') {
        const info = getTrunkDeviceById(elementId)
        const symbol = info ? getSymbolById(info.device.symbol) : undefined
        if (info && symbol) {
          if (info.isSupplyDevice) {
            const sourcePanelLayout = layout?.panels.find((candidate) =>
              candidate.supplyDevices?.some(({ device }) => device.id === elementId)
            )
            const sourceDeviceLayout = sourcePanelLayout?.supplyDevices?.find(
              ({ device }) => device.id === elementId
            )
            setInternalDragPlacement({
              elementId,
              symbol,
              supply: {
                panelId: sourcePanelLayout?.panel.id,
                feedScope: info.supplyFeedScope ?? sourceDeviceLayout?.feedScope ?? 'shared',
                index: sourceDeviceLayout?.feedIndex ?? info.device.trunkPosition ?? 0,
                supplyPath: info.device.supplyPath,
                supplyConverterDcConnectionIndex: info.device.supplyConverterDcConnectionIndex,
                converterGridPlacement: info.device.converterGridPlacement,
                changeoverGridPlacement: info.device.changeoverGridPlacement,
                dcBusRoot: info.device.type === 'dc_bus',
              },
            })
          } else if (info.circuit) {
            setInternalDragPlacement({
              elementId,
              symbol,
              circuitTrunk: {
                circuitId: info.circuit.id,
                index: Math.max(
                  0,
                  info.circuit.trunkDevices?.findIndex((device) => device.id === elementId) ?? 0
                ),
                converterDcConnection: info.device.converterDcConnection,
                dcBusRoot: info.device.type === 'dc_bus',
              },
            })
          }
        }
      } else if (elementType === 'endpoint') {
        const endpoint = getEndpointById(elementId)
        const symbol = endpoint?.symbol ? getSymbolById(endpoint.symbol) : undefined
        if (symbol) setInternalDragPlacement({ elementId, symbol })
      } else if (elementType === 'protection') {
        const store = useProjectStore.getState()
        const protection = store.getProtectionById(elementId)
        const panel = store.getPanelForProtection(elementId)
        const symbolId = protection ? protectionTypeToSymbolKey(protection.type) : undefined
        const symbol = symbolId ? getSymbolById(symbolId) : undefined
        if (protection && panel && symbol) {
          const busCircuitId = pickRepresentativeCircuitIdForMainBusMove(panel, protection)
          const mainBusItems = getMainBusItemsWithIndices(panel)
          const mainIndex = mainBusItems.findIndex(
            (item) =>
              (item.type === 'protection' && item.id === protection.id) ||
              (item.type === 'circuit' && item.id === busCircuitId)
          )
          if (mainIndex >= 0) {
            setInternalDragPlacement({
              elementId,
              symbol,
              protectionBus: { kind: 'main', panelId: panel.id, index: mainIndex },
            })
          } else if (busCircuitId) {
            const panelCircuits = [
              ...panel.circuits,
              ...panel.protections.flatMap((candidate) => candidate.circuits ?? []),
            ]
            const parentCircuit = panelCircuits.find((candidate) =>
              candidate.subCircuitIds?.includes(busCircuitId)
            )
            const secondaryIndex = parentCircuit?.subCircuitIds?.indexOf(busCircuitId) ?? -1
            if (parentCircuit && secondaryIndex >= 0) {
              setInternalDragPlacement({
                elementId,
                symbol,
                protectionBus: {
                  kind: 'secondary',
                  panelId: panel.id,
                  parentCircuitId: parentCircuit.id,
                  index: secondaryIndex,
                },
              })
            }
          }
        }
      }
      const selection = useUIStore.getState().selection
      endpointDragStartSelectionIdsRef.current = selection.ids.includes(elementId)
        ? [...selection.ids]
        : [elementId]

      // Long-press duplicate already started window-level drag; block Konva move-drag.
      if (elementDragModeRef.current === 'duplicate') {
        return true
      }
      if (
        !altKey ||
        (elementType !== 'endpoint' &&
          elementType !== 'protection' &&
          elementType !== 'trunkDevice')
      ) {
        elementDragModeRef.current = 'move'
        return false
      }
      if (!nativeEvt) return false
      // Alt-drag is a targeted duplicate. Keep tracking the pointer and defer
      // all mutation until the drop target is known; Ctrl-D remains the
      // immediate duplicate action.
      beginAltDuplicatePointerDrag(elementId, elementType, nativeEvt)
      return true
    },
    [
      beginAltDuplicatePointerDrag,
      getEndpointById,
      getTrunkDeviceById,
      layout?.panels,
    ]
  )
  handleElementDragStartRef.current = handleElementDragStart

  const handleLongPressDuplicateDragStart = useCallback(
    (params: {
      elementId: string
      elementType: Selection['type']
      clientX: number
      clientY: number
    }) => {
      if (params.elementType !== 'endpoint' && params.elementType !== 'protection') return
      setSelection({ type: params.elementType, ids: [params.elementId] })
      beginAltDuplicatePointerDrag(params.elementId, params.elementType, {
        clientX: params.clientX,
        clientY: params.clientY,
      })
    },
    [beginAltDuplicatePointerDrag, setSelection]
  )

  const longPressDuplicateDrag = useMemo<EendraadLongPressDuplicateDrag | undefined>(
    () =>
      canDragItems
        ? {
            elementTypes: ['endpoint', 'protection'],
            onStart: handleLongPressDuplicateDragStart,
          }
        : undefined,
    [canDragItems, handleLongPressDuplicateDragStart]
  )

  // Handle ground symbol drag end
  const handleGroundDragEnd = useCallback(() => {
    logger.info('[GroundSymbol] onDragEnd - dragPreview:', dragPreview)
    // Check if preview showed mainBus during drag
    if (dragPreview?.dropTarget?.type === 'mainBus' && dragPreview.dropTarget.panelId) {
      const panelId = dragPreview.dropTarget.panelId
      const targetPanelLayout = layout?.panels.find((p) => p.panel.id === panelId)

      logger.info(
        '[GroundSymbol] Adding ground to panel:',
        panelId,
        'isSubPanel:',
        targetPanelLayout?.isSubPanel
      )

      // Only add to main panels or create a local stem on a secondary board
      if (targetPanelLayout && currentProject && currentInstallation) {
        if (targetPanelLayout.isSubPanel) {
          useProjectStore.getState().ensureSecondaryPanelEarthingStem(panelId)
        } else if (!targetPanelLayout.isSubPanel) {
          updateInstallation({ hasGround: true })
        }
        const activeFloorId = resolveSitplanTargetFloorId(
          currentProject,
          useUIStore.getState().activeFloorId
        )
        if (activeFloorId) {
          const uiSnap = useUIStore.getState()
          const preferredPlanPos =
            getViewportCenterPlanSpaceIfApplicable(
              uiSnap.viewportLayout,
              uiSnap.planCanvasViewportPx,
              uiSnap.activeFloorId,
              activeFloorId,
              uiSnap.planView
            ) ?? undefined
          ensureEarthingSitplanPlacement(activeFloorId, preferredPlanPos)
        }
        logger.info('[GroundSymbol] updateInstallation called')
      }
    }

    // Clear drag preview
    setDragPreview(null)
  }, [dragPreview, layout, currentProject, currentInstallation, updateInstallation, setDragPreview])
  handleGroundDragEndRef.current = handleGroundDragEnd

  const shouldSuppressKonvaDragEnd = useCallback(() => suppressKonvaDragEndRef.current, [])

  const handleNoteDragEnd = useCallback(
    (noteId: string, newPos: Point) => {
      if (!canDragItems) return
      updateEendraadNote(noteId, { pos: newPos })
    },
    [canDragItems, updateEendraadNote]
  )
  handleNoteDragEndRef.current = handleNoteDragEnd

  // Track panel IDs to detect when panels are added/removed
  const panelIds = useMemo(() => {
    return currentPanels.map((p: Panel) => p.id).join(',')
  }, [currentPanels])

  // Ensure all panels have placements on the plan
  useEffect(() => {
    // Get latest project state to avoid dependency on currentProject (which changes on every store update)
    const project = useProjectStore.getState().currentProject
    if (!project) return

    getProjectElectricalPanels(project).forEach((panel: Panel) => {
      const panelPlacement = ensurePanelPlacement(project, panel)
      if (!panelPlacement) return

      // Check if endpoint already exists in panel circuits
      let endpointId: string
      let existingEndpoint: Endpoint | undefined

      // Search for existing panel endpoint in panel circuits
      for (const circuit of panel.circuits) {
        existingEndpoint = circuit.endpoints.find(
          (e: Endpoint) =>
            e.symbol === 'panel_distribution' && (e.panelId === panel.id || e.label === panel.name)
        )
        if (existingEndpoint) break
      }

      if (!existingEndpoint) {
        // Check if a dummy circuit already exists for this panel
        let dummyCircuit = panel.circuits.find((c: Circuit) => c.code === 'PANEL')

        if (!dummyCircuit) {
          // Create dummy circuit for panel endpoint
          dummyCircuit = {
            id: generateId(),
            code: 'PANEL',
            kind: 'other',
            cable: {
              kind: 'XVB',
              conductors: 3,
              sectionMm2: 6,
              hasPE: true,
            },
            endpoints: [],
          }
          // Add circuit to panel
          addCircuit(panel.id, dummyCircuit)
        }

        // Add endpoint to circuit
        panelPlacement.endpoint.placements = [panelPlacement.placement]
        addEndpoint(dummyCircuit.id, panelPlacement.endpoint)
        endpointId = panelPlacement.endpoint.id
      } else {
        endpointId = existingEndpoint.id
        // Non-destructive sync: panel_distribution endpoints should have one placement.
        // If one already exists (possibly moved by the user), never auto-add another.
        if (existingEndpoint.placements.length === 0) {
          addPlacement(endpointId, panelPlacement.placement)
        }
      }
    })
  }, [panelIds, addEndpoint, addPlacement, addCircuit])

  // Sync panel selection to plan view
  useEffect(() => {
    const eendraadSelection = useUIStore.getState().selection
    if (eendraadSelection.type === 'panel' && eendraadSelection.ids.length > 0 && currentProject) {
      // Find the panel's placement endpoint and sync selection
      const panelId = eendraadSelection.ids[0]
      if (!panelId) return
      const panel = useProjectStore.getState().getPanelById(panelId)
      if (panel) {
        // Find the endpoint that represents this panel (search in panel circuits)
        let panelEndpoint: Endpoint | undefined
        for (const circuit of panel.circuits) {
          panelEndpoint = circuit.endpoints.find(
            (e: Endpoint) =>
              e.symbol === 'panel_distribution' &&
              (e.panelId === panel.id || e.label === panel.name)
          )
          if (panelEndpoint) break
        }
        if (!panelEndpoint) {
          // Also check circuits under protections
          for (const protection of panel.protections) {
            if (protection.circuits) {
              for (const circuit of protection.circuits) {
                panelEndpoint = circuit.endpoints.find(
                  (e: Endpoint) =>
                    e.symbol === 'panel_distribution' &&
                    (e.panelId === panel.id || e.label === panel.name)
                )
                if (panelEndpoint) break
              }
            }
            if (panelEndpoint) break
          }
        }
        if (panelEndpoint) {
          // Sync to plan by selecting the endpoint's placement
          // This will be handled by PlanCanvas watching for panel selections
        }
      }
    }
  }, [currentProject])

  // Helper function to check if a panel is the last main panel
  const isLastMainPanelCallback = useCallback(
    (panelId: string): boolean => {
      if (!currentProject) return false

      const { getPanelById } = useProjectStore.getState()
      const panel = getPanelById(panelId)
      if (!panel || !panel.isMain) return false

      return isLastMainPanel(getProjectElectricalPanels(currentProject), panelId)
    },
    [currentProject]
  )

  // Handle keyboard Delete by invoking the same delete actions as context menu.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!canDeleteItems) return
      if (!isEendraadDeleteKey(e)) {
        return
      }

      // Only handle Delete when not typing in an input field or contentEditable
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return
      }

      const uiState = useUIStore.getState()
      let effectiveSelection = uiState.selection

      if (
        (uiState.selection.type === 'note' || uiState.selection.type === 'frame') &&
        uiState.selection.ids.length > 0
      ) {
        const store = useProjectStore.getState()
        const annotationTarget = resolveEendraadAnnotationDeleteTarget(
          uiState.selection,
          null,
          store
        )
        if (hasEendraadAnnotationDeleteTarget(annotationTarget)) {
          e.preventDefault()
          e.stopPropagation()
          e.stopImmediatePropagation()
          deleteEendraadAnnotationTarget(annotationTarget, store)
          useUIStore.getState().clearSelection()
          return
        }
      }

      // Floor-plan placements are handled by plan keyboard delete logic. Do not convert
      // placement selections back to endpoint ids here: multiplied plan symbols can be
      // deleted one copy at a time.
      if (uiState.selection.type === 'placement' && uiState.selection.ids.length > 0) {
        return
      }
      if (
        uiState.selection.type === 'wall' ||
        uiState.selection.type === 'wallPoint' ||
        uiState.selection.type === 'door' ||
        uiState.selection.type === 'window' ||
        uiState.selection.type === 'stair' ||
        uiState.selection.type === 'stairPoint' ||
        uiState.selection.type === 'graphicElement'
      ) {
        return
      }

      const resolver = contextMenuItemsResolverRef.current
      if (!resolver) {
        return
      }
      if (
        effectiveSelection.ids.length === 0 &&
        uiState.hover.type === 'panel' &&
        uiState.hover.ids.length > 0
      ) {
        effectiveSelection = { type: 'panel', ids: [...uiState.hover.ids] }
        useUIStore.getState().setSelection(effectiveSelection)
      }

      if (effectiveSelection.ids.length === 0) {
        return
      }

      const contextElementId =
        effectiveSelection.ids.length === 1 ? (effectiveSelection.ids[0] ?? null) : null
      const itemsForElement = resolver({ x: 0, y: 0 }, contextElementId)
      const itemsForSelection = resolver({ x: 0, y: 0 }, null)
      const items = itemsForElement.length > 0 ? itemsForElement : itemsForSelection
      if (!items.length) {
        return
      }

      const deleteItem =
        items.find(
          (item) =>
            !item.separator &&
            (item.label === t('contextMenu.deleteAll') || item.label === t('contextMenu.delete'))
        ) ?? items.find((item) => !item.separator && item.variant === 'danger')
      if (!deleteItem) {
        return
      }

      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      deleteItem.onClick()
    }

    // Capture phase so Eendraad delete runs before other global key handlers (e.g. plan keyboard).
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [canDeleteItems, t])

  // Get context menu items for right-click
  const handleGetContextMenuItems = useCallback(
    (_position: Point, elementId: string | null): ContextMenuItem[] => {
      const uiState = useUIStore.getState()
      const {
        selection,
        activeFloorId,
        clearSelection,
        setActivePanelId,
        setSelection: setLiveSelection,
      } = uiState
      const projectState = useProjectStore.getState()
      const {
        addEendraadNote,
        addFrame,
        deleteEendraadNotes,
        deleteEndpoints,
        deleteEndpoint,
        deleteFrames,
        deleteGroundTrunkDevice,
        deleteProtection,
        deleteProtections,
        deletePanel,
        deleteSitplanNotes,
        deleteTrunkDevice,
        getCircuitById,
        getEendraadNoteById,
        getFrameById,
        getPanelById,
        getPanelForProtection,
        getCircuitsByPanel,
        getProtectionById,
        getEndpointById,
        getSitplanNoteById,
        getTrunkDeviceById,
        findCircuitForEndpoint,
      } = projectState
      const { openDialog, closeDialog } = useDialogStore.getState()
      const items: ContextMenuItem[] = []

      // Add Element and Add note at top of every symbol menu so they're available when right-clicking on a symbol (or empty with selection).
      const addElementAndNoteItems: ContextMenuItem[] = [
        {
          label: t('contextMenu.addElement'),
          icon: getContextMenuIcon('addElement'),
          onClick: () => setAddElementDropPosition(_position),
        },
        {
          label: t('contextMenu.addNote'),
          icon: getContextMenuIcon('addNote'),
          onClick: () => {
            const noteId = `note-${Date.now()}`
            addEendraadNote({
              id: noteId,
              text: 'New note',
              fontSize: 14,
              pos: _position,
              panelId: undefined,
            })
            setLiveSelection({ type: 'note', ids: [noteId] })
          },
        },
        { label: '', onClick: () => {}, separator: true },
      ]

      // If hit detection missed (elementId null) but one item is selected, use it so right-click still shows that symbol's menu (e.g. Delete).
      let resolvedElementId = elementId
      if (!resolvedElementId && selection.ids.length === 1 && selection.ids[0]) {
        resolvedElementId = selection.ids[0]
      }

      if (selection.type === 'wire' && selection.ids.length === 1) {
        const metadata = selection.wireMetadata?.find(
          (candidate) => candidate.id === selection.ids[0]
        )
        const selectedWire =
          wireSegments.find((candidate) => candidate.id === selection.ids[0]) ??
          (metadata ? resolveSupplyWireSegmentByMetadata(wireSegments, metadata) : undefined)
        const assembly =
          currentProject && selectedWire?.supplyAssemblyId
            ? selectProjectSupplyAssemblies(currentProject).find(
                ({ id }) => id === selectedWire.supplyAssemblyId
              )
            : undefined
        const connection = assembly?.connections.find(
          ({ id }) => id === selectedWire?.supplyConnectionId
        )
        if (
          selectedWire?.type === 'vertical' &&
          selectedWire.panelId &&
          assembly &&
          connection?.pathRole === 'inverter-grid-ac'
        ) {
          items.push({
            label: t('contextMenu.delete'),
            icon: getContextMenuIcon('delete'),
            onClick: () => {
              projectState.disconnectSupplyInverterGridInput(assembly.id, selectedWire.panelId!)
              clearSelection()
            },
            variant: 'danger',
          })
          return items
        }
      }

      // Check for multi-selection (2+ items selected, regardless of whether right-click hit an element)
      const hasMultiSelection = selection.ids.length > 1

      // For multi-selection, classify selected IDs by actual type (since rectangle selection
      // may put mixed types into a single selection with one nominal type). Deletion works on
      // the full selection regardless of type.
      if (hasMultiSelection) {
        const protectionIds: string[] = []
        const endpointIds: string[] = []
        const panelIds: string[] = []
        const trunkDeviceIds: string[] = []
        const noteIds: string[] = []
        const frameIds: string[] = []
        let hasGroundSelected = false
        let hasSupplySelected = false
        for (const id of selection.ids) {
          if (!id) continue
          if (isGroundElementId(id) && selection.type === 'ground') {
            hasGroundSelected = true
          } else if (id === 'supply' && selection.type === 'supply') {
            hasSupplySelected = true
          } else if (getProtectionById(id)) {
            protectionIds.push(id)
          } else if (getEndpointById(id)) {
            endpointIds.push(id)
          } else if (getPanelById(id)) {
            panelIds.push(id)
          } else if (getTrunkDeviceById(id)) {
            trunkDeviceIds.push(id)
          } else if (getEendraadNoteById(id)) {
            noteIds.push(id)
          } else if (getFrameById(id)) {
            frameIds.push(id)
          }
        }

        const hasDeletable =
          protectionIds.length > 0 ||
          endpointIds.length > 0 ||
          panelIds.length > 0 ||
          trunkDeviceIds.length > 0 ||
          hasGroundSelected ||
          noteIds.length > 0 ||
          frameIds.length > 0
        // Supply is not deletable - it's a permanent part of the installation

        const selectionBlocksFrame =
          noteIds.length > 0 || panelIds.length > 0 || frameIds.length > 0 || hasSupplySelected
        const hasFrameableContent =
          protectionIds.length +
            endpointIds.length +
            trunkDeviceIds.length +
            (hasGroundSelected ? 1 : 0) >
          0
        const classifiedForFrame = {
          protectionIds,
          endpointIds,
          trunkDeviceIds,
          hasGround: hasGroundSelected,
        }
        const panelIdForFrame = resolveEendraadFramePanelIdForSelection(layout, classifiedForFrame)
        const canFrame =
          hasFrameableContent && !selectionBlocksFrame && !!panelIdForFrame && !!currentProject
        const secondaryBusEjectSelection = resolveSecondaryBusEjectSelection(
          currentProject,
          protectionIds
        )

        if (hasDeletable) {
          items.push(...addElementAndNoteItems)
          // Add "Add Frame" for any frameable-only selection on one panel (mixed types / multi-circuit trunks OK)
          if (canFrame && panelIdForFrame && currentProject) {
            items.push({
              label: t('contextMenu.addFrame', 'Add Frame'),
              onClick: () => {
                const frameId = `frame-${Date.now()}`
                const fields = buildFrameFieldsFromClassifiedSelection(
                  classifiedForFrame,
                  getTrunkDeviceById,
                  currentProject
                )
                addFrame({
                  id: frameId,
                  title: 'Frame',
                  fontSize: 10,
                  titlePosition: 'inside',
                  panelId: panelIdForFrame,
                  ...fields,
                })
                setLiveSelection({ type: 'frame', ids: [frameId] })
              },
            })
            items.push({ label: '', onClick: () => {}, separator: true })
          }

          if (secondaryBusEjectSelection) {
            items.push({
              label: t('contextMenu.moveProtectionToNewPanel'),
              onClick: () => {
                withSingleUndoEntry(
                  () => {
                    const newId = ejectSecondaryBusProtectionsToNewPanel(
                      secondaryBusEjectSelection.protectionIds
                    )
                    if (newId) {
                      setActivePanelId(newId)
                      setLiveSelection({ type: 'panel', ids: [newId] })
                    }
                    return !!newId
                  },
                  { sessionLabel: 'move secondary bus protections to new distribution board' }
                )
              },
            })
            items.push({ label: '', onClick: () => {}, separator: true })
          }

          if (endpointIds.length >= 1) {
            const endpointOnlySelection = {
              type: 'endpoint' as const,
              ids: [...endpointIds],
            }
            const multiDuplicateGetters = {
              getEndpointById,
              getCircuitById,
              findCircuitForEndpoint,
              getTrunkDeviceById,
              getProtectionById,
              getCurrentProject: () => projectState.currentProject,
              getSupplyTrunkDeviceIndex: (id: string) =>
                currentInstallation?.mainSupply?.supplyTrunkDevices?.findIndex(
                  (d: { id: string }) => d.id === id
                ) ?? -1,
              getGroundTrunkDeviceIndex: (id: string) =>
                currentProject
                  ? findGroundTrunkDeviceOwner(
                      getProjectElectricalPanels(currentProject),
                      currentInstallation,
                      id
                    )?.index ?? -1
                  : -1,
            }
            const multiDuplicateActions = {
              addEndpoint,
              syncEndpointMultiplierCount: (endpointId: string, count: number) =>
                syncEndpointMultiplierCount(
                  createSyncEndpointMultiplierDeps(),
                  endpointId,
                  count
                ),
              addCircuit,
              addTrunkDevice,
              updateTrunkDevice,
              addSupplyTrunkDevice,
              syncSupplyDeviceMultiplierCount: (deviceId: string, count: number) =>
                syncSupplyDeviceMultiplierCount(
                  createSyncSupplyInverterMultiplierDeps(),
                  deviceId,
                  count
                ),
              addGroundTrunkDevice,
              insertProtectionAfter,
              updateCircuit,
              setSelection,
            }
            if (canDuplicateEendraadSelection(endpointOnlySelection, multiDuplicateGetters)) {
              items.push({
                label: t('contextMenu.duplicate'),
                onClick: () =>
                  doEendraadDuplicate(
                    endpointOnlySelection,
                    multiDuplicateGetters,
                    multiDuplicateActions
                  ),
              })
            }
            items.push({
              label: t('contextMenu.moveToFloor'),
              onClick: () => {
                const ids = [...endpointIds]
                const hasAnyNotOnActive =
                  !!activeFloorId &&
                  ids.some((id) => {
                    const ep = getEndpointById(id)
                    return ep && !ep.placements.some((p: Placement) => p.floorId === activeFloorId)
                  })
                const listHighlightFloorId = hasAnyNotOnActive ? activeFloorId : null
                openDialog({
                  type: 'custom',
                  title: t('contextMenu.moveToFloor'),
                  content: (
                    <FloorSelectionDialog
                      currentFloorId={activeFloorId}
                      listHighlightFloorId={listHighlightFloorId}
                      onSelect={(floorId) => {
                        applyEendraadEndpointsToFloor(ids, floorId)
                        closeDialog()
                      }}
                      onCancel={closeDialog}
                    />
                  ),
                })
              },
            })
            items.push({ label: '', onClick: () => {}, separator: true })
          }

          items.push({
            label: t('contextMenu.deleteAll'),
            onClick: () => {
              const runBulkDelete = (preserveLinkedPanels = false) => {
                if (protectionIds.length > 0) {
                  deleteProtections(protectionIds, { preserveLinkedPanels })
                }
                if (endpointIds.length > 0) deleteEndpoints(endpointIds)
                if (noteIds.length > 0) deleteEendraadNotes(noteIds)
                if (frameIds.length > 0) deleteFrames(frameIds)
                for (const id of trunkDeviceIds) {
                  const result = getTrunkDeviceById(id)
                  if (result) {
                    if (result.isSupplyDevice) {
                      confirmDeleteSupplyTrunkDevice(id)
                    } else if (result.isGroundDevice) {
                      deleteGroundTrunkDevice(id)
                    } else if (result.circuit) {
                      deleteTrunkDevice(result.circuit.id, id)
                    }
                  }
                }
                if (hasGroundSelected) {
                  for (const id of selection.ids) {
                    if (!isGroundElementId(id)) continue
                    const parsed = parseGroundElementId(id)
                    performDeleteEarthingLocations({
                      mode: parsed?.kind === 'panel' ? 'panel' : parsed?.kind === 'installation' ? 'installation' : 'all',
                      panelId: parsed?.kind === 'panel' ? parsed.panelId : undefined,
                      clearSelection: false,
                    })
                  }
                }
                const doDeletePanels = () => {
                  panelIds.forEach((id) => deletePanel(id))
                  clearSelection()
                }
                if (panelIds.length > 0) {
                  const lastMainPanels = panelIds.filter((id) => id && isLastMainPanelCallback(id))
                  const selectedPanels = panelIds
                    .map((id) => (id ? getPanelById(id) : null))
                    .filter((panel): panel is Panel => panel !== null && panel !== undefined)
                  const mainPanels = selectedPanels.filter((panel) => panel.isMain)
                  const panelsWithContent = selectedPanels.filter(panelHasContent)
                  if (lastMainPanels.length > 0) {
                    const panelNames = lastMainPanels
                      .map((id) => (id ? getPanelById(id)?.name : null))
                      .filter((name): name is string => name !== null)
                      .join(', ')
                    openDialog({
                      type: 'info',
                      title: t('panel.deleteBlockedTitle', 'Cannot delete main panel'),
                      message: t('panel.deleteLastMainMessage', {
                        panelNames,
                        defaultValue: `Main panel "${panelNames}" cannot be deleted.`,
                      }),
                      variant: 'warning',
                      confirmLabel: t('common.ok', 'OK'),
                    })
                  } else if (mainPanels.length > 0) {
                    const panelNames = selectedPanels.map((panel) => panel.name).join(', ')
                    openDialog({
                      type: 'confirm',
                      title: t('panel.deleteConfirmTitle', 'Delete Panels?'),
                      message: t('panel.deleteMainConfirmMessage', {
                        panelNames,
                        defaultValue: `Delete main panel(s) "${panelNames}"? The selected panels and their contents will be removed. You can undo this action.`,
                      }),
                      variant: 'warning',
                      confirmLabel: t('common.delete'),
                      cancelLabel: t('common.cancel'),
                      onConfirm: doDeletePanels,
                    })
                  } else if (panelsWithContent.length > 0) {
                    const panelNames = panelsWithContent.map((p: Panel) => p.name).join(', ')
                    openDialog({
                      type: 'confirm',
                      title: t('panel.deleteConfirmTitle', 'Delete Panels?'),
                      message: t('panel.deleteConfirmMessage', {
                        panelNames,
                        defaultValue: `The following panel(s) contain circuits, protections, or sub-panels: ${panelNames}\n\nDeleting them will also delete all their contents. You can undo this action.\n\nAre you sure you want to continue?`,
                      }),
                      variant: 'warning',
                      confirmLabel: t('common.delete'),
                      cancelLabel: t('common.cancel'),
                      onConfirm: doDeletePanels,
                    })
                  } else doDeletePanels()
                } else {
                  clearSelection()
                }
              }

              const linkedPanelNames = linkedSubPanelDisplayNamesForProtectionIds(
                projectState.currentProject,
                getPanelById,
                protectionIds
              )
              const executeBulkDelete = () => {
                if (linkedPanelNames.length > 0) {
                  openDialog(
                    createLinkedProtectionDeleteDialog({
                      t,
                      panelNames: linkedPanelNames.join(', '),
                      onDeletePanel: () => runBulkDelete(false),
                      onDeleteProtection: () => runBulkDelete(true),
                    })
                  )
                } else {
                  runBulkDelete()
                }
              }
              if (hasGroundSelected) {
                confirmDeleteEarthing(executeBulkDelete)
              } else {
                executeBulkDelete()
              }
            },
            variant: 'danger',
          })
        }
      } else if (resolvedElementId) {
        // Single element context menu - check if it's a protection device, panel, or endpoint
        let protection = getProtectionById(resolvedElementId)

        // Fallback: if not found, check layout elements to find protection by ID
        if (!protection && layout) {
          for (const panelLayout of layout.panels) {
            const layoutElement = panelLayout.elements.find(
              (e) =>
                (e.type === 'protection' || e.type === 'rcd') &&
                e.protectionId === resolvedElementId
            )
            if (layoutElement?.protectionId) {
              protection = getProtectionById(layoutElement.protectionId)
              if (protection) break
            }
          }
        }

        const isProtectionSelected =
          selection.type === 'protection' && selection.ids.includes(resolvedElementId)
        const isPanelSelected =
          selection.type === 'panel' && selection.ids.includes(resolvedElementId)
        const isGroundSelected =
          selection.type === 'ground' && selection.ids.includes(resolvedElementId)
        const annotationDeleteTarget = resolveEendraadAnnotationDeleteTarget(
          selection,
          resolvedElementId,
          {
            getEendraadNoteById,
            getSitplanNoteById,
            getFrameById,
          }
        )

        // Also check if resolvedElementId is a protection ID by checking panel protections directly
        if (!protection && currentProject) {
          for (const panel of getProjectElectricalPanels(currentProject)) {
            const foundProtection = panel.protections.find(
              (p: ProtectionDevice) => p.id === resolvedElementId
            )
            if (foundProtection) {
              protection = foundProtection
              break
            }
            const checkSubPanels = (subPanels: Panel[]): ProtectionDevice | undefined => {
              for (const subPanel of subPanels) {
                const found = subPanel.protections.find(
                  (p: ProtectionDevice) => p.id === resolvedElementId
                )
                if (found) return found
                const subFound = checkSubPanels(subPanel.subPanels)
                if (subFound) return subFound
              }
              return undefined
            }
            const subFound = checkSubPanels(panel.subPanels)
            if (subFound) {
              protection = subFound
              break
            }
          }
        }

        if (isPanelSelected) {
          // Panel context menu
          const panel = getPanelById(resolvedElementId)
          const panelEndpoint = panel
            ? panel.circuits
                .flatMap((c) => c.endpoints ?? [])
                .find(
                  (e) =>
                    e.symbol === 'panel_distribution' &&
                    (e.panelId === panel.id || e.label === panel.name)
                )
            : undefined
          items.push(
            ...addElementAndNoteItems,
            ...(panelEndpoint
              ? [
                  {
                    label: t('contextMenu.moveToFloor'),
                    onClick: () => {
                      const ep = getEndpointById(panelEndpoint.id)
                      if (!ep) return
                      const hasPlacementOnActiveFloor =
                        !!activeFloorId &&
                        ep.placements.some((p: { floorId: string }) => p.floorId === activeFloorId)
                      const listHighlightFloorId =
                        activeFloorId && !hasPlacementOnActiveFloor ? activeFloorId : null
                      openDialog({
                        type: 'custom',
                        title: t('contextMenu.moveToFloor'),
                        content: (
                          <FloorSelectionDialog
                            currentFloorId={activeFloorId}
                            listHighlightFloorId={listHighlightFloorId}
                            onSelect={(floorId) => {
                              applyEendraadEndpointsToFloor([panelEndpoint.id], floorId)
                              closeDialog()
                            }}
                            onCancel={closeDialog}
                          />
                        ),
                      })
                    },
                  },
                  { label: '', onClick: () => {}, separator: true },
                ]
              : []),
            {
              label: t('contextMenu.copy'),
              onClick: () => setEendraadClipboard({ type: 'panel', ids: [resolvedElementId!] }),
            },
            {
              label: t('contextMenu.cut'),
              onClick: () => {
                setEendraadClipboard({ type: 'panel', ids: [resolvedElementId!] })
                deletePanel(resolvedElementId!)
                clearSelection()
              },
            },
            { label: '', onClick: () => {}, separator: true },
            {
              label: t('contextMenu.delete'),
              icon: getContextMenuIcon('delete'),
              onClick: () => {
                if (!panel) {
                  deletePanel(resolvedElementId!)
                  clearSelection()
                  return
                }

                // Check if this is the last main panel
                if (isLastMainPanelCallback(resolvedElementId!)) {
                  openDialog({
                    type: 'info',
                    title: t('panel.deleteBlockedTitle', 'Cannot delete main panel'),
                    message: t('panel.deleteLastMainMessage', {
                      panelNames: panel.name,
                      defaultValue: `Main panel "${panel.name}" cannot be deleted.`,
                    }),
                    variant: 'warning',
                    confirmLabel: t('common.ok', 'OK'),
                  })
                } else if (panel.isMain) {
                  openDialog({
                    type: 'confirm',
                    title: t('panel.deleteConfirmTitle', 'Delete Panel?'),
                    message: t('panel.deleteMainConfirmMessage', {
                      panelNames: panel.name,
                      defaultValue: `Delete main panel "${panel.name}"? The panel and its contents will be removed. You can undo this action.`,
                    }),
                    variant: 'warning',
                    confirmLabel: t('common.delete'),
                    cancelLabel: t('common.cancel'),
                    onConfirm: () => {
                      deletePanel(resolvedElementId!)
                      clearSelection()
                    },
                  })
                } else if (panelHasContent(panel)) {
                  openDialog({
                    type: 'confirm',
                    title: t('panel.deleteConfirmTitle', 'Delete Panel?'),
                    message: t('panel.deleteConfirmMessage', {
                      panelNames: panel.name,
                      defaultValue: `The panel "${panel.name}" contains circuits, protections, or sub-panels.\n\nDeleting it will also delete all its contents. You can undo this action.\n\nAre you sure you want to continue?`,
                    }),
                    variant: 'warning',
                    confirmLabel: t('common.delete'),
                    cancelLabel: t('common.cancel'),
                    onConfirm: () => {
                      deletePanel(resolvedElementId!)
                      clearSelection()
                    },
                  })
                } else {
                  openDialog({
                    type: 'confirm',
                    title: t('panel.deleteConfirmTitle', 'Delete Panel?'),
                    message: t('panel.deleteEmptyPanelMessage', {
                      panelNames: panel.name,
                      defaultValue: `Are you sure you want to delete panel "${panel.name}"?\n\nThis will also remove any associated frames and nested panels. You can undo this action.`,
                    }),
                    variant: 'warning',
                    confirmLabel: t('common.delete'),
                    cancelLabel: t('common.cancel'),
                    onConfirm: () => {
                      deletePanel(resolvedElementId!)
                      clearSelection()
                    },
                  })
                }
              },
              variant: 'danger',
            }
          )
        } else if (protection || isProtectionSelected) {
          const protectionContextIds =
            selection.type === 'protection' && selection.ids.includes(resolvedElementId)
              ? selection.ids
              : [resolvedElementId]
          const secondaryBusEjectSelection = resolveSecondaryBusEjectSelection(
            currentProject,
            protectionContextIds.filter((id): id is string => !!id)
          )
          const getters = {
            getEndpointById,
            getCircuitById,
            findCircuitForEndpoint,
            getTrunkDeviceById,
            getProtectionById,
            getPanelForProtection,
            getCircuitsByPanel,
            getCurrentProject: () => projectState.currentProject,
            getSupplyTrunkDeviceIndex: (id: string) =>
              currentInstallation?.mainSupply?.supplyTrunkDevices?.findIndex(
                (d: { id: string }) => d.id === id
              ) ?? -1,
            getGroundTrunkDeviceIndex: (id: string) =>
              currentProject
                ? findGroundTrunkDeviceOwner(
                    getProjectElectricalPanels(currentProject),
                    currentInstallation,
                    id
                  )?.index ?? -1
                : -1,
          }
          const actions = {
            addEndpoint,
            syncEndpointMultiplierCount: (endpointId: string, count: number) =>
              syncEndpointMultiplierCount(
                createSyncEndpointMultiplierDeps(),
                endpointId,
                count
              ),
            addCircuit,
            addTrunkDevice,
            updateTrunkDevice,
            addSupplyTrunkDevice,
            syncSupplyDeviceMultiplierCount: (deviceId: string, count: number) =>
              syncSupplyDeviceMultiplierCount(
                createSyncSupplyInverterMultiplierDeps(),
                deviceId,
                count
              ),
            addGroundTrunkDevice,
            insertProtectionAfter,
            updateCircuit,
            setSelection,
          }
          items.push(
            ...addElementAndNoteItems,
            ...(canDuplicateEendraadSelection(selection, getters)
              ? [
                  {
                    label: t('contextMenu.duplicate'),
                    onClick: () => doEendraadDuplicate(selection, getters, actions),
                  },
                ]
              : []),
            ...(selection.type === 'protection' &&
            selection.ids.length === 1 &&
            selection.ids[0] === resolvedElementId
              ? [
                  ...(secondaryBusEjectSelection
                    ? [
                        {
                          label: t('contextMenu.moveProtectionToNewPanel'),
                          onClick: () => {
                            withSingleUndoEntry(
                              () => {
                                const newId = ejectSecondaryBusProtectionsToNewPanel(
                                  secondaryBusEjectSelection.protectionIds
                                )
                                if (newId) {
                                  setActivePanelId(newId)
                                  setLiveSelection({ type: 'panel', ids: [newId] })
                                }
                                return !!newId
                              },
                              { sessionLabel: 'move protection to new distribution board' }
                            )
                          },
                        },
                      ]
                    : []),
                  { label: '', onClick: () => {}, separator: true },
                ]
              : []),
            ...(secondaryBusEjectSelection &&
            !(
              selection.type === 'protection' &&
              selection.ids.length === 1 &&
              selection.ids[0] === resolvedElementId
            )
              ? [
                  {
                    label: t('contextMenu.moveProtectionToNewPanel'),
                    onClick: () => {
                      withSingleUndoEntry(
                        () => {
                          const newId = ejectSecondaryBusProtectionsToNewPanel(
                            secondaryBusEjectSelection.protectionIds
                          )
                          if (newId) {
                            setActivePanelId(newId)
                            setLiveSelection({ type: 'panel', ids: [newId] })
                          }
                          return !!newId
                        },
                        { sessionLabel: 'move secondary bus protections to new distribution board' }
                      )
                    },
                  },
                  { label: '', onClick: () => {}, separator: true },
                ]
              : []),
            {
              label: t('contextMenu.delete'),
              icon: getContextMenuIcon('delete'),
              onClick: () => {
                const protectionId = resolvedElementId!
                const runDelete = (preserveLinkedPanels = false) => {
                  deleteProtection(protectionId, { preserveLinkedPanels })
                  clearSelection()
                }
                const linkedNames = linkedSubPanelDisplayNamesForProtectionIds(
                  currentProject,
                  getPanelById,
                  [protectionId]
                )
                if (linkedNames.length > 0) {
                  openDialog(
                    createLinkedProtectionDeleteDialog({
                      t,
                      panelNames: linkedNames.join(', '),
                      onDeletePanel: () => runDelete(false),
                      onDeleteProtection: () => runDelete(true),
                    })
                  )
                } else {
                  runDelete()
                }
              },
              variant: 'danger',
            }
          )
        } else if (isGroundSelected || isGroundElementId(resolvedElementId)) {
          // Ground symbol context menu
          items.push(...addElementAndNoteItems, {
            label: t('contextMenu.delete'),
            icon: getContextMenuIcon('delete'),
            onClick: () => confirmDeleteEarthing({ groundElementId: resolvedElementId }),
            variant: 'danger',
          })
        } else if (selection.type === 'supply' && selection.ids.includes('supply')) {
          // Supply symbol context menu (supply can't be deleted or duplicated)
        } else if (selection.type === 'trunkDevice' && selection.ids.includes(resolvedElementId)) {
          // Trunk device context menu (energy meter, protection on wire)
          const trunkResult = getTrunkDeviceById(resolvedElementId!)
          const trunkDevice = trunkResult?.device
          const supportsDeviceMultiplier = supportsSupplyDeviceMultiplier(trunkDevice)
          let panelIdForFrame: string | undefined
          if (layout) {
            for (const panelLayout of layout.panels) {
              if (
                (panelLayout as PanelLayoutWithElements).elements?.some(
                  (el) => el.type === 'trunkDevice' && el.trunkDeviceId === resolvedElementId
                )
              ) {
                panelIdForFrame = panelLayout.panel.id
                break
              }
            }
          }
          items.push(
            ...addElementAndNoteItems,
            ...(supportsDeviceMultiplier && trunkDevice
              ? [
                  {
                    label: t('contextMenu.addMore', 'Add more...'),
                    onClick: () => openSupplyDeviceAddMoreDialog(trunkDevice, t),
                  },
                ]
              : []),
            ...(panelIdForFrame && currentProject
              ? [
                  {
                    label: t('contextMenu.addFrame', 'Add Frame'),
                    onClick: () => {
                      const frameId = `frame-${Date.now()}`
                      const fields = buildFrameFieldsFromClassifiedSelection(
                        {
                          protectionIds: [],
                          endpointIds: [],
                          trunkDeviceIds: [resolvedElementId!],
                          hasGround: false,
                        },
                        getTrunkDeviceById,
                        currentProject
                      )
                      addFrame({
                        id: frameId,
                        title: 'Frame',
                        fontSize: 10,
                        titlePosition: 'inside',
                        panelId: panelIdForFrame!,
                        ...fields,
                      })
                      setLiveSelection({ type: 'frame', ids: [frameId] })
                    },
                  },
                  { label: '', onClick: () => {}, separator: true },
                ]
              : []),
            {
              label: t('contextMenu.delete'),
              icon: getContextMenuIcon('delete'),
              onClick: () => {
                if (trunkResult) {
                  const { device, circuit, isSupplyDevice, isGroundDevice } = trunkResult
                  const performDelete = () => {
                    if (isSupplyDevice) {
                      confirmDeleteSupplyTrunkDevice(resolvedElementId!)
                    } else if (isGroundDevice) {
                      deleteGroundTrunkDevice(resolvedElementId!)
                    } else if (circuit) {
                      deleteTrunkDevice(circuit.id, resolvedElementId!)
                    }
                    clearSelection()
                  }

                  // If this is a rectifier on a circuit that feeds DC-only endpoints, warn and cascade delete them.
                  if (device.symbol === 'rectifier' && circuit && circuit.endpoints?.length) {
                    const dcEndpoints = circuit.endpoints.filter(
                      (ep: Endpoint) => ep.symbol === 'solar_panel' || ep.symbol === 'battery'
                    )
                    if (dcEndpoints.length > 0) {
                      openDialog({
                        type: 'confirm',
                        title: t('wires.deleteRectifierWithDcDevicesTitle', {
                          defaultValue: 'Delete rectifier and DC devices?',
                        }),
                        message: t('wires.deleteRectifierWithDcDevicesMessage', {
                          defaultValue:
                            'This rectifier feeds {{count}} DC-only device(s) (solar panels / batteries). Deleting it will also delete those devices. Do you want to continue?',
                          count: dcEndpoints.length,
                        }),
                        variant: 'warning',
                        confirmLabel: t('common.delete'),
                        cancelLabel: t('common.cancel'),
                        onConfirm: () => {
                          deleteEndpoints(dcEndpoints.map((ep: Endpoint) => ep.id))
                          performDelete()
                        },
                      })
                      return
                    }
                  }

                  performDelete()
                } else {
                  clearSelection()
                }
              },
              variant: 'danger',
            }
          )
        } else if (hasEendraadAnnotationDeleteTarget(annotationDeleteTarget)) {
          // Note/frame context menu (resolved by actual item id, not only selection type).
          items.push(...addElementAndNoteItems, {
            label: t('contextMenu.delete'),
            icon: getContextMenuIcon('delete'),
            onClick: () => {
              deleteEendraadAnnotationTarget(annotationDeleteTarget, {
                deleteEendraadNotes,
                deleteSitplanNotes,
                deleteFrames,
              })
              clearSelection()
            },
            variant: 'danger',
          })
        } else {
          // Endpoint context menu
          const endpoint = getEndpointById(resolvedElementId!)
          const supportsAddMore =
            !!endpoint && (endpointSupportsMultiplier(endpoint) || endpoint.type === 'socket')
          items.push(
            ...addElementAndNoteItems,
            {
              label: t('contextMenu.moveToFloor'),
              onClick: () => {
                const endpointId = resolvedElementId!
                const ep = getEndpointById(endpointId)
                if (!ep) return
                const hasPlacementOnActiveFloor =
                  !!activeFloorId &&
                  ep.placements.some((p: Placement) => p.floorId === activeFloorId)
                const listHighlightFloorId =
                  activeFloorId && !hasPlacementOnActiveFloor ? activeFloorId : null
                openDialog({
                  type: 'custom',
                  title: t('contextMenu.moveToFloor'),
                  content: (
                    <FloorSelectionDialog
                      currentFloorId={activeFloorId}
                      listHighlightFloorId={listHighlightFloorId}
                      onSelect={(floorId) => {
                        applyEendraadEndpointsToFloor([endpointId], floorId)
                        closeDialog()
                      }}
                      onCancel={closeDialog}
                    />
                  ),
                })
              },
            },
            ...(canDuplicateEendraadSelection(selection, {
              getEndpointById,
              getCircuitById,
              findCircuitForEndpoint,
              getTrunkDeviceById,
              getProtectionById,
              getCurrentProject: () => projectState.currentProject,
              getSupplyTrunkDeviceIndex: (id: string) =>
                currentInstallation?.mainSupply?.supplyTrunkDevices?.findIndex(
                  (d: { id: string }) => d.id === id
                ) ?? -1,
              getGroundTrunkDeviceIndex: (id: string) =>
                currentProject
                  ? findGroundTrunkDeviceOwner(
                      getProjectElectricalPanels(currentProject),
                      currentInstallation,
                      id
                    )?.index ?? -1
                  : -1,
            })
              ? [
                  {
                    label: t('contextMenu.duplicate'),
                    onClick: () => {
                      doEendraadDuplicate(
                        selection,
                        {
                          getEndpointById,
                          getCircuitById,
                          findCircuitForEndpoint,
                          getTrunkDeviceById,
                          getProtectionById,
                          getCurrentProject: () => projectState.currentProject,
                          getSupplyTrunkDeviceIndex: (id: string) =>
                            currentInstallation?.mainSupply?.supplyTrunkDevices?.findIndex(
                              (d: { id: string }) => d.id === id
                            ) ?? -1,
                          getGroundTrunkDeviceIndex: (id: string) =>
                            currentProject
                              ? findGroundTrunkDeviceOwner(
                                  getProjectElectricalPanels(currentProject),
                                  currentInstallation,
                                  id
                                )?.index ?? -1
                              : -1,
                        },
                        {
                          addEndpoint,
                          syncEndpointMultiplierCount: (endpointId: string, count: number) =>
                            syncEndpointMultiplierCount(
                              createSyncEndpointMultiplierDeps(),
                              endpointId,
                              count
                            ),
                          addCircuit,
                          addTrunkDevice,
                          updateTrunkDevice,
                          addSupplyTrunkDevice,
                          syncSupplyDeviceMultiplierCount: (deviceId: string, count: number) =>
                            syncSupplyDeviceMultiplierCount(
                              createSyncSupplyInverterMultiplierDeps(),
                              deviceId,
                              count
                            ),
                          addGroundTrunkDevice,
                          insertProtectionAfter,
                          updateCircuit,
                          setSelection,
                        }
                      )
                    },
                  },
                ]
              : []),
            ...(supportsAddMore
              ? [
                  {
                    label: t('contextMenu.addMore', 'Add more...'),
                    onClick: () => {
                      if (!endpoint) return
                      openAddMoreDialogForEndpoint(endpoint, t)
                    },
                  },
                ]
              : []),
            { label: '', onClick: () => {}, separator: true },
            {
              label: t('contextMenu.delete'),
              icon: getContextMenuIcon('delete'),
              onClick: () => {
                deleteEndpoint(resolvedElementId!)
                clearSelection()
              },
              variant: 'danger',
            }
          )
        }
      } else {
        // Right-click on empty space with no selection
        items.push(
          {
            label: t('contextMenu.addElement'),
            icon: getContextMenuIcon('addElement'),
            onClick: () => setAddElementDropPosition(_position),
          },
          {
            label: t('contextMenu.addNote'),
            icon: getContextMenuIcon('addNote'),
            onClick: () => {
              // Add a note at the click position
              const noteId = `note-${Date.now()}`
              addEendraadNote({
                id: noteId,
                text: 'New note',
                fontSize: 14,
                pos: _position,
                panelId: undefined, // Will be assigned based on position if needed
              })
              setLiveSelection({ type: 'note', ids: [noteId] })
            },
          }
        )
      }

      return items
    },
    [
      t,
      isLastMainPanelCallback,
      setEendraadClipboard,
      setAddElementDropPosition,
      currentProject,
      addEndpoint,
      addCircuit,
      addTrunkDevice,
      addSupplyTrunkDevice,
      addGroundTrunkDevice,
      insertProtectionAfter,
      layout,
      wireSegments,
      setSelection,
      withSingleUndoEntry,
      ejectSecondaryBusProtectionsToNewPanel,
      currentInstallation,
      updateCircuit,
      updateTrunkDevice,
    ]
  )

  useEffect(() => {
    contextMenuItemsResolverRef.current = handleGetContextMenuItems
  }, [handleGetContextMenuItems])

  const handleEendraadContextMenu = useCallback(
    (position: Point, elementId: string | null) => {
      if (eendraadDateMarkingMode) {
        exitDateMarkingMode()
        return []
      }
      return handleGetContextMenuItems(position, elementId)
    },
    [eendraadDateMarkingMode, exitDateMarkingMode, handleGetContextMenuItems]
  )

  const handleAddElementSelect = useCallback(
    (symbol: import('@/lib/symbols').SymbolMetadata, position: Point) => {
      handleDrop(position, symbol)
      setAddElementDropPosition(null)
    },
    [handleDrop]
  )

  const supplySeparators = useMemo(() => {
    if (!layout) return []
    return layout.panels.flatMap((panelLayout) =>
      getSupplySeparatorsForDiagram(wireSegments, getPanelDiagramId(panelLayout))
    )
  }, [layout, wireSegments])

  const enableAutomaticNamingAndApply = useCallback(() => {
    updateInstallation({ eendraadAutomaticNaming: true })
    applyAutomaticEendraadNamingAllPanels()
  }, [applyAutomaticEendraadNamingAllPanels, updateInstallation])

  const handleEendraadAutomaticNamingChange = useCallback(
    (checked: boolean) => {
      if (!currentProject) return
      if (!checked) {
        updateInstallation({ eendraadAutomaticNaming: false })
        return
      }
      const opts = resolveAutomaticNamingOptsFromInstallation(
        getProjectElectricalInstallation(currentProject)
      )
      if (!automaticMainBusNamingWouldChangeProject(currentProject, opts)) {
        enableAutomaticNamingAndApply()
        return
      }
      openDialog({
        type: 'confirm',
        title: t('canvas.eendraadNaming.confirmOverwriteTitle'),
        message: t('canvas.eendraadNaming.confirmOverwriteMessage'),
        variant: 'warning',
        confirmLabel: t('canvas.eendraadNaming.confirmOverwriteConfirm'),
        cancelLabel: t('common.cancel'),
        onConfirm: enableAutomaticNamingAndApply,
      })
    },
    [currentProject, enableAutomaticNamingAndApply, openDialog, t, updateInstallation]
  )

  const handleResetAllEendraadLabels = useCallback(() => {
    if (!currentProject || !eendraadAutoNaming || !hasCustomEendraadLabels) return
    openDialog({
      type: 'confirm',
      title: t('canvas.eendraadNaming.resetAllConfirmTitle', 'Reset all custom labels?'),
      message: t(
        'canvas.eendraadNaming.resetAllConfirmMessage',
        'All custom circuit labels will be cleared and replaced by automatic labels. You can undo this change.'
      ),
      variant: 'warning',
      confirmLabel: t('canvas.eendraadNaming.resetAllConfirm', 'Reset labels'),
      cancelLabel: t('common.cancel'),
      onConfirm: () => {
        const latestProject = useProjectStore.getState().currentProject
        if (!latestProject || !projectHasManualEendraadLabelOverrides(latestProject)) return
        withSingleUndoEntry(() => {
          resetAllEendraadLabelOverrides()
          return true
        })
      },
    })
  }, [
    currentProject,
    eendraadAutoNaming,
    hasCustomEendraadLabels,
    openDialog,
    resetAllEendraadLabelOverrides,
    t,
    withSingleUndoEntry,
  ])

  const applyHideFeederPreferenceAndRenumber = useCallback(
    (hideFeederLetters: boolean) => {
      updateInstallation({ eendraadAutoNamingHideFeederLetters: hideFeederLetters })
      applyAutomaticEendraadNamingAllPanels()
    },
    [applyAutomaticEendraadNamingAllPanels, updateInstallation]
  )

  const handleEendraadHideFeederLettersChange = useCallback(
    (checked: boolean) => {
      if (!currentProject) return
      if (!eendraadAutoNaming) {
        updateInstallation({ eendraadAutoNamingHideFeederLetters: checked })
        return
      }
      const opts = { hideFeederLetters: checked }
      if (!automaticMainBusNamingWouldChangeProject(currentProject, opts)) {
        applyHideFeederPreferenceAndRenumber(checked)
        return
      }
      openDialog({
        type: 'confirm',
        title: t('canvas.eendraadNaming.confirmOverwriteTitle'),
        message: t('canvas.eendraadNaming.confirmOverwriteMessage'),
        variant: 'warning',
        confirmLabel: t('canvas.eendraadNaming.confirmOverwriteConfirm'),
        cancelLabel: t('common.cancel'),
        onConfirm: () => applyHideFeederPreferenceAndRenumber(checked),
      })
    },
    [
      applyHideFeederPreferenceAndRenumber,
      currentProject,
      eendraadAutoNaming,
      openDialog,
      t,
      updateInstallation,
    ]
  )

  const normalScene = useMemo(() => {
    if (!layoutTree || !layout) return null

    return (
      <>
        {layout.panels.map((panelLayout) => {
          const panelNode = layoutTree.panels.find(
            (p) => p.diagramId === getPanelDiagramId(panelLayout)
          )
          if (!panelNode) return null

          return (
            <Group
              key={getPanelDiagramId(panelLayout)}
              name={`panel-group-${getPanelDiagramId(panelLayout)}`}
            >
              {/* Frames layer - render first so they appear under everything */}
              {panelLayout.frameRole !== 'supply' &&
                getFramesByPanel(panelLayout.panel.id).map((frame: Frame) => (
                  <FrameComponent key={frame.id} frame={frame} panelLayout={panelLayout} />
                ))}

              {/* Supply/panel dashed separator — behind wires and labels */}
              {supplySeparators
                .filter((separator) => separator.diagramId === getPanelDiagramId(panelLayout))
                .map((separator) => (
                  <Line
                    key={separator.id}
                    points={separator.points}
                    stroke="#6b7280"
                    strokeWidth={2.25}
                    dash={[4, 4]}
                    lineCap="round"
                    listening={false}
                  />
                ))}

              {/* Wire segments layer - render above frames/separator but below symbols */}
              <WireSegments
                panelId={panelLayout.panel.id}
                diagramId={getPanelDiagramId(panelLayout)}
                wireSegments={wireSegments}
              />

              {/* Tree-based element rendering */}
              <RenderNode
                node={panelNode}
                translate={t}
                advancedPanelLabels={advancedPanelLabels}
                panelLayout={panelLayout}
                getProtectionById={getProtectionById}
                getPanelById={getPanelById}
                getCanvasPositionFromEvent={getCanvasPositionFromEvent}
                onElementDragStart={canDragItems ? stableElementDragStart : undefined}
                shouldSuppressKonvaDragEnd={canDragItems ? shouldSuppressKonvaDragEnd : undefined}
                onElementDragMove={canDragItems ? stableElementDragMove : undefined}
                onElementDragEnd={canDragItems ? stableElementDragEnd : undefined}
                onGroundDragEnd={canDragItems ? stableGroundDragEnd : undefined}
              />
            </Group>
          )
        })}

        {/* Notes layer - render last so they appear on top of everything (above preview graph) */}
        {eendraadNotes.map((note) => (
          <NoteSymbol key={note.id} note={note} onDragEnd={stableNoteDragEnd} />
        ))}
      </>
    )
  }, [
    advancedPanelLabels,
    canDragItems,
    eendraadNotes,
    getCanvasPositionFromEvent,
    getFramesByPanel,
    getPanelById,
    getProtectionById,
    layout,
    layoutTree,
    shouldSuppressKonvaDragEnd,
    stableElementDragEnd,
    stableElementDragMove,
    stableElementDragStart,
    stableGroundDragEnd,
    stableNoteDragEnd,
    supplySeparators,
    t,
    wireSegments,
  ])

  const selectedEndpointOverlay = useMemo(() => {
    if (
      selection.type !== 'endpoint' ||
      selection.ids.length !== 1 ||
      !layoutTree ||
      !layout
    ) {
      return null
    }
    const target = findEndpointRenderTarget(layoutTree.panels, selection.ids[0]!)
    if (!target) return null
    const panelLayout = layout.panels.find(
      (candidate) => getPanelDiagramId(candidate) === target.panelNode.diagramId
    )
    if (!panelLayout) return null
    return (
      <CanvasPanOrClickProvider onBeginPan={beginInteractiveOverlayPan}>
        <RenderNode
          node={target.node}
          translate={t}
          advancedPanelLabels={advancedPanelLabels}
          panelLayout={panelLayout}
          getProtectionById={getProtectionById}
          getPanelById={getPanelById}
          getCanvasPositionFromEvent={getCanvasPositionFromEvent}
          onElementDragStart={canDragItems ? stableElementDragStart : undefined}
          shouldSuppressKonvaDragEnd={canDragItems ? shouldSuppressKonvaDragEnd : undefined}
          onElementDragMove={canDragItems ? stableElementDragMove : undefined}
          onElementDragEnd={canDragItems ? stableElementDragEnd : undefined}
          onGroundDragEnd={canDragItems ? stableGroundDragEnd : undefined}
          renderSelectedEndpoint
        />
      </CanvasPanOrClickProvider>
    )
  }, [
    advancedPanelLabels,
    beginInteractiveOverlayPan,
    canDragItems,
    getCanvasPositionFromEvent,
    getPanelById,
    getProtectionById,
    layout,
    layoutTree,
    selection,
    shouldSuppressKonvaDragEnd,
    stableElementDragEnd,
    stableElementDragMove,
    stableElementDragStart,
    stableGroundDragEnd,
    t,
  ])

  const canvasInteractionOverlay = useMemo(
    () => (
      <>
        {selectedEndpointOverlay}
        {dragPreview?.movingProtection && (
          <Circle
            ref={protectionMainBusCursorRef}
            name="protection-drag-cursor-preview"
            x={dragPreview.position.x}
            y={dragPreview.position.y}
            radius={15}
            fill="#0284c7"
            opacity={0.25}
            stroke="#0284c7"
            strokeWidth={2}
            listening={false}
          />
        )}
      </>
    ),
    [dragPreview, selectedEndpointOverlay]
  )

  return (
    <CanvasOverlayScaleProvider containerRef={containerRef}>
      <div
        ref={containerRef}
        className="relative w-full h-full"
        data-1p-ignore
        data-op-ignore
        onPointerEnter={() => {
          pointerOverEendraadRef.current = true
        }}
        onPointerLeave={() => {
          pointerOverEendraadRef.current = false
        }}
      >
        {canPlaceSymbols && addElementDropPosition && (
          <AddElementPicker
            dropPosition={addElementDropPosition}
            onSelect={handleAddElementSelect}
            onClose={() => setAddElementDropPosition(null)}
          />
        )}
        <BaseCanvas
          ref={canvasRef}
          gestureZoomCanvas="eendraad"
          zoom={eendraadView.zoom}
          pan={eendraadView.pan}
          showGrid={false}
          gridSize={eendraadView.gridSize}
          onZoomChange={handleZoomChange}
          onPanChange={handlePanChange}
          onViewTransformCommit={handleViewTransformCommit}
          onViewportPanStateChange={handleViewportPanStateChange}
          onViewportPixelSizeChange={setViewportPixelSize}
          onDrop={canPlaceSymbols ? handleDrop : undefined}
          onDragOver={canPlaceSymbols ? handleDragOver : undefined}
          onFindElementsInRectangle={handleFindElementsInRectangle}
          onGetContextMenuItems={
            canDeleteItems || canPlaceSymbols || eendraadDateMarkingMode
              ? handleEendraadContextMenu
              : undefined
          }
          onGetSelectionBounds={handleGetSelectionBounds}
          selectionFitMaxZoom={ZOOM_100}
          onMultiFingerSwipe={onMultiFingerSwipe}
          
          gridOpacity={0.1}
          overlayChildren={canvasInteractionOverlay}
          enableIsolatedDragLayer
        >
          <Group name="canvas-content">
            <ConverterResizeViewportContext.Provider value={resizeConverterWithViewportAnchor}>
              <CanvasPanOrClickProvider onBeginPan={beginInteractiveOverlayPan}>
                {normalScene}
              </CanvasPanOrClickProvider>
            </ConverterResizeViewportContext.Provider>

            {/* Preview overlay: show only the changed circuits and wires for the current drag preview. */}
            {showSimulatedDragPreview &&
              previewGraph &&
              previewGraph.affectedPanelIds
                .flatMap((panelId) =>
                  previewGraph.layout.panels
                    .filter((p: BottomUpPanelLayout) => p.panel.id === panelId)
                    .map((previewPanelLayout) => ({ panelId, previewPanelLayout }))
                )
                .map(({ panelId, previewPanelLayout }) => {
                  const diagramId = getPanelDiagramId(previewPanelLayout)
                  const previewPanelNode = previewGraph.layoutTree.panels.find(
                    (p: LayoutNode) => p.diagramId === diagramId
                  )
                  const currentPanelNode = layoutTree?.panels.find(
                    (p: LayoutNode) => p.diagramId === diagramId
                  )
                  const currentPanelLayout = layout?.panels.find(
                    (candidate) => getPanelDiagramId(candidate) === diagramId
                  )
                  if (!previewPanelLayout || !previewPanelNode) return null

                  const previewPanelTranslation = getPreviewPanelTranslation(
                    currentPanelLayout,
                    previewPanelLayout
                  )

                  // Generated wire IDs are unstable between layouts, so compare topology and
                  // geometry. This avoids tinting unchanged panel/supply buses for endpoint drops.
                  const relocationSourceParentCircuitId =
                    dragPreview?.movingProtection &&
                    internalDragPlacement?.elementId ===
                      dragPreview.movingProtection.protectionId &&
                    internalDragPlacement.protectionBus?.kind === 'secondary'
                      ? internalDragPlacement.protectionBus.parentCircuitId
                      : undefined
                  const previewWiresForPanel = filterProtectionRelocationPreviewWires(
                    getChangedPreviewWireSegments(
                      previewGraph.wireSegments,
                      wireSegments,
                      panelId,
                      previewPanelNode,
                      diagramId
                    ),
                    relocationSourceParentCircuitId,
                    dragPreview?.dropTarget?.circuitId
                  )

                  // Collect nodes for newly created symbols (endpoints, protections, trunk devices).
                  const createdNodes: LayoutNode[] = []
                  const collectCreated = (node: LayoutNode) => {
                    if (
                      (node.type === 'endpoint' &&
                        node.domainId &&
                        previewGraph.createdEndpointIds.includes(node.domainId)) ||
                      ((node.type === 'mcb' || node.type === 'rcd') &&
                        node.domainId &&
                        previewGraph.createdProtectionIds.includes(node.domainId)) ||
                      (node.type === 'trunkDevice' &&
                        node.domainId &&
                        previewGraph.createdTrunkDeviceIds.includes(node.domainId))
                    ) {
                      createdNodes.push(node)
                    }
                    if (node.children && node.children.length > 0) {
                      node.children.forEach(collectCreated)
                    }
                  }
                  collectCreated(previewPanelNode)
                  const dropTarget = dragPreview?.dropTarget
                  const insertBetweenMovedProtectionNodes: LayoutNode[] = []
                  if (dropTarget?.insertBeforeNestedCircuitId) {
                    let movedRoot: LayoutNode | null = null
                    const findMovedRoot = (node: LayoutNode) => {
                      if (movedRoot) return
                      if (
                        (node.type === 'mcb' || node.type === 'rcd') &&
                        node.circuitIdForWires === dropTarget.insertBeforeNestedCircuitId
                      ) {
                        movedRoot = node
                        return
                      }
                      node.children?.forEach(findMovedRoot)
                    }
                    findMovedRoot(previewPanelNode)

                    const collectMovedProtections = (node: LayoutNode) => {
                      if (node.type === 'mcb' || node.type === 'rcd') {
                        insertBetweenMovedProtectionNodes.push(node)
                      }
                      node.children?.forEach(collectMovedProtections)
                    }
                    if (movedRoot) collectMovedProtections(movedRoot)
                  }
                  const expandingDomoticaParentNode: LayoutNode | null =
                    dropTarget?.domoticaOutput?.expands && dropTarget.endpointId
                      ? (() => {
                          let found: LayoutNode | null = null
                          const visit = (node: LayoutNode) => {
                            if (found) return
                            if (
                              node.type === 'endpoint' &&
                              node.domainId === dropTarget.endpointId
                            ) {
                              found = node
                              return
                            }
                            node.children?.forEach(visit)
                          }
                          visit(previewPanelNode)
                          return found
                        })()
                      : null

                  // Preview nodes are taken from the same simulated layout graph that
                  // will be used after commit, including domotica output branches.
                  const previewNodes: LayoutNode[] = []
                  const seenNodeIds = new Set<string>()
                  if (
                    expandingDomoticaParentNode &&
                    !seenNodeIds.has((expandingDomoticaParentNode as LayoutNode).id)
                  ) {
                    seenNodeIds.add((expandingDomoticaParentNode as LayoutNode).id)
                    previewNodes.push(expandingDomoticaParentNode)
                  }
                  for (const node of createdNodes) {
                    if (!seenNodeIds.has(node.id)) {
                      seenNodeIds.add(node.id)
                      previewNodes.push(node)
                    }
                  }
                  for (const node of insertBetweenMovedProtectionNodes) {
                    if (!seenNodeIds.has(node.id)) {
                      seenNodeIds.add(node.id)
                      previewNodes.push(node)
                    }
                  }

                  const previewStroke = '#0284c7'
                  const previewSeparatorStroke = '#38bdf8'
                  const dashPattern = [8, 4]
                  const previewSupplySeparators = getChangedSupplySeparatorsForDiagram(
                    previewGraph.wireSegments,
                    wireSegments,
                    diagramId
                  )
                  if (dragPreview?.movingPanelAttachment) {
                    const panelPreviewTarget =
                      dragPreview.dropTarget?.type === 'mainBus' && dragPreview.dropTarget.panelId
                        ? {
                            type: 'mainBus' as const,
                            panelId: dragPreview.dropTarget.panelId,
                          }
                        : dragPreview.dropTarget?.type === 'circuit' &&
                            dragPreview.dropTarget.panelId &&
                            dragPreview.dropTarget.circuitId
                          ? {
                              type: 'circuit' as const,
                              panelId: dragPreview.dropTarget.panelId,
                              circuitId: dragPreview.dropTarget.circuitId,
                            }
                          : dragPreview.dropTarget?.type === 'rcd' &&
                              dragPreview.dropTarget.panelId &&
                              dragPreview.dropTarget.protectionId
                            ? {
                                type: 'rcd' as const,
                                panelId: dragPreview.dropTarget.panelId,
                                protectionId: dragPreview.dropTarget.protectionId,
                              }
                            : null
                    const geometry = panelPreviewTarget
                      ? resolvePanelAttachmentPreviewGeometry(
                          wireSegments,
                          panelPreviewTarget,
                          dragPreview.position.x
                        )
                      : null

                    // Never fall through to the generic changed-wire preview for a
                    // panel move. A panel reflow can change almost every wire and
                    // would render a second, ghost copy of the entire bus layout.
                    if (!geometry || panelPreviewTarget?.panelId !== panelId) return null

                    const { busSegment, busY, ghostX, symbolY } = geometry
                    return (
                      <Group
                        key={`preview-panel-attachment-${panelId}`}
                        name={`preview-panel-attachment-${panelId}`}
                        opacity={0.88}
                        listening={false}
                      >
                        <Line
                          points={[
                            busSegment.startPoint.x,
                            busSegment.startPoint.y,
                            busSegment.endPoint.x,
                            busSegment.endPoint.y,
                          ]}
                          stroke={previewStroke}
                          strokeWidth={8}
                          opacity={0.6}
                          lineCap="round"
                          listening={false}
                        />
                        <Line
                          points={[ghostX, busY, ghostX, symbolY + 14]}
                          stroke={previewStroke}
                          strokeWidth={4}
                          dash={dashPattern}
                          lineCap="round"
                          listening={false}
                        />
                        <Rect
                          x={ghostX - 13}
                          y={symbolY}
                          width={26}
                          height={14}
                          stroke={previewStroke}
                          strokeWidth={2}
                          dash={dashPattern}
                          cornerRadius={3}
                          fill="rgba(59,130,246,0.12)"
                          listening={false}
                        />
                      </Group>
                    )
                  }

                  if (
                    previewWiresForPanel.length === 0 &&
                    previewNodes.length === 0 &&
                    previewSupplySeparators.length === 0
                  ) {
                    return null
                  }

                  const mainBusInsertIndex = dropTarget?.mainBusInsertIndex
                  const isDomoticaOutputPreview =
                    !!dropTarget?.domoticaOutput &&
                    !!dropTarget.endpointId &&
                    !!dropTarget.circuitId

                  // Special-case: when inserting a protection on the main or
                  // secondary bus, show a very explicit ghost (highlighted bus
                  // segment + vertical line + box) at the resolved insertion slot.
                  const isMainBusProtectionPreview =
                    dropTarget?.type === 'mainBus' && previewGraph.createdProtectionIds.length > 0
                  const isSecondaryBusProtectionPreview =
                    dropTarget?.type === 'circuit' &&
                    !dropTarget.dcBusId &&
                    typeof dropTarget.secondaryBusInsertIndex === 'number' &&
                    previewGraph.createdProtectionIds.length > 0

                  const shouldUseMainBusInsertionGhost =
                    isMainBusProtectionPreview &&
                    typeof mainBusInsertIndex === 'number' &&
                    typeof dropTarget.mainBusItemCount === 'number'
                  const nestCircuitIdAtCursor = (() => {
                    if (!layoutTree || !dragPreview?.position) return undefined
                    const matched = findDropTargetWithDebug(
                      layoutTree,
                      dragPreview.position
                    ).debug.path.find(
                      (step) => step.matched && step.nodeId?.startsWith('circuit-nest-')
                    )
                    const id = matched?.nodeId?.slice('circuit-nest-'.length)
                    return id && id.length > 0 ? id : undefined
                  })()

                  const nestCircuitIdForPreview = resolveProtectionNestPreviewCircuitId(
                    dropTarget,
                    nestCircuitIdAtCursor
                  )

                  const isProtectionNestOnCircuitPreview =
                    !!nestCircuitIdForPreview && previewGraph.createdProtectionIds.length > 0

                  // A second child turns the single nested connection into a real
                  // secondary bus. Prefer that simulated geometry over the compact
                  // single-child ghost so the hover preview matches the committed drop.
                  const nestedProtectionPreviewBusSegments = nestCircuitIdForPreview
                    ? previewGraph.wireSegments.filter(
                        (ws) =>
                          ws.panelId === panelId &&
                          (ws.diagramId ?? ws.panelId) === diagramId &&
                          ws.type === 'mainBus' &&
                          ws.fromElementType === 'secondaryBus' &&
                          ws.circuitId === nestCircuitIdForPreview
                      )
                    : []
                  const createsSecondaryBusFromNestedDrop =
                    isProtectionNestOnCircuitPreview &&
                    nestedProtectionPreviewBusSegments.length > 0

                  const nestedPreviewOffsetX = (() => {
                    if (
                      dropTarget?.insertBeforeNestedCircuitId ||
                      !isProtectionNestOnCircuitPreview ||
                      !nestCircuitIdForPreview ||
                      isSecondaryBusProtectionPreview ||
                      !currentPanelNode
                    ) {
                      return 0
                    }

                    const createdProtectionNode = previewNodes.find(
                      (node) =>
                        (node.type === 'mcb' || node.type === 'rcd') &&
                        !!node.domainId &&
                        previewGraph.createdProtectionIds.includes(node.domainId)
                    )
                    if (!createdProtectionNode) return 0

                    const currentMatch: {
                      nest: LayoutNode | null
                      protection: LayoutNode | null
                    } = { nest: null, protection: null }
                    const visit = (node: LayoutNode) => {
                      if (node.id === `circuit-nest-${nestCircuitIdForPreview}`) {
                        currentMatch.nest = node
                      }
                      if (
                        (node.type === 'mcb' || node.type === 'rcd') &&
                        node.circuitIdForWires === nestCircuitIdForPreview
                      ) {
                        currentMatch.protection = node
                      }
                      node.children?.forEach(visit)
                    }
                    visit(currentPanelNode)
                    if (currentMatch.protection) {
                      return currentMatch.protection.bounds.x - createdProtectionNode.bounds.x
                    }
                    if (!currentMatch.nest) return 0

                    const currentNestBounds = getHitZoneBounds(currentMatch.nest, 'core')
                    const currentAttachX = (currentNestBounds.left + currentNestBounds.right) / 2
                    return currentAttachX - createdProtectionNode.bounds.x
                  })()

                  if (isDomoticaOutputPreview) {
                    const currentDomoticaWires = wireSegments
                      .filter(
                        (ws) =>
                          ws.panelId === panelId &&
                          ws.circuitId === dropTarget.circuitId &&
                          ws.type === 'branch' &&
                          ws.fromElementId === dropTarget.endpointId
                      )
                      .sort((a, b) => a.startPoint.y - b.startPoint.y)
                    const bottomWire = currentDomoticaWires[currentDomoticaWires.length - 1]
                    const targetWire =
                      currentDomoticaWires.find(
                        (ws) => ws.domoticaOutputIndex === dropTarget.domoticaOutput?.index
                      ) ?? currentDomoticaWires[dropTarget.domoticaOutput!.index]
                    const allCurrentRowsOccupied =
                      currentDomoticaWires.length > 0 &&
                      currentDomoticaWires.every((ws) => !!ws.toElementId)
                    const shouldRenderExpandPreview =
                      !!dropTarget.domoticaOutput?.expands ||
                      (allCurrentRowsOccupied &&
                        currentDomoticaWires.length < DOMOTICA_MAX_ENDPOINT_OUTPUTS &&
                        !!targetWire?.toElementId)
                    if (!shouldRenderExpandPreview) {
                      // Non-expanding domotica output previews use the generic simulated graph.
                    } else {
                      const anchorWire = dropTarget.domoticaOutput?.expands
                        ? bottomWire
                        : targetWire
                      if (!anchorWire) return null

                      const outputStartX = anchorWire.startPoint.x
                      const outputY = dropTarget.domoticaOutput?.expands
                        ? anchorWire.startPoint.y + DOMOTICA_OUTPUT_SPACING
                        : anchorWire.startPoint.y - DOMOTICA_OUTPUT_SPACING
                      const ghostX = outputStartX + DOMOTICA_BRANCH_LEAD
                      const ghostSize = SYMBOL_SIZE
                      const expandCueHeight = Math.max(12, DOMOTICA_OUTPUT_SPACING - 4)
                      const domoticaParentPreviewNode: LayoutNode | null = (() => {
                        let found: LayoutNode | null = null
                        const visit = (node: LayoutNode) => {
                          if (found) return
                          if (node.type === 'endpoint' && node.domainId === dropTarget.endpointId) {
                            found = node
                            return
                          }
                          node.children?.forEach(visit)
                        }
                        visit(previewPanelNode)
                        return found
                      })()

                      return (
                        <Group
                          key={`preview-panel-${panelId}`}
                          name={`preview-panel-${panelId}`}
                          opacity={0.85}
                          listening={false}
                        >
                          {domoticaParentPreviewNode &&
                            (() => {
                              const { x, y, width, height } = (
                                domoticaParentPreviewNode as LayoutNode
                              ).bounds
                              const inset = 2
                              const adjWidth = Math.max(0, width - inset * 2)
                              const adjHeight = Math.max(0, height - inset * 2)
                              return (
                                <Rect
                                  key={`preview-node-${(domoticaParentPreviewNode as LayoutNode).id}`}
                                  x={x - adjWidth / 2}
                                  y={y - adjHeight / 2}
                                  width={adjWidth}
                                  height={adjHeight}
                                  stroke={previewStroke}
                                  strokeWidth={2}
                                  dash={dashPattern}
                                  cornerRadius={4}
                                  fill="rgba(59,130,246,0.08)"
                                  listening={false}
                                />
                              )
                            })()}
                          <Rect
                            x={outputStartX - 6}
                            y={outputY - expandCueHeight / 2}
                            width={12}
                            height={expandCueHeight}
                            stroke={previewStroke}
                            strokeWidth={2}
                            dash={dashPattern}
                            cornerRadius={6}
                            fill="rgba(59,130,246,0.16)"
                            listening={false}
                          />
                          <Circle
                            x={outputStartX}
                            y={outputY}
                            radius={4}
                            fill={previewStroke}
                            opacity={0.9}
                            listening={false}
                          />
                          <Line
                            points={[outputStartX, outputY, ghostX, outputY]}
                            stroke={previewStroke}
                            strokeWidth={3}
                            dash={dashPattern}
                            lineCap="round"
                            lineJoin="round"
                            listening={false}
                          />
                          <Rect
                            x={ghostX - ghostSize / 2}
                            y={outputY - ghostSize / 2}
                            width={ghostSize}
                            height={ghostSize}
                            stroke={previewStroke}
                            strokeWidth={2}
                            dash={dashPattern}
                            cornerRadius={4}
                            fill="rgba(59,130,246,0.12)"
                            listening={false}
                          />
                        </Group>
                      )
                    }
                  }

                  if (
                    (isMainBusProtectionPreview && !nestCircuitIdAtCursor) ||
                    isSecondaryBusProtectionPreview
                  ) {
                    const createdProtectionNode = previewNodes.find(
                      (node) =>
                        (node.type === 'mcb' || node.type === 'rcd') &&
                        !!node.domainId &&
                        previewGraph.createdProtectionIds.includes(node.domainId)
                    )
                    // Secondary-bus previews use the simulated node position so the
                    // ghost shows the exact final slot instead of following the cursor.
                    const shouldUseInsertionGhost = shouldUseMainBusInsertionGhost
                    // `type: 'mainBus'` includes secondary bars; exclude `fromElementType === 'secondaryBus'`.
                    const busSegments = (
                      isSecondaryBusProtectionPreview
                        ? previewWiresForPanel
                        : previewGraph.wireSegments
                    ).filter((ws) => {
                      if (ws.panelId !== panelId || ws.type !== 'mainBus') return false
                      if (!isSecondaryBusProtectionPreview) {
                        return ws.fromElementType !== 'secondaryBus'
                      }
                      return (
                        ws.fromElementType === 'secondaryBus' &&
                        ws.circuitId === dropTarget?.circuitId
                      )
                    })
                    const dragPreviewPosition = dragPreview?.position
                    const targetX = shouldUseInsertionGhost
                      ? dragPreviewPosition?.x
                      : createdProtectionNode?.bounds.x

                    // For insertion ghost, use REAL layout's bus segments (matches the
                    // segments the drop logic will hit-test against) so the highlighted
                    // segment and ghost X align with what the user actually clicks on.
                    // The simulated layout has an extra ghost item which shifts its
                    // segments away from the cursor's true position.
                    const realBusSegments = isSecondaryBusProtectionPreview
                      ? wireSegments.filter(
                          (ws) =>
                            ws.panelId === panelId &&
                            ws.type === 'mainBus' &&
                            ws.fromElementType === 'secondaryBus' &&
                            ws.circuitId === dropTarget?.circuitId
                        )
                      : wireSegments.filter(
                          (ws) =>
                            ws.panelId === panelId &&
                            ws.type === 'mainBus' &&
                            ws.fromElementType !== 'secondaryBus'
                        )
                    const segmentsForHighlight =
                      realBusSegments.length > 0 ? realBusSegments : busSegments

                    const hitSegment =
                      (targetX != null
                        ? segmentsForHighlight.find((ws) => {
                            const minX = Math.min(ws.startPoint.x, ws.endPoint.x)
                            const maxX = Math.max(ws.startPoint.x, ws.endPoint.x)
                            return targetX >= minX && targetX <= maxX
                          })
                        : undefined) ??
                      (targetX != null && segmentsForHighlight.length > 0
                        ? [...segmentsForHighlight].sort((a, b) => {
                            const aMid = (a.startPoint.x + a.endPoint.x) / 2
                            const bMid = (b.startPoint.x + b.endPoint.x) / 2
                            return Math.abs(aMid - targetX) - Math.abs(bMid - targetX)
                          })[0]
                        : undefined)

                    const busY = hitSegment?.startPoint.y ?? previewPanelLayout.mainBus.y
                    // Approximate the real MCB geometry: short vertical from bus to symbol,
                    // and a nearly square symbol box.
                    const verticalLen = 40
                    const symbolHeight = 20
                    const symbolWidth = 20
                    const symbolCenterY = busY - verticalLen
                    // Main-bus insertion keeps its cursor-aligned ghost. Secondary-bus
                    // insertion snaps to the simulated layout's final node position.
                    const ghostCenterX = shouldUseInsertionGhost
                      ? (targetX ??
                        (hitSegment ? (hitSegment.startPoint.x + hitSegment.endPoint.x) / 2 : 0))
                      : (createdProtectionNode?.bounds.x ?? targetX)

                    if (ghostCenterX == null) {
                      return null
                    }

                    return (
                      <Group
                        key={`preview-panel-${panelId}`}
                        name={`preview-panel-${panelId}`}
                        opacity={0.85}
                        listening={false}
                      >
                        {/* Show the complete simulated secondary bus so end insertions visibly extend it. */}
                        {isSecondaryBusProtectionPreview &&
                          busSegments.map((ws) => (
                            <Line
                              key={`preview-extended-secondary-bus-${ws.id}`}
                              name="eendraad-preview-secondary-bus"
                              points={[
                                ws.startPoint.x,
                                ws.startPoint.y,
                                ws.endPoint.x,
                                ws.endPoint.y,
                              ]}
                              stroke={previewStroke}
                              strokeWidth={6}
                              opacity={0.6}
                              listening={false}
                            />
                          ))}

                        {/* Highlight the busbar segment we're inserting on */}
                        {hitSegment && (
                          <Line
                            points={[
                              hitSegment.startPoint.x,
                              hitSegment.startPoint.y,
                              hitSegment.endPoint.x,
                              hitSegment.endPoint.y,
                            ]}
                            stroke={previewStroke}
                            strokeWidth={8}
                            opacity={0.6}
                            listening={false}
                          />
                        )}

                        {/* Vertical preview wire from bus to protection */}
                        <Line
                          points={[ghostCenterX, busY, ghostCenterX, symbolCenterY + symbolHeight]}
                          stroke={previewStroke}
                          strokeWidth={4}
                          dash={dashPattern}
                          lineCap="round"
                          lineJoin="round"
                          listening={false}
                        />

                        {/* Vertical preview wire from protection to empty top */}
                        <Line
                          points={[ghostCenterX, symbolCenterY, ghostCenterX, symbolCenterY - 70]}
                          stroke={previewStroke}
                          strokeWidth={4}
                          dash={dashPattern}
                          lineCap="round"
                          lineJoin="round"
                          listening={false}
                        />

                        {/* Protection ghost box, centered on symbolCenterY */}
                        <Rect
                          name="eendraad-preview-created-protection"
                          x={ghostCenterX - symbolWidth / 2}
                          y={symbolCenterY}
                          width={symbolWidth}
                          height={symbolWidth}
                          stroke={previewStroke}
                          strokeWidth={2}
                          dash={dashPattern}
                          cornerRadius={4}
                          fill="rgba(59,130,246,0.12)"
                          listening={false}
                        />
                      </Group>
                    )
                  } else if (createsSecondaryBusFromNestedDrop) {
                    // When adding a nested circuit: draw the fat secondary bus bar, then use the same
                    // wire segments and node positions from the preview graph as the general case, so
                    // the preview matches the final layout exactly.
                    const busSegments = nestedProtectionPreviewBusSegments
                    const busSegmentIds = new Set(busSegments.map((ws) => ws.id))

                    // If we have a secondary bus, draw fat bar + same wires/nodes as general case (exclude bar from wires to avoid double-draw)
                    if (busSegments.length > 0) {
                      const otherWires = previewWiresForPanel.filter(
                        (ws) => !busSegmentIds.has(ws.id)
                      )

                      return (
                        <Group
                          key={`preview-panel-${panelId}`}
                          name={`preview-panel-${panelId}`}
                          x={nestedPreviewOffsetX + previewPanelTranslation.x}
                          y={previewPanelTranslation.y}
                          opacity={0.85}
                          listening={false}
                        >
                          {/* Fat secondary bus bar (same segments as real layout, drawn thick for visibility) */}
                          {busSegments.map((ws) => (
                            <Line
                              key={`preview-secondary-bus-${ws.id}`}
                              points={[
                                ws.startPoint.x,
                                ws.startPoint.y,
                                ws.endPoint.x,
                                ws.endPoint.y,
                              ]}
                              stroke={previewStroke}
                              strokeWidth={8}
                              opacity={0.6}
                              listening={false}
                            />
                          ))}

                          {/* Same wire draw as general case: verticals and rest of circuit (layout positions) */}
                          {otherWires.map((ws) => {
                            const isThick = ws.type === 'trunk' || ws.type === 'mainBus'
                            return (
                              <Line
                                key={`preview-wire-${ws.id}`}
                                points={[
                                  ws.startPoint.x,
                                  ws.startPoint.y,
                                  ws.endPoint.x,
                                  ws.endPoint.y,
                                ]}
                                stroke={previewStroke}
                                strokeWidth={isThick ? 6 : 3}
                                dash={dashPattern}
                                lineCap="round"
                                lineJoin="round"
                                listening={false}
                              />
                            )
                          })}

                          {/* Same node draw as general case (layout positions) */}
                          {previewNodes.map((node) => {
                            const { x, y, width, height } = node.bounds
                            const inset = 4
                            const adjWidth = Math.max(0, width - inset * 2)
                            const adjHeight = Math.max(0, height - inset * 2)
                            const rectX = x - adjWidth / 2
                            const rectY = y - adjHeight / 2

                            return (
                              <Rect
                                key={`preview-node-${node.id}`}
                                name={
                                  node.domainId &&
                                  previewGraph.createdProtectionIds.includes(node.domainId)
                                    ? 'eendraad-preview-created-protection'
                                    : insertBetweenMovedProtectionNodes.includes(node)
                                      ? 'eendraad-preview-moved-protection'
                                      : undefined
                                }
                                x={rectX}
                                y={rectY}
                                width={adjWidth}
                                height={adjHeight}
                                stroke={previewStroke}
                                strokeWidth={2}
                                dash={dashPattern}
                                cornerRadius={4}
                                fill="rgba(59,130,246,0.10)"
                                listening={false}
                              />
                            )
                          })}
                        </Group>
                      )
                    }
                    // No secondary bus segments (e.g. adding first sub-circuit): fall through to general case
                  }

                  return (
                    <Group
                      key={`preview-panel-${panelId}`}
                      name={`preview-panel-${panelId}`}
                      x={nestedPreviewOffsetX + previewPanelTranslation.x}
                      y={previewPanelTranslation.y}
                      opacity={0.8}
                      listening={false}
                    >
                      {previewSupplySeparators.map((separator) => (
                        <Line
                          key={`preview-${separator.id}`}
                          name="eendraad-preview-supply-separator"
                          points={separator.points}
                          stroke={previewSeparatorStroke}
                          strokeWidth={4}
                          dash={[5, 5]}
                          opacity={0.95}
                          lineCap="round"
                          listening={false}
                        />
                      ))}

                      {previewWiresForPanel.map((ws) => {
                        const isThick = ws.type === 'trunk' || ws.type === 'mainBus'
                        return (
                          <Line
                            key={`preview-wire-${ws.id}`}
                            points={[
                              ws.startPoint.x,
                              ws.startPoint.y,
                              ws.endPoint.x,
                              ws.endPoint.y,
                            ]}
                            stroke={previewStroke}
                            strokeWidth={isThick ? 6 : 3}
                            dash={dashPattern}
                            lineCap="round"
                            lineJoin="round"
                            listening={false}
                          />
                        )
                      })}

                      {previewNodes.map((node) => {
                        const { x, y, width, height } = node.bounds
                        const inset = 4
                        const adjWidth = Math.max(0, width - inset * 2)
                        const adjHeight = Math.max(0, height - inset * 2)
                        const rectX = x - adjWidth / 2
                        const rectY = y - adjHeight / 2

                        return (
                          <Rect
                            key={`preview-node-${node.id}`}
                            name={
                              node.domainId &&
                              previewGraph.createdProtectionIds.includes(node.domainId)
                                ? 'eendraad-preview-created-protection'
                                : insertBetweenMovedProtectionNodes.includes(node)
                                  ? 'eendraad-preview-moved-protection'
                                  : undefined
                            }
                            x={rectX}
                            y={rectY}
                            width={adjWidth}
                            height={adjHeight}
                            stroke={previewStroke}
                            strokeWidth={2}
                            dash={dashPattern}
                            cornerRadius={4}
                            fill="rgba(59,130,246,0.10)"
                            listening={false}
                          />
                        )
                      })}
                    </Group>
                  )
                })}

            {/* Drop-zone hints: legal targets while dragging from the library */}
            {canPlaceSymbols && activePlacementSymbol && (
              <DropZoneHintsOverlay
                layoutTree={layoutTree}
                project={currentProject}
                symbol={activePlacementSymbol}
                activeDropTarget={dragPreview?.dropTarget ?? null}
                activeDropTargetNodeId={activeDropTargetNodeId}
                activePosition={dragPreview?.position ?? null}
                relocation={internalDragPlacement}
                movingPanelAttachmentId={
                  internalDragPlacement?.elementId ?? dragPreview?.movingPanelAttachment?.panelId
                }
              />
            )}

            {/* Legacy drag preview fallback when simulated preview graph is unavailable. */}
            {canPlaceSymbols && showLegacyDragPreview && dragPreview && (
              <DragPreview
                position={dragPreview.position}
                dropTarget={dragPreview.dropTarget}
                layout={layout}
                wireSegments={wireSegments}
                symbolData={dragPreview.symbolData}
                showMainBusPositionMarker={!dragPreview.movingProtection}
              />
            )}

            {/* Pointer-follow icon (Alt-duplicate); library drag uses HTML5 setDragImage instead. */}
            {canPlaceSymbols &&
              altDuplicatePointerDragActive &&
              dragPreview?.symbolData &&
              dragPreview.position.x !== -Infinity && (
                <DragCursorSymbol
                  position={dragPreview.position}
                  symbolData={dragPreview.symbolData}
                />
              )}

            {currentProject ? (
              <InstallDateOverlay
                project={currentProject}
                layout={layout}
                visible={installDatesVisible}
                monochrome={eendraadDateMarkingVisibility.installDatesMonochrome}
                selectionEnabled={eendraadDateMarkingMode}
                onSelectFrame={(frame) => {
                  if (suppressDateFrameSelectionRef.current) return
                  const selectableTargets = frame.targets.filter(
                    (target) => target.type !== 'panel'
                  )
                  const selectionTargets =
                    selectableTargets.length > 0 ? selectableTargets : frame.targets
                  const firstTarget = selectionTargets[0]
                  if (!firstTarget) return
                  setClosedDateToolSelectionKey(null)
                  setSelection({
                    type: firstTarget.type,
                    ids: selectionTargets.map((target) => target.id),
                  })
                  setDateToolFrameSelection({
                    year: frame.year,
                    bounds: frame.bounds,
                  })
                }}
              />
            ) : null}

            {/* Debug: hit zone overlay (dev builds only, when enabled in settings) */}
            {import.meta.env.DEV && (
              <>
                <TrunkLayoutDebugOverlay layout={layout} wireSegments={wireSegments} />
                <HitZoneDebugOverlay layoutTree={layoutTree} dragPreview={dragPreview} />
              </>
            )}
            {}
          </Group>
        </BaseCanvas>

        {offscreenSupplyPreviewDirection ? (
          <OffscreenPreviewIndicator direction={offscreenSupplyPreviewDirection} />
        ) : null}

        <ViewNavigationToolbar
          zoom={eendraadView.zoom}
          onZoomChange={handleZoomChange}
          onPanChange={handlePanChange}
          onFitToView={handleFitToView}
          canvasType="eendraad"
        />

        <CanvasFloatingControlRail
          side="left"
          verticalAlign="center"
          offsetPx={12}
          zIndex={30}
          dataCanvasOverlayAnchor="left"
          dataCanvasOverlayPosition="center-left"
        >
          {canUseInstallDates ? (
            <FloatingControl
              icon={<CalendarDays className="h-5 w-5" />}
              label={t('installDates.tool', 'Install date')}
              tooltipDescription={t(
                'installDates.toolDescription',
                'Mark selected one-wire items by year'
              )}
              variant="tool"
              side="left"
              active={eendraadDateMarkingMode}
              onClick={() => setEendraadDateMarkingMode(!eendraadDateMarkingMode)}
            />
          ) : null}
        </CanvasFloatingControlRail>

        {dateToolHelperStyle ? (
          <div
            className="absolute z-40 rounded-md border border-gray-200 bg-white p-3 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-800"
            style={dateToolHelperStyle}
          >
            <label className="mb-1 block font-medium text-gray-700 dark:text-gray-200">
              {t('installDates.installDate', 'Install date')}
            </label>
            <div className="flex items-center gap-2">
              <label
                className="relative block h-8 w-8 shrink-0 cursor-pointer rounded border border-gray-300 shadow-sm dark:border-gray-600"
                style={{ backgroundColor: dateToolStoredColor }}
                title={t('installDates.color', 'Install date color')}
              >
                <input
                  type="color"
                  value={dateToolStoredColor}
                  onChange={(e) => updateInstallDateColor(dateToolDraftYear, e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  aria-label={t('installDates.color', 'Install date color')}
                />
              </label>
              <button
                type="button"
                onClick={() => setDateToolCalendarOpen((open) => !open)}
                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  dateToolCalendarOpen
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/40 dark:text-blue-200'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600'
                }`}
                title={t('installDates.chooseExactDate', 'Choose exact date')}
                aria-label={t('installDates.chooseExactDate', 'Choose exact date')}
                aria-expanded={dateToolCalendarOpen}
              >
                <CalendarDays className="h-4 w-4" aria-hidden />
              </button>
              <input
                ref={dateToolInputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={dateToolYear}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
                  const parsed = digits.length === 4 ? Number.parseInt(digits, 10) : null
                  if (parsed != null && parsed > currentInstallYear) {
                    setDateToolYear(String(currentInstallYear))
                  } else {
                    setDateToolYear(digits)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitDateToolDraft()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    setDateToolYear(String(selectedDateToolYear))
                    setClosedDateToolSelectionKey(dateToolSelectionKey)
                  }
                }}
                onBlur={() => {
                  if (dateToolYear === '') return
                  const parsed = normalizeInstallYear(dateToolYear)
                  const clamped =
                    parsed == null ? selectedDateToolYear : clamp(currentInstallYear, 1900, parsed)
                  setDateToolYear(String(clamped))
                }}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  e.preventDefault()
                  const input = e.currentTarget
                  const pointerId = e.pointerId
                  const startY = e.clientY
                  const startYear = Math.max(
                    1900,
                    Math.min(
                      currentInstallYear,
                      normalizeInstallYear(dateToolYear) ?? selectedDateToolYear
                    )
                  )
                  let didDrag = false
                  input.setPointerCapture(pointerId)
                  const handleMove = (moveEvent: PointerEvent) => {
                    if (moveEvent.pointerId !== pointerId) return
                    if (Math.abs(startY - moveEvent.clientY) < 4) return
                    didDrag = true
                    moveEvent.preventDefault()
                    const delta = Math.trunc((startY - moveEvent.clientY) / 8)
                    if (delta === 0) return
                    const nextYear = clamp(currentInstallYear, 1900, startYear + delta)
                    setDateToolYear(String(nextYear))
                  }
                  const finishPointer = (pointerEvent: PointerEvent) => {
                    if (pointerEvent.pointerId !== pointerId) return
                    input.removeEventListener('pointermove', handleMove)
                    input.removeEventListener('pointerup', finishPointer)
                    input.removeEventListener('pointercancel', finishPointer)
                    if (input.hasPointerCapture(pointerId)) input.releasePointerCapture(pointerId)
                    if (!didDrag) {
                      input.focus({ preventScroll: true })
                      input.select()
                    }
                  }
                  input.addEventListener('pointermove', handleMove)
                  input.addEventListener('pointerup', finishPointer)
                  input.addEventListener('pointercancel', finishPointer)
                }}
                onDragStart={(e) => e.preventDefault()}
                placeholder={String(
                  currentProject?.project.yearOfConstruction ?? new Date().getFullYear()
                )}
                className="min-w-0 flex-1 touch-none cursor-ns-resize rounded-md border border-gray-300 bg-white px-2 py-1.5 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
              <button
                type="button"
                onClick={commitDateToolDraft}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                title={t('common.confirm', 'Confirm')}
                aria-label={t('common.confirm', 'Confirm')}
              >
                <CornerDownLeft className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                onClick={clearSelectedInstallDates}
                disabled={!dateToolHasExplicitDate}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-red-300 bg-red-50 text-red-600 shadow-sm hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-50 disabled:text-gray-300 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70 dark:disabled:border-gray-700 dark:disabled:bg-gray-800 dark:disabled:text-gray-600"
                title={t('installDates.clearExplicitDate', 'Clear explicit date')}
                aria-label={t('installDates.clearExplicitDate', 'Clear explicit date')}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </div>
            {dateToolCalendarOpen ? (
              <div className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-700">
                <div
                  className="mb-2 grid grid-cols-6 gap-1"
                  aria-label={t('installDates.month', 'Month')}
                >
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                    <button
                      key={month}
                      type="button"
                      onClick={() => {
                        setDateToolMonth(month)
                        const maxDay = new Date(Date.UTC(dateToolDraftYear, month, 0)).getUTCDate()
                        setDateToolDay((day) => Math.min(day, maxDay))
                      }}
                      className={`h-7 rounded text-[11px] tabular-nums transition-colors ${
                        dateToolMonth === month
                          ? 'bg-blue-600 font-semibold text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
                      }`}
                      aria-pressed={dateToolMonth === month}
                    >
                      {dateToolMonthLabels[month - 1]}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1" aria-label={t('installDates.day', 'Day')}>
                  {Array.from({ length: dateToolDaysInMonth }, (_, index) => index + 1).map(
                    (day) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => setDateToolDay(day)}
                        className={`h-7 rounded text-[11px] tabular-nums transition-colors ${
                          dateToolSafeDay === day
                            ? 'bg-blue-600 font-semibold text-white'
                            : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'
                        }`}
                        aria-pressed={dateToolSafeDay === day}
                      >
                        {day}
                      </button>
                    )
                  )}
                </div>
                <div className="mt-2 text-center text-xs font-medium tabular-nums text-gray-600 dark:text-gray-300">
                  {dateToolDraftDate}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <CanvasFloatingControlRail
          side="right"
          verticalAlign="top"
          offsetPx={12}
          topOffsetPx={12}
          zIndex={30}
          menuOpen={openEendraadMenu !== null}
          dataCanvasOverlayAnchor="right"
          dataCanvasOverlayPosition="top-right"
        >
          {canEditProject ? (
            <FloatingControl
              icon={
                <span className="flex items-baseline justify-center gap-px font-bold text-[13px] leading-none tracking-tight text-gray-700 dark:text-gray-200 tabular-nums">
                  <span>A</span>
                  <span className="text-[11px] opacity-80">B</span>
                </span>
              }
              label={t('canvas.eendraadNaming.menuTitle')}
              variant="menu"
              side="right"
              open={openEendraadMenu === 'naming'}
              onOpenChange={(next) => setOpenEendraadMenu(next ? 'naming' : null)}
            >
              <div className="rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg p-3 min-w-[260px] space-y-3 text-xs">
                <div
                  data-testid="eendraad-auto-label-setting"
                  className={`rounded-md p-1 text-gray-700 transition-all duration-1000 dark:text-gray-200 ${
                    namingGuidanceHighlighted
                      ? 'bg-sky-100 ring-2 ring-sky-500 dark:bg-sky-950/60'
                      : 'ring-2 ring-transparent'
                  }`}
                >
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={eendraadAutoNaming}
                      onChange={(e) => handleEendraadAutomaticNamingChange(e.target.checked)}
                      className="rounded border-gray-400 mt-0.5"
                    />
                    <span>
                      <span className="font-medium block">
                        {t('canvas.eendraadNaming.automaticNaming')}
                      </span>
                      <span className="block text-[11px] leading-snug text-gray-500 dark:text-gray-400 mt-0.5">
                        {t('canvas.eendraadNaming.automaticNamingDescription')}
                      </span>
                    </span>
                  </label>
                  <span
                    className="mt-2 block"
                    title={t(
                      'canvas.eendraadNaming.resetAllTooltip',
                      'Remove every custom label and return all circuits to automatic naming.'
                    )}
                  >
                    <button
                      type="button"
                      disabled={!eendraadAutoNaming || !hasCustomEendraadLabels}
                      onClick={handleResetAllEendraadLabels}
                      className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                      {t('canvas.eendraadNaming.resetAllLabels', 'Reset all labels')}
                    </button>
                  </span>
                </div>
                <label
                  className={`flex items-start gap-2 ${
                    eendraadAutoNaming
                      ? 'text-gray-700 dark:text-gray-200'
                      : 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={eendraadHideFeederLetters}
                    disabled={!eendraadAutoNaming}
                    onChange={(e) => handleEendraadHideFeederLettersChange(e.target.checked)}
                    className="rounded border-gray-400 mt-0.5 disabled:opacity-50"
                  />
                  <span>
                    <span className="font-medium block">
                      {t('canvas.eendraadNaming.hideFeederLetters')}
                    </span>
                    <span className="block text-[11px] leading-snug text-gray-500 dark:text-gray-400 mt-0.5">
                      {t('canvas.eendraadNaming.hideFeederLettersDescription')}
                    </span>
                  </span>
                </label>
                {canUseInstallDates ? (
                  <>
                    <div className="flex items-center gap-2 border-t border-gray-200 pt-3 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                      <span>{t('installDates.menuSection', 'Dates')}</span>
                    </div>
                    <label className="flex items-start gap-2 text-gray-700 dark:text-gray-200">
                      <input
                        type="checkbox"
                        checked={eendraadDateMarkingVisibility.installDatesVisible}
                        onChange={(e) =>
                          setEendraadDateMarkingVisibility({
                            installDatesVisible: e.target.checked,
                          })
                        }
                        className="rounded border-gray-400 mt-0.5"
                      />
                      <span>
                        <span className="font-medium block">
                          {t('installDates.showLabelsOutsideMode', 'Date labels')}
                        </span>
                        <span className="block text-[11px] leading-snug text-gray-500 dark:text-gray-400 mt-0.5">
                          {t(
                            'installDates.showLabelsOutsideModeDescription',
                            'Show outside date mode.'
                          )}
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-gray-700 dark:text-gray-200">
                      <input
                        type="checkbox"
                        checked={eendraadDateMarkingVisibility.installDatesMonochrome}
                        onChange={(e) =>
                          setEendraadDateMarkingVisibility({
                            installDatesMonochrome: e.target.checked,
                          })
                        }
                        className="rounded border-gray-400 mt-0.5"
                      />
                      <span>
                        <span className="font-medium block">
                          {t('installDates.forceMonochrome', 'Monochrome')}
                        </span>
                        <span className="block text-[11px] leading-snug text-gray-500 dark:text-gray-400 mt-0.5">
                          {t('installDates.forceMonochromeDescription', 'Use one neutral color.')}
                        </span>
                      </span>
                    </label>
                  </>
                ) : null}
              </div>
            </FloatingControl>
          ) : null}
        </CanvasFloatingControlRail>
      </div>
    </CanvasOverlayScaleProvider>
  )
}

interface SupplySeparatorGeometry {
  id: string
  diagramId: string
  points: [number, number, number, number]
}

function getSupplySeparatorsForDiagram(
  wireSegments: WireSegment[],
  diagramId: string
): SupplySeparatorGeometry[] {
  const diagramSegments = wireSegments.filter((segment) => segment.diagramId === diagramId)
  const enclosureBoundaries = diagramSegments.filter(
    (segment) => segment.supplyEnclosureBoundary === true
  )
  const separators: SupplySeparatorGeometry[] = enclosureBoundaries.map((segment) => {
    const { x, y } = getSupplyEnclosureBoundaryCenter(segment)
    const horizontal =
      Math.abs(segment.endPoint.x - segment.startPoint.x) >=
      Math.abs(segment.endPoint.y - segment.startPoint.y)
    return {
      id: `supply-enclosure-separator-${diagramId}-${segment.id}`,
      diagramId,
      points: horizontal ? [x, y - 16, x, y + 16] : [x - 16, y, x + 16, y],
    }
  })
  if (separators.length > 0) return separators

  const crossing = diagramSegments.find(
    (segment) =>
      segment.isSupplyTrunk === true &&
      segment.supplyWireRole === 'crossing' &&
      segment.supplySeparatorX != null
  )
  if (!crossing || crossing.supplySeparatorX == null) return separators

  const legacySeparator: SupplySeparatorGeometry = {
    id: `supply-separator-${diagramId}`,
    diagramId,
    points: [
      crossing.supplySeparatorX,
      crossing.startPoint.y - 16,
      crossing.supplySeparatorX,
      crossing.startPoint.y + 16,
    ],
  }
  return [legacySeparator]
}

function getChangedSupplySeparatorsForDiagram(
  previewWireSegments: WireSegment[],
  currentWireSegments: WireSegment[],
  diagramId: string
): SupplySeparatorGeometry[] {
  const currentById = new Map(
    getSupplySeparatorsForDiagram(currentWireSegments, diagramId).map((separator) => [
      separator.id,
      separator,
    ])
  )
  return getSupplySeparatorsForDiagram(previewWireSegments, diagramId).filter((preview) => {
    // Simulating an unrelated drop can rebuild an enclosure boundary with a new wire id.
    // Stable geometry means there is no separator change to preview.
    const current =
      currentById.get(preview.id) ??
      [...currentById.values()].find((candidate) =>
        preview.points.every(
          (coordinate, index) => Math.abs(coordinate - candidate.points[index]!) < 0.001
        )
      )
    return (
      !current ||
      preview.points.some(
        (coordinate, index) => Math.abs(coordinate - current.points[index]!) >= 0.001
      )
    )
  })
}

const EendraadCanvas = memo(
  EendraadCanvasInner,
  (prev: Readonly<EendraadCanvasProps>, next: Readonly<EendraadCanvasProps>) => {
    return (
      prev.onMultiFingerSwipe === next.onMultiFingerSwipe && prev.capabilities === next.capabilities
    )
  }
)

export default EendraadCanvas
