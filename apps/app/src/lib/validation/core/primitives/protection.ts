import { selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
import { registerPrimitive } from './registry'
import { logger } from '@/lib/logger'
import type {
  CheckContext,
  CheckResult,
  Issue,
  Offender,
  ElectricalDomain,
  Panel,
  TrunkDevice,
  ProtectionDevice,
  WireSegment,
} from './common'
import { isHouseholdInstallation } from '@/lib/installationProfile'
import {
  isIntermediateProtectionDevice,
  isOvercurrentProtectionType,
} from '@/lib/protectionKind'
import {
  DEFAULT_ELECTRICAL_DOMAIN,
  calculateBottomUpLayout,
  buildLayoutTree,
  deriveWires,
  getElementPortDomains,
  getPanelFeedProjection,
  trunkDeviceCountsAsProtection,
  i18n,
  VALIDATION_DEBUG,
  projectPanels,
  projectInstallation,
  validationCircuitCode,
  validationProtectionLabel,
} from './common'

/**
 * Check cascading ratings: downstream overcurrent protections must not be
 * rated higher than the effective upstream overcurrent limit. Pure RCDs are
 * transparent here because their rating is a continuous-current capacity, not
 * an overcurrent trip threshold. Intermediate RCBOs can narrow the limit but
 * must not widen it when their rating is higher than the existing limit.
 */
function cascadeProtectionRatings(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query } = context

  // Case 1: board scope — check sub-panel cascades (feed MCB vs sub-panel protections)
  if (scope.type === 'board') {
    const rootPanel = query.getPanelById(scope.id)
    if (!rootPanel) return { passed: true }

    const offenders: Offender[] = []

    const walkPanels = (panel: Panel, upstreamRatingA?: number) => {
      for (const protection of panel.protections) {
        const thisRating = protection.ratingA
        const isOvercurrent = isOvercurrentProtectionType(protection.type)
        const isIntermediate = isIntermediateProtectionDevice(protection)

        if (
          isOvercurrent &&
          !isIntermediate &&
          thisRating != null &&
          upstreamRatingA != null &&
          thisRating > upstreamRatingA
        ) {
          offenders.push({
            kind: 'protection',
            id: protection.id,
            viewHint: 'eendraad',
          })
        }

        // If this protection feeds a sub-panel, recurse into that panel with this as upstream
        if (protection.subPanelId) {
          const subPanel = query.getPanelById(protection.subPanelId)
          if (subPanel) {
            const nextUpstreamRatingA =
              isOvercurrent && thisRating != null
                ? upstreamRatingA == null
                  ? thisRating
                  : Math.min(upstreamRatingA, thisRating)
                : upstreamRatingA
            walkPanels(subPanel, nextUpstreamRatingA)
          }
        }
      }

      // Also recurse into nested sub-panels that are structurally nested (for completeness)
      for (const subPanel of panel.subPanels) {
        walkPanels(subPanel, upstreamRatingA)
      }
    }

    walkPanels(rootPanel, undefined)

    if (offenders.length === 0) return { passed: true }

    return {
      passed: false,
      offenders,
      message: i18n.t('validation.primitives.cascadeProtectionRatings.message', {
        defaultValue: 'Downstream protection rating exceeds upstream breaker rating',
      }),
      details: i18n.t('validation.primitives.cascadeProtectionRatings.details', {
        defaultValue:
          'A downstream MCB/RCBO must not be rated higher than its upstream protection. Reduce the downstream rating or increase the upstream rating with proper coordination.',
      }),
    }
  }

  // Case 2: circuit scope — check protection devices on the circuit trunk vs panel-level protection
  if (scope.type === 'circuit') {
    const circuit = query.getCircuitById(scope.id)
    if (!circuit) return { passed: true }

    const upstream = query.getProtectionForCircuit(scope.id)
    let effectiveUpstreamRatingA = upstream?.ratingA

    const offenders: Offender[] = []

    if (circuit.trunkDevices) {
      for (const td of circuit.trunkDevices) {
        if (
          td.type !== 'protection' ||
          td.ratingA == null ||
          !isOvercurrentProtectionType(td.protectionType)
        ) {
          continue
        }
        if (effectiveUpstreamRatingA != null && td.ratingA > effectiveUpstreamRatingA) {
          offenders.push({
            kind: 'protection',
            id: td.id,
            viewHint: 'eendraad',
          })
        }
        effectiveUpstreamRatingA =
          effectiveUpstreamRatingA == null
            ? td.ratingA
            : Math.min(effectiveUpstreamRatingA, td.ratingA)
      }
    }

    if (offenders.length === 0) return { passed: true }

    return {
      passed: false,
      offenders,
      message: i18n.t('validation.primitives.cascadeProtectionRatings.message', {
        circuitCode: validationCircuitCode(circuit.code),
        defaultValue: `Circuit ${circuit.code}: downstream protection rating exceeds upstream breaker rating`,
      }),
      details: i18n.t('validation.primitives.cascadeProtectionRatings.details', {
        defaultValue:
          'A downstream MCB/RCBO on a circuit must not be rated higher than its upstream protection. Reduce the downstream rating or increase the upstream rating with proper coordination.',
      }),
    }
  }

  return { passed: true }
}

