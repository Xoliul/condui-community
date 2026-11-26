import {
  findPanelOwnDistributionEndpoint,
  isPanelDistributionEndpointForPanel,
} from '@/lib/eendraad/panelSupplyLink'
import { generateId } from '@/utils/id'
import type { Circuit, Endpoint, Panel, Placement } from '@/types/schema'

export interface PanelDistributionPlacementMutation {
  circuitId: string
  endpointId: string
  placementId: string
  createdCircuitId?: string
  createdEndpointId?: string
  placementAdded: boolean
}

export function createPanelDistributionEndpoint(
  panel: Panel,
  newId: () => string = generateId
): Endpoint {
  return {
    id: newId(),
    type: 'fixed_appliance',
    label: panel.name,
    panelId: panel.id,
    symbol: 'panel_distribution',
    placements: [],
  }
}

/**
 * Attach one already-resolved plan placement to a panel's ordinary distribution endpoint.
 * The endpoint lives on the panel's `PANEL` pseudo-circuit when one must be created; this is
 * the same portable representation used by `addPanelInProject` and plan placement commands.
 */
export function ensurePanelDistributionPlacementInProject(
  panel: Panel,
  placement: Placement,
  options: {
    newId?: () => string
    endpointCandidate?: Endpoint
  } = {}
): PanelDistributionPlacementMutation {
  const { endpoint, ...mutation } = ensurePanelDistributionEndpointInProject(panel, options)
  const placementAdded = !endpoint.placements.some((entry) => entry.id === placement.id)
  if (placementAdded) endpoint.placements.push(placement)
  return { ...mutation, endpointId: endpoint.id, placementId: placement.id, placementAdded }
}

export function ensurePanelDistributionEndpointInProject(
  panel: Panel,
  options: { newId?: () => string; endpointCandidate?: Endpoint } = {}
) {
  const newId = options.newId ?? generateId
  const existingPanelEndpoint = findPanelOwnDistributionEndpoint(panel)
  // A candidate that names another board is that board's symbol; reusing it would give two
  // boards one endpoint and placement ID.
  const candidate =
    options.endpointCandidate?.panelId && options.endpointCandidate.panelId !== panel.id
      ? undefined
      : options.endpointCandidate
  let endpoint = existingPanelEndpoint ?? candidate
  let circuit = endpoint
    ? panel.circuits.find((candidate) => candidate.endpoints.includes(endpoint!))
    : undefined
  if (!circuit) {
    circuit = panel.circuits.find((candidate) => candidate.code === 'PANEL')
  }

  let createdCircuitId: string | undefined
  if (!circuit) {
    const created: Circuit = {
      id: newId(),
      code: 'PANEL',
      kind: 'other',
      cable: { kind: 'XVB', conductors: 3, sectionMm2: 6, hasPE: true },
      endpoints: [],
    }
    panel.circuits.push(created)
    circuit = created
    createdCircuitId = created.id
  }

  let createdEndpointId: string | undefined
  if (!endpoint) {
    endpoint = createPanelDistributionEndpoint(panel, newId)
    createdEndpointId = endpoint.id
  }

  const endpointId = endpoint.id
  // A candidate may already be present on another circuit in this panel. Prefer its current
  // owner rather than inserting the same electrical identity twice.
  const existingOwner = panel.circuits.find((candidate) =>
    candidate.endpoints.some((entry) => entry.id === endpointId && isPanelDistributionEndpointForPanel(entry, panel))
  )
  if (existingOwner) circuit = existingOwner
  if (!circuit.endpoints.some((entry) => entry.id === endpointId))
    circuit.endpoints.push(endpoint)

  return {
    circuitId: circuit.id,
    endpoint,
    ...(createdCircuitId ? { createdCircuitId } : {}),
    ...(createdEndpointId ? { createdEndpointId } : {}),
  }
}
