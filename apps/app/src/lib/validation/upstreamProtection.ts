import type { Circuit, ProtectionDevice, TrunkDevice } from '@/types/schema'
import type { CheckContext } from './core/types'
import { getPanelBusSectionFeedProjection } from '@/lib/feedTopology'
import { getPrimaryPanelBusSectionId } from '@/lib/panel/panelBusSections'
import { resolvePanelSupplyLinkForPanelInPanels } from '@/lib/eendraad/panelSupplyLink'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { isPanelPlacementCarrierCircuit } from './core/primitives/common'
import { getCircuitBranches } from '@/lib/layout/endpointChains'
import { isDomoticaPanelFeedEndpoint } from '@/lib/eendraad/panelSupplyLink'
import { findVirtualPanelOwner, isVirtualPanel } from '@/lib/supplyTaps/virtualPanel'
import { findSupplyTapAnchorOfCircuit } from '@/lib/supplyTaps/upstreamTrunkDevices'
import { getSupplyTapUpstreamDevicesForOwner } from '@/lib/supplyTaps/tapFeedDevice'
import { isStructuralCarrierProtection } from '@/lib/eendraad/structuralCarrier'

export type UpstreamProtection = {
  id: string
  type: ProtectionDevice['type']
  residualCurrentType?: ProtectionDevice['residualCurrentType']
  sensitivityMa?: number
  ratingA?: number
  offenderKind: 'protection' | 'device'
  supply?: boolean
}

/** One topology index per validation run, including container circuits and board feeders. */
const indexes = new WeakMap<object, Map<string, UpstreamProtection[]>>()
const finalCircuitIndexes = new WeakMap<object, Map<string, Circuit[]>>()
type GroupingQualification = 'downstream' | 'origin' | 'unknown'
const groupingQualifications = new WeakMap<object, Map<string, GroupingQualification>>()

export function circuitUpstreamProtections(
  context: CheckContext,
  circuitId: string
): UpstreamProtection[] {
  let index = indexes.get(context.query)
  if (!index) {
    const { query, project } = context
    const panels = getProjectElectricalPanels(project)
    const installation = getProjectElectricalInstallation(project)
    const circuits = new Map(query.getCircuits().map((circuit) => [circuit.id, circuit]))
    const parents = new Map<string, string[]>()
    const directProtections = new Map<string, ProtectionDevice[]>()
    const owner = new Map<string, ReturnType<typeof query.getPanelById>>()
    for (const panel of query.getBoards()) {
      for (const circuit of query.getCircuits(panel.id)) owner.set(circuit.id, panel)
      for (const protection of panel.protections) {
        for (const circuit of protection.circuits ?? []) {
          directProtections.set(circuit.id, [
            ...(directProtections.get(circuit.id) ?? []),
            protection,
          ])
        }
      }
    }
    for (const circuit of circuits.values()) {
      for (const child of circuit.subCircuitIds ?? []) {
        parents.set(child, [...(parents.get(child) ?? []), circuit.id])
      }
    }
    index = new Map()
    for (const circuit of circuits.values()) {
      const devices = new Map<string, UpstreamProtection>()
      const visited = new Set<string>()
      const addTrunk = (device: TrunkDevice, supply = false) => {
        if (device.type !== 'protection' || !device.protectionType) return
        devices.set(device.id, {
          ...device,
          type: device.protectionType,
          offenderKind: 'device',
          supply,
        })
      }
      const visit = (id: string, isContainer = false, lastUpstreamBranch = 0) => {
        if (visited.has(id)) return
        visited.add(id)
        const current = circuits.get(id)
        if (!current) return
        // A device below an earlier branch does not protect that entire final
        // circuit. Container child circuits leave after the parent trunk.
        // Stored order breaks same-position ties in the upstream-to-downstream
        // drawing. Reverse that entire order, including ties, for ancestry.
        for (const device of [...(current.trunkDevices ?? [])].sort(
          (a, b) => a.trunkPosition - b.trunkPosition
        ).reverse()) {
          if (isContainer || device.trunkPosition <= lastUpstreamBranch) addTrunk(device)
        }
        for (const device of directProtections.get(id) ?? []) {
          if (!isStructuralCarrierProtection(device)) {
            devices.set(device.id, { ...device, offenderKind: 'protection' })
          }
        }
        const parentIds = parents.get(id) ?? []
        for (const parent of parentIds) visit(parent, true)
        if (parentIds.length > 0) return
        const panel = owner.get(id)
        if (!panel) return
        if (isVirtualPanel(panel)) {
          // Supply taps leave the owner's grid-side supply wire: the owner's trunk devices from
          // the grid source up to the anchor protect them. Nothing downstream of the anchor does.
          const tapOwner = findVirtualPanelOwner(panels, panel.id)
          const anchor = findSupplyTapAnchorOfCircuit(panel, id)
          if (!tapOwner || !anchor || !installation) return
          const upstream = getSupplyTapUpstreamDevicesForOwner(installation, tapOwner.id, anchor)
          for (const device of [...upstream].reverse()) addTrunk(device, true)
          return
        }
        if (panel.isMain && installation) {
          const protection = query.getProtectionForCircuit(id)
          const section =
            protection?.busSectionId ?? current.busSectionId ?? getPrimaryPanelBusSectionId(panel)
          const projection = getPanelBusSectionFeedProjection(installation, panels, panel, section)
          for (const device of [...(projection?.devices ?? [])].reverse()) addTrunk(device, true)
        } else {
          const link = resolvePanelSupplyLinkForPanelInPanels(panels, panel.id)
          if (link?.feederCircuit) {
            let source = link.sourcePanelEndpoint
            let branchIndex = 0
            const ancestry = new Set<string>()
            if (isDomoticaPanelFeedEndpoint(source)) {
              while (source?.domoticaChildProps && !ancestry.has(source.id)) {
                ancestry.add(source.id)
                const parentId: string = source.domoticaChildProps.parentEndpointId
                source = link.feederCircuit.endpoints.find((endpoint) => endpoint.id === parentId)
              }
              branchIndex = Math.max(0, getCircuitBranches(link.feederCircuit)
                .findIndex((branch) => branch.some((endpoint) => endpoint.id === source?.id)))
            }
            visit(link.feederCircuit.id, false, branchIndex)
          }
        }
      }
      visit(circuit.id)
      index.set(circuit.id, [...devices.values()])
    }
    indexes.set(context.query, index)
  }
  return index.get(circuitId) ?? []
}

