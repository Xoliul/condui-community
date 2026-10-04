import type { Endpoint, EnergyConversionDeviceProps, TrunkDevice } from '@/types/schema'
import { getScopedControlLinkNote } from '@/lib/controlLink/controlLinkNoteContext'
import { CERTIFICATION_LISTING_VISIBILITY_KEY, formatCompactDiagramField } from '@/lib/certificationLabels'

/** Inline supplies start compact; an explicit visibility choice is preserved. */
export function hideInlineConverterMetadataByDefault(endpoint: Endpoint): void {
  if (endpoint.symbol !== 'inverter' && endpoint.symbol !== 'rectifier') return
  endpoint.symbolLabelDisplay = {
    ...endpoint.symbolLabelDisplay,
    visibility: {
      [CERTIFICATION_LISTING_VISIBILITY_KEY]: false,
      ...endpoint.symbolLabelDisplay?.visibility,
    },
  }
}

type ConversionSource =
  | Pick<
      Endpoint,
      'symbolLabelDisplay' | 'energyConversionProps' | 'solarPanelProps' | 'batteryProps' | 'symbol'
    >
  | Pick<
      TrunkDevice,
      'symbolLabelDisplay' | 'conversionProps' | 'solarPanelProps' | 'batteryProps' | 'symbol'
    >

export type ConversionLabelKey =
  | 'conversionTransformerLabel'
  | 'conversionPmaxPrimary'
  | 'conversionPmaxSecondary'
  | 'solarPower'
  | 'solarVoltage'
  | 'batteryVoltage'
  | 'batteryCapacity'

export interface ConversionLabelPart {
  key: ConversionLabelKey
  text: string
}

const DEFAULT_VISIBILITY: Record<ConversionLabelKey, boolean> = {
  conversionTransformerLabel: true,
  conversionPmaxPrimary: true,
  conversionPmaxSecondary: true,
  solarPower: true,
  solarVoltage: true,
  batteryVoltage: true,
  batteryCapacity: true,
}

export function isConversionLabelVisible(
  source: ConversionSource,
  key: ConversionLabelKey
): boolean {
  const configured = source.symbolLabelDisplay?.visibility?.[key]
  if (typeof configured === 'boolean') return configured
  return DEFAULT_VISIBILITY[key]
}

/**
 * One-wire note text for an endpoint. A valid control link replaces the endpoint's own
 * notes (and their visibility flag) with the resolved link text. Callers outside a
 * layout scope pass linkedNoteText explicitly (see getEndpointOneWireNoteText).
 */
export function getVisibleEndpointNoteText(
  endpoint: Pick<Endpoint, 'notes' | 'notesVisible' | 'domoticaChildProps' | 'symbol'> & {
    id?: string
  },
  linkedNoteText?: string
): string {
  if (endpoint.domoticaChildProps && endpoint.symbol !== 'domotica') return ''
  const linked =
    linkedNoteText ?? (endpoint.id ? getScopedControlLinkNote(endpoint.id) : undefined)
  if (linked) return linked
  if (endpoint.notesVisible === false) return ''
  return (endpoint.notes ?? '').trim()
}

export function getVisibleConversionLabelParts(source: ConversionSource): ConversionLabelPart[] {
  const props = source as {
    conversionProps?: EnergyConversionDeviceProps
    energyConversionProps?: EnergyConversionDeviceProps
  }
  const conversionProps = props.conversionProps ?? props.energyConversionProps

  const transformerLabel = (
    source.symbol === 'transformer' ? conversionProps?.transformerOverlayLabel : ''
  )?.trim()
  const pMaxPrimary = (conversionProps?.pMaxPrimaryW ?? '').trim()
  const pMaxSecondary = (conversionProps?.pMaxSecondaryW ?? '').trim()
  const solarPower =
    'solarPanelProps' in source && source.solarPanelProps?.wattageW != null
      ? `${source.solarPanelProps.wattageW}Wp`
      : ''
  const solarVoltage =
    'solarPanelProps' in source && source.solarPanelProps?.voltageV != null
      ? `${source.solarPanelProps.voltageV}V`
      : ''
  const batteryVoltage =
    'batteryProps' in source && source.batteryProps?.voltageV != null
      ? `${source.batteryProps.voltageV}V`
      : ''
  const batteryCapacity =
    'batteryProps' in source && source.batteryProps?.capacityKWh != null
      ? `${source.batteryProps.capacityKWh}kWh`
      : ''

  const parts: ConversionLabelPart[] = []
  if (transformerLabel && isConversionLabelVisible(source, 'conversionTransformerLabel')) {
    parts.push({ key: 'conversionTransformerLabel', text: transformerLabel })
  }
  if (pMaxPrimary && isConversionLabelVisible(source, 'conversionPmaxPrimary')) {
    parts.push({ key: 'conversionPmaxPrimary', text: `Uprim: ${pMaxPrimary}` })
  }
  if (pMaxSecondary && isConversionLabelVisible(source, 'conversionPmaxSecondary')) {
    parts.push({ key: 'conversionPmaxSecondary', text: `Usec: ${pMaxSecondary}` })
  }
  if (source.symbol === 'solar_panel' && isConversionLabelVisible(source, 'solarPower')) {
    parts.push({ key: 'solarPower', text: formatCompactDiagramField('P', solarPower) })
  }
  if (solarVoltage && isConversionLabelVisible(source, 'solarVoltage')) {
    parts.push({ key: 'solarVoltage', text: `U: ${solarVoltage}` })
  }
  if (batteryVoltage && isConversionLabelVisible(source, 'batteryVoltage')) {
    parts.push({ key: 'batteryVoltage', text: `U: ${batteryVoltage}` })
  }
  if (batteryCapacity && isConversionLabelVisible(source, 'batteryCapacity')) {
    parts.push({ key: 'batteryCapacity', text: `C: ${batteryCapacity}` })
  }
  return parts
}
