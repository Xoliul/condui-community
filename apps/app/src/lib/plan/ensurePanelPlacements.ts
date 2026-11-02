import type { Circuit, Panel } from '@/types/schema'
import type { ProjectV2 } from '@/types/projectV2'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { addCircuitToProject } from '@/lib/eendraad/circuitMutations'
import { addEndpointToProject } from '@/lib/eendraad/endpointMutations'
import { addPlacementToProject } from '@/lib/plan/placementMutations'
import { ensurePanelPlacement, getPanelEndpoint } from '@/utils/panelPlacement'

export interface EnsurePanelPlacementsResult {
  createdCircuitIds: string[]
  createdEndpointIds: string[]
  createdPlacementIds: string[]
}

/**
 * Gives every board a distribution endpoint with a plan placement: creates the board's `PANEL`
 * circuit and endpoint when missing, and a placement when its endpoint has none.
 */
export function ensureAllPanelPlacementsInProject(
  project: ProjectV2,
  newId: () => string
): EnsurePanelPlacementsResult {
  const result: EnsurePanelPlacementsResult = {
    createdCircuitIds: [],
    createdEndpointIds: [],
    createdPlacementIds: [],
  }
  for (const panel of [...getEditableProjectElectricalPanels(project)] as Panel[]) {
    const panelPlacement = ensurePanelPlacement(project, panel, { newId })
    if (!panelPlacement) continue
    const existingEndpoint = getPanelEndpoint(project, panel.id)
    if (!existingEndpoint) {
      let dummyCircuit = panel.circuits.find((circuit: Circuit) => circuit.code === 'PANEL')
      if (!dummyCircuit) {
        dummyCircuit = {
          id: newId(),
          code: 'PANEL',
          kind: 'other',
          cable: { kind: 'XVB', conductors: 3, sectionMm2: 6, hasPE: true },
          endpoints: [],
        }
        if (addCircuitToProject(project, panel.id, dummyCircuit)) {
          result.createdCircuitIds.push(dummyCircuit.id)
        }
      }
      const circuitId = addEndpointToProject(
        project,
        dummyCircuit.id,
        { ...panelPlacement.endpoint, placements: [panelPlacement.placement] },
        undefined,
        undefined,
        newId
      )
      if (circuitId) {
        result.createdEndpointIds.push(panelPlacement.endpoint.id)
        result.createdPlacementIds.push(panelPlacement.placement.id)
      }
    } else if (existingEndpoint.placements.length === 0) {
      if (addPlacementToProject(project, existingEndpoint.id, panelPlacement.placement)) {
        result.createdPlacementIds.push(panelPlacement.placement.id)
      }
    }
  }
  return result
}
