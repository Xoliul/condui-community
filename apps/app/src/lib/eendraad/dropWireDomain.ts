import { hasOneWireRisers } from '@/lib/eendraad/oneWireRisers'
import { getCircuitBranches } from '@/lib/layout/endpointChains'
import { getPortDomainsForSymbol, resolveSymbolPortsForWire } from '@/lib/symbols'
import { DEFAULT_ELECTRICAL_DOMAIN } from '@/types/schema'
import { getDomoticaEndpointInputDomain } from '@/lib/eendraad/domoticaOutputOrdering'
import type { SymbolMetadata } from '@/lib/symbols'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import type {
  Endpoint,
  ProtectionDevice,
  Circuit,
  TrunkDevice,
} from '@/types/schema'
import type { TFunction } from 'i18next'
import { getSupplyFeedDevicesForPanel } from '@/lib/feedTopology'
import { findPanelById } from '@/lib/panel/panelTree'
import { isStructuralCarrierProtection } from '@/lib/eendraad/structuralCarrier'
import {
  type DropBehaviorProject,
  type DropBehaviorCallbacks,
  projectPanels,
  projectInstallation,
  findProtectionInProject,
} from './dropBehaviorModel'

export function getOrderedTrunkDevices(circuit: Circuit): TrunkDevice[] {
  // Stable sort by trunkPosition; for equal positions keep array order.
  return [...(circuit.trunkDevices ?? [])].sort(
    (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
  )
}

/**
 * The one safe place where a DC source may create its own AC/DC converter:
 * directly on a protection whose sole circuit is still completely empty.
 * Intermediate circuit-wire drops must never infer this topology.
 */
export function isEmptyProtectionCircuitForDcDrop(protection: ProtectionDevice): boolean {
  if (
    protection.subPanelId ||
    isStructuralCarrierProtection(protection) ||
    protection.circuits?.length !== 1
  ) {
    return false
  }

  const circuit = protection.circuits?.[0]
  if (!circuit) return false
  return (
    !circuit.dcBusSource &&
    !circuit.supplySource &&
    circuit.endpoints.length === 0 &&
    (circuit.branches?.length ?? 0) === 0 &&
    (circuit.trunkDevices?.length ?? 0) === 0 &&
    (circuit.subCircuitIds?.length ?? 0) === 0
  )
}

export function getSupplyDevicesForDropTarget(
  target: DropTarget,
  project: DropBehaviorProject
): TrunkDevice[] {
  const panels = projectPanels(project)
  const installation = projectInstallation(project)
  const targetPanel = target.panelId ? findPanelById(panels, target.panelId) : null
  const panelSupplyCircuit = targetPanel?.circuits?.find((c) => c.code === 'PANEL')
  const panelSupply = [...(panelSupplyCircuit?.trunkDevices ?? [])].sort(
    (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
  )
  if (panelSupply.length > 0 || (targetPanel && !targetPanel.isMain)) {
    return panelSupply
  }
  if (targetPanel?.isMain && target.panelId) {
    if (!installation) return []
    return getSupplyFeedDevicesForPanel(
      installation,
      panels,
      target.panelId,
      target.supplyFeedScope ?? 'shared'
    )
  }
  return installation?.mainSupply?.supplyTrunkDevices ?? []
}

export function getCircuitTrunkPositionForDrop(target: DropTarget, circuit: Circuit): number {
  // A circuit with risers keeps every trunk device on the shared part under the split.
  if (hasOneWireRisers(circuit)) return 0
  if (target.insertAfterCircuitContent) {
    return Math.max(
      getCircuitBranches(circuit).length,
      ...(circuit.trunkDevices ?? []).map((device) => device.trunkPosition ?? 0)
    )
  }
  // Per-segment drop target on vertical trunk wire takes priority.
  if (typeof target.circuitTrunkSegmentIndex === 'number') {
    const ordered = getOrderedTrunkDevices(circuit)
    const segmentIndex = target.circuitTrunkSegmentIndex
    if (segmentIndex <= 0 || ordered.length === 0) return 0
    const prevDevice = ordered[Math.min(segmentIndex - 1, ordered.length - 1)]
    return prevDevice?.trunkPosition ?? 0
  }

  // Fallback legacy behavior: infer by nearest branch endpoint.
  if (target.insertAfterEndpointId) {
    const branches = getCircuitBranches(circuit)
    for (let i = 0; i < branches.length; i++) {
      const branch = branches[i]
      if (branch?.some((ep) => ep.id === target.insertAfterEndpointId)) {
        return i + 1
      }
    }
  }
  return 0
}

/** Get the wire domain at a drop target. Used to validate conversion component placement. */
export function getWireDomainAtDropTarget(
  target: DropTarget,
  project: DropBehaviorProject,
  callbacks: Pick<DropBehaviorCallbacks, 'getCircuitById'>
): typeof DEFAULT_ELECTRICAL_DOMAIN {
  if (target.wireDomain) {
    return target.wireDomain as typeof DEFAULT_ELECTRICAL_DOMAIN
  }
  const AC = 'AC' as const

  if (target.type === 'supplyWire') {
    const supply = getSupplyDevicesForDropTarget(target, project)
    const insertIndex = target.supplyDeviceInsertIndex ?? 0
    if (insertIndex === 0) return AC // Mains is AC
    let domain: typeof DEFAULT_ELECTRICAL_DOMAIN = AC
    for (let i = 0; i < insertIndex; i++) {
      const prevDevice = supply[i]
      if (!prevDevice) continue
      const resolved = resolveSymbolPortsForWire(prevDevice.symbol, domain)
      if (resolved.matched && resolved.oppositePortDomain) {
        domain = resolved.oppositePortDomain
      }
    }
    return domain
  }

  // The right/top lanes leaving a supply converter are explicit DC branches.
  // They are not represented by the ordinary supply-wire trunk, so there is no
  // serial device list to infer the domain from at the drop point.
  if (target.type === 'supplyConverterDcWire') return 'DC'

  if (target.type === 'protection' && target.protectionId) {
    const protection = findProtectionInProject(projectPanels(project), target.protectionId)
    const circuitId = protection?.circuits?.[0]?.id
    if (circuitId) {
      const circuit = callbacks.getCircuitById(circuitId)
      if (circuit?.trunkDevices?.length) {
        const sorted = [...circuit.trunkDevices].sort(
          (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
        )
        let domain: typeof DEFAULT_ELECTRICAL_DOMAIN = AC
        for (const td of sorted) {
          const resolved = resolveSymbolPortsForWire(td.symbol, domain)
          if (resolved.matched && resolved.oppositePortDomain) {
            domain = resolved.oppositePortDomain
          }
        }
        return domain
      }
    }
    return AC // MCB output or empty circuit
  }
  if (target.type === 'mainBus' || target.type === 'rcd') return AC

  if (target.type === 'circuit' && target.circuitId && !target.branchEndpoints?.length) {
    const circuit = callbacks.getCircuitById(target.circuitId)
    if (!circuit) return AC
    const trunkDevices = getOrderedTrunkDevices(circuit)

    // Segment-aware domain check for per-segment vertical trunk hitboxes.
    if (typeof target.circuitTrunkSegmentIndex === 'number' && !target.insertAfterCircuitContent) {
      const segmentIndex = target.circuitTrunkSegmentIndex
      if (segmentIndex <= 0 || trunkDevices.length === 0) return AC
      let domain: typeof DEFAULT_ELECTRICAL_DOMAIN = AC
      const endExclusive = Math.min(segmentIndex, trunkDevices.length)
      for (let i = 0; i < endExclusive; i++) {
        const prevDevice = trunkDevices[i]
        if (!prevDevice) continue
        const resolved = resolveSymbolPortsForWire(prevDevice.symbol, domain)
        if (resolved.matched && resolved.oppositePortDomain) {
          domain = resolved.oppositePortDomain
        }
      }
      return domain
    }

    const trunkPosition = getCircuitTrunkPositionForDrop(target, circuit)
    if (trunkPosition === 0 && !target.insertAfterCircuitContent) return AC // MCB output is AC
    const prevDevices = target.insertAfterCircuitContent
      ? trunkDevices
      : trunkDevices.filter((d) => (d.trunkPosition ?? 0) < trunkPosition)
    let domain: typeof DEFAULT_ELECTRICAL_DOMAIN = AC
    for (const prevDevice of prevDevices) {
      const resolved = resolveSymbolPortsForWire(prevDevice.symbol, domain)
      if (resolved.matched && resolved.oppositePortDomain) {
        domain = resolved.oppositePortDomain
      }
    }
    return domain
  }

  if (target.type === 'endpoint' || (target.type === 'circuit' && target.branchEndpoints?.length)) {
    const circuitId = target.circuitId
    if (!circuitId) return AC
    const circuit = callbacks.getCircuitById(circuitId)
    if (!circuit) return AC

    // Only devices below this branch tap feed its endpoints.
    const branchIndex = getCircuitBranches(circuit).findIndex((branch) =>
      branch.some(
        (endpoint) =>
          endpoint.id === target.endpointId || target.branchEndpoints?.includes(endpoint.id)
      )
    )
    const trunkDevices = (circuit.trunkDevices ?? []).filter(
      (device) => branchIndex < 0 || (device.trunkPosition ?? 0) <= branchIndex
    )
    const sorted = [...trunkDevices].sort((a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0))
    let domain: typeof DEFAULT_ELECTRICAL_DOMAIN = AC
    for (const td of sorted) {
      const resolved = resolveSymbolPortsForWire(td.symbol, domain)
      if (resolved.matched && resolved.oppositePortDomain) {
        domain = resolved.oppositePortDomain
      }
    }

    // If this drop is on a branch wire/endpoint, include upstream in-branch symbols
    // (e.g. rectifier placed on branch) up to the insertion point.
    const targetEndpoint = circuit.endpoints.find((endpoint) => endpoint.id === target.endpointId)
    if (targetEndpoint && (targetEndpoint.domoticaChildProps || target.domoticaOutput)) {
      const input = getDomoticaEndpointInputDomain(circuit, targetEndpoint.id, domain)
      if (target.domoticaOutput || target.domoticaChildDropIntent === 'insertBefore') return input
      if (!targetEndpoint.symbol) return input
      const resolved = resolveSymbolPortsForWire(targetEndpoint.symbol, input)
      return resolved.matched ? (resolved.oppositePortDomain ?? input) : input
    }
    const branchIds = target.branchEndpoints ?? []
    if (branchIds.length > 0) {
      let upstreamIds: string[] = []
      if (target.insertAfterEndpointId === null) {
        upstreamIds = []
      } else if (typeof target.insertAfterEndpointId === 'string') {
        const idx = branchIds.indexOf(target.insertAfterEndpointId)
        upstreamIds = idx >= 0 ? branchIds.slice(0, idx + 1) : []
      } else {
        // No explicit insertion cursor in branch: treat as append at end.
        upstreamIds = [...branchIds]
      }

      for (const endpointId of upstreamIds) {
        const endpoint = circuit.endpoints.find((ep: Endpoint) => ep.id === endpointId)
        if (!endpoint?.symbol) continue
        const resolved = resolveSymbolPortsForWire(endpoint.symbol, domain)
        if (resolved.matched && resolved.oppositePortDomain) {
          domain = resolved.oppositePortDomain
        }
      }
    }
    return domain
  }

  return AC
}

/** Returns true if the symbol is a conversion component that requires domain validation. */
export function isConversionSymbol(symbol: SymbolMetadata): boolean {
  return ['transformer', 'rectifier', 'inverter', 'dc_dc_converter'].includes(symbol.id)
}

/** Returns true if domain at drop target matches symbol's required input domain; calls onDropRejected if not. */
export function checkDomainForConversion(
  target: DropTarget,
  project: DropBehaviorProject,
  symbol: SymbolMetadata,
  t: TFunction,
  callbacks: DropBehaviorCallbacks
): boolean {
  if (!isConversionSymbol(symbol)) return true
  const requiredPorts = getPortDomainsForSymbol(symbol.id)
  const wireDomain = getWireDomainAtDropTarget(target, project, callbacks)
  const resolved = resolveSymbolPortsForWire(symbol.id, wireDomain)
  if (resolved.matched) return true
  const message = t('wires.domainMismatchDrop', {
    defaultValue:
      '{{component}} has no {{wireDomain}} compatible port (ports: {{portA}} / {{portB}}).',
    component: symbol.name,
    domain: requiredPorts[0],
    wireDomain,
    portA: requiredPorts[0],
    portB: requiredPorts[1],
  })
  callbacks.onDropRejected?.(message)
  return false
}
