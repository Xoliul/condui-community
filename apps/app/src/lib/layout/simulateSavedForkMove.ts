import { nanoid } from 'nanoid'
import type { ProjectV2 } from '@/types/projectV2'
import type { DropTarget } from './findDropTarget'
import type { EendraadPreviewChangeSet } from './eendraadPreviewModel'
import { eendraadMoveEndpoints } from '@/lib/commands/project/commands/eendraadMoveEndpoints'
import { ProjectCommandRegistry } from '@/lib/commands/project/registry'
import { applyCommandBatch } from '@/lib/commands/project/transaction'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { walkPanels, collectCircuits } from '@/lib/panel/panelTree'
import { getRiserTargetFields } from '@/lib/eendraad/oneWireRisers'
import { hasOneWireForks } from '@/lib/eendraad/oneWireForkProject'

/** Moves that target or touch fork-bearing circuits preview the real move command. */
export function isSavedForkMove(project: ProjectV2, sourceCircuitId: string, target: DropTarget): boolean {
  if (target.forkAfterEndpointId || target.forkBranchId || Object.keys(getRiserTargetFields(target)).length) return true
  const ids = new Set([sourceCircuitId, target.circuitId])
  return [...walkPanels(getProjectElectricalPanels(project))].flatMap(collectCircuits).some((circuit) => ids.has(circuit.id) && hasOneWireForks(circuit))
}

const registry = new ProjectCommandRegistry().register(eendraadMoveEndpoints)
export function simulateSavedForkMove(project: ProjectV2, moving: { draggedEndpointId: string; sourceCircuitId: string; endpointIds: string[] }, target: DropTarget): EendraadPreviewChangeSet | null {
  try {
    const result = applyCommandBatch(project, registry.parse([{ id: 'electrical.moveEndpoints', input: {
      draggedEndpointId: moving.draggedEndpointId, selectedEndpointIds: moving.endpointIds, target,
    } }]), { newId: () => nanoid(16), now: () => '2000-01-01T00:00:00.000Z', language: 'en' })
    if (result.project === project) return null
    const affectedCircuitIds = [...new Set([moving.sourceCircuitId, target.circuitId!])]
    return { project: result.project, affectedCircuitIds,
      affectedPanelIds: [...walkPanels(getProjectElectricalPanels(result.project))].filter((panel) => collectCircuits(panel).some((circuit) => affectedCircuitIds.includes(circuit.id))).map((panel) => panel.id),
      createdEndpointIds: result.results.flatMap((item) => item.select?.filter((ref) => ref.kind === 'endpoint').map((ref) => ref.id) ?? []),
      createdProtectionIds: [], createdTrunkDeviceIds: [], movedTrunkDeviceIds: [], createdSupplyTrunkDeviceIds: [], createdGroundTrunkDeviceIds: [],
    }
  } catch { return null }
}
