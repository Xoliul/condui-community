import { z } from 'zod'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import { getStandardCircuitBranches } from '@/lib/layout/endpointChains'
import { findCircuitOwner } from '@/lib/eendraad/projectElectricalDomain'
import { getPanelGroundTrunkDevices } from '@/lib/eendraad/panelGround'
import { getMainBusOrder } from '@/lib/eendraad/mainBusOrder'
import { findPanelById, walkPanels } from '@/lib/panel/panelTree'
import { getCircuitConverterDcConnectionCount, supportsCircuitConverterDcConnections } from '@/lib/layout/circuitConverterGeometry'
import { getSupplyConverterDcConnectionIndex } from '@/lib/supplyAssembly/converterDcConnections'
import { getConverterOutputDevices } from '@/lib/eendraad/converterOutputDevices'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import type { ProjectV2 } from '@/types/projectV2'
import type { Circuit } from '@/types/schema'
import { emptyBranchTarget, forkAfterEndpointTarget, riserCircuitRowTarget } from './forkRiserSemanticTarget'

const id = z.string().min(1)

/** Stable, project-owned identities for callers that don't have canvas hit-zone metadata. */
export const electricalSemanticDestinationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('endpoint'), endpointId: id }),
  z.strictObject({
    kind: z.literal('circuit'),
    circuitId: id,
    afterEndpointId: id.optional(),
  }),
  z.strictObject({
    kind: z.literal('branch'),
    circuitId: id,
    branchId: id,
    afterEndpointId: id.optional(),
  }),
  /** A new branch (leg) starting after this endpoint; only where something already follows it in its run. */
  z.strictObject({ kind: z.literal('fork'), afterEndpointId: id }),
  z.strictObject({
    kind: z.literal('panelBus'),
    panelId: id,
    afterProtectionId: id.optional(),
    afterCircuitId: id.optional(),
  }),
  z.strictObject({ kind: z.literal('protection'), protectionId: id }),
  /** Behind an RCD: appended to its bus, or after one circuit already behind it. */
  z.strictObject({ kind: z.literal('rcd'), protectionId: id, afterCircuitId: id.optional() }),
  /** After a kWh meter wired directly to the busbar: only protections may follow it. */
  z.strictObject({ kind: z.literal('meter'), trunkDeviceId: id, afterCircuitId: id.optional() }),
  z.strictObject({
    kind: z.literal('supply'),
    panelId: id,
    scope: z.enum(['shared', 'root']),
    afterDeviceId: id.optional(),
  }),
  z.strictObject({ kind: z.literal('ground'), panelId: id, afterDeviceId: id.optional() }),
  /**
   * A branch hanging off a supply DC bus (`busDeviceId` is the dc_bus supply device). Without
   * `afterDeviceId` it starts a new branch after the last one; with it the symbol goes right after
   * that device inside the same branch, so a device placed after a fuse sits above that fuse.
   */
  z.strictObject({ kind: z.literal('dcBusBranch'), busDeviceId: id, afterDeviceId: id.optional() }),
  /**
   * One DC output of a widened converter: a DC-DC MPPT on a DC-bus branch, or an inverter or
   * converter in a circuit. Output `connectionIndex` is 0-based. Without `afterDeviceId` the symbol
   * is appended to that output's string; with it, right after that device of the same string. On a
   * circuit converter, protections and strips come before the output's endpoints.
   */
  z.strictObject({
    kind: z.literal('converterOutput'),
    converterId: id,
    connectionIndex: z.number().int().nonnegative(),
    afterDeviceId: id.optional(),
  }),
]).superRefine((destination, context) => {
  if (
    destination.kind === 'panelBus' &&
    destination.afterProtectionId &&
    destination.afterCircuitId
  )
    context.addIssue({ code: 'custom', message: 'Choose one main-bus anchor.' })
})

export type ElectricalSemanticDestination = z.output<typeof electricalSemanticDestinationSchema>

export type SemanticTargetResult =
  | { ok: true; target: DropTarget }
  | { ok: false; code: string; message: string }

const invalid = (code: string, message: string): SemanticTargetResult => ({ ok: false, code, message })

/** A slot on a carrier circuit's secondary bus: appended, or after one circuit already on it. */
function secondaryBusSlot(panelId: string, protectionId: string, carrier: Circuit, afterCircuitId: string | undefined,
  anchor: [code: string, message: string]): SemanticTargetResult {
  const behind = carrier.subCircuitIds ?? []
  const after = afterCircuitId ? behind.indexOf(afterCircuitId) : behind.length - 1
  if (afterCircuitId && after < 0) return invalid(...anchor)
  return { ok: true, target: { type: 'circuit', panelId, circuitId: carrier.id, protectionId,
    secondaryBusInsertIndex: after + 1, secondaryBusItemCount: behind.length } }
}

