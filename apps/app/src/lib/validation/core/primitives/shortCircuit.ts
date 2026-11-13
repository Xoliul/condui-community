import { registerPrimitive } from './registry'
import type { CheckContext, CheckResult, Offender, Panel, ProtectionDevice, TrunkDevice } from './common'
import {
  getPanelFeedProjection,
  i18n,
  projectInstallation,
  projectPanels,
  validationCircuitCode,
  validationProtectionLabel,
  isPanelPlacementCarrierCircuit,
} from './common'
import { defaultVoltagesForSystem, normalizeNominalVoltageSystem } from '@/constants/nominalVoltage'
import { isHouseholdInstallation } from '@/lib/installationProfile'
import { getInstallationSupplyTransformers } from '@/lib/electrical/supplyTransformer'
import { resolveCircuitNominalVoltage } from '@/lib/electrical/feedNominalVoltage'
import { isOvercurrentProtectionType } from '@/lib/protectionKind'
import { isSpecialistProtectionCurve } from '@/lib/protectionCurves'
import {
  buildCircuitCablePathIndex,
  type CircuitCablePath,
} from '@/lib/shortCircuit/circuitCablePaths'
import {
  instantaneousTripCurrentA,
  maximumProtectedLengthM,
} from '@/lib/shortCircuit/minimumShortCircuit'
import type { Installation } from '@/types/schema'

/** AREI 5.3.5.5.e: household overcurrent devices after the connection device. */
const HOUSEHOLD_MIN_BREAKING_CAPACITY_KA = 3
/** AREI 5.3.5.5.e: the connection device ("beschermingsinrichting voor aansluiting"). */
const HOUSEHOLD_CONNECTION_DEVICE_MIN_BREAKING_CAPACITY_KA = 6

function formatAmps(ka: number): string {
  return String(Math.round(ka * 1000))
}

function isStructuralCarrier(protection: ProtectionDevice): boolean {
  return protection.directPanelFeeder === true || protection.directDcBusFeeder === true
}

/**
 * Household boards: every AC overcurrent device on the board needs a breaking capacity of at
 * least 3000 A. Devices without an entered breaking capacity are skipped.
 */
function householdBoardBreakingCapacity(context: CheckContext): CheckResult {
  const { scope, query, project } = context
  if (scope.type !== 'board') return { passed: true }
  if (!isHouseholdInstallation(projectInstallation(project))) return { passed: true }
  const panel = query.getPanelById(scope.id)
  if (!panel) return { passed: true }

  const low = panel.protections.filter(
    (protection) =>
      !isStructuralCarrier(protection) &&
      protection.dcBusId == null &&
      isOvercurrentProtectionType(protection.type) &&
      protection.breakingCapacityKa != null &&
      protection.breakingCapacityKa < HOUSEHOLD_MIN_BREAKING_CAPACITY_KA
  )
  if (low.length === 0) return { passed: true }

  const labels = low.map((protection) => validationProtectionLabel(protection.label)).join(', ')
  return {
    passed: false,
    offenders: low.map((protection) => ({
      kind: 'protection' as const,
      id: protection.id,
      viewHint: 'eendraad' as const,
    })),
    message: i18n.t('validation.primitives.householdBoardBreakingCapacity.message', {
      labels,
      defaultValue: `Breaking capacity below 3000 A: ${labels}`,
    }),
    details: i18n.t('validation.primitives.householdBoardBreakingCapacity.details', {
      defaultValue:
        'In household installations, overcurrent devices after the connection device need a breaking capacity of at least 3000 A.',
    }),
  }
}

/**
 * Household supply: overcurrent devices before the energy meter are the network operator's
 * connection device and need at least 6000 A; devices after the meter need at least 3000 A.
 */
