import type { Circuit, ElectricalDomain, Panel, TrunkDevice } from '@/types/schema'
import { resolveSymbolPortsForWire } from '@/lib/symbols'
import { getDomoticaEndpointInputDomain } from '@/lib/eendraad/domoticaOutputOrdering'
import {
  getCircuitConverterDcConnectionCount,
  getCircuitConverterPrimaryBranch,
  supportsCircuitConverterDcConnections,
} from '@/lib/layout/circuitConverterGeometry'

const CONVERTERS = new Set(['transformer', 'rectifier', 'inverter', 'dc_dc_converter'])

/** Matches the one-wire's implicit output-zero ownership for older circuits. */
export function circuitConverterEndpointConnections(circuit: Circuit): Map<string, {
  converterId: string
  connectionIndex: number
}> {
  const result = new Map(circuit.endpoints.flatMap((endpoint) =>
    endpoint.converterDcConnection
      ? [[endpoint.id, endpoint.converterDcConnection] as const]
      : []))
  for (const converter of [
    ...(circuit.trunkDevices ?? []),
    ...(circuit.branches ?? []).flatMap((branch) => branch.branchDevices ?? []),
  ]) {
    if (!supportsCircuitConverterDcConnections(converter)) continue
    const owningBranch = (circuit.branches ?? []).find((branch) =>
      branch.branchDevices?.some((device) => device.id === converter.id))
    if (getCircuitConverterDcConnectionCount(converter) <= 1 && !owningBranch) continue
    const primaryBranch = owningBranch ?? getCircuitConverterPrimaryBranch(circuit, converter)
    for (const id of primaryBranch?.endpointIds ?? [])
      if (!result.has(id)) result.set(id, { converterId: converter.id, connectionIndex: 0 })
  }
  return result
}

/** Explicit output references, plus the legacy single-rail convention. */
export function circuitConverterDeviceConnections(circuit: Circuit): Map<string, {
  converterId: string
  connectionIndex: number
}> {
  const devices = [
    ...(circuit.trunkDevices ?? []),
    ...(circuit.branches ?? []).flatMap((branch) => branch.branchDevices ?? []),
  ]
  const result = new Map(devices.flatMap((device) =>
    device.converterDcConnection
      ? [[device.id, device.converterDcConnection] as const]
      : []))
  const converters = (circuit.trunkDevices ?? []).filter(supportsCircuitConverterDcConnections)
  if (converters.length !== 1) return result
  const converter = converters[0]!
  const unlinkedBuses = (circuit.trunkDevices ?? []).filter((device) =>
    device.type === 'dc_bus' && !result.has(device.id) &&
    (circuit.branches ?? []).some((branch) => branch.dcBusId === device.id))
  if (unlinkedBuses.length !== 1 ||
    [...circuitConverterEndpointConnections(circuit).values()].some((connection) =>
      connection.converterId === converter.id && connection.connectionIndex === 0) ||
    [...result.values()].some((connection) =>
      connection.converterId === converter.id && connection.connectionIndex === 0)) return result
  result.set(unlinkedBuses[0]!.id, { converterId: converter.id, connectionIndex: 0 })
  return result
}

/** Persist the unambiguous legacy rail convention as an explicit device reference. */
export function materializeLegacyDcRailConnections(panels: Panel[]): boolean {
  let changed = false
  const visit = (panel: Panel): void => {
    for (const circuit of [
      ...(panel.circuits ?? []),
      ...panel.protections.flatMap((protection) => protection.circuits ?? []),
    ]) {
      const connections = circuitConverterDeviceConnections(circuit)
      for (const device of circuit.trunkDevices ?? []) {
        if (device.type !== 'dc_bus' || device.converterDcConnection) continue
        const connection = connections.get(device.id)
        if (!connection) continue
        device.converterDcConnection = connection
        changed = true
      }
    }
    panel.subPanels?.forEach(visit)
  }
  panels.forEach(visit)
  return changed
}

export function domainAfterWireDevice(
  domain: ElectricalDomain,
  device: TrunkDevice
): ElectricalDomain {
  if (!device.symbol || !CONVERTERS.has(device.symbol)) return domain
  if (
    supportsCircuitConverterDcConnections(device) &&
    getCircuitConverterDcConnectionCount(device) > 1
  )
    return domain
  const ports = resolveSymbolPortsForWire(device.symbol, domain)
  return ports.matched ? (ports.oppositePortDomain ?? domain) : domain
}

/** Same incoming device identity for the migration, structure graph and one-wire geometry. */
export function circuitWireNodeKind(circuit: Circuit, id: string): 'trunk-device' | 'endpoint' {
  return [
    ...(circuit.trunkDevices ?? []),
    ...(circuit.branches ?? []).flatMap((b) => b.branchDevices ?? []),
  ].some((d) => d.id === id)
    ? 'trunk-device'
    : 'endpoint'
}

export function circuitWireDomains(panels: Panel[]): Map<string, ElectricalDomain> {
  const result = new Map<string, ElectricalDomain>()
  const visit = (panel: Panel) => {
    for (const circuit of [
      ...(panel.circuits ?? []),
      ...panel.protections.flatMap((p) => p.circuits ?? []),
    ]) {
      const converterEndpoints = circuitConverterEndpointConnections(circuit)
      const converterDevices = circuitConverterDeviceConnections(circuit)
      const orderedTrunks = [...(circuit.trunkDevices ?? [])].sort(
        (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0))
      let domain: ElectricalDomain = circuit.dcBusSource ? 'DC' : 'AC'
      // The stored array breaks equal-position ties, as it does in one-wire.
      for (const device of orderedTrunks) {
        result.set(`${circuit.id}:${device.id}`, converterDevices.has(device.id) ? 'DC' : domain)
        if (!converterDevices.has(device.id)) domain = domainAfterWireDevice(domain, device)
      }
      result.set(`${circuit.id}:secondary-bus:${circuit.id}`, domain)
      for (const endpoint of circuit.endpoints)
        result.set(`${circuit.id}:${endpoint.id}`, converterEndpoints.has(endpoint.id) ? 'DC' : domain)
      for (const [branchIndex, branch] of (circuit.branches ?? []).entries()) {
        let branchDomain: ElectricalDomain = circuit.dcBusSource ? 'DC' : 'AC'
        for (const device of orderedTrunks) {
          if ((device.trunkPosition ?? 0) <= branchIndex && !converterDevices.has(device.id)) {
            branchDomain = domainAfterWireDevice(branchDomain, device)
          }
        }
        if (branch.dcBusId) branchDomain = 'DC'
        for (const device of branch.branchDevices ?? []) {
          result.set(`${circuit.id}:${device.id}`, converterDevices.has(device.id) ? 'DC' : branchDomain)
          if (!converterDevices.has(device.id)) branchDomain = domainAfterWireDevice(branchDomain, device)
        }
        for (const id of branch.endpointIds) {
          result.set(`${circuit.id}:${id}`, converterEndpoints.has(id)
            ? 'DC'
            : getDomoticaEndpointInputDomain(circuit, id, branchDomain))
        }
      }
    }
    panel.subPanels?.forEach(visit)
  }
  panels.forEach(visit)
  return result
}
