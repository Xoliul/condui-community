import type { EnergyConversionDeviceProps, EquipmentCertificationProps } from '@/types/schema'

/**
 * Equipment facts read from a TRiK Nota typed next to a panel string, battery or inverter.
 *
 * Parsing is deliberately strict so free text is never misread: a line only becomes a field
 * when its key is a known label and, for quantities, its value carries an explicit unit of
 * the right kind. Everything else stays visible as note text.
 */
export type TrikEquipmentNota = EquipmentCertificationProps & {
  /** Peak/maximum power in watts, from `Pmax` with a W/Wp/kW/kWp/MW unit. */
  maxPowerW?: number
  /** Rated (nominal) power in watts, from `Pnom`, `Vermogen` or `P` with a power unit. */
  ratedPowerW?: number
  /** Energy in kWh, from `Capaciteit` with a Wh/kWh/MWh unit. */
  capacityKWh?: number
  /** Lines that are not equipment facts. */
  remainingText?: string
}

type FactKey = 'brand' | 'model' | 'maxPower' | 'ratedPower' | 'capacity' | 'serial'

const KEY_ALIASES: Record<string, FactKey> = {
  merk: 'brand',
  brand: 'brand',
  type: 'model',
  model: 'model',
  pmax: 'maxPower',
  pnom: 'ratedPower',
  vermogen: 'ratedPower',
  p: 'ratedPower',
  capaciteit: 'capacity',
  capacity: 'capacity',
  sn: 'serial',
  's/n': 'serial',
  serienummer: 'serial',
}

/** `Key: value`, or `Key value` when the key is a known label. */
const KEY_VALUE = /^([A-Za-z][A-Za-z/]*)\s*(:)?\s*(\S.*)?$/

function parseNumberWithUnit(value: string): { amount: number; unit: string } | undefined {
  const match = value.replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*([A-Za-z]+)\b/)
  if (!match) return undefined
  const amount = Number(match[1])
  return Number.isFinite(amount) ? { amount, unit: match[2]! } : undefined
}

const POWER_FACTOR: Record<string, number> = { w: 1, wp: 1, kw: 1e3, kwp: 1e3, mw: 1e6, mwp: 1e6 }
const ENERGY_FACTOR_KWH: Record<string, number> = { wh: 1e-3, kwh: 1, mwh: 1e3 }

function parsePowerW(value: string): number | undefined {
  const quantity = parseNumberWithUnit(value)
  const factor = quantity ? POWER_FACTOR[quantity.unit.toLowerCase()] : undefined
  return quantity && factor ? quantity.amount * factor : undefined
}

function parseEnergyKWh(value: string): number | undefined {
  const quantity = parseNumberWithUnit(value)
  const factor = quantity ? ENERGY_FACTOR_KWH[quantity.unit.toLowerCase()] : undefined
  return quantity && factor ? quantity.amount * factor : undefined
}

export function parseTrikEquipmentNota(text: string): TrikEquipmentNota {
  const result: TrikEquipmentNota = {}
  const remaining: string[] = []
  const serials: string[] = []
  let continuesSerials = false
  for (const rawLine of text.split(/\r\n?|\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    // Further serial numbers are written as indented bare tokens under `SN:`.
    if (continuesSerials && /^\s/.test(rawLine) && /^[\w-]+$/.test(line)) {
      serials.push(line)
      continue
    }
    continuesSerials = false
    const match = line.match(KEY_VALUE)
    const key = match ? KEY_ALIASES[match[1]!.toLowerCase()] : undefined
    const value = match?.[3]?.trim() ?? ''
    let consumed = false
    if (key && value) {
      if (key === 'brand' && !result.brand) {
        result.brand = value
        consumed = true
      } else if (key === 'model' && !result.model) {
        result.model = value
        consumed = true
      } else if (key === 'maxPower' && result.maxPowerW == null) {
        result.maxPowerW = parsePowerW(value)
        consumed = result.maxPowerW != null
      } else if (key === 'ratedPower' && result.ratedPowerW == null) {
        result.ratedPowerW = parsePowerW(value)
        consumed = result.ratedPowerW != null
      } else if (key === 'capacity' && result.capacityKWh == null) {
        result.capacityKWh = parseEnergyKWh(value)
        consumed = result.capacityKWh != null
      } else if (key === 'serial' && /^[\w-]+$/.test(value)) {
        serials.push(value)
        continuesSerials = true
        consumed = true
      }
    }
    if (!consumed) remaining.push(line)
  }
  if (serials.length === 1) result.serialNumber = serials[0]
  if (serials.length > 1) result.serialNumbers = serials
  if (remaining.length > 0) result.remainingText = remaining.join('\n')
  return result
}

export function hasTrikEquipmentFacts(nota: TrikEquipmentNota): boolean {
  return !!(
    nota.brand ||
    nota.model ||
    nota.maxPowerW != null ||
    nota.ratedPowerW != null ||
    nota.capacityKWh != null ||
    nota.serialNumber ||
    nota.serialNumbers
  )
}

function certification(nota: TrikEquipmentNota): EquipmentCertificationProps {
  return {
    ...(nota.brand ? { brand: nota.brand } : {}),
    ...(nota.model ? { model: nota.model } : {}),
    ...(nota.serialNumber ? { serialNumber: nota.serialNumber } : {}),
    ...(nota.serialNumbers ? { serialNumbers: nota.serialNumbers } : {}),
  }
}

function formatPower(watts: number): string {
  return watts >= 1000 ? `${watts / 1000} kW` : `${watts} W`
}

/** Inverter: the listing's P is its rated power; a Pmax stays as text. */
export function toConversionProps(nota: TrikEquipmentNota): EnergyConversionDeviceProps {
  return {
    ...certification(nota),
    ...(nota.ratedPowerW != null ? { power: formatPower(nota.ratedPowerW) } : {}),
  }
}

/** Panel string: the panel rating is its peak power (Wp). */
export function toSolarPanelFacts(nota: TrikEquipmentNota) {
  return { ...certification(nota), ...(nota.maxPowerW != null ? { wattageW: nota.maxPowerW } : {}) }
}

/** Battery: P is its rated power; a Pmax stays as text. */
export function toBatteryFacts(nota: TrikEquipmentNota) {
  return {
    ...certification(nota),
    ...(nota.capacityKWh != null ? { capacityKWh: nota.capacityKWh } : {}),
    ...(nota.ratedPowerW != null ? { powerKw: nota.ratedPowerW / 1000 } : {}),
  }
}

/** Facts this device kind has no field for, kept as text so nothing is lost. */
export function unmappedFactsText(nota: TrikEquipmentNota, kind: 'inverter' | 'solar_panel' | 'battery'): string[] {
  const lines: string[] = []
  if (kind !== 'solar_panel' && nota.maxPowerW != null) lines.push(`Pmax: ${formatPower(nota.maxPowerW)}`)
  if (kind === 'solar_panel' && nota.ratedPowerW != null) lines.push(`P: ${formatPower(nota.ratedPowerW)}`)
  if (kind !== 'battery' && nota.capacityKWh != null) lines.push(`Capaciteit: ${nota.capacityKWh} kWh`)
  return lines
}
