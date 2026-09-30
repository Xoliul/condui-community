import { selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
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
  SupplyWireRole,
} from './common'
import {
  DEFAULT_ELECTRICAL_DOMAIN,
  calculateBottomUpLayout,
  MAX_BREAKER_BY_SECTION,
  getMaxProtectionRatingForSection,
  getCircuitMinSectionForCableProtectedByDevice,
  getCircuitSegmentsForValidation,
  buildLayoutTree,
  deriveWires,
  cableExplicitlyWithoutPe,
  cableForSupplyWireRole,
  i18n,
  projectPanels,
  projectInstallation,
  validationCircuitCode,
  CONSERVATIVE_DC_AMPACITY_BY_SECTION,
  getConservativeAmpacityForSection,
} from './common'
import { isHouseholdInstallation } from '@/lib/installationProfile'
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

  const segments = query.getCableSegments(scope.id)
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
    return { passed: true }
  }

  return {
    passed: false,
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
 */
function breakerSizeMatchesCrossSection(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query } = context
  if (scope.type !== 'circuit') {
    return { passed: true }
  }

  const circuit = query.getCircuitById(scope.id)
  if (!circuit) return { passed: true }
  if ((circuit.endpoints?.length ?? 0) === 0) {
    return { passed: true }
  }
  const kind = query.getCircuitKind(scope.id)
  if (kind === 'empty') {
    return { passed: true }
  }

  const protection = query.getProtectionForCircuit(scope.id)
  if (!protection || protection.ratingA == null) {
    return { passed: true }
  }

  const { minSection: segmentMinSection, minSegmentIds } =
    getCircuitMinSectionForCableProtectedByDevice(query, scope.id, protection.id, { domain: 'AC' })
  const section =
    segmentMinSection ??
    (circuit.cable?.sectionMm2 && circuit.cable.sectionMm2 > 0
      ? circuit.cable.sectionMm2
      : undefined)
  if (section == null || section <= 0) {
    // No cable information; let cableHasCrossSection handle this.
    return { passed: true }
  }

  const maxRating = getMaxProtectionRatingForSection(section, protection.type)
  if (maxRating == null) {
    // Section not covered by our simplified table; skip check.
    return { passed: true }
  }

  const breakerRating = protection.ratingA

  if (breakerRating <= maxRating) {
    return { passed: true }
  }

  return {
    passed: false,
    offenders: [
      ...minSegmentIds.map((id) => ({
        kind: 'segment' as const,
        id,
        viewHint: 'eendraad' as const,
      })),
      { kind: 'circuit', id: circuit.id, viewHint: 'eendraad' },
      { kind: 'protection', id: protection.id, viewHint: 'eendraad' },
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
  const { scope, query } = context
  if (scope.type !== 'circuit') {
    return { passed: true }
  }

  const circuit = query.getCircuitById(scope.id)
  if (!circuit) return { passed: true }

  const protection = query.getProtectionForCircuit(scope.id)
  const { minSection: segmentMinSection, minSegmentIds } =
    getCircuitMinSectionForCableProtectedByDevice(query, scope.id, protection?.id, { domain: 'AC' })
  const section =
    segmentMinSection ??
    (circuit.cable?.sectionMm2 && circuit.cable.sectionMm2 > 0
      ? circuit.cable.sectionMm2
      : undefined)
  if (section == null || section <= 0) return { passed: true }

  const kind = query.getCircuitKind(scope.id)

  // Don't enforce load-based minimum cable size on circuits that have no
  // load-relevant endpoints yet (draft/incomplete circuits).
  if (kind === 'empty') {
    return { passed: true }
  }

  const getSubpanelRequiredSection = (circuitId: string): number | undefined => {
    const prot = query.getProtectionForCircuit(circuitId)
    const subPanelId = prot?.subPanelId
    if (!subPanelId) return undefined

    const subPanel = query.getPanelById(subPanelId)
    if (!subPanel) return undefined

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
            p.ratingA != null &&
            isOvercurrentProtectionType(p.type) &&
            !isIntermediateProtectionDevice(p)
          ) {
            // If a downstream breaker needs a heavier conductor (e.g. 32A => 6mm²),
            // feeder must be at least that section as well.
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
  const required =
    kind === 'subpanel'
      ? getSubpanelRequiredSection(scope.id) ?? 0
      : circuit.endpoints.some((endpoint) => endpoint.type === 'socket')
        ? 2.5
        : 1.5

  if (section >= required) {
    return { passed: true }
  }

  return {
    passed: false,
    offenders: [
      ...minSegmentIds.map((id) => ({
        kind: 'segment' as const,
        id,
        viewHint: 'eendraad' as const,
      })),
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
  if (dcSegments.length === 0) return { passed: true }

  const dcSections = dcSegments
    .map((segment) => ({ id: segment.id, section: query.getCrossSection(segment) }))
    .filter(
      (entry): entry is { id: string; section: number } =>
        entry.section != null && entry.section > 0
    )
  if (dcSections.length === 0) return { passed: true }

  const minSection = dcSections.reduce(
    (min, s) => (s.section < min ? s.section : min),
    dcSections[0]!.section
  )
  const minSegmentIds = dcSections.filter((s) => s.section === minSection).map((s) => s.id)
  const sectionAmpacity = getConservativeAmpacityForSection(
    minSection,
    CONSERVATIVE_DC_AMPACITY_BY_SECTION
  )
  if (sectionAmpacity == null) return { passed: true }

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
  if (powerCandidatesW.length === 0) return { passed: true }

  const estimatedPowerW = Math.max(...powerCandidatesW)
  const estimatedCurrentA = estimatedPowerW / estimatedVoltage
  if (!Number.isFinite(estimatedCurrentA) || estimatedCurrentA <= sectionAmpacity)
    return { passed: true }

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

const INSTALLATION_SIDE_SUPPLY_ROLES: SupplyWireRole[] = ['crossing', 'downstream']

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
 * Warn when AC wiring on the installation side of the main bus uses conductors without PE.
 * Ground/PE is bonded at the main bus; circuits and the supply drop from the dashed separator
 * to the bus should use a G suffix (e.g. 3G, 4G). DC segments are excluded.
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

  const installation = projectInstallation(project)

  if (panel.isMain === true && installation) {
    for (const role of INSTALLATION_SIDE_SUPPLY_ROLES) {
      const cable = cableForSupplyWireRole(installation, projectPanels(project), panel, role)
      if (!cableExplicitlyWithoutPe(cable)) continue

      const roleLabel = i18n.t(
        `validation.primitives.postMainBusRequiresPeConductor.supplyRole.${role}`,
        {
          defaultValue: role === 'crossing' ? 'panel boundary' : 'main panel supply to bus',
        }
      )
      const conductorLabel = formatConductorLabel(cable)
      pushIssue(
        `supply:${role}`,
        [{ kind: 'board', id: panel.id, viewHint: 'eendraad' }],
        i18n.t('validation.primitives.postMainBusRequiresPeConductor.supplyMessage', {
          panelName: panel.name,
          roleLabel,
          conductorLabel,
          defaultValue: `Panel ${panel.name}: ${roleLabel} uses ${conductorLabel} without protective earth (G). After the main bus, use a G conductor (e.g. 3G, 4G).`,
        }),
        i18n.t('validation.primitives.postMainBusRequiresPeConductor.supplyDetails', {
          panelName: panel.name,
          roleLabel,
          conductorLabel,
          defaultValue: `Protective earth is connected at the main bus. The ${roleLabel} is on the installation side and should include a PE conductor in the cable designation (…G), not ${conductorLabel}.`,
        })
      )
    }
  }

  let panelSegments: WireSegment[] = []
  try {
    if (!installation) throw new Error('Missing electrical installation')
    const layout = calculateBottomUpLayout(project, new Map())
    const tree = buildLayoutTree(layout)
    const allSegments = deriveWires(tree, projectPanels(project), installation, [], undefined, selectProjectWireRuns(project))
    panelSegments = allSegments.filter((s) => s.panelId === scope.id)
  } catch {
    return issues.length > 0 ? issues : { passed: true }
  }

  const flaggedCircuits = new Set<string>()

  for (const seg of panelSegments) {
    if (seg.type === 'mainBus' || seg.type === 'secondaryBus') continue
    if ((seg.domain ?? DEFAULT_ELECTRICAL_DOMAIN) === 'DC') continue
    if (seg.supplyWireRole === 'upstream') continue
    if (!seg.circuitId) continue
    // Bus-to-protection links carry active conductors inside the panel; the
    // circuit's PE runs separately from the PE bar to its outgoing wiring.
    if (
      (seg.fromElementType === 'mainBus' || seg.fromElementType === 'secondaryBus') &&
      seg.toElementType === 'protection'
    )
      continue
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

  const hasVisibleLength =
    hasVisiblePositiveWireLength(circuit) ||
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
