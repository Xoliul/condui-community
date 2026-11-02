import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'
import { trackSymbolPlace } from '@/lib/analytics/editorEventAnalytics'
import type { DropBehaviorEditorHooks } from '@/lib/eendraad/dropBehaviors'
import { getViewportCenterPlanSpaceIfApplicable } from '@/lib/plan/autoSitplanPlacement'
import { ensureEarthingSitplanPlacement } from '@/lib/plan/ensureEarthingSitplanPlacement'
import { useProjectStore } from '@/stores/projectStore'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import { useUIStore } from '@/stores/uiStore'
import { useCanvasRegistryStore } from '@/stores/canvasRegistryStore'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { findPanelById } from '@/lib/panel/panelTree'

/**
 * The editor-side parts of the drop engine: the active floor and visible plan centre, live
 * store follow-ups and analytics. Spread into every editor `DropBehaviorCallbacks`; project
 * commands supply their own explicit inputs instead.
 */
export function createUiDropBehaviorHooks(
  ownerDocument = typeof document === 'undefined' ? undefined : document
): DropBehaviorEditorHooks {
  return {
    getSitplanTarget: () => {
      const ui = useUIStore.getState()
      const project = useProjectStore.getState().currentProject
      // The active one-wire slot has its own (usually stale) plan camera. Read
      // the mounted plan slot instead, including when it is in another window.
      const visiblePlan = useCanvasRegistryStore.getState().getSitplanPlacementTarget(ownerDocument)
      return {
        activeFloorId: visiblePlan?.activeFloorId ?? ui.activeFloorId,
        viewportCenter:
          visiblePlan?.viewportCenter ??
          (ui.activeFloorId
            ? getViewportCenterPlanSpaceIfApplicable(
                ui.viewportLayout,
                ui.planCanvasViewportPx,
                ui.activeFloorId,
                ui.activeFloorId,
                ui.planView
              )
            : null),
        activePanelId: project && ui.activePanelId &&
          findPanelById(getProjectElectricalPanels(project), ui.activePanelId) ? ui.activePanelId : null,
      }
    },
    ensureEarthingSitplanPlacement: (floorId, pos) => {
      ensureEarthingSitplanPlacement(floorId, pos)
    },
    ensureSecondaryPanelEarthingStem: (panelId) => {
      runProjectCommand('panel.ensureEarthingStem', { panelId })
    },
    onSymbolPlaced: trackSymbolPlace,
    onNotePlaced: () =>
      trackGoogleAnalyticsEvent('note_place', { canvas: 'eendraad', source: 'symbol_drop' }),
  }
}
