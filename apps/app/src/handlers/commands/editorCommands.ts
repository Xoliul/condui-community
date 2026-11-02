import { useProjectStore } from '@/stores/projectStore'
import { resolveSelectionDeleteRefs, requestDeleteProjectEntities } from './deleteEntities'
import { createElement } from 'react'
import { useUIStore } from '@/stores/uiStore'
import { liveProjectSession, runProjectCommand } from '@/stores/liveProjectCommandSession'
import SitplanVisibilityPanel from '@/components/plan/SitplanVisibilityPanel'
import FloorSelectionDialog from '@/components/plan/FloorSelectionDialog'
import {
  hidePlanPlacementsOnActiveFloor,
  requestDeletePlanPlacements,
} from '@/handlers/plan/deletePlanPlacements'
import { useDialogStore } from '@/stores/dialogStore'
import i18n from '@/i18n'
import { planFloorDrawingConsumesTabRef } from '@/lib/plan/planFloorDrawingKeyboardGate'
import { planFloorDrawingUndoRef } from '@/lib/plan/planFloorDrawingUndo'
import { isTextLikeFocusTarget } from '@/lib/ui/blurFocusStealingActiveElement'
import { revealCanvas } from '@/lib/ui/revealCanvas'
import { isStructuralCanvasEnabled } from '@/lib/structuralCanvas/availability'
import { CommandPalette, COMMAND_PALETTE_DIALOG_ID } from '@/components/commands/CommandPalette'
import { ShortcutsDialog } from '@/components/shortcuts/ShortcutsDialog'
import type { CanvasType } from '@/types/ui'
import type { CommandRegistry } from '@/lib/commands/ui/registry'
import type { CommandContext, CommandDefinition } from '@/lib/commands/ui/types'
import { duplicateSelection } from './duplicateSelection'
import { fitView } from './fitView'
import { toggleViewportPanelFocus, zoomVisibleCanvases } from './viewport'
import { createProjectPaletteCommands } from './projectPaletteCommands'
import { openFindPanel } from './findPanel'
import { openMaterialListExport } from './exportMaterialList'
import { SettingsBuildInfo, SettingsPanel } from '@/components/settings/SettingsPanel'
import { openLabelSchemeDialog } from '@/handlers/eendraad/openLabelSchemeDialog'

const canEdit = (ctx: CommandContext) => ctx.capabilities.canEditProject

/** Panel the command acts on: under the pointer, else the one holding keyboard focus. */
const actionPanelIndex = (ctx: CommandContext) => ctx.pointerPanelIndex ?? ctx.targetPanelIndex

/** Gesture-local undo (floor drawing) first, then the project session history. */
function undo(): void {
  if (planFloorDrawingUndoRef.current?.tryUndo()) return
  liveProjectSession.undo()
}

function redo(): void {
  if (planFloorDrawingUndoRef.current?.tryRedo()) return
  liveProjectSession.redo()
}

function switchCanvas(ctx: CommandContext, canvas: CanvasType): boolean {
  const panelIndex = actionPanelIndex(ctx)
  if (panelIndex == null) {
    if (ctx.source !== 'palette') return false
    revealCanvas(canvas)
    return true
  }
  const ui = ctx.viewport?.ui ?? useUIStore
  const panel = ui.getState().viewportLayout.panels[panelIndex]
  if (!panel || panel.canvas === canvas) return false
  ui.getState().setPanelCanvas(panelIndex, canvas)
  return true
}

function openCommandPalette(registry: CommandRegistry, ctx: CommandContext): void {
  const { dialog, openDialog, closeDialog } = useDialogStore.getState()
  if (dialog?.id === COMMAND_PALETTE_DIALOG_ID) {
    closeDialog()
    return
  }
  openDialog({
    id: COMMAND_PALETTE_DIALOG_ID,
    type: 'custom',
    title: '',
    showCloseButton: false,
    size: 'lg',
    content: createElement(CommandPalette, {
      registry,
      context: { ...ctx, source: 'palette', event: undefined },
    }),
  }, ctx.viewport?.getOwnerWindow().document)
}