function insertionAfterId<T extends { id: string }>(items: readonly T[], anchorId?: string): number | null {
  if (!anchorId) return items.length
  const index = items.findIndex((item) => item.id === anchorId)
  return index < 0 ? null : index + 1
}

function supplyDevicesForTarget(project: ProjectV2, panelId: string, scope: 'shared' | 'root') {
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return null
  if (scope === 'shared')
    return installation.mainSupply.supplyTrunkDevices ?? installation.feedTopology?.sharedFeed.trunkDevices ?? []
  return installation.feedTopology?.rootFeeds.find((feed) => feed.panelId === panelId)?.trunkDevices ?? null
}

function findRootFeedOf(project: ProjectV2, deviceId: string) {
  const feeds = getProjectElectricalInstallation(project)?.feedTopology?.rootFeeds ?? []
  for (const feed of feeds) {
    const devices = feed.trunkDevices ?? []
    if (devices.some((device) => device.id === deviceId)) return { feed, devices }
  }
  return null
}

/** The DC-bus branch and MPPT-output positions of a root supply feed, as the editor drops them. */
function resolveDcSupplyDestination(
  project: ProjectV2,
  destination: Extract<ElectricalSemanticDestination, { kind: 'dcBusBranch' | 'converterOutput' }>
): SemanticTargetResult {
  const ownerId = destination.kind === 'dcBusBranch' ? destination.busDeviceId : destination.converterId
  const found = findRootFeedOf(project, ownerId)
  if (!found)
    return invalid(
      destination.kind === 'dcBusBranch' ? 'dc_bus_not_found' : 'converter_not_found',
      destination.kind === 'dcBusBranch'
        ? 'DC bus not found in a supply feed'
        : 'Converter not found in a supply feed'
    )
  const { feed, devices } = found
  const owner = devices.find((device) => device.id === ownerId)!
  const base = {
    type: 'supplyConverterDcWire' as const,
    panelId: feed.panelId,
    supplyFeedScope: 'root' as const,
    ...(feed.busSectionId ? { busSectionId: feed.busSectionId } : {}),
  }
  const afterIndex = (anchorId: string | undefined, members: readonly { id: string }[], code: string, message: string) => {
    if (!anchorId) return { ok: true as const, index: undefined }
    const member = members.find((device) => device.id === anchorId)
    if (!member) return { ok: false as const, result: invalid(code, message) }
    return { ok: true as const, index: devices.findIndex((device) => device.id === anchorId) + 1 }
  }

  if (destination.kind === 'dcBusBranch') {
    if (owner.type !== 'dc_bus' && owner.symbol !== 'dc_bus')
      return invalid('not_a_dc_bus', 'That supply device is not a DC bus')
    const lane = {
      supplyConverterDcBranch: owner.supplyPath === 'converter-dc-top' ? ('top' as const) : ('right' as const),
      supplyConverterDcConnectionIndex: getSupplyConverterDcConnectionIndex(owner) ?? 0,
      supplyDcBusId: owner.id,
    }
    const onBus = devices.filter((device) => device.supplyDcBusId === owner.id && !device.converterDcConnection)
    if (!destination.afterDeviceId) {
      // After everything already hanging off this bus, so a new branch never splits an older one.
      const last = devices.reduce((max, device, index) => (device.supplyDcBusId === owner.id ? Math.max(max, index) : max), devices.indexOf(owner))
      return { ok: true, target: { ...base, ...lane, supplyDeviceInsertIndex: last + 1 } }
    }
    const anchor = onBus.find((device) => device.id === destination.afterDeviceId)
    if (!anchor)
      return invalid('dc_branch_anchor_not_found', 'That device is not in a branch of this DC bus (devices on a converter output are addressed with converterOutput)')
    if (!anchor.supplyDcBusBranchId)
      return invalid('dc_branch_unidentified', 'That branch has no stored identity; place on the bus to start a new branch')
    const at = afterIndex(anchor.id, onBus, 'dc_branch_anchor_not_found', 'That device is not in a branch of this DC bus')
    if (!at.ok) return at.result
    return {
      ok: true,
      target: { ...base, ...lane, supplyDcBusBranchId: anchor.supplyDcBusBranchId, supplyDeviceInsertIndex: at.index },
    }
  }

  if (!supportsCircuitConverterDcConnections(owner))
    return invalid('not_a_converter', 'That supply device has no DC outputs')
  const count = getCircuitConverterDcConnectionCount(owner)
  if (destination.connectionIndex >= count)
    return invalid('converter_connection_not_found', `That converter has ${count} DC output(s); widen it first with properties_resize_converter`)
  if (!owner.supplyDcBusId || !owner.supplyDcBusBranchId)
    return invalid('converter_not_on_dc_bus', 'Only a converter on a DC-bus branch has strings on its outputs')
  const string = devices.filter(
    (device) =>
      device.converterDcConnection?.converterId === owner.id &&
      device.converterDcConnection.connectionIndex === destination.connectionIndex
  )
  const at = afterIndex(destination.afterDeviceId, string, 'output_anchor_not_found', 'That device is not on this converter output')
  if (!at.ok) return at.result
  // Appended to the string, or right after the converter while the output is still empty.
  const insertIndex =
    at.index ?? Math.max(devices.indexOf(owner), ...string.map((device) => devices.indexOf(device))) + 1
  return {
    ok: true,
    target: {
      ...base,
      supplyConverterDcBranch: owner.supplyPath === 'converter-dc-top' ? 'top' : 'right',
      supplyConverterDcConnectionIndex: getSupplyConverterDcConnectionIndex(owner) ?? 0,
      supplyDcBusId: owner.supplyDcBusId,
      supplyDcBusBranchId: owner.supplyDcBusBranchId,
      converterDcConnection: { converterId: owner.id, connectionIndex: destination.connectionIndex },
      supplyDeviceInsertIndex: insertIndex,
    },
  }
}

