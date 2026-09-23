import { registerPrimitive } from './registry'
import type {
  CheckContext,
  CheckResult,
  Issue,
  ValidationProject,
  ProtectionType,
  Panel,
  CableSpec,
  TrunkDevice,
  ProtectionDevice,
} from './common'
import {
  detectPanelOrphans,
  orphanReportToIssues,
  findDuplicateProtectionLabelGroupsOnPanel,
  getPanelFeedProjection,
  trunkDeviceCountsAsProtection,
  resolvePanelSupplyLinkForPanelInPanels,
  i18n,
  projectPanels,
  projectInstallation,
} from './common'
import { isHouseholdInstallation } from '@/lib/installationProfile'
import { resolveEffectiveEarthingSystem } from '@/lib/panel/panelEarthingSync'
import {
  getActiveConductorCount,
  getEffectiveCircuitPhaseState,
  getFullInstallationPhaseAssignment,
  getPanelIncomingPhaseState,
  supportsExplicitPhaseSelection,
} from '@/lib/wires/phaseAssignment'
import type { CircuitPhaseAssignment } from '@/types/schema'

function activeConductorsForSystem(system: string | undefined): number {
  switch (system) {
    case '1~':
    case '2~':
    case '1N~':
      return 2
    case '3~':
      return 3
    case '3N~':
      return 4
    case 'DC':
      return 2
    default:
      return 2
  }
}

/**
 * Current-carrying conductors in a cable for isolation checks.
 * When hasPE is true, one conductor is treated as protective earth.
 */
function activeConductorsFromCableSpec(cable: CableSpec): number | undefined {
  if (!Number.isFinite(cable.conductors) || cable.conductors < 1) return undefined
  if (cable.hasPE === true) {
    return Math.max(1, cable.conductors - 1)
  }
  return cable.conductors
}

/**
 * Active conductors that must be switched to isolate this board: prefer the incoming
 * PANEL supply cable (e.g. single-phase subfeed while installation nominal is 3~),
 * else the upstream feeder circuit cable for sub-panels, else nominal system.
 */
function activeConductorsForBoardIsolation(panel: Panel, project: ValidationProject): number {
  const panelSupplyCable = panel.circuits.find((c) => c.code === 'PANEL')?.cable
  if (panelSupplyCable) {
    const n = activeConductorsFromCableSpec(panelSupplyCable)
    if (n != null) return n
  }

  if (!panel.isMain) {
    const feeder = findUpstreamFeederProtectionForPanel(projectPanels(project), panel.id)
    const feederCable = feeder?.circuits?.[0]?.cable
    if (feederCable) {
      const n = activeConductorsFromCableSpec(feederCable)
      if (n != null) return n
    }
  }

  return activeConductorsForSystem(projectInstallation(project)?.nominalVoltage?.system)
}

function poleCountFromDevice(device: { polesConfig?: string; poles?: number }): number | undefined {
  if (device.poles != null && device.poles > 0) return device.poles
  switch (device.polesConfig) {
    case '1P':
      return 1
    case '1P+N':
      return 2
    case '2P':
      return 2
    case '3P':
      return 3
    case '3P+N':
      return 4
    case '4P':
      return 4
    default:
      return undefined
  }
}

type PhaseProtectionDevice = {
  id: string
  label?: string
  polesConfig?: string
  poles?: number
}

type PhaseCompatibilityReason = 'neutralUnavailable' | 'tooManyPoles' | 'tooFewPoles'

type PhaseCompatibilityCandidate = {
  device: PhaseProtectionDevice
  assignment: CircuitPhaseAssignment
  reason: PhaseCompatibilityReason
  offenderKind: 'protection' | 'device'
  poleCount: number
  availablePoleCount: number
  deviceLabel: string
}

function phaseAssignmentGroupKey(assignment: CircuitPhaseAssignment): string {
  return `${assignment.kind}:${assignment.phases.join('-')}:${assignment.neutral ?? ''}`
}

