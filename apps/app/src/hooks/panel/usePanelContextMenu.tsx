import { useCanvasWindow } from '@/components/viewport/ViewportContext'
import { useIsActiveViewport } from '@/components/viewport/ViewportUIStore'
import { deleteProjectEntities, resolveSelectionDeleteRefs } from '@/handlers/commands/deleteEntities'
import { editProperties } from '@/handlers/properties/editProperties'
import {
  deleteAuxiliaryEnclosures as deleteAuxiliaryEnclosuresLayout,
  dismissEmptySharedSupplyFrame,
} from '@/handlers/panel/editPanelLayout'
import { duplicateProtection } from '@/handlers/eendraad/duplicateProtection'
import { useCallback, useEffect } from 'react'
import type { TFunction } from 'i18next'
import type { ContextMenuItem } from '@/components/common/ContextMenu'
import { getContextMenuIcon } from '@/components/common/ContextMenuIcons'
import type { DialogConfig } from '@/stores/dialogStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { collectPanelHiddenModuleEntries, getGlobalPanelHiddenDialogTargets } from '@/lib/panel/panelHiddenModules'
import { linkedSubPanelDisplayNamesForProtectionIds } from '@/lib/panel/linkedSubPanelDeleteWarning'
import { createLinkedProtectionDeleteDialog } from '@/lib/panel/linkedProtectionDeleteDialog'
import { isEendraadDeleteKey } from '@/lib/eendraad/deleteKeyboardKey'
import { isKeyboardTypingTarget } from '@/lib/ui/keyboardTypingTarget'
import { panelGridModuleRefKey } from '@/lib/panel/panelGridLayout'
import { openPanelHiddenModulesDialog } from '@/components/canvas/panel/openPanelHiddenModulesDialog'
import { getSharedSupplyFrameDevices, SHARED_SUPPLY_FRAME_ID } from '@/lib/panel/sharedSupplyFrame'
import { isModularSocket } from '@/lib/socket/modularSocket'
import type { Panel, PanelGridModuleRef } from '@/types/schema'
import type { Point, Selection as CanvasSelection } from '@/types/ui'
import { isKeyboardOwnedByFloatingEditor } from '@/utils/keyboardOwner'

type ModuleItem = {
  ref: PanelGridModuleRef
  inSupplyPanel?: boolean
}

export function appendPanelShowHiddenMenuEntry(
  items: ContextMenuItem[],
  hasHiddenModules: boolean,
  item: ContextMenuItem
): void {
  if (items.length > 0) {
    items.push({ label: '', onClick: () => {}, separator: true })
  }
  items.push({ ...item, disabled: !hasHiddenModules })
}

export type PanelContext = {
  panel: Panel
  panelId: string
  modules: ModuleItem[]
  sharedSupplyRefKeys: Set<string>
}

type UsePanelContextMenuOptions = {
  canDeleteItems: boolean
  clearSelection: () => void
  effectiveActivePanelId: string | null
  ejectToSupplyPanel: ProjectState['ejectToSupplyPanel']
  getEndpointById: ProjectState['getEndpointById']
  getPanelHiddenModuleRefs: ProjectState['getPanelHiddenModuleRefs']
  getProtectionById: ProjectState['getProtectionById']
  getTrunkDeviceById: ProjectState['getTrunkDeviceById']
  hideModuleFromPanel: ProjectState['hideModuleFromPanel']
  modules: ModuleItem[]
  openDialog: (config: DialogConfig) => void
  panel: Panel | null
  returnFromSupplyPanel: ProjectState['returnFromSupplyPanel']
  resolvePanelContext?: (position: Point, elementId: string | null) => PanelContext | null
  selection: CanvasSelection
  setSupplyPanelVisible: ProjectState['setSupplyPanelVisible']
  sharedSupplyRefKeys: Set<string>
  t: TFunction
}

