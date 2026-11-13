import { getDerivedWiresForValidation } from '@/lib/validation/derivedWiresForValidation'
import { isWireLengthLabelVisibleForSegment } from '@/lib/wireLabelVisibility'
import { registerPrimitive } from './registry'
import type {
  CheckContext,
  CheckResult,
  Issue,
  Offender,
  Panel,
  Circuit,
  CableSpec,
  WireSegment,
} from './common'
import {
  DEFAULT_ELECTRICAL_DOMAIN,
  MAX_BREAKER_BY_SECTION,
  getMaxProtectionRatingForSection,
  getCircuitMinSectionForCableProtectedByDevice,
  getCircuitSegmentsForValidation,
  cableExplicitlyWithoutPe,
  i18n,
  projectInstallation,
  validationCircuitCode,
  CONSERVATIVE_DC_AMPACITY_BY_SECTION,
  getConservativeAmpacityForSection,
  isPanelPlacementCarrierCircuit,
} from './common'
import { isHouseholdInstallation } from '@/lib/installationProfile'
import { isDomoticaPanelFeedEndpoint } from '@/lib/eendraad/panelSupplyLink'
import { circuitUpstreamProtections, type UpstreamProtection } from '@/lib/validation/upstreamProtection'
import { isPanelBusTapToProtectionOrRcd } from '@/lib/validation/circuitCableSection'
import { getCircuitBranches } from '@/lib/layout/endpointChains'
import {
  isIntermediateProtectionDevice,
  isOvercurrentProtectionType,
} from '@/lib/protectionKind'

/**
 * Check if cable segments have cross-section
 */
function cableHasCrossSection(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query } = context
  if (scope.type !== 'circuit') {
    return { passed: true }
  }

  if (isPanelPlacementCarrierCircuit(query, scope.id)) {
    return { passed: true, coverage: { status: 'skipped', reason: 'panel-placement-carrier-is-not-an-electrical-feed' } }
  }

  const segments = query.getCableSegments(scope.id)
  if (segments.length === 0) {
    return {
      passed: true,
      coverage: {
        status: 'missing-information',
        reason: 'no-modeled-cable-segments',
        missingFacts: ['cable path / conductor segments'],
      },
    }
  }
  const missingCrossSection: Offender[] = []

  for (const segment of segments) {
    const crossSection = query.getCrossSection(segment)
    if (crossSection == null || crossSection <= 0) {
      missingCrossSection.push({
        kind: 'segment',
        id: segment.id,
        viewHint: 'eendraad',
      })
    }
  }

  if (missingCrossSection.length === 0) {
    const missingInstallationMethod = segments.some((segment) => !query.getInstallationMethod(segment))
    return {
      passed: true,
      ...(missingInstallationMethod ? {
        coverage: {
          status: 'missing-information' as const,
          reason: 'cable-section-check-does-not-model-installation-method',
          missingFacts: ['cable installation method'],
        },
      } : { coverage: { status: 'passed' as const } }),
    }
  }

  return {
    passed: false,
    coverage: {
      status: 'missing-information',
      reason: 'cable-cross-section-not-entered',
      missingFacts: ['cable cross-section'],
    },
    offenders: missingCrossSection,
    message: i18n.t('validation.primitives.cableHasCrossSection.message', {
      defaultValue: 'Circuit has cable segments without cross-section',
    }),
    details: i18n.t('validation.primitives.cableHasCrossSection.details', {
      defaultValue: 'All cable segments must have a valid cross-section specified.',
    }),
  }
}

/**
 * Check that the circuit's breaker rating does not exceed the admissible
 * current for the circuit cable cross-section (simple AREI table).
 *
 * AREI 4.4.1.4 limits table 4.11 to household installations. Non-household
 * circuits must satisfy IB ≤ In ≤ Iz for the actual installation method, which
 * this table cannot decide.
 */
