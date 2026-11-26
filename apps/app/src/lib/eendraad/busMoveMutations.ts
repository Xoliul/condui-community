import { clamp } from '@/lib/geometry'
import { liftCircuitContentAboveOwnProtection } from '@/lib/eendraad/circuitContentInsertion'
import { findParentCircuitInfo } from '@/lib/eendraad/findParentCircuitInfo'
import {
  getMainBusItemsWithIndices,
  pickRepresentativeCircuitIdForMainBusMove,
  relocateProtectionToPanelMainBus,
  dedupePanelProtectionsInPanelTree,
} from '@/lib/eendraad/mainBusOrder'
import { moveCircuitsToRcdBus } from '@/lib/eendraad/panelAttachmentMove'
import {
  findPanelOwningProtection,
  findProtectionById,
  getAllCircuits,
  maybeApplyAutomaticEendraadNamingForPanel,
  rewirePromotedIncomingProtectionGridRef,
  syncLinkedSubPanelHierarchy,
} from '@/lib/eendraad/projectElectricalDomain'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { getMainBusInsertionSectionId } from '@/lib/panel/panelBusSections'
import { protectionFeedsPanel } from '@/lib/eendraad/panelSupplyLink'
import { findPanelById } from '@/lib/panel/panelTree'
import { getVoltagePolesConfig } from '@/lib/protectionDefaults'
import type { ProjectV2 } from '@/types/projectV2'
import type { Circuit, Panel, ProtectionDevice } from '@/types/schema'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import {
  moveCircuitOnMainBusInProject,
  moveCircuitToSecondaryBusInProject,
} from '@/lib/projectMutations/storeActions'
import {
  promoteMovedSubPanelRootToIncomingTrunk,
  protectionDeviceToSubPanelIncomingTrunkDevice,
} from '@/lib/eendraad/mainBusOrder'
import {
  circuitClosureContains,
  collapseProtectionMoveRoots,
} from '@/lib/eendraad/multiSelectionMove'

export type ProtectionBusDropInput = {
  kind: 'protectionDrop'
  protectionId: string
  target: DropTarget
}
export type ProtectionSelectionBusDropInput = {
  kind: 'protectionSelectionDrop'
  protectionIds: string[]
  target: DropTarget
}
export type MainBusDirectionInput = {
  kind: 'mainBusDirection'
  panelId: string
  circuitId: string
  direction: 'left' | 'right'
}
export type SecondaryBusCircuitMoveInput = {
  kind: 'secondaryBus'
  panelId: string
  parentCircuitId: string
  circuitId: string
  insertIndex: number
  itemCount?: number
  insertBeforeCircuitContent?: boolean
}
export type PromoteCircuitInput = {
  kind: 'promoteCircuit'
  panelId: string
  circuitId: string
  insertIndex: number
}

export type BusMoveInput =
  | ProtectionBusDropInput
  | ProtectionSelectionBusDropInput
  | MainBusDirectionInput
  | SecondaryBusCircuitMoveInput
  | PromoteCircuitInput

export type BusMoveResult = { changed: boolean; circuitId?: string; reason?: string }

function findCircuitOnPanel(panel: Panel, circuitId: string): Circuit | undefined {
  return getAllCircuits(panel).find((circuit) => circuit.id === circuitId)
}

function protectionDropHitsSource(protection: ProtectionDevice, target: DropTarget): boolean {
  if (target.protectionId === protection.id) return true
  const isBusInsertion =
    target.type === 'mainBus' ||
    (target.type === 'circuit' && typeof target.secondaryBusInsertIndex === 'number')
  if (isBusInsertion || !target.circuitId) return false
  if (!(protection.circuits ?? []).some((circuit) => circuit.id === target.circuitId)) return false
  return !(target.type === 'circuit' && target.insertAfterCircuitContent === true)
}

