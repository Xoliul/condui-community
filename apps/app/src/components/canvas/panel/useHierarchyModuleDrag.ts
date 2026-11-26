import { snapPanelGridColToFields } from '@/lib/panel/panelGridFields'
import type { BuiltPanelScene } from '@/lib/panel/panelScene'
import type { useHierarchyLibraryDrop } from './useHierarchyLibraryDrop'

import type {
  Project,
  HierarchySurface,
  HierarchyDragPreview,
  PanelOption,
} from './hierarchyPanelCanvasModel'

import {
  updatePanelGridSlots,
  updateSupplyPanelSlots,
  createAuxiliarySupplyEnclosure,
  moveSupplyDeviceToAuxiliaryEnclosure,
  moveSupplyDeviceToPanelEnclosure,
  moveSupplyDeviceToGridEnclosure,
  moveTerminalStripToPanel,
  moveCircuitModule,
  createCircuitModuleEnclosure,
  editPanelLayout,
} from '@/handlers/panel/editPanelLayout'
import { findRemountableCircuitModule } from '@/lib/panel/circuitModuleMounting'
import { getJunctionPanelModuleLayout, getJunctionPanelModuleRowOffset } from '@/lib/junctionPanel/moduleLayout'
import { logger } from '@/lib/logger'
import { useCallback } from 'react'

import { useUIStore } from '@/stores/uiStore'

import { useProjectStore } from '@/stores/projectStore'

import {
  panelGridModuleRefKey,
  resolveModuleWidthCols,
  CELL_W,
  CELL_H,
  ROW_GAP,
  ROW_STRIDE,
  TERMINAL_STRIP_RAIL_H,
  getTerminalStripTopOffset,
  snapTerminalStripPlacementCol,
  snapToGrid,
  type ModulePlacement,
} from '@/lib/panel/panelGridLayout'

import { getPanelSceneSurfaceGrid, PANEL_SCENE_SIBLING_GAP } from '@/lib/panel/panelScene'

import { resolveTerminalStripModule } from '@/lib/eendraad/projectElectricalDomain'
import type { PanelGridSlot, PanelGridModuleRef } from '@/types/schema'

import type { Selection as CanvasSelection } from '@/types/ui'

import { clamp } from '@/lib/geometry'

import { upsertPanelGridSlotPosition } from '@/lib/panel/panelSupplySlots'
import { MIN_PANEL_GRID_MODULE_WIDTH, normalizePanelModuleMeasure } from '@/lib/panel/panelGridUnits'
import { isAuxiliaryMountableSupplyDevice, planAuxiliarySupplyEnclosureGrid } from '@/lib/panel/auxiliarySupplyEnclosures'

import type { Dispatch, SetStateAction } from 'react'
import { PANEL_SCENE_FRAME_MARGIN as PANEL_FRAME_MARGIN } from '@/lib/panel/panelScene'

interface HierarchyModuleDragOptions {
  currentProject: Project | null
  detectHierarchyModuleDropTarget: ReturnType<typeof useHierarchyLibraryDrop>['detectHierarchyModuleDropTarget']
  hierarchyFeedFromTop: boolean
  isHierarchyRefInSelection: (ref: PanelGridModuleRef) => boolean
  moduleDragPreview: HierarchyDragPreview | null
  panelOptions: PanelOption[]
  scene: BuiltPanelScene | null
  selection: CanvasSelection
  setModuleDragLive: Dispatch<SetStateAction<HierarchyDragPreview | null>>
  setModuleDragPreview: Dispatch<SetStateAction<HierarchyDragPreview | null>>
  setSelection: ReturnType<typeof useUIStore.getState>['setSelection']
}

