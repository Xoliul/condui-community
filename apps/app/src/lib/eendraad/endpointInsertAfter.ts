import { isHvacDeviceSymbol, type SymbolMetadata } from '@/lib/symbols'
import type { Circuit, Endpoint } from '@/types/schema'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import {
  isActualEndpoint,
  isActualEndpointSymbol,
  isFixedApplianceSymbol,
  isInBetweenDevice,
} from '@/utils/symbolMapping'

export function isDcOnlyEndpointSymbol(symbol: SymbolMetadata): boolean {
  return symbol.id === 'solar_panel' || symbol.id === 'battery'
}

export function isEnergyConversionEndpointSymbol(symbol: string | undefined): boolean {
  return (
    symbol === 'transformer' ||
    symbol === 'rectifier' ||
    symbol === 'inverter' ||
    symbol === 'dc_dc_converter'
  )
}

/**
 * Compute insert position for a new endpoint on a branch (shared by drop + preview).
 */
export function computeEndpointInsertAfter(
  target: DropTarget,
  circuit: Circuit,
  symbol: SymbolMetadata,
): { insertAfterEndpointId: string | null | undefined; createNewBranch: boolean } {
  const branchIds = target.branchEndpoints?.length ? target.branchEndpoints : null
  const inBetween = isInBetweenDevice(symbol)
  const actualEndpoint = isActualEndpointSymbol(symbol)

  if (target.domoticaOutput && target.endpointId) {
    const parent = circuit.endpoints.find((e) => e.id === target.endpointId)
    if (parent) {
      return { insertAfterEndpointId: target.endpointId, createNewBranch: false }
    }
  }

  if (target.domoticaChildDropIntent === 'insertBefore' && branchIds?.length) {
    return { insertAfterEndpointId: target.insertAfterEndpointId ?? null, createNewBranch: false }
  }

  if (inBetween) {
    if (!branchIds?.length) {
      return { insertAfterEndpointId: target.insertAfterEndpointId ?? undefined, createNewBranch: false }
    }

    let insertAfterId = target.insertAfterEndpointId

    if (typeof insertAfterId === 'string') {
      const insertIdx = branchIds.indexOf(insertAfterId)
      if (insertIdx >= 0) {
        const ep = circuit.endpoints.find((e) => e.id === insertAfterId)
        const isDomoticaAfterConversion = symbol.id === 'domotica' && isEnergyConversionEndpointSymbol(ep?.symbol)
        if (ep && isActualEndpoint(ep) && !isDomoticaAfterConversion) {
          insertAfterId = insertIdx > 0 ? branchIds[insertIdx - 1] : null
        }
      }
    }

    return { insertAfterEndpointId: insertAfterId, createNewBranch: false }
  }

  if (actualEndpoint) {
    if (branchIds?.length && typeof target.insertAfterEndpointId === 'string') {
      const insertAfterEp = circuit.endpoints.find((e) => e.id === target.insertAfterEndpointId)
      if (insertAfterEp?.domoticaChildProps) {
        return { insertAfterEndpointId: insertAfterEp.id, createNewBranch: false }
      }
    }

    const isFixedAppliance = isFixedApplianceSymbol(symbol)
    if (branchIds?.length && typeof target.insertAfterEndpointId === 'string') {
      const insertAfterEp = circuit.endpoints.find((e) => e.id === target.insertAfterEndpointId)
      const isFixedAfterSocket = isFixedAppliance && insertAfterEp?.type === 'socket'
      const isDcAfterConversion =
        isDcOnlyEndpointSymbol(symbol) && isEnergyConversionEndpointSymbol(insertAfterEp?.symbol)
      const isVentilationAfterHvacSource =
        symbol.id === 'ventilation' && insertAfterEp?.symbol === 'furnace'
      if (
        insertAfterEp &&
        (isFixedAfterSocket || isDcAfterConversion || isVentilationAfterHvacSource)
      ) {
        return { insertAfterEndpointId: insertAfterEp.id, createNewBranch: false }
      }
    }

    if (branchIds?.length) {
      const hasTerminalAlready = branchIds.some((id) => {
        const ep = circuit.endpoints.find((e) => e.id === id)
        return ep && (ep.type === 'socket' || ep.type === 'light_point')
      })
      if (hasTerminalAlready) {
        // Unchainable endpoint drop on an already terminal branch:
        // keep the cursor intent for ordering between branches.
        // - null means before the hovered branch (drop on lead-in wire)
        // - string/undefined means after the hovered branch
        if (target.insertAfterEndpointId === null) {
          return { insertAfterEndpointId: null, createNewBranch: true }
        }
        const lastId = branchIds[branchIds.length - 1]
        return { insertAfterEndpointId: lastId, createNewBranch: true }
      }
      const lastId = branchIds[branchIds.length - 1]
      return { insertAfterEndpointId: lastId, createNewBranch: false }
    }

    return { insertAfterEndpointId: target.insertAfterEndpointId, createNewBranch: false }
  }

  return { insertAfterEndpointId: target.insertAfterEndpointId, createNewBranch: false }
}

