import { useState, useCallback, useEffect, useRef, type MutableRefObject, type SetStateAction } from 'react'
import { normalizeBusFeedSupplyFrameDrop } from '@/lib/layout/supplyFrameRole'
import { protectionDropTargetHitsSource } from '@/lib/eendraad/eendraadAltDragDuplicate'
import { PROTECTION_SYMBOL_IDS } from '@/lib/protectionKind'
import { getEndpointTypeFromSymbol } from '@/utils'
import type { SymbolMetadata } from '@/lib/symbols'
import { isHorizontalDomoticaPreset } from '@/lib/library/libraryPresets'
import type { DropTarget, FindDropTargetOptions } from '@/lib/layout/findDropTarget'
import type { ProtectionDevice } from '@/types/schema'
import type { Point } from '@/types/ui'
import type { ElectricalEnclosureRef } from '@/types/supplyAssembly'
import { normalizeProtectionPlacementDropTarget } from '@/lib/eendraad/protectionPlacementDropTarget'
import { canCreateSupplyTopologyFromDrop } from '@/lib/supplyTopologyFeature'
import type { SameSymbolAddMoreLayoutTarget } from '@/lib/eendraad/sameSymbolAddMore'
import type { CircuitTrunkBranchSlot } from '@/lib/layout/circuitTrunkBranchSlots'
import type { BranchDropIntent } from '@/lib/layout/branchDropInteraction'
import { isSupplyDropTarget } from '@/lib/eendraad/supplyDropTargets'
import { dropBehaviors, canDropSymbolOnSupplyConverterDcWire } from '@/lib/eendraad/dropBehaviors'

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
  branchIntent?: BranchDropIntent
}

interface DragFeedbackState {
  dragPreview: DragPreviewState | null
  dragPointer: Point | null
}

function getDragFeedbackIntent(preview: DragPreviewState | null): string | null {
  if (!preview) return null
  // Compare all target and move metadata, including bus slots and mounting.
  // Symbol metadata is compared by identity separately; only the pointer may
  // wait for a frame when the complete resolved intent is unchanged.
  const { position: _position, symbolData: _symbolData, ...intent } = preview
  return JSON.stringify(intent)
}

function pointsEqual(left: Point | null, right: Point | null): boolean {
  return left === right || (!!left && !!right && left.x === right.x && left.y === right.y)
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
    clearBranchDrop?: () => void
    resolveBranchDrop?: (position: Point, symbol: SymbolMetadata) => {
      handled: boolean; intent: BranchDropIntent | null
    }
  }
) {
  const [feedback, setFeedback] = useState<DragFeedbackState>({
    dragPreview: null,
    dragPointer: null,
  })
  const latestFeedbackRef = useRef(feedback)
  const intentRef = useRef<string | null>(null)
  const frameRef = useRef<number | null>(null)
  /** Last pointer position, kept even where there is no valid drop target. */
  const pointerRef = useRef<Point | null>(null)

  const cancelPendingFrame = useCallback(() => {
    if (frameRef.current === null) return
    cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }, [])

  useEffect(() => cancelPendingFrame, [cancelPendingFrame])

  const setDragPreview = useCallback((action: SetStateAction<DragPreviewState | null>) => {
    const previous = latestFeedbackRef.current
    // Internal drags compose additional move metadata immediately after
    // handleDragOver. Read the latest queued value, not the last rendered one.
    const dragPreview = typeof action === 'function' ? action(previous.dragPreview) : action
    const intent = getDragFeedbackIntent(dragPreview)
    const sameIntent =
      intent === intentRef.current &&
      dragPreview?.symbolData === previous.dragPreview?.symbolData
    const next = { dragPreview, dragPointer: pointerRef.current }
    latestFeedbackRef.current = next
    intentRef.current = intent

    if (
      sameIntent &&
      pointsEqual(dragPreview?.position ?? null, previous.dragPreview?.position ?? null) &&
      pointsEqual(next.dragPointer, previous.dragPointer)
    ) return

    // Target transitions and teardown must never wait behind a pointer frame.
    // In particular, clearing after drop/cancel cancels any queued ghost update.
    if (!sameIntent || dragPreview === null || typeof requestAnimationFrame !== 'function') {
      cancelPendingFrame()
      setFeedback(next)
      return
    }
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      setFeedback(latestFeedbackRef.current)
    })
  }, [cancelPendingFrame])
  const resolveSameSymbolAddMore = options?.resolveSameSymbolAddMore
  const isBlockedDropPosition = options?.isBlockedDropPosition

  const handleDragOver = useCallback(
    (position: Point, symbolData: unknown | null) => {
      if (position.x === -Infinity || position.y === -Infinity) {
        options?.clearBranchDrop?.()
        pointerRef.current = null
        setDragPreview(null)
        return
      }
      pointerRef.current = position

      const symbol = symbolData as SymbolMetadata | null
      if (!symbol) {
        setDragPreview(null)
        return
      }
      const branch = options?.resolveBranchDrop?.(position, symbol)
      if (branch?.handled) {
        setDragPreview(branch.intent ? {
          position, symbolData: symbol, dropTarget: branch.intent.target,
          branchIntent: branch.intent,
          ...(branch.intent.sameSymbolTarget ? { sameSymbolAddMore: branch.intent.sameSymbolTarget } : {}),
        } : null)
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
              preferDomoticaEndpointOutput: symbol.id === 'panel_distribution',
              ...(isHorizontalDomoticaPreset(symbol.id, symbol.searchPreset) ? { placingHorizontalDomotica: true } : {}),
              ...(symbol.id === 'dc_bus' ? { preferCircuitTrunkWire: true } : {}),
              ...(symbol.id === 'source_changeover'
                ? { normalizeDirectConverterChangeoverDrop: true }
                : {}),
            }
      )

      // Normalize generic panel-frame hits (type:null with panelId) for protection
      // devices so they behave exactly like drops on the main bus of that panel.
      let dropTarget: DropTarget = normalizeBusFeedSupplyFrameDrop(rawDropTarget, symbol)
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
      if (isSupplyDropTarget(dropTarget)) {
        // Match release eligibility before advertising a supply insertion.
        if (!dropBehaviors[symbol.id]?.validTargets.includes(dropTarget.type) ||
          (dropTarget.type === 'supplyConverterDcWire' && !dropTarget.supplyDcBusId &&
            !canDropSymbolOnSupplyConverterDcWire(symbol.id, false))) {
          setDragPreview(null)
          return
        }
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
      } else if (symbol.id === 'dc_bus' && dropTarget.converterDcConnection) {
        // Circuit inverter inputs are not supply-assembly lanes, and rails are
        // not endpoint symbols. Let command validation decide which input is free.
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
      setDragPreview,
    ]
  )

  return {
    dragPreview: feedback.dragPreview,
    setDragPreview,
    dragPointer: feedback.dragPointer,
    handleDragOver,
  }
}
