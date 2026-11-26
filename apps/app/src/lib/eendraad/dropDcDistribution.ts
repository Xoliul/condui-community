import {
  getNextTerminalStripLabel,
  getTerminalStripTrunkConnectionProps,
} from '@/lib/terminalStrip/labels'
import { getNextJunctionIdentity, isSharedJunctionSymbol } from '@/lib/junctionIdentity'
import { isTerminalPanelFeederCircuit } from '@/lib/eendraad/panelSupplyLink'

import { buildAutoSitplanPlacement } from '@/lib/plan/autoSitplanPlacement'
import type { SitplanPlacementTarget } from '@/lib/eendraad/duplicateSitplanHelpers'
import { resolveCircuitSitplanTargetFloorId } from '@/lib/plan/sitplanTargetFloor'

import { generateId } from '@/utils'

import {
  getVoltagePolesConfig,
  getDefaultTrunkDeviceProtectionProps,
  withDcSideProtectionDefaults,
} from '@/lib/protectionDefaults'
import { PROTECTION_SYMBOL_ID_TO_TYPE } from '@/lib/protectionKind'
import { getSymbolById } from '@/lib/symbols'
import {
  getCircuitConverterDcConnectionCount,
  promoteOrdinaryCircuitBranchesToDcBus,
} from '@/lib/layout/circuitConverterGeometry'

import type { SymbolMetadata } from '@/lib/symbols'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import type { Circuit, Panel, TrunkDevice, TrunkDeviceType, Placement } from '@/types/schema'
import type { Point } from '@/types/ui'

import { getSupplyConverterDcConnectionIndex } from '@/lib/supplyAssembly/converterDcConnections'

import { selectProjectSupplyAssemblies } from '@/lib/projectV2/electrical'
import { clamp } from '@/lib/geometry'
import { insertConverterOutputDevice } from './converterOutputDevices'

import { buildDirectConverterSupplyAssembly } from '@/lib/supplyAssembly/editorIntegration'

import {
  type DropBehaviorProject,
  type DropBehavior,
  type DropBehaviorCallbacks,
  viewportCenterOn,
  projectPanels,
} from './dropBehaviorModel'
import { getSupplyDevicesForDropTarget, getCircuitTrunkPositionForDrop } from './dropWireDomain'
import { getFirstJunctionPanelLabel, addSupplyTrunkDevice } from './dropSupplyDevices'

export function addCircuitTrunkDeviceAtDrop(
  target: DropTarget,
  _circuit: Circuit,
  trunkDevice: TrunkDevice,
  callbacks: DropBehaviorCallbacks
): void {
  if (!target.circuitId) return
  callbacks.addTrunkDevice(target.circuitId, trunkDevice)
  const updatedCircuit = callbacks.getCircuitById(target.circuitId)
  const list = updatedCircuit?.trunkDevices ? [...updatedCircuit.trunkDevices] : null
  if (!list) return
  const currentIdx = list.findIndex((d) => d.id === trunkDevice.id)
  if (currentIdx === -1) return
  list.splice(currentIdx, 1)
  const segIndex =
    typeof target.circuitTrunkSegmentIndex === 'number' && !target.insertAfterCircuitContent
      ? target.circuitTrunkSegmentIndex
      : list.length
  const insertIdx = clamp(segIndex, 0, list.length)
  list.splice(insertIdx, 0, trunkDevice)
  callbacks.updateCircuit(target.circuitId, { trunkDevices: list })
}