function breakerSizeMatchesCrossSection(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query, project } = context
  if (scope.type !== 'circuit') {
    return { passed: true }
  }
  if (!isHouseholdInstallation(projectInstallation(project))) {
    return {
      passed: true,
      coverage: {
        status: 'skipped',
        reason: 'table-4-11-is-household-only',
        missingFacts: ['design current and admissible current Iz for the installation method'],
      },
    }
  }

  const circuit = query.getCircuitById(scope.id)
  if (!circuit) return { passed: true }
  if (isPanelPlacementCarrierCircuit(query, scope.id)) {
    return { passed: true, coverage: { status: 'skipped', reason: 'panel-placement-carrier-is-not-an-electrical-feed' } }
  }
  if ((circuit.endpoints?.length ?? 0) === 0) {
    return { passed: true }
  }
  const kind = query.getCircuitKind(scope.id)
  if (kind === 'empty') {
    return { passed: true }
  }

  const path = circuitUpstreamProtections(context, circuit.id).filter((device) =>
    isOvercurrentProtectionType(device.type)
  )
  const inline = [...(circuit.trunkDevices ?? [])].sort((a, b) => a.trunkPosition - b.trunkPosition)
  const inlineIds = new Set(inline.map(({ id }) => id))
  // Inline devices do not protect their own incoming cable. The ancestry helper
  // includes head devices for final-load checks; here each wire needs its own side.
  const externalPath = path.filter(({ id }) => !inlineIds.has(id))
  const branches = getCircuitBranches(circuit)
  const branchByEndpoint = new Map(branches.flatMap((branch, index) => branch.map(({ id }) => [id, index] as const)))
  const protectionsForSegment = (segment: WireSegment): UpstreamProtection[] => {
    const from = inline.findIndex(({ id }) => id === segment.fromElementId)
    const to = inline.findIndex(({ id }) => id === segment.toElementId)
    const branch = branchByEndpoint.get(segment.fromElementId ?? '') ?? branchByEndpoint.get(segment.toElementId ?? '')
    const beforeSegment = from >= 0
      ? inline.slice(0, from + 1)
      : to >= 0
        ? inline.slice(0, to)
        : segment.fromElementType === 'protection' || segment.fromElementType === 'rcd'
          ? []
          : branch != null ? inline.filter((device) => device.trunkPosition <= branch) : []
    return [
      ...externalPath,
      ...beforeSegment.flatMap((device): UpstreamProtection[] =>
        device.type === 'protection' && isOvercurrentProtectionType(device.protectionType)
          ? [{ ...device, type: device.protectionType!, offenderKind: 'device' }]
          : []
      ),
    ]
  }
  const { segments } = getCircuitSegmentsForValidation(query, circuit.id)
  const acSegments = segments.filter((segment) =>
    (segment.domain ?? DEFAULT_ELECTRICAL_DOMAIN) === 'AC' && !isPanelBusTapToProtectionOrRcd(segment)
  )
  const cableChecks = acSegments.flatMap((segment) => {
    const section = query.getCrossSection(segment)
    return section != null && Number.isFinite(section) && section > 0
      ? [{ section, segmentIds: [segment.id], protections: protectionsForSegment(segment) }]
      : []
  })
  if (cableChecks.length === 0 && circuit.cable?.sectionMm2 > 0) {
    cableChecks.push({ section: circuit.cable.sectionMm2, segmentIds: [], protections: path })
  }
  if (cableChecks.length === 0) {
    return {
      passed: true,
      coverage: { status: 'missing-information', reason: 'cable-section-unavailable', missingFacts: ['cable cross-section'] },
    }
  }
  const assessed = cableChecks.map((check) => {
    const hasUnknownRating = check.protections.some(({ ratingA }) =>
      ratingA == null || !Number.isFinite(ratingA) || ratingA <= 0
    )
    const candidates = check.protections.flatMap((protection) => {
      if (protection.ratingA == null || !Number.isFinite(protection.ratingA) || protection.ratingA <= 0) return []
      const maxRating = getMaxProtectionRatingForSection(check.section, protection.type)
      return maxRating == null ? [] : [{ protection, maxRating, ratio: protection.ratingA / maxRating }]
    }).sort((left, right) => left.ratio - right.ratio)
    return { ...check, effective: candidates[0], hasUnknownRating }
  })
  if (assessed.every(({ protections }) => protections.length === 0)) {
    return {
      passed: true,
      coverage: {
        status: 'missing-information',
        reason: 'breaker-rating-unavailable',
        missingFacts: ['upstream protection rating'],
      },
    }
  }

  // A known safe serial limiter proves the bound even if another rating is
  // unknown. Otherwise that unknown device might be the effective protection;
  // a larger known device alone cannot prove this cable is underprotected.
  const failure = assessed.filter(({ effective, hasUnknownRating }) => effective != null && effective.ratio > 1 && !hasUnknownRating)
    .sort((left, right) => right.effective!.ratio - left.effective!.ratio)[0]
  if (!failure && assessed.some(({ protections, effective, hasUnknownRating }) =>
    protections.length === 0 || (hasUnknownRating && (effective == null || effective.ratio > 1))
  )) {
    return { passed: true, coverage: { status: 'missing-information', reason: 'breaker-rating-unavailable', missingFacts: ['upstream protection rating'] } }
  }
  if (!failure && assessed.some(({ effective }) => effective == null)) {
    // Section not covered by our simplified table; skip check.
    return {
      passed: true,
      coverage: {
        status: 'unavailable',
        reason: 'cross-section-not-covered-by-supported-ampacity-table',
        missingFacts: ['validated ampacity for this cross-section and installation method'],
      },
    }
  }

  if (!failure) {
    const missingInstallationMethod = query.getCableSegments(scope.id).some(
      (segment) => !query.getInstallationMethod(segment)
    )
    return {
      passed: true,
      coverage: missingInstallationMethod
        ? {
            status: 'missing-information',
            reason: 'breaker-ampacity-table-does-not-model-installation-method',
            missingFacts: ['cable installation method'],
          }
        : { status: 'passed' },
    }
  }

  const { section, segmentIds: minSegmentIds } = failure
  const { protection, maxRating } = failure.effective!
  const breakerRating = protection.ratingA!

  return {
    passed: false,
    offenders: [
      ...minSegmentIds.map((id) => ({
        kind: 'segment' as const,
        id,
        viewHint: 'eendraad' as const,
      })),
      { kind: 'circuit', id: circuit.id, viewHint: 'eendraad' },
      { kind: protection.offenderKind, id: protection.id, viewHint: 'eendraad' },
    ],
    message: i18n.t('validation.primitives.breakerSizeMatchesCrossSection.message', {
      circuitCode: validationCircuitCode(circuit.code),
      breakerRating,
      section,
      maxRating,
      defaultValue: `Circuit ${circuit.code}: breaker rating ${breakerRating}A exceeds maximum ${maxRating}A for ${section}mm² cable`,
    }),
    details: i18n.t('validation.primitives.breakerSizeMatchesCrossSection.details', {
      circuitCode: validationCircuitCode(circuit.code),
      breakerRating,
      section,
      maxRating,
      defaultValue: `For circuit ${circuit.code}, the MCB/RCBO rating (${breakerRating}A) is higher than the admissible current for a ${section}mm² copper cable (${maxRating}A) according to AREI tables. Reduce breaker rating or increase cable size.`,
    }),
  }
}