function householdSupplyBreakingCapacity(context: CheckContext): CheckResult {
  const { scope, query, project } = context
  if (scope.type !== 'board') return { passed: true }
  const installation = projectInstallation(project)
  if (!installation || !isHouseholdInstallation(installation)) return { passed: true }
  const panel = query.getPanelById(scope.id)
  if (!panel?.isMain) return { passed: true }

  const devices = getPanelFeedProjection(installation, projectPanels(project), panel)?.devices ?? []
  const meterIndex = devices.findIndex((device) => device.type === 'energy_meter')

  const offenders: Offender[] = []
  const findings: string[] = []
  devices.forEach((device: TrunkDevice, index) => {
    if (device.type !== 'protection' || !isOvercurrentProtectionType(device.protectionType)) return
    const ka = device.breakingCapacityKa
    if (ka == null) return
    const required =
      meterIndex >= 0 && index < meterIndex
        ? HOUSEHOLD_CONNECTION_DEVICE_MIN_BREAKING_CAPACITY_KA
        : HOUSEHOLD_MIN_BREAKING_CAPACITY_KA
    if (ka >= required) return
    offenders.push({ kind: 'device', id: device.id, viewHint: 'eendraad' })
    findings.push(
      `${validationProtectionLabel(device.label)} (${formatAmps(ka)} A < ${formatAmps(required)} A)`
    )
  })
  if (offenders.length === 0) return { passed: true }

  const list = findings.join(', ')
  return {
    passed: false,
    offenders,
    message: i18n.t('validation.primitives.householdSupplyBreakingCapacity.message', {
      list,
      defaultValue: `Supply breaking capacity too low: ${list}`,
    }),
    details: i18n.t('validation.primitives.householdSupplyBreakingCapacity.details', {
      defaultValue:
        'The connection device before the meter needs at least 6000 A. Overcurrent devices after it need at least 3000 A.',
    }),
  }
}

/**
 * Fault-loop voltage for AREI 5.3.5.5.h: phase-to-neutral when the circuit carries a neutral,
 * otherwise phase-to-phase. A three-pole device on a system with neutral has no neutral.
 */
function faultLoopVoltageV(
  nominalVoltage: Installation['nominalVoltage'] | undefined,
  protection: ProtectionDevice
): number {
  const system = normalizeNominalVoltageSystem(nominalVoltage?.system ?? '2~')
  const { uLineToNeutral, uLineToLine } = defaultVoltagesForSystem(system)
  const hasNeutralSystem = system === '1N~' || system === '3N~'
  if (!hasNeutralSystem) return uLineToLine
  return protection.polesConfig === '3P' ? uLineToLine : uLineToNeutral
}

const cablePathIndexByQuery = new WeakMap<object, Map<string, CircuitCablePath[]>>()

function circuitCablePaths(context: CheckContext, circuitId: string): CircuitCablePath[] {
  let index = cablePathIndexByQuery.get(context.query)
  if (!index) {
    index = buildCircuitCablePathIndex(context.project)
    cablePathIndexByQuery.set(context.query, index)
  }
  return index.get(circuitId) ?? []
}

