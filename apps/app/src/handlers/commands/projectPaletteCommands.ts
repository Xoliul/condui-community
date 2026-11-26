import { createElement } from 'react'
import i18n from '@/i18n'
import { CommandInputDialog } from '@/components/commands/CommandInputDialog'
import { getProjectPaletteActions } from '@/lib/commands/ui/projectPaletteActions'
import type { CommandContext, CommandDefinition } from '@/lib/commands/ui/types'
import { CommandError } from '@/lib/commands/project'
import { liveProjectSession } from '@/stores/liveProjectCommandSession'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { useDialogStore } from '@/stores/dialogStore'
import { canOpenRoomPlanScan, openRoomPlanScan } from '@/handlers/plan/roomPlanScan'
import type { Selection } from '@/types/ui'
import { useCanvasRegistryStore } from '@/stores/canvasRegistryStore'
import {
  canOpenSelectedJunctionEditorForEdition,
  openSelectedJunctionEditorForEdition,
} from '@/lib/junction/junctionEditorUiHooks'

const bindings = [
  ['electrical.createFork', 'createFork'],
  ['electrical.deleteEmptyFork', 'deleteEmptyFork'],
  ['electrical.createRiser', 'addRiser'],
  ['electrical.moveToOwnRiser', 'moveToOwnRiser'],
  ['electrical.joinRisers', 'joinRisers'],
  ['electrical.deleteEmptyRiser', 'deleteEmptyRiser'],
  ['electrical.addSupplyTransformer', 'addSupplyTransformer'],
  ['electrical.addPanelAtDomoticaOutput', 'addPanelAtDomoticaOutput'],
  ['electrical.addDomoticaHorizontal', 'addDomoticaHorizontal'],
  ['electrical.assignEndpoints', 'moveToCircuit'],
  ['electrical.reorderBranch', 'reorderBranch'],
  ['electrical.moveProtectionOnBus', 'moveOnBus'],
  ['electrical.moveBus.left', 'moveBusLeft'],
  ['electrical.moveBus.right', 'moveBusRight'],
  ['panel.moveModules', 'moveModules'],
  ['panel.resizeModule', 'resizeModule'],
  ['panel.rewire', 'connectTo'],
  ['panel.resizeEnclosure', 'resizePanel'],
  ['panel.autoArrange', 'autoArrange'],
  ['floor.rename', 'renameFloor'],
  ['circuit.createEmpty', 'addCircuit'],
  ['document.removeFromOneWire', 'removeFromOneWire'],
  ['document.showOnOneWire', 'showOnOneWire'],
  ['floor.create', 'addFloor'],
  ['floor.delete', 'deleteFloor'],
  ['plan.transformBackground', 'transformBackground'],
  ['plan.detachBackground', 'removeBackground'],
  ['plan.addWall', 'addPlanWall'],
  ['plan.splitWall', 'splitWall'],
  ['plan.addDoor', 'addPlanDoor'],
  ['plan.addWindow', 'addPlanWindow'],
  ['plan.addStair', 'addPlanStair'],
  ['plan.addGraphicElement', 'addPlanGraphic'],
  ['plan.placeExisting', 'placeExistingOnPlan'],
  ['panel.hideAllModules', 'hideAllPanelModules'],
  ['panel.showAllModules', 'showAllPanelModules'],
  ['panel.showAuxiliaryEnclosures', 'showAuxiliaryEnclosures'],
  ['panel.hideAuxiliaryEnclosures', 'hideAuxiliaryEnclosures'],
  ['plan.addNote', 'planAddNote'],
  ['eendraad.addNote', 'eendraadAddNote'],
  ['eendraad.createFrame', 'eendraadCreateFrame'],
  ['plan.insertWireWaypoint', 'planInsertWireWaypoint'],
  ['plan.moveWireWaypoint', 'planMoveWireWaypoint'],
  ['plan.removeWireWaypoint', 'planRemoveWireWaypoint'],
  ['plan.moveWireRiser', 'planMoveWireRiser'],
  ['plan.disconnectOutgoingWires', 'planDisconnectOutgoingWires'],
  ['cable.acceptAllLengthEstimates', 'cableAcceptLengthEstimates'],
  ['electrical.moveSupplyTrunkDevice', 'moveSupplyDevice'],
  ['electrical.moveCircuitTrunkDevice', 'moveCircuitTrunkDevice'],
  ['panel.setFeedOrganization', 'setPanelFeedOrganization'],
  ['panel.setBusFeedBoundary.grid', 'setGridFeedBoundary'],
  ['panel.setBusFeedBoundary.backup', 'setBackupFeedBoundary'],
  ['panel.moveSupply', 'movePanelSupply'],
  ['panel.ensureEarthingStem', 'ensureSecondaryPanelEarthingStem'],
  ['panel.ejectSecondaryBusProtections', 'ejectSecondaryBusProtections'],
  ['supply.disconnectInverterGridInput', 'disconnectInverterGridInput'],
  ['supply.convertToTap', 'convertSupplyDeviceToTap'],
  ['supply.convertToInline', 'convertSupplyTapToInline'],
] as const

