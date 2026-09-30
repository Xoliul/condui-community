import type { CableSpec, WireSegment } from '@/types/schema'
import { formatCableTypeLabel } from '@/lib/wireTextLabel'

export type WireTranslateFn = (key: string, options?: string | Record<string, unknown>) => string

function resolveTranslate(t?: WireTranslateFn): WireTranslateFn {
  return (
    t ??
    ((key, options) => {
      if (key === 'wires.lengthWithUnit' && options && typeof options !== 'string') {
        return `${String(options.value)} m`
      }
      return typeof options === 'string' ? options : key
    })
  )
}

export function formatWireLengthNumber(lengthM: number): string {
  const rounded = Math.round(lengthM * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

export function formatWireLengthMeters(lengthM: number, t?: WireTranslateFn): string {
  const translate = resolveTranslate(t)
  return translate('wires.lengthWithUnit', { value: formatWireLengthNumber(lengthM) })
}

export function getWireLengthLabel(wire: WireSegment, t?: WireTranslateFn): string | undefined {
  if (wire.wireLengthM == null || wire.wireLengthM <= 0) return undefined
  const label = formatWireLengthMeters(wire.wireLengthM, t)
  // An accepted plan estimate must never read as a measured length on a drawing.
  return wire.wireLengthEstimated ? `≈ ${label}` : label
}

export function isHardwareTallyWireSegment(segment: WireSegment): boolean {
  if (segment.type === 'mainBus' || segment.type === 'secondaryBus') return false
  if (segment.supplyMergedIntoBusDrop) return false
  // The short bus-to-protection stub is drawn with the panel-bus minimum
  // cable. It is internal distribution, not the circuit cable to install.
  if (segment.toElementType === 'protection') return false
  // A protection-to-secondary-bus link is internal panel distribution, not an
  // installed cable run. The incoming secondary-panel bus stub is the same.
  if (segment.toElementType === 'secondaryBus' || segment.isSubPanelSupply) return false
  return true
}

function normalizeCableForFingerprint(cable: CableSpec): string {
  return JSON.stringify({
    kind: cable.kind,
    conductors: cable.conductors,
    sectionMm2: cable.sectionMm2,
    hasPE: cable.hasPE ?? false,
    fireClass: cable.fireClass ?? null,
    customKind: cable.customKind?.trim() || null,
  })
}

export function wireSegmentFingerprint(segment: WireSegment): string {
  const route =
    segment.wireRoute ?? (segment.inWall ? 'wall' : segment.inWall === false ? 'air' : 'none')
  return JSON.stringify({
    cable: normalizeCableForFingerprint(segment.cable),
    domain: segment.domain ?? 'AC',
    inTube: segment.inTube ?? false,
    wireRoute: route,
    inWall: segment.inWall ?? false,
  })
}

export function formatWireTallySummaryLabel(segment: WireSegment, t: WireTranslateFn): string {
  const type = formatCableTypeLabel(segment.cable, {
    otherLabel: t('wires.other', 'Other'),
    batteryCableLabel: t('wires.batteryCable', 'Battery cable'),
  })
  const conductors = segment.cable.conductors
  const hasPE = segment.cable.hasPE ?? false
  const thickness = segment.cable.sectionMm2
  const spec = hasPE ? `${type} ${conductors}G${thickness}` : `${type} ${conductors}x${thickness}`

  const extras: string[] = []
  if (segment.cable.fireClass) extras.push(segment.cable.fireClass)
  if (segment.inTube) extras.push(t('wires.inTube', 'Tube'))
  const route = segment.wireRoute ?? (segment.inWall ? 'wall' : undefined)
  if (route === 'wall') {
    extras.push(segment.inWall ? t('wires.inWall', 'In wall') : t('wires.onWall', 'On wall'))
  } else if (route === 'ground') {
    extras.push(t('wires.inGround', 'Ground'))
  } else if (route === 'air') {
    extras.push(t('wires.inAir', 'Air'))
  }
  if ((segment.domain ?? 'AC') === 'DC') extras.push(t('wires.domainDc', 'DC'))

  return extras.length > 0 ? `${spec} (${extras.join(', ')})` : spec
}
