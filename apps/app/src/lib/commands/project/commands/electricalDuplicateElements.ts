import { z } from 'zod'
import type { ProjectV2 } from '@/types/projectV2'
import { electricalDropTargetSchema, checkElectricalDropTarget } from '../electricalDropTarget'
import { defineProjectCommand } from '../types'
import { getEditableProjectElectricalPanels, getProjectElectricalInstallation } from '@/lib/projectV2/electrical'
import { findCircuitById, findEndpointById } from '@/lib/eendraad/projectElectricalDomain'
import { findTrunkDeviceInProject } from '@/lib/eendraad/findTrunkDeviceInProject'
import { walkPanels, findPanelById } from '@/lib/panel/panelTree'
import { endpointSymbolCanBeDuplicated } from '@/lib/eendraad/duplicateEndpoint'
import { endpointSupportsMultiplier } from '@/utils/endpointMultipliers'
import { circuitContainsJunctionPanelIdentity, getJunctionIdentity } from '@/lib/junctionIdentity'
import { queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { applyElectricalDuplicateElements } from '@/lib/eendraad/duplicateElementsMutations'
import { collectTopologyRefs, diffTopologyRefs } from '../topologyRefs'

const pointSchema = z.strictObject({ x: z.number().finite(), y: z.number().finite() })
const sitplanSchema = z.strictObject({
  activeFloorId: z.string().min(1).nullable(),
  viewportCenter: pointSchema.nullable(),
  activePanelId: z.string().min(1).nullable(),
})
const enclosureSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('grid') }),
  z.strictObject({ kind: z.literal('panel'), panelId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('auxiliary'), enclosureId: z.string().min(1) }),
])
const sourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('endpoint'), id: z.string().min(1) }),
  z.strictObject({ kind: z.literal('trunkDevice'), id: z.string().min(1) }),
])
const targetSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('duplicateBranch'), circuitId: z.string().min(1), branchOrder: z.enum(['beforeSource', 'aboveSource']) }),
  z.strictObject({ type: z.literal('pasteEndpoints'), circuitId: z.string().min(1), insertAfterEndpointId: z.string().min(1).nullable().optional() }),
  z.strictObject({ type: z.literal('circuitTrunk'), circuitId: z.string().min(1), insertIndex: z.number().int().nonnegative() }),
  z.strictObject({ type: z.literal('dcBranchDevice'), circuitId: z.string().min(1), branchId: z.string().min(1), insertIndex: z.number().int().nonnegative() }),
  z.strictObject({ type: z.literal('supply'), panelId: z.string().min(1).nullable(), feedScope: z.enum(['shared', 'root']), insertIndex: z.number().int().nonnegative() }),
  z.strictObject({ type: z.literal('ground'), panelId: z.string().min(1).nullable(), insertIndex: z.number().int().nonnegative() }),
  z.strictObject({ type: z.literal('sourceSelection') }),
  z.strictObject({ type: z.literal('panelGrid'), panelId: z.string().min(1), row: z.number().int().nonnegative(), col: z.number().finite().nonnegative() }),
  z.strictObject({ type: z.literal('drop'), target: electricalDropTargetSchema, targetMounting: enclosureSchema.optional() }),
])

export const electricalDuplicateElementsInputSchema = z.strictObject({
  items: z.array(sourceSchema).min(1).max(100),
  purpose: z.enum(['duplicate', 'paste', 'altDrag']),
  target: targetSchema,
  sitplan: sitplanSchema.optional(),
})
export type ElectricalDuplicateElementsInput = z.input<typeof electricalDuplicateElementsInputSchema>
type Source = z.output<typeof sourceSchema>
type Target = z.output<typeof targetSchema>

