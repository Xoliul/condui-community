/**
 * Alt-drag duplicate on the situation plan, editor side: decides which symbols can be copied,
 * runs the `plan.altDuplicate` command and selects the copy. The project change itself lives
 * in `planAltDuplicateMutations.ts`.
 */

import { endpointSymbolCanBeDuplicated } from '@/lib/eendraad/duplicateEndpoint'
import { getViewportCenterPlanSpaceIfApplicable } from '@/lib/plan/autoSitplanPlacement'
import { PLAN_ALT_DRAG_COPY_OFFSET } from '@/lib/plan/planAltDuplicateMutations'
import { supportsSupplyDeviceMultiplier } from '@/lib/supplyAssembly/inverterMultipliers'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import { useUIStore } from '@/stores/uiStore'
import type { Endpoint, Placement, TrunkDevice } from '@/types/schema'
import type { Point } from '@/types/ui'
import { endpointSupportsMultiplier } from '@/utils/endpointMultipliers'

export { PLAN_ALT_DRAG_COPY_OFFSET }

export type PlanAltDuplicateSource = {
  endpoint?: Endpoint | null
  trunkDevice?: TrunkDevice | null
}

/** Whether this plan symbol has a duplication strategy. */
export function canPlanAltDuplicate(source: PlanAltDuplicateSource): boolean {
  if (source.trunkDevice) return supportsSupplyDeviceMultiplier(source.trunkDevice)
  if (!source.endpoint) return false
  return endpointSupportsMultiplier(source.endpoint) || endpointSymbolCanBeDuplicated(source.endpoint)
}

/**
 * Create the copy that the shared Alt-drag handoff moves, as one undoable step, and select its
 * placement. Every eligible symbol uses this one entry point; only the domain rule differs
 * (another occurrence versus another physical endpoint). `finalPos` is where the pointer ended.
 */
export function createPlanAltDuplicatePlacement(
  source: PlanAltDuplicateSource,
  refPlacement: Placement,
  finalPos?: Point
): string | null {
  const ref = source.trunkDevice
    ? ({ kind: 'trunkDevice', id: source.trunkDevice.id } as const)
    : source.endpoint
      ? ({ kind: 'endpoint', id: source.endpoint.id } as const)
      : null
  if (!ref) return null
  const ui = useUIStore.getState()
  const viewportCenter = ui.activeFloorId
    ? getViewportCenterPlanSpaceIfApplicable(
        ui.viewportLayout,
        ui.planCanvasViewportPx,
        ui.activeFloorId,
        ui.activeFloorId,
        ui.planView
      )
    : null
  const outcome = runProjectCommand(
    'plan.altDuplicate',
    {
      source: ref,
      refPlacementId: refPlacement.id,
      ...(finalPos ? { pos: { x: finalPos.x, y: finalPos.y } } : {}),
      sitplan: {
        activeFloorId: ui.activeFloorId,
        viewportCenter,
        activePanelId: ui.activePanelId ?? null,
      },
    },
    { label: 'duplicate plan symbol via alt-drag', source: 'plan-alt-drag' }
  )
  const placementId = outcome?.results[0]?.select?.[0]?.id
  if (!placementId) return null
  useUIStore.getState().setSelection({ type: 'placement', ids: [placementId] })
  return placementId
}
