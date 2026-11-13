/**
 * Situation-plan library drop on a mutable project (a project command draft): an optional new
 * MCB + circuit, then the endpoint with its first plan placement, through the same drop engine
 * the one-wire canvas uses. Shared by `circuit.createEmpty` and `plan.placeSymbol`.
 */
import type { TFunction } from 'i18next'
import type { ProjectV2 } from '@/types/projectV2'
import type { Circuit, Panel, ProtectionDevice } from '@/types/schema'
import type { Point } from '@/types/ui'
import type { SitplanPlacementTarget } from '@/lib/eendraad/duplicateSitplanHelpers'
import { executeDropBehavior, type DropBehaviorProject } from '@/lib/eendraad/dropBehaviors'
import { addCircuitToProject } from '@/lib/eendraad/circuitMutations'
import { createDraftDropBehaviorCallbacks } from '@/lib/eendraad/draftDropBehaviorCallbacks'
import { placeElectricalSymbolInProject } from '@/lib/eendraad/electricalSymbolDrop'
import { getDomainTranslator } from '@/lib/i18n/domainI18n'
import { addProtectionToProject } from '@/lib/eendraad/protectionMutations'
import { findCircuitById } from '@/lib/eendraad/projectElectricalDomain'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import { logger } from '@/lib/logger'
import {
  endpointTypeToPlanDropKind,
  planDropKindToCircuitKind,
  type PlanDropCircuitChoice,
  type PlanDropKind,
} from '@/lib/plan/planDropPicker'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { getSymbolById } from '@/lib/symbols'
import { createDefaultAcCircuitCable } from '@/lib/wires/circuitWireDefaults'
import { generateId } from '@/utils/id'
import { getEndpointTypeFromSymbol } from '@/utils/symbolMapping'
import { collectCircuits } from '@/utils/eendraad/panelHelpers'
import { getPanelEndpoint } from '@/utils/panelPlacement'

export type CreateEmptyCircuitOptions = {
  /** Legacy MCB label; leave empty so circuit code sync sets the protection label later. */
  protectionLabel?: string
  /** Stored on `Circuit.notes` (optional description). */
  circuitNotes?: string
}

function findPanelInTree(panels: readonly Panel[], panelId: string): Panel | null {
  for (const panel of panels) {
    if (panel.id === panelId) return panel
    const nested = findPanelInTree(panel.subPanels ?? [], panelId)
    if (nested) return nested
  }
  return null
}

function findProtectionInTree(
  panels: readonly Panel[],
  protectionId: string
): ProtectionDevice | null {
  for (const panel of panels) {
    const protection = panel.protections?.find((candidate) => candidate.id === protectionId)
    if (protection) return protection
    const nested = findProtectionInTree(panel.subPanels ?? [], protectionId)
    if (nested) return nested
  }
  return null
}

function findCircuitInTree(panels: readonly Panel[], circuitId: string): Circuit | null {
  for (const panel of panels) {
    const found = findCircuitById(panel, circuitId)?.circuit
    if (found) return found
    for (const circuit of collectCircuits(panel)) {
      if (circuit.id === circuitId) return circuit
    }
    const nested = findCircuitInTree(panel.subPanels ?? [], circuitId)
    if (nested) return nested
  }
  return null
}

/** Adds a new MCB with an empty circuit on a panel, with plan-drop defaults. Returns its id. */
export function createEmptyCircuitInProject(
  project: ProjectV2,
  panelId: string,
  dropKind: PlanDropKind,
  options: CreateEmptyCircuitOptions,
  sitplanTarget: SitplanPlacementTarget,
  language?: string
): string | null {
  const mcb = getSymbolById('mcb')
  if (!mcb) return null
  const circuitKind = planDropKindToCircuitKind(dropKind)
  const label = (options.protectionLabel ?? '').trim()
  const notes = (options.circuitNotes ?? '').trim()
  const panels = () => getEditableProjectElectricalPanels(project)
  let newCircuitId: string | null = null

  const callbacks = createDraftDropBehaviorCallbacks(project, sitplanTarget, {
    addProtection: (targetPanelId, protection) => {
      const planProtection: ProtectionDevice = {
        ...protection,
        label,
        ratingA: circuitKind === 'lighting' ? 10 : 16,
        curve: 'C',
        polesConfig: '2P',
        poles: 2,
      }
      addProtectionToProject(project, targetPanelId, planProtection)
      if (findProtectionInTree(panels(), planProtection.id)) return
      // Panels outside the editable tree (nested sub-panels) still get their protection.
      const panel = findPanelInTree(panels(), targetPanelId)
      if (!panel) return
      if (!planProtection.circuits) planProtection.circuits = []
      panel.protections.push(planProtection)
    },
    addCircuit: (targetPanelId, circuit, protectionId) => {
      const planCircuit: Circuit = {
        ...circuit,
        code: '',
        kind: circuitKind,
        cable: createDefaultAcCircuitCable({ sectionMm2: circuitKind === 'lighting' ? 1.5 : 2.5 }),
        ...(notes ? { notes } : {}),
      }
      newCircuitId = planCircuit.id
      addCircuitToProject(project, targetPanelId, planCircuit, protectionId)
      if (findCircuitInTree(panels(), planCircuit.id)) return
      const protection = protectionId ? findProtectionInTree(panels(), protectionId) : null
      if (!protection) {
        logger.error('Unable to create plan-drop circuit because its protection is missing', {
          panelId: targetPanelId,
          protectionId,
          circuitId: planCircuit.id,
        })
        return
      }
      protection.circuits = [...(protection.circuits ?? []), planCircuit]
    },
  }, language)

  executeDropBehavior(
    mcb,
    { type: 'mainBus', panelId } as DropTarget,
    project as DropBehaviorProject,
    getDomainTranslator(language) as TFunction,
    callbacks,
    false
  )
  return newCircuitId && findCircuitInTree(panels(), newCircuitId) ? newCircuitId : null
}

