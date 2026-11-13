import { getPanelGridTotalColumns } from '@/lib/panel/panelGridFields'
import { placeElectricalSymbol } from '@/handlers/eendraad/placeElectricalSymbol'
import { useCallback, useRef, useState } from 'react'
import type { ProjectState } from '@/stores/projectStore'
import { logger } from '@/lib/logger'
import { getVoltagePolesConfig, getProtectionCreationProps } from '@/lib/protectionDefaults'
import {
  PROTECTION_SYMBOL_IDS,
  protectionTypeFromSymbolId,
  ROTATING_SWITCH_SYMBOL_ID,
} from '@/lib/protectionKind'
import { getSharedSupplyRefsForPanel, isSupplyTrunkRef } from '@/lib/panel/panelRewire'
import { polesFromConfig } from '@/constants/poleConfig'
import { clamp } from '@/lib/geometry'
import type { SymbolMetadata } from '@/lib/symbols'
import type { Panel, PanelGridModuleRef } from '@/types/schema'
import type { Point } from '@/types/ui'
import {
  CELL_H,
  CELL_W,
  ROW_GAP,
  getModuleWidthInCols,
  getPlacementForNewChildNextToParent,
  getSupplyPanelColumns,
  getSupplyPanelRows,
  panelGridModuleRefKey,
  snapToGrid,
  type ModulePlacement,
} from '@/lib/panel/panelGridLayout'
import { getLastAssignableCircuit } from '@/lib/panel/panelTree'
import { trackSymbolPlace } from '@/lib/analytics/editorEventAnalytics'
import { DEFAULT_PANEL_GRID_ROWS } from '@/lib/panel/panelGridDefaults'
import {
  canDropModularSocketOnPanel,
  findPreferredModularSocketCircuit,
  findPreferredModularSocketProtection,
  isModularSocketLibraryId,
  MODULAR_SOCKET_SINGLE_MODULE_WIDTH,
} from '@/lib/socket/modularSocket'

type Project = NonNullable<ProjectState['currentProject']>

type CombinedPlacement = ModulePlacement & { inSupplyPanel: boolean }

type DragPreview = {
  position: Point
  symbol: SymbolMetadata
  previewRef: PanelGridModuleRef | null
  previewWidthCols: number
  invalid?: boolean
  autoParent?: { parentRef: PanelGridModuleRef; placement: { row: number; col: number } | null }
}

type UsePanelLibraryDropOptions = {
  combinedPlacements: CombinedPlacement[]
  currentProject: Project | null
  panel: Panel | null
  placements: ModulePlacement[]
  setActivePanelId: (panelId: string | null) => void
  supplyLayout: { cols: number; contentWidth: number; rows: number }
  supplyModulesLength: number
}

function getLibraryDropWidthCols(symbol: SymbolMetadata, project: Project | null): number {
  if (isModularSocketLibraryId(symbol.id)) return MODULAR_SOCKET_SINGLE_MODULE_WIDTH
  if (symbol.id === 'energy_meter')
    return Math.max(1, polesFromConfig(getVoltagePolesConfig(project)))
  if (symbol.id === ROTATING_SWITCH_SYMBOL_ID) return 1
  const protectionType = protectionTypeFromSymbolId(symbol.id)
  const defaults = getProtectionCreationProps(project, protectionType)
  const poles =
    defaults.poles ??
    (defaults.polesConfig ? polesFromConfig(defaults.polesConfig) : undefined) ??
    1
  return Math.max(1, poles)
}

