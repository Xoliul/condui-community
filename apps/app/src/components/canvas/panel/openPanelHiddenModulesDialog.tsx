import type { TFunction } from 'i18next'
import HiddenItemsDialog, { type HiddenItem } from '@/components/common/HiddenItemsDialog'
import { getSymbolById, getSymbolIconPath } from '@/lib/symbols'
import { useDialogStore } from '@/stores/dialogStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { editProperties } from '@/handlers/properties/editProperties'
import { collectPanelHiddenModuleEntries, type PanelHiddenDialogTarget } from '@/lib/panel/panelHiddenModules'
import {
  getPanelHiddenModulePresentation,
  getPanelModuleSelection,
} from './panelHiddenModulePresentation'

export type { PanelHiddenDialogTarget } from '@/lib/panel/panelHiddenModules'

interface OpenPanelHiddenModulesDialogOptions {
  showPanelName?: boolean
  title?: string
}

export function openPanelHiddenModulesDialog(
  targets: PanelHiddenDialogTarget[],
  t: TFunction,
  options: OpenPanelHiddenModulesDialogOptions = {}
): boolean {
  const store = useProjectStore.getState()
  const project = store.currentProject
  if (!project) return false

  const selectionByDialogId = new Map<string, { panelId: string; moduleKey: string }>()
  const items: HiddenItem[] = collectPanelHiddenModuleEntries(project, targets, store.getPanelHiddenModuleRefs)
    .map(({ panelId, panelName, ref, isGridPanel }) => {
      const item = getPanelHiddenModulePresentation(ref, project, t)
      const symbol = item.symbolId ? getSymbolById(item.symbolId) : undefined
      const dialogId = `${panelId}\u0000${item.key}`
      const selection = getPanelModuleSelection(ref)
      selectionByDialogId.set(dialogId, { panelId, moduleKey: item.key })
      const destinationName = isGridPanel ? t('panelCanvas.supplyPanel', 'Grid panel') : panelName
      const subtitle = [item.typeLabel, options.showPanelName ? destinationName : undefined]
        .filter(Boolean)
        .join(' · ')
      return {
        id: dialogId,
        label: item.label,
        subtitle: subtitle || undefined,
        icon: symbol ? (
          <img src={getSymbolIconPath(symbol)} alt="" className="h-7 w-7 object-contain dark:invert" />
        ) : undefined,
        onSelect: () => useUIStore.getState().setSelection(selection),
        onHoverChange: (hovered) => {
          if (hovered) useUIStore.getState().setHover(selection)
          else useUIStore.getState().clearHover()
        },
        selectAriaLabel: t('hiddenItemsDialog.selectSymbol', 'Select {{symbol}}', {
          symbol: item.label,
        }),
      }
    })

  const { openDialog, closeDialog } = useDialogStore.getState()
  openDialog({
    type: 'custom',
    title: options.title ?? t('hiddenItemsDialog.manageHidden', 'Manage hidden symbols'),
    content: (
      <HiddenItemsDialog
        items={items}
        description={t(
          'panelCanvas.showHiddenDescription',
          'Select one or more devices to show.'
        )}
        onConfirm={(selectedIds) => {
          const actions = selectedIds.flatMap((selectedId) => {
            const selected = selectionByDialogId.get(selectedId)
            return selected
              ? [
                  {
                    kind: 'panelModuleVisibility' as const,
                    panelId: selected.panelId,
                    moduleRefKey: selected.moduleKey,
                    visible: true,
                  },
                ]
              : []
          })
          if (actions.length) editProperties({ actions })
          useUIStore.getState().clearHover()
          closeDialog()
        }}
        onCancel={() => {
          useUIStore.getState().clearHover()
          closeDialog()
        }}
      />
    ),
  })
  return true
}
