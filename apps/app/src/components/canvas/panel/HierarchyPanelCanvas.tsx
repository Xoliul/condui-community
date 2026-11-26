import { INTERACTIVE_OVERLAY_EXPORT_NAME } from '@/lib/export/interactiveOverlayExport'
import { PanelFieldRails } from './PanelFieldRails'
import { snapPanelFrameResize } from '@/lib/panel/panelFrameResize'
import { useHierarchyModuleEditing } from './useHierarchyModuleEditing'
import { useHierarchySelectionActions } from './useHierarchySelectionActions'
import { useHierarchyRewire } from './useHierarchyRewire'
import { HIERARCHY_PANEL_FRAME_HIT_MARGIN, HIERARCHY_PANEL_FRAME_TITLE_HIT_HEIGHT } from './hierarchyPanelSceneQueries'
import { useHierarchyModuleDrag } from './useHierarchyModuleDrag'
import { useHierarchyLibraryDrop } from './useHierarchyLibraryDrop'
import {
  placementMatchesSelection,
  hierarchyRouteForHierarchySurface,
  buildPanelWirePathRegions,
  buildPanelWirePathLinks,
} from './hierarchyPanelSceneQueries'
import { ConverterBackupFeedMarker } from './ConverterBackupFeedMarker'
import type {
  Project,
  HierarchySurface,
  HierarchyDragPreview,
  PanelOption,
} from './hierarchyPanelCanvasModel'
export type { PanelOption } from './hierarchyPanelCanvasModel'
import { usePanelViewportRect } from './usePanelViewportRect'

import { usePointerPreview } from '@/hooks/usePointerPreview'
import { useCanvasWindow } from '@/components/viewport/ViewportContext'
import { useIsActiveViewport } from '@/components/viewport/ViewportUIStore'


import { getAuxiliaryEnclosureLabel } from '@/lib/panel/auxiliaryEnclosureLabel'
import { editProperties } from '@/handlers/properties/editProperties'
import {
  updatePanelGrid,
  updateJunctionPanelGrid,
  editPanelLayout,
} from '@/handlers/panel/editPanelLayout'



