import type { ProtectionDevice } from '@/types/schema'

type CarrierFlags = Pick<ProtectionDevice, 'directPanelFeeder' | 'directDcBusFeeder' | 'directTrunkFeeder'>

/** Hidden structural owners: topology only, never a physical protection, symbol or panel module. */
export function isStructuralCarrierProtection(protection: CarrierFlags | null | undefined): boolean {
  return !!protection && (protection.directPanelFeeder === true || protection.directDcBusFeeder === true ||
    protection.directTrunkFeeder === true)
}

export function isDirectTrunkFeeder(protection: CarrierFlags | null | undefined): boolean {
  return protection?.directTrunkFeeder === true
}