export function addCircuitDcPassiveDevice(
  target: DropTarget,
  project: DropBehaviorProject,
  symbol: SymbolMetadata,
  callbacks: DropBehaviorCallbacks
): TrunkDevice | null {
  if (!target.circuitId) return null
  const circuit = callbacks.getCircuitById(target.circuitId)
  if (!circuit) return null

  const protectionType = PROTECTION_SYMBOL_ID_TO_TYPE[symbol.id]
  const type: TrunkDeviceType = protectionType
    ? 'protection'
    : symbol.id === 'junction_panel'
      ? 'junction_panel'
      : symbol.id === 'junction_box'
        ? 'junction_box'
        : symbol.id === 'terminal_strip'
          ? 'terminal_strip'
          : symbol.id === 'energy_meter'
            ? 'energy_meter'
            : symbol.id === 'dc_bus'
              ? 'dc_bus'
              : 'protection'
  const label =
    symbol.id === 'junction_panel'
      ? (getFirstJunctionPanelLabel(project) ?? 'JP1')
      : symbol.id === 'terminal_strip'
        ? getNextTerminalStripLabel(project, undefined, target.circuitId)
        : symbol.id === 'energy_meter'
          ? 'kWh'
          : symbol.id === 'dc_bus'
            ? 'DC'
            : ''
  if (symbol.id === 'junction_panel') callbacks.ensureJunctionPanelPlacementForLabel(label)

  const device: TrunkDevice = {
    id: callbacks.newId?.() ?? generateId(),
    type,
    symbol: symbol.id as TrunkDevice['symbol'],
    label,
    ...(symbol.id === 'terminal_strip'
      ? getTerminalStripTrunkConnectionProps(project, undefined, target.circuitId)
      : isSharedJunctionSymbol(symbol.id)
        ? { junctionIdentity: getNextJunctionIdentity(project, symbol.id) }
        : {}),
    trunkPosition: target.converterDcConnection
      ? 0
      : getCircuitTrunkPositionForDrop(target, circuit),
    ...(target.converterDcConnection
      ? { converterDcConnection: { ...target.converterDcConnection } }
      : {}),
    ...(type === 'dc_bus' ? { dcBusProps: {} } : {}),
    ...(protectionType
      ? {
          protectionType,
          ...getDefaultTrunkDeviceProtectionProps(protectionType, getVoltagePolesConfig(project)),
        }
      : {}),
  }
  if (protectionType === 'ROTATING_SWITCH') {
    const placement = buildVisibleTrunkSitplanPlacement(
      project,
      callbacks.getSitplanTarget(),
      circuit.id,
      undefined,
      callbacks.newId
    )
    if (placement) device.placements = [placement]
  }
  if (target.converterDcConnection && type === 'dc_bus') callbacks.addTrunkDevice(circuit.id, device)
  else if (target.converterDcConnection)
    // A device on a converter output sits at its place among that output's devices, before its
    // endpoints, and starts as a DC device (two poles, no AC breaking capacity).
    callbacks.updateCircuit(circuit.id, {
      trunkDevices: insertConverterOutputDevice(
        circuit.trunkDevices ?? [],
        withDcSideProtectionDefaults(device),
        target.branchDeviceInsertIndex
      ),
    })
  else addCircuitTrunkDeviceAtDrop(target, circuit, device, callbacks)
  callbacks.setSelection({ type: 'trunkDevice', ids: [device.id] })
  return device
}

/** Add a protection in series on one ordinary DC-rail branch. */
export function addDcBusBranchProtectionDevice(
  target: DropTarget,
  project: DropBehaviorProject,
  symbol: SymbolMetadata,
  callbacks: DropBehaviorCallbacks
): TrunkDevice | null {
  if (!target.circuitId || !target.dcBusId) return null
  const circuit = callbacks.getCircuitById(target.circuitId)
  if (!circuit) return null

  const branch = (circuit.branches ?? []).find(
    (candidate) =>
      candidate.dcBusId === target.dcBusId &&
      (candidate.id === target.branchId ||
        candidate.endpointIds.some((id) => target.branchEndpoints?.includes(id)))
  )
  if (!branch) return null

  const protectionType = PROTECTION_SYMBOL_ID_TO_TYPE[symbol.id]
  if (!protectionType) return null
  const device: TrunkDevice = {
    id: callbacks.newId?.() ?? generateId(),
    type: 'protection',
    symbol: symbol.id as TrunkDevice['symbol'],
    label: '',
    trunkPosition: 0,
    protectionType,
    ...getDefaultTrunkDeviceProtectionProps(protectionType, getVoltagePolesConfig(project)),
  }
  const branchDevices = [...(branch.branchDevices ?? [])]
  const insertIndex = clamp(
    target.branchDeviceInsertIndex ?? branchDevices.length,
    0,
    branchDevices.length
  )
  branchDevices.splice(insertIndex, 0, device)
  callbacks.updateCircuit(target.circuitId, {
    branches: (circuit.branches ?? []).map((candidate) =>
      candidate.id === branch.id ? { ...candidate, branchDevices } : candidate
    ),
  })
  callbacks.setSelection({ type: 'trunkDevice', ids: [device.id] })
  return device
}

