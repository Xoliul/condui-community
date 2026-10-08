import { registerPrimitive } from './registry'
import { logger } from '@/lib/logger'
import type {
  CheckContext,
  CheckResult,
  Issue,
  Offender,
  ValidationProject,
  SymbolKey,
  Panel,
  Circuit,
  Endpoint,
} from './common'
import {
  computeAreiCircuitEndpointLimitCount,
  listLightingFeedCircuits,
  getCircuitMinSectionForCableProtectedByDevice,
  i18n,
  VALIDATION_DEBUG,
  projectPanels,
  projectInstallation,
  validationCircuitCode,
  HEAVY_APPLIANCE_SYMBOLS,
  FIXED_APPLIANCE_DEDICATED_HINT_EXCLUDED_SYMBOLS,
} from './common'
import { isHouseholdInstallation } from '@/lib/installationProfile'
import { selectProjectSupplyAssemblies } from '@/lib/projectV2/electrical'
import { isHvacDeviceSymbol } from '@/lib/symbols'

// Push/impulse buttons are control-only devices. They commonly operate a
// remote teleruptor or relay, so they may legitimately have no load on their
// own branch.
const CONTROL_ONLY_SWITCH_SYMBOLS = new Set<SymbolKey>(['switch_impulse'])

/** Circuit that owns `endpointId`, including nested panel circuits. */
function findCircuitContainingEndpoint(
  project: ValidationProject,
  endpointId: string
): Circuit | undefined {
  const scan = (panels: Panel[]): Circuit | undefined => {
    for (const panel of panels) {
      for (const circuit of panel.circuits) {
        if (circuit.endpoints.some((e) => e.id === endpointId)) return circuit
      }
      for (const protection of panel.protections) {
        if (!protection.circuits) continue
        for (const circuit of protection.circuits) {
          if (circuit.endpoints.some((e) => e.id === endpointId)) return circuit
        }
      }
      const nested = scan(panel.subPanels)
      if (nested) return nested
    }
    return undefined
  }
  return scan(projectPanels(project))
}

/**
 * Consumer endpoints that satisfy "switch controls a load" when they appear after the switch
 * on the same `circuit.branches` entry (eendraad topology; mirrors schema branch ordering).
 */
function isElectricalLoadForSwitchRule(ep: Endpoint): boolean {
  if (ep.type === 'switch') return false
  if (
    ep.symbol === 'junction_box' ||
    ep.symbol === 'junction_panel' ||
    ep.symbol === 'terminal_strip'
  )
    return false
  if (ep.type === 'light_point' || ep.type === 'socket' || ep.type === 'fixed_appliance')
    return true
  if (ep.type === 'domotica' && ep.domoticaChildProps?.outputGroup === 'endpoint') return true
  return false
}

/** True when `circuit.branches` lists a load after this switch on their shared branch. */
function switchHasDownstreamLoadOnBranch(circuit: Circuit, switchId: string): boolean {
  const branches = circuit.branches
  if (!branches?.length) return false
  const byId = new Map((circuit.endpoints ?? []).map((e) => [e.id, e]))
  for (const branch of branches) {
    const ids = branch.endpointIds ?? []
    const idx = ids.indexOf(switchId)
    if (idx < 0) continue
    for (let j = idx + 1; j < ids.length; j++) {
      const other = byId.get(ids[j]!)
      if (other && isElectricalLoadForSwitchRule(other)) return true
    }
  }
  return false
}

/**
 * Check if a switch has controlled loads
 */
