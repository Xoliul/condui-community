import { logger } from '@/lib/logger'
import { useJunctionEditorMenu } from '@/components/junctionEditor/junctionEditorHostedFeatures'
/**
 * Panel (kast) canvas: shows one panel at a time as a grid of modules
 * (protections, energy meters, optionally domotica). Same panels as eendraad frames.
 */
import { useRef, useCallback, useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { Group, Rect, Line } from 'react-konva'
import Konva from 'konva'
import type { BaseCanvasHandle } from './BaseCanvas'
import CanvasFloatingControlRail from './CanvasFloatingControlRail'
import { CanvasOverlayScaleProvider } from '@/contexts/CanvasOverlayScaleContext'
import { FloatingControl } from './FloatingControls'
import { PanelSelectorIcon, VisibilityIcon } from '@/components/icons/UiIcons'
import { useUIStore } from '@/stores/uiStore'

import { useSettingsStore } from '@/stores/settingsStore'
import { useProjectStore, isModuleRefValid } from '@/stores/projectStore'
import { useDialogStore } from '@/stores/dialogStore'
import { useCanvasRegistryStore } from '@/stores/canvasRegistryStore'
import { useThemeColors } from '@/lib/theme/hooks'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import {
  getPanelGridPlacements,
  getSupplyPanelPlacements,
  getSupplyPanelColumns,
  getSupplyPanelRows,
  panelGridModuleRefKey,
  getModuleWidthInCols,
  resolveModuleWidthCols,
  CELL_W,
  CELL_H,
  ROW_GAP,
  ROW_STRIDE,
  snapToGrid,
  type ModulePlacement,
} from './panel/panelGridLayout'
import {
  arePanelGridSlotArraysEqual,
  buildPanelAutoArrangeSlots,
  getSupplyPanelLayout,
  placeSupplyModuleAfterInsert as planSupplyModuleSlotsAfterInsert,
  rebalanceSupplyOverflowIntoMain as rebalanceSupplyOverflowSlotsIntoMain,
} from '@/lib/panel/panelSupplySlots'
import { getModuleDisplayInfo, type ModuleDisplayInfo } from './panel/getModuleDisplayInfo'
import ModuleBox, { type ModuleTooltipData } from './panel/ModuleBox'
import { getDownstreamWirePoints } from './panel/RelationWires'
import { getCircuitIdFromModuleRef, getRelationEdges } from './panel/panelRelationEdges'
import { PANEL_SCENE_FRAME_MARGIN, PANEL_SCENE_SUPPLY_GAP } from '@/lib/panel/panelScene'
import {
  PANEL_FOCUS_SINGLE_PANEL_LINK_POLICY,
  type PanelSceneFilter,
} from '@/lib/panel/applyPanelSceneFilter'
import { DEFAULT_PANEL_GRID_COLUMNS, DEFAULT_PANEL_GRID_ROWS } from '@/lib/panel/panelGridDefaults'
import { getPanelFeedProjection } from '@/lib/feedTopology'
import {
  getSharedSupplyRefKeysForPanel,
  isSharedSupplyTrunkRef,
  validatePanelRewireOperation,
} from '@/lib/panel/panelRewire'
import { getPanelCanvasOverflowModuleKeys } from '@/lib/export/labelStripReadiness'
import type { PanelGridSlot, PanelGridModuleRef, Circuit, Panel } from '@/types/schema'
import type { ProjectState } from '@/stores/projectStore'
import { getPanelDisplayName } from '@/utils/panelNames'
import type { PanelCanvasMode, Selection as CanvasSelection } from '@/types/ui'
import type { EditorCapabilities } from '@/lib/viewerMode'
import { clamp, rectContainsRect } from '@/lib/geometry'
import { HierarchyPanelCanvas } from './panel/HierarchyPanelCanvas'
import { PanelOptionsMenu } from './panel/PanelOptionsMenu'
import { buildPanelSelectorLabel, type PanelOption } from './panel/panelOptionsMenuUtils'
import { PanelVisibilityMenu, type PanelVisibilityTarget } from './panel/PanelVisibilityMenu'
import {
  usePanelContextMenu,
  usePanelLibraryDrop,
  usePanelOptionsMenuState,
  usePanelViewportHandlers,
} from '@/hooks/panel'

type Project = NonNullable<ProjectState['currentProject']>

function panelGridSlotPersistenceKey(slot: PanelGridSlot): string {
  return [
    panelGridModuleRefKey(slot.module),
    slot.row,
    slot.col,
    slot.moduleWidth ?? '',
    slot.moduleWidthManual === true ? 'manual' : 'auto',
  ].join(':')
}

function moduleRefMatchesSelection(ref: PanelGridModuleRef, selection: CanvasSelection): boolean {
  if (!selection.type || selection.ids.length === 0) return false
  if (selection.type === 'protection')
    return ref.kind === 'protection' && selection.ids.includes(ref.id)
  if (selection.type === 'trunkDevice') {
    return ref.kind === 'trunkDevice' && selection.ids.includes(ref.id)
  }
  if (selection.type === 'endpoint') {
    return ref.kind === 'domotica' && selection.ids.includes(ref.endpointId)
  }
  return false
}

function getModuleSelectionBounds(
  placements: Array<{
    x: number
    y: number
    width: number
    height: number
    ref: PanelGridModuleRef
  }>,
  selection: CanvasSelection,
  padding = 0
): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let found = false

  for (const placement of placements) {
    if (!moduleRefMatchesSelection(placement.ref, selection)) continue
    minX = Math.min(minX, placement.x)
    minY = Math.min(minY, placement.y)
    maxX = Math.max(maxX, placement.x + placement.width)
    maxY = Math.max(maxY, placement.y + placement.height)
    found = true
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

  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  }
}

interface HierarchyDragPreview {
  panelId: string
  x: number
  y: number
  width: number
  height: number
  ref?: PanelGridModuleRef
  invalid?: boolean
  items?: Array<{
    ref: PanelGridModuleRef
    x: number
    y: number
    width: number
    height: number
  }>
}

function flattenPanels(
  panels: Panel[],
  project?: Project | null,
  depth = 0,
  isRoot = true
): PanelOption[] {
  const out: PanelOption[] = []
  for (const p of panels) {
    out.push({ id: p.id, name: getPanelDisplayName(p, project), panel: p, depth, isRoot })
    out.push(...flattenPanels(p.subPanels ?? [], project, depth + 1, false))
  }
  return out
}

interface PanelCanvasProps {
  onMultiFingerSwipe?: (
    direction: 'left' | 'right' | 'up' | 'down',
    fingerCount: number,
    startClientX: number
  ) => void
  capabilities?: EditorCapabilities
}

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