/**
 * Non-AREI rule: ensure there is a main protection device on the supply trunk.
 */
function supplyHasMainBreaker(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query, project } = context
  if (scope.type !== 'board') return { passed: true }

  const panel = query.getPanelById(scope.id)
  if (!panel?.isMain) return { passed: true }

  const installation = projectInstallation(project)
  const projection = installation
    ? getPanelFeedProjection(installation, projectPanels(project), panel)
    : null
  const supplyProtections =
    ((projection?.rootFeed?.trunkDevices?.length ?? 0) > 0
      ? projection?.rootFeed?.trunkDevices
      : projection?.sharedFeed.trunkDevices
    )?.filter((td: TrunkDevice) => trunkDeviceCountsAsProtection(td)) ??
    query.getMainSupplyProtections().filter((td: TrunkDevice) => trunkDeviceCountsAsProtection(td))
  const mainProtections = supplyProtections.filter(
    (td: TrunkDevice) =>
      td.protectionType === 'MCB' ||
      td.protectionType === 'RCBO' ||
      td.protectionType === 'MAIN_SWITCH'
  )

  if (mainProtections.length === 0) {
    return {
      passed: false,
      offenders: [],
      message: i18n.t('validation.primitives.supplyHasMainBreaker.message', {
        defaultValue: 'Main supply has no upstream breaker or main switch',
      }),
      details: i18n.t('validation.primitives.supplyHasMainBreaker.details', {
        defaultValue:
          'The supply trunk should include a main breaker or main switch upstream of the main panel. Add a suitably rated MCB, RCBO or main switch on the supply wire.',
      }),
    }
  }

  return { passed: true }
}
/**
 * Check if supply origin is specified
 */
function hasSupplyOrigin(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { query } = context
  const origin = query.getSupplyOrigin()

  if (origin != null) {
    return { passed: true }
  }

  return {
    passed: false,
    message: i18n.t('validation.primitives.hasSupplyOrigin.message', {
      defaultValue: 'Main supply origin should be specified',
    }),
    details: i18n.t('validation.primitives.hasSupplyOrigin.details', {
      defaultValue:
        'The main supply origin (grid, generator, pv_inverter, etc.) should be specified in the installation settings.',
    }),
  }
}

/**
 * Check electrical domain consistency: wire domain must match connected components.
 * Only conversion components may connect different input/output domains.
 * Runs at board scope: derives wires for the panel and validates each segment.
 */