export interface PlanSymbolDropInput {
  symbolId: string
  searchPreset?: string
  pos: Point
  floorId: string
  floorLayer: string
  panelId: string
  circuit: PlanDropCircuitChoice
}

export type PlanPanelDropInput = Pick<PlanSymbolDropInput, 'floorId' | 'floorLayer' | 'pos'>

/** A board dropped on free plan space is a new root board, as on free one-wire space. */
export function placePanelOnPlanInProject(
  project: ProjectV2,
  input: PlanPanelDropInput,
  language?: string
): { panelId: string; endpointId: string; placementId: string } | null {
  const outcome = placeElectricalSymbolInProject(
    project,
    { symbolId: 'panel_distribution', target: { type: null } },
    { activeFloorId: input.floorId, viewportCenter: input.pos },
    language
  )
  if (outcome.status !== 'placed') return null
  const panelId = outcome.created.find((ref) => ref.kind === 'panel')?.id
  const endpoint = panelId ? getPanelEndpoint(project, panelId) : null
  const placement = endpoint?.placements[0]
  if (!panelId || !endpoint || !placement) return null
  // Automatic board placements use the ground floor and collision avoidance. An explicit
  // plan drop instead owns the chosen floor and exact snapped position.
  placement.floorId = input.floorId
  placement.layer = input.floorLayer
  placement.pos = { ...input.pos }
  return { panelId, endpointId: endpoint.id, placementId: placement.id }
}

/**
 * Endpoint and placement are null when the symbol became a circuit device instead (junction
 * box, energy meter, converters): the drop engine then adds the device and its own placement.
 */
export type PlanSymbolDropOutcome = {
  endpointId: string | null
  placementId: string | null
  circuitId: string
  createdCircuit: boolean
}

/** Places a library symbol on the plan, on an existing or a new circuit. */
export function placeSymbolOnPlanInProject(
  project: ProjectV2,
  input: PlanSymbolDropInput,
  sitplanTarget: SitplanPlacementTarget,
  language?: string
): PlanSymbolDropOutcome | null {
  const symbol = getSymbolById(input.symbolId)
  const endpointType = symbol ? getEndpointTypeFromSymbol(symbol) : undefined
  if (!symbol || !endpointType) return null

  const circuitId =
    input.circuit.mode === 'existing'
      ? input.circuit.circuitId
      : createEmptyCircuitInProject(
          project,
          input.panelId,
          endpointTypeToPlanDropKind(endpointType),
          input.circuit,
          sitplanTarget,
          language
        )
  if (!circuitId) return null
  const circuit = findCircuitInTree(getEditableProjectElectricalPanels(project), circuitId)
  if (!circuit || circuit.code === 'PANEL') return null

  const outcome = placeElectricalSymbolInProject(
    project,
    {
      symbolId: input.symbolId,
      searchPreset: input.searchPreset,
      target: {
        type: 'circuit',
        panelId: input.panelId,
        circuitId,
        insertAfterEndpointId: circuit.endpoints[circuit.endpoints.length - 1]?.id,
      },
      planPlacement: {
        id: generateId(),
        floorId: input.floorId,
        layer: input.floorLayer,
        pos: input.pos,
        rotationDeg: 0,
        scale: 1,
      },
    },
    sitplanTarget,
    language
  )
  if (outcome.status !== 'placed') return null
  const endpointIds = outcome.created.filter((ref) => ref.kind === 'endpoint').map((ref) => ref.id)
  const endpointId = endpointIds[endpointIds.length - 1] ?? null
  const placementId = outcome.placementId
  return {
    endpointId,
    placementId,
    circuitId,
    createdCircuit: input.circuit.mode === 'new',
  }
}