/**
 * Check that the circuit cable meets minimum cross-section for the circuit type.
 * Uses a simplified mapping from AREI 5.2.1.
 */
function minimumCrossSection(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query, project } = context
  if (scope.type !== 'circuit') {
    return { passed: true }
  }

  const circuit = query.getCircuitById(scope.id)
  if (!circuit) return { passed: true }

  const protection = query.getProtectionForCircuit(scope.id)
  const { minSection: segmentMinSection, minSegmentIds } =
    getCircuitMinSectionForCableProtectedByDevice(query, scope.id, protection?.id, { domain: 'AC' })
  let section =
    segmentMinSection ??
    (circuit.cable?.sectionMm2 && circuit.cable.sectionMm2 > 0
      ? circuit.cable.sectionMm2
      : undefined)
  if (section == null || section <= 0) {
    return {
      passed: true,
      coverage: {
        status: 'missing-information',
        reason: 'cable-section-unavailable',
        missingFacts: ['cable cross-section'],
      },
    }
  }

  const kind = query.getCircuitKind(scope.id)

  // Don't enforce load-based minimum cable size on circuits that have no
  // load-relevant endpoints yet (draft/incomplete circuits).
  if (kind === 'empty') {
    return { passed: true }
  }

  const household = isHouseholdInstallation(projectInstallation(project))
  const getSubpanelRequiredSection = (subPanel: Panel): number | undefined => {
    const sectionForBreakerRating = (ratingA: number): number | undefined => {
      const entries = Object.entries(MAX_BREAKER_BY_SECTION)
        .map(([s, max]) => ({ section: Number(s), maxRating: max }))
        .sort((a, b) => a.section - b.section)
      const match = entries.find((e) => ratingA <= e.maxRating)
      return match?.section
    }

    const baselineRequiredForCircuit = (candidate: Circuit): number | undefined => {
      const k = query.getCircuitKind(candidate.id)
      if (k === 'empty') return undefined
      return candidate.endpoints.some((endpoint) => endpoint.type === 'socket') ? 2.5 : 1.5
    }

    let required: number | undefined
    const pushRequired = (candidate: number | undefined) => {
      if (candidate == null || candidate <= 0) return
      required = required == null ? candidate : Math.max(required, candidate)
    }

    const collectRequirements = (panel: Panel) => {
      for (const c of panel.circuits) {
        pushRequired(baselineRequiredForCircuit(c))
      }
      for (const p of panel.protections) {
        for (const c of p.circuits ?? []) {
          pushRequired(baselineRequiredForCircuit(c))
          if (
            household &&
            p.ratingA != null &&
            isOvercurrentProtectionType(p.type) &&
            !isIntermediateProtectionDevice(p)
          ) {
            // If a downstream breaker needs a heavier conductor (e.g. 32A => 6mm²),
            // feeder must be at least that section as well. Table 4.11 is
            // household-only (AREI 4.4.1.4).
            pushRequired(sectionForBreakerRating(p.ratingA))
          }
        }
      }
      for (const child of panel.subPanels) {
        collectRequirements(child)
      }
    }
    collectRequirements(subPanel)

    // No load-relevant circuits yet in the fed panel tree: don't enforce.
    return required
  }

  // AREI 5.2.1.2 establishes 2.5 mm² as the general minimum and permits
  // 1.5 mm² for circuits without sockets. Higher load-dependent sizing needs
  // actual design current and installation-method facts, so it is not inferred
  // merely from labels such as "stove" or "EV".
  const legacySubPanel = protection?.subPanelId ? query.getPanelById(protection.subPanelId) : undefined
  let required =
    kind === 'subpanel'
      ? (legacySubPanel ? getSubpanelRequiredSection(legacySubPanel) : undefined) ?? 0
      : circuit.endpoints.some((endpoint) => endpoint.type === 'socket')
        ? 2.5
        : 1.5

  // A module can feed a real board alongside other output rows. Check that
  // output's cable, without applying its downstream load minimum to every
  // unrelated module output or replacing the whole circuit's feeder model.
  let failedOutputEndpointId: string | undefined
  const { segments: resolvedCircuitSegments } = getCircuitSegmentsForValidation(query, circuit.id)
  for (const endpoint of circuit.endpoints.filter(isDomoticaPanelFeedEndpoint)) {
    const targetPanel = query.getPanelById(endpoint.panelId)
    if (!targetPanel) continue
    const outputRequired = getSubpanelRequiredSection(targetPanel)
    if (outputRequired == null) continue
    const parent = circuit.endpoints.find((candidate) => candidate.id === endpoint.domoticaChildProps.parentEndpointId)
    const output = parent?.domoticaProps?.endpointOutputWires?.[endpoint.domoticaChildProps.outputIndex]
    // Prefer the actual painted feeder, which includes wire-run/section
    // overrides. Raw output settings are only a fallback when no geometry is
    // available for this board endpoint.
    const outputRef = endpoint.domoticaChildProps
    const outputIds = new Set(circuit.endpoints.filter((candidate) =>
      candidate.domoticaChildProps?.parentEndpointId === outputRef.parentEndpointId &&
      candidate.domoticaChildProps.outputIndex === outputRef.outputIndex &&
      candidate.domoticaChildProps.outputGroup === outputRef.outputGroup).map((candidate) => candidate.id))
    const feederSections: number[] = []
    const pending = [endpoint.id]
    const visited = new Set<string>()
    while (pending.length) {
      const targetId = pending.pop()!
      if (visited.has(targetId)) continue
      visited.add(targetId)
      for (const segment of resolvedCircuitSegments) {
        if (segment.domain === 'DC' || segment.isSubPanelSupply ||
          segment.toElementType !== 'endpoint' || segment.toElementId !== targetId ||
          segment.fromElementType !== 'endpoint' || !segment.fromElementId ||
          (segment.fromElementId !== parent?.id && !outputIds.has(segment.fromElementId))) continue
        const value = query.getCrossSection(segment)
        if (value != null && value > 0) feederSections.push(value)
        if (segment.fromElementId !== parent?.id) pending.push(segment.fromElementId)
      }
    }
    const outputSection = feederSections.length
      ? Math.min(...feederSections)
      : output?.cable?.sectionMm2 ?? circuit.cable?.sectionMm2
    if (outputSection != null && outputSection > 0 && outputSection < outputRequired) {
      section = outputSection
      required = outputRequired
      failedOutputEndpointId = endpoint.id
      break
    }
  }

  if (section >= required) {
    const missingInstallationMethod = query.getCableSegments(scope.id).some(
      (segment) => !query.getInstallationMethod(segment)
    )
    return {
      passed: true,
      ...(missingInstallationMethod ? {
        coverage: {
          status: 'missing-information' as const,
          reason: 'basic-section-rule-does-not-model-current-or-installation-method',
          missingFacts: ['design current', 'cable installation method'],
        },
      } : { coverage: { status: 'passed' as const } }),
    }
  }

  return {
    passed: false,
    offenders: [
      ...(failedOutputEndpointId ? [{ kind: 'endpoint' as const, id: failedOutputEndpointId, viewHint: 'eendraad' as const }] : minSegmentIds.map((id) => ({
        kind: 'segment' as const,
        id,
        viewHint: 'eendraad' as const,
      }))),
      { kind: 'circuit', id: circuit.id, viewHint: 'eendraad' },
    ],
    message: i18n.t('validation.primitives.minimumCrossSection.message', {
      circuitCode: validationCircuitCode(circuit.code),
      section,
      required,
      defaultValue: `Circuit ${circuit.code}: cable cross-section ${section}mm² is below minimum ${required}mm² for this circuit type`,
    }),
    details: i18n.t('validation.primitives.minimumCrossSection.details', {
      circuitCode: validationCircuitCode(circuit.code),
      section,
      required,
      defaultValue: `Circuit ${circuit.code} uses a ${section}mm² cable, but the AREI minimum for this circuit type is ${required}mm². Increase the cable size or change the circuit type.`,
    }),
  }
}

function parsePositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : undefined
  if (typeof value === 'string') {
    const normalized = value.replace(',', '.').trim()
    if (!normalized) return undefined
    const parsed = Number(normalized)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }
  return undefined
}

function dcCrossSectionHeuristic(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query } = context
  if (scope.type !== 'circuit') return { passed: true }
  const circuit = query.getCircuitById(scope.id)
  if (!circuit) return { passed: true }

  const { segments } = getCircuitSegmentsForValidation(query, scope.id)
  const dcSegments = segments.filter((segment) => segment.domain === 'DC')
  if (dcSegments.length === 0) {
    return { passed: true, coverage: { status: 'skipped', reason: 'no-dc-cable-segments' } }
  }

  const dcSections = dcSegments
    .map((segment) => ({ id: segment.id, section: query.getCrossSection(segment) }))
    .filter(
      (entry): entry is { id: string; section: number } =>
        entry.section != null && entry.section > 0
    )
  if (dcSections.length === 0) {
    return {
      passed: true,
      coverage: {
        status: 'missing-information',
        reason: 'dc-cable-sections-unavailable',
        missingFacts: ['DC cable cross-section'],
      },
    }
  }

  const minSection = dcSections.reduce(
    (min, s) => (s.section < min ? s.section : min),
    dcSections[0]!.section
  )
  const minSegmentIds = dcSections.filter((s) => s.section === minSection).map((s) => s.id)
  const sectionAmpacity = getConservativeAmpacityForSection(
    minSection,
    CONSERVATIVE_DC_AMPACITY_BY_SECTION
  )
  if (sectionAmpacity == null) {
    return {
      passed: true,
      coverage: {
        status: 'unavailable',
        reason: 'dc-ampacity-not-covered-by-supported-table',
        missingFacts: ['validated DC ampacity for this cross-section'],
      },
    }
  }

  const voltageCandidates: number[] = []
  let voltageSource = 'fallback-48V'
  const conversionVoltageCandidates: number[] = []
  for (const td of circuit.trunkDevices ?? []) {
    if (td.type !== 'conversion') continue
    if (td.symbol === 'rectifier' || td.symbol === 'dc_dc_converter') {
      const v = parsePositiveNumber(td.conversionProps?.dcOutputVoltageV)
      if (v != null) conversionVoltageCandidates.push(v)
    } else if (td.symbol === 'inverter') {
      const v = parsePositiveNumber(td.conversionProps?.dcInputMinVoltageV)
      if (v != null) conversionVoltageCandidates.push(v)
    }
  }
  for (const ep of circuit.endpoints ?? []) {
    if (ep.symbol === 'rectifier' || ep.symbol === 'dc_dc_converter') {
      const v = parsePositiveNumber(ep.energyConversionProps?.dcOutputVoltageV)
      if (v != null) conversionVoltageCandidates.push(v)
    } else if (ep.symbol === 'inverter') {
      const v = parsePositiveNumber(ep.energyConversionProps?.dcInputMinVoltageV)
      if (v != null) conversionVoltageCandidates.push(v)
    }
  }
  for (const ep of circuit.endpoints ?? []) {
    const batteryV = parsePositiveNumber(ep.batteryProps?.voltageV)
    if (batteryV != null) voltageCandidates.push(batteryV)
    const solarV = parsePositiveNumber(ep.solarPanelProps?.voltageV)
    if (solarV != null) voltageCandidates.push(solarV)
  }
  const estimatedVoltage =
    conversionVoltageCandidates.length > 0
      ? Math.min(...conversionVoltageCandidates)
      : voltageCandidates.length > 0
        ? Math.min(...voltageCandidates)
        : 48
  if (conversionVoltageCandidates.length > 0) {
    voltageSource = 'conversion-device'
  } else if (voltageCandidates.length > 0) {
    voltageSource = 'endpoint-device'
  }

  const powerCandidatesW: number[] = []
  for (const td of circuit.trunkDevices ?? []) {
    if (td.type !== 'conversion') continue
    const secondary = parsePositiveNumber(td.conversionProps?.pMaxSecondaryW)
    const primary = parsePositiveNumber(td.conversionProps?.pMaxPrimaryW)
    if (secondary != null) powerCandidatesW.push(secondary)
    else if (primary != null) powerCandidatesW.push(primary)
  }
  for (const ep of circuit.endpoints ?? []) {
    const solarW = parsePositiveNumber(ep.solarPanelProps?.wattageW)
    if (solarW != null) powerCandidatesW.push(solarW)
  }
  if (powerCandidatesW.length === 0) {
    return {
      passed: true,
      coverage: {
        status: 'missing-information',
        reason: 'dc-load-power-unavailable',
        missingFacts: ['DC design power/current'],
      },
    }
  }

  const estimatedPowerW = Math.max(...powerCandidatesW)
  const estimatedCurrentA = estimatedPowerW / estimatedVoltage
  const missingFacts = [
    ...(voltageSource === 'fallback-48V' ? ['DC operating voltage'] : []),
    ...(dcSegments.some((segment) => !query.getInstallationMethod(segment)) ? ['DC cable installation method'] : []),
  ]
  if (!Number.isFinite(estimatedCurrentA) || estimatedCurrentA <= sectionAmpacity) {
    return {
      passed: true,
      ...(missingFacts.length > 0 ? {
        coverage: {
          status: 'missing-information' as const,
          reason: 'dc-sizing-estimate-uses-incomplete-design-facts',
          missingFacts,
        },
      } : {}),
    }
  }

  const voltageSourceLabel = i18n.t(
    `validation.primitives.dcCrossSectionHeuristic.voltageSources.${voltageSource}`,
    {
      defaultValue:
        voltageSource === 'fallback-48V'
          ? 'fallback 48V (no explicit DC voltage found)'
          : voltageSource === 'conversion-device'
            ? 'conversion device voltage setting'
            : 'battery/solar voltage setting',
    }
  )

  return {
    passed: false,
    ...(missingFacts.length > 0 ? {
      coverage: {
        status: 'failed' as const,
        reason: 'dc-sizing-limit-exceeded-with-estimate-inputs-incomplete',
        missingFacts,
      },
    } : {}),
    offenders: [
      { kind: 'circuit', id: circuit.id, viewHint: 'eendraad' },
      ...minSegmentIds.map((id) => ({
        kind: 'segment' as const,
        id,
        viewHint: 'eendraad' as const,
      })),
    ],
    message: i18n.t('validation.primitives.dcCrossSectionHeuristic.message', {
      circuitCode: validationCircuitCode(circuit.code),
      estimatedCurrentA: estimatedCurrentA.toFixed(1),
      estimatedPowerW: estimatedPowerW.toFixed(0),
      estimatedVoltage: estimatedVoltage.toFixed(0),
      section: minSection,
      sectionAmpacity,
      defaultValue: `Circuit ${circuit.code}: DC sizing warning - estimated ${estimatedCurrentA.toFixed(1)}A exceeds ~${sectionAmpacity}A for ${minSection}mm²`,
    }),
    details: i18n.t('validation.primitives.dcCrossSectionHeuristic.details', {
      circuitCode: validationCircuitCode(circuit.code),
      estimatedPowerW: estimatedPowerW.toFixed(0),
      estimatedVoltage: estimatedVoltage.toFixed(0),
      estimatedCurrentA: estimatedCurrentA.toFixed(1),
      section: minSection,
      sectionAmpacity,
      voltageSource,
      voltageSourceLabel,
      defaultValue:
        `Heuristic calculation on DC section of circuit ${circuit.code}: ` +
        `I ~= P/U = ${estimatedPowerW.toFixed(0)}W / ${estimatedVoltage.toFixed(0)}V = ${estimatedCurrentA.toFixed(1)}A. ` +
        `Weakest DC wire section is ${minSection}mm² (simplified reference ~${sectionAmpacity}A). ` +
        `Voltage source: ${voltageSourceLabel}. ` +
        `This is a warning, not a hard AREI error; verify converter and device specs.`,
    }),
  }
}

