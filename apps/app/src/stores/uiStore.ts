import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { enableMapSet } from 'immer'
import type {
  ViewMode,
  Selection,
  ViewState,
  PanelState,
  PanelCanvasMode,
  PlanVisibilityState,
  EendraadDateMarkingVisibilityState,
  Point,
  ViewportLayout,
  LayoutPreset,
  CanvasType,
  ViewportPanel,
  PlanToolMode,
} from '@/types/ui'
import type { ExportOptions } from '@/lib/export/types'
import type { SymbolMetadata } from '@/lib/symbols'
import { VIEWPORT_RATIO_MAX, VIEWPORT_RATIO_MIN } from '@/constants/layoutConstants'
import type { PlanDropKind } from '@/lib/plan/planDropPicker'
import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'
import {
  trackValidationPanelVisibility,
  type ValidationPanelAnalyticsSource,
} from '@/lib/analytics/validationPanelAnalytics'

import { getResponsiveEditorMode } from '@/hooks/useResponsiveEditorMode'
import { getAvailableCanvasTypes } from '@/lib/viewport/availableCanvasTypes'

/** Plan canvas view state (zoom, pan, grid) — alias for ViewState */
export type PlanView = ViewState
/** Plan visibility toggles — alias for PlanVisibilityState */
export type PlanVisibility = PlanVisibilityState
export type LeftDockPanel =
  | 'library'
  | 'tally'
  | 'validation'
  | 'quickPlacer'
  | 'schematicAssistant'
  
export type ProjectVersionsWindowTab = 'timeline' | 'qr' | 'sharing'
export interface FloatingPanelDragSeed {
  panel: LeftDockPanel
  pointerId: number
  pointerType: string
  clientX: number
  clientY: number
  initialLeft: number
  initialTop: number
  offsetX: number
  offsetY: number
  token: number
}

// Enable Immer MapSet plugin to support Map and Set in Immer state
enableMapSet()

// --- Viewport layout helpers ---

export const DEFAULT_LAYOUTS: Record<LayoutPreset, () => ViewportLayout> = {
  single: () => ({
    preset: 'single',
    panels: [{ canvas: 'eendraad' }],
    primaryRatio: 1,
    secondaryRatio: 0.5,
    focusReturnLayout: null,
  }),
  sideBySide: () => ({
    preset: 'sideBySide',
    panels: [{ canvas: 'eendraad' }, { canvas: 'plan' }],
    primaryRatio: 0.5,
    secondaryRatio: 0.5,
    focusReturnLayout: null,
  }),
  stacked: () => ({
    preset: 'stacked',
    panels: [{ canvas: 'eendraad' }, { canvas: 'plan' }],
    primaryRatio: 0.5,
    secondaryRatio: 0.5,
    focusReturnLayout: null,
  }),
  topPairBottomWide: () => ({
    preset: 'topPairBottomWide',
    panels: [{ canvas: 'eendraad' }, { canvas: 'plan' }, { canvas: 'panel' }],
    primaryRatio: 0.5,
    secondaryRatio: 0.5,
    focusReturnLayout: null,
  }),
  topWideBottomPair: () => ({
    preset: 'topWideBottomPair',
    panels: [{ canvas: 'eendraad' }, { canvas: 'plan' }, { canvas: 'panel' }],
    primaryRatio: 0.5,
    secondaryRatio: 0.5,
    focusReturnLayout: null,
  }),
  grid: () => {
    const canvases = getAvailableCanvasTypes()
    return {
      preset: 'grid',
      panels: [
        { canvas: 'eendraad' },
        { canvas: 'plan' },
        { canvas: 'panel' },
        { canvas: canvases[3] ?? 'eendraad' },
      ],
      primaryRatio: 0.5,
      secondaryRatio: 0.5,
      focusReturnLayout: null,
    }
  },
}

/** A two-by-two layout needs four distinct canvases. */
export function isLayoutPresetAvailable(preset: LayoutPreset): boolean {
  return preset !== 'grid' || getAvailableCanvasTypes().length >= 4
}

const CANVAS_TYPES: CanvasType[] = getAvailableCanvasTypes()

function cloneLayoutForFocusReturn(layout: ViewportLayout): ViewportLayout {
  const cloned = JSON.parse(JSON.stringify(layout)) as ViewportLayout
  cloned.focusReturnLayout = null
  return cloned
}

/** Each viewport panel must show a distinct canvas type. */
function ensureUniquePanelCanvases(panels: ViewportPanel[]): void {
  const used = new Set<CanvasType>()
  for (const panel of panels) {
    if (!used.has(panel.canvas)) {
      used.add(panel.canvas)
      continue
    }
    const replacement = CANVAS_TYPES.find((canvas) => !used.has(canvas))
    if (replacement) {
      panel.canvas = replacement
      used.add(replacement)
    }
  }
}

/** Derive the old ViewMode from viewport layout for backward compat */
function deriveViewMode(layout: ViewportLayout): ViewMode {
  // Documents is not a drawing view; the legacy view mode follows the drawing canvases beside it.
  const types = layout.panels.map((p) => p.canvas).filter((canvas) => canvas !== 'documents')
  if (types.length === 1) return types[0] as ViewMode
  if (types.length === 2 && types.includes('eendraad') && types.includes('plan')) return 'both'
  if (types.length === 2 && types.includes('panel') && types.includes('plan')) return 'panelAndPlan'
  if (types.length >= 2) return 'both'
  return 'eendraad'
}

