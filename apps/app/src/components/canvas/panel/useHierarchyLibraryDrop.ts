import { snapPanelGridColToFields } from '@/lib/panel/panelGridFields'
import type { BuiltPanelScene } from '@/lib/panel/panelScene'
import { getLibraryDropWidthCols } from './hierarchyPanelSceneQueries'

import type {
  Project,
  HierarchySurface,
  HierarchyDragPreview,
  PanelOption,
} from './hierarchyPanelCanvasModel'

import { placeElectricalSymbol } from '@/handlers/eendraad/placeElectricalSymbol'

import { findRemountableCircuitModule } from '@/lib/panel/circuitModuleMounting'

import { useCallback } from 'react'

import {
  CELL_W,
  CELL_H,
  ROW_GAP,
  ROW_STRIDE,
  getTerminalStripTopOffset,
  snapToGrid,
} from '@/lib/panel/panelGridLayout'

import { findPanelLibraryDropSlot } from '@/lib/panel/panelLibraryDropSlot'
import { getPanelSceneSurfaceGrid } from '@/lib/panel/panelScene'

import { resolveTerminalStripModule } from '@/lib/eendraad/projectElectricalDomain'
import { PROTECTION_SYMBOL_IDS } from '@/lib/protectionKind'
import type { PanelGridModuleRef } from '@/types/schema'

import type { CanvasDropMeta, Point } from '@/types/ui'

import type { SymbolMetadata } from '@/lib/symbols'

import { clamp } from '@/lib/geometry'

import { getLastAssignableCircuit } from '@/lib/panel/panelTree'
import { isAuxiliaryMountableSupplyDevice } from '@/lib/panel/auxiliarySupplyEnclosures'

import {
  canDropModularSocketOnPanel,
  findPreferredModularSocketCircuit,
  findPreferredModularSocketProtection,
  isModularSocketLibraryId,
} from '@/lib/socket/modularSocket'
import type { Dispatch, SetStateAction } from 'react'
import { PANEL_SCENE_FRAME_MARGIN as PANEL_FRAME_MARGIN } from '@/lib/panel/panelScene'

interface HierarchyLibraryDropOptions {
  currentProject: Project | null
  panelOptions: PanelOption[]
  scene: BuiltPanelScene | null
  setDragPreview: Dispatch<SetStateAction<HierarchyDragPreview | null>>
}