/** A specialist characteristic must not silently escape a check because inputs are absent. */
function circuitShortCircuitProtectionVerifiable(context: CheckContext): CheckResult {
  const { scope, query } = context
  if (scope.type !== 'circuit') return { passed: true }
  if (isPanelPlacementCarrierCircuit(query, scope.id)) {
    return { passed: true, coverage: { status: 'skipped', reason: 'panel-placement-carrier-is-not-an-electrical-feed' } }
  }
  const circuit = query.getCircuitById(scope.id)
  const protection = query.getProtectionForCircuit(scope.id)
  if (!circuit) return { passed: true }
  if (!protection || protection.dcBusId != null) {
    return { passed: true, coverage: { status: 'missing-information', reason: 'protective-device-not-modeled', missingFacts: ['upstream protective device'] } }
  }
  if (protection.type !== 'MCB' && protection.type !== 'RCBO') return { passed: true }
  if (!isSpecialistProtectionCurve(protection.curve)) return { passed: true }

  const curve = protection.curve!
  const supportedCurve = instantaneousTripCurrentA(1, curve) != null
  const paths = circuitCablePaths(context, circuit.id)
  const positive = (value: number | undefined): boolean =>
    value != null && Number.isFinite(value) && value > 0
  const complete = supportedCurve && positive(protection.ratingA) && paths.length > 0 &&
    paths.every((path) => path.missingLengthAnchors.length === 0 &&
      path.edges.every((edge) => positive(edge.lengthM) &&
        positive(edge.cable?.sectionMm2 ?? circuit.cable?.sectionMm2)))
  if (complete) return { passed: true, coverage: { status: 'passed' } }

  const missingFacts = [
    ...(!supportedCurve ? ['supported protective-device curve model'] : []),
    ...(!positive(protection.ratingA) ? ['protective-device current rating'] : []),
    ...(paths.length === 0 ? ['modeled cable path'] : []),
    ...(paths.some((path) => path.missingLengthAnchors.length > 0) ? ['complete route length / connected cable anchors'] : []),
    ...(paths.some((path) => path.edges.some((edge) => !positive(edge.lengthM))) ? ['cable edge length'] : []),
    ...(paths.some((path) => path.edges.some((edge) => !positive(edge.cable?.sectionMm2 ?? circuit.cable?.sectionMm2))) ? ['cable cross-section'] : []),
  ]

  return {
    passed: false,
    coverage: {
      status: supportedCurve ? 'missing-information' : 'unavailable',
      reason: supportedCurve
        ? 'short-circuit-protection-could-not-be-verified-from-entered-data'
        : 'unsupported-protection-curve',
      missingFacts,
    },
    offenders: [
      { kind: 'circuit', id: circuit.id, viewHint: 'eendraad' },
      { kind: 'protection', id: protection.id, viewHint: 'eendraad' },
    ],
    message: i18n.t('validation.primitives.circuitShortCircuitProtectionVerifiable.message', {
      circuitCode: validationCircuitCode(circuit.code), curve,
    }),
    details: i18n.t(supportedCurve
      ? 'validation.primitives.circuitShortCircuitProtectionVerifiable.missingData'
      : 'validation.primitives.circuitShortCircuitProtectionVerifiable.unsupportedCurve'),
  }
}

/**
 * AREI 5.3.5.5.h: a fault at the far end of the circuit must still reach the breaker's
 * instantaneous trip current. Only entered lengths are summed, so the result is a lower bound
 * and the check only fails when the circuit is certainly too long.
 */
