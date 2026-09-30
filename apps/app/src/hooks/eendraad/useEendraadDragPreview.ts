import { useState, useCallback, type MutableRefObject } from 'react'
import { protectionDropTargetHitsSource } from '@/lib/eendraad/eendraadAltDragDuplicate'
import { PROTECTION_SYMBOL_IDS } from '@/lib/protectionKind'
import { getEndpointTypeFromSymbol } from '@/utils'
import type { SymbolMetadata } from '@/lib/symbols'
import type { DropTarget, FindDropTargetOptions } from '@/lib/layout/findDropTarget'
import type { ProtectionDevice } from '@/types/schema'
import type { Point } from '@/types/ui'
import type { ElectricalEnclosureRef } from '@/types/supplyAssembly'
import { normalizeProtectionPlacementDropTarget } from '@/lib/eendraad/protectionPlacementDropTarget'
import { canCreateSupplyTopologyFromDrop } from '@/lib/supplyTopologyFeature'
import type { SameSymbolAddMoreLayoutTarget } from '@/lib/eendraad/sameSymbolAddMore'
import type { CircuitTrunkBranchSlot } from '@/lib/layout/circuitTrunkBranchSlots'

const SUPPLY_ASSEMBLY_DROP_TARGETS = new Set<NonNullable<DropTarget['type']>>([
  'supplyWire',
  'supplyBackupWire',
  'supplyBackupOutputWire',
  'supplyChangeoverGridWire',
  'supplyConverterGridWire',
  'supplyConverterBackupWire',
  'supplyConverterDcWire',
])

export interface DragPreviewState {
  position: Point
  symbolData: SymbolMetadata | null
  dropTarget: DropTarget | null
  /**
   * When dragging an existing circuit trunk device, preview shows it removed from
   * the source circuit and inserted on the hovered trunk (same device id).
   */
  relocatingTrunkDevice?: { id: string; sourceCircuitId: string }
  /** Existing device being popped out and reinserted in a supply-frame lane. */
  relocatingSupplyTrunkDevice?: { id: string; targetMounting?: ElectricalEnclosureRef }
  movingEndpointSelection?: {
    draggedEndpointId: string
    sourceCircuitId: string
    endpointIds: string[]
  }
  movingPanelAttachment?: { panelId: string }
  /** Existing protection/circuit being reparented instead of duplicated. */
  movingProtection?: { protectionId: string; circuitId: string }
  /** Existing matching symbol that will be incremented instead of inserting a new entity. */
  sameSymbolAddMore?: SameSymbolAddMoreLayoutTarget
  /** Branch gap on a circuit trunk while moving whole endpoint branches. */
  trunkBranchSlot?: CircuitTrunkBranchSlot
}

export function shouldPreferMainBusOverSupplyWire(): boolean {
  // An existing protection can be moved onto a secondary panel's incoming wire.
  // Let the wire win at the bus/feeder overlap so the move is treated as a
  // rewire, rather than as a main-bus reorder that leaves the old hierarchy.
  return false
}

export function shouldShowPanelDragPreview(dropTarget: DropTarget): boolean {
  return !(dropTarget.type === null && dropTarget.panelId)
}

/**
 * Hook to manage drag preview state and handle drag over events
 */
