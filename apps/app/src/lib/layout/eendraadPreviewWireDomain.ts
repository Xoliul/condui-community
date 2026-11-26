import type { Circuit } from '@/types/schema'
import { hasOneWireRisers } from '@/lib/eendraad/oneWireRisers'
import { DEFAULT_ELECTRICAL_DOMAIN } from '@/types/schema'
import type { DropTarget } from './findDropTarget'
import { getCircuitBranches } from './endpointChains'
import { resolveSymbolPortsForWire } from '@/lib/symbols'
import { getSupplyFeedDevicesForPanel } from '@/lib/feedTopology'
import { getDomoticaEndpointInputDomain } from '@/lib/eendraad/domoticaOutputOrdering'
import { findPanelById } from '@/lib/panel/panelTree'
import {
  findCircuitInProject,
  projectInstallation,
  projectPanels,
  type PreviewProject,
} from './eendraadPreviewModel'

/**
 * Compute trunk position similarly to existing getCircuitTrunkPositionForDrop, but purely on Circuit.
 */
export function getCircuitTrunkPositionForDropSim(target: DropTarget, circuit: Circuit): number {
  if (hasOneWireRisers(circuit)) return 0 // shared part under the split, as the commit
  if (target.insertAfterCircuitContent) {
    return Math.max(getCircuitBranches(circuit).length, ...(circuit.trunkDevices ?? []).map((device) => device.trunkPosition ?? 0))
  }
  const trunkDevices = [...(circuit.trunkDevices ?? [])].sort(
    (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
  )

  if (typeof target.circuitTrunkSegmentIndex === 'number') {
    const segmentIndex = target.circuitTrunkSegmentIndex
    if (segmentIndex <= 0 || trunkDevices.length === 0) return 0
    const prevDevice = trunkDevices[Math.min(segmentIndex - 1, trunkDevices.length - 1)]
    return prevDevice?.trunkPosition ?? 0
  }

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

/**
 * Determine the electrical domain on a circuit trunk based purely on the simulated project.
 */
export function getWireDomainAtDropTargetSim(
  target: DropTarget,
  project: PreviewProject
): typeof DEFAULT_ELECTRICAL_DOMAIN {
  if (target.wireDomain) {
    return target.wireDomain as typeof DEFAULT_ELECTRICAL_DOMAIN
  }
  const AC = 'AC' as const

  if (target.type === 'supplyWire') {
    const installation = projectInstallation(project)
    const targetPanel = target.panelId
      ? findPanelById(projectPanels(project), target.panelId)
      : null
    const panelSupplyCircuit = targetPanel?.circuits?.find((c) => c.code === 'PANEL')
    const panelSupply = [...(panelSupplyCircuit?.trunkDevices ?? [])].sort(
      (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
    )
    const supply =
      panelSupply.length > 0 || (targetPanel && !targetPanel.isMain)
        ? panelSupply
        : targetPanel?.isMain && target.panelId && installation
          ? getSupplyFeedDevicesForPanel(
              installation,
              projectPanels(project),
              target.panelId,
              target.supplyFeedScope ?? 'shared'
            )
          : (installation?.mainSupply?.supplyTrunkDevices ?? [])
    const insertIndex = target.supplyDeviceInsertIndex ?? 0
    if (insertIndex === 0) return AC
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

  // Direct-converter right/top insertion slots are explicit DC lanes; there
  // is no ordinary serial supply prefix to walk for domain inference here.
  if (target.type === 'supplyConverterDcWire') return 'DC'

  if (target.type === 'circuit' && target.circuitId && !target.branchEndpoints?.length) {
    const circuit = findCircuitInProject(project, target.circuitId)
    if (!circuit) return AC
    const trunkDevices = [...(circuit.trunkDevices ?? [])].sort(
      (a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0)
    )
    if (!trunkDevices.length) return AC

    if (typeof target.circuitTrunkSegmentIndex === 'number' && !target.insertAfterCircuitContent) {
      const segmentIndex = target.circuitTrunkSegmentIndex
      if (segmentIndex <= 0) return AC
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

    const trunkPosition = getCircuitTrunkPositionForDropSim(target, circuit)
    if (trunkPosition === 0 && !target.insertAfterCircuitContent) return AC
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
    const circuit = findCircuitInProject(project, circuitId)
    if (!circuit) return AC
    const branchIndex = getCircuitBranches(circuit).findIndex((branch) =>
      branch.some((endpoint) => endpoint.id === target.endpointId || target.branchEndpoints?.includes(endpoint.id)))
    const trunkDevices = (circuit.trunkDevices ?? []).filter((device) =>
      branchIndex < 0 || (device.trunkPosition ?? 0) <= branchIndex)
    const sorted = [...trunkDevices].sort((a, b) => (a.trunkPosition ?? 0) - (b.trunkPosition ?? 0))
    let domain: typeof DEFAULT_ELECTRICAL_DOMAIN = AC
    for (const td of sorted) {
      const resolved = resolveSymbolPortsForWire(td.symbol, domain)
      if (resolved.matched && resolved.oppositePortDomain) {
        domain = resolved.oppositePortDomain
      }
    }

    // Branch drops must account for upstream in-branch conversion symbols.
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
        upstreamIds = [...branchIds]
      }

      for (const endpointId of upstreamIds) {
        const endpoint = circuit.endpoints.find((ep) => ep.id === endpointId)
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
