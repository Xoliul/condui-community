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
import type { TrunkDevice } from '@/types/schema'
import { getCircuitConverterDcConnectionCount, supportsCircuitConverterDcConnections } from '@/lib/layout/circuitConverterGeometry'
import { getSupplyConverterDcConnectionIndex } from '@/lib/supplyAssembly/converterDcConnections'
import { getConverterOutputDevices } from '@/lib/eendraad/converterOutputDevices'
import type { ProjectCommandRegistry } from './registry'
import { riserInsertionTargets } from './riserInsertionTargets'
import { forkInsertionTargets } from './forkInsertionTargets'
import { resolveElectricalSemanticTarget } from './electricalSemanticTarget'
import { canEditOneWireRisers } from '@/lib/eendraad/oneWireRisers'
import { hasOneWireForks } from '@/lib/eendraad/oneWireForkProject'
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

/**
 * The DC-bus positions of one root supply feed: a new branch per bus, the gaps inside each branch,
 * and, for a widened converter on a branch, every output and the gaps of its string. The values
 * are the ones the editor's own drop zones carry.
 */
function dcSupplyTargets(devices: readonly TrunkDevice[], feed: { panelId: string; busSectionId?: string }): DropTarget[] {
  const targets: DropTarget[] = []
  const base = {
    type: 'supplyConverterDcWire' as const,
    panelId: feed.panelId,
    supplyFeedScope: 'root' as const,
    ...(feed.busSectionId ? { busSectionId: feed.busSectionId } : {}),
  }
  const lane = (device: TrunkDevice) => ({
    supplyConverterDcBranch: device.supplyPath === 'converter-dc-top' ? ('top' as const) : ('right' as const),
    supplyConverterDcConnectionIndex: getSupplyConverterDcConnectionIndex(device) ?? 0,
  })
  const indexOf = (device: TrunkDevice) => devices.findIndex((candidate) => candidate.id === device.id)
  for (const bus of devices.filter((device) => device.type === 'dc_bus' || device.symbol === 'dc_bus')) {
    const hanging = devices.filter((device) => device.supplyDcBusId === bus.id)
    const last = hanging.reduce((max, device) => Math.max(max, indexOf(device)), indexOf(bus))
    targets.push({ ...base, ...lane(bus), supplyDcBusId: bus.id, supplyDeviceInsertIndex: last + 1 })
    const branches = new Map<string, TrunkDevice[]>()
    for (const device of hanging) {
      if (device.converterDcConnection || !device.supplyDcBusBranchId) continue
      branches.set(device.supplyDcBusBranchId, [...(branches.get(device.supplyDcBusBranchId) ?? []), device])
    }
    for (const [branchId, members] of branches) {
      const branch = { ...base, ...lane(bus), supplyDcBusId: bus.id, supplyDcBusBranchId: branchId }
      targets.push({ ...branch, supplyDeviceInsertIndex: indexOf(members[0]!) })
      for (const member of members) {
        targets.push({ ...branch, supplyDeviceInsertIndex: indexOf(member) + 1 })
        const count = getCircuitConverterDcConnectionCount(member)
        if (!supportsCircuitConverterDcConnections(member) || count < 2) continue
        for (let connectionIndex = 0; connectionIndex < count; connectionIndex++) {
          const output = { ...branch, converterDcConnection: { converterId: member.id, connectionIndex } }
          const string = hanging.filter(
            (device) =>
              device.converterDcConnection?.converterId === member.id &&
              device.converterDcConnection.connectionIndex === connectionIndex
          )
          targets.push({ ...output, supplyDeviceInsertIndex: (string.length ? indexOf(string[0]!) : indexOf(member) + 1) })
          for (const device of string) targets.push({ ...output, supplyDeviceInsertIndex: indexOf(device) + 1 })
        }
      }
    }
  }
  return targets
}

/**
 * The positions on each DC output of a widened converter in a circuit: every device position
 * (`branchDeviceInsertIndex` 0..n) for protections and strips, and an append position after the
 * output's last endpoint. The values match what `electrical_place_symbol` resolves for a
 * `converterOutput` destination and what the editor's drop zones carry.
 */