function getPhaseCompatibilityReason(
  device: PhaseProtectionDevice,
  assignment: CircuitPhaseAssignment
): PhaseCompatibilityReason | undefined {
  const poles = poleCountFromDevice(device)
  const activeConductors = getActiveConductorCount(assignment)
  if (poles == null || activeConductors == null) return undefined

  const expectsNeutral = device.polesConfig === '1P+N' || device.polesConfig === '3P+N'
  if (expectsNeutral && !assignment.phases.includes('N')) return 'neutralUnavailable'
  if (poles > activeConductors) return 'tooManyPoles'
  // A one-pole device on a phase-to-phase supply is the useful suspicious case.
  // Do not warn for common L+N arrangements where neutral is intentionally unswitched.
  if (poles < activeConductors && !assignment.phases.includes('N')) return 'tooFewPoles'
  return undefined
}

function protectionPhaseCompatibility(context: CheckContext): Issue[] {
  const { scope, query, project } = context
  if (scope.type !== 'board') return []
  const panel = query.getPanelById(scope.id)
  const installation = projectInstallation(project)
  const system = installation?.nominalVoltage.system
  if (!panel || !installation || !supportsExplicitPhaseSelection(system)) return []

  const panels = projectPanels(project)
  const fullAssignment = getFullInstallationPhaseAssignment(system)
  const panelIncoming = getPanelIncomingPhaseState(installation, panels, panel)
  const candidates: PhaseCompatibilityCandidate[] = []
  const seen = new Set<string>()
  const addCandidate = (
    device: PhaseProtectionDevice,
    assignment: CircuitPhaseAssignment | undefined,
    offenderKind: 'protection' | 'device'
  ) => {
    if (!assignment) return
    const reason = getPhaseCompatibilityReason(device, assignment)
    if (!reason) return
    const assignmentKey = phaseAssignmentGroupKey(assignment)
    const key = `${device.id}:${reason}:${assignmentKey}`
    if (seen.has(key)) return
    seen.add(key)

    const poleCount = poleCountFromDevice(device)
    const availablePoleCount = getActiveConductorCount(assignment)
    if (poleCount == null || availablePoleCount == null) return
    const deviceLabel =
      device.label?.trim() ||
      i18n.t('validation.primitives.protectionPhaseCompatibility.deviceLabel', {
        defaultValue: 'Protection',
      })
    candidates.push({
      device,
      assignment,
      reason,
      offenderKind,
      poleCount,
      availablePoleCount,
      deviceLabel,
    })
  }

  for (const protection of panel.protections) {
    const assignments = (protection.circuits ?? []).map(
      (circuit) => getEffectiveCircuitPhaseState(circuit, panels, system, installation).assignment
    )
    if (assignments.length === 0) {
      assignments.push(panelIncoming.assignment ?? fullAssignment)
    }
    for (const assignment of assignments) addCandidate(protection, assignment, 'protection')
  }

  // Root-feed devices are ordered from supply to bus. Once the incoming protection
  // narrows the feed, later panel-side devices see that reduced phase set.
  const projection = getPanelFeedProjection(installation, panels, panel)
  const rootDevices = projection?.rootFeed?.trunkDevices ?? []
  let rootAssignment = projection?.rootFeed?.phaseAssignment ?? fullAssignment
  for (const device of rootDevices) {
    if (trunkDeviceCountsAsProtection(device)) {
      addCandidate(device, rootAssignment, 'device')
    }
    if (device.id === panelIncoming.lockedByProtectionId) {
      rootAssignment = panelIncoming.assignment
    }
  }

  const grouped = new Map<string, PhaseCompatibilityCandidate[]>()
  for (const candidate of candidates) {
    const key = phaseAssignmentGroupKey(candidate.assignment)
    const bucket = grouped.get(key) ?? []
    bucket.push(candidate)
    grouped.set(key, bucket)
  }

  const defaults: Record<PhaseCompatibilityReason, { message: string; details: string }> = {
    neutralUnavailable: {
      message: `{{deviceLabel}} uses neutral, but this network has none`,
      details: 'This combination may not make sense. Check the phase or pole setting.',
    },
    tooManyPoles: {
      message: `{{deviceLabel}} is {{poleCount}}-pole; that may be too many for this {{availablePoleCount}}-pole supply`,
      details: 'This combination may not make sense. Check the pole setting.',
    },
    tooFewPoles: {
      message: `{{deviceLabel}} is {{poleCount}}-pole; that may be too few for this three-phase network`,
      details: 'This combination may not make sense. Check the pole setting.',
    },
  }

  return Array.from(grouped.entries()).map(([assignmentKey, group]): Issue => {
    const first = group[0]!
    const isGrouped = group.length > 1
    const genericLabel = i18n.t('validation.primitives.protectionPhaseCompatibility.deviceLabel', {
      defaultValue: 'Protection',
    })
    const deviceLabels = group
      .map((candidate, index) => candidate.device.label?.trim() || `${genericLabel} ${index + 1}`)
      .join(', ')
    const message = isGrouped
      ? i18n.t('validation.primitives.protectionPhaseCompatibility.group.message', {
          count: group.length,
          availablePoleCount: first.availablePoleCount,
          defaultValue:
            '{{count}} protections may not match this {{availablePoleCount}}-pole supply',
        })
      : i18n.t(
          `validation.primitives.protectionPhaseCompatibility.${first.reason}.message`,
          {
            deviceLabel: first.deviceLabel,
            poleCount: first.poleCount,
            availablePoleCount: first.availablePoleCount,
            defaultValue: defaults[first.reason].message,
          }
        )
    const details = isGrouped
      ? i18n.t('validation.primitives.protectionPhaseCompatibility.group.details', {
          deviceLabels,
          defaultValue:
            'Affected protections: {{deviceLabels}}. Check their phase and pole settings at this supply transition.',
        })
      : i18n.t(`validation.primitives.protectionPhaseCompatibility.${first.reason}.details`, {
          defaultValue: defaults[first.reason].details,
        })
    return {
      id: `be.areibook1.2025.phase-protection-compatibility:board:${panel.id}:${assignmentKey}:${isGrouped ? 'group' : first.reason}`,
      ruleId: 'be.areibook1.2025.phase-protection-compatibility',
      severity: 'warning',
      jurisdiction: installation.address.country || 'BE',
      rulesetVersion: '2025',
      scope: { type: 'board', id: panel.id },
      offenders: group.map((candidate) => ({
        kind: candidate.offenderKind,
        id: candidate.device.id,
        viewHint: 'both',
      })),
      message,
      details,
      citations: [],
      tags: ['phase', 'protection', 'consistency'],
    }
  })
}