export function downstreamFinalCircuits(context: CheckContext, deviceId: string): Circuit[] {
  let index = finalCircuitIndexes.get(context.query)
  if (!index) {
    index = new Map()
    const qualifications = new Map<string, GroupingQualification>()
    const circuits = new Map(context.query.getCircuits().map((circuit) => [circuit.id, circuit]))
    for (const circuit of circuits.values()) {
      if (
        circuit.subCircuitIds?.length ||
        circuit.endpoints.length === 0 ||
        isPanelPlacementCarrierCircuit(context.query, circuit.id) ||
        context.query.getCircuitKind(circuit.id) === 'subpanel'
      )
        continue
      const path = circuitUpstreamProtections(context, circuit.id)
      for (const device of path) {
        const existing = index.get(device.id)
        if (existing) existing.push(circuit)
        else index.set(device.id, [circuit])
      }
      // Walk from origin toward the final circuit once. Every grouping lookup
      // then reuses this result rather than rescanning every path for every RCD.
      let hasRcdAbove = false
      let hasConfirmedMainAbove = false
      for (let position = path.length - 1; position >= 0; position -= 1) {
        const device = path[position]!
        if (device.type !== 'RCD' && device.type !== 'RCBO') continue
        const qualification: GroupingQualification = hasConfirmedMainAbove
          ? 'downstream'
          : !hasRcdAbove && device.supply
            ? 'origin'
            : 'unknown'
        const previous = qualifications.get(device.id)
        qualifications.set(
          device.id,
          previous === 'downstream' || qualification === 'downstream'
            ? 'downstream'
            : previous === 'unknown'
              ? 'unknown'
              : qualification
        )
        hasRcdAbove = true
        if (
          device.sensitivityMa != null &&
          device.sensitivityMa > 0 &&
          device.sensitivityMa <= 300
        ) {
          hasConfirmedMainAbove = true
        }
      }
    }
    finalCircuitIndexes.set(context.query, index)
    groupingQualifications.set(context.query, qualifications)
  }
  return index.get(deviceId) ?? []
}

/** FOD AREI FAQ pp. 7, 13: the eight-circuit limit is for the downstream RCD,
 * not the origin RCD itself, even if that origin device is rated 30 mA. */
export function rcdGroupingQualification(
  context: CheckContext,
  deviceId: string
): GroupingQualification {
  downstreamFinalCircuits(context, deviceId)
  return groupingQualifications.get(context.query)?.get(deviceId) ?? 'unknown'
}
