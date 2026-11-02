import type {
  ProtectionDevice,
  ProtectionType,
  PolesConfig,
  ResidualCurrentType,
  SymbolLabelDisplayConfig,
  TrunkDevice,
} from '@/types/schema'
import { polesConfigToDisplay } from '@/constants/poleConfig'
import {
  breakingCapacityLabelForOption,
  breakingCapacityOptionIsAmpStyle,
  DEFAULT_RESIDUAL_CURRENT_TYPE,
  getDefaultProtectionProps,
  getDefaultTrunkDeviceProtectionProps,
  resolveBreakingCapacitySelectValue,
} from '@/lib/protectionDefaults'
export type ProtectionLabelKey =
  | 'protectionPoles'
  | 'protectionCurrent'
  | 'protectionCharacteristic'
  | 'protectionResidualCurrent'
  | 'protectionResidualCurrentType'
  | 'protectionShortCircuit'

export interface ProtectionLabelPart {
  key: ProtectionLabelKey
  text: string
  /** Thin inset frame on one-wire when true (amp-style breaking capacity: 3000–10000). */
  frame?: boolean
}

/** Up-pointing triangle before residual trip current on the one-wire (e.g. △30mA). */
export const RESIDUAL_CURRENT_DELTA = '△'

export type ProtectionOneWireLabelRole = 'residual' | 'breaking' | 'specs'

export type ProtectionOneWireLabelLine = {
  text: string
  frame?: boolean
  role: ProtectionOneWireLabelRole
}

export type ProtectionLike = ProtectionDevice | TrunkDevice

const DEFAULT_VISIBILITY: Record<ProtectionLabelKey, boolean> = {
  protectionPoles: true,
  protectionCurrent: true,
  protectionCharacteristic: true,
  protectionResidualCurrent: true,
  protectionResidualCurrentType: true,
  protectionShortCircuit: true,
}

/**
 * Electrical protection kind (MCB, RCD, …).
 * Trunk devices use `type` for placement category (`'protection'`, `'energy_meter'`, …);
 * the actual MCB/RCD kind is `protectionType`. Reading `.type` first would yield `'protection'`
 * and incorrectly hide poles/curve/kA on the diagram.
 */
function getProtectionElectricalKind(source: ProtectionLike): ProtectionType | undefined {
  if ('trunkPosition' in source) {
    return (source as TrunkDevice).protectionType
  }
  return (source as ProtectionDevice).type
}

/**
 * Which technical label segments apply to a protection type — aligned with
 * {@link ProtectionDeviceElectricalFields} so stale data after a type change
 * cannot produce irrelevant canvas labels.
 */
export function protectionLabelKeyAppliesToType(
  type: ProtectionType | undefined,
  key: ProtectionLabelKey,
): boolean {
  if (type == null) return true
  switch (key) {
    case 'protectionPoles':
      return (
        type === 'RCD' ||
        type === 'RCBO' ||
        type === 'MCB' ||
        type === 'SPD' ||
        type === 'ROTATING_SWITCH'
      )
    case 'protectionCurrent':
      return type !== 'SPD'
    case 'protectionCharacteristic':
      return type === 'MCB' || type === 'RCBO'
    case 'protectionResidualCurrent':
      return type === 'RCD' || type === 'RCBO'
    case 'protectionResidualCurrentType':
      return type === 'RCD' || type === 'RCBO'
    case 'protectionShortCircuit':
      return type === 'MCB' || type === 'RCBO' || type === 'SPD'
    default:
      return true
  }
}

/** Strip electrical fields that do not apply after a protection type change. */
export function getProtectionTypeChangeClears(next: ProtectionType): {
  sensitivityMa?: undefined
  residualCurrentType?: undefined
  selective?: undefined
  superImmunized?: undefined
  curve?: undefined
  breakingCapacityKa?: undefined
  breakingCapacityOption?: undefined
} {
  const out: {
    sensitivityMa?: undefined
    residualCurrentType?: undefined
    selective?: undefined
    superImmunized?: undefined
    curve?: undefined
    breakingCapacityKa?: undefined
    breakingCapacityOption?: undefined
  } = {}
  if (!protectionLabelKeyAppliesToType(next, 'protectionResidualCurrent')) {
    out.sensitivityMa = undefined
    out.residualCurrentType = undefined
    out.selective = undefined
    out.superImmunized = undefined
  }
  if (!protectionLabelKeyAppliesToType(next, 'protectionCharacteristic')) {
    out.curve = undefined
  }
  if (!protectionLabelKeyAppliesToType(next, 'protectionShortCircuit')) {
    out.breakingCapacityKa = undefined
    out.breakingCapacityOption = undefined
  }
  return out
}