function switchHasControlledLoads(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query, project } = context
  if (scope.type !== 'device') {
    return { passed: true }
  }

  const endpoint = query.getEndpointById(scope.id)
  if (!endpoint || endpoint.type !== 'switch') {
    return { passed: true } // Not a switch, skip
  }

  if (endpoint.symbol && CONTROL_ONLY_SWITCH_SYMBOLS.has(endpoint.symbol)) {
    return { passed: true }
  }

  // Domotica parent: by metadata (symbol/domoticaProps) or by being the parent of any domotica child
  const hasDomoticaMetadata =
    (endpoint.symbol === 'domotica' && !endpoint.domoticaChildProps) || !!endpoint.domoticaProps
  const hasDomoticaChildren = (() => {
    const scanPanels = (panels: Panel[]): boolean => {
      for (const panel of panels) {
        for (const circuit of panel.circuits) {
          if (circuit.endpoints.some((e) => e.domoticaChildProps?.parentEndpointId === endpoint.id))
            return true
        }
        for (const protection of panel.protections) {
          if (!protection.circuits) continue
          for (const circuit of protection.circuits) {
            if (
              circuit.endpoints.some((e) => e.domoticaChildProps?.parentEndpointId === endpoint.id)
            )
              return true
          }
        }
        if (scanPanels(panel.subPanels)) return true
      }
      return false
    }
    return scanPanels(projectPanels(project))
  })()
  const isDomoticaParent = hasDomoticaMetadata || hasDomoticaChildren
  const isDomoticaControlChild = endpoint.domoticaChildProps?.outputGroup === 'control'

  if (process.env.NODE_ENV === 'development' && VALIDATION_DEBUG) {
    // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
    console.group('[Validation Debug] switchHasControlledLoads', scope.id, endpoint.label)

    logger.info('Endpoint:', {
      id: endpoint.id,
      label: endpoint.label,
      type: endpoint.type,
      symbol: endpoint.symbol,
      domoticaProps: endpoint.domoticaProps != null ? '(present)' : undefined,
      domoticaChildProps: endpoint.domoticaChildProps,
      controlledEndpointIds: endpoint.controlledEndpointIds,
    })

    logger.info('Skip checks:', {
      'symbol === "domotica"': endpoint.symbol === 'domotica',
      '!domoticaChildProps': !endpoint.domoticaChildProps,
      'has domoticaProps': !!endpoint.domoticaProps,
      hasDomoticaMetadata,
      hasDomoticaChildren,
      isDomoticaParent,
      isDomoticaControlChild,
    })
  }

  // Domotica parent module: it is not a physical switch that must control a load;
  // its children (endpoint/control outputs) are the logical switches and loads.
  // Identify by symbol/domoticaProps or by any endpoint referencing this id as parent.
  if (isDomoticaParent) {
    if (process.env.NODE_ENV === 'development' && VALIDATION_DEBUG) {
      logger.info('Skip: domotica parent module')

      // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
      console.groupEnd()
    }
    return { passed: true }
  }

  // Domotica control outputs are pure control points on a domotica module.
  // They do not represent direct loads and should be exempt from the
  // "switch must control at least one load" requirement.
  if (isDomoticaControlChild) {
    if (process.env.NODE_ENV === 'development' && VALIDATION_DEBUG) {
      logger.info('Skip: domotica control child')

      // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
      console.groupEnd()
    }
    return { passed: true }
  }

  if (endpoint.controlledEndpointIds && endpoint.controlledEndpointIds.length > 0) {
    if (process.env.NODE_ENV === 'development' && VALIDATION_DEBUG) {
      logger.info('Pass: has controlledEndpointIds')

      // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
      console.groupEnd()
    }
    return { passed: true }
  }

  const circuitForSwitch = findCircuitContainingEndpoint(project, endpoint.id)

  // Branch topology: switches are ordered before loads in `branch.endpointIds`; that already
  // defines control — controlledEndpointIds is optional metadata for the same relationship.
  if (circuitForSwitch && switchHasDownstreamLoadOnBranch(circuitForSwitch, endpoint.id)) {
    if (process.env.NODE_ENV === 'development' && VALIDATION_DEBUG) {
      logger.info('Pass: downstream load on same branch (topology)')

      // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
      console.groupEnd()
    }
    return { passed: true }
  }

  // Heuristic fallback: if the circuit that contains this switch has a sound
  // device (buzzer/bell/horn) on it, treat that as a valid controlled load
  // even when controlledEndpointIds is not wired up.
  const soundSymbols = new Set(['buzzer', 'bell', 'horn'])
  const hasSoundLoadOnSameCircuit =
    !!circuitForSwitch &&
    circuitForSwitch.endpoints.some(
      (e) =>
        e.id !== endpoint.id &&
        e.type === 'fixed_appliance' &&
        e.symbol &&
        soundSymbols.has(e.symbol)
    )

  if (hasSoundLoadOnSameCircuit) {
    if (process.env.NODE_ENV === 'development' && VALIDATION_DEBUG) {
      logger.info('Pass: sound load on same circuit')

      // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
      console.groupEnd()
    }
    return { passed: true }
  }

  if (process.env.NODE_ENV === 'development' && VALIDATION_DEBUG) {
    logger.info('Fail: no controlled loads')

    // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
    console.groupEnd()
  }
  return {
    passed: false,
    offenders: [
      {
        kind: 'endpoint',
        id: scope.id,
        viewHint: 'eendraad',
      },
    ],
    message: i18n.t('validation.primitives.switchHasControlledLoads.message', {
      switchLabel: endpoint.label,
      defaultValue: `Switch ${endpoint.label} has no controlled loads`,
    }),
    details: i18n.t('validation.primitives.switchHasControlledLoads.details', {
      defaultValue: 'Every switch must control at least one load (light, outlet, or appliance).',
    }),
  }
}

