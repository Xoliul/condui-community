import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useDialogStore } from '@/stores/dialogStore'
import FloorSelectionDialog from '@/components/plan/FloorSelectionDialog'
import HiddenItemsDialog, { type HiddenItem } from '@/components/common/HiddenItemsDialog'
import { getSymbolById } from '@/lib/symbols'
import { generateId } from '@/utils/project'
import { endpointSupportsMultiplier } from '@/utils/endpointMultipliers'
import { openAddMoreDialogForEndpoint } from '@/components/endpoints/AddMoreCountDialog'
import type { Point } from '@/types/ui'
import type { Floor, Placement, Panel, PlanGraphicElement } from '@/types/schema'
import { logger } from '@/lib/logger'

type SitplanPlacementRow = Placement & {
  endpointId?: string
  trunkDeviceId?: string
  enclosureId?: string
  junctionPanelLabel?: string
  isEarthing?: boolean
}
import { endpointSymbolCanBeDuplicated } from '@/lib/eendraad/duplicateEndpoint'
import { runPlanDuplicate } from '@/lib/plan/planDuplicateSelection'
import {
  isMainPanelDistributionEndpoint,
  resolvePanelForDistributionEndpoint,
} from '@/lib/plan/panelDistributionEndpoint'
import { resolveSelectionToEndpointIds } from '@/lib/plan/selectionResolvers'
import { getSelectedPlacementsForSelection } from '@/lib/plan/planContextMenuSelection'
import { buildPlacementAlignmentMoves } from '@/lib/plan/planContextMenuLayout'
import type { ContextMenuItem } from '@/components/common/ContextMenu'
import { getContextMenuIcon } from '@/components/common/ContextMenuIcons'
import { confirmDeleteEarthing } from '@/lib/installation/deleteEarthing'
import { readLegacyCompatibilityFloors } from '@/lib/projectV2/buildingFloors'
import { restoreHiddenSituationPlanPlacementsToActiveView } from '@/lib/plan/restoreHiddenSituationPlanPlacements'
import { hasCustomPlacement } from '@/lib/plan/customPlacement'
import { deleteSelectedPlanGraphicElements } from '@/lib/plan/planGraphicElementDeletion'
import { mergeHiddenSituationPlanPlacementIds } from '@/lib/plan/hideSituationPlanPlacements'
import { openSituationPlanBulkDeleteWarning } from '@/components/plan/SituationPlanBulkDeleteWarningDialog'

/**
 * Hook to generate context menu items for the plan canvas
 */