export function useHierarchyModuleDrag({
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
}: HierarchyModuleDragOptions) {
  const handleHierarchyModuleDragMove = useCallback(
    (
      surface: HierarchySurface,
      placement: ModulePlacement & { inSupplyPanel?: boolean },
      rawX: number,
      rawY: number,
      shiftKey = false,
      altKey = false
    ) => {
      const isAltDuplicate =
        altKey &&
        !placement.inSupplyPanel &&
        (placement.ref.kind === 'protection' || placement.ref.kind === 'domotica')
      const surfaceTargetId = surface.panel?.id ?? surface.id
      const key = panelGridModuleRefKey(placement.ref)
      const moduleCols = Math.max(
        MIN_PANEL_GRID_MODULE_WIDTH,
        normalizePanelModuleMeasure(placement.width / CELL_W)
      )
      const maxCol = Math.max(0, surface.cols - moduleCols)
      const selectedPlacements =
        !isAltDuplicate && selection.ids.length >= 2 && isHierarchyRefInSelection(placement.ref)
          ? surface.placements.filter(
              (other) =>
                other.inSupplyPanel === placement.inSupplyPanel &&
                isHierarchyRefInSelection(other.ref)
            )
          : []

      if (placement.ref.kind === 'trunkDevice' && placement.ref.scope === 'supply') {
        const canvasPos = { x: surface.x + rawX, y: surface.y + rawY }
        const detectedTarget = detectHierarchyModuleDropTarget(canvasPos, placement.ref)
        const target = detectedTarget
        const currentArea =
          surface.kind === 'auxiliary' ? 'auxiliary' : placement.inSupplyPanel ? 'supply' : 'main'
        const targetSurfaceId = target ? (target.surface.panel?.id ?? target.surface.id) : null
        const currentSurfaceId = surface.panel?.id ?? surface.id
        if (target && (targetSurfaceId !== currentSurfaceId || target.area !== currentArea)) {
          const targetCols =
            target.area === 'supply' ? target.surface.supplyCols : target.surface.cols
          const targetRows =
            target.area === 'supply' ? target.surface.supplyRows : target.surface.rows
          const targetMaxCol = Math.max(0, targetCols - moduleCols)
          const localX = canvasPos.x - target.surface.x - PANEL_FRAME_MARGIN
          const localY =
            target.area === 'supply'
              ? canvasPos.y - target.surface.y - target.surface.supplyPanelY - PANEL_FRAME_MARGIN
              : canvasPos.y -
                target.surface.y -
                target.surface.mainPanelY -
                PANEL_FRAME_MARGIN -
                getTerminalStripTopOffset(getPanelSceneSurfaceGrid(target.surface))
          const snapped = snapToGrid(localX, localY + CELL_H / 2)
          const row = clamp(snapped.row, 0, targetRows - 1)
          const col = snapPanelGridColToFields(target.area === 'supply' ? undefined : target.surface.panel?.gridView, clamp(snapped.col, 0, targetMaxCol), moduleCols)
          const targetY =
            target.area === 'supply'
              ? target.surface.y +
                target.surface.supplyPanelY +
                PANEL_FRAME_MARGIN +
                row * ROW_STRIDE
              : target.surface.y +
                target.surface.mainPanelY +
                PANEL_FRAME_MARGIN +
                getTerminalStripTopOffset(getPanelSceneSurfaceGrid(target.surface)) +
                row * ROW_STRIDE
          const invalid = target.surface.placements.some((other) => {
            const otherArea =
              target.surface.kind === 'auxiliary'
                ? 'auxiliary'
                : other.inSupplyPanel === true
                  ? 'supply'
                  : 'main'
            if (otherArea !== target.area) return false
            if (panelGridModuleRefKey(other.ref) === key) return false
            if (other.row !== row) return false
            const otherCols = Math.max(
              MIN_PANEL_GRID_MODULE_WIDTH,
              normalizePanelModuleMeasure(other.width / CELL_W)
            )
            return col < other.col + otherCols && other.col < col + moduleCols
          })
          setModuleDragLive({
            surfaceId: targetSurfaceId ?? currentSurfaceId,
            x: canvasPos.x,
            y: canvasPos.y,
            width: placement.width,
            height: placement.height,
            ref: placement.ref,
          })
          setModuleDragPreview({
            surfaceId: targetSurfaceId ?? currentSurfaceId,
            x: target.surface.x + PANEL_FRAME_MARGIN + col * CELL_W,
            y: targetY,
            width: placement.width,
            height: placement.height,
            ref: placement.ref,
            invalid,
          })
          return
        }
        const ownerPanelId =
          surface.enclosure?.ownerPanelId ??
          surface.panel?.id ??
          panelOptions.find((option) => option.isRoot && option.panel.isMain)?.panel.id
        const creationPlacements = selectedPlacements.length >= 2 ? selectedPlacements : [placement]
        const creationDeviceIds = creationPlacements.flatMap((candidate) =>
          candidate.ref.kind === 'trunkDevice' && candidate.ref.scope === 'supply'
            ? [candidate.ref.id]
            : []
        )
        const completeEligibleSelection =
          (selection.ids.length <= 1 || creationPlacements.length === selection.ids.length) &&
          creationDeviceIds.length === creationPlacements.length &&
          currentProject != null &&
          creationDeviceIds.every((deviceId) =>
            isAuxiliaryMountableSupplyDevice(currentProject, deviceId)
          )
        const plannedGrid =
          currentProject && completeEligibleSelection
            ? planAuxiliarySupplyEnclosureGrid(currentProject, creationDeviceIds)
            : null
        const isInsideSurface = scene?.surfaces.some(
          (candidate) =>
            canvasPos.x >= candidate.x &&
            canvasPos.x <= candidate.x + candidate.width &&
            canvasPos.y >= candidate.y &&
            canvasPos.y <= candidate.y + candidate.height
        )
        if (!target && !isInsideSurface && ownerPanelId && currentProject && scene) {
          const fallbackColumns = Math.max(
            1,
            creationPlacements.reduce(
              (sum, candidate) =>
                sum +
                Math.max(
                  MIN_PANEL_GRID_MODULE_WIDTH,
                  normalizePanelModuleMeasure(candidate.width / CELL_W)
                ),
              0
            )
          )
          const previewWidth =
            (plannedGrid?.columns ?? fallbackColumns) * CELL_W + PANEL_FRAME_MARGIN * 2
          const previewHeight =
            (plannedGrid?.rows ?? 1) * CELL_H +
            Math.max(0, (plannedGrid?.rows ?? 1) - 1) * ROW_GAP +
            PANEL_FRAME_MARGIN * 2
          const existingOwnerEnclosure = scene.surfaces.find(
            (candidate) =>
              candidate.kind === 'auxiliary' && candidate.enclosure?.ownerPanelId === ownerPanelId
          )
          const sharedSurface = scene.surfaces.find(
            (candidate) => candidate.kind === 'shared_supply'
          )
          const ownerSurface = scene.surfaces.find(
            (candidate) => candidate.kind === 'panel' && candidate.panel?.id === ownerPanelId
          )
          const transitionY = existingOwnerEnclosure
            ? existingOwnerEnclosure.y
            : sharedSurface && ownerSurface && sharedSurface.y < ownerSurface.y
              ? ownerSurface.y
              : sharedSurface && ownerSurface
                ? ownerSurface.y + ownerSurface.height
                : Math.max(0, canvasPos.y - PANEL_FRAME_MARGIN - CELL_H / 2)
          setModuleDragLive({
            surfaceId: surfaceTargetId,
            x: canvasPos.x,
            y: canvasPos.y,
            width: placement.width,
            height: placement.height,
            ref: placement.ref,
            items: creationPlacements.map((candidate) => ({
              ref: candidate.ref,
              x: surface.x + candidate.x + (rawX - placement.x),
              y: surface.y + candidate.y + (rawY - placement.y),
              width: candidate.width,
              height: candidate.height,
            })),
          })
          setModuleDragPreview({
            surfaceId: '__new_auxiliary__',
            x: Math.max(0, canvasPos.x - PANEL_FRAME_MARGIN - placement.width / 2),
            y: Math.max(0, transitionY),
            width: previewWidth,
            height: previewHeight,
            ref: placement.ref,
            createAuxiliary: true,
            deviceIds: creationDeviceIds,
            invalid: plannedGrid == null,
          })
          return
        }
      }

      const circuitModule =
        !placement.inSupplyPanel &&
        currentProject != null &&
        resolveTerminalStripModule(currentProject, placement.ref) == null
          ? findRemountableCircuitModule(currentProject, placement.ref)
          : undefined
      if (circuitModule && currentProject && scene) {
        const canvasPos = { x: surface.x + rawX, y: surface.y + rawY }
        const target = detectHierarchyModuleDropTarget(canvasPos, placement.ref)
        const currentSurfaceId = surface.panel?.id ?? surface.id
        const targetSurfaceId = target?.surface.panel?.id ?? target?.surface.id
        if (
          selectedPlacements.length < 2 &&
          (target?.area === 'main' || target?.area === 'auxiliary') &&
          (targetSurfaceId !== currentSurfaceId || target.area === 'auxiliary')
        ) {
          const targetPanel = target.surface.enclosure
            ? { ...target.panel, gridView: target.surface.enclosure.gridView }
            : target.panel
          const targetMaxCol = Math.max(0, target.surface.cols - moduleCols)
          const localX = canvasPos.x - target.surface.x - PANEL_FRAME_MARGIN
          const localY =
            canvasPos.y -
            target.surface.y -
            target.surface.mainPanelY -
            PANEL_FRAME_MARGIN -
            getTerminalStripTopOffset(targetPanel)
          const snapped = snapToGrid(localX, localY + CELL_H / 2)
          const row = clamp(snapped.row, 0, target.surface.rows - 1)
          const col = snapPanelGridColToFields(target.surface.panel?.gridView, clamp(snapped.col, 0, targetMaxCol), moduleCols)
          const invalid = target.surface.placements.some((other) => {
            if (other.terminalStripRail) return false
            if (other.inSupplyPanel && target.area !== 'auxiliary') return false
            if (panelGridModuleRefKey(other.ref) === key) return false
            if (other.row !== row) return false
            const otherCols = Math.max(
              MIN_PANEL_GRID_MODULE_WIDTH,
              normalizePanelModuleMeasure(other.width / CELL_W)
            )
            return col < other.col + otherCols && other.col < col + moduleCols
          })
          setModuleDragLive({
            surfaceId: targetSurfaceId ?? currentSurfaceId,
            x: canvasPos.x,
            y: canvasPos.y,
            width: placement.width,
            height: placement.height,
            ref: placement.ref,
          })
          setModuleDragPreview({
            surfaceId: targetSurfaceId ?? currentSurfaceId,
            x: target.surface.x + PANEL_FRAME_MARGIN + col * CELL_W,
            y:
              target.surface.y +
              target.surface.mainPanelY +
              PANEL_FRAME_MARGIN +
              getTerminalStripTopOffset(targetPanel) +
              row * ROW_STRIDE,
            width: placement.width,
            height: CELL_H,
            ref: placement.ref,
            invalid,
          })
          return
        }
        const isInsideSurface = scene.surfaces.some(
          (candidate) =>
            canvasPos.x >= candidate.x &&
            canvasPos.x <= candidate.x + candidate.width &&
            canvasPos.y >= candidate.y &&
            canvasPos.y <= candidate.y + candidate.height
        )
        if (!target && !isInsideSurface) {
          const creationPlacements =
            selectedPlacements.length >= 2 ? selectedPlacements : [placement]
          const creationRefs = creationPlacements.map((candidate) => candidate.ref)
          const allCircuitModules =
            (selection.ids.length <= 1 || creationPlacements.length === selection.ids.length) &&
            creationRefs.every(
              (ref) =>
                resolveTerminalStripModule(currentProject, ref) == null &&
                findRemountableCircuitModule(currentProject, ref) != null
            )
          const columns = Math.max(
            12,
            creationPlacements.reduce(
              (sum, candidate) =>
                sum +
                Math.max(
                  MIN_PANEL_GRID_MODULE_WIDTH,
                  normalizePanelModuleMeasure(candidate.width / CELL_W)
                ),
              0
            )
          )
          // The new enclosure will hang beside the board its modules belong to.
          const ownerPanelId = circuitModule.ownerPanel.id
          const ownerSurface = scene.surfaces.find(
            (candidate) => candidate.kind === 'panel' && candidate.panel?.id === ownerPanelId
          )
          const previewHeight = CELL_H + PANEL_FRAME_MARGIN * 2
          const besideX = ownerSurface
            ? Math.max(
                ownerSurface.x + ownerSurface.width,
                ...scene.surfaces
                  .filter(
                    (candidate) =>
                      candidate.enclosure?.kind === 'other' &&
                      candidate.enclosure.ownerPanelId === ownerPanelId
                  )
                  .map((candidate) => candidate.x + candidate.width)
              ) + PANEL_SCENE_SIBLING_GAP
            : Math.max(0, canvasPos.x - PANEL_FRAME_MARGIN - placement.width / 2)
          const besideY = ownerSurface
            ? hierarchyFeedFromTop
              ? ownerSurface.y
              : ownerSurface.y + ownerSurface.height - previewHeight
            : Math.max(0, canvasPos.y - PANEL_FRAME_MARGIN - CELL_H / 2)
          setModuleDragLive({
            surfaceId: surfaceTargetId,
            x: canvasPos.x,
            y: canvasPos.y,
            width: placement.width,
            height: placement.height,
            ref: placement.ref,
            items: creationPlacements.map((candidate) => ({
              ref: candidate.ref,
              x: surface.x + candidate.x + (rawX - placement.x),
              y: surface.y + candidate.y + (rawY - placement.y),
              width: candidate.width,
              height: candidate.height,
            })),
          })
          setModuleDragPreview({
            surfaceId: '__new_auxiliary__',
            x: besideX,
            y: besideY,
            width: Math.min(columns, 18) * CELL_W + PANEL_FRAME_MARGIN * 2,
            height: previewHeight,
            ref: placement.ref,
            createAuxiliary: true,
            circuitModuleRefs: creationRefs,
            invalid: !allCircuitModules,
          })
          return
        }
      }

      const isTerminalStrip =
        !placement.inSupplyPanel &&
        currentProject != null &&
        resolveTerminalStripModule(currentProject, placement.ref) != null
      if (isTerminalStrip) {
        const canvasPos = { x: surface.x + rawX, y: surface.y + rawY }
        const target = detectHierarchyModuleDropTarget(canvasPos, placement.ref)
        const currentSurfaceId = surface.panel?.id ?? surface.id
        const targetSurfaceId = target?.surface.panel?.id ?? target?.surface.id
        if (
          (target?.area === 'main' || target?.area === 'auxiliary') &&
          (targetSurfaceId !== currentSurfaceId || target.area === 'auxiliary')
        ) {
          const targetPanel = target.surface.enclosure
            ? { ...target.panel, gridView: target.surface.enclosure.gridView }
            : target.panel
          const targetMaxCol = Math.max(0, target.surface.cols - moduleCols)
          const localX = canvasPos.x - target.surface.x - PANEL_FRAME_MARGIN
          const panelLocalY = canvasPos.y - target.surface.y - target.surface.mainPanelY
          const topRail =
            targetPanel.gridView?.terminalStripTopRail === true &&
            panelLocalY <= PANEL_FRAME_MARGIN + TERMINAL_STRIP_RAIL_H + ROW_GAP / 2
          const bottomRail =
            targetPanel.gridView?.terminalStripBottomRail === true &&
            panelLocalY >=
              target.surface.panelFrameHeight -
                PANEL_FRAME_MARGIN -
                TERMINAL_STRIP_RAIL_H -
                ROW_GAP / 2
          const targetRail = topRail ? 'top' : bottomRail ? 'bottom' : undefined
          const localY = panelLocalY - PANEL_FRAME_MARGIN - getTerminalStripTopOffset(targetPanel)
          const snapped = snapToGrid(localX, localY + CELL_H / 2)
          const row = clamp(snapped.row, 0, target.surface.rows - 1)
          const col = snapTerminalStripPlacementCol(
            localX,
            moduleCols,
            targetMaxCol,
            row,
            target.surface.placements.filter(
              (other) =>
                panelGridModuleRefKey(other.ref) !== key &&
                !other.terminalStripMemberRefs?.some(
                  (member) => panelGridModuleRefKey(member) === key
                )
            ),
            shiftKey,
            targetRail
          )
          const invalid = target.surface.placements.some((other) => {
            if (
              (other.inSupplyPanel && target.area !== 'auxiliary') ||
              other.terminalStripRail !== targetRail
            )
              return false
            if (
              panelGridModuleRefKey(other.ref) === key ||
              other.terminalStripMemberRefs?.some((member) => panelGridModuleRefKey(member) === key)
            )
              return false
            if (!targetRail && other.row !== row) return false
            const otherCols = Math.max(
              MIN_PANEL_GRID_MODULE_WIDTH,
              normalizePanelModuleMeasure(other.width / CELL_W)
            )
            return col < other.col + otherCols && other.col < col + moduleCols
          })
          const previewY =
            targetRail === 'top'
              ? target.surface.y + target.surface.mainPanelY + PANEL_FRAME_MARGIN
              : targetRail === 'bottom'
                ? target.surface.y +
                  target.surface.mainPanelY +
                  target.surface.panelFrameHeight -
                  PANEL_FRAME_MARGIN -
                  TERMINAL_STRIP_RAIL_H
                : target.surface.y +
                  target.surface.mainPanelY +
                  PANEL_FRAME_MARGIN +
                  getTerminalStripTopOffset(targetPanel) +
                  row * ROW_STRIDE
          setModuleDragLive({
            surfaceId: targetSurfaceId ?? currentSurfaceId,
            x: canvasPos.x,
            y: canvasPos.y,
            width: placement.width,
            height: placement.height,
            ref: placement.ref,
          })
          setModuleDragPreview({
            surfaceId: targetSurfaceId ?? currentSurfaceId,
            x: target.surface.x + PANEL_FRAME_MARGIN + col * CELL_W,
            y: previewY,
            width: placement.width,
            height: targetRail ? TERMINAL_STRIP_RAIL_H : CELL_H,
            ref: placement.ref,
            invalid,
          })
          return
        }
      }

      if (placement.inSupplyPanel) {
        const dx = rawX - placement.x
        const dy = rawY - placement.y
        if (selectedPlacements.length >= 2) {
          setModuleDragLive({
            surfaceId: surfaceTargetId,
            x: surface.x + rawX,
            y: surface.y + rawY,
            width: placement.width,
            height: placement.height,
            ref: placement.ref,
            items: selectedPlacements.map((selectedPlacement) => ({
              ref: selectedPlacement.ref,
              x: surface.x + selectedPlacement.x + dx,
              y: surface.y + selectedPlacement.y + dy,
              width: selectedPlacement.width,
              height: selectedPlacement.height,
            })),
          })
        } else {
          setModuleDragLive({
            surfaceId: surfaceTargetId,
            x: surface.x + rawX,
            y: surface.y + rawY,
            width: placement.width,
            height: placement.height,
            ref: placement.ref,
          })
        }
        const col = Math.max(0, Math.min(maxCol, Math.round((rawX - PANEL_FRAME_MARGIN) / CELL_W)))
        if (selectedPlacements.length >= 2) {
          const deltaCol = col - placement.col
          const previewItems = selectedPlacements.map((selectedPlacement) => ({
            ref: selectedPlacement.ref,
            col: selectedPlacement.col + deltaCol,
            x: surface.x + PANEL_FRAME_MARGIN + (selectedPlacement.col + deltaCol) * CELL_W,
            y: surface.y + surface.supplyPanelY + PANEL_FRAME_MARGIN,
            width: selectedPlacement.width,
            height: selectedPlacement.height,
          }))
          const invalid =
            previewItems.some((item) => {
              const widthCols = Math.max(
                MIN_PANEL_GRID_MODULE_WIDTH,
                normalizePanelModuleMeasure(item.width / CELL_W)
              )
              return item.col < 0 || item.col > surface.cols - widthCols
            }) ||
            surface.placements.some((other) => {
              if (!other.inSupplyPanel) return false
              if (
                selectedPlacements.some(
                  (selected) =>
                    panelGridModuleRefKey(selected.ref) === panelGridModuleRefKey(other.ref)
                )
              ) {
                return false
              }
              const otherCols = Math.max(
                MIN_PANEL_GRID_MODULE_WIDTH,
                normalizePanelModuleMeasure(other.width / CELL_W)
              )
              return previewItems.some((item) => {
                const widthCols = Math.max(
                  MIN_PANEL_GRID_MODULE_WIDTH,
                  normalizePanelModuleMeasure(item.width / CELL_W)
                )
                return item.col < other.col + otherCols && other.col < item.col + widthCols
              })
            })
          setModuleDragPreview({
            surfaceId: surfaceTargetId,
            x: surface.x + PANEL_FRAME_MARGIN + col * CELL_W,
            y: surface.y + surface.supplyPanelY + PANEL_FRAME_MARGIN,
            width: placement.width,
            height: placement.height,
            ref: placement.ref,
            invalid,
            items: previewItems.map(({ ref, x, y, width, height }) => ({
              ref,
              x,
              y,
              width,
              height,
            })),
          })
          return
        }
        const invalid = surface.placements.some((other) => {
          if (!other.inSupplyPanel) return false
          if (panelGridModuleRefKey(other.ref) === key) return false
          const otherCols = Math.max(
            MIN_PANEL_GRID_MODULE_WIDTH,
            normalizePanelModuleMeasure(other.width / CELL_W)
          )
          return col < other.col + otherCols && other.col < col + moduleCols
        })
        setModuleDragPreview({
          surfaceId: surfaceTargetId,
          x: surface.x + PANEL_FRAME_MARGIN + col * CELL_W,
          y: surface.y + surface.supplyPanelY + PANEL_FRAME_MARGIN,
          width: placement.width,
          height: placement.height,
          ref: placement.ref,
          invalid,
        })
        return
      }

      const localX = rawX - PANEL_FRAME_MARGIN
      const panelLocalY = rawY - surface.mainPanelY
      const panel = getPanelSceneSurfaceGrid(surface)
      const junctionRowOffset = surface.junctionPanelGridView
        ? getJunctionPanelModuleRowOffset(surface.junctionPanelGridView)
        : 0
      const previewIsTerminal =
        currentProject != null && resolveTerminalStripModule(currentProject, placement.ref) != null
      const previewTopRail =
        previewIsTerminal &&
        panel?.gridView?.terminalStripTopRail === true &&
        panelLocalY <= PANEL_FRAME_MARGIN + TERMINAL_STRIP_RAIL_H + ROW_GAP / 2
      const previewBottomRail =
        previewIsTerminal &&
        panel?.gridView?.terminalStripBottomRail === true &&
        panelLocalY >=
          surface.panelFrameHeight - PANEL_FRAME_MARGIN - TERMINAL_STRIP_RAIL_H - ROW_GAP / 2
      const previewRail = previewTopRail ? 'top' : previewBottomRail ? 'bottom' : undefined
      const localY =
        panelLocalY -
        PANEL_FRAME_MARGIN -
        getTerminalStripTopOffset(panel) -
        junctionRowOffset * ROW_STRIDE
      const snapped = snapToGrid(localX, localY + CELL_H / 2)
      const row = clamp(snapped.row, 0, Math.max(0, surface.rows - junctionRowOffset - 1))
      const col = previewIsTerminal
        ? snapTerminalStripPlacementCol(
            localX,
            moduleCols,
            maxCol,
            row,
            surface.placements.filter(
              (other) => panelGridModuleRefKey(other.ref) !== key && !other.inSupplyPanel
            ),
            shiftKey,
            previewRail
          )
        : clamp(snapped.col, 0, maxCol)
      const dx = rawX - placement.x
      const dy = rawY - placement.y
      if (selectedPlacements.length >= 2) {
        setModuleDragLive({
          surfaceId: surfaceTargetId,
          x: surface.x + rawX,
          y: surface.y + rawY,
          width: placement.width,
          height: placement.height,
          ref: placement.ref,
          items: selectedPlacements.map((selectedPlacement) => ({
            ref: selectedPlacement.ref,
            x: surface.x + selectedPlacement.x + dx,
            y: surface.y + selectedPlacement.y + dy,
            width: selectedPlacement.width,
            height: selectedPlacement.height,
          })),
        })
      } else {
        setModuleDragLive({
          isAltDuplicate,
          surfaceId: surfaceTargetId,
          x: surface.x + rawX,
          y: surface.y + rawY,
          width: placement.width,
          height: placement.height,
          ref: placement.ref,
        })
      }
      if (selectedPlacements.length >= 2) {
        const deltaRow = row - placement.row
        const deltaCol = col - placement.col
        const previewItems = selectedPlacements.map((selectedPlacement) => ({
          ref: selectedPlacement.ref,
          row: selectedPlacement.row + deltaRow,
          col: selectedPlacement.col + deltaCol,
          x: surface.x + PANEL_FRAME_MARGIN + (selectedPlacement.col + deltaCol) * CELL_W,
          y:
            surface.y +
            surface.mainPanelY +
            PANEL_FRAME_MARGIN +
            getTerminalStripTopOffset(panel) +
            (selectedPlacement.row + deltaRow + junctionRowOffset) * ROW_STRIDE,
          width: selectedPlacement.width,
          height: selectedPlacement.height,
        }))
        const invalid =
          previewItems.some((item) => {
            const widthCols = Math.max(
              MIN_PANEL_GRID_MODULE_WIDTH,
              normalizePanelModuleMeasure(item.width / CELL_W)
            )
            return (
              item.row < 0 ||
              item.row >= surface.rows - junctionRowOffset ||
              item.col < 0 ||
              item.col > surface.cols - widthCols
            )
          }) ||
          surface.placements.some((other) => {
            if (other.inSupplyPanel || other.junctionPanelTerminal) return false
            if (
              selectedPlacements.some(
                (selected) =>
                  panelGridModuleRefKey(selected.ref) === panelGridModuleRefKey(other.ref)
              )
            ) {
              return false
            }
            const otherCols = Math.max(
              MIN_PANEL_GRID_MODULE_WIDTH,
              normalizePanelModuleMeasure(other.width / CELL_W)
            )
            return previewItems.some((item) => {
              const widthCols = Math.max(
                MIN_PANEL_GRID_MODULE_WIDTH,
                normalizePanelModuleMeasure(item.width / CELL_W)
              )
              if (item.row !== other.row) return false
              return item.col < other.col + otherCols && other.col < item.col + widthCols
            })
          })
        setModuleDragPreview({
          surfaceId: surfaceTargetId,
          x: surface.x + PANEL_FRAME_MARGIN + col * CELL_W,
          y:
            surface.y +
            surface.mainPanelY +
            PANEL_FRAME_MARGIN +
            getTerminalStripTopOffset(panel) +
            (row + junctionRowOffset) * ROW_STRIDE,
          width: placement.width,
          height: placement.height,
          ref: placement.ref,
          invalid,
          items: previewItems.map(({ ref, x, y, width, height }) => ({ ref, x, y, width, height })),
        })
        return
      }
      const invalid = surface.placements.some((other) => {
        if (other.inSupplyPanel || other.junctionPanelTerminal) return false
        if (panelGridModuleRefKey(other.ref) === key) return false
        if (other.terminalStripRail !== previewRail) return false
        if (!previewRail && other.row !== row) return false
        const otherCols = Math.max(
          MIN_PANEL_GRID_MODULE_WIDTH,
          normalizePanelModuleMeasure(other.width / CELL_W)
        )
        return col < other.col + otherCols && other.col < col + moduleCols
      })
      setModuleDragPreview({
        surfaceId: surfaceTargetId,
        x: surface.x + PANEL_FRAME_MARGIN + col * CELL_W,
        y:
          surface.y +
          surface.mainPanelY +
          PANEL_FRAME_MARGIN +
          (previewRail === 'top'
            ? 0
            : previewRail === 'bottom'
              ? surface.panelFrameHeight - PANEL_FRAME_MARGIN * 2 - TERMINAL_STRIP_RAIL_H
              : getTerminalStripTopOffset(panel) + (row + junctionRowOffset) * ROW_STRIDE),
        width: placement.width,
        height: previewRail ? TERMINAL_STRIP_RAIL_H : CELL_H,
        ref: placement.ref,
        invalid,
      })
    },
    [
      currentProject,
      detectHierarchyModuleDropTarget,
      hierarchyFeedFromTop,
      isHierarchyRefInSelection,
      panelOptions,
      scene,
      selection.ids.length,
      setModuleDragLive,
      setModuleDragPreview,
    ]
  )

  const handleHierarchyModuleDragEnd = useCallback(
    (
      surface: HierarchySurface,
      placement: ModulePlacement & { inSupplyPanel?: boolean },
      rawX: number,
      rawY: number,
      shiftKey = false
    ) => {
      logger.warn('[PanelCanvas hierarchy drag] handleHierarchyModuleDragEnd:start', {
        surfaceId: surface.id,
        panelId: surface.panel?.id ?? null,
        placementRef: placement.ref,
        rawX,
        rawY,
        selection: useUIStore.getState().selection,
      })
      const preview = moduleDragPreview
      setModuleDragPreview(null)
      setModuleDragLive(null)
      const panel =
        surface.panel ??
        (surface.enclosure && panelOptions[0]
          ? { ...panelOptions[0].panel, gridView: surface.enclosure.gridView }
          : null)
      const surfaceTargetId = panel?.id ?? surface.id
      if (
        preview &&
        preview.surfaceId === surfaceTargetId &&
        preview.ref &&
        panelGridModuleRefKey(preview.ref) === panelGridModuleRefKey(placement.ref) &&
        preview.invalid
      ) {
        logger.warn('[PanelCanvas hierarchy drag] abort:invalid-preview')
        return
      }
      const key = panelGridModuleRefKey(placement.ref)
      const totalCols = placement.inSupplyPanel ? surface.supplyCols : surface.cols
      const totalRows = surface.rows
      const moduleCols = Math.max(
        MIN_PANEL_GRID_MODULE_WIDTH,
        normalizePanelModuleMeasure(placement.width / CELL_W)
      )
      const maxCol = Math.max(0, totalCols - moduleCols)
      const selectedPlacements =
        selection.ids.length >= 2 && isHierarchyRefInSelection(placement.ref)
          ? surface.placements.filter(
              (other) =>
                other.inSupplyPanel === placement.inSupplyPanel &&
                isHierarchyRefInSelection(other.ref)
            )
          : []

      if (placement.ref.kind === 'trunkDevice' && placement.ref.scope === 'supply') {
        const supplyRef = placement.ref
        if (preview?.invalid) return
        const canvasPos = { x: surface.x + rawX, y: surface.y + rawY }
        const detectedTarget = detectHierarchyModuleDropTarget(canvasPos, supplyRef)
        const target = detectedTarget
        const currentArea =
          surface.kind === 'auxiliary' ? 'auxiliary' : placement.inSupplyPanel ? 'supply' : 'main'
        const targetSurfaceId = target ? (target.surface.panel?.id ?? target.surface.id) : null
        const currentSurfaceId = surface.panel?.id ?? surface.id
        if (preview?.createAuxiliary) {
          const ownerPanelId = surface.enclosure?.ownerPanelId ?? surface.panel?.id
          const deviceIds = preview.deviceIds ?? [supplyRef.id]
          if (
            !ownerPanelId ||
            !currentProject ||
            deviceIds.length === 0 ||
            deviceIds.some(
              (deviceId) => !isAuxiliaryMountableSupplyDevice(currentProject, deviceId)
            )
          ) {
            return
          }
          const enclosureId = createAuxiliarySupplyEnclosure(deviceIds, ownerPanelId, {
            x: preview.x,
            y: preview.y,
          })
          if (enclosureId) setSelection({ type: 'auxiliaryEnclosure', ids: [enclosureId] })
          return
        }
        if (target && (targetSurfaceId !== currentSurfaceId || target.area !== currentArea)) {
          const targetCols =
            target.area === 'supply' ? target.surface.supplyCols : target.surface.cols
          const targetRows =
            target.area === 'supply' ? target.surface.supplyRows : target.surface.rows
          const targetMaxCol = Math.max(0, targetCols - moduleCols)
          const localX = canvasPos.x - target.surface.x - PANEL_FRAME_MARGIN
          const localY =
            target.area === 'supply'
              ? canvasPos.y - target.surface.y - target.surface.supplyPanelY - PANEL_FRAME_MARGIN
              : canvasPos.y -
                target.surface.y -
                target.surface.mainPanelY -
                PANEL_FRAME_MARGIN -
                getTerminalStripTopOffset(getPanelSceneSurfaceGrid(target.surface))
          const snapped = snapToGrid(localX, localY + CELL_H / 2)
          const row = clamp(snapped.row, 0, targetRows - 1)
          const col = snapPanelGridColToFields(target.area === 'supply' ? undefined : target.surface.panel?.gridView, clamp(snapped.col, 0, targetMaxCol), moduleCols)
          if (target.area === 'auxiliary') {
            moveSupplyDeviceToAuxiliaryEnclosure(supplyRef.id, target.surface.id, row, col)
            return
          }

          if (target.area === 'supply') {
            moveSupplyDeviceToGridEnclosure(supplyRef.id, target.panel.id, row, col)
            return
          }
          moveSupplyDeviceToPanelEnclosure(supplyRef.id, target.panel.id, row, col)
          return
        }

        if (surface.kind === 'auxiliary') {
          const localX = rawX - PANEL_FRAME_MARGIN
          const localY =
            rawY - PANEL_FRAME_MARGIN - getTerminalStripTopOffset(getPanelSceneSurfaceGrid(surface))
          const snapped = snapToGrid(localX, localY + CELL_H / 2)
          moveSupplyDeviceToAuxiliaryEnclosure(
            supplyRef.id,
            surface.id,
            clamp(snapped.row, 0, surface.rows - 1),
            clamp(snapped.col, 0, maxCol)
          )
          return
        }
      }

      const circuitModule =
        !placement.inSupplyPanel &&
        currentProject != null &&
        resolveTerminalStripModule(currentProject, placement.ref) == null
          ? findRemountableCircuitModule(currentProject, placement.ref)
          : undefined
      if (circuitModule && currentProject) {
        if (preview?.createAuxiliary) {
          const refs = preview.circuitModuleRefs ?? []
          if (preview.invalid || refs.length === 0) return
          const enclosureId = createCircuitModuleEnclosure(refs, circuitModule.ownerPanel.id, {
            x: preview.x,
            y: preview.y,
          })
          if (enclosureId) setSelection({ type: 'auxiliaryEnclosure', ids: [enclosureId] })
          return
        }
        const canvasPos = { x: surface.x + rawX, y: surface.y + rawY }
        const target = detectHierarchyModuleDropTarget(canvasPos, placement.ref)
        const currentSurfaceId = surface.panel?.id ?? surface.id
        const targetSurfaceId = target?.surface.panel?.id ?? target?.surface.id
        if (
          selectedPlacements.length < 2 &&
          (target?.area === 'main' || target?.area === 'auxiliary') &&
          (targetSurfaceId !== currentSurfaceId || target.area === 'auxiliary')
        ) {
          if (preview?.invalid) return
          const targetPanel = target.surface.enclosure
            ? { ...target.panel, gridView: target.surface.enclosure.gridView }
            : target.panel
          const localX = canvasPos.x - target.surface.x - PANEL_FRAME_MARGIN
          const localY =
            canvasPos.y -
            target.surface.y -
            target.surface.mainPanelY -
            PANEL_FRAME_MARGIN -
            getTerminalStripTopOffset(targetPanel)
          const snapped = snapToGrid(localX, localY + CELL_H / 2)
          const row = clamp(snapped.row, 0, target.surface.rows - 1)
          const col = snapPanelGridColToFields(target.surface.panel?.gridView, clamp(snapped.col, 0, Math.max(0, target.surface.cols - moduleCols)), moduleCols)
          moveCircuitModule(
            placement.ref,
            target.area === 'auxiliary' && target.surface.enclosure
              ? { kind: 'auxiliary', enclosureId: target.surface.enclosure.id }
              : { kind: 'panel', panelId: target.panel.id },
            row,
            col
          )
          return
        }
      }

      if (surface.kind === 'junction_panel' && currentProject && !placement.junctionPanelTerminal) {
        if (preview?.invalid) return
        const representative = surface.placements.find((item) => item.junctionPanelTerminal)
        if (representative?.ref.kind !== 'trunkDevice') return
        const device = useProjectStore.getState().getTrunkDeviceById(representative.ref.id)?.device
        if (!device) return
        const layout = getJunctionPanelModuleLayout(currentProject, device)
        const snapped = snapToGrid(
          rawX - PANEL_FRAME_MARGIN,
          rawY -
            PANEL_FRAME_MARGIN -
            getTerminalStripTopOffset(getPanelSceneSurfaceGrid(surface)) -
            layout.moduleRowOffset * ROW_STRIDE +
            CELL_H / 2
        )
        const row = clamp(snapped.row, 0, Math.max(0, surface.rows - layout.moduleRowOffset - 1))
        const col = snapPanelGridColToFields(placement.inSupplyPanel ? undefined : surface.panel?.gridView, clamp(snapped.col, 0, maxCol), moduleCols)
        const selectedKeys = new Set(
          (selectedPlacements.length >= 2 ? selectedPlacements : [placement]).map((item) =>
            panelGridModuleRefKey(item.ref)
          )
        )
        const slots = layout.slots.map((slot) =>
          selectedKeys.has(panelGridModuleRefKey(slot.module))
            ? { ...slot, row: slot.row + row - placement.row, col: slot.col + col - placement.col }
            : slot
        )
        editPanelLayout({ junctionGrids: [{ deviceId: device.id, slots }] })
        return
      }

      if (placement.inSupplyPanel) {
        if (!panel) {
          if (
            placement.ref.kind !== 'trunkDevice' ||
            placement.ref.scope !== 'supply' ||
            !currentProject
          ) {
            logger.warn('[PanelCanvas hierarchy drag] abort:shared-supply-missing-context')
            return
          }
          const rootPanel = panelOptions.find((option) => option.isRoot)?.panel
          if (!rootPanel) return
          const existingSupplySlots = rootPanel.gridView?.supplyPanelSlots ?? []
          const draggedRef = placement.ref
          const sourceX = rawX
          const snappedCol = Math.max(
            0,
            Math.min(maxCol, Math.round((sourceX - PANEL_FRAME_MARGIN) / CELL_W))
          )
          const previousSlot = existingSupplySlots.find(
            (slot) => panelGridModuleRefKey(slot.module) === key
          )
          const collidedSlot = existingSupplySlots.find((slot) => {
            const slotKey = panelGridModuleRefKey(slot.module)
            if (slotKey === key) return false
            const width = Math.max(
              MIN_PANEL_GRID_MODULE_WIDTH,
              resolveModuleWidthCols(slot.module, currentProject, slot)
            )
            return snappedCol < slot.col + width && slot.col < snappedCol + moduleCols
          })
          const reorderedSupplySlots = existingSupplySlots.map((slot) => {
            const slotKey = panelGridModuleRefKey(slot.module)
            if (
              collidedSlot &&
              slotKey === panelGridModuleRefKey(collidedSlot.module) &&
              previousSlot
            ) {
              return {
                ...slot,
                row: previousSlot.row,
                col: previousSlot.col,
              }
            }
            return slot
          })
          const nextSupplySlots = upsertPanelGridSlotPosition(
            reorderedSupplySlots,
            draggedRef,
            0,
            snappedCol
          )
          logger.warn('[PanelCanvas hierarchy drag] shared-supply reorder:calc', {
            draggedId: draggedRef.id,
            snappedCol,
            sourceX,
            usedPreviewX: false,
            rawX,
            rootPanelId: rootPanel.id,
            surfaceSupplyIds: surface.placements
              .filter(
                (
                  p
                ): p is typeof p & { ref: { kind: 'trunkDevice'; id: string; scope: 'supply' } } =>
                  p.inSupplyPanel === true &&
                  p.ref.kind === 'trunkDevice' &&
                  p.ref.scope === 'supply'
              )
              .sort(
                (a, b) =>
                  a.col - b.col ||
                  panelGridModuleRefKey(a.ref).localeCompare(panelGridModuleRefKey(b.ref))
              )
              .map((p) => p.ref.id),
            existingSlotIds: existingSupplySlots.map((slot) =>
              slot.module.kind === 'trunkDevice'
                ? slot.module.id
                : panelGridModuleRefKey(slot.module)
            ),
            nextSlotIds: nextSupplySlots.map((slot) =>
              slot.module.kind === 'trunkDevice'
                ? slot.module.id
                : panelGridModuleRefKey(slot.module)
            ),
          })
          updateSupplyPanelSlots(rootPanel.id, nextSupplySlots)
          logger.warn('[PanelCanvas hierarchy drag] commit:shared-supply-reorder', {
            unchanged:
              existingSupplySlots.length === nextSupplySlots.length &&
              existingSupplySlots.every(
                (slot, index) =>
                  panelGridModuleRefKey(slot.module) ===
                    panelGridModuleRefKey(nextSupplySlots[index]?.module ?? slot.module) &&
                  slot.col === nextSupplySlots[index]?.col &&
                  slot.row === nextSupplySlots[index]?.row
              ),
          })
          return
        }
        const existingSupplySlots = panel.gridView?.supplyPanelSlots ?? []
        const previousSlot = existingSupplySlots.find(
          (slot) => panelGridModuleRefKey(slot.module) === key
        )
        const snappedSupply = snapToGrid(
          rawX - PANEL_FRAME_MARGIN,
          rawY - (surface.supplyPanelY + PANEL_FRAME_MARGIN) + CELL_H / 2
        )
        const row = clamp(snappedSupply.row, 0, surface.supplyRows - 1)
        const col = Math.max(0, Math.min(maxCol, Math.round((rawX - PANEL_FRAME_MARGIN) / CELL_W)))
        if (selectedPlacements.length >= 2) {
          const selectedKeys = new Set(
            selectedPlacements.map((selected) => panelGridModuleRefKey(selected.ref))
          )
          const deltaRow = row - placement.row
          const deltaCol = col - placement.col
          let nextSupplySlots = existingSupplySlots.map((slot) => {
            const slotKey = panelGridModuleRefKey(slot.module)
            if (!selectedKeys.has(slotKey)) return slot
            const selectedPlacement = selectedPlacements.find(
              (selected) => panelGridModuleRefKey(selected.ref) === slotKey
            )
            return {
              ...slot,
              row: (selectedPlacement?.row ?? slot.row) + deltaRow,
              col: (selectedPlacement?.col ?? slot.col) + deltaCol,
            }
          })
          for (const selectedPlacement of selectedPlacements) {
            nextSupplySlots = upsertPanelGridSlotPosition(
              nextSupplySlots,
              selectedPlacement.ref,
              selectedPlacement.row + deltaRow,
              selectedPlacement.col + deltaCol
            )
          }
          updateSupplyPanelSlots(panel.id, nextSupplySlots)
          logger.warn('[PanelCanvas hierarchy drag] commit:supply-multi', {
            selectedCount: selectedPlacements.length,
            afterCount: nextSupplySlots.length,
          })
          return
        }
        const collidedSlot = existingSupplySlots.find((slot) => {
          if (panelGridModuleRefKey(slot.module) === key) return false
          const width = Math.max(
            MIN_PANEL_GRID_MODULE_WIDTH,
            resolveModuleWidthCols(slot.module, currentProject, slot)
          )
          return col < slot.col + width && slot.col < col + moduleCols
        })
        const reorderedSupplySlots = existingSupplySlots.map((slot) => {
          const slotKey = panelGridModuleRefKey(slot.module)
          if (
            collidedSlot &&
            slotKey === panelGridModuleRefKey(collidedSlot.module) &&
            previousSlot
          ) {
            return {
              ...slot,
              row: previousSlot.row,
              col: previousSlot.col,
            }
          }
          return slot
        })
        const nextSupplySlots = upsertPanelGridSlotPosition(
          reorderedSupplySlots,
          placement.ref,
          row,
          col
        )
        updateSupplyPanelSlots(panel.id, nextSupplySlots)
        logger.warn('[PanelCanvas hierarchy drag] commit:supply-single', {
          afterCount: nextSupplySlots.length,
        })
        return
      }

      if (!panel) return

      const terminalStrip = currentProject
        ? resolveTerminalStripModule(currentProject, placement.ref)
        : undefined
      const isTerminalStrip = terminalStrip != null
      if (terminalStrip) {
        const canvasPos = { x: surface.x + rawX, y: surface.y + rawY }
        const target = detectHierarchyModuleDropTarget(canvasPos, placement.ref)
        const targetSurfaceId = target?.surface.panel?.id ?? target?.surface.id
        const currentSurfaceId = surface.panel?.id ?? surface.id
        if (
          (target?.area === 'main' || target?.area === 'auxiliary') &&
          (targetSurfaceId !== currentSurfaceId || target.area === 'auxiliary')
        ) {
          if (preview?.invalid) return
          const targetPanel = target.surface.enclosure
            ? { ...target.panel, gridView: target.surface.enclosure.gridView }
            : target.panel
          const localX = canvasPos.x - target.surface.x - PANEL_FRAME_MARGIN
          const panelLocalY = canvasPos.y - target.surface.y - target.surface.mainPanelY
          const topRail =
            targetPanel.gridView?.terminalStripTopRail === true &&
            panelLocalY <= PANEL_FRAME_MARGIN + TERMINAL_STRIP_RAIL_H + ROW_GAP / 2
          const bottomRail =
            targetPanel.gridView?.terminalStripBottomRail === true &&
            panelLocalY >=
              target.surface.panelFrameHeight -
                PANEL_FRAME_MARGIN -
                TERMINAL_STRIP_RAIL_H -
                ROW_GAP / 2
          const targetRail = topRail ? 'top' : bottomRail ? 'bottom' : undefined
          const localY = panelLocalY - PANEL_FRAME_MARGIN - getTerminalStripTopOffset(targetPanel)
          const snapped = snapToGrid(localX, localY + CELL_H / 2)
          const row = clamp(snapped.row, 0, target.surface.rows - 1)
          const col = snapTerminalStripPlacementCol(
            localX,
            moduleCols,
            Math.max(0, target.surface.cols - moduleCols),
            row,
            target.surface.placements.filter((other) => panelGridModuleRefKey(other.ref) !== key),
            shiftKey,
            targetRail
          )
          const sourceSlot = panel.gridView?.slots?.find(
            (candidate) => panelGridModuleRefKey(candidate.module) === key
          )
          const targetSlot: PanelGridSlot = {
            row: targetRail ? 0 : row,
            col,
            module: placement.ref,
            ...(targetRail ? { terminalStripRail: targetRail } : {}),
            ...(sourceSlot?.moduleWidthManual === true
              ? {
                  moduleWidth: sourceSlot.moduleWidth,
                  moduleWidthManual: true,
                }
              : {}),
          }
          if (
            moveTerminalStripToPanel(
              terminalStrip.id,
              targetPanel.id,
              targetSlot,
              target.surface.enclosure?.id
            )
          ) {
            setSelection({
              type: terminalStrip.form === 'endpoint' ? 'endpoint' : 'trunkDevice',
              ids: [terminalStrip.id],
            })
          }
          return
        }
      }

      const existingMainSlots = panel.gridView?.slots ?? []
      const previousSlot = existingMainSlots.find(
        (slot) => panelGridModuleRefKey(slot.module) === key
      )
      const localX = rawX - PANEL_FRAME_MARGIN
      const panelLocalY = rawY - surface.mainPanelY
      const topRail =
        isTerminalStrip &&
        panel.gridView?.terminalStripTopRail === true &&
        panelLocalY <= PANEL_FRAME_MARGIN + TERMINAL_STRIP_RAIL_H + ROW_GAP / 2
      const bottomRail =
        isTerminalStrip &&
        panel.gridView?.terminalStripBottomRail === true &&
        panelLocalY >=
          surface.panelFrameHeight - PANEL_FRAME_MARGIN - TERMINAL_STRIP_RAIL_H - ROW_GAP / 2
      const targetTerminalRail = topRail ? 'top' : bottomRail ? 'bottom' : undefined
      const localY = panelLocalY - PANEL_FRAME_MARGIN - getTerminalStripTopOffset(panel)
      const snapped = snapToGrid(localX, localY + CELL_H / 2)
      const row = clamp(snapped.row, 0, totalRows - 1)
      const col = isTerminalStrip
        ? snapTerminalStripPlacementCol(
            localX,
            moduleCols,
            maxCol,
            row,
            surface.placements.filter(
              (other) => panelGridModuleRefKey(other.ref) !== key && !other.inSupplyPanel
            ),
            shiftKey,
            targetTerminalRail
          )
        : snapPanelGridColToFields(surface.panel?.gridView, clamp(snapped.col, 0, maxCol), moduleCols)
      if (selectedPlacements.length >= 2) {
        const selectedKeys = new Set(
          selectedPlacements.map((selected) => panelGridModuleRefKey(selected.ref))
        )
        const deltaRow = row - placement.row
        const deltaCol = col - placement.col
        let nextMainSlots = existingMainSlots.map((slot) => {
          const slotKey = panelGridModuleRefKey(slot.module)
          if (!selectedKeys.has(slotKey)) return slot
          const selectedPlacement = selectedPlacements.find(
            (selected) => panelGridModuleRefKey(selected.ref) === slotKey
          )
          return {
            ...slot,
            row: (selectedPlacement?.row ?? slot.row) + deltaRow,
            col: (selectedPlacement?.col ?? slot.col) + deltaCol,
          }
        })
        for (const selectedPlacement of selectedPlacements) {
          nextMainSlots = upsertPanelGridSlotPosition(
            nextMainSlots,
            selectedPlacement.ref,
            selectedPlacement.row + deltaRow,
            selectedPlacement.col + deltaCol
          )
        }
        updatePanelGridSlots(panel.id, nextMainSlots)
        logger.warn('[PanelCanvas hierarchy drag] commit:main-multi', {
          selectedCount: selectedPlacements.length,
          afterCount: nextMainSlots.length,
        })
        return
      }
      const collidedSlot = existingMainSlots.find((slot) => {
        if (panelGridModuleRefKey(slot.module) === key) return false
        const width = Math.max(
          MIN_PANEL_GRID_MODULE_WIDTH,
          resolveModuleWidthCols(slot.module, currentProject, slot)
        )
        if (slot.terminalStripRail !== targetTerminalRail) return false
        if (!targetTerminalRail && slot.row !== row) return false
        return col < slot.col + width && slot.col < col + moduleCols
      })
      const reorderedMainSlots = existingMainSlots.map((slot) => {
        const slotKey = panelGridModuleRefKey(slot.module)
        if (
          collidedSlot &&
          slotKey === panelGridModuleRefKey(collidedSlot.module) &&
          previousSlot
        ) {
          return {
            ...slot,
            row: previousSlot.row,
            col: previousSlot.col,
          }
        }
        return slot
      })
      const nextMainSlots = upsertPanelGridSlotPosition(
        reorderedMainSlots,
        placement.ref,
        targetTerminalRail ? 0 : row,
        col,
        targetTerminalRail
      )
      const terminalStripForDrop = currentProject
        ? resolveTerminalStripModule(currentProject, placement.ref)
        : undefined
      if (targetTerminalRail && terminalStripForDrop) {
        const targetSlot = nextMainSlots.find(
          (slot) => panelGridModuleRefKey(slot.module) === key
        )
        if (targetSlot) {
          moveTerminalStripToPanel(terminalStripForDrop.id, panel.id, targetSlot)
        }
      } else {
        updatePanelGridSlots(panel.id, nextMainSlots)
      }
      logger.warn('[PanelCanvas hierarchy drag] commit:main-single', {
        afterCount: nextMainSlots.length,
      })
    },
    [
      currentProject,
      detectHierarchyModuleDropTarget,
      isHierarchyRefInSelection,
      moduleDragPreview,
      panelOptions,
      selection.ids.length,
      setSelection,
      setModuleDragLive,
      setModuleDragPreview,
    ]
  )

  return { handleHierarchyModuleDragMove, handleHierarchyModuleDragEnd }
}
