import i18n from '@/lib/i18n/domainI18n'
import type {
  Endpoint,
  EnergyConversionDeviceProps,
  SymbolLabelDisplayConfig,
  TrunkDevice,
} from '@/types/schema'
import { isSymbolLabelVisible } from '@/lib/symbolLabels'

export const CERTIFICATION_LISTING_VISIBILITY_KEY = 'certificationListing'

export type CertificationLabelKey =
  | 'certificationBrand'
  | 'certificationModel'
  | 'certificationSerial'
  | 'certificationPower'

export interface CertificationLabelPart {
  key: CertificationLabelKey
  text: string
}

export type CertificationLabelSource =
  | Pick<
      Endpoint,
      | 'symbol'
      | 'symbolLabelDisplay'
      | 'energyConversionProps'
      | 'evChargerProps'
      | 'batteryProps'
      | 'solarPanelProps'
    >
  | Pick<
      TrunkDevice,
      'symbol' | 'symbolLabelDisplay' | 'conversionProps' | 'solarPanelProps' | 'batteryProps'
    >

const CERT_FIELD_LABEL_KEYS = {
  brand: 'endpoints.certification.brand',
  model: 'endpoints.certification.model',
} as const

const DIAGRAM_POWER_PREFIX = 'P'
const COMPACT_VALUE_THRESHOLD = 5

/** Keep an empty/short field identifiable, but drop its redundant prefix for long values. */
export function formatCompactDiagramField(prefix: string, value: string | undefined): string {
  const text = (value ?? '').trim()
  if (!text) return `${prefix}:`
  return text.length > COMPACT_VALUE_THRESHOLD ? text : `${prefix}: ${text}`
}

function conversionPropsFromSource(
  source: CertificationLabelSource
): EnergyConversionDeviceProps | undefined {
  const props = source as {
    conversionProps?: EnergyConversionDeviceProps
    energyConversionProps?: EnergyConversionDeviceProps
  }
  return props.conversionProps ?? props.energyConversionProps
}

export function isCertificationListingVisible(
  config: SymbolLabelDisplayConfig | undefined
): boolean {
  return isSymbolLabelVisible(config, CERTIFICATION_LISTING_VISIBILITY_KEY, true)
}

function certificationLine(
  key: CertificationLabelKey,
  labelKey: string,
  value: string | number | undefined,
  compactLongValue = false
): CertificationLabelPart {
  const label = i18n.t(labelKey)
  if (value === undefined || value === null) {
    return { key, text: `${label}:` }
  }
  const text = typeof value === 'number' ? String(value) : value.trim()
  return {
    key,
    text: compactLongValue
      ? formatCompactDiagramField(label, text)
      : text
        ? `${label}: ${text}`
        : `${label}:`,
  }
}

/** Serial numbers: values only, one line per physical unit. Omitted when empty. */
function serialNumberLine(value: string | string[] | undefined): CertificationLabelPart | null {
  const values = (Array.isArray(value) ? value : [value])
    .map((candidate) => (candidate ?? '').trim())
    .filter(Boolean)
  if (values.length === 0) return null
  return { key: 'certificationSerial', text: values.join('\n') }
}

/** Power: short `P:` prefix on the one-wire (all languages). */
function powerLine(value: string | undefined): CertificationLabelPart {
  return {
    key: 'certificationPower',
    text: formatCompactDiagramField(DIAGRAM_POWER_PREFIX, value),
  }
}

function inverterRectifierParts(
  props: Endpoint['energyConversionProps'] | TrunkDevice['conversionProps'] | undefined
): CertificationLabelPart[] {
  return [
    certificationLine('certificationBrand', CERT_FIELD_LABEL_KEYS.brand, props?.brand, true),
    certificationLine('certificationModel', CERT_FIELD_LABEL_KEYS.model, props?.model, true),
    serialNumberLine(
      props?.serialNumbers?.some((serialNumber) => serialNumber.trim().length > 0)
        ? props.serialNumbers
        : props?.serialNumber
    ),
    powerLine(props?.power),
  ].filter((part): part is CertificationLabelPart => part != null)
}

function evChargerParts(props: Endpoint['evChargerProps'] | undefined): CertificationLabelPart[] {
  return [
    certificationLine('certificationBrand', CERT_FIELD_LABEL_KEYS.brand, props?.brand),
    certificationLine('certificationModel', CERT_FIELD_LABEL_KEYS.model, props?.model),
    serialNumberLine(props?.serialNumber),
  ].filter((part): part is CertificationLabelPart => part != null)
}

function batteryParts(
  props: Endpoint['batteryProps'] | TrunkDevice['batteryProps'] | undefined
): CertificationLabelPart[] {
  const powerValue =
    props?.powerKw != null && Number.isFinite(props.powerKw) ? `${props.powerKw}kW` : undefined
  return [
    certificationLine('certificationBrand', CERT_FIELD_LABEL_KEYS.brand, props?.brand, true),
    certificationLine('certificationModel', CERT_FIELD_LABEL_KEYS.model, props?.model, true),
    serialNumberLine(
      props?.serialNumbers?.some((serialNumber) => serialNumber.trim().length > 0)
        ? props.serialNumbers
        : props?.serialNumber
    ),
    powerLine(powerValue),
  ].filter((part): part is CertificationLabelPart => part != null)
}

function solarPanelParts(
  props: Endpoint['solarPanelProps'] | TrunkDevice['solarPanelProps'] | undefined
): CertificationLabelPart[] {
  return [
    certificationLine('certificationBrand', CERT_FIELD_LABEL_KEYS.brand, props?.brand, true),
    certificationLine('certificationModel', CERT_FIELD_LABEL_KEYS.model, props?.model, true),
    serialNumberLine(
      props?.serialNumbers?.some((serialNumber) => serialNumber.trim().length > 0)
        ? props.serialNumbers
        : props?.serialNumber
    ),
  ].filter((part): part is CertificationLabelPart => part != null)
}

export function getVisibleCertificationLabelParts(
  source: CertificationLabelSource
): CertificationLabelPart[] {
  if (!isCertificationListingVisible(source.symbolLabelDisplay)) return []

  const symbol = source.symbol

  if (symbol === 'inverter' || symbol === 'rectifier') {
    return inverterRectifierParts(conversionPropsFromSource(source))
  }

  if (symbol === 'ev' && 'evChargerProps' in source) {
    return evChargerParts(source.evChargerProps)
  }

  if (symbol === 'battery' && 'batteryProps' in source) {
    return batteryParts(source.batteryProps)
  }

  if (symbol === 'solar_panel' && 'solarPanelProps' in source) {
    return solarPanelParts(source.solarPanelProps)
  }

  return []
}
