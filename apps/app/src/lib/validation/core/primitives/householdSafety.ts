import { registerPrimitive } from './registry'
import type { CheckContext, CheckResult, Offender, ProtectionDevice, TrunkDevice } from './common'
import { i18n, isPanelPlacementCarrierCircuit, projectInstallation, projectPanels } from './common'
import { isBelgianInstallation } from './earthing'
import { isHouseholdInstallation } from '@/lib/installationProfile'
import { getPanelBusSectionFeedProjection } from '@/lib/feedTopology'
import { getPanelBusSections } from '@/lib/panel/panelBusSections'
import { collectEarthingStems, findCanonicalEarthingBoard } from '@/lib/eendraad/panelGround'
import { isOvercurrentProtectionType } from '@/lib/protectionKind'
import {
  circuitUpstreamProtections,
  downstreamFinalCircuits,
  rcdGroupingQualification,
} from '../../upstreamProtection'
import { getApplicableRulesetDate } from '../date-resolver'
import { hasLegacyRcdGroupingDate } from '../../rcdGroupingDate'
import { getCircuitSegmentsForValidation } from '../../circuitCableSection'
import { circuitCableSpecificationSegments, missingCableSpecificationSegments } from '../../cableSpecifications'
import { isStructuralCarrierProtection } from '@/lib/eendraad/structuralCarrier'

function finding(key: string, offenders: Offender[], missingFacts?: string[]): CheckResult {
  return {
    passed: false,
    offenders,
    message: i18n.t(`validation.primitives.feedbackSafety.${key}.message`),
    details: i18n.t(`validation.primitives.feedbackSafety.${key}.details`),
    ...(missingFacts
      ? { coverage: { status: 'missing-information' as const, reason: key, missingFacts } }
      : {}),
  }
}

function applicable(context: CheckContext): boolean {
  const installation = projectInstallation(context.project)
  return isBelgianInstallation(installation) && isHouseholdInstallation(installation)
}

type BoardDevice = { device: ProtectionDevice | TrunkDevice; kind: 'protection' | 'device' }
function boardDevices(context: CheckContext): BoardDevice[] {
  const panel = context.query.getPanelById(context.scope.id)
  if (!panel) return []
  const devices: BoardDevice[] = panel.protections
    .filter(
      (device) => !isStructuralCarrierProtection(device) && device.dcBusId == null
    )
    .map((device) => ({ device, kind: 'protection' }))
  for (const circuit of context.query.getCircuits(panel.id)) {
    if (circuit.dcBusSource) continue
    for (const device of circuit.trunkDevices ?? []) {
      if (device.type === 'protection' && !device.converterDcConnection)
        devices.push({ device, kind: 'device' })
    }
  }
  const installation = projectInstallation(context.project)
  if (panel.isMain && installation) {
    const sharedOwner = context.query.getBoards().find((candidate) => candidate.isMain)?.id
    for (const section of getPanelBusSections(panel)) {
      const projection = getPanelBusSectionFeedProjection(
        installation,
        projectPanels(context.project),
        panel,
        section.id
      )
      for (const [index, device] of (projection?.devices ?? []).entries()) {
        if (index < (projection?.sharedDeviceCount ?? 0) && sharedOwner !== panel.id) continue
        if (device.type === 'protection' && !device.converterDcConnection)
          devices.push({ device, kind: 'device' })
      }
    }
  }
  return [...new Map(devices.map((entry) => [entry.device.id, entry])).values()]
}

function householdRcdWaveform(context: CheckContext): CheckResult {
  if (context.scope.type !== 'board' || !applicable(context))
    return { passed: true, coverage: { status: 'passed' } }
  const offenders = boardDevices(context)
    .filter(
      ({ device }) =>
        (device.type === 'RCD' ||
          device.type === 'RCBO' ||
          (device.type === 'protection' &&
            (device.protectionType === 'RCD' || device.protectionType === 'RCBO'))) &&
        device.residualCurrentType === 'AC'
    )
    .map(({ device, kind }) => ({ kind, id: device.id, viewHint: 'eendraad' as const }))
  return offenders.length
    ? finding('rcdType', offenders)
    : { passed: true, coverage: { status: 'passed' } }
}

function householdBreakingCapacityKnown(context: CheckContext): CheckResult {
  if (context.scope.type !== 'board' || !applicable(context))
    return { passed: true, coverage: { status: 'passed' } }
  const offenders = boardDevices(context)
    .filter(
      ({ device }) =>
        (device.type === 'MCB' ||
          device.type === 'RCBO' ||
          device.type === 'FUSE' ||
          (device.type === 'protection' && isOvercurrentProtectionType(device.protectionType))) &&
        (device.breakingCapacityKa == null ||
          !Number.isFinite(device.breakingCapacityKa) ||
          device.breakingCapacityKa <= 0)
    )
    .map(({ device, kind }) => ({ kind, id: device.id, viewHint: 'eendraad' as const }))
  return offenders.length
    ? finding('breakingCapacity', offenders, ['protective-device breaking capacity'])
    : { passed: true, coverage: { status: 'passed' } }
}

