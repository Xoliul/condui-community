import { getCircuitBranches } from '@/lib/layout/endpointChains'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import type { Circuit, TrunkDevice } from '@/types/schema'

/**
 * Switching devices that may sit in series on an ordinary circuit trunk, where
 * they switch every branch downstream. Only the plain (1–4 pole) switch and the
 * relay qualify; staircase, changeover, dimmer, pull and impulse switches are
 * branch-only because their meaning depends on the branch they control.
 */
const CIRCUIT_TRUNK_SWITCH_SYMBOLS = new Set(['switch', 'relay'])

export function isCircuitTrunkSwitchSymbol(symbolId: string): boolean {
  return CIRCUIT_TRUNK_SWITCH_SYMBOLS.has(symbolId)
}

/**
 * Ordinary final circuits accept a trunk switch, including empty ones (the
 * branches it switches may follow later). Feeder, nested-bus and
 * converter-backup circuits are supply paths.
 */
export function circuitAcceptsTrunkSwitch(circuit: Circuit | undefined): boolean {
  if (!circuit || circuit.code === 'PANEL' || circuit.supplySource) return false
  return (circuit.subCircuitIds?.length ?? 0) === 0
}

/** Whether the circuit already draws endpoint branches above its trunk. */
export function circuitHasBranchContent(circuit: Circuit | undefined): boolean {
  return !!circuit && getCircuitBranches(circuit).some((branch) => branch.length > 0)
}

/**
 * A drop low on the vertical trunk wire places the switch on the trunk. The
 * nest zone at the top of the trunk (`insertAfterCircuitContent`) keeps
 * starting a new branch, as do branch, rail and converter-output targets.
 */
export function isCircuitTrunkSwitchDropTarget(target: DropTarget): boolean {
  return (
    target.type === 'circuit' &&
    !!target.circuitId &&
    // Any branch context, including an empty branch (`[]`), starts a branch.
    target.branchEndpoints === undefined &&
    !target.branchId &&
    !target.dcBusId &&
    !target.converterDcConnection &&
    typeof target.circuitTrunkSegmentIndex === 'number' &&
    target.insertAfterCircuitContent !== true &&
    typeof target.secondaryBusInsertIndex !== 'number'
  )
}

/**
 * A trunk switch switches every branch above it, so it lands in the branch gap under the
 * pointer. Trunk wire segments only split at existing trunk devices, so `fallback` (the
 * segment-derived position) cannot reach a gap between branches.
 */
export function getCircuitTrunkSwitchPositionForDrop(target: DropTarget, fallback: number): number {
  return typeof target.circuitTrunkBranchSlot === 'number' && target.insertAfterCircuitContent !== true
    ? target.circuitTrunkBranchSlot
    : fallback
}

export function createCircuitTrunkSwitchDevice(
  symbolId: string,
  id: string,
  trunkPosition: number
): TrunkDevice {
  if (symbolId === 'relay') {
    return { id, type: 'relay', symbol: 'relay', label: '', trunkPosition }
  }
  // Start with two poles; the user can choose the poles for the actual control function.
  return {
    id,
    type: 'switch',
    symbol: 'switch',
    label: '',
    poles: 2,
    polesConfig: '2P',
    trunkPosition,
  }
}
