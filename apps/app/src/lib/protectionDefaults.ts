/**
 * Default properties for protection devices (MCB, RCD, RCBO, SPD, etc.)
 * when created by drop (eendraad or panel). Single source of truth for defaults.
 */
import type {
  ProtectionCreationTemplate,
  ProtectionDevice,
  ProtectionType,
  TrunkDevice,
  PolesConfig,
  InstallationProfile,
} from '@/types/schema'
import { polesConfigFromVoltageSystem } from '@/constants/poleConfig'
import { polesFromConfig } from '@/constants/poleConfig'
import { queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { ROTATING_SWITCH_LABEL_VISIBILITY } from '@/lib/protectionKind'
import {
  getProjectElectricalInstallation,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

/** Mandatory RCBO default residual-current sensitivity. */
export const DEFAULT_RCBO_SENSITIVITY_MA = 300

/** Default residual-current type for new RCD/RCBO devices. */
export const DEFAULT_RESIDUAL_CURRENT_TYPE = 'A' as const

/** Sentinel shown in breaker rating selectors for entering a non-standard value. */
export const OTHER_PROTECTION_RATING_OPTION = '__other_rating__'

/** Accept only positive finite custom protection ratings from number fields. */
export function parsePositiveProtectionRating(value: string): number | undefined {
  if (!value) return undefined
  const rating = Number(value)
  return Number.isFinite(rating) && rating > 0 ? rating : undefined
}

/** Standard Belgian breaker rated currents for MCB/RCBO selection (A). */
export const BE_STANDARD_BREAKER_RATINGS_A = [
  2, 4, 6, 10, 12, 16, 20, 25, 32, 40, 50, 63, 80, 100,
] as const

const NON_HOUSEHOLD_BREAKER_RATINGS_A = [
  ...BE_STANDARD_BREAKER_RATINGS_A,
  125,
  160,
  200,
  250,
  360,
  400,
  630,
  1000,
] as const

export function getProtectionRatingOptions(
  type: ProtectionType,
  profile: InstallationProfile = 'household'
): readonly number[] | null {
  if (type === 'RCD') return [25, 40, 63, 80, 100, 125]
  if (type !== 'MCB' && type !== 'RCBO') return null
  return profile === 'non_household'
    ? NON_HOUSEHOLD_BREAKER_RATINGS_A
    : BE_STANDARD_BREAKER_RATINGS_A
}

/** Default short-circuit breaking capacity for new MCB/RCBO (3000 / 3 kA). */
export const DEFAULT_BREAKING_CAPACITY_KA = 3

/** Default unique dropdown value (amp-style `3000`, not `3` kA). */
export const DEFAULT_BREAKING_CAPACITY_OPTION = '3000'

/** Option values that render with a frame on the one-wire (3000–10000 only). */
export const BREAKING_CAPACITY_AMP_OPTION_VALUES = new Set(['3000', '4500', '6000', '10000'])

export type BreakingCapacityDropdownOption = {
  /** Unique CustomDropdown value (may differ from label for duplicate kA entries). */
  value: string
  label: string
  ka: number
}

/** MCB/RCBO breaking-capacity dropdown — exact labels and order. */
export const MCB_RCBO_BREAKING_CAPACITY_OPTIONS: BreakingCapacityDropdownOption[] = [
  { value: '3000', label: '3000', ka: 3 },
  { value: '4500', label: '4500', ka: 4.5 },
  { value: '6000', label: '6000', ka: 6 },
  { value: '10000', label: '10000', ka: 10 },
  { value: '3', label: '3 kA', ka: 3 },
  { value: '4.5', label: '4,5 kA', ka: 4.5 },
  { value: '6', label: '6 kA', ka: 6 },
  { value: '10', label: '10 kA', ka: 10 },
  { value: '15', label: '15 kA', ka: 15 },
  { value: '25', label: '25 kA', ka: 25 },
  { value: '30', label: '30 kA', ka: 30 },
]

const NON_HOUSEHOLD_BREAKING_CAPACITY_OPTIONS: BreakingCapacityDropdownOption[] = [
  ...MCB_RCBO_BREAKING_CAPACITY_OPTIONS,
  { value: '36', label: '36 kA', ka: 36 },
]

/** Household devices use framed amp markings; keep a stored kA choice editable. */
export function getBreakerBreakingCapacityOptions(
  profile: InstallationProfile = 'household',
  currentValue?: string,
): readonly BreakingCapacityDropdownOption[] {
  return profile === 'non_household'
    ? NON_HOUSEHOLD_BREAKING_CAPACITY_OPTIONS
    : NON_HOUSEHOLD_BREAKING_CAPACITY_OPTIONS.filter(
        ({ value }) => BREAKING_CAPACITY_AMP_OPTION_VALUES.has(value) || value === currentValue,
      )
}

export function breakingCapacityKaFromSelectValue(value: string): number | undefined {
  const option = NON_HOUSEHOLD_BREAKING_CAPACITY_OPTIONS.find((o) => o.value === value)
  if (option) return option.ka
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : undefined
}

export function breakingCapacityPatchFromSelectValue(
  value: string
): { breakingCapacityKa: number; breakingCapacityOption: string } | undefined {
  const option = NON_HOUSEHOLD_BREAKING_CAPACITY_OPTIONS.find((o) => o.value === value)
  if (!option) return undefined
  return { breakingCapacityKa: option.ka, breakingCapacityOption: option.value }
}

/** Resolve stored option; legacy projects with only kA default to amp-style when ambiguous. */
export function resolveBreakingCapacitySelectValue(
  option: string | undefined,
  ka: number | undefined
): string {
  if (option && NON_HOUSEHOLD_BREAKING_CAPACITY_OPTIONS.some((entry) => entry.value === option)) {
    return option
  }
  if (ka != null) {
    const ampEntry = NON_HOUSEHOLD_BREAKING_CAPACITY_OPTIONS.find(
      (entry) => entry.ka === ka && BREAKING_CAPACITY_AMP_OPTION_VALUES.has(entry.value)
    )
    if (ampEntry) return ampEntry.value
    const kaEntry = NON_HOUSEHOLD_BREAKING_CAPACITY_OPTIONS.find(
      (entry) => entry.ka === ka && !BREAKING_CAPACITY_AMP_OPTION_VALUES.has(entry.value)
    )
    if (kaEntry) return kaEntry.value
    return String(ka)
  }
  return ''
}

/** A capacity edit replaces both representations, including explicit clears. */
export function normalizeProtectionCapacityUpdates<
  T extends { breakingCapacityKa?: number; breakingCapacityOption?: string },
>(updates: T, current?: { breakingCapacityOption?: string }): T {
  const hasKa = Object.prototype.hasOwnProperty.call(updates, 'breakingCapacityKa')
  const hasOption = Object.prototype.hasOwnProperty.call(updates, 'breakingCapacityOption')
  if (!hasKa && !hasOption) return updates
  const next = { ...updates }
  if (hasKa) {
    const option = hasOption ? updates.breakingCapacityOption : current?.breakingCapacityOption
    if (
      updates.breakingCapacityKa == null ||
      (option != null && breakingCapacityKaFromSelectValue(option) !== updates.breakingCapacityKa) ||
      (!hasOption && !option)
    ) {
      next.breakingCapacityOption = undefined
    }
  } else {
    next.breakingCapacityKa = updates.breakingCapacityOption
      ? breakingCapacityKaFromSelectValue(updates.breakingCapacityOption)
      : undefined
  }
  return next
}

export function breakingCapacityLabelForOption(optionValue: string): string {
  const entry = NON_HOUSEHOLD_BREAKING_CAPACITY_OPTIONS.find((o) => o.value === optionValue)
  return entry?.label ?? optionValue
}

/** Frame on one-wire only for 3000, 4500, 6000, 10000 — not for 3 kA etc. */
export function breakingCapacityOptionIsAmpStyle(optionValue: string): boolean {
  return BREAKING_CAPACITY_AMP_OPTION_VALUES.has(optionValue)
}

/** kA options for SPD (surge ratings). */
export function protectionBreakingCapacityKaOptions(isSPD: boolean): number[] {
  return isSPD ? [10, 20, 25, 40, 50] : []
}

/** Get poles config from project installation voltage (1~ → 2P, 3~ → 3P, 3N~ → 4P). */
export function getVoltagePolesConfig(
  project: ProjectWithOptionalV2Electrical | null
): PolesConfig {
  const system = project
    ? getProjectElectricalInstallation(project)?.nominalVoltage?.system
    : '2~'
  return polesConfigFromVoltageSystem(system ?? '2~')
}

/** Keep voltage-derived defaults inside the choices offered by the protection editor. */
export function getProtectionDefaultPolesConfig(
  type: ProtectionType,
  voltagePolesConfig: PolesConfig
): PolesConfig {
  if ((type === 'RCD' || type === 'RCBO') && voltagePolesConfig === '3P') return '4P'
  if (type === 'RCD' && voltagePolesConfig !== '2P' && voltagePolesConfig !== '4P') return '2P'
  return voltagePolesConfig
}

export function protectionCreationTemplateFromDevice(
  protection: ProtectionDevice
): ProtectionCreationTemplate {
  const polesConfig =
    protection.type === 'RCD' && protection.polesConfig
      ? getProtectionDefaultPolesConfig(protection.type, protection.polesConfig)
      : protection.polesConfig
  return {
    ratingA: protection.ratingA,
    curve: protection.curve,
    sensitivityMa: protection.sensitivityMa,
    residualCurrentType: protection.residualCurrentType,
    selective: protection.selective,
    superImmunized: protection.superImmunized,
    breakingCapacityKa: protection.breakingCapacityKa,
    breakingCapacityOption: protection.breakingCapacityOption,
    surgeProtectionKind: protection.surgeProtectionKind,
    polesConfig,
    poles: polesConfig ? polesFromConfig(polesConfig) : protection.poles,
  }
}

type ProjectWithProtectionTemplates = ProjectWithOptionalV2Electrical & {
  project?: {
    protectionCreationTemplates?: Partial<Record<ProtectionType, ProtectionCreationTemplate>>
  }
}

/** Project-specific learned values take precedence over voltage-derived fallbacks. */
export function getProtectionCreationProps(
  project: ProjectWithProtectionTemplates | null,
  type: ProtectionType
): Partial<ProtectionDevice> {
  const fallback = getDefaultProtectionProps(type, getVoltagePolesConfig(project))
  const remembered = project?.project?.protectionCreationTemplates?.[type]
  return remembered ? { ...fallback, ...remembered } : fallback
}

/** Default properties for a protection device by type. Use when creating on main bus or in panel. */
export function getDefaultProtectionProps(
  type: ProtectionDevice['type'],
  polesConfig: PolesConfig
): Partial<ProtectionDevice> {
  const effectivePolesConfig = getProtectionDefaultPolesConfig(type, polesConfig)
  const poles = polesFromConfig(effectivePolesConfig)
  switch (type) {
    case 'MCB':
      return {
        polesConfig: effectivePolesConfig,
        poles,
        ratingA: 16,
        curve: 'C',
        breakingCapacityKa: DEFAULT_BREAKING_CAPACITY_KA,
        breakingCapacityOption: DEFAULT_BREAKING_CAPACITY_OPTION,
      }
    case 'RCD':
      return {
        polesConfig: effectivePolesConfig,
        poles,
        sensitivityMa: 300,
        residualCurrentType: DEFAULT_RESIDUAL_CURRENT_TYPE,
        ratingA: 40,
      }
    case 'RCBO':
      return {
        polesConfig: effectivePolesConfig,
        poles,
        sensitivityMa: DEFAULT_RCBO_SENSITIVITY_MA,
        residualCurrentType: DEFAULT_RESIDUAL_CURRENT_TYPE,
        ratingA: 40,
        curve: 'C',
        breakingCapacityKa: DEFAULT_BREAKING_CAPACITY_KA,
        breakingCapacityOption: DEFAULT_BREAKING_CAPACITY_OPTION,
      }
    case 'SPD':
      return {
        polesConfig: effectivePolesConfig,
        poles,
        breakingCapacityKa: 20,
        surgeProtectionKind: 'standard',
      }
    case 'FUSE':
      return { polesConfig: '1P', poles: 1, ratingA: 10 }
    case 'MAIN_SWITCH':
      return { polesConfig: effectivePolesConfig, poles, ratingA: 63 }
    case 'ROTATING_SWITCH':
      return {
        polesConfig: effectivePolesConfig,
        poles,
        symbolLabelDisplay: {
          visibility: { ...ROTATING_SWITCH_LABEL_VISIBILITY },
        },
      }
    default:
      return { polesConfig: effectivePolesConfig, poles }
  }
}

/**
 * Reconcile a known MCB/RCBO capacity on supply-trunk protections.
 * Missing ratings remain unspecified; loading must not invent electrical facts.
 */
export function healSupplyTrunkProtectionBreakingCapacity(
  project: ProjectWithOptionalV2Electrical
): boolean {
  let changed = false
  for (const device of queryAllSupplyTrunkDevices(project)) {
    if (device.type !== 'protection') continue
    const kind = device.protectionType
    if (kind !== 'MCB' && kind !== 'RCBO') continue
    if (device.breakingCapacityKa != null && device.breakingCapacityOption != null) continue

    if (device.breakingCapacityKa == null && device.breakingCapacityOption) {
      const ka = breakingCapacityKaFromSelectValue(device.breakingCapacityOption)
      if (ka == null) continue
      device.breakingCapacityKa = ka
      changed = true
    }
    if (device.breakingCapacityOption == null && device.breakingCapacityKa != null) {
      device.breakingCapacityOption = resolveBreakingCapacitySelectValue(
        undefined,
        device.breakingCapacityKa
      )
      changed = true
    }
  }
  return changed
}

/** Default properties for a supply trunk device (protection type). Use when dropping on supply wire or in panel supply area. */
export function getDefaultTrunkDeviceProtectionProps(
  protectionType: ProtectionDevice['type'],
  polesConfig: PolesConfig
): Partial<TrunkDevice> {
  const effectivePolesConfig = getProtectionDefaultPolesConfig(protectionType, polesConfig)
  const poles = polesFromConfig(effectivePolesConfig)
  switch (protectionType) {
    case 'MCB':
      return {
        polesConfig: effectivePolesConfig,
        poles,
        ratingA: 16,
        curve: 'C',
        breakingCapacityKa: DEFAULT_BREAKING_CAPACITY_KA,
        breakingCapacityOption: DEFAULT_BREAKING_CAPACITY_OPTION,
      }
    case 'RCD':
      return {
        polesConfig: effectivePolesConfig,
        poles,
        sensitivityMa: 300,
        residualCurrentType: DEFAULT_RESIDUAL_CURRENT_TYPE,
        ratingA: 40,
      }
    case 'RCBO':
      return {
        polesConfig: effectivePolesConfig,
        poles,
        sensitivityMa: DEFAULT_RCBO_SENSITIVITY_MA,
        residualCurrentType: DEFAULT_RESIDUAL_CURRENT_TYPE,
        ratingA: 40,
        curve: 'C',
        breakingCapacityKa: DEFAULT_BREAKING_CAPACITY_KA,
        breakingCapacityOption: DEFAULT_BREAKING_CAPACITY_OPTION,
      }
    case 'SPD':
      return {
        polesConfig: effectivePolesConfig,
        poles,
        breakingCapacityKa: 20,
        surgeProtectionKind: 'standard',
      }
    case 'FUSE':
      return { polesConfig: '1P', poles: 1, ratingA: 10 }
    case 'MAIN_SWITCH':
      return { polesConfig: effectivePolesConfig, poles, ratingA: 63 }
    case 'ROTATING_SWITCH':
      return {
        polesConfig: effectivePolesConfig,
        poles,
        symbolLabelDisplay: {
          visibility: { ...ROTATING_SWITCH_LABEL_VISIBILITY },
        },
      }
    default:
      return { polesConfig: effectivePolesConfig, poles }
  }
}

/** A supply device on the DC side of a converter: its DC wire, a DC-bus branch or a converter output. */
function isSupplyDcSideDevice(device: TrunkDevice): boolean {
  return (
    device.supplyPath === 'converter-dc' ||
    device.supplyPath === 'converter-dc-top' ||
    device.supplyDcBusId != null ||
    device.converterDcConnection != null
  )
}

/**
 * Creation defaults of a protection on the DC side are DC devices: two poles (+ and -), and no
 * breaking capacity, since the AC household default (3000) says nothing about a DC breaker.
 * Fuses, residual-current devices and devices off the DC side keep their AC defaults.
 */
export function withDcSideProtectionDefaults(device: TrunkDevice): TrunkDevice {
  if (device.type !== 'protection' || !isSupplyDcSideDevice(device)) return device
  const kind = device.protectionType
  if (kind === 'FUSE' || kind === 'RCD' || kind === 'RCBO') return device
  const next: TrunkDevice = { ...device, polesConfig: '2P', poles: 2 }
  if (kind === 'MCB') {
    delete next.breakingCapacityKa
    delete next.breakingCapacityOption
  }
  return next
}