function isCircuitDescendant(project: ProjectV2, ancestorId: string, childId: string): boolean {
  const circuits = getEditableProjectElectricalPanels(project).flatMap((panel) =>
    getAllCircuits(panel)
  )
  const byId = new Map(circuits.map((circuit) => [circuit.id, circuit]))
  const pending = [...(byId.get(ancestorId)?.subCircuitIds ?? [])]
  const seen = new Set<string>()
  while (pending.length) {
    const current = pending.pop()!
    if (current === childId) return true
    if (seen.has(current)) continue
    seen.add(current)
    pending.push(...(byId.get(current)?.subCircuitIds ?? []))
  }
  return false
}

/** Read-only protection drop validation shared by the command and the mutation boundary. */
export function checkProtectionBusDrop(
  project: ProjectV2,
  protectionId: string,
  target: DropTarget
): string | null {
  const panels = getEditableProjectElectricalPanels(project)
  const sourcePanel = findPanelOwningProtection(panels, protectionId)
  const protection = sourcePanel && findProtectionById(sourcePanel, protectionId)
  if (!sourcePanel || !protection) return 'protection_not_found'
  const circuitId = pickRepresentativeCircuitIdForMainBusMove(sourcePanel, protection)
  if (!circuitId) return 'protection_has_no_bus_circuit'
  if (protectionDropHitsSource(protection, target)) return 'drop_hits_source'

  if (target.type === 'supplyWire') {
    if (protectionFeedsPanel(protection)) return 'panel_feeder_cannot_be_promoted'
    const targetPanel = target.panelId ? findPanelById(panels, target.panelId) : undefined
    const panelCircuit = targetPanel?.circuits.find((circuit) => circuit.code === 'PANEL')
    const incoming = (panelCircuit?.trunkDevices ?? []).find(
      (device) => device.type === 'protection'
    )
    if (!targetPanel || targetPanel.isMain || !panelCircuit) return 'invalid_supply_panel'
    if (incoming && incoming.id !== protectionId) return 'incoming_protection_exists'
    return null
  }

  if (target.type === 'mainBus') {
    if (!target.panelId || target.mainBusInsertIndex == null) return 'main_bus_index_required'
    const targetPanel = findPanelById(panels, target.panelId)
    if (!targetPanel) return 'panel_not_found'
    if (target.mainBusInsertIndex > getMainBusItemsWithIndices(targetPanel).length)
      return 'main_bus_index_out_of_range'
    const isAlreadyOnBus = getMainBusItemsWithIndices(targetPanel).some(
      (item) =>
        (item.type === 'protection' && item.id === protectionId) ||
        (item.type === 'circuit' && item.id === circuitId)
    )
    if (!isAlreadyOnBus && !findPanelOwningProtection(panels, protectionId))
      return 'protection_not_found'
    return null
  }

  if (target.type === 'rcd') {
    if (!target.panelId || !target.protectionId || target.secondaryBusInsertIndex == null)
      return 'rcd_target_incomplete'
    const targetPanel = findPanelById(panels, target.panelId)
    const rcd = targetPanel?.protections.find((candidate) => candidate.id === target.protectionId)
    if (!targetPanel || !rcd || (rcd.type !== 'RCD' && rcd.type !== 'RCBO')) return 'rcd_not_found'
    if (sourcePanel.id !== targetPanel.id && protectionFeedsPanel(protection))
      return 'panel_feeder_cannot_move_to_secondary_bus'
    if (sourcePanel.id === targetPanel.id && target.protectionId === protection.id)
      return 'drop_hits_source'
    const anchor = (rcd.circuits ?? []).find((circuit) => circuit.id !== circuitId)
    if (!anchor) return 'rcd_has_no_secondary_bus_anchor'
    if (anchor && isCircuitDescendant(project, circuitId, anchor.id)) return 'circuit_cycle'
    const itemCount = target.secondaryBusItemCount ?? anchor?.subCircuitIds?.length ?? 0
    if (target.secondaryBusInsertIndex > itemCount) return 'secondary_bus_index_out_of_range'
    return null
  }
  if (target.type !== 'circuit' || !target.circuitId) return 'unsupported_drop_target'
  const targetPanel = target.panelId ? findPanelById(panels, target.panelId) : undefined
  const anchorCircuit = targetPanel && findCircuitOnPanel(targetPanel, target.circuitId)
  if (!targetPanel || !anchorCircuit) return 'circuit_not_in_target_panel'
  if (sourcePanel.id !== targetPanel.id && protectionFeedsPanel(protection))
    return 'panel_feeder_cannot_move_to_secondary_bus'
  if (target.circuitId === circuitId && target.insertAfterCircuitContent === true) return null
  if (isCircuitDescendant(project, circuitId, target.circuitId)) return 'circuit_cycle'
  if (target.protectionId) {
    const rcd = targetPanel.protections.find((candidate) => candidate.id === target.protectionId)
    if (!rcd || (rcd.type !== 'RCD' && rcd.type !== 'RCBO')) return 'rcd_not_found'
    const itemCount = target.secondaryBusItemCount ?? anchorCircuit.subCircuitIds?.length ?? 0
    if (target.secondaryBusInsertIndex != null && target.secondaryBusInsertIndex > itemCount)
      return 'secondary_bus_index_out_of_range'
    return null
  }
  if (target.secondaryBusInsertIndex == null) return 'secondary_bus_index_required'
  const itemCount = target.secondaryBusItemCount ?? anchorCircuit?.subCircuitIds?.length ?? 0
  if (target.secondaryBusInsertIndex > itemCount) return 'secondary_bus_index_out_of_range'
  return null
}

