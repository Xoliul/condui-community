import { useEendraadSelectionBounds } from './eendraad/useEendraadSelectionBounds'
import { isSupplyDiagramId, normalizeBusFeedSupplyFrameDrop } from '@/lib/layout/supplyFrameRole'
import { useEendraadViewportNavigation } from './eendraad/useEendraadViewportNavigation'
import { useEendraadElementDrag } from './eendraad/useEendraadElementDrag'
import { useEendraadSceneArtwork } from './eendraad/useEendraadSceneArtwork'
import { getSupplySeparatorsForDiagram } from '@/lib/layout/supplySeparatorSceneGeometry'
import { useEendraadInstallDateTool } from './eendraad/useEendraadInstallDateTool'
import { useEendraadContextMenu } from './eendraad/useEendraadContextMenu'

import { DescribedCheckbox } from '@/components/common/DescribedCheckbox'
import { resolveLiveProtectionBusPreview } from '@/lib/layout/liveProtectionBusPreview'

import { useCanvasWindow } from '@/components/viewport/ViewportContext'
import {
  useIsActiveViewport,
  useViewportUIStore as useCanvasUIStore,
  useViewportUIApi,
} from '@/components/viewport/ViewportUIStore'

import { createUiDropBehaviorHooks } from '@/handlers/eendraad/uiDropBehaviorHooks'
import { placeElectricalSymbol } from '@/handlers/eendraad/placeElectricalSymbol'
import { normalizeElectricalDropTarget } from '@/lib/eendraad/electricalSymbolDrop'
import {
  memo,
  useCallback,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'
import { useJunctionEditorMenu } from '@/components/junctionEditor/junctionEditorHostedFeatures'
import { Group } from 'react-konva'

import type Konva from 'konva'
import { useTranslation } from 'react-i18next'
import {
  CalendarDays,
  CornerDownLeft,
  RotateCcw,
  Trash2,
} from 'lucide-react'

import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import { useDialogStore } from '@/stores/dialogStore'
import { useCanvasRegistryStore } from '@/stores/canvasRegistryStore'
import { isDemoProjectId } from '@/lib/demoProject'
import type {
  CanvasDropMeta,
  CanvasSize,
  Point,
} from '@/types/ui'
import type {
  Endpoint,
  Panel,
} from '@/types/schema'
import BaseCanvas, { type BaseCanvasHandle } from './BaseCanvas'
import ViewNavigationToolbar from './ViewNavigationToolbar'
import CanvasFloatingControlRail from './CanvasFloatingControlRail'
import { FloatingControl } from './FloatingControls'
import { CanvasOverlayScaleProvider } from '@/contexts/CanvasOverlayScaleContext'
import { EendraadWireSegmentsContext } from '@/contexts/EendraadWireSegmentsContext'

import { logger } from '@/lib/logger'
import { trackSymbolPlace } from '@/lib/analytics/editorEventAnalytics'

import { EendraadRemoteSelections, OffscreenPreviewIndicator, TrunkLayoutDebugOverlay } from './eendraad'

import InstallDateOverlay from './eendraad/InstallDateOverlay'

/* @vision-scan-strip-start */
import { OneWireReferencePages } from './eendraad/OneWireReferencePages'
import { isElectricalVisionScanEnabled } from '@/lib/vision/availability'
import { placeDocumentOnOneWire } from '@/handlers/documents/oneWireReferences'

/* @vision-scan-strip-end */

import { CanvasPanOrClickProvider } from './eendraad/CanvasPanOrClickProvider'
import { ConverterResizeViewportContext } from './eendraad/ConverterResizeViewportContext'
import { MetadataCalloutDragContext } from './eendraad/MetadataCalloutDragContext'

import { panelHasModularChangeover } from '@/lib/panel/panelFeedOrganization'
import { canCreateSupplyTopologyFromDrop } from '@/lib/supplyTopologyFeature'

import {
  findSameSymbolAddMoreLayoutTargets,
  incrementSameSymbolAddMoreTarget,
  isConflictingOnSymbolDrop,
  positionHitsMultiplierBadge,
  endpointMergeSettingsMatchEndpoints,
  type SameSymbolAddMoreTarget,
} from '@/lib/eendraad/sameSymbolAddMore'

import { validateEendraadPreview } from '@/hooks/eendraad/validateEendraadPreview'

import { createSyncEndpointMultiplierDeps, syncEndpointMultiplierCount } from '@/lib/eendraad/syncEndpointMultiplierCount'
import { createSyncSupplyInverterMultiplierDeps, syncSupplyDeviceMultiplierCount } from '@/lib/eendraad/syncSupplyInverterMultiplier'

import {
  useEendraadLayout,
  useEendraadWireSegments,
  useDropTargetDetection,
  useEendraadDragPreview,
  useLayoutTree,
  useChangeoverGridSourcePreview,
} from '@/hooks/eendraad'

import { useEendraadPreviewGraph } from '@/hooks/eendraad/useEendraadPreviewGraph'
import { useBranchDropResolver } from '@/hooks/eendraad/useBranchDropResolver'
import { resolveOffscreenSupplyPreviewDirection } from '@/lib/layout/offscreenSupplyPreviewIndicator'
import type { LayoutNode } from '@/lib/layout/layoutTree'

import { getEendraadRenderProjectRevision } from '@/lib/layout/eendraadDerivedLayout'
import type { DropZoneHintRelocation } from '@/lib/layout/collectDropZoneHints'
import {
  findDropTarget,
  findDropTargetWithDebug,
  ensureCircuitTrunkWireSegmentOnDropTarget,
  getHitZoneBounds,
  type DropTarget,
  type FindDropTargetOptions,
} from '@/lib/layout/findDropTarget'

import { createFindElementsInRectangleHandler } from '@/handlers/eendraad'
import { canDropSymbolOnEmptyCanvas } from '@/lib/eendraad/dropBehaviors'
import { isSupplyDropTarget } from '@/lib/eendraad/supplyDropTargets'
import { PROTECTION_SYMBOL_IDS } from '@/lib/protectionKind'
import { describeEnclosureKey } from '@/lib/panel/enclosureNames'
import { getSymbolById, type SymbolMetadata } from '@/lib/symbols'
import AddElementPicker from '@/components/eendraad/AddElementPicker'

import { OPEN_EENDRAAD_NAMING_GUIDANCE_EVENT } from '@/lib/ui/eendraadNamingGuidance'

import { getViewportCenterPlanSpaceIfApplicable } from '@/lib/plan/autoSitplanPlacement'
import { resolveSitplanTargetFloorId } from '@/lib/plan/sitplanTargetFloor'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import { ensureEarthingSitplanPlacement } from '@/lib/plan/ensureEarthingSitplanPlacement'

import { getProjectElectricalInstallation, getProjectElectricalPanels } from '@/lib/projectV2/electrical'

import { isPanelAttachmentDropTargetTerminal } from '@/lib/eendraad/panelAttachmentMove'

import { ZOOM_100 } from '@/constants/canvasConstants'
import { getPanelCanvasZoomMinimum } from '@/lib/panel/panelCanvasZoom'
import { getPanelDiagramId } from '@/lib/layout/bottomUpLayout'

import {
  automaticMainBusNamingWouldChangeProject,
  projectHasManualEendraadLabelOverrides,
  resolveAutomaticNamingOptsFromInstallation,
} from '@/lib/eendraad/automaticMainBusNaming'
import { installationHideFeederLetters } from '@/lib/eendraad/eendraadNamingInstall'
import { getMainBusOrder } from '@/lib/eendraad/mainBusOrder'
import type { EditorCapabilities } from '@/lib/viewerMode'


import { useEditionFeatureAvailability } from '@/hooks/useEditionFeatureAvailability'
import { LabelStyleSelect } from '@/components/canvas/eendraad/LabelSchemeSettings'
import { applyLabelScheme } from '@/handlers/properties/applyLabelScheme'
import { editProperties } from '@/handlers/properties/editProperties'
import { updateNoteProperties } from '@/handlers/properties/editGeneralProperties'
import { openLabelSchemeDialog } from '@/handlers/eendraad/openLabelSchemeDialog'
import { labelSchemeUsesPanelPart, resolveLabelScheme } from '@/lib/eendraad/labelScheme'
import { useSettingsStore } from '@/stores/settingsStore'
import { normalizeInstallYear } from '@/lib/installDates'

import { queryOneWireNotes } from '@/lib/projectV2/annotations'
import { clamp } from '@/lib/geometry'
import { resolveCircuitWireSegmentByMetadata, resolveSupplyWireSegmentByMetadata } from '@/lib/eendraad/wireSelectionIdentity'

// Keep a generous screen-space gutter interactive while the camera is moving.

const EMPTY_PANELS: Panel[] = []








interface EendraadCanvasProps {
  onMultiFingerSwipe?: (
    direction: 'left' | 'right' | 'up' | 'down',
    fingerCount: number,
    startClientX: number
  ) => void
  capabilities?: EditorCapabilities
}


function EendraadCanvasInner({ onMultiFingerSwipe, capabilities }: EendraadCanvasProps = {}) {
  const isActiveViewport = useIsActiveViewport()
  const window = useCanvasWindow()
  const viewportUI = useViewportUIApi()
  const { t, i18n } = useTranslation()
  const withJunctionEditorItem = useJunctionEditorMenu()
  const eendraadView = useCanvasUIStore((s) => s.eendraadView)
  const requestFitToView = useCanvasUIStore((s) => s.requestFitToView)
  const activePanelId = useCanvasUIStore((s) => s.activePanelId)
  const eendraadViewRef = useRef(eendraadView)
  useLayoutEffect(() => { eendraadViewRef.current = eendraadView }, [eendraadView])
  const setEendraadView = useCanvasUIStore((s) => s.setEendraadView)
  const setSelection = useCanvasUIStore((s) => s.setSelection)
  const currentProject = useProjectStore((s: ProjectState) =>
    s.currentProject ? getEendraadRenderProjectRevision(s.currentProject) : null
  )
  const getEjectPlanPlacement = useCallback(() => {
    if (!currentProject) return undefined
    const ui = viewportUI.getState()
    const floorId = resolveSitplanTargetFloorId(currentProject, ui.activeFloorId)
    if (!floorId) return undefined
    const floor = selectProjectBuildingFloors(currentProject).find((candidate) => candidate.id === floorId)
    if (!floor) return undefined
    return {
      floorId,
      layer: 'layers' in floor && Array.isArray(floor.layers) ? floor.layers[0] ?? 'electrical' : 'electrical',
      pos:
        getViewportCenterPlanSpaceIfApplicable(
          ui.viewportLayout,
          ui.planCanvasViewportPx,
          ui.activeFloorId,
          floorId,
          ui.planView
        ) ?? { x: 400, y: 300 },
    }
  }, [currentProject, viewportUI])
  const eendraadNotes = useMemo(
    () => (currentProject ? queryOneWireNotes(currentProject) : []),
    [currentProject]
  )
  const currentProjectStorageMode = useProjectStore(
    (s: ProjectState) => s.currentProjectStorageMode
  )
  const selection = useCanvasUIStore((s) => s.selection)
  const eendraadDateMarkingMode = useCanvasUIStore((s) => s.eendraadDateMarkingMode)
  const setEendraadDateMarkingMode = useCanvasUIStore((s) => s.setEendraadDateMarkingMode)
  const eendraadDateMarkingVisibility = useCanvasUIStore((s) => s.eendraadDateMarkingVisibility)
  const setEendraadDateMarkingVisibility = useCanvasUIStore((s) => s.setEendraadDateMarkingVisibility)
  
  const canEditProject = capabilities?.canEditProject ?? true
  const canPlaceSymbols = capabilities?.canPlaceSymbols ?? true
  const canDragItems = capabilities?.canDragItems ?? true
  const canDeleteItems = capabilities?.canDeleteItems ?? true
  const getProtectionById = useProjectStore((s: ProjectState) => s.getProtectionById)
  const getPanelById = useProjectStore((s: ProjectState) => s.getPanelById)
  const getFloorById = useProjectStore((s: ProjectState) => s.getFloorById)
  const getCircuitById = useProjectStore((s: ProjectState) => s.getCircuitById)
  const getEndpointById = useProjectStore((s: ProjectState) => s.getEndpointById)
  const getTrunkDeviceById = useProjectStore((s: ProjectState) => s.getTrunkDeviceById)
  const getFramesByPanel = useProjectStore((s: ProjectState) => s.getFramesByPanel)
  const openDialog = useDialogStore((s) => s.openDialog)
  const canvasRef = useRef<BaseCanvasHandle>(null)
  const minZoom = useProjectStore((state) => getPanelCanvasZoomMinimum(state.currentProject))
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
  const endpointDragStartSelectionIdsRef = useRef<string[] | null>(null)
  const [dragRenderElementId, setDragRenderElementId] = useState<string | null>(null)
  const [dragRenderMode, setDragRenderMode] = useState<'move' | 'duplicate'>('move')
  const [dragRenderSelectionIds, setDragRenderSelectionIds] = useState<string[] | null>(null)
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
  const eendraadLabelScheme = resolveLabelScheme(currentInstallation?.labelScheme)
  const savedLabelStyles = useSettingsStore((s) => s.labelStyles)
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
  }, [window])
  
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
  useLayoutEffect(() => {
    viewportHitViewRef.current = { pan: eendraadView.pan, zoom: eendraadView.zoom, viewport: viewportPixelSize }
  }, [eendraadView.pan, eendraadView.zoom, viewportPixelSize])
  const [closedDateToolSelectionKey, setClosedDateToolSelectionKey] = useState<string | null>(null)
  const [dateToolFrameSelection, setDateToolFrameSelection] = useState<{
    year: number
    bounds: { x: number; y: number; width: number; height: number }
    selectionKey: string
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
  }, [eendraadDateMarkingMode, exitDateMarkingMode, window])

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
  }, [window])

  useEffect(
    () => () => {
      if (clearDateFrameSelectionSuppressionRef.current != null) {
        window.clearTimeout(clearDateFrameSelectionSuppressionRef.current)
      }
    },
    [window]
  )

  const setEendraadClipboard = useCanvasUIStore((s) => s.setEendraadClipboard)
  const libraryDragSymbol = useCanvasUIStore((s) => s.libraryDragSymbol)

  // Register canvas for export
  const registerEendraad = useCanvasRegistryStore((s) => s.registerEendraad)
  useEffect(() => {
    return registerEendraad(
      () => canvasRef.current?.getStage() ?? null,
      () => canvasRef.current?.fitToView()
    )
  }, [registerEendraad])

  // Calculate layout and wire segments
  const layout = useEendraadLayout()
  const layoutTree = useLayoutTree() // Tree-based rendering and operations
  const wireSegments = useEendraadWireSegments() // Tree-based wire generation
  // Sidebar hover/focus preview of the alternative changeover port-1 feed (UI state only).
  const changeoverGridSourcePreviewScene = useChangeoverGridSourcePreview(
    wireSegments,
    layoutTree,
    layout?.infoBlockLogo === true
  )

  const { resizeConverterWithViewportAnchor, getCanvasPositionFromEvent } = useEendraadViewportNavigation({
    canvasRef,
    currentProject,
    eendraadView,
    eendraadViewRef,
    layout,
    layoutTree,
    pendingConverterResizeAnchorRef,
    pointerOverEendraadRef,
    setEendraadView,
    viewportHitNeedsRemeasureRef,
    viewportHitRefreshTimerRef,
    viewportHitViewRef,
    viewportPixelSize,
    viewportUI,
    window,
    wireSegments,
  })

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
  const detectDropTargetCallback = useDropTargetDetection(internalDragElementIdRef, endpointDragStartSelectionIdsRef) // Tree-based hit testing, never the supply side for a dragged horizontal module

  const { getBranchTargets, resolveBranchDrop, clearBranchDrop } = useBranchDropResolver({
    layout, layoutTree, project: currentProject, internalDragElementIdRef, elementDragModeRef, endpointDragStartSelectionIdsRef,
    getZoom: () => canvasRef.current?.getLiveViewTransform().zoom ?? eendraadViewRef.current.zoom,
  })

  // Drag preview state and handler
  const { dragPreview: pendingDragPreview, setDragPreview, handleDragOver } = useEendraadDragPreview(
    detectDropTargetCallback,
    {
      resolveBranchDrop,
      clearBranchDrop,
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
        const target = findSameSymbolAddMoreLayoutTargets(symbol.searchPreset ? '' : symbol.id, layoutTree, position)[0]
        if (!target) return null
        const internalId = internalDragElementIdRef.current
        if (internalId) {
          const source = getEndpointById(internalId)
          const endpoint = target.target.endpoint
          if (!source || !endpoint) return null
          if (elementDragModeRef.current === 'duplicate' && source.id === endpoint.id) return target
          if (!source.domoticaChildProps || !endpoint.domoticaChildProps ||
            (endpointDragStartSelectionIdsRef.current?.length ?? 1) !== 1 ||
            !endpointMergeSettingsMatchEndpoints(source, endpoint) ||
            findDropTarget(layoutTree, position).domoticaChildDropIntent !== 'replace') return null
          return source.id === endpoint.id ? null : target
        }
        const targetId = target.target.endpoint?.id ?? target.target.trunkDevice?.id
        return targetId === internalDragElementIdRef.current ? null : target
      },
      isBlockedDropPosition: (position) =>
        layoutTree ? positionHitsMultiplierBadge(layoutTree, position) : false,
    }
  )
  const dragPreview = validateEendraadPreview(currentProject, pendingDragPreview,
    createUiDropBehaviorHooks(window.document).getSitplanTarget(),
    dragRenderMode === 'duplicate' && internalDragPlacement ? {
      id: internalDragPlacement.elementId,
      kind: getEndpointById(internalDragPlacement.elementId) ? 'endpoint'
        : getProtectionById(internalDragPlacement.elementId) ? 'protection' : 'trunkDevice',
    } : undefined)
  const trunkBranchSlotMarkerRef = useRef<Konva.Circle | null>(null)

  // Keep an internally dragged symbol active independently from the currently
  // hovered target. Relocation may clear dragPreview while the pointer is
  // between wires, but the legal drop-zone hints should remain visible.
  const activePlacementSymbol =
    dragPreview?.symbolData ?? internalDragPlacement?.symbol ?? libraryDragSymbol
  const activePlacementSymbolId = activePlacementSymbol?.id
  const useBranchInteraction = !dragRenderElementId ||
    (dragRenderMode !== 'duplicate' && !!getEndpointById(dragRenderElementId) &&
      (dragRenderSelectionIds ?? [dragRenderElementId]).every((id) => !!getEndpointById(id)))
  const branchDropTargets = canPlaceSymbols && activePlacementSymbol && useBranchInteraction
    ? getBranchTargets(activePlacementSymbol).targets : null

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

  // A validated library protection on a drawn rail needs only the committed rail geometry.
  const liveProtectionBusPreview = !internalDragPlacement && dragPreview &&
    !dragPreview.movingProtection && !dragPreview.relocatingTrunkDevice &&
    !dragPreview.relocatingSupplyTrunkDevice && !dragPreview.movingEndpointSelection &&
    !dragPreview.movingPanelAttachment && !dragPreview.branchIntent && !dragPreview.sameSymbolAddMore
      ? resolveLiveProtectionBusPreview(dragPreview.symbolData?.id, dragPreview.dropTarget, dragPreview.position, wireSegments)
      : null

  // Layout + wires preview graph based on simulated drop
  const previewGraph = useEendraadPreviewGraph(
    liveProtectionBusPreview || dragPreview?.sameSymbolAddMore || dragPreview?.branchIntent ? null : dragPreview,
    layout
  )

  useEffect(() => {
    if (!import.meta.env.VITE_E2E) return
    const ownerWindow: (Window & {
      __eendraNestedPreviewDebug?: {
        dropTarget: DropTarget | null
        createdProtectionIds: string[]
        affectedPanelIds: string[]
        liveBusPreview: boolean
      }
    }) | null | undefined = containerRef.current?.ownerDocument.defaultView
    if (!ownerWindow) return
    ownerWindow.__eendraNestedPreviewDebug = {
      dropTarget: dragPreview?.dropTarget ?? null,
      createdProtectionIds: previewGraph?.createdProtectionIds ?? [],
      affectedPanelIds: previewGraph?.affectedPanelIds ?? [],
      liveBusPreview: liveProtectionBusPreview != null,
    }
  }, [dragPreview?.dropTarget, previewGraph, liveProtectionBusPreview, window])

  useEffect(() => {
    if (!import.meta.env.VITE_E2E || !layoutTree) return

    const showNestedProtectionPreview = (event: Event) => {
      const {
        circuitId,
        mainBusPanelId,
        mainBusFraction = 0.5,
        symbolId = 'mcb',
        secondaryBusInsertIndex,
        secondaryBusItemCount,
        targetRegion = 'tip-upper',
      } = (
        event as CustomEvent<{
          circuitId?: string
          mainBusPanelId?: string
          mainBusFraction?: number
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
      if (mainBusPanelId) {
        const panel = layout?.panels.find((item) => item.panel.id === mainBusPanelId && item.frameRole !== 'supply')
        const symbol = getSymbolById(symbolId)
        if (panel && symbol) handleDragOver({
          x: panel.mainBus.x + panel.mainBus.width * mainBusFraction,
          y: panel.mainBus.y,
        }, symbol)
        return
      }
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
  }, [handleDragOver, layout, layoutTree, setDragPreview, window])

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
  // A trunk reorder draws its own slot preview; the generic fallback would show an
  // append-at-the-top preview for the same circuit target.
  const showLegacyDragPreview =
    !!dragPreview &&
    !liveProtectionBusPreview &&
    !dragPreview.branchIntent &&
    !dragPreview.trunkBranchSlot &&
    !isSupplyDropTarget(dragPreview.dropTarget) &&
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

  const { handleGetSelectionBounds, getPeerSelectionBounds, handleFitToView } = useEendraadSelectionBounds({
    layoutTree,
    requestFitToView,
    viewportUI,
    wireSegments,
  })

  const {
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
  } = useEendraadInstallDateTool({
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
  })

  const fitTrigger = useCanvasUIStore((s) => s.fitToViewTrigger.eendraad)
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
    async (position: Point, symbolData: unknown, _meta?: CanvasDropMeta) => {
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

      const branchDrop = resolveBranchDrop(position, symbol, [])
      if (branchDrop.handled && !branchDrop.intent) return
      if (!branchDrop.handled && positionHitsMultiplierBadge(layoutTree, position)) return
      const directSameSymbolTarget = branchDrop.handled ? branchDrop.intent?.sameSymbolTarget : findSameSymbolAddMoreLayoutTargets(
        symbol.searchPreset ? '' : symbol.id,
        layoutTree,
        position
      )[0]

      const { target: rawTarget } = branchDrop.intent ? { target: branchDrop.intent.target } : findDropTargetWithDebug(
        layoutTree,
        position,
        symbol.id === 'earthing_separator'
          ? undefined
          : {
              preferMainBusOverGroundWire: true,
              preferMainBusOverSupplyWire: Boolean(symbol.busFeedKind) || isProtectionPlacement,
              preferSecondaryBusForNestedProtection: isProtectionPlacement,
              preferDomoticaEndpointOutput: symbol.id === 'panel_distribution',
              ...(symbol.id === 'dc_bus' ? { preferCircuitTrunkWire: true } : {}),
              ...(symbol.id === 'source_changeover'
                ? { normalizeDirectConverterChangeoverDrop: true }
                : {}),
            }
      )

      // A Domotica child's central hit zone means replace. If the incoming
      // symbol belongs to the same device family but has different settings,
      // refuse the drop instead of silently replacing the configured child.
      // A same-symbol add-more target takes precedence: it keeps the child.
      if (
        !directSameSymbolTarget &&
        rawTarget.domoticaChildDropIntent === 'replace' &&
        rawTarget.endpointId
      ) {
        let existingEndpoint: Endpoint | undefined
        const findEndpoint = (node: LayoutNode) => {
          if (node.type === 'endpoint' && node.domainId === rawTarget.endpointId) {
            existingEndpoint = node.domainRef as Endpoint | undefined
            return
          }
          for (const child of node.children) {
            findEndpoint(child)
            if (existingEndpoint) return
          }
        }
        layoutTree.panels.forEach(findEndpoint)
        if (existingEndpoint && isConflictingOnSymbolDrop(symbol.id, existingEndpoint, symbol.searchPreset)) {
          logger.info(`[drop-diag] Conflicting configured endpoint drop blocked for symbol=${symbol.id}`)
          return
        }
      }

      const sameSymbolEndpoint = directSameSymbolTarget?.target.endpoint
      const sameSymbolTrunkDevice = directSameSymbolTarget?.target.trunkDevice
      const sameSymbolTarget: SameSymbolAddMoreTarget | null = sameSymbolEndpoint
        ? { endpoint: sameSymbolEndpoint }
        : sameSymbolTrunkDevice
          ? { trunkDevice: sameSymbolTrunkDevice }
          : null
      const sameSymbolAddMoreResult = sameSymbolTarget
        ? incrementSameSymbolAddMoreTarget(symbol.id, sameSymbolTarget, {
            syncEndpointCount: (endpointId, count) =>
              syncEndpointMultiplierCount(createSyncEndpointMultiplierDeps(), endpointId, count),
            syncSupplyDeviceCount: (deviceId, count) =>
              syncSupplyDeviceMultiplierCount(
                createSyncSupplyInverterMultiplierDeps(),
                deviceId,
                count
              ),
          })
        : 'not-applicable'
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
      let dropTarget = normalizeBusFeedSupplyFrameDrop(rawTarget, symbol)
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
        const isSupplyFrameDrop = isSupplyDiagramId(dropTarget.diagramId)
        if (isSupplyFrameDrop) {
          const didEnableSplit = panel.busSections?.length
            ? true
            : !!(runProjectCommand('properties.edit', {
                edits: [],
                actions: [
                  {
                    kind: 'panelFeedOrganization',
                    panelId: panel.id,
                    organization: panelHasModularChangeover(currentProject, panel.id)
                      ? 'split-switchable'
                      : 'split-backup',
                  },
                ],
              }))?.changed
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
        const didPlaceFeedBoundary = !!(runProjectCommand('properties.edit', {
          edits: [],
          actions: [
            {
              kind: 'panelBusFeedBoundary',
              panelId: panel.id,
              feed: symbol.busFeedKind,
              mainBusInsertIndex: insertIndex,
            },
          ],
        }))?.changed
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

      logger.info(
        `[drop-diag] Executing drop: symbol=${symbol.id}, target=${JSON.stringify({ type: dropTarget.type, panelId: dropTarget.panelId, circuitId: dropTarget.circuitId, protectionId: dropTarget.protectionId })}`
      )
      // Apply shared drop rules and repairs in one undoable command.
      const placed = placeElectricalSymbol({
        ownerDocument: window.document,
        symbolId: symbol.id,
        searchPreset: symbol.searchPreset,
        target: dropTarget,
        dropCanvasPosition: position,
        label: 'drop symbol from library onto installation plan',
      })
      if (placed.status === 'rejected') {
        useDialogStore.getState().openDialog({
          type: 'info',
          title: t('wires.domainMismatchTitle', { defaultValue: 'Cannot connect here' }),
          message: placed.message,
          confirmLabel: t('common.ok', { defaultValue: 'OK' }),
          variant: 'warning',
        })
        return
      }
      if (placed.status === 'placed' && placed.changed) {
        trackSymbolPlace({
          canvas: 'eendraad',
          symbol,
          placementMethod: 'library_drop',
          targetType: normalizeElectricalDropTarget(symbol.id, dropTarget).type ?? 'empty',
        })
      }
    },
    [
      currentProject,
      t,
      layoutTree,
      setDragPreview,
      setSelection,
      wireSegments,
      getPanelById,
      resolveBranchDrop,
      window.document,
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
    setDragRenderElementId(null)
    setInternalDragPlacement(null)
    setDragPreview(null)
    trunkDnDLoggedStartRef.current = false
    elementDragModeRef.current = 'move'
    setDragRenderMode('move')
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
  const handleGroundDragEndRef = useRef<() => void | Promise<void>>(() => {})
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
    void handleGroundDragEndRef.current()
  }, [])

  const stableNoteDragEnd = useCallback((noteId: string, newPos: Point) => {
    handleNoteDragEndRef.current(noteId, newPos)
  }, [])

  const longPressDuplicateDrag = useEendraadElementDrag({
    altDuplicatePointerCleanupRef,
    augmentCircuitVerticalWireDomain,
    canDragItems,
    currentProject,
    dragPreview,
    draggingProtectionIdRef,
    elementDragModeRef,
    endAltDuplicatePointerDrag,
    endpointDragStartSelectionIdsRef,
    getEndpointById,
    getFloorById,
    getPanelById,
    getProtectionById,
    getTrunkDeviceById,
    handleDragOver,
    handleElementDragEndRef,
    handleElementDragMoveRef,
    handleElementDragStartRef,
    internalDragElementIdRef,
    layout,
    layoutTree,
    movingPanelAttachmentIdRef,
    pointerClientToCanvasPoint,
    resolveBranchDrop,
    resolveTrunkRelocateDropTarget,
    setAltDuplicatePointerDragActive,
    setDragPreview,
    setDragRenderElementId,
    setDragRenderMode,
    setDragRenderSelectionIds,
    setInternalDragPlacement,
    setSelection,
    suppressKonvaDragEndRef,
    t,
    trunkBranchSlotMarkerRef,
    trunkDnDLoggedStartRef,
    viewportUI,
    window,
    wireSegments,
  })

  // Handle ground symbol drag end
  const handleGroundDragEnd = useCallback(async () => {
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
          const outcome = runProjectCommand('panel.ensureEarthingStem', { panelId })
          if (!outcome) return
        } else if (!targetPanelLayout.isSubPanel) {
          editProperties({ installation: { hasGround: true } })
        }
        const activeFloorId = resolveSitplanTargetFloorId(
          currentProject,
          viewportUI.getState().activeFloorId
        )
        if (activeFloorId) {
          const uiSnap = viewportUI.getState()
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
  }, [dragPreview, layout, currentProject, currentInstallation, setDragPreview, viewportUI])
  useLayoutEffect(() => { handleGroundDragEndRef.current = handleGroundDragEnd }, [handleGroundDragEnd])

  const shouldSuppressKonvaDragEnd = useCallback(() => suppressKonvaDragEndRef.current, [])

  const handleNoteDragEnd = useCallback(
    (noteId: string, newPos: Point) => {
      if (!canDragItems) return
      updateNoteProperties(noteId, 'oneWire', { pos: newPos })
    },
    [canDragItems]
  )
  useLayoutEffect(() => { handleNoteDragEndRef.current = handleNoteDragEnd }, [handleNoteDragEnd])

  // Track panel IDs to detect when panels are added/removed
  const panelIds = useMemo(() => {
    return currentPanels.map((p: Panel) => p.id).join(',')
  }, [currentPanels])

  // Ensure all panels have placements on the plan
  useEffect(() => {
    // Depend on the panel ids only, not on currentProject (which changes on every store update).
    if (!useProjectStore.getState().currentProject) return
    runProjectCommand('plan.ensurePanelPlacements', {})
  }, [panelIds])

  // Sync panel selection to plan view
  useEffect(() => {
    const eendraadSelection = viewportUI.getState().selection
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
  }, [currentProject, viewportUI])

  const handleEendraadContextMenu = useEendraadContextMenu({
    canDeleteItems,
    canDragItems,
    canEditProject,
    currentInstallation,
    currentProject,
    eendraadDateMarkingMode,
    exitDateMarkingMode,
    getEjectPlanPlacement,
    isActiveViewport,
    layout,
    pointerOverEendraadRef,
    setAddElementDropPosition,
    setEendraadClipboard,
    setSelection,
    t,
    viewportUI,
    window,
    wireSegments,
    withJunctionEditorItem,
  })

  const handleAddElementSelect = useCallback(
    (symbol: import('@/lib/symbols').SymbolMetadata, position: Point) => {
      void handleDrop(position, symbol)
      setAddElementDropPosition(null)
    },
    [handleDrop]
  )

  // Blank canvas only accepts a few symbols (e.g. a new board); list only those there so
  // picking an element never silently does nothing.
  const canPlaceAddElementSymbol = useMemo(() => {
    if (!addElementDropPosition || !layoutTree) return undefined
    const { target } = findDropTargetWithDebug(layoutTree, addElementDropPosition)
    if (target.type !== null || target.panelId) return undefined
    return (symbol: import('@/lib/symbols').SymbolMetadata) => canDropSymbolOnEmptyCanvas(symbol.id)
  }, [addElementDropPosition, layoutTree])

  const [separatorTooltip, setSeparatorTooltip] = useState<{
    text: string
    clientX: number
    clientY: number
  } | null>(null)
  const describeEnclosureTransition = useCallback(
    (transition: { from: string; to: string }) => {
      const name = (key: string) =>
        currentProject
          ? describeEnclosureKey(currentProject, key, (k, fallback) => t(k, fallback))
          : key
      return t('canvas.enclosureTransition', '{{from}} → {{to}}', {
        from: name(transition.from),
        to: name(transition.to),
      })
    },
    [currentProject, t]
  )

  const supplySeparators = useMemo(() => {
    if (!layout) return []
    return layout.panels.flatMap((panelLayout) =>
      getSupplySeparatorsForDiagram(wireSegments, getPanelDiagramId(panelLayout))
    )
  }, [layout, wireSegments])

  const enableAutomaticNamingAndApply = useCallback(() => {
    editProperties({
      installation: { eendraadAutomaticNaming: true },
      refreshAutomaticNaming: true,
    })
  }, [])

  const handleEendraadAutomaticNamingChange = useCallback(
    (checked: boolean) => {
      if (!currentProject) return
      if (!checked) {
        editProperties({ installation: { eendraadAutomaticNaming: false } })
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
    [currentProject, enableAutomaticNamingAndApply, openDialog, t]
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
        runProjectCommand('eendraad.resetLabelOverrides', {})
      },
    })
  }, [
    currentProject,
    eendraadAutoNaming,
    hasCustomEendraadLabels,
    openDialog,
    t,
  ])

  const applyHideFeederPreferenceAndRenumber = useCallback(
    (hideFeederLetters: boolean) => {
      editProperties({
        installation: { eendraadAutoNamingHideFeederLetters: hideFeederLetters },
        refreshAutomaticNaming: true,
      })
    },
    []
  )

  const handleEendraadHideFeederLettersChange = useCallback(
    (checked: boolean) => {
      if (!currentProject) return
      if (!eendraadAutoNaming) {
        editProperties({ installation: { eendraadAutoNamingHideFeederLetters: checked } })
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
    ]
  )

  const { normalScene, canvasInteractionOverlay } = useEendraadSceneArtwork({
    activeDropTargetNodeId,
    activePlacementSymbol,
    advancedPanelLabels,
    altDuplicatePointerDragActive,
    beginInteractiveOverlayPan,
    branchDropTargets,
    canDragItems,
    canPlaceSymbols,
    canvasRef,
    changeoverGridSourcePreviewScene,
    currentProject,
    describeEnclosureTransition,
    dragPreview,
    eendraadNotes,
    eendraadView,
    getCanvasPositionFromEvent,
    getEndpointById,
    getFramesByPanel,
    getPanelById,
    getProtectionById,
    internalDragPlacement,
    layout,
    layoutTree,
    liveProtectionBusPreview,
    previewGraph,
    selection,
    setSeparatorTooltip,
    shouldSuppressKonvaDragEnd,
    showLegacyDragPreview,
    showSimulatedDragPreview,
    stableElementDragEnd,
    stableElementDragMove,
    stableElementDragStart,
    stableGroundDragEnd,
    stableNoteDragEnd,
    supplySeparators,
    t,
    trunkBranchSlotMarkerRef,
    viewportUI,
    wireSegments,
  })

  return (
    <EendraadWireSegmentsContext.Provider value={wireSegments}>
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
        {separatorTooltip && containerRef.current && (
          <div
            className="pointer-events-none absolute z-50"
            style={{
              left: separatorTooltip.clientX - containerRef.current.getBoundingClientRect().left,
              top: separatorTooltip.clientY - containerRef.current.getBoundingClientRect().top,
              transform: 'translate(12px, 12px)',
            }}
          >
            <div className="max-w-[240px] whitespace-pre-wrap rounded bg-black/85 px-2 py-1 text-xs text-white shadow-lg">
              {separatorTooltip.text}
            </div>
          </div>
        )}
        {canPlaceSymbols && addElementDropPosition && (
          <AddElementPicker
            dropPosition={addElementDropPosition}
            onSelect={handleAddElementSelect}
            onClose={() => setAddElementDropPosition(null)}
            canPlaceSymbol={canPlaceAddElementSymbol}
          />
        )}
        <BaseCanvas
          ref={canvasRef}
          gestureZoomCanvas="eendraad"
          minZoom={minZoom}
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
          /* @vision-scan-strip-start */
          onDocumentDrop={
            isElectricalVisionScanEnabled() && canEditProject
              ? (position, documentId) => {
                  placeDocumentOnOneWire(documentId, position)
                }
              : undefined
          }
          /* @vision-scan-strip-end */
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
            {/* @vision-scan-strip-start */}
            {isElectricalVisionScanEnabled() && (
              <OneWireReferencePages layout={layout} canDrag={canEditProject && canDragItems} />
            )}
            {/* @vision-scan-strip-end */}
            <ConverterResizeViewportContext.Provider value={resizeConverterWithViewportAnchor}>
              <MetadataCalloutDragContext.Provider value={canEditProject && canDragItems}>
                <CanvasPanOrClickProvider onBeginPan={beginInteractiveOverlayPan}>
                  {normalScene}
                </CanvasPanOrClickProvider>
              </MetadataCalloutDragContext.Provider>
            </ConverterResizeViewportContext.Provider>

            {currentProject ? (
              <InstallDateOverlay
                project={currentProject}
                layout={layout}
                wireSegments={wireSegments}
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
                    selectionKey: selectionTargets.map((target) => target.id).join('|'),
                  })
                }}
              />
            ) : null}

            {/* Debug: hit zone overlay (dev builds only, when enabled in settings) */}
            {import.meta.env.DEV && <TrunkLayoutDebugOverlay layout={layout} wireSegments={wireSegments} />}
            <EendraadRemoteSelections getSelectionBounds={getPeerSelectionBounds} zoom={eendraadView.zoom} />
            {}
          </Group>
        </BaseCanvas>

        {pendingDragPreview?.movingProtection && (
          <svg
            data-protection-drag-cursor
            aria-hidden="true"
            className="absolute pointer-events-none"
            viewBox="0 0 34 34"
            style={{
              left: 0,
              top: 0,
              width: 34 * eendraadView.zoom,
              height: 34 * eendraadView.zoom,
              transform: `translate3d(${eendraadView.pan.x + (pendingDragPreview.position.x - 17) * eendraadView.zoom}px, ${eendraadView.pan.y + (pendingDragPreview.position.y - 17) * eendraadView.zoom}px, 0)`,
            }}
          >
            <circle
              cx="17"
              cy="17"
              r="15"
              fill="#0284c7"
              stroke="#0284c7"
              strokeWidth="2"
              opacity="0.25"
            />
          </svg>
        )}

        {offscreenSupplyPreviewDirection ? (
          <OffscreenPreviewIndicator direction={offscreenSupplyPreviewDirection} />
        ) : null}

        <ViewNavigationToolbar
          zoom={eendraadView.zoom}
          minZoom={minZoom}
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
            <div className="flex flex-wrap items-center gap-2">
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
                    parsed == null ? selectedDateToolYear : clamp(parsed, 1900, currentInstallYear)
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
                    const nextYear = clamp(startYear + delta, 1900, currentInstallYear)
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
                className="min-w-[4rem] flex-1 touch-none cursor-ns-resize rounded-md border border-gray-300 bg-white px-2 py-1.5 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
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
              triggerTestId="eendraad-naming-menu"
              variant="menu"
              side="right"
              open={openEendraadMenu === 'naming'}
              onOpenChange={(next) => setOpenEendraadMenu(next ? 'naming' : null)}
            >
              <div className="rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg p-3 min-w-[260px] space-y-3 text-xs">
                <div
                  data-testid="eendraad-auto-label-setting"
                  className={`flex items-center gap-2 rounded-md p-1 text-gray-700 transition-all duration-1000 dark:text-gray-200 ${
                    namingGuidanceHighlighted
                      ? 'bg-sky-100 ring-2 ring-sky-500 dark:bg-sky-950/60'
                      : 'ring-2 ring-transparent'
                  }`}
                >
                  <DescribedCheckbox
                    label={t('canvas.eendraadNaming.automaticNaming')}
                    description={t('canvas.eendraadNaming.automaticNamingDescription')}
                    checked={eendraadAutoNaming}
                    onChange={(e) => handleEendraadAutomaticNamingChange(e.target.checked)}
                    className="flex min-w-0 flex-1 items-start gap-2"
                    inputClassName="mt-0.5 shrink-0 rounded border-gray-400"
                    labelClassName="font-medium block"
                    descriptionClassName="block text-[11px] leading-snug text-gray-500 dark:text-gray-400 mt-0.5"
                  />
                  <span
                    className="shrink-0"
                    title={t(
                      'canvas.eendraadNaming.resetAllTooltip',
                      'Remove every custom label and return all circuits to automatic naming.'
                    )}
                  >
                    <button
                      type="button"
                      aria-label={t('canvas.eendraadNaming.resetAllLabels', 'Reset all labels')}
                      disabled={!eendraadAutoNaming || !hasCustomEendraadLabels}
                      onClick={handleResetAllEendraadLabels}
                      className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </span>
                </div>
                <div className="space-y-1.5 text-gray-700 dark:text-gray-200">
                  <label htmlFor="eendraad-label-style" className="block font-medium">
                    {t('canvas.eendraadNaming.scheme.style', 'Style')}
                  </label>
                  <LabelStyleSelect
                    id="eendraad-label-style"
                    scheme={eendraadLabelScheme}
                    savedStyles={savedLabelStyles}
                    panelPartAvailable={advancedPanelLabels}
                    onChange={(scheme) =>
                      applyLabelScheme(
                        scheme,
                        advancedPanelLabels && labelSchemeUsesPanelPart(scheme) ? true : undefined
                      )
                    }
                  />
                  <button
                    type="button"
                    data-testid="eendraad-label-scheme-customize"
                    onClick={() => {
                      setOpenEendraadMenu(null)
                      openLabelSchemeDialog(t)
                    }}
                    className="text-[11px] font-medium text-sky-600 hover:underline dark:text-sky-400"
                  >
                    {t('canvas.eendraadNaming.scheme.customize', 'Customize…')}
                  </button>
                </div>
                <DescribedCheckbox
                  label={t('canvas.eendraadNaming.hideFeederLetters')}
                  description={t('canvas.eendraadNaming.hideFeederLettersDescription')}
                  checked={eendraadHideFeederLetters}
                  disabled={!eendraadAutoNaming}
                  onChange={(e) => handleEendraadHideFeederLettersChange(e.target.checked)}
                  className={`flex items-start gap-2 ${
                    eendraadAutoNaming
                      ? 'text-gray-700 dark:text-gray-200'
                      : 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
                  }`}
                  inputClassName="rounded border-gray-400 mt-0.5 disabled:opacity-50"
                  labelClassName="font-medium block"
                  descriptionClassName="block text-[11px] leading-snug text-gray-500 dark:text-gray-400 mt-0.5"
                />
                {canUseInstallDates ? (
                  <>
                    <div className="flex items-center gap-2 border-t border-gray-200 pt-3 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                      <span>{t('installDates.menuSection', 'Dates')}</span>
                    </div>
                    <DescribedCheckbox
                      label={t('installDates.showLabelsOutsideMode', 'Date labels')}
                      description={t('installDates.showLabelsOutsideModeDescription', 'Show outside date mode.')}
                      checked={eendraadDateMarkingVisibility.installDatesVisible}
                      onChange={(e) =>
                        setEendraadDateMarkingVisibility({
                          installDatesVisible: e.target.checked,
                        })
                      }
                      className="flex items-start gap-2 text-gray-700 dark:text-gray-200"
                      inputClassName="rounded border-gray-400 mt-0.5"
                      labelClassName="font-medium block"
                      descriptionClassName="block text-[11px] leading-snug text-gray-500 dark:text-gray-400 mt-0.5"
                    />
                    <DescribedCheckbox
                      label={t('installDates.forceMonochrome', 'Monochrome')}
                      description={t('installDates.forceMonochromeDescription', 'Use one neutral color.')}
                      checked={eendraadDateMarkingVisibility.installDatesMonochrome}
                      onChange={(e) =>
                        setEendraadDateMarkingVisibility({
                          installDatesMonochrome: e.target.checked,
                        })
                      }
                      className="flex items-start gap-2 text-gray-700 dark:text-gray-200"
                      inputClassName="rounded border-gray-400 mt-0.5"
                      labelClassName="font-medium block"
                      descriptionClassName="block text-[11px] leading-snug text-gray-500 dark:text-gray-400 mt-0.5"
                    />
                  </>
                ) : null}
              </div>
            </FloatingControl>
          ) : null}
        </CanvasFloatingControlRail>
      </div>
    </CanvasOverlayScaleProvider>
    </EendraadWireSegmentsContext.Provider>
  )
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