/** Selectable passive DC distribution point on a circuit or converter output. */
export const dcBusBehavior: DropBehavior = {
  // Keep the legacy circuit target executable for existing converter data, but
  // collectDropZoneHints deliberately hides it: new rails are advertised only
  // on an ordinary supply wire or an unoccupied converter DC connection.
  validTargets: ['circuit', 'supplyWire', 'supplyConverterDcWire'],
  execute: (target, project, symbol, t, callbacks) => {
    if (!canDropDcBusOnTarget(target, project)) return

    if (target.type === 'supplyWire') {
      if (
        !target.panelId ||
        target.supplyFeedScope !== 'root' ||
        selectProjectSupplyAssemblies(project).length > 0
      ) {
        return
      }
      const supplyDevices = getSupplyDevicesForDropTarget(target, project)
      if (
        supplyDevices.some(
          (device) =>
            device.type === 'dc_bus' ||
            device.symbol === 'dc_bus' ||
            device.supplyPath === 'converter-branch'
        )
      ) {
        return
      }
      const inverter = addSupplyTrunkDevice(
        getSymbolById('inverter')!,
        target,
        project,
        callbacks,
        { supplyPath: 'converter-branch' }
      )
      if (!inverter) return
      callbacks.addSupplyAssembly(
        buildDirectConverterSupplyAssembly(project, target.panelId, inverter)
      )
      const bus = addSupplyTrunkDevice(
        getSymbolById('dc_bus')!,
        {
          ...target,
          supplyDeviceInsertIndex: inverter.trunkPosition + 1,
        },
        project,
        callbacks,
        {
          supplyPath: 'converter-dc',
          supplyConverterDcConnectionIndex: 0,
        }
      )
      callbacks.setSelection({ type: 'trunkDevice', ids: [bus?.id ?? inverter.id] })
      return
    }

    if (target.type === 'supplyConverterDcWire') {
      if (!isBareSupplyConverterDcWire(target, project)) return
      const device = addConverterDcBranchDevice(symbol, target, project, callbacks)
      if (device) callbacks.setSelection({ type: 'trunkDevice', ids: [device.id] })
      return
    }

    if (
      target.type !== 'circuit' ||
      target.dcBusId ||
      !isBareInverterCircuitDcConnection(target, project)
    ) {
      return
    }

    if (!target.circuitId) return
    const circuit = callbacks.getCircuitById(target.circuitId)
    if (!circuit || circuitIsTerminalPanelFeeder(project, circuit.id)) return
    const wireDomain = 'DC'
    if (wireDomain !== 'DC') {
      callbacks.onDropRejected?.(
        t('wires.domainMismatchDrop', {
          defaultValue:
            '{{component}} requires {{domain}} input, but the wire here is {{wireDomain}}.',
          component: symbol.name,
          domain: 'DC',
          wireDomain,
        })
      )
      return
    }

    const bus = addCircuitDcPassiveDevice(target, project, symbol, callbacks)
    if (!bus) return
    const updatedCircuit = callbacks.getCircuitById(circuit.id)
    if (!updatedCircuit) return
    callbacks.updateCircuit(updatedCircuit.id, {
      branches: promoteOrdinaryCircuitBranchesToDcBus(
        updatedCircuit,
        bus.id,
        target.converterDcConnection
      ),
    })
  },
}