export function usePanelLibraryDrop({
  combinedPlacements,
  currentProject,
  panel,
  placements,
  setActivePanelId,
  supplyLayout,
  supplyModulesLength,
}: UsePanelLibraryDropOptions) {
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  const lastDragPreviewRef = useRef<DragPreview | null>(null)
  const handleDragOver = useCallback(
    (position: Point, symbolData: unknown | null) => {
      // Clear preview when leaving canvas
      if (
        position.x === -Infinity ||
        position.y === -Infinity ||
        !symbolData ||
        !panel ||
        !currentProject
      ) {
        setDragPreview(null)
        return
      }

      const symbol = symbolData as SymbolMetadata
      if (!symbol || !symbol.id) {
        setDragPreview(null)
        return
      }

      const isProtectionDevice = (PROTECTION_SYMBOL_IDS as readonly string[]).includes(symbol.id)
      const isEnergyMeter = symbol.id === 'energy_meter'
      const isModularSocket = isModularSocketLibraryId(symbol.id)
      const previewWidthCols = getLibraryDropWidthCols(symbol, currentProject)

      if (!isProtectionDevice && !isEnergyMeter && !isModularSocket) {
        setDragPreview(null)
        return
      }

      // Calculate panel dimensions
      const FRAME_MARGIN = 40
      const SUPPLY_GAP = 20
      const rows = panel?.gridView?.rows ?? DEFAULT_PANEL_GRID_ROWS
      const cols = getPanelGridTotalColumns(panel?.gridView)
      const supplyRows = getSupplyPanelRows(panel)
      const supplyCols = getSupplyPanelColumns(panel)
      const contentWidth = cols * CELL_W
      const contentHeight = rows * CELL_H + (rows - 1) * ROW_GAP
      const panelFrameHeight = contentHeight + FRAME_MARGIN * 2
      const supplyPanelVisible = !!(panel?.isMain && supplyModulesLength > 0)
      const supplyContentHeight = supplyRows * CELL_H + Math.max(0, supplyRows - 1) * ROW_GAP
      const supplyFrameHeight = supplyContentHeight + FRAME_MARGIN * 2
      const feedFromTop = panel?.gridView?.feedFromTop ?? false
      const mainPanelY = supplyPanelVisible && feedFromTop ? supplyFrameHeight + SUPPLY_GAP : 0
      const supplyPanelY = supplyPanelVisible && !feedFromTop ? panelFrameHeight + SUPPLY_GAP : 0

      const frameLeft = -FRAME_MARGIN
      const frameRight = Math.max(contentWidth, supplyCols * CELL_W) + FRAME_MARGIN
      const supFrameTop = supplyPanelVisible ? supplyPanelY - FRAME_MARGIN : -Infinity
      const supFrameBottom = supplyPanelVisible
        ? supplyPanelY + supplyContentHeight + FRAME_MARGIN
        : -Infinity

      const inSupplyFrame =
        supplyPanelVisible &&
        position.x >= frameLeft &&
        position.x <= frameRight &&
        position.y >= supFrameTop &&
        position.y <= supFrameBottom

      const inMainFrame =
        position.x >= frameLeft &&
        position.x <= frameRight &&
        position.y >= mainPanelY - FRAME_MARGIN &&
        position.y <= mainPanelY + contentHeight + FRAME_MARGIN

      if (!inSupplyFrame && !inMainFrame) {
        setDragPreview(null)
        return
      }

      // Create preview ref based on symbol type
      let previewRef: PanelGridModuleRef | null = null
      let autoParent:
        | { parentRef: PanelGridModuleRef; placement: { row: number; col: number } | null }
        | undefined
      if (isProtectionDevice || isEnergyMeter) {
        if (inSupplyFrame && panel.isMain) {
          // Supply trunk device: targeted drop when over an existing supply module (like protection in main grid)
          const supplyPlacements = combinedPlacements.filter(
            (p): p is typeof p & { inSupplyPanel: true } => p.inSupplyPanel === true
          )
          const groupX = position.x - FRAME_MARGIN
          const groupY = position.y - FRAME_MARGIN
          const supplyHit = supplyPlacements.find(
            (pl) =>
              groupX >= pl.x &&
              groupX <= pl.x + pl.width &&
              groupY >= pl.y &&
              groupY <= pl.y + pl.height
          )
          const hitIndex = supplyHit
            ? supplyPlacements.findIndex(
                (pl) => panelGridModuleRefKey(pl.ref) === panelGridModuleRefKey(supplyHit.ref)
              )
            : -1
          const isLastSupplyHit = hitIndex >= 0 && hitIndex === supplyPlacements.length - 1
          if (supplyHit) {
            if (isLastSupplyHit) {
              // Hovering the last supply module means branching from main bus (not extending supply chain).
              previewRef = isEnergyMeter
                ? { kind: 'trunkDevice', id: 'preview', scope: 'circuit' }
                : { kind: 'protection', id: 'preview' }
            } else {
              const hitWidthCols = getModuleWidthInCols(supplyHit.ref, currentProject)
              const nextCol = Math.min(supplyHit.col + hitWidthCols, supplyCols - previewWidthCols)
              previewRef = { kind: 'trunkDevice', id: 'preview', scope: 'supply' }
              autoParent = {
                parentRef: supplyHit.ref,
                placement: { row: supplyHit.row, col: nextCol },
              }
            }
          } else {
            previewRef = { kind: 'trunkDevice', id: 'preview', scope: 'supply' }
          }
        } else if (isProtectionDevice && inMainFrame) {
          // Auto-parenting: dropping protection onto another protection makes it child
          const localX = position.x - FRAME_MARGIN
          const localY = position.y - FRAME_MARGIN
          const mainPlacements = combinedPlacements.filter(
            (p): p is typeof p & { inSupplyPanel: false } => !p.inSupplyPanel
          )
          const hit = mainPlacements.find(
            (pl) =>
              pl.ref.kind === 'protection' &&
              localX >= pl.x &&
              localX <= pl.x + pl.width &&
              localY >= pl.y &&
              localY <= pl.y + pl.height
          )
          if (hit) {
            const parentPl = placements.find(
              (p) => panelGridModuleRefKey(p.ref) === panelGridModuleRefKey(hit.ref)
            )
            if (parentPl) {
              const childPlacement = getPlacementForNewChildNextToParent(
                placements,
                parentPl,
                previewWidthCols,
                rows,
                cols,
                feedFromTop
              )
              previewRef = { kind: 'protection', id: 'preview' }
              autoParent = { parentRef: hit.ref, placement: childPlacement }
            } else {
              previewRef = { kind: 'protection', id: 'preview' }
            }
          } else {
            previewRef = { kind: 'protection', id: 'preview' }
          }
        } else if (isProtectionDevice) {
          previewRef = { kind: 'protection', id: 'preview' }
        } else if (isEnergyMeter) {
          previewRef = { kind: 'trunkDevice', id: 'preview', scope: 'circuit' }
        }
      } else if (isModularSocket && (inMainFrame || inSupplyFrame)) {
        previewRef = { kind: 'domotica', endpointId: 'preview', circuitId: 'preview' }
      }

      if (previewRef) {
        const next = {
          position,
          symbol,
          previewRef,
          previewWidthCols,
          invalid: isModularSocket
            ? inSupplyFrame || !canDropModularSocketOnPanel(panel)
            : undefined,
          ...(autoParent != null ? { autoParent } : {}),
        }
        setDragPreview(next)
        lastDragPreviewRef.current = next
      } else {
        setDragPreview(null)
        lastDragPreviewRef.current = null
      }
    },
    [panel, currentProject, combinedPlacements, placements, supplyModulesLength]
  )

  const handleDrop = useCallback(
    (position: Point, symbolData: unknown) => {
      const previewFromDrag = lastDragPreviewRef.current
      setDragPreview(null)
      lastDragPreviewRef.current = null

      if (!currentProject || !panel) {
        logger.warn('PanelCanvas: No current project or panel')
        return
      }

      const symbol = symbolData as SymbolMetadata
      if (!symbol || !symbol.id) {
        logger.warn('PanelCanvas: Invalid symbol data:', symbolData)
        return
      }

      if (symbol.id === 'panel_distribution') {
        const placed = placeElectricalSymbol({
          symbolId: symbol.id, searchPreset: symbol.searchPreset,
          target: { type: null },
          label: 'drop panel from library',
        })
        const newPanelId =
          placed.status === 'placed'
            ? placed.created.find((ref) => ref.kind === 'panel')?.id
            : undefined
        if (!newPanelId) return
        setActivePanelId(newPanelId)
        trackSymbolPlace({
          canvas: 'panel',
          symbol,
          placementMethod: 'library_drop',
          targetType: 'panel_hierarchy',
        })
        return
      }

      // Check if drop is in supply panel area (only for main panels)
      const FRAME_MARGIN = 40
      const SUPPLY_GAP = 20
      const rows = panel?.gridView?.rows ?? DEFAULT_PANEL_GRID_ROWS
      const cols = getPanelGridTotalColumns(panel?.gridView)
      const contentWidth = cols * CELL_W
      const contentHeight = rows * CELL_H + (rows - 1) * ROW_GAP
      const panelFrameHeight = contentHeight + FRAME_MARGIN * 2
      const supplyPanelVisible = !!(panel?.isMain && supplyModulesLength > 0)
      const supplyContentHeight =
        supplyLayout.rows * CELL_H + Math.max(0, supplyLayout.rows - 1) * ROW_GAP
      const supplyFrameHeight = supplyContentHeight + FRAME_MARGIN * 2
      const feedFromTop = panel?.gridView?.feedFromTop ?? false
      const mainPanelY = supplyPanelVisible && feedFromTop ? supplyFrameHeight + SUPPLY_GAP : 0
      const supplyPanelY = supplyPanelVisible && !feedFromTop ? panelFrameHeight + SUPPLY_GAP : 0

      const frameLeft = -FRAME_MARGIN
      const frameRight = Math.max(contentWidth, supplyLayout.contentWidth) + FRAME_MARGIN
      const supFrameTop = supplyPanelVisible ? supplyPanelY - FRAME_MARGIN : -Infinity
      const supFrameBottom = supplyPanelVisible
        ? supplyPanelY + supplyContentHeight + FRAME_MARGIN
        : -Infinity

      const inSupplyFrame =
        supplyPanelVisible &&
        position.x >= frameLeft &&
        position.x <= frameRight &&
        position.y >= supFrameTop &&
        position.y <= supFrameBottom
      const inMainFrame =
        position.x >= frameLeft &&
        position.x <= frameRight &&
        position.y >= mainPanelY - FRAME_MARGIN &&
        position.y <= mainPanelY + contentHeight + FRAME_MARGIN
      const groupX = position.x - FRAME_MARGIN
      const groupY = position.y - FRAME_MARGIN
      const supplyPlacementsForDrop = combinedPlacements.filter(
        (p): p is typeof p & { inSupplyPanel: true } => p.inSupplyPanel === true
      )
      const supplyHitForDrop = inSupplyFrame
        ? supplyPlacementsForDrop.find(
            (pl) =>
              groupX >= pl.x &&
              groupX <= pl.x + pl.width &&
              groupY >= pl.y &&
              groupY <= pl.y + pl.height
          )
        : undefined
      const supplyHitIndex = supplyHitForDrop
        ? supplyPlacementsForDrop.findIndex(
            (pl) => panelGridModuleRefKey(pl.ref) === panelGridModuleRefKey(supplyHitForDrop.ref)
          )
        : -1
      const isLastSupplyHitOnDrop =
        supplyHitIndex >= 0 && supplyHitIndex === supplyPlacementsForDrop.length - 1

      // Check if symbol is a protection device
      const isProtectionDevice = (PROTECTION_SYMBOL_IDS as readonly string[]).includes(symbol.id)

      // Check if symbol is an energy meter
      const isEnergyMeter = symbol.id === 'energy_meter'
      const isModularSocket = isModularSocketLibraryId(symbol.id)
      const droppedModuleWidthCols = getLibraryDropWidthCols(symbol, currentProject)

      // Drop to supply chain only when actually dropped inside supply frame.
      const addToSupply =
        panel.isMain &&
        inSupplyFrame &&
        (isProtectionDevice || isEnergyMeter) &&
        !isLastSupplyHitOnDrop
      if (addToSupply) {
        // Get existing supply trunk devices and optional hit for targeted drop
        const existingDevices = getSharedSupplyRefsForPanel(currentProject, panel)
          .map((ref) => ({
            id: isSupplyTrunkRef(ref) ? ref.id : '',
          }))
          .filter((device) => device.id.length > 0)
        const supplyPlacements = combinedPlacements.filter(
          (p): p is typeof p & { inSupplyPanel: true } => p.inSupplyPanel === true
        )
        const groupX = position.x - FRAME_MARGIN
        const groupY = position.y - FRAME_MARGIN
        const supplyHit = supplyPlacements.find(
          (pl) =>
            groupX >= pl.x &&
            groupX <= pl.x + pl.width &&
            groupY >= pl.y &&
            groupY <= pl.y + pl.height
        )
        const supplyHitRef = supplyHit && isSupplyTrunkRef(supplyHit.ref) ? supplyHit.ref : null
        const hitDeviceIndex = supplyHitRef
          ? existingDevices.findIndex((d) => d.id === supplyHitRef.id)
          : -1
        const newModuleWidthCols = droppedModuleWidthCols
        let insertIndex: number
        let row: number
        let col: number
        if (supplyHit) {
          insertIndex = hitDeviceIndex >= 0 ? hitDeviceIndex + 1 : existingDevices.length
          row = supplyHit.row
          col = Math.min(
            supplyHit.col + getModuleWidthInCols(supplyHit.ref, currentProject),
            supplyLayout.cols - newModuleWidthCols
          )
        } else if (supplyPlacements.length > 0) {
          const lastPl = supplyPlacements[supplyPlacements.length - 1]
          if (!lastPl) return
          const usePreview =
            previewFromDrag?.autoParent?.placement != null &&
            previewFromDrag.autoParent.parentRef.kind === 'trunkDevice' &&
            previewFromDrag.autoParent.parentRef.scope === 'supply'
          if (usePreview) {
            row = previewFromDrag!.autoParent!.placement!.row
            col = Math.max(
              0,
              Math.min(
                supplyLayout.cols - newModuleWidthCols,
                previewFromDrag!.autoParent!.placement!.col
              )
            )
            insertIndex = supplyPlacements.filter(
              (pl) =>
                pl.row < row ||
                (pl.row === row && pl.col + getModuleWidthInCols(pl.ref, currentProject) <= col)
            ).length
          } else {
            insertIndex = existingDevices.length
            row = lastPl.row
            col = Math.min(
              lastPl.col + getModuleWidthInCols(lastPl.ref, currentProject),
              supplyLayout.cols - newModuleWidthCols
            )
          }
        } else {
          insertIndex = existingDevices.length
          row = Math.max(
            0,
            Math.min(
              supplyLayout.rows - 1,
              snapToGrid(groupX, groupY - supplyPanelY + CELL_H / 2).row
            )
          )
          col = Math.max(
            0,
            Math.min(supplyLayout.cols - newModuleWidthCols, Math.round(groupX / CELL_W))
          )
        }
        const placed = placeElectricalSymbol({
          symbolId: symbol.id, searchPreset: symbol.searchPreset,
          target: {
            type: 'supplyWire',
            panelId: panel.id,
            supplyDeviceInsertIndex: insertIndex,
            supplyFeedScope: 'shared',
          },
          panelGrid: { scope: 'supply', row, col: Math.max(0, col) },
          label: 'drop symbol from library onto panel',
        })
        if (placed.status !== 'placed' || !placed.changed) return
        trackSymbolPlace({
          canvas: 'panel',
          symbol,
          placementMethod: 'library_drop',
          targetType: 'supply_panel',
        })
        return
      }

      if (isProtectionDevice) {
        const localX = position.x - FRAME_MARGIN
        const localY = position.y - FRAME_MARGIN
        const mainPlacementsForHit = combinedPlacements.filter(
          (p): p is typeof p & { inSupplyPanel: false } => !p.inSupplyPanel
        )
        const hit = mainPlacementsForHit.find(
          (pl) =>
            pl.ref.kind === 'protection' &&
            localX >= pl.x &&
            localX <= pl.x + pl.width &&
            localY >= pl.y &&
            localY <= pl.y + pl.height
        )
        const parentPl = hit
          ? placements.find((p) => panelGridModuleRefKey(p.ref) === panelGridModuleRefKey(hit.ref))
          : null
        const childPlacement = parentPl
          ? getPlacementForNewChildNextToParent(
              placements,
              parentPl,
              droppedModuleWidthCols,
              rows,
              cols,
              feedFromTop
            )
          : null
        const isAutoParent = !!hit && !!parentPl

        const parentProtectionId =
          isAutoParent && hit?.ref.kind === 'protection' ? hit.ref.id : undefined
        const parentProtection = panel.protections.find(
          (protection) => protection.id === parentProtectionId
        )
        const parentCircuitId = parentProtection?.circuits?.[0]?.id
        const snapped = snapToGrid(localX, localY - mainPanelY + CELL_H / 2)
        const placed = placeElectricalSymbol({
          symbolId: symbol.id, searchPreset: symbol.searchPreset,
          target: { type: 'mainBus', panelId: panel.id },
          panelGrid: {
            scope: 'main',
            row: isAutoParent ? (childPlacement?.row ?? 0) : clamp(snapped.row, 0, rows - 1),
            col: isAutoParent
              ? (childPlacement?.col ?? 0)
              : Math.max(0, Math.round(localX / CELL_W)),
            centerColumn: !isAutoParent,
            parentCircuitId,
          },
          label: 'drop symbol from library onto panel',
        })
        if (placed.status !== 'placed' || !placed.changed) return
        trackSymbolPlace({
          canvas: 'panel',
          symbol,
          placementMethod: 'library_drop',
          targetType: isAutoParent ? 'protection_child' : 'panel_grid',
        })
      } else if (isEnergyMeter) {
        // Calculate row/col from drop position
        const localX = position.x - FRAME_MARGIN
        const localY = position.y - mainPanelY - FRAME_MARGIN
        const snapped = snapToGrid(localX, localY + CELL_H / 2)

        const targetCircuit = getLastAssignableCircuit(panel)

        if (!targetCircuit) {
          logger.warn('PanelCanvas: No available circuit found for energy meter')
          return
        }

        const placed = placeElectricalSymbol({
          symbolId: symbol.id, searchPreset: symbol.searchPreset,
          target: {
            type: 'circuit',
            circuitId: targetCircuit.id,
            panelId: panel.id,
            circuitTrunkSegmentIndex: 0,
          },
          panelGrid: {
            scope: 'main',
            row: clamp(snapped.row, 0, rows - 1),
            col: Math.max(0, Math.round(localX / CELL_W)),
            centerColumn: true,
          },
          label: 'drop symbol from library onto panel',
        })
        if (placed.status !== 'placed' || !placed.changed) return
        trackSymbolPlace({
          canvas: 'panel',
          symbol,
          placementMethod: 'library_drop',
          targetType: 'panel_grid',
        })
      } else if (isModularSocket && inMainFrame) {
        const localX = position.x - FRAME_MARGIN
        const localY = position.y - mainPanelY - FRAME_MARGIN
        const snapped = snapToGrid(localX, localY + CELL_H / 2)
        const mainPlacements = combinedPlacements.filter(
          (p): p is typeof p & { inSupplyPanel: false } => !p.inSupplyPanel
        )
        const hitProtection = mainPlacements.find(
          (pl) =>
            pl.ref.kind === 'protection' &&
            localX >= pl.x &&
            localX <= pl.x + pl.width &&
            localY + mainPanelY >= pl.y &&
            localY + mainPanelY <= pl.y + pl.height
        )
        const hitProtectionId =
          hitProtection?.ref.kind === 'protection' ? hitProtection.ref.id : undefined
        const hitProtectionDevice = hitProtectionId
          ? panel.protections.find((protection) => protection.id === hitProtectionId)
          : undefined
        const protection = findPreferredModularSocketProtection(panel, hitProtectionDevice)
        if (!protection) return
        const targetCircuit = findPreferredModularSocketCircuit(panel, protection)

        if (!targetCircuit) {
          logger.warn('PanelCanvas: No available circuit found for modular socket')
          return
        }

        const placed = placeElectricalSymbol({
          symbolId: symbol.id, searchPreset: symbol.searchPreset,
          target: { type: 'circuit', panelId: panel.id, circuitId: targetCircuit.id },
          panelGrid: {
            scope: 'main',
            row: clamp(snapped.row, 0, rows - 1),
            col: Math.max(0, Math.round(localX / CELL_W)),
            centerColumn: true,
          },
          label: 'drop symbol from library onto panel',
        })
        if (placed.status !== 'placed' || !placed.changed) return
        trackSymbolPlace({
          canvas: 'panel',
          symbol,
          placementMethod: 'library_drop',
          targetType: 'panel_grid',
        })
      }
    },
    [
      currentProject,
      panel,
      setActivePanelId,
      combinedPlacements,
      placements,
      supplyLayout.cols,
      supplyLayout.contentWidth,
      supplyLayout.rows,
      supplyModulesLength,
    ]
  )

  return { dragPreview, handleDragOver, handleDrop }
}
