import type { ProjectV2 } from '@/types/projectV2'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import type { Point } from '@/types/ui'
import type { SitplanPlacementTarget } from './duplicateSitplanHelpers'
import { ProjectCommandRegistry } from '@/lib/commands/project/registry'
import { applyCommandBatch } from '@/lib/commands/project/transaction'
import { CommandError, type CommandInvocation } from '@/lib/commands/project/types'
import { electricalPlaceSymbol } from '@/lib/commands/project/commands/electricalPlaceSymbol'
import { eendraadMoveEndpoints } from '@/lib/commands/project/commands/eendraadMoveEndpoints'
import { electricalMoveProtectionOnBus } from '@/lib/commands/project/commands/electricalMoveProtectionOnBus'
import { electricalMoveSupplyTrunkDevice, electricalMoveCircuitTrunkDevice } from '@/lib/commands/project/commands/electricalMoveTrunkDevices'
import { propertiesEdit } from '@/lib/commands/project/commands/propertiesEdit'
import { electricalDuplicateElements } from '@/lib/commands/project/commands/electricalDuplicateElements'
import { electricalDuplicateProtection } from '@/lib/commands/project/commands/electricalDuplicateProtection'
import { supplyCreateTap } from '@/lib/commands/project/commands/supplyCreateTap'
import { supplyMoveTap } from '@/lib/commands/project/commands/supplyMoveTap'
import { simulatePanelAttachmentMoveOnProject } from '@/lib/layout/eendraadPreviewSimulation'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'

const registry = new ProjectCommandRegistry().register(electricalPlaceSymbol)
  .register(eendraadMoveEndpoints).register(electricalMoveProtectionOnBus)
  .register(electricalMoveSupplyTrunkDevice).register(electricalMoveCircuitTrunkDevice)
  .register(propertiesEdit).register(electricalDuplicateElements).register(electricalDuplicateProtection)
  .register(supplyCreateTap).register(supplyMoveTap)
const acceptance = new WeakMap<ProjectV2, Map<string, boolean>>()

export function canPreviewPanelAttachmentMove(project: ProjectV2, panelId: string, target: DropTarget): boolean {
  let cache = acceptance.get(project)
  if (!cache) { cache = new Map(); acceptance.set(project, cache) }
  const key = JSON.stringify({ panelAttachment: panelId, target })
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const result = simulatePanelAttachmentMoveOnProject(project, { panelId }, target)
  const changed = !!result && JSON.stringify(getProjectElectricalPanels(project)) !==
    JSON.stringify(getProjectElectricalPanels(result.project))
  if (cache.size >= 256) cache.delete(cache.keys().next().value!)
  cache.set(key, changed)
  return changed
}

/** Run the real transaction on an isolated draft, without publishing events/history/selection. */
export function canPreviewElectricalCommand(project: ProjectV2, invocation: CommandInvocation): boolean {
  let cache = acceptance.get(project)
  if (!cache) { cache = new Map(); acceptance.set(project, cache) }
  const key = JSON.stringify(invocation)
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  let accepted = false
  let id = 0
  try {
    const result = applyCommandBatch(project, registry.parse([invocation]), {
      newId: () => `__drop_preview_${++id}`, now: () => '2000-01-01T00:00:00.000Z', language: 'en',
    })
    accepted = result.project !== project
  } catch (error) {
    if (!(error instanceof CommandError)) throw error
  }
  // Pointer motion in one slot reuses this decision. Bound memory during long drags.
  if (cache.size >= 256) cache.delete(cache.keys().next().value!)
  cache.set(key, accepted)
  return accepted
}

export function canPreviewElectricalPlacement(project: ProjectV2, symbolId: string, target: DropTarget,
  context?: { position?: Point; sitplan?: SitplanPlacementTarget; searchPreset?: string }): boolean {
  return canPreviewElectricalCommand(project, { id: 'electrical.placeSymbol', input: {
    symbolId, target, ...(context?.searchPreset ? { searchPreset: context.searchPreset } : {}), ...(symbolId === 'note' ? { dropCanvasPosition: context?.position } : {}),
    ...(context?.sitplan ? { sitplan: context.sitplan } : {}),
  } })
}
