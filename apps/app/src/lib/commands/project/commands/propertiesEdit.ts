import {
  checkExtraElectricalAction,
  applyExtraElectricalAction,
  collectElectricalPropertyRefs,
} from '@/lib/properties/electricalPropertyActions'
import {
  extraElectricalPropertyEditSchema,
  isExtraElectricalPropertyEdit,
  trunkPropertiesSchema,
  extraElectricalActionSchema,
  isExtraElectricalAction,
} from '@/lib/properties/electricalPropertySchemas'
import {
  checkExtraElectricalPropertyEdit,
  applyExtraElectricalPropertyEdit,
} from '@/lib/properties/extraElectricalProperties'
import {
  generalPropertyEditSchema,
  isGeneralPropertyEdit,
  checkGeneralPropertyEdit,
  applyGeneralPropertyEdit,
} from '@/lib/properties/generalPropertyFamilies'
import {
  updateCircuitTrunkPropertiesInProject,
  updateGroundTrunkPropertiesInProject,
} from '@/lib/properties/electricalPropertyMutations'
import { normalizePatch, patchChanges } from '@/lib/properties/propertyPatch'
import { defaultVoltagesForSystem } from '@/constants/nominalVoltage'
import { propertyPatchPreservesPanelSlots } from '@/lib/properties/propertyPanelSlots'
import { getInstallationSupplyTransformer, getInstallationSupplyTransformers, isSupplyTransformer } from '@/lib/electrical/supplyTransformer'
import { normalizeProtectionCapacityUpdates } from '@/lib/protectionDefaults'
import { persistAutomaticPanelSlotsInProject } from '@/lib/panel/panelAutomaticSlots'
import { walkPanels } from '@/lib/panel/panelTree'
import { z } from 'zod'
import type { Circuit, Endpoint, Placement, ProtectionDevice } from '@/types/schema'
import { syncSupplyDeviceMultiplierInProject } from '@/lib/eendraad/supplyDeviceMultiplierInProject'
import type { ProjectV2 } from '@/types/projectV2'
import {
  applyAutomaticEendraadNamingAllPanelsInProject,
  findCircuitById,
  findCircuitOwner,
  getAllCircuits,
  getDefaultPanelGridModuleRefs,
  panelGridModuleRefKey,
  findEndpointById,
  findPanelOwningProtection,
} from '@/lib/eendraad/projectElectricalDomain'
import { updateCircuitInProject } from '@/lib/eendraad/circuitMutations'
import { findTrunkDeviceInProject } from '@/lib/eendraad/findTrunkDeviceInProject'
import {
  getHorizontalDomoticaSwitchBlock,
  HORIZONTAL_DOMOTICA_NO_NESTING_MESSAGE,
  HORIZONTAL_DOMOTICA_NO_SUPPLY_MESSAGE,
  HORIZONTAL_DOMOTICA_TERMINAL_MESSAGE,
  HORIZONTAL_DOMOTICA_TOP_LEVEL_MESSAGE,
  isEndpointInSupplyAssembly,
} from '@/lib/eendraad/horizontalDomoticaTerminal'
import { isHorizontalDomotica } from '@/lib/layout/domoticaHorizontalGeometry'
import { getPanelSupplyTrunkDevices, queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { assignEndpointsToCircuitInProject } from '@/lib/eendraad/endpointMutations'
import { deleteEndpointsFromProject } from '@/lib/eendraad/endpointDeletion'
import {
  updateEndpointInProject,
  updateInstallationInProject,
  updateProtectionInProject,
  updateSupplyTrunkDeviceInProject,
} from '@/lib/projectMutations/storeActions'
import {
  getEditableProjectElectricalInstallation,
  getEditableProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import {
  findSectionWireOverride,
  upsertSectionWireOverride,
} from '@/lib/wires/sectionWireOverrides'
import {
  collectTerminalStripOccurrences,
  getTerminalStripPinPatch,
  planTerminalStripPinAssignment,
} from '@/lib/terminalStrip/labels'
import { findPanelById } from '@/lib/panel/panelTree'
import { ensureInstallYearColor } from '@/lib/installDates'
import { syncPanelAndSituationPlanDeviceVisibility } from '@/lib/plan/panelPlanPlacementVisibility'
import { getInstallDateTargetInheritedYear } from '@/lib/installDatePropagation'
import {
  applyEndpointMultiplierCountInProject,
  setPanelModuleVisibilityInProject,
} from '@/lib/properties/propertyActions'
import { endpointSupportsMultiplier } from '@/utils/endpointMultipliers'
import { isModularSocket } from '@/lib/socket/modularSocket'
import { circuitModuleRef } from '@/lib/panel/circuitModuleMounting'
import { listRemountableCircuitModules } from '@/lib/panel/circuitModuleMountingRules'
import { isHvacDeviceSymbol } from '@/lib/symbols'
import { canLinkControlDevice, collectControlLinkEntries } from '@/lib/controlLink/controlLink'
import {
  circuitPatchSchema,
  circuitSectionRefSchema,
  circuitWirePatchSchema,
  endpointPatchSchema,
  installationPropertiesSchema,
  protectionPatchSchema,
} from '@/lib/properties/propertySchemas'
import { CommandError, defineProjectCommand, type CommandEnv, type EntityRef } from '../types'
import { panelModuleRefSchema } from './panelEditLayout'

const electricalPropertyEditSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('protection'),
      ids: z.array(z.string().min(1)).min(1),
      set: protectionPatchSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('circuit'),
      ids: z.array(z.string().min(1)).min(1),
      set: circuitPatchSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('endpoint'),
      ids: z.array(z.string().min(1)).min(1),
      set: endpointPatchSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('trunkDevice'),
      ids: z.array(z.string().min(1)).min(1),
      set: trunkPropertiesSchema,
    })
    .strict(),
])

/** Exported for the per-section MCP property tools; keep every kind reachable there. */
export const propertyEditSchema = z.union([
  electricalPropertyEditSchema,
  extraElectricalPropertyEditSchema,
  generalPropertyEditSchema,
])

export const wireEditSchema = z
  .object({
    circuitId: z.string().min(1),
    sectionRef: circuitSectionRefSchema.nullable().optional(),
    domain: z.enum(['AC', 'DC']),
    set: circuitWirePatchSchema,
  })
  .strict()

export const installDateTargetSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(['panel', 'protection', 'circuit', 'endpoint', 'trunkDevice']),
    clearOverride: z.boolean().nullable().optional(),
    explicitlyUnmark: z.boolean().nullable().optional(),
    preserveYear: z.number().int().nullable().optional(),
    forceOverride: z.boolean().nullable().optional(),
  })
  .strict()