/** True when a solar/battery drop chains after a socket on the same branch (plug-in device). */
export function isPlugInAfterSocketDrop(
  target: DropTarget,
  circuit: Circuit,
  symbol: SymbolMetadata,
): boolean {
  if (!isDcOnlyEndpointSymbol(symbol)) return false
  if (!target.branchEndpoints?.length) return false
  const { insertAfterEndpointId } = computeEndpointInsertAfter(target, circuit, symbol)
  if (typeof insertAfterEndpointId !== 'string') return false
  const insertAfterEp = circuit.endpoints.find((e) => e.id === insertAfterEndpointId)
  return insertAfterEp?.type === 'socket'
}

/** True when endpoint sits immediately after a socket on its branch (plug-in battery/solar). */
export function isPlugInDcEndpointInCircuit(circuit: Circuit, endpoint: Endpoint): boolean {
  if (endpoint.symbol !== 'solar_panel' && endpoint.symbol !== 'battery') return false
  const branches = circuit.branches ?? []
  for (const branch of branches) {
    const idx = branch.endpointIds.indexOf(endpoint.id)
    if (idx <= 0) continue
    const prev = circuit.endpoints.find((e) => e.id === branch.endpointIds[idx - 1])
    return prev?.type === 'socket'
  }
  return false
}

/**
 * True when an HVAC device (ventilation, boiler, heating, or a downstream HVAC source) sits
 * immediately after an HVAC source (furnace/heat pump) on its branch. Any HVAC-category device
 * can be chained after a source and multiplied, not only ventilation — so changing a chained
 * unit's type afterwards keeps its "add more" multiplier instead of orphaning its placements.
 */
export function isHvacDeviceAfterHvacSourceInCircuit(circuit: Circuit, endpoint: Endpoint): boolean {
  if (!isHvacDeviceSymbol(endpoint.symbol)) return false
  const branches = circuit.branches ?? []
  for (const branch of branches) {
    const idx = branch.endpointIds.indexOf(endpoint.id)
    if (idx <= 0) continue
    const prev = circuit.endpoints.find((e) => e.id === branch.endpointIds[idx - 1])
    return prev?.symbol === 'furnace'
  }
  return false
}

function applyDerivedBooleanFlag<P extends object, K extends keyof P>(
  props: P | undefined,
  key: K,
  value: boolean,
): P | undefined {
  if (value) {
    return { ...(props ?? ({} as P)), [key]: true } as P
  }
  if (!props?.[key]) return props
  const { [key]: _removed, ...rest } = props
  return Object.keys(rest).length > 0 ? (rest as P) : undefined
}

/**
 * Keep topology-derived endpoint flags in sync with branch layout (hidden, for validation/export
 * and to gate UI such as the "add more" multiplier):
 * - battery/solar `plugIn` when immediately after a socket
 * - HVAC devices `chainedAfterHvacSource` when immediately after an HVAC source (furnace/heat pump)
 */
export function syncDerivedEndpointFlags(circuit: Circuit): void {
  for (const ep of circuit.endpoints) {
    if (ep.symbol === 'solar_panel') {
      ep.solarPanelProps = applyDerivedBooleanFlag(
        ep.solarPanelProps,
        'plugIn',
        isPlugInDcEndpointInCircuit(circuit, ep),
      )
    } else if (ep.symbol === 'battery') {
      ep.batteryProps = applyDerivedBooleanFlag(
        ep.batteryProps,
        'plugIn',
        isPlugInDcEndpointInCircuit(circuit, ep),
      )
    } else if (isHvacDeviceSymbol(ep.symbol)) {
      ep.fixedApplianceProps = applyDerivedBooleanFlag(
        ep.fixedApplianceProps,
        'chainedAfterHvacSource',
        isHvacDeviceAfterHvacSourceInCircuit(circuit, ep),
      )
    }
  }
}
