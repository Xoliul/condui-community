/**
 * Classification helpers for protection symbols and types.
 * Rotating switches and SPDs can be placed like protection devices but do not
 * satisfy generic circuit-protection requirements in validation or hardware tallies.
 */
import type { ProtectionDevice, ProtectionType, SymbolKey, TrunkDevice } from '@/types/schema'

export const ROTATING_SWITCH_SYMBOL_ID = 'rotating_switch' as const

/** All protection library symbols (panel bus, secondary bus, supply wire). */
export const PROTECTION_SYMBOL_IDS = [
  'mcb',
  'rcd',
  'rcbo',
  'fuse',
  'main_switch',
  'spd',
  ROTATING_SWITCH_SYMBOL_ID,
] as const satisfies readonly SymbolKey[]

/** @deprecated Use {@link PROTECTION_SYMBOL_IDS}. */
export const PANEL_PROTECTION_SYMBOL_IDS = PROTECTION_SYMBOL_IDS

/** @deprecated Use {@link PROTECTION_SYMBOL_IDS}. */
export const SUPPLY_TRUNK_PROTECTION_SYMBOL_IDS = PROTECTION_SYMBOL_IDS

export const PROTECTION_SYMBOL_ID_TO_TYPE: Record<string, ProtectionType> = {
  mcb: 'MCB',
  rcd: 'RCD',
  rcbo: 'RCBO',
  fuse: 'FUSE',
  main_switch: 'MAIN_SWITCH',
  spd: 'SPD',
  [ROTATING_SWITCH_SYMBOL_ID]: 'ROTATING_SWITCH',
}

export const PROTECTION_TYPE_TO_SYMBOL_ID: Partial<Record<ProtectionType, SymbolKey>> = {
  MCB: 'mcb',
  RCD: 'rcd',
  RCBO: 'rcbo',
  FUSE: 'fuse',
  MAIN_SWITCH: 'main_switch',
  SPD: 'spd',
  ROTATING_SWITCH: ROTATING_SWITCH_SYMBOL_ID,
}

export function protectionTypeFromSymbolId(symbolId: string): ProtectionType {
  return PROTECTION_SYMBOL_ID_TO_TYPE[symbolId] ?? 'OTHER'
}

export function protectionTypeToSymbolKey(pt: ProtectionType): SymbolKey | undefined {
  return PROTECTION_TYPE_TO_SYMBOL_ID[pt]
}

/** True when the protection type participates in AREI validation as a protective device. */
export function isFunctionalProtectionType(type: ProtectionType | undefined): boolean {
  return type != null && type !== 'ROTATING_SWITCH' && type !== 'SPD'
}

/** Protection types that can limit fault current through an overcurrent trip. */
export function isOvercurrentProtectionType(type: ProtectionType | undefined): boolean {
  return type === 'MCB' || type === 'RCBO' || type === 'FUSE'
}

/**
 * Whether a protection is only an intermediate carrier for downstream protections.
 *
 * An RCD's ampere marking is a continuous-current rating, not an overcurrent trip
 * threshold. An RCBO can be an intermediate carrier too when it feeds a subpanel or
 * a container circuit; its rating may narrow the effective upstream limit, but a
 * higher rating must not widen that limit.
 */
export function isIntermediateProtectionDevice(
  protection: Pick<ProtectionDevice, 'type' | 'subPanelId' | 'circuits'>,
): boolean {
  if (protection.type === 'RCD') return true
  if (protection.type !== 'RCBO') return false
  if (protection.subPanelId) return true
  return (protection.circuits ?? []).some(
    (circuit) =>
      (circuit.subCircuitIds?.length ?? 0) > 0 && (circuit.endpoints?.length ?? 0) === 0,
  )
}

/** True for protection symbols that are add-ons on an existing circuit trunk. */
export function isCircuitTrunkAddOnProtectionType(
  type: ProtectionType | undefined
): boolean {
  return type === 'SPD' || type === 'ROTATING_SWITCH'
}

export function trunkDeviceCountsAsProtection(
  td: Pick<TrunkDevice, 'type' | 'protectionType'>,
): boolean {
  return td.type === 'protection' && isFunctionalProtectionType(td.protectionType)
}

/**
 * Initial main/secondary-bus label and circuit code on drop.
 * Rotating-switch protection rows stay unlabeled; circuit-wire drops are stored as inline trunk
 * devices and therefore inherit the owning circuit's label.
 */
export function resolveInitialProtectionBusLabel(
  type: ProtectionType,
  nextSequentialCode: string,
): string {
  return type === 'ROTATING_SWITCH' ? '' : nextSequentialCode
}

/** Default one-wire / supply name label visibility for rotating switches. */
export const ROTATING_SWITCH_LABEL_VISIBILITY = {
  protectionPoles: false,
  protectionCurrent: false,
  protectionCharacteristic: false,
  protectionResidualCurrent: false,
  protectionResidualCurrentType: false,
  protectionShortCircuit: false,
  supplyProtectionNameLabel: false,
} as const