const supplyMultiplierSourcePlacementSchema = z.object({
  id: z.string().min(1),
  floorId: z.string().min(1),
  layer: z.string(),
  pos: z.object({ x: z.number().finite(), y: z.number().finite() }),
  rotationDeg: z.number(),
  scale: z.number(),
  rotationMode: z.literal('explicit').optional(),
  mountingHeightM: z.number().optional(),
  locked: z.boolean().optional(),
  style: z.record(z.string(), z.unknown()).optional(),
}).strip()

const ordinaryPropertyActionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('assignEndpoints'),
      endpointIds: z.array(z.string().min(1)).min(1),
      targetCircuitId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('endpointMultiplier'),
      endpointId: z.string().min(1),
      count: z.number().int().min(1).max(99),
      activeFloorId: z.string().nullable().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('terminalStripPin'),
      occurrenceId: z.string().min(1),
      stripId: z.string(),
      pin: z.number().int().min(1),
      vacatedPin: z.number().int().nullable().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('panelModuleVisibility'),
      panelId: z.string().min(1),
      moduleRefKey: z.string().min(1),
      visible: z.boolean(),
    })
    .strict(),
  z
    .object({ kind: z.literal('deleteEndpoints'), endpointIds: z.array(z.string().min(1)).min(1) })
    .strict(),
  z.object({ kind: z.literal('lockCircuitRowForCode'), circuitId: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal('supplyDeviceMultiplier'),
      deviceId: z.string().min(1),
      count: z.number().int().min(1),
      activeFloorId: z.string().nullable().optional(),
      sourcePlacement: supplyMultiplierSourcePlacementSchema.optional(),
    })
    .strict(),
])

const semanticModuleVisibilitySchema = z.strictObject({
  kind: z.literal('panelModuleVisibility'),
  panelId: z.string().min(1),
  module: panelModuleRefSchema,
  visible: z.boolean(),
}).transform(({ module, ...action }) => ({ ...action, moduleRefKey: panelGridModuleRefKey(module) }))
export const propertyActionSchema = z.union([ordinaryPropertyActionSchema, extraElectricalActionSchema, semanticModuleVisibilitySchema])

export const propertiesEditInputSchema = z
  .object({
    edits: z.array(propertyEditSchema).default([]),
    wireEdits: z.array(wireEditSchema).optional(),
    actions: z.array(propertyActionSchema).optional(),
    installation: installationPropertiesSchema.optional(),
    seedInstallDateColors: z
      .object({
        targets: z.array(installDateTargetSchema),
        year: z.number().int().nullable().optional(),
      })
      .strict()
      .optional(),
    refreshAutomaticNaming: z.boolean().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.edits.length > 0 ||
      !!input.wireEdits?.length ||
      !!input.installation ||
      !!input.actions?.length ||
      !!input.seedInstallDateColors,
    {
      message: 'At least one property edit is required',
    }
  )

/**
 * Changing only the supply system also changes its line voltages, as the editor's system picker
 * does (3N~ is 230 V line-neutral and 400 V line-line). Voltages named in the patch win, and an
 * unchanged system keeps the stored voltages.
 */
function installationPatchWithSystemVoltages(
  current: { nominalVoltage: { system: string } } | null | undefined,
  patch: NonNullable<z.output<typeof propertiesEditInputSchema>['installation']>
) {
  const system = patch.nominalVoltage?.system
  if (!system || system === 'DC' || system === current?.nominalVoltage.system) return patch
  return { ...patch, nominalVoltage: { ...defaultVoltagesForSystem(system), ...patch.nominalVoltage } }
}

export type PropertyEdit = z.input<typeof propertyEditSchema>
export type PropertiesEditInput = z.input<typeof propertiesEditInputSchema>
export type ProtectionPropertyPatch = z.input<typeof protectionPatchSchema>
export type CircuitPropertyPatch = z.input<typeof circuitPatchSchema>
export type EndpointPropertyPatch = z.input<typeof endpointPatchSchema>
export type InstallationPropertyPatch = z.input<typeof installationPropertiesSchema>
export type CircuitWirePropertyPatch = z.input<typeof circuitWirePatchSchema>
export type PropertiesEditAction = z.input<typeof propertyActionSchema>
export type PropertiesEditOutcome = {
  changed: boolean
  changedEntities: Array<{ kind: string; id: string }>
}

// Text, nameplates and visibility cannot add modules or change their cabinet widths.
// Keep all other property families on the existing slot-repair path.
function preservesPanelSlots(input: z.output<typeof propertiesEditInputSchema>): boolean {
  return !input.installation && !input.actions?.length && !input.wireEdits?.length &&
    !input.seedInstallDateColors && !input.refreshAutomaticNaming && input.edits.every((edit) =>
      isGeneralPropertyEdit(edit) || (
        edit.kind === 'panel' && Object.keys(edit.set).every((key) =>
          ['name', 'nameByLocale', 'location', 'symbolLabelDisplay'].includes(key))
      ) || (
        ['protection', 'circuit', 'endpoint', 'trunkDevice'].includes(edit.kind) &&
        propertyPatchPreservesPanelSlots(edit.set)
      )
    )
}

function uniqueIds(edits: readonly z.output<typeof propertyEditSchema>[]): boolean {
  const seen = new Set<string>()
  for (const edit of edits) {
    for (const id of edit.ids) {
      const discriminator =
        isGeneralPropertyEdit(edit) && edit.kind === 'note'
          ? edit.scope
          : isExtraElectricalPropertyEdit(edit) && edit.kind === 'domoticaOutputWire'
            ? `${edit.outputGroup}:${edit.outputIndex}`
            : isExtraElectricalPropertyEdit(edit) && edit.kind === 'supplyConnection'
              ? edit.assemblyId
              : isExtraElectricalPropertyEdit(edit) && edit.kind === 'rootFeedWireSection'
                ? edit.sectionKey
                : ''
      const key = `${edit.kind}:${discriminator}:${id}`
      if (seen.has(key)) return false
      seen.add(key)
    }
  }
  return true
}

function findCircuit(project: ProjectV2, id: string) {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const result = findCircuitById(panel, id)
    if (result) return result
  }
  return null
}

function findEndpoint(project: ProjectV2, id: string) {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const result = findEndpointById(panel, id)
    if (result) return result
  }
  return null
}

function findTrunkDevice(project: ProjectV2, id: string) {
  return findTrunkDeviceInProject(project, id)
}

/** Switching a supply trunk device, or a module that sits in a supply assembly, to horizontal. */
function switchesSupplyModuleToHorizontal(
  project: ProjectV2,
  edit: z.output<typeof electricalPropertyEditSchema>
): boolean {
  const layout = (edit.set as { domoticaProps?: { oneWireLayout?: string | null } | null }).domoticaProps
    ?.oneWireLayout
  if (layout !== 'horizontal') return false
  if (edit.kind === 'trunkDevice')
    return edit.ids.some((id) => queryAllSupplyTrunkDevices(project).some((device) => device.id === id))
  if (edit.kind !== 'endpoint') return false
  const panels = getEditableProjectElectricalPanels(project)
  return edit.ids.some((id) => {
    const found = findEndpoint(project, id)
    if (!found || isHorizontalDomotica(found.endpoint)) return false
    return isEndpointInSupplyAssembly(found.circuit, id, findCircuitOwner(panels, found.circuit.id) ?? undefined)
  })
}