/**
 * Hint for stove circuits: warn when breaker and cable section are below
 * a recommended sizing for full-size cookers, even if still AREI-compliant.
 */
function stoveCircuitSizingHint(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query } = context
  if (scope.type !== 'circuit') {
    return { passed: true }
  }

  const circuit = query.getCircuitById(scope.id)
  if (!circuit) return { passed: true }

  const kind = query.getCircuitKind(scope.id)
  if (kind !== 'stove') {
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
    return { passed: true }
  }

  const breakerRating = protection.ratingA
  const recommendedSection = 6
  const recommendedBreaker = 32

  if (section >= recommendedSection && breakerRating >= recommendedBreaker) {
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
    message: i18n.t('validation.primitives.stoveCircuitSizingHint.message', {
      circuitCode: validationCircuitCode(circuit.code),
      breakerRating,
      section,
      recommendedBreaker,
      recommendedSection,
      defaultValue: `Cooker circuit ${circuit.code} uses ${section}mm² and ${breakerRating}A; consider at least ${recommendedSection}mm² and ${recommendedBreaker}A for a full-size stove.`,
    }),
    details: i18n.t('validation.primitives.stoveCircuitSizingHint.details', {
      circuitCode: validationCircuitCode(circuit.code),
      breakerRating,
      section,
      recommendedBreaker,
      recommendedSection,
      defaultValue: `This is a design recommendation: typical Belgian practice is to feed full-size electric cookers with a dedicated circuit of about ${recommendedBreaker}A and ${recommendedSection}mm² copper. Smaller values may still be compliant if matched to the actual appliance rating, but can limit future cooker upgrades.`,
    }),
  }
}

/**
 * Enforce that heavy fixed appliances (cookers, boilers, washers, dryers, etc.)
 * live on a dedicated leaf circuit: no subcircuits and no other loads.
 */
