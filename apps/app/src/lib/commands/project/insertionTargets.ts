import type { ProjectV2 } from '@/types/projectV2'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { collectCircuits, walkPanels } from '@/lib/panel/panelTree'
import { getStandardCircuitBranches } from '@/lib/layout/endpointChains'
import { getPanelBusSections } from '@/lib/panel/panelBusSections'
import { getMainBusItemsWithIndices } from '@/lib/eendraad/mainBusOrder'
import { symbols, type SymbolMetadata } from '@/lib/symbols'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import type { ProjectCommandRegistry } from './registry'
import { applyCommandBatch } from './transaction'
import { CommandError } from './types'

const PLACE_SYMBOL_COMMAND = 'electrical.placeSymbol'
const MAX_TARGETS = 256
const MAX_DRY_RUNS = 768
const MAX_PAGE_SIZE = 100

export interface InsertionTargetOptions {
  symbolId?: string
  panelId?: string
  circuitId?: string
  offset?: number
  limit?: number
}

export interface InsertionTarget {
  symbol: Pick<SymbolMetadata, 'id' | 'name' | 'nameNL' | 'nameFR' | 'category'>
  input: {
    symbolId: string
    target: DropTarget
    sitplan?: {
      activeFloorId: null
      viewportCenter: null
      activePanelId: string | null
    }
  }
}