export interface UIState {
  /** @deprecated — kept for backward compat, derived from viewportLayout */
  viewMode: ViewMode
  viewportLayout: ViewportLayout
  /** Session-only canvas receiving the most recent pointer, focus, or wheel interaction. */
  lastInteractedCanvas: CanvasType | null
  /** Session-only surfaces actually rendered, including compact layout fallback. */
  renderedCanvases: CanvasType[] | null
  selection: Selection
  hover: Selection
  eendraadView: ViewState
  planView: ViewState
  /** Live Konva scale per canvas during wheel/pinch; null when in sync with that canvas view store. */
  canvasGestureZoom: Record<CanvasType, number | null>
  panelView: ViewState
  structureView: ViewState
  panels: PanelState
  activeFloorId: string | null
  /** Active situation-plan tool, shared so sibling panels can reflect drawing properties. */
  activePlanTool: PlanToolMode
  /** Last wall thickness used by either wall drawing tool. */
  planWallDrawingThicknessCm: number
  activePanelId: string | null
  panelCanvasMode: PanelCanvasMode
  sitplanPanelFilterId: string | null
  syncSitplanFilterWithPanelView: boolean
  planVisibility: PlanVisibilityState
  eendraadDateMarkingVisibility: EendraadDateMarkingVisibilityState
  eendraadDateMarkingMode: boolean
  eendraadLayoutOverrides: Map<string, Point>
  /** Plan canvas container size (CSS px) from ResizeObserver; used for viewport-centered auto placement */
  planCanvasViewportPx: { width: number; height: number } | null
  /** Monotonically increasing counter per canvas type; bump to request fit-to-view */
  fitToViewTrigger: Record<CanvasType, number>
  /** Monotonically increasing trigger to force-cancel plan reset-scale UI from other canvases. */
  cancelPlanResetScaleTrigger: number
  /** True while PDF export is running; used to mount hidden canvases for export */
  isExporting: boolean
  /** Hardware tally window visible (popped up from header button) */
  tallyWindowOpen: boolean
  /** Validation issues window visible (side panel, similar to hardware tally) */
  validationWindowOpen: boolean
  /** Library visible in floating mode */
  libraryWindowOpen: boolean
  /** Quick placer panel visible in floating mode */
  quickPlacerWindowOpen: boolean
  /** Development assistant session survives switching dock surfaces. Never persisted. */
  schematicAssistantOpen: boolean
  schematicAssistantWindowOpen: boolean
  
  /** Which dockable panel is currently shown in the left sidebar */
  leftDockPanel: LeftDockPanel
  /** Which floating panel is currently previewing a left-dock drop target */
  leftDockPreviewPanel: LeftDockPanel | null
  /** Whether the left sidebar is collapsed */
  leftDockCollapsed: boolean
  /** Orphan inspector / recovery panel visible (detected orphans + quarantined items) */
  orphanInspectorOpen: boolean
  /** Active symbol dragged from the library; used as a dragover/drop fallback when DataTransfer payloads are unavailable. */
  libraryDragSymbol: SymbolMetadata | null
  /** Library symbol armed by a click: canvases preview it under the cursor and place a copy per click until disarmed. */
  armedLibrarySymbol: SymbolMetadata | null
  /** Canvas instance last hovered while armed; only that canvas shows the armed-symbol banner. */
  armedLibraryCanvasId: string | null
  /** Increments per armed placement so the library can bring the armed symbol back into view. */
  armedPlacementCount: number
  /** Pointer state handed from a docked panel tear-out to a floating window. */
  floatingPanelDragSeed: FloatingPanelDragSeed | null
  /** 1draad copy/paste: copied element type and ids (for paste-at-position) */
  eendraadClipboard: {
    type: 'endpoint' | 'trunkDevice' | 'protection' | 'panel'
    ids: string[]
  } | null
  /** Last-used PDF export options so user can re-export with previous settings */
  lastExportOptions: ExportOptions | null
  /** Last panel chosen in situation-plan drop dialog (multi-board projects). */
  planDropLastPanelId: string | null
  /** Last circuit chosen per symbol category for plan drops (lights vs sockets, etc.). */
  planDropLastCircuitIdByDropKind: Partial<Record<PlanDropKind, string>>

  // Actions
  /** @deprecated — use setViewportLayout instead */
  setViewMode: (mode: ViewMode) => void
  setViewportLayout: (layout: ViewportLayout) => void
  setLastInteractedCanvas: (canvas: CanvasType | null) => void
  setRenderedCanvases: (canvases: CanvasType[] | null) => void
  setLayoutPreset: (preset: LayoutPreset, options?: { sourcePanelIndex?: number }) => void
  setPanelCanvas: (panelIndex: number, canvas: CanvasType) => void
  setLayoutPrimaryRatio: (ratio: number) => void
  setLayoutSecondaryRatio: (ratio: number) => void
  focusPanel: (panelIndex: number) => void
  unfocusPanel: () => void
  /** Spacebar / gesture: unfocus, focus panel under cursor, or escape stuck single-panel layout. */
  toggleViewportPanelFocus: (panelIndex: number | null) => void
  requestFitToView: (canvases: CanvasType[]) => void
  setPlanCanvasViewportPx: (size: { width: number; height: number } | null) => void
  setSelection: (selection: Selection) => void
  clearSelection: () => void
  setHover: (hover: Selection) => void
  clearHover: () => void
  setEendraadView: (view: Partial<ViewState>) => void
  setPlanView: (view: Partial<ViewState>) => void
  setCanvasGestureZoom: (canvas: CanvasType, zoom: number | null) => void
  setPanelView: (view: Partial<ViewState>) => void
  setStructureView: (view: Partial<ViewState>) => void
  setActivePanelId: (panelId: string | null) => void
  setPanelCanvasMode: (mode: PanelCanvasMode) => void
  setSitplanPanelFilterId: (panelId: string | null) => void
  setSyncSitplanFilterWithPanelView: (sync: boolean) => void
  togglePanel: (panel: keyof PanelState) => void
  setPanelWidth: (panel: 'library' | 'properties', width: number) => void
  setActiveFloor: (floorId: string | null) => void
  setActivePlanTool: (tool: PlanToolMode) => void
  setPlanWallDrawingThicknessCm: (thicknessCm: number) => void
  setEendraadLayoutOverride: (key: string, position: Point | null) => void
  clearEendraadLayoutOverrides: () => void
  setPlanVisibility: (visibility: Partial<PlanVisibilityState>) => void
  setEendraadDateMarkingVisibility: (
    visibility: Partial<EendraadDateMarkingVisibilityState>
  ) => void
  setEendraadDateMarkingMode: (active: boolean) => void
  setExporting: (exporting: boolean) => void
  setTallyWindowOpen: (open: boolean) => void
  toggleTallyWindow: () => void
  setValidationWindowOpen: (open: boolean, source?: ValidationPanelAnalyticsSource) => void
  toggleValidationWindow: () => void
  setLibraryWindowOpen: (open: boolean) => void
  setQuickPlacerWindowOpen: (open: boolean) => void
  toggleQuickPlacerWindow: () => void
  setSchematicAssistantWindowOpen: (open: boolean) => void
  closeSchematicAssistant: () => void
  
