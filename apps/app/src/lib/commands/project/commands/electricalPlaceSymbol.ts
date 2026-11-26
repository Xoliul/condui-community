import { z } from 'zod'
import { checkForkSymbolPlacement } from '@/lib/eendraad/forkSymbolPlacement'
import { getRiserTargetFields } from '@/lib/eendraad/oneWireRisers'
import { checkRiserDropTarget, checkRiserProtectionDrop } from '../riserTargetCheck'
import { PROJECT_V2_FORK_SCHEMA_VERSION, PROJECT_V2_RISER_SCHEMA_VERSION } from '@/types/projectV2'
import { raiseSchemaVersion } from '@/lib/projectV2/projectSchemaVersion'
import { getSearchPreset } from '@/lib/library/searchPresets'
import { isHorizontalDomoticaPreset, resolveLibraryPresetInput } from '@/lib/library/libraryPresets'
import { normalizeElectricalDropTarget, placeElectricalSymbolInProject } from '@/lib/eendraad/electricalSymbolDrop'
import { findPanelById } from '@/lib/panel/panelTree'
import { persistAutomaticPanelSlotsInProject } from '@/lib/panel/panelAutomaticSlots'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { getSymbolById } from '@/lib/symbols'
import { DOMOTICA_MAX_ENDPOINT_OUTPUTS } from '@/lib/domoticaLayout'
import {
  HORIZONTAL_DOMOTICA_NO_NESTING_MESSAGE,
  HORIZONTAL_DOMOTICA_NO_SUPPLY_MESSAGE,
  HORIZONTAL_DOMOTICA_TERMINAL_MESSAGE,
  HORIZONTAL_DOMOTICA_TOP_LEVEL_MESSAGE,
  isDomoticaNestingUnderHorizontalModule,
  circuitHasHorizontalDomotica,
  isDropTargetIntoSupplyAssembly,
} from '@/lib/eendraad/horizontalDomoticaTerminal'
import { PROTECTION_SYMBOL_IDS } from '@/lib/protectionKind'
import {
  isModularSocketLibraryId,
  canDropModularSocketOnPanel,
  findPreferredModularSocketCircuit,
} from '@/lib/socket/modularSocket'
import { addCircuitToProject } from '@/lib/eendraad/circuitMutations'
import { getNextAvailableCircuitCode } from '@/utils/project'
import { resolveInitialProtectionBusLabel } from '@/lib/protectionKind'
import {
  createDefaultAcCircuitCable,
  DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
} from '@/lib/wires/circuitWireDefaults'
import { collectCircuits } from '@/lib/panel/panelTree'
import { findCircuitOwner } from '@/lib/eendraad/projectElectricalDomain'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import { canSymbolAppearOnSituationPlan } from '@/lib/plan/situationPlanSymbolEligibility'
import type { ProjectV2 } from '@/types/projectV2'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import { CommandError, defineProjectCommand, type EntityKind, type EntityRef } from '../types'
import { checkElectricalDropTarget, electricalDropTargetSchema } from '../electricalDropTarget'
import { applyPanelDropPlacement, panelDropPlacementSchema } from '../panelDropPlacement'
import { collectTopologyRefs, diffTopologyRefs } from '../topologyRefs'
import {
  resolveElectricalSemanticTarget,
  electricalSemanticDestinationSchema,
} from '../electricalSemanticTarget'

const point = z.object({ x: z.number().finite(), y: z.number().finite() })

const SELECTION_KINDS = new Set<string>(['endpoint', 'note', 'panel', 'protection', 'trunkDevice'])

/**
 * A new horizontal module is a top-level, terminal, non-supply module. The same pure rules as the
 * Layout field and the commit invariant; whether something would follow it in a branch is
 * left to the invariant, which also covers every other command.
 */
function checkNewHorizontalDomoticaPlacement(project: ProjectV2, target: DropTarget) {
  const owner = target.circuitId
    ? findCircuitOwner(getEditableProjectElectricalPanels(project), target.circuitId)
    : null
  if (isDropTargetIntoSupplyAssembly(target, owner?.circuit, owner ?? undefined))
    return { ok: false as const, code: 'horizontal_domotica_no_supply', message: HORIZONTAL_DOMOTICA_NO_SUPPLY_MESSAGE }
  if (target.domoticaOutput || target.domoticaChildDropIntent)
    return { ok: false as const, code: 'horizontal_domotica_top_level', message: HORIZONTAL_DOMOTICA_TOP_LEVEL_MESSAGE }
  // Every position on a circuit with a horizontal module is before or after it, and it is the last device.
  if (owner && circuitHasHorizontalDomotica(owner.circuit))
    return { ok: false as const, code: 'horizontal_domotica_terminal', message: HORIZONTAL_DOMOTICA_TERMINAL_MESSAGE }
  return null
}