function installationHasEarthingSeparator(context: CheckContext): CheckResult {
  if (context.scope.type !== 'board' || !applicable(context))
    return { passed: true, coverage: { status: 'passed' } }
  const panels = projectPanels(context.project)
  const main = findCanonicalEarthingBoard(panels)
  if (!main || main.id !== context.scope.id) return { passed: true, coverage: { status: 'passed' } }
  const installation = projectInstallation(context.project)
  const offenders: Offender[] = []
  for (const stem of collectEarthingStems(panels, installation)) {
    const owner = stem.kind === 'panel' ? context.query.getPanelById(stem.panelId) : undefined
    const devices =
      stem.kind === 'panel' ? owner?.groundTrunkDevices : installation?.groundTrunkDevices
    if (!devices?.some((device) => device.type === 'earthing_separator')) {
      offenders.push({ kind: 'board', id: owner?.id ?? main.id, viewHint: 'eendraad' })
    }
  }
  return offenders.length
    ? finding('earthingSeparator', offenders)
    : { passed: true, coverage: { status: 'passed' } }
}

function householdSocketSafety(context: CheckContext): CheckResult {
  if (context.scope.type !== 'circuit' || !applicable(context))
    return { passed: true, coverage: { status: 'passed' } }
  // A documented old electrical installation can retain otherwise permitted legacy outlets.
  if (getApplicableRulesetDate(context.project, context.scope) < 1981) {
    return {
      passed: true,
      coverage: { status: 'skipped', reason: 'legacy-socket-derogation-needs-inspection' },
    }
  }
  const circuit = context.query.getCircuitById(context.scope.id)
  const offenders = (circuit?.endpoints ?? [])
    .filter((endpoint) => ['socket', 'socket_gnd', 'socket_child'].includes(endpoint.symbol ?? ''))
    .map((endpoint) => ({ kind: 'endpoint' as const, id: endpoint.id, viewHint: 'both' as const }))
  return offenders.length
    ? finding('socketSafety', offenders)
    : { passed: true, coverage: { status: 'passed' } }
}

function householdSocketProtection(context: CheckContext): CheckResult {
  if (context.scope.type !== 'circuit' || !applicable(context))
    return { passed: true, coverage: { status: 'passed' } }
  const circuit = context.query.getCircuitById(context.scope.id)
  if (
    !circuit?.endpoints.some((endpoint) =>
      [
        'socket',
        'socket_gnd',
        'socket_child',
        'socket_gnd_child',
        'double_socket_gnd_child',
      ].includes(endpoint.symbol ?? '')
    )
  )
    return { passed: true, coverage: { status: 'passed' } }
  const protections = circuitUpstreamProtections(context, circuit.id).filter((device) =>
    isOvercurrentProtectionType(device.type)
  )
  // A smaller downstream breaker limits the socket even when the main breaker is larger.
  const protectsSockets = protections.some(
    (device) =>
      device.ratingA != null &&
      Number.isFinite(device.ratingA) &&
      device.ratingA > 0 &&
      device.ratingA <= (device.type === 'FUSE' ? 16 : 20)
  )
  if (protectsSockets) return { passed: true, coverage: { status: 'passed' } }
  if (
    protections.length === 0 ||
    protections.some(
      (device) => device.ratingA == null || !Number.isFinite(device.ratingA) || device.ratingA <= 0
    )
  ) {
    return {
      passed: true,
      coverage: {
        status: 'missing-information',
        reason: 'socket-protection-rating-not-entered',
        missingFacts: ['socket circuit overcurrent protection rating'],
      },
    }
  }
  return finding('socketProtection', [{ kind: 'circuit', id: circuit.id, viewHint: 'eendraad' }])
}

function circuitCableSpecifications(
  context: CheckContext,
  params?: Record<string, unknown>
): CheckResult {
  if (context.scope.type !== 'circuit' || !applicable(context))
    return { passed: true, coverage: { status: 'passed' } }
  const circuit = context.query.getCircuitById(context.scope.id)
  if (
    !circuit ||
    circuit.endpoints.length === 0 ||
    circuit.dcBusSource ||
    isPanelPlacementCarrierCircuit(context.query, circuit.id)
  ) {
    return {
      passed: true,
      coverage: { status: 'skipped', reason: 'not-an-active-ac-cable-circuit' },
    }
  }
  const { segments } = getCircuitSegmentsForValidation(context.query, circuit.id)
  const cables = circuitCableSpecificationSegments(segments, circuit.id)
  const fireClass = params?.field === 'fireClass'
  const missing = cables.length > 0
    ? missingCableSpecificationSegments(cables, circuit.id, fireClass ? 'fireClass' : 'placement').length > 0
    : segments.length > 0
      ? false // This circuit has only internal rails or DC wiring.
      : fireClass ? !circuit.cable.fireClass : circuit.wireRoute == null && !circuit.inTube
  if (!missing) return { passed: true, coverage: { status: 'passed' } }
  return {
    ...finding(
      fireClass ? 'fireClass' : 'placement',
      [{ kind: 'circuit', id: circuit.id, viewHint: 'eendraad' }],
      [fireClass ? 'cable fire classification' : 'cable installation method']
    ),
    // One project-wide notice per specification, retaining each affected circuit.
    mergeBucket: 'missing-cable-specification',
  }
}