function circuitWithinMaximumProtectedLength(context: CheckContext): CheckResult {
  const { scope, query, project } = context
  if (scope.type !== 'circuit') return { passed: true }
  if (isPanelPlacementCarrierCircuit(query, scope.id)) {
    return { passed: true, coverage: { status: 'skipped', reason: 'panel-placement-carrier-is-not-an-electrical-feed' } }
  }
  const circuit = query.getCircuitById(scope.id)
  if (!circuit) return { passed: true }
  const protection = query.getProtectionForCircuit(scope.id)
  if (!protection || protection.dcBusId != null) return { passed: true }
  if (protection.type !== 'MCB' && protection.type !== 'RCBO') return { passed: true }
  const tripCurrentA = instantaneousTripCurrentA(protection.ratingA, protection.curve)
  if (tripCurrentA == null) {
    return {
      passed: true,
      coverage: {
        status: 'missing-information',
        reason: 'protective-device-rating-or-trip-curve-unavailable',
        missingFacts: [
          ...(!protection.ratingA || protection.ratingA <= 0 ? ['protective-device current rating'] : []),
          ...(!protection.curve ? ['protective-device trip curve'] : []),
        ],
      },
    }
  }

  const installation = projectInstallation(project)
  // A board on its own transformer output loops at that output's voltage.
  const voltageV = faultLoopVoltageV(
    installation ? resolveCircuitNominalVoltage(installation, projectPanels(project), circuit.id) : undefined,
    protection
  )
  const paths = circuitCablePaths(context, circuit.id)
  let worst: { path: CircuitCablePath; maxLengthM: number; sectionMm2: number } | undefined
  for (const path of paths) {
    const sectionMm2 = path.minSectionMm2 ?? circuit.cable?.sectionMm2
    if (!sectionMm2 || path.knownLengthM <= 0) continue
    const material = path.edges.some((edge) => edge.material === 'aluminium')
      ? 'aluminium'
      : 'copper'
    const maxLengthM = maximumProtectedLengthM({ voltageV, sectionMm2, material, tripCurrentA })
    if (maxLengthM == null || path.knownLengthM <= maxLengthM) continue
    if (!worst || path.knownLengthM - maxLengthM > worst.path.knownLengthM - worst.maxLengthM) {
      worst = { path, maxLengthM, sectionMm2 }
    }
  }
  const missingFacts = [
    ...(paths.length === 0 ? ['modeled cable path'] : []),
    ...(paths.some((path) => path.missingLengthAnchors.length > 0) ? ['complete route length / connected cable anchors'] : []),
    ...(paths.some((path) => path.edges.some((edge) => !edge.lengthM || edge.lengthM <= 0)) ? ['cable edge length'] : []),
    ...(paths.some((path) => path.edges.some((edge) => !(path.minSectionMm2 ?? circuit.cable?.sectionMm2 ?? edge.cable?.sectionMm2))) ? ['cable cross-section'] : []),
    ...(query.getCableSegments(circuit.id).length === 0 || query.getCableSegments(circuit.id).some((segment) => !query.getInstallationMethod(segment)) ? ['cable installation method'] : []),
    ...(paths.some((path) => path.edges.some((edge) => !edge.material && !edge.cable?.kind)) ? ['conductor material'] : []),
    ...(!projectInstallation(project)?.nominalVoltage?.system ? ['nominal voltage system'] : []),
  ]
  if (!worst) {
    return {
      passed: true,
      ...(missingFacts.length > 0 ? {
        coverage: {
          status: 'missing-information' as const,
          reason: 'known-data-does-not-prove-protected-length-compliance',
          missingFacts,
        },
      } : {}),
    }
  }

  const circuitCode = validationCircuitCode(circuit.code)
  const lengthM = Math.round(worst.path.knownLengthM)
  const maxLengthM = Math.floor(worst.maxLengthM)
  const curve = protection.curve ?? ''
  const ratingA = protection.ratingA ?? 0
  return {
    passed: false,
    ...(missingFacts.length > 0 ? {
      coverage: {
        status: 'failed' as const,
        reason: 'known-cable-length-exceeds-protected-maximum-with-some-data-incomplete',
        missingFacts,
      },
    } : {}),
    offenders: [
      { kind: 'circuit', id: circuit.id, viewHint: 'eendraad' },
      { kind: 'protection', id: protection.id, viewHint: 'eendraad' },
    ],
    message: i18n.t('validation.primitives.circuitWithinMaximumProtectedLength.message', {
      circuitCode,
      lengthM,
      maxLengthM,
      defaultValue: `Circuit ${circuitCode}: ${lengthM} m of cable exceeds the protected length of ${maxLengthM} m`,
    }),
    details: i18n.t('validation.primitives.circuitWithinMaximumProtectedLength.details', {
      curve,
      ratingA,
      sectionMm2: worst.sectionMm2,
      tripCurrentA: Math.round(tripCurrentA),
      maxLengthM,
      defaultValue: `A short circuit at the far end must still trip the ${curve}${ratingA} instantly (${Math.round(tripCurrentA)} A). With ${worst.sectionMm2} mm² that allows at most ${maxLengthM} m. Use a larger section, a shorter route, or a lower rating or curve.`,
    }),
  }
}

type BreakingCapacityDevice = {
  id: string
  label?: string
  breakingCapacityKa?: number
  offenderKind: 'protection' | 'device'
}

/**
 * Overcurrent devices whose breaking capacity applies at this board: the board's own AC
 * devices and, for a main board, the supply devices after the meter (before it is the
 * network operator's connection device).
 */