function formatConductorLabel(cable: CableSpec): string {
  const n = cable.conductors
  return cable.hasPE === true ? `${n}G` : `${n}`
}

/**
 * Structural parent circuits only distribute active conductors from an RCD/RCBO
 * to downstream protections. Their PE remains continuous through the panel's PE
 * bar and must not be interpreted as passing through the protection devices.
 */
function isInternalProtectionDistributionCircuit(circuit: Circuit): boolean {
  return (
    (circuit.subCircuitIds?.length ?? 0) > 0 &&
    circuit.endpoints.length === 0 &&
    (circuit.branches?.length ?? 0) === 0 &&
    (circuit.trunkDevices?.length ?? 0) === 0
  )
}

function isInternalProtectionLinkSegment(segment: WireSegment, circuit: Circuit): boolean {
  return (
    isInternalProtectionDistributionCircuit(circuit) &&
    segment.fromElementType === 'protection' &&
    segment.toElementType === 'protection'
  )
}

function isNestedProtectionBusFeedSegment(
  segment: WireSegment,
  circuit: Circuit,
  panel: Panel
): boolean {
  if (segment.fromElementType !== 'secondaryBus' || segment.toElementType !== 'protection') {
    return false
  }

  const childProtection = panel.protections.find(
    (protection) =>
      protection.id === segment.toElementId &&
      protection.circuits?.some((candidate) => candidate.id === circuit.id)
  )
  if (!childProtection) return false

  return panel.protections.some((protection) =>
    (protection.circuits ?? []).some(
      (parentCircuit) =>
        isInternalProtectionDistributionCircuit(parentCircuit) &&
        parentCircuit.subCircuitIds?.includes(circuit.id) === true
    )
  )
}

