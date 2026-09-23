import type { CableSpec } from '@/types/schema'

export type WireTypeOption = { value: CableSpec['kind']; label: string }

/** Common cable sections available in the wire properties editors. */
export const AC_CABLE_SECTION_OPTIONS = [1.5, 2.5, 4, 6, 10, 16, 25, 35, 50] as const

/** Common insulated comb-busbar sections (manufacturer-specific current ratings). */
export const COMB_BUSBAR_SECTION_OPTIONS = [10, 16] as const

/** DC cable sections, including common battery-cable sizes. */
export const DC_CABLE_SECTION_OPTIONS = [
  0.22,
  0.34,
  0.6,
  0.72,
  0.75,
  0.8,
  1,
  1.5,
  2.5,
  4,
  6,
  10,
  16,
  25,
  35,
  50,
  70,
  95,
  120,
] as const

export function getWireSectionOptions(isDC: boolean): readonly number[] {
  return isDC ? DC_CABLE_SECTION_OPTIONS : AC_CABLE_SECTION_OPTIONS
}

/** AC cable kinds shown in wire properties (VOBst is AC-only). */
export function getAcWireTypeOptions(otherLabel: string): WireTypeOption[] {
  return [
    { value: 'XVB', label: 'XVB' },
    { value: 'VOB', label: 'VOB' },
    { value: 'VOBst', label: 'VOBst' },
    { value: 'XGB', label: 'XGB' },
    { value: 'EXVB', label: 'EXVB' },
    { value: 'H07RN-F', label: 'H07RN-F' },
    { value: 'other', label: otherLabel },
  ]
}

/** DC cable kinds; Solar and Twinflex are not translated. */
export function getDcWireTypeOptions(
  otherLabel: string,
  labels?: { batteryCable: string },
): WireTypeOption[] {
  return [
    { value: 'battery-cable', label: labels?.batteryCable ?? 'Battery cable' },
    { value: 'twinflex', label: 'Twinflex' },
    { value: 'PV1-F', label: 'PV1-F' },
    { value: 'H1Z2Z2-K', label: 'H1Z2Z2-K' },
    { value: 'H07V-K', label: 'H07V-K' },
    { value: 'SVV', label: 'SVV' },
    { value: 'LiYY', label: 'LiYY' },
    { value: 'VTLB', label: 'VTLB' },
    { value: 'JYSTY', label: 'JYSTY' },
    { value: 'NYFAZ', label: 'NYFAZ' },
    { value: 'Solar', label: 'Solar' },
    ...getAcWireTypeOptions(otherLabel),
  ]
}

/** Earthing / ground wire type list (AC types, no Solar). */
export function getGroundWireTypeOptions(otherLabel: string): WireTypeOption[] {
  return [
    { value: 'VOB', label: 'VOB' },
    { value: 'VOBst', label: 'VOBst' },
    { value: 'XVB', label: 'XVB' },
    { value: 'XGB', label: 'XGB' },
    { value: 'EXVB', label: 'EXVB' },
    { value: 'H07RN-F', label: 'H07RN-F' },
    { value: 'other', label: otherLabel },
  ]
}

export function applyCableKindChange(
  cable: CableSpec,
  kind: CableSpec['kind'],
): CableSpec {
  if (kind === 'other') {
    return { ...cable, kind }
  }
  const { customKind: _removed, ...rest } = cable
  return { ...rest, kind }
}
