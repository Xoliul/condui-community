import { cloneValue } from '@/utils/cloneValue'
import { getEditableProjectElectricalPanels, getProjectElectricalPanels, type ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import type { Circuit, Endpoint, Panel } from '@/types/schema'

/** One board symbol (panel_distribution endpoint) whose ID occurs in more than one board. */
export interface DuplicatedBoardSymbol {
  endpointId: string
  label: string
  /** The board the symbol names through `panelId`, when that board holds a copy. */
  ownerPanelId: string | null
  /** Boards holding a copy that is not their own; the repair gives each a new symbol. */
  copyPanelIds: string[]
}

interface Occurrence {
  panel: Panel
  circuit: Circuit
  endpoint: Endpoint
}

function collectBoardSymbolOccurrences(panels: Panel[]): Map<string, Occurrence[]> {
  const byId = new Map<string, Occurrence[]>()
  const visit = (panel: Panel) => {
    const circuits = [...panel.circuits, ...panel.protections.flatMap((protection) => protection.circuits ?? [])]
    for (const circuit of circuits) {
      for (const endpoint of circuit.endpoints) {
        if (endpoint.symbol !== 'panel_distribution') continue
        const list = byId.get(endpoint.id) ?? []
        list.push({ panel, circuit, endpoint })
        byId.set(endpoint.id, list)
      }
    }
    panel.subPanels.forEach(visit)
  }
  panels.forEach(visit)
  return byId
}

function classify(occurrences: Occurrence[]) {
  const endpoint = occurrences[0]!.endpoint
  const owner = occurrences.find(({ panel }) => panel.id === endpoint.panelId) ?? occurrences[0]!
  return { owner, copies: occurrences.filter((occurrence) => occurrence !== owner) }
}

/**
 * Board symbols whose ID appears in more than one board. An older board-creation path matched
 * a new board's symbol by name, so a second board with the same name received the existing
 * board's symbol, endpoint and placement IDs included.
 */
export function findDuplicatedBoardSymbols(project: ProjectWithOptionalV2Electrical): DuplicatedBoardSymbol[] {
  const found: DuplicatedBoardSymbol[] = []
  for (const [endpointId, occurrences] of collectBoardSymbolOccurrences(getProjectElectricalPanels(project))) {
    if (new Set(occurrences.map(({ panel }) => panel.id)).size < 2) continue
    const { owner, copies } = classify(occurrences)
    found.push({
      endpointId,
      label: owner.endpoint.label || endpointId,
      ownerPanelId: owner.panel.id === owner.endpoint.panelId ? owner.panel.id : null,
      copyPanelIds: [...new Set(copies.map(({ panel }) => panel.id))],
    })
  }
  return found
}

export interface DuplicatedBoardSymbolRepair {
  repairedPanelIds: string[]
  createdEndpointIds: string[]
}

/**
 * Keeps each duplicated symbol in the board it names and gives every other board holding a copy
 * its own symbol: new endpoint and placement IDs, the board's own ID and name, the same plan
 * positions. Branch references in the copy's circuit follow the new endpoint ID.
 */
export function repairDuplicatedBoardSymbolsInProject(
  project: ProjectWithOptionalV2Electrical,
  newId: () => string
): DuplicatedBoardSymbolRepair {
  const result: DuplicatedBoardSymbolRepair = { repairedPanelIds: [], createdEndpointIds: [] }
  for (const occurrences of collectBoardSymbolOccurrences(getEditableProjectElectricalPanels(project)).values()) {
    if (new Set(occurrences.map(({ panel }) => panel.id)).size < 2) continue
    for (const { panel, circuit, endpoint } of classify(occurrences).copies) {
      const source = cloneValue(endpoint)
      const replacement: Endpoint = {
        ...source,
        id: newId(),
        label: panel.name,
        panelId: panel.id,
        placements: source.placements.map((placement) => ({ ...placement, id: newId() })),
      }
      circuit.endpoints = circuit.endpoints.map((entry) => (entry === endpoint ? replacement : entry))
      circuit.branches = circuit.branches?.map((branch) => ({
        ...branch,
        endpointIds: branch.endpointIds.map((id) => (id === endpoint.id ? replacement.id : id)),
      }))
      result.repairedPanelIds.push(panel.id)
      result.createdEndpointIds.push(replacement.id)
    }
  }
  return result
}
