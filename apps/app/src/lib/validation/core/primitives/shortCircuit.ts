import { registerPrimitive } from './registry'
import type { CheckContext, CheckResult, Offender, ProtectionDevice, TrunkDevice } from './common'
import {
  getPanelFeedProjection,
  i18n,
  projectInstallation,
  projectPanels,
  validationCircuitCode,
  validationProtectionLabel,
} from './common'
import { defaultVoltagesForSystem, normalizeNominalVoltageSystem } from '@/constants/nominalVoltage'
import { isHouseholdInstallation } from '@/lib/installationProfile'
import { isOvercurrentProtectionType } from '@/lib/protectionKind'
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
  installation: Installation | undefined,
  protection: ProtectionDevice
): number {
  const system = normalizeNominalVoltageSystem(installation?.nominalVoltage?.system ?? '2~')
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

/**
 * AREI 5.3.5.5.h: a fault at the far end of the circuit must still reach the breaker's
 * instantaneous trip current. Only entered lengths are summed, so the result is a lower bound
 * and the check only fails when the circuit is certainly too long.
 */
function circuitWithinMaximumProtectedLength(context: CheckContext): CheckResult {
  const { scope, query, project } = context
  if (scope.type !== 'circuit') return { passed: true }
  const circuit = query.getCircuitById(scope.id)
  if (!circuit) return { passed: true }
  const protection = query.getProtectionForCircuit(scope.id)
  if (!protection || protection.dcBusId != null) return { passed: true }
  if (protection.type !== 'MCB' && protection.type !== 'RCBO') return { passed: true }
  const tripCurrentA = instantaneousTripCurrentA(protection.ratingA, protection.curve)
  if (tripCurrentA == null) return { passed: true }

  const voltageV = faultLoopVoltageV(projectInstallation(project), protection)
  let worst: { path: CircuitCablePath; maxLengthM: number; sectionMm2: number } | undefined
  for (const path of circuitCablePaths(context, circuit.id)) {
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
  if (!worst) return { passed: true }

  const circuitCode = validationCircuitCode(circuit.code)
  const lengthM = Math.round(worst.path.knownLengthM)
  const maxLengthM = Math.floor(worst.maxLengthM)
  const curve = protection.curve ?? ''
  const ratingA = protection.ratingA ?? 0
  return {
    passed: false,
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

registerPrimitive('householdBoardBreakingCapacity', householdBoardBreakingCapacity)
registerPrimitive('householdSupplyBreakingCapacity', householdSupplyBreakingCapacity)
registerPrimitive('circuitWithinMaximumProtectedLength', circuitWithinMaximumProtectedLength)