/**
 * The plain refusal for switching an endpoint module to the horizontal layout when the module
 * cannot be horizontal (the same meaning the Layout field shows as its disabled reason), or null.
 * Modules that are already horizontal and switches to vertical are never refused here.
 */
function horizontalSwitchRefusal(
  project: ProjectV2,
  edit: z.output<typeof electricalPropertyEditSchema>
): { ok: false; code: string; message: string } | null {
  if (edit.kind !== 'endpoint') return null
  const layout = (edit.set as { domoticaProps?: { oneWireLayout?: string | null } | null }).domoticaProps
    ?.oneWireLayout
  if (layout !== 'horizontal') return null
  for (const id of edit.ids) {
    const found = findEndpoint(project, id)
    if (!found || isHorizontalDomotica(found.endpoint)) continue
    const block = getHorizontalDomoticaSwitchBlock(
      found.circuit,
      id,
      findCircuitOwner(getEditableProjectElectricalPanels(project), found.circuit.id) ?? undefined
    )
    if (block === 'nested')
      return { ok: false, code: 'horizontal_domotica_top_level', message: HORIZONTAL_DOMOTICA_TOP_LEVEL_MESSAGE }
    if (block === 'has_nested_modules')
      return { ok: false, code: 'horizontal_domotica_no_nesting', message: HORIZONTAL_DOMOTICA_NO_NESTING_MESSAGE }
    if (block === 'continuation')
      return { ok: false, code: 'horizontal_domotica_terminal', message: HORIZONTAL_DOMOTICA_TERMINAL_MESSAGE }
    if (block === 'dc_bus' || block === 'supply_assembly')
      return { ok: false, code: 'horizontal_domotica_no_supply', message: HORIZONTAL_DOMOTICA_NO_SUPPLY_MESSAGE }
  }
  return null
}

function validateEntity(
  project: ProjectV2,
  edit: z.output<typeof electricalPropertyEditSchema>
): boolean {
  if (edit.kind === 'protection') {
    const panels = getEditableProjectElectricalPanels(project)
    return edit.ids.every((id) => !!findPanelOwningProtection(panels, id))
  }
  if (edit.kind === 'circuit')
    return edit.ids.every((id) => {
      const owner = findCircuit(project, id)
      if (!owner) return false
      return nestedValuesValid(
        normalizePatch(
          owner.circuit as unknown as Record<string, unknown>,
          edit.set as Record<string, unknown>
        ),
        Object.keys(edit.set)
      )
    })
  if (edit.kind === 'endpoint')
    return edit.ids.every((id) => {
      const owner = findEndpoint(project, id)
      if (!owner) return false
      const set = edit.set as Record<string, unknown>
      if (
        !nestedValuesValid(
          normalizePatch(owner.endpoint as unknown as Record<string, unknown>, set),
          Object.keys(set)
        )
      )
        return false
      const symbol = typeof set.symbol === 'string' ? set.symbol : owner.endpoint.symbol
      const has = (key: string) => set[key] != null
      if (has('socketProps') && owner.endpoint.type !== 'socket') return false
      if (has('switchProps') && owner.endpoint.type !== 'switch' && symbol !== 'domotica')
        return false
      if (has('lightPointProps') && symbol !== 'light_point') return false
      if (has('lightSpotProps') && symbol !== 'light_spot') return false
      if (has('lightFluorescentProps') && symbol !== 'light_fluorescent') return false
      if (has('smokeDetectorProps') && symbol !== 'smoke_detector') return false
      if (has('motionDetectorProps') && symbol !== 'motion_detector') return false
      if (has('relayProps') && symbol !== 'relay') return false
      if (has('energyMeterProps') && symbol !== 'energy_meter') return false
      if (has('domoticaProps') && symbol !== 'domotica') return false
      // A horizontal layout needs a top-level circuit module with nothing after it and no nested
      // modules (shared rule with the Layout field). Only the switch is checked: edits to a module
      // that is already horizontal stay possible, and switching back to vertical is always allowed.
      const requestedLayout = (
        set.domoticaProps as { oneWireLayout?: string | null } | null | undefined
      )?.oneWireLayout
      if (
        requestedLayout != null &&
        !isHorizontalDomotica(owner.endpoint) &&
        getHorizontalDomoticaSwitchBlock(
          owner.circuit,
          id,
          findCircuitOwner(getEditableProjectElectricalPanels(project), owner.circuit.id) ?? undefined
        ) != null
      )
        return false
      const childParentId =
        (set.domoticaChildProps as { parentEndpointId?: string | null } | null | undefined)
          ?.parentEndpointId ?? owner.endpoint.domoticaChildProps?.parentEndpointId
      const childParent = childParentId ? findEndpoint(project, childParentId)?.endpoint : undefined
      const existingChild = owner.endpoint.domoticaChildProps
      const nextChild = { ...existingChild, ...normalizePatch(
        (existingChild ?? {}) as unknown as Record<string, unknown>,
        (set.domoticaChildProps ?? {}) as Record<string, unknown>
      ) }
      const rowAnchor = existingChild && childParent?.domoticaProps &&
        (existingChild.outputGroup === 'control'
          ? childParent.domoticaProps.controlChildEndpointIds
          : childParent.domoticaProps.endpointChildEndpointIds)?.[existingChild.outputIndex]
      // Only the first device occupies the parent's row slot. Further physical devices
      // on that row must be able to edit addressing without inventing a new parent link.
      const keepsChainedRow = !!existingChild && !!rowAnchor &&
        nextChild.parentEndpointId === existingChild.parentEndpointId &&
        nextChild.outputGroup === existingChild.outputGroup &&
        nextChild.outputIndex === existingChild.outputIndex &&
        !!owner.circuit.branches?.some((branch) =>
          branch.endpointIds.includes(rowAnchor) && branch.endpointIds.includes(owner.endpoint.id)
        )
      const childLinkValid =
        !!childParent?.domoticaProps &&
        (childParent.domoticaProps.endpointChildEndpointIds?.includes(owner.endpoint.id) ||
          childParent.domoticaProps.controlChildEndpointIds?.includes(owner.endpoint.id) ||
          keepsChainedRow)
      if (has('domoticaChildProps') && !childLinkValid) return false
      if (has('domoticaRowLabel') && !owner.endpoint.domoticaChildProps && !childLinkValid)
        return false
      if (has('solarPanelProps') && symbol !== 'solar_panel') return false
      if (has('batteryProps') && symbol !== 'battery') return false
      if (has('evChargerProps') && symbol !== 'ev') return false
      if (has('hvacProps') && !isHvacDeviceSymbol(symbol)) return false
      if (
        has('energyConversionProps') &&
        !['transformer', 'rectifier', 'inverter', 'dc_dc_converter'].includes(symbol ?? '')
      )
        return false
      if (
        has('junctionIdentity') &&
        !['junction_box', 'junction_panel', 'terminal_strip'].includes(symbol ?? '')
      )
        return false
      return true
    })
  return edit.ids.every((id) => {
    const device = findTrunkDevice(project, id)
    if (!device) return false
    const set = edit.set as Record<string, unknown>
    const symbol = typeof set.symbol === 'string' ? set.symbol : device.symbol
    for (const [key, expected] of Object.entries({
      conversionProps: ['transformer', 'rectifier', 'inverter', 'dc_dc_converter'],
      batteryProps: ['battery'],
      solarPanelProps: ['solar_panel'],
      domoticaProps: ['domotica'],
      dcBusProps: ['dc_bus'],
      relayProps: ['relay'],
      energyMeterProps: ['energy_meter'],
      changeoverProps: ['source_changeover'],
    }))
      if (set[key] != null && !expected.includes(symbol)) return false
    // The horizontal one-wire layout is only drawn for circuit endpoint modules.
    if (
      (set.domoticaProps as { oneWireLayout?: string | null } | null | undefined)?.oneWireLayout !=
      null
    )
      return false
    return nestedValuesValid(
      normalizePatch(device as unknown as Record<string, unknown>, set),
      Object.keys(set)
    )
  })
}

