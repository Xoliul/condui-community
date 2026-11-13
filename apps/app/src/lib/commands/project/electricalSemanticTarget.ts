import { z } from 'zod'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import { getStandardCircuitBranches } from '@/lib/layout/endpointChains'
import { findCircuitOwner } from '@/lib/eendraad/projectElectricalDomain'
import { getPanelGroundTrunkDevices } from '@/lib/eendraad/panelGround'
import { getMainBusOrder } from '@/lib/eendraad/mainBusOrder'
import { findPanelById, walkPanels } from '@/lib/panel/panelTree'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import type { ProjectV2 } from '@/types/projectV2'

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
  z.strictObject({
    kind: z.literal('panelBus'),
    panelId: id,
    afterProtectionId: id.optional(),
    afterCircuitId: id.optional(),
  }),
  z.strictObject({ kind: z.literal('protection'), protectionId: id }),
  /** Behind an RCD: appended to its bus, or after one circuit already behind it. */
  z.strictObject({ kind: z.literal('rcd'), protectionId: id, afterCircuitId: id.optional() }),
  z.strictObject({
    kind: z.literal('supply'),
    panelId: id,
    scope: z.enum(['shared', 'root']),
    afterDeviceId: id.optional(),
  }),
  z.strictObject({ kind: z.literal('ground'), panelId: id, afterDeviceId: id.optional() }),
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
  if (destination.kind === 'circuit' || destination.kind === 'branch') {
    const owner = findCircuitOwner(panels, destination.circuitId)
    if (!owner) return invalid('circuit_not_found', 'Circuit not found')
    if (destination.kind === 'circuit') {
      if (
        destination.afterEndpointId &&
        !owner.circuit.endpoints.some((endpoint) => endpoint.id === destination.afterEndpointId)
      )
        return invalid('endpoint_not_found', 'Insertion endpoint does not belong to the circuit')
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
    const behind = carrier.subCircuitIds ?? []
    const after = destination.afterCircuitId ? behind.indexOf(destination.afterCircuitId) : behind.length - 1
    if (destination.afterCircuitId && after < 0)
      return invalid('rcd_anchor_not_found', 'That circuit is not behind this RCD')
    return {
      ok: true,
      target: {
        type: 'circuit',
        panelId: owner.id,
        circuitId: carrier.id,
        protectionId: rcd.id,
        secondaryBusInsertIndex: after + 1,
        secondaryBusItemCount: behind.length,
      },
    }
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
