import type { Circuit, ElectricalDomain, WireSegment } from '@/types/schema'

type CircuitSectionOverride = NonNullable<Circuit['sectionWireOverrides']>[number]

export interface CircuitSectionRef {
  fromElementType?: 'mainBus' | 'secondaryBus' | 'protection' | 'endpoint'
  fromElementId?: string
  toElementType?: 'protection' | 'endpoint'
  toElementId?: string
  domain?: ElectricalDomain
  /** Manual riser k (`Branch.stem`): its own cable section from the protection. Absent or 0 = the trunk. */
  riserStem?: number
}

const stemOf = (entry: { riserStem?: number }): number => entry.riserStem ?? 0

export function getSubPanelFeederSectionRef(
  protectionId: string | undefined,
  subPanelId: string,
  domain: ElectricalDomain
): CircuitSectionRef {
  return {
    fromElementType: 'protection',
    fromElementId: protectionId,
    toElementType: 'endpoint',
    toElementId: subPanelId,
    domain,
  }
}

export function findSubPanelFeederWireOverride(
  circuit: Circuit,
  protectionId: string | undefined,
  subPanelId: string,
  domain: ElectricalDomain
): CircuitSectionOverride | undefined {
  return (
    findSectionWireOverride(circuit, getSubPanelFeederSectionRef(protectionId, subPanelId, domain)) ??
    findSectionWireOverride(circuit, {
      fromElementType: 'mainBus',
      toElementType: 'endpoint',
      toElementId: subPanelId,
      domain,
    }) ??
    findSectionWireOverride(circuit, {
      fromElementType: 'secondaryBus',
      toElementType: 'endpoint',
      toElementId: subPanelId,
      domain,
    }) ??
    findSectionWireOverride(circuit, {
      fromElementType: 'mainBus',
      toElementType: 'protection',
      toElementId: protectionId,
      domain,
    }) ??
    findSectionWireOverride(circuit, {
      fromElementType: 'secondaryBus',
      toElementType: 'protection',
      toElementId: protectionId,
      domain,
    }) ??
    findSectionWireOverride(circuit, {
      fromElementType: 'protection',
      fromElementId: protectionId,
      domain,
    })
  )
}

export function getSectionRefFromWireSegment(wireSegment: WireSegment): CircuitSectionRef | null {
  if (wireSegment.type !== 'vertical' || !wireSegment.circuitId) return null
  if (
    wireSegment.feederProtectionId &&
    wireSegment.toElementType === 'endpoint' &&
    wireSegment.toElementId
  ) {
    return getSubPanelFeederSectionRef(
      wireSegment.feederProtectionId,
      wireSegment.toElementId,
      wireSegment.domain ?? 'AC'
    )
  }
  if (wireSegment.isSubPanelSupply && wireSegment.feederProtectionId) {
    return getSubPanelFeederSectionRef(
      wireSegment.feederProtectionId,
      wireSegment.panelId,
      wireSegment.domain ?? 'AC'
    )
  }
  const fromType = wireSegment.fromElementType
  if (
    fromType !== 'mainBus' &&
    fromType !== 'secondaryBus' &&
    fromType !== 'protection' &&
    fromType !== 'endpoint'
  ) {
    return null
  }
  return {
    fromElementType: fromType,
    fromElementId: wireSegment.fromElementId,
    toElementType:
      wireSegment.toElementType === 'protection' || wireSegment.toElementType === 'endpoint'
        ? wireSegment.toElementType
        : undefined,
    toElementId: wireSegment.toElementId,
    domain: wireSegment.domain,
  }
}

/**
 * Like {@link findSectionWireOverride}, but when the section is main/secondary bus → endpoint
 * and no exact match exists, fall back to the same bus → feeder protection override (legacy
 * projects stored cable/route on the bus stub before bus→endpoint was merged).
 */
export function findSectionWireOverrideWithFeederFallback(
  circuit: Circuit,
  sectionRef: CircuitSectionRef | null,
  feederProtectionId?: string,
): CircuitSectionOverride | undefined {
  if (!sectionRef) return undefined
  const direct = findSectionWireOverride(circuit, sectionRef)
  if (direct) return direct
  if (
    feederProtectionId &&
    sectionRef.toElementType === 'endpoint' &&
    (sectionRef.fromElementType === 'mainBus' || sectionRef.fromElementType === 'secondaryBus')
  ) {
    return findSectionWireOverride(circuit, {
      ...sectionRef,
      toElementType: 'protection',
      toElementId: feederProtectionId,
    })
  }
  return undefined
}

export function findSectionWireOverride(
  circuit: Circuit,
  sectionRef: CircuitSectionRef | null
): CircuitSectionOverride | undefined {
  if (!sectionRef) return undefined
  const exact = (circuit.sectionWireOverrides ?? []).find((entry) =>
    stemOf(entry as { riserStem?: number }) === stemOf(sectionRef) &&
    entry.fromElementType === sectionRef.fromElementType &&
    entry.fromElementId === sectionRef.fromElementId &&
    entry.toElementType === sectionRef.toElementType &&
    entry.toElementId === sectionRef.toElementId &&
    entry.domain === sectionRef.domain
  )
  if (exact) return exact
  // Backward/forward compatibility for entries created without domain key.
  return (circuit.sectionWireOverrides ?? []).find((entry) =>
    stemOf(entry as { riserStem?: number }) === stemOf(sectionRef) &&
    entry.fromElementType === sectionRef.fromElementType &&
    entry.fromElementId === sectionRef.fromElementId &&
    entry.toElementType === sectionRef.toElementType &&
    entry.toElementId === sectionRef.toElementId &&
    (entry.domain === undefined || sectionRef.domain === undefined)
  )
}

export function upsertSectionWireOverride(
  circuit: Circuit,
  sectionRef: CircuitSectionRef,
  updates: Partial<CircuitSectionOverride>
): CircuitSectionOverride[] {
  const overrides = [...(circuit.sectionWireOverrides ?? [])]
  const index = overrides.findIndex((entry) =>
    stemOf(entry as { riserStem?: number }) === stemOf(sectionRef) &&
    entry.fromElementType === sectionRef.fromElementType &&
    entry.fromElementId === sectionRef.fromElementId &&
    entry.toElementType === sectionRef.toElementType &&
    entry.toElementId === sectionRef.toElementId &&
    entry.domain === sectionRef.domain
  )
  const nextEntry: CircuitSectionOverride = {
    ...(index >= 0 ? overrides[index] : sectionRef),
    ...updates,
  }
  if (index >= 0) overrides[index] = nextEntry
  else overrides.push(nextEntry)
  return overrides
}