/** Check all requested endpoint links together, so a multi-edit cannot create a cycle
 * that each individual edit would accept against the original project. */
function validateControlLinkEdits(
  project: ProjectV2,
  edits: readonly z.output<typeof propertyEditSchema>[],
): boolean {
  const relevant = edits.filter((edit) => edit.kind === 'endpoint' &&
    ['controlLink', 'symbol', 'domoticaChildProps'].some((key) => Object.hasOwn(edit.set, key)))
  if (relevant.length === 0) return true
  const panels = getEditableProjectElectricalPanels(project)
  const projected = new Map(collectControlLinkEntries(panels).map(({ endpoint }) => [endpoint.id, endpoint]))
  const targets = new Set<string>()
  for (const edit of relevant) {
    if (edit.kind !== 'endpoint') continue
    for (const id of edit.ids) {
      const endpoint = projected.get(id)
      if (!endpoint) return false
      const patch = normalizePatch(endpoint as unknown as Record<string, unknown>, edit.set as Record<string, unknown>)
      projected.set(id, { ...endpoint, ...patch } as Endpoint)
      targets.add(id)
    }
  }
  for (const id of targets) {
    const endpoint = projected.get(id)!
    if (endpoint.controlLink && !canLinkControlDevice(panels, endpoint, endpoint.controlLink.deviceId, projected)) return false
  }
  return true
}

function nestedValuesValid(value: Record<string, unknown>, touched: string[]): boolean {
  const cableIsComplete = (candidate: unknown): boolean => {
    if (candidate == null) return true
    if (typeof candidate !== 'object') return false
    const cable = candidate as Record<string, unknown>
    return (
      typeof cable.kind === 'string' &&
      typeof cable.conductors === 'number' &&
      Number.isInteger(cable.conductors) &&
      cable.conductors > 0 &&
      typeof cable.sectionMm2 === 'number' &&
      Number.isFinite(cable.sectionMm2) &&
      cable.sectionMm2 > 0
    )
  }
  const phaseIsComplete = (candidate: unknown): boolean => {
    if (candidate == null) return true
    if (typeof candidate !== 'object') return false
    const phase = candidate as Record<string, unknown>
    return typeof phase.kind === 'string' && Array.isArray(phase.phases)
  }
  if (touched.includes('cable') && !cableIsComplete(value.cable)) return false
  if (touched.includes('phaseAssignment') && !phaseIsComplete(value.phaseAssignment)) return false
  for (const key of ['controlLink', 'domoticaChildProps'] as const) {
    const nested = value[key]
    if (!touched.includes(key) || !nested || typeof nested !== 'object') continue
    const fields = nested as Record<string, unknown>
    if (key === 'controlLink' && typeof fields.deviceId !== 'string') return false
    if (
      key === 'domoticaChildProps' &&
      (typeof fields.parentEndpointId !== 'string' ||
        typeof fields.outputIndex !== 'number' ||
        !Number.isInteger(fields.outputIndex))
    )
      return false
  }
  const props = touched.includes('domoticaProps') ? value.domoticaProps : undefined
  if (props && typeof props === 'object') {
    const propertyBag = props as Record<string, unknown>
    for (const key of ['endpointOutputWires', 'controlOutputWires']) {
      const rows = propertyBag[key]
      if (!Array.isArray(rows)) continue
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue
        const wire = row as Record<string, unknown>
        if (!cableIsComplete(wire.cable) || !phaseIsComplete(wire.phaseAssignment)) return false
      }
    }
  }
  return true
}

