import type { ProjectV2 } from '@/types/projectV2'
import { isSupplyDiagramId } from '@/lib/layout/supplyFrameRole'
import type { DragPreviewState } from './useEendraadDragPreview'
import type { SitplanPlacementTarget } from '@/lib/eendraad/duplicateSitplanHelpers'
import { canPreviewElectricalCommand, canPreviewElectricalPlacement, canPreviewPanelAttachmentMove } from '@/lib/eendraad/previewDropValidation'
import { canGrowSameSymbolAddMoreTarget, canIncrementSameSymbolAddMoreTarget } from '@/lib/eendraad/sameSymbolAddMore'
import { getSymbolById } from '@/lib/symbols'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'
import { getMainBusOrder } from '@/lib/eendraad/mainBusOrder'
import { panelHasModularChangeover } from '@/lib/panel/panelFeedOrganization'
import { findEndpointById } from '@/lib/eendraad/projectElectricalDomain'
import { findTrunkDeviceInProject } from '@/lib/eendraad/findTrunkDeviceInProject'

/** Acceptance and presentation are separate: a geometry simulation is not permission to drop. */
export function validateEendraadPreview(project: ProjectV2 | null, preview: DragPreviewState | null,
  sitplan: SitplanPlacementTarget,
  duplicate?: { id: string; kind: 'endpoint' | 'trunkDevice' | 'protection' }): DragPreviewState | null {
  if (!project || !preview?.symbolData || !preview.dropTarget && !preview.sameSymbolAddMore) return null
  if (preview.sameSymbolAddMore && !preview.movingEndpointSelection) {
    const previous = preview.sameSymbolAddMore.target
    const endpoint = previous.endpoint ? getProjectElectricalPanels(project)
      .map((panel) => findEndpointById(panel, previous.endpoint!.id)?.endpoint).find(Boolean) : undefined
    const trunkDevice = previous.trunkDevice ? findTrunkDeviceInProject(project, previous.trunkDevice.id) : null
    const current = endpoint ? { endpoint } : trunkDevice ? { trunkDevice } : null
    return current && canIncrementSameSymbolAddMoreTarget(preview.symbolData.id, current) &&
      canGrowSameSymbolAddMoreTarget(current) ? preview : null
  }
  const target = preview.dropTarget!
  let accepted: boolean
  if (target.supplyTapAnchor && target.panelId) {
    accepted = canPreviewElectricalCommand(project, { id: 'supply.createTap', input: {
      ownerPanelId: target.panelId, anchor: target.supplyTapAnchor, symbolId: preview.symbolData.id,
      ...(preview.symbolData.searchPreset ? { searchPreset: preview.symbolData.searchPreset } : {}),
    } })
  } else if (duplicate) {
    accepted = canPreviewElectricalCommand(project, duplicate.kind === 'protection'
      ? { id: 'electrical.duplicateProtection', input: { protectionId: duplicate.id, dropTarget: target,
        sitplanTarget: { activeFloorId: sitplan.activeFloorId, viewportCenter: sitplan.viewportCenter } } }
      : { id: 'electrical.duplicateElements', input: { items: [{ kind: duplicate.kind, id: duplicate.id }],
        purpose: 'altDrag', target: { type: 'drop', target,
          ...(preview.relocatingSupplyTrunkDevice?.targetMounting
            ? { targetMounting: preview.relocatingSupplyTrunkDevice.targetMounting } : {}) }, sitplan } })
  } else if (preview.movingEndpointSelection) {
    const move = preview.movingEndpointSelection
    accepted = canPreviewElectricalCommand(project, { id: 'electrical.moveEndpoints', input: {
      draggedEndpointId: move.draggedEndpointId, selectedEndpointIds: move.endpointIds, target, sitplan,
    } })
  } else if (preview.movingProtection) {
    accepted = canPreviewElectricalCommand(project, { id: 'electrical.moveProtectionOnBus', input: {
      kind: 'protectionDrop', protectionId: preview.movingProtection.protectionId, target,
    } })
  } else if (preview.relocatingSupplyTrunkDevice) {
    accepted = canPreviewElectricalCommand(project, { id: 'electrical.moveSupplyTrunkDevice', input: {
      deviceId: preview.relocatingSupplyTrunkDevice.id, target,
      targetMounting: preview.relocatingSupplyTrunkDevice.targetMounting,
    } })
  } else if (preview.relocatingTrunkDevice) {
    accepted = canPreviewElectricalCommand(project, { id: 'electrical.moveCircuitTrunkDevice', input: {
      deviceId: preview.relocatingTrunkDevice.id, sourceCircuitId: preview.relocatingTrunkDevice.sourceCircuitId, target,
    } })
  } else if (preview.movingPanelAttachment) {
    accepted = canPreviewPanelAttachmentMove(project, preview.movingPanelAttachment.panelId, target)
  } else if (getSymbolById(preview.symbolData.id)?.busFeedKind) {
    const panel = target.panelId ? findPanelById(getProjectElectricalPanels(project), target.panelId) : null
    if (!panel) return null
    const supplyFrame = isSupplyDiagramId(target.diagramId)
    const order = getMainBusOrder(panel)
    const referencedIndex = order.findIndex((entry) => entry.id === (target.protectionId ?? target.circuitId))
    const index = target.type === 'mainBus' && typeof target.mainBusInsertIndex === 'number'
      ? target.mainBusInsertIndex : referencedIndex >= 0 ? referencedIndex : undefined
    if (!supplyFrame && index == null) return null
    accepted = canPreviewElectricalCommand(project, { id: 'properties.edit', input: { edits: [], actions: [
      supplyFrame ? { kind: 'panelFeedOrganization', panelId: panel.id,
        organization: panelHasModularChangeover(project, panel.id) ? 'split-switchable' : 'split-backup' }
        : { kind: 'panelBusFeedBoundary', panelId: panel.id, feed: preview.symbolData.busFeedKind, mainBusInsertIndex: index },
    ] } })
  } else {
    accepted = canPreviewElectricalPlacement(project, preview.symbolData.id, target, { position: preview.position, sitplan, searchPreset: preview.symbolData.searchPreset })
  }
  return accepted ? preview : null
}