function boardOvercurrentDevices(context: CheckContext, panel: Panel): BreakingCapacityDevice[] {
  const devices: BreakingCapacityDevice[] = panel.protections
    .filter(
      (protection) =>
        !isStructuralCarrier(protection) &&
        protection.dcBusId == null &&
        isOvercurrentProtectionType(protection.type)
    )
    .map((protection) => ({
      id: protection.id,
      label: protection.label,
      breakingCapacityKa: protection.breakingCapacityKa,
      offenderKind: 'protection' as const,
    }))
  const installation = projectInstallation(context.project)
  if (!panel.isMain || !installation) return devices
  const trunk = getPanelFeedProjection(installation, projectPanels(context.project), panel)?.devices ?? []
  const meterIndex = trunk.findIndex((device) => device.type === 'energy_meter')
  trunk.forEach((device: TrunkDevice, index) => {
    if (index < meterIndex) return
    if (device.type !== 'protection' || !isOvercurrentProtectionType(device.protectionType)) return
    devices.push({
      id: device.id,
      label: device.label,
      breakingCapacityKa: device.breakingCapacityKa,
      offenderKind: 'device',
    })
  })
  return devices
}

function nonHouseholdBoard(context: CheckContext): Panel | undefined {
  const { scope, query, project } = context
  if (scope.type !== 'board') return undefined
  const installation = projectInstallation(project)
  if (!installation || isHouseholdInstallation(installation)) return undefined
  const country = installation.address?.country
  if (country && country !== 'BE') return undefined
  return query.getPanelById(scope.id) ?? undefined
}

function formatKa(ka: number): string {
  return String(Math.round(ka * 100) / 100)
}

/** AREI 3.1.2.2(b), 3.1.3.3(b): non-household boards state their expected maximum short-circuit current. */
function nonHouseholdBoardShortCircuitStated(context: CheckContext): CheckResult {
  const panel = nonHouseholdBoard(context)
  if (!panel) return { passed: true }
  if (panel.expectedShortCircuitKa != null && panel.expectedShortCircuitKa > 0) {
    return { passed: true }
  }
  return {
    passed: false,
    offenders: [{ kind: 'board', id: panel.id, viewHint: 'eendraad' }],
    coverage: {
      status: 'missing-information',
      reason: 'expected-short-circuit-current-not-entered',
      missingFacts: ['expected maximum short-circuit current at the board'],
    },
    message: i18n.t('validation.primitives.nonHouseholdBoardShortCircuitStated.message', {
      panelName: panel.name,
      defaultValue: `Board ${panel.name} has no expected short-circuit current`,
    }),
    details: i18n.t('validation.primitives.nonHouseholdBoardShortCircuitStated.details', {
      defaultValue:
        'Non-domestic diagrams and board markings state the expected maximum short-circuit current when it exceeds 3000 A. It is also needed to verify breaking capacities.',
    }),
  }
}

/** AREI 4.4.2.1, 5.3.5.5(e): breaking capacity at least the expected short-circuit current. */
function nonHouseholdBreakingCapacity(context: CheckContext): CheckResult {
  const panel = nonHouseholdBoard(context)
  if (!panel) return { passed: true }
  const expectedKa = panel.expectedShortCircuitKa
  if (expectedKa == null || expectedKa <= 0) {
    return {
      passed: true,
      coverage: {
        status: 'missing-information',
        reason: 'expected-short-circuit-current-not-entered',
        missingFacts: ['expected maximum short-circuit current at the board'],
      },
    }
  }
  const low = boardOvercurrentDevices(context, panel).filter(
    (device) => device.breakingCapacityKa != null && device.breakingCapacityKa < expectedKa
  )
  if (low.length === 0) return { passed: true, coverage: { status: 'passed' } }
  const labels = low.map((device) => validationProtectionLabel(device.label)).join(', ')
  const ka = formatKa(expectedKa)
  return {
    passed: false,
    offenders: low.map((device) => ({ kind: device.offenderKind, id: device.id, viewHint: 'eendraad' as const })),
    message: i18n.t('validation.primitives.nonHouseholdBreakingCapacity.message', {
      labels,
      ka,
      defaultValue: `Breaking capacity below ${ka} kA: ${labels}`,
    }),
    details: i18n.t('validation.primitives.nonHouseholdBreakingCapacity.details', {
      ka,
      defaultValue: `The expected short-circuit current at this board is ${ka} kA. Each overcurrent device needs at least that breaking capacity, unless an upstream device covers it by cascading (filiation) according to the manufacturer's tables.`,
    }),
  }
}