function circuit(project: ProjectV2, id: string) {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const found = findCircuitById(panel, id)
    if (found) return found.circuit
  }
  return undefined
}
function endpoint(project: ProjectV2, id: string) {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const found = findEndpointById(panel, id)
    if (found) return found
  }
  return undefined
}
function device(project: ProjectV2, id: string) { return findTrunkDeviceInProject(project, id) }
function isGround(project: ProjectV2, id: string) {
  return [...walkPanels(getEditableProjectElectricalPanels(project))].some((panel) => panel.groundTrunkDevices?.some((item) => item.id === id)) ||
    !!getProjectElectricalInstallation(project)?.groundTrunkDevices?.some((item) => item.id === id)
}
function trunkOwner(project: ProjectV2, id: string) {
  const installation = getProjectElectricalInstallation(project)
  if (installation?.mainSupply.supplyTrunkDevices?.some((item) => item.id === id)) return 'supply:shared:'
  for (const feed of installation?.feedTopology?.rootFeeds ?? []) {
    if (feed.trunkDevices?.some((item) => item.id === id)) return `supply:root:${feed.panelId}`
  }
  if (installation?.feedTopology?.sharedFeed.trunkDevices?.some((item) => item.id === id)) return 'supply:shared:'
  for (const panel of walkPanels(getEditableProjectElectricalPanels(project))) {
    if (panel.groundTrunkDevices?.some((item) => item.id === id)) return `ground:panel:${panel.id}`
  }
  if (getProjectElectricalInstallation(project)?.groundTrunkDevices?.some((item) => item.id === id)) return 'ground:installation'
  const circuit = circuitForDevice(project, id)
  if (circuit) return `circuit:${circuit.id}`
  return undefined
}
function circuitIds(project: ProjectV2, items: Source[]) {
  return [...new Set(items.map((item) => item.kind === 'endpoint' ? endpoint(project, item.id)?.circuit.id : undefined).filter((id): id is string => !!id))]
}
function circuitForDevice(project: ProjectV2, id: string) {
  for (const panel of walkPanels(getEditableProjectElectricalPanels(project))) {
    for (const candidate of [...(panel.circuits ?? []), ...(panel.protections ?? []).flatMap((entry) => entry.circuits ?? [])]) {
      if (candidate.trunkDevices?.some((entry) => entry.id === id) || candidate.branches?.some((branch) => branch.branchDevices?.some((entry) => entry.id === id))) return candidate
    }
  }
  return undefined
}
function checkItems(project: ProjectV2, items: Source[]) {
  if (new Set(items.map((item) => `${item.kind}:${item.id}`)).size !== items.length) return { ok: false as const, code: 'duplicate_source', message: 'A source may only be copied once' }
  if (new Set(items.map((item) => item.kind)).size !== 1) return { ok: false as const, code: 'mixed_sources', message: 'Copy endpoints or devices together, not both' }
  if (items.some((item) => item.kind === 'endpoint' ? !endpoint(project, item.id) : !device(project, item.id))) return { ok: false as const, code: 'source_not_found', message: 'A copied endpoint or device no longer exists' }
  return { ok: true as const }
}
function checkDestination(project: ProjectV2, items: Source[], purpose: string, target: Target) {
  const endpointsOnly = items.every((item) => item.kind === 'endpoint')
  const devicesOnly = items.every((item) => item.kind === 'trunkDevice')
  if (target.type === 'sourceSelection') {
    if (endpointsOnly) {
      const ids = circuitIds(project, items)
      if (!ids.length || ids.length !== 1) return { ok: false as const, code: 'circuit_mismatch', message: 'Selected endpoints must share a circuit' }
      if (items.some((item) => {
        const source = endpoint(project, item.id)!.endpoint
        if (source.symbol === 'junction_panel') return true
        return !endpointSymbolCanBeDuplicated(source) && !(items.length === 1 && endpointSupportsMultiplier(source))
      })) return { ok: false as const, code: 'endpoint_not_duplicable', message: 'An endpoint cannot be duplicated' }
    } else if (devicesOnly) {
      const owners = items.map((item) => item.kind === 'trunkDevice' ? trunkOwner(project, item.id) : undefined)
      if (owners.some((owner) => !owner) || new Set(owners).size !== 1) return { ok: false as const, code: 'device_owner_mismatch', message: 'Selected devices must share an owner' }
      const owner = owners[0]
      if (owner?.startsWith('circuit:')) {
        const sourceCircuit = circuit(project, owner.slice('circuit:'.length))
        const branchOwners = items.map((item) => sourceCircuit?.branches?.find((branch) => branch.branchDevices?.some((device) => device.id === item.id))?.id ?? null)
        if (new Set(branchOwners).size > 1) return { ok: false as const, code: 'device_branch_mismatch', message: 'Selected circuit devices must share a trunk or DC branch' }
      }
      if (items.some((item) => item.kind === 'trunkDevice' && device(project, item.id)?.type === 'dc_bus')) return { ok: false as const, code: 'dc_bus_not_duplicable', message: 'A DC bus cannot be duplicated by itself' }
      if (items.some((item) => item.kind === 'trunkDevice' && device(project, item.id)?.symbol === 'junction_panel')) return { ok: false as const, code: 'junction_panel_not_duplicable', message: 'A junction panel cannot be duplicated' }
    } else return { ok: false as const, code: 'empty_selection', message: 'Nothing can be duplicated' }
    return { ok: true as const }
  }
  if (target.type === 'panelGrid') {
    // Alt-drag of a Domotica module inside a panel grid: the copy stays on the source circuit.
    if (items.length !== 1 || !endpointsOnly) return { ok: false as const, code: 'source_target_mismatch', message: 'Only one Domotica module can be copied onto a panel grid' }
    const source = endpoint(project, items[0]!.id)!.endpoint
    if (source.symbol === 'junction_panel' || !endpointSymbolCanBeDuplicated(source)) return { ok: false as const, code: 'endpoint_not_duplicable', message: 'An endpoint cannot be duplicated' }
    if (!findPanelById(getEditableProjectElectricalPanels(project), target.panelId)) return { ok: false as const, code: 'panel_not_found', message: 'Panel not found' }
    return { ok: true as const }
  }
  if ((target.type === 'duplicateBranch' || target.type === 'pasteEndpoints') && !endpointsOnly) return { ok: false as const, code: 'source_target_mismatch', message: 'This destination only accepts endpoints' }
  if (target.type === 'dcBranchDevice' && !devicesOnly) return { ok: false as const, code: 'source_target_mismatch', message: 'This destination only accepts devices' }
  if (target.type === 'duplicateBranch' || target.type === 'pasteEndpoints' || target.type === 'circuitTrunk' || target.type === 'dcBranchDevice') {
    const destination = circuit(project, target.circuitId)
    if (!destination) return { ok: false as const, code: 'circuit_not_found', message: 'Destination circuit not found' }
    if (target.type === 'duplicateBranch') {
      if (items.some((item) => item.kind !== 'endpoint' || endpoint(project, item.id)!.endpoint.symbol === 'junction_panel' || !endpointSymbolCanBeDuplicated(endpoint(project, item.id)!.endpoint))) return { ok: false as const, code: 'endpoint_not_duplicable', message: 'An endpoint cannot be duplicated' }
      if (purpose === 'duplicate' && circuitIds(project, items).some((id) => id !== target.circuitId)) return { ok: false as const, code: 'circuit_mismatch', message: 'Duplicate branch must use its source circuit' }
    }
    if (target.type === 'pasteEndpoints' && target.insertAfterEndpointId && !destination.endpoints.some((item) => item.id === target.insertAfterEndpointId)) return { ok: false as const, code: 'anchor_not_found', message: 'Paste position no longer exists' }
    if (target.type === 'pasteEndpoints' && items.some((item) => {
      if (item.kind !== 'endpoint') return false
      const source = endpoint(project, item.id)
      if (source?.endpoint.symbol !== 'junction_panel') return false
      return source.circuit.id === destination.id || circuitContainsJunctionPanelIdentity(destination, getJunctionIdentity(source.endpoint))
    })) return { ok: false as const, code: 'duplicate_junction_panel', message: 'This junction panel cannot be duplicated on the destination circuit' }
    if (target.type === 'dcBranchDevice') {
      const branch = destination.branches?.find((item) => item.id === target.branchId)
      if (!branch?.dcBusId || target.insertIndex > (branch.branchDevices?.length ?? 0)) return { ok: false as const, code: 'branch_not_found', message: 'Destination DC branch not found' }
      if (items.some((item) => item.kind !== 'trunkDevice' || !destination.branches?.some((candidate) => candidate.branchDevices?.some((entry) => entry.id === item.id)))) return { ok: false as const, code: 'invalid_dc_branch_source', message: 'Only devices on this circuit’s DC branches can be copied here' }
    }
    if (target.type === 'circuitTrunk') {
      if (!devicesOnly || items.some((item) => {
        if (item.kind !== 'trunkDevice') return true
        const sourceCircuit = circuitForDevice(project, item.id)
        return !sourceCircuit?.trunkDevices?.some((entry) => entry.id === item.id)
      })) return { ok: false as const, code: 'invalid_circuit_trunk_source', message: 'Only circuit-trunk devices can be copied here' }
      if (target.insertIndex > (destination.trunkDevices?.length ?? 0)) return { ok: false as const, code: 'invalid_insert_index', message: 'The circuit trunk insertion position is stale' }
    }
  } else if (target.type === 'supply') {
    if (target.panelId && !findPanelById(getEditableProjectElectricalPanels(project), target.panelId)) return { ok: false as const, code: 'panel_not_found', message: 'Supply panel not found' }
    if (items.some((item) => item.kind !== 'trunkDevice' || !queryAllSupplyTrunkDevices(project).some((entry) => entry.id === item.id))) return { ok: false as const, code: 'invalid_supply_source', message: 'Only supply devices can be copied here' }
    const owners = items.map((item) => item.kind === 'trunkDevice' ? trunkOwner(project, item.id) : undefined)
    if (owners.some((owner) => !owner) || new Set(owners).size !== 1) return { ok: false as const, code: 'supply_owner_mismatch', message: 'Selected supply devices must share one feed' }
  } else if (target.type === 'ground') {
    if (items.some((item) => item.kind !== 'trunkDevice' || !isGround(project, item.id))) return { ok: false as const, code: 'invalid_ground_source', message: 'Only ground devices can be copied here' }
    if (target.panelId && !findPanelById(getEditableProjectElectricalPanels(project), target.panelId)) return { ok: false as const, code: 'panel_not_found', message: 'Ground panel not found' }
    const owners = items.map((item) => item.kind === 'trunkDevice' ? trunkOwner(project, item.id) : undefined)
    if (owners.some((owner) => !owner) || new Set(owners).size !== 1) return { ok: false as const, code: 'ground_owner_mismatch', message: 'Selected ground devices must share one owner' }
  } else {
    const checked = checkElectricalDropTarget(project, target.target)
    if (!checked.ok) return checked
    if (endpointsOnly && (target.target.type === 'supplyWire' || target.target.type === 'groundWire')) return { ok: false as const, code: 'source_target_mismatch', message: 'Endpoints cannot be copied to this wire' }
    for (const item of items) {
      if (item.kind !== 'endpoint') continue
      const source = endpoint(project, item.id)?.endpoint
      if (source?.symbol !== 'junction_panel') continue
      const targetCircuitId = target.target.circuitId
      const destination = targetCircuitId ? circuit(project, targetCircuitId) : undefined
      if (targetCircuitId === endpoint(project, item.id)?.circuit.id || (destination && circuitContainsJunctionPanelIdentity(destination, getJunctionIdentity(source)))) {
        return { ok: false as const, code: 'duplicate_junction_panel', message: 'This junction panel cannot be duplicated there' }
      }
    }
    for (const item of items) {
      if (item.kind !== 'trunkDevice') continue
      const source = device(project, item.id)
      if (source?.symbol === 'junction_panel') {
        const sourceCircuit = circuitForDevice(project, item.id)
        const destination = target.target.circuitId ? circuit(project, target.target.circuitId) : undefined
        if (!destination || sourceCircuit?.id === destination.id || circuitContainsJunctionPanelIdentity(destination, getJunctionIdentity(source))) {
          return { ok: false as const, code: 'duplicate_junction_panel', message: 'This junction panel cannot be duplicated there' }
        }
      }
    }
  }
  return { ok: true as const }
}

export const electricalDuplicateElements = defineProjectCommand({
  id: 'electrical.duplicateElements',
  version: 1,
  input: electricalDuplicateElementsInputSchema,
  check(project, input) {
    const checked = checkItems(project as ProjectV2, input.items)
    if (!checked.ok) return checked
    return checkDestination(project as ProjectV2, input.items, input.purpose, input.target)
  },
  apply(draft, input, env) {
    const before = collectTopologyRefs(draft as ProjectV2)
    const result = applyElectricalDuplicateElements(draft as ProjectV2, input, env)
    return { ...result, ...diffTopologyRefs(before, collectTopologyRefs(draft as ProjectV2)) }
  },
})