  closeFloatingWindows: () => boolean
  setLeftDockPanel: (panel: LeftDockPanel) => void
  setLeftDockPreviewPanel: (panel: LeftDockPanel | null) => void
  setLeftDockCollapsed: (collapsed: boolean) => void
  toggleMainDockPanelsCollapse: () => void
  setFloatingPanelDragSeed: (seed: FloatingPanelDragSeed | null) => void
  setOrphanInspectorOpen: (open: boolean) => void
  toggleOrphanInspector: () => void
  setLibraryDragSymbol: (symbol: SymbolMetadata | null) => void
  setArmedLibrarySymbol: (symbol: SymbolMetadata | null) => void
  setArmedLibraryCanvasId: (canvasId: string | null) => void
  noteArmedPlacement: () => void
  /** Set 1draad clipboard for paste (type + ids). Null to clear. */
  setEendraadClipboard: (
    data: { type: 'endpoint' | 'trunkDevice' | 'protection' | 'panel'; ids: string[] } | null
  ) => void
  /** Bump the cancel trigger so PlanCanvas can exit reset-scale mode. */
  bumpCancelPlanResetScaleTrigger: () => void
  /** Remember last-used PDF export options */
  setLastExportOptions: (options: ExportOptions) => void
  /** Remember plan-drop targets for the next quick confirmation. */
  setPlanDropPreference: (panelId: string, dropKind: PlanDropKind, circuitId: string) => void
  reset: () => void
}

const defaultViewportLayout = DEFAULT_LAYOUTS.sideBySide()

const initialState = {
  viewMode: 'both' as ViewMode,
  viewportLayout: defaultViewportLayout,
  lastInteractedCanvas: null as CanvasType | null,
  renderedCanvases: null as CanvasType[] | null,
  selection: { type: null, ids: [] } as Selection,
  hover: { type: null, ids: [] } as Selection,
  eendraadView: {
    zoom: 2,
    pan: { x: 0, y: 0 },
    showGrid: true,
    gridSize: 20,
    snapToGrid: false,
    snapToProjection: false,
    gridIntensity: 50,
  },
  planView: {
    zoom: 2,
    pan: { x: 0, y: 0 },
    showGrid: true,
    gridSize: 10,
    snapToGrid: false,
    snapToProjection: true,
    // Sitplan grid: 75 is treated as “100%” visual strength
    gridIntensity: 75,
  },
  canvasGestureZoom: {
    eendraad: null,
    plan: null,
    panel: null,
    structure: null,
    documents: null,
  },
  panelView: {
    zoom: 2,
    pan: { x: 0, y: 0 },
    showGrid: true,
    gridSize: 24,
    snapToGrid: true,
    snapToProjection: false,
    gridIntensity: 50,
  },
  structureView: {
    zoom: 1,
    pan: { x: 0, y: 0 },
    showGrid: false,
    gridSize: 24,
    snapToGrid: false,
    snapToProjection: false,
    gridIntensity: 50,
  },
  panels: {
    library: { visible: true, width: 300 },
    properties: { visible: true, width: 300 },
    validation: { visible: false, height: 200 },
  },
  activeFloorId: null,
  activePlanTool: 'none' as PlanToolMode,
  planWallDrawingThicknessCm: 20,
  activePanelId: null,
  panelCanvasMode: { kind: 'all' } as PanelCanvasMode,
  sitplanPanelFilterId: null,
  syncSitplanFilterWithPanelView: false,
  planVisibility: {
    allVisible: true,
    groundPlansVisible: true,
    groundPlansOpacity: 100,
    labelsVisible: true,
    symbolsVisible: true,
    symbolSizeCm: 20,
    socketsVisible: true,
    lightsVisible: true,
    switchesVisible: true,
    panelsVisible: true,
    fixedAppliancesVisible: true,
  },
  eendraadDateMarkingVisibility: {
    installDatesVisible: true,
    installDatesMonochrome: false,
  },
  eendraadDateMarkingMode: false,
  eendraadLayoutOverrides: new Map<string, Point>(),
  planCanvasViewportPx: null as { width: number; height: number } | null,
  fitToViewTrigger: { eendraad: 0, plan: 0, panel: 0, structure: 0, documents: 0 } as Record<CanvasType, number>,
  cancelPlanResetScaleTrigger: 0,
  isExporting: false,
  tallyWindowOpen: false,
  validationWindowOpen: false,
  libraryWindowOpen: false,
  quickPlacerWindowOpen: false,
  schematicAssistantOpen: false,
  schematicAssistantWindowOpen: false,
  
  leftDockPanel: 'library' as LeftDockPanel,
  leftDockPreviewPanel: null as LeftDockPanel | null,
  leftDockCollapsed: false,
  orphanInspectorOpen: false,
  libraryDragSymbol: null,
  armedLibrarySymbol: null,
  armedLibraryCanvasId: null,
  armedPlacementCount: 0,
  floatingPanelDragSeed: null,
  eendraadClipboard: null,
  lastExportOptions: null,
  planDropLastPanelId: null,
  planDropLastCircuitIdByDropKind: {},
}