/**
 * The feeder PE terminates on the subpanel's PE bar; links from its local incoming protection
 * to the bus carry only active conductors and are not outgoing circuit wiring.
 */
function isInternalSubPanelProtectionToBusSegment(segment: WireSegment): boolean {
  return (
    segment.isSubPanelSupply === true &&
    segment.fromElementType === 'protection' &&
    segment.feederProtectionId != null &&
    segment.fromElementId !== segment.feederProtectionId
  )
}

/**
 * Check outgoing AC circuit wiring for a PE path. The utility feed, internal active bus and
 * protection links do not carry PE: the enclosure's separate PE bar supplies outgoing wiring.
 * DC segments are excluded. Cable designation alone cannot verify an independent PE conductor.
 */
function postMainBusRequiresPeConductor(
  context: CheckContext,
  params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, project, query } = context
  if (scope.type !== 'board') return { passed: true }

  const panel = query.getPanelById(scope.id)
  if (!panel) return { passed: true }

  const ruleId = (params?.ruleId as string) ?? 'be.areibook1.2025.post-main-bus-pe-conductor'
  const jurisdiction = projectInstallation(project)?.address?.country ?? 'BE'
  const issues: Issue[] = []
  const seenIssueKeys = new Set<string>()

  const pushIssue = (issueKey: string, offenders: Offender[], message: string, details: string) => {
    if (seenIssueKeys.has(issueKey)) return
    seenIssueKeys.add(issueKey)
    issues.push({
      id: `${ruleId}:${scope.id}:${issueKey}`,
      ruleId,
      severity: 'info',
      jurisdiction,
      rulesetVersion: '2025',
      scope,
      offenders,
      message,
      details,
      remediation: i18n.t('validation.primitives.postMainBusRequiresPeConductor.remediation', {
        defaultValue:
          'Provide a continuous protective-earth path with the outgoing AC wiring, either in the cable (G) or as a correctly installed independent PE conductor. PE must not pass through protection devices.',
      }),
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.2.1.3',
        },
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.4.3.1',
        },
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 5.4.3.5-5.4.3.6',
        },
      ],
      tags: ['cable', 'PE', 'earthing', 'supply'],
    })
  }

  const snapshot = getDerivedWiresForValidation(query, project)
  if (!snapshot) return issues.length > 0 ? issues : { passed: true }
  const panelSegments = snapshot.byPanel.get(scope.id) ?? []

  const flaggedCircuits = new Set<string>()

  for (const seg of panelSegments) {
    if (seg.type === 'mainBus' || seg.type === 'secondaryBus') continue
    if ((seg.domain ?? DEFAULT_ELECTRICAL_DOMAIN) === 'DC') continue
    if (seg.supplyWireRole === 'upstream') continue
    // Bus-to-breaker and breaker-to-breaker links are internal panel wiring;
    // only the outgoing segment after the final protection needs PE here.
    if (seg.toElementType === 'protection') continue
    if (!seg.circuitId) continue
    if (isInternalSubPanelProtectionToBusSegment(seg)) continue
    if (!cableExplicitlyWithoutPe(seg.cable)) continue

    const circuit = query.getCircuitById(seg.circuitId)
    if (!circuit) continue
    if (
      isInternalProtectionDistributionCircuit(circuit) ||
      isInternalProtectionLinkSegment(seg, circuit) ||
      isNestedProtectionBusFeedSegment(seg, circuit, panel)
    )
      continue
    if (flaggedCircuits.has(seg.circuitId)) continue
    flaggedCircuits.add(seg.circuitId)

    const circuitCode = validationCircuitCode(circuit.code)
    const conductorLabel = formatConductorLabel(seg.cable)
    const offenders: Offender[] = [
      { kind: 'segment', id: seg.id, viewHint: 'eendraad' },
      { kind: 'circuit', id: circuit.id, viewHint: 'eendraad' },
    ]

    pushIssue(
      `circuit:${circuit.id}`,
      offenders,
      i18n.t('validation.primitives.postMainBusRequiresPeConductor.circuitMessage', {
        circuitCode,
        conductorLabel,
        defaultValue: `Circuit ${circuitCode}: outgoing AC wiring uses ${conductorLabel} without a protective-earth path.`,
      }),
      i18n.t('validation.primitives.postMainBusRequiresPeConductor.circuitDetails', {
        circuitCode,
        conductorLabel,
        defaultValue: `Household AC circuits downstream of the general RCD need a continuous PE path. The outgoing wiring may include PE in the cable (…G) or use a correctly installed independent protective conductor. Internal links carrying only active conductors between protection devices are not treated as outgoing wiring. DC circuits are not checked.`,
      })
    )
  }

  if (issues.length === 0) return { passed: true }
  return issues
}