export function isBareInverterCircuitDcConnection(
  target: DropTarget,
  project: DropBehaviorProject
): boolean {
  const connection = target.converterDcConnection
  if (!target.circuitId) return false

  const circuit = findCircuitForDcBusTarget(project, target.circuitId)
  if (!circuit) return false
  const inverter = connection
    ? circuit.trunkDevices?.find((device) => device.id === connection.converterId)
    : [...(circuit.trunkDevices ?? [])]
        .sort((left, right) => (left.trunkPosition ?? 0) - (right.trunkPosition ?? 0))
        .at((target.circuitTrunkSegmentIndex ?? 0) - 1)
  if (!inverter || inverter.symbol !== 'inverter') return false

  if (!connection) {
    if (target.wireDomain !== 'DC' || getCircuitConverterDcConnectionCount(inverter) > 1) {
      return false
    }
    return !(circuit.trunkDevices ?? []).some((device) => device.type === 'dc_bus')
  }

  if (connection.connectionIndex !== getCircuitConverterDcConnectionCount(inverter) - 1) {
    return false
  }

  return !(circuit.trunkDevices ?? []).some(
    (device) =>
      device.type === 'dc_bus' &&
      device.converterDcConnection?.converterId === connection.converterId
  )
}

export function findCircuitForDcBusTarget(
  project: DropBehaviorProject,
  circuitId: string
): Circuit | null {
  const stack = [...projectPanels(project)]
  while (stack.length > 0) {
    const panel = stack.pop()!
    const direct = panel.circuits?.find((circuit) => circuit.id === circuitId)
    if (direct) return direct
    for (const protection of panel.protections ?? []) {
      const nested = protection.circuits?.find((circuit) => circuit.id === circuitId)
      if (nested) return nested
    }
    stack.push(...(panel.subPanels ?? []))
  }
  return null
}

export function canDropDcBusOnTarget(target: DropTarget, project: DropBehaviorProject): boolean {
  if (target.type === 'supplyWire') {
    if (
      !target.panelId ||
      target.supplyFeedScope !== 'root' ||
      selectProjectSupplyAssemblies(project).length > 0
    ) {
      return false
    }
    const supplyDevices = getSupplyDevicesForDropTarget(target, project)
    return !supplyDevices.some(
      (device) =>
        device.type === 'dc_bus' ||
        device.symbol === 'dc_bus' ||
        device.supplyPath === 'converter-branch'
    )
  }

  if (target.type === 'supplyConverterDcWire') {
    return isBareSupplyConverterDcWire(target, project)
  }

  return (
    target.type === 'circuit' &&
    !target.dcBusId &&
    isBareInverterCircuitDcConnection(target, project)
  )
}

export function isBareSupplyConverterDcWire(
  target: DropTarget,
  project: DropBehaviorProject
): boolean {
  if (
    target.type !== 'supplyConverterDcWire' ||
    !target.panelId ||
    target.supplyFeedScope !== 'root' ||
    target.supplyDcBusId
  ) {
    return false
  }

  const connectionIndex =
    target.supplyConverterDcConnectionIndex ?? (target.supplyConverterDcBranch === 'top' ? 1 : 0)
  if (connectionIndex !== 0) return false

  const supplyDevices = getSupplyDevicesForDropTarget(
    { ...target, type: 'supplyWire', supplyFeedScope: 'root' },
    project
  )
  const hasConverter = supplyDevices.some(
    (device) => device.supplyPath === 'converter-branch' || device.supplyPath === 'backup'
  )
  return (
    hasConverter &&
    !supplyDevices.some((device) => device.type === 'dc_bus' || device.symbol === 'dc_bus')
  )
}