export function usePlanContextMenu(
  activeFloorId: string | null,
  getPlacementWorldBoundsMemo: (
    pos: Point,
    rotationDeg: number,
    scale: number,
    socketCount: number,
    symbolType?: string
  ) => { left: number; right: number; top: number; bottom: number },
  options?: {
    onAddElementClick?: (position: Point) => void
    openContextAssignCircuitPanel?: (endpointIds: string[], planAnchor: Point) => void
  }
): (position: Point, elementId: string | null) => ContextMenuItem[] {
  const { t } = useTranslation()
  const openDialog = useDialogStore((state) => state.openDialog)
  const getEndpointById = useProjectStore((state: ProjectState) => state.getEndpointById)
  const onAddElementClick = options?.onAddElementClick
  const openContextAssignCircuitPanel = options?.openContextAssignCircuitPanel

  const handleGetContextMenuItems = useCallback(
    (position: Point, elementId: string | null) => {
      const uiState = useUIStore.getState()
      const { clearSelection, selection, setSelection } = uiState
      const projectState = useProjectStore.getState()
      const {
        currentProject,
        deleteEndpoint,
        deleteEndpoints,
        deletePlacement,
        deletePlacements,
        updatePlacement,
        addPlacement,
        deleteSitplanNote,
        addSitplanNote,
        deletePlanGraphicElement,
        deletePanel,
        getEndpointById: getEndpointByIdFromSnapshot,
        getAllEndpoints,
        getFloorById,
        getPanelById,
        getPanelByName,
        getPlacementById,
        getPlacementsByFloor,
        updateFloor,
        findCircuitForEndpoint,
        withSingleUndoEntry,
      } = projectState
      const { closeDialog } = useDialogStore.getState()
      const items: ContextMenuItem[] = []

      if (selection.type === 'ground' && selection.ids.includes('ground')) {
        items.push({
          label: t('contextMenu.delete'),
          icon: getContextMenuIcon('delete'),
          onClick: () => confirmDeleteEarthing(),
          variant: 'danger',
        })
        return items
      }

      const hitGraphicElementId =
        elementId &&
        (currentProject ? readLegacyCompatibilityFloors(currentProject) : []).some(
          (floor: Floor) =>
            (floor.floorPlan?.graphicElements ?? []).some(
              (entry: PlanGraphicElement) => entry.id === elementId
            )
        )
          ? elementId
          : null
      if (selection.type === 'graphicElement' && selection.ids.length > 0) {
        const selectedGraphicIds = selection.ids.slice()
        if (hitGraphicElementId && !selectedGraphicIds.includes(hitGraphicElementId)) {
          selectedGraphicIds.push(hitGraphicElementId)
        }
        items.push({
          label: t('contextMenu.delete'),
          icon: getContextMenuIcon('delete'),
          onClick: () => {
            if (
              deleteSelectedPlanGraphicElements(
                { type: 'graphicElement', ids: selectedGraphicIds },
                deletePlanGraphicElement
              )
            ) {
              clearSelection()
            }
          },
          variant: 'danger',
        })
        return items
      }
      if (hitGraphicElementId) {
        items.push({
          label: t('contextMenu.delete'),
          icon: getContextMenuIcon('delete'),
          onClick: () => {
            if (
              deleteSelectedPlanGraphicElements(
                { type: 'graphicElement', ids: [hitGraphicElementId] },
                deletePlanGraphicElement
              )
            ) {
              useUIStore.getState().clearSelection()
            }
          },
          variant: 'danger',
        })
        return items
      }

      const selectedTrunkPlacement =
        selection.type === 'placement' && selection.ids.length === 1
          ? getPlacementById(selection.ids[0]!)
          : undefined
      if (selectedTrunkPlacement?.trunkDeviceId && activeFloorId) {
        items.push(
          {
            label: t('contextMenu.hideInThisView', 'Hide in this view'),
            icon: getContextMenuIcon('hideInThisView'),
            onClick: () => {
              const floor = getFloorById(activeFloorId)
              if (!floor) return
              updateFloor(activeFloorId, {
                hiddenSitplanPlacementIds: Array.from(
                  new Set([...(floor.hiddenSitplanPlacementIds ?? []), selectedTrunkPlacement.id])
                ),
              })
              clearSelection()
            },
          },
          {
            label: t('contextMenu.delete'),
            icon: getContextMenuIcon('delete'),
            onClick: () => {
              deletePlacement(selectedTrunkPlacement.id)
              clearSelection()
            },
            variant: 'danger',
          }
        )
        return items
      }

      const getSelectedPlacements = () =>
        getSelectedPlacementsForSelection(
          selection,
          activeFloorId,
          {
            getEndpointById: getEndpointByIdFromSnapshot,
            getPanelById,
            getPanelByName,
            getAllEndpoints,
            getPlacementsByFloor,
            onUnresolvedPanel: (panel) => {
              logger.warn(
                '[PlanContextMenu] Panel selection could not resolve to panel_distribution endpoint',
                {
                  panelId: panel.id,
                  panelName: panel.name,
                  selection,
                }
              )
            },
          },
          getPlacementWorldBoundsMemo
        )

      // When hit detection misses (elementId null) but one placement/endpoint/panel is selected, use it so single-element menu (Move to floor, Assign to circuit) still shows
      let resolvedElementId: string | null = elementId
      if (
        !resolvedElementId &&
        selection.ids.length === 1 &&
        (selection.type === 'endpoint' ||
          selection.type === 'panel' ||
          selection.type === 'placement' ||
          selection.type === 'ground')
      ) {
        const sel = getSelectedPlacements()
        if (sel.length > 0) {
          resolvedElementId = sel[0]!.endpointId
        } else {
          if (selection.type === 'placement') {
            const placementId = selection.ids[0] ?? null
            const placement = placementId
              ? useProjectStore.getState().getPlacementById(placementId)
              : null
            resolvedElementId = placement?.endpointId ?? null
          } else {
            resolvedElementId = selection.ids[0] ?? null
          }
        }
      }

      const isMultiSelect =
        (selection.type === 'endpoint' ||
          selection.type === 'panel' ||
          selection.type === 'placement') &&
        selection.ids.length > 1

      if (isMultiSelect) {
        // Multi-select context menu: Move to floor + Assign to circuit, then align/distribute,
        // then a final section with Hide in this view + Delete all at the bottom.
        const multiSelected = getSelectedPlacements()
        const multiEndpointIds = multiSelected.map((item) => item.endpointId)
        items.push(
          {
            label: t('contextMenu.moveToFloor'),
            onClick: () => {
              openDialog({
                type: 'custom',
                title: t('contextMenu.moveToFloor'),
                content: (
                  <FloorSelectionDialog
                    currentFloorId={activeFloorId}
                    onSelect={(floorId) => {
                      const items = getSelectedPlacements()
                      logger.info('[PlanContextMenu] Move to floor (multi)', {
                        toFloorId: floorId,
                        activeFloorId,
                        selection,
                        count: items.length,
                        placementIds: items.map((item) => item.placementId),
                      })
                      items.forEach((item) => {
                        updatePlacement(item.placementId, { floorId })
                      })
                      useDialogStore.getState().closeDialog()
                    }}
                    onCancel={() => useDialogStore.getState().closeDialog()}
                  />
                ),
              })
            },
          },
          {
            label: t('contextMenu.assignToCircuit'),
            onClick: () => {
              openContextAssignCircuitPanel?.(multiEndpointIds, position)
            },
          },
          { label: '', onClick: () => {}, separator: true },
          {
            label: t('contextMenu.alignLeft'),
            onClick: () => {
              const items = getSelectedPlacements()
              if (items.length < 2) return
              buildPlacementAlignmentMoves(items, 'left').forEach((move) =>
                updatePlacement(move.placementId, { pos: move.pos })
              )
            },
          },
          {
            label: t('contextMenu.alignRight'),
            onClick: () => {
              const items = getSelectedPlacements()
              if (items.length < 2) return
              buildPlacementAlignmentMoves(items, 'right').forEach((move) =>
                updatePlacement(move.placementId, { pos: move.pos })
              )
            },
          },
          {
            label: t('contextMenu.alignTop'),
            onClick: () => {
              const items = getSelectedPlacements()
              if (items.length < 2) return
              buildPlacementAlignmentMoves(items, 'top').forEach((move) =>
                updatePlacement(move.placementId, { pos: move.pos })
              )
            },
          },
          {
            label: t('contextMenu.alignBottom'),
            onClick: () => {
              const items = getSelectedPlacements()
              if (items.length < 2) return
              buildPlacementAlignmentMoves(items, 'bottom').forEach((move) =>
                updatePlacement(move.placementId, { pos: move.pos })
              )
            },
          },
          {
            label: t('contextMenu.alignCenter'),
            onClick: () => {
              const items = getSelectedPlacements()
              if (items.length < 2) return
              buildPlacementAlignmentMoves(items, 'center').forEach((move) =>
                updatePlacement(move.placementId, { pos: move.pos })
              )
            },
          },
          { label: '', onClick: () => {}, separator: true },
          {
            label: t('contextMenu.distributeHorizontal'),
            onClick: () => {
              const items = getSelectedPlacements()
              if (items.length < 3) return
              buildPlacementAlignmentMoves(items, 'distributeHorizontal').forEach((move) =>
                updatePlacement(move.placementId, { pos: move.pos })
              )
            },
          },
          {
            label: t('contextMenu.distributeVertical'),
            onClick: () => {
              const items = getSelectedPlacements()
              if (items.length < 3) return
              buildPlacementAlignmentMoves(items, 'distributeVertical').forEach((move) =>
                updatePlacement(move.placementId, { pos: move.pos })
              )
            },
          },
          { label: '', onClick: () => {}, separator: true },
          {
            label: t('contextMenu.hideInThisView', 'Hide in this view'),
            icon: getContextMenuIcon('hideInThisView'),
            onClick: () => {
              if (!activeFloorId) return
              const floor = getFloorById(activeFloorId)
              if (!floor) return
              const current = new Set<string>(floor.hiddenSitplanPlacementIds ?? [])
              const selected = getSelectedPlacements()
              if (selected.length === 0) return
              selected.forEach((item) => current.add(item.placementId))
              updateFloor(activeFloorId, {
                hiddenSitplanPlacementIds: Array.from(current),
              })
              clearSelection()
            },
          },
          {
            label: t('contextMenu.deleteAll'),
            icon: getContextMenuIcon('delete'),
            onClick: () => {
              const items = getSelectedPlacements()
              const endpointsToDelete: string[] = []
              const placementsToDelete: string[] = []
              const selectedPlacementIds: string[] = []
              for (const item of items) {
                const endpoint = getEndpointByIdFromSnapshot(item.endpointId)
                if (!endpoint) continue
                if (
                  endpoint.symbol === 'panel_distribution' &&
                  currentProject &&
                  isMainPanelDistributionEndpoint(currentProject, endpoint)
                ) {
                  continue
                }
                selectedPlacementIds.push(item.placementId)
                const keepEndpoint =
                  endpointSupportsMultiplier(endpoint) && endpoint.placements.length > 1
                if (keepEndpoint) {
                  placementsToDelete.push(item.placementId)
                } else {
                  endpointsToDelete.push(item.endpointId)
                }
              }
              const deleteSelection = () => {
                withSingleUndoEntry(
                  () => {
                    if (placementsToDelete.length > 0) deletePlacements(placementsToDelete)
                    if (endpointsToDelete.length > 0) deleteEndpoints(endpointsToDelete)
                    return placementsToDelete.length > 0 || endpointsToDelete.length > 0
                  },
                  { sessionLabel: 'delete plan selection' }
                )
                clearSelection()
              }
              const hideSelection = () => {
                if (activeFloorId) {
                  const floor = getFloorById(activeFloorId)
                  if (floor) {
                    updateFloor(activeFloorId, {
                      hiddenSitplanPlacementIds: mergeHiddenSituationPlanPlacementIds(
                        floor.hiddenSitplanPlacementIds,
                        selectedPlacementIds,
                      ),
                    })
                  }
                }
                clearSelection()
              }
              if (
                openSituationPlanBulkDeleteWarning({
                  projectId: currentProject?.project.id ?? '',
                  placementIds: selectedPlacementIds,
                  t,
                  onDelete: deleteSelection,
                  onHide: hideSelection,
                })
              ) {
                return
              }
              deleteSelection()
            },
            variant: 'danger',
          }
        )
      } else if (resolvedElementId) {
        // Single element context menu - check if it's a note first
        const isNoteSelected =
          selection.type === 'note' && selection.ids.includes(resolvedElementId)

        if (isNoteSelected) {
          // Note context menu
          items.push({
            label: t('contextMenu.delete'),
            icon: getContextMenuIcon('delete'),
            onClick: () => {
              deleteSitplanNote(resolvedElementId!)
              clearSelection()
            },
            variant: 'danger',
          })
        } else {
          // Placement/Endpoint context menu — when selection is placement-based, act on the selected placement(s)
          const placementSelection = selection.type === 'placement' && selection.ids.length === 1
          const singleItem = placementSelection ? getSelectedPlacements()[0] : null
          const effectiveEndpointId = (() => {
            if (singleItem) return singleItem.endpointId
            if (selection.type === 'panel' && selection.ids.length === 1) {
              const mapped = resolveSelectionToEndpointIds(selection, {
                getPanelById,
                getPanelByName,
                getAllEndpoints,
              })
              return mapped[0] ?? resolvedElementId!
            }
            return resolvedElementId!
          })()
          const effectivePlacementId = singleItem ? singleItem.placementId : undefined
          const endpoint = getEndpointById(effectiveEndpointId)
          const placement = (() => {
            if (!endpoint) return undefined
            if (effectivePlacementId) {
              return endpoint.placements.find((p: Placement) => p.id === effectivePlacementId)
            }
            const onActiveFloor = endpoint.placements.find(
              (p: Placement) => p.floorId === activeFloorId
            )
            if (onActiveFloor) return onActiveFloor
            // Fallback for context-menu operations when the symbol is not placed
            // on the currently active floor (e.g. referenced/overlay floor view).
            if (endpoint.placements.length === 1) return endpoint.placements[0]
            return undefined
          })()

          const forbidDeleteMainPanelSymbol =
            !!endpoint &&
            endpoint.symbol === 'panel_distribution' &&
            !!currentProject &&
            isMainPanelDistributionEndpoint(currentProject, endpoint)

          items.push(
            {
              label: t('contextMenu.moveToFloor'),
              onClick: () => {
                openDialog({
                  type: 'custom',
                  title: t('contextMenu.moveToFloor'),
                  content: (
                    <FloorSelectionDialog
                      currentFloorId={activeFloorId}
                      onSelect={(floorId) => {
                        if (placement) {
                          logger.info('[PlanContextMenu] Move to floor (single)', {
                            endpointId: effectiveEndpointId,
                            placementId: placement.id,
                            fromFloorId: placement.floorId,
                            toFloorId: floorId,
                            activeFloorId,
                            selection,
                          })
                          updatePlacement(placement.id, { floorId })
                        } else if (endpoint) {
                          const createdPlacementId = generateId()
                          const newPlacement: Placement = {
                            id: createdPlacementId,
                            floorId,
                            layer: 'electrical',
                            pos: { x: position.x, y: position.y },
                            rotationDeg: 0,
                            scale: 1,
                          }
                          logger.info(
                            '[PlanContextMenu] Move to floor created placement (single)',
                            {
                              endpointId: effectiveEndpointId,
                              createdPlacementId,
                              toFloorId: floorId,
                              activeFloorId,
                              selection,
                              fromContextMenuPos: position,
                            }
                          )
                          addPlacement(effectiveEndpointId, newPlacement)
                        } else {
                          logger.warn(
                            '[PlanContextMenu] Move to floor skipped (single): no placement resolved',
                            {
                              effectiveEndpointId,
                              effectivePlacementId,
                              activeFloorId,
                              selection,
                              endpointPlacementCount: 0,
                            }
                          )
                        }
                        closeDialog()
                      }}
                      onCancel={closeDialog}
                    />
                  ),
                })
              },
            },
            {
              label: t('contextMenu.assignToCircuit'),
              onClick: () => {
                openContextAssignCircuitPanel?.([effectiveEndpointId], position)
              },
            },
            ...(endpoint &&
            endpointSymbolCanBeDuplicated(endpoint) &&
            (endpointSupportsMultiplier(endpoint) || findCircuitForEndpoint(effectiveEndpointId))
              ? [
                  {
                    label: t('contextMenu.duplicate'),
                    onClick: () => {
                      const duplicateSelection =
                        effectivePlacementId != null
                          ? { type: 'placement' as const, ids: [effectivePlacementId] }
                          : { type: 'endpoint' as const, ids: [effectiveEndpointId] }
                      const result = runPlanDuplicate(duplicateSelection, activeFloorId, {
                        fallbackPosition: position,
                        withSingleUndoEntry,
                      })
                      if (result) {
                        setSelection(result)
                      }
                    },
                  },
                ]
              : []),
            ...(endpoint && (endpointSupportsMultiplier(endpoint) || endpoint.type === 'socket')
              ? [
                  {
                    label: t('contextMenu.addMore', 'Add more...'),
                    onClick: () => {
                      const latest = getEndpointByIdFromSnapshot(effectiveEndpointId)
                      if (!latest) return
                      openAddMoreDialogForEndpoint(latest, t)
                    },
                  },
                ]
              : []),
            { label: '', onClick: () => {}, separator: true },
            (() => {
              const isLocked = placement?.locked ?? false
              return {
                label: isLocked ? t('contextMenu.unlockPosition') : t('contextMenu.lockPosition'),
                onClick: () => {
                  if (placement) {
                    updatePlacement(placement.id, { locked: !isLocked })
                  }
                },
              }
            })(),
            { label: '', onClick: () => {}, separator: true },
            {
              label: t('contextMenu.hideInThisView', 'Hide in this view'),
              icon: getContextMenuIcon('hideInThisView'),
              onClick: () => {
                if (!activeFloorId || !placement) return
                const floor = getFloorById(activeFloorId)
                if (!floor) return
                const current = new Set<string>(floor.hiddenSitplanPlacementIds ?? [])
                current.add(placement.id)
                updateFloor(activeFloorId, {
                  hiddenSitplanPlacementIds: Array.from(current),
                })
                clearSelection()
              },
            },
            ...(forbidDeleteMainPanelSymbol
              ? []
              : [
                  {
                    label: t('contextMenu.delete'),
                    icon: getContextMenuIcon('delete'),
                    onClick: () => {
                      if (!endpoint) return
                      // If this is a panel_distribution endpoint, delete the panel itself (never the main board)
                      if (endpoint.symbol === 'panel_distribution') {
                        if (
                          currentProject &&
                          isMainPanelDistributionEndpoint(currentProject, endpoint)
                        )
                          return
                        // Safety: if corrupted data has multiple placements for this panel symbol,
                        // only remove the selected placement (never delete the panel object here).
                        if (placement && endpoint.placements.length > 1) {
                          deletePlacement(placement.id)
                          clearSelection()
                          return
                        }
                        const panelToDelete = currentProject
                          ? resolvePanelForDistributionEndpoint(currentProject, endpoint)
                          : getPanelByName(endpoint.label)
                        if (panelToDelete) {
                          const panelHasContent = (panel: Panel): boolean => {
                            const hasDirectCircuits = panel.circuits.some((c) => c.code !== 'PANEL')
                            const hasProtections = panel.protections.length > 0
                            const hasSubPanels = panel.subPanels.length > 0
                            return hasDirectCircuits || hasProtections || hasSubPanels
                          }
                          const hasContent = panelHasContent(panelToDelete)
                          const panelNames = panelToDelete.name
                          const message = hasContent
                            ? t('panel.deleteConfirmMessage', {
                                panelNames,
                                defaultValue:
                                  'The following panel(s) contain circuits, protections, or sub-panels: {{panelNames}}\n\nDeleting them will also delete all their contents. You can undo this action.\n\nAre you sure you want to continue?',
                              })
                            : t('panel.deleteEmptyPanelMessage', {
                                panelNames,
                                defaultValue:
                                  'Are you sure you want to delete panel(s): {{panelNames}}?\n\nThis will also remove any associated frames and nested panels. You can undo this action.',
                              })
                          openDialog({
                            type: 'confirm',
                            title: t('panel.deleteConfirmTitle', {
                              defaultValue: 'Delete Panel(s)?',
                            }),
                            message,
                            variant: 'warning',
                            confirmLabel: t('common.delete'),
                            cancelLabel: t('common.cancel'),
                            onConfirm: () => {
                              deletePanel(panelToDelete.id)
                              clearSelection()
                            },
                          })
                          return
                        }
                      }
                      const keepEndpoint =
                        !!placement &&
                        endpointSupportsMultiplier(endpoint) &&
                        endpoint.placements.length > 1
                      if (keepEndpoint) {
                        deletePlacement(placement.id)
                      } else {
                        deleteEndpoint(effectiveEndpointId)
                      }
                      clearSelection()
                    },
                    variant: 'danger' as const,
                  },
                ])
          )
        }
      } else {
        // Right-click on empty space (no selection)
        items.push({
          label: t('contextMenu.addElement'),
          icon: getContextMenuIcon('addElement'),
          onClick: () => onAddElementClick?.(position),
        })

        items.push({
          label: t('contextMenu.addNote'),
          icon: getContextMenuIcon('addNote'),
          onClick: () => {
            // Add a note at the click position
            const noteId = `note-${Date.now()}`
            if (activeFloorId) {
              addSitplanNote({
                id: noteId,
                text: 'New note',
                fontSize: 14,
                pos: position,
                floorId: activeFloorId,
              })
              setSelection({ type: 'note', ids: [noteId] })
            }
          },
        })

        // When something is selected (single), add Remove option
        const isSingleSelect =
          (selection.type === 'endpoint' ||
            selection.type === 'panel' ||
            selection.type === 'placement' ||
            selection.type === 'ground' ||
            selection.type === 'graphicElement') &&
          selection.ids.length === 1
        const selected = isSingleSelect ? getSelectedPlacements() : []
        if (isSingleSelect && selected.length > 0) {
          items.push({ label: '', onClick: () => {}, separator: true })
          items.push({
            label: t('contextMenu.delete'),
            icon: getContextMenuIcon('delete'),
            onClick: () => {
              const endpointsToDelete: string[] = []
              const placementsToDelete: string[] = []
              for (const item of selected) {
                const endpoint = getEndpointByIdFromSnapshot(item.endpointId)
                if (!endpoint) continue
                const keepEndpoint =
                  endpointSupportsMultiplier(endpoint) && endpoint.placements.length > 1
                if (keepEndpoint) {
                  placementsToDelete.push(item.placementId)
                } else {
                  endpointsToDelete.push(item.endpointId)
                }
              }
              withSingleUndoEntry(
                () => {
                  if (placementsToDelete.length > 0) deletePlacements(placementsToDelete)
                  if (endpointsToDelete.length > 0) deleteEndpoints(endpointsToDelete)
                  return placementsToDelete.length > 0 || endpointsToDelete.length > 0
                },
                { sessionLabel: 'delete plan selection' }
              )
              clearSelection()
            },
            variant: 'danger',
          })
        }

        // Show / Hide in same section (one separator, then Hide if single-select, then Show hidden if any)
        const floor = activeFloorId ? getFloorById(activeFloorId) : null
        const hiddenIds = floor?.hiddenSitplanPlacementIds ?? []
        const hasHide = isSingleSelect && selected.length > 0
        const hasShowHidden = hiddenIds.length > 0
        if (hasHide || hasShowHidden) {
          items.push({ label: '', onClick: () => {}, separator: true })
          if (hasHide) {
            items.push({
              label: t('contextMenu.hideInThisView', 'Hide in this view'),
              icon: getContextMenuIcon('hideInThisView'),
              onClick: () => {
                const floorInner = getFloorById(activeFloorId!)
                if (!floorInner) return
                const current = new Set<string>(floorInner.hiddenSitplanPlacementIds ?? [])
                selected.forEach((item) => current.add(item.placementId))
                updateFloor(activeFloorId!, {
                  hiddenSitplanPlacementIds: Array.from(current),
                })
                clearSelection()
              },
            })
          }
          if (hasShowHidden) {
            items.push({
              label: t('contextMenu.showHidden', 'Show hidden…'),
              icon: getContextMenuIcon('showHidden'),
              onClick: () => {
                if (!activeFloorId) return
                const floorInner = getFloorById(activeFloorId)
                const hiddenInner = floorInner?.hiddenSitplanPlacementIds ?? []
                if (hiddenInner.length === 0) return
                const allPlacements = getPlacementsByFloor(activeFloorId)
                const placementMap = new Map<string, SitplanPlacementRow>(
                  allPlacements.map((p: SitplanPlacementRow) => [p.id, p])
                )
                const customPlacementIds = new Set(
                  allPlacements.filter(hasCustomPlacement).map((placement) => placement.id)
                )
                const dialogItems: HiddenItem[] = hiddenInner.flatMap((id: string) => {
                  const pl = placementMap.get(id)
                  if (!pl) return []
                  if (pl.isEarthing) {
                    const symbolMeta = getSymbolById('earthing')
                    return [
                      {
                        id: pl.id,
                        label: t('symbols.earthing', 'Earthing'),
                        icon: symbolMeta ? (
                          <img
                            src={symbolMeta.svgPath}
                            alt=""
                            className="w-7 h-7 object-contain dark:invert"
                          />
                        ) : undefined,
                        subtitle: symbolMeta?.name,
                      },
                    ]
                  }
                  if (pl.enclosureId) {
                    const symbolMeta = getSymbolById('panel_distribution')
                    const enclosure = useProjectStore
                      .getState()
                      .currentProject?.disciplines?.electrical?.auxiliaryEnclosures?.find(
                        (candidate) => candidate.id === pl.enclosureId
                      )
                    return [
                      {
                        id: pl.id,
                        label:
                          enclosure?.name.trim() ||
                          t('panelCanvas.virtualEnclosure', 'Supply enclosure'),
                        icon: symbolMeta ? (
                          <img
                            src={symbolMeta.svgPath}
                            alt=""
                            className="w-7 h-7 object-contain dark:invert"
                          />
                        ) : undefined,
                      },
                    ]
                  }
                  const endpoint = pl.endpointId
                    ? getEndpointByIdFromSnapshot(pl.endpointId)
                    : undefined
                  const trunkDevice = pl.trunkDeviceId
                    ? useProjectStore.getState().getTrunkDeviceById(pl.trunkDeviceId)?.device
                    : undefined
                  const label =
                    endpoint?.label ||
                    trunkDevice?.label ||
                    endpoint?.symbol ||
                    trunkDevice?.symbol ||
                    t('hiddenItemsDialog.unnamedItem', 'Unnamed item')
                  const symbolKey = endpoint?.symbol ?? trunkDevice?.symbol
                  const symbolMeta = symbolKey ? getSymbolById(symbolKey) : null
                  const subtitle = symbolMeta?.id
                    ? t(`symbols.${symbolMeta.id}`, symbolMeta.name)
                    : undefined
                  const icon = symbolMeta ? (
                    <img
                      src={symbolMeta.svgPath}
                      alt=""
                      className="w-7 h-7 object-contain dark:invert"
                    />
                  ) : undefined
                  return [{ id: pl.id, label, icon, subtitle }]
                })

                openDialog({
                  type: 'custom',
                  title: t('contextMenu.showHidden', 'Show hidden…'),
                  content: (
                    <HiddenItemsDialog
                      items={dialogItems}
                      showMoveToCurrentView
                      getMoveToCurrentViewDefault={(selectedIds) =>
                        selectedIds.some((id) => !customPlacementIds.has(id))
                      }
                      onConfirm={(selectedIds, options) => {
                        restoreHiddenSituationPlanPlacementsToActiveView(selectedIds, {
                          moveToActiveView: options.moveToCurrentViewOverridden
                            ? options.moveToCurrentView
                            : undefined,
                        })
                        closeDialog()
                      }}
                      onCancel={closeDialog}
                    />
                  ),
                })
              },
            })
          }
        }
      }

      return items
    },
    [
      t,
      activeFloorId,
      getPlacementWorldBoundsMemo,
      getEndpointById,
      openDialog,
      onAddElementClick,
      openContextAssignCircuitPanel,
    ]
  )

  return handleGetContextMenuItems
}