/** AREI 3.1.2.2(b): non-household diagrams show each protective device's breaking capacity. */
function nonHouseholdBreakingCapacityShown(context: CheckContext): CheckResult {
  const panel = nonHouseholdBoard(context)
  if (!panel) return { passed: true }
  const missing = boardOvercurrentDevices(context, panel).filter(
    (device) => device.breakingCapacityKa == null
  )
  if (missing.length === 0) return { passed: true }
  const labels = missing.map((device) => validationProtectionLabel(device.label)).join(', ')
  return {
    passed: false,
    offenders: missing.map((device) => ({ kind: device.offenderKind, id: device.id, viewHint: 'eendraad' as const })),
    message: i18n.t('validation.primitives.nonHouseholdBreakingCapacityShown.message', {
      labels,
      defaultValue: `Breaking capacity not entered: ${labels}`,
    }),
    details: i18n.t('validation.primitives.nonHouseholdBreakingCapacityShown.details', {
      defaultValue: 'Non-domestic circuit diagrams state the breaking capacity of every protective device.',
    }),
  }
}

/** AREI 3.1.2.2(b): an own supply transformer documents its apparent power and impedance. */
function nonHouseholdSupplyTransformerDocumented(context: CheckContext): CheckResult {
  const panel = nonHouseholdBoard(context)
  if (!panel?.isMain) return { passed: true }
  const installation = projectInstallation(context.project)
  if (!installation) return { passed: true }
  const incomplete = getInstallationSupplyTransformers(installation).filter((device) => {
    if (device.conversionProps?.transformerRole !== 'supply') return false
    const props = device.conversionProps
    return !(props?.transformerRatedPowerKva && props.transformerRatedPowerKva > 0) ||
      !(props?.transformerShortCircuitVoltagePercent && props.transformerShortCircuitVoltagePercent > 0)
  })
  if (incomplete.length === 0) return { passed: true }
  return {
    passed: false,
    offenders: incomplete.map((device) => ({ kind: 'device' as const, id: device.id, viewHint: 'eendraad' as const })),
    message: i18n.t('validation.primitives.nonHouseholdSupplyTransformerDocumented.message', {
      defaultValue: 'Supply transformer power or short-circuit voltage is missing',
    }),
    details: i18n.t('validation.primitives.nonHouseholdSupplyTransformerDocumented.details', {
      defaultValue:
        'Non-domestic diagrams state the characteristics of the sources, including the apparent power and impedance of a supply transformer.',
    }),
  }
}

registerPrimitive('householdBoardBreakingCapacity', householdBoardBreakingCapacity)
registerPrimitive('nonHouseholdBoardShortCircuitStated', nonHouseholdBoardShortCircuitStated)
registerPrimitive('nonHouseholdBreakingCapacity', nonHouseholdBreakingCapacity)
registerPrimitive('nonHouseholdBreakingCapacityShown', nonHouseholdBreakingCapacityShown)
registerPrimitive('nonHouseholdSupplyTransformerDocumented', nonHouseholdSupplyTransformerDocumented)
registerPrimitive('householdSupplyBreakingCapacity', householdSupplyBreakingCapacity)
registerPrimitive('circuitWithinMaximumProtectedLength', circuitWithinMaximumProtectedLength)
registerPrimitive('circuitShortCircuitProtectionVerifiable', circuitShortCircuitProtectionVerifiable)