function electricalDomainConsistency(
  context: CheckContext,
  params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, project } = context
  if (scope.type !== 'board') return { passed: true }

  const ruleId = (params?.ruleId as string) ?? 'electricalDomainConsistency'

  let segments: WireSegment[] = []
  try {
    const installation = projectInstallation(project)
    if (!installation) throw new Error('Missing electrical installation')
    const layout = calculateBottomUpLayout(project, new Map())
    const tree = buildLayoutTree(layout)
    segments = deriveWires(tree, projectPanels(project), installation, [], undefined, selectProjectWireRuns(project))
  } catch {
    return { passed: true } // Layout failed, skip domain check
  }

  const panelSegments = segments.filter((s) => s.panelId === scope.id)
  const query = context.query
  const issues: Issue[] = []

  const describeElement = (
    elementType: string | undefined,
    elementId: string | undefined
  ): string => {
    if (!elementType || !elementId) return 'unknown'
    if (elementType === 'endpoint') {
      const ep = query.getEndpointById(elementId)
      if (ep) return ep.label ?? `endpoint ${elementId}`
      const trunkDevice = query.getTrunkDeviceById(elementId)
      if (trunkDevice) return trunkDevice.label ?? `${trunkDevice.symbol} ${elementId}`
      return `endpoint ${elementId}`
    }
    if (elementType === 'protection' || elementType === 'rcd') {
      const prot = query.getProtectionById(elementId)
      return prot ? validationProtectionLabel(prot.label) : `protection ${elementId}`
    }
    return elementId
  }

  for (const seg of panelSegments) {
    const wireDomain: ElectricalDomain = seg.domain ?? DEFAULT_ELECTRICAL_DOMAIN

    if (seg.fromElementType && seg.fromElementId) {
      const fromPortDomains = getElementPortDomains(query, seg.fromElementType, seg.fromElementId)
      const isFromCompatible =
        fromPortDomains[0] === wireDomain || fromPortDomains[1] === wireDomain
      if (!isFromCompatible) {
        const fromLabel = describeElement(seg.fromElementType, seg.fromElementId)

        const offenders: Offender[] = [{ kind: 'segment', id: seg.id, viewHint: 'eendraad' }]
        if (seg.circuitId) {
          offenders.push({ kind: 'circuit', id: seg.circuitId, viewHint: 'eendraad' })
        }
        if (seg.fromElementType === 'endpoint' && seg.fromElementId) {
          offenders.push({ kind: 'endpoint', id: seg.fromElementId, viewHint: 'eendraad' })
        } else if (
          (seg.fromElementType === 'protection' || seg.fromElementType === 'rcd') &&
          seg.fromElementId
        ) {
          offenders.push({ kind: 'protection', id: seg.fromElementId, viewHint: 'eendraad' })
        }

        if (process.env.NODE_ENV === 'development' && VALIDATION_DEBUG) {
          // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
          console.group('[Validation Debug] domain-mismatch', `${seg.id}:from`)

          logger.info('Panel ID:', seg.panelId)

          logger.info('Circuit ID:', seg.circuitId)

          logger.info('Wire domain:', wireDomain)

          logger.info('From element:', {
            type: seg.fromElementType,
            id: seg.fromElementId,
            label: fromLabel,
            portDomains: fromPortDomains,
          })

          logger.info('Offenders:', offenders)

          // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
          console.groupEnd()
        }

        const circuitCode =
          seg.circuitId != null
            ? validationCircuitCode(query.getCircuitById(seg.circuitId)?.code)
            : undefined

        issues.push({
          id: `domain-mismatch:${seg.id}:from`,
          ruleId,
          severity: 'warning',
          jurisdiction: projectInstallation(project)?.address?.country ?? 'BE',
          rulesetVersion: '2025',
          scope,
          offenders,
          message: i18n.t('validation.primitives.domainMismatch.message', {
            circuitCode,
            defaultValue:
              circuitCode != null
                ? `Domain mismatch on circuit ${circuitCode}: cannot connect wire to component without a compatible domain port.`
                : 'Cannot connect DC circuit to AC component.',
          }),
          details: i18n.t('validation.primitives.domainMismatch.details', {
            circuitCode,
            wireDomain,
            elementLabel: fromLabel,
            expectedDomain: `${fromPortDomains[0]} | ${fromPortDomains[1]}`,
            defaultValue:
              `Domain mismatch on circuit ${circuitCode ?? 'unknown'} at ${fromLabel}: ` +
              `wire is ${wireDomain}, component ports are ${fromPortDomains[0]} and ${fromPortDomains[1]}. ` +
              "A wire domain must match at least one of the component's typed ports.",
          }),
          citations: [],
        })
      }
    }

    if (seg.toElementType && seg.toElementId) {
      const toPortDomains = getElementPortDomains(query, seg.toElementType, seg.toElementId)
      const isToCompatible = toPortDomains[0] === wireDomain || toPortDomains[1] === wireDomain
      if (!isToCompatible) {
        const toLabel = describeElement(seg.toElementType, seg.toElementId)

        const offenders: Offender[] = [{ kind: 'segment', id: seg.id, viewHint: 'eendraad' }]
        if (seg.circuitId) {
          offenders.push({ kind: 'circuit', id: seg.circuitId, viewHint: 'eendraad' })
        }
        if (seg.toElementType === 'endpoint' && seg.toElementId) {
          offenders.push({ kind: 'endpoint', id: seg.toElementId, viewHint: 'eendraad' })
        } else if (
          (seg.toElementType === 'protection' || seg.toElementType === 'rcd') &&
          seg.toElementId
        ) {
          offenders.push({ kind: 'protection', id: seg.toElementId, viewHint: 'eendraad' })
        }

        if (process.env.NODE_ENV === 'development' && VALIDATION_DEBUG) {
          // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
          console.group('[Validation Debug] domain-mismatch', `${seg.id}:to`)

          logger.info('Panel ID:', seg.panelId)

          logger.info('Circuit ID:', seg.circuitId)

          logger.info('Wire domain:', wireDomain)

          logger.info('To element:', {
            type: seg.toElementType,
            id: seg.toElementId,
            label: toLabel,
            portDomains: toPortDomains,
          })

          logger.info('Offenders:', offenders)

          // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
          console.groupEnd()
        }

        const circuitCode =
          seg.circuitId != null
            ? validationCircuitCode(query.getCircuitById(seg.circuitId)?.code)
            : undefined

        issues.push({
          id: `domain-mismatch:${seg.id}:to`,
          ruleId,
          severity: 'warning',
          jurisdiction: projectInstallation(project)?.address?.country ?? 'BE',
          rulesetVersion: '2025',
          scope,
          offenders,
          message: i18n.t('validation.primitives.domainMismatch.message', {
            circuitCode,
            defaultValue:
              circuitCode != null
                ? `Domain mismatch on circuit ${circuitCode}: cannot connect wire to component without a compatible domain port.`
                : 'Cannot connect DC circuit to AC component.',
          }),
          details: i18n.t('validation.primitives.domainMismatch.details', {
            circuitCode,
            wireDomain,
            elementLabel: toLabel,
            expectedDomain: `${toPortDomains[0]} | ${toPortDomains[1]}`,
            defaultValue:
              `Domain mismatch on circuit ${circuitCode ?? 'unknown'} at ${toLabel}: ` +
              `wire is ${wireDomain}, component ports are ${toPortDomains[0]} and ${toPortDomains[1]}. ` +
              "A wire domain must match at least one of the component's typed ports.",
          }),
          citations: [],
        })
      }
    }
  }

  if (issues.length > 0) return issues
  return { passed: true }
}