export function useHierarchyLibraryDrop({
  currentProject,
  panelOptions,
  scene,
  setDragPreview,
}: HierarchyLibraryDropOptions) {
  const detectHierarchyPanelTarget = useCallback(
    (position: Point) => {
      if (!scene) return null
      for (const surface of scene.surfaces) {
        if (surface.kind !== 'panel' || !surface.panel) continue
        const titleHitHeight = 36
        const frameLeft = surface.x - 10
        const frameRight = surface.x + surface.width + 10
        const frameTop = surface.y + surface.mainPanelY - 10
        const frameBottom = surface.y + surface.mainPanelY + surface.panelFrameHeight + 10
        if (
          position.x >= frameLeft &&
          position.x <= frameRight &&
          position.y >= frameTop &&
          position.y <= frameBottom
        ) {
          return surface
        }
        const titleTop = surface.y + surface.mainPanelY
        if (
          position.x >= frameLeft &&
          position.x <= frameRight &&
          position.y >= titleTop &&
          position.y <= titleTop + titleHitHeight
        ) {
          return surface
        }
      }
      return null
    },
    [scene]
  )

  const detectHierarchyLibraryDropHover = useCallback(
    (position: Point) => {
      if (!scene) return null
      const panelTarget = detectHierarchyPanelTarget(position)
      if (panelTarget) return panelTarget
      for (const surface of scene.surfaces) {
        if (surface.kind === 'panel') continue
        if (
          position.x >= surface.x - 10 &&
          position.x <= surface.x + surface.width + 10 &&
          position.y >= surface.y - 10 &&
          position.y <= surface.y + surface.height + 10
        ) {
          return surface
        }
      }
      return null
    },
    [detectHierarchyPanelTarget, scene]
  )

  const detectHierarchyModuleDropTarget = useCallback(
    (position: Point, ref: PanelGridModuleRef) => {
      if (!scene || !currentProject) return null
      const stripModule = resolveTerminalStripModule(currentProject, ref)
      // Relays, meters and domotica modules move between panels and virtual enclosures
      // like terminal strips do: the physical placement changes, the circuit does not.
      const isCircuitModule =
        stripModule == null && findRemountableCircuitModule(currentProject, ref) != null
      const isTerminalStrip = stripModule != null || isCircuitModule
      // Endpoint-form strips can move between panels but have no auxiliary mounting.
      const isEndpointStrip = stripModule?.form === 'endpoint'
      const trunkRefId = ref.kind === 'trunkDevice' ? ref.id : ''
      if (!isTerminalStrip && !(ref.kind === 'trunkDevice' && ref.scope === 'supply')) return null
      if (!isTerminalStrip && !isAuxiliaryMountableSupplyDevice(currentProject, trunkRefId))
        return null

      for (const surface of scene.surfaces) {
        if (surface.kind === 'auxiliary' && surface.enclosure) {
          const inside =
            position.x >= surface.x - 10 &&
            position.x <= surface.x + surface.width + 10 &&
            position.y >= surface.y - 10 &&
            position.y <= surface.y + surface.height + 10
          if (!inside) continue
          if (isEndpointStrip) continue
          const ownerPanelId = surface.enclosure.ownerPanelId
          // An enclosure whose owner board is gone or not in view still accepts modules.
          const ownerPanel =
            (ownerPanelId
              ? panelOptions.find((option) => option.panel.id === ownerPanelId)?.panel
              : undefined) ??
            panelOptions.find((option) => option.isRoot && option.panel.isMain)?.panel ??
            panelOptions[0]?.panel
          if (
            !ownerPanel ||
            (!isTerminalStrip && !isAuxiliaryMountableSupplyDevice(currentProject, trunkRefId))
          )
            return null
          return { surface, panel: ownerPanel, area: 'auxiliary' as const }
        }
        if (surface.kind === 'shared_supply') {
          if (isTerminalStrip) continue
          const frameLeft = surface.x
          const frameRight = surface.x + surface.width
          const frameTop = surface.y
          const frameBottom = surface.y + surface.height
          if (
            position.x >= frameLeft &&
            position.x <= frameRight &&
            position.y >= frameTop &&
            position.y <= frameBottom
          ) {
            const rootPanel = panelOptions.find(
              (option) => option.isRoot && option.panel.isMain
            )?.panel
            if (!rootPanel) return null
            return { surface, panel: rootPanel, area: 'supply' as const }
          }
          continue
        }

        if (surface.kind !== 'panel' || !surface.panel) continue
        const frameLeft = surface.x - 10
        const frameRight = surface.x + surface.width + 10
        const mainTop = surface.y + surface.mainPanelY - 10
        const mainBottom = surface.y + surface.mainPanelY + surface.panelFrameHeight + 10
        if (
          position.x >= frameLeft &&
          position.x <= frameRight &&
          position.y >= mainTop &&
          position.y <= mainBottom
        ) {
          return { surface, panel: surface.panel, area: 'main' as const }
        }

        const supplyTop = surface.y + surface.supplyPanelY - 10
        const supplyBottom = surface.y + surface.supplyPanelY + surface.supplyFrameHeight + 10
        if (
          surface.supplyPanelVisible &&
          position.x >= frameLeft &&
          position.x <= frameRight &&
          position.y >= supplyTop &&
          position.y <= supplyBottom
        ) {
          if (isTerminalStrip) return null
          return { surface, panel: surface.panel, area: 'supply' as const }
        }
      }
      return null
    },
    [currentProject, panelOptions, scene]
  )

  /**
   * Where a library symbol dropped at `position` lands on `surface`: the pointer's cell when
   * it is free, otherwise the nearest free cells beside the module under the pointer. A
   * protection dropped on an existing protection is fed from it (the feeder).
   */
  const resolveHierarchyLibraryDrop = useCallback(
    (position: Point, symbol: SymbolMetadata, surface: HierarchySurface) => {
      if (!currentProject) return null
      const gridTop =
        surface.y +
        (surface.kind === 'panel' ? surface.mainPanelY : 0) +
        PANEL_FRAME_MARGIN +
        getTerminalStripTopOffset(getPanelSceneSurfaceGrid(surface))
      const gridLeft = surface.x + PANEL_FRAME_MARGIN
      const localX = position.x - gridLeft
      const localY = position.y - gridTop
      const widthCols = getLibraryDropWidthCols(symbol, currentProject)
      const requestedCol = snapPanelGridColToFields(
        surface.panel?.gridView,
        Math.max(
          0,
          Math.min(
            surface.cols - widthCols,
            Math.round(localX / CELL_W) - Math.floor(widthCols / 2)
          )
        ),
        widthCols
      )
      const requestedRow = clamp(snapToGrid(localX, localY + CELL_H / 2).row, 0, surface.rows - 1)

      const gridPlacements = surface.placements.filter(
        (placement) => !placement.inSupplyPanel && !placement.isOverflow
      )
      const hit = gridPlacements.find(
        (placement) =>
          position.x >= surface.x + placement.x &&
          position.x <= surface.x + placement.x + placement.width &&
          position.y >= surface.y + placement.y &&
          position.y <= surface.y + placement.y + placement.height
      )
      const slot = findPanelLibraryDropSlot({
        occupied: gridPlacements.map((placement) => ({
          row: placement.row,
          col: placement.col,
          widthCols: placement.width / CELL_W,
        })),
        rows: surface.rows,
        cols: surface.cols,
        widthCols,
        requested: { row: requestedRow, col: requestedCol },
        anchor: hit ? { row: hit.row, col: hit.col, widthCols: hit.width / CELL_W } : null,
      })

      const hitProtectionId = hit?.ref.kind === 'protection' ? hit.ref.id : undefined
      const isProtectionDrop = (PROTECTION_SYMBOL_IDS as readonly string[]).includes(symbol.id)
      const feederProtection =
        isProtectionDrop && hitProtectionId
          ? surface.panel?.protections.find(
              (protection) =>
                protection.id === hitProtectionId && (protection.circuits?.length ?? 0) > 0
            )
          : undefined

      const ghost = slot
        ? {
            x: gridLeft + slot.col * CELL_W,
            y: gridTop + slot.row * ROW_STRIDE,
            width: widthCols * CELL_W,
            height: CELL_H,
          }
        : null
      let feedWirePoints: number[] | undefined
      if (ghost && hit && feederProtection) {
        const originCx = surface.x + hit.x + hit.width / 2
        const originTop = surface.y + hit.y
        const originBottom = originTop + hit.height
        const targetCx = ghost.x + ghost.width / 2
        const below = ghost.y > originBottom
        const gapY = below ? originBottom + ROW_GAP / 2 : originTop - ROW_GAP / 2
        feedWirePoints = [
          originCx,
          below ? originBottom : originTop,
          originCx,
          gapY,
          targetCx,
          gapY,
          targetCx,
          ghost.y,
        ]
      }

      return {
        slot,
        ghost,
        widthCols,
        requestedRow,
        requestedCol,
        gridTop,
        feederProtection,
        feedWirePoints,
      }
    },
    [currentProject]
  )

  const handleHierarchyDragOver = useCallback(
    (position: Point, symbolData: unknown | null) => {
      if (!scene || !currentProject || !symbolData || typeof symbolData !== 'object') {
        setDragPreview(null)
        return
      }
      const symbol = symbolData as SymbolMetadata
      const isModularSocketDrop = isModularSocketLibraryId(symbol.id)
      const hoverSurface = isModularSocketDrop
        ? detectHierarchyLibraryDropHover(position)
        : detectHierarchyPanelTarget(position)
      if (!hoverSurface) {
        setDragPreview(null)
        return
      }

      const resolved = resolveHierarchyLibraryDrop(position, symbol, hoverSurface)
      if (!resolved) {
        setDragPreview(null)
        return
      }
      const invalid =
        !resolved.ghost ||
        (isModularSocketDrop &&
          (hoverSurface.kind !== 'panel' || !canDropModularSocketOnPanel(hoverSurface.panel)))

      setDragPreview({
        surfaceId: hoverSurface.id,
        panelId: hoverSurface.panel?.id,
        ...(resolved.ghost ?? {
          x: hoverSurface.x + PANEL_FRAME_MARGIN + resolved.requestedCol * CELL_W,
          y: resolved.gridTop + resolved.requestedRow * ROW_STRIDE,
          width: resolved.widthCols * CELL_W,
          height: CELL_H,
        }),
        invalid,
        feedWirePoints: invalid ? undefined : resolved.feedWirePoints,
      })
    },
    [currentProject, detectHierarchyLibraryDropHover, detectHierarchyPanelTarget, resolveHierarchyLibraryDrop, scene, setDragPreview]
  )

  const handleHierarchyDrop = useCallback(
    (position: Point, symbolData: unknown | null, _meta?: CanvasDropMeta) => {
      setDragPreview(null)
      if (!currentProject || !symbolData || typeof symbolData !== 'object') return
      const symbol = symbolData as SymbolMetadata
      const modular = isModularSocketLibraryId(symbol.id)
      const surface = modular
        ? detectHierarchyLibraryDropHover(position)
        : detectHierarchyPanelTarget(position)
      const panel = surface?.panel
      if (
        !surface ||
        !panel ||
        (modular && (surface.kind !== 'panel' || !canDropModularSocketOnPanel(panel)))
      )
        return
      const resolved = resolveHierarchyLibraryDrop(position, symbol, surface)
      if (!resolved?.slot) return
      const { row, col } = resolved.slot
      if ((PROTECTION_SYMBOL_IDS as readonly string[]).includes(symbol.id)) {
        placeElectricalSymbol({
          symbolId: symbol.id, searchPreset: symbol.searchPreset,
          target: { type: 'mainBus', panelId: panel.id },
          panelGrid: {
            scope: 'main',
            row,
            col,
            ...(resolved.feederProtection?.circuits?.[0]?.id
              ? { parentCircuitId: resolved.feederProtection.circuits[0].id }
              : {}),
          },
          label: 'place protection from library',
        })
        return
      }
      if (symbol.id === 'energy_meter') {
        const circuit = getLastAssignableCircuit(panel)
        if (!circuit) return
        placeElectricalSymbol({
          symbolId: symbol.id, searchPreset: symbol.searchPreset,
          target: {
            type: 'circuit',
            panelId: panel.id,
            circuitId: circuit.id,
            circuitTrunkSegmentIndex: 0,
          },
          panelGrid: { scope: 'main', row, col },
          label: 'place meter from library',
        })
        return
      }
      if (modular) {
        const hit = surface.placements.find(
          (placement) =>
            placement.ref.kind === 'protection' &&
            position.x >= surface.x + placement.x &&
            position.x <= surface.x + placement.x + placement.width &&
            position.y >= surface.y + placement.y &&
            position.y <= surface.y + placement.y + placement.height
        )
        const hitProtectionId = hit?.ref.kind === 'protection' ? hit.ref.id : undefined
        const hitProtection = hitProtectionId
          ? panel.protections.find((protection) => protection.id === hitProtectionId)
          : undefined
        const protection = findPreferredModularSocketProtection(panel, hitProtection)
        if (!protection) return
        const circuit = findPreferredModularSocketCircuit(panel, protection)
        placeElectricalSymbol({
          symbolId: symbol.id, searchPreset: symbol.searchPreset,
          target: circuit
            ? { type: 'circuit', panelId: panel.id, circuitId: circuit.id }
            : { type: 'mainBus', panelId: panel.id },
          panelGrid: {
            scope: 'main',
            row,
            col,
            ...(!circuit ? { ensureCircuitForProtectionId: protection.id } : {}),
          },
          label: 'place modular socket from library',
        })
      }
    },
    [currentProject, detectHierarchyLibraryDropHover, detectHierarchyPanelTarget, resolveHierarchyLibraryDrop, setDragPreview]
  )

  return { detectHierarchyModuleDropTarget, handleHierarchyDragOver, handleHierarchyDrop }
}
