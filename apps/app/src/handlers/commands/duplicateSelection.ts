import {
  canDuplicateEendraadSelection,
  runEendraadDuplicate,
} from '@/lib/eendraad/duplicateSelection'
import { canDuplicatePlanSelection, runPlanDuplicate } from '@/lib/plan/planDuplicateSelection'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import { duplicateProtection } from '@/handlers/eendraad/duplicateProtection'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'

/**
 * Duplicates the current selection. On the situation plan (or with placements selected)
 * the plan duplicate wins; otherwise the one-wire duplicate runs.
 */
export function duplicateSelection(panelIndex: number | null): boolean {
  const selection = useUIStore.getState().selection
  const store = useProjectStore.getState()
  const ui = useUIStore.getState()
  const hoveredCanvas =
    panelIndex != null ? ui.viewportLayout.panels[panelIndex]?.canvas : undefined
  const planGetters = {
    getEndpointById: store.getEndpointById,
    getPlacementById: store.getPlacementById,
    getPlacementsByFloor: store.getPlacementsByFloor,
    findCircuitForEndpoint: store.findCircuitForEndpoint,
    getPanelById: store.getPanelById,
    getPanelByName: store.getPanelByName,
    getAllEndpoints: store.getAllEndpoints,
    getCurrentProject: () => store.currentProject,
  }
  const preferPlanDuplicate = hoveredCanvas === 'plan' || selection.type === 'placement'
  if (preferPlanDuplicate && canDuplicatePlanSelection(selection, planGetters, ui.activeFloorId)) {
    const planDupResult = runPlanDuplicate(selection, ui.activeFloorId)
    if (planDupResult) {
      ui.setSelection(planDupResult)
      return true
    }
  }

  // Individual one-wire endpoint/device duplication uses one semantic command,
  // including multiplier, DC-branch and supply/ground group semantics.
  const project = store.currentProject
  if (project && (selection.type === 'endpoint' || selection.type === 'trunkDevice') && selection.ids.length) {
    if (canDuplicateEendraadSelection(selection, {
      getEndpointById: store.getEndpointById,
      getCircuitById: store.getCircuitById,
      findCircuitForEndpoint: store.findCircuitForEndpoint,
      getTrunkDeviceById: store.getTrunkDeviceById,
      getProtectionById: store.getProtectionById,
      getCurrentProject: () => project,
    })) {
      const result = runProjectCommand('electrical.duplicateElements', {
        items: selection.ids.map((id) => ({ kind: selection.type === 'endpoint' ? 'endpoint' as const : 'trunkDevice' as const, id })),
        purpose: 'duplicate',
        target: { type: 'sourceSelection' },
        sitplan: { activeFloorId: ui.activeFloorId, viewportCenter: null, activePanelId: null },
      }, { label: 'Duplicate selection' })
      const created = result?.results[0]?.select?.filter((ref) => ref.kind === selection.type)
      if (!result?.changed || !created) return false
      if (created.length === 0) return false
      ui.setSelection({ type: selection.type, ids: created.map((ref) => ref.id) })
      return true
    }
    return false
  }

  const getters = {
    getEndpointById: store.getEndpointById,
    getCircuitById: store.getCircuitById,
    findCircuitForEndpoint: store.findCircuitForEndpoint,
    getTrunkDeviceById: store.getTrunkDeviceById,
    getProtectionById: store.getProtectionById,
    getCurrentProject: () => store.currentProject,
  }
  if (!canDuplicateEendraadSelection(selection, getters)) return false
  const dupResult = runEendraadDuplicate(
    selection,
    getters,
    (protectionId) => duplicateProtection({ protectionId }),
    { activeFloorId: ui.activeFloorId }
  )
  if (!dupResult) return false
  useUIStore.getState().setSelection(dupResult.selection)
  return true
}