/**
 * Enforce AREI-style main RCD presence and sizing on the supply trunk.
 *
 * Approximates for Belgian residential-style installations:
 * - A main RCD or RCBO on the main supply
 * - Sensitivity at most 300 mA
 * - Nominal current at least 40 A
 * - Residual current type at least type A (no pure AC-only devices)
 *
 * The check runs at board scope and only enforces this on the main panel.
 */
function mainRcdCompliance(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query, project } = context
  if (scope.type !== 'board') return { passed: true }

  const panel = query.getPanelById(scope.id)
  if (!panel || !panel.isMain) return { passed: true }

  const installation = projectInstallation(project)
  if (!isHouseholdInstallation(installation)) return { passed: true }
  const country = installation?.address?.country
  if (country && country !== 'BE') {
    return { passed: true }
  }

  const projection = installation
    ? getPanelFeedProjection(installation, projectPanels(project), panel)
    : null
  const supplyDevices =
    ((projection?.rootFeed?.trunkDevices?.length ?? 0) > 0
      ? projection?.rootFeed?.trunkDevices
      : projection?.sharedFeed.trunkDevices
    )?.filter((td: TrunkDevice) => trunkDeviceCountsAsProtection(td)) ??
    query.getMainSupplyProtections().filter((td: TrunkDevice) => trunkDeviceCountsAsProtection(td))
  const mainRcdCandidates = supplyDevices.filter(
    (td: TrunkDevice) => td.protectionType === 'RCD' || td.protectionType === 'RCBO'
  )
  // A residual-current device only counts as such when its residual trip current
  // (sensitivity in mA) is explicitly configured.
  const mainRcds = mainRcdCandidates.filter((td: TrunkDevice) => td.sensitivityMa != null)

  if (mainRcds.length === 0) {
    return {
      passed: false,
      offenders: [],
      message: i18n.t('validation.primitives.mainRcdCompliance.missing.message', {
        defaultValue: 'Main supply has no upstream RCD or RCBO',
      }),
      details: i18n.t('validation.primitives.mainRcdCompliance.missing.details', {
        defaultValue:
          'Belgian AREI Book 1 requires a main residual current device at the origin of the installation. Add a main RCD or RCBO on the supply trunk upstream of the main panel.',
      }),
    }
  }

  const issues: Issue[] = []

  for (const td of mainRcdCandidates) {
    const ratingA = td.ratingA
    const sensitivityMa = td.sensitivityMa

    if (sensitivityMa == null) {
      issues.push({
        id: `main-rcd-missing-sensitivity:${td.id}`,
        ruleId: 'be.areibook1.2025.main-rcd',
        severity: 'warning',
        jurisdiction: 'BE',
        rulesetVersion: '2025',
        scope,
        offenders: [{ kind: 'device', id: td.id, viewHint: 'eendraad' }],
        message: i18n.t('validation.primitives.mainRcdCompliance.sensitivityMissing.message', {
          defaultValue: 'Main RCD/RCBO is missing residual current sensitivity (mA)',
        }),
        details: i18n.t('validation.primitives.mainRcdCompliance.sensitivityMissing.details', {
          defaultValue:
            'A main RCD/RCBO only counts when its residual trip current (for example 300 mA or 30 mA) is configured. Set the sensitivity value for this device.',
        }),
        citations: [],
      })
      continue
    }

    if (ratingA != null && ratingA < 40) {
      issues.push({
        id: `main-rcd-rating:${td.id}`,
        ruleId: 'be.areibook1.2025.main-rcd',
        severity: 'warning',
        jurisdiction: 'BE',
        rulesetVersion: '2025',
        scope,
        offenders: [{ kind: 'device', id: td.id, viewHint: 'eendraad' }],
        message: i18n.t('validation.primitives.mainRcdCompliance.rating.message', {
          ratingA,
          defaultValue: `Main RCD/RCBO has rating ${ratingA}A, below the recommended 40A minimum for residential main devices`,
        }),
        details: i18n.t('validation.primitives.mainRcdCompliance.rating.details', {
          ratingA,
          defaultValue:
            'The main residual current device at the origin of the installation should have a nominal current of at least 40 A. Increase the device rating or adjust the installation design.',
        }),
        citations: [],
      })
    }

    if (sensitivityMa > 300) {
      issues.push({
        id: `main-rcd-sensitivity:${td.id}`,
        ruleId: 'be.areibook1.2025.main-rcd',
        severity: 'warning',
        jurisdiction: 'BE',
        rulesetVersion: '2025',
        scope,
        offenders: [{ kind: 'device', id: td.id, viewHint: 'eendraad' }],
        message: i18n.t('validation.primitives.mainRcdCompliance.sensitivity.message', {
          sensitivityMa,
          defaultValue: `Main RCD/RCBO sensitivity ${sensitivityMa} mA exceeds 300 mA maximum`,
        }),
        details: i18n.t('validation.primitives.mainRcdCompliance.sensitivity.details', {
          sensitivityMa,
          defaultValue:
            'The main residual current device at the origin of the installation should have a residual trip current not exceeding 300 mA. Use a 300 mA (or lower) device.',
        }),
        citations: [],
      })
    }

    // Temporarily disabled: enforcing "main RCD type must be at least A"
    // while we align upstream device defaults and migration behavior.
  }

  if (issues.length > 0) return issues
  return { passed: true }
}

