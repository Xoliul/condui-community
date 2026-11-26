import type { useCanvasWindow } from '@/components/viewport/ViewportContext'
import type { useViewportUIApi } from '@/components/viewport/ViewportUIStore'
import { resolveSupplyDropMounting } from '@/lib/layout/resolveSupplyDropMounting'
import { createUiDropBehaviorHooks } from '@/handlers/eendraad/uiDropBehaviorHooks'

import {
  useCallback,
  useLayoutEffect,
  useMemo,
} from 'react'


import type Konva from 'konva'
import type { useTranslation } from 'react-i18next'

import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'

import type { Point, Selection } from '@/types/ui'

import type { resolveBranchDropIntent } from '@/lib/layout/branchDropInteraction'
import type { validateEendraadPreview } from '@/hooks/eendraad/validateEendraadPreview'

import type {
  useEendraadLayout,
  useEendraadWireSegments,
  useEendraadDragPreview,
  useLayoutTree,
} from '@/hooks/eendraad'

import { pickRepresentativeCircuitIdForMainBusMove } from '@/lib/eendraad/mainBusOrder'
import { getEendraadPreviewIntentKey } from '@/hooks/eendraad/useEendraadPreviewGraph'

import type { LayoutTree } from '@/lib/layout/layoutTree'

import type { DropZoneHintRelocation } from '@/lib/layout/collectDropZoneHints'
import {
  findDomoticaOutputDropTarget,
  findDropTarget,
  findDropTargetWithDebug,
  type DropTarget,
} from '@/lib/layout/findDropTarget'
import { circuitTrunkBranchSlotDropTarget, findCircuitTrunkBranchSlot } from '@/lib/layout/circuitTrunkBranchSlots'
import { getBranchDragGroupEndpointIds } from '@/lib/eendraad/downstreamSelection'

import { protectionTypeToSymbolKey } from '@/lib/protectionKind'

import { getSymbolById, type SymbolMetadata } from '@/lib/symbols'

import {
  logTrunkDnD,
  trunkDnDCommitLogEnabled,
  logTrunkDnDCommit,
  serializeTrunkDevices,
  summarizeDropTarget,
  summarizeHitDebugPath,
  trunkDnDVerboseLogEnabled,
} from '@/lib/eendraad/trunkDeviceDnDLog'

import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import {
  isPanelAttachmentDropTargetTerminal,
} from '@/lib/eendraad/panelAttachmentMove'
import { resolveProtectionDropTargetForPosition, runEendraadEndpointAltDragDuplicate } from '@/lib/eendraad/eendraadAltDragDuplicate'
import { commitEndpointMove as moveEndpointSelection } from '@/handlers/eendraad/moveEndpointSelection'
import { duplicateProtection } from '@/handlers/eendraad/duplicateProtection'
import { moveSupplyTrunkDevice } from '@/handlers/eendraad/moveSupplyTrunkDevice'
import { moveCircuitTrunkDevice } from '@/handlers/eendraad/moveCircuitTrunkDevice'
import { moveCircuitTrunkDevices } from '@/handlers/eendraad/moveCircuitTrunkDevices'
import { runEendraadBusMove } from '@/handlers/eendraad/moveBusItems'
import { findDirectTrunkFeederOwnerOfMeter } from '@/lib/eendraad/directTrunkFeeder'
import { classifyEendraadMoveSelection, resolveEendraadMultiMoveKind } from '@/lib/eendraad/multiSelectionMove'
import { isSupplyTrunkDeviceDropTarget } from '@/lib/eendraad/supplyTrunkDeviceMove'

import { getPanelDiagramId } from '@/lib/layout/bottomUpLayout'

import { getMainBusItemsWithIndices } from '@/lib/eendraad/mainBusOrder'

import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from 'react'

type ViewportUIState = ReturnType<ReturnType<typeof useViewportUIApi>['getState']>
type InternalDragPlacement = (DropZoneHintRelocation & { symbol: SymbolMetadata }) | null
interface EendraadElementDragOptions extends Pick<ProjectState,
  'getEndpointById' | 'getFloorById' | 'getPanelById' | 'getProtectionById' | 'getTrunkDeviceById'> {
  altDuplicatePointerCleanupRef: RefObject<(() => void) | null>
  augmentCircuitVerticalWireDomain: (rawTarget: DropTarget, position: Point) => DropTarget
  canDragItems: boolean
  currentProject: ProjectState['currentProject']
  dragPreview: ReturnType<typeof validateEendraadPreview>
  draggingProtectionIdRef: RefObject<string | null>
  elementDragModeRef: RefObject<'move' | 'duplicate'>
  endAltDuplicatePointerDrag: () => void
  endpointDragStartSelectionIdsRef: RefObject<string[] | null>
  handleDragOver: ReturnType<typeof useEendraadDragPreview>['handleDragOver']
  handleElementDragEndRef: RefObject<(id: string, type: string, position: Point) => boolean | void>
  handleElementDragMoveRef: RefObject<(id: string, type: string, position: Point) => void>
  handleElementDragStartRef: RefObject<(id: string, type: string, altKey: boolean, event?: MouseEvent) => boolean>
  internalDragElementIdRef: RefObject<string | null>
  layout: ReturnType<typeof useEendraadLayout>
  layoutTree: ReturnType<typeof useLayoutTree>
  movingPanelAttachmentIdRef: RefObject<string | null>
  pointerClientToCanvasPoint: (clientX: number, clientY: number) => Point | null
  resolveBranchDrop: (position: Point, symbol: SymbolMetadata, movingIds?: string[]) => ReturnType<typeof resolveBranchDropIntent>
  resolveTrunkRelocateDropTarget: (position: Point) => DropTarget | null
  setAltDuplicatePointerDragActive: Dispatch<SetStateAction<boolean>>
  setDragPreview: ReturnType<typeof useEendraadDragPreview>['setDragPreview']
  setDragRenderElementId: Dispatch<SetStateAction<string | null>>
  setDragRenderMode: Dispatch<SetStateAction<'move' | 'duplicate'>>
  setDragRenderSelectionIds: Dispatch<SetStateAction<string[] | null>>
  setInternalDragPlacement: Dispatch<SetStateAction<InternalDragPlacement>>
  setSelection: ViewportUIState['setSelection']
  suppressKonvaDragEndRef: RefObject<boolean>
  t: ReturnType<typeof useTranslation>['t']
  trunkBranchSlotMarkerRef: RefObject<Konva.Circle | null>
  trunkDnDLoggedStartRef: RefObject<boolean>
  viewportUI: ReturnType<typeof useViewportUIApi>
  window: ReturnType<typeof useCanvasWindow>
  wireSegments: ReturnType<typeof useEendraadWireSegments>
}

