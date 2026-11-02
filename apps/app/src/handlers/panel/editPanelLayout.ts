import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import type { PanelGridConfig, PanelGridModuleRef, PanelGridSlot, Point2 } from '@/types/schema'
import type { PanelEditLayoutInput } from '@/lib/commands/project/commands/panelEditLayout'
import { editProperties } from '@/handlers/properties/editProperties'

export function editPanelLayout(input: PanelEditLayoutInput) {
  return runProjectCommand('panel.editLayout', input, {
    label: 'edit panel layout',
    source: 'panel',
  })
}
export function deleteAuxiliaryEnclosures(enclosureIds: string[]) {
  const ids = [...new Set(enclosureIds)]
  return ids.length ? editPanelLayout({ deleteEnclosures: ids }) : null
}
export function dismissEmptySharedSupplyFrame() {
  return editPanelLayout({ dismissEmptySharedSupplyFrame: true })
}
export function updatePanelGridSlots(panelId: string, mainSlots: PanelGridSlot[]) {
  return editPanelLayout({ panels: [{ panelId, mainSlots }] })
}
export function updateSupplyPanelSlots(panelId: string, supplySlots: PanelGridSlot[]) {
  return editPanelLayout({ panels: [{ panelId, supplySlots }] })
}
export function updatePanelGrid(panelId: string, grid: Partial<PanelGridConfig>) {
  return editPanelLayout({ panels: [{ panelId, grid }] })
}
export function updateJunctionPanelGrid(deviceId: string, grid: Partial<PanelGridConfig>) {
  return editPanelLayout({ junctionGrids: [{ deviceId, grid }] })
}
export function moveSupplyDeviceToAuxiliaryEnclosure(
  deviceId: string,
  targetId: string,
  row: number,
  col: number
) {
  return editPanelLayout({
    supplyMoves: [{ deviceId, targetId, destination: 'auxiliary', row, col }],
  })
}
export function moveSupplyDeviceToPanelEnclosure(
  deviceId: string,
  targetId: string,
  row: number,
  col: number
) {
  return editPanelLayout({ supplyMoves: [{ deviceId, targetId, destination: 'panel', row, col }] })
}
export function moveSupplyDeviceToGridEnclosure(
  deviceId: string,
  targetId: string,
  row: number,
  col: number
) {
  return editPanelLayout({ supplyMoves: [{ deviceId, targetId, destination: 'grid', row, col }] })
}
export function moveTerminalStripToPanel(
  deviceId: string,
  panelId: string,
  slot: PanelGridSlot,
  enclosureId?: string
) {
  return (
    editPanelLayout({
      terminalMoves: [{ deviceId, panelId, slot, ...(enclosureId ? { enclosureId } : {}) }],
    })?.changed ?? false
  )
}
export function createAuxiliarySupplyEnclosure(
  deviceIds: string[],
  ownerPanelId: string,
  position: Point2
): string | null {
  return (
    editPanelLayout({ createAuxiliary: { deviceIds, ownerPanelId, position } })
      ?.results.flatMap((result) => result.created)
      .find((ref) => ref.kind === 'auxiliaryEnclosure')?.id ?? null
  )
}
export function rewirePanelModules(
  panelId: string,
  origin: PanelGridModuleRef,
  target: PanelGridModuleRef | null
) {
  return runProjectCommand(
    'panel.rewire',
    { panelId, origin, target },
    { label: 'rewire panel module connection', source: 'panel' }
  )
}
export function ejectToSupplyPanel(panelId: string, module: PanelGridModuleRef) {
  return editPanelLayout({ supplyTransitions: [{ panelId, module, destination: 'supply' }] })
}
export function returnFromSupplyPanel(panelId: string, module: PanelGridModuleRef) {
  return editPanelLayout({ supplyTransitions: [{ panelId, module, destination: 'main' }] })
}
export function setSupplyPanelVisible(panelId: string, visible: boolean) {
  return editPanelLayout({ supplyVisibility: [{ panelId, visible }] })
}
export function hideModuleFromPanel(panelId: string, moduleRefKey: string) {
  return editProperties({
    actions: [{ kind: 'panelModuleVisibility', panelId, moduleRefKey, visible: false }],
  })
}
export function unhideModuleFromPanel(panelId: string, moduleRefKey: string) {
  return editProperties({
    actions: [{ kind: 'panelModuleVisibility', panelId, moduleRefKey, visible: true }],
  })
}
export function moveCircuitModule(
  module: PanelGridModuleRef,
  destination: { kind: 'panel'; panelId: string } | { kind: 'auxiliary'; enclosureId: string },
  row: number,
  col: number
) {
  return editPanelLayout({ circuitModuleMoves: [{ module, destination, row, col }] })
}
export function createCircuitModuleEnclosure(
  modules: PanelGridModuleRef[],
  ownerPanelId: string,
  position: Point2
): string | null {
  return (
    editPanelLayout({ createCircuitModuleEnclosure: { modules, ownerPanelId, position } })
      ?.results.flatMap((result) => result.created)
      .find((ref) => ref.kind === 'auxiliaryEnclosure')?.id ?? null
  )
}
