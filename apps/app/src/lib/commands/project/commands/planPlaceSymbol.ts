import { z } from 'zod'
import { getSearchPreset } from '@/lib/library/searchPresets'
import { findPanelById } from '@/lib/panel/panelTree'
import {
  createEmptyCircuitInProject,
  placePanelOnPlanInProject,
  placeSymbolOnPlanInProject,
} from '@/lib/plan/planSymbolDrop'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import { getSymbolById } from '@/lib/symbols'
import type { ProjectV2 } from '@/types/projectV2'
import { getEndpointTypeFromSymbol } from '@/utils/symbolMapping'
import { moveProtectionOnBusInProject } from '@/lib/eendraad/busMoveMutations'
import { updateCircuitInProject } from '@/lib/eendraad/circuitMutations'
import { maybeApplyAutomaticEendraadNamingForPanel } from '@/lib/eendraad/projectElectricalDomain'
import { buildPlanDropAvailableCircuitCodeOptions } from '@/lib/plan/planDropPicker'
import { createCircuitCodeSequence } from '@/utils/project'
import { CommandError, defineProjectCommand, type CommandCheck, type EntityRef } from '../types'
import { collectTopologyRefs, diffTopologyRefs } from '../topologyRefs'

const point = z.object({ x: z.number().finite(), y: z.number().finite() })
const dropKind = z.enum(['lighting', 'sockets', 'fixed_appliance', 'other'])

function checkPanel(project: ProjectV2, panelId: string): CommandCheck {
  return findPanelById(getEditableProjectElectricalPanels(project), panelId)
    ? { ok: true }
    : { ok: false, code: 'panel_not_found', message: 'Panel not found' }
}

function checkRcd(project: ProjectV2, panelId: string, rcdProtectionId: string | undefined): CommandCheck {
  if (!rcdProtectionId) return { ok: true }
  const panel = findPanelById(getEditableProjectElectricalPanels(project), panelId)
  const rcd = panel?.protections.find((protection) => protection.id === rcdProtectionId)
  if (!rcd) return { ok: false, code: 'protection_not_found', message: 'The RCD is not on this panel' }
  return rcd.type === 'RCD' || rcd.type === 'RCBO'
    ? { ok: true }
    : { ok: false, code: 'not_an_rcd', message: 'Only an RCD or RCBO has circuits behind it' }
}

/** Adds a new MCB with an empty circuit on a panel, with the plan-drop defaults. */
export const circuitCreateEmpty = defineProjectCommand({
  id: 'circuit.createEmpty',
  version: 1,
  input: z.object({
    panelId: z.string().min(1),
    kind: dropKind,
    protectionLabel: z.string().optional(),
    circuitNotes: z.string().optional(),
    /** Append the new breaker behind this RCD instead of on the main bus. */
    rcdProtectionId: z.string().min(1).optional(),
    /** Circuit code; 'auto' takes the first free code of the project's label scheme. The breaker label follows it. */
    code: z.string().trim().min(1).max(40).optional(),
  }),
  check: (project, input) => {
    const panel = checkPanel(project, input.panelId)
    return panel.ok ? checkRcd(project, input.panelId, input.rcdProtectionId) : panel
  },
  apply(draft, input, env) {
    const before = collectTopologyRefs(draft as ProjectV2)
    const circuitId = createEmptyCircuitInProject(
      draft as ProjectV2,
      input.panelId,
      input.kind,
      { protectionLabel: input.protectionLabel, circuitNotes: input.circuitNotes },
      { activeFloorId: null },
      env.language
    )
    if (!circuitId) throw new Error('The circuit could not be created')
    if (input.rcdProtectionId) {
      const panel = findPanelById(getEditableProjectElectricalPanels(draft as ProjectV2), input.panelId)!
      const breaker = panel.protections.find((protection) => protection.circuits?.some(({ id }) => id === circuitId))
      const rcd = panel.protections.find((protection) => protection.id === input.rcdProtectionId)
      const moved = breaker && rcd && moveProtectionOnBusInProject(draft as ProjectV2, breaker.id, {
        type: 'rcd',
        panelId: panel.id,
        protectionId: rcd.id,
        secondaryBusInsertIndex: rcd.circuits?.[0]?.subCircuitIds?.length ?? 0,
      })
      if (!moved || !moved.changed)
        throw new CommandError('check_failed', 'The circuit could not be placed behind the RCD', {
          reason: moved?.reason ?? 'breaker_not_found',
        })
    }
    if (input.code) {
      const project = draft as ProjectV2
      const panel = findPanelById(getEditableProjectElectricalPanels(project), input.panelId)!
      const code = input.code === 'auto'
        ? buildPlanDropAvailableCircuitCodeOptions(panel, circuitId, undefined, createCircuitCodeSequence(project, panel.id))[0]
        : input.code
      // An automatic code stays automatic, as for circuits dropped in the editor; only a chosen code is locked.
      if (code)
        updateCircuitInProject(project, circuitId, input.code === 'auto' ? { code } : { code, eendraadManualCodeLock: true })
      if (input.code === 'auto') maybeApplyAutomaticEendraadNamingForPanel(project, panel.id)
    }
    const ref: EntityRef = { kind: 'circuit', id: circuitId }
    const diff = diffTopologyRefs(before, collectTopologyRefs(draft as ProjectV2))
    return { ...diff, created: [ref, ...diff.created.filter((item) => item.kind !== ref.kind || item.id !== ref.id)], related: [ref] }
  },
})