function reorderMainBusProtection(
  panel: Panel,
  protection: ProtectionDevice,
  circuitId: string,
  insertIndex: number,
  busSectionId?: string
): boolean {
  const items = getMainBusItemsWithIndices(panel)
  const current = items.find(
    (item) =>
      (item.type === 'protection' && item.id === protection.id) ||
      (item.type === 'circuit' && item.id === circuitId)
  )
  if (!current) return false
  const currentIndex = items.indexOf(current)
  const maxIndex = clamp(insertIndex, 0, items.length)
  const desiredIndex = clamp(maxIndex > currentIndex ? maxIndex - 1 : maxIndex, 0, items.length - 1)
  if (desiredIndex === currentIndex) return false
  const sectionId =
    busSectionId ?? getMainBusInsertionSectionId(panel, desiredIndex, new Set([current.id]))
  let sectionChanged = false
  if (sectionId && current.type === 'protection' && protection.busSectionId !== sectionId) {
    protection.busSectionId = sectionId
    sectionChanged = true
  } else if (sectionId && current.type === 'circuit') {
    const circuit = panel.circuits.find((candidate) => candidate.id === circuitId)
    if (circuit && circuit.busSectionId !== sectionId) {
      circuit.busSectionId = sectionId
      sectionChanged = true
    }
  }
  const direction = desiredIndex > currentIndex ? 1 : -1
  let moved = false
  for (let step = 0; step < Math.abs(desiredIndex - currentIndex); step++) {
    const currentItems = getMainBusItemsWithIndices(panel)
    const currentItem = currentItems.find(
      (item) =>
        (item.type === 'protection' && item.id === protection.id) ||
        (item.type === 'circuit' && item.id === circuitId)
    )
    if (!currentItem) break
    const currentPosition = currentItems.indexOf(currentItem)
    const next = currentItems[currentPosition + direction]
    if (!next || next.type !== currentItem.type) continue
    if (currentItem.type === 'protection') {
      const a = panel.protections[currentItem.index]
      const b = panel.protections[next.index]
      if (!a || !b) continue
      panel.protections[currentItem.index] = b
      panel.protections[next.index] = a
    } else {
      const a = panel.circuits[currentItem.index]
      const b = panel.circuits[next.index]
      if (!a || !b) continue
      panel.circuits[currentItem.index] = b
      panel.circuits[next.index] = a
    }
    moved = true
  }
  return moved || sectionChanged
}