function applyEdit(
  project: ProjectV2,
  edit: z.output<typeof electricalPropertyEditSchema>,
  changed: Set<string>
): void {
  if (edit.kind === 'protection') {
    for (const id of edit.ids) {
      const panel = findPanelOwningProtection(getEditableProjectElectricalPanels(project), id)
      const protection = panel?.protections.find((candidate) => candidate.id === id)
      if (!protection) continue
      const patch = normalizeProtectionCapacityUpdates(
        normalizePatch(
          protection as unknown as Record<string, unknown>,
          edit.set as Record<string, unknown>
        ) as Partial<ProtectionDevice>,
        protection
      )
      if (!patchChanges(protection as unknown as Record<string, unknown>, patch)) continue
      const result = updateProtectionInProject(project, id, patch as Partial<ProtectionDevice>)
      if (result.changed) changed.add(`protection:${id}`)
    }
    return
  }
  if (edit.kind === 'circuit') {
    for (const id of edit.ids) {
      const owner = findCircuit(project, id)
      if (!owner) continue
      const patch = normalizePatch(
        owner.circuit as unknown as Record<string, unknown>,
        edit.set as Record<string, unknown>
      )
      if (!patchChanges(owner.circuit as unknown as Record<string, unknown>, patch)) continue
      if (updateCircuitInProject(project, id, patch as Partial<Circuit>))
        changed.add(`circuit:${id}`)
    }
    return
  }
  if (edit.kind === 'endpoint') {
    for (const id of edit.ids) {
      const owner = findEndpoint(project, id)
      if (!owner) continue
      const patch = normalizePatch(
        owner.endpoint as unknown as Record<string, unknown>,
        edit.set as Record<string, unknown>
      )
      if (!patchChanges(owner.endpoint as unknown as Record<string, unknown>, patch)) continue
      const previousRotations = new Map(owner.endpoint.placements.map((placement) => [placement.id, placement.rotationDeg]))
      if (updateEndpointInProject(project, id, patch as Partial<Endpoint>).changed) {
        changed.add(`endpoint:${id}`)
        for (const placement of owner.endpoint.placements) {
          if (previousRotations.get(placement.id) !== placement.rotationDeg)
            changed.add(`placement:${placement.id}`)
        }
      }
    }
    return
  }
  for (const id of edit.ids) {
    const device = findTrunkDevice(project, id)
    if (!device) continue
    const patch = normalizeProtectionCapacityUpdates(
      normalizePatch(
        device as unknown as Record<string, unknown>,
        edit.set as Record<string, unknown>
      ) as Partial<import('@/types/schema').TrunkDevice>,
      device
    )
    if (!patchChanges(device as unknown as Record<string, unknown>, patch)) continue
    let didChange = false
    if (queryAllSupplyTrunkDevices(project).some((candidate) => candidate.id === id)) {
      didChange = updateSupplyTrunkDeviceInProject(
        project,
        id,
        patch as Partial<import('@/types/schema').TrunkDevice>
      ).changed
    } else {
      for (const panel of walkPanels(getEditableProjectElectricalPanels(project))) {
        const owner = getAllCircuits(panel).find(
          (c) =>
            c.trunkDevices?.some((d) => d.id === id) ||
            c.branches?.some((b) => b.branchDevices?.some((d) => d.id === id))
        )
        if (owner) {
          didChange = updateCircuitTrunkPropertiesInProject(project, owner.id, id, patch)
          break
        }
      }
      if (!didChange) didChange = updateGroundTrunkPropertiesInProject(project, id, patch)
    }
    if (didChange) changed.add(`trunkDevice:${id}`)
  }
}

function applyWireEdit(
  project: ProjectV2,
  wireEdit: z.output<typeof wireEditSchema>,
  changed: Set<string>
): void {
  const owner = findCircuit(project, wireEdit.circuitId)
  if (!owner) return
  const circuit = owner.circuit
  const domain = wireEdit.domain
  const patch = wireEdit.set as Record<string, unknown>
  let didChange = false
  if (wireEdit.sectionRef) {
    const ref = { ...wireEdit.sectionRef, domain }
    if (!isSectionRefValid(project, owner.circuit, ref)) {
      throw new CommandError('check_failed', 'A wire section target no longer exists', {
        reason: 'stale_wire_section',
      })
    }
    const current = findSectionWireOverride(circuit, ref)
    const merged = normalizePatch((current ?? {}) as Record<string, unknown>, patch)
    const next = upsertSectionWireOverride(circuit, ref, merged as never)
    didChange = JSON.stringify(next) !== JSON.stringify(circuit.sectionWireOverrides ?? [])
    if (didChange) circuit.sectionWireOverrides = next
  } else if (domain === 'AC') {
    didChange =
      updateCircuitInProject(
        project,
        wireEdit.circuitId,
        normalizePatch(circuit as unknown as Record<string, unknown>, patch) as Partial<Circuit>
      ) != null
  } else {
    const current = circuit.domainWireOverrides?.DC ?? {}
    const merged = normalizePatch(current as Record<string, unknown>, patch)
    const next = {
      ...(circuit.domainWireOverrides ?? {}),
      DC: merged as NonNullable<Circuit['domainWireOverrides']>['DC'],
    }
    didChange = JSON.stringify(next) !== JSON.stringify(circuit.domainWireOverrides ?? {})
    if (didChange) circuit.domainWireOverrides = next
  }
  if (didChange) changed.add(`circuit:${wireEdit.circuitId}`)
}

function isSectionRefValid(
  project: ProjectV2,
  circuit: Circuit,
  ref: z.output<typeof circuitSectionRefSchema>
): boolean {
  if (
    ref.fromElementType === 'endpoint' &&
    (!ref.fromElementId || !circuit.endpoints.some((endpoint) => endpoint.id === ref.fromElementId))
  )
    return false
  if (
    ref.toElementType === 'endpoint' &&
    (!ref.toElementId || !circuit.endpoints.some((endpoint) => endpoint.id === ref.toElementId))
  )
    return false
  const owningProtectionId = findCircuitOwner(
    getEditableProjectElectricalPanels(project),
    circuit.id
  )?.protection?.id
  if (
    ref.fromElementType === 'protection' &&
    (!ref.fromElementId || ref.fromElementId !== owningProtectionId)
  )
    return false
  if (
    ref.toElementType === 'protection' &&
    (!ref.toElementId || ref.toElementId !== owningProtectionId)
  )
    return false
  if (
    (ref.fromElementType === 'mainBus' || ref.fromElementType === 'secondaryBus') &&
    ref.fromElementId
  )
    return false
  return true
}

function validateDateTargets(
  project: ProjectV2,
  targets: z.output<typeof installDateTargetSchema>[]
): boolean {
  return targets.every((target) => {
    if (target.type === 'panel')
      return !!findPanelById(getEditableProjectElectricalPanels(project), target.id)
    if (target.type === 'protection')
      return !!findPanelOwningProtection(getEditableProjectElectricalPanels(project), target.id)
    if (target.type === 'circuit') return !!findCircuit(project, target.id)
    if (target.type === 'endpoint') return !!findEndpoint(project, target.id)
    return !!findTrunkDevice(project, target.id)
  })
}