/** Volta: built-in 6 mA detection protects one charger, not an arbitrary upstream Type A group. */
function evUpstreamDcCoordination(context: CheckContext): CheckResult {
  if (
    context.scope.type !== 'board' ||
    !isBelgianInstallation(projectInstallation(context.project))
  )
    return { passed: true, coverage: { status: 'passed' } }
  const panel = context.query.getPanelById(context.scope.id)
  if (!panel) return { passed: true, coverage: { status: 'passed' } }
  const candidates = boardDevices(context).filter(
    ({ device }) =>
      (device.type === 'RCD' ||
        device.type === 'RCBO' ||
        (device.type === 'protection' &&
          (device.protectionType === 'RCD' || device.protectionType === 'RCBO'))) &&
      device.residualCurrentType === 'A'
  )
  const offenders: Offender[] = []
  for (const { device, kind } of candidates) {
    const circuits = downstreamFinalCircuits(context, device.id).filter((circuit) =>
      circuit.endpoints.some((endpoint) => endpoint.symbol === 'ev')
    )
    const chargers = circuits.flatMap((circuit) =>
      circuit.endpoints.filter((endpoint) => endpoint.symbol === 'ev')
    )
    const hasDownstreamTypeB = circuits.some((circuit) => {
      const path = circuitUpstreamProtections(context, circuit.id)
      const deviceIndex = path.findIndex((upstream) => upstream.id === device.id)
      return path.slice(0, deviceIndex).some((upstream) => upstream.residualCurrentType === 'B')
    })
    if (chargers.length > 1 || (chargers.length > 0 && hasDownstreamTypeB)) {
      offenders.push({ kind, id: device.id, viewHint: 'eendraad' })
    }
  }
  return offenders.length
    ? finding('evCoordination', offenders, ['manufacturer-approved upstream RCD DC coordination'])
    : { passed: true, coverage: { status: 'passed' } }
}

function supplyRcdCircuitCount(context: CheckContext): CheckResult {
  if (context.scope.type !== 'board' || !applicable(context))
    return { passed: true, coverage: { status: 'passed' } }
  const offenders: Offender[] = []
  let hasUnknownPath = false
  for (const { device, kind } of boardDevices(context)) {
    if (kind !== 'device' || device.type !== 'protection' || device.protectionType !== 'RCD')
      continue
    if (
      device.sensitivityMa == null ||
      !Number.isFinite(device.sensitivityMa) ||
      device.sensitivityMa <= 0
    ) {
      hasUnknownPath = true
      continue
    }
    if (device.sensitivityMa > 30 || hasLegacyRcdGroupingDate(context, device)) continue
    const circuits = downstreamFinalCircuits(context, device.id)
    if (circuits.length === 0) continue
    const qualification = rcdGroupingQualification(context, device.id)
    if (qualification === 'unknown') hasUnknownPath = true
    if (qualification !== 'downstream') continue
    if (circuits.length > 8) offenders.push({ kind, id: device.id, viewHint: 'eendraad' })
  }
  return offenders.length
    ? finding('rcdCircuitCount', offenders)
    : {
        passed: true,
        coverage: hasUnknownPath
          ? {
              status: 'missing-information',
              reason: 'main-rcd-path-not-confirmed',
              missingFacts: ['upstream main RCD and its sensitivity'],
            }
          : { status: 'passed' },
      }
}

registerPrimitive('householdRcdWaveform', householdRcdWaveform)
registerPrimitive('householdBreakingCapacityKnown', householdBreakingCapacityKnown)
registerPrimitive('installationHasEarthingSeparator', installationHasEarthingSeparator)
registerPrimitive('householdSocketSafety', householdSocketSafety)
registerPrimitive('householdSocketProtection', householdSocketProtection)
registerPrimitive('circuitCableSpecifications', circuitCableSpecifications)
registerPrimitive('evUpstreamDcCoordination', evUpstreamDcCoordination)
registerPrimitive('supplyRcdCircuitCount', supplyRcdCircuitCount)
