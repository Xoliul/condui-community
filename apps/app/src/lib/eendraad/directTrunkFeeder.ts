/**
 * A kWh meter wired directly to a busbar, without a protection in front of it. It is modelled as
 * a hidden structural owner (`ProtectionDevice.directTrunkFeeder`, like `directPanelFeeder`)
 * whose circuit carries the meter on its trunk. Only protected sub-circuits may follow it: the
 * circuit itself never carries endpoints or branches (`assertDirectTrunkFeedersCarryNoLoads`).
 */
import type { Circuit, Panel, ProtectionDevice, TrunkDevice } from '@/types/schema'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import { clamp } from '@/lib/geometry'
import { walkPanels } from '@/lib/panel/panelTree'
import { getMainBusInsertionSectionId } from '@/lib/panel/panelBusSections'
import { createDefaultAcCircuitCable, DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS } from '@/lib/wires/circuitWireDefaults'
import { generateId } from '@/utils'
import { getNextAvailableCircuitCode } from '@/utils/project'
import { findPanelForTarget, projectPanels, type DropBehaviorCallbacks, type DropBehaviorProject } from './dropBehaviorModel'

/** A bus position (main bus, RCD bus or secondary-bus slot) where a new circuit starts. */
export function isBusCircuitDropTarget(target: DropTarget): boolean {
  if (target.dcBusId || target.converterDcConnection) return false
  return target.type === 'mainBus' || (target.type === 'rcd' && !!target.protectionId) ||
    (target.type === 'circuit' && !!target.circuitId &&
      typeof target.secondaryBusInsertIndex === 'number' && target.secondaryBusInsertIndex >= 0)
}

/** A kWh meter dropped on a bus position starts its own unprotected meter circuit. */
export function isDirectTrunkFeederMeterDrop(symbolId: string, target: DropTarget): boolean {
  return symbolId === 'energy_meter' && isBusCircuitDropTarget(target)
}

/** The hidden owner and its circuit with the meter on the trunk. */
export function createDirectTrunkFeeder(
  ids: { protectionId: string; circuitId: string; meterId: string },
  code: string,
  busSectionId?: string
): { protection: ProtectionDevice; circuit: Circuit } {
  const meter: TrunkDevice = {
    id: ids.meterId, type: 'energy_meter', symbol: 'energy_meter', label: 'kWh', trunkPosition: 0,
  }
  return {
    protection: {
      id: ids.protectionId, type: 'OTHER', label: '', circuits: [], directTrunkFeeder: true,
      ...(busSectionId ? { busSectionId } : {}),
    },
    circuit: {
      id: ids.circuitId, code, kind: 'other', cable: createDefaultAcCircuitCable(), endpoints: [],
      trunkDevices: [meter], ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
    },
  }
}

/**
 * The circuit code a protection dropped on a structural owner's own wire takes when it replaces
 * that owner (null: no replacement). A board feeder keeps its old behaviour; a meter owner is
 * replaced only by a drop on the wire below its first trunk device.
 */
export function structuralCarrierReplacementCode(
  protection: ProtectionDevice | null | undefined,
  circuit: Circuit | null | undefined,
  target: DropTarget,
  automaticCode: string
): string | null {
  if (!protection || !circuit) return null
  if (protection.directPanelFeeder && protection.subPanelId) return automaticCode
  const belowFirstDevice = target.type === 'circuit' && target.circuitTrunkSegmentIndex === 0 &&
    typeof target.secondaryBusInsertIndex !== 'number' && !target.insertAfterCircuitContent &&
    !target.branchEndpoints?.length
  return protection.directTrunkFeeder && belowFirstDevice ? circuit.code : null
}

/** Moves a just-added circuit to the dropped main-bus or secondary-bus slot. */
export function placeNewBusCircuitAtDrop(
  target: DropTarget,
  panelId: string,
  circuitId: string,
  callbacks: Pick<DropBehaviorCallbacks, 'moveCircuitOnMainBus' | 'moveCircuitToSecondaryBus'>
): void {
  if (target.type === 'mainBus' && typeof target.mainBusInsertIndex === 'number') {
    // A new item starts at the end of the bus; step it left to the cursor segment.
    const total = (target.mainBusItemCount ?? 0) + 1
    const steps = Math.max(0, total - 1 - clamp(target.mainBusInsertIndex, 0, total - 1))
    for (let i = 0; i < steps; i++) callbacks.moveCircuitOnMainBus(panelId, circuitId, 'left')
  }
  if (target.type === 'circuit' && target.circuitId && typeof target.secondaryBusInsertIndex === 'number' &&
    target.secondaryBusInsertIndex >= 0) {
    callbacks.moveCircuitToSecondaryBus(panelId, target.circuitId, circuitId, target.secondaryBusInsertIndex)
  }
}