function heavyApplianceRequiresDedicatedCircuit(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query, project } = context
  if (scope.type !== 'circuit') {
    return { passed: true }
  }
  if (!isHouseholdInstallation(projectInstallation(project))) return { passed: true }

  const circuit = query.getCircuitById(scope.id)
  if (!circuit) return { passed: true }

  const endpoints = circuit.endpoints ?? []
  // Domotica output loads belong to the module's circuit. Do not ask for a
  // separate dedicated circuit for each controlled appliance.
  const heavyEndpoints = endpoints.filter(
    (ep: Endpoint) =>
      ep.type === 'fixed_appliance' &&
      !ep.domoticaChildProps &&
      ep.symbol &&
      HEAVY_APPLIANCE_SYMBOLS.has(ep.symbol as SymbolKey)
  )

  if (heavyEndpoints.length === 0) {
    return { passed: true }
  }

  // Map endpoints by ID so we can reason about branches (same heuristic as
  // circuitHasTooManyEndpoints): a socket and a heavy appliance that live on
  // the same branch count as a single endpoint group.
  const endpointsById = new Map<string, Endpoint>(endpoints.map((ep: Endpoint) => [ep.id, ep]))
  const heavyEndpointIds = new Set(heavyEndpoints.map((endpoint) => endpoint.id))
  const socketsOnHeavyBranches = new Set<string>()
  if (circuit.branches) {
    for (const branch of circuit.branches) {
      const ids = branch.endpointIds ?? []
      const hasHeavyOnBranch = ids.some((id: string) => heavyEndpointIds.has(id))
      if (!hasHeavyOnBranch) continue
      const hasSocketOnBranch = ids.some((id: string) => endpointsById.get(id)?.type === 'socket')
      if (!hasSocketOnBranch) continue
      for (const id of ids) {
        const ep = endpointsById.get(id)
        if (ep?.type === 'socket') {
          socketsOnHeavyBranches.add(id)
        }
      }
    }
  }

  const isLeaf = !circuit.subCircuitIds || circuit.subCircuitIds.length === 0

  const otherLoadEndpoints = endpoints.filter((ep: Endpoint) => {
    if (heavyEndpoints.some((h: Endpoint) => h.id === ep.id)) return false
    if (ep.type === 'switch') return false
    if (ep.symbol === 'domotica' || ep.domoticaChildProps) return false
    if (
      ep.symbol === 'junction_box' ||
      ep.symbol === 'junction_panel' ||
      ep.symbol === 'terminal_strip'
    )
      return false
    // Sockets that are on the same branch as a heavy appliance are treated
    // as part of that appliance group and do not break "dedicated" status.
    if (ep.type === 'socket' && socketsOnHeavyBranches.has(ep.id)) return false
    return true
  })

  if (isLeaf && otherLoadEndpoints.length === 0 && heavyEndpoints.length === 1) {
    return { passed: true }
  }

  const offenders: Offender[] = [{ kind: 'circuit', id: circuit.id, viewHint: 'eendraad' }]
  for (const ep of heavyEndpoints) {
    offenders.push({ kind: 'endpoint', id: ep.id, viewHint: 'eendraad' })
  }

  const applianceLabels = heavyEndpoints.map((ep) => ep.label || ep.symbol || ep.id).join(', ')

  return {
    passed: false,
    offenders,
    message: i18n.t('validation.primitives.heavyApplianceDedicatedCircuit.message', {
      circuitCode: validationCircuitCode(circuit.code),
      applianceLabels,
      defaultValue: `Heavy fixed appliance(s) ${applianceLabels} on circuit ${circuit.code} must be on their own circuit without other loads.`,
    }),
    details: i18n.t('validation.primitives.heavyApplianceDedicatedCircuit.details', {
      circuitCode: validationCircuitCode(circuit.code),
      applianceLabels,
      defaultValue: `Cookers, boilers, washing machines, tumble dryers, dishwashers and similar heavy fixed appliances should each have their own circuit with no extra sockets, lights or other loads. Move these appliances to their own circuit or split this circuit.`,
    }),
  }
}

/**
 * Soft hint: when any fixed appliance shares a circuit with other loads or the
 * circuit is not a leaf, suggest using a dedicated circuit. This is used as a
 * warning, especially for ambiguous appliance types.
 */
