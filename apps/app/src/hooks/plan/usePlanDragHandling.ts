import { useRef, useCallback, useState } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { usePlanDragVisualStore } from '@/stores/planDragVisualStore'
import { resetPlanDragVisualFlush, schedulePlanDragVisualFlush } from './planDragVisualFlush'
import {
  suggestRotationForPlacement,
  type WallFacingSide,
} from '@/utils/planAutoOrient'
import { hasExplicitSituationPlanRotation } from '@/lib/plan/situationPlanRotation'
import type { Point } from '@/types/ui'
import type {
  Panel,
  Placement,
  ProtectionDevice,
  SituationPlanRotation,
  TrunkDevice,
  Wall,
} from '@/types/schema'
import { selectProjectElectricalInstallation, selectProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { getPlanPlacementSelectionIds } from '@/lib/plan/planMarqueeSelection'

interface UsePlanDragHandlingResult {
  isDraggingRef: React.MutableRefObject<boolean>
  /**
   * Move the exact placements participating in the active drag before changing floors.
   * An empty map means no drag was active; null means the transfer was rejected.
   */
  moveActiveDragToFloor: (floorId: string) => Map<string, Point> | null
  updateCrossFloorDragPreview: (positions: Map<string, Point>) => void
  finishCrossFloorDrag: () => void
  dragInitialPositionsRef: React.MutableRefObject<Map<string, Point>>
  dragLabelOffsetsRef: React.MutableRefObject<Map<string, { dx: number; dy: number }>>
  labelRecalcKey: number
  setLabelRecalcKey: React.Dispatch<React.SetStateAction<number>>
  initDragLabelOffset: (
    placementId: string,
    pos: Point,
    labelPositions: Map<string, { x: number; y: number }>,
  ) => void
  calculateDragLabelPosition: (placementId: string, pos: Point) => { x: number; y: number }
  createMultiSelectDragHandlers: (labelPositions: Map<string, { x: number; y: number }>, baseSymbolSizePx: number) => {
    onMultiSelectDragStart: (draggedEndpointId: string) => void
    onMultiSelectDrag: (draggedEndpointId: string, newPos: Point) => void
    onMultiSelectDragEnd: () => void
  }
  createSingleDragHandlers: (placement: Placement, labelPositions: Map<string, { x: number; y: number }>, baseSymbolSizePx: number, planImage: HTMLImageElement | null, planImagePosition: { x: number; y: number }, activeFloorId: string | null) => {
    onDragStart: () => void
    onDragMove: (e: DragMoveEvent) => void
    onDragEnd: (finalPos: Point) => void
  }
  /** Factory for drag-by-selection-frame handlers; pass current labelPositions. */
  createSelectionFrameDragHandlers: (labelPositions: Map<string, { x: number; y: number }>) => {
    onSelectionFrameDragStart: () => void
    onSelectionFrameDragMove: (delta: Point) => void
    /** If overrideDeltaInPlanSpace is provided (from pointer movement), it is used for the commit instead of Konva delta. */
    onSelectionFrameDragEnd: (overrideDeltaInPlanSpace?: Point) => void
  }
}

type PlacementRow = Placement & {
  endpointId?: string
  trunkDeviceId?: string
  enclosureId?: string
  junctionPanelLabel?: string
  isEarthing?: boolean
}

type JunctionLabelMatchDevice = Pick<TrunkDevice, 'id' | 'type' | 'label'>

type DragMoveEvent = {
  target: {
    x: () => number
    y: () => number
  }
}

type SingleDragHandlers = {
  onDragStart: () => void
  onDragMove: (e: DragMoveEvent) => void
  onDragEnd: (finalPos: Point) => void
}

type SingleDragHandlersCacheEntry = {
  placement: Placement
  labelPositions: Map<string, { x: number; y: number }>
  baseSymbolSizePx: number
  planImage: HTMLImageElement | null
  planImagePosition: { x: number; y: number }
  activeFloorId: string | null
  handlers: SingleDragHandlers
}

type PlacementOrientContext = {
  image?: HTMLImageElement | null
  imagePosition?: { x: number; y: number }
  walls?: Wall[]
  symbolBaseSizePx?: number
}

/** Prefer live drag-preview rotation; fall back to wall/image heuristics at drop. */
function resolveDragEndRotation(
  placementId: string,
  placementAtDrop: Placement,
  ctx: PlacementOrientContext,
  wallFacingSide: WallFacingSide,
): SituationPlanRotation | null {
  if (hasExplicitSituationPlanRotation(placementAtDrop)) return null
  const previewRotation = usePlanDragVisualStore.getState().rotations.get(placementId)
  if (previewRotation != null) return previewRotation
  return suggestRotationForPlacement(placementAtDrop, ctx, wallFacingSide)
}

/**
 * Hook to handle drag operations for placements on the plan canvas
 */
export function usePlanDragHandling(
  activeFloorId: string | null,
  baseSymbolSizePx: number,
  _labelPositions: Map<string, { x: number; y: number }>,
  planImage: HTMLImageElement | null,
  planImagePosition: { x: number; y: number },
  snapPlacementPosition?: (pos: Point) => Point,
): UsePlanDragHandlingResult {
  const snapPos = useCallback(
    (pos: Point) => (snapPlacementPosition ? snapPlacementPosition(pos) : pos),
    [snapPlacementPosition],
  )
  const getEndpointById = useProjectStore((state: ProjectState) => state.getEndpointById)
  const getPlacementsByFloor = useProjectStore(
    (state: ProjectState) => state.getPlacementsByFloor
  )
  const getFloorById = useProjectStore((state: ProjectState) => state.getFloorById)
  const updatePlacement = useProjectStore((state: ProjectState) => state.updatePlacement)
  const updatePlacementsBatch = useProjectStore(
    (state: ProjectState) => state.updatePlacementsBatch
  )
  const movePlanPlacementsToFloor = useProjectStore(
    (state: ProjectState) => state.movePlanPlacementsToFloor
  )
  const updateJunctionPanelPlacement = useProjectStore(
    (state: ProjectState) => state.updateJunctionPanelPlacement
  )
  const updateEarthingPlacement = useProjectStore(
    (state: ProjectState) => state.updateEarthingPlacement
  )
  const isDraggingRef = useRef(false)
  const crossFloorContinuationRef = useRef(false)
  const activeDragPlacementIdsRef = useRef<Set<string>>(new Set())
  const dragInitialPositionsRef = useRef<Map<string, Point>>(new Map())
  const dragLabelOffsetsRef = useRef<Map<string, { dx: number; dy: number }>>(new Map())
  /** Latest drag positions during multi-drag; ref so drag-end always has last pointer-move values. */
  const dragPositionsCommitRef = useRef<Map<string, Point>>(new Map())
  const singleDragHandlersCacheRef = useRef<Map<string, SingleDragHandlersCacheEntry>>(new Map())
  const [labelRecalcKey, setLabelRecalcKey] = useState(0)

  const seedDragLabels = useCallback((positions: Map<string, { x: number; y: number }>) => {
    usePlanDragVisualStore.getState().patch({
      labels: new Map(positions),
      positions: new Map(),
      rotations: new Map(),
    })
  }, [])

  const clearDragVisuals = useCallback(() => {
    resetPlanDragVisualFlush()
    usePlanDragVisualStore.getState().clear()
  }, [])

  const moveActiveDragToFloor = useCallback(
    (floorId: string): Map<string, Point> | null => {
      if (!isDraggingRef.current) return new Map()
      const placementIds = Array.from(activeDragPlacementIdsRef.current)
      if (placementIds.length === 0) return null

      const previewPositions = usePlanDragVisualStore.getState().positions
      const positions = new Map<string, Point>()
      const moves = placementIds.map((id) => {
        const pos =
          dragPositionsCommitRef.current.get(id) ??
          previewPositions.get(id) ??
          dragInitialPositionsRef.current.get(id)
        if (pos) positions.set(id, pos)
        return {
          id,
          pos,
        }
      })
      if (positions.size !== placementIds.length) return null
      crossFloorContinuationRef.current = true
      if (floorId !== activeFloorId && !movePlanPlacementsToFloor(moves, floorId)) {
        crossFloorContinuationRef.current = false
        return null
      }
      return positions
    },
    [activeFloorId, movePlanPlacementsToFloor],
  )

  const initDragLabelOffset = useCallback(
    (placementId: string, pos: Point, positions: Map<string, { x: number; y: number }>) => {
      const labelPos = positions.get(placementId)
      if (labelPos) {
        dragLabelOffsetsRef.current.set(placementId, { dx: labelPos.x - pos.x, dy: labelPos.y - pos.y })
      }
    },
    [],
  )

  const calculateDragLabelPosition = useCallback((placementId: string, pos: Point) => {
    const offset = dragLabelOffsetsRef.current.get(placementId)
    if (offset) {
      return { x: pos.x + offset.dx, y: pos.y + offset.dy }
    }
    // Fallback: right side (half symbol + gap)
    return { x: pos.x + baseSymbolSizePx / 2 + 8, y: pos.y }
  }, [baseSymbolSizePx])

  const updateCrossFloorDragPreview = useCallback(
    (positions: Map<string, Point>) => {
      dragPositionsCommitRef.current = new Map(positions)
      const labels = new Map<string, { x: number; y: number }>()
      positions.forEach((position, placementId) => {
        labels.set(placementId, calculateDragLabelPosition(placementId, position))
      })
      usePlanDragVisualStore.getState().patch({ positions: new Map(positions), labels })
    },
    [calculateDragLabelPosition],
  )

  const finishCrossFloorDrag = useCallback(() => {
    crossFloorContinuationRef.current = false
    isDraggingRef.current = false
    activeDragPlacementIdsRef.current.clear()
    dragInitialPositionsRef.current.clear()
    dragPositionsCommitRef.current.clear()
    dragLabelOffsetsRef.current.clear()
    clearDragVisuals()
    setLabelRecalcKey((prev) => prev + 1)
  }, [clearDragVisuals])

  const createMultiSelectDragHandlers = useCallback((labelPositions: Map<string, { x: number; y: number }>, baseSymbolSizePx: number) => {
    return {
      onMultiSelectDragStart: (_draggedEndpointId: string) => {
        const { selection } = useUIStore.getState()
        const isPlacementSelection = selection.type === 'placement'
        if (selection.type !== 'endpoint' && !isPlacementSelection) return

        isDraggingRef.current = true
        crossFloorContinuationRef.current = false
        dragInitialPositionsRef.current.clear()
        dragPositionsCommitRef.current.clear()
        activeDragPlacementIdsRef.current.clear()

        if (isPlacementSelection && activeFloorId) {
          const floorPlacements = getPlacementsByFloor(activeFloorId)
          selection.ids.forEach((placementId) => {
            const row = floorPlacements.find((p: PlacementRow) => p.id === placementId)
            if (!row) return
            if (!(row.locked ?? false)) {
              dragInitialPositionsRef.current.set(placementId, { ...row.pos })
              initDragLabelOffset(row.id, row.pos, labelPositions)
            }
          })
        } else {
          selection.ids.forEach((endpointId) => {
            const endpoint = getEndpointById(endpointId)
            if (endpoint) {
              const placementsForEndpoint = endpoint.placements.filter(
                (p: Placement) => p.floorId === activeFloorId,
              )
              placementsForEndpoint.forEach((placementForEndpoint: Placement) => {
                if (placementForEndpoint.locked ?? false) return
                dragInitialPositionsRef.current.set(placementForEndpoint.id, { ...placementForEndpoint.pos })
                initDragLabelOffset(placementForEndpoint.id, placementForEndpoint.pos, labelPositions)
              })
            }
          })
        }
        activeDragPlacementIdsRef.current = new Set(dragInitialPositionsRef.current.keys())
        dragPositionsCommitRef.current = new Map(dragInitialPositionsRef.current)
        seedDragLabels(labelPositions)
      },
      onMultiSelectDrag: (draggedEndpointId: string, newPos: Point) => {
        const { selection } = useUIStore.getState()
        const isPlacementSelection = selection.type === 'placement'
        if (selection.type !== 'endpoint' && !isPlacementSelection) return

        const snappedDragPos = snapPos(newPos)

        let draggedKey: string
        if (isPlacementSelection && activeFloorId) {
          if (selection.ids.includes(draggedEndpointId)) {
            draggedKey = draggedEndpointId
          } else {
            const floorPlacements = getPlacementsByFloor(activeFloorId)
            const row = floorPlacements.find(
              (p: PlacementRow) => p.endpointId === draggedEndpointId && selection.ids.includes(p.id),
            )
            draggedKey = row?.id ?? ''
          }
        } else {
          draggedKey = draggedEndpointId
        }
        const draggedInitialPos = dragInitialPositionsRef.current.get(draggedKey)
        if (!draggedInitialPos) return

        const deltaX = snappedDragPos.x - draggedInitialPos.x
        const deltaY = snappedDragPos.y - draggedInitialPos.y

        const newDragPositions = new Map<string, Point>()
        const newLabelPositions = new Map<string, { x: number; y: number }>()

        if (isPlacementSelection) {
          selection.ids.forEach((placementId) => {
            const initialPos = dragInitialPositionsRef.current.get(placementId)
            if (!initialPos) return
            const floorPlacements = getPlacementsByFloor(activeFloorId ?? '')
            const row = floorPlacements.find((p: PlacementRow) => p.id === placementId)
            if (!row) return
            if (!(row.locked ?? false)) {
              const updatedPos = snapPos({ x: initialPos.x + deltaX, y: initialPos.y + deltaY })
              newDragPositions.set(placementId, updatedPos)
              newLabelPositions.set(placementId, calculateDragLabelPosition(placementId, updatedPos))
            }
          })
        } else {
          selection.ids.forEach((endpointId) => {
            const endpoint = getEndpointById(endpointId)
            if (endpoint) {
              const placementsToUpdate = endpoint.placements.filter(
                (p: Placement) => p.floorId === activeFloorId,
              )
              placementsToUpdate.forEach((placementToUpdate: Placement) => {
                if (placementToUpdate.locked ?? false) return
                const initialPos = dragInitialPositionsRef.current.get(placementToUpdate.id)
                if (initialPos) {
                  const updatedPos = snapPos({ x: initialPos.x + deltaX, y: initialPos.y + deltaY })
                  newDragPositions.set(placementToUpdate.id, updatedPos)
                  newLabelPositions.set(
                    placementToUpdate.id,
                    calculateDragLabelPosition(placementToUpdate.id, updatedPos),
                  )
                }
              })
            }
          })
        }

        dragPositionsCommitRef.current = newDragPositions
        schedulePlanDragVisualFlush({
          positions: newDragPositions,
          labels: newLabelPositions,
        })
      },
      onMultiSelectDragEnd: () => {
        if (crossFloorContinuationRef.current) return
        const toCommit = dragPositionsCommitRef.current
        const floorPlacements = activeFloorId ? getPlacementsByFloor(activeFloorId) : []
        const batch: Array<{ id: string; updates: Partial<Placement> }> = []
        toCommit.forEach((pos, id) => {
          const snappedPos = snapPos(pos)
          const row = floorPlacements.find((p: PlacementRow) => p.id === id)
          const isJunctionPanel = row?.junctionPanelLabel != null
          const isEarthing = row?.isEarthing === true
          if (isJunctionPanel) {
            updateJunctionPanelPlacement(id, { pos: snappedPos })
          } else if (isEarthing) {
            updateEarthingPlacement(id, { pos: snappedPos })
          } else {
            batch.push({ id, updates: { pos: snappedPos } })
          }
        })
        if (batch.length > 0) updatePlacementsBatch(batch)

        if (activeFloorId) {
          const floor = getFloorById(activeFloorId)
          const walls = floor?.floorPlan?.walls ?? []
          const hasWalls = walls.length > 0
          const hasImage = !!planImage
          if (hasWalls || hasImage) {
            const { selection } = useUIStore.getState()
            const placementIdsToOrient =
              selection.type === 'placement'
                ? selection.ids
                : selection.type === 'endpoint'
                  ? selection.ids.flatMap((endpointId) => {
                      const endpoint = getEndpointById(endpointId)
                      return endpoint?.placements
                        .filter((p: Placement) => p.floorId === activeFloorId)
                        .map((p: Placement) => p.id) ?? []
                    })
                  : []

            const ctx = hasImage
              ? { image: planImage, imagePosition: planImagePosition, walls, symbolBaseSizePx: baseSymbolSizePx }
              : { walls, symbolBaseSizePx: baseSymbolSizePx }
            placementIdsToOrient.forEach((placementId) => {
              const floorPlacements = getPlacementsByFloor(activeFloorId)
              const row = floorPlacements.find((p: PlacementRow) => p.id === placementId)
              if (!row) return
              if (row.junctionPanelLabel != null) return
              if (!row.endpointId) return
              const endpoint = getEndpointById(row.endpointId)
              const placement = endpoint?.placements.find((p: Placement) => p.id === placementId)
              if (!placement || !endpoint) return
              const placementCtx = endpoint.type === 'socket'
                ? { ...ctx, socketCount: endpoint.socketProps?.socketCount ?? 1 }
                : ctx

              if (endpoint.type === 'socket') {
                const suggested = resolveDragEndRotation(
                  placement.id,
                  placement,
                  placementCtx,
                  'left',
                )
                if (suggested != null && suggested !== placement.rotationDeg) {
                  updatePlacement(placement.id, { rotationDeg: suggested })
                }
              }
              if (endpoint.symbol === 'panel_distribution') {
                const suggested = resolveDragEndRotation(
                  placement.id,
                  placement,
                  placementCtx,
                  'top',
                )
                if (suggested != null && suggested !== placement.rotationDeg) {
                  updatePlacement(placement.id, { rotationDeg: suggested })
                }
              }
            })
          }
        }
        isDraggingRef.current = false
        activeDragPlacementIdsRef.current.clear()
        dragInitialPositionsRef.current.clear()
        dragPositionsCommitRef.current.clear()
        dragLabelOffsetsRef.current.clear()
        clearDragVisuals()
        setLabelRecalcKey((prev) => prev + 1)
      },
    }
  }, [activeFloorId, clearDragVisuals, getEndpointById, getFloorById, getPlacementsByFloor, initDragLabelOffset, calculateDragLabelPosition, planImage, planImagePosition, seedDragLabels, snapPos, updatePlacement, updatePlacementsBatch, updateJunctionPanelPlacement, updateEarthingPlacement])

  const createSingleDragHandlers = useCallback((placement: Placement, labelPositions: Map<string, { x: number; y: number }>, baseSymbolSizePx: number, planImage: HTMLImageElement | null, planImagePosition: { x: number; y: number }, activeFloorId: string | null) => {
    const cached = singleDragHandlersCacheRef.current.get(placement.id)
    if (
      cached?.placement === placement &&
      cached.labelPositions === labelPositions &&
      cached.baseSymbolSizePx === baseSymbolSizePx &&
      cached.planImage === planImage &&
      cached.planImagePosition === planImagePosition &&
      cached.activeFloorId === activeFloorId
    ) {
      return cached.handlers
    }

    const handlers: SingleDragHandlers = {
      onDragStart: () => {
        isDraggingRef.current = true
        crossFloorContinuationRef.current = false
        activeDragPlacementIdsRef.current = new Set([placement.id])
        dragInitialPositionsRef.current = new Map([[placement.id, { ...placement.pos }]])
        dragPositionsCommitRef.current = new Map([[placement.id, { ...placement.pos }]])
        // Capture current label offset so it stays on the same side during drag
        initDragLabelOffset(placement.id, placement.pos, labelPositions)
        seedDragLabels(labelPositions)
      },
      onDragMove: (e: DragMoveEvent) => {
        const currentPos = snapPos({ x: e.target.x(), y: e.target.y() })
        const labelPatch = new Map<string, { x: number; y: number }>()
        labelPatch.set(placement.id, calculateDragLabelPosition(placement.id, currentPos))
        const rotationPatch = new Map<string, SituationPlanRotation>()
        // Konva owns the dragged node position; only patch label + rotation preview in the drag store.
        if (activeFloorId) {
          const floor = getFloorById(activeFloorId)
          const walls = floor?.floorPlan?.walls ?? []
          const hasWalls = walls.length > 0
          const hasImage = !!planImage
          if (hasWalls || hasImage) {
            const endpointId = (placement as PlacementRow).endpointId
            if (endpointId) {
              const endpoint = getEndpointById(endpointId)
              const ctx = hasImage
                ? { image: planImage, imagePosition: planImagePosition, walls, symbolBaseSizePx: baseSymbolSizePx }
                : { walls, symbolBaseSizePx: baseSymbolSizePx }
              const placementCtx = endpoint?.type === 'socket'
                ? { ...ctx, socketCount: endpoint.socketProps?.socketCount ?? 1 }
                : ctx
              const tmpPlacement = { ...placement, pos: currentPos }
              if (
                endpoint?.type === 'socket' &&
                !hasExplicitSituationPlanRotation(tmpPlacement)
              ) {
                const suggested = suggestRotationForPlacement(tmpPlacement, placementCtx)
                if (suggested != null) {
                  const prev = usePlanDragVisualStore.getState().rotations.get(placement.id)
                  if (prev !== suggested) rotationPatch.set(placement.id, suggested)
                }
              } else if (
                endpoint?.symbol === 'panel_distribution' &&
                !hasExplicitSituationPlanRotation(tmpPlacement)
              ) {
                const suggested = suggestRotationForPlacement(tmpPlacement, placementCtx, 'top')
                if (suggested != null) {
                  const prev = usePlanDragVisualStore.getState().rotations.get(placement.id)
                  if (prev !== suggested) rotationPatch.set(placement.id, suggested)
                }
              }
            }
          }
        }
        const positionPatch = new Map<string, Point>([[placement.id, currentPos]])
        dragPositionsCommitRef.current = positionPatch
        schedulePlanDragVisualFlush({
          positions: positionPatch,
          labels: labelPatch,
          ...(rotationPatch.size > 0 ? { rotations: rotationPatch } : {}),
        })
      },
      onDragEnd: (finalPos: Point) => {
        if (crossFloorContinuationRef.current) return
        // Run orientation first so store is updated before we clear state; one re-render shows both.
        if (activeFloorId) {
          const floor = getFloorById(activeFloorId)
          const walls = floor?.floorPlan?.walls ?? []
          const hasWalls = walls.length > 0
          const hasImage = !!planImage
          if (hasWalls || hasImage) {
            const endpointId = (placement as PlacementRow).endpointId
            if (endpointId) {
              const endpoint = getEndpointById(endpointId)
              const ctx = hasImage
                ? { image: planImage, imagePosition: planImagePosition, walls, symbolBaseSizePx: baseSymbolSizePx }
                : { walls, symbolBaseSizePx: baseSymbolSizePx }
              const placementCtx = endpoint?.type === 'socket'
                ? { ...ctx, socketCount: endpoint.socketProps?.socketCount ?? 1 }
                : ctx
              // Use the drop position (same one used by drag preview) so commit
              // cannot snap back to a rotation computed from stale pre-drag data.
              const placementAtDrop = { ...placement, pos: finalPos }
              if (endpoint?.type === 'socket') {
                const suggested = resolveDragEndRotation(
                  placement.id,
                  placementAtDrop,
                  placementCtx,
                  'left',
                )
                if (suggested != null && suggested !== placement.rotationDeg) {
                  updatePlacement(placement.id, { rotationDeg: suggested })
                }
              }
              if (endpoint?.symbol === 'panel_distribution') {
                const suggested = resolveDragEndRotation(
                  placement.id,
                  placementAtDrop,
                  placementCtx,
                  'top',
                )
                if (suggested != null && suggested !== placement.rotationDeg) {
                  updatePlacement(placement.id, { rotationDeg: suggested })
                }
              }
            }
          }
        }

        isDraggingRef.current = false
        activeDragPlacementIdsRef.current.clear()
        dragInitialPositionsRef.current.clear()
        dragPositionsCommitRef.current.clear()
        dragLabelOffsetsRef.current.clear()
        clearDragVisuals()
        setLabelRecalcKey((prev) => prev + 1)
      },
    }
    singleDragHandlersCacheRef.current.set(placement.id, {
      placement,
      labelPositions,
      baseSymbolSizePx,
      planImage,
      planImagePosition,
      activeFloorId,
      handlers,
    })
    return handlers
  }, [clearDragVisuals, initDragLabelOffset, calculateDragLabelPosition, getEndpointById, getFloorById, seedDragLabels, snapPos, updatePlacement])

  const createSelectionFrameDragHandlers = useCallback((labelPositions: Map<string, { x: number; y: number }>) => {
    return {
      onSelectionFrameDragStart: () => {
        const { selection } = useUIStore.getState()
        if (selection.ids.length === 0 || !activeFloorId) return

        isDraggingRef.current = true
        crossFloorContinuationRef.current = false
        dragInitialPositionsRef.current.clear()
        dragPositionsCommitRef.current.clear()
        activeDragPlacementIdsRef.current.clear()

        const selectionIdSet = new Set(selection.ids)
        const floorPlacements = getPlacementsByFloor(activeFloorId)
        const store = useProjectStore.getState()
        const inst = store.currentProject
          ? selectProjectElectricalInstallation(store.currentProject)
          : undefined

        floorPlacements.forEach((row: PlacementRow) => {
          const placementRow = row

          // Build candidate IDs that should move this placement when selected:
          // - Endpoint-backed symbols: endpointId, placement.id, and for panel_distribution also panel id.
          // - Junction panels: placement.id plus all matching junction_panel trunk device ids by label.
          // - Earthing: placement.id and eendraad ground selection id.
          const candidateIds: string[] = []

          if (placementRow.isEarthing) {
            candidateIds.push(placementRow.id, 'ground')
          } else if (placementRow.junctionPanelLabel != null) {
            const label = placementRow.junctionPanelLabel
            candidateIds.push(placementRow.id)

            if (inst) {
              const labelMatchesJunction = (d: JunctionLabelMatchDevice) =>
                d.type === 'junction_panel' && d.label === label

              inst.mainSupply?.supplyTrunkDevices
                ?.filter(labelMatchesJunction)
                .forEach((d: TrunkDevice) => candidateIds.push(d.id))
              inst.groundTrunkDevices
                ?.filter(labelMatchesJunction)
                .forEach((d: TrunkDevice) => candidateIds.push(d.id))

              ;(store.currentProject ? selectProjectElectricalPanels(store.currentProject) : []).forEach((panel: Panel) => {
                const circuits = [
                  ...(panel.circuits ?? []),
                  ...(panel.protections?.flatMap((pr: ProtectionDevice) => pr.circuits ?? []) ?? []),
                ]
                circuits.forEach((c) =>
                  c.trunkDevices
                    ?.filter(labelMatchesJunction)
                    .forEach((d: TrunkDevice) => candidateIds.push(d.id)),
                )
              })
            }
          } else if (placementRow.enclosureId) {
            candidateIds.push(placementRow.id, placementRow.enclosureId)
          } else if (placementRow.endpointId || placementRow.trunkDeviceId) {
            candidateIds.push(...getPlanPlacementSelectionIds(placementRow))

            const endpoint = placementRow.endpointId
              ? getEndpointById(placementRow.endpointId)
              : undefined

            if (endpoint?.symbol === 'panel_distribution') {
              const panel = store.getPanelByName(endpoint.label)
              if (panel) {
                candidateIds.push(panel.id)
              }
            }
          }

          if (!candidateIds.some((id) => selectionIdSet.has(id))) return

          const placement = placementRow as Placement
          if (placement.locked) return

          dragInitialPositionsRef.current.set(placement.id, { ...placement.pos })
          initDragLabelOffset(placement.id, placement.pos, labelPositions)
        })

        activeDragPlacementIdsRef.current = new Set(dragInitialPositionsRef.current.keys())
        dragPositionsCommitRef.current = new Map(dragInitialPositionsRef.current)
        seedDragLabels(labelPositions)
      },
      onSelectionFrameDragMove: (delta: Point) => {
        const newDragPositions = new Map<string, Point>()
        const newLabelPositions = new Map<string, { x: number; y: number }>()
        dragInitialPositionsRef.current.forEach((initialPos, placementId) => {
          const updatedPos = { x: initialPos.x + delta.x, y: initialPos.y + delta.y }
          newDragPositions.set(placementId, updatedPos)
          newLabelPositions.set(placementId, calculateDragLabelPosition(placementId, updatedPos))
        })
        dragPositionsCommitRef.current = newDragPositions
        schedulePlanDragVisualFlush({
          positions: newDragPositions,
          labels: newLabelPositions,
        })
      },
      onSelectionFrameDragEnd: (overrideDeltaInPlanSpace?: Point) => {
        if (crossFloorContinuationRef.current) return
        const initialPositions = dragInitialPositionsRef.current
        const floorPlacements = activeFloorId ? getPlacementsByFloor(activeFloorId) : []
        // Use pointer-based delta when provided (correct plan space); otherwise fall back to Konva delta
        const toCommit = new Map<string, Point>()
        if (overrideDeltaInPlanSpace != null) {
          initialPositions.forEach((initialPos, placementId) => {
            toCommit.set(placementId, {
              x: initialPos.x + overrideDeltaInPlanSpace.x,
              y: initialPos.y + overrideDeltaInPlanSpace.y,
            })
          })
        } else {
          dragPositionsCommitRef.current.forEach((pos, id) => toCommit.set(id, pos))
        }
        const batch: Array<{ id: string; updates: Partial<Placement> }> = []
        toCommit.forEach((pos, id) => {
          const snappedPos = snapPos(pos)
          const row = floorPlacements.find((p: PlacementRow) => p.id === id)
          const isJunctionPanel = row?.junctionPanelLabel != null
          const isEarthing = row?.isEarthing === true
          if (isJunctionPanel) {
            updateJunctionPanelPlacement(id, { pos: snappedPos })
          } else if (isEarthing) {
            updateEarthingPlacement(id, { pos: snappedPos })
          } else {
            batch.push({ id, updates: { pos: snappedPos } })
          }
        })
        if (batch.length > 0) updatePlacementsBatch(batch)
        if (activeFloorId) {
          const floor = getFloorById(activeFloorId)
          const walls = floor?.floorPlan?.walls ?? []
          const hasWalls = walls.length > 0
          const hasImage = !!planImage
          if (hasWalls || hasImage) {
            const { selection } = useUIStore.getState()
            const placementIdsToOrient =
              selection.type === 'placement'
                ? selection.ids
                : selection.type === 'endpoint'
                  ? selection.ids
                      .map((endpointId) => {
                        const endpoint = getEndpointById(endpointId)
                        const p = endpoint?.placements.find(
                          (p: Placement) => p.floorId === activeFloorId,
                        )
                        return p?.id
                      })
                      .filter((id): id is string => id != null)
                  : []
            const ctx = hasImage
              ? { image: planImage, imagePosition: planImagePosition, walls, symbolBaseSizePx: baseSymbolSizePx }
              : { walls, symbolBaseSizePx: baseSymbolSizePx }
            placementIdsToOrient.forEach((placementId) => {
              const floorPlacements = getPlacementsByFloor(activeFloorId)
              const row = floorPlacements.find((p: PlacementRow) => p.id === placementId)
              if (!row) return
              if (row.junctionPanelLabel != null) return
              if (!row.endpointId) return
              const endpoint = getEndpointById(row.endpointId)
              const placement = endpoint?.placements.find((p: Placement) => p.id === placementId)
              if (!placement || !endpoint) return
              const placementCtx = endpoint.type === 'socket'
                ? { ...ctx, socketCount: endpoint.socketProps?.socketCount ?? 1 }
                : ctx
              if (endpoint.type === 'socket') {
                const suggested = resolveDragEndRotation(
                  placement.id,
                  placement,
                  placementCtx,
                  'left',
                )
                if (suggested != null && suggested !== placement.rotationDeg) {
                  updatePlacement(placement.id, { rotationDeg: suggested })
                }
              }
              if (endpoint.symbol === 'panel_distribution') {
                const suggested = resolveDragEndRotation(
                  placement.id,
                  placement,
                  placementCtx,
                  'top',
                )
                if (suggested != null && suggested !== placement.rotationDeg) {
                  updatePlacement(placement.id, { rotationDeg: suggested })
                }
              }
            })
          }
        }
        isDraggingRef.current = false
        activeDragPlacementIdsRef.current.clear()
        dragInitialPositionsRef.current.clear()
        dragPositionsCommitRef.current.clear()
        dragLabelOffsetsRef.current.clear()
        clearDragVisuals()
        setLabelRecalcKey((prev) => prev + 1)
      },
    }
  }, [activeFloorId, baseSymbolSizePx, clearDragVisuals, getEndpointById, getFloorById, getPlacementsByFloor, initDragLabelOffset, calculateDragLabelPosition, planImage, planImagePosition, seedDragLabels, snapPos, updatePlacement, updatePlacementsBatch, updateJunctionPanelPlacement, updateEarthingPlacement])

  return {
    isDraggingRef,
    moveActiveDragToFloor,
    updateCrossFloorDragPreview,
    finishCrossFloorDrag,
    dragInitialPositionsRef,
    dragLabelOffsetsRef,
    labelRecalcKey,
    setLabelRecalcKey,
    initDragLabelOffset,
    calculateDragLabelPosition,
    createMultiSelectDragHandlers,
    createSingleDragHandlers,
    createSelectionFrameDragHandlers,
  }
}