let cached:
  | {
      project: unknown
      selection: unknown
      panel: string | null
      floor: string | null
      actions: ReturnType<typeof getProjectPaletteActions>
    }
  | undefined
function actions() {
  const project = useProjectStore.getState().currentProject
  if (!project) {
    cached = undefined
    return []
  }
  const { selection, activePanelId: panel, activeFloorId: floor } = useUIStore.getState()
  if (
    !cached ||
    cached.project !== project ||
    cached.selection !== selection ||
    cached.panel !== panel ||
    cached.floor !== floor
  )
    cached = {
      project,
      selection,
      panel,
      floor,
      actions: getProjectPaletteActions(project, selection, panel, floor),
    }
  return cached.actions
}

function planActions(ctx: CommandContext) {
  const registry = useCanvasRegistryStore.getState()
  if (!ctx.viewport) return registry.registry.sitplan
  const { viewport } = ctx
  const panels = viewport.ui.getState().viewportLayout.panels
  const invokingIndex = ctx.pointerPanelIndex ?? ctx.targetPanelIndex
  const index = invokingIndex != null && panels[invokingIndex]?.canvas === 'plan'
    ? invokingIndex
    : panels.findIndex((panel) => panel.canvas === 'plan')
  const panelUI = index >= 0 ? viewport.getPanelUI(index) : undefined
  return panelUI ? registry.getSitplanForViewport(panelUI) : null
}