export interface InsertionTargetPage {
  targets: InsertionTarget[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
  truncated: boolean
}

type Candidate = { target: DropTarget; panelId: string | null }

function appendTarget(targets: Candidate[], candidate: Candidate): boolean {
  if (targets.length >= MAX_TARGETS) return false
  targets.push(candidate)
  return true
}

/** Construct only identities already present in the source snapshot; never normalize topology. */
function collectTargets(
  project: ProjectV2,
  options: InsertionTargetOptions
): { targets: Candidate[]; truncated: boolean } {
  const roots = getProjectElectricalPanels(project)
  const panels = [...walkPanels(roots)].filter(
    (panel) => !options.panelId || panel.id === options.panelId
  )
  const candidates: Candidate[] = []
  let truncated = false
  const add = (target: DropTarget, panelId: string | null) => {
    if (!appendTarget(candidates, { target, panelId })) truncated = true
  }

  // Reserve early space for panel-bus and supply anchors so larger circuit trees cannot
  // crowd those schematic destinations out of the bounded candidate set.
  if (!options.circuitId) {
    for (const panel of panels) {
      const mainBusItems = getMainBusItemsWithIndices(panel)
      for (const section of getPanelBusSections(panel)) {
        for (let index = 0; index <= mainBusItems.length; index++) {
          add(
            {
              type: 'mainBus',
              panelId: panel.id,
              busSectionId: section.id,
              mainBusInsertIndex: index,
              mainBusItemCount: mainBusItems.length,
            },
            panel.id
          )
        }
      }
      if (panel.isMain) {
        const installation = getProjectElectricalInstallation(project)
        const rootFeeds =
          installation?.feedTopology?.rootFeeds.filter((feed) => feed.panelId === panel.id) ?? []
        const sharedCount = installation?.mainSupply.supplyTrunkDevices?.length ?? 0
        add(
          {
            type: 'supplyWire',
            panelId: panel.id,
            supplyFeedScope: 'shared',
            supplyDeviceInsertIndex: sharedCount,
          },
          panel.id
        )
        add(
          {
            type: 'supplyWire',
            panelId: panel.id,
            supplyFeedScope: 'shared',
            supplyDeviceInsertIndex: 0,
          },
          panel.id
        )
        for (const feed of rootFeeds) {
          const count = feed.trunkDevices?.length ?? 0
          add(
            {
              type: 'supplyWire',
              panelId: panel.id,
              supplyFeedScope: 'root',
              supplyDeviceInsertIndex: count,
              busSectionId: feed.busSectionId,
            },
            panel.id
          )
          add(
            {
              type: 'supplyWire',
              panelId: panel.id,
              supplyFeedScope: 'root',
              supplyDeviceInsertIndex: 0,
              busSectionId: feed.busSectionId,
            },
            panel.id
          )
        }
        if (!rootFeeds.length) {
          add(
            {
              type: 'supplyWire',
              panelId: panel.id,
              supplyFeedScope: 'root',
              supplyDeviceInsertIndex: 0,
            },
            panel.id
          )
        }
      }
    }
  }

  for (const panel of panels) {
    const circuits = collectCircuits(panel).filter(
      (circuit) => !options.circuitId || circuit.id === options.circuitId
    )
    for (const circuit of circuits) {
      add({ type: 'circuit', panelId: panel.id, circuitId: circuit.id }, panel.id)
      for (const endpoint of circuit.endpoints) {
        add(
          { type: 'endpoint', panelId: panel.id, circuitId: circuit.id, endpointId: endpoint.id },
          panel.id
        )
      }
      const branches = getStandardCircuitBranches(circuit)
      if (!branches.length) {
        add(
          {
            type: 'circuit',
            panelId: panel.id,
            circuitId: circuit.id,
            branchId: `branch-${circuit.id}-empty`,
            branchEndpoints: [],
            branchInsertIndex: 0,
          },
          panel.id
        )
      }
      branches.forEach((branch, branchIndex) => {
        const endpointIds = branch.map((endpoint) => endpoint.id)
        add(
          {
            type: 'circuit',
            panelId: panel.id,
            circuitId: circuit.id,
            branchId: `branch-${circuit.id}-${branchIndex}`,
            branchEndpoints: endpointIds,
            branchInsertIndex: endpointIds.length,
          },
          panel.id
        )
        endpointIds.forEach((endpointId, index) =>
          add(
            {
              type: 'circuit',
              panelId: panel.id,
              circuitId: circuit.id,
              branchId: `branch-${circuit.id}-${branchIndex}`,
              branchEndpoints: endpointIds,
              insertAfterEndpointId: endpointId,
              branchInsertIndex: index + 1,
            },
            panel.id
          )
        )
      })
    }

    if (!options.circuitId) {
      for (const protection of panel.protections) {
        add({ type: 'protection', panelId: panel.id, protectionId: protection.id }, panel.id)
        add({ type: 'rcd', panelId: panel.id, protectionId: protection.id }, panel.id)
      }
    }
  }
  return { targets: candidates, truncated }
}

/** Whether a symbol ID can be placed in the one-wire schematic at all. */
export function isSchematicLibrarySymbol(symbolId: string): boolean {
  return librarySymbols(symbolId).length > 0
}

function librarySymbols(symbolId?: string): SymbolMetadata[] {
  return symbols.filter(
    (symbol) =>
      (!symbolId || symbol.id === symbolId) &&
      !symbol.hiddenFromLibrary &&
      (symbol.scope === 'eendraad' || symbol.scope === 'both')
  )
}

/**
 * Discovers executable electrical.placeSymbol invocations. Each returned input has passed the
 * real command apply path against a private Immer draft, so symbol-specific drop behavior and
 * domain follow-ups are included without publishing events or changing the caller's snapshot.
 */
export function discoverInsertionTargets(
  project: ProjectV2,
  registry: ProjectCommandRegistry,
  options: InsertionTargetOptions = {}
): InsertionTargetPage {
  const requestedOffset = options.offset ?? 0
  const requestedLimit = options.limit ?? 25
  const offset = Number.isFinite(requestedOffset) ? Math.max(0, Math.floor(requestedOffset)) : 0
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(requestedLimit)))
    : 25
  const command = registry.get(PLACE_SYMBOL_COMMAND)
  if (!command || (options.symbolId && !librarySymbols(options.symbolId).length)) {
    return { targets: [], total: 0, offset, limit, hasMore: false, truncated: false }
  }
  const { targets: candidates, truncated: candidateTruncated } = collectTargets(project, options)
  const availableSymbols = librarySymbols(options.symbolId)
  const found: InsertionTarget[] = []
  const seen = new Set<string>()
  let runs = 0
  let nextDryRunId = 0
  let truncated = candidateTruncated
  // Interleave symbols and targets so a broad request represents the library instead of
  // exhausting the dry-run budget on the first symbol.
  outer: for (const candidate of candidates) {
    for (const symbol of availableSymbols) {
      if (runs >= MAX_DRY_RUNS) {
        truncated = true
        break outer
      }
      runs++
      const input = {
        symbolId: symbol.id,
        target: candidate.target,
        sitplan: { activeFloorId: null, viewportCenter: null, activePanelId: candidate.panelId },
      }
      const key = JSON.stringify(input)
      if (seen.has(key)) continue
      seen.add(key)
      try {
        const parsed = registry.parse([{ id: PLACE_SYMBOL_COMMAND, input }])
        const dryRun = applyCommandBatch(project, parsed, {
          newId: () => `dryrun${String(nextDryRunId++).padStart(10, '0')}`,
          now: () => '2000-01-01T00:00:00.000Z',
          language: 'en-GB',
        })
        if (dryRun.project === project) continue
        found.push({
          symbol: {
            id: symbol.id,
            name: symbol.name,
            nameNL: symbol.nameNL,
            nameFR: symbol.nameFR,
            category: symbol.category,
          },
          input,
        })
      } catch (error) {
        if (error instanceof CommandError) continue
        throw error
      }
    }
  }
  const targets = found.slice(offset, offset + limit)
  return {
    targets,
    total: found.length,
    offset,
    limit,
    hasMore: offset + targets.length < found.length,
    truncated,
  }
}