/**
 * One output of a widened converter in a circuit, as the editor drops on it: its circuit devices
 * (protections, strips) come first, then its endpoints. A device symbol lands after `afterDeviceId`
 * when that is one of the output's devices, otherwise after its last device; an endpoint symbol
 * lands after `afterDeviceId` when that is one of its endpoints, otherwise after its last one.
 * Undefined when no circuit holds the converter.
 */
function resolveCircuitConverterOutput(
  project: ProjectV2,
  destination: Extract<ElectricalSemanticDestination, { kind: 'converterOutput' }>
): SemanticTargetResult | undefined {
  for (const panel of walkPanels(getProjectElectricalPanels(project))) {
    for (const circuit of [...panel.circuits, ...panel.protections.flatMap((entry) => entry.circuits ?? [])]) {
      const converter = circuit.trunkDevices?.find((device) => device.id === destination.converterId)
      if (!converter) continue
      if (!supportsCircuitConverterDcConnections(converter))
        return invalid('not_a_converter', 'That circuit device has no DC outputs')
      const count = getCircuitConverterDcConnectionCount(converter)
      if (destination.connectionIndex >= count)
        return invalid('converter_connection_not_found', `That converter has ${count} DC output(s); widen it first with properties_resize_converter`)
      const connection = { converterId: converter.id, connectionIndex: destination.connectionIndex }
      const devices = getConverterOutputDevices(circuit.trunkDevices ?? [], connection).filter(
        (device) => device.type !== 'dc_bus'
      )
      const endpoints = circuit.endpoints.filter(
        (endpoint) =>
          endpoint.converterDcConnection?.converterId === converter.id &&
          endpoint.converterDcConnection.connectionIndex === destination.connectionIndex
      )
      const anchor = destination.afterDeviceId
      if (anchor && !devices.some((device) => device.id === anchor) && !endpoints.some((endpoint) => endpoint.id === anchor))
        return invalid('output_anchor_not_found', 'That device is not on this converter output')
      const deviceAnchor = devices.findIndex((device) => device.id === anchor)
      return {
        ok: true,
        target: {
          type: 'circuit',
          panelId: panel.id,
          circuitId: circuit.id,
          converterDcConnection: connection,
          branchId: `converter-dc-output-${converter.id}-${destination.connectionIndex}`,
          branchEndpoints: endpoints.map((endpoint) => endpoint.id),
          ...(endpoints.length > 0
            ? { insertAfterEndpointId: endpoints.some((endpoint) => endpoint.id === anchor) ? anchor : endpoints.at(-1)!.id }
            : {}),
          branchDeviceInsertIndex: deviceAnchor >= 0 ? deviceAnchor + 1 : devices.length,
        },
      }
    }
  }
  return undefined
}