/**
 * Places a library symbol on the situation plan at a floor position, on an existing circuit or
 * on a new MCB + circuit, through the same drop rules as the one-wire canvas. Selects the new
 * placement. Device symbols (junction box, energy meter, converters) become circuit devices.
 */
export const planPlaceSymbol = defineProjectCommand({
  id: 'plan.placeSymbol',
  version: 1,
  input: z.union([
    z.strictObject({
      symbolId: z.literal('panel_distribution'),
      floorId: z.string().min(1),
      floorLayer: z.string().min(1).default('electrical'),
      pos: point,
    }),
    z.object({
      symbolId: z
        .string()
        .min(1)
        .refine((id) => id !== 'panel_distribution'),
      searchPreset: z.string().min(1).optional(),
      floorId: z.string().min(1),
      floorLayer: z.string().min(1).default('electrical'),
      pos: point,
      panelId: z.string().min(1),
      circuit: z.discriminatedUnion('mode', [
        z.object({ mode: z.literal('existing'), circuitId: z.string().min(1) }),
        z.object({
          mode: z.literal('new'),
          protectionLabel: z.string().optional(),
          circuitNotes: z.string().optional(),
        }),
      ]),
      /** Plan viewport centre on the active floor, for automatic placements of extra devices. */
      viewportCenter: point.nullable().optional(),
    }),
  ]),
  check(project, input) {
    if ('searchPreset' in input && input.searchPreset && !getSearchPreset(input.symbolId, input.searchPreset))
      return { ok: false, code: 'invalid_preset', message: 'Unknown preset for this symbol' }
    const symbol = getSymbolById(input.symbolId)
    if (!symbol || ('circuit' in input && !getEndpointTypeFromSymbol(symbol))) {
      return {
        ok: false,
        code: 'unsupported_symbol',
        message: 'This symbol cannot be placed on the plan',
      }
    }
    if (!selectProjectBuildingFloors(project).some((floor) => floor.id === input.floorId)) {
      return { ok: false, code: 'floor_not_found', message: 'Floor not found' }
    }
    return 'circuit' in input ? checkPanel(project, input.panelId) : { ok: true }
  },
  apply(draft, input, env) {
    const before = collectTopologyRefs(draft as ProjectV2)
    if (!('circuit' in input)) {
      const outcome = placePanelOnPlanInProject(draft as ProjectV2, input, env.language)
      if (!outcome) throw new Error('The panel could not be placed')
      return {
        ...diffTopologyRefs(before, collectTopologyRefs(draft as ProjectV2)),
        select: [{ kind: 'panel' as const, id: outcome.panelId }],
      }
    }
    const outcome = placeSymbolOnPlanInProject(
      draft as ProjectV2,
      input,
      {
        activeFloorId: input.floorId,
        viewportCenter: input.viewportCenter ?? null,
      },
      env.language
    )
    if (!outcome) throw new Error('The symbol could not be placed')
    const circuit: EntityRef = { kind: 'circuit', id: outcome.circuitId }
    const placement: EntityRef[] = outcome.placementId
      ? [{ kind: 'placement', id: outcome.placementId }]
      : []
    const diff = diffTopologyRefs(before, collectTopologyRefs(draft as ProjectV2))
    const preferred: EntityRef[] = [
      ...(outcome.endpointId ? [{ kind: 'endpoint' as const, id: outcome.endpointId }] : []),
      ...placement,
      ...(outcome.createdCircuit ? [circuit] : []),
    ]
    return {
      ...diff,
      created: [...preferred, ...diff.created.filter((item) => !preferred.some((ref) => ref.kind === item.kind && ref.id === item.id))],
      related: [circuit],
      select: placement,
    }
  },
})
