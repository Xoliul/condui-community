import type { BottomUpPanelLayout } from '@/lib/layout/bottomUpLayout'
import { createElement } from 'react'
import { isKeyboardTypingTarget } from '@/lib/ui/keyboardTypingTarget'
import type { useCanvasWindow } from '@/components/viewport/ViewportContext'
import type { useIsActiveViewport, useViewportUIApi } from '@/components/viewport/ViewportUIStore'
import {
  deleteProjectEntities,
  resolveSelectionDeleteRefs,
  deleteEndpointByCommand as deleteEndpoint,
  deleteProtectionByCommand as deleteProtection,
  deletePanelByCommand as deletePanel,
  deleteTrunkDeviceByCommand as deleteTrunkDevice,
  deleteGroundTrunkDeviceByCommand as deleteGroundTrunkDevice,
} from '@/handlers/commands/deleteEntities'

import {
  useCallback,
  useRef,
  useEffect,
} from 'react'
import type { useJunctionEditorMenu } from '@/components/junctionEditor/junctionEditorHostedFeatures'

import type { useTranslation } from 'react-i18next'

import { useUIStore } from '@/stores/uiStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import { useDialogStore } from '@/stores/dialogStore'


import type { Point } from '@/types/ui'
import type {
  Endpoint,
  Panel,
  ProtectionDevice,
  Placement,
} from '@/types/schema'


/* @vision-scan-strip-start */
import { isElectricalVisionScanEnabled } from '@/lib/vision/availability'
/* @vision-scan-strip-end */
/* @vision-scan-strip-start */
import { removeOneWireReferenceItems } from '@/handlers/documents/oneWireReferences'
/* @vision-scan-strip-end */
/* @vision-scan-strip-start */
import { parseOneWireReferenceItemId } from '@/lib/documents/oneWireReferences'
/* @vision-scan-strip-end */

import {
  getStoredMetadataCalloutOffset,
  clearMetadataCalloutOffsets,
  type MetadataCalloutOwnerRef,
} from '@/handlers/eendraad/metadataCalloutOffset'
import { linkedSubPanelDisplayNamesForProtectionIds } from '@/lib/panel/linkedSubPanelDeleteWarning'
import { createLinkedProtectionDeleteDialog } from '@/lib/panel/linkedProtectionDeleteDialog'

import { panelHasContent, isLastMainPanel } from '@/utils/eendraad'
import { endpointSupportsMultiplier } from '@/utils/endpointMultipliers'
import { supportsSupplyDeviceMultiplier } from '@/lib/supplyAssembly/inverterMultipliers'

import { openAddMoreDialogForEndpoint, openSupplyDeviceAddMoreDialog } from '@/components/endpoints/AddMoreCountDialog'
import type { useEendraadLayout, useEendraadWireSegments } from '@/hooks/eendraad'

import { resolveSecondaryBusEjectSelection } from '@/lib/eendraad/secondaryBusEjectEligibility'

import { buildFrameFieldsFromClassifiedSelection, resolveEendraadFramePanelIdForSelection } from '@/lib/eendraad/frameContent'

import type { ContextMenuItem } from '@/components/common/ContextMenu'
import { getContextMenuIcon } from '@/components/common/ContextMenuIcons'
import FloorSelectionDialog from '@/components/plan/FloorSelectionDialog'
import { getViewportCenterPlanSpaceIfApplicable } from '@/lib/plan/autoSitplanPlacement'

import { isMainPanelDistributionEndpoint } from '@/lib/plan/panelDistributionEndpoint'
import { confirmDeleteEarthing } from '@/lib/installation/deleteEarthing'
import { findGroundTrunkDeviceOwner, isGroundElementId } from '@/lib/eendraad/panelGround'
import { confirmDeleteSupplyTrunkDevice } from '@/lib/supplyAssembly/deleteSupplyTrunkDevice'
import {
  type getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectSupplyAssemblies,
} from '@/lib/projectV2/electrical'
import { canDuplicateEendraadSelection, doEendraadDuplicate } from '@/lib/eendraad/contextMenuActions'
import { hasEendraadAnnotationDeleteTarget, resolveEendraadAnnotationDeleteTarget } from '@/lib/eendraad/deleteSelection'
import { isEendraadDeleteKey } from '@/lib/eendraad/deleteKeyboardKey'

import { duplicateProtection } from '@/handlers/eendraad/duplicateProtection'


import { resolveSupplyWireSegmentByMetadata } from '@/lib/eendraad/wireSelectionIdentity'
import { isKeyboardOwnedByFloatingEditor } from '@/utils/keyboardOwner'
import type {
  Dispatch,
  RefObject,
  SetStateAction,
} from 'react'

type PanelLayoutWithElements = BottomUpPanelLayout & {
  elements?: Array<{ type?: string; trunkDeviceId?: string }>
}

type ViewportUIState = ReturnType<ReturnType<typeof useViewportUIApi>['getState']>
interface EendraadContextMenuOptions {
  canDeleteItems: boolean
  canDragItems: boolean
  canEditProject: boolean
  currentInstallation: ReturnType<typeof getProjectElectricalInstallation> | undefined
  currentProject: ProjectState['currentProject']
  eendraadDateMarkingMode: boolean
  exitDateMarkingMode: () => void
  getEjectPlanPlacement: () => { floorId: string; layer: string; pos: Point } | undefined
  isActiveViewport: ReturnType<typeof useIsActiveViewport>
  layout: ReturnType<typeof useEendraadLayout>
  pointerOverEendraadRef: RefObject<boolean>
  setAddElementDropPosition: Dispatch<SetStateAction<Point | null>>
  setEendraadClipboard: ViewportUIState['setEendraadClipboard']
  setSelection: ViewportUIState['setSelection']
  t: ReturnType<typeof useTranslation>['t']
  viewportUI: ReturnType<typeof useViewportUIApi>
  window: ReturnType<typeof useCanvasWindow>
  wireSegments: ReturnType<typeof useEendraadWireSegments>
  withJunctionEditorItem: ReturnType<typeof useJunctionEditorMenu>
}