export function moveProtectionToSupplyWireInProject(
  project: ProjectV2,
  protectionId: string,
  targetPanelId: string
): boolean {
  const panels = getEditableProjectElectricalPanels(project)
  const sourcePanel = findPanelOwningProtection(panels, protectionId)
  const targetPanel = findPanelById(panels, targetPanelId)
  const protection = sourcePanel && findProtectionById(sourcePanel, protectionId)
  const panelCircuit = targetPanel?.circuits.find((circuit) => circuit.code === 'PANEL')
  if (!sourcePanel || !targetPanel || targetPanel.isMain || !protection || !panelCircuit)
    return false
  // Converting the protection to a trunk device discards its structural panel links.
  if (protectionFeedsPanel(protection)) return false
  const incoming = (panelCircuit.trunkDevices ?? []).find((device) => device.type === 'protection')
  if (incoming && incoming.id !== protectionId) return false

  relocateProtectionToPanelMainBus(sourcePanel, targetPanel, protection, 0)
  const incomingDevice = protectionDeviceToSubPanelIncomingTrunkDevice(
    protection,
    protection.id,
    getVoltagePolesConfig(project)
  )
  promoteMovedSubPanelRootToIncomingTrunk(targetPanel, protection.id, incomingDevice)
  targetPanel.protections = targetPanel.protections.filter(
    (candidate) => candidate.id !== protection.id
  )
  rewirePromotedIncomingProtectionGridRef(targetPanel, protection.id, panelCircuit.id)
  if (
    !(panelCircuit.trunkDevices ?? []).some(
      (device) => device.id === protection.id && device.type === 'protection'
    )
  )
    return false

  syncLinkedSubPanelHierarchy(project)
  dedupePanelProtectionsInPanelTree(sourcePanel)
  dedupePanelProtectionsInPanelTree(targetPanel)
  maybeApplyAutomaticEendraadNamingForPanel(project, sourcePanel.id)
  if (sourcePanel.id !== targetPanel.id)
    maybeApplyAutomaticEendraadNamingForPanel(project, targetPanel.id)
  return true
}

