import {
  getPanelGridFieldLayout,
  panelGridFieldEndCol,
  snapPanelGridColToFields,
} from '@/lib/panel/panelGridFields'
import type {
  Project,
  HierarchySurface,
  HierarchyDragPreview,
} from './hierarchyPanelCanvasModel'

import { duplicateProtection } from '@/handlers/eendraad/duplicateProtection'

import { updateEndpointProperties as updateEndpoint } from '@/handlers/properties/editProperties'
import {
  updatePanelGridSlots,
  updateSupplyPanelSlots,
  editPanelLayout,
} from '@/handlers/panel/editPanelLayout'
import { getJunctionPanelModuleLayout } from '@/lib/junctionPanel/moduleLayout'
import { useCallback } from 'react'

import type { useUIStore } from '@/stores/uiStore'

import { useProjectStore } from '@/stores/projectStore'

import {
  panelGridModuleRefKey,
  CELL_W,
  canResizeModulePlacement,
  CELL_H,
  getTerminalStripTopOffset,
  snapToGrid,
  type ModulePlacement,
} from '@/lib/panel/panelGridLayout'

import type { PanelGridSlot, PanelGridModuleRef } from '@/types/schema'

import { clamp } from '@/lib/geometry'
import { MIN_PANEL_GRID_MODULE_WIDTH, normalizePanelModuleMeasure } from '@/lib/panel/panelGridUnits'

import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import {
  getModularSocketCount,
  isModularSocket,
  snapModularSocketModuleWidthWithin,
  socketCountForModularWidth,
  withModularSocketProps,
} from '@/lib/socket/modularSocket'
import type { Dispatch, SetStateAction } from 'react'
import { PANEL_SCENE_FRAME_MARGIN as PANEL_FRAME_MARGIN } from '@/lib/panel/panelScene'

interface HierarchyModuleEditingOptions {
  currentProject: Project | null
  moduleDragPreview: HierarchyDragPreview | null
  setModuleDragLive: Dispatch<SetStateAction<HierarchyDragPreview | null>>
  setModuleDragPreview: Dispatch<SetStateAction<HierarchyDragPreview | null>>
  setSelection: ReturnType<typeof useUIStore.getState>['setSelection']
  updateAuxiliaryElectricalEnclosure: (id: string, updates: { gridView: import('@/types/schema').PanelGridConfig }) => void
}