type EendraadLongPressDuplicateDrag = {
  elementTypes: Selection['type'][]
  onStart: (params: {
    elementId: string
    elementType: Selection['type']
    clientX: number
    clientY: number
  }) => void
}


function findProtectionDragTarget(tree: LayoutTree, position: Point): { target: DropTarget } {
  return {
    target: findDropTarget(tree, position, {
      preferMainBusOverGroundWire: true,
      preferMainBusOverSupplyWire: false,
      preferSecondaryBusForNestedProtection: true,
    }),
  }
}

const PROTECTION_SYMBOL_BY_TYPE: Record<string, string> = {
  MCB: 'mcb', RCD: 'rcd', RCBO: 'rcbo', FUSE: 'fuse', MAIN_SWITCH: 'main_switch', SPD: 'spd',
}

/** A directly wired kWh meter drags as its whole circuit (meter and all after it) through its hidden owner. */
function meterOwnerDrag(id: string, type: string, duplicate: boolean): [string, string] {
  const project = type === 'trunkDevice' && !duplicate ? useProjectStore.getState().currentProject : null
  const owner = project ? findDirectTrunkFeederOwnerOfMeter(getProjectElectricalPanels(project), id) : null
  return owner ? [owner, 'protection'] : [id, type]
}

export function useEendraadElementDrag({
  altDuplicatePointerCleanupRef,
  augmentCircuitVerticalWireDomain,
  canDragItems,
  currentProject,
  dragPreview,
  draggingProtectionIdRef,
  elementDragModeRef,
  endAltDuplicatePointerDrag,
  endpointDragStartSelectionIdsRef,
  getEndpointById,
  getFloorById,
  getPanelById,
  getProtectionById,
  getTrunkDeviceById,
  handleDragOver,
  handleElementDragEndRef,
  handleElementDragMoveRef,
  handleElementDragStartRef,
  internalDragElementIdRef,
  layout,
  layoutTree,
  movingPanelAttachmentIdRef,
  pointerClientToCanvasPoint,
  resolveBranchDrop,
  resolveTrunkRelocateDropTarget,
  setAltDuplicatePointerDragActive,
  setDragPreview,
  setDragRenderElementId,
  setDragRenderMode,
  setDragRenderSelectionIds,
  setInternalDragPlacement,
  setSelection,
  suppressKonvaDragEndRef,
  t,
  trunkBranchSlotMarkerRef,
  trunkDnDLoggedStartRef,
  viewportUI,
  window,
  wireSegments,
}: EendraadElementDragOptions) {
  // Internal 1‑draad drag pipeline for existing symbols
  // Live drag: feed internal drags into the existing preview system so we get
  // the same ghost wires/rectangles as when adding a new symbol from the library.
  const handleElementDragMove = useCallback(
    (elementId: string, elementType: string, newPos: Point) => {
      if (elementType === 'panelAttachment') {
        movingPanelAttachmentIdRef.current = elementId
        const symbolMeta = getSymbolById('panel_distribution')
        if (!symbolMeta) return
        handleDragOver(newPos, symbolMeta)
        return
      }

      if (elementType === 'endpoint') {
        const endpoint = getEndpointById(elementId)
        if (!endpoint || !endpoint.symbol) return
        const symbolMeta = getSymbolById(endpoint.symbol)
        if (!symbolMeta) return
        handleDragOver(newPos, symbolMeta)
        const store = useProjectStore.getState()
        const selectionIds = endpointDragStartSelectionIdsRef.current
        const sourceCircuitId = store.findCircuitForEndpoint(elementId)?.circuit.id
        const selectedEndpointIds = (selectionIds ?? viewportUI.getState().selection.ids).filter(
          (id) => !!store.getEndpointById(id)
        )
        const isGroupMove =
          selectedEndpointIds.length > 1 && selectedEndpointIds.includes(elementId)
        const movingEndpointIds = isGroupMove ? selectedEndpointIds : [elementId]
        if (resolveBranchDrop(newPos, symbolMeta).handled) {
          if (sourceCircuitId) setDragPreview((preview) => preview ? {
            ...preview, movingEndpointSelection: {
              draggedEndpointId: elementId, sourceCircuitId, endpointIds: movingEndpointIds,
            },
          } : null)
          return
        }
        // Domotica groups keep their dedicated slot handling.
        const canUseTrunkSlot =
          !!sourceCircuitId && endpoint.symbol !== 'domotica' && !endpoint.domoticaChildProps
        const trunkBranchSlot =
          canUseTrunkSlot && layoutTree
            ? (findCircuitTrunkBranchSlot(layoutTree, newPos, {
                includeBranchRows: isGroupMove,
              }) ?? undefined)
            : undefined
        if (sourceCircuitId) {
          const movingEndpointSelection = {
            draggedEndpointId: elementId,
            sourceCircuitId,
            endpointIds: movingEndpointIds,
          }
          trunkBranchSlotMarkerRef.current?.y(newPos.y)
          trunkBranchSlotMarkerRef.current?.getLayer()?.batchDraw()
          setDragPreview((preview) => {
            if (!trunkBranchSlot) {
              return preview ? { ...preview, movingEndpointSelection,
                ...(preview.sameSymbolAddMore && layoutTree ? {
                  dropTarget: findDropTarget(layoutTree, newPos, { preferMainBusOverGroundWire: true }),
                } : {}),
              } : preview
            }
            return {
              position: newPos,
              symbolData: preview?.symbolData ?? symbolMeta,
              dropTarget: circuitTrunkBranchSlotDropTarget(trunkBranchSlot),
              movingEndpointSelection,
              trunkBranchSlot,
            }
          })
        }
        return
      }

      if (elementType === 'protection') {
        const protection = getProtectionById(elementId)
        if (!protection) return
        draggingProtectionIdRef.current = elementId

        const typeMap: Record<string, string> = {
          MCB: 'mcb',
          RCD: 'rcd',
          RCBO: 'rcbo',
          FUSE: 'fuse',
          MAIN_SWITCH: 'main_switch',
          SPD: 'spd',
        }
        const symbolId = protection.directTrunkFeeder ? 'energy_meter' : typeMap[protection.type]
        if (!symbolId) return
        const symbolMeta = getSymbolById(symbolId)
        if (!symbolMeta) return

        // A supply tap slides along the grid wire's tap zones like a new one; the drop moves it.
        if (protection.supplyTap) {
          const tapIntent = resolveBranchDrop(newPos, symbolMeta).intent
          if (tapIntent?.lockPoint) {
            setDragPreview({ position: newPos, symbolData: symbolMeta, dropTarget: tapIntent.target, branchIntent: tapIntent })
            return
          }
        }

        const sourcePanel = useProjectStore.getState().getPanelForProtection(elementId)
        const circuitId = sourcePanel
          ? pickRepresentativeCircuitIdForMainBusMove(sourcePanel, protection)
          : protection.circuits?.[0]?.id
        if (circuitId) {
          const resolvedTarget = layoutTree
            ? resolveProtectionDropTargetForPosition(
                layoutTree,
                newPos,
                findProtectionDragTarget,
                (panelId) => getPanelById(panelId),
                elementId,
                (id) => getProtectionById(id),
                { nestOnRcd: true }
              )
            : null
          if (layoutTree && !resolvedTarget) {
            setDragPreview(null)
            return
          }
          if (!resolvedTarget) return

          const nextPreview = {
            position: newPos,
            symbolData: symbolMeta,
            dropTarget: resolvedTarget,
            movingProtection: { protectionId: elementId, circuitId },
          }
          setDragPreview((preview) =>
            getEendraadPreviewIntentKey(preview) === getEendraadPreviewIntentKey(nextPreview)
              ? { ...preview!, position: newPos, dropTarget: resolvedTarget }
              : nextPreview
          )
        }
        return
      }

      if (elementType === 'trunkDevice') {
        const info = getTrunkDeviceById(elementId)
        if (!info || info.isGroundDevice) return
        const meta = getSymbolById(info.device.symbol)
        if (!meta) return
        if (info.isSupplyDevice) {
          if (!layoutTree) return
          const { target } = findDropTargetWithDebug(layoutTree, newPos)
          if (!isSupplyTrunkDeviceDropTarget(info.device, target)) {
            setDragPreview(null)
            return
          }
          const targetPanelLayout = layout?.panels.find(
            (candidate) =>
              getPanelDiagramId(candidate) === target.diagramId ||
              (!target.diagramId && candidate.panel.id === target.panelId)
          )
          const targetMounting =
            currentProject && targetPanelLayout
              ? resolveSupplyDropMounting(
                  currentProject,
                  targetPanelLayout,
                  target,
                  newPos,
                  wireSegments
                )
              : undefined
          setDragPreview({
            position: newPos,
            symbolData: meta,
            dropTarget: target,
            relocatingSupplyTrunkDevice: { id: elementId, targetMounting },
          })
          return
        }
        if (!info.circuit) return
        if (trunkDnDVerboseLogEnabled() && !trunkDnDLoggedStartRef.current) {
          trunkDnDLoggedStartRef.current = true
          const st = useProjectStore.getState()
          const srcCircuit = st.getCircuitById(info.circuit.id)
          logTrunkDnD('canvas:drag-start', {
            deviceId: elementId,
            deviceSymbol: info.device.symbol,
            deviceType: info.device.type,
            sourceCircuitId: info.circuit.id,
            sourceCircuitCode: info.circuit.code,
            sourceTrunkOrderBottomToTop: serializeTrunkDevices(srcCircuit?.trunkDevices),
            pointerCanvas: newPos,
          })
        }
        const dropTarget = resolveTrunkRelocateDropTarget(newPos)
        if (!dropTarget) { setDragPreview(null); return }
        setDragPreview({
          position: newPos,
          symbolData: meta,
          dropTarget,
          relocatingTrunkDevice: { id: elementId, sourceCircuitId: info.circuit.id },
        })
      }
    },
    [
      getEndpointById,
      getPanelById,
      getProtectionById,
      getTrunkDeviceById,
      handleDragOver,
      resolveBranchDrop,
      currentProject,
      layout,
      layoutTree,
      resolveTrunkRelocateDropTarget,
      setDragPreview,
      wireSegments,
      viewportUI,
      movingPanelAttachmentIdRef,
      endpointDragStartSelectionIdsRef,
      trunkBranchSlotMarkerRef,
      draggingProtectionIdRef,
      trunkDnDLoggedStartRef,
    ]
  )

  /** A supply tap dropped on a tap zone moves there; null when the drop is not a tap move. */
  const moveSupplyTapOnDrop = useCallback((protectionId: string, position: Point): boolean | null => {
    const protection = getProtectionById(protectionId)
    const symbolId = protection?.supplyTap ? PROTECTION_SYMBOL_BY_TYPE[protection.type] : undefined
    const symbol = symbolId ? getSymbolById(symbolId) : undefined
    if (!symbol) return null
    const target = resolveBranchDrop(position, symbol).intent
    if (!target?.lockPoint || !target.target.panelId || !target.target.supplyTapAnchor) return null
    return runProjectCommand('supply.moveTap', {
      ownerPanelId: target.target.panelId,
      itemId: protectionId,
      anchor: target.target.supplyTapAnchor,
    }) !== null
  }, [getProtectionById, resolveBranchDrop])

  // Drag end: treat as "add new at drop target, then delete original". Return
  // a boolean so the symbol can snap back when the drop was invalid.
  const handleElementDragEnd = useCallback(
    (elementId: string, elementType: string, position: Point) => {
      movingPanelAttachmentIdRef.current = null
      internalDragElementIdRef.current = null
      setDragRenderElementId(null)
      setInternalDragPlacement(null)
      const isDuplicateDrag = elementDragModeRef.current === 'duplicate'
      // Clear any preview once the drop is committed (pointer-drag path clears in endAltDuplicatePointerDrag)
      if (!altDuplicatePointerCleanupRef.current) {
        setDragPreview(null)
        trunkDnDLoggedStartRef.current = false
        elementDragModeRef.current = 'move'
        setDragRenderMode('move')
      }

      const dragSelectionIds = (() => {
        const currentIds = viewportUI.getState().selection.ids
        const capturedIds = endpointDragStartSelectionIdsRef.current
        if (capturedIds?.includes(elementId)) return capturedIds
        return currentIds.includes(elementId) ? currentIds : [elementId]
      })()

      if (!isDuplicateDrag && elementType === 'endpoint') {
        const endpoint = useProjectStore.getState().getEndpointById(elementId)
        const symbol = endpoint?.symbol ? getSymbolById(endpoint.symbol) : null
        if (symbol) {
          const branchDrop = resolveBranchDrop(position, symbol, dragSelectionIds)
          if (branchDrop.handled) return !!branchDrop.intent && moveEndpointSelection({
            draggedEndpointId: elementId, selectedEndpointIds: dragSelectionIds,
            target: branchDrop.intent.target,
          })
        }
      }

      // A rectangle selection can contain mixed domain types while Selection.type is
      // only its compatibility/majority type. Resolve one accepted family from the
      // physical drop target before entering any single-symbol behavior.
      if (!isDuplicateDrag && dragSelectionIds.length > 1 && currentProject && layoutTree) {
        const store = useProjectStore.getState()
        const classified = classifyEendraadMoveSelection(dragSelectionIds, {
          isProtection: (id) => !!store.getProtectionById(id),
          isEndpoint: (id) => !!store.getEndpointById(id),
          isTrunkDevice: (id) => !!getTrunkDeviceById(id),
        })
        const { target: rawMultiTarget } = findDropTargetWithDebug(layoutTree, position, {
          preferMainBusOverGroundWire: true,
          preferMainBusOverSupplyWire: true,
          preferSecondaryBusForNestedProtection: classified.protectionIds.length > 0,
          ignoreCircuitTrunkDeviceSymbolHits: elementType === 'trunkDevice',
        })
        // Whole-branch moves resolve the gap between branches along the circuit trunk.
        const trunkBranchSlot =
          classified.endpointIds.length === dragSelectionIds.length
            ? findCircuitTrunkBranchSlot(layoutTree, position)
            : null
        const multiKind = trunkBranchSlot
          ? 'endpoint'
          : resolveEendraadMultiMoveKind(classified, rawMultiTarget)

        if (multiKind === 'endpoint') {
          const hasDomoticaChild = classified.endpointIds.some(
            (id) => store.getEndpointById(id)?.domoticaChildProps
          )
          const endpointTarget = hasDomoticaChild
            ? findDomoticaOutputDropTarget(layoutTree, position) ?? rawMultiTarget
            : trunkBranchSlot
              ? circuitTrunkBranchSlotDropTarget(trunkBranchSlot)
              : augmentCircuitVerticalWireDomain(rawMultiTarget, position)
          return moveEndpointSelection({
            draggedEndpointId: classified.endpointIds.includes(elementId)
              ? elementId
              : classified.endpointIds[0]!,
            selectedEndpointIds: classified.endpointIds,
            target: endpointTarget,
          })
        }

        if (multiKind === 'protection') {
          const target = resolveProtectionDropTargetForPosition(
            layoutTree, position, findProtectionDragTarget,
            (panelId) => store.getPanelById(panelId), undefined, undefined, { nestOnRcd: true }
          )
          if (!target) return false
          return runEendraadBusMove({
            kind: 'protectionSelectionDrop', protectionIds: classified.protectionIds, target,
          })
        }

        if (multiKind === 'trunkDevice') {
          const target = resolveTrunkRelocateDropTarget(position)
          if (!target?.circuitId) return false
          const movable = classified.trunkDeviceIds.flatMap((id) => {
            const info = getTrunkDeviceById(id)
            return info?.circuit && !info.isGroundDevice && !info.isSupplyDevice
              ? [{ id, sourceCircuitId: info.circuit.id, symbol: info.device.symbol }]
              : []
          })
          if (movable.length !== classified.trunkDeviceIds.length) return false
          if (!moveCircuitTrunkDevices(movable, target)) return false
          setSelection({ type: 'trunkDevice', ids: movable.map((item) => item.id) })
          return true
        }

        // The target accepts none of the selected families. Do not fall through and
        // accidentally move only the symbol under the pointer.
        return false
      }

      if (elementType === 'panelAttachment') {
        if (!currentProject || !layoutTree) return false
        // Resolve from the release position first. The last drag-preview state
        // may lag one pointer event or may have selected an overlapping supply
        // hit zone, which made a visibly valid main-bus drop snap back.
        const releaseTarget = findDropTargetWithDebug(layoutTree, position, {
          preferMainBusOverGroundWire: true,
          preferMainBusOverSupplyWire: true,
        }).target
        const target =
          releaseTarget.type === 'mainBus' ||
          releaseTarget.type === 'circuit' ||
          releaseTarget.type === 'rcd' ||
          releaseTarget.type === 'endpoint'
            ? releaseTarget
            : (dragPreview?.dropTarget ?? releaseTarget)
        const canMoveToEndpoint =
          target.type === 'endpoint' &&
          !!target.endpointId &&
          !!target.circuitId
        const canMoveToCircuitTop =
          target.type === 'circuit' &&
          !!target.circuitId &&
          target.insertAfterCircuitContent === true &&
          typeof target.secondaryBusInsertIndex !== 'number'
        const canMoveToSecondary =
          target.type === 'circuit' &&
          !!target.circuitId &&
          typeof target.secondaryBusInsertIndex === 'number'
        const canMoveToMain =
          target.type === 'mainBus' &&
          !!target.panelId &&
          typeof target.mainBusInsertIndex === 'number'
        const canMoveToRcd =
          target.type === 'rcd' &&
          !!target.protectionId &&
          typeof target.secondaryBusInsertIndex === 'number'
        if (
          !canMoveToSecondary &&
          !canMoveToMain &&
          !canMoveToRcd &&
          !canMoveToEndpoint &&
          !canMoveToCircuitTop
        ) {
          return false
        }
        if (
          !isPanelAttachmentDropTargetTerminal(
            getProjectElectricalPanels(currentProject),
            elementId,
            target
          )
        ) {
          return false
        }

        if (canMoveToEndpoint || canMoveToCircuitTop) {
          const outcome = runProjectCommand('panel.moveSupply', {
            panelId: elementId,
            target: { type: 'circuit', circuitId: target.circuitId! },
          })
          if (outcome?.changed) setSelection({ type: 'panel', ids: [elementId] })
          return !!outcome?.changed
        }

        const outcome = runProjectCommand(
          'panel.moveAttachmentOnBus',
          {
            panelId: elementId,
            target: canMoveToSecondary
              ? {
                  type: 'secondaryBus',
                  parentCircuitId: target.circuitId!,
                  insertIndex: target.secondaryBusInsertIndex!,
                }
              : canMoveToRcd
                ? {
                    type: 'rcdBus',
                    protectionId: target.protectionId!,
                    insertIndex: target.secondaryBusInsertIndex!,
                  }
                : {
                    type: 'mainBus',
                    sourcePanelId: target.panelId!,
                    insertIndex: target.mainBusInsertIndex!,
                  },
          },
          { label: 'Move distribution board on bus' }
        )
        if (outcome?.changed) setSelection({ type: 'panel', ids: [elementId] })
        return !!outcome?.changed
      }

      if (elementType === 'endpoint') {
        if (isDuplicateDrag) {
          if (!currentProject || !layoutTree) return false
          return (
              runEendraadEndpointAltDragDuplicate(elementId, position, {
                dropHooks: createUiDropBehaviorHooks(window.document),
                project: currentProject,
                layoutTree,
                wireSegments,
                findDropTarget: (tree, pos) =>
                  findDropTargetWithDebug(tree, pos, { preferMainBusOverGroundWire: true }),
                t,
                setSelection,
                getFloorById: (floorId) => {
                  const floor = getFloorById(floorId)
                  return floor
                    ? {
                        id: floor.id,
                        layers: floor.layers,
                        hiddenSitplanPlacementIds: floor.hiddenSitplanPlacementIds,
                      }
                    : null
                },
                getProtectionById: (protectionId) => getProtectionById(protectionId) || null,
                incrementEndpointMultiplier: (endpointId) => {
                  const result = runProjectCommand('electrical.duplicateElements', {
                    items: [{ kind: 'endpoint', id: endpointId }],
                    purpose: 'altDrag',
                    target: { type: 'sourceSelection' },
                    sitplan: createUiDropBehaviorHooks(window.document).getSitplanTarget(),
                  }, { label: 'Add endpoint instance' })
                  if (!result?.changed) return false
                  setSelection({ type: 'endpoint', ids: [endpointId] })
                  return true
                },
              })
          )
        }

        if (!currentProject || !layoutTree) return false
        const store = useProjectStore.getState()
        const endpoint = store.getEndpointById(elementId)
        if (!endpoint) return false
        const trunkBranchSlot =
          endpoint.symbol !== 'domotica' && !endpoint.domoticaChildProps
            ? findCircuitTrunkBranchSlot(layoutTree, position, { includeBranchRows: false })
            : null
        let target = trunkBranchSlot
          ? circuitTrunkBranchSlotDropTarget(trunkBranchSlot)
          : augmentCircuitVerticalWireDomain(
              findDropTargetWithDebug(layoutTree, position, {
                preferMainBusOverGroundWire: true,
              }).target,
              position
            )
        if (endpoint.domoticaChildProps && !target.domoticaOutput) {
          const targetEndpoint = target.endpointId ? store.getEndpointById(target.endpointId) : null
          if (!targetEndpoint?.domoticaChildProps) {
            target = findDomoticaOutputDropTarget(layoutTree, position) ?? target
          }
        }
        return moveEndpointSelection({
          draggedEndpointId: elementId,
          selectedEndpointIds: dragSelectionIds.filter((id) => !!store.getEndpointById(id)),
          target,
        })
      }

      if (elementType === 'protection') {
        try {
          if (isDuplicateDrag) {
            if (!layoutTree) return false
            const dropTarget =
              dragPreview?.dropTarget ??
              resolveProtectionDropTargetForPosition(
                layoutTree,
                position,
                findProtectionDragTarget,
                (panelId) => getPanelById(panelId),
                elementId,
                (id) => getProtectionById(id),
                { nestOnRcd: true }
              )
            if (!dropTarget) return false
            const newProtId = duplicateProtection({
              ownerDocument: window.document,
              protectionId: elementId,
              dropTarget,
              label: 'duplicate protection via alt-drag',
            })
            if (!newProtId) return false
            setSelection({ type: 'protection', ids: [newProtId] })
            return true
          }

          const movedTap = moveSupplyTapOnDrop(elementId, position)
          if (movedTap !== null) return movedTap
          if (!currentProject || !layoutTree) return false
          const target = resolveProtectionDropTargetForPosition(
            layoutTree, position, findProtectionDragTarget,
            (panelId) => getPanelById(panelId), undefined, undefined, { nestOnRcd: true }
          )
          if (!target) return false
          return runEendraadBusMove({ kind: 'protectionDrop', protectionId: elementId, target })
        } finally {
          if (!isDuplicateDrag) {
            draggingProtectionIdRef.current = null
          }
        }
      }

      if (elementType === 'trunkDevice') {
        const info = getTrunkDeviceById(elementId)
        if (!info || info.isGroundDevice || !layoutTree || !currentProject) return false

        if (info.isSupplyDevice) {
          const { target, debug: hitDebug } = findDropTargetWithDebug(layoutTree, position)
          const targetFeedScope = target.supplyFeedScope ?? 'shared'
          const targetPanelId = target.panelId
          let moved = false
          const targetPanelLayout = layout?.panels.find(
            (candidate) =>
              getPanelDiagramId(candidate) === target.diagramId ||
              (!target.diagramId && candidate.panel.id === target.panelId)
          )
          const targetMounting = targetPanelLayout
            ? resolveSupplyDropMounting(
                currentProject,
                targetPanelLayout,
                target,
                position,
                wireSegments
              )
              : undefined

          if (isDuplicateDrag) {
            if (target.type === null) return false
            const outcome = runProjectCommand('electrical.duplicateElements', {
              items: [{ kind: 'trunkDevice', id: elementId }],
              purpose: 'altDrag',
              target: { type: 'drop', target, ...(targetMounting ? { targetMounting } : {}) },
            }, { label: 'Duplicate supply device' })
            const created = outcome?.results[0]?.select?.find((reference) => reference.kind === 'trunkDevice')
            if (!outcome?.changed || !created) return false
            setSelection({ type: 'trunkDevice', ids: [created.id] })
            return true
          }

          moved = moveSupplyTrunkDevice({
            deviceId: elementId,
            target,
            targetMounting,
            label: 'move supply device',
          })

          if (!moved) return false
          if (trunkDnDCommitLogEnabled()) {
            logTrunkDnDCommit('relocateSupplyTrunkDevice', {
              deviceId: elementId,
              targetPanelId,
              targetFeedScope,
              targetType: target.type,
              targetSupplyDcBusId: target.supplyDcBusId,
              targetSupplyDcBusBranchId: target.supplyDcBusBranchId,
              targetSupplyConverterDcBranch: target.supplyConverterDcBranch,
              targetSupplyConverterDcConnectionIndex:
                target.supplyConverterDcConnectionIndex,
              supplyDeviceInsertIndex: target.supplyDeviceInsertIndex,
              hitPathMatchedTail: summarizeHitDebugPath(hitDebug.path),
            })
          }
          if (moved) {
            setSelection({ type: 'trunkDevice', ids: [elementId] })
            return true
          }
          return false
        }

        if (!info.circuit) return false
        const meta = getSymbolById(info.device.symbol)
        if (!meta) return false

        const sourceCircuitId = info.circuit.id
        const dropTarget = resolveTrunkRelocateDropTarget(position)

        if (trunkDnDVerboseLogEnabled()) {
          const storeSnap = useProjectStore.getState()
          const { debug: hitDebug } = findDropTargetWithDebug(layoutTree, position, {
            ignoreCircuitTrunkDeviceSymbolHits: true,
          })
          const srcC = storeSnap.getCircuitById(sourceCircuitId)
          const tgtC =
            dropTarget?.circuitId != null
              ? storeSnap.getCircuitById(dropTarget.circuitId)
              : undefined
          logTrunkDnD('canvas:drop-end:before-commit', {
            deviceId: elementId,
            deviceSymbol: info.device.symbol,
            pointerCanvas: position,
            sourceCircuitId,
            sourceTrunkOrderBottomToTop: serializeTrunkDevices(srcC?.trunkDevices),
            targetCircuitId: dropTarget?.circuitId ?? null,
            targetTrunkOrderBottomToTop: tgtC ? serializeTrunkDevices(tgtC.trunkDevices) : null,
            resolvedDropTarget: summarizeDropTarget(dropTarget),
            hitPathMatchedTail: summarizeHitDebugPath(hitDebug.path),
          })
        }

        if (!dropTarget || dropTarget.type === null) {
          logTrunkDnDCommit('drop-aborted', {
            reason: 'no-valid-drop-target',
            deviceId: elementId,
            pointerCanvas: position,
          })
          return false
        }

        if (isDuplicateDrag) {
          const outcome = runProjectCommand('electrical.duplicateElements', {
            items: [{ kind: 'trunkDevice', id: elementId }],
            purpose: 'altDrag',
            target: { type: 'drop', target: dropTarget },
          }, { label: 'Duplicate circuit device' })
          const created = outcome?.results[0]?.select?.find((reference) => reference.kind === 'trunkDevice')
          if (!outcome?.changed || !created) return false
          setSelection({ type: 'trunkDevice', ids: [created.id] })
          return true
        }

        const moved = moveCircuitTrunkDevice({
          deviceId: elementId,
          sourceCircuitId,
          target: dropTarget,
          label: 'move circuit device',
        })

        if (trunkDnDVerboseLogEnabled()) {
          const stAfter = useProjectStore.getState()
          const srcAfter = stAfter.getCircuitById(sourceCircuitId)
          const tgtAfter =
            dropTarget.circuitId != null ? stAfter.getCircuitById(dropTarget.circuitId) : undefined
          logTrunkDnD('canvas:drop-end:after-commit', {
            deviceId: elementId,
            relocateOk: moved,
            sourceCircuitId,
            targetCircuitId: dropTarget.circuitId,
            sourceTrunkOrderBottomToTop: serializeTrunkDevices(srcAfter?.trunkDevices),
            targetTrunkOrderBottomToTop: tgtAfter
              ? serializeTrunkDevices(tgtAfter.trunkDevices)
              : null,
          })
        }

        if (!moved) return false
        setSelection({ type: dropTarget.type === 'endpoint' ? 'endpoint' : 'trunkDevice', ids: [elementId] })
        return true
      }

      return false
    },
    [
      window.document,
      augmentCircuitVerticalWireDomain,
      moveSupplyTapOnDrop,
      resolveBranchDrop,
      currentProject,
      dragPreview,
      getFloorById,
      getPanelById,
      getProtectionById,
      getTrunkDeviceById,
      layout?.panels,
      layoutTree,
      resolveTrunkRelocateDropTarget,
      setDragPreview,
      setSelection,
      t,
      wireSegments,
      viewportUI,
      movingPanelAttachmentIdRef,
      internalDragElementIdRef,
      setDragRenderElementId,
      setInternalDragPlacement,
      elementDragModeRef,
      altDuplicatePointerCleanupRef,
      trunkDnDLoggedStartRef,
      setDragRenderMode,
      endpointDragStartSelectionIdsRef,
      draggingProtectionIdRef,
    ]
  )

  useLayoutEffect(() => {
    const asMeterOwner = (id: string, type: string) =>
      meterOwnerDrag(id, type, elementDragModeRef.current === 'duplicate')
    handleElementDragMoveRef.current = (id, type, position) => handleElementDragMove(...asMeterOwner(id, type), position)
    handleElementDragEndRef.current = (id, type, position) => handleElementDragEnd(...asMeterOwner(id, type), position)
  }, [handleElementDragMove, handleElementDragEnd, handleElementDragMoveRef, handleElementDragEndRef, elementDragModeRef])

  const readPointerClient = useCallback(
    (ev: MouseEvent | TouchEvent): { clientX: number; clientY: number } | null => {
      if ('touches' in ev) {
        const t = ev.touches[0] ?? ev.changedTouches[0]
        return t ? { clientX: t.clientX, clientY: t.clientY } : null
      }
      return { clientX: ev.clientX, clientY: ev.clientY }
    },
    []
  )

  const beginAltDuplicatePointerDrag = useCallback(
    (elementId: string, elementType: string, nativeEvt: { clientX: number; clientY: number }) => {
      endAltDuplicatePointerDrag()
      elementDragModeRef.current = 'duplicate'
      setDragRenderMode('duplicate')
      suppressKonvaDragEndRef.current = true
      setAltDuplicatePointerDragActive(true)

      const onMove = (ev: MouseEvent | TouchEvent) => {
        if ('touches' in ev) ev.preventDefault()
        const client = readPointerClient(ev)
        if (!client) return
        const pos = pointerClientToCanvasPoint(client.clientX, client.clientY)
        if (pos) handleElementDragMoveRef.current(elementId, elementType, pos)
      }
      const onUp = (ev: MouseEvent | TouchEvent) => {
        const client = readPointerClient(ev)
        const pos = client ? pointerClientToCanvasPoint(client.clientX, client.clientY) : null
        if (pos) handleElementDragEndRef.current(elementId, elementType, pos)
        else {
          setDragPreview(null)
          elementDragModeRef.current = 'move'
          setDragRenderMode('move')
        }
        endAltDuplicatePointerDrag()
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp, true)
      window.addEventListener('touchmove', onMove, { capture: true, passive: false })
      window.addEventListener('touchend', onUp, true)
      window.addEventListener('touchcancel', onUp, true)

      altDuplicatePointerCleanupRef.current = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp, true)
        window.removeEventListener('touchmove', onMove, true)
        window.removeEventListener('touchend', onUp, true)
        window.removeEventListener('touchcancel', onUp, true)
      }

      const initial = pointerClientToCanvasPoint(nativeEvt.clientX, nativeEvt.clientY)
      if (initial) handleElementDragMoveRef.current(elementId, elementType, initial)
    },
    [
      endAltDuplicatePointerDrag,
      pointerClientToCanvasPoint,
      readPointerClient,
      setDragPreview,
      window,
      altDuplicatePointerCleanupRef,
      elementDragModeRef,
      handleElementDragEndRef,
      handleElementDragMoveRef,
      setAltDuplicatePointerDragActive,
      setDragRenderMode,
      suppressKonvaDragEndRef,
    ]
  )

  const handleElementDragStart = useCallback(
    (elementId: string, elementType: string, altKey: boolean, nativeEvt?: MouseEvent): boolean => {
      internalDragElementIdRef.current = elementId
      setDragRenderElementId(elementId)
      setInternalDragPlacement(null)
      if (elementType === 'panelAttachment') {
        movingPanelAttachmentIdRef.current = elementId
        const symbol = getSymbolById('panel_distribution')
        if (symbol) setInternalDragPlacement({ elementId, symbol })
      } else if (elementType === 'trunkDevice') {
        const info = getTrunkDeviceById(elementId)
        const symbol = info ? getSymbolById(info.device.symbol) : undefined
        if (info && symbol) {
          if (info.isSupplyDevice) {
            const sourcePanelLayout = layout?.panels.find((candidate) =>
              candidate.supplyDevices?.some(({ device }) => device.id === elementId)
            )
            const sourceDeviceLayout = sourcePanelLayout?.supplyDevices?.find(
              ({ device }) => device.id === elementId
            )
            setInternalDragPlacement({
              elementId,
              symbol,
              supply: {
                panelId: sourcePanelLayout?.panel.id,
                feedScope: info.supplyFeedScope ?? sourceDeviceLayout?.feedScope ?? 'shared',
                index: sourceDeviceLayout?.feedIndex ?? info.device.trunkPosition ?? 0,
                supplyPath: info.device.supplyPath,
                supplyConverterDcConnectionIndex: info.device.supplyConverterDcConnectionIndex,
                converterGridPlacement: info.device.converterGridPlacement,
                changeoverGridPlacement: info.device.changeoverGridPlacement,
                dcBusRoot: info.device.type === 'dc_bus',
              },
            })
          } else if (info.circuit) {
            setInternalDragPlacement({
              elementId,
              symbol,
              circuitTrunk: {
                circuitId: info.circuit.id,
                index: Math.max(
                  0,
                  info.circuit.trunkDevices?.findIndex((device) => device.id === elementId) ?? 0
                ),
                converterDcConnection: info.device.converterDcConnection,
                dcBusRoot: info.device.type === 'dc_bus',
              },
            })
          }
        }
      } else if (elementType === 'endpoint') {
        const endpoint = getEndpointById(elementId)
        const symbol = endpoint?.symbol ? getSymbolById(endpoint.symbol) : undefined
        if (symbol) setInternalDragPlacement({ elementId, symbol })
      } else if (elementType === 'protection') {
        const store = useProjectStore.getState()
        const protection = store.getProtectionById(elementId)
        const panel = store.getPanelForProtection(elementId)
        const symbolId = protection?.directTrunkFeeder
          ? 'energy_meter'
          : protection ? protectionTypeToSymbolKey(protection.type) : undefined
        const symbol = symbolId ? getSymbolById(symbolId) : undefined
        if (protection && panel && symbol) {
          const busCircuitId = pickRepresentativeCircuitIdForMainBusMove(panel, protection)
          const mainBusItems = getMainBusItemsWithIndices(panel)
          const mainIndex = mainBusItems.findIndex(
            (item) =>
              (item.type === 'protection' && item.id === protection.id) ||
              (item.type === 'circuit' && item.id === busCircuitId)
          )
          if (mainIndex >= 0) {
            setInternalDragPlacement({
              elementId,
              symbol,
              protectionBus: { kind: 'main', panelId: panel.id, index: mainIndex },
            })
          } else if (busCircuitId) {
            const panelCircuits = [
              ...panel.circuits,
              ...panel.protections.flatMap((candidate) => candidate.circuits ?? []),
            ]
            const parentCircuit = panelCircuits.find((candidate) =>
              candidate.subCircuitIds?.includes(busCircuitId)
            )
            const secondaryIndex = parentCircuit?.subCircuitIds?.indexOf(busCircuitId) ?? -1
            if (parentCircuit && secondaryIndex >= 0) {
              setInternalDragPlacement({
                elementId,
                symbol,
                protectionBus: {
                  kind: 'secondary',
                  panelId: panel.id,
                  parentCircuitId: parentCircuit.id,
                  index: secondaryIndex,
                },
              })
            }
          }
        }
      }
      const selection = viewportUI.getState().selection
      endpointDragStartSelectionIdsRef.current = selection.ids.includes(elementId)
        ? [...selection.ids]
        : [elementId]
      setDragRenderSelectionIds(endpointDragStartSelectionIdsRef.current)
      // Grabbing the first endpoint of a branch on its own moves the whole branch.
      if (
        elementType === 'endpoint' &&
        !altKey &&
        elementDragModeRef.current !== 'duplicate' &&
        endpointDragStartSelectionIdsRef.current.length === 1
      ) {
        const circuit = useProjectStore.getState().findCircuitForEndpoint(elementId)?.circuit
        const branchGroup = circuit ? getBranchDragGroupEndpointIds(circuit, elementId) : null
        if (branchGroup) {
          endpointDragStartSelectionIdsRef.current = branchGroup
          setDragRenderSelectionIds(branchGroup)
        }
      }

      // Long-press duplicate already started window-level drag; block Konva move-drag.
      if (elementDragModeRef.current === 'duplicate') {
        return true
      }
      if (
        !altKey ||
        (elementType !== 'endpoint' &&
          elementType !== 'protection' &&
          elementType !== 'trunkDevice')
      ) {
        elementDragModeRef.current = 'move'
        setDragRenderMode('move')
        return false
      }
      if (!nativeEvt) return false
      // Alt-drag is a targeted duplicate. Keep tracking the pointer and defer
      // all mutation until the drop target is known; Ctrl-D remains the
      // immediate duplicate action.
      beginAltDuplicatePointerDrag(elementId, elementType, nativeEvt)
      return true
    },
    [
      beginAltDuplicatePointerDrag,
      getEndpointById,
      getTrunkDeviceById,
      layout?.panels,
      viewportUI,
      elementDragModeRef,
      endpointDragStartSelectionIdsRef,
      internalDragElementIdRef,
      movingPanelAttachmentIdRef,
      setDragRenderElementId,
      setDragRenderMode,
      setDragRenderSelectionIds,
      setInternalDragPlacement,
    ]
  )
  useLayoutEffect(() => {
    handleElementDragStartRef.current = (id, type, altKey, nativeEvt) =>
      handleElementDragStart(...meterOwnerDrag(id, type, altKey), altKey, nativeEvt)
  }, [handleElementDragStart, handleElementDragStartRef])

  const handleLongPressDuplicateDragStart = useCallback(
    (params: {
      elementId: string
      elementType: Selection['type']
      clientX: number
      clientY: number
    }) => {
      if (params.elementType !== 'endpoint' && params.elementType !== 'protection') return
      setSelection({ type: params.elementType, ids: [params.elementId] })
      beginAltDuplicatePointerDrag(params.elementId, params.elementType, {
        clientX: params.clientX,
        clientY: params.clientY,
      })
    },
    [beginAltDuplicatePointerDrag, setSelection]
  )

  const longPressDuplicateDrag = useMemo<EendraadLongPressDuplicateDrag | undefined>(
    () =>
      canDragItems
        ? {
            elementTypes: ['endpoint', 'protection'],
            onStart: handleLongPressDuplicateDragStart,
          }
        : undefined,
    [canDragItems, handleLongPressDuplicateDragStart]
  )

  return longPressDuplicateDrag
}