/** Resolves semantic ids to the legacy canvas target without mutating or normalizing the project. */
export function resolveElectricalSemanticTarget(
  project: ProjectV2,
  destination: ElectricalSemanticDestination
): SemanticTargetResult {
  const panels = getProjectElectricalPanels(project)
  if (destination.kind === 'endpoint') {
    for (const panel of walkPanels(panels)) {
      const circuits = [...panel.circuits, ...panel.protections.flatMap((entry) => entry.circuits ?? [])]
      for (const circuit of circuits) {
        if (!circuit.endpoints.some((endpoint) => endpoint.id === destination.endpointId)) continue
        const branches = getStandardCircuitBranches(circuit)
        const index = branches.findIndex((branch) => branch.some((endpoint) => endpoint.id === destination.endpointId))
        if (index < 0) return invalid('branch_not_found', 'Endpoint has no ordinary branch destination')
        return {
          ok: true,
          target: {
            type: 'endpoint',
            panelId: panel.id,
            circuitId: circuit.id,
            endpointId: destination.endpointId,
            branchEndpoints: branches[index]!.map((endpoint) => endpoint.id),
            insertAfterEndpointId: destination.endpointId,
          },
        }
      }
    }
    return invalid('endpoint_not_found', 'Endpoint not found')
  }
  if (destination.kind === 'fork') {
    for (const panel of walkPanels(panels)) {
      for (const circuit of [...panel.circuits, ...panel.protections.flatMap((entry) => entry.circuits ?? [])]) {
        if (circuit.endpoints.some((endpoint) => endpoint.id === destination.afterEndpointId))
          return forkAfterEndpointTarget(panel.id, circuit, destination.afterEndpointId)
      }
    }
    return invalid('endpoint_not_found', 'Endpoint not found')
  }
  if (destination.kind === 'circuit' || destination.kind === 'branch') {
    const owner = findCircuitOwner(panels, destination.circuitId)
    if (!owner) return invalid('circuit_not_found', 'Circuit not found')
    if (destination.kind === 'circuit') {
      if (
        destination.afterEndpointId &&
        !owner.circuit.endpoints.some((endpoint) => endpoint.id === destination.afterEndpointId)
      )
        return invalid('endpoint_not_found', 'Insertion endpoint does not belong to the circuit')
      const riserRow = riserCircuitRowTarget(owner.panel.id, owner.circuit, destination.afterEndpointId)
      if (riserRow) return { ok: true, target: riserRow }
      return {
        ok: true,
        target: {
          type: 'circuit',
          panelId: owner.panel.id,
          circuitId: owner.circuit.id,
          ...(destination.afterEndpointId ? { insertAfterEndpointId: destination.afterEndpointId } : {}),
        },
      }
    }

    const stored = owner.circuit.branches?.find((branch) => branch.id === destination.branchId)
    const emptyTarget = stored && emptyBranchTarget(owner.panel.id, owner.circuit, stored)
    if (emptyTarget) {
      return destination.afterEndpointId
        ? invalid('wrong_branch', 'Insertion endpoint does not belong to the selected branch')
        : { ok: true, target: emptyTarget }
    }
    const syntheticPrefix = `branch-${owner.circuit.id}-`
    const syntheticSuffix = destination.branchId.startsWith(syntheticPrefix)
      ? destination.branchId.slice(syntheticPrefix.length)
      : ''
    const syntheticIndex = /^\d+$/.test(syntheticSuffix) ? Number(syntheticSuffix) : -1
    const standard = getStandardCircuitBranches(owner.circuit)
    const endpointIds = stored?.endpointIds ?? standard[syntheticIndex]?.map((endpoint) => endpoint.id)
    const isEmptyBranch =
      destination.branchId === `${syntheticPrefix}empty` &&
      !standard.flat().some((endpoint) => endpoint.symbol !== 'panel_distribution')
    if (!endpointIds && !isEmptyBranch)
      return invalid('branch_not_found', 'Branch does not belong to the circuit')
    const branchIds = endpointIds ?? []
    const branchMembers = new Set(branchIds)
    let previousSize = -1
    while (previousSize !== branchMembers.size) {
      previousSize = branchMembers.size
      for (const endpoint of owner.circuit.endpoints) {
        if (
          endpoint.domoticaChildProps &&
          branchMembers.has(endpoint.domoticaChildProps.parentEndpointId)
        )
          branchMembers.add(endpoint.id)
      }
    }
    if (destination.afterEndpointId && !branchMembers.has(destination.afterEndpointId))
      return invalid('wrong_branch', 'Insertion endpoint does not belong to the selected branch')
    return {
      ok: true,
      target: {
        type: 'circuit',
        panelId: owner.panel.id,
        circuitId: owner.circuit.id,
        branchId: destination.branchId,
        branchEndpoints: branchIds,
        insertAfterEndpointId: destination.afterEndpointId ?? null,
      },
    }
  }

  if (destination.kind === 'panelBus') {
    const panel = findPanelById(panels, destination.panelId)
    if (!panel) return invalid('panel_not_found', 'Panel not found')
    if (destination.afterProtectionId && destination.afterCircuitId)
      return invalid('ambiguous_bus_anchor', 'Choose one main-bus anchor')
    const anchorId = destination.afterProtectionId ?? destination.afterCircuitId
    const anchorType = destination.afterProtectionId ? 'protection' : 'circuit'
    const order = getMainBusOrder(panel)
    const anchorIndex = anchorId
      ? order.findIndex((item) => item.type === anchorType && item.id === anchorId)
      : -1
    if (anchorId && anchorIndex < 0)
      return invalid('bus_anchor_not_found', 'Main-bus anchor does not belong to this panel')
    const index = anchorId ? anchorIndex + 1 : 0
    return { ok: true, target: { type: 'mainBus', panelId: panel.id, mainBusInsertIndex: index } }
  }

  if (destination.kind === 'protection') {
    const owner = [...walkPanels(panels)].find((panel) =>
      panel.protections.some((item) => item.id === destination.protectionId)
    )
    if (!owner) return invalid('protection_not_found', 'Protection not found')
    return {
      ok: true,
      target: { type: 'protection', panelId: owner.id, protectionId: destination.protectionId },
    }
  }

  if (destination.kind === 'rcd') {
    const owner = [...walkPanels(panels)].find((panel) =>
      panel.protections.some((item) => item.id === destination.protectionId)
    )
    const rcd = owner?.protections.find((item) => item.id === destination.protectionId)
    if (!owner || !rcd) return invalid('protection_not_found', 'Protection not found')
    if (rcd.type !== 'RCD' && rcd.type !== 'RCBO')
      return invalid('not_an_rcd', 'Only an RCD or RCBO has circuits behind it')
    // The circuits behind an RCD hang off its carrier circuit's secondary bus.
    const carrier = rcd.circuits?.[0]
    if (!carrier) return invalid('rcd_carrier_missing', 'This RCD has no bus to place circuits on')
    return secondaryBusSlot(owner.id, rcd.id, carrier, destination.afterCircuitId,
      ['rcd_anchor_not_found', 'That circuit is not behind this RCD'])
  }

  if (destination.kind === 'meter') {
    for (const panel of walkPanels(panels)) {
      for (const owner of panel.protections) {
        const circuit = owner.circuits?.find((candidate) =>
          candidate.trunkDevices?.some((device) => device.id === destination.trunkDeviceId))
        if (!circuit) continue
        if (!owner.directTrunkFeeder)
          return invalid('meter_not_on_busbar', 'This meter has a protection in front of it; place loads on its circuit')
        return secondaryBusSlot(panel.id, owner.id, circuit, destination.afterCircuitId,
          ['meter_anchor_not_found', 'That circuit does not follow this meter'])
      }
    }
    return invalid('meter_not_found', 'kWh meter not found')
  }

  if (destination.kind === 'supply') {
    const panel = findPanelById(panels, destination.panelId)
    if (!panel) return invalid('panel_not_found', 'Panel not found')
    const devices = supplyDevicesForTarget(project, panel.id, destination.scope)
    if (!devices) return invalid('supply_scope_not_found', 'Supply feed does not belong to this panel')
    const insertIndex = insertionAfterId(devices, destination.afterDeviceId)
    if (insertIndex == null) return invalid('supply_anchor_not_found', 'Supply device does not belong to this feed')
    return {
      ok: true,
      target: {
        type: 'supplyWire',
        panelId: panel.id,
        supplyFeedScope: destination.scope,
        supplyDeviceInsertIndex: insertIndex,
      },
    }
  }

  if (destination.kind === 'converterOutput' && !findRootFeedOf(project, destination.converterId)) {
    const circuitOutput = resolveCircuitConverterOutput(project, destination)
    if (circuitOutput) return circuitOutput
  }
  if (destination.kind === 'dcBusBranch' || destination.kind === 'converterOutput')
    return resolveDcSupplyDestination(project, destination)

  const panel = findPanelById(panels, destination.panelId)
  if (!panel) return invalid('panel_not_found', 'Panel not found')
  const installation = getProjectElectricalInstallation(project)
  const devices = getPanelGroundTrunkDevices(panel, installation)
  const insertIndex = insertionAfterId(devices, destination.afterDeviceId)
  if (insertIndex == null) return invalid('ground_anchor_not_found', 'Ground device does not belong to this panel')
  return {
    ok: true,
    target: { type: 'groundWire', panelId: panel.id, groundDeviceInsertIndex: insertIndex },
  }
}