/** Sitplan visibility toggles + sliders persisted in local UI storage. */
function pickPersistedPlanVisibility(pv: PlanVisibilityState): PlanVisibilityState {
  return {
    ...initialState.planVisibility,
    allVisible: pv.allVisible,
    groundPlansVisible: pv.groundPlansVisible,
    groundPlansOpacity: pv.groundPlansOpacity,
    labelsVisible: pv.labelsVisible,
    symbolsVisible: pv.symbolsVisible,
    symbolSizeCm: pv.symbolSizeCm ?? initialState.planVisibility.symbolSizeCm,
    socketsVisible: pv.socketsVisible,
    lightsVisible: pv.lightsVisible,
    switchesVisible: pv.switchesVisible,
    panelsVisible: pv.panelsVisible,
    fixedAppliancesVisible: pv.fixedAppliancesVisible,
  }
}

/**
 * Avoid repeated synchronous localStorage writes when persisted state payload
 * is unchanged (e.g. frequent pan updates that are excluded from partialize).
 */
const persistedValueCache = new Map<string, string>()
const dedupedLocalStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(name),
  setItem: (name, value) => {
    if (persistedValueCache.get(name) === value) return
    persistedValueCache.set(name, value)
    localStorage.setItem(name, value)
  },
  removeItem: (name) => {
    persistedValueCache.delete(name)
    localStorage.removeItem(name)
  },
}