/** Apply the existing single-protection drag semantics on an Immer draft. */
export function moveProtectionOnBusInProject(
  project: ProjectV2,
  protectionId: string,
  target: DropTarget
): BusMoveResult {
  const reason = checkProtectionBusDrop(project, protectionId, target)
  if (reason) return { changed: false, reason }
  const panels = getEditableProjectElectricalPanels(project)
  const sourcePanel = findPanelOwningProtection(panels, protectionId)!
  const protection = findProtectionById(sourcePanel, protectionId)!
  const circuitId = pickRepresentativeCircuitIdForMainBusMove(sourcePanel, protection)!

  if (target.type === 'supplyWire') {
    const changed = moveProtectionToSupplyWireInProject(project, protectionId, target.panelId!)
    return { changed, circuitId, ...(!changed ? { reason: 'incoming_promotion_failed' } : {}) }
  }

  if (
    target.type === 'circuit' &&
    target.circuitId === circuitId &&
    target.insertAfterCircuitContent === true
  ) {
    const panel = findPanelById(panels, target.panelId!)!
    const changed = liftCircuitContentAboveOwnProtection(panel, circuitId)
    if (changed) maybeApplyAutomaticEendraadNamingForPanel(project, panel.id)
    return { changed, circuitId }
  }

  const secondaryBusPanelId =
    target.type === 'rcd' ||
    (target.type === 'circuit' && typeof target.secondaryBusInsertIndex === 'number')
      ? target.panelId
      : undefined
  if (secondaryBusPanelId && secondaryBusPanelId !== sourcePanel.id) {
    const targetPanel = findPanelById(panels, secondaryBusPanelId)
    if (!targetPanel || protectionFeedsPanel(protection))
      return { changed: false, circuitId, reason: 'panel_feeder_cannot_move_to_secondary_bus' }
    relocateProtectionToPanelMainBus(
      sourcePanel,
      targetPanel,
      protection,
      getMainBusItemsWithIndices(targetPanel).length
    )
    syncLinkedSubPanelHierarchy(project)
    dedupePanelProtectionsInPanelTree(sourcePanel)
    dedupePanelProtectionsInPanelTree(targetPanel)
  }

  if (target.type === 'rcd' && target.panelId && target.protectionId) {
    const targetPanel = findPanelById(panels, target.panelId)!
    const rcd = targetPanel.protections.find((candidate) => candidate.id === target.protectionId)
    const anchor = rcd?.circuits?.find((circuit) => circuit.id !== circuitId)
    const siblingCount = anchor?.subCircuitIds?.length ?? 0
    const visualCount = target.secondaryBusItemCount ?? siblingCount
    const insertIndex =
      visualCount > 0 && visualCount !== siblingCount
        ? Math.floor((target.secondaryBusInsertIndex! * siblingCount) / visualCount)
        : target.secondaryBusInsertIndex!
    const moved = moveCircuitsToRcdBus(
      panels,
      targetPanel.id,
      target.protectionId!,
      [circuitId],
      insertIndex
    )
    if (!moved) return { changed: false, reason: 'invalid_rcd_move' }
    if (sourcePanel.id !== targetPanel.id)
      maybeApplyAutomaticEendraadNamingForPanel(project, sourcePanel.id)
    maybeApplyAutomaticEendraadNamingForPanel(project, targetPanel.id)
    return { changed: true, circuitId }
  }

  if (target.type === 'mainBus') {
    const targetPanel = findPanelById(panels, target.panelId!)!
    const direct = getMainBusItemsWithIndices(targetPanel).some(
      (item) =>
        (item.type === 'protection' && item.id === protectionId) ||
        (item.type === 'circuit' && item.id === circuitId)
    )
    if (direct) {
      const changed = reorderMainBusProtection(
        targetPanel,
        protection,
        circuitId,
        target.mainBusInsertIndex!,
        target.busSectionId
      )
      if (changed) maybeApplyAutomaticEendraadNamingForPanel(project, targetPanel.id)
      return { changed, circuitId }
    }
    const targetIndex = target.mainBusInsertIndex!
    relocateProtectionToPanelMainBus(sourcePanel, targetPanel, protection, targetIndex)
    syncLinkedSubPanelHierarchy(project)
    dedupePanelProtectionsInPanelTree(sourcePanel)
    dedupePanelProtectionsInPanelTree(targetPanel)
    maybeApplyAutomaticEendraadNamingForPanel(project, sourcePanel.id)
    if (sourcePanel.id !== targetPanel.id)
      maybeApplyAutomaticEendraadNamingForPanel(project, targetPanel.id)
    return { changed: true, circuitId }
  }

  if (target.type === 'circuit' && target.circuitId && target.panelId) {
    const targetPanel = findPanelById(panels, target.panelId)!
    const anchorCircuit = findCircuitOnPanel(targetPanel, target.circuitId)
    const siblingCount = anchorCircuit?.subCircuitIds?.length ?? 0
    const sourceInsertIndex = target.secondaryBusInsertIndex ?? siblingCount
    const targetItemCount = target.secondaryBusItemCount ?? siblingCount
    const insertIndex =
      targetItemCount > 0 && targetItemCount !== siblingCount
        ? Math.floor((sourceInsertIndex * siblingCount) / targetItemCount)
        : sourceInsertIndex
    if (target.protectionId) {
      const moved = moveCircuitsToRcdBus(
        panels,
        target.panelId!,
        target.protectionId,
        [circuitId],
        insertIndex
      )
      if (!moved) return { changed: false }
      if (sourcePanel.id !== targetPanel.id)
        maybeApplyAutomaticEendraadNamingForPanel(project, sourcePanel.id)
      maybeApplyAutomaticEendraadNamingForPanel(project, targetPanel.id)
      return { changed: true, circuitId }
    }
    const currentParent = findParentCircuitInfo(circuitId, panels)
    const insertBeforeCircuitContent =
      target.insertAfterCircuitContent !== true && target.circuitTrunkSegmentIndex != null
    if (currentParent?.parentCircuit.id === target.circuitId && !insertBeforeCircuitContent) {
      const order = currentParent.parentCircuit.subCircuitIds ?? []
      const currentIndex = order.indexOf(circuitId)
      const destination = clamp(
        insertIndex > currentIndex ? insertIndex - 1 : insertIndex,
        0,
        order.length - 1
      )
      if (destination === currentIndex) return { changed: false, circuitId }
      order.splice(currentIndex, 1)
      order.splice(destination, 0, circuitId)
      currentParent.parentCircuit.subCircuitIds = order
      maybeApplyAutomaticEendraadNamingForPanel(project, targetPanel.id)
      return { changed: true, circuitId }
    }
    const changed = moveCircuitToSecondaryBusInProject(
      project,
      targetPanel.id,
      target.circuitId,
      circuitId,
      insertIndex,
      { insertBeforeCircuitContent }
    )
    if (changed.changed && sourcePanel.id !== targetPanel.id)
      maybeApplyAutomaticEendraadNamingForPanel(project, sourcePanel.id)
    return { changed: changed.changed, circuitId }
  }

  return { changed: false }
}