export default function PanelCanvas({ onMultiFingerSwipe, capabilities }: PanelCanvasProps = {}) {
  const { t } = useTranslation()
  const canvasRef = useRef<BaseCanvasHandle>(null)
  const canPlaceSymbols = capabilities?.canPlaceSymbols ?? true
  const canDeleteItems = capabilities?.canDeleteItems ?? true
  const canEditProject = capabilities?.canEditProject ?? true
  const containerRef = useRef<HTMLDivElement>(null)
  const isTouchDevice = useMemo(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0, [])
  const isSafariBrowser = useMemo(() => {
    const ua = navigator.userAgent
    const hasSafari = ua.includes('Safari')
    const hasChromium = ua.includes('Chrome') || ua.includes('Chromium') || ua.includes('CriOS')
    return hasSafari && !hasChromium
  }, [])
  const panelZoom = useUIStore((s) => s.panelView.zoom)
  const panelPan = useUIStore((s) => s.panelView.pan)
  const panelRelationDebug = useSettingsStore((s) =>
    process.env.NODE_ENV !== 'production' ? s.panelRelationDebug : false
  )
  const leftDragPansCanvas = useSettingsStore((s) => s.leftDragPansCanvas)
  void leftDragPansCanvas
  const requestFitToView = useUIStore((s) => s.requestFitToView)
  const activePanelId = useUIStore((s) => s.activePanelId)
  const setActivePanelId = useUIStore((s) => s.setActivePanelId)
  const panelCanvasMode = useUIStore((s) => s.panelCanvasMode)
  const setPanelCanvasMode = useUIStore((s) => s.setPanelCanvasMode)
  
  const selection = useUIStore((s) => s.selection)
  const syncSitplanFilterWithPanelView = useUIStore((s) => s.syncSitplanFilterWithPanelView)
  const setSitplanPanelFilterId = useUIStore((s) => s.setSitplanPanelFilterId)
  const {
    closePanelOptionsMenu,
    feedSideDirection,
    panelOptionsMenuOpen,
    setFeedSideDirection,
    setPanelOptionsMenuOpen,
  } = usePanelOptionsMenuState()
  const [panelVisibilityMenuOpen, setPanelVisibilityMenuOpen] = useState(false)

  // Register canvas for export
  // Always return stage if available - export will handle switching panels as needed
  const registerPanel = useCanvasRegistryStore((s) => s.registerPanel)
  const unregisterPanel = useCanvasRegistryStore((s) => s.unregisterPanel)
  useEffect(() => {
    registerPanel(
      () => {
        // Always return stage if available - export handles switching to the right panel
        // The stage will contain the currently active panel, which export will switch to match.
        return canvasRef.current?.getStage() ?? null
      },
      () => {
        // Fit to view - export will ensure the right panel is active before calling this
        canvasRef.current?.fitToView()
      }
    )
    return () => unregisterPanel()
  }, [registerPanel, unregisterPanel])
  const currentProject = useProjectStore((s: ProjectState) => s.currentProject)
  const getPanelById = useProjectStore((s: ProjectState) => s.getPanelById)
  const getProtectionById = useProjectStore((s: ProjectState) => s.getProtectionById)
  const addPanel = useProjectStore((s: ProjectState) => s.addPanel)
  const getPanelGridModules = useProjectStore((s: ProjectState) => s.getPanelGridModules)
  const updatePanelGridSlots = useProjectStore((s: ProjectState) => s.updatePanelGridSlots)
  const updatePanelGrid = useProjectStore((s: ProjectState) => s.updatePanelGrid)
  const applyPanelAutoArrange = useProjectStore((s: ProjectState) => s.applyPanelAutoArrange)
  const ejectToSupplyPanel = useProjectStore((s: ProjectState) => s.ejectToSupplyPanel)
  const returnFromSupplyPanel = useProjectStore((s: ProjectState) => s.returnFromSupplyPanel)
  const hideModuleFromPanel = useProjectStore((s: ProjectState) => s.hideModuleFromPanel)
  const unhideModuleFromPanel = useProjectStore((s: ProjectState) => s.unhideModuleFromPanel)
  const getPanelHiddenModuleRefs = useProjectStore((s: ProjectState) => s.getPanelHiddenModuleRefs)
  const getTrunkDeviceById = useProjectStore((s: ProjectState) => s.getTrunkDeviceById)
  const getEndpointById = useProjectStore((s: ProjectState) => s.getEndpointById)
  const setSupplyPanelVisible = useProjectStore((s: ProjectState) => s.setSupplyPanelVisible)
  const updateSupplyPanelSlots = useProjectStore((s: ProjectState) => s.updateSupplyPanelSlots)
  const moveEndpointToCircuit = useProjectStore((s: ProjectState) => s.moveEndpointToCircuit)
  const colors = useThemeColors()
  const clearSelection = useUIStore((s) => s.clearSelection)
  const openDialog = useDialogStore((s) => s.openDialog)

  const fitTrigger = useUIStore((s) => s.fitToViewTrigger.panel)
  useEffect(() => {
    if (fitTrigger === 0) return
    const id = requestAnimationFrame(() => {
      canvasRef.current?.fitToView()
    })
    return () => cancelAnimationFrame(id)
  }, [fitTrigger])

  const { handlePanChange, handleViewTransformCommit, handleZoomChange } =
    usePanelViewportHandlers()

  const panelList = useMemo(
    () =>
      flattenPanels(
        currentProject ? getProjectElectricalPanels(currentProject) : [],
        currentProject
      ),
    [currentProject]
  )
  const hasActivePanelInProject =
    activePanelId != null && panelList.some((p) => p.id === activePanelId)
  // Keep panel selection project-local: stale IDs from a previous project fall back to first panel.
  const effectiveActivePanelId = hasActivePanelInProject
    ? activePanelId
    : (panelList[0]?.id ?? null)
  const effectivePanelCanvasMode = useMemo<PanelCanvasMode>(() => {
    if (panelCanvasMode.kind !== 'panel') return panelCanvasMode
    const selectedExists = panelList.some(
      (panelOption) => panelOption.id === panelCanvasMode.panelId
    )
    return selectedExists ? panelCanvasMode : { kind: 'all' }
  }, [panelCanvasMode, panelList])
  const panelVisibilityTargets = useMemo<PanelVisibilityTarget[]>(() => {
    const visiblePanels =
      effectivePanelCanvasMode.kind === 'panel'
        ? panelList.filter((option) => option.id === effectivePanelCanvasMode.panelId)
        : panelList
    return visiblePanels.map((option) => ({ panelId: option.id, panelName: option.name }))
  }, [effectivePanelCanvasMode, panelList])
  /** When single-panel mode or the focused panel id changes, re-frame the scene after layout. */
  const panelCanvasFitKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const mode = effectivePanelCanvasMode
    if (mode.kind !== 'panel') {
      panelCanvasFitKeyRef.current = 'all'
      return
    }
    const key = `panel:${mode.panelId}`
    const prev = panelCanvasFitKeyRef.current
    panelCanvasFitKeyRef.current = key
    if (prev === key) return

    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        canvasRef.current?.fitToView()
      })
    })
    return () => cancelAnimationFrame(raf1)
  }, [effectivePanelCanvasMode])

  const panel = useMemo(
    () => {
      const selectedId = effectivePanelCanvasMode.kind === 'panel'
        ? effectivePanelCanvasMode.panelId
        : effectiveActivePanelId
      return panelList.find((candidate) => candidate.id === selectedId)?.panel ?? null
    },
    [effectiveActivePanelId, effectivePanelCanvasMode, panelList]
  )
  
  const selectedPanelForLayout = useMemo(() => {
    if (effectivePanelCanvasMode.kind === 'panel') return panel ?? null
    const selectedPanelId = selection.type === 'panel' ? selection.ids[0] : null
    if (selectedPanelId) return getPanelById(selectedPanelId) ?? null
    return panel ?? null
  }, [effectivePanelCanvasMode, selection, getPanelById, panel])
  const rootPanels = useMemo(
    () =>
      panelList.filter((panelOption) => panelOption.isRoot).map((panelOption) => panelOption.panel),
    [panelList]
  )
  const hierarchyFeedFromTop = useMemo(
    () => rootPanels[0]?.gridView?.feedFromTop ?? false,
    [rootPanels]
  )
  const setHierarchyFeedFromTop = useCallback(
    (feedFromTop: boolean) => {
      for (const rootPanel of rootPanels) {
        updatePanelGrid(rootPanel.id, { feedFromTop })
      }
    },
    [rootPanels, updatePanelGrid]
  )

  const handleFitToView = useCallback(() => {
    const viewportLayout = useUIStore.getState().viewportLayout
    const canvasesToFit =
      viewportLayout.panels.length === 1
        ? ['panel' as const]
        : Array.from(new Set(viewportLayout.panels.map((panel) => panel.canvas)))
    requestFitToView(canvasesToFit)
  }, [requestFitToView])

  const modules = useMemo(
    () =>
      panel && currentProject
        ? getPanelGridModules(panel.id).filter(
            (m: ReturnType<typeof getPanelGridModules>[number]) =>
              !(m.ref.kind === 'trunkDevice' && m.ref.scope === 'ground')
          )
        : [],
    [currentProject, panel, getPanelGridModules]
  )
  type ModuleItem = {
    ref: PanelGridModuleRef
    slot?: { row: number; col: number; moduleWidth?: number; moduleWidthManual?: boolean }
    inSupplyPanel?: boolean
  }
  const mainModules = useMemo(
    () => modules.filter((m: ModuleItem) => m.inSupplyPanel !== true),
    [modules]
  )
  const supplyModules = useMemo(
    () => modules.filter((m: ModuleItem) => m.inSupplyPanel === true),
    [modules]
  )
  const sharedSupplyRefKeys = useMemo(
    () =>
      panel && currentProject
        ? getSharedSupplyRefKeysForPanel(currentProject, panel)
        : new Set<string>(),
    [currentProject, panel]
  )

  const resolvePanelContext = useCallback(
    (_position: { x: number; y: number }, elementId: string | null) => {
      if (!currentProject) return null

      let targetPanel =
        effectivePanelCanvasMode.kind === 'panel'
          ? (getPanelById(effectivePanelCanvasMode.panelId) ?? null)
          : elementId
            ? (getPanelById(elementId) ?? null)
            : null

      if (!targetPanel && elementId) {
        targetPanel =
          panelList.find((option) =>
            getPanelGridModules(option.id).some(
              (item) => panelGridModuleRefKey(item.ref) === elementId
            )
          )?.panel ?? null
      }

      if (!targetPanel && effectiveActivePanelId) {
        targetPanel = getPanelById(effectiveActivePanelId) ?? null
      }
      if (!targetPanel) return null

      return {
        panel: targetPanel,
        panelId: targetPanel.id,
        modules: getPanelGridModules(targetPanel.id).filter(
          (item) => !(item.ref.kind === 'trunkDevice' && item.ref.scope === 'ground')
        ),
        sharedSupplyRefKeys: getSharedSupplyRefKeysForPanel(currentProject, targetPanel),
      }
    },
    [
      currentProject,
      effectiveActivePanelId,
      effectivePanelCanvasMode,
      getPanelById,
      getPanelGridModules,
      panelList,
    ]
  )
  const supplyPanelVisibleForPanel = !!(panel?.isMain && supplyModules.length > 0)
  const placements = useMemo(() => {
    if (!panel || !currentProject) return []
    return getPanelGridPlacements(panel, currentProject, mainModules)
  }, [panel, currentProject, mainModules])
  const overflowModuleCount = useMemo(() => {
    if (!panel || !currentProject) return 0
    const visiblePanels =
      effectivePanelCanvasMode.kind === 'all'
        ? panelList.map((panelOption) => panelOption.panel)
        : [panel]
    return visiblePanels.reduce((count, visiblePanel) => {
      const visibleModules = getPanelGridModules(visiblePanel.id).filter(
        (module) => !(module.ref.kind === 'trunkDevice' && module.ref.scope === 'ground')
      )
      return (
        count + getPanelCanvasOverflowModuleKeys(visiblePanel, currentProject, visibleModules).size
      )
    }, 0)
  }, [currentProject, effectivePanelCanvasMode, getPanelGridModules, panel, panelList])
  const supplyPlacements = useMemo(() => {
    if (!panel || !currentProject) return []
    return getSupplyPanelPlacements(panel, currentProject, supplyModules)
  }, [panel, currentProject, supplyModules])

  const moduleWidthOverrides = useMemo(() => {
    const map = new Map<string, number | undefined>()
    for (const m of modules) {
      const key = panelGridModuleRefKey(m.ref)
      const s = m.slot
      if (s?.moduleWidthManual === true && s.moduleWidth != null) {
        map.set(key, s.moduleWidth)
      } else {
        map.set(key, undefined)
      }
    }
    return map
  }, [modules])

  // A store update can legitimately normalize a proposed slot away (for example while
  // healing transitional panel data). Do not retry the exact same rejected proposal on
  // every render: that would create a synchronous React -> Zustand -> React update loop.
  const slotPersistenceAttemptRef = useRef<{ main?: string; supply?: string }>({})

  const rebalanceSupplyOverflowIntoMain = useCallback(
    (targetPanel: Panel, targetProject: Project) =>
      rebalanceSupplyOverflowSlotsIntoMain(targetPanel, targetProject),
    []
  )

  const placeSupplyModuleAfterInsert = useCallback(
    (
      targetPanel: Panel,
      targetProject: Project,
      moduleRef: PanelGridModuleRef,
      preferredRow?: number,
      preferredCol?: number
    ) =>
      planSupplyModuleSlotsAfterInsert(
        targetPanel,
        targetProject,
        moduleRef,
        preferredRow,
        preferredCol
      ),
    []
  )

  const buildAutoArrangeSlots = useCallback(
    (targetPanel: Panel, targetProject: Project) =>
      buildPanelAutoArrangeSlots({
        feedSideDirection,
        getPanelGridModules,
        targetPanel,
        targetProject,
      }),
    [feedSideDirection, getPanelGridModules]
  )

  // Prevent implicit reflow/compaction: once a module appears with a computed placement
  // but has no stored slot yet, persist that slot so future renders stay manual/stable.
  useEffect(() => {
    if (!panel || !currentProject) return

    const latestPanel = getPanelById(panel.id) ?? panel
    const existingMainSlots = latestPanel.gridView?.slots ?? []
    const existingSupplySlots = latestPanel.gridView?.supplyPanelSlots ?? []
    const existingMainKeys = new Set(
      existingMainSlots.map((s: PanelGridSlot) => panelGridModuleRefKey(s.module))
    )
    const existingSupplyKeys = new Set(
      existingSupplySlots.map((s: PanelGridSlot) => panelGridModuleRefKey(s.module))
    )

    const mainAdds: PanelGridSlot[] = []
    for (const pl of placements) {
      const key = panelGridModuleRefKey(pl.ref)
      if (existingMainKeys.has(key)) continue
      // Shared supply trunks live in the supply strip. Root-local supply trunks belong in
      // the main panel body and must be allowed to persist there.
      if (latestPanel.isMain && sharedSupplyRefKeys.has(key)) {
        continue
      }
      // Must match store filtering in updatePanelGridSlots; otherwise invalid refs never persist
      // and this effect re-runs until React hits max update depth.
      try {
        if (!isModuleRefValid(pl.ref, currentProject)) continue
      } catch {
        continue
      }
      mainAdds.push({
        row: pl.row,
        col: pl.col,
        module: pl.ref,
      })
    }

    const supplyAdds: PanelGridSlot[] = []
    for (const pl of supplyPlacements) {
      const key = panelGridModuleRefKey(pl.ref)
      if (existingSupplyKeys.has(key)) continue
      try {
        if (!isModuleRefValid(pl.ref, currentProject)) continue
      } catch {
        continue
      }
      supplyAdds.push({
        row: pl.row,
        col: pl.col,
        module: pl.ref,
      })
    }

    if (mainAdds.length === 0) {
      slotPersistenceAttemptRef.current.main = undefined
    } else {
      const nextMainSlots = [...existingMainSlots, ...mainAdds]
      const attemptKey = `${latestPanel.id}:${nextMainSlots
        .map(panelGridSlotPersistenceKey)
        .join('|')}`
      if (slotPersistenceAttemptRef.current.main !== attemptKey) {
        slotPersistenceAttemptRef.current.main = attemptKey
        updatePanelGridSlots(latestPanel.id, nextMainSlots)
      }
    }
    if (supplyAdds.length === 0) {
      slotPersistenceAttemptRef.current.supply = undefined
    } else {
      const nextSupplySlots = [...existingSupplySlots, ...supplyAdds]
      const attemptKey = `${latestPanel.id}:${nextSupplySlots
        .map(panelGridSlotPersistenceKey)
        .join('|')}`
      if (slotPersistenceAttemptRef.current.supply !== attemptKey) {
        slotPersistenceAttemptRef.current.supply = attemptKey
        updateSupplyPanelSlots(latestPanel.id, nextSupplySlots)
      }
    }
  }, [
    panel,
    currentProject,
    getPanelById,
    placements,
    sharedSupplyRefKeys,
    supplyPlacements,
    updatePanelGridSlots,
    updateSupplyPanelSlots,
  ])

  useEffect(() => {
    if (!panel || !currentProject || !panel.isMain) return

    const supplySlots = panel.gridView?.supplyPanelSlots ?? []
    if (supplySlots.length === 0) return
    const { rows: supplyRows, cols: supplyCols } = getSupplyPanelLayout(panel)
    const seenCells = new Set<string>()
    const mainKeys = new Set(
      (panel.gridView?.slots ?? []).map((slot: PanelGridSlot) => panelGridModuleRefKey(slot.module))
    )
    let hasIllegalSupplyLayout = false

    for (const slot of supplySlots) {
      const key = panelGridModuleRefKey(slot.module)
      const width = Math.max(1, resolveModuleWidthCols(slot.module, currentProject, slot))
      if (
        slot.row < 0 ||
        slot.row >= supplyRows ||
        slot.col < 0 ||
        slot.col + width > supplyCols ||
        mainKeys.has(key)
      ) {
        hasIllegalSupplyLayout = true
        break
      }
      for (let i = 0; i < width; i++) {
        const cellKey = `${slot.row},${slot.col + i}`
        if (seenCells.has(cellKey)) {
          hasIllegalSupplyLayout = true
          break
        }
        seenCells.add(cellKey)
      }
      if (hasIllegalSupplyLayout) break
    }

    if (!hasIllegalSupplyLayout) return

    const { mainSlots, supplySlots: normalizedSupplySlots } = rebalanceSupplyOverflowIntoMain(
      panel,
      currentProject
    )
    if (
      arePanelGridSlotArraysEqual(panel.gridView?.slots ?? [], mainSlots) &&
      arePanelGridSlotArraysEqual(supplySlots, normalizedSupplySlots)
    ) {
      return
    }
    updatePanelGridSlots(panel.id, mainSlots)
    updateSupplyPanelSlots(panel.id, normalizedSupplySlots)
  }, [
    panel,
    currentProject,
    rebalanceSupplyOverflowIntoMain,
    updatePanelGridSlots,
    updateSupplyPanelSlots,
  ])

  // Selection bounds for panel modules (protections, trunk devices, domotica endpoints)
  const handleGetSelectionBounds = useCallback(() => {
    const { selection } = useUIStore.getState()
    if (!panel) return null
    if (!selection.type || selection.ids.length === 0) return null
    const frameMargin = 40
    const supplyGap = 20
    const rows = panel.gridView?.rows ?? DEFAULT_PANEL_GRID_ROWS
    const cols = panel.gridView?.columns ?? DEFAULT_PANEL_GRID_COLUMNS
    const supplyLayout = getSupplyPanelLayout(panel)
    const contentWidth = cols * CELL_W
    const contentHeight = rows * CELL_H + (rows - 1) * ROW_GAP
    const panelFrameWidth = contentWidth + frameMargin * 2
    const panelFrameHeight = contentHeight + frameMargin * 2
    const supplyPanelVisible = supplyPanelVisibleForPanel
    const feedFromTop = panel.gridView?.feedFromTop ?? false
    const supplyFrameHeight = supplyLayout.contentHeight + frameMargin * 2
    const supplyFrameWidth = supplyLayout.contentWidth + frameMargin * 2
    const mainPanelY = supplyPanelVisible && feedFromTop ? supplyFrameHeight + supplyGap : 0
    const supplyPanelY = supplyPanelVisible && !feedFromTop ? panelFrameHeight + supplyGap : 0

    if (selection.type === 'panel') {
      const selectedPanelIds = new Set(selection.ids)
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      let found = false
      const localContentHeight = rows * CELL_H + (rows - 1) * ROW_GAP
      const localPanelFrameHeight = localContentHeight + frameMargin * 2
      const localSupplyFrameHeight = supplyFrameHeight
      const totalPanelHeight =
        localPanelFrameHeight +
        (supplyPanelVisibleForPanel ? localSupplyFrameHeight + supplyGap : 0)

      if (selectedPanelIds.has(panel.id)) {
        minX = 0
        minY = 0
        maxX = panelFrameWidth
        maxY = totalPanelHeight
        found = true
      }

      const allPlacements = [
        ...placements.map((pl) => ({
          ...pl,
          x: pl.x + frameMargin,
          y: pl.y + mainPanelY + frameMargin,
        })),
        ...supplyPlacements.map((pl) => ({
          ...pl,
          x: pl.x + frameMargin,
          y: pl.y + supplyPanelY + frameMargin,
        })),
      ]

      for (const pl of allPlacements) {
        if (pl.ref.kind !== 'domotica') continue
        const endpoint = getEndpointById(pl.ref.endpointId)
        if (endpoint?.symbol !== 'panel_distribution' || !endpoint.panelId) continue
        if (!selectedPanelIds.has(endpoint.panelId)) continue
        minX = Math.min(minX, pl.x)
        minY = Math.min(minY, pl.y)
        maxX = Math.max(maxX, pl.x + pl.width)
        maxY = Math.max(maxY, pl.y + pl.height)
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

    if (selection.type === 'supplyPanel') {
      const selectedSupplyPanelIds = new Set(selection.ids)
      if (!selectedSupplyPanelIds.has(panel.id) || !supplyPanelVisibleForPanel) return null
      return {
        x: 0,
        y: supplyPanelY,
        width: supplyFrameWidth,
        height: supplyFrameHeight,
      }
    }

    // Map current selection to module ref keys
    const selectedKeys = new Set<string>()
    modules.forEach((moduleItem: ModuleItem) => {
      if (!moduleRefMatchesSelection(moduleItem.ref, selection)) return
      selectedKeys.add(panelGridModuleRefKey(moduleItem.ref))
    })

    if (selectedKeys.size === 0) return null

    // Convert module placements to the same canvas coordinate space as rendered modules:
    // - apply main/supply panel vertical offsets
    // - apply panel frame Group offset (FRAME_MARGIN on x/y)
    const allPlacements = [
      ...placements.map((pl) => ({
        ...pl,
        x: pl.x + frameMargin,
        y: pl.y + mainPanelY + frameMargin,
      })),
      ...supplyPlacements.map((pl) => ({
        ...pl,
        x: pl.x + frameMargin,
        y: pl.y + supplyPanelY + frameMargin,
      })),
    ]

    return getModuleSelectionBounds(
      allPlacements.filter((placement) => selectedKeys.has(panelGridModuleRefKey(placement.ref))),
      selection
    )
  }, [panel, modules, placements, supplyPlacements, getEndpointById, supplyPanelVisibleForPanel])

  const selectedRef = useMemo((): PanelGridModuleRef | null => {
    if (!selection.type || selection.ids.length === 0) return null
    const id = selection.ids[0]
    if (id == null) return null
    if (selection.type === 'protection') return { kind: 'protection', id }
    if (selection.type === 'trunkDevice') {
      const mod = modules.find(
        (m: { ref: PanelGridModuleRef }) => m.ref.kind === 'trunkDevice' && m.ref.id === id
      )
      return mod?.ref ?? null
    }
    if (selection.type === 'endpoint') {
      const mod = modules.find(
        (m: { ref: PanelGridModuleRef }) => m.ref.kind === 'domotica' && m.ref.endpointId === id
      )
      return mod?.ref ?? null
    }
    return null
  }, [selection.type, selection.ids, modules])

  const [dragOverride, setDragOverride] = useState<{
    ref: PanelGridModuleRef
    x: number
    y: number
  } | null>(null)
  const [moduleDropPreview, setModuleDropPreview] = useState<HierarchyDragPreview | null>(null)

  // Multi-drag: local preview so we don't update store on every move (like PlanCanvas wall points).
  const multiDragInitialRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const multiDragPreviewRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const [multiDragPreviewTick, setMultiDragPreviewTick] = useState(0)

  const isRefInSelection = useCallback(
    (ref: PanelGridModuleRef, sel: { type: string | null; ids: string[] }) => {
      if (sel.ids.length === 0) return false
      if (ref.kind === 'protection') return sel.ids.includes(ref.id)
      if (ref.kind === 'trunkDevice') return sel.ids.includes(ref.id)
      if (ref.kind === 'domotica') return sel.ids.includes(ref.endpointId)
      return false
    },
    []
  )
  const [tooltip, setTooltip] = useState<ModuleTooltipData | null>(null)
  void tooltip
  void setTooltip
  const [hoveredModuleRef, setHoveredModuleRef] = useState<PanelGridModuleRef | null>(null)
  void setHoveredModuleRef
  const ghostWiresGroupRef = useRef<Konva.Group>(null)
  // Re-raise ghost wires above whichever module just called moveToTop().
  // Module useEffects (child) run before PanelCanvas useEffect (parent), so
  // by the time this fires the module is already on top — we just go one higher.
  useEffect(() => {
    ghostWiresGroupRef.current?.moveToTop()
  }, [hoveredModuleRef, selectedRef])
  const [assignToCircuitMode, setAssignToCircuitMode] = useState(false)
  const [rewireMode, setRewireMode] = useState(false)
  void setRewireMode
  const [rewireOriginRef, setRewireOriginRef] = useState<PanelGridModuleRef | null>(null)
  const [rewireDragPos, setRewireDragPos] = useState<{ x: number; y: number } | null>(null)
  const [rewireTargetRef, setRewireTargetRef] = useState<PanelGridModuleRef | null>(null)
  const [rewireTargetValid, setRewireTargetValid] = useState<boolean>(true)
  const handleAssignTargetClick = useCallback(
    (ref: PanelGridModuleRef) => {
      if (!panel || !currentProject) return
      const targetCircuitId = getCircuitIdFromModuleRef(ref, panel, currentProject)
      if (!targetCircuitId) {
        setAssignToCircuitMode(false)
        return
      }
      for (const endpointId of selection.ids) {
        moveEndpointToCircuit(endpointId, targetCircuitId)
      }
      setAssignToCircuitMode(false)
      clearSelection()
    },
    [panel, currentProject, selection.ids, moveEndpointToCircuit, clearSelection]
  )

  // Persist canonical active panel to store so export and other consumers stay in sync.
  useEffect(() => {
    if (effectivePanelCanvasMode.kind !== 'panel') return
    if (effectivePanelCanvasMode.panelId !== activePanelId) {
      setActivePanelId(effectivePanelCanvasMode.panelId)
    }
  }, [activePanelId, effectivePanelCanvasMode, setActivePanelId])

  const withJunctionEditorItem = useJunctionEditorMenu()
  const basePanelContextMenuItems = usePanelContextMenu({
    canDeleteItems,
    clearSelection,
    effectiveActivePanelId,
    ejectToSupplyPanel,
    getEndpointById,
    getPanelHiddenModuleRefs,
    getProtectionById,
    getTrunkDeviceById,
    hideModuleFromPanel,
    modules,
    openDialog,
    panel,
    returnFromSupplyPanel,
    resolvePanelContext,
    selection,
    setSupplyPanelVisible,
    sharedSupplyRefKeys,
    t,
  })
  const handleGetContextMenuItems = useCallback(
    (position: import('@/types/ui').Point, elementId: string | null) =>
      withJunctionEditorItem(basePanelContextMenuItems(position, elementId), [
        elementId,
        ...useUIStore.getState().selection.ids,
      ]),
    [basePanelContextMenuItems, withJunctionEditorItem]
  )

  // Calculate panel frame dimensions with margin
  const FRAME_MARGIN = 40
  const SUPPLY_GAP = 20
  const rows = panel?.gridView?.rows ?? DEFAULT_PANEL_GRID_ROWS
  const cols = panel?.gridView?.columns ?? DEFAULT_PANEL_GRID_COLUMNS
  const supplyLayout = getSupplyPanelLayout(panel)
  const contentWidth = cols * CELL_W
  const contentHeight = rows * CELL_H + (rows - 1) * ROW_GAP // Include gaps between rows
  const panelFrameHeight = contentHeight + FRAME_MARGIN * 2
  const supplyPanelVisible = supplyPanelVisibleForPanel
  const supplyContentWidth = supplyLayout.contentWidth
  const supplyContentHeight = supplyLayout.contentHeight
  const supplyFrameHeight = supplyContentHeight + FRAME_MARGIN * 2
  const feedFromTop = panel?.gridView?.feedFromTop ?? false
  const mainPanelY = supplyPanelVisible && feedFromTop ? supplyFrameHeight + SUPPLY_GAP : 0
  const supplyPanelY = supplyPanelVisible && !feedFromTop ? panelFrameHeight + SUPPLY_GAP : 0

  const combinedPlacements = useMemo(() => {
    const main = placements.map((p) => ({
      ...p,
      y: p.y + mainPanelY,
      inSupplyPanel: false as const,
    }))
    const supply = supplyPlacements.map((p) => ({
      ...p,
      y: p.y + supplyPanelY,
      inSupplyPanel: true as const,
    }))
    return [...main, ...supply]
  }, [placements, supplyPlacements, mainPanelY, supplyPanelY])

  const handleModuleDragMove = useCallback(
    (ref: PanelGridModuleRef, x: number, y: number) => {
      const draggedPlacement = combinedPlacements.find(
        (placement) => panelGridModuleRefKey(placement.ref) === panelGridModuleRefKey(ref)
      )
      if (draggedPlacement) {
        const currentRows = panel?.gridView?.rows ?? DEFAULT_PANEL_GRID_ROWS
        const currentCols = panel?.gridView?.columns ?? DEFAULT_PANEL_GRID_COLUMNS
        const currentSupplyLayout = getSupplyPanelLayout(panel)
        const inSupply = draggedPlacement.inSupplyPanel === true
        const localY = y - (inSupply ? supplyPanelY : mainPanelY)
        const snappedBase = snapToGrid(x, localY + CELL_H / 2)
        const moduleW = Math.max(
          1,
          moduleWidthOverrides.get(panelGridModuleRefKey(ref)) ??
            getModuleWidthInCols(ref, currentProject)
        )
        const snappedRow = Math.max(
          0,
          Math.min((inSupply ? currentSupplyLayout.rows : currentRows) - 1, snappedBase.row)
        )
        const snappedCol = Math.max(
          0,
          Math.min((inSupply ? currentSupplyLayout.cols : currentCols) - moduleW, snappedBase.col)
        )
        const initial = multiDragInitialRef.current
        if (initial.size > 1 && initial.has(panelGridModuleRefKey(ref))) {
          const deltaRow = snappedRow - draggedPlacement.row
          const deltaCol = snappedCol - draggedPlacement.col
          const selectedPlacements = combinedPlacements.filter((placement) =>
            initial.has(panelGridModuleRefKey(placement.ref))
          )
          setModuleDropPreview({
            panelId: panel?.id ?? 'panel',
            x: snappedCol * CELL_W,
            y: (inSupply ? supplyPanelY : mainPanelY) + snappedRow * ROW_STRIDE,
            width: draggedPlacement.width,
            height: draggedPlacement.height,
            ref,
            items: selectedPlacements.map((placement) => ({
              ref: placement.ref,
              x: (placement.col + deltaCol) * CELL_W,
              y:
                (placement.inSupplyPanel ? supplyPanelY : mainPanelY) +
                (placement.row + deltaRow) * ROW_STRIDE,
              width: placement.width,
              height: placement.height,
            })),
          })
        } else {
          setModuleDropPreview({
            panelId: panel?.id ?? 'panel',
            x: snappedCol * CELL_W,
            y: (inSupply ? supplyPanelY : mainPanelY) + snappedRow * ROW_STRIDE,
            width: draggedPlacement.width,
            height: draggedPlacement.height,
            ref,
          })
        }
      }
      const initial = multiDragInitialRef.current
      if (initial.size > 0) {
        const key = panelGridModuleRefKey(ref)
        const start = initial.get(key)
        if (start != null) {
          const dx = x - start.x
          const dy = y - start.y
          const preview = multiDragPreviewRef.current
          for (const [k, pos] of initial) {
            preview.set(k, { x: pos.x + dx, y: pos.y + dy })
          }
          setMultiDragPreviewTick((t) => t + 1)
          return
        }
      }
      setDragOverride({ ref, x, y })
    },
    [combinedPlacements, currentProject, mainPanelY, moduleWidthOverrides, panel, supplyPanelY]
  )
  void handleModuleDragMove

  const handleMultiDragStart = useCallback(
    (ref: PanelGridModuleRef, _x: number, _y: number) => {
      const draggedPl = combinedPlacements.find(
        (p) => panelGridModuleRefKey(p.ref) === panelGridModuleRefKey(ref)
      )
      if (!draggedPl) return
      const inSupply = draggedPl.inSupplyPanel
      const selectedInZone = combinedPlacements.filter(
        (pl) => pl.inSupplyPanel === inSupply && isRefInSelection(pl.ref, selection)
      )
      if (selectedInZone.length < 2) return
      const initial = multiDragInitialRef.current
      const preview = multiDragPreviewRef.current
      initial.clear()
      preview.clear()
      for (const pl of selectedInZone) {
        const key = panelGridModuleRefKey(pl.ref)
        initial.set(key, { x: pl.x, y: pl.y })
        preview.set(key, { x: pl.x, y: pl.y })
      }
      setMultiDragPreviewTick(1)
    },
    [combinedPlacements, selection, isRefInSelection]
  )
  void handleMultiDragStart

  const effectivePlacements = useMemo(() => {
    if (multiDragPreviewTick === 0 || multiDragPreviewRef.current.size === 0)
      return combinedPlacements
    const preview = multiDragPreviewRef.current
    return combinedPlacements.map((pl) => {
      const key = panelGridModuleRefKey(pl.ref)
      const pos = preview.get(key)
      if (pos != null) return { ...pl, x: pos.x, y: pos.y }
      return pl
    })
  }, [combinedPlacements, multiDragPreviewTick])

  const onFindElementsInRectangle = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      logger.warn('[PanelCanvas drag-rect] hit-test start', {
        panelId: panel?.id ?? null,
        rect,
        placementCount: combinedPlacements.length,
      })
      const out: Array<{ id: string; type: 'protection' | 'trunkDevice' | 'endpoint' | 'panel' }> =
        []
      for (const pl of combinedPlacements) {
        const renderBox = {
          x: pl.x + FRAME_MARGIN,
          y: pl.y + FRAME_MARGIN,
          width: pl.width,
          height: pl.height,
        }
        const fullyContained = rectContainsRect(rect, renderBox)
        logger.warn('[PanelCanvas drag-rect] placement check', {
          ref: pl.ref,
          inSupplyPanel: (pl as { inSupplyPanel?: boolean }).inSupplyPanel ?? false,
          row: pl.row,
          col: pl.col,
          renderBox,
          fullyContained,
        })
        if (!fullyContained) continue
        if (pl.ref.kind === 'protection') {
          out.push({ id: pl.ref.id, type: 'protection' })
        } else if (pl.ref.kind === 'trunkDevice') {
          out.push({ id: pl.ref.id, type: 'trunkDevice' })
        } else {
          const endpoint = getEndpointById(pl.ref.endpointId)
          if (endpoint?.symbol === 'panel_distribution' && endpoint.panelId) {
            out.push({ id: endpoint.panelId, type: 'panel' })
          } else {
            out.push({ id: pl.ref.endpointId, type: 'endpoint' })
          }
        }
      }
      logger.warn('[PanelCanvas drag-rect] hit-test result', {
        panelId: panel?.id ?? null,
        rect,
        hits: out,
      })
      return out
    },
    [combinedPlacements, getEndpointById, panel?.id]
  )

  const supplyWireTarget = useMemo(() => {
    if (!panel || !panel.isMain || !currentProject) return null

    const supplyDevices =
      getProjectElectricalInstallation(currentProject)?.mainSupply?.supplyTrunkDevices ?? []

    // The first module in the supply chain is the first visible supply trunk device (uses effectivePlacements so multi-drag preview is included)
    for (const device of supplyDevices) {
      const ref: PanelGridModuleRef = { kind: 'trunkDevice', id: device.id, scope: 'supply' }
      const key = panelGridModuleRefKey(ref)
      const pl = effectivePlacements.find((p) => panelGridModuleRefKey(p.ref) === key)
      if (pl) {
        if (dragOverride && panelGridModuleRefKey(dragOverride.ref) === key) {
          return { ...pl, x: dragOverride.x, y: dragOverride.y }
        }
        return pl
      }
    }

    // No supply trunk devices placed — fall back to closest main-bus protection
    const withSupplyParent = effectivePlacements.filter((p) => {
      if (p.ref.kind !== 'protection') return false
      const { parentRefs } = getRelationEdges(p.ref, panel, currentProject)
      return parentRefs.some((r) => r.kind === 'trunkDevice' && r.scope === 'supply')
    })
    if (withSupplyParent.length === 0) return null

    const sorted = [...withSupplyParent].sort((a, b) =>
      feedFromTop
        ? a.row !== b.row
          ? a.row - b.row
          : a.col - b.col
        : a.row !== b.row
          ? b.row - a.row
          : a.col - b.col
    )
    const best = sorted[0] ?? null
    if (
      best &&
      dragOverride &&
      panelGridModuleRefKey(dragOverride.ref) === panelGridModuleRefKey(best.ref)
    ) {
      return { ...best, x: dragOverride.x, y: dragOverride.y }
    }
    return best
  }, [panel, currentProject, effectivePlacements, feedFromTop, dragOverride])

  const subPanelFeedWireTarget = useMemo(() => {
    if (!panel || panel.isMain || !currentProject) return null

    const panelCircuit = panel.circuits?.find((c: Circuit) => c.code === 'PANEL')
    const sortedTrunks = panelCircuit?.trunkDevices?.length
      ? [...panelCircuit.trunkDevices].sort(
          (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
        )
      : []

    for (const d of sortedTrunks) {
      const ref: PanelGridModuleRef = {
        kind: 'trunkDevice',
        id: d.id,
        scope: 'circuit',
        circuitId: panelCircuit!.id,
      }
      const key = panelGridModuleRefKey(ref)
      const pl = effectivePlacements.find((p) => panelGridModuleRefKey(p.ref) === key)
      if (pl) {
        if (dragOverride && panelGridModuleRefKey(dragOverride.ref) === key) {
          return { ...pl, x: dragOverride.x, y: dragOverride.y }
        }
        return pl
      }
    }

    if (panelCircuit) {
      const withIncoming = effectivePlacements.filter((p) => {
        if (p.ref.kind !== 'protection') return false
        const { parentRefs } = getRelationEdges(p.ref, panel, currentProject)
        return parentRefs.some(
          (r) =>
            r.kind === 'trunkDevice' && r.scope === 'circuit' && r.circuitId === panelCircuit.id
        )
      })
      if (withIncoming.length > 0) {
        const sorted = [...withIncoming].sort((a, b) =>
          feedFromTop
            ? a.row !== b.row
              ? a.row - b.row
              : a.col - b.col
            : a.row !== b.row
              ? b.row - a.row
              : a.col - b.col
        )
        const best = sorted[0] ?? null
        if (
          best &&
          dragOverride &&
          panelGridModuleRefKey(dragOverride.ref) === panelGridModuleRefKey(best.ref)
        ) {
          return { ...best, x: dragOverride.x, y: dragOverride.y }
        }
        if (best) return best
      }
    }

    if (effectivePlacements.length === 0) return null
    const sorted = [...effectivePlacements].sort((a, b) =>
      feedFromTop
        ? a.row !== b.row
          ? a.row - b.row
          : a.col - b.col
        : a.row !== b.row
          ? b.row - a.row
          : a.col - b.col
    )
    const first = sorted[0] ?? null
    if (
      first &&
      dragOverride &&
      panelGridModuleRefKey(dragOverride.ref) === panelGridModuleRefKey(first.ref)
    ) {
      return { ...first, x: dragOverride.x, y: dragOverride.y }
    }
    return first
  }, [panel, currentProject, effectivePlacements, feedFromTop, dragOverride])

  const supplyLineRef = useRef<Konva.Line>(null)
  const subPanelFeedLineRef = useRef<Konva.Line>(null)
  const incomingFeedAnimRef = useRef<Konva.Animation | null>(null)
  const supplyWireSelected = !!(
    supplyWireTarget &&
    selectedRef &&
    panelGridModuleRefKey(supplyWireTarget.ref) === panelGridModuleRefKey(selectedRef)
  )
  const subPanelFeedWireSelected = !!(
    subPanelFeedWireTarget &&
    selectedRef &&
    panelGridModuleRefKey(subPanelFeedWireTarget.ref) === panelGridModuleRefKey(selectedRef)
  )
  const reducedPanelEffects = isTouchDevice || isSafariBrowser
  const animatePanelWires = true // Animated dashes on wires; not a perf cause, kept for all devices
  const simplifyPanelBackdrop = reducedPanelEffects
  void simplifyPanelBackdrop
  const singlePanelFramePointerDownRef = useRef<{ x: number; y: number } | null>(null)
  void singlePanelFramePointerDownRef
  const pendingSinglePanelFrameSelectCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const cleanup = pendingSinglePanelFrameSelectCleanupRef.current
    return () => {
      cleanup?.()
    }
  }, [])

  useEffect(() => {
    const stop = () => {
      if (incomingFeedAnimRef.current) {
        incomingFeedAnimRef.current.stop()
        incomingFeedAnimRef.current = null
      }
    }
    if (!animatePanelWires) {
      stop()
      return
    }
    const shouldAnimate = supplyWireSelected || subPanelFeedWireSelected
    if (!shouldAnimate) {
      stop()
      return
    }

    const DASH_TOTAL = 12
    const SPEED = 30
    const frameId = requestAnimationFrame(() => {
      const line = supplyWireSelected ? supplyLineRef.current : subPanelFeedLineRef.current
      if (!line) return
      const layer = line.getLayer()
      const anim = new Konva.Animation(() => {
        const offset = ((performance.now() * SPEED) / 1000) % DASH_TOTAL
        line.dashOffset(offset)
      }, layer)
      anim.start()
      incomingFeedAnimRef.current = anim
    })

    return () => {
      cancelAnimationFrame(frameId)
      stop()
    }
  }, [supplyWireSelected, subPanelFeedWireSelected, animatePanelWires])

  // Validate if a rewire operation is valid
  const validateRewireOperation = useCallback(
    (origin: PanelGridModuleRef, target: PanelGridModuleRef): boolean =>
      validatePanelRewireOperation(panel, currentProject, origin, target),
    [panel, currentProject]
  )
  void validateRewireOperation

  const resetRewireState = useCallback(() => {
    setRewireOriginRef(null)
    setRewireDragPos(null)
    setRewireTargetRef(null)
    setRewireTargetValid(true)
  }, [])
  void resetRewireState

  const handleCombinedDragEnd = useCallback(
    (draggedRef: PanelGridModuleRef, rawX: number, rawY: number) => {
      logger.warn('[PanelCanvas drag] handleCombinedDragEnd:start', {
        draggedRef,
        rawX,
        rawY,
        panelId: panel?.id ?? null,
        selection: useUIStore.getState().selection,
      })
      multiDragInitialRef.current.clear()
      multiDragPreviewRef.current.clear()
      setMultiDragPreviewTick(0)
      setDragOverride(null)
      setModuleDropPreview(null)
      if (!panel) {
        logger.warn('[PanelCanvas drag] handleCombinedDragEnd:abort:no-panel')
        return
      }

      // Rewire mode is handled by handleRewireDragEnd, not here

      const totalRows = panel.gridView?.rows ?? DEFAULT_PANEL_GRID_ROWS
      const totalCols = panel.gridView?.columns ?? DEFAULT_PANEL_GRID_COLUMNS
      const draggedKey = panelGridModuleRefKey(draggedRef)

      const isRefInSelection = (
        ref: PanelGridModuleRef,
        sel: { type: string | null; ids: string[] }
      ) => {
        if (sel.ids.length === 0) return false
        if (ref.kind === 'protection') return sel.ids.includes(ref.id)
        if (ref.kind === 'trunkDevice') return sel.ids.includes(ref.id)
        if (ref.kind === 'domotica') return sel.ids.includes(ref.endpointId)
        return false
      }

      const mod = modules.find((m: ModuleItem) => panelGridModuleRefKey(m.ref) === draggedKey)
      const wasInSupply = mod?.inSupplyPanel === true
      const isSupplyScope = draggedRef.kind === 'trunkDevice' && draggedRef.scope === 'supply'
      const isSharedSupplyScope =
        isSupplyScope &&
        !!currentProject &&
        isSharedSupplyTrunkRef(currentProject, panel, draggedRef)
      const supplyRows = supplyLayout.rows
      const supplyCols = supplyLayout.cols

      // Module width in columns — used to clamp col so module never overflows the grid
      const moduleW = Math.max(
        1,
        moduleWidthOverrides.get(draggedKey) ?? getModuleWidthInCols(draggedRef, currentProject)
      )
      const maxCol = Math.max(0, totalCols - moduleW)
      const maxSupplyCol = Math.max(0, supplyCols - moduleW)

      // Zone detection via panel frame bounds (in FRAME_MARGIN group coords)
      const mainFrameTop = mainPanelY - FRAME_MARGIN
      const mainFrameBottom = mainPanelY + contentHeight + FRAME_MARGIN
      const supFrameTop = supplyPanelY - FRAME_MARGIN
      const supFrameBottom = supplyPanelY + supplyContentHeight + FRAME_MARGIN
      const frameLeft = -FRAME_MARGIN
      const mainFrameRight = contentWidth + FRAME_MARGIN
      const supplyFrameRight = supplyContentWidth + FRAME_MARGIN

      const inMainFrame =
        rawX >= frameLeft &&
        rawX <= mainFrameRight &&
        rawY >= mainFrameTop &&
        rawY <= mainFrameBottom
      const inSupplyFrame =
        supplyPanelVisible &&
        rawX >= frameLeft &&
        rawX <= supplyFrameRight &&
        rawY >= supFrameTop &&
        rawY <= supFrameBottom

      let targetZone: 'main' | 'supply' | 'outside'
      if (inMainFrame && inSupplyFrame) {
        const dMain = Math.min(
          Math.abs(rawY - mainPanelY),
          Math.abs(rawY - (mainPanelY + contentHeight))
        )
        const dSup = Math.min(
          Math.abs(rawY - supplyPanelY),
          Math.abs(rawY - (supplyPanelY + supplyContentHeight))
        )
        targetZone = dMain <= dSup ? 'main' : 'supply'
      } else if (inMainFrame) {
        targetZone = 'main'
      } else if (inSupplyFrame) {
        targetZone = 'supply'
      } else {
        targetZone = 'outside'
      }
      logger.warn('[PanelCanvas drag] zone-detect', {
        targetZone,
        wasInSupply,
        inMainFrame,
        inSupplyFrame,
        isSharedSupplyScope,
      })

      // Helper: move a module from supply panel to main panel at a specific position,
      // preserving only explicit user width overrides.
      const transferSupplyToMain = (row: number, col: number) => {
        const supplySlots = panel.gridView?.supplyPanelSlots ?? []
        const supplySlot = supplySlots.find(
          (s: PanelGridSlot) => panelGridModuleRefKey(s.module) === draggedKey
        )
        const manual =
          supplySlot?.moduleWidthManual === true && supplySlot.moduleWidth != null
            ? { moduleWidth: supplySlot.moduleWidth, moduleWidthManual: true as const }
            : moduleWidthOverrides.get(draggedKey) != null
              ? {
                  moduleWidth: moduleWidthOverrides.get(draggedKey)!,
                  moduleWidthManual: true as const,
                }
              : {}
        const newSupplySlots = supplySlots.filter(
          (s: PanelGridSlot) => panelGridModuleRefKey(s.module) !== draggedKey
        )

        const mainSlots = panel.gridView?.slots ?? []
        const newMainSlots = [...mainSlots, { row, col, ...manual, module: draggedRef }]

        updatePanelGridSlots(panel.id, newMainSlots)
        updateSupplyPanelSlots(panel.id, newSupplySlots)
      }

      // Helper: compute snapped main-panel row/col from raw drop coordinates.
      const snapToMainPanel = () => {
        const localY = rawY - mainPanelY
        const snapped = snapToGrid(rawX, localY + CELL_H / 2)
        return {
          row: clamp(snapped.row, 0, totalRows - 1),
          col: clamp(maxCol, 0, snapped.col),
        }
      }

      // Helper: move a module from main panel to supply panel at a specific column,
      // preserving only explicit user width overrides.
      const transferMainToSupply = (row: number, col: number) => {
        const mainSlots = panel.gridView?.slots ?? []
        const mainSlot = mainSlots.find(
          (s: PanelGridSlot) => panelGridModuleRefKey(s.module) === draggedKey
        )
        const manual =
          mainSlot?.moduleWidthManual === true && mainSlot.moduleWidth != null
            ? { moduleWidth: mainSlot.moduleWidth, moduleWidthManual: true as const }
            : moduleWidthOverrides.get(draggedKey) != null
              ? {
                  moduleWidth: moduleWidthOverrides.get(draggedKey)!,
                  moduleWidthManual: true as const,
                }
              : {}
        const newMainSlots = mainSlots.filter(
          (s: PanelGridSlot) => panelGridModuleRefKey(s.module) !== draggedKey
        )

        const supplySlots = panel.gridView?.supplyPanelSlots ?? []
        const newSupplySlots = [...supplySlots, { row, col, ...manual, module: draggedRef }]

        updatePanelGridSlots(panel.id, newMainSlots)
        updateSupplyPanelSlots(panel.id, newSupplySlots)
      }

      const snapToSupplyPanel = () => {
        const localY = rawY - supplyPanelY
        const snapped = snapToGrid(rawX, localY + CELL_H / 2)
        return {
          row: clamp(supplyRows - 1, 0, snapped.row),
          col: clamp(maxSupplyCol, 0, snapped.col),
        }
      }

      // --- Cross-panel transitions ---
      if (wasInSupply && targetZone === 'main') {
        const { row, col } = snapToMainPanel()
        logger.warn('[PanelCanvas drag] transition:supply->main', { row, col })
        transferSupplyToMain(row, col)
        return
      }
      if (!wasInSupply && targetZone === 'supply' && isSharedSupplyScope) {
        const { row, col } = snapToSupplyPanel()
        logger.warn('[PanelCanvas drag] transition:main->supply', { row, col })
        transferMainToSupply(row, col)
        return
      }

      // --- Drops outside both panels ---
      if (targetZone === 'outside') {
        logger.warn('[PanelCanvas drag] outside-drop', { wasInSupply, isSharedSupplyScope })
        if (isSharedSupplyScope && panel.isMain) {
          if (!wasInSupply) {
            const { row, col } = snapToSupplyPanel()
            logger.warn('[PanelCanvas drag] outside->mainSupply transfer', { row, col })
            transferMainToSupply(row, col)
          } else {
            const { row, col } = snapToSupplyPanel()
            const supplySlots = panel.gridView?.supplyPanelSlots ?? []
            const newSlots = supplySlots.map((s: PanelGridSlot) =>
              panelGridModuleRefKey(s.module) === draggedKey ? { ...s, row, col } : s
            )
            logger.warn('[PanelCanvas drag] outside->supply reposition', {
              row,
              col,
              beforeCount: supplySlots.length,
              afterCount: newSlots.length,
            })
            updateSupplyPanelSlots(panel.id, newSlots)
          }
          return
        }
        if (wasInSupply) {
          const { row, col } = snapToMainPanel()
          logger.warn('[PanelCanvas drag] outside->main transfer', { row, col })
          transferSupplyToMain(row, col)
          return
        }
        // Non-supply module dropped outside → snap to closest valid main position
        targetZone = 'main'
      }

      // --- Reposition within supply panel ---
      if (targetZone === 'supply') {
        const { row: newRow, col: newCol } = snapToSupplyPanel()
        logger.warn('[PanelCanvas drag] supply-drop', { newRow, newCol })
        const supplySlots = panel.gridView?.supplyPanelSlots ?? []
        const selSupply = useUIStore.getState().selection
        const multiMoveSupply =
          wasInSupply &&
          selSupply.ids.length >= 2 &&
          (selSupply.type === 'protection' ||
            selSupply.type === 'trunkDevice' ||
            selSupply.type === 'endpoint') &&
          isRefInSelection(draggedRef, selSupply)
        if (multiMoveSupply && combinedPlacements.length > 0) {
          const selectedSupply = combinedPlacements.filter(
            (pl) => pl.inSupplyPanel && isRefInSelection(pl.ref, selSupply)
          )
          const draggedPlSupply = combinedPlacements.find(
            (pl) => panelGridModuleRefKey(pl.ref) === draggedKey && pl.inSupplyPanel
          )
          if (selectedSupply.length >= 2 && draggedPlSupply) {
            const deltaRow = newRow - draggedPlSupply.row
            const deltaCol = newCol - draggedPlSupply.col
            const proposedSupply: Array<{
              ref: PanelGridModuleRef
              row: number
              col: number
              w: number
            }> = []
            for (const pl of selectedSupply) {
              const key = panelGridModuleRefKey(pl.ref)
              const w = Math.max(
                1,
                moduleWidthOverrides.get(key) ?? getModuleWidthInCols(pl.ref, currentProject)
              )
              const row = pl.row + deltaRow
              const col = pl.col + deltaCol
              proposedSupply.push({ ref: pl.ref, row, col, w })
            }
            const inBoundsSupply = proposedSupply.every(
              (p) => p.row >= 0 && p.row < supplyRows && p.col >= 0 && p.col <= supplyCols - p.w
            )
            const occupiedSupply = new Set<string>()
            for (const pl of combinedPlacements) {
              if (!pl.inSupplyPanel) continue
              if (isRefInSelection(pl.ref, selSupply)) continue
              const key = panelGridModuleRefKey(pl.ref)
              const w = Math.max(
                1,
                moduleWidthOverrides.get(key) ?? getModuleWidthInCols(pl.ref, currentProject)
              )
              for (let i = 0; i < w; i++) occupiedSupply.add(`${pl.row},${pl.col + i}`)
            }
            let noOverlapSupply = true
            for (const p of proposedSupply) {
              for (let i = 0; i < p.w; i++) {
                if (occupiedSupply.has(`${p.row},${p.col + i}`)) {
                  noOverlapSupply = false
                  break
                }
              }
              if (!noOverlapSupply) break
              for (let i = 0; i < p.w; i++) occupiedSupply.add(`${p.row},${p.col + i}`)
            }
            if (inBoundsSupply && noOverlapSupply) {
              const selectedSupplyKeys = new Set(
                selectedSupply.map((pl) => panelGridModuleRefKey(pl.ref))
              )
              const supplyWithoutSelected = supplySlots.filter(
                (s: PanelGridSlot) => !selectedSupplyKeys.has(panelGridModuleRefKey(s.module))
              )
              const newSupplySlotsMulti: PanelGridSlot[] = [
                ...supplyWithoutSelected,
                ...proposedSupply.map((p) => {
                  const prev = supplySlots.find(
                    (s: PanelGridSlot) =>
                      panelGridModuleRefKey(s.module) === panelGridModuleRefKey(p.ref)
                  )
                  const manual =
                    prev?.moduleWidthManual === true && prev.moduleWidth != null
                      ? { moduleWidth: prev.moduleWidth, moduleWidthManual: true as const }
                      : {}
                  return { row: p.row, col: p.col, module: p.ref, ...manual }
                }),
              ]
              logger.warn('[PanelCanvas drag] supply-drop multi-commit', {
                selectedCount: selectedSupply.length,
                beforeCount: supplySlots.length,
                afterCount: newSupplySlotsMulti.length,
              })
              updateSupplyPanelSlots(panel.id, newSupplySlotsMulti)
              return
            }
          }
        }
        const newSlots = supplySlots.map((s: PanelGridSlot) =>
          panelGridModuleRefKey(s.module) === draggedKey ? { ...s, row: newRow, col: newCol } : s
        )
        logger.warn('[PanelCanvas drag] supply-drop single-commit', {
          beforeCount: supplySlots.length,
          afterCount: newSlots.length,
        })
        updateSupplyPanelSlots(panel.id, newSlots)
        return
      }

      // --- Reposition within main panel ---
      // Snap using module center, not top-left, so the row that most of the
      // module body overlaps with wins (the gap between rows biases toward the
      // row above when using the top-left corner).
      const localY = rawY - mainPanelY
      const snapped = snapToGrid(rawX, localY + CELL_H / 2)
      const newRow = clamp(snapped.row, 0, totalRows - 1)
      const newCol = clamp(maxCol, 0, snapped.col)
      logger.warn('[PanelCanvas drag] main-drop', { newRow, newCol })

      const existingSlots = panel.gridView?.slots ?? []
      const sel = useUIStore.getState().selection
      const multiMoveMain =
        !wasInSupply &&
        sel.ids.length >= 2 &&
        (sel.type === 'protection' || sel.type === 'trunkDevice' || sel.type === 'endpoint') &&
        isRefInSelection(draggedRef, sel)
      if (multiMoveMain && combinedPlacements.length > 0) {
        const selectedPlacements = combinedPlacements.filter(
          (pl) => !pl.inSupplyPanel && isRefInSelection(pl.ref, sel)
        )
        const draggedPl = combinedPlacements.find(
          (pl) => panelGridModuleRefKey(pl.ref) === draggedKey
        )
        if (selectedPlacements.length >= 2 && draggedPl) {
          const deltaRow = newRow - draggedPl.row
          const deltaCol = newCol - draggedPl.col
          const proposed: Array<{ ref: PanelGridModuleRef; row: number; col: number; w: number }> =
            []
          for (const pl of selectedPlacements) {
            const key = panelGridModuleRefKey(pl.ref)
            const w = Math.max(
              1,
              moduleWidthOverrides.get(key) ?? getModuleWidthInCols(pl.ref, currentProject)
            )
            const row = pl.row + deltaRow
            const col = pl.col + deltaCol
            proposed.push({ ref: pl.ref, row, col, w })
          }
          const inBounds = proposed.every(
            (p) => p.row >= 0 && p.row < totalRows && p.col >= 0 && p.col <= totalCols - p.w
          )
          const cellKey = (r: number, c: number) => `${r},${c}`
          const occupied = new Set<string>()
          for (const pl of combinedPlacements) {
            if (pl.inSupplyPanel) continue
            if (isRefInSelection(pl.ref, sel)) continue
            const key = panelGridModuleRefKey(pl.ref)
            const w = Math.max(
              1,
              moduleWidthOverrides.get(key) ?? getModuleWidthInCols(pl.ref, currentProject)
            )
            for (let i = 0; i < w; i++) occupied.add(cellKey(pl.row, pl.col + i))
          }
          let noOverlap = true
          for (const p of proposed) {
            for (let i = 0; i < p.w; i++) {
              if (occupied.has(cellKey(p.row, p.col + i))) {
                noOverlap = false
                break
              }
            }
            if (!noOverlap) break
            for (let i = 0; i < p.w; i++) occupied.add(cellKey(p.row, p.col + i))
          }
          if (inBounds && noOverlap) {
            const selectedKeys = new Set(
              selectedPlacements.map((pl) => panelGridModuleRefKey(pl.ref))
            )
            const slotsWithoutSelected = existingSlots.filter(
              (s: PanelGridSlot) => !selectedKeys.has(panelGridModuleRefKey(s.module))
            )
            const newMainSlots: PanelGridSlot[] = [
              ...slotsWithoutSelected,
              ...proposed.map((p) => {
                const prev = existingSlots.find(
                  (s: PanelGridSlot) =>
                    panelGridModuleRefKey(s.module) === panelGridModuleRefKey(p.ref)
                )
                const manual =
                  prev?.moduleWidthManual === true && prev.moduleWidth != null
                    ? { moduleWidth: prev.moduleWidth, moduleWidthManual: true as const }
                    : {}
                return { row: p.row, col: p.col, module: p.ref, ...manual }
              }),
            ]
            logger.warn('[PanelCanvas drag] main-drop multi-commit', {
              selectedCount: selectedPlacements.length,
              beforeCount: existingSlots.length,
              afterCount: newMainSlots.length,
            })
            updatePanelGridSlots(panel.id, newMainSlots)
            return
          }
        }
      }

      let found = false
      const newSlots: PanelGridSlot[] = existingSlots.map((s: PanelGridSlot) => {
        if (panelGridModuleRefKey(s.module) === draggedKey) {
          found = true
          return { ...s, row: newRow, col: newCol }
        }
        return s
      })
      if (!found) {
        const mw = moduleWidthOverrides.get(draggedKey)
        newSlots.push(
          mw != null
            ? {
                row: newRow,
                col: newCol,
                moduleWidth: mw,
                moduleWidthManual: true,
                module: draggedRef,
              }
            : { row: newRow, col: newCol, module: draggedRef }
        )
      }
      logger.warn('[PanelCanvas drag] main-drop single-commit', {
        found,
        beforeCount: existingSlots.length,
        afterCount: newSlots.length,
      })
      updatePanelGridSlots(panel.id, newSlots)
    },
    [
      panel,
      modules,
      currentProject,
      contentWidth,
      contentHeight,
      mainPanelY,
      supplyContentHeight,
      supplyContentWidth,
      supplyLayout.cols,
      supplyLayout.rows,
      supplyPanelY,
      supplyPanelVisible,
      updatePanelGridSlots,
      updateSupplyPanelSlots,
      moduleWidthOverrides,
      combinedPlacements,
      setModuleDropPreview,
    ]
  )
  void handleCombinedDragEnd

  const moduleDisplayInfoByKey = useMemo(() => {
    const map = new Map<string, ModuleDisplayInfo>()
    for (const pl of combinedPlacements) {
      const key = panelGridModuleRefKey(pl.ref)
      if (!map.has(key)) {
        map.set(key, getModuleDisplayInfo(pl.ref, currentProject ?? null))
      }
    }
    return map
  }, [combinedPlacements, currentProject])

  /** Origin (drag start) becomes parent; dashed flow and arrow aim toward target / cursor. */
  const rewirePreviewWire = useMemo(() => {
    if (!rewireMode || !rewireOriginRef || !rewireDragPos) return null
    const originPlacement = combinedPlacements.find(
      (pl) => panelGridModuleRefKey(pl.ref) === panelGridModuleRefKey(rewireOriginRef)
    )
    if (!originPlacement) return null

    const originCx = originPlacement.x + originPlacement.width / 2
    const originY = originPlacement.y

    let finalTargetX = rewireDragPos.x
    let finalTargetY = rewireDragPos.y
    let targetPlacement: (typeof combinedPlacements)[0] | null = null
    if (rewireTargetRef) {
      const found = combinedPlacements.find(
        (pl) => panelGridModuleRefKey(pl.ref) === panelGridModuleRefKey(rewireTargetRef)
      )
      if (found) {
        targetPlacement = found
        finalTargetX = found.x + found.width / 2
        finalTargetY = found.y
      }
    }

    const gapY = originY - ROW_GAP / 2
    const useBottomGap = finalTargetY > originY + originPlacement.height
    const routingGapY = useBottomGap ? originY + originPlacement.height + ROW_GAP / 2 : gapY

    const points: number[] = []
    if (useBottomGap) {
      points.push(
        originCx,
        originY + originPlacement.height,
        originCx,
        routingGapY,
        finalTargetX,
        routingGapY,
        finalTargetX,
        finalTargetY
      )
    } else {
      points.push(
        originCx,
        originY,
        originCx,
        routingGapY,
        finalTargetX,
        routingGapY,
        finalTargetX,
        finalTargetY
      )
    }

    const stroke =
      rewireTargetRef && targetPlacement ? (rewireTargetValid ? '#10b981' : '#ef4444') : '#f59e0b'
    return { points, stroke }
  }, [
    rewireMode,
    rewireOriginRef,
    rewireDragPos,
    rewireTargetValid,
    rewireTargetRef,
    combinedPlacements,
  ])
  void rewirePreviewWire

  const { dragPreview, handleDragOver, handleDrop } = usePanelLibraryDrop({
    addPanel,
    combinedPlacements,
    currentProject,
    panel,
    placeSupplyModuleAfterInsert,
    placements,
    setActivePanelId,
    supplyLayout,
    supplyModulesLength: supplyModules.length,
    t,
    updatePanelGridSlots,
    updateSupplyPanelSlots,
  })

  const handleAutoArrange = useCallback(() => {
    if (!currentProject) return
    const selectedPanelId = selection.type === 'panel' ? (selection.ids[0] ?? null) : null
    const explicitTargetPanel = selectedPanelId ? (getPanelById(selectedPanelId) ?? null) : null
    const visiblePanels =
      effectivePanelCanvasMode.kind === 'all'
        ? panelList.map((panelOption) => panelOption.panel)
        : panel
          ? [panel]
          : []
    const targetPanels = explicitTargetPanel ? [explicitTargetPanel] : visiblePanels
    if (targetPanels.length === 0) return
    // Ensure sitplan reset-scale UI is closed before showing the confirm dialog.
    useUIStore.getState().bumpCancelPlanResetScaleTrigger()
    openDialog({
      type: 'confirm',
      title: t('panelCanvas.autoArrange'),
      message:
        targetPanels.length === 1
          ? t(
              'panelCanvas.autoArrangeConfirm',
              'This will fully replace the current panel layout (main and supply). Continue?'
            )
          : t(
              'panelCanvas.autoArrangeVisibleConfirm',
              'This will fully replace the current layout of the visible panels. Continue?'
            ),
      variant: 'warning',
      confirmLabel: t('common.confirm', 'Confirm'),
      cancelLabel: t('common.cancel', 'Cancel'),
      onConfirm: () => {
        for (const targetPanel of targetPanels) {
          const { mainSlots, supplySlots } = buildAutoArrangeSlots(targetPanel, currentProject)
          applyPanelAutoArrange(targetPanel.id, mainSlots, supplySlots)
        }
      },
    })
  }, [
    currentProject,
    applyPanelAutoArrange,
    buildAutoArrangeSlots,
    effectivePanelCanvasMode,
    getPanelById,
    openDialog,
    panel,
    panelList,
    selection,
    t,
  ])
  void handleAutoArrange

  const panelSceneFilter = useMemo((): PanelSceneFilter => {
    if (effectivePanelCanvasMode.kind === 'all') return { mode: 'full' }
    return {
      mode: 'focus',
      panelId: effectivePanelCanvasMode.panelId,
      linkPolicy: PANEL_FOCUS_SINGLE_PANEL_LINK_POLICY,
    }
  }, [effectivePanelCanvasMode])

  const panelLibraryInteraction = useMemo(() => {
    return {
      onGetContextMenuItems:
        canDeleteItems || canPlaceSymbols ? handleGetContextMenuItems : undefined,
      onDrop: effectivePanelCanvasMode.kind === 'panel' && canPlaceSymbols ? handleDrop : undefined,
      onDragOver:
        effectivePanelCanvasMode.kind === 'panel' && canPlaceSymbols ? handleDragOver : undefined,
      onFindElementsInRectangle:
        effectivePanelCanvasMode.kind === 'panel' ? onFindElementsInRectangle : undefined,
      onGetSelectionBounds:
        effectivePanelCanvasMode.kind === 'panel' ? handleGetSelectionBounds : undefined,
    }
  }, [
    canDeleteItems,
    canPlaceSymbols,
    effectivePanelCanvasMode.kind,
    handleGetContextMenuItems,
    handleDrop,
    handleDragOver,
    onFindElementsInRectangle,
    handleGetSelectionBounds,
  ])

  const panelLibraryCanvasExtras = useMemo(() => {
    if (effectivePanelCanvasMode.kind !== 'panel' || !panel || !currentProject) return null
    const FRAME_MARGIN = PANEL_SCENE_FRAME_MARGIN
    const SUPPLY_GAP = PANEL_SCENE_SUPPLY_GAP
    return (
      <Group x={FRAME_MARGIN} y={FRAME_MARGIN}>
        {moduleDropPreview &&
          (moduleDropPreview.items && moduleDropPreview.items.length > 0
            ? moduleDropPreview.items.map((item) => (
                <Rect
                  key={`single-module-drop-preview-${panelGridModuleRefKey(item.ref)}`}
                  x={item.x}
                  y={item.y}
                  width={item.width}
                  height={item.height}
                  stroke={colors.hoverColor}
                  strokeWidth={2}
                  dash={[8, 4]}
                  fill="transparent"
                  listening={false}
                />
              ))
            : [
                <Rect
                  key="single-module-drop-preview-single"
                  x={moduleDropPreview.x}
                  y={moduleDropPreview.y}
                  width={moduleDropPreview.width}
                  height={moduleDropPreview.height}
                  stroke={colors.hoverColor}
                  strokeWidth={2}
                  dash={[8, 4]}
                  fill="transparent"
                  listening={false}
                />,
              ])}
        {dragPreview &&
          dragPreview.previewRef &&
          panel &&
          currentProject &&
          combinedPlacements &&
          (() => {
            const rows = panel?.gridView?.rows ?? DEFAULT_PANEL_GRID_ROWS
            const cols = panel?.gridView?.columns ?? DEFAULT_PANEL_GRID_COLUMNS
            const supplyRows = getSupplyPanelRows(panel)
            const supplyCols = getSupplyPanelColumns(panel)
            const supplyPanelVisible = !!(panel?.isMain && supplyModules.length > 0)
            const feedFromTop = panel?.gridView?.feedFromTop ?? false
            const panelFrameHeight = contentHeight + FRAME_MARGIN * 2
            const supplyContentHeight = supplyRows * CELL_H + Math.max(0, supplyRows - 1) * ROW_GAP
            const supplyFrameHeight = supplyContentHeight + FRAME_MARGIN * 2
            const mainPanelYLocal =
              supplyPanelVisible && feedFromTop ? supplyFrameHeight + SUPPLY_GAP : 0
            const supplyPanelYLocal =
              supplyPanelVisible && !feedFromTop ? panelFrameHeight + SUPPLY_GAP : 0

            const frameLeft = -FRAME_MARGIN
            const frameRight = Math.max(contentWidth, supplyCols * CELL_W) + FRAME_MARGIN
            const supFrameTop = supplyPanelVisible ? supplyPanelYLocal - FRAME_MARGIN : -Infinity
            const supFrameBottom = supplyPanelVisible
              ? supplyPanelYLocal + supplyContentHeight + FRAME_MARGIN
              : -Infinity

            const inSupplyFrame =
              supplyPanelVisible &&
              dragPreview.position.x >= frameLeft &&
              dragPreview.position.x <= frameRight &&
              dragPreview.position.y >= supFrameTop &&
              dragPreview.position.y <= supFrameBottom
            const showSupplyRowPreview =
              inSupplyFrame &&
              panel.isMain &&
              dragPreview.previewRef.kind === 'trunkDevice' &&
              dragPreview.previewRef.scope === 'supply'

            const isProtectionDevice = dragPreview.previewRef.kind === 'protection'
            const isEnergyMeter =
              dragPreview.previewRef.kind === 'trunkDevice' &&
              dragPreview.symbol?.id === 'energy_meter'

            let previewX = 0
            let previewY = 0
            let previewWidth = CELL_W
            const previewHeight = CELL_H

            const previewWidthCols = dragPreview.previewWidthCols

            if (dragPreview.autoParent) {
              const pl = dragPreview.autoParent.placement
              const parentPlacement =
                combinedPlacements.find(
                  (p) =>
                    panelGridModuleRefKey(p.ref) ===
                    panelGridModuleRefKey(dragPreview.autoParent!.parentRef)
                ) ?? null
              const isSupplyRowParent = parentPlacement?.inSupplyPanel === true
              previewWidth = previewWidthCols * CELL_W
              if (pl != null) {
                previewX = pl.col * CELL_W
                previewY =
                  (isSupplyRowParent ? supplyPanelYLocal : mainPanelYLocal) + pl.row * ROW_STRIDE
              } else {
                previewX = contentWidth + 8
                previewY = isSupplyRowParent ? supplyPanelYLocal : mainPanelYLocal
              }
            } else if (showSupplyRowPreview) {
              const localSupplyY = dragPreview.position.y - supplyPanelYLocal - FRAME_MARGIN
              const snappedSupply = snapToGrid(
                dragPreview.position.x - FRAME_MARGIN,
                localSupplyY + CELL_H / 2
              )
              const col = Math.max(
                0,
                Math.min(
                  supplyCols - previewWidthCols,
                  Math.round((dragPreview.position.x - FRAME_MARGIN) / CELL_W)
                )
              )
              const row = clamp(supplyRows - 1, 0, snappedSupply.row)
              previewX = col * CELL_W
              previewY = supplyPanelYLocal + row * ROW_STRIDE
              previewWidth = previewWidthCols * CELL_W
            } else {
              const localX = dragPreview.position.x - FRAME_MARGIN
              const localY = dragPreview.position.y - mainPanelYLocal - FRAME_MARGIN
              const col = Math.max(
                0,
                Math.min(
                  cols - previewWidthCols,
                  Math.round(localX / CELL_W) - Math.floor(previewWidthCols / 2)
                )
              )
              const snapped = snapToGrid(localX, localY + CELL_H / 2)
              const row = clamp(snapped.row, 0, rows - 1)
              previewX = col * CELL_W
              previewY = row * ROW_STRIDE
              previewWidth = previewWidthCols * CELL_W
            }

            let parentPl: (typeof combinedPlacements)[0] | null = null
            if (dragPreview.autoParent) {
              parentPl =
                combinedPlacements.find(
                  (p) =>
                    panelGridModuleRefKey(p.ref) ===
                    panelGridModuleRefKey(dragPreview.autoParent!.parentRef)
                ) ?? null
            } else if (showSupplyRowPreview) {
              const supplyDevices =
                getProjectElectricalInstallation(currentProject)?.mainSupply?.supplyTrunkDevices ??
                []
              const lastSupply =
                supplyDevices.length > 0 ? supplyDevices[supplyDevices.length - 1] : null
              if (lastSupply) {
                const ref: PanelGridModuleRef = {
                  kind: 'trunkDevice',
                  id: lastSupply.id,
                  scope: 'supply',
                }
                parentPl =
                  combinedPlacements.find(
                    (p) => panelGridModuleRefKey(p.ref) === panelGridModuleRefKey(ref)
                  ) ?? null
              }
            } else if (!inSupplyFrame) {
              if (isProtectionDevice) {
                const installation = currentProject
                  ? getProjectElectricalInstallation(currentProject)
                  : undefined
                const supplyDevices = panel.isMain
                  ? installation
                    ? (getPanelFeedProjection(
                        installation,
                        getProjectElectricalPanels(currentProject),
                        panel
                      )?.devices ?? [])
                    : []
                  : []
                const lastSupply =
                  supplyDevices.length > 0 ? supplyDevices[supplyDevices.length - 1] : null
                if (lastSupply) {
                  const ref: PanelGridModuleRef = {
                    kind: 'trunkDevice',
                    id: lastSupply.id,
                    scope: 'supply',
                  }
                  parentPl =
                    combinedPlacements.find(
                      (p) => panelGridModuleRefKey(p.ref) === panelGridModuleRefKey(ref)
                    ) ?? null
                }
              } else if (isEnergyMeter) {
                const getAllCircuits = (p: Panel): Circuit[] => {
                  const out: Circuit[] = [...(p.circuits ?? [])]
                  for (const pr of p.protections ?? []) {
                    for (const c of pr.circuits ?? []) out.push(c)
                  }
                  for (const sub of p.subPanels ?? []) out.push(...getAllCircuits(sub))
                  return out
                }
                const firstCircuit = getAllCircuits(panel).find((c) => c.code !== 'PANEL')
                if (firstCircuit) {
                  let protectionId: string | null = null
                  for (const pr of panel.protections) {
                    if (pr.circuits?.some((c: Circuit) => c.id === firstCircuit.id)) {
                      protectionId = pr.id
                      break
                    }
                  }
                  if (protectionId) {
                    const ref: PanelGridModuleRef = { kind: 'protection', id: protectionId }
                    parentPl =
                      combinedPlacements.find(
                        (p) => panelGridModuleRefKey(p.ref) === panelGridModuleRefKey(ref)
                      ) ?? null
                  }
                }
              }
            }

            const childRow = inSupplyFrame
              ? Math.floor((previewY - supplyPanelYLocal) / ROW_STRIDE)
              : Math.floor((previewY - mainPanelYLocal) / ROW_STRIDE)
            const childCol = Math.floor(previewX / CELL_W)
            const childPl: ModulePlacement = {
              ref: dragPreview.previewRef,
              x: previewX,
              y: previewY,
              width: previewWidth,
              height: previewHeight,
              row: childRow,
              col: childCol,
            }

            const wirePoints = parentPl ? getDownstreamWirePoints(parentPl, childPl, 0) : []
            const placement = dragPreview.autoParent?.placement
            const strokeColor = placement != null ? colors.hoverColor : '#ef4444'

            return (
              <Group key="drag-preview" listening={false}>
                {wirePoints.length > 0 && (
                  <Line
                    points={wirePoints}
                    stroke={colors.hoverColor}
                    strokeWidth={2.5}
                    dash={[8, 4]}
                    lineCap="round"
                    lineJoin="round"
                    listening={false}
                  />
                )}
                {dragPreview.autoParent && (
                  <Rect
                    x={placement != null ? placement.col * CELL_W : contentWidth + 8}
                    y={
                      parentPl?.inSupplyPanel
                        ? placement != null
                          ? placement.row * ROW_STRIDE + supplyPanelYLocal
                          : supplyPanelYLocal
                        : placement != null
                          ? placement.row * ROW_STRIDE + mainPanelYLocal
                          : mainPanelYLocal
                    }
                    width={parentPl?.inSupplyPanel ? previewWidth : 2 * CELL_W}
                    height={CELL_H}
                    stroke={strokeColor}
                    strokeWidth={2}
                    dash={placement == null ? [4, 4] : undefined}
                    fill="transparent"
                    listening={false}
                  />
                )}
                <Group opacity={0.6}>
                  <ModuleBox
                    moduleRef={dragPreview.previewRef}
                    x={previewX}
                    y={previewY}
                    width={previewWidth}
                    height={previewHeight}
                    info={
                      moduleDisplayInfoByKey.get(panelGridModuleRefKey(dragPreview.previewRef)) ??
                      getModuleDisplayInfo(dragPreview.previewRef, currentProject)
                    }
                    draggable={false}
                    onHoverChange={() => {}}
                    onHoverRefChange={() => {}}
                    debugMode={panelRelationDebug}
                    debugSupplyTrunkKind={
                      panelRelationDebug &&
                      dragPreview.previewRef.kind === 'trunkDevice' &&
                      dragPreview.previewRef.scope === 'supply'
                        ? sharedSupplyRefKeys.has(panelGridModuleRefKey(dragPreview.previewRef))
                          ? 'shared'
                          : 'unique'
                        : undefined
                    }
                  />
                </Group>
                {dragPreview.invalid && (
                  <Rect
                    x={previewX}
                    y={previewY}
                    width={previewWidth}
                    height={previewHeight}
                    stroke="#ef4444"
                    strokeWidth={2}
                    dash={[8, 4]}
                    fill="transparent"
                    listening={false}
                  />
                )}
              </Group>
            )
          })()}
      </Group>
    )
  }, [
    effectivePanelCanvasMode.kind,
    panel,
    currentProject,
    moduleDropPreview,
    dragPreview,
    combinedPlacements,
    supplyModules,
    contentHeight,
    contentWidth,
    colors.hoverColor,
    moduleDisplayInfoByKey,
    panelRelationDebug,
    sharedSupplyRefKeys,
  ])

  return (
    <CanvasOverlayScaleProvider containerRef={containerRef}>
      <div ref={containerRef} className="relative w-full h-full" data-1p-ignore data-op-ignore>
        {overflowModuleCount > 0 ? (
          <div
            role="alert"
            data-testid="panel-canvas-overflow-warning"
            className="pointer-events-none absolute left-1/2 top-3 z-[100] flex max-w-[min(34rem,calc(100%-7rem))] -translate-x-1/2 items-center gap-2 overflow-hidden whitespace-nowrap rounded-md border border-amber-300 bg-amber-50/95 px-3 py-1.5 text-left text-amber-950 shadow-md dark:border-amber-700 dark:bg-amber-950/90 dark:text-amber-50"
          >
            <AlertTriangle
              className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300"
              aria-hidden
            />
            <span className="truncate text-xs font-semibold">
              {t('panelCanvas.overflowWarningTitle')}
            </span>
          </div>
        ) : null}
        <HierarchyPanelCanvas
          canvasRef={canvasRef}
          currentProject={currentProject}
          panelOptions={panelList}
          panelSceneFilter={panelSceneFilter}
          libraryInteraction={panelLibraryInteraction}
          libraryCanvasExtras={canPlaceSymbols ? panelLibraryCanvasExtras : null}
          assignToCircuitMode={
            effectivePanelCanvasMode.kind === 'panel' ? assignToCircuitMode : false
          }
          onAssignTargetClick={
            effectivePanelCanvasMode.kind === 'panel' ? handleAssignTargetClick : undefined
          }
          feedSideDirection={feedSideDirection}
          panelZoom={panelZoom}
          panelPan={panelPan}
          handleZoomChange={handleZoomChange}
          handlePanChange={handlePanChange}
          handleFitToView={handleFitToView}
          handleViewTransformCommit={handleViewTransformCommit}
          onMultiFingerSwipe={onMultiFingerSwipe}
          containerRef={containerRef}
          getPanelGridModules={getPanelGridModules}
          buildAutoArrangeSlots={buildAutoArrangeSlots}
          applyPanelAutoArrange={applyPanelAutoArrange}
          placeSupplyModuleAfterInsert={placeSupplyModuleAfterInsert}
          panelRelationDebug={panelRelationDebug}
          
          capabilities={capabilities}
        />

        {/* Floating right-side controls */}
        <CanvasFloatingControlRail
          side="right"
          verticalAlign="top"
          offsetPx={12}
          topOffsetPx={12}
          zIndex={30}
          menuOpen={panelOptionsMenuOpen || panelVisibilityMenuOpen}
          dataCanvasOverlayAnchor="right"
        >
          <FloatingControl
            icon={<PanelSelectorIcon className="w-6 h-6 text-gray-700 dark:text-gray-200" />}
            label={t('panelCanvas.panelOptions', 'Panel options')}
            tooltipDescription={buildPanelSelectorLabel(effectivePanelCanvasMode, panelList)}
            variant="menu"
            side="right"
            open={panelOptionsMenuOpen}
            onOpenChange={(open) => {
              if (open) setPanelVisibilityMenuOpen(false)
              setPanelOptionsMenuOpen(open)
            }}
            triggerTestId="e2e-panel-canvas-options"
          >
            <PanelOptionsMenu
              panelOptions={panelList}
              panelCanvasMode={effectivePanelCanvasMode}
              selectedPanelForLayout={selectedPanelForLayout}
              hierarchyFeedFromTop={hierarchyFeedFromTop}
              feedSideDirection={feedSideDirection}
              setPanelCanvasMode={setPanelCanvasMode}
              setActivePanelId={setActivePanelId}
              setSitplanPanelFilterId={setSitplanPanelFilterId}
              syncSitplanFilterWithPanelView={syncSitplanFilterWithPanelView}
              setHierarchyFeedFromTop={setHierarchyFeedFromTop}
              updatePanelGrid={updatePanelGrid}
              setFeedSideDirection={setFeedSideDirection}
              showFeedControls={canEditProject}
              onClose={closePanelOptionsMenu}
            />
          </FloatingControl>
          <FloatingControl
            icon={<VisibilityIcon className="w-6 h-6 text-gray-700 dark:text-gray-200" />}
            label={t('panelCanvas.visibility', 'Visibility')}
            tooltipDescription={t('panelCanvas.hiddenDevices', 'Hidden devices')}
            variant="menu"
            side="right"
            open={panelVisibilityMenuOpen}
            onOpenChange={(open) => {
              if (open) closePanelOptionsMenu()
              setPanelVisibilityMenuOpen(open)
            }}
            triggerTestId="e2e-panel-canvas-visibility"
          >
            <PanelVisibilityMenu
              readOnly={!canEditProject}
              showPanelName={effectivePanelCanvasMode.kind === 'all'}
              targets={panelVisibilityTargets}
              onShow={unhideModuleFromPanel}
            />
          </FloatingControl>
        </CanvasFloatingControlRail>
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
      </div>
    </CanvasOverlayScaleProvider>
  )
}