export function addConverterDcBranchDevice(
  symbol: SymbolMetadata,
  target: DropTarget,
  project: DropBehaviorProject,
  callbacks: DropBehaviorCallbacks
): TrunkDevice | null {
  if (target.type !== 'supplyConverterDcWire' || !target.panelId) return null
  const supplyDevices = getSupplyDevicesForDropTarget(
    { ...target, type: 'supplyWire', supplyFeedScope: 'root' },
    project
  )
  const converter = supplyDevices.find(
    (device) => device.supplyPath === 'converter-branch' || device.supplyPath === 'backup'
  )
  if (!converter) return null
  const supplyPath = target.supplyConverterDcBranch === 'top' ? 'converter-dc-top' : 'converter-dc'
  const connectionIndex =
    target.supplyConverterDcConnectionIndex ?? (target.supplyConverterDcBranch === 'top' ? 1 : 0)
  const branchDevices = supplyDevices.filter(
    (device) =>
      device.supplyPath === supplyPath &&
      getSupplyConverterDcConnectionIndex(device) === connectionIndex &&
      (target.converterDcConnection
        ? device.converterDcConnection?.converterId === target.converterDcConnection.converterId &&
          device.converterDcConnection.connectionIndex ===
            target.converterDcConnection.connectionIndex
        : !device.converterDcConnection)
  )
  const lastBranchIndex = branchDevices.reduce(
    (lastIndex, device) => Math.max(lastIndex, supplyDevices.indexOf(device)),
    -1
  )
  return addSupplyTrunkDevice(
    symbol,
    {
      ...target,
      supplyFeedScope: 'root',
      supplyDeviceInsertIndex:
        target.supplyDeviceInsertIndex ??
        (lastBranchIndex >= 0 ? lastBranchIndex + 1 : Math.max(0, converter.trunkPosition + 1)),
    },
    project,
    callbacks,
    {
      supplyPath,
      supplyConverterDcConnectionIndex: connectionIndex,
      ...(target.supplyDcBusId
        ? {
            supplyDcBusId: target.supplyDcBusId,
            supplyDcBusBranchId: target.supplyDcBusBranchId ?? callbacks.newId?.() ?? generateId(),
          }
        : {}),
      ...(target.converterDcConnection
        ? { converterDcConnection: { ...target.converterDcConnection } }
        : {}),
    }
  )
}

/**
 * Only dedicated sub-panel feeders are terminal. Existing consumer branches
 * remain editable when the board caps a mixed circuit's trunk.
 */
export function circuitIsTerminalPanelFeeder(
  project: DropBehaviorProject,
  circuitId: string
): boolean {
  const stack: Panel[] = [...projectPanels(project)]
  while (stack.length) {
    const panel = stack.pop()!
    for (const protection of panel.protections ?? []) {
      if (
        protection.circuits?.some(
          (c) => c.id === circuitId && isTerminalPanelFeederCircuit(protection, c)
        )
      ) {
        return true
      }
    }
    if (panel.subPanels?.length) {
      stack.push(...panel.subPanels)
    }
  }
  return false
}

export function buildVisibleTrunkSitplanPlacement(
  project: DropBehaviorProject,
  sitplanTarget: SitplanPlacementTarget,
  circuitId: string,
  preferredPlanPosOverride?: Point,
  newId: () => string = generateId
): Placement | null {
  const activeFloorId = resolveCircuitSitplanTargetFloorId(
    project,
    sitplanTarget.activeFloorId,
    circuitId
  )
  if (!activeFloorId) return null

  const preferredPlanPos =
    preferredPlanPosOverride ?? viewportCenterOn(sitplanTarget, activeFloorId) ?? undefined
  return buildAutoSitplanPlacement(project, {
    circuitId,
    floorId: activeFloorId,
    placementId: newId(),
    ...(preferredPlanPos ? { preferredPlanPos } : {}),
  })
}
