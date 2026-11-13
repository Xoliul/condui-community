import { z } from 'zod'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import type { ProjectV2 } from '@/types/projectV2'
import type { Panel } from '@/types/schema'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import { getPanelBusSections } from '@/lib/panel/panelBusSections'
import { getStandardCircuitBranches } from '@/lib/layout/endpointChains'
import {
  getCircuitConverterDcConnectionCount,
  getCircuitConverterPrimaryBranch,
  supportsCircuitConverterDcConnections,
} from '@/lib/layout/circuitConverterGeometry'
import type { CommandCheck } from './types'

const id = z.string().min(1)
const index = z.number().int().nonnegative()

/** Canvas hit metadata is an external command input, including all of its optional fields. */
export const electricalDropTargetSchema = z.strictObject({
  type: z
    .enum([
      'circuit',
      'protection',
      'endpoint',
      'mainBus',
      'rcd',
      'supplyWire',
      'supplyBackupWire',
      'supplyBackupOutputWire',
      'supplyChangeoverGridWire',
      'supplyConverterGridWire',
      'supplyConverterBackupWire',
      'supplyConverterDcWire',
      'groundWire',
    ])
    .nullable(),
  circuitId: id.optional(),
  protectionId: id.optional(),
  endpointId: id.optional(),
  insertAfterEndpointId: id.nullable().optional(),
  panelId: id.optional(),
  diagramId: id.optional(),
  branchEndpoints: z.array(id).optional(),
  branchId: id.optional(),
  forkAfterEndpointId: id.optional(),
  forkBranchId: id.optional(),
  adoptForksOf: id.optional(),
  releaseForkLegsOf: id.optional(),
  branchInsertIndex: index.optional(),
  branchDeviceInsertIndex: index.optional(),
  supplyDeviceInsertIndex: index.optional(),
  supplyFeedScope: z.enum(['shared', 'root']).optional(),
  supplyPanelInput: z.boolean().optional(),
  supplyConverterDcBranch: z.enum(['right', 'top']).optional(),
  supplyConverterDcConnectionIndex: index.optional(),
  supplyDcBusId: id.optional(),
  supplyDcBusBranchId: id.optional(),
  converterGridPlacement: z.enum(['inline', 'input-leg', 'converter-leg']).optional(),
  changeoverGridPlacement: z.enum(['inline', 'input-leg']).optional(),
  supplyConverterChangeoverSlot: z.boolean().optional(),
  groundDeviceInsertIndex: index.optional(),
  circuitTrunkSegmentIndex: index.optional(),
  circuitTrunkBranchSlot: index.optional(),
  mainBusInsertIndex: index.optional(),
  mainBusItemCount: index.optional(),
  busSectionId: id.optional(),
  normalizedFromPanelFrame: z.boolean().optional(),
  secondaryBusInsertIndex: index.optional(),
  secondaryBusItemCount: index.optional(),
  insertBeforeNestedCircuitId: id.optional(),
  insertAfterCircuitContent: z.boolean().optional(),
  wireDomain: id.optional(),
  domoticaOutput: z
    .strictObject({
      group: z.enum(['control', 'endpoint']),
      index,
      expands: z.boolean().optional(),
    })
    .optional(),
  domoticaChildDropIntent: z.enum(['replace', 'insertBefore', 'insertAfter']).optional(),
  converterDcConnection: z.strictObject({ converterId: id, connectionIndex: index }).optional(),
  dcBusId: id.optional(),
}).superRefine((target, context) => {
  if (target.type === 'circuit' && !target.circuitId)
    context.addIssue({ code: 'custom', path: ['circuitId'], message: 'A circuit target needs a circuit id.' })
  if (target.type === 'endpoint' && !target.endpointId)
    context.addIssue({ code: 'custom', path: ['endpointId'], message: 'An endpoint target needs an endpoint id.' })
}) satisfies z.ZodType<DropTarget>

function flattenPanels(panels: readonly Panel[]): Panel[] {
  return panels.flatMap((panel) => [panel, ...flattenPanels(panel.subPanels)])
}