function fixedApplianceDedicatedCircuitHint(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query } = context
  if (scope.type !== 'circuit') {
    return { passed: true }
  }

  const circuit = query.getCircuitById(scope.id)
  if (!circuit) return { passed: true }

  const endpoints = circuit.endpoints ?? []
  // Some fixed_appliance symbols are supporting devices, such as a lighting
  // transformer, and do not warrant a dedicated circuit hint. Other conversion
  // endpoints on a final branch (for example socket → rectifier) still do.
  // Fixed loads on domotica outputs are exempt, including nested modules.
  const fixedAppliances = endpoints.filter((ep: Endpoint) =>
    ep.type === 'fixed_appliance' &&
    !ep.domoticaChildProps &&
    ep.symbol !== 'solar_panel' &&
    ep.symbol !== 'battery' &&
    !(ep.symbol && FIXED_APPLIANCE_DEDICATED_HINT_EXCLUDED_SYMBOLS.has(ep.symbol as SymbolKey))
  )
  if (fixedAppliances.length === 0) {
    return { passed: true }
  }

  const hasHeavy = fixedAppliances.some(
    (ep: Endpoint) => ep.symbol && HEAVY_APPLIANCE_SYMBOLS.has(ep.symbol as SymbolKey)
  )
  if (hasHeavy) {
    return { passed: true }
  }

  const endpointsById = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]))
  const fixedApplianceIds = new Set(fixedAppliances.map((endpoint) => endpoint.id))
  const socketsOnFixedApplianceBranches = new Set<string>()
  for (const branch of circuit.branches ?? []) {
    const branchEndpoints = (branch.endpointIds ?? [])
      .map((id) => endpointsById.get(id))
      .filter((endpoint): endpoint is Endpoint => endpoint != null)
    if (!branchEndpoints.some((endpoint) => fixedApplianceIds.has(endpoint.id))) continue
    for (const endpoint of branchEndpoints) {
      if (endpoint.type === 'socket') socketsOnFixedApplianceBranches.add(endpoint.id)
    }
  }

  // Older projects may not have persisted branch membership. A single socket
  // followed by one fixed appliance is still one dedicated appliance branch;
  // do not turn that representation into a false "not dedicated" hint.
  const hasCompleteBranchTopology =
    (circuit.branches?.length ?? 0) > 0 &&
    endpoints.every((endpoint) =>
      circuit.branches?.some((branch) => branch.endpointIds.includes(endpoint.id)),
    )
  const socketCount = endpoints.filter((endpoint) => endpoint.type === 'socket').length
  const kind = query.getCircuitKind(scope.id)
  const fixedLoadOnlyWithoutBranches =
    !hasCompleteBranchTopology &&
    fixedAppliances.length === 1 &&
    socketCount === 1 &&
    ['fixed_appliance', 'boiler', 'heating', 'stove', 'hvac'].includes(kind)

  const isLeaf = !circuit.subCircuitIds || circuit.subCircuitIds.length === 0

  // A heat pump or other HVAC unit can be followed by additional HVAC units or
  // a generic device on the same circuit. That is one modeled HVAC system,
  // not a generic set of fixed appliances that should trigger this hint.
  const hasChainedHvacApplianceGroup =
    fixedAppliances.length > 1 &&
    (circuit.branches ?? []).some((branch) => {
      const branchAppliances = (branch.endpointIds ?? [])
        .map((id) => endpointsById.get(id))
        .filter(
          (endpoint): endpoint is Endpoint =>
            endpoint != null && fixedAppliances.some((fixed) => fixed.id === endpoint.id),
        )
      return (
        branchAppliances.length === fixedAppliances.length &&
        branchAppliances.length > 1 &&
        isHvacDeviceSymbol(branchAppliances[0]?.symbol) &&
        branchAppliances
          .slice(1)
          .every(
            (endpoint) =>
              isHvacDeviceSymbol(endpoint.symbol) || endpoint.symbol === 'fixed_appliance_generic',
          )
      )
    })

  const otherLoadEndpoints = endpoints.filter((ep: Endpoint) => {
    if (fixedAppliances.some((f: Endpoint) => f.id === ep.id)) return false
    if (ep.type === 'switch') return false
    if (ep.symbol === 'domotica' || ep.domoticaChildProps) return false
    if (
      ep.symbol === 'junction_box' ||
      ep.symbol === 'junction_panel' ||
      ep.symbol === 'terminal_strip'
    )
      return false
    if (
      ep.type === 'socket' &&
      (socketsOnFixedApplianceBranches.has(ep.id) || fixedLoadOnlyWithoutBranches)
    )
      return false
    return true
  })

  if (
    isLeaf &&
    otherLoadEndpoints.length === 0 &&
    (fixedAppliances.length === 1 || hasChainedHvacApplianceGroup)
  ) {
    return { passed: true }
  }

  const offenders: Offender[] = [{ kind: 'circuit', id: circuit.id, viewHint: 'eendraad' }]
  for (const ep of fixedAppliances) {
    offenders.push({ kind: 'endpoint', id: ep.id, viewHint: 'eendraad' })
  }

  const applianceLabels = fixedAppliances.map((ep) => ep.label || ep.symbol || ep.id).join(', ')

  return {
    passed: false,
    offenders,
    message: i18n.t('validation.primitives.fixedApplianceDedicatedCircuitHint.message', {
      circuitCode: validationCircuitCode(circuit.code),
      applianceLabels,
      defaultValue: `Fixed appliance(s) ${applianceLabels} on circuit ${circuit.code} share the circuit with other loads.`,
    }),
    details: i18n.t('validation.primitives.fixedApplianceDedicatedCircuitHint.details', {
      circuitCode: validationCircuitCode(circuit.code),
      applianceLabels,
      defaultValue: `Fixed appliances are often placed on their own circuit so the cable size and protection match the appliance and possible future replacements. Consider moving ${applianceLabels} to its own circuit without extra sockets, lights or other loads.`,
    }),
  }
}