export function useHierarchyModuleEditing({
  currentProject,
  moduleDragPreview,
  setModuleDragLive,
  setModuleDragPreview,
  setSelection,
  updateAuxiliaryElectricalEnclosure,
}: HierarchyModuleEditingOptions) {
  /**
   * Panel-grid Alt-drag is deliberately limited to circuit-owned modules. Protection
   * duplication uses the established circuit-clone command; endpoint modules reuse the
   * normal endpoint duplication rules (including same-branch switches). Supply and
   * trunk devices are topology owners, so copying them here would create broken feeds.
   */
  const handleHierarchyModuleAltDuplicate = useCallback(
    (
      surface: HierarchySurface,
      placement: ModulePlacement & { inSupplyPanel?: boolean },
      rawX: number,
      rawY: number
    ) => {
      const preview = moduleDragPreview
      setModuleDragPreview(null)
      setModuleDragLive(null)
      const sourcePanel = surface.panel
      if (
        !currentProject ||
        !sourcePanel ||
        placement.inSupplyPanel ||
        preview?.invalid ||
        preview?.surfaceId !== sourcePanel.id
      ) {
        return
      }

      // No slot is created until the existing collision preview is valid.
      const localX = rawX - PANEL_FRAME_MARGIN
      const localY =
        rawY - surface.mainPanelY - PANEL_FRAME_MARGIN - getTerminalStripTopOffset(sourcePanel)
      const snapped = snapToGrid(localX, localY + CELL_H / 2)
      const moduleCols = Math.max(
        MIN_PANEL_GRID_MODULE_WIDTH,
        normalizePanelModuleMeasure(placement.width / CELL_W)
      )
      const row = clamp(snapped.row, 0, surface.rows - 1)
      const col = snapPanelGridColToFields(surface.panel?.gridView, clamp(snapped.col, 0, Math.max(0, surface.cols - moduleCols)), moduleCols)

      const store = useProjectStore.getState()
      let duplicateRef: PanelGridModuleRef | null = null

      if (placement.ref.kind === 'protection') {
        const protection = store.getProtectionById(placement.ref.id)
        if (!protection) return
        const protectionOwner = store.getPanelForProtection(placement.ref.id)
        if (protectionOwner?.id !== sourcePanel.id) return
        const newProtectionId = duplicateProtection({
          protectionId: placement.ref.id,
          copyCircuitContents: false,
          gridPlacement: { panelId: sourcePanel.id, row, col },
          label: 'duplicate protection in panel grid',
        })
        if (!newProtectionId) return
        duplicateRef = { kind: 'protection', id: newProtectionId }
      } else if (placement.ref.kind === 'domotica') {
        // The copy and its panel-grid slot are one command, hence one undo step.
        const outcome = runProjectCommand(
          'electrical.duplicateElements',
          {
            items: [{ kind: 'endpoint', id: placement.ref.endpointId }],
            purpose: 'altDrag',
            target: { type: 'panelGrid', panelId: sourcePanel.id, row, col },
          },
          { label: 'duplicate module in panel grid', source: 'panel' }
        )
        const newEndpointId = outcome?.results[0]?.select?.find((ref) => ref.kind === 'endpoint')?.id
        if (!outcome?.changed || !newEndpointId) return
        duplicateRef = {
          kind: 'domotica',
          endpointId: newEndpointId,
          circuitId: placement.ref.circuitId,
        }
      } else {
        return
      }
      setSelection(
        duplicateRef.kind === 'protection'
          ? { type: 'protection', ids: [duplicateRef.id] }
          : { type: 'endpoint', ids: [duplicateRef.endpointId] }
      )
    },
    [currentProject, moduleDragPreview, setSelection, setModuleDragLive, setModuleDragPreview]
  )

  const handleHierarchyModuleResize = useCallback(
    (
      surface: HierarchySurface,
      placement: ModulePlacement & { inSupplyPanel?: boolean },
      newWidthCols: number
    ) => {
      const panel = surface.panel
      const key = panelGridModuleRefKey(placement.ref)

      if (placement.ref.kind === 'domotica') {
        const endpoint = useProjectStore.getState().getEndpointById(placement.ref.endpointId)
        if (endpoint && isModularSocket(endpoint)) {
          const maxWidthCols = Math.max(
            2,
            (placement.inSupplyPanel ? surface.supplyCols : surface.cols) - placement.col
          )
          const snappedWidth = snapModularSocketModuleWidthWithin(newWidthCols, maxWidthCols)
          const nextCount = socketCountForModularWidth(snappedWidth)
          if (getModularSocketCount(endpoint) !== nextCount) {
            updateEndpoint(placement.ref.endpointId, {
              socketProps: {
                ...withModularSocketProps(endpoint.socketProps, nextCount),
                socketCount: nextCount,
              },
            })
          }
          return
        }
      }

      if (surface.kind === 'junction_panel' && currentProject && !placement.junctionPanelTerminal) {
        const representative = surface.placements.find((item) => item.junctionPanelTerminal)
        if (representative?.ref.kind !== 'trunkDevice') return
        const device = useProjectStore.getState().getTrunkDeviceById(representative.ref.id)?.device
        if (!device) return
        const layout = getJunctionPanelModuleLayout(currentProject, device)
        editPanelLayout({
          junctionGrids: [
            {
              deviceId: device.id,
              slots: layout.slots.map((slot) =>
                panelGridModuleRefKey(slot.module) === key
                  ? { ...slot, moduleWidth: newWidthCols, moduleWidthManual: true }
                  : slot
              ),
            },
          ],
        })
        return
      }
      if (surface.kind === 'auxiliary' && surface.enclosure) {
        updateAuxiliaryElectricalEnclosure(surface.id, {
          gridView: {
            ...surface.enclosure.gridView,
            slots: surface.enclosure.gridView.slots.map((slot) =>
              panelGridModuleRefKey(slot.module) === key
                ? { ...slot, moduleWidth: newWidthCols, moduleWidthManual: true }
                : slot
            ),
          },
        })
        return
      }
      if (!panel) return

      if (placement.inSupplyPanel) {
        const existingSupplySlots = panel.gridView?.supplyPanelSlots ?? []
        const nextSupplySlots: PanelGridSlot[] = existingSupplySlots.map((slot) =>
          panelGridModuleRefKey(slot.module) === key
            ? { ...slot, moduleWidth: newWidthCols, moduleWidthManual: true }
            : slot
        )
        updateSupplyPanelSlots(panel.id, nextSupplySlots)
        return
      }

      const existingMainSlots = panel.gridView?.slots ?? []
      let found = false
      const nextMainSlots: PanelGridSlot[] = existingMainSlots.map((slot) => {
        if (panelGridModuleRefKey(slot.module) === key) {
          found = true
          return { ...slot, moduleWidth: newWidthCols, moduleWidthManual: true }
        }
        return slot
      })
      if (!found) {
        nextMainSlots.push({
          row: placement.row,
          col: placement.col,
          module: placement.ref,
          moduleWidth: newWidthCols,
          moduleWidthManual: true,
          ...(placement.terminalStripRail
            ? { terminalStripRail: placement.terminalStripRail }
            : {}),
        })
      }
      updatePanelGridSlots(panel.id, nextMainSlots)
    },
    [currentProject, updateAuxiliaryElectricalEnclosure]
  )

  const getHierarchyMaxWidth = useCallback(
    (surface: HierarchySurface, placement: ModulePlacement & { inSupplyPanel?: boolean }) => {
      const totalCols = placement.inSupplyPanel
        ? surface.supplyCols
        : Math.min(surface.cols, panelGridFieldEndCol(surface.panel?.gridView, placement.col))
      const remaining = Math.max(1, totalCols - placement.col)
      if (placement.ref.kind === 'domotica') {
        const endpoint = useProjectStore.getState().getEndpointById(placement.ref.endpointId)
        if (isModularSocket(endpoint)) {
          return Math.min(4, remaining)
        }
      }
      return remaining
    },
    []
  )

  const isHierarchyResizeWidthValid = useCallback(
    (
      surface: HierarchySurface,
      placement: ModulePlacement & { inSupplyPanel?: boolean },
      newWidthCols: number
    ) =>
      canResizeModulePlacement(
        placement,
        surface.placements.filter((other) => !other.junctionPanelTerminal),
        newWidthCols,
        placement.inSupplyPanel ? surface.supplyCols : surface.cols,
        getPanelGridFieldLayout(surface.panel?.gridView)
      ),
    []
  )

  return { handleHierarchyModuleAltDuplicate, handleHierarchyModuleResize, getHierarchyMaxWidth, isHierarchyResizeWidthValid }
}