function circuitConverterOutputTargets(
  panelId: string,
  circuit: {
    id: string
    endpoints: readonly { id: string; converterDcConnection?: TrunkDevice['converterDcConnection'] }[]
    trunkDevices?: readonly TrunkDevice[]
  }
): DropTarget[] {
  const targets: DropTarget[] = []
  for (const converter of circuit.trunkDevices ?? []) {
    if (!supportsCircuitConverterDcConnections(converter)) continue
    const count = getCircuitConverterDcConnectionCount(converter)
    if (count < 2) continue
    for (let connectionIndex = 0; connectionIndex < count; connectionIndex++) {
      const connection = { converterId: converter.id, connectionIndex }
      const devices = getConverterOutputDevices(circuit.trunkDevices ?? [], connection).filter(
        (device) => device.type !== 'dc_bus'
      )
      const endpoints = circuit.endpoints
        .filter(
          (endpoint) =>
            endpoint.converterDcConnection?.converterId === converter.id &&
            endpoint.converterDcConnection.connectionIndex === connectionIndex
        )
        .map((endpoint) => endpoint.id)
      const base = {
        type: 'circuit' as const,
        panelId,
        circuitId: circuit.id,
        converterDcConnection: connection,
        branchId: `converter-dc-output-${converter.id}-${connectionIndex}`,
        branchEndpoints: endpoints,
      }
      for (let index = 0; index <= devices.length; index++) targets.push({ ...base, branchDeviceInsertIndex: index })
      if (endpoints.length > 0)
        targets.push({ ...base, insertAfterEndpointId: endpoints.at(-1)!, branchDeviceInsertIndex: devices.length })
    }
  }
  return targets
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
        for (const feed of rootFeeds)
          for (const target of dcSupplyTargets(feed.trunkDevices ?? [], { panelId: panel.id, busSectionId: feed.busSectionId }))
            add(target, panel.id)
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

  const late: Candidate[] = []
  for (const panel of panels) {
    const circuits = collectCircuits(panel).filter(
      (circuit) => !options.circuitId || circuit.id === options.circuitId
    )
    for (const circuit of circuits) {
      // Rows of a circuit with forks or risers name their cable run and place (the plain circuit and endpoint
      // slots would append them to the last riser, and the numbered ones carry no cable run).
      const ownRows = hasOneWireForks(circuit) && canEditOneWireRisers(circuit)
      if (ownRows) {
        for (const endpoint of circuit.endpoints) {
          const row = resolveElectricalSemanticTarget(project, { kind: 'endpoint', endpointId: endpoint.id })
          if (row.ok) add(row.target, panel.id)
        }
      } else {
        add({ type: 'circuit', panelId: panel.id, circuitId: circuit.id }, panel.id)
        for (const endpoint of circuit.endpoints) {
          add(
            { type: 'endpoint', panelId: panel.id, circuitId: circuit.id, endpointId: endpoint.id },
            panel.id
          )
        }
      }
      for (const target of circuitConverterOutputTargets(panel.id, circuit)) add(target, panel.id)
      for (const target of riserInsertionTargets(panel.id, circuit)) add(target, panel.id)
      const branches = ownRows ? [] : getStandardCircuitBranches(circuit)
      if (!branches.length && !ownRows) {
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

    // Fork slots come last, so they cannot crowd out the ordinary positions of a large board.
    for (const circuit of circuits)
      for (const target of forkInsertionTargets(panel.id, circuit)) late.push({ target, panelId: panel.id })

    if (!options.circuitId) {
      for (const protection of panel.protections) {
        add({ type: 'protection', panelId: panel.id, protectionId: protection.id }, panel.id)
        add({ type: 'rcd', panelId: panel.id, protectionId: protection.id }, panel.id)
      }
    }
  }
  for (const candidate of late) add(candidate.target, candidate.panelId)
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
