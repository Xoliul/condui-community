import type { CurveType } from '@/types/schema'

/**
 * Minimum short-circuit current and maximum protected cable length per AREI Book 1,
 * 5.3.5.5.h: `Icc,min = 0.8 · U · S / (1.5 · ρ · 2L)`.
 *
 * - `0.8` accounts for the supply voltage dropping to 80 % during the fault.
 * - `1.5` raises conductor resistance from 20 °C to the mean temperature during the fault.
 * - `2L` is the out-and-return conductor loop.
 * - Large sections add reactance by increasing resistance 15 / 20 / 25 % (150 / 185 / 240 mm²).
 *
 * See apps/app/docs/context/future/short-circuit-breaking-capacity.md.
 */

export type ConductorMaterial = 'copper' | 'aluminium'

/** Resistivity at 20 °C in Ω·mm²/m. */
export const CONDUCTOR_RESISTIVITY_20C: Record<ConductorMaterial, number> = {
  copper: 0.0178,
  aluminium: 0.0286,
}

const FAULT_VOLTAGE_FACTOR = 0.8
const FAULT_TEMPERATURE_RESISTANCE_FACTOR = 1.5

/**
 * Upper limit of the instantaneous (magnetic) trip band as a multiple of In. EN 60898-1 gives
 * B 3–5, C 5–10, D 10–20; the upper limit is the current that guarantees tripping. K and Z
 * follow common manufacturer bands. Other curves have no dependable band.
 */
const INSTANTANEOUS_TRIP_MULTIPLIER: Partial<Record<CurveType, number>> = {
  B: 5,
  C: 10,
  D: 20,
  K: 14,
  Z: 3,
}

export function instantaneousTripMultiplier(curve: CurveType | undefined): number | undefined {
  return curve ? INSTANTANEOUS_TRIP_MULTIPLIER[curve] : undefined
}

/** Current that guarantees instantaneous tripping (`Ia` in AREI 5.3.5.5.h). */
export function instantaneousTripCurrentA(
  ratingA: number | undefined,
  curve: CurveType | undefined
): number | undefined {
  const multiplier = instantaneousTripMultiplier(curve)
  if (multiplier == null || ratingA == null || !(ratingA > 0)) return undefined
  return ratingA * multiplier
}

/** Reactance allowance for large sections, applied as extra resistance. */
export function reactanceResistanceFactor(sectionMm2: number): number {
  if (sectionMm2 >= 240) return 1.25
  if (sectionMm2 >= 185) return 1.2
  if (sectionMm2 >= 150) return 1.15
  return 1
}

interface ConductorLoop {
  /** Phase-to-neutral voltage when the neutral is distributed, otherwise phase-to-phase. */
  voltageV: number
  sectionMm2: number
  material?: ConductorMaterial
}

function loopResistancePerMetre({ sectionMm2, material = 'copper' }: ConductorLoop): number {
  return (
    (FAULT_TEMPERATURE_RESISTANCE_FACTOR *
      CONDUCTOR_RESISTIVITY_20C[material] *
      2 *
      reactanceResistanceFactor(sectionMm2)) /
    sectionMm2
  )
}

/** Prospective minimum short-circuit current at the far end of `lengthM` of cable. */
export function minimumShortCircuitCurrentA(
  loop: ConductorLoop & { lengthM: number }
): number | undefined {
  if (!(loop.voltageV > 0) || !(loop.sectionMm2 > 0) || !(loop.lengthM > 0)) return undefined
  return (FAULT_VOLTAGE_FACTOR * loop.voltageV) / (loopResistancePerMetre(loop) * loop.lengthM)
}

/** Longest cable for which the far-end minimum short-circuit current still reaches `tripCurrentA`. */
export function maximumProtectedLengthM(
  loop: ConductorLoop & { tripCurrentA: number }
): number | undefined {
  if (!(loop.voltageV > 0) || !(loop.sectionMm2 > 0) || !(loop.tripCurrentA > 0)) return undefined
  return (FAULT_VOLTAGE_FACTOR * loop.voltageV) / (loopResistancePerMetre(loop) * loop.tripCurrentA)
}