/** Reject stale ids and cross-panel/cross-circuit anchors before the engine can append/fallback. */
export function checkElectricalDropTarget(
  project: ProjectV2,
  target: DropTarget,
  floorId?: string | null
): CommandCheck {
  const fail = (code: string, message: string): CommandCheck => ({ ok: false, code, message })
  const panels = flattenPanels(getEditableProjectElectricalPanels(project))
  const panel = target.panelId ? panels.find((entry) => entry.id === target.panelId) : undefined
  if (target.panelId && !panel) return fail('panel_not_found', 'Panel not found')
  if (
    target.busSectionId &&
    (!panel || !getPanelBusSections(panel).some((section) => section.id === target.busSectionId))
  )
    return fail('bus_section_not_found', 'Bus section does not belong to the target panel')
  const circuits = panels.flatMap((owner) =>
    [...owner.circuits, ...owner.protections.flatMap((entry) => entry.circuits ?? [])].map(
      (circuit) => ({ circuit, panel: owner })
    )
  )
  const owner = circuits.find((entry) => entry.circuit.id === target.circuitId)
  if ((target.type === 'circuit' || target.type === 'endpoint') && !target.circuitId)
    return fail('circuit_required', 'A circuit target needs a circuit id')
  if (target.circuitId && !owner) return fail('circuit_not_found', 'Circuit not found')
  if (owner && panel && owner.panel.id !== panel.id)
    return fail('wrong_panel', 'Circuit does not belong to the target panel')
  const protectionOwner = panels.find((entry) =>
    entry.protections.some((item) => item.id === target.protectionId)
  )
  const protection = protectionOwner?.protections.find((entry) => entry.id === target.protectionId)
  if ((target.type === 'protection' || target.type === 'rcd') && !target.protectionId)
    return fail('protection_required', 'A protection target needs a protection id')
  if (target.protectionId && !protection)
    return fail('protection_not_found', 'Protection not found')
  if (protectionOwner && panel && protectionOwner.id !== panel.id)
    return fail('wrong_panel', 'Protection does not belong to the target panel')
  if (owner && protection && !protection.circuits?.some((entry) => entry.id === owner.circuit.id))
    return fail('wrong_protection', 'Circuit does not belong to the target protection')
  const endpointIds = [
    target.endpointId,
    target.insertAfterEndpointId,
    ...(target.branchEndpoints ?? []),
  ].filter((entry): entry is string => !!entry)
  if (
    endpointIds.some((entry) => !owner?.circuit.endpoints.some((endpoint) => endpoint.id === entry))
  )
    return fail('endpoint_not_found', 'Endpoint anchor does not belong to the target circuit')
  if (target.type === 'endpoint' && !target.endpointId)
    return fail('endpoint_required', 'An endpoint target needs an endpoint id')
  const connection = target.converterDcConnection
  const converterBranch = connection && owner?.circuit.branches?.find((branch) =>
    branch.branchDevices?.some((device) => device.id === connection.converterId))
  const converter = connection && (
    owner?.circuit.trunkDevices?.find((device) => device.id === connection.converterId) ??
    converterBranch?.branchDevices?.find((device) => device.id === connection.converterId)
  )
  if (connection) {
    if (!converter || !supportsCircuitConverterDcConnections(converter))
      return fail('converter_not_found', 'Converter does not belong to the target circuit')
    if (connection.connectionIndex >= getCircuitConverterDcConnectionCount(converter))
      return fail('converter_connection_not_found', 'Converter connection no longer exists')
  }
  if (target.branchId && owner) {
    const circuit = owner.circuit
    const prefix = `branch-${circuit.id}-`
    let branchIds: string[] | undefined
    if (connection && converter && target.branchId ===
      `converter-dc-output-${converter.id}-${connection.connectionIndex}`) {
      // Expanded DC outputs are rendered branches, including empty inputs that
      // have no stored branch yet. Validate their actual connection membership.
      const primaryIds = new Set((converterBranch ??
        getCircuitConverterPrimaryBranch(circuit, converter))?.endpointIds ?? [])
      branchIds = circuit.endpoints.filter((endpoint) =>
        endpoint.converterDcConnection
          ? endpoint.converterDcConnection.converterId === converter.id &&
            endpoint.converterDcConnection.connectionIndex === connection.connectionIndex
          : connection.connectionIndex === 0 && primaryIds.has(endpoint.id)
      ).map((endpoint) => endpoint.id)
    } else if (
      target.branchId === `${prefix}empty` &&
      !getStandardCircuitBranches(circuit)
        .flat()
        .some((endpoint) => endpoint.symbol !== 'panel_distribution')
    ) {
      branchIds = []
    } else if (
      target.branchId.startsWith(prefix) &&
      /^\d+$/.test(target.branchId.slice(prefix.length))
    ) {
      branchIds = getStandardCircuitBranches(circuit)[
        Number(target.branchId.slice(prefix.length))
      ]?.map((endpoint) => endpoint.id)
    } else {
      branchIds = circuit.branches?.find((branch) => branch.id === target.branchId)?.endpointIds
    }
    if (!branchIds) return fail('branch_not_found', 'Branch does not belong to the target circuit')
    const members = new Set(branchIds)
    // A rendered branch also contains the children of its domotica outputs.
    let previousSize = -1
    while (previousSize !== members.size) {
      previousSize = members.size
      for (const endpoint of circuit.endpoints) {
        if (
          endpoint.domoticaChildProps &&
          members.has(endpoint.domoticaChildProps.parentEndpointId)
        )
          members.add(endpoint.id)
      }
    }
    if (target.branchEndpoints?.some((endpointId) => !members.has(endpointId)))
      return fail('wrong_branch', 'Endpoint anchor does not belong to the target branch')
    if (target.insertAfterEndpointId && !members.has(target.insertAfterEndpointId))
      return fail('wrong_branch', 'Insertion anchor does not belong to the target branch')
  }
  if (
    target.insertBeforeNestedCircuitId &&
    !owner?.circuit.subCircuitIds?.includes(target.insertBeforeNestedCircuitId)
  )
    return fail('nested_circuit_not_found', 'Nested circuit does not belong to the target circuit')
  if (
    target.dcBusId &&
    !owner?.circuit.trunkDevices?.some((device) => device.id === target.dcBusId)
  )
    return fail('dc_bus_not_found', 'DC bus does not belong to the target circuit')
  if (floorId && !selectProjectBuildingFloors(project).some((floor) => floor.id === floorId))
    return fail('floor_not_found', 'Floor not found')
  return { ok: true }
}