/** Situation-plan placements in the current selection. */
function selectedPlanPlacementIds(): string[] {
  const { selection } = useUIStore.getState()
  return selection.type === 'placement' ? selection.ids : []
}

function selectionDeleteRefs(ctx: CommandContext) {
  const ui = useUIStore.getState()
  const windowUI = ctx.viewport?.ui.getState() ?? ui
  const panelIndex = actionPanelIndex(ctx)
  const canvas =
    panelIndex == null ? windowUI.viewMode : windowUI.viewportLayout.panels[panelIndex]?.canvas
  return resolveSelectionDeleteRefs(ui.selection, canvas === 'plan' ? 'sitplan' : 'oneWire')
}

function canDeletePlanSelection(ctx: CommandContext): boolean {
  const refs = selectionDeleteRefs(ctx)
  if (!ctx.capabilities.canEditProject || refs.length === 0) return false
  try {
    return liveProjectSession.preview({
      id: 'entities.delete',
      input: { refs },
    }).check.ok
  } catch {
    return false
  }
}

function openMoveToFloorDialog(): void {
  const placementIds = selectedPlanPlacementIds()
  const { openDialog, closeDialog } = useDialogStore.getState()
  openDialog({
    type: 'custom',
    title: i18n.t('contextMenu.moveToFloor'),
    content: createElement(FloorSelectionDialog, {
      currentFloorId: useUIStore.getState().activeFloorId,
      onSelect: (floorId: string) => {
        runProjectCommand('plan.moveToFloor', {
          floorId,
          moves: placementIds.map((placementId) => ({ placementId })),
        })
        closeDialog()
      },
      onCancel: closeDialog,
    }),
  })
}