/** Drop engine: a kWh meter on a bus position, with its hidden owner, placed at the dropped slot. */
export function addDirectTrunkFeederMeterAtDrop(
  target: DropTarget,
  project: DropBehaviorProject,
  callbacks: DropBehaviorCallbacks
): void {
  const panel = findPanelForTarget(project, target)
  if (!panel) return
  const newId = () => callbacks.newId?.() ?? generateId()
  const { protection, circuit } = createDirectTrunkFeeder(
    { protectionId: newId(), circuitId: newId(), meterId: newId() },
    getNextAvailableCircuitCode(project, panel.id),
    target.type === 'mainBus'
      ? target.busSectionId ?? getMainBusInsertionSectionId(panel, target.mainBusInsertIndex)
      : undefined
  )
  callbacks.addProtection(panel.id, protection)
  callbacks.addCircuit(panel.id, circuit, protection.id)
  if (target.type === 'rcd' && target.protectionId) {
    callbacks.addCircuitToProtection(panel.id, target.protectionId, circuit)
  }
  placeNewBusCircuitAtDrop(target, panel.id, circuit.id, callbacks)
  callbacks.setSelection({ type: 'trunkDevice', ids: [circuit.trunkDevices![0]!.id] })
}

/**
 * Deleting the breaker in front of a kWh meter whose circuit carries only devices (the meter
 * feeding a secondary bus) keeps the meter and what follows it: the breaker becomes the hidden
 * owner, as if the meter had been dropped on the bus. Returns false when the breaker is not such
 * a breaker, so the caller deletes it normally.
 */
export function downgradeMeterBreakerToDirectTrunkFeeder(panels: Panel[], protectionId: string): boolean {
  for (const panel of walkPanels(panels)) {
    const index = panel.protections.findIndex((protection) => protection.id === protectionId)
    if (index < 0) continue
    const protection = panel.protections[index]!
    const circuit = protection.circuits?.length === 1 ? protection.circuits[0] : undefined
    if (!circuit || protection.directPanelFeeder || protection.directDcBusFeeder || protection.directTrunkFeeder ||
      protection.subPanelId || protection.dcBusId || protection.supplyTap || circuit.endpoints.length > 0 ||
      (circuit.branches?.length ?? 0) > 0 || circuit.dcBusSource || circuit.supplySource ||
      !circuit.trunkDevices?.some((device) => device.type === 'energy_meter')) return false
    panel.protections[index] = {
      id: protection.id, type: 'OTHER', label: '', circuits: protection.circuits, directTrunkFeeder: true,
      ...(protection.busSectionId ? { busSectionId: protection.busSectionId } : {}),
    }
    return true
  }
  return false
}

/**
 * Dragging a directly wired meter moves its whole circuit (the meter and everything after it),
 * like dragging a breaker: the drag acts on the hidden owner. Returns that owner's id.
 */
export function findDirectTrunkFeederOwnerOfMeter(panels: Panel[], deviceId: string): string | null {
  for (const panel of walkPanels(panels)) {
    for (const protection of panel.protections ?? []) {
      if (protection.directTrunkFeeder && protection.circuits?.some((circuit) => circuit.trunkDevices?.some(
        (device) => device.id === deviceId && device.type === 'energy_meter'))) return protection.id
    }
  }
  return null
}

/** Owner of a circuit when it is a hidden meter owner. */
export function findDirectTrunkFeederOfCircuit(panels: Panel[], circuitId: string): ProtectionDevice | null {
  for (const panel of walkPanels(panels)) {
    for (const protection of panel.protections ?? []) {
      if (protection.directTrunkFeeder && protection.circuits?.some((circuit) => circuit.id === circuitId))
        return protection
    }
  }
  return null
}

/**
 * Drops the one-wire preview shows by running the real placement command rather than the
 * preview simulation: meters on a bus position and anything dropped on a meter-owner circuit
 * (so refused loads show no ghost and an accepted protection previews exactly).
 */
export function previewsDirectTrunkFeederDropByCommand(
  project: DropBehaviorProject,
  symbolId: string,
  target: DropTarget
): boolean {
  if (isDirectTrunkFeederMeterDrop(symbolId, target)) return true
  return !!target.circuitId && !!findDirectTrunkFeederOfCircuit(projectPanels(project), target.circuitId)
}

/** Ids of meter-owner circuits that carry endpoints or branches, which only protections may follow. */
export function findLoadedDirectTrunkFeederCircuitIds(panels: Panel[]): Set<string> {
  const ids = new Set<string>()
  for (const panel of walkPanels(panels)) {
    for (const protection of panel.protections ?? []) {
      if (!protection.directTrunkFeeder) continue
      for (const circuit of protection.circuits ?? []) {
        if (circuit.endpoints.length > 0 || (circuit.branches?.length ?? 0) > 0) ids.add(circuit.id)
      }
    }
  }
  return ids
}