/** Defaults when switching to a protection type (fills missing fields, keeps user values). */
export function getProtectionTypeChangePatch(
  device: ProtectionLike,
  next: ProtectionType,
  polesConfig: PolesConfig,
): Partial<ProtectionDevice> & Partial<TrunkDevice> {
  const clears = getProtectionTypeChangeClears(next)
  const isTrunk = 'trunkPosition' in device
  const defaults = isTrunk
    ? getDefaultTrunkDeviceProtectionProps(next, polesConfig)
    : getDefaultProtectionProps(next, polesConfig)

  const patch: Partial<ProtectionDevice> & Partial<TrunkDevice> = { ...clears }

  if (protectionLabelKeyAppliesToType(next, 'protectionResidualCurrent')) {
    if (device.sensitivityMa == null && defaults.sensitivityMa != null) {
      patch.sensitivityMa = defaults.sensitivityMa
    }
    if (device.residualCurrentType == null) {
      patch.residualCurrentType =
        (defaults.residualCurrentType as ResidualCurrentType | undefined) ??
        DEFAULT_RESIDUAL_CURRENT_TYPE
    }
  }
  if (protectionLabelKeyAppliesToType(next, 'protectionCharacteristic') && device.curve == null) {
    patch.curve = defaults.curve
  }
  if (protectionLabelKeyAppliesToType(next, 'protectionShortCircuit')) {
    if (device.breakingCapacityKa == null && defaults.breakingCapacityKa != null) {
      patch.breakingCapacityKa = defaults.breakingCapacityKa
    }
    if (device.breakingCapacityOption == null && defaults.breakingCapacityOption != null) {
      patch.breakingCapacityOption = defaults.breakingCapacityOption
    }
  }
  if (protectionLabelKeyAppliesToType(next, 'protectionPoles')) {
    if (device.polesConfig == null && defaults.polesConfig != null) {
      patch.polesConfig = defaults.polesConfig
    }
    if (device.poles == null && defaults.poles != null) {
      patch.poles = defaults.poles
    }
  }
  if (device.ratingA == null && defaults.ratingA != null) {
    patch.ratingA = defaults.ratingA
  }

  if (next === 'RCD' || next === 'RCBO') {
    const visibility = { ...(device.symbolLabelDisplay?.visibility ?? {}) }
    if (typeof visibility.protectionResidualCurrentType !== 'boolean') {
      patch.symbolLabelDisplay = {
        ...device.symbolLabelDisplay,
        visibility: {
          ...visibility,
          protectionResidualCurrentType: true,
        },
      }
    }
  }

  return patch
}

export function isProtectionLabelPartVisible(
  source: ProtectionLike,
  key: ProtectionLabelKey,
): boolean {
  const kind = getProtectionElectricalKind(source)
  if (!protectionLabelKeyAppliesToType(kind, key)) return false
  const display = source.symbolLabelDisplay
  const configured = display?.visibility?.[key]
  if (typeof configured === 'boolean') return configured
  if (kind === 'ROTATING_SWITCH') return false
  return DEFAULT_VISIBILITY[key]
}

/** Return the next persisted display config for a single visibility-button click. */
export function toggleProtectionLabelVisibility(
  source: ProtectionLike,
  key: ProtectionLabelKey,
): SymbolLabelDisplayConfig {
  return {
    ...source.symbolLabelDisplay,
    visibility: {
      ...(source.symbolLabelDisplay?.visibility ?? {}),
      [key]: !isProtectionLabelPartVisible(source, key),
    },
  }
}