function applyAction(
  project: ProjectV2,
  action: z.output<typeof propertyActionSchema>,
  env: CommandEnv,
  changed: Set<string>,
  created: EntityRef[],
  removed: EntityRef[]
): void {
  if (isExtraElectricalAction(action)) {
    const tracksRefs = [
      'projectSupplyConnection',
      'resizeConverter',
      'junctionPanelIdentity',
      'auxiliaryPlanVisibility',
      'panelFeedOrganization',
      'panelBusFeedBoundary',
      'supplyTapMode',
    ].includes(action.kind)
    const before = tracksRefs ? collectElectricalPropertyRefs(project) : []
    for (const ref of applyExtraElectricalAction(project, action, env))
      changed.add(`${ref.kind}:${ref.id}`)
    if (tracksRefs) {
      const after = collectElectricalPropertyRefs(project)
      const oldKeys = new Set(before.map((r) => `${r.kind}:${r.id}`))
      const nextKeys = new Set(after.map((r) => `${r.kind}:${r.id}`))
      for (const ref of after) if (!oldKeys.has(`${ref.kind}:${ref.id}`)) created.push(ref)
      for (const ref of before) if (!nextKeys.has(`${ref.kind}:${ref.id}`)) removed.push(ref)
    }
    return
  }

  if (action.kind === 'assignEndpoints') {
    const result = assignEndpointsToCircuitInProject(
      project,
      action.endpointIds,
      action.targetCircuitId,
      env.newId
    )
    if (!result) {
      if (
        action.endpointIds.every(
          (id) => findEndpoint(project, id)?.circuit.id === action.targetCircuitId
        )
      )
        return
      throw new CommandError('check_failed', 'Endpoints could not be assigned', {
        reason: 'assignment_rejected',
      })
    }
    result.changedCircuitIds.forEach((id) => changed.add(`circuit:${id}`))
    result.movedEndpointIds.forEach((id) => changed.add(`endpoint:${id}`))
    return
  }
  if (action.kind === 'endpointMultiplier') {
    const previousIds = new Set(
      findEndpoint(project, action.endpointId)?.endpoint.placements.map((placement) => placement.id)
    )
    const changedMultiplier = applyEndpointMultiplierCountInProject(
      project,
      action.endpointId,
      action.count,
      action.activeFloorId,
      env.newId
    )
    if (
      !changedMultiplier &&
      (findEndpoint(project, action.endpointId)?.endpoint.placements?.length ?? 0) !== action.count
    ) {
      throw new CommandError(
        'check_failed',
        'Endpoint cannot be multiplied without a plan placement',
        { reason: 'multiplier_placement_missing' }
      )
    }
    if (changedMultiplier) {
      syncPanelAndSituationPlanDeviceVisibility(project)
      changed.add(`endpoint:${action.endpointId}`)
      const nextIds = new Set(
        findEndpoint(project, action.endpointId)?.endpoint.placements.map(
          (placement) => placement.id
        )
      )
      for (const id of nextIds) if (!previousIds.has(id)) created.push({ kind: 'placement', id })
      for (const id of previousIds) if (!nextIds.has(id)) removed.push({ kind: 'placement', id })
    }
    return
  }
  if (action.kind === 'terminalStripPin') {
    const planned = planTerminalStripPinAssignment(
      project,
      action.occurrenceId,
      action.stripId,
      action.pin,
      action.vacatedPin ?? undefined
    )
    if (!planned.length)
      throw new CommandError('check_failed', 'Terminal strip occurrence no longer exists', {
        reason: 'stale_terminal_strip',
      })
    for (const update of planned) {
      const side = update.id.endsWith(':outgoing') ? 'outgoing' : 'incoming'
      const entityId = update.id.slice(0, -9)
      const endpoint = findEndpoint(project, entityId)?.endpoint
      if (endpoint) {
        updateEndpointInProject(project, entityId, getTerminalStripPinPatch(endpoint, side, update.stripId, update.pin))
        changed.add(`endpoint:${entityId}`)
        continue
      }
      const device = findTrunkDevice(project, entityId)
      if (!device) continue
      const patch = getTerminalStripPinPatch(device, side, update.stripId, update.pin)
      if (queryAllSupplyTrunkDevices(project).some((candidate) => candidate.id === entityId)) {
        updateSupplyTrunkDeviceInProject(project, entityId, patch)
      } else {
        Object.assign(device, patch)
      }
      changed.add(`trunkDevice:${entityId}`)
    }
    return
  }
  if (action.kind === 'panelModuleVisibility') {
    const changedVisibility = setPanelModuleVisibilityInProject(
      project,
      action.panelId,
      action.moduleRefKey,
      action.visible
    )
    if (changedVisibility) changed.add(`panel:${action.panelId}`)
    return
  }
  if (action.kind === 'supplyDeviceMultiplier') {
    if (
      !syncSupplyDeviceMultiplierInProject(project, action.deviceId, action.count, {
        activeFloorId: action.activeFloorId,
        sourcePlacement: action.sourcePlacement as Placement | undefined,
        newId: env.newId,
      })
    )
      throw new CommandError('check_failed', 'Supply device cannot be resized', {
        reason: 'unsupported_supply_multiplier',
      })
    changed.add(`trunkDevice:${action.deviceId}`)
    return
  }
  if (action.kind === 'lockCircuitRowForCode') {
    const owner = findCircuitOwner(getEditableProjectElectricalPanels(project), action.circuitId)
    if (!owner)
      throw new CommandError('check_failed', 'Circuit no longer exists', { reason: 'stale_target' })
    for (const circuit of owner.protection?.circuits ?? [owner.circuit]) {
      if (updateCircuitInProject(project, circuit.id, { eendraadManualCodeLock: true }))
        changed.add(`circuit:${circuit.id}`)
    }
    return
  }
  if (!deleteEndpointsFromProject(project, action.endpointIds)) {
    throw new CommandError('check_failed', 'Endpoints could not be removed', {
      reason: 'endpoint_delete_rejected',
    })
  }
  action.endpointIds.forEach((id) => removed.push({ kind: 'endpoint', id }))
}

function seedInstallDateColors(
  project: ProjectV2,
  targets: z.output<typeof installDateTargetSchema>[],
  year?: number
): boolean {
  let changed = false
  for (const target of targets) {
    if (target.clearOverride) continue
    const requested = target.preserveYear ?? year
    if (requested == null) continue
    const normalizedTarget = {
      ...target,
      clearOverride: target.clearOverride ?? undefined,
      explicitlyUnmark: target.explicitlyUnmark ?? undefined,
      preserveYear: target.preserveYear ?? undefined,
      forceOverride: target.forceOverride ?? undefined,
    }
    const inherited = getInstallDateTargetInheritedYear(project, normalizedTarget)
    if (!target.forceOverride && requested === inherited) continue
    changed = ensureInstallYearColor(project, requested) || changed
  }
  return changed
}