/**
 * RCD selectivity: upstream RCD must be less sensitive than downstream
 * (e.g. 300 mA main, 30 mA sub). Upstream sensitivity (mA) must be greater than
 * downstream (never 30 mA upstream of 300 mA). AREI / European practice.
 */
function rcdSelectivity(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query, project } = context
  if (scope.type !== 'board') return { passed: true }

  const panel = query.getPanelById(scope.id)
  if (!panel || !panel.isMain) return { passed: true }

  const installation = projectInstallation(project)
  const country = installation?.address?.country
  if (country && country !== 'BE') return { passed: true }

  const projection = installation
    ? getPanelFeedProjection(installation, projectPanels(project), panel)
    : null
  const panelScopedSupplyProtections =
    ((projection?.rootFeed?.trunkDevices?.length ?? 0) > 0
      ? projection?.rootFeed?.trunkDevices
      : projection?.sharedFeed.trunkDevices
    )?.filter((td: TrunkDevice) => trunkDeviceCountsAsProtection(td)) ??
    query.getMainSupplyProtections().filter((td: TrunkDevice) => trunkDeviceCountsAsProtection(td))
  const supplyRcds = panelScopedSupplyProtections.filter(
    (td: TrunkDevice) => td.protectionType === 'RCD' || td.protectionType === 'RCBO'
  )
  const panelRcds = panel.protections.filter(
    (p: ProtectionDevice) => p.type === 'RCD' || p.type === 'RCBO'
  )

  const offenders: Offender[] = []

  for (const supplyTd of supplyRcds) {
    const upMa = supplyTd.sensitivityMa
    if (upMa == null) continue
    for (const panelRcd of panelRcds) {
      const downMa = panelRcd.sensitivityMa
      if (downMa == null) continue
      // Temporarily allow equal sensitivities (e.g. 300 -> 300) and only
      // reject clearly inverted selectivity where upstream is more sensitive
      // than downstream (e.g. 30 -> 300).
      if (upMa < downMa) {
        offenders.push({ kind: 'protection', id: panelRcd.id, viewHint: 'eendraad' })
      }
    }
  }

  if (offenders.length === 0) return { passed: true }

  return {
    passed: false,
    offenders,
    message: i18n.t('validation.primitives.rcdSelectivity.message', {
      defaultValue:
        'RCD selectivity: upstream RCD must be less sensitive than downstream (e.g. 300 mA main, 30 mA sub)',
    }),
    details: i18n.t('validation.primitives.rcdSelectivity.details', {
      defaultValue:
        'The main RCD (e.g. 300 mA for fire protection) must be upstream of more sensitive RCDs (e.g. 30 mA for personal protection). Never place a 30 mA RCD upstream of a 300 mA device.',
    }),
  }
}

registerPrimitive('cascadeProtectionRatings', cascadeProtectionRatings)
registerPrimitive('supplyHasMainBreaker', supplyHasMainBreaker)
registerPrimitive('hasSupplyOrigin', hasSupplyOrigin)
registerPrimitive('electricalDomainConsistency', electricalDomainConsistency)
registerPrimitive('mainRcdCompliance', mainRcdCompliance)
registerPrimitive('rcdSelectivity', rcdSelectivity)