/** Apply the former multi-protection drag as one project mutation. */
export function moveProtectionSelectionOnBusInProject(
  project: ProjectV2,
  protectionIds: readonly string[],
  target: DropTarget
): BusMoveResult {
  const panels = getEditableProjectElectricalPanels(project)
  const selected = protectionIds.map((id) => {
    const panel = findPanelOwningProtection(panels, id)
    const protection = panel && findProtectionById(panel, id)
    const circuitId =
      panel && protection && pickRepresentativeCircuitIdForMainBusMove(panel, protection)
    return panel && protection && circuitId ? { id, circuitId, panelId: panel.id } : null
  })
  if (selected.some((item) => !item)) return { changed: false, reason: 'protection_not_found' }
  const movable = collapseProtectionMoveRoots(
    selected as Array<{ id: string; circuitId: string; panelId: string }>,
    (id) => panels.flatMap((panel) => getAllCircuits(panel)).find((circuit) => circuit.id === id)
  )
  if (!movable.length) return { changed: false, reason: 'no_movable_protections' }

  if (
    target.type !== 'mainBus' &&
    !(target.type === 'circuit' && target.circuitId && target.secondaryBusInsertIndex != null) &&
    !(target.type === 'rcd' && target.protectionId && target.secondaryBusInsertIndex != null)
  ) {
    return { changed: false, reason: 'unsupported_drop_target' }
  }
  for (const item of movable) {
    const protection = findProtectionById(findPanelOwningProtection(panels, item.id)!, item.id)!
    if (protectionDropHitsSource(protection, target))
      return { changed: false, reason: 'drop_hits_source' }
    if (
      target.type === 'circuit' &&
      target.circuitId &&
      circuitClosureContains(item.circuitId, target.circuitId, (id) =>
        panels.flatMap((panel) => getAllCircuits(panel)).find((circuit) => circuit.id === id)
      )
    ) {
      return { changed: false, reason: 'circuit_cycle' }
    }
    if (
      (target.type === 'circuit' || target.type === 'rcd') &&
      findPanelOwningProtection(panels, item.id)?.id !== target.panelId
    )
      return { changed: false, reason: 'wrong_panel' }
  }

  const targetPanel = target.panelId ? findPanelById(panels, target.panelId) : undefined
  if (!targetPanel) return { changed: false, reason: 'panel_not_found' }
  if (target.type === 'mainBus') {
    for (const [index, item] of movable.entries()) {
      const sourcePanel = findPanelOwningProtection(panels, item.id)
      const protection = sourcePanel && findProtectionById(sourcePanel, item.id)
      if (!sourcePanel || !protection) return { changed: false, reason: 'protection_not_found' }
      relocateProtectionToPanelMainBus(
        sourcePanel,
        targetPanel,
        protection,
        target.mainBusInsertIndex! + index
      )
      syncLinkedSubPanelHierarchy(project)
      dedupePanelProtectionsInPanelTree(sourcePanel)
      dedupePanelProtectionsInPanelTree(targetPanel)
      maybeApplyAutomaticEendraadNamingForPanel(project, sourcePanel.id)
      if (sourcePanel.id !== targetPanel.id)
        maybeApplyAutomaticEendraadNamingForPanel(project, targetPanel.id)
    }
    return { changed: true, circuitId: movable[0]?.circuitId }
  }

  if (target.type === 'rcd' || target.protectionId) {
    const result = moveCircuitsToRcdBus(
      panels,
      targetPanel.id,
      target.protectionId!,
      movable.map((item) => item.circuitId),
      target.secondaryBusInsertIndex!
    )
    if (!result) return { changed: false, reason: 'invalid_rcd_move' }
    maybeApplyAutomaticEendraadNamingForPanel(project, targetPanel.id)
    return { changed: true, circuitId: movable[0]?.circuitId }
  }

  for (const [index, item] of movable.entries()) {
    const result = moveCircuitToSecondaryBusInProject(
      project,
      targetPanel.id,
      target.circuitId!,
      item.circuitId,
      target.secondaryBusInsertIndex! + index
    )
    if (!result.changed)
      return {
        changed: index > 0,
        circuitId: movable[0]?.circuitId,
        reason: result.changed ? undefined : 'invalid_secondary_move',
      }
  }
  return { changed: true, circuitId: movable[0]?.circuitId }
}