function canDisconnectAllActiveConductors(
  device: {
    polesConfig?: string
    poles?: number
  },
  activeConductors: number
): boolean {
  const poles = poleCountFromDevice(device)
  // Backward compatibility: when poles are not modeled, assume capable.
  if (poles == null) return true
  return poles >= activeConductors
}

function findUpstreamFeederProtectionForPanel(
  rootPanels: Panel[],
  panelId: string
): ProtectionDevice | undefined {
  const protection = resolvePanelSupplyLinkForPanelInPanels(rootPanels, panelId)?.protection
  return protection?.directPanelFeeder || protection?.directDcBusFeeder
    ? undefined
    : protection
}

function hasPanelLocalIsolation(
  panel: Panel,
  activeConductors: number
): { ok: boolean; localDeviceId?: string } {
  const localMainSwitch = panel.protections.find(
    (p) =>
      p.type === 'MAIN_SWITCH' &&
      canDisconnectAllActiveConductors(
        {
          polesConfig: p.polesConfig,
          poles: p.poles,
        },
        activeConductors
      )
  )
  if (localMainSwitch) {
    return { ok: true, localDeviceId: localMainSwitch.id }
  }

  // Secondary panels can also host a local isolating/protective device on their
  // incoming PANEL supply wire (stored as trunkDevices on the PANEL circuit).
  const panelSupplyCircuit = panel.circuits.find((c) => c.code === 'PANEL')
  const panelSupplyProtection = panelSupplyCircuit?.trunkDevices?.find((td) => {
    if (!trunkDeviceCountsAsProtection(td)) return false
    const isolatingTypes: ProtectionType[] = ['MCB', 'RCD', 'RCBO', 'FUSE', 'MAIN_SWITCH']
    if (!td.protectionType || !isolatingTypes.includes(td.protectionType)) return false
    return canDisconnectAllActiveConductors(
      {
        polesConfig: td.polesConfig,
        poles: td.poles,
      },
      activeConductors
    )
  })
  if (panelSupplyProtection) {
    return { ok: true, localDeviceId: panelSupplyProtection.id }
  }
  return { ok: false }
}