/**
 * Drops a library symbol on a one-wire / panel position: protections on a bus or panel, devices
 * on a circuit or supply wire, endpoints on a circuit. Applies the shared target rules, then the
 * drop engine with all of its follow-ups (plan placements, panel grid, sub-panels, earthing).
 */
export const electricalPlaceSymbol = defineProjectCommand({
  id: 'electrical.placeSymbol',
  version: 1,
  input: z
    .object({
      symbolId: z.string().min(1),
      searchPreset: z.string().min(1).optional(),
      target: electricalDropTargetSchema.optional(),
      destination: electricalSemanticDestinationSchema.optional(),
      panelGrid: panelDropPlacementSchema.optional(),
      dropCanvasPosition: point.optional(),
      planPlacement: z.strictObject({
        floorId: z.string().min(1),
        layer: z.string().min(1).default('electrical'),
        pos: point.strict(),
        rotationDeg: z.number().finite().default(0),
        scale: z.number().finite().positive().default(1),
      }).optional(),
      sitplan: z
        .object({
          activeFloorId: z.string().min(1).nullable(),
          viewportCenter: point.nullable(),
          activePanelId: z.string().min(1).nullable(),
        })
        .optional(),
    })
    .superRefine((input, context) => {
      if (input.planPlacement && input.sitplan)
        context.addIssue({ code: 'custom', message: 'Provide exact planPlacement or automatic sitplan context, not both.', path: ['sitplan'] })
      if (Boolean(input.target) === Boolean(input.destination))
        context.addIssue({
          code: 'custom',
          message: 'Provide exactly one legacy target or semantic destination.',
          path: ['destination'],
        })
    }),
  check(project, rawInput) {
    // A library preset entry ID (agents, palette) is checked as its base symbol plus the preset.
    const input = resolveLibraryPresetInput(rawInput)
    if ('searchPreset' in input && input.searchPreset && !getSearchPreset(input.symbolId, input.searchPreset))
      return { ok: false, code: 'invalid_preset', message: 'Unknown preset for this symbol' }
    if (!getSymbolById(input.symbolId)) {
      return { ok: false, code: 'unknown_symbol', message: 'Unknown symbol' }
    }
    if (input.planPlacement) {
      if (!canSymbolAppearOnSituationPlan(input.symbolId) || getSearchPreset(input.symbolId, input.searchPreset)?.libraryEntry)
        return { ok: false, code: 'unsupported_plan_symbol', message: 'This symbol cannot be placed on the plan' }
      const floor = selectProjectBuildingFloors(project).find((entry) => entry.id === input.planPlacement!.floorId)
      if (!floor) return { ok: false, code: 'floor_not_found', message: 'Floor not found' }
      // Native V2 floors expose the electrical plan layer implicitly, rather than storing
      // the compatibility view's `layers` array.
      const layers = 'layers' in floor && floor.layers?.length ? floor.layers : ['electrical']
      if (!layers.includes(input.planPlacement.layer))
        return { ok: false, code: 'layer_not_found', message: 'Plan layer not found' }
    }
    const resolved = input.destination
      ? resolveElectricalSemanticTarget(project, input.destination)
      : input.target
        ? { ok: true as const, target: input.target }
        : { ok: false as const, code: 'target_required', message: 'A placement destination is required.' }
    if (!resolved.ok) return resolved
    const target = resolved.target
    const targetCheck = checkElectricalDropTarget(project, target, input.planPlacement?.floorId ?? input.sitplan?.activeFloorId)
    if (!targetCheck.ok) return targetCheck
    if (isHorizontalDomoticaPreset(input.symbolId, input.searchPreset)) {
      const refusal = checkNewHorizontalDomoticaPlacement(project, normalizeElectricalDropTarget(input.symbolId, target, project))
      if (refusal) return refusal
    }
    if (input.symbolId === 'domotica' && target.circuitId) {
      const nestOwner = findCircuitOwner(getEditableProjectElectricalPanels(project), target.circuitId)
      if (nestOwner && isDomoticaNestingUnderHorizontalModule(nestOwner.circuit, target, input.symbolId))
        return { ok: false, code: 'horizontal_domotica_no_nesting', message: HORIZONTAL_DOMOTICA_NO_NESTING_MESSAGE }
    }
    if (target.forkAfterEndpointId || target.forkBranchId) {
      const owner = findCircuitOwner(getEditableProjectElectricalPanels(project), target.circuitId ?? '')
      if (!owner || !checkForkSymbolPlacement(owner.circuit, target, input.symbolId))
        return { ok: false, code: 'unsupported_fork', message: 'This symbol cannot be placed on that fork' }
    }
    const riserCircuit = findCircuitOwner(getEditableProjectElectricalPanels(project), target.circuitId ?? '')?.circuit
    const riserCheck = checkRiserDropTarget(riserCircuit, target)
    if (!riserCheck.ok) return riserCheck
    const protectionCheck = checkRiserProtectionDrop(riserCircuit, input.symbolId, target)
    if (!protectionCheck.ok) return protectionCheck
    if (input.panelGrid?.parentCircuitId) {
      // Panel and hierarchy views: a protection dropped as a child of a circuit nests into it as well.
      const parent = findCircuitOwner(getEditableProjectElectricalPanels(project), input.panelGrid.parentCircuitId)?.circuit
      const parentCheck = checkRiserProtectionDrop(parent, input.symbolId, { type: 'circuit' })
      if (!parentCheck.ok) return parentCheck
    }
    if (input.symbolId === 'panel_distribution' && target.domoticaOutput) {
      const owner = findCircuitOwner(getEditableProjectElectricalPanels(project), target.circuitId ?? '')
      const module = owner?.circuit.endpoints.find((endpoint) => endpoint.id === target.endpointId)
      if (!owner?.protection || !module || module.symbol !== 'domotica' || target.domoticaOutput.group !== 'endpoint' ||
        target.domoticaOutput.index >= DOMOTICA_MAX_ENDPOINT_OUTPUTS ||
        target.domoticaOutput.index >= (module.domoticaProps?.endpointCount ?? 1) +
          (target.domoticaOutput.expands ? 1 : 0))
        return { ok: false, code: 'output_not_found', message: 'Domotica output no longer exists.' }
    }
    if (
      input.sitplan?.activePanelId &&
      !findPanelById(getEditableProjectElectricalPanels(project), input.sitplan.activePanelId)
    ) {
      return { ok: false, code: 'panel_not_found', message: 'Situation-plan panel not found' }
    }
    if (input.panelGrid) {
      const panel =
        target.panelId &&
        findPanelById(getEditableProjectElectricalPanels(project), target.panelId)
      const protection = (PROTECTION_SYMBOL_IDS as readonly string[]).includes(input.symbolId)
      const valid =
        input.panelGrid.scope === 'supply'
          ? panel &&
            panel.isMain &&
            target.type === 'supplyWire' &&
            (protection || input.symbolId === 'energy_meter')
          : panel &&
            ((protection && target.type === 'mainBus') ||
              (target.type === 'circuit' &&
                (input.symbolId === 'energy_meter' || isModularSocketLibraryId(input.symbolId))) ||
              (target.type === 'mainBus' &&
                isModularSocketLibraryId(input.symbolId) &&
                input.panelGrid.ensureCircuitForProtectionId != null))
      if (!valid)
        return { ok: false, code: 'invalid_panel_drop', message: 'Invalid panel-grid drop target' }
      if (
        input.panelGrid.ensureCircuitForProtectionId &&
        (!panel ||
          input.panelGrid.scope !== 'main' ||
          !isModularSocketLibraryId(input.symbolId) ||
          !canDropModularSocketOnPanel(panel) ||
          !panel.protections.some(
            (protection) => protection.id === input.panelGrid!.ensureCircuitForProtectionId
          ))
      )
        return {
          ok: false,
          code: 'protection_not_found',
          message: 'Modular socket protection not found',
        }
      if (
        input.panelGrid.parentCircuitId &&
        (!protection ||
          input.panelGrid.scope !== 'main' ||
          !panel ||
          ![
            ...panel.circuits,
            ...panel.protections.flatMap((protection) => protection.circuits ?? []),
          ].some((circuit) => circuit.id === input.panelGrid!.parentCircuitId))
      ) {
        return {
          ok: false,
          code: 'parent_circuit_not_found',
          message: 'Parent circuit does not belong to the target panel',
        }
      }
    }
    return { ok: true }
  },
  apply(draft, input, env) {
    const project = draft as ProjectV2
    const before = collectTopologyRefs(project)
    const resolved = input.destination
      ? resolveElectricalSemanticTarget(project, input.destination)
      : input.target
        ? { ok: true as const, target: input.target }
        : { ok: false as const, code: 'target_required', message: 'A placement destination is required.' }
    if (!resolved.ok)
      throw new CommandError('check_failed', resolved.message, { reason: resolved.code })
    let target = resolved.target
    const additionalCreated: EntityRef[] = []
    if (input.panelGrid?.ensureCircuitForProtectionId) {
      const panel = findPanelById(
        getEditableProjectElectricalPanels(project),
        target.panelId!
      )!
      const protection = panel.protections.find(
        (protection) => protection.id === input.panelGrid!.ensureCircuitForProtectionId
      )!
      let circuit = findPreferredModularSocketCircuit(panel, protection)
      if (!circuit) {
        const id = env.newId()
        circuit = {
          id,
          code: resolveInitialProtectionBusLabel(
            protection.type,
            getNextAvailableCircuitCode(project, panel.id)
          ),
          kind: 'other',
          cable: createDefaultAcCircuitCable(),
          endpoints: [],
          ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
        }
        if (!addCircuitToProject(project, panel.id, circuit, protection.id))
          throw new CommandError('check_failed', 'Unable to create modular socket circuit', {
            reason: 'circuit_not_created',
          })
        additionalCreated.push({ kind: 'circuit', id })
      }
      target = { type: 'circuit', panelId: panel.id, circuitId: circuit.id }
    }
    const outcome = placeElectricalSymbolInProject(
      project,
      {
        symbolId: input.symbolId,
        searchPreset: input.searchPreset,
        target,
        dropCanvasPosition: input.dropCanvasPosition,
        ...(input.planPlacement ? { planPlacement: { ...input.planPlacement, id: env.newId(), rotationMode: 'explicit' as const } } : {}),
      },
      input.planPlacement
        ? { activeFloorId: input.planPlacement.floorId, viewportCenter: input.planPlacement.pos, activePanelId: target.panelId ?? null }
        : input.sitplan ?? { activeFloorId: null, viewportCenter: null, activePanelId: null },
      env.language
    )
    if (outcome.status === 'rejected') {
      throw new CommandError('check_failed', outcome.message, { reason: 'drop_rejected' })
    }
    if (outcome.status === 'blocked') {
      throw new CommandError('check_failed', 'This symbol cannot be placed here', {
        reason: outcome.reason,
      })
    }
    // The drop engine reads supply lists that fill in defaults on the draft; a drop that placed
    // nothing must stay a no-op instead of committing those defaults as an undo step.
    if (!outcome.mutated) {
      throw new CommandError('check_failed', 'Nothing was placed', { reason: 'nothing_placed' })
    }
    if (Object.keys(getRiserTargetFields(target)).length) raiseSchemaVersion(project, PROJECT_V2_RISER_SCHEMA_VERSION)
    else if (target.forkAfterEndpointId || target.forkBranchId) raiseSchemaVersion(project, PROJECT_V2_FORK_SCHEMA_VERSION)
    const created: EntityRef[] = [
      ...additionalCreated,
      ...outcome.created.map((entry) => ({
        kind: entry.kind as EntityKind,
        id: entry.id,
      })),
    ]
    const { selection } = outcome
    const gridChanged: EntityRef[] = input.panelGrid
      ? applyPanelDropPlacement(draft as ProjectV2, target.panelId!, input.panelGrid, created)
      : []
    // A device dropped on a panel wire (for example in series on the supply) needs its grid slot in
    // this undo step; otherwise the canvas repairs it afterwards as a separate step.
    if (target.panelId && persistAutomaticPanelSlotsInProject(project, target.panelId))
      gridChanged.push({ kind: 'panel', id: target.panelId })
    // Callbacks report the requested symbol; shared follow-ups can also create board
    // occurrences, circuits and plan placements. Return those IDs for immediate reuse.
    const diff = diffTopologyRefs(before, collectTopologyRefs(project))
    for (const ref of diff.created) {
      if (!created.some((entry) => entry.kind === ref.kind && entry.id === ref.id))
        created.push(ref)
    }
    const changed = [...new Map([...gridChanged, ...diff.changed].map((ref) => [
      `${ref.kind}:${ref.id}`, ref,
    ])).values()]
    const relatedCircuitIds = new Set<string>()
    if (target.circuitId) relatedCircuitIds.add(target.circuitId)
    const createdEndpointIds = new Set(
      created.filter((ref) => ref.kind === 'endpoint').map((ref) => ref.id)
    )
    for (const panel of getEditableProjectElectricalPanels(draft)) {
      for (const circuit of collectCircuits(panel)) {
        if (circuit.endpoints.some((endpoint) => createdEndpointIds.has(endpoint.id)))
          relatedCircuitIds.add(circuit.id)
      }
    }
    return {
      created,
      changed,
      removed: diff.removed,
      related: [...relatedCircuitIds].map((id) => ({ kind: 'circuit' as const, id })),
      select:
        selection && selection.type && SELECTION_KINDS.has(selection.type)
          ? selection.ids.map((id) => ({ kind: selection.type as EntityKind, id }))
          : [],
    }
  },
})