function hasVisiblePositiveWireLength(value: {
  wireLengthM?: number
  showWireLengthLabel?: boolean
} | undefined): boolean {
  return (
    value?.showWireLengthLabel === true &&
    value.wireLengthM != null &&
    Number.isFinite(value.wireLengthM) &&
    value.wireLengthM > 0
  )
}

/** Non-household circuit diagrams must document and show electrical-line lengths. */
function nonHouseholdCircuitShowsCableLength(
  context: CheckContext,
  _params?: Record<string, unknown>,
): CheckResult {
  const { scope, query, project } = context
  if (scope.type !== 'circuit') return { passed: true }
  if (isHouseholdInstallation(projectInstallation(project))) return { passed: true }

  const circuit = query.getCircuitById(scope.id)
  if (!circuit || circuit.code === 'PANEL') return { passed: true }

  // Canonical wire runs can set or hide a length independently of legacy circuit defaults.
  const wires = getDerivedWiresForValidation(query, project)
  const hasVisibleLength = wires
    ? wires.byCircuit.get(circuit.id)?.some((segment) =>
        Number.isFinite(segment.wireLengthM) && isWireLengthLabelVisibleForSegment(segment)
      )
    : hasVisiblePositiveWireLength(circuit) ||
      hasVisiblePositiveWireLength(circuit.domainWireOverrides?.AC) ||
      Object.values(circuit.sectionWireOverrides ?? {}).some(hasVisiblePositiveWireLength)
  if (hasVisibleLength) return { passed: true }

  return {
    passed: false,
    offenders: [{ kind: 'circuit', id: circuit.id, viewHint: 'eendraad' }],
    message: i18n.t('validation.primitives.nonHouseholdCircuitShowsCableLength.message', {
      circuitCode: validationCircuitCode(circuit.code),
      defaultValue: `Circuit ${validationCircuitCode(circuit.code)} does not show a cable length`,
    }),
    details: i18n.t('validation.primitives.nonHouseholdCircuitShowsCableLength.details', {
      circuitCode: validationCircuitCode(circuit.code),
      defaultValue:
        'Non-domestic circuit diagrams must include electrical-line lengths. Enter a positive wire length and enable its visibility on the one-wire diagram.',
    }),
  }
}

registerPrimitive('cableHasCrossSection', cableHasCrossSection)
registerPrimitive('breakerSizeMatchesCrossSection', breakerSizeMatchesCrossSection)
registerPrimitive('minimumCrossSection', minimumCrossSection)
registerPrimitive('dcCrossSectionHeuristic', dcCrossSectionHeuristic)
registerPrimitive('postMainBusRequiresPeConductor', postMainBusRequiresPeConductor)
registerPrimitive('nonHouseholdCircuitShowsCableLength', nonHouseholdCircuitShowsCableLength)
