/**
 * The new-riser drop zone: right of the trunk just above the breaker (right of the last riser once risers exist).
 * A drop there creates the next riser with the placed or moved content. Series and trunk hits win over the zone,
 * and the zone sits at the split height, below the cable captions and clear of the breaker label.
 */
import type { BottomUpLayoutResult } from './bottomUpLayout'
import { getPanelDiagramId } from './bottomUpLayout'
import type { BranchDropTargets } from './branchDropInteraction'
import type { DropTarget } from './findDropTarget'
import { getDropZoneCentre, getRiserDropZone } from './newLineDropZone'
import { getDrawnRiserSplitY } from './circuitRiserSplit'
import { LAYOUT_CONSTANTS } from './bottomUpLayoutConstants'
import { getDrawnSupplyTapCircuitIds } from './supplyTapLayout'
import { canEditOneWireRisers } from '@/lib/eendraad/oneWireRisers'
import { checkForkRunMove } from '@/lib/eendraad/forkRunMove'
import { isTerminalPanelFeederCircuit } from '@/lib/eendraad/panelSupplyLink'
import type { Circuit } from '@/types/schema'

export function getNewRiserIntentId(diagramId: string, circuitId: string): string {
  return `${diagramId}/${circuitId}/new-riser`
}

export function collectNewRiserDropTargets(
  layout: BottomUpLayoutResult, zoom: number, movingIds: readonly string[], result: BranchDropTargets,
): void {
  const moving = new Set(movingIds)
  const allCircuits = layout.panels.flatMap((panel) => panel.circuits.map((column) => column.circuit))
  const source: Circuit | undefined = movingIds.length
    ? allCircuits.find((circuit) => circuit.endpoints.some((endpoint) => moving.has(endpoint.id))) : undefined
  for (const panel of layout.panels) {
    const tapCircuitIds = panel.frameRole === 'supply' ? getDrawnSupplyTapCircuitIds(panel) : null
    if (tapCircuitIds?.size === 0) continue
    const diagramId = getPanelDiagramId(panel)
    const circuitIds = [...new Set(panel.branches.map((branch) => branch.circuitId))]
    for (const circuitId of circuitIds) {
      const circuit = panel.circuits.find((column) => column.circuit.id === circuitId)?.circuit
      if (!circuit || (tapCircuitIds && !tapCircuitIds.has(circuit.id))) continue
      if (!circuit.endpoints.length || !canEditOneWireRisers(circuit) || panel.panel.protections.some((protection) =>
        isTerminalPanelFeederCircuit(protection, circuit) && protection.circuits?.some((entry) => entry.id === circuit.id))) continue
      const roots = panel.branches.filter((branch) => branch.circuitId === circuitId && !branch.forkFrom)
      if (!roots.length) continue
      const trunkX = Math.min(...roots.map((branch) => branch.trunkX))
      const lastX = Math.max(...roots.map((branch) => branch.trunkX))
      const trunkY = roots[0]!.trunkY
      const target: DropTarget = {
        type: 'circuit', panelId: panel.ownerPanelId ?? panel.panel.id, diagramId, circuitId, wireDomain: 'AC', newRiser: true,
        ...(moving.size ? {} : { branchEndpoints: [] }),
      }
      if (moving.size) {
        const first = movingIds[0]!
        if (!source || source.id === circuit.id && source.endpoints.every((endpoint) => moving.has(endpoint.id))) continue
        const check = checkForkRunMove(source, circuit, first, movingIds, target)
        if (!check.ok || check.noOp) continue
      }
      const deviceY = (id: string) => panel.elements.find((element) => element.type === 'trunkDevice' && element.trunkDeviceId === id)?.position.y
      const y = getDrawnRiserSplitY(circuit, trunkY, roots[0]!.column?.splitRise, deviceY, LAYOUT_CONSTANTS.SYMBOL_SIZE)
      const wirePoint = { x: lastX > trunkX ? lastX : trunkX, y }
      const zone = getRiserDropZone(wirePoint, Math.max(...roots.map((branch) => branch.branchY)), zoom)
      result.intents.push({
        id: getNewRiserIntentId(diagramId, circuitId), kind: 'riser', target, point: getDropZoneCentre(zone), wirePoint,
        wireOrigin: wirePoint, direction: 1, radiusPx: 12, zone,
      })
      result.regions.push(zone)
      result.circuitIds.add(circuit.id)
    }
  }
}