/** Circuit reorder entry used by keyboard/drag adapters for main-bus directional moves. */
export function moveMainBusCircuitInProject(
  project: ProjectV2,
  panelId: string,
  circuitId: string,
  direction: 'left' | 'right'
): BusMoveResult {
  const panel = findPanelById(getEditableProjectElectricalPanels(project), panelId)
  if (!panel) return { changed: false, reason: 'panel_not_found' }
  const circuit = findCircuitOnPanel(panel, circuitId)
  if (!circuit) return { changed: false, reason: 'circuit_not_found' }
  const ownerProtection = panel.protections.find((protection) =>
    protection.circuits?.some((candidate) => candidate.id === circuitId)
  )
  const current = getMainBusItemsWithIndices(panel).find(
    (item) =>
      (item.type === 'circuit' && item.id === circuitId) ||
      (item.type === 'protection' && item.id === ownerProtection?.id)
  )
  if (!current) return { changed: false, reason: 'circuit_not_on_main_bus' }
  const items = getMainBusItemsWithIndices(panel)
  const index = items.indexOf(current)
  const adjacent = items[index + (direction === 'left' ? -1 : 1)]
  if (!adjacent || adjacent.type !== current.type) return { changed: false }
  const result = moveCircuitOnMainBusInProject(project, panelId, circuitId, direction)
  return { changed: result.changed, circuitId: result.changed ? circuitId : result.circuitId }
}

