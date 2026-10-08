import { createElement, useEffect, useRef, useCallback } from 'react'
import { ZOOM_MIN, ZOOM_MAX } from '@/constants/canvasConstants'
import { getPlanZoomMinimum } from '@/lib/plan/planZoom'
import { resolvePlanPxPerMeter } from '@/lib/plan/planScale'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import {
  getViewportPanelAtClientPoint,
  getViewportPanelZones,
} from '@/components/layout/viewportGeometry'
import { planFloorDrawingConsumesTabRef } from '@/lib/plan/planFloorDrawingKeyboardGate'
import { planFloorDrawingUndoRef } from '@/lib/plan/planFloorDrawingUndo'
import { isTextLikeFocusTarget } from '@/lib/ui/blurFocusStealingActiveElement'
import { dispatchExtendPropertiesPanelFieldBlur } from '@/lib/ui/propertiesPanelFieldBlur'
import {
  canDuplicateEendraadSelection,
  runEendraadDuplicate,
} from '@/lib/eendraad/duplicateSelection'
import { canDuplicatePlanSelection, runPlanDuplicate } from '@/lib/plan/planDuplicateSelection'
import type { CanvasType, ViewportLayout } from '@/types/ui'
import { isStructuralCanvasEnabled } from '@/lib/structuralCanvas/availability'
import type { EditorCapabilities } from '@/lib/viewerMode'
import { isKeyboardTypingTarget } from '@/lib/ui/keyboardTypingTarget'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { findGroundTrunkDeviceOwner } from '@/lib/eendraad/panelGround'
import { useDialogStore } from '@/stores/dialogStore'
import HiddenItemsDialog, { type HiddenItem } from '@/components/common/HiddenItemsDialog'
import { getSymbolById } from '@/lib/symbols'
import { buildAutoSitplanPlacement } from '@/lib/plan/autoSitplanPlacement'
import { generateId } from '@/utils/project'
import i18n from '@/i18n'
import { restoreHiddenSituationPlanPlacementsToActiveView } from '@/lib/plan/restoreHiddenSituationPlanPlacements'
import { hasCustomPlacement } from '@/lib/plan/customPlacement'
import {
  createSyncSupplyInverterMultiplierDeps,
  syncSupplyDeviceMultiplierCount,
} from '@/lib/eendraad/syncSupplyInverterMultiplier'
import {
  createSyncEndpointMultiplierDeps,
  syncEndpointMultiplierCount,
} from '@/lib/eendraad/syncEndpointMultiplierCount'

/**
 * Hook to handle global keyboard shortcuts for the application.
 *
 * Spacebar: focus the viewport panel under the mouse (maximize it).
 *           If already focused, restore the previous multi-panel layout.
 */