/**
 * Check if RCD has too many circuits.
 * For 30 mA RCDs: max 8 circuits; RCBO-protected circuits do not count toward the limit
 * (each RCBO provides its own 30 mA protection, so they are excluded from the count).
 */
function rcdHasTooManyCircuits(
  context: CheckContext,
  params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query, project } = context
  if (scope.type !== 'device') {
    return { passed: true }
  }
  if (!isHouseholdInstallation(projectInstallation(project))) return { passed: true }

  const protection = query.getProtectionById(scope.id)
  if (!protection || protection.type !== 'RCD') {
    return { passed: true } // Not an RCD, skip
  }

  // Only enforce max circuits for 30 mA RCDs (leakage accumulation limit)
  const sensitivityMa = protection.sensitivityMa ?? 0
  if (sensitivityMa > 30) {
    return { passed: true }
  }

  const circuits = protection.circuits ?? []
  // RCBO-protected circuits do not count toward the 8-circuit limit (AREI / European practice)
  const countTowardLimit = circuits.filter((c: Circuit) => {
    const circuitProtection = query.getProtectionForCircuit(c.id)
    return circuitProtection?.type !== 'RCBO'
  }).length

  const threshold = (params?.threshold as number) || 8

  if (countTowardLimit <= threshold) {
    return { passed: true }
  }

  return {
    passed: false,
    offenders: [
      {
        kind: 'protection',
        id: scope.id,
        viewHint: 'eendraad',
      },
    ],
    message: i18n.t('validation.primitives.rcdHasTooManyCircuits.message', {
      circuitCount: countTowardLimit,
      threshold,
      defaultValue: `RCD has too many circuits (${countTowardLimit} > ${threshold})`,
    }),
    details: i18n.t('validation.primitives.rcdHasTooManyCircuits.details', {
      threshold,
      defaultValue: `Circuits under one 30 mA RCD should respect a maximum count (${threshold}) to reduce nuisance tripping and limit leakage current accumulation. RCBO-protected circuits are excluded from this count.`,
    }),
  }
}

/**
 * Check if circuit has too many endpoints
 */
function circuitHasTooManyEndpoints(
  context: CheckContext,
  params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query, project } = context
  if (scope.type !== 'circuit') {
    return { passed: true }
  }
  if (!isHouseholdInstallation(projectInstallation(project))) return { passed: true }

  const circuit = query.getCircuitById(scope.id)
  if (!circuit) {
    return { passed: true } // Circuit not found, skip
  }

  // Only enforce the endpoint limit on leaf circuits (circuits without subcircuits).
  // Parent circuits that are split into subcircuits act as containers and may
  // aggregate many endpoints across the hierarchy; the AREI-style limit should
  // apply to the lowest-level circuits in that hierarchy instead.
  if (circuit.subCircuitIds && circuit.subCircuitIds.length > 0) {
    return { passed: true }
  }

  // AREI 5.3.5.2 applies this numerical limit to household final circuits
  // containing socket outlets. Pure lighting and other socket-free circuits
  // are outside this particular eight-point rule.
  const hasSocket = circuit.endpoints.some((endpoint) => endpoint.type === 'socket')
  if (!hasSocket) {
    return { passed: true }
  }

  const {
    endpointCount,
    switchOnlyBranchCredits,
    rawEndpoints,
    breakdown: debugEndpointBreakdown,
  } = computeAreiCircuitEndpointLimitCount(circuit)

  const threshold = (params?.threshold as number) || 8

  if (endpointCount <= threshold) {
    return { passed: true }
  }

  // Development-only debug log to help understand why this rule fired.
  if (process.env.NODE_ENV === 'development' && VALIDATION_DEBUG) {
    // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
    console.group('[Validation Debug] circuitHasTooManyEndpoints', circuit.code)

    logger.info('Circuit ID:', circuit.id)

    logger.info('Raw endpoint count:', rawEndpoints.length)

    logger.info('Effective endpoint count:', endpointCount)

    logger.info('Switch-only branch credits:', switchOnlyBranchCredits)

    logger.info('Threshold:', threshold)

    // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
    console.table(debugEndpointBreakdown)

    // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
    console.groupEnd()
  }

  return {
    passed: false,
    offenders: [
      {
        kind: 'circuit',
        id: scope.id,
        viewHint: 'eendraad',
      },
    ],
    message: i18n.t('validation.primitives.circuitHasTooManyEndpoints.message', {
      circuitCode: validationCircuitCode(circuit.code),
      endpointCount,
      threshold,
      defaultValue: `Circuit ${circuit.code} has too many socket-equivalent points (${endpointCount} > ${threshold})`,
    }),
    details: i18n.t('validation.primitives.circuitHasTooManyEndpoints.details', {
      circuitCode: validationCircuitCode(circuit.code),
      endpointCount,
      threshold,
      defaultValue: `Socket and mixed circuit ${circuit.code} has ${endpointCount} socket-equivalent points; the maximum is ${threshold}.`,
    }),
  }
}