export function usePanelContextMenu({
  canDeleteItems,
  clearSelection,
  effectiveActivePanelId,
  ejectToSupplyPanel,
  getPanelHiddenModuleRefs,
  getTrunkDeviceById,
  hideModuleFromPanel,
  modules,
  openDialog,
  panel,
  returnFromSupplyPanel,
  resolvePanelContext,
  selection,
  setSupplyPanelVisible,
  sharedSupplyRefKeys,
  t,
}: UsePanelContextMenuOptions) {
  const window = useCanvasWindow()
  const isActiveViewport = useIsActiveViewport()
  const deleteAuxiliaryEnclosures = useCallback(
    (enclosureIds: string[]) => {
      deleteAuxiliaryEnclosuresLayout(enclosureIds)
      clearSelection()
    },
    [clearSelection]
  )

  const handleGetContextMenuItems = useCallback(
    (position: Point, elementId: string | null): ContextMenuItem[] => {
      const project = useProjectStore.getState().currentProject
      const globalTargets = project ? getGlobalPanelHiddenDialogTargets(project) : []
      const hasHiddenModules = project ? collectPanelHiddenModuleEntries(project, globalTargets, getPanelHiddenModuleRefs).length > 0 : false
      const showHiddenItem: ContextMenuItem = {
        label: t('contextMenu.showHidden', 'Show hidden…'),
        icon: getContextMenuIcon('showHidden'),
        onClick: () => {
          const current = useProjectStore.getState().currentProject
          if (current) openPanelHiddenModulesDialog(getGlobalPanelHiddenDialogTargets(current), t, {
            showPanelName: true,
            title: t('contextMenu.showHidden', 'Show hidden…'),
          })
        },
      }
      if (selection.type === 'supplyPanel' && selection.ids.includes(SHARED_SUPPLY_FRAME_ID)) {
        const items: ContextMenuItem[] = [{
          label: t('contextMenu.delete'),
          icon: getContextMenuIcon('delete'),
          variant: 'danger',
          disabled: !canDeleteItems || !project || getSharedSupplyFrameDevices(project).length > 0,
          onClick: () => {
            dismissEmptySharedSupplyFrame()
            clearSelection()
          },
        }]
        appendPanelShowHiddenMenuEntry(items, hasHiddenModules, showHiddenItem)
        return items
      }
      if (selection.type === 'auxiliaryEnclosure' && selection.ids.length > 0) {
        const items: ContextMenuItem[] = [
          {
            label: t('contextMenu.delete'),
            icon: getContextMenuIcon('delete'),
            variant: 'danger',
            onClick: () => deleteAuxiliaryEnclosures(selection.ids),
          },
        ]
        appendPanelShowHiddenMenuEntry(items, hasHiddenModules, showHiddenItem)
        return items
      }
      const resolvedContext = resolvePanelContext?.(position, elementId)
      const contextPanel = resolvedContext?.panel ?? panel
      const contextPanelId = resolvedContext?.panelId ?? effectiveActivePanelId
      const contextModules = resolvedContext?.modules ?? modules
      const contextSharedSupplyRefKeys = resolvedContext?.sharedSupplyRefKeys ?? sharedSupplyRefKeys
      if (!contextPanel || !contextPanelId) {
        const items: ContextMenuItem[] = []
        appendPanelShowHiddenMenuEntry(items, hasHiddenModules, showHiddenItem)
        return items
      }

      const items: ContextMenuItem[] = []

      const findModuleItemInList = (
        list: ModuleItem[],
        selType: typeof selection.type,
        entityId: string
      ): ModuleItem | undefined => {
        if (selType === 'protection') {
          return list.find((x) => x.ref.kind === 'protection' && x.ref.id === entityId)
        }
        if (selType === 'trunkDevice') {
          const matches = list.filter((x) => x.ref.kind === 'trunkDevice' && x.ref.id === entityId)
          return matches.find((x) => x.inSupplyPanel === true) ?? matches[0]
        }
        if (selType === 'endpoint') {
          return list.find((x) => x.ref.kind === 'domotica' && x.ref.endpointId === entityId)
        }
        return undefined
      }

      /** Shared supply / supply-strip modules live in {@link getPanelGridModules} for the owning main panel only. */
      const resolveModuleItemForPanelCanvas = (
        selType: typeof selection.type,
        entityId: string
      ): ModuleItem | undefined => {
        const m = findModuleItemInList(contextModules, selType, entityId)
        if (m) return m
        if (selType !== 'trunkDevice') return undefined
        const trunkInfo = getTrunkDeviceById(entityId)
        if (!trunkInfo?.isSupplyDevice) return undefined
        // Auxiliary modules are rendered by the hierarchy scene, outside panel selectors.
        return { ref: { kind: 'trunkDevice', id: entityId, scope: 'supply' }, inSupplyPanel: true }
      }

      // Multi-selection hide support (protections / trunk devices / domotica endpoints)
      const isMultiSelect =
        (selection.type === 'protection' ||
          selection.type === 'trunkDevice' ||
          selection.type === 'endpoint') &&
        selection.ids.length > 1

      if (isMultiSelect) {
        const moduleKeys = new Set<string>()
        const hideableKeys = new Set<string>()
        if (selection.type === 'protection') {
          for (const id of selection.ids) {
            const m = contextModules.find(
              (x: ModuleItem) => x.ref.kind === 'protection' && x.ref.id === id
            )
            if (m) {
              const key = panelGridModuleRefKey(m.ref)
              moduleKeys.add(key)
              hideableKeys.add(key)
            }
          }
        } else if (selection.type === 'trunkDevice') {
          for (const id of selection.ids) {
            const m = resolveModuleItemForPanelCanvas('trunkDevice', id)
            if (m) {
              const key = panelGridModuleRefKey(m.ref)
              moduleKeys.add(key)
              hideableKeys.add(key)
            }
          }
        } else if (selection.type === 'endpoint') {
          const getEndpointById = useProjectStore.getState().getEndpointById
          for (const id of selection.ids) {
            const m = contextModules.find(
              (x: ModuleItem) => x.ref.kind === 'domotica' && x.ref.endpointId === id
            )
            if (!m) continue
            const key = panelGridModuleRefKey(m.ref)
            moduleKeys.add(key)
            if (!isModularSocket(getEndpointById(id))) hideableKeys.add(key)
          }
        }

        for (const id of selection.ids) {
          const item = contextModules.find((candidate) => candidate.ref.kind === 'domotica' ? candidate.ref.endpointId === id : candidate.ref.id === id)
          if (!item) continue
          const key = panelGridModuleRefKey(item.ref)
          moduleKeys.add(key)
          if (item.ref.kind !== 'domotica' || !isModularSocket(useProjectStore.getState().getEndpointById(item.ref.endpointId))) hideableKeys.add(key)
        }

        if (moduleKeys.size > 0) {
          // Bottom section: Hide in this view + Delete (multi)
          items.push({ label: '', onClick: () => {}, separator: true })
          if (hideableKeys.size > 0) {
            items.push({
              label: t('contextMenu.hideInThisView', 'Hide in this view'),
              icon: getContextMenuIcon('hideInThisView'),
              onClick: () => {
                editProperties({ actions: [...hideableKeys].map((moduleRefKey) => ({ kind: 'panelModuleVisibility', panelId: contextPanelId, moduleRefKey, visible: false })) })
              },
            })
          }
          items.push(
            {
              label: t('contextMenu.deleteAll'),
              icon: getContextMenuIcon('delete'),
              onClick: () => {
                const store = useProjectStore.getState()
                const protectionIds = selection.ids.filter((id) => store.getProtectionById(id))
                const runBulkDelete = (preserveLinkedPanels = false) => {
                  deleteProjectEntities(resolveSelectionDeleteRefs(selection), { preserveLinkedPanels, onDeleted: clearSelection })
                }

                const linkedPanelNames = linkedSubPanelDisplayNamesForProtectionIds(
                  store.currentProject,
                  store.getPanelById,
                  protectionIds
                )
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
              },
              variant: 'danger',
            }
          )
        }
      } else {
        // Single element / panel context menu
        let key = elementId
        // Keyboard Delete passes the entity id (protection / trunk / endpoint), but lookups use
        // panelGridModuleRefKey(ref) which includes scope — resolve when key doesn't match a module.
        if (selection.ids.length === 1 && selection.ids[0]) {
          const id = selection.ids[0]
          const resolveKeyFromSelection = (): string | null => {
            const m = resolveModuleItemForPanelCanvas(selection.type, id)
            return m ? panelGridModuleRefKey(m.ref) : null
          }
          if (!key) {
            key = resolveKeyFromSelection() ?? key
          } else {
            const matchedByKey = contextModules.some(
              (m: ModuleItem) => panelGridModuleRefKey(m.ref) === key
            )
            if (!matchedByKey) {
              const resolved = resolveKeyFromSelection()
              if (resolved) key = resolved
            }
          }
        }

        if (!key) {
          if (elementId === contextPanel.id) {
            items.push({
              label: t('panelCanvas.hideSupplyPanel', 'Hide grid panel'),
              onClick: () => setSupplyPanelVisible(contextPanelId, false),
            })
          }
        } else {
          let mod = contextModules.find((m: ModuleItem) => panelGridModuleRefKey(m.ref) === key)
          if (!mod && selection.ids.length === 1 && selection.ids[0]) {
            mod = resolveModuleItemForPanelCanvas(selection.type, selection.ids[0])
          }
          if (mod) {
            const ref = mod.ref
            const inSupply = mod.inSupplyPanel === true
            const isSupplyScope = ref.kind === 'trunkDevice' && ref.scope === 'supply'
            if (
              contextPanel.isMain &&
              isSupplyScope &&
              !inSupply &&
              contextSharedSupplyRefKeys.has(panelGridModuleRefKey(ref))
            ) {
              items.push({
                label: t('panelCanvas.moveToSupplyPanel', 'Move to grid panel'),
                onClick: () => ejectToSupplyPanel(contextPanelId, ref),
              })
            }
            if (inSupply) {
              items.push({
                label: t('panelCanvas.moveToMainPanel', 'Move to main panel'),
                onClick: () => returnFromSupplyPanel(contextPanelId, ref),
              })
            }

            if (
              ref.kind === 'protection' &&
              selection.type === 'protection' &&
              selection.ids.length === 1 &&
              selection.ids[0] === ref.id
            ) {
              items.push({
                label: t('contextMenu.duplicate'),
                onClick: () => {
                  const newId = duplicateProtection({ protectionId: ref.id })
                  if (newId) {
                    useUIStore.getState().setSelection({ type: 'protection', ids: [newId] })
                  }
                },
              })
            }

            // Bottom section: Hide in this view + Delete for single module
            items.push({ label: '', onClick: () => {}, separator: true })
            const hideBlocked =
              ref.kind === 'domotica' &&
              isModularSocket(useProjectStore.getState().getEndpointById(ref.endpointId))
            if (!hideBlocked) {
              items.push({
                label: t('contextMenu.hideInThisView', 'Hide in this view'),
                icon: getContextMenuIcon('hideInThisView'),
                onClick: () => hideModuleFromPanel(contextPanelId, key!),
              })
            }
            items.push({
              label: t('contextMenu.delete'),
              icon: getContextMenuIcon('delete'),
              onClick: () => {
                const store = useProjectStore.getState()
                if (ref.kind === 'protection') {
                  const runDeleteProtection = (preserveLinkedPanels = false) => {
                    deleteProjectEntities([{ kind: 'protection', id: ref.id }], { preserveLinkedPanels, onDeleted: clearSelection })
                  }
                  const linkedNames = linkedSubPanelDisplayNamesForProtectionIds(
                    store.currentProject,
                    store.getPanelById,
                    [ref.id]
                  )
                  if (linkedNames.length > 0) {
                    openDialog(
                      createLinkedProtectionDeleteDialog({
                        t,
                        panelNames: linkedNames.join(', '),
                        onDeletePanel: () => runDeleteProtection(false),
                        onDeleteProtection: () => runDeleteProtection(true),
                      })
                    )
                  } else {
                    runDeleteProtection()
                  }
                } else if (ref.kind === 'domotica') {
                  deleteProjectEntities([{ kind: 'endpoint', id: ref.endpointId }], { onDeleted: clearSelection })
                } else if (ref.kind === 'trunkDevice') {
                  deleteProjectEntities([{ kind: 'trunkDevice', id: ref.id }], { onDeleted: clearSelection })
                }
              },
              variant: 'danger',
            })
          }
        }
      }

      // Keep the panel menu discoverable on empty space. When there is nothing to restore,
      // show the action disabled instead of returning an empty menu.
      appendPanelShowHiddenMenuEntry(items, hasHiddenModules, showHiddenItem)

      return items
    },
    [
      canDeleteItems,
      panel,
      effectiveActivePanelId,
      modules,
      selection,
      t,
      ejectToSupplyPanel,
      returnFromSupplyPanel,
      hideModuleFromPanel,
      setSupplyPanelVisible,
      getPanelHiddenModuleRefs,
      getTrunkDeviceById,
      openDialog,
      clearSelection,
      sharedSupplyRefKeys,
      resolvePanelContext,
      deleteAuxiliaryEnclosures,
    ]
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActiveViewport()) return
      if (!canDeleteItems) return
      if (!isEendraadDeleteKey(e)) return
      // A floating editor over the canvas (the junction editor) deletes its own selection.
      if (isKeyboardOwnedByFloatingEditor()) return

      if (isKeyboardTypingTarget(e.target)) return

      const effectiveSelection = useUIStore.getState().selection
      if (effectiveSelection.ids.length === 0) return
      if (effectiveSelection.type === 'auxiliaryEnclosure') {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        deleteAuxiliaryEnclosures(effectiveSelection.ids)
        return
      }

      const contextElementId =
        effectiveSelection.ids.length === 1 ? (effectiveSelection.ids[0] ?? null) : null
      const itemsForElement = handleGetContextMenuItems({ x: 0, y: 0 }, contextElementId)
      const itemsForSelection = handleGetContextMenuItems({ x: 0, y: 0 }, null)
      const pickDeleteItem = (list: ContextMenuItem[]) =>
        list.find(
          (item) =>
            !item.separator &&
            (item.label === t('contextMenu.deleteAll') || item.label === t('contextMenu.delete'))
        ) ?? list.find((item) => !item.separator && item.variant === 'danger')
      let deleteItem = pickDeleteItem(
        itemsForElement.length > 0 ? itemsForElement : itemsForSelection
      )
      if (!deleteItem && itemsForElement.length > 0) {
        deleteItem = pickDeleteItem(itemsForSelection)
      }
      if (!deleteItem || deleteItem.disabled) return

      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      deleteItem.onClick()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [canDeleteItems, deleteAuxiliaryEnclosures, handleGetContextMenuItems, isActiveViewport, t, window])

  return handleGetContextMenuItems
}