export function useKeyboardShortcuts(options?: { capabilities?: EditorCapabilities }) {
  const capabilities = options?.capabilities
  const canEditProject = capabilities?.canEditProject ?? true
  const canPlaceSymbols = capabilities?.canPlaceSymbols ?? true
  const togglePanel = useUIStore(
    (state: ReturnType<typeof useUIStore.getState>) => state.togglePanel
  )
  const requestFitToView = useUIStore(
    (state: ReturnType<typeof useUIStore.getState>) => state.requestFitToView
  )
  const toggleMainDockPanelsCollapse = useUIStore(
    (state: ReturnType<typeof useUIStore.getState>) => state.toggleMainDockPanelsCollapse
  )
  const closeFloatingWindows = useUIStore(
    (state: ReturnType<typeof useUIStore.getState>) => state.closeFloatingWindows
  )
  const setPanelCanvas = useUIStore(
    (state: ReturnType<typeof useUIStore.getState>) => state.setPanelCanvas
  )
  const undo = useProjectStore((state: ReturnType<typeof useProjectStore.getState>) => state.undo)
  const redo = useProjectStore((state: ReturnType<typeof useProjectStore.getState>) => state.redo)
  const mousePos = useRef({ x: 0, y: 0 })
  const pendingSpaceToggleRef = useRef<number | null>(null)

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePos.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      if (pendingSpaceToggleRef.current != null) {
        window.cancelAnimationFrame(pendingSpaceToggleRef.current)
        pendingSpaceToggleRef.current = null
      }
    }
  }, [])

  const findPanelIndexAtPoint = useCallback((x: number, y: number): number | null => {
    const layout = useUIStore.getState().viewportLayout
    const contentEl = document.querySelector('[data-viewport-content]') as HTMLElement | null
    const contentRect = contentEl?.getBoundingClientRect()
    if (!contentRect) return null

    return (
      getViewportPanelAtClientPoint(
        layout,
        {
          left: contentRect.left,
          top: contentRect.top,
          width: contentRect.width,
          height: contentRect.height,
        },
        x,
        y
      )?.panelIndex ?? null
    )
  }, [])

  const findPanelIndexFromTarget = useCallback((target: EventTarget | null): number | null => {
    if (!(target instanceof Element)) return null
    const panelEl = target.closest('[data-viewport-panel]')
    if (!panelEl) return null
    const value = panelEl.getAttribute('data-viewport-panel')
    if (!value) return null
    const panelIndex = Number.parseInt(value, 10)
    return Number.isNaN(panelIndex) ? null : panelIndex
  }, [])

  const applyFastViewportLayoutPreview = useCallback(
    (layout: ViewportLayout, panelIndex: number | null) => {
      const contentEl = document.querySelector('[data-viewport-content]') as HTMLElement | null
      if (!contentEl) return

      const previewLayout: ViewportLayout | null = layout.focusReturnLayout
        ? layout.focusReturnLayout
        : layout.panels.length > 1 && panelIndex != null && layout.panels[panelIndex]
          ? {
              preset: 'single',
              panels: [{ canvas: layout.panels[panelIndex].canvas }],
              primaryRatio: 1,
              secondaryRatio: 0.5,
              focusReturnLayout: null,
            }
          : null

      if (!previewLayout) return

      const previewZones = getViewportPanelZones(previewLayout)
      const panels = Array.from(
        contentEl.querySelectorAll<HTMLElement>('[data-viewport-panel][data-viewport-canvas]')
      )

      for (const panelEl of panels) {
        const canvas = panelEl.getAttribute('data-viewport-canvas') as CanvasType | null
        const zone = canvas ? previewZones.find((candidate) => candidate.type === canvas) : null

        panelEl.style.transition = 'none'
        panelEl.style.willChange = 'left, top, width, height'

        if (!zone) {
          panelEl.style.visibility = 'hidden'
          panelEl.style.pointerEvents = 'none'
          continue
        }

        const r = zone.rect
        panelEl.style.visibility = ''
        panelEl.style.pointerEvents = ''
        panelEl.style.left = `${r.left * 100}%`
        panelEl.style.top = `${r.top * 100}%`
        panelEl.style.width = `${r.width * 100}%`
        panelEl.style.height = `${r.height * 100}%`
        panelEl.setAttribute('data-viewport-fast-preview', '1')
      }

      window.setTimeout(() => {
        for (const panelEl of panels) {
          panelEl.style.transition = ''
          panelEl.style.willChange = ''
          panelEl.removeAttribute('data-viewport-fast-preview')
        }
      }, 250)
    },
    []
  )

  const scheduleViewportPanelFocusToggle = useCallback((panelIndex: number | null) => {
    if (pendingSpaceToggleRef.current != null) {
      window.cancelAnimationFrame(pendingSpaceToggleRef.current)
      pendingSpaceToggleRef.current = null
    }
    pendingSpaceToggleRef.current = window.requestAnimationFrame(() => {
      pendingSpaceToggleRef.current = null
      window.setTimeout(() => {
        useUIStore.getState().toggleViewportPanelFocus(panelIndex)
      }, 0)
    })
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const layout = useUIStore.getState().viewportLayout
      const allCanvases = layout.panels.map((p) => p.canvas)

      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 'z':
          case 'Z': {
            if (!canEditProject) break
            const isTyping = isKeyboardTypingTarget(e.target)
            if (!isTyping) {
              e.preventDefault()
              if (e.shiftKey) {
                if (planFloorDrawingUndoRef.current?.tryRedo()) return
                redo()
              } else {
                if (planFloorDrawingUndoRef.current?.tryUndo()) return
                undo()
              }
              return
            }
            break
          }
          case 'y':
          case 'Y': {
            if (!canEditProject) break
            const isTyping = isKeyboardTypingTarget(e.target)
            if (!isTyping) {
              e.preventDefault()
              redo()
              return
            }
            break
          }
          case 'l':
          case 'L':
            if (!canPlaceSymbols) break
            e.preventDefault()
            togglePanel('library')
            break
          case 'p':
          case 'P':
            e.preventDefault()
            togglePanel('properties')
            break
          case 'd':
          case 'D': {
            if (!canEditProject) break
            const isTypingDup = isKeyboardTypingTarget(e.target)
            if (isTypingDup || e.shiftKey) break
            e.preventDefault()
            let duplicated = false
            const selDup = useUIStore.getState().selection
            const store = useProjectStore.getState()
            const ui = useUIStore.getState()
            const panelIdx =
              findPanelIndexAtPoint(mousePos.current.x, mousePos.current.y) ??
              findPanelIndexFromTarget(e.target)
            const hoveredCanvas = panelIdx != null ? layout.panels[panelIdx]?.canvas : undefined
            const onPlanCanvas = hoveredCanvas === 'plan'
            const planGetters = {
              getEndpointById: store.getEndpointById,
              getPlacementById: store.getPlacementById,
              getPlacementsByFloor: store.getPlacementsByFloor,
              findCircuitForEndpoint: store.findCircuitForEndpoint,
              getPanelById: store.getPanelById,
              getPanelByName: store.getPanelByName,
              getAllEndpoints: store.getAllEndpoints,
              getCurrentProject: () => store.currentProject,
            }
            const preferPlanDuplicate = onPlanCanvas || selDup.type === 'placement'
            if (
              preferPlanDuplicate &&
              canDuplicatePlanSelection(selDup, planGetters, ui.activeFloorId)
            ) {
              const planDupResult = runPlanDuplicate(selDup, ui.activeFloorId, {
                withSingleUndoEntry: (fn, opts) => store.withSingleUndoEntry(fn, opts),
              })
              if (planDupResult) {
                duplicated = true
                ui.setSelection(planDupResult)
              }
            }
            if (!duplicated) {
              const getters = {
                getEndpointById: store.getEndpointById,
                getCircuitById: store.getCircuitById,
                findCircuitForEndpoint: store.findCircuitForEndpoint,
                getTrunkDeviceById: store.getTrunkDeviceById,
                getProtectionById: store.getProtectionById,
                getCurrentProject: () => store.currentProject,
                getSupplyTrunkDeviceIndex: (id: string) =>
                  (store.currentProject
                    ? getProjectElectricalInstallation(store.currentProject)
                    : undefined
                  )?.mainSupply?.supplyTrunkDevices?.findIndex(
                    (d: { id: string }) => d.id === id
                  ) ?? -1,
                getGroundTrunkDeviceIndex: (id: string) =>
                  store.currentProject
                    ? findGroundTrunkDeviceOwner(
                        getProjectElectricalPanels(store.currentProject),
                        getProjectElectricalInstallation(store.currentProject),
                        id
                      )?.index ?? -1
                    : -1,
              }
              if (canDuplicateEendraadSelection(selDup, getters)) {
                const dupResult = runEendraadDuplicate(
                  selDup,
                  getters,
                  {
                    addEndpoint: store.addEndpoint,
                    syncEndpointMultiplierCount: (endpointId: string, count: number) =>
                      syncEndpointMultiplierCount(
                        createSyncEndpointMultiplierDeps(),
                        endpointId,
                        count
                      ),
                    addCircuit: store.addCircuit,
                    addTrunkDevice: store.addTrunkDevice,
                    updateTrunkDevice: store.updateTrunkDevice,
                    addSupplyTrunkDevice: store.addSupplyTrunkDevice,
                    syncSupplyDeviceMultiplierCount: (deviceId: string, count: number) =>
                      syncSupplyDeviceMultiplierCount(
                        createSyncSupplyInverterMultiplierDeps(),
                        deviceId,
                        count
                      ),
                    addGroundTrunkDevice: store.addGroundTrunkDevice,
                    insertProtectionAfter: store.insertProtectionAfter,
                    updateCircuit: store.updateCircuit,
                    setSelection: useUIStore.getState().setSelection,
                  },
                  (protectionId) => store.duplicateProtectionLeft(protectionId),
                  (fn, opts) => store.withSingleUndoEntry(fn, opts)
                )
                if (dupResult) {
                  duplicated = true
                  useUIStore.getState().setSelection(dupResult.selection)
                }
              }
            }
            break
          }
        }
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') {
        if (planFloorDrawingConsumesTabRef.current) {
          return
        }
        if (isTextLikeFocusTarget(document.activeElement)) {
          return
        }
        const tabPanelIdx = findPanelIndexAtPoint(mousePos.current.x, mousePos.current.y)
        if (tabPanelIdx == null) {
          return
        }
        e.preventDefault()
        toggleMainDockPanelsCollapse()
        return
      }

      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Escape') {
        if (closeFloatingWindows()) {
          e.preventDefault()
          return
        }
      }

      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
        const isTyping = isKeyboardTypingTarget(e.target)

        // Don't hijack typable keys when focus is in an input
        if (
          isTyping &&
          [' ', '+', '-', '=', 'f', 'F', 'q', 'Q', 'w', 'W', 'd', 'D'].includes(e.key)
        ) {
          return
        }

        const canvasSwitchByFunctionKey: Record<string, CanvasType> = {
          F1: 'eendraad',
          F2: 'plan',
          F3: 'panel',
          F4: 'structure',
        }
        const switchTargetCanvas = canvasSwitchByFunctionKey[e.key]
        if (switchTargetCanvas) {
          if (switchTargetCanvas === 'structure' && !isStructuralCanvasEnabled()) return
          const panelIdx =
            findPanelIndexAtPoint(mousePos.current.x, mousePos.current.y) ??
            findPanelIndexFromTarget(e.target)
          if (panelIdx != null) {
            const panel = layout.panels[panelIdx]
            if (panel && panel.canvas !== switchTargetCanvas) {
              e.preventDefault()
              setPanelCanvas(panelIdx, switchTargetCanvas)
            }
          }
          return
        }
        if (e.key === ' ' || e.code === 'Space') {
          const spaceTarget = e.target
          if (spaceTarget instanceof Element && spaceTarget.closest('button')) {
            return
          }

          e.preventDefault()
          dispatchExtendPropertiesPanelFieldBlur()

          const idx =
            layout.panels.length > 1
              ? (findPanelIndexAtPoint(mousePos.current.x, mousePos.current.y) ??
                findPanelIndexFromTarget(e.target))
              : null
          applyFastViewportLayoutPreview(layout, idx)
          scheduleViewportPanelFocusToggle(idx)
          return
        }

        if (e.key === 'f' || e.key === 'F') {
          e.preventDefault()
          const idx =
            findPanelIndexAtPoint(mousePos.current.x, mousePos.current.y) ??
            findPanelIndexFromTarget(e.target)
          const targetPanel =
            idx != null ? layout.panels[idx] : layout.panels.length === 1 ? layout.panels[0] : null
          if (targetPanel?.canvas === 'plan' && canEditProject) {
            const ui = useUIStore.getState()
            const store = useProjectStore.getState()
            const floorId = ui.activeFloorId
            const floor = floorId ? store.getFloorById(floorId) : undefined
            let targetPlacementId: string | undefined

            if (floorId && floor && ui.selection.ids.length > 0) {
              if (ui.selection.type === 'endpoint') {
                const endpointId = ui.selection.ids[0]!
                const endpoint = store.getEndpointById(endpointId)
                let placement = endpoint?.placements.find(
                  (candidate) => candidate.floorId === floorId
                )
                const repairableSitplanSymbols = new Set([
                  'junction_box',
                  'junction_panel',
                  'transformer',
                  'rectifier',
                  'inverter',
                  'dc_dc_converter',
                ])
                if (
                  !placement &&
                  endpoint?.symbol &&
                  repairableSitplanSymbols.has(endpoint.symbol) &&
                  store.currentProject
                ) {
                  const circuitId = store.findCircuitForEndpoint(endpointId)?.circuit.id
                  if (circuitId) {
                    placement =
                      buildAutoSitplanPlacement(store.currentProject, {
                        circuitId,
                        floorId,
                        placementId: generateId(),
                      }) ?? undefined
                    if (placement) {
                      store.addPlacement(endpointId, placement)
                    }
                  }
                }
                targetPlacementId = placement?.id
              } else if (ui.selection.type === 'trunkDevice') {
                const deviceId = ui.selection.ids[0]!
                const resolved = store.getTrunkDeviceById(deviceId)
                const device = resolved?.device
                let placement = device?.placements?.find(
                  (candidate) => candidate.floorId === floorId
                )
                if (
                  !placement &&
                  (device?.type === 'conversion' || device?.symbol === 'junction_box') &&
                  resolved?.circuit &&
                  store.currentProject
                ) {
                  placement =
                    buildAutoSitplanPlacement(store.currentProject, {
                      circuitId: resolved.circuit.id,
                      floorId,
                      placementId: generateId(),
                    }) ?? undefined
                  if (placement) {
                    store.updateTrunkDevice(resolved.circuit.id, deviceId, {
                      placements: [...(device.placements ?? []), placement],
                    })
                  }
                }
                targetPlacementId = placement?.id
              }
            }

            const refreshedFloor = floorId ? store.getFloorById(floorId) : undefined
            const hiddenIds = refreshedFloor?.hiddenSitplanPlacementIds ?? []
            if (floorId && targetPlacementId && hiddenIds.includes(targetPlacementId)) {
              const rows = store.getPlacementsByFloor(floorId)
              const rowById = new Map(rows.map((row) => [row.id, row]))
              const customPlacementIds = new Set(
                rows.filter(hasCustomPlacement).map((row) => row.id)
              )
              const items: HiddenItem[] = hiddenIds.flatMap((hiddenId) => {
                const row = rowById.get(hiddenId)
                if (!row) return []
                const endpoint = row.endpointId ? store.getEndpointById(row.endpointId) : undefined
                const trunkDevice = row.trunkDeviceId
                  ? store.getTrunkDeviceById(row.trunkDeviceId)?.device
                  : undefined
                const symbolKey = endpoint?.symbol ?? trunkDevice?.symbol
                const symbol = symbolKey ? getSymbolById(symbolKey) : undefined
                return [
                  {
                    id: hiddenId,
                    label:
                      endpoint?.label ||
                      trunkDevice?.label ||
                      symbol?.name ||
                      i18n.t('hiddenItemsDialog.unnamedItem', { defaultValue: 'Unnamed item' }),
                    subtitle: symbol
                      ? i18n.t(`symbols.${symbol.id}`, { defaultValue: symbol.name })
                      : undefined,
                    icon: symbol
                      ? createElement('img', {
                          src: symbol.svgPath,
                          alt: '',
                          className: 'w-7 h-7 object-contain dark:invert',
                        })
                      : undefined,
                  },
                ]
              })
              const { openDialog, closeDialog } = useDialogStore.getState()
              openDialog({
                type: 'custom',
                title: i18n.t('contextMenu.showHidden', { defaultValue: 'Show hidden…' }),
                content: createElement(HiddenItemsDialog, {
                  items,
                  initialSelectedIds: [targetPlacementId],
                  showMoveToCurrentView: true,
                  getMoveToCurrentViewDefault: (selectedIds: string[]) =>
                    selectedIds.some((id) => !customPlacementIds.has(id)),
                  onConfirm: (
                    selectedIds: string[],
                    options: {
                      moveToCurrentView: boolean
                      moveToCurrentViewOverridden: boolean
                    }
                  ) => {
                    restoreHiddenSituationPlanPlacementsToActiveView(selectedIds, {
                      moveToActiveView: options.moveToCurrentViewOverridden
                        ? options.moveToCurrentView
                        : undefined,
                    })
                    closeDialog()
                  },
                  onCancel: closeDialog,
                }),
              })
              return
            }
          }
          if (targetPanel) {
            // Fit the canvas under the pointer; without a hovered panel (touch), fit them all.
            const hoveredPanelIdx = findPanelIndexAtPoint(mousePos.current.x, mousePos.current.y)
            const canvasesToFit =
              layout.panels.length === 1 || hoveredPanelIdx != null
                ? [targetPanel.canvas]
                : Array.from(new Set(layout.panels.map((panel) => panel.canvas)))
            requestFitToView(canvasesToFit)
          }
          return
        }

        switch (e.key) {
          case '+':
          case '=':
            e.preventDefault()
            for (const canvas of allCanvases) {
              if (canvas === 'eendraad') {
                useUIStore.setState((state) => ({
                  eendraadView: {
                    ...state.eendraadView,
                    zoom: Math.min(ZOOM_MAX, state.eendraadView.zoom * 1.25),
                  },
                }))
              }
              if (canvas === 'plan') {
                useUIStore.setState((state) => ({
                  planView: {
                    ...state.planView,
                    zoom: Math.min(ZOOM_MAX, state.planView.zoom * 1.25),
                  },
                }))
              }
              if (canvas === 'panel') {
                useUIStore.setState((state) => ({
                  panelView: {
                    ...state.panelView,
                    zoom: Math.min(ZOOM_MAX, state.panelView.zoom * 1.25),
                  },
                }))
              }
            }
            break
          case '-':
            e.preventDefault()
            for (const canvas of allCanvases) {
              if (canvas === 'eendraad') {
                useUIStore.setState((state) => ({
                  eendraadView: {
                    ...state.eendraadView,
                    zoom: Math.max(ZOOM_MIN, state.eendraadView.zoom / 1.25),
                  },
                }))
              }
              if (canvas === 'plan') {
                const activeFloorId = useUIStore.getState().activeFloorId
                const activeFloor = activeFloorId
                  ? useProjectStore.getState().getFloorById(activeFloorId)
                  : null
                const committedPxPerMeter = activeFloor?.planScaleNeedsCalibration
                  ? null
                  : resolvePlanPxPerMeter(activeFloor?.scale)
                const planMinZoom = getPlanZoomMinimum(committedPxPerMeter)
                useUIStore.setState((state) => ({
                  planView: {
                    ...state.planView,
                    zoom: Math.max(planMinZoom, state.planView.zoom / 1.25),
                  },
                }))
              }
              if (canvas === 'panel') {
                useUIStore.setState((state) => ({
                  panelView: {
                    ...state.panelView,
                    zoom: Math.max(ZOOM_MIN, state.panelView.zoom / 1.25),
                  },
                }))
              }
            }
            break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    findPanelIndexAtPoint,
    findPanelIndexFromTarget,
    applyFastViewportLayoutPreview,
    redo,
    requestFitToView,
    scheduleViewportPanelFocusToggle,
    closeFloatingWindows,
    toggleMainDockPanelsCollapse,
    togglePanel,
    setPanelCanvas,
    undo,
    canEditProject,
    canPlaceSymbols,
  ])
}