function getRawProtectionLabelParts(source: ProtectionLike): ProtectionLabelPart[] {
  const kind = getProtectionElectricalKind(source)
  const curve = displayedProtectionCurve(source)
  const ratingA =
    (source as ProtectionDevice).ratingA ??
    (source as TrunkDevice).ratingA
  const breakingCapacityKa =
    (source as ProtectionDevice).breakingCapacityKa ??
    (source as TrunkDevice).breakingCapacityKa
  const breakingCapacityOption =
    (source as ProtectionDevice).breakingCapacityOption ??
    (source as TrunkDevice).breakingCapacityOption
  const sensitivityMa =
    (source as ProtectionDevice).sensitivityMa ??
    (source as TrunkDevice).sensitivityMa
  const polesConfig =
    (source as ProtectionDevice).polesConfig ??
    (source as TrunkDevice).polesConfig
  const poles =
    (source as ProtectionDevice).poles ??
    (source as TrunkDevice).poles

  const parts: ProtectionLabelPart[] = []
  const polesDisplay = polesConfig
    ? polesConfigToDisplay(polesConfig)
    : poles != null
      ? `${poles}P`
      : ''
  if (polesDisplay && protectionLabelKeyAppliesToType(kind, 'protectionPoles')) {
    parts.push({ key: 'protectionPoles', text: polesDisplay })
  }
  if (curve && protectionLabelKeyAppliesToType(kind, 'protectionCharacteristic')) {
    parts.push({ key: 'protectionCharacteristic', text: curve })
  }
  if (ratingA != null) {
    parts.push({ key: 'protectionCurrent', text: `${ratingA}A` })
  }
  if (sensitivityMa != null && protectionLabelKeyAppliesToType(kind, 'protectionResidualCurrent')) {
    parts.push({ key: 'protectionResidualCurrent', text: `${sensitivityMa}mA` })
  }
  if (breakingCapacityKa != null && protectionLabelKeyAppliesToType(kind, 'protectionShortCircuit')) {
    const optionValue = resolveBreakingCapacitySelectValue(
      breakingCapacityOption,
      breakingCapacityKa,
    )
    const text =
      kind === 'SPD'
        ? `${breakingCapacityKa}kA`
        : breakingCapacityLabelForOption(optionValue)
    parts.push({
      key: 'protectionShortCircuit',
      text,
      frame: kind !== 'SPD' && breakingCapacityOptionIsAmpStyle(optionValue),
    })
  }
  return parts
}

export function getVisibleProtectionLabelParts(source: ProtectionLike): ProtectionLabelPart[] {
  return getRawProtectionLabelParts(source).filter((part) =>
    isProtectionLabelPartVisible(source, part.key),
  )
}

function buildResidualTopWireLines(
  source: ProtectionLike,
  byKey: Map<ProtectionLabelKey, ProtectionLabelPart>,
  splitResidualLine: boolean,
): ProtectionOneWireLabelLine[] {
  const storedType =
    (source as ProtectionDevice).residualCurrentType ??
    (source as TrunkDevice).residualCurrentType
  const effectiveType = storedType
  const maPart = byKey.get('protectionResidualCurrent')
  const chunks: string[] = []
  if (source.selective) chunks.push('S')
  if (source.superImmunized) chunks.push('SI')
  if (
    effectiveType &&
    isProtectionLabelPartVisible(source, 'protectionResidualCurrentType')
  ) {
    chunks.push(`Type ${effectiveType}`)
  }
  if (maPart) {
    chunks.push(`${RESIDUAL_CURRENT_DELTA}${maPart.text}`)
  }
  if (chunks.length === 0) return []
  return splitResidualLine
    ? chunks.map((text) => ({ text, role: 'residual' }))
    : [{ text: chunks.join('  '), role: 'residual' }]
}

function buildSpecsWireLine(
  source: ProtectionLike,
  byKey: Map<ProtectionLabelKey, ProtectionLabelPart>,
): ProtectionOneWireLabelLine | null {
  const poles = byKey.get('protectionPoles')
  const curve = byKey.get('protectionCharacteristic')
  const current = byKey.get('protectionCurrent')
  const ratingText = curve && current
    ? formatProtectionCurveRating(source.curve, source.ratingA)
    : curve?.text ?? current?.text
  const text = [poles?.text, ratingText].filter(Boolean).join(' ')
  if (!text) return null
  return {
    text,
    role: 'specs',
  }
}

/**
 * Stacked one-wire lines for protections (RCD/RCBO: type+△IΔn, breaking, poles/curve/A).
 */
export function getProtectionOneWireLabelLines(
  source: ProtectionLike,
  options: { splitResidualLine?: boolean } = {},
): ProtectionOneWireLabelLine[] {
  const kind = getProtectionElectricalKind(source)
  const visible = getVisibleProtectionLabelParts(source)
  if (visible.length === 0 && !source.selective && !source.superImmunized) return []

  const byKey = new Map(visible.map((part) => [part.key, part]))
  const lines: ProtectionOneWireLabelLine[] = []

  if (kind === 'RCD' || kind === 'RCBO') {
    lines.push(...buildResidualTopWireLines(source, byKey, options.splitResidualLine === true))

    const breaking = byKey.get('protectionShortCircuit')
    if (breaking) {
      lines.push({
        text: breaking.text,
        frame: breaking.frame,
        role: 'breaking',
      })
    }

    const specsLine = buildSpecsWireLine(source, byKey)
    if (specsLine) lines.push(specsLine)
    return lines
  }

  const breaking = byKey.get('protectionShortCircuit')
  if (breaking) {
    lines.push({
      text: breaking.text,
      frame: breaking.frame,
      role: 'breaking',
    })
  }

  const specsLine = buildSpecsWireLine(source, byKey)
  if (specsLine) lines.push(specsLine)

  return lines
}