export function createEditorCommands(registry: CommandRegistry): CommandDefinition[] {
  return [
    {
      id: 'ui.exportMaterialList',
      labelKey: 'materialListExport.title',
      searchKey: 'materialListExport.searchAliases',
      isEnabled: () => useProjectStore.getState().currentProject != null,
      run: (ctx) => openMaterialListExport(ctx.viewport?.getOwnerWindow().document),
    },
    {
      id: 'ui.findPanel',
      labelKey: 'findPanel.title',
      keyLabels: ['ctrlCmdF'],
      keybindings: [{ key: 'f', mod: true }],
      isEnabled: () => useProjectStore.getState().currentProject != null,
      run: openFindPanel,
    },
    {
      id: 'ui.commandPalette',
      labelKey: 'shortcuts.entries.openCommandPalette.description',
      keyLabels: ['ctrlCmdK'],
      keybindings: [{ key: 'k', mod: true, whileTyping: true }],
      palette: false,
      run: (ctx) => openCommandPalette(registry, ctx),
    },
    {
      id: 'session.undo',
      labelKey: 'shortcuts.entries.undo.description',
      keyLabels: ['ctrlCmdZ'],
      keybindings: [{ key: 'z', mod: true, alt: 'any' }],
      isEnabled: canEdit,
      run: undo,
    },
    {
      id: 'session.redo',
      labelKey: 'shortcuts.entries.redo.description',
      keyLabels: ['ctrlCmdShiftZ', 'ctrlCmdY'],
      keybindings: [
        { key: 'z', mod: true, shift: true, alt: 'any' },
        { key: 'y', mod: true, shift: 'any', alt: 'any' },
      ],
      isEnabled: canEdit,
      run: redo,
    },
    ...createProjectPaletteCommands(),
    {
      id: 'ui.plan.colors',
      labelKey: 'sitplanVisibility.colors',
      isEnabled: (ctx) => canEdit(ctx) && !!useProjectStore.getState().currentProject,
      run: () => {
        revealCanvas('plan')
        useDialogStore.getState().openDialog({
          type: 'custom',
          title: i18n.t('sitplanVisibility.colors'),
          content: createElement(SitplanVisibilityPanel),
        })
      },
    },
    {
      id: 'ui.settings',
      labelKey: 'settings.title',
      searchKey: 'infoBlock.settingsSearch',
      isEnabled: canEdit,
      run: () => {
        useDialogStore.getState().openDialog({
          type: 'custom',
          title: i18n.t('settings.title'),
          titleAside: createElement(SettingsBuildInfo),
          content: createElement(SettingsPanel, { canEditProject: true }),
          size: 'md',
          showCloseButton: true,
        })
      },
    },
    {
      id: 'ui.eendraad.labelScheme',
      labelKey: 'canvas.eendraadNaming.scheme.dialogTitle',
      searchKey: 'canvas.eendraadNaming.scheme.searchAliases',
      isEnabled: (ctx) => canEdit(ctx) && !!useProjectStore.getState().currentProject,
      run: () => {
        revealCanvas('eendraad')
        openLabelSchemeDialog(i18n.t)
      },
    },
    {
      id: 'ui.plan.wiring',
      labelKey: 'planWiring.tool',
      isEnabled: (ctx) =>
        canEdit(ctx) &&
        !!useProjectStore.getState().currentProject &&
        !!useUIStore.getState().activeFloorId,
      run: () => {
        revealCanvas('plan')
        useUIStore.getState().setActivePlanTool('wiring')
      },
    },
    // Selection-aware bindings to project commands (ADR 0003).
    {
      id: 'entities.delete',
      labelKey: 'contextMenu.delete',
      isEnabled: canDeletePlanSelection,
      run: (ctx) => {
        if (useUIStore.getState().selection.type === 'placement') {
          requestDeletePlanPlacements({
            placementIds: selectedPlanPlacementIds(),
            t: i18n.t,
            onHide: hidePlanPlacementsOnActiveFloor,
            onDone: () => useUIStore.getState().clearSelection(),
          })
        } else
          requestDeleteProjectEntities(selectionDeleteRefs(ctx), i18n.t, () =>
            useUIStore.getState().clearSelection()
          )
      },
    },
    {
      id: 'plan.moveToFloor',
      labelKey: 'contextMenu.moveToFloor',
      isEnabled: (ctx) => canEdit(ctx) && selectedPlanPlacementIds().length > 0,
      run: openMoveToFloorDialog,
    },
    {
      id: 'edit.duplicate',
      labelKey: 'shortcuts.entries.duplicate.description',
      keyLabels: ['ctrlCmdD'],
      keybindings: [{ key: 'd', mod: true, alt: 'any' }],
      isEnabled: canEdit,
      // Keyboard: always swallow Ctrl+D so the browser does not open its bookmark dialog.
      run: (ctx) => {
        duplicateSelection(actionPanelIndex(ctx))
      },
    },
    {
      id: 'ui.panels.toggleLibrary',
      labelKey: 'shortcuts.entries.toggleLibrary.description',
      keyLabels: ['ctrlCmdL'],
      keybindings: [{ key: 'l', mod: true, shift: 'any', alt: 'any', whileTyping: true }],
      isEnabled: (ctx) => ctx.capabilities.canPlaceSymbols,
      run: (ctx) => (ctx.viewport?.ui ?? useUIStore).getState().togglePanel('library'),
    },
    {
      id: 'ui.panels.toggleProperties',
      labelKey: 'shortcuts.entries.toggleProperties.description',
      keyLabels: ['ctrlCmdP'],
      keybindings: [{ key: 'p', mod: true, shift: 'any', alt: 'any', whileTyping: true }],
      run: (ctx) => (ctx.viewport?.ui ?? useUIStore).getState().togglePanel('properties'),
    },
    {
      id: 'ui.panels.toggleDock',
      labelKey: 'shortcuts.entries.toggleDockPanels.description',
      keyLabels: ['tab'],
      keybindings: [{ key: 'Tab', shift: 'any', whileTyping: true }],
      run: (ctx) => {
        if (ctx.source === 'keyboard') {
          if (planFloorDrawingConsumesTabRef.current) return false
          if (
            isTextLikeFocusTarget(
              (ctx.viewport?.getOwnerWindow().document ?? document).activeElement
            )
          )
            return false
          if (ctx.pointerPanelIndex == null) return false
        }
        const ui = ctx.viewport?.ui ?? useUIStore
        ui.getState().toggleMainDockPanelsCollapse()
        return true
      },
    },
    {
      id: 'ui.closeFloatingWindows',
      labelKey: 'shortcuts.entries.closeFloatingWindows.description',
      keyLabels: ['esc'],
      keybindings: [{ key: 'Escape', shift: 'any', whileTyping: true }],
      palette: false,
      run: () => useUIStore.getState().closeFloatingWindows(),
    },
    {
      id: 'ui.viewport.focusPanel',
      labelKey: 'shortcuts.entries.focusViewport.description',
      keyLabels: ['space'],
      keybindings: [{ key: ' ', code: 'Space' }],
      run: (ctx) => {
        const target = ctx.event?.target
        if ((target as Element | null)?.nodeType === 1 && (target as Element).closest('button'))
          return false
        toggleViewportPanelFocus(actionPanelIndex(ctx), ctx.viewport)
        return true
      },
    },
    {
      id: 'ui.viewport.fit',
      labelKey: 'shortcuts.entries.fitView.description',
      keyLabels: ['f'],
      keybindings: [{ key: 'f' }],
      run: (ctx) =>
        fitView({
          viewport: ctx.viewport,
          panelIndex: actionPanelIndex(ctx),
          pointerPanelIndex: ctx.pointerPanelIndex,
          canEditProject: ctx.capabilities.canEditProject,
        }),
    },
    {
      id: 'ui.viewport.zoomIn',
      labelKey: 'shortcuts.entries.zoomIn.description',
      keyLabels: ['plus', 'equals'],
      keybindings: [{ key: '+' }, { key: '=' }],
      run: (ctx) => zoomVisibleCanvases('in', ctx.viewport),
    },
    {
      id: 'ui.viewport.zoomOut',
      labelKey: 'shortcuts.entries.zoomOut.description',
      keyLabels: ['minus'],
      keybindings: [{ key: '-' }],
      run: (ctx) => zoomVisibleCanvases('out', ctx.viewport),
    },
    {
      id: 'ui.viewport.showEendraad',
      labelKey: 'shortcuts.entries.switchToEendraadCanvas.description',
      keyLabels: ['f1'],
      keybindings: [{ key: 'F1', whileTyping: true }],
      run: (ctx) => switchCanvas(ctx, 'eendraad'),
    },
    {
      id: 'ui.viewport.showPlan',
      labelKey: 'shortcuts.entries.switchToPlanCanvas.description',
      keyLabels: ['f2'],
      keybindings: [{ key: 'F2', whileTyping: true }],
      run: (ctx) => switchCanvas(ctx, 'plan'),
    },
    {
      id: 'ui.viewport.showPanel',
      labelKey: 'shortcuts.entries.switchToPanelCanvas.description',
      keyLabels: ['f3'],
      keybindings: [{ key: 'F3', whileTyping: true }],
      run: (ctx) => switchCanvas(ctx, 'panel'),
    },
    {
      id: 'ui.viewport.showStructure',
      keybindings: [{ key: 'F4', whileTyping: true }],
      isEnabled: () => isStructuralCanvasEnabled(),
      run: (ctx) => switchCanvas(ctx, 'structure'),
    },
    {
      id: 'ui.shortcuts',
      labelKey: 'shortcuts.title',
      run: () =>
        useDialogStore.getState().openDialog({
          type: 'custom',
          title: i18n.t('shortcuts.title'),
          content: createElement(ShortcutsDialog),
          size: 'xl',
          showCloseButton: true,
        }),
    },
  ]
}