/** Moves a circuit onto or along a secondary bus, preserving before-content topology moves. */
export function moveCircuitOnSecondaryBusInProject(
  project: ProjectV2,
  input: SecondaryBusCircuitMoveInput
): BusMoveResult {
  const panel = findPanelById(getEditableProjectElectricalPanels(project), input.panelId)
  if (!panel) return { changed: false, reason: 'panel_not_found' }
  const parent = findCircuitOnPanel(panel, input.parentCircuitId)
  const moving = findCircuitOnPanel(panel, input.circuitId)
  if (!parent || !moving) return { changed: false, reason: 'circuit_not_found' }
  if (
    input.parentCircuitId === input.circuitId ||
    isCircuitDescendant(project, input.circuitId, input.parentCircuitId)
  ) {
    return { changed: false, reason: 'circuit_cycle' }
  }
  const existingParent = findParentCircuitInfo(input.circuitId, [panel])
  const siblingCount = parent.subCircuitIds?.length ?? 0
  const visualCount = input.itemCount ?? siblingCount
  const insertIndex =
    visualCount > 0 && visualCount !== siblingCount
      ? Math.floor((input.insertIndex * siblingCount) / visualCount)
      : input.insertIndex
  if (existingParent?.parentCircuit.id === parent.id && !input.insertBeforeCircuitContent) {
    const order = parent.subCircuitIds ?? []
    const currentIndex = order.indexOf(input.circuitId)
    if (currentIndex < 0) return { changed: false, reason: 'circuit_not_on_secondary_bus' }
    const destination = clamp(
      insertIndex > currentIndex ? insertIndex - 1 : insertIndex,
      0,
      order.length - 1
    )
    if (destination === currentIndex) return { changed: false, circuitId: input.circuitId }
    order.splice(currentIndex, 1)
    order.splice(destination, 0, input.circuitId)
    parent.subCircuitIds = order
    maybeApplyAutomaticEendraadNamingForPanel(project, panel.id)
    return { changed: true, circuitId: input.circuitId }
  }
  const result = moveCircuitToSecondaryBusInProject(
    project,
    panel.id,
    parent.id,
    moving.id,
    insertIndex,
    { insertBeforeCircuitContent: input.insertBeforeCircuitContent }
  )
  return { changed: result.changed, circuitId: result.circuitId ?? input.circuitId }
}

/** Promotes the protection owning a circuit onto the target panel main bus. */
export function promoteCircuitToMainBusInProject(
  project: ProjectV2,
  input: PromoteCircuitInput
): BusMoveResult {
  const panels = getEditableProjectElectricalPanels(project)
  const targetPanel = findPanelById(panels, input.panelId)
  if (!targetPanel) return { changed: false, reason: 'panel_not_found' }
  let sourcePanel: Panel | undefined
  let protection: ProtectionDevice | undefined
  for (const root of panels) {
    const pending = [root]
    while (pending.length) {
      const panel = pending.pop()!
      const owner = panel.protections.find((candidate) =>
        candidate.circuits?.some((circuit) => circuit.id === input.circuitId)
      )
      if (owner) {
        sourcePanel = panel
        protection = owner
        break
      }
      pending.push(...panel.subPanels)
    }
    if (protection) break
  }
  if (!sourcePanel || !protection) return { changed: false, reason: 'protection_owner_not_found' }

  const current = getMainBusItemsWithIndices(sourcePanel).find(
    (item) => item.type === 'protection' && item.id === protection!.id
  )
  if (sourcePanel.id === targetPanel.id && current) {
    const order = getMainBusItemsWithIndices(targetPanel)
    const currentIndex = order.findIndex(
      (item) => item.type === current.type && item.id === current.id
    )
    const desiredIndex = clamp(
      input.insertIndex > currentIndex ? input.insertIndex - 1 : input.insertIndex,
      0,
      order.length - 1
    )
    if (desiredIndex === currentIndex) return { changed: false, circuitId: input.circuitId }
  }

  relocateProtectionToPanelMainBus(sourcePanel, targetPanel, protection, input.insertIndex)
  syncLinkedSubPanelHierarchy(project)
  dedupePanelProtectionsInPanelTree(sourcePanel)
  dedupePanelProtectionsInPanelTree(targetPanel)
  maybeApplyAutomaticEendraadNamingForPanel(project, sourcePanel.id)
  if (sourcePanel.id !== targetPanel.id)
    maybeApplyAutomaticEendraadNamingForPanel(project, targetPanel.id)
  return { changed: true, circuitId: input.circuitId }
}