export function useEendraadDragPreview(
  detectDropTarget: (position: Point, options?: FindDropTargetOptions) => DropTarget,
  options?: {
    draggingProtectionIdRef?: MutableRefObject<string | null>
    getProtectionById?: (id: string) => ProtectionDevice | null | undefined
    movingPanelAttachmentIdRef?: MutableRefObject<string | null>
    isPanelAttachmentDropAllowed?: (panelId: string, target: DropTarget) => boolean
    resolveSameSymbolAddMore?: (
      position: Point,
      symbol: SymbolMetadata
    ) => SameSymbolAddMoreLayoutTarget | null
    isBlockedDropPosition?: (position: Point) => boolean
  }
) {
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null)
  /** Last pointer position during a drag, kept even where there is no valid drop target. */
  const [dragPointer, setDragPointer] = useState<Point | null>(null)
  const resolveSameSymbolAddMore = options?.resolveSameSymbolAddMore
  const isBlockedDropPosition = options?.isBlockedDropPosition

  const handleDragOver = useCallback(
    (position: Point, symbolData: unknown | null) => {
      if (position.x === -Infinity || position.y === -Infinity) {
        setDragPreview(null)
        setDragPointer(null)
        return
      }
      setDragPointer(position)

      const symbol = symbolData as SymbolMetadata | null
      if (!symbol) {
        setDragPreview(null)
        return
      }
      if (isBlockedDropPosition?.(position)) {
        setDragPreview(null)
        return
      }
      const sameSymbolAddMore = resolveSameSymbolAddMore?.(position, symbol)
      if (sameSymbolAddMore) {
        setDragPreview({
          position: sameSymbolAddMore.center,
          symbolData: symbol,
          dropTarget: null,
          sameSymbolAddMore,
        })
        return
      }
      if (!canCreateSupplyTopologyFromDrop(symbol, null)) {
        setDragPreview(null)
        return
      }

      const draggingProtectionId = options?.draggingProtectionIdRef?.current
      const protectionIds = [...PROTECTION_SYMBOL_IDS]
      const isProtectionPlacement = protectionIds.includes(
        symbol.id as (typeof PROTECTION_SYMBOL_IDS)[number]
      )
      // New protections need main-bus preference on compact empty split rails, whose
      // incoming supply stubs necessarily cross the short bars. Existing protections
      // keep the wire target available so they can be rewired onto a sub-panel feeder.
      // Panels must keep the actual wire target: a converter-backed circuit can run
      // close enough to the main bus for the padded hit zones to overlap.
      const prefersMainBus =
        shouldPreferMainBusOverSupplyWire() ||
        Boolean(symbol.busFeedKind) ||
        isProtectionPlacement
      const rawDropTarget = detectDropTarget(
        position,
        symbol.id === 'earthing_separator'
          ? undefined
          : {
              preferMainBusOverGroundWire: true,
              preferMainBusOverSupplyWire: prefersMainBus,
              preferSecondaryBusForNestedProtection: isProtectionPlacement,
              ...(symbol.id === 'dc_bus' ? { preferCircuitTrunkWire: true } : {}),
              ...(symbol.id === 'source_changeover'
                ? { normalizeDirectConverterChangeoverDrop: true }
                : {}),
            }
      )

      // Normalize generic panel-frame hits (type:null with panelId) for protection
      // devices so they behave exactly like drops on the main bus of that panel.
      let dropTarget: DropTarget = rawDropTarget
      if (
        symbol.busFeedKind &&
        rawDropTarget.type === null &&
        rawDropTarget.panelId &&
        rawDropTarget.diagramId?.endsWith('--supply')
      ) {
        dropTarget = { ...rawDropTarget, type: 'mainBus', mainBusInsertIndex: 0 }
      }
      if (
        rawDropTarget.type === null &&
        rawDropTarget.panelId &&
        symbol &&
        protectionIds.includes(symbol.id as (typeof PROTECTION_SYMBOL_IDS)[number])
      ) {
        dropTarget = { ...rawDropTarget, type: 'mainBus', normalizedFromPanelFrame: true }
      }

      if (!canCreateSupplyTopologyFromDrop(symbol, dropTarget.type)) {
        setDragPreview(null)
        return
      }

      const movingPanelAttachmentId = options?.movingPanelAttachmentIdRef?.current
      if (
        symbol.id === 'panel_distribution' &&
        movingPanelAttachmentId &&
        !options?.isPanelAttachmentDropAllowed?.(movingPanelAttachmentId, dropTarget)
      ) {
        setDragPreview(null)
        return
      }

      // New protections dropped on an existing protection nest on its output
      // circuit. Existing-protection drags keep their separate reorder behavior.
      if (!options?.draggingProtectionIdRef?.current) {
        dropTarget = normalizeProtectionPlacementDropTarget(symbol, dropTarget)
      }

      // Supply-assembly lanes use the full simulated layout preview. Keep the drag
      // preview alive for every placeable symbol, not only endpoint/protection types.
      if (dropTarget.type && SUPPLY_ASSEMBLY_DROP_TARGETS.has(dropTarget.type)) {
        setDragPreview({ position, symbolData: symbol, dropTarget })
        return
      }

      if (symbol.busFeedKind) {
        if (dropTarget.type === 'protection' || dropTarget.type === 'circuit') {
          dropTarget = { ...dropTarget, type: 'mainBus' }
        }
        if (
          dropTarget.type === 'mainBus' ||
          dropTarget.type === 'protection' ||
          dropTarget.type === 'circuit'
        ) {
          setDragPreview({ position, symbolData: symbol, dropTarget })
        } else {
          setDragPreview(null)
        }
        return
      }

      // Get endpoint type for this symbol (null for protection devices and panels)
      const endpointType = getEndpointTypeFromSymbol(symbol)

      // Only show preview for endpoint types (not protection devices during drag)
      if (endpointType) {
        setDragPreview({ position, symbolData: symbol, dropTarget })
      } else if (symbol.id === 'panel_distribution') {
        // Keep the resolved drop target so panel preview can reflect actual
        // hover intent (main bus vs empty feeder circuit/protection).
        if (!shouldShowPanelDragPreview(dropTarget)) {
          setDragPreview(null)
        } else {
          setDragPreview({
            position,
            symbolData: symbol,
            dropTarget,
            ...(movingPanelAttachmentId
              ? { movingPanelAttachment: { panelId: movingPanelAttachmentId } }
              : {}),
          })
        }
      } else if (symbol.id === 'earthing' || symbol.id === 'earthing_separator') {
        if (
          dropTarget.type === 'mainBus' ||
          (symbol.id === 'earthing_separator' && dropTarget.type === 'groundWire')
        ) {
          setDragPreview({ position, symbolData: symbol, dropTarget })
        } else {
          setDragPreview(null)
        }
      } else {
        // For protection devices (MCB, RCD, RCBO, FUSE, MAIN_SWITCH, SPD), always
        // show a preview on any supported target: main bus, RCD bus, secondary
        // buses (circuit trunk), existing protection, and the supply wire.
        if (protectionIds.includes(symbol.id as (typeof PROTECTION_SYMBOL_IDS)[number])) {
          if (
            draggingProtectionId &&
            options?.getProtectionById &&
            protectionDropTargetHitsSource(
              draggingProtectionId,
              dropTarget,
              options.getProtectionById
            )
          ) {
            setDragPreview(null)
            return
          }
          if (
            dropTarget.type === 'mainBus' ||
            dropTarget.type === 'rcd' ||
            dropTarget.type === 'circuit' ||
            dropTarget.type === 'protection' ||
            (dropTarget.type === null && dropTarget.panelId)
          ) {
            setDragPreview({ position, symbolData: symbol, dropTarget })
          } else {
            setDragPreview(null)
          }
        } else {
          setDragPreview(null)
        }
      }
    },
    [
      detectDropTarget,
      options,
      resolveSameSymbolAddMore,
      isBlockedDropPosition,
    ]
  )

  return {
    dragPreview,
    setDragPreview,
    dragPointer,
    handleDragOver,
  }
}