export const useUIStore = create<UIState>()(
  persist(
    immer((set) => ({
      ...initialState,

      setLastInteractedCanvas: (canvas) => {
        if (useUIStore.getState().lastInteractedCanvas === canvas) return
        set((state) => {
          state.lastInteractedCanvas = canvas
        })
      },

      setRenderedCanvases: (canvases) => {
        const previous = useUIStore.getState().renderedCanvases
        const next = canvases === null ? null : [...new Set(canvases)]
        if (
          previous === next ||
          (previous &&
            next &&
            previous.length === next.length &&
            previous.every((canvas, index) => canvas === next[index]))
        ) return
        set((state) => {
          state.renderedCanvases = next
        })
      },

      setViewMode: (mode) =>
        set((state) => {
          state.viewMode = mode
          // Sync viewport layout when old API is used
          if (mode === 'eendraad') {
            state.viewportLayout = { ...DEFAULT_LAYOUTS.single(), panels: [{ canvas: 'eendraad' }] }
          } else if (mode === 'plan') {
            state.viewportLayout = { ...DEFAULT_LAYOUTS.single(), panels: [{ canvas: 'plan' }] }
          } else if (mode === 'panel') {
            state.viewportLayout = { ...DEFAULT_LAYOUTS.single(), panels: [{ canvas: 'panel' }] }
          } else if (mode === 'both') {
            state.viewportLayout = DEFAULT_LAYOUTS.sideBySide()
          } else if (mode === 'panelAndPlan') {
            state.viewportLayout = {
              ...DEFAULT_LAYOUTS.sideBySide(),
              panels: [{ canvas: 'panel' }, { canvas: 'plan' }],
            }
          }
        }),

      setViewportLayout: (layout) =>
        set((state) => {
          state.viewportLayout = layout
          state.viewMode = deriveViewMode(layout)
        }),

      setLayoutPreset: (preset, options) =>
        set((state) => {
          const previousPreset = state.viewportLayout.preset
          const oldLayout = state.viewportLayout
          const oldCanvasSet = new Set(oldLayout.panels.map((p) => p.canvas))
          const oldCanvases = oldLayout.panels.map((p) => p.canvas)
          const sourcePanelIndex = options?.sourcePanelIndex
          const newLayout = DEFAULT_LAYOUTS[preset]()
          const savedReturnLayout = oldLayout.focusReturnLayout
          const canRestoreReturnLayout =
            oldLayout.preset === 'single' &&
            preset !== 'single' &&
            savedReturnLayout != null &&
            savedReturnLayout.panels.length === newLayout.panels.length

          if (canRestoreReturnLayout) {
            for (let i = 0; i < newLayout.panels.length; i++) {
              newLayout.panels[i]!.canvas = savedReturnLayout.panels[i]!.canvas
            }
            newLayout.primaryRatio = savedReturnLayout.primaryRatio
            newLayout.secondaryRatio = savedReturnLayout.secondaryRatio
          } else if (preset === 'single' && oldLayout.panels.length > 1) {
            newLayout.focusReturnLayout = cloneLayoutForFocusReturn(oldLayout)
            const focusIndex =
              sourcePanelIndex != null &&
              sourcePanelIndex >= 0 &&
              sourcePanelIndex < oldCanvases.length
                ? sourcePanelIndex
                : 0
            newLayout.panels[0]!.canvas = oldCanvases[focusIndex]!
          } else {
            for (let i = 0; i < newLayout.panels.length && i < oldCanvases.length; i++) {
              newLayout.panels[i]!.canvas = oldCanvases[i]!
            }
            if (
              preset === 'single' &&
              sourcePanelIndex != null &&
              sourcePanelIndex >= 0 &&
              sourcePanelIndex < oldCanvases.length
            ) {
              newLayout.panels[0]!.canvas = oldCanvases[sourcePanelIndex]!
            }
            if (newLayout.panels.length > 1) {
              ensureUniquePanelCanvases(newLayout.panels)
            }
            if (preset === 'single') {
              newLayout.focusReturnLayout = oldLayout.focusReturnLayout
            }
          }
          // Fit-to-view any canvases that weren't previously visible
          const newlyVisible: CanvasType[] = []
          for (const p of newLayout.panels) {
            if (!oldCanvasSet.has(p.canvas)) {
              newlyVisible.push(p.canvas)
            }
          }
          state.viewportLayout = newLayout
          state.viewMode = deriveViewMode(newLayout)
          for (const c of newlyVisible) {
            state.fitToViewTrigger[c] = (state.fitToViewTrigger[c] ?? 0) + 1
          }
          if (previousPreset !== preset) {
            trackGoogleAnalyticsEvent('layout_preset_change', {
              from_preset: previousPreset,
              to_preset: preset,
              panel_count: newLayout.panels.length,
            })
          }
        }),

      setPanelCanvas: (panelIndex, canvas) =>
        set((state) => {
          const panels = state.viewportLayout.panels
          const target = panels[panelIndex]
          if (!target) return
          const previousCanvas = target.canvas
          const existingIdx = panels.findIndex((p, i) => i !== panelIndex && p.canvas === canvas)
          const existing = existingIdx !== -1 ? panels[existingIdx] : null
          const canvasesToFit: CanvasType[] = [canvas]
          if (existing) {
            canvasesToFit.push(target.canvas)
            existing.canvas = target.canvas
          }
          target.canvas = canvas
          state.viewMode = deriveViewMode(state.viewportLayout)
          for (const c of canvasesToFit) {
            state.fitToViewTrigger[c] = (state.fitToViewTrigger[c] ?? 0) + 1
          }
          if (previousCanvas !== canvas) {
            trackGoogleAnalyticsEvent('canvas_switch', {
              panel_index: panelIndex,
              from_canvas: previousCanvas,
              to_canvas: canvas,
              swapped_duplicate: Boolean(existing),
            })
          }
        }),

      setLayoutPrimaryRatio: (ratio) =>
        set((state) => {
          state.viewportLayout.primaryRatio = Math.max(
            VIEWPORT_RATIO_MIN,
            Math.min(VIEWPORT_RATIO_MAX, ratio)
          )
        }),

      setLayoutSecondaryRatio: (ratio) =>
        set((state) => {
          state.viewportLayout.secondaryRatio = Math.max(
            VIEWPORT_RATIO_MIN,
            Math.min(VIEWPORT_RATIO_MAX, ratio)
          )
        }),

      focusPanel: (panelIndex) =>
        set((state) => {
          const layout = state.viewportLayout
          if (layout.panels.length <= 1) return
          const panel = layout.panels[panelIndex]
          if (!panel) return
          const canvas = panel.canvas
          const returnLayout = JSON.parse(JSON.stringify(layout)) as ViewportLayout
          returnLayout.focusReturnLayout = null
          state.viewportLayout = {
            preset: 'single',
            panels: [{ canvas }],
            primaryRatio: 1,
            secondaryRatio: 0.5,
            focusReturnLayout: returnLayout,
          }
          state.viewMode = canvas as ViewMode
          trackGoogleAnalyticsEvent('canvas_focus', {
            panel_index: panelIndex,
            canvas,
          })
        }),

      unfocusPanel: () =>
        set((state) => {
          const returnLayout = state.viewportLayout.focusReturnLayout
          if (!returnLayout) return
          const focusedCanvas = state.viewportLayout.panels[0]?.canvas
          state.viewportLayout = returnLayout
          state.viewMode = deriveViewMode(returnLayout)
          trackGoogleAnalyticsEvent('canvas_unfocus', {
            canvas: focusedCanvas,
            panel_count: returnLayout.panels.length,
          })
        }),

      toggleViewportPanelFocus: (panelIndex) => {
        const layout = useUIStore.getState().viewportLayout
        if (layout.focusReturnLayout) {
          useUIStore.getState().unfocusPanel()
          return
        }
        if (layout.panels.length > 1) {
          if (panelIndex != null) {
            useUIStore.getState().focusPanel(panelIndex)
          }
          return
        }
        const preset =
          getResponsiveEditorMode().mode === 'compactPortrait' ? 'stacked' : 'sideBySide'
        useUIStore.getState().setLayoutPreset(preset)
      },

      requestFitToView: (canvases) =>
        set((state) => {
          for (const c of canvases) {
            state.fitToViewTrigger[c] = (state.fitToViewTrigger[c] ?? 0) + 1
          }
        }),

      setPlanCanvasViewportPx: (size) =>
        set((state) => {
          state.planCanvasViewportPx = size
        }),

      bumpCancelPlanResetScaleTrigger: () =>
        set((state) => {
          state.cancelPlanResetScaleTrigger = (state.cancelPlanResetScaleTrigger ?? 0) + 1
        }),

      setSelection: (selection) =>
        set((state) => {
          state.selection = selection
        }),

      clearSelection: () =>
        set((state) => {
          state.selection = { type: null, ids: [], wireMetadata: undefined }
        }),

      setHover: (hover) =>
        set((state) => {
          state.hover = hover
        }),

      clearHover: () =>
        set((state) => {
          state.hover = { type: null, ids: [] }
        }),

      setEendraadView: (view) =>
        set((state) => {
          state.eendraadView = { ...state.eendraadView, ...view }
        }),

      setPlanView: (view) =>
        set((state) => {
          state.planView = { ...state.planView, ...view }
        }),

      setCanvasGestureZoom: (canvas, zoom) =>
        set((state) => {
          if (state.canvasGestureZoom[canvas] === zoom) return
          state.canvasGestureZoom[canvas] = zoom
        }),

      setPanelView: (view) =>
        set((state) => {
          state.panelView = { ...state.panelView, ...view }
        }),

      setStructureView: (view) =>
        set((state) => {
          state.structureView = { ...state.structureView, ...view }
        }),

      setActivePanelId: (panelId) =>
        set((state) => {
          state.activePanelId = panelId
        }),

      setPanelCanvasMode: (mode) =>
        set((state) => {
          state.panelCanvasMode = mode
          if (mode.kind === 'panel') state.activePanelId = mode.panelId
        }),

      setSitplanPanelFilterId: (panelId) =>
        set((state) => {
          state.sitplanPanelFilterId = panelId
        }),

      setSyncSitplanFilterWithPanelView: (sync) =>
        set((state) => {
          state.syncSitplanFilterWithPanelView = sync
        }),

      togglePanel: (panel) =>
        set((state) => {
          state.panels[panel].visible = !state.panels[panel].visible
        }),

      setPanelWidth: (panel, width) =>
        set((state) => {
          state.panels[panel].width = width
        }),

      setActiveFloor: (floorId) =>
        set((state) => {
          state.activeFloorId = floorId
        }),

      setActivePlanTool: (tool) =>
        set((state) => {
          state.activePlanTool = tool
          if (tool === 'move') {
            state.selection = { type: null, ids: [], wireMetadata: undefined }
          }
        }),

      setPlanWallDrawingThicknessCm: (thicknessCm) =>
        set((state) => {
          if (!Number.isFinite(thicknessCm) || thicknessCm < 1) return
          state.planWallDrawingThicknessCm = thicknessCm
        }),

      setEendraadLayoutOverride: (key, position) =>
        set((state) => {
          if (position === null) {
            state.eendraadLayoutOverrides.delete(key)
          } else {
            state.eendraadLayoutOverrides.set(key, position)
          }
        }),

      clearEendraadLayoutOverrides: () =>
        set((state) => {
          state.eendraadLayoutOverrides.clear()
        }),

      setPlanVisibility: (visibility) =>
        set((state) => {
          state.planVisibility = { ...state.planVisibility, ...visibility }
        }),

      setEendraadDateMarkingVisibility: (visibility) =>
        set((state) => {
          state.eendraadDateMarkingVisibility = {
            ...state.eendraadDateMarkingVisibility,
            ...visibility,
          }
        }),

      setEendraadDateMarkingMode: (active) =>
        set((state) => {
          state.eendraadDateMarkingMode = active
        }),

      setExporting: (exporting) =>
        set((state) => {
          state.isExporting = exporting
        }),

      setTallyWindowOpen: (open) =>
        set((state) => {
          const wasOpen = state.tallyWindowOpen
          state.tallyWindowOpen = open
          if (open) state.validationWindowOpen = false
          if (open) state.libraryWindowOpen = false
          if (open) state.quickPlacerWindowOpen = false
          
          if (open && state.leftDockPanel === 'tally') {
            state.leftDockPanel = 'library'
            state.leftDockCollapsed = false
          }
          if (wasOpen !== open) {
            trackGoogleAnalyticsEvent(open ? 'hardware_tally_open' : 'hardware_tally_close', {
              source: 'floating',
            })
          }
        }),

      toggleTallyWindow: () =>
        set((state) => {
          const next = !state.tallyWindowOpen
          state.tallyWindowOpen = next
          if (next) state.validationWindowOpen = false
          if (next) state.libraryWindowOpen = false
          if (next) state.quickPlacerWindowOpen = false
          
          if (next && state.leftDockPanel === 'tally') {
            state.leftDockPanel = 'library'
            state.leftDockCollapsed = false
          }
          trackGoogleAnalyticsEvent(next ? 'hardware_tally_open' : 'hardware_tally_close', {
            source: 'toolbar',
          })
        }),

      setValidationWindowOpen: (open, source = 'state') =>
        set((state) => {
          const wasOpen = state.validationWindowOpen
          state.validationWindowOpen = open
          if (open) state.tallyWindowOpen = false
          if (open) state.libraryWindowOpen = false
          if (open) state.quickPlacerWindowOpen = false
          
          if (open && state.leftDockPanel === 'validation') {
            state.leftDockPanel = 'library'
            state.leftDockCollapsed = false
          }
          if (wasOpen !== open) {
            trackValidationPanelVisibility(open, source)
          }
        }),

      toggleValidationWindow: () =>
        set((state) => {
          const wasOpen = state.validationWindowOpen
          const next = !wasOpen
          state.validationWindowOpen = next
          if (next) state.tallyWindowOpen = false
          if (next) state.libraryWindowOpen = false
          if (next) state.quickPlacerWindowOpen = false
          
          if (next && state.leftDockPanel === 'validation') {
            state.leftDockPanel = 'library'
            state.leftDockCollapsed = false
          }
          if (wasOpen !== next) {
            trackValidationPanelVisibility(next, 'status_icon')
          }
        }),

      setLibraryWindowOpen: (open) =>
        set((state) => {
          state.libraryWindowOpen = open
          if (open) state.tallyWindowOpen = false
          if (open) state.validationWindowOpen = false
          if (open) state.quickPlacerWindowOpen = false
          
          if (open && state.leftDockPanel === 'library') {
            state.leftDockCollapsed = true
          }
        }),

      setQuickPlacerWindowOpen: (open) =>
        set((state) => {
          const wasOpen = state.quickPlacerWindowOpen
          state.quickPlacerWindowOpen = open
          if (open) state.tallyWindowOpen = false
          if (open) state.validationWindowOpen = false
          if (open) state.libraryWindowOpen = false
          
          if (open && state.leftDockPanel === 'quickPlacer') {
            state.leftDockPanel = 'library'
            state.leftDockCollapsed = false
          }
          if (wasOpen !== open) {
            trackGoogleAnalyticsEvent(open ? 'quick_placer_open' : 'quick_placer_close', {
              surface: 'floating',
            })
          }
        }),

      

      toggleQuickPlacerWindow: () =>
        set((state) => {
          const next = !state.quickPlacerWindowOpen
          state.quickPlacerWindowOpen = next
          if (next) state.tallyWindowOpen = false
          if (next) state.validationWindowOpen = false
          if (next) state.libraryWindowOpen = false
          
          if (next && state.leftDockPanel === 'quickPlacer') {
            state.leftDockPanel = 'library'
            state.leftDockCollapsed = false
          }
          trackGoogleAnalyticsEvent(next ? 'quick_placer_open' : 'quick_placer_close', {
            surface: 'floating',
          })
        }),

      setSchematicAssistantWindowOpen: (open) =>
        set((state) => {
          state.schematicAssistantWindowOpen = open
          if (open) {
            state.schematicAssistantOpen = true
            if (state.leftDockPanel === 'schematicAssistant') {
              state.leftDockPanel = 'library'
              state.leftDockCollapsed = true
            }
          }
        }),

      closeSchematicAssistant: () =>
        set((state) => {
          state.schematicAssistantOpen = false
          state.schematicAssistantWindowOpen = false
          if (state.leftDockPanel === 'schematicAssistant') state.leftDockPanel = 'library'
          if (state.leftDockPreviewPanel === 'schematicAssistant') state.leftDockPreviewPanel = null
        }),

      closeFloatingWindows: () => {
        const state = useUIStore.getState()
        const hasFloatingWindows = [
          state.libraryWindowOpen,
          state.tallyWindowOpen,
          state.validationWindowOpen,
          state.quickPlacerWindowOpen,
          state.schematicAssistantWindowOpen,
          
        ].some(Boolean)
        if (!hasFloatingWindows) return false

        set((draft) => {
          draft.libraryWindowOpen = false
          draft.tallyWindowOpen = false
          draft.validationWindowOpen = false
          draft.quickPlacerWindowOpen = false
          draft.schematicAssistantWindowOpen = false
          
        })
        return true
      },

      setLeftDockPanel: (panel) =>
        set((state) => {
          const previousPanel = state.leftDockPanel
          state.leftDockPanel = panel
          state.leftDockPreviewPanel = null
          state.leftDockCollapsed = false
          if (panel === 'tally') state.tallyWindowOpen = false
          if (panel === 'validation') state.validationWindowOpen = false
          if (panel === 'quickPlacer') state.quickPlacerWindowOpen = false
          if (panel === 'schematicAssistant') {
            state.schematicAssistantOpen = true
            state.schematicAssistantWindowOpen = false
          }
          if (previousPanel !== panel) {
            trackGoogleAnalyticsEvent('left_dock_panel_change', {
              from_panel: previousPanel,
              to_panel: panel,
            })
            if (panel === 'validation') {
              trackValidationPanelVisibility(true, 'left_dock')
            } else if (previousPanel === 'validation') {
              trackValidationPanelVisibility(false, 'left_dock')
            }
            
          }
        }),

      setLeftDockPreviewPanel: (panel) =>
        set((state) => {
          state.leftDockPreviewPanel = panel
        }),

      setLeftDockCollapsed: (collapsed) =>
        set((state) => {
          state.leftDockCollapsed = collapsed
        }),

      toggleMainDockPanelsCollapse: () =>
        set((state) => {
          const hasFloatingLeftPanel =
            state.libraryWindowOpen ||
            state.tallyWindowOpen ||
            state.validationWindowOpen ||
            state.quickPlacerWindowOpen ||
            state.schematicAssistantWindowOpen

          if (hasFloatingLeftPanel) {
            state.leftDockCollapsed = true
            state.panels.properties.visible = !state.panels.properties.visible
            return
          }

          const bothCollapsed = state.leftDockCollapsed && !state.panels.properties.visible
          const collapseNext = !bothCollapsed

          state.leftDockCollapsed = collapseNext
          state.panels.properties.visible = !collapseNext
        }),

      setFloatingPanelDragSeed: (seed) =>
        set((state) => {
          state.floatingPanelDragSeed = seed
        }),

      setOrphanInspectorOpen: (open) =>
        set((state) => {
          state.orphanInspectorOpen = open
        }),

      toggleOrphanInspector: () =>
        set((state) => {
          state.orphanInspectorOpen = !state.orphanInspectorOpen
        }),
      setLibraryDragSymbol: (symbol) =>
        set((state) => {
          state.libraryDragSymbol = symbol
        }),
      setArmedLibrarySymbol: (symbol) =>
        set((state) => {
          state.armedLibrarySymbol = symbol
          if (!symbol) state.armedLibraryCanvasId = null
        }),
      setArmedLibraryCanvasId: (canvasId) =>
        set((state) => {
          state.armedLibraryCanvasId = canvasId
        }),
      noteArmedPlacement: () =>
        set((state) => {
          state.armedPlacementCount += 1
        }),
      setEendraadClipboard: (data) =>
        set((state) => {
          state.eendraadClipboard = data
        }),

      setLastExportOptions: (options) =>
        set((state) => {
          state.lastExportOptions = options
        }),

      setPlanDropPreference: (panelId, dropKind, circuitId) =>
        set((state) => {
          state.planDropLastPanelId = panelId
          state.planDropLastCircuitIdByDropKind[dropKind] = circuitId
        }),

      reset: () => set(initialState),
    })),
    {
      name: 'eendra-ui-storage',
      version: 9,
      storage: createJSONStorage(() => dedupedLocalStorage),
      partialize: (state) => ({
        // viewportLayout / viewMode are per-project (local editor state + project JSON).
        // Persist only stable view preferences; pan/zoom remain effectively
        // runtime-only, but we always include default pan/zoom in the persisted
        // payload so hydrated state has a complete ViewState shape.
        eendraadView: {
          ...initialState.eendraadView,
          showGrid: state.eendraadView.showGrid,
          gridSize: state.eendraadView.gridSize,
          snapToGrid: state.eendraadView.snapToGrid,
          snapToProjection: state.eendraadView.snapToProjection,
        },
        planView: {
          ...initialState.planView,
          showGrid: state.planView.showGrid,
          gridSize: state.planView.gridSize,
          snapToGrid: state.planView.snapToGrid,
          snapToProjection: state.planView.snapToProjection,
          gridIntensity: state.planView.gridIntensity,
        },
        panelView: {
          ...initialState.panelView,
          showGrid: state.panelView.showGrid,
          gridSize: state.panelView.gridSize,
          snapToGrid: state.panelView.snapToGrid,
          snapToProjection: state.panelView.snapToProjection,
        },
        structureView: {
          ...initialState.structureView,
        },
        planVisibility: pickPersistedPlanVisibility(state.planVisibility),
        panels: state.panels,
        activeFloorId: state.activeFloorId,
        planWallDrawingThicknessCm: state.planWallDrawingThicknessCm,
        activePanelId: state.activePanelId,
        panelCanvasMode: state.panelCanvasMode,
        // The development-only assistant must not leave an unavailable production dock preference.
        leftDockPanel: state.leftDockPanel === 'schematicAssistant' ? 'library' : state.leftDockPanel,
        leftDockCollapsed: state.leftDockCollapsed,
        lastExportOptions: state.lastExportOptions,
        planDropLastPanelId: state.planDropLastPanelId,
        planDropLastCircuitIdByDropKind: state.planDropLastCircuitIdByDropKind,
      }),
      migrate: (persisted: unknown, version: number) => {
        const state = (persisted ?? {}) as Record<string, unknown>
        // v0 → v1: add viewportLayout derived from old viewMode
        if (version < 1 && state.viewMode && !state.viewportLayout) {
          const vm = state.viewMode as ViewMode
          const layoutMap: Record<ViewMode, () => ViewportLayout> = {
            eendraad: () => ({ ...DEFAULT_LAYOUTS.single(), panels: [{ canvas: 'eendraad' }] }),
            plan: () => ({ ...DEFAULT_LAYOUTS.single(), panels: [{ canvas: 'plan' }] }),
            panel: () => ({ ...DEFAULT_LAYOUTS.single(), panels: [{ canvas: 'panel' }] }),
            structure: () => ({ ...DEFAULT_LAYOUTS.single(), panels: [{ canvas: 'structure' }] }),
            both: DEFAULT_LAYOUTS.sideBySide,
            panelAndPlan: () => ({
              ...DEFAULT_LAYOUTS.sideBySide(),
              panels: [{ canvas: 'panel' }, { canvas: 'plan' }],
            }),
          }
          state.viewportLayout = (layoutMap[vm] ?? DEFAULT_LAYOUTS.sideBySide)()
        }
        // v0/v1 → v2: view states weren't persisted, nothing to migrate —
        // Zustand merge fills them from initialState defaults
        //
        // v0/v1/v2 → v3: ensure view states always have a complete shape
        // so consumers can rely on zoom, pan, and gridIntensity.
        if (version < 3) {
          state.eendraadView = {
            ...initialState.eendraadView,
            ...(state.eendraadView ?? {}),
          }
          state.planView = {
            ...initialState.planView,
            ...(state.planView ?? {}),
          }
          state.panelView = {
            ...initialState.panelView,
            ...(state.panelView ?? {}),
          }
          state.structureView = {
            ...initialState.structureView,
            ...(state.structureView ?? {}),
          }
        }
        // v0/v1/v2/v3 -> v4: keep only sitplan slider prefs; reset all
        // visibility toggles to default-on.
        if (version < 4) {
          const prevVisibility = (state.planVisibility ?? {}) as Partial<PlanVisibilityState>
          state.planVisibility = {
            ...initialState.planVisibility,
            groundPlansOpacity:
              prevVisibility.groundPlansOpacity ?? initialState.planVisibility.groundPlansOpacity,
            symbolSizeCm: prevVisibility.symbolSizeCm ?? initialState.planVisibility.symbolSizeCm,
          }
        }
        if (version < 5) {
          const activePanelId =
            typeof state.activePanelId === 'string' && state.activePanelId.length > 0
              ? state.activePanelId
              : null
          state.panelCanvasMode = activePanelId
            ? { kind: 'panel', panelId: activePanelId }
            : { kind: 'all' }
        }
        const persistedPanelCanvasMode = (state as { panelCanvasMode?: { kind?: string } })
          .panelCanvasMode
        if (version < 6 && persistedPanelCanvasMode?.kind === 'main_only') {
          state.panelCanvasMode = { kind: 'all' }
        }
        // v7: viewport layout is stored per project, not in global UI persistence.
        if (version < 7) {
          delete (state as { viewMode?: unknown }).viewMode
          delete (state as { viewportLayout?: unknown }).viewportLayout
        }
        // v8: persist all sitplan visibility toggles (including plan wires), not only sliders.
        if (version < 8) {
          const prevVisibility = (state.planVisibility ?? {}) as Partial<PlanVisibilityState>
          state.planVisibility = pickPersistedPlanVisibility({
            ...initialState.planVisibility,
            ...prevVisibility,
          })
        }
        // v9: plan wire visibility/style live on the project plan-wiring model, not UI storage.
        if (version < 9) {
          state.planVisibility = pickPersistedPlanVisibility(
            (state.planVisibility ?? {}) as PlanVisibilityState
          )
        }
        return state
      },
    }
  )
)