/**
 * AREI 5.3.5.2: at least two separate circuits feed lighting (assumed for typical dwellings).
 * Runs once on the main panel; counts leaf circuits with kind lighting or mixed.
 */
function installationHasMinimumLightingCircuits(
  context: CheckContext,
  params?: Record<string, unknown>
): CheckResult {
  const { scope, query, project } = context
  if (scope.type !== 'board') return { passed: true }

  const panel = query.getPanelById(scope.id)
  if (!panel?.isMain) return { passed: true }

  const country = projectInstallation(project)?.address?.country
  if (country && country !== 'BE') return { passed: true }
  if (!isHouseholdInstallation(projectInstallation(project))) return { passed: true }

  // A project that only draws the supply topology is not a complete dwelling
  // installation. Do not infer missing household load circuits from that limited scope.
  const householdEndUseKinds = new Set([
    'lighting',
    'mixed',
    'sockets',
    'fixed_appliance',
    'stove',
    'hvac',
    'boiler',
    'heating',
    'ev',
    'doorbell',
  ])
  const hasModeledHouseholdLoad = query
    .getCircuits()
    .some(
      (circuit) =>
        circuit.endpoints.length > 0 && householdEndUseKinds.has(query.getCircuitKind(circuit.id))
    )
  if (selectProjectSupplyAssemblies(project).length > 0 && !hasModeledHouseholdLoad) {
    return { passed: true }
  }

  const threshold = (params?.threshold as number) || 2
  const lightingCircuitIds = listLightingFeedCircuits(query)
  const count = lightingCircuitIds.length

  if (count >= threshold) {
    return { passed: true }
  }

  return {
    passed: false,
    offenders: lightingCircuitIds.map((id) => ({
      kind: 'circuit' as const,
      id,
      viewHint: 'eendraad' as const,
    })),
    message: i18n.t('validation.primitives.installationHasMinimumLightingCircuits.message', {
      count,
      threshold,
      defaultValue: `Installation has ${count} lighting circuit(s); at least ${threshold} are required`,
    }),
    details: i18n.t('validation.primitives.installationHasMinimumLightingCircuits.details', {
      count,
      threshold,
      defaultValue: `AREI 5.3.5.2 requires at least ${threshold} separate circuits for lighting in a typical dwelling. This installation has ${count}. Add another lighting or mixed circuit.`,
    }),
  }
}

registerPrimitive('switchHasControlledLoads', switchHasControlledLoads)
registerPrimitive('stoveCircuitSizingHint', stoveCircuitSizingHint)
registerPrimitive('heavyApplianceRequiresDedicatedCircuit', heavyApplianceRequiresDedicatedCircuit)
registerPrimitive('fixedApplianceDedicatedCircuitHint', fixedApplianceDedicatedCircuitHint)
registerPrimitive('rcdHasTooManyCircuits', rcdHasTooManyCircuits)
registerPrimitive('circuitHasTooManyEndpoints', circuitHasTooManyEndpoints)
registerPrimitive('installationHasMinimumLightingCircuits', installationHasMinimumLightingCircuits)