/** Applies property edits and related wire changes as one atomic project command. */
export const propertiesEdit = defineProjectCommand({
  id: 'properties.edit',
  version: 1,
  input: propertiesEditInputSchema,
  check(project, input) {
    if (!uniqueIds(input.edits)) {
      return {
        ok: false,
        code: 'duplicate_target',
        message: 'A property target may only appear once',
      }
    }
    if (!validateControlLinkEdits(project, input.edits)) {
      return { ok: false, code: 'invalid_control_link', message: 'Control links require an eligible device and cannot form a cycle' }
    }
    for (const edit of input.edits) {
      if (
        (edit.kind === 'protection' || edit.kind === 'trunkDevice') &&
        edit.set.ratingA != null &&
        edit.set.ratingA <= 0
      ) {
        return {
          ok: false,
          code: 'invalid_protection_rating',
          message: 'A protection rating must be greater than zero',
        }
      }
      if (isGeneralPropertyEdit(edit)) {
        const result = checkGeneralPropertyEdit(project, edit)
        if (!result.ok) return result
        continue
      }
      if (isExtraElectricalPropertyEdit(edit)) {
        const result = checkExtraElectricalPropertyEdit(project, edit)
        if (!result.ok) return result
        continue
      }
      if (switchesSupplyModuleToHorizontal(project, edit))
        return { ok: false, code: 'horizontal_domotica_no_supply', message: HORIZONTAL_DOMOTICA_NO_SUPPLY_MESSAGE }
      const horizontalRefusal = horizontalSwitchRefusal(project, edit)
      if (horizontalRefusal) return horizontalRefusal
      if (!validateEntity(project, edit)) {
        return { ok: false, code: 'stale_target', message: 'A property target no longer exists' }
      }
      if (edit.kind === 'trunkDevice') {
        const installation = getEditableProjectElectricalInstallation(project)!
        for (const id of edit.ids) {
          const device = findTrunkDevice(project, id)!
          const next = normalizePatch(device as unknown as Record<string, unknown>, edit.set as Record<string, unknown>)
          const props = { ...device.conversionProps, ...(next.conversionProps as typeof device.conversionProps) }
          if (props.transformerRole !== 'supply') continue
          if ((next.symbol ?? device.symbol) !== 'transformer' || !getInstallationSupplyTransformers(installation).some((source) => source.id === id))
            return { ok: false, code: 'invalid_transformer_owner', message: 'The supply transformer must be on the common incoming wire' }
          if (props.transformerPrimaryVoltageV != null && props.transformerPrimaryVoltageV <= 1000)
            return { ok: false, code: 'invalid_primary_voltage', message: 'The supply transformer primary voltage must exceed 1000 V' }
          const output = (input.installation && installationPatchWithSystemVoltages(installation, input.installation).nominalVoltage?.uLineToLine) ?? installation.nominalVoltage.uLineToLine
          const explicitlySetsOutput = edit.set.conversionProps != null &&
            Object.hasOwn(edit.set.conversionProps, 'transformerSecondaryVoltageV')
          if ((explicitlySetsOutput || device.conversionProps?.transformerRole !== 'supply') && props.transformerSecondaryVoltageV !== output)
            return { ok: false, code: 'invalid_secondary_voltage', message: 'Choose the installation voltage to change the supply transformer output' }
        }
      }
    }
    if (
      input.seedInstallDateColors &&
      !validateDateTargets(project, input.seedInstallDateColors.targets)
    ) {
      return { ok: false, code: 'stale_target', message: 'An install date target no longer exists' }
    }
    for (const action of input.actions ?? []) {
      if (isExtraElectricalAction(action)) {
        const result = checkExtraElectricalAction(project, action)
        if (!result.ok) return result
        continue
      }
      if (action.kind === 'assignEndpoints') {
        if (
          new Set(action.endpointIds).size !== action.endpointIds.length ||
          action.endpointIds.some((id) => !findEndpoint(project, id))
        )
          return { ok: false, code: 'stale_target', message: 'An endpoint no longer exists' }
        const target = findCircuit(project, action.targetCircuitId)
        if (!target || target.circuit.code === 'PANEL')
          return { ok: false, code: 'invalid_target_circuit', message: 'Target circuit not found' }
      } else if (action.kind === 'endpointMultiplier') {
        const endpoint = findEndpoint(project, action.endpointId)?.endpoint
        if (!endpoint)
          return { ok: false, code: 'stale_target', message: 'Endpoint no longer exists' }
        if (!endpointSupportsMultiplier(endpoint))
          return {
            ok: false,
            code: 'unsupported_endpoint',
            message: 'This endpoint cannot be multiplied',
          }
        if (
          action.activeFloorId &&
          !selectProjectBuildingFloors(project).some((floor) => floor.id === action.activeFloorId)
        )
          return { ok: false, code: 'stale_floor', message: 'Active floor no longer exists' }
      } else if (action.kind === 'terminalStripPin') {
        if (
          !collectTerminalStripOccurrences(project).some(
            (occurrence) => occurrence.id === action.occurrenceId
          )
        )
          return {
            ok: false,
            code: 'stale_terminal_strip',
            message: 'Terminal strip occurrence no longer exists',
          }
      } else if (action.kind === 'panelModuleVisibility') {
        const panel = findPanelById(getEditableProjectElectricalPanels(project), action.panelId)
        if (!panel) return { ok: false, code: 'stale_target', message: 'Panel no longer exists' }
        const allPanels = getEditableProjectElectricalPanels(project)
        const installation = getEditableProjectElectricalInstallation(project)
        if (action.visible && queryAllSupplyTrunkDevices(project).some(
          (device) => `trunkDevice:${device.id}:supply` === action.moduleRefKey && isSupplyTransformer(device)
        ))
          return {
            ok: false,
            code: 'unsupported_module_visibility',
            message: 'Supply transformers cannot appear in a panel',
          }
        const auxiliaryModule = listRemountableCircuitModules(allPanels).find(
          (occurrence) => occurrence.ownerPanel.id === action.panelId &&
            occurrence.entity.panelMounting?.kind === 'auxiliary' &&
            panelGridModuleRefKey(circuitModuleRef(occurrence)) === action.moduleRefKey
        )
        const known =
          auxiliaryModule != null ||
          getDefaultPanelGridModuleRefs(panel, installation, allPanels).some(
            (ref) => panelGridModuleRefKey(ref) === action.moduleRefKey
          ) ||
          (!!installation &&
            getPanelSupplyTrunkDevices(installation, allPanels, panel).some(
              (device) => `trunkDevice:${device.id}:supply` === action.moduleRefKey
            ))
        if (!known)
          return { ok: false, code: 'stale_target', message: 'Panel module no longer exists' }
        if (!action.visible) {
          const domotica = getDefaultPanelGridModuleRefs(panel, installation, allPanels).find(
            (ref) => panelGridModuleRefKey(ref) === action.moduleRefKey
          ) ?? (auxiliaryModule ? circuitModuleRef(auxiliaryModule) : undefined)
          if (domotica?.kind === 'domotica') {
            const endpoint = findEndpoint(project, domotica.endpointId)?.endpoint
            if (endpoint && isModularSocket(endpoint))
              return {
                ok: false,
                code: 'unsupported_module_visibility',
                message: 'Modular sockets cannot be hidden from the panel',
              }
          }
        }
      } else if (action.kind === 'supplyDeviceMultiplier') {
        if (!queryAllSupplyTrunkDevices(project).some((device) => device.id === action.deviceId))
          return { ok: false, code: 'stale_target', message: 'Supply device no longer exists' }
      } else if (action.kind === 'lockCircuitRowForCode') {
        if (!findCircuit(project, action.circuitId))
          return { ok: false, code: 'stale_target', message: 'Circuit no longer exists' }
      } else if (action.endpointIds.some((id) => !findEndpoint(project, id))) {
        return { ok: false, code: 'stale_target', message: 'An endpoint no longer exists' }
      }
    }
    for (const edit of input.wireEdits ?? []) {
      const owner = findCircuit(project, edit.circuitId)
      if (!owner)
        return { ok: false, code: 'stale_target', message: 'A wire circuit no longer exists' }
      const currentWireProperties = edit.sectionRef
        ? (findSectionWireOverride(owner.circuit, { ...edit.sectionRef, domain: edit.domain }) ??
          {})
        : edit.domain === 'AC'
          ? owner.circuit
          : (owner.circuit.domainWireOverrides?.DC ?? {})
      if (
        !nestedValuesValid(
          normalizePatch(
            currentWireProperties as Record<string, unknown>,
            edit.set as Record<string, unknown>
          ),
          Object.keys(edit.set)
        )
      ) {
        return { ok: false, code: 'invalid_property', message: 'A wire property is incomplete' }
      }
      if (
        edit.sectionRef &&
        !isSectionRefValid(project, owner.circuit, { ...edit.sectionRef, domain: edit.domain })
      ) {
        return {
          ok: false,
          code: 'stale_wire_section',
          message: 'A wire section target no longer exists',
        }
      }
    }
    if (input.installation && !getEditableProjectElectricalInstallation(project)) {
      return {
        ok: false,
        code: 'installation_missing',
        message: 'Electrical installation not found',
      }
    }
    if (input.installation) {
      const current = getEditableProjectElectricalInstallation(project)!
      if (input.installation.nominalVoltage?.system === 'DC' &&
        (getInstallationSupplyTransformer(current) || input.actions?.some((action) => action.kind === 'projectSupplyConnection' && action.connection === 'transformer')))
        return { ok: false, code: 'ac_supply_required', message: 'A supply transformer requires an AC installation' }
      const patch = normalizePatch(
        current as unknown as Record<string, unknown>,
        installationPatchWithSystemVoltages(current, input.installation) as Record<string, unknown>
      )
      if (
        ('groundCable' in patch && !nestedValuesValid({ cable: patch.groundCable }, ['cable'])) ||
        ('mainSupply' in patch &&
          !nestedValuesValid(patch.mainSupply as Record<string, unknown>, ['cable']))
      )
        return {
          ok: false,
          code: 'invalid_cable',
          message: 'Installation cable properties are incomplete',
        }
    }
    return { ok: true }
  },
  apply(draft, input, env) {
    const project = draft as ProjectV2
    const changed = new Set<string>()
    const created: EntityRef[] = []
    const removed: EntityRef[] = []
    if (
      input.seedInstallDateColors &&
      seedInstallDateColors(
        project,
        input.seedInstallDateColors.targets,
        input.seedInstallDateColors.year ?? undefined
      )
    )
      changed.add('project:installDateColors')
    // A custom circuit code locks its protection row before protection updates run, so
    // uniqueness/automatic naming cannot replace the value being edited in the same gesture.
    for (const action of input.actions ?? []) {
      if (action.kind === 'lockCircuitRowForCode')
        applyAction(project, action, env, changed, created, removed)
    }
    for (const edit of input.edits) {
      if (isGeneralPropertyEdit(edit)) {
        for (const ref of applyGeneralPropertyEdit(project, edit, env))
          changed.add(`${ref.kind}:${ref.id}`)
      } else if (isExtraElectricalPropertyEdit(edit)) {
        for (const ref of applyExtraElectricalPropertyEdit(project, edit))
          changed.add(`${ref.kind}:${ref.id}`)
      } else applyEdit(project, edit, changed)
    }
    for (const wireEdit of input.wireEdits ?? []) applyWireEdit(project, wireEdit, changed)
    for (const action of input.actions ?? []) {
      if (action.kind !== 'lockCircuitRowForCode')
        applyAction(project, action, env, changed, created, removed)
    }
    const installationPatch = input.installation
      ? installationPatchWithSystemVoltages(getEditableProjectElectricalInstallation(project), input.installation)
      : undefined
    if (
      installationPatch &&
      patchChanges(
        getEditableProjectElectricalInstallation(project) as unknown as Record<string, unknown>,
        normalizePatch(
          getEditableProjectElectricalInstallation(project) as unknown as Record<string, unknown>,
          installationPatch as Record<string, unknown>
        )
      )
    ) {
      const result = updateInstallationInProject(
        project,
        normalizePatch(
          getEditableProjectElectricalInstallation(project) as unknown as Record<string, unknown>,
          installationPatch as Record<string, unknown>
        ) as never
      )
      if (result.changed) changed.add('installation:electrical')
      if (result.changedSupplyBreakerId) changed.add(`trunkDevice:${result.changedSupplyBreakerId}`)
      if (result.changedSupplyTransformerId) changed.add(`trunkDevice:${result.changedSupplyTransformerId}`)
    }
    if (input.refreshAutomaticNaming) {
      const before = new Map<string, string>()
      const collectNames = (panels: ReturnType<typeof getEditableProjectElectricalPanels>) => {
        for (const panel of panels) {
          for (const protection of panel.protections)
            before.set(`protection:${protection.id}`, protection.label)
          for (const circuit of getAllCircuits(panel))
            before.set(`circuit:${circuit.id}`, circuit.code)
          if (panel.subPanels?.length) collectNames(panel.subPanels)
        }
      }
      collectNames(getEditableProjectElectricalPanels(project))
      applyAutomaticEendraadNamingAllPanelsInProject(project)
      const collectChanged = (panels: ReturnType<typeof getEditableProjectElectricalPanels>) => {
        for (const panel of panels) {
          for (const protection of panel.protections) {
            if (before.get(`protection:${protection.id}`) !== protection.label)
              changed.add(`protection:${protection.id}`)
          }
          for (const circuit of getAllCircuits(panel)) {
            if (before.get(`circuit:${circuit.id}`) !== circuit.code)
              changed.add(`circuit:${circuit.id}`)
          }
          if (panel.subPanels?.length) collectChanged(panel.subPanels)
        }
      }
      collectChanged(getEditableProjectElectricalPanels(project))
    }
    if ((changed.size || created.length || removed.length) && !preservesPanelSlots(input)) {
      for (const panel of walkPanels(getEditableProjectElectricalPanels(project))) {
        if (persistAutomaticPanelSlotsInProject(project, panel.id)) changed.add(`panel:${panel.id}`)
      }
    }
    const changedEntities = [...changed].map((entry) => {
      const separator = entry.indexOf(':')
      const kind = separator < 0 ? entry : entry.slice(0, separator)
      const id = separator < 0 ? '' : entry.slice(separator + 1)
      return { kind: kind!, id: id! }
    })
    return {
      created,
      changed: changedEntities
        .filter(
          (entity) => !removed.some((ref) => ref.kind === entity.kind && ref.id === entity.id)
        )
        .map(({ kind, id }) => ({
          kind: kind as import('../types').EntityKind,
          id,
        })),
      removed,
      related: [],
      select: [],
    }
  },
})
