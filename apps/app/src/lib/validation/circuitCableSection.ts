import { selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
/**
 * Circuit cable cross-section resolution for validation (matches primitives logic).
 * Derived layout wires can differ from stored one-wire segments; validation uses derived when available.
 */
import type { ProtectionType, WireSegment } from '@/types/schema'
import type { ElectricalDomain } from '@/types/schema'
import type { InstallationQueryAPI } from '@/lib/validation/core/query-api'
import { calculateBottomUpLayout } from '@/lib/layout/bottomUpLayout'
import { buildLayoutTree } from '@/lib/layout/layoutTree'
import { deriveWires } from '@/lib/layout/deriveWires'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'

/** AREI Book 1 table 4.11: max circuit-breaker rating (A) per conductor section (mm²). */
export const MAX_BREAKER_BY_SECTION: Record<number, number> = {
  0.5: 4,
  0.75: 6,
  1: 10,
  1.5: 16,
  2.5: 20,
  4: 25,
  6: 40,
  10: 63,
  16: 80,
  25: 100,
  35: 125,
}

/** AREI Book 1 table 4.11: max fuse rating (A) per conductor section (mm²). */
export const MAX_FUSE_BY_SECTION: Record<number, number> = {
  0.5: 2,
  0.75: 4,
  1: 6,
  1.5: 10,
  2.5: 16,
  4: 20,
  6: 32,
  10: 50,
  16: 63,
  25: 80,
  35: 100,
}

export function getMaxProtectionRatingForSection(
  sectionMm2: number,
  protectionType: ProtectionType
): number | undefined {
  return (protectionType === 'FUSE' ? MAX_FUSE_BY_SECTION : MAX_BREAKER_BY_SECTION)[sectionMm2]
}

/**
 * Vertical tap from the panel main or RCD trunk bus into a protection device (MCB/RCBO) or RCD.
 * Uses the circuit’s default cable in the layout model but is not the conductor *after* the breaker;
 * it must not drive breaker-vs-cross-section or minimum cable size for the circuit.
 */
export function isPanelBusTapToProtectionOrRcd(segment: WireSegment): boolean {
  const from = segment.fromElementType
  if (from !== 'mainBus' && from !== 'secondaryBus') return false
  return segment.toElementType === 'protection' || segment.toElementType === 'rcd'
}

/**
 * Match {@link getCircuitMinSectionForCableProtectedByDevice} on a concrete segment list (e.g. current
 * `deriveWires` output). Validation often references derived segment ids from an earlier layout pass;
 * those ids do not match live eendraad segments, so the UI re-resolves weakest AC section here.
 */
export function resolveLiveWireSegmentsForMinimumCrossSectionFocus(
  liveSegments: WireSegment[],
  circuitId: string,
  protectionId: string | undefined,
  getCrossSection: (s: WireSegment) => number | undefined,
  options?: { domain?: ElectricalDomain },
): WireSegment[] {
  const domainFilter = options?.domain ?? 'AC'
  const pool = liveSegments.filter(
    (ws) =>
      ws.circuitId === circuitId &&
      (Math.abs(ws.startPoint.x - ws.endPoint.x) > 0.001 ||
        Math.abs(ws.startPoint.y - ws.endPoint.y) > 0.001)
  )

  const pickMinSectionSegments = (candidates: WireSegment[]): WireSegment[] => {
    let minSection: number | undefined
    let out: WireSegment[] = []
    for (const segment of candidates) {
      const section = getCrossSection(segment)
      if (section == null || section <= 0) continue
      if (minSection == null || section < minSection) {
        minSection = section
        out = [segment]
      } else if (section === minSection) {
        out.push(segment)
      }
    }
    return out
  }

  if (protectionId) {
    const downstream = pool.filter((segment) => {
      if (segment.fromElementType !== 'protection' || segment.fromElementId !== protectionId) return false
      if (domainFilter && segment.domain != null && segment.domain !== domainFilter) return false
      return true
    })
    const picked = pickMinSectionSegments(downstream)
    if (picked.length > 0) return picked
  }

  const allCircuit = pool.filter((segment) => {
    if (isPanelBusTapToProtectionOrRcd(segment)) return false
    if (domainFilter && segment.domain !== domainFilter) return false
    return true
  })
  return pickMinSectionSegments(allCircuit)
}

/** Prefer the first visible DC segment directly leaving a conversion device. */
export function pickRootmostLiveDcWireSegmentForFocus(
  segments: WireSegment[],
  conversionDeviceIds: ReadonlySet<string>
): WireSegment | undefined {
  const dcSegments = segments.filter((segment) => segment.domain === 'DC')
  return (
    dcSegments.find(
      (segment) =>
        segment.type === 'vertical' &&
        segment.fromElementId != null &&
        conversionDeviceIds.has(segment.fromElementId)
    ) ??
    dcSegments.find(
      (segment) => segment.type === 'vertical' && segment.fromElementId != null
    ) ??
    dcSegments[0]
  )
}

/** Pick one visible root circuit wire so validation focus opens a single property editor. */
export function pickRootmostLiveCircuitWireSegmentForFocus(
  segments: WireSegment[],
  circuitId: string,
  protectionId?: string,
  domain?: ElectricalDomain
): WireSegment | undefined {
  const candidates = segments.filter(
    (segment) =>
      segment.circuitId === circuitId &&
      (domain == null || segment.domain === domain) &&
      (Math.abs(segment.startPoint.x - segment.endPoint.x) > 0.001 ||
        Math.abs(segment.startPoint.y - segment.endPoint.y) > 0.001)
  )
  return (
    candidates.find(
      (segment) =>
        protectionId != null &&
        segment.fromElementType === 'protection' &&
        segment.fromElementId === protectionId
    ) ??
    candidates.find((segment) => segment.type === 'vertical') ??
    candidates[0]
  )
}

export function getCircuitSegmentsForValidation(query: InstallationQueryAPI, circuitId: string): {
  segments: WireSegment[]
  source: 'stored' | 'derived'
} {
  const storedSegments = (query.getCableSegments(circuitId) ?? []).filter((segment) => segment.circuitId === circuitId)
  let derivedSegments: WireSegment[] = []
  try {
    const project = (query as { project?: import('@/types/projectV2').ProjectV2 }).project
    if (project) {
      const layout = calculateBottomUpLayout(project, new Map())
      const tree = buildLayoutTree(layout)
      const installation = getProjectElectricalInstallation(project)
      if (installation) {
        derivedSegments = deriveWires(tree, getProjectElectricalPanels(project), installation, [], undefined, selectProjectWireRuns(project)).filter(
          (segment) => segment.circuitId === circuitId
        )
      }
    }
  } catch {
    // Ignore derive failures and fall back to stored segments only.
  }
  if (derivedSegments.length > 0) return { segments: derivedSegments, source: 'derived' }
  return { segments: storedSegments, source: 'stored' }
}

export function getCircuitMinSegmentSection(
  query: InstallationQueryAPI,
  circuitId: string,
  options?: { domain?: ElectricalDomain }
): {
  minSection: number | undefined
  minSegmentIds: string[]
  source: 'stored' | 'derived'
} {
  const { segments, source } = getCircuitSegmentsForValidation(query, circuitId)
  const domainFilter = options?.domain
  let minSection: number | undefined
  let minSegmentIds: string[] = []
  for (const segment of segments) {
    if (isPanelBusTapToProtectionOrRcd(segment)) continue
    if (domainFilter && segment.domain !== domainFilter) continue
    const section = query.getCrossSection(segment)
    if (section == null || section <= 0) continue
    if (minSection == null || section < minSection) {
      minSection = section
      minSegmentIds = [segment.id]
    } else if (section === minSection) {
      minSegmentIds.push(segment.id)
    }
  }
  return { minSection, minSegmentIds, source }
}

/**
 * Segments that leave the circuit's overcurrent device (protection → …).
 * Bus→protection taps are excluded separately in {@link getCircuitMinSegmentSection} when falling back.
 */
export function getCircuitMinSectionDownstreamOfProtection(
  query: InstallationQueryAPI,
  circuitId: string,
  protectionId: string,
  options?: { domain?: ElectricalDomain }
): {
  minSection: number | undefined
  minSegmentIds: string[]
  source: 'stored' | 'derived'
} {
  const { segments, source } = getCircuitSegmentsForValidation(query, circuitId)
  const domainFilter = options?.domain
  const downstream = segments.filter((segment) => {
    if (segment.fromElementType !== 'protection' || segment.fromElementId !== protectionId) return false
    if (domainFilter && segment.domain != null && segment.domain !== domainFilter) return false
    return true
  })

  let minSection: number | undefined
  let minSegmentIds: string[] = []
  for (const segment of downstream) {
    const section = query.getCrossSection(segment)
    if (section == null || section <= 0) continue
    if (minSection == null || section < minSection) {
      minSection = section
      minSegmentIds = [segment.id]
    } else if (section === minSection) {
      minSegmentIds.push(segment.id)
    }
  }
  return { minSection, minSegmentIds, source }
}

/**
 * Prefer cross-section on segments immediately downstream of the circuit breaker; if none, fall back to min over circuit segments
 * (excluding panel bus→protection/RCD taps — those never count as the protected circuit run).
 */
export function getCircuitMinSectionForCableProtectedByDevice(
  query: InstallationQueryAPI,
  circuitId: string,
  protectionId: string | undefined,
  options?: { domain?: ElectricalDomain }
): {
  minSection: number | undefined
  minSegmentIds: string[]
  source: 'stored' | 'derived'
  basis: 'downstream-of-protection' | 'all-circuit-segments'
} {
  if (protectionId) {
    const d = getCircuitMinSectionDownstreamOfProtection(query, circuitId, protectionId, options)
    if (d.minSection != null && d.minSection > 0) {
      return { ...d, basis: 'downstream-of-protection' }
    }
  }
  const fb = getCircuitMinSegmentSection(query, circuitId, options)
  return { ...fb, basis: 'all-circuit-segments' }
}

/** Fields the UI / devtools can log to see why cable rules fired. */
export function buildCircuitCableValidationDebug(
  query: InstallationQueryAPI,
  circuitId: string
): {
  circuitId: string
  circuitCode: string
  circuitKind: string
  circuitDefaultCableSectionMm2: number | undefined
  segmentListSource: 'stored' | 'derived'
  effectiveSectionMm2: number | undefined
  minAcSegmentIds: string[]
  acSegments: Array<{
    id: string
    type: string | undefined
    domain: string | undefined
    sectionMm2: number | undefined
    cable: WireSegment['cable']
    fromElementType: string | undefined
    fromElementId: string | undefined
    toElementType: string | undefined
    toElementId: string | undefined
  }>
  upstreamProtectionId: string | undefined
  upstreamBreakerRatingA: number | undefined
  maxAdmissibleBreakerAForEffectiveSection: number | undefined
  minimumCrossSectionRequiredMm2: number | null
  sectionResolutionBasis: 'downstream-of-protection' | 'all-circuit-segments'
} | null {
  const circuit = query.getCircuitById(circuitId)
  if (!circuit) return null

  const { segments, source } = getCircuitSegmentsForValidation(query, circuitId)
  const protection = query.getProtectionForCircuit(circuitId)
  const {
    minSection,
    minSegmentIds,
    basis: sectionResolutionBasis,
  } = getCircuitMinSectionForCableProtectedByDevice(query, circuitId, protection?.id, { domain: 'AC' })
  const circuitDefault = circuit.cable?.sectionMm2 && circuit.cable.sectionMm2 > 0 ? circuit.cable.sectionMm2 : undefined
  const effectiveSection = minSection ?? circuitDefault

  const kind = query.getCircuitKind(circuitId)
  let minimumCrossSectionRequiredMm2: number | null = null
  switch (kind) {
    case 'lighting':
      minimumCrossSectionRequiredMm2 = 1.5
      break
    case 'sockets':
      minimumCrossSectionRequiredMm2 = 2.5
      break
    case 'stove':
    case 'ev':
      minimumCrossSectionRequiredMm2 = 4
      break
    case 'subpanel':
      minimumCrossSectionRequiredMm2 = null
      break
    case 'empty':
      minimumCrossSectionRequiredMm2 = null
      break
    default:
      minimumCrossSectionRequiredMm2 = 2.5
      break
  }

  const maxAdmissible =
    effectiveSection != null && MAX_BREAKER_BY_SECTION[effectiveSection] != null
      ? MAX_BREAKER_BY_SECTION[effectiveSection]
      : undefined

  const acSegments = segments
    .filter((s) => s.domain === 'AC' || s.domain == null)
    .map((s) => ({
      id: s.id,
      type: s.type,
      domain: s.domain,
      sectionMm2: query.getCrossSection(s),
      cable: s.cable,
      fromElementType: s.fromElementType,
      fromElementId: s.fromElementId,
      toElementType: s.toElementType,
      toElementId: s.toElementId,
    }))

  return {
    circuitId,
    circuitCode: circuit.code,
    circuitKind: kind,
    circuitDefaultCableSectionMm2: circuitDefault,
    segmentListSource: source,
    effectiveSectionMm2: effectiveSection,
    minAcSegmentIds: minSegmentIds,
    sectionResolutionBasis,
    acSegments,
    upstreamProtectionId: protection?.id,
    upstreamBreakerRatingA: protection?.ratingA ?? undefined,
    maxAdmissibleBreakerAForEffectiveSection: maxAdmissible,
    minimumCrossSectionRequiredMm2,
  }
}
