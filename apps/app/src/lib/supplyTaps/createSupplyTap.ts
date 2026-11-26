import { placeElectricalSymbolInProject } from '@/lib/eendraad/electricalSymbolDrop'
import { getDomainTranslator } from '@/lib/i18n/domainI18n'
import { findPanelById } from '@/lib/panel/panelTree'
import {
  getEditableProjectElectricalPanels,
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { getSymbolById } from '@/lib/symbols'
import { createDefaultAcCircuitCable, DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS } from '@/lib/wires/circuitWireDefaults'
import type { ProjectV2 } from '@/types/projectV2'
import type { Circuit, Panel, TrunkDevice } from '@/types/schema'
import type { SupplyTapAnchor } from '@/types/supplySources'
import { getGridSideTapDevices } from './legs'
import { getSupplyTapSymbolKind } from './tapSymbols'
import { getOrCreateSupplyTapsPanel, getSupplyTapsPanel } from './virtualPanel'

export interface SupplyTapRef {
  kind: 'protection' | 'circuit' | 'endpoint' | 'trunkDevice' | 'panel'
  id: string
}

export type SupplyTapResult =
  | { ok: false; code: string; message: string }
  | { ok: true; created: SupplyTapRef[]; select: SupplyTapRef[] }

export interface CreateSupplyTapInput {
  ownerPanelId: string
  anchor: SupplyTapAnchor
  symbolId: string
  searchPreset?: string
}

/** The owner main panel and its root-feed devices, read-only. */
export function findSupplyTapOwner(
  project: ProjectV2,
  ownerPanelId: string
): { panel: Panel; devices: readonly TrunkDevice[] } | null {
  const panel = findPanelById(getProjectElectricalPanels(project), ownerPanelId)
  if (!panel || panel.virtual) return null
  const feed = getProjectElectricalInstallation(project)?.feedTopology?.rootFeeds?.find(
    (entry) => entry.panelId === ownerPanelId
  )
  return feed ? { panel, devices: feed.trunkDevices ?? [] } : null
}

/** An anchor must name a leg of the owner's supply and, when given, a tap-eligible device on it. */
export function checkSupplyTapAnchor(
  project: ProjectV2,
  ownerPanelId: string,
  anchor: SupplyTapAnchor
): { ok: true } | { ok: false; code: string; message: string } {
  const owner = findSupplyTapOwner(project, ownerPanelId)
  if (!owner)
    return { ok: false, code: 'owner_not_found', message: 'Panel with a supply path not found' }
  if (
    anchor.afterTrunkDeviceId !== undefined &&
    !getGridSideTapDevices(owner.devices, anchor.leg).some(
      (device) => device.id === anchor.afterTrunkDeviceId
    )
  )
    return {
      ok: false,
      code: 'anchor_not_found',
      message: 'The anchor device is not on the grid side of this supply',
    }
  return { ok: true }
}

/**
 * Creates one tap at `anchor` from a library symbol: a protection becomes a protected tap, a
 * meter, terminal strip or load an unprotected circuit. The supply-taps board of the owner is created with the
 * first tap. Mutates `project` (a command draft).
 */
export function createSupplyTapInProject(
  project: ProjectV2,
  input: CreateSupplyTapInput,
  env: { newId: () => string; language?: string }
): SupplyTapResult {
  const symbol = getSymbolById(input.symbolId)
  const kind = symbol ? getSupplyTapSymbolKind(symbol) : null
  if (!symbol || !kind)
    return { ok: false, code: 'unsupported_symbol', message: 'This symbol cannot start a supply tap' }
  const anchorCheck = checkSupplyTapAnchor(project, input.ownerPanelId, input.anchor)
  if (!anchorCheck.ok) return anchorCheck
  const owner = findPanelById(getEditableProjectElectricalPanels(project), input.ownerPanelId)!
  const existing = getSupplyTapsPanel(owner)
  const board = getOrCreateSupplyTapsPanel(
    owner,
    getDomainTranslator(env.language)('panels.supplyTapsName', { defaultValue: 'Supply taps' })
  )
  if (!existing) board.id = env.newId()
  const anchor: SupplyTapAnchor = { ...input.anchor }
  const sitplan = { activeFloorId: null, viewportCenter: null, activePanelId: null }
  const created: SupplyTapRef[] = []
  const select: SupplyTapRef[] = []
  const fail = (message: string): SupplyTapResult => ({ ok: false, code: 'drop_rejected', message })

  if (kind === 'protection') {
    const outcome = placeElectricalSymbolInProject(
      project,
      { symbolId: input.symbolId, searchPreset: input.searchPreset, target: { type: 'mainBus', panelId: board.id } },
      sitplan,
      env.language
    )
    if (outcome.status !== 'placed' || !outcome.mutated)
      return fail(outcome.status === 'rejected' ? outcome.message : 'This symbol cannot be placed here')
    const protection = board.protections.find((item) =>
      outcome.created.some((ref) => ref.kind === 'protection' && ref.id === item.id)
    )
    if (!protection) return fail('This symbol cannot be placed here')
    protection.supplyTap = anchor
    delete protection.busSectionId
    // Tap circuits stay out of automatic labelling: they start unlabelled.
    protection.label = ''
    for (const circuit of protection.circuits ?? []) circuit.code = ''
    created.push(...outcome.created.map((ref) => ({ kind: ref.kind as SupplyTapRef['kind'], id: ref.id })))
    select.push({ kind: 'protection', id: protection.id })
  } else {
    const circuit: Circuit = {
      id: env.newId(),
      code: '',
      kind: 'other',
      cable: createDefaultAcCircuitCable(),
      endpoints: [],
      supplyTap: anchor,
      ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
    }
    board.circuits.push(circuit)
    created.push({ kind: 'circuit', id: circuit.id })
    const outcome = placeElectricalSymbolInProject(
      project,
      {
        symbolId: input.symbolId,
        searchPreset: input.searchPreset,
        target: {
          type: 'circuit',
          panelId: board.id,
          circuitId: circuit.id,
          wireDomain: 'AC',
          circuitTrunkSegmentIndex: 0,
          ...(kind === 'load' ? { branchEndpoints: [], branchInsertIndex: 0 } : {}),
        },
      },
      sitplan,
      env.language
    )
    if (outcome.status !== 'placed' || !outcome.mutated)
      return fail(outcome.status === 'rejected' ? outcome.message : 'This symbol cannot be placed here')
    created.push(...outcome.created.map((ref) => ({ kind: ref.kind as SupplyTapRef['kind'], id: ref.id })))
    const first = outcome.created.find((ref) => ref.kind === (kind === 'load' ? 'endpoint' : 'trunkDevice'))
    if (first) select.push({ kind: first.kind as SupplyTapRef['kind'], id: first.id })
  }
  if (!existing) created.push({ kind: 'panel', id: board.id })
  return { ok: true, created, select }
}