/** Apply plan-consistent floor moves for one or more endpoints (one-wire context menu). */
function applyEendraadEndpointsToFloor(endpointIds: string[], floorId: string): void {
  const uiSnap = useUIStore.getState()
  const preferredPlanPos =
    getViewportCenterPlanSpaceIfApplicable(
      uiSnap.viewportLayout,
      uiSnap.planCanvasViewportPx,
      uiSnap.activeFloorId,
      floorId,
      uiSnap.planView
    ) ?? undefined
  runProjectCommand('plan.moveEndpointsToFloor', {
    endpointIds,
    floorId,
    activeFloorId: uiSnap.activeFloorId,
    ...(preferredPlanPos ? { preferredPlanPos } : {}),
  })
}


export function useEendraadContextMenu({
  canDeleteItems,
  canDragItems,
  canEditProject,
  currentInstallation,
  currentProject,
  eendraadDateMarkingMode,
  exitDateMarkingMode,
  getEjectPlanPlacement,
  isActiveViewport,
  layout,
  pointerOverEendraadRef,
  setAddElementDropPosition,
  setEendraadClipboard,
  setSelection,
  t,
  viewportUI,
  window,
  wireSegments,
  withJunctionEditorItem,
}: EendraadContextMenuOptions) {
  const contextMenuItemsResolverRef = useRef<
    ((position: Point, elementId: string | null) => ContextMenuItem[]) | null
  >(null)
  // Helper function to check if a panel is the last main panel
  const isLastMainPanelCallback = useCallback(
    (panelId: string): boolean => {
      if (!currentProject) return false

      const { getPanelById } = useProjectStore.getState()
      const panel = getPanelById(panelId)
      if (!panel || !panel.isMain) return false

      return isLastMainPanel(getProjectElectricalPanels(currentProject), panelId)
    },
    [currentProject]
  )

  // Handle keyboard Delete by invoking the same delete actions as context menu.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActiveViewport()) return
      if (!canDeleteItems) return
      if (!isEendraadDeleteKey(e)) {
        return
      }
      // A floating editor over the canvas (the junction editor) deletes its own selection.
      if (isKeyboardOwnedByFloatingEditor()) return

      // Only handle Delete when not typing in an input field or contentEditable
      if (
        isKeyboardTypingTarget(e.target)
      ) {
        return
      }

      const uiState = viewportUI.getState()
      let effectiveSelection = uiState.selection

      /* @vision-scan-strip-start */
      // Deleting a reference page here only takes it off the one-wire; the document stays.
      if (
        isElectricalVisionScanEnabled() &&
        uiState.selection.type === 'oneWireReference' &&
        uiState.selection.ids.length > 0
      ) {
        e.preventDefault()
        e.stopPropagation()
        removeOneWireReferenceItems(uiState.selection.ids)
        return
      }
      /* @vision-scan-strip-end */

      if (
        (uiState.selection.type === 'note' || uiState.selection.type === 'frame') &&
        uiState.selection.ids.length > 0
      ) {
        const store = useProjectStore.getState()
        const annotationTarget = resolveEendraadAnnotationDeleteTarget(
          uiState.selection,
          null,
          store
        )
        if (hasEendraadAnnotationDeleteTarget(annotationTarget)) {
          const refs = resolveSelectionDeleteRefs(uiState.selection, 'oneWire')
          // Situation-plan notes use that canvas's keyboard adapter and explicit note scope.
          if (!refs.length) return
          if (uiState.selection.type === 'note' && !pointerOverEendraadRef.current && uiState.selection.ids.some((id) => store.getSitplanNoteById(id))) return
          e.preventDefault()
          e.stopPropagation()
          e.stopImmediatePropagation()
          deleteProjectEntities(refs, { onDeleted: () => viewportUI.getState().clearSelection() })
          return
        }
      }

      // Floor-plan placements are handled by plan keyboard delete logic. Do not convert
      // placement selections back to endpoint ids here: multiplied plan symbols can be
      // deleted one copy at a time.
      if (uiState.selection.type === 'placement' && uiState.selection.ids.length > 0) {
        return
      }
      if (
        uiState.selection.type === 'wall' ||
        uiState.selection.type === 'wallPoint' ||
        uiState.selection.type === 'door' ||
        uiState.selection.type === 'window' ||
        uiState.selection.type === 'stair' ||
        uiState.selection.type === 'stairPoint' ||
        uiState.selection.type === 'graphicElement'
      ) {
        return
      }

      const resolver = contextMenuItemsResolverRef.current
      if (!resolver) {
        return
      }
      if (
        effectiveSelection.ids.length === 0 &&
        uiState.hover.type === 'panel' &&
        uiState.hover.ids.length > 0
      ) {
        effectiveSelection = { type: 'panel', ids: [...uiState.hover.ids] }
        viewportUI.getState().setSelection(effectiveSelection)
      }

      if (effectiveSelection.ids.length === 0) {
        return
      }

      const contextElementId =
        effectiveSelection.ids.length === 1 ? (effectiveSelection.ids[0] ?? null) : null
      const itemsForElement = resolver({ x: 0, y: 0 }, contextElementId)
      const itemsForSelection = resolver({ x: 0, y: 0 }, null)
      const items = itemsForElement.length > 0 ? itemsForElement : itemsForSelection
      if (!items.length) {
        return
      }

      const deleteItem =
        items.find(
          (item) =>
            !item.separator &&
            (item.label === t('contextMenu.deleteAll') || item.label === t('contextMenu.delete'))
        ) ?? items.find((item) => !item.separator && item.variant === 'danger')
      if (!deleteItem) {
        return
      }

      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      deleteItem.onClick()
    }

    // Capture phase so Eendraad delete runs before other global key handlers (e.g. plan keyboard).
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [canDeleteItems, t, window, viewportUI, isActiveViewport, pointerOverEendraadRef])

  // Get context menu items for right-click
  const handleGetContextMenuItems = useCallback(
    (_position: Point, elementId: string | null): ContextMenuItem[] => {
      const uiState = viewportUI.getState()
      const {
        selection,
        activeFloorId,
        clearSelection,
        setActivePanelId,
        setSelection: setLiveSelection,
      } = uiState
      const projectState = useProjectStore.getState()
      const {
        getCircuitById,
        getEendraadNoteById,
        getFrameById,
        getPanelById,
        getPanelForProtection,
        getCircuitsByPanel,
        getProtectionById,
        getEndpointById,
        getSitplanNoteById,
        getTrunkDeviceById,
        findCircuitForEndpoint,
      } = projectState
      const { openDialog, closeDialog } = useDialogStore.getState()
      const items: ContextMenuItem[] = []

      // Add Element and Add note at top of every symbol menu so they're available when right-clicking on a symbol (or empty with selection).
      const addElementAndNoteItems: ContextMenuItem[] = [
        {
          label: t('contextMenu.addElement'),
          icon: getContextMenuIcon('addElement'),
          onClick: () => setAddElementDropPosition(_position),
        },
        {
          label: t('contextMenu.addNote'),
          icon: getContextMenuIcon('addNote'),
          onClick: () => {
            const outcome = runProjectCommand('annotation.createNote', {
              scope: 'oneWire', pos: _position,
            }, { source: 'one-wire-context-menu' })
            const noteId = outcome?.results[0]?.created[0]?.id
            if (noteId) setLiveSelection({ type: 'note', ids: [noteId] })
          },
        },
        { label: '', onClick: () => {}, separator: true },
      ]

      // If hit detection missed (elementId null) but one item is selected, use it so right-click still shows that symbol's menu (e.g. Delete).
      let resolvedElementId = elementId
      if (!resolvedElementId && selection.ids.length === 1 && selection.ids[0]) {
        resolvedElementId = selection.ids[0]
      }

      if (selection.type === 'wire' && selection.ids.length === 1) {
        const metadata = selection.wireMetadata?.find(
          (candidate) => candidate.id === selection.ids[0]
        )
        const selectedWire =
          wireSegments.find((candidate) => candidate.id === selection.ids[0]) ??
          (metadata ? resolveSupplyWireSegmentByMetadata(wireSegments, metadata) : undefined)
        const assembly =
          currentProject && selectedWire?.supplyAssemblyId
            ? selectProjectSupplyAssemblies(currentProject).find(
                ({ id }) => id === selectedWire.supplyAssemblyId
              )
            : undefined
        const connection = assembly?.connections.find(
          ({ id }) => id === selectedWire?.supplyConnectionId
        )
        if (
          selectedWire?.type === 'vertical' &&
          selectedWire.panelId &&
          assembly &&
          connection?.pathRole === 'inverter-grid-ac'
        ) {
          items.push({
            label: t('contextMenu.delete'),
            icon: getContextMenuIcon('delete'),
            onClick: async () => {
              const outcome = runProjectCommand('supply.disconnectInverterGridInput', {
                assemblyId: assembly.id,
                panelId: selectedWire.panelId!,
              })
              if (outcome?.changed) clearSelection()
            },
            variant: 'danger',
          })
          return items
        }
      }

      // Check for multi-selection (2+ items selected, regardless of whether right-click hit an element)
      const hasMultiSelection = selection.ids.length > 1

      // For multi-selection, classify selected IDs by actual type (since rectangle selection
      // may put mixed types into a single selection with one nominal type). Deletion works on
      // the full selection regardless of type.
      if (hasMultiSelection) {
        const protectionIds: string[] = []
        const endpointIds: string[] = []
        const panelIds: string[] = []
        const trunkDeviceIds: string[] = []
        const noteIds: string[] = []
        const frameIds: string[] = []
        let hasGroundSelected = false
        let hasSupplySelected = false
        for (const id of selection.ids) {
          if (!id) continue
          if (isGroundElementId(id) && selection.type === 'ground') {
            hasGroundSelected = true
          } else if (id === 'supply' && selection.type === 'supply') {
            hasSupplySelected = true
          } else if (getProtectionById(id)) {
            protectionIds.push(id)
          } else if (getEndpointById(id)) {
            endpointIds.push(id)
          } else if (getPanelById(id)) {
            panelIds.push(id)
          } else if (getTrunkDeviceById(id)) {
            trunkDeviceIds.push(id)
          } else if (getEendraadNoteById(id)) {
            noteIds.push(id)
          } else if (getFrameById(id)) {
            frameIds.push(id)
          }
        }

        const hasDeletable =
          protectionIds.length > 0 ||
          endpointIds.length > 0 ||
          panelIds.length > 0 ||
          trunkDeviceIds.length > 0 ||
          hasGroundSelected ||
          noteIds.length > 0 ||
          frameIds.length > 0
        // Supply is not deletable - it's a permanent part of the installation

        const selectionBlocksFrame =
          noteIds.length > 0 || panelIds.length > 0 || frameIds.length > 0 || hasSupplySelected
        const hasFrameableContent =
          protectionIds.length +
            endpointIds.length +
            trunkDeviceIds.length +
            (hasGroundSelected ? 1 : 0) >
          0
        const classifiedForFrame = {
          protectionIds,
          endpointIds,
          trunkDeviceIds,
          hasGround: hasGroundSelected,
        }
        const panelIdForFrame = resolveEendraadFramePanelIdForSelection(layout, classifiedForFrame)
        const canFrame =
          hasFrameableContent && !selectionBlocksFrame && !!panelIdForFrame && !!currentProject
        const secondaryBusEjectSelection = resolveSecondaryBusEjectSelection(
          currentProject,
          protectionIds
        )

        if (hasDeletable) {
          items.push(...addElementAndNoteItems)
          // Add "Add Frame" for any frameable-only selection on one panel (mixed types / multi-circuit trunks OK)
          if (canFrame && panelIdForFrame && currentProject) {
            items.push({
              label: t('contextMenu.addFrame', 'Add Frame'),
              onClick: () => {
                const fields = buildFrameFieldsFromClassifiedSelection(
                  classifiedForFrame,
                  getTrunkDeviceById,
                  currentProject
                )
                const outcome = runProjectCommand('eendraad.createFrame', {
                  panelId: panelIdForFrame, fields,
                }, { source: 'one-wire-context-menu' })
                const frameId = outcome?.results[0]?.created[0]?.id
                if (frameId) setLiveSelection({ type: 'frame', ids: [frameId] })
              },
            })
            items.push({ label: '', onClick: () => {}, separator: true })
          }

          if (secondaryBusEjectSelection) {
            items.push({
              label: t('contextMenu.moveProtectionToNewPanel'),
              onClick: async () => {
                const outcome = runProjectCommand('panel.ejectSecondaryBusProtections', {
                  protectionIds: secondaryBusEjectSelection.protectionIds,
                  planPlacement: getEjectPlanPlacement(),
                })
                const newId = outcome?.results[0]?.created.find((ref) => ref.kind === 'panel')?.id
                if (newId) {
                  setActivePanelId(newId)
                  setLiveSelection({ type: 'panel', ids: [newId] })
                }
              },
            })
            items.push({ label: '', onClick: () => {}, separator: true })
          }

          if (endpointIds.length >= 1) {
            const endpointOnlySelection = {
              type: 'endpoint' as const,
              ids: [...endpointIds],
            }
            const multiDuplicateGetters = {
              getEndpointById,
              getCircuitById,
              findCircuitForEndpoint,
              getTrunkDeviceById,
              getProtectionById,
              getCurrentProject: () => projectState.currentProject,
              getSupplyTrunkDeviceIndex: (id: string) =>
                currentInstallation?.mainSupply?.supplyTrunkDevices?.findIndex(
                  (d: { id: string }) => d.id === id
                ) ?? -1,
              getGroundTrunkDeviceIndex: (id: string) =>
                currentProject
                  ? findGroundTrunkDeviceOwner(
                      getProjectElectricalPanels(currentProject),
                      currentInstallation,
                      id
                    )?.index ?? -1
                  : -1,
            }
            const multiDuplicateActions = {
              duplicateProtection: (protectionId: string) => duplicateProtection({ protectionId, ownerDocument: window.document }),
              setSelection,
            }
            if (canDuplicateEendraadSelection(endpointOnlySelection, multiDuplicateGetters)) {
              items.push({
                label: t('contextMenu.duplicate'),
                onClick: () =>
                  doEendraadDuplicate(
                    endpointOnlySelection,
                    multiDuplicateGetters,
                    multiDuplicateActions
                  ),
              })
            }
            items.push({
              label: t('contextMenu.moveToFloor'),
              onClick: () => {
                const ids = [...endpointIds]
                const hasAnyNotOnActive =
                  !!activeFloorId &&
                  ids.some((id) => {
                    const ep = getEndpointById(id)
                    return ep && !ep.placements.some((p: Placement) => p.floorId === activeFloorId)
                  })
                const listHighlightFloorId = hasAnyNotOnActive ? activeFloorId : null
                openDialog({
                  type: 'custom',
                  title: t('contextMenu.moveToFloor'),
                  content: (
                    createElement(FloorSelectionDialog, { currentFloorId: activeFloorId, listHighlightFloorId: listHighlightFloorId, onSelect: (floorId) => {
                        applyEendraadEndpointsToFloor(ids, floorId)
                        closeDialog()
                      }, onCancel: closeDialog })
                  ),
                })
              },
            })
            items.push({ label: '', onClick: () => {}, separator: true })
          }

          items.push({
            label: t('contextMenu.deleteAll'),
            onClick: () => {
              const runBulkDelete = (preserveLinkedPanels = false) => {
                const doDeletePanels = () => {
                  deleteProjectEntities(resolveSelectionDeleteRefs(selection, 'oneWire'), { preserveLinkedPanels, onDeleted: clearSelection })
                }
                if (panelIds.length > 0) {
                  const lastMainPanels = panelIds.filter((id) => id && isLastMainPanelCallback(id))
                  const selectedPanels = panelIds
                    .map((id) => (id ? getPanelById(id) : null))
                    .filter((panel): panel is Panel => panel !== null && panel !== undefined)
                  const mainPanels = selectedPanels.filter((panel) => panel.isMain)
                  const panelsWithContent = selectedPanels.filter(panelHasContent)
                  if (lastMainPanels.length > 0) {
                    const panelNames = lastMainPanels
                      .map((id) => (id ? getPanelById(id)?.name : null))
                      .filter((name): name is string => name !== null)
                      .join(', ')
                    openDialog({
                      type: 'info',
                      title: t('panel.deleteBlockedTitle', 'Cannot delete main panel'),
                      message: t('panel.deleteLastMainMessage', {
                        panelNames,
                        defaultValue: `Main panel "${panelNames}" cannot be deleted.`,
                      }),
                      variant: 'warning',
                      confirmLabel: t('common.ok', 'OK'),
                    })
                  } else if (mainPanels.length > 0) {
                    const panelNames = selectedPanels.map((panel) => panel.name).join(', ')
                    openDialog({
                      type: 'confirm',
                      title: t('panel.deleteConfirmTitle', 'Delete Panels?'),
                      message: t('panel.deleteMainConfirmMessage', {
                        panelNames,
                        defaultValue: `Delete main panel(s) "${panelNames}"? The selected panels and their contents will be removed. You can undo this action.`,
                      }),
                      variant: 'warning',
                      confirmLabel: t('common.delete'),
                      cancelLabel: t('common.cancel'),
                      onConfirm: doDeletePanels,
                    })
                  } else if (panelsWithContent.length > 0) {
                    const panelNames = panelsWithContent.map((p: Panel) => p.name).join(', ')
                    openDialog({
                      type: 'confirm',
                      title: t('panel.deleteConfirmTitle', 'Delete Panels?'),
                      message: t('panel.deleteConfirmMessage', {
                        panelNames,
                        defaultValue: `The following panel(s) contain circuits, protections, or sub-panels: ${panelNames}\n\nDeleting them will also delete all their contents. You can undo this action.\n\nAre you sure you want to continue?`,
                      }),
                      variant: 'warning',
                      confirmLabel: t('common.delete'),
                      cancelLabel: t('common.cancel'),
                      onConfirm: doDeletePanels,
                    })
                  } else doDeletePanels()
                } else {
                  doDeletePanels()
                }
              }

              const linkedPanelNames = linkedSubPanelDisplayNamesForProtectionIds(
                projectState.currentProject,
                getPanelById,
                protectionIds
              )
              const executeBulkDelete = () => {
                if (linkedPanelNames.length > 0) {
                  openDialog(
                    createLinkedProtectionDeleteDialog({
                      t,
                      panelNames: linkedPanelNames.join(', '),
                      onDeletePanel: () => runBulkDelete(false),
                      onDeleteProtection: () => runBulkDelete(true),
                    })
                  )
                } else {
                  runBulkDelete()
                }
              }
              if (hasGroundSelected) {
                confirmDeleteEarthing({ onConfirmed: executeBulkDelete, deleteOnConfirm: false })
              } else {
                executeBulkDelete()
              }
            },
            variant: 'danger',
          })
        }
      } else if (resolvedElementId) {
        // Single element context menu - check if it's a protection device, panel, or endpoint
        let protection = getProtectionById(resolvedElementId)

        // Fallback: if not found, check layout elements to find protection by ID
        if (!protection && layout) {
          for (const panelLayout of layout.panels) {
            const layoutElement = panelLayout.elements.find(
              (e) =>
                (e.type === 'protection' || e.type === 'rcd') &&
                e.protectionId === resolvedElementId
            )
            if (layoutElement?.protectionId) {
              protection = getProtectionById(layoutElement.protectionId)
              if (protection) break
            }
          }
        }

        const isProtectionSelected =
          selection.type === 'protection' && selection.ids.includes(resolvedElementId)
        const isPanelSelected =
          selection.type === 'panel' && selection.ids.includes(resolvedElementId)
        const isGroundSelected =
          selection.type === 'ground' && selection.ids.includes(resolvedElementId)
        const annotationDeleteTarget = resolveEendraadAnnotationDeleteTarget(
          selection,
          resolvedElementId,
          {
            getEendraadNoteById,
            getSitplanNoteById,
            getFrameById,
          }
        )

        // Also check if resolvedElementId is a protection ID by checking panel protections directly
        if (!protection && currentProject) {
          for (const panel of getProjectElectricalPanels(currentProject)) {
            const foundProtection = panel.protections.find(
              (p: ProtectionDevice) => p.id === resolvedElementId
            )
            if (foundProtection) {
              protection = foundProtection
              break
            }
            const checkSubPanels = (subPanels: Panel[]): ProtectionDevice | undefined => {
              for (const subPanel of subPanels) {
                const found = subPanel.protections.find(
                  (p: ProtectionDevice) => p.id === resolvedElementId
                )
                if (found) return found
                const subFound = checkSubPanels(subPanel.subPanels)
                if (subFound) return subFound
              }
              return undefined
            }
            const subFound = checkSubPanels(panel.subPanels)
            if (subFound) {
              protection = subFound
              break
            }
          }
        }

        if (isPanelSelected) {
          // Panel context menu
          const panel = getPanelById(resolvedElementId)
          const panelEndpoint = panel
            ? panel.circuits
                .flatMap((c) => c.endpoints ?? [])
                .find(
                  (e) =>
                    e.symbol === 'panel_distribution' &&
                    (e.panelId === panel.id || e.label === panel.name)
                )
            : undefined
          items.push(
            ...addElementAndNoteItems,
            ...(panelEndpoint
              ? [
                  {
                    label: t('contextMenu.moveToFloor'),
                    onClick: () => {
                      const ep = getEndpointById(panelEndpoint.id)
                      if (!ep) return
                      const hasPlacementOnActiveFloor =
                        !!activeFloorId &&
                        ep.placements.some((p: { floorId: string }) => p.floorId === activeFloorId)
                      const listHighlightFloorId =
                        activeFloorId && !hasPlacementOnActiveFloor ? activeFloorId : null
                      openDialog({
                        type: 'custom',
                        title: t('contextMenu.moveToFloor'),
                        content: (
                          createElement(FloorSelectionDialog, { currentFloorId: activeFloorId, listHighlightFloorId: listHighlightFloorId, onSelect: (floorId) => {
                              applyEendraadEndpointsToFloor([panelEndpoint.id], floorId)
                              closeDialog()
                            }, onCancel: closeDialog })
                        ),
                      })
                    },
                  },
                  { label: '', onClick: () => {}, separator: true },
                ]
              : []),
            {
              label: t('contextMenu.copy'),
              onClick: () => setEendraadClipboard({ type: 'panel', ids: [resolvedElementId!] }),
            },
            {
              label: t('contextMenu.cut'),
              onClick: () => {
                setEendraadClipboard({ type: 'panel', ids: [resolvedElementId!] })
                deletePanel(resolvedElementId!)
                clearSelection()
              },
            },
            { label: '', onClick: () => {}, separator: true },
            {
              label: t('contextMenu.delete'),
              icon: getContextMenuIcon('delete'),
              onClick: () => {
                if (!panel) {
                  deletePanel(resolvedElementId!)
                  clearSelection()
                  return
                }

                // Check if this is the last main panel
                if (isLastMainPanelCallback(resolvedElementId!)) {
                  openDialog({
                    type: 'info',
                    title: t('panel.deleteBlockedTitle', 'Cannot delete main panel'),
                    message: t('panel.deleteLastMainMessage', {
                      panelNames: panel.name,
                      defaultValue: `Main panel "${panel.name}" cannot be deleted.`,
                    }),
                    variant: 'warning',
                    confirmLabel: t('common.ok', 'OK'),
                  })
                } else if (panel.isMain) {
                  openDialog({
                    type: 'confirm',
                    title: t('panel.deleteConfirmTitle', 'Delete Panel?'),
                    message: t('panel.deleteMainConfirmMessage', {
                      panelNames: panel.name,
                      defaultValue: `Delete main panel "${panel.name}"? The panel and its contents will be removed. You can undo this action.`,
                    }),
                    variant: 'warning',
                    confirmLabel: t('common.delete'),
                    cancelLabel: t('common.cancel'),
                    onConfirm: () => {
                      deletePanel(resolvedElementId!)
                      clearSelection()
                    },
                  })
                } else if (panelHasContent(panel)) {
                  openDialog({
                    type: 'confirm',
                    title: t('panel.deleteConfirmTitle', 'Delete Panel?'),
                    message: t('panel.deleteConfirmMessage', {
                      panelNames: panel.name,
                      defaultValue: `The panel "${panel.name}" contains circuits, protections, or sub-panels.\n\nDeleting it will also delete all its contents. You can undo this action.\n\nAre you sure you want to continue?`,
                    }),
                    variant: 'warning',
                    confirmLabel: t('common.delete'),
                    cancelLabel: t('common.cancel'),
                    onConfirm: () => {
                      deletePanel(resolvedElementId!)
                      clearSelection()
                    },
                  })
                } else {
                  openDialog({
                    type: 'confirm',
                    title: t('panel.deleteConfirmTitle', 'Delete Panel?'),
                    message: t('panel.deleteEmptyPanelMessage', {
                      panelNames: panel.name,
                      defaultValue: `Are you sure you want to delete panel "${panel.name}"?\n\nThis will also remove any associated frames and nested panels. You can undo this action.`,
                    }),
                    variant: 'warning',
                    confirmLabel: t('common.delete'),
                    cancelLabel: t('common.cancel'),
                    onConfirm: () => {
                      deletePanel(resolvedElementId!)
                      clearSelection()
                    },
                  })
                }
              },
              variant: 'danger',
            }
          )
        } else if (protection || isProtectionSelected) {
          const protectionContextIds =
            selection.type === 'protection' && selection.ids.includes(resolvedElementId)
              ? selection.ids
              : [resolvedElementId]
          const secondaryBusEjectSelection = resolveSecondaryBusEjectSelection(
            currentProject,
            protectionContextIds.filter((id): id is string => !!id)
          )
          const getters = {
            getEndpointById,
            getCircuitById,
            findCircuitForEndpoint,
            getTrunkDeviceById,
            getProtectionById,
            getPanelForProtection,
            getCircuitsByPanel,
            getCurrentProject: () => projectState.currentProject,
            getSupplyTrunkDeviceIndex: (id: string) =>
              currentInstallation?.mainSupply?.supplyTrunkDevices?.findIndex(
                (d: { id: string }) => d.id === id
              ) ?? -1,
            getGroundTrunkDeviceIndex: (id: string) =>
              currentProject
                ? findGroundTrunkDeviceOwner(
                    getProjectElectricalPanels(currentProject),
                    currentInstallation,
                    id
                  )?.index ?? -1
                : -1,
          }
          const actions = {
            duplicateProtection: (protectionId: string) => duplicateProtection({ protectionId, ownerDocument: window.document }),
            setSelection,
          }
          items.push(
            ...addElementAndNoteItems,
            ...(canDuplicateEendraadSelection(selection, getters)
              ? [
                  {
                    label: t('contextMenu.duplicate'),
                    onClick: () => doEendraadDuplicate(selection, getters, actions),
                  },
                ]
              : []),
            ...(selection.type === 'protection' &&
            selection.ids.length === 1 &&
            selection.ids[0] === resolvedElementId
              ? [
                  ...(secondaryBusEjectSelection
                    ? [
                        {
                          label: t('contextMenu.moveProtectionToNewPanel'),
                          onClick: async () => {
                            const outcome = runProjectCommand('panel.ejectSecondaryBusProtections', {
                              protectionIds: secondaryBusEjectSelection.protectionIds,
                              planPlacement: getEjectPlanPlacement(),
                            })
                            const newId = outcome?.results[0]?.created.find((ref) => ref.kind === 'panel')?.id
                            if (newId) {
                              setActivePanelId(newId)
                              setLiveSelection({ type: 'panel', ids: [newId] })
                            }
                          },
                        },
                      ]
                    : []),
                  { label: '', onClick: () => {}, separator: true },
                ]
              : []),
            ...(secondaryBusEjectSelection &&
            !(
              selection.type === 'protection' &&
              selection.ids.length === 1 &&
              selection.ids[0] === resolvedElementId
            )
              ? [
                  {
                    label: t('contextMenu.moveProtectionToNewPanel'),
                    onClick: async () => {
                      const outcome = runProjectCommand('panel.ejectSecondaryBusProtections', {
                        protectionIds: secondaryBusEjectSelection.protectionIds,
                        planPlacement: getEjectPlanPlacement(),
                      })
                      const newId = outcome?.results[0]?.created.find((ref) => ref.kind === 'panel')?.id
                      if (newId) {
                        setActivePanelId(newId)
                        setLiveSelection({ type: 'panel', ids: [newId] })
                      }
                    },
                  },
                  { label: '', onClick: () => {}, separator: true },
                ]
              : []),
            {
              label: t('contextMenu.delete'),
              icon: getContextMenuIcon('delete'),
              onClick: () => {
                const protectionId = resolvedElementId!
                const runDelete = (preserveLinkedPanels = false) => {
                  deleteProtection(protectionId, { preserveLinkedPanels })
                  clearSelection()
                }
                const linkedNames = linkedSubPanelDisplayNamesForProtectionIds(
                  currentProject,
                  getPanelById,
                  [protectionId]
                )
                if (linkedNames.length > 0) {
                  openDialog(
                    createLinkedProtectionDeleteDialog({
                      t,
                      panelNames: linkedNames.join(', '),
                      onDeletePanel: () => runDelete(false),
                      onDeleteProtection: () => runDelete(true),
                    })
                  )
                } else {
                  runDelete()
                }
              },
              variant: 'danger',
            }
          )
        } else if (isGroundSelected || isGroundElementId(resolvedElementId)) {
          // Ground symbol context menu
          items.push(...addElementAndNoteItems, {
            label: t('contextMenu.delete'),
            icon: getContextMenuIcon('delete'),
            onClick: () => confirmDeleteEarthing({ groundElementId: resolvedElementId }),
            variant: 'danger',
          })
        } else if (selection.type === 'supply' && selection.ids.includes('supply')) {
          // Supply symbol context menu (supply can't be deleted or duplicated)
        } else if (selection.type === 'trunkDevice' && selection.ids.includes(resolvedElementId)) {
          // Trunk device context menu (energy meter, protection on wire)
          const trunkResult = getTrunkDeviceById(resolvedElementId!)
          const trunkDevice = trunkResult?.device
          const supportsDeviceMultiplier = supportsSupplyDeviceMultiplier(trunkDevice)
          let panelIdForFrame: string | undefined
          if (layout) {
            for (const panelLayout of layout.panels) {
              if (
                (panelLayout as PanelLayoutWithElements).elements?.some(
                  (el) => el.type === 'trunkDevice' && el.trunkDeviceId === resolvedElementId
                )
              ) {
                panelIdForFrame = panelLayout.panel.id
                break
              }
            }
          }
          items.push(
            ...addElementAndNoteItems,
            ...(supportsDeviceMultiplier && trunkDevice
              ? [
                  {
                    label: t('contextMenu.addMore', 'Add more...'),
                    onClick: () => openSupplyDeviceAddMoreDialog(trunkDevice, t),
                  },
                ]
              : []),
            ...(panelIdForFrame && currentProject
              ? [
                  {
                    label: t('contextMenu.addFrame', 'Add Frame'),
                    onClick: () => {
                      const fields = buildFrameFieldsFromClassifiedSelection(
                        {
                          protectionIds: [],
                          endpointIds: [],
                          trunkDeviceIds: [resolvedElementId!],
                          hasGround: false,
                        },
                        getTrunkDeviceById,
                        currentProject
                      )
                      const outcome = runProjectCommand('eendraad.createFrame', {
                        panelId: panelIdForFrame!, fields,
                      }, { source: 'one-wire-context-menu' })
                      const frameId = outcome?.results[0]?.created[0]?.id
                      if (frameId) setLiveSelection({ type: 'frame', ids: [frameId] })
                    },
                  },
                  { label: '', onClick: () => {}, separator: true },
                ]
              : []),
            {
              label: t('contextMenu.delete'),
              icon: getContextMenuIcon('delete'),
              onClick: () => {
                if (trunkResult) {
                  const { device, circuit, isSupplyDevice, isGroundDevice } = trunkResult
                  const performDelete = () => {
                    if (isSupplyDevice) {
                      confirmDeleteSupplyTrunkDevice(resolvedElementId!)
                    } else if (isGroundDevice) {
                      deleteGroundTrunkDevice(resolvedElementId!)
                    } else if (circuit) {
                      deleteTrunkDevice(circuit.id, resolvedElementId!)
                    }
                    clearSelection()
                  }

                  // If this is a rectifier on a circuit that feeds DC-only endpoints, warn and cascade delete them.
                  if (device.symbol === 'rectifier' && circuit && circuit.endpoints?.length) {
                    const dcEndpoints = circuit.endpoints.filter(
                      (ep: Endpoint) => ep.symbol === 'solar_panel' || ep.symbol === 'battery'
                    )
                    if (dcEndpoints.length > 0) {
                      openDialog({
                        type: 'confirm',
                        title: t('wires.deleteRectifierWithDcDevicesTitle', {
                          defaultValue: 'Delete rectifier and DC devices?',
                        }),
                        message: t('wires.deleteRectifierWithDcDevicesMessage', {
                          defaultValue:
                            'This rectifier feeds {{count}} DC-only device(s) (solar panels / batteries). Deleting it will also delete those devices. Do you want to continue?',
                          count: dcEndpoints.length,
                        }),
                        variant: 'warning',
                        confirmLabel: t('common.delete'),
                        cancelLabel: t('common.cancel'),
                        onConfirm: () => {
                          performDelete()
                        },
                      })
                      return
                    }
                  }

                  performDelete()
                } else {
                  clearSelection()
                }
              },
              variant: 'danger',
            }
          )
        } else if (hasEendraadAnnotationDeleteTarget(annotationDeleteTarget)) {
          // Note/frame context menu (resolved by actual item id, not only selection type).
          items.push(...addElementAndNoteItems, {
            label: t('contextMenu.delete'),
            icon: getContextMenuIcon('delete'),
            onClick: () => {
              deleteProjectEntities([
                ...annotationDeleteTarget.eendraadNoteIds.map((id) => ({ kind: 'note' as const, id, scope: 'oneWire' as const })),
                ...annotationDeleteTarget.sitplanNoteIds.map((id) => ({ kind: 'note' as const, id, scope: 'sitplan' as const })),
                ...annotationDeleteTarget.frameIds.map((id) => ({ kind: 'frame' as const, id })),
              ], { onDeleted: clearSelection })
            },
            variant: 'danger',
          })
        } else if (!getEndpointById(resolvedElementId)) {
          // Wires, busbars, bus sections and other derived items are implicit: they
          // disappear with the symbols that create them, so offer no Delete here.
          items.push(...addElementAndNoteItems)
        } else {
          // Endpoint context menu
          const endpoint = getEndpointById(resolvedElementId!)
          const supportsAddMore =
            !!endpoint && (endpointSupportsMultiplier(endpoint) || endpoint.type === 'socket')
          // The store refuses to delete the main panel's distribution symbol.
          const canDeleteEndpoint =
            !!endpoint &&
            !(currentProject && isMainPanelDistributionEndpoint(currentProject, endpoint))
          items.push(
            ...addElementAndNoteItems,
            {
              label: t('contextMenu.moveToFloor'),
              onClick: () => {
                const endpointId = resolvedElementId!
                const ep = getEndpointById(endpointId)
                if (!ep) return
                const hasPlacementOnActiveFloor =
                  !!activeFloorId &&
                  ep.placements.some((p: Placement) => p.floorId === activeFloorId)
                const listHighlightFloorId =
                  activeFloorId && !hasPlacementOnActiveFloor ? activeFloorId : null
                openDialog({
                  type: 'custom',
                  title: t('contextMenu.moveToFloor'),
                  content: (
                    createElement(FloorSelectionDialog, { currentFloorId: activeFloorId, listHighlightFloorId: listHighlightFloorId, onSelect: (floorId) => {
                        applyEendraadEndpointsToFloor([endpointId], floorId)
                        closeDialog()
                      }, onCancel: closeDialog })
                  ),
                })
              },
            },
            ...(canDuplicateEendraadSelection(selection, {
              getEndpointById,
              getCircuitById,
              findCircuitForEndpoint,
              getTrunkDeviceById,
              getProtectionById,
              getCurrentProject: () => projectState.currentProject,
              getSupplyTrunkDeviceIndex: (id: string) =>
                currentInstallation?.mainSupply?.supplyTrunkDevices?.findIndex(
                  (d: { id: string }) => d.id === id
                ) ?? -1,
              getGroundTrunkDeviceIndex: (id: string) =>
                currentProject
                  ? findGroundTrunkDeviceOwner(
                      getProjectElectricalPanels(currentProject),
                      currentInstallation,
                      id
                    )?.index ?? -1
                  : -1,
            })
              ? [
                  {
                    label: t('contextMenu.duplicate'),
                    onClick: () => {
                      doEendraadDuplicate(
                        selection,
                        {
                          getEndpointById,
                          getCircuitById,
                          findCircuitForEndpoint,
                          getTrunkDeviceById,
                          getProtectionById,
                          getCurrentProject: () => projectState.currentProject,
                          getSupplyTrunkDeviceIndex: (id: string) =>
                            currentInstallation?.mainSupply?.supplyTrunkDevices?.findIndex(
                              (d: { id: string }) => d.id === id
                            ) ?? -1,
                          getGroundTrunkDeviceIndex: (id: string) =>
                            currentProject
                              ? findGroundTrunkDeviceOwner(
                                  getProjectElectricalPanels(currentProject),
                                  currentInstallation,
                                  id
                                )?.index ?? -1
                              : -1,
                        },
                        {
                          duplicateProtection: (protectionId: string) => duplicateProtection({ protectionId, ownerDocument: window.document }),
                          setSelection,
                        }
                      )
                    },
                  },
                ]
              : []),
            ...(supportsAddMore
              ? [
                  {
                    label: t('contextMenu.addMore', 'Add more...'),
                    onClick: () => {
                      if (!endpoint) return
                      openAddMoreDialogForEndpoint(endpoint, t)
                    },
                  },
                ]
              : []),
            ...(canDeleteEndpoint
              ? [
                  { label: '', onClick: () => {}, separator: true },
                  {
                    label: t('contextMenu.delete'),
                    icon: getContextMenuIcon('delete'),
                    onClick: () => {
                      deleteEndpoint(resolvedElementId!)
                      clearSelection()
                    },
                    variant: 'danger' as const,
                  },
                ]
              : [])
          )
        }
      } else {
        // Right-click on empty space with no selection
        items.push(
          {
            label: t('contextMenu.addElement'),
            icon: getContextMenuIcon('addElement'),
            onClick: () => setAddElementDropPosition(_position),
          },
          {
            label: t('contextMenu.addNote'),
            icon: getContextMenuIcon('addNote'),
            onClick: () => {
            const outcome = runProjectCommand('annotation.createNote', {
              scope: 'oneWire', pos: _position,
            }, { source: 'one-wire-context-menu' })
            const noteId = outcome?.results[0]?.created[0]?.id
            if (noteId) setLiveSelection({ type: 'note', ids: [noteId] })
            },
          }
        )
      }

      while (items.length > 0 && items[items.length - 1]?.separator) items.pop()
      return items
    },
    [
      t,
      getEjectPlanPlacement,
      window.document,
      isLastMainPanelCallback,
      setEendraadClipboard,
      setAddElementDropPosition,
      currentProject,
      layout,
      wireSegments,
      setSelection,
      currentInstallation,
      viewportUI,
    ]
  )

  useEffect(() => {
    contextMenuItemsResolverRef.current = handleGetContextMenuItems
  }, [handleGetContextMenuItems])

  const handleEendraadContextMenu = useCallback(
    (position: Point, elementId: string | null) => {
      if (eendraadDateMarkingMode) {
        exitDateMarkingMode()
        return []
      }
      /* @vision-scan-strip-start */
      if (isElectricalVisionScanEnabled() && elementId) {
        const { documentId } = parseOneWireReferenceItemId(elementId)
        const reference = useProjectStore
          .getState()
          .currentProject?.assets.find((asset) => asset.id === documentId)?.document?.oneWire
        if (reference) {
          if (!canEditProject) return []
          return [
            {
              label: t('oneWireReference.remove', 'Remove from one-wire'),
              icon: getContextMenuIcon('delete'),
              variant: 'danger' as const,
              onClick: () => removeOneWireReferenceItems([elementId]),
            },
          ]
        }
      }
      /* @vision-scan-strip-end */
      const items = withJunctionEditorItem(handleGetContextMenuItems(position, elementId), [
        elementId ?? viewportUI.getState().selection.ids[0],
      ])
      if (!canEditProject || !canDragItems) return items
      // Dragged metadata cards can return to automatic placement. Card owners are
      // part of the card's selection, so check the selection and the hit element.
      const { getEndpointById, getTrunkDeviceById } = useProjectStore.getState()
      const candidateIds = new Set([
        ...viewportUI.getState().selection.ids,
        ...(elementId ? [elementId] : []),
      ])
      const movedOwners = [...candidateIds].flatMap((id): MetadataCalloutOwnerRef[] => {
        const owner: MetadataCalloutOwnerRef | null = getEndpointById(id)
          ? { type: 'endpoint', id }
          : getTrunkDeviceById(id)
            ? { type: 'trunkDevice', id }
            : null
        return owner && getStoredMetadataCalloutOffset(owner) ? [owner] : []
      })
      if (movedOwners.length === 0) return items
      const resetItem: ContextMenuItem = {
        label: t('contextMenu.resetCardPosition'),
        onClick: () => clearMetadataCalloutOffsets(movedOwners),
      }
      const firstDangerIndex = items.findIndex((item) => item.variant === 'danger')
      if (firstDangerIndex < 0) return [...items, resetItem]
      const insertIndex =
        firstDangerIndex > 0 && items[firstDangerIndex - 1]?.separator
          ? firstDangerIndex - 1
          : firstDangerIndex
      return [...items.slice(0, insertIndex), resetItem, ...items.slice(insertIndex)]
    },
    [
      canDragItems,
      canEditProject,
      eendraadDateMarkingMode,
      exitDateMarkingMode,
      handleGetContextMenuItems,
      t,
      withJunctionEditorItem,
      viewportUI,
    ]
  )

  return handleEendraadContextMenu
}