import {
  useRef,
  useCallback,
  useMemo,
  useState,
  useEffect,
  useLayoutEffect,
  type RefObject,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { flushSync } from 'react-dom'
import { Printer, Tag } from 'lucide-react'
import {
  Group,
  Rect,
  Line,
  Text,
  KonvaRenderer,
} from 'react-konva'
import type Konva from 'konva'
import { PanelRemoteSelections } from './PanelRemoteSelections'
import BaseCanvas, { type BaseCanvasHandle } from '../BaseCanvas'
import ViewNavigationToolbar from '../ViewNavigationToolbar'
import CanvasFloatingControlRail from '../CanvasFloatingControlRail'
import { FloatingControl } from '../FloatingControls'
import { openLabelStripExportDialog } from '@/lib/ui/labelStripExportDialog'

import { AutoArrangeIcon } from '@/components/icons/UiIcons'
import { SupplySymbol } from '../eendraad/SupplySymbol'
import { useUIStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useProjectStore } from '@/stores/projectStore'
import { useDialogStore } from '@/stores/dialogStore'
import { useThemeColors } from '@/lib/theme/hooks'
import { useCanvasFontFamily } from '@/editions/community/communityHooks'
import { useTouchPrimaryDevice } from '@/hooks/useTouchPrimaryDevice'
import { ZOOM_100 } from '@/constants/canvasConstants'
import { getPanelCanvasZoomMinimum } from '@/lib/panel/panelCanvasZoom'
import {
  panelGridModuleRefKey,
  CELL_W,
  CELL_H,
  ROW_GAP,
  ROW_STRIDE,
  TERMINAL_STRIP_RAIL_H,
  getTerminalStripTopOffset,
  type ModulePlacement,
} from '@/lib/panel/panelGridLayout'
import { getCachedModuleDisplayInfo } from '@/lib/panel/moduleDisplayInfoCache'
import { getCachedFullPanelScene } from '@/lib/panel/panelCanvasReadCache'
import { registerCanvasGroupMaterialization } from '@/lib/canvas/groupMaterialization'
import { PANEL_DETAIL_MIN_ZOOM, PanelSurfaceGroup } from './PanelSurfaceGroup'
import { tweenCanvasOpacity } from '@/lib/canvas/opacityTransition'
import ModuleBox, { type ModuleTooltipData } from './ModuleBox'
import { PanelLabelModeOverlay, type PanelLabelEntityUpdates } from './PanelLabelModeOverlay'
import { choosePanelLabelSurface } from '@/lib/panel/panelLabelEditingScope'
import type { PropertiesEditInput } from '@/lib/commands/project/commands/propertiesEdit'
import RelationWires from './RelationWires'

import { RewireTool } from './RewireTool'
import { RewirePreviewWire, PointerRewirePreviewWire } from './RewirePreviewWire'

import {
  getPanelSceneSurfaceGrid,
  buildDirectPanelFeederConnectors,
  PANEL_SCENE_FRAME_MARGIN,
  PANEL_SCENE_SHARED_SUPPLY_ID,
} from '@/lib/panel/panelScene'
import { applyPanelSceneFilter, type PanelSceneFilter } from '@/lib/panel/applyPanelSceneFilter'

import { toggleSelection } from '@/utils/selection'
import { selectProjectAuxiliaryElectricalEnclosures, getProjectElectricalPanels } from '@/lib/projectV2/electrical'




import type {
  PanelGridModuleRef,
  Panel,
  ProtectionDevice,
  Circuit,
} from '@/types/schema'
import type { ProjectState } from '@/stores/projectStore'
import type {
  CanvasDropMeta,
  Point,
  Selection as CanvasSelection,
} from '@/types/ui'
import type { ContextMenuItem } from '@/components/common/ContextMenu'

import { awaitPendingSymbolImages } from '@/lib/symbolImage'

import type { EditorCapabilities } from '@/lib/viewerMode'







import { resolvePanelWireSelectionFocus } from '@/lib/panel/panelWireSelection'





interface PanelFrameResizePreview {
  panelId: string
  axis: 'rows' | 'columns'
  value: number
  x: number
  y: number
  width: number
  height: number
}











const PANEL_FRAME_MARGIN = PANEL_SCENE_FRAME_MARGIN



const PANEL_RELATION_DEBUG_WIRE_LEGEND = [
  { label: 'Available pathways', color: '#06b6d4' },
  { label: 'Internal routing (WINT)', color: '#22c55e' },
  { label: 'Shared supply -> main protections (WSPM)', color: '#a855f7' },
  { label: 'Shared supply -> unique supply device (WSUD)', color: '#0ea5e9' },
  { label: 'Unique supply -> main protections (WUMP)', color: '#f97316' },
  { label: 'Panel bus feed -> protections (WPBP)', color: '#f43f5e' },
  { label: 'Main protection -> secondary panel feed (WSPF)', color: '#2563eb' },
] as const

const PANEL_RELATION_DEBUG_MODULE_LEGEND = [
  { label: 'Protection module (MPRO)', color: '#f43f5e' },
  { label: 'Secondary-panel feeder protection (MSPF)', color: '#2563eb' },
  { label: 'Shared supply trunk device (MSUP)', color: '#a855f7' },
  { label: 'Unique supply wire device (MUNQ)', color: '#f97316' },
  { label: 'Circuit trunk / bus feed device (MCIR)', color: '#06b6d4' },
  { label: 'Domotica module (MDOM)', color: '#8b5cf6' },
] as const

/** Parent-side protection that declares `subPanelId` for this secondary panel. */
function findProtectionFeedingSubPanel(
  project: Project,
  subPanelId: string
): { panel: Panel; protection: ProtectionDevice } | null {
  const scan = (panels: Panel[]): { panel: Panel; protection: ProtectionDevice } | null => {
    for (const pan of panels) {
      for (const pr of pan.protections ?? []) {
        if (pr.subPanelId === subPanelId) return { panel: pan, protection: pr }
      }
      const nested = scan(pan.subPanels ?? [])
      if (nested) return nested
    }
    return null
  }
  return scan(getProjectElectricalPanels(project))
}

function findCircuitFeedingSubPanel(pr: ProtectionDevice, subPanelId: string): Circuit | null {
  for (const c of pr.circuits ?? []) {
    if (c.endpoints?.some((e) => e.symbol === 'panel_distribution' && e.panelId === subPanelId))
      return c
  }
  return pr.circuits?.[0] ?? null
}
void findProtectionFeedingSubPanel
void findCircuitFeedingSubPanel



















export function HierarchyPanelCanvas({
  canvasRef,
  currentProject,
  panelOptions,
  panelSceneFilter,
  libraryInteraction,
  libraryCanvasExtras,
  assignToCircuitMode = false,
  onAssignTargetClick,
  feedSideDirection,
  panelZoom,
  panelPan,
  handleZoomChange,
  handlePanChange,
  handleFitToView,
  handleViewTransformCommit,
  onMultiFingerSwipe,
  containerRef,
  getPanelGridModules,
  panelRelationDebug,
  
  capabilities,
}: {
  canvasRef: RefObject<BaseCanvasHandle | null>
  currentProject: Project | null
  panelOptions: PanelOption[]
  panelSceneFilter: PanelSceneFilter
  libraryInteraction?: {
    onGetContextMenuItems?: (position: Point, elementId: string | null) => ContextMenuItem[]
    onDrop?: (position: Point, symbolData: unknown, meta?: CanvasDropMeta) => void
    onDragOver?: (position: Point, symbolData: unknown | null) => void
    onFindElementsInRectangle?: (rect: {
      x: number
      y: number
      width: number
      height: number
    }) => Array<{ id: string; type: string }>
    onGetSelectionBounds?: () => { x: number; y: number; width: number; height: number } | null
  }
  libraryCanvasExtras?: ReactNode
  assignToCircuitMode?: boolean
  onAssignTargetClick?: (ref: PanelGridModuleRef) => void
  feedSideDirection: 'left' | 'right'
  panelZoom: number
  panelPan: Point
  handleZoomChange: (zoom: number) => void
  handlePanChange: (pan: { x: number; y: number }) => void
  handleFitToView: () => void
  handleViewTransformCommit: (patch: { pan?: Point; zoom?: number }) => void
  onMultiFingerSwipe?: (
    direction: 'left' | 'right' | 'up' | 'down',
    fingerCount: number,
    startClientX: number
  ) => void
  containerRef: RefObject<HTMLDivElement | null>
  getPanelGridModules: ProjectState['getPanelGridModules']
  panelRelationDebug: boolean
  
  capabilities?: EditorCapabilities
}) {
  const window = useCanvasWindow()
  const isActiveViewport = useIsActiveViewport()
  const { t, i18n } = useTranslation()
  const displayLanguage = i18n.resolvedLanguage ?? i18n.language
  const connectorGroupRef = useRef<Konva.Group>(null)
  const contentGroupRef = useRef<Konva.Group>(null)
  const [materializeAllSurfaces, setMaterializeAllSurfaces] = useState(false)
  const materializationsRef = useRef(0)
  useLayoutEffect(() => {
    const group = contentGroupRef.current
    if (!group) return
    let active = true
    const unregister = registerCanvasGroupMaterialization(group, async () => {
      materializationsRef.current++
      let released = false
      const release = () => {
        if (released) return
        released = true
        materializationsRef.current--
        if (active && materializationsRef.current === 0) {
          flushSync(() => setMaterializeAllSurfaces(false))
          KonvaRenderer.flushSyncFromReconciler(() => {})
        }
      }
      try {
        flushSync(() => setMaterializeAllSurfaces(true))
        KonvaRenderer.flushSyncFromReconciler(() => {})
        KonvaRenderer.flushPassiveEffects()
        // Newly mounted SVG icons start asynchronous image loads in effects.
        // Wait for their real completion, then commit image state before cloning.
        await awaitPendingSymbolImages()
        KonvaRenderer.flushSyncFromReconciler(() => {})
        KonvaRenderer.flushPassiveEffects()
        return release
      } catch (error) {
        release()
        throw error
      }
    })
    return () => {
      active = false
      unregister()
    }
  }, [])
  const colors = useThemeColors()
  const fontFamily = useCanvasFontFamily()
  const touchPrimary = useTouchPrimaryDevice()
  const touchHandleHitStrokeWidth = touchPrimary ? 56 / Math.max(panelZoom, 0.1) : 'auto'
  const selection = useUIStore((s) => s.selection)
  const setSelection = useUIStore((s) => s.setSelection)
  const openDialog = useDialogStore((s) => s.openDialog)
  const canPlaceSymbols = capabilities?.canPlaceSymbols ?? true
  const canDragItems = capabilities?.canDragItems ?? true
  const canEditProject = capabilities?.canEditProject ?? true
  const canUseRewireTools = capabilities?.canUseRewireTools ?? true
  const leftDragPansCanvas = useSettingsStore((s) => s.leftDragPansCanvas)
  const updateAuxiliaryElectricalEnclosure = useCallback(
    (id: string, updates: { gridView: import('@/types/schema').PanelGridConfig }) => {
      const { slots, ...grid } = updates.gridView
      const { rows, columns, feedFromTop, terminalStripTopRail, terminalStripBottomRail } = grid
      editPanelLayout({
        enclosures: [
          {
            enclosureId: id,
            slots,
            grid: {
              rows,
              columns,
              feedFromTop,
              ...(terminalStripTopRail != null ? { terminalStripTopRail } : {}),
              ...(terminalStripBottomRail != null ? { terminalStripBottomRail } : {}),
            },
          },
        ],
      })
    },
    []
  )

  const getProtectionById = useProjectStore((s: ProjectState) => s.getProtectionById)
  const viewportRect = usePanelViewportRect(containerRef)
  const [tooltip, setTooltip] = useState<ModuleTooltipData | null>(null)
  void tooltip
  void setTooltip
  const [hoveredModuleRef, setHoveredModuleRef] = useState<PanelGridModuleRef | null>(null)
  void setHoveredModuleRef
  const [dragPreview, setDragPreview] = useState<HierarchyDragPreview | null>(null)
  const [moduleDragPreview, setModuleDragPreview] = useState<HierarchyDragPreview | null>(null)
  const [moduleDragLive, setModuleDragLive] = useState<HierarchyDragPreview | null>(null)
  const [panelFrameResizePreview, setPanelFrameResizePreview] =
    useState<PanelFrameResizePreview | null>(null)
  const panelFrameResizePreviewRef = useRef<PanelFrameResizePreview | null>(null)
  const hierarchyFeedFromTop = useMemo(
    () => panelOptions.find((option) => option.isRoot)?.panel.gridView?.feedFromTop ?? false,
    [panelOptions]
  )
  const [rewireMode, setRewireMode] = useState(false)
  const [rewireOriginRef, setRewireOriginRef] = useState<PanelGridModuleRef | null>(null)
  const [rewireOriginSurfaceId, setRewireOriginSurfaceId] = useState<string | null>(null)
  const { pointStore: rewirePointerStore, setPoint: setRewireDragPos } = usePointerPreview()
  const [rewireTargetRef, setRewireTargetRef] = useState<PanelGridModuleRef | null>(null)
  const [rewireTargetSurfaceId, setRewireTargetSurfaceId] = useState<string | null>(null)
  const [rewireTargetValid, setRewireTargetValid] = useState(true)
  const [labelMode, setLabelMode] = useState(false)
  const [labelSurfaceId, setLabelSurfaceId] = useState<string | null>(null)
  const prioritizeOverviewNavigation =
    panelZoom < PANEL_DETAIL_MIN_ZOOM && !labelMode && !rewireMode && !assignToCircuitMode
  const canDragOnCanvas = canDragItems && !prioritizeOverviewNavigation

  const updateModuleLabels = useCallback(
    (changes: Array<{ ref: PanelGridModuleRef; updates: PanelLabelEntityUpdates }>) => {
      // A focused editor may flush on unmount; never flush into a newly opened project.
      if (!currentProject ||
        useProjectStore.getState().currentProject?.project.id !== currentProject.project.id) return
      const edits: NonNullable<PropertiesEditInput['edits']> = []
      for (const { ref, updates } of changes) {
        if (ref.kind === 'protection') {
          const firstCircuitId = getProtectionById(ref.id)?.circuits?.[0]?.id
          const { notes, ...protectionUpdates } = updates
          if (firstCircuitId && notes !== undefined)
            edits.push({ kind: 'circuit', ids: [firstCircuitId], set: { notes } })
          if (Object.keys(protectionUpdates).length)
            edits.push({ kind: 'protection', ids: [ref.id], set: protectionUpdates })
        } else if (ref.kind === 'domotica') {
          edits.push({ kind: 'endpoint', ids: [ref.endpointId], set: updates })
        } else {
          edits.push({ kind: 'trunkDevice', ids: [ref.id], set: updates })
        }
      }
      if (edits.length) editProperties({ edits })
    },
    [currentProject, getProtectionById]
  )
  const updateModuleLabel = useCallback(
    (ref: PanelGridModuleRef, updates: PanelLabelEntityUpdates) =>
      updateModuleLabels([{ ref, updates }]),
    [updateModuleLabels]
  )

  const fullScene = useMemo(() => {
    if (!currentProject) return null
    const panelScenePanelOptions = panelOptions.map((o) => ({
      id: o.id,
      panel: o.panel,
      isRoot: o.isRoot,
    }))
    return getCachedFullPanelScene({
      project: currentProject,
      panelOptions: panelScenePanelOptions,
      getPanelGridModules,
      includeDescendants: true,
      hierarchyFeedFromTop,
      sharedSupplyLabel: t('panelCanvas.supplyPanel', 'Grid panel'),
    })
  }, [currentProject, panelOptions, getPanelGridModules, hierarchyFeedFromTop, t])

  const scene = useMemo(() => {
    if (!fullScene || !currentProject) return null
    return applyPanelSceneFilter(fullScene, panelSceneFilter, currentProject, hierarchyFeedFromTop)
  }, [fullScene, panelSceneFilter, currentProject, hierarchyFeedFromTop])
  const getLabelEditingView = useCallback(() => {
    const camera = canvasRef.current?.getLiveViewTransform() ?? { pan: panelPan, zoom: panelZoom }
    const stage = canvasRef.current?.getStage()
    return {
      ...camera,
      width: stage?.width() ?? containerRef.current?.clientWidth ?? window.innerWidth,
      height: stage?.height() ?? containerRef.current?.clientHeight ?? window.innerHeight,
    }
  }, [canvasRef, containerRef, panelPan, panelZoom, window])
  const labelScene = useMemo(() => {
    if (!scene) return null
    return { surfaces: scene.surfaces.filter((surface) => surface.id === labelSurfaceId) }
  }, [scene, labelSurfaceId])
  const activeLabelSurfaceId = labelMode ? labelScene?.surfaces[0]?.id : undefined
  useEffect(() => {
    if (!labelMode || !scene) return
    // BaseCanvas applies store-driven camera changes in its own effect. Read the
    // live view after that commit, rather than caching the previous camera during render.
    const next = choosePanelLabelSurface(scene.surfaces, getLabelEditingView(), labelSurfaceId)
    if (next?.id !== labelSurfaceId) setLabelSurfaceId(next?.id ?? null)
  }, [scene, labelMode, labelSurfaceId, getLabelEditingView])
  const directPanelFeederConnectors = useMemo(
    () =>
      scene && currentProject
        ? buildDirectPanelFeederConnectors(scene.surfaces, currentProject, scene.connectors)
        : [],
    [currentProject, scene]
  )
  const panelWirePathRegions = useMemo(
    () => buildPanelWirePathRegions(scene?.surfaces ?? []),
    [scene]
  )
  const panelRelationConnectors = useMemo(
    () => [...(scene?.connectors ?? []), ...directPanelFeederConnectors],
    [directPanelFeederConnectors, scene]
  )
  const panelWirePathLinks = useMemo(
    () => buildPanelWirePathLinks([...(scene?.connectors ?? []), ...directPanelFeederConnectors]),
    [directPanelFeederConnectors, scene]
  )
  const relationScene = useMemo(() => {
    const panelSurfaces = scene?.surfaces.filter(
      (surface): surface is HierarchySurface & { panel: Panel } =>
        surface.kind === 'panel' && surface.panel != null
    )
    if (!panelSurfaces?.length || !scene) return null
    const sharedSurface = scene.surfaces.find((surface) => surface.kind === 'shared_supply')
    const auxiliarySurfaces = scene.surfaces.filter(
      (surface) => surface.kind === 'auxiliary' || surface.kind === 'junction_panel'
    )
    const placements = [
      ...(sharedSurface ? [sharedSurface] : []), ...auxiliarySurfaces, ...panelSurfaces,
    ].flatMap((surface) => surface.placements.map((placement) => ({
      ...placement, x: placement.x + surface.x, y: placement.y + surface.y,
    })))
    const supplyPanelRefKeys = new Set(
      [...panelSurfaces, ...auxiliarySurfaces].flatMap((surface) => surface.placements
        .filter((placement) => placement.inSupplyPanel === true)
        .map((placement) => panelGridModuleRefKey(placement.ref)))
    )
    const primarySurface = panelSurfaces.find((surface) => surface.panel.isMain) ?? panelSurfaces[0]!
    const routesByPanelId = new Map(panelSurfaces.map((surface) => [surface.panel.id,
      hierarchyRouteForHierarchySurface(surface, sharedSurface, feedSideDirection, PANEL_FRAME_MARGIN),
    ]))
    return {
      placements, supplyPanelRefKeys, panel: primarySurface.panel,
      hierarchyRoute: routesByPanelId.get(primarySurface.panel.id)!,
      getHierarchyRoute: (panel: Panel) => routesByPanelId.get(panel.id) ?? null,
    }
  }, [scene, feedSideDirection])
  // Wires track the moving module. RelationWires adjusts only terminal leads
  // during the gesture and computes final corridor routes after the drop.
  const dragRef = moduleDragLive?.ref, dragX = moduleDragLive?.x, dragY = moduleDragLive?.y
  const moduleDragWireOverride = useMemo(() => dragRef && dragX != null && dragY != null ? {
    ref: dragRef, x: dragX, y: dragY,
  } : null, [dragRef, dragX, dragY])

  const selectedPanelIds = useMemo(
    () => (selection.type === 'panel' ? selection.ids : []),
    [selection]
  )
  const selectedSupplyPanelIds = useMemo(
    () => (selection.type === 'supplyPanel' ? selection.ids : []),
    [selection]
  )
  const selectedAuxiliaryEnclosureIds = useMemo(
    () => (selection.type === 'auxiliaryEnclosure' ? selection.ids : []),
    [selection]
  )
  const selectedPanels = useMemo(
    () =>
      selectedPanelIds
        .map((panelId) => panelOptions.find((panelOption) => panelOption.id === panelId)?.panel)
        .filter((panel): panel is Panel => panel != null),
    [panelOptions, selectedPanelIds]
  )
  const hierarchyPanelsFromSelection = useMemo(() => {
    if (!scene || selection.ids.length === 0) return [] as Panel[]
    const selectedIds = new Set(selection.ids)
    const byPanelId = new Map<string, Panel>()
    for (const panelOption of panelOptions) {
      if (selectedIds.has(panelOption.panel.id))
        byPanelId.set(panelOption.panel.id, panelOption.panel)
    }
    for (const surface of scene.surfaces) {
      if (surface.kind !== 'panel' || !surface.panel) continue
      const hasSelectedModule = surface.placements.some((placement) => {
        if (placement.ref.kind === 'protection') return selectedIds.has(placement.ref.id)
        if (placement.ref.kind === 'trunkDevice') return selectedIds.has(placement.ref.id)
        if (placement.ref.kind === 'domotica') return selectedIds.has(placement.ref.endpointId)
        return false
      })
      if (hasSelectedModule) byPanelId.set(surface.panel.id, surface.panel)
    }
    return [...byPanelId.values()]
  }, [panelOptions, scene, selection.ids])
  const panelDepthById = useMemo(() => {
    const out = new Map<string, number>()
    const walk = (panels: Panel[], depth: number) => {
      for (const candidate of panels) {
        out.set(candidate.id, depth)
        walk(candidate.subPanels ?? [], depth + 1)
      }
    }
    if (currentProject) walk(getProjectElectricalPanels(currentProject) ?? [], 0)
    return out
  }, [currentProject])

  const { getSurfaceRewireId, resetHierarchyRewireState, handleHierarchyRewireDragStart, handleHierarchyRewireDragMove, handleHierarchyRewireDragEnd, hierarchyRewirePreviewWire } = useHierarchyRewire({
    containerRef,
    currentProject,
    isActiveViewport,
    labelMode,
    panelOptions,
    panelPan,
    panelZoom,
    rewireMode,
    rewireOriginRef,
    rewireOriginSurfaceId,
    rewireTargetRef,
    rewireTargetSurfaceId,
    rewireTargetValid,
    scene,
    setLabelMode,
    setRewireDragPos,
    setRewireMode,
    setRewireOriginRef,
    setRewireOriginSurfaceId,
    setRewireTargetRef,
    setRewireTargetSurfaceId,
    setRewireTargetValid,
    window,
  })

  const { handleHierarchyAutoArrange, handleHierarchyPanelSelect, shouldIgnorePanelFrameClick, startPanelFrameSelectionRect, handleGetHierarchySelectionBounds, onFindHierarchyElementsInRectangle, createHierarchySelectionResolver } = useHierarchySelectionActions({
    canvasRef,
    currentProject,
    feedSideDirection,
    hierarchyPanelsFromSelection,
    leftDragPansCanvas,
    openDialog,
    panelDepthById,
    prioritizeOverviewNavigation,
    scene,
    selectedAuxiliaryEnclosureIds,
    selectedPanelIds,
    selectedPanels,
    selection,
    setSelection,
    t,
  })

  const { detectHierarchyModuleDropTarget, handleHierarchyDragOver, handleHierarchyDrop } = useHierarchyLibraryDrop({
    currentProject,
    panelOptions,
    scene,
    setDragPreview,
  })

  const selectedRef = useMemo((): PanelGridModuleRef | null => {
    if (!scene || !selection.type || selection.ids.length === 0) return null
    const id = selection.ids[0]
    if (!id) return null
    for (const surface of scene.surfaces) {
      const match = surface.placements.find((placement) => {
        if (selection.type === 'protection') {
          return placement.ref.kind === 'protection' && placement.ref.id === id
        }
        if (selection.type === 'trunkDevice') {
          return (
            (placement.ref.kind === 'trunkDevice' && placement.ref.id === id) ||
            placement.terminalStripMemberRefs?.some(
              (ref) => ref.kind === 'trunkDevice' && ref.id === id
            ) === true
          )
        }
        if (selection.type === 'endpoint') {
          return placement.ref.kind === 'domotica' && placement.ref.endpointId === id
        }
        if (selection.type === 'junctionPanelTerminal') {
          return placement.junctionPanelTerminal?.terminalId === id
        }
        return false
      })
      if (match) return match.ref
    }
    return null
  }, [scene, selection])
  const panelWireSelectionFocus = useMemo(() => {
    if (!scene || !currentProject) return null
    return resolvePanelWireSelectionFocus(
      selection,
      scene.surfaces.flatMap((surface) => surface.placements)
    )
  }, [currentProject, scene, selection])

  const previewPanelFrameResize = useCallback(
    (surface: HierarchySurface & { panel: Panel }, axis: 'rows' | 'columns', delta: number) => {
      // Every field changes together, so the width snaps to steps of one column per field.
      const snap = snapPanelFrameResize(surface.panel.gridView, axis, delta, {
        rows: surface.rows,
        columns: surface.cols,
      })
      const nextRows = snap.rows
      const nextColumns = snap.columns
      const nextWidth = snap.contentWidth + PANEL_FRAME_MARGIN * 2
      const mainContentHeight = nextRows * CELL_H + Math.max(0, nextRows - 1) * ROW_GAP
      const nextHeight =
        getTerminalStripTopOffset(getPanelSceneSurfaceGrid(surface)) +
        mainContentHeight +
        (surface.panel.gridView?.terminalStripBottomRail ? TERMINAL_STRIP_RAIL_H + ROW_GAP : 0) +
        PANEL_FRAME_MARGIN * 2
      const preview: PanelFrameResizePreview = {
        panelId: surface.panel.id,
        axis,
        value: axis === 'rows' ? nextRows : nextColumns,
        x: 0,
        y:
          axis === 'rows'
            ? surface.mainPanelY + surface.panelFrameHeight - nextHeight
            : surface.mainPanelY,
        width: axis === 'columns' ? nextWidth : surface.width,
        height: axis === 'rows' ? nextHeight : surface.panelFrameHeight,
      }
      panelFrameResizePreviewRef.current = preview
      setPanelFrameResizePreview(preview)
    },
    []
  )

  const commitPanelFrameResize = useCallback((surface: HierarchySurface & { panel: Panel }) => {
    const preview = panelFrameResizePreviewRef.current
    panelFrameResizePreviewRef.current = null
    setPanelFrameResizePreview(null)
    if (!preview || preview.panelId !== surface.panel.id) return
    updatePanelGrid(surface.panel.id, {
      [preview.axis]: preview.value,
    })
  }, [])

  const previewJunctionPanelFrameResize = useCallback(
    (surface: HierarchySurface, axis: 'rows' | 'columns', delta: number) => {
      const gridView = surface.junctionPanelGridView ?? surface.enclosure?.gridView
      if (!gridView) return
      const rows = gridView.rows ?? surface.rows
      const columns = gridView.columns ?? surface.cols
      const nextRows = axis === 'rows' ? Math.max(1, rows + Math.round(delta / ROW_STRIDE)) : rows
      const nextColumns =
        axis === 'columns' ? Math.max(1, Math.round(columns + delta / CELL_W)) : columns
      const layoutPanel = { gridView } as Panel
      const mainContentHeight = nextRows * CELL_H + Math.max(0, nextRows - 1) * ROW_GAP
      const nextHeight =
        getTerminalStripTopOffset(layoutPanel) +
        mainContentHeight +
        (gridView.terminalStripBottomRail ? TERMINAL_STRIP_RAIL_H + ROW_GAP : 0) +
        PANEL_FRAME_MARGIN * 2
      const preview: PanelFrameResizePreview = {
        panelId: surface.id,
        axis,
        value: axis === 'rows' ? nextRows : nextColumns,
        x: 0,
        y: axis === 'rows' ? surface.height - nextHeight : 0,
        width: axis === 'columns' ? nextColumns * CELL_W + PANEL_FRAME_MARGIN * 2 : surface.width,
        height: axis === 'rows' ? nextHeight : surface.height,
      }
      panelFrameResizePreviewRef.current = preview
      setPanelFrameResizePreview(preview)
    },
    []
  )

  const commitJunctionPanelFrameResize = useCallback(
    (surface: HierarchySurface) => {
      const preview = panelFrameResizePreviewRef.current
      panelFrameResizePreviewRef.current = null
      setPanelFrameResizePreview(null)
      if (!preview || preview.panelId !== surface.id) return
      if (surface.kind === 'auxiliary' && surface.enclosure) {
        updateAuxiliaryElectricalEnclosure(surface.id, {
          gridView: { ...surface.enclosure.gridView, [preview.axis]: preview.value },
        })
        return
      }
      const representative = surface.placements.find(
        (placement) => placement.ref.kind === 'trunkDevice'
      )
      if (representative?.ref.kind !== 'trunkDevice') return
      updateJunctionPanelGrid(representative.ref.id, { [preview.axis]: preview.value })
    },
    [updateAuxiliaryElectricalEnclosure]
  )

  const scenePlacementIndex = useMemo(() => {
    const index = new Map<string, ModulePlacement>()
    for (const surface of scene?.surfaces ?? []) {
      for (const placement of surface.placements) {
        for (const ref of [placement.ref, ...(placement.terminalStripMemberRefs ?? [])]) {
          const key = panelGridModuleRefKey(ref)
          if (!index.has(key)) index.set(key, placement)
        }
      }
    }
    return index
  }, [scene])
  const selectedModuleIds = useMemo(() => new Set(selection.ids), [selection.ids])
  const isHierarchyRefInSelection = useCallback(
    (ref: PanelGridModuleRef) => {
      if (selection.ids.length === 0) return false
      // Keep hierarchy drag-select behavior aligned with BaseCanvas drag-rect:
      // mixed-type selections may carry IDs from multiple kinds under one selection.type.
      if (ref.kind === 'protection') return selectedModuleIds.has(ref.id)
      if (ref.kind === 'trunkDevice') {
        const placement = scenePlacementIndex.get(panelGridModuleRefKey(ref))
        return (
          selectedModuleIds.has(ref.id) ||
          placement?.terminalStripMemberRefs?.some(
            (member) => member.kind === 'trunkDevice' && selectedModuleIds.has(member.id)
          ) === true
        )
      }
      if (ref.kind === 'domotica') return selectedModuleIds.has(ref.endpointId)
      return false
    },
    [scenePlacementIndex, selectedModuleIds, selection.ids.length]
  )

  const { handleHierarchyModuleDragMove, handleHierarchyModuleDragEnd } = useHierarchyModuleDrag({
    currentProject,
    detectHierarchyModuleDropTarget,
    hierarchyFeedFromTop,
    isHierarchyRefInSelection,
    moduleDragPreview,
    panelOptions,
    scene,
    selection,
    setModuleDragLive,
    setModuleDragPreview,
    setSelection,
  })

  const { handleHierarchyModuleAltDuplicate, handleHierarchyModuleResize, getHierarchyMaxWidth, isHierarchyResizeWidthValid } = useHierarchyModuleEditing({
    currentProject,
    moduleDragPreview,
    setModuleDragLive,
    setModuleDragPreview,
    setSelection,
    updateAuxiliaryElectricalEnclosure,
  })

  const selectedSharedFeederKey = useMemo(() => {
    if (!scene || !selectedRef) return null
    const sharedSurface = scene.surfaces.find((surface) => surface.kind === 'shared_supply')
    const lastPlacement = sharedSurface?.placements[sharedSurface.placements.length - 1]
    if (!lastPlacement) return null
    return panelGridModuleRefKey(lastPlacement.ref) === panelGridModuleRefKey(selectedRef)
      ? panelGridModuleRefKey(lastPlacement.ref)
      : null
  }, [scene, selectedRef])

  useEffect(() => {
    const node = connectorGroupRef.current
    if (!node) return
    return tweenCanvasOpacity(node, selectedSharedFeederKey ? 0.18 : 1, 0.18)
  }, [selectedSharedFeederKey])

  const renderSurfaceOverview = (surface: HierarchySurface) => (
    <Group name="panel-surface-overview">
      <Rect
        y={surface.mainPanelY}
        width={surface.width}
        height={surface.panelFrameHeight}
        fill={colors.panelFrameFill}
        stroke={colors.panelFrameStroke}
        strokeWidth={3}
        cornerRadius={4}
        name={`panel-${surface.panel?.id ?? surface.id}`}
        onMouseDown={startPanelFrameSelectionRect}
        onClick={(event) => {
          event.cancelBubble = true
          if (shouldIgnorePanelFrameClick(event.evt) || !surface.panel) return
          handleHierarchyPanelSelect(surface.panel.id, event.evt)
        }}
        onTap={(event) => {
          event.cancelBubble = true
          if (surface.panel) handleHierarchyPanelSelect(surface.panel.id, event.evt)
        }}
      />
      <Text
        x={8}
        y={surface.mainPanelY + 8}
        text={surface.label}
        fontFamily={fontFamily}
        fontSize={14}
        fontStyle="bold"
        fill={colors.panelFrameStroke}
        listening={false}
      />
      {surface.supplyPanelVisible && (
        <Rect
          y={surface.supplyPanelY}
          width={surface.width}
          height={surface.supplyFrameHeight}
          fill={colors.panelFrameFill}
          stroke={colors.panelSupplyStroke}
          strokeWidth={3}
          cornerRadius={4}
          listening={false}
        />
      )}
      {surface.placements.map((placement) => {
        const click = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
          if ('button' in event.evt && event.evt.button !== 0) return
          event.cancelBubble = true
          if ('button' in event.evt && shouldIgnorePanelFrameClick(event.evt)) return
          const ref = placement.ref
          const next: CanvasSelection =
            ref.kind === 'domotica'
              ? { type: 'endpoint', ids: [ref.endpointId] }
              : { type: ref.kind, ids: [ref.id] }
          const id = next.ids[0]!
          const shift = event.evt.shiftKey === true
          const ctrl = event.evt.ctrlKey === true || event.evt.metaKey === true
          const isModuleSelection =
            selection.type === 'protection' ||
            selection.type === 'trunkDevice' ||
            selection.type === 'endpoint'
          const candidate =
            shift && isModuleSelection
              ? { ...next, ids: [...new Set([...selection.ids, id])] }
              : ctrl && isModuleSelection
                ? toggleSelection({ ...selection, type: next.type }, id)
                : next
          const resolved = createHierarchySelectionResolver(surface, placement)(candidate, {
            currentSelection: selection,
            event: { shiftKey: shift, ctrlKey: ctrl, metaKey: event.evt.metaKey === true },
          })
          if (resolved) setSelection(resolved)
        }
        return (
          <Rect
            key={panelGridModuleRefKey(placement.ref)}
            name={`panelModule-${panelGridModuleRefKey(placement.ref)}`}
            x={placement.x}
            y={placement.y}
            width={placement.width}
            height={placement.height}
            fill={colors.moduleBg}
            stroke={colors.moduleBorder}
            strokeWidth={1}
            perfectDrawEnabled={false}
            onMouseDown={startPanelFrameSelectionRect}
            onClick={click}
            onTap={click}
          />
        )
      })}
    </Group>
  )

  return (
    <>
      <BaseCanvas
        ref={canvasRef}
        minZoom={getPanelCanvasZoomMinimum(currentProject)}
        gestureZoomCanvas="panel"
        prioritizeNavigation={prioritizeOverviewNavigation}
        zoom={panelZoom}
        pan={panelPan}
        onZoomChange={handleZoomChange}
        onPanChange={handlePanChange}
        onViewTransformCommit={handleViewTransformCommit}
        onFindElementsInRectangle={
          libraryInteraction?.onFindElementsInRectangle ?? onFindHierarchyElementsInRectangle
        }
        onGetSelectionBounds={
          libraryInteraction?.onGetSelectionBounds ?? handleGetHierarchySelectionBounds
        }
        onGetContextMenuItems={libraryInteraction?.onGetContextMenuItems}
        longPressDragSelectFromContent
        selectionFitMaxZoom={ZOOM_100}
        showGrid={false}
        gridSize={24}
        onDragOver={
          canPlaceSymbols ? (libraryInteraction?.onDragOver ?? handleHierarchyDragOver) : undefined
        }
        onDrop={canPlaceSymbols ? (libraryInteraction?.onDrop ?? handleHierarchyDrop) : undefined}
        onMultiFingerSwipe={onMultiFingerSwipe}
        
      >
        <Group ref={contentGroupRef} name="canvas-content">
          {scene && (
            <Group ref={connectorGroupRef} opacity={1}>
              {scene.connectors.map((connector, index) => (
                <Line
                  key={`hierarchy-connector-${index}`}
                  points={connector.points}
                  stroke={colors.supplyWire}
                  strokeWidth={1.5}
                  dash={[8, 4]}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
              ))}
            </Group>
          )}

          {scene?.surfaces.map((surface) => (
            <PanelSurfaceGroup
              key={surface.id}
              surface={surface}
              forceMounted={materializeAllSurfaces}
              onActivateLabels={
                labelMode &&
                surface.id !== activeLabelSurfaceId &&
                surface.placements.some((placement) => placement.terminalStripRail == null)
                  ? () => setLabelSurfaceId(surface.id)
                  : undefined
              }
              forceDetails={
                surface.id === activeLabelSurfaceId ||
                rewireMode ||
                assignToCircuitMode ||
                selectedPanelIds.includes(surface.panel?.id ?? '') ||
                selectedSupplyPanelIds.includes(surface.panel?.id ?? '') ||
                surface.placements.some((placement) =>
                  placementMatchesSelection(placement, selection)
                ) ||
                moduleDragLive?.surfaceId === (surface.panel?.id ?? surface.id) ||
                moduleDragPreview?.surfaceId === (surface.panel?.id ?? surface.id) ||
                dragPreview?.surfaceId === surface.id
              }
              overview={
                (fullScene?.moduleRefs.size ?? 0) > 500 &&
                surface.kind === 'panel' &&
                !panelRelationDebug
                  ? () => renderSurfaceOverview(surface)
                  : undefined
              }
              initialView={{
                pan: panelPan,
                zoom: panelZoom,
                width: viewportRect.width,
                height: viewportRect.height,
              }}
            >
              {() => (
                <>
                  {surface.kind === 'shared_supply' ? (
                    <Group>
                      <Rect
                        x={0}
                        y={0}
                        width={surface.width}
                        height={surface.height}
                        stroke={
                          selectedSupplyPanelIds.includes(PANEL_SCENE_SHARED_SUPPLY_ID)
                            ? colors.moduleBorderSelected
                            : colors.panelSupplyStroke
                        }
                        strokeWidth={3}
                        fill={colors.panelFrameFill}
                        cornerRadius={4}
                        listening={!labelMode}
                        name={`supplyPanel-${PANEL_SCENE_SHARED_SUPPLY_ID}`}
                        onMouseDown={startPanelFrameSelectionRect}
                        onClick={(event) => {
                          event.cancelBubble = true
                          if (shouldIgnorePanelFrameClick(event.evt)) return
                          setSelection({ type: 'supplyPanel', ids: [PANEL_SCENE_SHARED_SUPPLY_ID] })
                        }}
                        onTap={(event) => {
                          event.cancelBubble = true
                          setSelection({ type: 'supplyPanel', ids: [PANEL_SCENE_SHARED_SUPPLY_ID] })
                        }}
                      />
                      <Text
                        x={8}
                        y={8}
                        text={t('panelCanvas.supplyPanel', 'Grid panel')}
                        fontSize={14}
                        fontStyle="bold"
                        fontFamily={fontFamily}
                        fill={colors.panelFrameStroke}
                        listening={false}
                      />
                      <Rect
                        x={PANEL_FRAME_MARGIN}
                        y={PANEL_FRAME_MARGIN}
                        width={surface.contentWidth}
                        height={CELL_H}
                        fillEnabled={false}
                        stroke={colors.panelFrameStroke}
                        opacity={0.18}
                        strokeWidth={1}
                        listening={false}
                      />
                      {Array.from({ length: surface.cols + 1 }).map((_, colIndex) => (
                        <Line
                          key={`shared-col-${colIndex}`}
                          points={[
                            PANEL_FRAME_MARGIN + colIndex * CELL_W,
                            PANEL_FRAME_MARGIN,
                            PANEL_FRAME_MARGIN + colIndex * CELL_W,
                            PANEL_FRAME_MARGIN + CELL_H,
                          ]}
                          stroke={colors.panelFrameStroke}
                          opacity={0.08}
                          strokeWidth={0.75}
                          listening={false}
                        />
                      ))}
                      {(() => {
                        const firstPlacement = surface.placements[0]
                        const symbolX = firstPlacement
                          ? firstPlacement.x + firstPlacement.width / 2
                          : PANEL_FRAME_MARGIN + surface.contentWidth / 2
                        const symbolY = surface.feedFromTop ? -20 : surface.height + 20
                        const wireStartY = surface.feedFromTop
                          ? PANEL_FRAME_MARGIN
                          : PANEL_FRAME_MARGIN + CELL_H
                        return (
                          <>
                            <Line
                              points={[symbolX, wireStartY, symbolX, symbolY]}
                              stroke={colors.supplyWire}
                              strokeWidth={1.5}
                              dash={[8, 4]}
                              lineCap="round"
                              lineJoin="round"
                              listening={false}
                            />
                            <SupplySymbol x={symbolX} y={symbolY} />
                          </>
                        )
                      })()}
                    </Group>
                  ) : surface.kind === 'auxiliary' || surface.kind === 'junction_panel' ? (
                    <>
                      <Rect
                        x={0}
                        y={0}
                        width={surface.width}
                        height={surface.height}
                        stroke={
                          (surface.kind === 'auxiliary' &&
                            selectedAuxiliaryEnclosureIds.includes(surface.id)) ||
                          (surface.kind === 'junction_panel' &&
                            surface.placements.some(
                              (placement) =>
                                placement.junctionPanelTerminal != null &&
                                placement.ref.kind === 'trunkDevice' &&
                                selection.type === 'trunkDevice' &&
                                selection.ids.includes(placement.ref.id)
                            ))
                            ? colors.moduleBorderSelected
                            : colors.panelSupplyStroke
                        }
                        strokeWidth={
                          (surface.kind === 'auxiliary' &&
                            selectedAuxiliaryEnclosureIds.includes(surface.id)) ||
                          (surface.kind === 'junction_panel' &&
                            surface.placements.some(
                              (placement) =>
                                placement.junctionPanelTerminal != null &&
                                placement.ref.kind === 'trunkDevice' &&
                                selection.type === 'trunkDevice' &&
                                selection.ids.includes(placement.ref.id)
                            ))
                            ? 3
                            : 2
                        }
                        fill={colors.panelFrameFill}
                        cornerRadius={4}
                        listening={!labelMode}
                        name={
                          surface.kind === 'auxiliary'
                            ? `auxiliaryEnclosure-${surface.id}`
                            : undefined
                        }
                        onMouseDown={
                          surface.kind === 'auxiliary' ? startPanelFrameSelectionRect : undefined
                        }
                        onClick={
                          surface.kind === 'auxiliary'
                            ? (event) => {
                                if (shouldIgnorePanelFrameClick(event.evt)) {
                                  event.cancelBubble = true
                                  return
                                }
                                event.cancelBubble = true
                                setSelection({ type: 'auxiliaryEnclosure', ids: [surface.id] })
                              }
                            : surface.kind === 'junction_panel'
                              ? (event) => {
                                  event.cancelBubble = true
                                  setSelection({
                                    type: 'trunkDevice',
                                    // The junction panel itself, not the modules hanging in it.
                                    ids: surface.placements.flatMap((placement) =>
                                      placement.junctionPanelTerminal &&
                                      placement.ref.kind === 'trunkDevice'
                                        ? [placement.ref.id]
                                        : []
                                    ),
                                  })
                                }
                              : undefined
                        }
                        onTap={
                          surface.kind === 'auxiliary'
                            ? (event) => {
                                event.cancelBubble = true
                                setSelection({ type: 'auxiliaryEnclosure', ids: [surface.id] })
                              }
                            : surface.kind === 'junction_panel'
                              ? (event) => {
                                  event.cancelBubble = true
                                  setSelection({
                                    type: 'trunkDevice',
                                    // The junction panel itself, not the modules hanging in it.
                                    ids: surface.placements.flatMap((placement) =>
                                      placement.junctionPanelTerminal &&
                                      placement.ref.kind === 'trunkDevice'
                                        ? [placement.ref.id]
                                        : []
                                    ),
                                  })
                                }
                              : undefined
                        }
                      />
                      <Text
                        x={8}
                        y={8}
                        width={surface.width - 16}
                        text={
                          surface.label ||
                          getAuxiliaryEnclosureLabel(
                            surface.enclosure ?? undefined,
                            t,
                            currentProject
                              ? selectProjectAuxiliaryElectricalEnclosures(currentProject)
                              : undefined
                          )
                        }
                        fontSize={14}
                        fontStyle="bold"
                        fontFamily={fontFamily}
                        fill={colors.panelFrameStroke}
                        listening={false}
                      />
                      {((surface.kind === 'junction_panel' &&
                        surface.junctionPanelGridView?.terminalStripTopRail) ||
                        (surface.kind === 'auxiliary' &&
                          surface.enclosure?.gridView.terminalStripTopRail)) && (
                        <Rect
                          x={PANEL_FRAME_MARGIN}
                          y={PANEL_FRAME_MARGIN}
                          width={surface.contentWidth}
                          height={TERMINAL_STRIP_RAIL_H}
                          fillEnabled={false}
                          stroke={colors.panelFrameStroke}
                          opacity={0.2}
                          strokeWidth={1}
                          listening={false}
                        />
                      )}
                      {Array.from({ length: surface.rows }).map((_, rowIndex) => (
                        <Rect
                          key={`auxiliary-rail-${surface.id}-${rowIndex}`}
                          x={PANEL_FRAME_MARGIN}
                          y={
                            PANEL_FRAME_MARGIN +
                            ((surface.kind === 'junction_panel' &&
                              surface.junctionPanelGridView?.terminalStripTopRail) ||
                            (surface.kind === 'auxiliary' &&
                              surface.enclosure?.gridView.terminalStripTopRail)
                              ? TERMINAL_STRIP_RAIL_H + ROW_GAP
                              : 0) +
                            rowIndex * ROW_STRIDE
                          }
                          width={surface.contentWidth}
                          height={CELL_H}
                          fillEnabled={false}
                          stroke={colors.panelFrameStroke}
                          opacity={0.16}
                          strokeWidth={1}
                          listening={false}
                        />
                      ))}
                      {Array.from({ length: surface.rows }).map((_, rowIndex) =>
                        Array.from({ length: surface.cols + 1 }).map((_, colIndex) => (
                          <Line
                            key={`auxiliary-grid-${surface.id}-${rowIndex}-${colIndex}`}
                            points={[
                              PANEL_FRAME_MARGIN + colIndex * CELL_W,
                              PANEL_FRAME_MARGIN +
                                ((surface.kind === 'junction_panel' &&
                                  surface.junctionPanelGridView?.terminalStripTopRail) ||
                                (surface.kind === 'auxiliary' &&
                                  surface.enclosure?.gridView.terminalStripTopRail)
                                  ? TERMINAL_STRIP_RAIL_H + ROW_GAP
                                  : 0) +
                                rowIndex * ROW_STRIDE,
                              PANEL_FRAME_MARGIN + colIndex * CELL_W,
                              PANEL_FRAME_MARGIN +
                                ((surface.kind === 'junction_panel' &&
                                  surface.junctionPanelGridView?.terminalStripTopRail) ||
                                (surface.kind === 'auxiliary' &&
                                  surface.enclosure?.gridView.terminalStripTopRail)
                                  ? TERMINAL_STRIP_RAIL_H + ROW_GAP
                                  : 0) +
                                rowIndex * ROW_STRIDE +
                                CELL_H,
                            ]}
                            stroke={colors.panelFrameStroke}
                            opacity={0.08}
                            strokeWidth={0.75}
                            listening={false}
                          />
                        ))
                      )}
                      {((surface.kind === 'junction_panel' &&
                        surface.junctionPanelGridView?.terminalStripBottomRail) ||
                        (surface.kind === 'auxiliary' &&
                          surface.enclosure?.gridView.terminalStripBottomRail)) && (
                        <Rect
                          x={PANEL_FRAME_MARGIN}
                          y={surface.height - PANEL_FRAME_MARGIN - TERMINAL_STRIP_RAIL_H}
                          width={surface.contentWidth}
                          height={TERMINAL_STRIP_RAIL_H}
                          fillEnabled={false}
                          stroke={colors.panelFrameStroke}
                          opacity={0.2}
                          strokeWidth={1}
                          listening={false}
                        />
                      )}
                      {(surface.kind === 'junction_panel' || surface.kind === 'auxiliary') &&
                        canDragOnCanvas &&
                        (surface.kind === 'auxiliary'
                          ? selectedAuxiliaryEnclosureIds.includes(surface.id)
                          : surface.placements.some(
                              (placement) =>
                                placement.junctionPanelTerminal != null &&
                                placement.ref.kind === 'trunkDevice' &&
                                selection.type === 'trunkDevice' &&
                                selection.ids.includes(placement.ref.id)
                            )) && (
                          <>
                            {panelFrameResizePreview?.panelId === surface.id && (
                              <>
                                <Rect
                                  x={panelFrameResizePreview.x}
                                  y={panelFrameResizePreview.y}
                                  width={panelFrameResizePreview.width}
                                  height={panelFrameResizePreview.height}
                                  fill="transparent"
                                  stroke={colors.moduleBorderSelected}
                                  strokeWidth={2}
                                  dash={[7, 5]}
                                  cornerRadius={4}
                                  listening={false}
                                />
                                <Group
                                  x={
                                    panelFrameResizePreview.axis === 'columns'
                                      ? panelFrameResizePreview.width + 10
                                      : panelFrameResizePreview.width / 2 - 30
                                  }
                                  y={
                                    panelFrameResizePreview.axis === 'columns'
                                      ? panelFrameResizePreview.height / 2 - 10
                                      : panelFrameResizePreview.y - 26
                                  }
                                  listening={false}
                                >
                                  <Rect
                                    width={60}
                                    height={20}
                                    fill={colors.panelFrameFill}
                                    stroke={colors.moduleBorderSelected}
                                    strokeWidth={1}
                                    cornerRadius={6}
                                  />
                                  <Text
                                    x={4}
                                    y={4}
                                    width={52}
                                    height={12}
                                    text={`${panelFrameResizePreview.axis === 'rows' ? t('panelCanvas.rows', 'Rows') : t('panelCanvas.columns', 'Columns')} ${panelFrameResizePreview.value}`}
                                    fontSize={8}
                                    fontStyle="bold"
                                    fontFamily={fontFamily}
                                    fill={colors.moduleText}
                                    align="center"
                                  />
                                </Group>
                              </>
                            )}
                            <Rect
                              x={surface.width - 3}
                              y={surface.height / 2 - 16}
                              width={6}
                              height={32}
                              fill="#0284c7"
                              cornerRadius={3}
                              stroke="#0284c7"
                              strokeWidth={1}
                              hitStrokeWidth={touchHandleHitStrokeWidth}
                              draggable
                              onDragMove={(event) => {
                                event.cancelBubble = true
                                previewJunctionPanelFrameResize(
                                  surface,
                                  'columns',
                                  event.target.x() - (surface.width - 3)
                                )
                                event.target.y(surface.height / 2 - 16)
                              }}
                              onDragEnd={(event) => {
                                event.cancelBubble = true
                                event.target.position({
                                  x: surface.width - 3,
                                  y: surface.height / 2 - 16,
                                })
                                commitJunctionPanelFrameResize(surface)
                              }}
                              onMouseEnter={(event) => {
                                const stage = event.target.getStage()
                                if (stage) stage.container().style.cursor = 'ew-resize'
                              }}
                              onMouseLeave={(event) => {
                                const stage = event.target.getStage()
                                if (stage) stage.container().style.cursor = ''
                              }}
                            />
                            <Rect
                              x={surface.width / 2 - 16}
                              y={-3}
                              width={32}
                              height={6}
                              fill="#0284c7"
                              cornerRadius={3}
                              stroke="#0284c7"
                              strokeWidth={1}
                              hitStrokeWidth={touchHandleHitStrokeWidth}
                              draggable
                              onDragMove={(event) => {
                                event.cancelBubble = true
                                previewJunctionPanelFrameResize(
                                  surface,
                                  'rows',
                                  -event.target.y() - 3
                                )
                                event.target.x(surface.width / 2 - 16)
                              }}
                              onDragEnd={(event) => {
                                event.cancelBubble = true
                                event.target.position({ x: surface.width / 2 - 16, y: -3 })
                                commitJunctionPanelFrameResize(surface)
                              }}
                              onMouseEnter={(event) => {
                                const stage = event.target.getStage()
                                if (stage) stage.container().style.cursor = 'ns-resize'
                              }}
                              onMouseLeave={(event) => {
                                const stage = event.target.getStage()
                                if (stage) stage.container().style.cursor = ''
                              }}
                            />
                          </>
                        )}
                    </>
                  ) : (
                    <>
                      <Rect
                        x={-HIERARCHY_PANEL_FRAME_HIT_MARGIN}
                        y={
                          surface.mainPanelY -
                          Math.max(
                            HIERARCHY_PANEL_FRAME_HIT_MARGIN,
                            HIERARCHY_PANEL_FRAME_TITLE_HIT_HEIGHT
                          )
                        }
                        width={surface.width + HIERARCHY_PANEL_FRAME_HIT_MARGIN * 2}
                        height={
                          surface.panelFrameHeight +
                          HIERARCHY_PANEL_FRAME_HIT_MARGIN +
                          Math.max(
                            HIERARCHY_PANEL_FRAME_HIT_MARGIN,
                            HIERARCHY_PANEL_FRAME_TITLE_HIT_HEIGHT
                          )
                        }
                        fill="rgba(0,0,0,0.001)"
                        stroke="transparent"
                        strokeWidth={0}
                        cornerRadius={4}
                        name={`panel-${surface.panel?.id ?? surface.id} ${INTERACTIVE_OVERLAY_EXPORT_NAME}`}
                        listening={!labelMode}
                        onMouseDown={startPanelFrameSelectionRect}
                        onClick={(e) => {
                          if (!surface.panel) return
                          if (shouldIgnorePanelFrameClick(e.evt)) {
                            e.cancelBubble = true
                            return
                          }
                          e.cancelBubble = true
                          handleHierarchyPanelSelect(surface.panel.id, e.evt)
                        }}
                        onTap={(e) => {
                          if (!surface.panel) return
                          e.cancelBubble = true
                          handleHierarchyPanelSelect(surface.panel.id, e.evt)
                        }}
                      />
                      {surface.supplyPanelVisible && (
                        <>
                          <Group listening={false}>
                            <Rect
                              x={0}
                              y={surface.supplyPanelY}
                              width={surface.width}
                              height={surface.supplyFrameHeight}
                              stroke={colors.panelSupplyStroke}
                              strokeWidth={3}
                              fill={colors.panelFrameFill}
                              cornerRadius={4}
                              listening={false}
                            />
                            <Text
                              x={8}
                              y={surface.supplyPanelY + 8}
                              text={t('panelCanvas.supplyPanel', 'Grid panel')}
                              fontSize={14}
                              fontStyle="bold"
                              fontFamily={fontFamily}
                              fill={colors.panelFrameStroke}
                              listening={false}
                            />
                            <Rect
                              x={PANEL_FRAME_MARGIN}
                              y={surface.supplyPanelY + PANEL_FRAME_MARGIN}
                              width={surface.supplyContentWidth}
                              height={
                                surface.supplyRows * CELL_H +
                                Math.max(0, surface.supplyRows - 1) * ROW_GAP
                              }
                              fillEnabled={false}
                              stroke={colors.panelFrameStroke}
                              opacity={0.12}
                              strokeWidth={1}
                              listening={false}
                            />
                            {Array.from({ length: surface.supplyCols + 1 }).map((_, colIndex) => (
                              <Line
                                key={`supply-col-${surface.id}-${colIndex}`}
                                points={[
                                  PANEL_FRAME_MARGIN + colIndex * CELL_W,
                                  surface.supplyPanelY + PANEL_FRAME_MARGIN,
                                  PANEL_FRAME_MARGIN + colIndex * CELL_W,
                                  surface.supplyPanelY +
                                    PANEL_FRAME_MARGIN +
                                    surface.supplyRows * CELL_H +
                                    Math.max(0, surface.supplyRows - 1) * ROW_GAP,
                                ]}
                                stroke={colors.panelFrameStroke}
                                opacity={0.08}
                                strokeWidth={0.75}
                                listening={false}
                              />
                            ))}
                            {Array.from({ length: Math.max(0, surface.supplyRows - 1) }).map(
                              (_, rowIndex) => (
                                <Line
                                  key={`supply-row-${surface.id}-${rowIndex}`}
                                  points={[
                                    PANEL_FRAME_MARGIN,
                                    surface.supplyPanelY +
                                      PANEL_FRAME_MARGIN +
                                      (rowIndex + 1) * ROW_STRIDE -
                                      ROW_GAP,
                                    PANEL_FRAME_MARGIN + surface.supplyContentWidth,
                                    surface.supplyPanelY +
                                      PANEL_FRAME_MARGIN +
                                      (rowIndex + 1) * ROW_STRIDE -
                                      ROW_GAP,
                                  ]}
                                  stroke={colors.panelFrameStroke}
                                  opacity={0.08}
                                  strokeWidth={0.75}
                                  listening={false}
                                />
                              )
                            )}
                          </Group>
                          <Rect
                            x={0}
                            y={surface.supplyPanelY}
                            width={surface.width}
                            height={surface.supplyFrameHeight}
                            name={`supplyPanel-${surface.panel?.id ?? surface.id}`}
                            fill="transparent"
                            stroke="transparent"
                            strokeWidth={0}
                            cornerRadius={4}
                            listening={!labelMode}
                            onMouseDown={labelMode ? undefined : startPanelFrameSelectionRect}
                            onClick={(e) => {
                              if (labelMode) return
                              if (!surface.panel) return
                              if (shouldIgnorePanelFrameClick(e.evt)) {
                                e.cancelBubble = true
                                return
                              }
                              e.cancelBubble = true
                              setSelection({ type: 'supplyPanel', ids: [surface.panel.id] })
                            }}
                            onTap={(e) => {
                              if (labelMode) return
                              if (!surface.panel) return
                              e.cancelBubble = true
                              setSelection({ type: 'supplyPanel', ids: [surface.panel.id] })
                            }}
                          />
                        </>
                      )}
                      <Group y={surface.mainPanelY} listening={false}>
                        <Rect
                          x={0}
                          y={0}
                          width={surface.width}
                          height={surface.panelFrameHeight}
                          stroke={colors.panelFrameStroke}
                          strokeWidth={3}
                          fill={colors.panelFrameFill}
                          cornerRadius={4}
                          listening={false}
                        />
                        <Text
                          x={8}
                          y={8}
                          text={surface.label}
                          fontSize={14}
                          fontStyle="bold"
                          fontFamily={fontFamily}
                          fill={colors.panelFrameStroke}
                          listening={false}
                        />
                        <PanelFieldRails
                          idPrefix={surface.id}
                          grid={surface.panel?.gridView}
                          rows={surface.rows}
                          margin={PANEL_FRAME_MARGIN}
                          firstRowY={
                            PANEL_FRAME_MARGIN + getTerminalStripTopOffset(getPanelSceneSurfaceGrid(surface))
                          }
                          stroke={colors.panelFrameStroke}
                          topRailY={surface.panel?.gridView?.terminalStripTopRail ? PANEL_FRAME_MARGIN : undefined}
                          bottomRailY={
                            surface.panel?.gridView?.terminalStripBottomRail
                              ? surface.panelFrameHeight - PANEL_FRAME_MARGIN - TERMINAL_STRIP_RAIL_H
                              : undefined
                          }
                          terminalRailHeight={TERMINAL_STRIP_RAIL_H}
                        />
                      </Group>
                      <Rect
                        x={0}
                        y={surface.mainPanelY}
                        width={surface.width}
                        height={surface.panelFrameHeight}
                        fill="transparent"
                        stroke={
                          selectedPanelIds.includes(surface.panel?.id ?? '')
                            ? colors.moduleBorderSelected
                            : 'transparent'
                        }
                        strokeWidth={selectedPanelIds.includes(surface.panel?.id ?? '') ? 2 : 0}
                        cornerRadius={4}
                        listening={false}
                      />
                      {surface.panel &&
                        selectedPanelIds.includes(surface.panel.id) &&
                        canDragOnCanvas && (
                          <>
                            {panelFrameResizePreview?.panelId === surface.panel.id && (
                              <>
                                <Rect
                                  x={panelFrameResizePreview.x}
                                  y={panelFrameResizePreview.y}
                                  width={panelFrameResizePreview.width}
                                  height={panelFrameResizePreview.height}
                                  fill="transparent"
                                  stroke={colors.moduleBorderSelected}
                                  strokeWidth={2}
                                  dash={[7, 5]}
                                  cornerRadius={4}
                                  listening={false}
                                />
                                <Group
                                  x={
                                    panelFrameResizePreview.axis === 'columns'
                                      ? panelFrameResizePreview.width + 10
                                      : panelFrameResizePreview.width / 2 - 30
                                  }
                                  y={
                                    panelFrameResizePreview.axis === 'columns'
                                      ? panelFrameResizePreview.y +
                                        panelFrameResizePreview.height / 2 -
                                        10
                                      : panelFrameResizePreview.y - 26
                                  }
                                  listening={false}
                                >
                                  <Rect
                                    width={60}
                                    height={20}
                                    fill={colors.panelFrameFill}
                                    stroke={colors.moduleBorderSelected}
                                    strokeWidth={1}
                                    cornerRadius={6}
                                  />
                                  <Text
                                    x={4}
                                    y={4}
                                    width={52}
                                    height={12}
                                    text={`${panelFrameResizePreview.axis === 'rows' ? t('panelCanvas.rows', 'Rows') : t('panelCanvas.columns', 'Columns')} ${panelFrameResizePreview.value}`}
                                    fontSize={8}
                                    fontStyle="bold"
                                    fontFamily={fontFamily}
                                    fill={colors.moduleText}
                                    align="center"
                                  />
                                </Group>
                              </>
                            )}
                            <Rect
                              x={surface.width - 3}
                              y={surface.mainPanelY + surface.panelFrameHeight / 2 - 16}
                              width={6}
                              height={32}
                              fill="#0284c7"
                              cornerRadius={3}
                              stroke="#0284c7"
                              strokeWidth={1}
                              hitStrokeWidth={touchHandleHitStrokeWidth}
                              draggable
                              onMouseDown={(event) => {
                                event.cancelBubble = true
                              }}
                              onDragStart={(event) => {
                                event.cancelBubble = true
                                panelFrameResizePreviewRef.current = null
                                setPanelFrameResizePreview(null)
                              }}
                              onDragMove={(event) => {
                                event.cancelBubble = true
                                previewPanelFrameResize(
                                  surface as HierarchySurface & { panel: Panel },
                                  'columns',
                                  event.target.x() - (surface.width - 3)
                                )
                                event.target.y(
                                  surface.mainPanelY + surface.panelFrameHeight / 2 - 16
                                )
                              }}
                              onDragEnd={(event) => {
                                event.cancelBubble = true
                                event.target.position({
                                  x: surface.width - 3,
                                  y: surface.mainPanelY + surface.panelFrameHeight / 2 - 16,
                                })
                                commitPanelFrameResize(
                                  surface as HierarchySurface & { panel: Panel }
                                )
                              }}
                              onMouseEnter={(event) => {
                                const stage = event.target.getStage()
                                if (stage) stage.container().style.cursor = 'ew-resize'
                              }}
                              onMouseLeave={(event) => {
                                const stage = event.target.getStage()
                                if (stage) stage.container().style.cursor = ''
                              }}
                            />
                            <Rect
                              x={surface.width / 2 - 16}
                              y={surface.mainPanelY - 3}
                              width={32}
                              height={6}
                              fill="#0284c7"
                              cornerRadius={3}
                              stroke="#0284c7"
                              strokeWidth={1}
                              hitStrokeWidth={touchHandleHitStrokeWidth}
                              draggable
                              onMouseDown={(event) => {
                                event.cancelBubble = true
                              }}
                              onDragStart={(event) => {
                                event.cancelBubble = true
                                panelFrameResizePreviewRef.current = null
                                setPanelFrameResizePreview(null)
                              }}
                              onDragMove={(event) => {
                                event.cancelBubble = true
                                previewPanelFrameResize(
                                  surface as HierarchySurface & { panel: Panel },
                                  'rows',
                                  surface.mainPanelY - 3 - event.target.y()
                                )
                                event.target.x(surface.width / 2 - 16)
                              }}
                              onDragEnd={(event) => {
                                event.cancelBubble = true
                                event.target.position({
                                  x: surface.width / 2 - 16,
                                  y: surface.mainPanelY - 3,
                                })
                                commitPanelFrameResize(
                                  surface as HierarchySurface & { panel: Panel }
                                )
                              }}
                              onMouseEnter={(event) => {
                                const stage = event.target.getStage()
                                if (stage) stage.container().style.cursor = 'ns-resize'
                              }}
                              onMouseLeave={(event) => {
                                const stage = event.target.getStage()
                                if (stage) stage.container().style.cursor = ''
                              }}
                            />
                          </>
                        )}
                      {hierarchyRewirePreviewWire?.promotionPanelId === surface.panel?.id && (
                        <Rect
                          x={0}
                          y={surface.mainPanelY}
                          width={surface.width}
                          height={surface.panelFrameHeight}
                          fill="rgba(37,99,235,0.08)"
                          stroke="#2563eb"
                          strokeWidth={3}
                          dash={[10, 5]}
                          cornerRadius={4}
                          listening={false}
                        />
                      )}
                      {surface.supplyPanelVisible && (
                        <Rect
                          x={0}
                          y={surface.supplyPanelY}
                          width={surface.width}
                          height={surface.supplyFrameHeight}
                          stroke={
                            selectedSupplyPanelIds.includes(surface.panel?.id ?? '')
                              ? colors.moduleBorderSelected
                              : 'transparent'
                          }
                          strokeWidth={
                            selectedSupplyPanelIds.includes(surface.panel?.id ?? '') ? 2 : 0
                          }
                          cornerRadius={4}
                          listening={false}
                        />
                      )}
                    </>
                  )}

                  <ConverterBackupFeedMarker surface={surface} debugMode={panelRelationDebug} />

                  {surface.placements.map((placement) => {
                    const surfaceTargetId = surface.panel?.id ?? surface.id
                    const previewItem =
                      moduleDragLive?.surfaceId === surfaceTargetId
                        ? (moduleDragLive?.items?.find(
                            (item) =>
                              panelGridModuleRefKey(item.ref) ===
                              panelGridModuleRefKey(placement.ref)
                          ) ??
                          (moduleDragLive.ref &&
                          panelGridModuleRefKey(moduleDragLive.ref) ===
                            panelGridModuleRefKey(placement.ref)
                            ? {
                                ref: placement.ref,
                                x: moduleDragLive.x,
                                y: moduleDragLive.y,
                                width: placement.width,
                                height: placement.height,
                              }
                            : null))
                        : null
                    const isAltDuplicatePreview =
                      moduleDragLive?.isAltDuplicate === true &&
                      !!previewItem &&
                      moduleDragLive.ref != null &&
                      panelGridModuleRefKey(moduleDragLive.ref) ===
                        panelGridModuleRefKey(placement.ref)
                    return (
                      <>
                        <ModuleBox
                          key={`${surface.id}-${panelGridModuleRefKey(placement.ref)}`}
                          moduleRef={placement.ref}
                          terminalStripMemberRefs={placement.terminalStripMemberRefs}
                          selectionOverride={
                            placement.junctionPanelTerminal
                              ? {
                                  type: 'junctionPanelTerminal',
                                  ids: [placement.junctionPanelTerminal.terminalId],
                                  junctionPanelTerminalOwnerId:
                                    placement.ref.kind === 'trunkDevice'
                                      ? placement.ref.id
                                      : undefined,
                                }
                              : undefined
                          }
                          x={
                            previewItem && !isAltDuplicatePreview
                              ? previewItem.x - surface.x
                              : placement.x
                          }
                          y={
                            previewItem && !isAltDuplicatePreview
                              ? previewItem.y - surface.y
                              : placement.y
                          }
                          width={placement.width}
                          height={placement.height}
                          info={
                            placement.junctionPanelTerminal
                              ? {
                                  label: placement.junctionPanelTerminal.label,
                                  specLines: [],
                                  terminalStrip: {
                                    stripId: placement.junctionPanelTerminal.label.replace(
                                      /^X/i,
                                      ''
                                    ),
                                    incomingPin: 1,
                                    outgoingPin: 1,
                                    maxPin: placement.junctionPanelTerminal.pinCount,
                                    connectedPins: Array.from(
                                      { length: placement.junctionPanelTerminal.pinCount },
                                      (_, index) => index + 1
                                    ),
                                  },
                                  tooltipText: placement.junctionPanelTerminal.label,
                                  kind: 'trunkDevice' as const,
                                }
                              : getCachedModuleDisplayInfo(
                                  placement.ref,
                                  currentProject,
                                  displayLanguage
                                )
                          }
                          draggable={canDragOnCanvas && !labelMode}
                          interactive={!labelMode}
                          resetPositionOnAltDrag
                          compactLabelMode={surface.id === activeLabelSurfaceId}
                          onDragMove={
                            canDragItems
                              ? (_ref, x, y, shiftKey, altKey) =>
                                  handleHierarchyModuleDragMove(
                                    surface as HierarchySurface & { panel: Panel },
                                    placement,
                                    x,
                                    y,
                                    shiftKey,
                                    altKey
                                  )
                              : undefined
                          }
                          onDragEnd={
                            canDragItems
                              ? (_ref, x, y, shiftKey, altKey) => {
                                  if (altKey) {
                                    handleHierarchyModuleAltDuplicate(
                                      surface as HierarchySurface & { panel: Panel },
                                      placement,
                                      x,
                                      y
                                    )
                                    return
                                  }
                                  handleHierarchyModuleDragEnd(
                                    surface as HierarchySurface & { panel: Panel },
                                    placement,
                                    x,
                                    y,
                                    shiftKey
                                  )
                                }
                              : undefined
                          }
                          onHoverChange={setTooltip}
                          onHoverRefChange={setHoveredModuleRef}
                          debugMode={panelRelationDebug}
                          debugSupplyTrunkKind={
                            panelRelationDebug && scene?.sharedSupplyTrunkRefKeys
                              ? placement.ref.kind === 'trunkDevice' &&
                                placement.ref.scope === 'supply'
                                ? scene.sharedSupplyTrunkRefKeys.has(
                                    panelGridModuleRefKey(placement.ref)
                                  )
                                  ? 'shared'
                                  : 'unique'
                                : undefined
                              : undefined
                          }
                          onResizeEnd={
                            canDragOnCanvas
                              ? (_ref, newWidthCols) =>
                                  handleHierarchyModuleResize(
                                    surface as HierarchySurface & { panel: Panel },
                                    placement,
                                    newWidthCols
                                  )
                              : undefined
                          }
                          isResizeWidthValid={
                            canDragItems
                              ? (_ref, newWidthCols) =>
                                  isHierarchyResizeWidthValid(
                                    surface as HierarchySurface & { panel: Panel },
                                    placement,
                                    newWidthCols
                                  )
                              : undefined
                          }
                          maxWidthCols={getHierarchyMaxWidth(
                            surface as HierarchySurface & { panel: Panel },
                            placement
                          )}
                          onRewireDragStart={
                            canUseRewireTools && rewireMode
                              ? (ref) => handleHierarchyRewireDragStart(surface, ref)
                              : undefined
                          }
                          onRewireDragMove={
                            canUseRewireTools && rewireMode
                              ? (stage, pointerPos) =>
                                  handleHierarchyRewireDragMove(surface, stage, pointerPos)
                              : undefined
                          }
                          onRewireDragEnd={
                            canUseRewireTools && rewireMode
                              ? handleHierarchyRewireDragEnd
                              : undefined
                          }
                          onSelectionIntent={createHierarchySelectionResolver(surface, placement)}
                          onAssignTargetClick={
                            assignToCircuitMode && onAssignTargetClick
                              ? onAssignTargetClick
                              : undefined
                          }
                          isRewireOrigin={
                            rewireMode &&
                            rewireOriginRef != null &&
                            rewireOriginSurfaceId === getSurfaceRewireId(surface) &&
                            panelGridModuleRefKey(placement.ref) ===
                              panelGridModuleRefKey(rewireOriginRef)
                          }
                          isRewireTarget={
                            rewireMode &&
                            rewireTargetRef != null &&
                            rewireTargetSurfaceId === getSurfaceRewireId(surface) &&
                            panelGridModuleRefKey(placement.ref) ===
                              panelGridModuleRefKey(rewireTargetRef)
                          }
                          isRewireTargetValid={
                            rewireMode &&
                            rewireTargetRef != null &&
                            rewireTargetSurfaceId === getSurfaceRewireId(surface) &&
                            panelGridModuleRefKey(placement.ref) ===
                              panelGridModuleRefKey(rewireTargetRef)
                              ? rewireTargetValid
                              : true
                          }
                        />
                        {isAltDuplicatePreview && previewItem && (
                          <ModuleBox
                            key={`alt-duplicate-ghost-${surface.id}-${panelGridModuleRefKey(placement.ref)}`}
                            moduleRef={placement.ref}
                            terminalStripMemberRefs={placement.terminalStripMemberRefs}
                            x={previewItem.x - surface.x}
                            y={previewItem.y - surface.y}
                            width={placement.width}
                            height={placement.height}
                            info={getCachedModuleDisplayInfo(
                              placement.ref,
                              currentProject,
                              displayLanguage
                            )}
                            interactive={false}
                            opacity={0.72}
                          />
                        )}
                      </>
                    )
                  })}
                  {moduleDragPreview &&
                    moduleDragPreview.surfaceId === (surface.panel?.id ?? surface.id) &&
                    (moduleDragPreview.items && moduleDragPreview.items.length > 0
                      ? moduleDragPreview.items.map((item) => (
                          <Rect
                            key={`module-drag-preview-${panelGridModuleRefKey(item.ref)}`}
                            x={item.x - surface.x}
                            y={item.y - surface.y}
                            width={item.width}
                            height={item.height}
                            stroke={moduleDragPreview.invalid ? '#ef4444' : colors.hoverColor}
                            strokeWidth={2}
                            dash={[8, 4]}
                            fill="transparent"
                            listening={false}
                          />
                        ))
                      : [
                          <Rect
                            key="module-drag-preview-single"
                            x={moduleDragPreview.x - surface.x}
                            y={moduleDragPreview.y - surface.y}
                            width={moduleDragPreview.width}
                            height={moduleDragPreview.height}
                            stroke={moduleDragPreview.invalid ? '#ef4444' : colors.hoverColor}
                            strokeWidth={2}
                            dash={[8, 4]}
                            fill="transparent"
                            listening={false}
                          />,
                        ])}
                  {dragPreview && dragPreview.surfaceId === surface.id && (
                    <Rect
                      x={dragPreview.x - surface.x}
                      y={dragPreview.y - surface.y}
                      width={dragPreview.width}
                      height={dragPreview.height}
                      stroke={dragPreview.invalid ? '#ef4444' : colors.hoverColor}
                      strokeWidth={2}
                      dash={[8, 4]}
                      fill="transparent"
                      listening={false}
                    />
                  )}
                </>
              )}
            </PanelSurfaceGroup>
          ))}
          {moduleDragPreview?.createAuxiliary && (
            <Rect
              x={moduleDragPreview.x}
              y={moduleDragPreview.y}
              width={moduleDragPreview.width}
              height={moduleDragPreview.height}
              stroke={moduleDragPreview.invalid ? '#ef4444' : colors.hoverColor}
              strokeWidth={2}
              dash={[10, 5]}
              fill="transparent"
              cornerRadius={4}
              listening={false}
            />
          )}
          {directPanelFeederConnectors.map((connector, index) => (
            <Line
              key={`direct-panel-feeder-${index}`}
              points={connector.points}
              stroke={colors.supplyWire}
              strokeWidth={2}
              dash={[8, 4]}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          ))}
          {relationScene && (
              <Group key="hierarchy-relation-wires-merged" listening={false}>
                <RelationWires
                  placements={relationScene.placements}
                  selectedRef={panelWireSelectionFocus?.ref ?? selectedRef}
                  selectedPanelId={selectedPanelIds.length === 1 ? selectedPanelIds[0] : null}
                  surfaces={scene?.surfaces}
                  panelConnectors={panelRelationConnectors}
                  selectedConnectionSide={panelWireSelectionFocus?.side}
                  selectedConnectionPeerRef={panelWireSelectionFocus?.peerRef}
                  hoveredRef={hoveredModuleRef}
                  panel={relationScene.panel}
                  project={currentProject}
                  dragOverride={moduleDragWireOverride}
                  preserveRowForRefKeys={relationScene.supplyPanelRefKeys}
                  supplyPanelRefKeys={relationScene.supplyPanelRefKeys}
                  hierarchyRoute={relationScene.hierarchyRoute}
                  getHierarchyRoute={relationScene.getHierarchyRoute}
                  animateDash
                  debugMode={panelRelationDebug}
                  pathwayRegions={panelWirePathRegions}
                  pathwayLinks={panelWirePathLinks}
                />
              </Group>
          )}
          {dragPreview?.feedWirePoints && (
            <RewirePreviewWire points={dragPreview.feedWirePoints} stroke="#10b981" animateDash />
          )}
          {libraryCanvasExtras}
          {scene && <PanelRemoteSelections surfaces={scene.surfaces} zoom={panelZoom} />}
          {}
        </Group>
      </BaseCanvas>

      {labelMode && (
        <PanelLabelModeOverlay
          key={activeLabelSurfaceId}
          scene={labelScene}
          project={currentProject}
          canvasRef={canvasRef}
          panelZoom={panelZoom}
          panelPan={panelPan}
          canEdit={canEditProject}
          onUpdateModuleLabel={updateModuleLabel}
          onUpdateModuleLabels={updateModuleLabels}
        />
      )}

      <ViewNavigationToolbar
        zoom={panelZoom}
        minZoom={getPanelCanvasZoomMinimum(currentProject)}
        onZoomChange={handleZoomChange}
        onPanChange={handlePanChange}
        onFitToView={handleFitToView}
        canvasType="panel"
      />

      {scene && (
        <CanvasFloatingControlRail
          side="left"
          verticalAlign="center"
          topOverlayInsetPx={68}
          dataCanvasOverlayAnchor="left"
        >
          <>
            {canUseRewireTools && (
              <RewireTool
                isActive={rewireMode}
                disabled={labelMode}
                onToggle={() => {
                  if (labelMode) return
                  setRewireMode((prev) => !prev)
                  resetHierarchyRewireState()
                }}
                hasOrigin={!!rewireOriginRef}
              />
            )}
            {canDragItems && (
              <FloatingControl
                icon={<AutoArrangeIcon className="w-6 h-6" />}
                label={t('panelCanvas.autoArrange', 'Auto arrange')}
                variant="tool"
                side="left"
                triggerTestId="e2e-panel-auto-arrange"
                disabled={labelMode}
                onClick={handleHierarchyAutoArrange}
              />
            )}
            <FloatingControl
              icon={<Tag className="h-6 w-6" />}
              label={t('panelCanvas.labelMode', 'Label mode')}
              variant="tool"
              side="left"
              active={labelMode}
              triggerTestId="e2e-panel-label-mode"
              onClick={() => {
                // The live camera can be ahead of the last React camera commit.
                if (!labelMode) {
                  setLabelSurfaceId(scene
                    ? choosePanelLabelSurface(scene.surfaces, getLabelEditingView())?.id ?? null
                    : null)
                  setRewireMode(false)
                  resetHierarchyRewireState()
                  setSelection({ type: null, ids: [] })
                  setTooltip(null)
                  setHoveredModuleRef(null)
                }
                setLabelMode((previous) => !previous)
              }}
            />
            {labelMode && (
              <FloatingControl
                icon={<Printer className="h-6 w-6" />}
                label={t('menu.exportLabels', 'Export labels')}
                variant="tool"
                side="left"
                triggerTestId="e2e-panel-label-export"
                onClick={openLabelStripExportDialog}
              />
            )}
          </>
        </CanvasFloatingControlRail>
      )}

      {tooltip && (
        <div
          className="absolute z-50 pointer-events-none"
          style={{
            left: tooltip.clientX - viewportRect.left,
            top: tooltip.clientY - viewportRect.top,
            transform: 'translate(12px, 12px)',
          }}
        >
          <div className="rounded bg-black/85 text-white text-xs px-2 py-1 shadow-lg max-w-[240px] whitespace-pre-wrap">
            {tooltip.text}
          </div>
        </div>
      )}
      {panelRelationDebug && (
        <div className="absolute top-3 left-3 z-40 pointer-events-none rounded-md border border-slate-300/70 dark:border-slate-600/80 bg-white/92 dark:bg-slate-900/92 px-3 py-2 shadow-md">
          <div className="text-[11px] font-semibold text-slate-800 dark:text-slate-100 mb-1">
            Panel routing debug
          </div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-1">
            Wires
          </div>
          <div className="space-y-1 mb-2">
            {PANEL_RELATION_DEBUG_WIRE_LEGEND.map((item) => (
              <div
                key={`wire-${item.label}`}
                className="flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-200"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: item.color }}
                />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-1">
            Modules
          </div>
          <div className="space-y-1">
            {PANEL_RELATION_DEBUG_MODULE_LEGEND.map((item) => (
              <div
                key={`module-${item.label}`}
                className="flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-200"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: item.color }}
                />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