export function createProjectPaletteCommands(): CommandDefinition[] {
  return [
    {
      id: 'ui.junction.openEditor',
      labelKey: 'junctionEditor.openEditor',
      isEnabled: (ctx) =>
        ctx.capabilities.canEditProject && canOpenSelectedJunctionEditorForEdition(),
      run: () => openSelectedJunctionEditorForEdition(),
    },
    ...(
      [
        ['ui.plan.importBackground', 'importPlanBackground', 'importBackground'],
        ['ui.plan.calibrateScale', 'calibratePlan', 'calibrateScale'],
      ] as const
    ).map(([id, label, action]): CommandDefinition => ({
      id,
      labelKey: `commandPalette.${label}`,
      isEnabled: (ctx) =>
        ctx.capabilities.canEditProject &&
        !!useProjectStore.getState().currentProject &&
        !!planActions(ctx)?.[action],
      run: (ctx) => planActions(ctx)?.[action]?.(),
    })),
    {
      id: 'plan.scanRoom',
      labelKey: 'nativeRoomScan.start',
      searchKey: 'nativeRoomScan.search',
      isEnabled: (ctx) => ctx.capabilities.canEditProject && canOpenRoomPlanScan(),
      run: () => openRoomPlanScan('palette'),
    },
    {
      id: 'properties.edit',
      labelKey: 'contextMenu.editProperties',
      isEnabled: (ctx) =>
        ctx.capabilities.canEditProject && !!useProjectStore.getState().currentProject,
      run: () => {
        if (!useUIStore.getState().panels.properties.visible)
          useUIStore.getState().togglePanel('properties')
      },
    },
    ...bindings.map(
      ([id, label]) =>
        ({
          id,
          labelKey: `commandPalette.${label}`,
          searchKey:
            id === 'panel.rewire'
              ? 'commandPalette.rewire'
              : id === 'electrical.addDomoticaHorizontal'
                ? 'commandPalette.addDomoticaHorizontalSearch'
                : undefined,
          isEnabled: (ctx) =>
            ctx.capabilities.canEditProject &&
            (!['electrical.addSupplyTransformer', 'electrical.addPanelAtDomoticaOutput', 'electrical.addDomoticaHorizontal'].includes(id) || ctx.capabilities.canPlaceSymbols) &&
            actions().some((action) => action.id === id),
          run: () => {
            const action = actions().find((action) => action.id === id)
            if (!action) return false
            const revision = liveProjectSession.revision
            const submit = (values: Record<string, string>): boolean => {
              if (
                action.fields.some((field) => {
                  const value = values[field.name]
                  if (field.options) return !field.options.some((option) => option.value === value)
                  if (field.type !== 'number') return !value?.trim()
                  const number = Number(value)
                  return (
                    !value ||
                    !Number.isFinite(number) ||
                    (field.min != null && number < field.min) ||
                    (field.max != null && number > field.max) ||
                    (field.step === 1 && !Number.isInteger(number))
                  )
                })
              )
                return false
              try {
                const outcome = liveProjectSession.execute([action.invocation(values)], {
                  expectedRevision: revision,
                  source: 'palette',
                  label: action.id,
                })
                const suggested = outcome.results[0]?.select
                if (
                  suggested?.length &&
                  suggested.every((ref) => ref.kind === suggested[0]!.kind)
                ) {
                  const kind = suggested[0]!.kind
                  if (
                    [
                      'endpoint',
                      'placement',
                      'circuit',
                      'protection',
                      'trunkDevice',
                      'panel',
                      'wall',
                      'door',
                      'window',
                      'stair',
                      'graphicElement',
                      'note',
                      'frame',
                    ].includes(kind)
                  )
                    useUIStore.getState().setSelection({
                      type: kind as Selection['type'],
                      ids: suggested.map((ref) => ref.id),
                    })
                }
                if (id === 'document.removeFromOneWire') useUIStore.getState().clearSelection()
                if (id === 'floor.create') {
                  const floor = outcome.results[0]?.created.find((ref) => ref.kind === 'floor')
                  if (floor) useUIStore.getState().setActiveFloor(floor.id)
                }
                if (id === 'floor.delete') {
                  const project = useProjectStore.getState().currentProject
                  const active = useUIStore.getState().activeFloorId
                  if (project && !project.building.floors.some((floor) => floor.id === active))
                    useUIStore.getState().setActiveFloor(project.building.floors[0]?.id ?? null)
                  useUIStore.getState().clearSelection()
                }
                if (id === 'circuit.createEmpty') {
                  const created = outcome.results[0]?.created.find((ref) => ref.kind === 'circuit')
                  if (created)
                    useUIStore.getState().setSelection({ type: 'circuit', ids: [created.id] })
                }
                return true
              } catch (error) {
                if (!(error instanceof CommandError)) throw error
                return false
              }
            }
            if (!action.fields.length) return submit({})
            useDialogStore.getState().openDialog({
              type: 'custom',
              title: i18n.t(action.labelKey),
              size: 'sm',
              content: createElement(CommandInputDialog, {
                fields: action.fields,
                onSubmit: submit,
              }),
            })
            return true
          },
        }) satisfies CommandDefinition
    ),
  ]
}