/**
 * Vertical anchor for label block: 1 line → that line; 2 → between; 3+ with breaking → breaking line.
 */
export function getProtectionOneWireAnchorLineIndex(
  lines: ProtectionOneWireLabelLine[],
): number {
  const n = lines.length
  if (n === 0) return 0
  if (n === 1) return 0
  if (n === 2) return 0.5
  const breakingIdx = lines.findIndex((line) => line.role === 'breaking')
  if (breakingIdx >= 0) return breakingIdx
  return (n - 1) / 2
}

export function getVisibleProtectionLabelLines(source: ProtectionLike): string[] {
  return getProtectionOneWireLabelLines(source).map((line) => line.text)
}

/** The curve drawings show: none once adjustable trip settings replace it. */
export function displayedProtectionCurve(source: ProtectionLike): ProtectionLike['curve'] {
  return (source as ProtectionDevice).tripSettings ? undefined : source.curve
}

/** Standard compact breaker notation; retain amperes when no curve is known. */
export function formatProtectionCurveRating(curve?: string, ratingA?: number): string {
  if (curve && ratingA != null) return `${curve}${ratingA}`
  return curve || (ratingA != null ? `${ratingA}A` : '')
}

export function getProtectionInfoSummaryParts(source: ProtectionLike): string[] {
  const type = getProtectionElectricalKind(source)

  const ratingA =
    (source as ProtectionDevice).ratingA ??
    (source as TrunkDevice).ratingA
  const curve = displayedProtectionCurve(source)
  const sensitivityMa =
    (source as ProtectionDevice).sensitivityMa ??
    (source as TrunkDevice).sensitivityMa
  const residualCurrentType =
    (source as ProtectionDevice).residualCurrentType ??
    (source as TrunkDevice).residualCurrentType
  const breakingCapacityKa =
    (source as ProtectionDevice).breakingCapacityKa ??
    (source as TrunkDevice).breakingCapacityKa
  const polesConfig =
    (source as ProtectionDevice).polesConfig ??
    (source as TrunkDevice).polesConfig
  const poles =
    (source as ProtectionDevice).poles ??
    (source as TrunkDevice).poles

  const parts: string[] = []

  // Poles (simplified 1P–4P display)
  const polesDisplay = polesConfig
    ? polesConfigToDisplay(polesConfig)
    : poles != null
      ? `${poles}P`
      : ''
  if (polesDisplay) parts.push(polesDisplay)

  if (type === 'MCB') {
    // MCB: "2P - C16"
    const ratingText = formatProtectionCurveRating(curve, ratingA)
    if (ratingText) parts.push(ratingText)
  } else if (type === 'RCD') {
    // RCD: "2P - 40A 30mA" (optionally + type A)
    if (ratingA) parts.push(`${ratingA}A`)
    if (sensitivityMa) parts.push(`${sensitivityMa}mA`)
    if (residualCurrentType) parts.push(`Type ${residualCurrentType}`)
  } else if (type === 'RCBO') {
    // RCBO: "2P - C40 - 300mA"
    const ratingText = formatProtectionCurveRating(curve, ratingA)
    if (ratingText) parts.push(ratingText)
    if (sensitivityMa) parts.push(`${sensitivityMa}mA`)
    if (residualCurrentType) parts.push(`Type ${residualCurrentType}`)
  } else if (type === 'SPD') {
    if (breakingCapacityKa != null) parts.push(`${breakingCapacityKa}kA`)
  } else {
    // Generic: show whatever is available
    const ratingParts: string[] = []
    if (curve) ratingParts.push(curve)
    if (ratingA) ratingParts.push(`${ratingA}A`)
    const ratingText = ratingParts.join(' ')
    if (ratingText) parts.push(ratingText)
  }

  if ((type === 'RCD' || type === 'RCBO') && source.selective) parts.push('S')
  if ((type === 'RCD' || type === 'RCBO') && source.superImmunized) parts.push('SI')
  return parts
}

/**
 * Format a concise technical summary for protection devices (e.g. "2P - C16").
 * Shared between panel protections and trunk/supply protections.
 */
export function formatProtectionInfoSummary(source: ProtectionLike): string {
  return getProtectionInfoSummaryParts(source).join(' - ')
}