function hasPanelUpstreamIsolation(
  context: CheckContext,
  panel: Panel,
  activeConductors: number
): { ok: boolean; upstreamDeviceId?: string } {
  const { query, project } = context

  if (panel.isMain) {
    const installation = projectInstallation(project)
    const projection = installation
      ? getPanelFeedProjection(installation, projectPanels(project), panel)
      : null
    const panelScopedSupplyProtections =
      ((projection?.rootFeed?.trunkDevices?.length ?? 0) > 0
        ? projection?.rootFeed?.trunkDevices
        : projection?.sharedFeed.trunkDevices
      )?.filter((td: TrunkDevice) => trunkDeviceCountsAsProtection(td)) ??
      query
        .getMainSupplyProtections()
        .filter((td: TrunkDevice) => trunkDeviceCountsAsProtection(td))

    const mainSupplyIsolator = panelScopedSupplyProtections.find((td: TrunkDevice) => {
      if (!trunkDeviceCountsAsProtection(td)) return false
      const isolatingTypes: ProtectionType[] = ['MCB', 'RCD', 'RCBO', 'FUSE', 'MAIN_SWITCH']
      if (!td.protectionType || !isolatingTypes.includes(td.protectionType)) return false
      return canDisconnectAllActiveConductors(
        {
          polesConfig: td.polesConfig,
          poles: td.poles,
        },
        activeConductors
      )
    })
    if (!mainSupplyIsolator) return { ok: false }
    return { ok: true, upstreamDeviceId: mainSupplyIsolator.id }
  }

  const feederProtection = findUpstreamFeederProtectionForPanel(projectPanels(project), panel.id)
  if (!feederProtection) return { ok: false }
  const isolatingTypes: ProtectionType[] = ['MCB', 'RCD', 'RCBO', 'FUSE', 'MAIN_SWITCH']
  if (!isolatingTypes.includes(feederProtection.type)) return { ok: false }
  if (
    !canDisconnectAllActiveConductors(
      {
        polesConfig: feederProtection.polesConfig,
        poles: feederProtection.poles,
      },
      activeConductors
    )
  ) {
    return { ok: false }
  }
  return { ok: true, upstreamDeviceId: feederProtection.id }
}

/**
 * AREI 5.3.5.1 hard rule:
 * every board must be globally disconnectable (local or upstream).
 */
function panelHasGlobalIsolation(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query, project } = context
  if (scope.type !== 'board') return { passed: true }

  const panel = query.getPanelById(scope.id)
  if (!panel) return { passed: true }

  const activeConductors = activeConductorsForBoardIsolation(panel, project)
  const localIsolation = hasPanelLocalIsolation(panel, activeConductors)
  const upstreamIsolation = hasPanelUpstreamIsolation(context, panel, activeConductors)

  if (localIsolation.ok || upstreamIsolation.ok) {
    return { passed: true }
  }

  return {
    passed: false,
    offenders: [{ kind: 'board', id: panel.id, viewHint: 'eendraad' }],
    message: i18n.t('validation.primitives.panelHasGlobalIsolation.message', {
      panelName: panel.name,
      defaultValue: `Panel ${panel.name} has no device that disconnects all active conductors`,
    }),
    details: i18n.t('validation.primitives.panelHasGlobalIsolation.details', {
      panelName: panel.name,
      defaultValue:
        'Every distribution board must be disconnectable by a scheidingsinrichting that disconnects all active conductors, either locally in the panel or via an upstream feeder device.',
    }),
  }
}

/**
 * AREI-inspired best practice warning:
 * panel is only isolatable upstream, not locally.
 */
