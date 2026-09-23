import type { WireSegment } from '@/types/schema'
import type { Selection } from '@/types/ui'

type WireSelectionMetadata = NonNullable<Selection['wireMetadata']>[number]

/** Resolve a regenerated supply wire using its physical persisted section first. */
export function resolveSupplyWireSegmentByMetadata(
  wireSegments: WireSegment[],
  metadata: WireSelectionMetadata
): WireSegment | null {
  if (metadata.wireAnchor) return wireSegments.find(segment => segment.wireAnchor === metadata.wireAnchor) ?? null
  if (metadata.supplySectionKey) {
    const exactSection = wireSegments.find(
      (segment) =>
        segment.panelId === metadata.panelId &&
        segment.supplySectionKey === metadata.supplySectionKey
    )
    if (exactSection) return exactSection
  }

  if (metadata.supplyAssemblyId && metadata.supplyConnectionId) {
    const exactConnection = wireSegments.find(
      (segment) =>
        segment.panelId === metadata.panelId &&
        segment.supplyAssemblyId === metadata.supplyAssemblyId &&
        segment.supplyConnectionId === metadata.supplyConnectionId
    )
    if (exactConnection) return exactConnection
  }

  if (!metadata.isSupply) return null
  if (metadata.supplyWireRole) {
    const sameRole = wireSegments.find(
      (segment) =>
        segment.panelId === metadata.panelId &&
        (segment.supplyWireRole === metadata.supplyWireRole ||
          (metadata.supplyWireRole === 'downstream' &&
            segment.type === 'vertical' &&
            !segment.circuitId &&
            !segment.fromElementType)) &&
        (metadata.supplyWireRole !== 'crossing' || segment.isSupplyTrunk === true)
    )
    if (sameRole) return sameRole
  }
  if (metadata.supplySegmentIndex !== undefined) {
    const sameIndex = wireSegments.find(
      (segment) =>
        segment.isSupplyTrunk === true &&
        segment.panelId === metadata.panelId &&
        segment.supplySegmentIndex === metadata.supplySegmentIndex
    )
    if (sameIndex) return sameIndex
  }
  return (
    wireSegments.find(
      (segment) =>
        segment.type === 'vertical' &&
        !segment.circuitId &&
        !segment.fromElementType &&
        segment.panelId === metadata.panelId
    ) ?? null
  )
}

/** Resolve a regenerated circuit wire from stable electrical identity rather than its transient ID. */
export function resolveCircuitWireSegmentByMetadata(
  wireSegments: WireSegment[],
  metadata: WireSelectionMetadata
): WireSegment | null {
  if (metadata.wireAnchor) return wireSegments.find(segment => segment.wireAnchor === metadata.wireAnchor) ?? null
  if (!metadata.circuitId) return null
  const candidates = wireSegments.filter(
    (segment) => segment.circuitId === metadata.circuitId && segment.panelId === metadata.panelId
  )
  const domainMatches = (segment: WireSegment) =>
    metadata.domain == null || segment.domain === metadata.domain
  const endpointsMatch = (segment: WireSegment) =>
    (metadata.fromElementId == null || segment.fromElementId === metadata.fromElementId) &&
    (metadata.toElementId == null || segment.toElementId === metadata.toElementId)
  const hasEndpointIdentity = metadata.fromElementId != null || metadata.toElementId != null

  if (hasEndpointIdentity) {
    const exact = candidates.find(
      (segment) =>
        (metadata.type == null || segment.type === metadata.type) &&
        domainMatches(segment) &&
        endpointsMatch(segment)
    )
    if (exact) return exact
    return null
  }

  if (metadata.type != null || metadata.domain != null) {
    const sameKind = candidates.find(
      (segment) =>
        (metadata.type == null || segment.type === metadata.type) && domainMatches(segment)
    )
    if (sameKind) return sameKind
  }

  // Legacy metadata did not retain type/domain; keep its former vertical fallback.
  return candidates.find((segment) => segment.type === 'vertical') ?? null
}
