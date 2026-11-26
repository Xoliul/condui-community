import type { Circuit } from '@/types/schema'
import { canEditOneWireRisers, getMaxStem, getRiserTargetFields, isNestingTargetOnRiserCircuit, isProtectionDropOnRiserCircuit } from '@/lib/eendraad/oneWireRisers'
import type { CommandCheck } from './types'

/** Validate `branchStem` / `newRiser` on a placement or move target (nothing to check without them). */
export function checkRiserDropTarget(circuit: Circuit | undefined, target: object): CommandCheck {
  const { stem, newRiser } = getRiserTargetFields(target)
  if (stem === undefined && !newRiser) return { ok: true }
  if (!circuit) return { ok: false, code: 'circuit_not_found', message: 'Circuit not found' }
  if (!canEditOneWireRisers(circuit))
    return { ok: false, code: 'unsupported_riser', message: 'Risers need an ordinary AC final circuit without converters, inline protections or nested protections' }
  if (stem !== undefined && (!Number.isSafeInteger(stem) || stem < 0 || stem > getMaxStem(circuit)))
    return { ok: false, code: 'invalid_stem', message: 'That riser does not exist' }
  if (newRiser && stem !== undefined)
    return { ok: false, code: 'invalid_riser_target', message: 'Use either branchStem or newRiser, not both' }
  if (newRiser && !circuit.endpoints.length)
    return { ok: false, code: 'riser_needs_trunk', message: 'A riser needs content on the trunk first' }
  return { ok: true }
}

/** A protection dropped on a circuit with risers is refused (it would nest the risers into a new circuit). */
export function checkRiserProtectionDrop(circuit: Circuit | undefined, symbolId: string, target: object): CommandCheck {
  return isProtectionDropOnRiserCircuit(symbolId, target, circuit)
    ? { ok: false, code: 'unsupported_riser', message: 'A protection cannot be added to a circuit with risers' }
    : { ok: true }
}

const NO_NEST_ON_RISERS = { ok: false, code: 'unsupported_riser', message: 'A protection cannot be added to a circuit with risers' } as const

/**
 * Moving an existing breaker (or circuit) into a circuit with risers nests it just like a library drop: refused for a
 * circuit target (bus slot, nest zone, lift above the circuit's own breaker) and for a secondary-bus move whose
 * parent has risers. Moves along the main bus or under an RCD never name such a circuit and stay allowed.
 */
export function checkRiserProtectionMove(
  findCircuit: (circuitId: string) => Circuit | undefined,
  move: { target?: { type?: string | null; circuitId?: string }; parentCircuitId?: string },
): CommandCheck {
  const target = move.target
  if (target?.circuitId && isNestingTargetOnRiserCircuit(target, findCircuit(target.circuitId))) return NO_NEST_ON_RISERS
  if (move.parentCircuitId && isNestingTargetOnRiserCircuit({ type: 'circuit' }, findCircuit(move.parentCircuitId))) return NO_NEST_ON_RISERS
  return { ok: true }
}