function panelHasLocalIsolationHint(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult | Issue[] {
  const { scope, query, project } = context
  if (scope.type !== 'board') return { passed: true }

  const panel = query.getPanelById(scope.id)
  if (!panel) return { passed: true }
  // For the main panel, upstream disconnectability on the supply trunk is
  // considered sufficient in this hint rule. Keep the hard rule for global
  // isolation active for all panels.
  if (panel.isMain) return { passed: true }

  const activeConductors = activeConductorsForBoardIsolation(panel, project)
  const localIsolation = hasPanelLocalIsolation(panel, activeConductors)
  const upstreamIsolation = hasPanelUpstreamIsolation(context, panel, activeConductors)

  // Hard rule handles "no isolation at all". Warning is only for upstream-only.
  if (!upstreamIsolation.ok || localIsolation.ok) {
    return { passed: true }
  }

  return {
    passed: false,
    offenders: [{ kind: 'board', id: panel.id, viewHint: 'eendraad' }],
    message: i18n.t('validation.primitives.panelHasLocalIsolationHint.message', {
      panelName: panel.name,
      defaultValue: `Panel ${panel.name} is disconnectable only upstream, without a local isolator`,
    }),
    details: i18n.t('validation.primitives.panelHasLocalIsolationHint.details', {
      panelName: panel.name,
      defaultValue:
        'The board can be disconnected via an upstream feeder device, but there is no local main switch/disconnector in this panel. Local isolation improves safety and maintainability.',
    }),
  }
}

/** Non-household board markings must show the grounded network system. */
function nonHouseholdPanelShowsGroundedNetwork(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult {
  const { scope, query, project } = context
  if (scope.type !== 'board') return { passed: true }

  const installation = projectInstallation(project)
  if (isHouseholdInstallation(installation)) return { passed: true }

  const panel = query.getPanelById(scope.id)
  if (!panel) return { passed: true }

  const groundedNetworkSystem = resolveEffectiveEarthingSystem(panel, projectPanels(project))
  if (installation?.panelNetTypeLabelsEnabled === true && groundedNetworkSystem) {
    return { passed: true }
  }

  return {
    passed: false,
    offenders: [{ kind: 'board', id: panel.id, viewHint: 'eendraad' }],
    message: i18n.t('validation.primitives.nonHouseholdPanelShowsGroundedNetwork.message', {
      panelName: panel.name,
      defaultValue: `Board ${panel.name} does not show its grounded network system`,
    }),
    details: i18n.t('validation.primitives.nonHouseholdPanelShowsGroundedNetwork.details', {
      panelName: panel.name,
      defaultValue:
        'Non-domestic boards must identify their grounded network system. Enable the net-type label and select the applicable TT, TN or IT system in the board properties.',
    }),
  }
}

/** Non-household board markings must include board sequence numbering. */
function nonHouseholdPanelNumberingIsShown(
  context: CheckContext,
  _params?: Record<string, unknown>
): CheckResult {
  const { scope, query, project } = context
  if (scope.type !== 'board') return { passed: true }

  const installation = projectInstallation(project)
  if (isHouseholdInstallation(installation)) return { passed: true }

  const panel = query.getPanelById(scope.id)
  if (!panel?.isMain || installation?.panelNumberingEnabled === true) {
    return { passed: true }
  }

  return {
    passed: false,
    offenders: [{ kind: 'board', id: panel.id, viewHint: 'eendraad' }],
    message: i18n.t('validation.primitives.nonHouseholdPanelNumberingIsShown.message', {
      defaultValue: 'Board numbering is not shown',
    }),
    details: i18n.t('validation.primitives.nonHouseholdPanelNumberingIsShown.details', {
      defaultValue:
        'Non-domestic boards must carry an individual sequence number. Enable panel numbering in the board properties.',
    }),
  }
}

/**
 * Check for eendraad (one-line) orphans: circuits/endpoints/frames that are inconsistent
 * so that items don't show in the wire view or appear under the wrong protection.
 * Runs on board scope; returns multiple issues (Issue[]) for the panel.
 */
function checkDuplicatePanelProtectionLabels(
  context: CheckContext,
  _params?: Record<string, unknown>
): Issue[] {
  const { scope, project } = context
  if (scope.type !== 'board') return []

  let panel: Panel | undefined
  const visit = (panels: Panel[]) => {
    for (const p of panels) {
      if (p.id === scope.id) {
        panel = p
        return
      }
      visit(p.subPanels ?? [])
      if (panel) return
    }
  }
  visit(projectPanels(project))
  if (!panel) return []

  const pack = {
    jurisdiction: projectInstallation(project)?.address?.country ?? 'BE',
    version: '2025',
  }
  const issues: Issue[] = []
  for (const group of findDuplicateProtectionLabelGroupsOnPanel(panel, project)) {
    const offenders = group.entries.map((entry) => ({
      kind: entry.kind === 'protection' ? ('protection' as const) : ('device' as const),
      id: entry.id,
      viewHint: 'both' as const,
    }))
    issues.push({
      id: `be.areibook1.2025.duplicate-panel-protection-label:board:${panel.id}:${group.displayLabel}`,
      ruleId: 'be.areibook1.2025.duplicate-panel-protection-label',
      severity: 'error',
      jurisdiction: pack.jurisdiction,
      rulesetVersion: pack.version,
      scope: { type: 'board', id: panel.id },
      offenders,
      message: i18n.t('validation.primitives.duplicatePanelProtectionLabels.message', {
        label: group.displayLabel,
        count: String(group.entries.length),
        defaultValue:
          'Protection label "{{label}}" is used {{count}} times on this panel (main bus, secondary bus, or supply). Each protection on one panel needs a unique label.',
      }),
      details: i18n.t('validation.primitives.duplicatePanelProtectionLabels.details', {
        label: group.displayLabel,
        defaultValue:
          'Duplicate protection names on the same panel make circuits hard to identify on the one-line diagram and panel layout. Rename one of the protections or turn on automatic naming.',
      }),
      citations: [],
      tags: ['naming', 'panel', 'consistency'],
    })
  }
  return issues
}

function checkConverterBackupLabels(
  context: CheckContext,
  _params?: Record<string, unknown>
): Issue[] {
  const { scope, project } = context
  if (scope.type !== 'board') return []

  let panel: Panel | undefined
  const visit = (panels: Panel[]) => {
    for (const candidate of panels) {
      if (candidate.id === scope.id) {
        panel = candidate
        return
      }
      visit(candidate.subPanels ?? [])
      if (panel) return
    }
  }
  visit(projectPanels(project))
  if (!panel) return []

  const issues: Issue[] = []
  const pushIssue = (kind: 'protection' | 'endpoint', id: string, protection: ProtectionDevice) => {
    const offenderKind = kind === 'protection' ? ('protection' as const) : ('device' as const)
    issues.push({
      id: `be.areibook1.2025.converter-backup-labels:board:${panel!.id}:${kind}:${id}`,
      ruleId: 'be.areibook1.2025.converter-backup-labels',
      severity: 'error',
      jurisdiction: projectInstallation(project)?.address?.country ?? 'BE',
      rulesetVersion: '2025',
      scope: { type: 'board', id: panel!.id },
      offenders: [{ kind: offenderKind, id, viewHint: 'eendraad' }],
      message: i18n.t(`validation.primitives.converterBackupLabels.${kind}.message`, {
        defaultValue:
          kind === 'protection'
            ? 'Backup-supply protection is not labeled'
            : 'Backup-supply endpoint is not labeled',
      }),
      details: i18n.t(`validation.primitives.converterBackupLabels.${kind}.details`, {
        protectionLabel: protection.label || protection.type,
        defaultValue:
          kind === 'protection'
            ? 'Protections on an inverter backup-supply branch are not named automatically. Add a clear manual label.'
            : 'Endpoints on an inverter backup-supply branch are not named automatically. Add a clear manual label.',
      }),
      citations: [],
      tags: ['naming', 'supply', 'backup'],
    })
  }

  for (const protection of panel.protections ?? []) {
    const backupCircuits = (protection.circuits ?? []).filter(
      (circuit) => circuit.supplySource?.kind === 'converter-backup'
    )
    if (backupCircuits.length === 0) continue
    if (!(protection.label ?? '').trim()) {
      pushIssue('protection', protection.id, protection)
    }
    for (const circuit of backupCircuits) {
      for (const endpoint of circuit.endpoints) {
        if (!(endpoint.label ?? '').trim()) {
          pushIssue('endpoint', endpoint.id, protection)
        }
      }
    }
  }

  return issues
}

function checkEendraadOrphans(context: CheckContext, _params?: Record<string, unknown>): Issue[] {
  const { scope, project } = context
  if (scope.type !== 'board') {
    return []
  }

  const report = detectPanelOrphans(project, scope.id)
  const pack = {
    jurisdiction: projectInstallation(project)?.address?.country ?? 'BE',
    version: '2025',
  }
  return orphanReportToIssues(
    report,
    scope.id,
    'be.areibook1.2025.eendraad-orphans',
    pack.jurisdiction,
    pack.version,
    {
      circuitMissingProtection: (opts) =>
        i18n.t('validation.orphanDetection.circuitMissingProtection', {
          circuitCode: opts.circuitCode,
          endpointCount: opts.endpointCount,
          defaultValue: `Circuit "{{circuitCode}}" is not attached to any protection; it cannot render in one-line view.`,
        }),
      circuitRefMismatch: (opts) =>
        i18n.t('validation.orphanDetection.circuitRefMismatch', {
          circuitCode: opts.circuitCode,
          listedUnderLabel: opts.listedUnderLabel,
          parentCircuitCode: opts.parentCircuitCode,
          displayedUnderLabel: opts.displayedUnderLabel,
          defaultValue: `Circuit {{circuitCode}} is listed under protection "{{listedUnderLabel}}" but appears in the one-line diagram under circuit {{parentCircuitCode}} (protection "{{displayedUnderLabel}}").`,
        }),
      protectionReferenceConflict: (opts) =>
        i18n.t('validation.orphanDetection.protectionReferenceConflict', {
          circuitCode: opts.circuitCode,
          protectionLabels: opts.protectionLabels,
          defaultValue: `Circuit {{circuitCode}} is referenced by multiple protections ({{protectionLabels}}). Repair the one-line topology before continuing.`,
        }),
      endpointNotInBranch: (opts) =>
        i18n.t('validation.orphanDetection.endpointNotInBranch', {
          endpointLabel: opts.endpointLabel,
          circuitCode: opts.circuitCode,
          defaultValue: `Endpoint "{{endpointLabel}}" on circuit {{circuitCode}} is not on any branch and will not appear on the one-line diagram.`,
        }),
      branchRefsMissingEndpoint: (opts) =>
        i18n.t('validation.orphanDetection.branchRefsMissingEndpoint', {
          circuitCode: opts.circuitCode,
          branchLabel: opts.branchLabel,
          endpointId: opts.endpointId,
          defaultValue: `Branch "{{branchLabel}}" on circuit {{circuitCode}} references missing endpoint {{endpointId}}.`,
        }),
      frameContentOrphans: (opts) =>
        i18n.t('validation.orphanDetection.frameContentOrphans', {
          frameTitle: opts.frameTitle,
          contentId: opts.contentId,
          reason: opts.reason,
          defaultValue: `Frame "{{frameTitle}}" references missing or invalid content ({{contentId}}).`,
        }),
      subCircuitSelfReference: (opts) =>
        i18n.t('validation.orphanDetection.subCircuitSelfReference', {
          circuitCode: opts.circuitCode,
          defaultValue: `Circuit "{{circuitCode}}" lists itself in subCircuitIds (invalid). It may be missing from the one-line diagram while still appearing in drop lists — remove the self-reference.`,
        }),
      subCircuitIdMissingCircuit: (opts) =>
        i18n.t('validation.orphanDetection.subCircuitIdMissingCircuit', {
          parentCircuitCode: opts.parentCircuitCode,
          missingCircuitId: opts.missingCircuitId,
          defaultValue: `Circuit "{{parentCircuitCode}}" references missing sub-circuit (id: {{missingCircuitId}}).`,
        }),
      endpointOnPanelCircuit: (opts) =>
        i18n.t('validation.orphanDetection.endpointOnPanelCircuit', {
          endpointLabel: opts.endpointLabel,
          defaultValue: `Endpoint "{{endpointLabel}}" is attached to the PANEL pseudo-circuit and will not render correctly. Move it to a real circuit.`,
        }),
      endpointMultipleFloorPlacements: (opts) =>
        i18n.t('validation.orphanDetection.endpointMultipleFloorPlacements', {
          endpointLabel: opts.endpointLabel,
          floorCount: opts.floorCount,
          defaultValue: `Endpoint "{{endpointLabel}}" has placements on {{floorCount}} floors, but this symbol should only exist once in the plan.`,
        }),
      endpointPlacementIntegrity: (opts) =>
        i18n.t('validation.orphanDetection.endpointPlacementIntegrity', {
          endpointLabel: opts.endpointLabel,
          placementId: opts.placementId,
          floorId: opts.floorId,
          violation: opts.violation,
          defaultValue:
            opts.violation === 'missingFloor'
              ? `Endpoint "{{endpointLabel}}" has placement "{{placementId}}" on missing floor "{{floorId}}".`
              : `Endpoint "{{endpointLabel}}" has duplicate placement id "{{placementId}}".`,
        }),
      planPlacementIdentityConflict: (opts) =>
        i18n.t('validation.orphanDetection.planPlacementIdentityConflict', {
          placementId: opts.placementId,
          ownerLabels: opts.ownerLabels,
          defaultValue: `Situation-plan placement "{{placementId}}" is shared by {{ownerLabels}}. Symbols may overlap, disappear, or select together; recreate the affected duplicates with unique placements.`,
        }),
      domoticaChildLinkMismatch: (opts) =>
        i18n.t('validation.orphanDetection.domoticaChildLinkMismatch', {
          endpointLabel: opts.endpointLabel,
          parentLabel: opts.parentLabel,
          outputNumber: opts.outputNumber,
          defaultValue: `Domotica output "{{endpointLabel}}" is listed on "{{parentLabel}}" output {{outputNumber}}, but it is detached from the module.`,
        }),
      endpointMissingPlanPlacement: (opts) =>
        i18n.t('validation.orphanDetection.endpointMissingPlanPlacement', {
          endpointLabel: opts.endpointLabel,
          circuitCode: opts.circuitCode,
          defaultValue: `{{endpointLabel}} ({{circuitCode}}) — not on plan. Drop on plan or add a placement.`,
        }),
      panelDistributionLabelDrift: (opts) =>
        i18n.t('validation.orphanDetection.panelDistributionLabelDrift', {
          endpointLabel: opts.endpointLabel,
          panelName: opts.panelName,
          circuitCode: opts.circuitCode,
          defaultValue: `Panel symbol "{{endpointLabel}}" does not match board name "{{panelName}}" (circuit {{circuitCode}}).`,
        }),
      panelMissingOneWireSymbol: (opts) =>
        i18n.t('validation.orphanDetection.panelMissingOneWireSymbol', {
          panelName: opts.panelName,
          defaultValue: `Panel "{{panelName}}" exists but has no one-wire feeder symbol/link.`,
        }),
      panelGridDuplicateModule: (opts) =>
        i18n.t('validation.orphanDetection.panelGridDuplicateModule', {
          moduleLabel: opts.moduleLabel,
          duplicateCount: opts.duplicateCount,
          mode: opts.mode,
          defaultValue:
            opts.mode === 'duplicateVisibleLabel'
              ? `Panel canvas shows "{{moduleLabel}}" more than once; keep the fuller module and hide the weaker duplicate.`
              : `Panel canvas stores "{{moduleLabel}}" {{duplicateCount}} extra time(s); remove the duplicate slot(s).`,
        }),
      supplyTrunkMisplacedInMainGrid: (opts) =>
        i18n.t('validation.orphanDetection.supplyTrunkMisplacedInMainGrid', {
          label: opts.label,
          row: opts.row,
          col: opts.col,
          defaultValue: `Supply device "{{label}}" is on the main panel grid (row {{row}}, column {{col}}) but must be in the supply strip only.`,
        }),
      supplyTrunkVisualPlacementMissing: (opts) =>
        i18n.t('validation.orphanDetection.supplyTrunkVisualPlacementMissing', {
          label: opts.label,
          defaultValue: `Supply device "{{label}}" exists in the supply topology but has no reachable panel-canvas placement.`,
        }),
      splitBusWithoutBackupSupply: (opts) =>
        i18n.t('validation.orphanDetection.splitBusWithoutBackupSupply', {
          panelName: opts.panelName,
          busSectionCount: opts.busSectionCount,
          defaultValue: `Panel "{{panelName}}" has {{busSectionCount}} bus sections but no connected backup supply. Merge it back onto one grid feed.`,
        }),
      supplyAssemblyHandoffTargetMissing: (opts) =>
        i18n.t('validation.orphanDetection.supplyAssemblyHandoffTargetMissing', {
          missingCircuitId: opts.missingCircuitId,
          defaultValue: `Supply handoff references missing circuit {{missingCircuitId}}.`,
        }),
    }
  )
}

registerPrimitive('panelHasGlobalIsolation', panelHasGlobalIsolation)
registerPrimitive('panelHasLocalIsolationHint', panelHasLocalIsolationHint)
registerPrimitive('nonHouseholdPanelShowsGroundedNetwork', nonHouseholdPanelShowsGroundedNetwork)
registerPrimitive('nonHouseholdPanelNumberingIsShown', nonHouseholdPanelNumberingIsShown)
registerPrimitive('checkDuplicatePanelProtectionLabels', checkDuplicatePanelProtectionLabels)
registerPrimitive('checkConverterBackupLabels', checkConverterBackupLabels)
registerPrimitive('checkEendraadOrphans', checkEendraadOrphans)
registerPrimitive('protectionPhaseCompatibility', protectionPhaseCompatibility)
