import { selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
import { getInstallationPhases } from '@/lib/wires/phaseAssignment'
import {
  getProjectElectricalInstallation,
  selectProjectSupplyAssemblies,
} from '@/lib/projectV2/electrical'
import {
  deriveHandoffPhaseSupplyPaths,
  validateOffGridSupplyAssembly,
  type LiveAcPhase,
  type OffGridSupplyAssembly,
  type SupplyNode,
} from '@/lib/supplyAssembly'
import type { Offender } from '../types'
import {
  buildLayoutTree,
  calculateBottomUpLayout,
  deriveWires,
  i18n,
  projectPanels,
  type CheckContext,
  type Issue,
  type WireSegment,
} from './common'
import { getMaxProtectionRatingForSection } from '@/lib/validation/circuitCableSection'
import { isHouseholdInstallation } from '@/lib/installationProfile'
import { findPanelById } from '@/lib/panel/panelTree'
import { isSupplyHandoffTargetPresent } from '@/lib/supplyAssembly/handoffTargetIntegrity'
import { registerPrimitive } from './registry'

const SUPPLY_PATH_RULE_ID = 'be.areibook1.2025.supply-mode-paths'
const BACKUP_SUPPLY_RCD_RULE_ID = 'be.areibook1.2025.backup-supply-rcd'
const SUPPLY_CONDUCTOR_PROTECTION_RULE_ID =
  'be.areibook1.2025.supply-conductor-protection-coordination'

function assemblyPanelId(
  assembly: OffGridSupplyAssembly,
  context: CheckContext
): string | undefined {
  const handoffPanelId = assembly.loadHandoffs.find(
    (handoff) => 'panelId' in handoff.target
  )?.target
  if (handoffPanelId && 'panelId' in handoffPanelId) return handoffPanelId.panelId

  if ('panelId' in assembly.incomingAttachment) return assembly.incomingAttachment.panelId
  if (assembly.incomingAttachment.kind !== 'root-feed') return undefined
  const rootFeedId = assembly.incomingAttachment.rootFeedId
  return getProjectElectricalInstallation(context.project)?.feedTopology?.rootFeeds.find(
    (feed) => feed.id === rootFeedId
  )?.panelId
}

function findAssembly(context: CheckContext): OffGridSupplyAssembly | undefined {
  if (context.scope.type !== 'subgraph') return undefined
  return selectProjectSupplyAssemblies(context.project).find(
    (assembly) => assembly.id === context.scope.id
  )
}

/** Ignore graph paths whose persisted handoff target no longer exists in the project. */
function assemblyWithResolvedHandoffTargets(
  assembly: OffGridSupplyAssembly,
  context: CheckContext
): OffGridSupplyAssembly {
  const panels = projectPanels(context.project)
  const installation = getProjectElectricalInstallation(context.project)
  const loadHandoffs = assembly.loadHandoffs.filter((handoff) => {
    if (handoff.target.kind !== 'circuit-input') return true
    // Missing target panels are not covered by the per-panel orphan warning yet.
    if (!findPanelById(panels, handoff.target.panelId)) return true
    return isSupplyHandoffTargetPresent(handoff, panels, installation)
  })
  return loadHandoffs.length === assembly.loadHandoffs.length
    ? assembly
    : { ...assembly, loadHandoffs }
}

function isLivePhase(value: string): value is LiveAcPhase {
  return value === 'L1' || value === 'L2' || value === 'L3'
}

function isCompliantMainGradeRcd(device: {
  type?: string
  protectionType?: string
  sensitivityMa?: number
  ratingA?: number
  supplyPath?: string
}): boolean {
  return (
    (device.type === 'RCD' ||
      device.type === 'RCBO' ||
      device.protectionType === 'RCD' ||
      device.protectionType === 'RCBO') &&
    device.sensitivityMa != null &&
    device.sensitivityMa <= 300 &&
    (device.ratingA == null || device.ratingA >= 40) &&
    !device.supplyPath?.includes('grid')
  )
}

/**
 * A panel's root-feed layout can own protections drawn after a supply-assembly
 * changeover. They are electrically downstream of the backup input even though
 * they are not duplicated as assembly graph nodes.
 */
function hasCompliantRootFeedBackupRcd(
  assembly: OffGridSupplyAssembly,
  installation: NonNullable<ReturnType<typeof getProjectElectricalInstallation>>,
  handoffId: string,
  backupConnectionIds: ReadonlySet<string>
): boolean {
  const handoff = assembly.loadHandoffs.find((candidate) => candidate.id === handoffId)
  if (!handoff) return false
  const target = handoff.target
  const panelId =
    target.kind === 'root-feed'
      ? installation.feedTopology?.rootFeeds.find(
          (feed) => feed.id === target.rootFeedId
        )?.panelId
      : target.panelId
  if (!panelId) return false
  const backupPathNodeIds = new Set(
    assembly.connections
      .filter((connection) => backupConnectionIds.has(connection.id))
      .flatMap((connection) => connection.endpoints.map((endpoint) => endpoint.nodeId))
  )
  const changeoverIds = new Set(
    assembly.nodes
      .filter(
        (node) => node.kind === 'changeover-switch' && backupPathNodeIds.has(node.id)
      )
      .flatMap((node) => [node.id, node.deviceId].filter((id): id is string => !!id))
  )
  if (changeoverIds.size === 0) return false

  return (installation.feedTopology?.rootFeeds ?? [])
    .filter((feed) => feed.panelId === panelId)
    .some((feed) => {
      const trunkDevices = feed.trunkDevices ?? []
      const changeoverIndex = trunkDevices.findIndex((device) => changeoverIds.has(device.id))
      if (changeoverIndex < 0) return false
      return trunkDevices.slice(changeoverIndex + 1).some(isCompliantMainGradeRcd)
    })
}

function supplyModePaths(context: CheckContext): Issue[] {
  const storedAssembly = findAssembly(context)
  const installation = getProjectElectricalInstallation(context.project)
  if (!storedAssembly || !installation) return []
  const assembly = assemblyWithResolvedHandoffTargets(storedAssembly, context)
  if (
    assembly.presetIntent === 'grid_connected_storage_branch' &&
    !assembly.nodes.some(
      (node) => node.kind === 'inverter-unit' && node.properties.acConnection === 'separate'
    )
  ) {
    return []
  }
  if (validateOffGridSupplyAssembly(assembly).status === 'invalid') return []

  const presentPhases = getInstallationPhases(installation.nominalVoltage.system).filter(
    isLivePhase
  )
  const invalidPaths = deriveHandoffPhaseSupplyPaths(assembly, presentPhases).filter(
    (path) => path.state === 'invalid'
  )
  const byHandoff = new Map<string, typeof invalidPaths>()
  for (const path of invalidPaths) {
    const bucket = byHandoff.get(path.handoffId) ?? []
    bucket.push(path)
    byHandoff.set(path.handoffId, bucket)
  }

  return Array.from(byHandoff.entries()).map(([handoffId, paths]): Issue => {
    const connectionIds = new Set(
      paths.flatMap((path) => [...path.gridConnectionIds, ...path.backupConnectionIds])
    )
    const offenders: Offender[] = Array.from(connectionIds).map((id) => ({
      kind: 'segment',
      id,
      viewHint: 'eendraad',
    }))
    if (offenders.length === 0) {
      const panelId = assemblyPanelId(assembly, context)
      if (panelId) offenders.push({ kind: 'board', id: panelId, viewHint: 'eendraad' })
    }
    const phases = paths.map((path) => path.phase).join(', ')
    return {
      id: `${SUPPLY_PATH_RULE_ID}:subgraph:${assembly.id}:${handoffId}`,
      ruleId: SUPPLY_PATH_RULE_ID,
      severity: 'error',
      jurisdiction: installation.address.country || 'BE',
      rulesetVersion: '2025',
      scope: context.scope,
      offenders,
      message: i18n.t('validation.primitives.supplyModePaths.message', {
        phases,
        defaultValue: 'Grid and backup paths do not form a valid supply route',
      }),
      details: i18n.t('validation.primitives.supplyModePaths.details', {
        phases,
        defaultValue:
          'The one-line topology does not provide a complete, coordinated grid/backup path for every connected phase.',
      }),
      remediation: i18n.t('validation.primitives.supplyModePaths.remediation', {
        defaultValue:
          'Reconnect the grid, backup and load sides so every shown phase has a complete intended supply path.',
      }),
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 4.2.3.1, § 5.3.3.1',
        },
      ],
      tags: ['supply', 'backup', 'topology', 'phase'],
    }
  })
}

/**
 * A backup path reaching a panel through either a changeover or a direct inverter
 * output needs its own main-grade residual-current protection.
 */
function backupSupplyRcdCompliance(context: CheckContext): Issue[] {
  const storedAssembly = findAssembly(context)
  const installation = getProjectElectricalInstallation(context.project)
  if (!storedAssembly || !installation || !isHouseholdInstallation(installation)) return []
  const assembly = assemblyWithResolvedHandoffTargets(storedAssembly, context)
  if (installation.address.country && installation.address.country !== 'BE') return []
  if (validateOffGridSupplyAssembly(assembly).status === 'invalid') return []

  const presentPhases = getInstallationPhases(installation.nominalVoltage.system).filter(
    isLivePhase
  )
  const pathsByHandoff = new Map<string, ReturnType<typeof deriveHandoffPhaseSupplyPaths>>()
  for (const path of deriveHandoffPhaseSupplyPaths(assembly, presentPhases)) {
    if (path.backupConnectionIds.length === 0) continue
    const paths = pathsByHandoff.get(path.handoffId) ?? []
    paths.push(path)
    pathsByHandoff.set(path.handoffId, paths)
  }

  const terminalConnectionIds = new Set<string>()
  for (const [handoffId, paths] of pathsByHandoff) {
    const connectionIds = new Set(paths.flatMap((path) => path.backupConnectionIds))
    const nodeIds = new Set(
      assembly.connections
        .filter((connection) => connectionIds.has(connection.id))
        .flatMap((connection) => connection.endpoints.map((endpoint) => endpoint.nodeId))
    )
    const rcdsOnBackupPath = assembly.nodes.filter(
      (node): node is Extract<SupplyNode, { kind: 'protection' }> =>
        nodeIds.has(node.id) &&
        node.kind === 'protection' &&
        (node.properties.type === 'RCD' || node.properties.type === 'RCBO')
    )
    const hasCompliantRcd =
      rcdsOnBackupPath.some((node) => isCompliantMainGradeRcd(node.properties)) ||
      hasCompliantRootFeedBackupRcd(assembly, installation, handoffId, connectionIds)
    if (hasCompliantRcd) continue

    for (const path of paths) {
      const terminalConnectionId = path.backupConnectionIds[path.backupConnectionIds.length - 1]
      if (terminalConnectionId) terminalConnectionIds.add(terminalConnectionId)
    }
  }
  if (terminalConnectionIds.size === 0) return []

  // One message keeps related backup feeds from producing identical cards. Each
  // offender remains the final run into its bus, so the card focuses the wires
  // where the missing protection must be added.
  const offenders: Offender[] = Array.from(terminalConnectionIds).map((id) => ({
      kind: 'segment',
      id,
      viewHint: 'eendraad',
  }))

  return [{
    id: `${BACKUP_SUPPLY_RCD_RULE_ID}:subgraph:${assembly.id}`,
    ruleId: BACKUP_SUPPLY_RCD_RULE_ID,
    severity: 'error',
    jurisdiction: installation.address.country || 'BE',
    rulesetVersion: '2025',
    scope: context.scope,
    offenders,
    message: i18n.t('validation.primitives.backupSupplyRcdCompliance.message', {
      defaultValue: 'Backup supply has no equivalent RCD protection',
    }),
    details: i18n.t('validation.primitives.backupSupplyRcdCompliance.details', {
      defaultValue:
        'The backup path needs an RCD or RCBO with a configured sensitivity of at most 300 mA and a nominal current of at least 40 A.',
    }),
    remediation: i18n.t('validation.primitives.backupSupplyRcdCompliance.remediation', {
      defaultValue:
        'Add a compliant RCD or RCBO on the backup path between the inverter or changeover and the backed-up panel.',
    }),
    citations: [
      {
        code: 'AREI',
        title: 'Algemeen Reglement op de Elektrische Installaties',
        section: '§ 5.3.5.3(a)',
      },
    ],
    tags: ['rcd', 'supply', 'backup'],
  }]
}

function supplyConductorProtectionCoordination(context: CheckContext): Issue[] {
  const assembly = findAssembly(context)
  const installation = getProjectElectricalInstallation(context.project)
  if (!assembly || !installation) return []

  const panelId = assemblyPanelId(assembly, context)
  const relevantRootFeeds = (installation.feedTopology?.rootFeeds ?? []).filter(
    (feed) => !panelId || feed.panelId === panelId
  )
  const explicitSectionKeys = new Set(
    relevantRootFeeds.flatMap((feed) => Object.keys(feed.wireSections ?? {}))
  )
  const derivedSectionsByConnection = new Map<string, number[]>()
  const sectionKeysByConnection = new Map<string, Set<string>>()
  const derivedSegmentsBySection = new Map<string, WireSegment[]>()
  let derivedSupplySegments: WireSegment[] = []
  if (explicitSectionKeys.size > 0) {
    try {
      const layout = calculateBottomUpLayout(context.project, new Map())
      const tree = buildLayoutTree(layout)
      derivedSupplySegments = deriveWires(
        tree,
        projectPanels(context.project),
        installation, [], undefined, selectProjectWireRuns(context.project)
      ).filter((segment) => !panelId || segment.panelId === panelId)
      for (const segment of derivedSupplySegments) {
        if (!segment.supplySectionKey || !explicitSectionKeys.has(segment.supplySectionKey)) continue
        const section = segment.cable?.sectionMm2
        if (section == null || section <= 0) continue
        const sectionSegments = derivedSegmentsBySection.get(segment.supplySectionKey) ?? []
        sectionSegments.push(segment)
        derivedSegmentsBySection.set(segment.supplySectionKey, sectionSegments)
        if (segment.supplyAssemblyId !== assembly.id || !segment.supplyConnectionId) continue
        const sections = derivedSectionsByConnection.get(segment.supplyConnectionId) ?? []
        sections.push(section)
        derivedSectionsByConnection.set(segment.supplyConnectionId, sections)
        const keys = sectionKeysByConnection.get(segment.supplyConnectionId) ?? new Set<string>()
        keys.add(segment.supplySectionKey)
        sectionKeysByConnection.set(segment.supplyConnectionId, keys)
      }
    } catch {
      // A layout failure must not turn an unknown physical wire section into a finding.
    }
  }

  const issues: Issue[] = []
  const reportedSectionKeys = new Set<string>()
  for (const protection of assembly.nodes.filter((node) => node.kind === 'protection')) {
    const ratingA = protection.properties.ratingA
    const protectionType = protection.properties.type
    if (ratingA == null || ratingA <= 0) continue
    if (protectionType !== 'MCB' && protectionType !== 'RCBO' && protectionType !== 'FUSE') {
      continue
    }

    const hasDirectionalPorts = protection.ports.some(
      (port) => port.role === 'serial-load-side'
    )
    const protectedConnectionIds = new Set<string>()
    for (const connection of assembly.connections) {
      if (connection.domain === 'PE' || connection.pathRole === 'protective-earth') continue
      const endpoint = connection.endpoints.find(({ nodeId }) => nodeId === protection.id)
      if (!endpoint) continue
      const port = protection.ports.find(({ id }) => id === endpoint.portId)
      if (!port) continue
      if (hasDirectionalPorts && port.role !== 'serial-load-side') continue
      protectedConnectionIds.add(connection.id)
    }

    const undersized = assembly.connections.filter((connection) => {
      if (!protectedConnectionIds.has(connection.id)) return false
      const explicitlyMappedSections = derivedSectionsByConnection.get(connection.id) ?? []
      const section =
        explicitlyMappedSections.length > 0
          ? Math.min(...explicitlyMappedSections)
          : connection.wireProperties?.cable.sectionMm2
      if (section == null || section <= 0) return false
      const maxRatingA = getMaxProtectionRatingForSection(section, protectionType)
      return maxRatingA != null && ratingA > maxRatingA
    })
    if (undersized.length === 0) continue
    for (const connection of undersized) {
      for (const sectionKey of sectionKeysByConnection.get(connection.id) ?? []) {
        reportedSectionKeys.add(sectionKey)
      }
    }

    const sections = Array.from(
      new Set(
        undersized.map((connection) => {
          const mapped = derivedSectionsByConnection.get(connection.id) ?? []
          return mapped.length > 0
            ? Math.min(...mapped)
            : connection.wireProperties!.cable.sectionMm2
        })
      )
    ).sort((left, right) => left - right)
    const smallestSection = sections[0]!
    const maxRatingA = getMaxProtectionRatingForSection(smallestSection, protectionType)!
    const protectionLabel = protection.label?.trim() || `${protectionType} ${ratingA} A`
    issues.push({
      id: `${SUPPLY_CONDUCTOR_PROTECTION_RULE_ID}:subgraph:${assembly.id}:${protection.id}`,
      ruleId: SUPPLY_CONDUCTOR_PROTECTION_RULE_ID,
      severity: 'error',
      jurisdiction: installation.address.country || 'BE',
      rulesetVersion: '2025',
      scope: context.scope,
      offenders: [
        { kind: 'protection', id: protection.id, viewHint: 'eendraad' },
        ...undersized.map((connection) => ({
          kind: 'segment' as const,
          id: connection.id,
          viewHint: 'eendraad' as const,
        })),
      ],
      message: i18n.t('validation.primitives.supplyConductorProtectionCoordination.message', {
        protectionLabel,
        ratingA,
        section: smallestSection,
        defaultValue: `${protectionLabel}: ${smallestSection} mm² conductor is too small for ${ratingA} A protection`,
      }),
      details: i18n.t('validation.primitives.supplyConductorProtectionCoordination.details', {
        ratingA,
        section: smallestSection,
        maxRatingA,
        defaultValue: `The drawn ${smallestSection} mm² supply conductor may be protected at no more than ${maxRatingA} A by this ${protectionType === 'FUSE' ? 'fuse' : 'circuit breaker'}, but the shown rating is ${ratingA} A.`,
      }),
      remediation: i18n.t(
        'validation.primitives.supplyConductorProtectionCoordination.remediation',
        {
          defaultValue:
            'Increase the conductor cross-section or reduce the upstream protective-device rating.',
        }
      ),
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 4.4.1.4, § 4.4.3.2',
          page: '121-122',
        },
      ],
      tags: ['supply', 'cable', 'overcurrent', 'protection'],
    })
  }

  const feedProtectionById = new Map(
    [
      ...(installation.feedTopology?.sharedFeed.trunkDevices ?? []),
      ...relevantRootFeeds.flatMap((feed) => feed.trunkDevices ?? []),
    ]
      .filter((device) => device.type === 'protection')
      .map((device) => [device.id, device])
  )
  for (const protection of feedProtectionById.values()) {
    const protectionType = protection.protectionType
    const ratingA = protection.ratingA
    if (
      (protectionType !== 'MCB' && protectionType !== 'RCBO' && protectionType !== 'FUSE') ||
      ratingA == null ||
      ratingA <= 0
    ) {
      continue
    }

    const deviceToken = `device:${protection.id}`
    const adjacentSegments = derivedSupplySegments.filter((segment) =>
      segment.supplySectionKey?.includes(deviceToken)
    )
    const adjacentXs = adjacentSegments
      .flatMap((segment) => [segment.startPoint.x, segment.endPoint.x])
      .sort((left, right) => left - right)
    const middle = adjacentXs.length / 2
    const deviceX =
      adjacentXs.length === 0
        ? undefined
        : adjacentXs.length % 2 === 0
          ? (adjacentXs[middle - 1]! + adjacentXs[middle]!) / 2
          : adjacentXs[Math.floor(middle)]!

    const undersizedSections = Array.from(derivedSegmentsBySection.entries()).filter(
      ([sectionKey, segments]) => {
        if (reportedSectionKeys.has(sectionKey) || !sectionKey.includes(deviceToken)) return false
        const isDc = segments.some((segment) => segment.domain === 'DC')
        if (isDc) {
          if (protection.supplyPath !== 'converter-dc') return false
        } else {
          const isNamedLoadSidePath = /:(?:changeover-grid|changeover-backup|changeover-load|changeover-shared-grid|direct-grid|converter-grid):/.test(
            sectionKey
          )
          if (!isNamedLoadSidePath) {
            if (protection.supplyPath != null && protection.supplyPath !== 'serial') return false
            if (deviceX == null) return false
            const sectionCenterX =
              (Math.min(
                ...segments.flatMap((segment) => [segment.startPoint.x, segment.endPoint.x])
              ) +
                Math.max(
                  ...segments.flatMap((segment) => [segment.startPoint.x, segment.endPoint.x])
                )) /
              2
            if (sectionCenterX >= deviceX) return false
          }
        }
        const section = segments[0]?.cable.sectionMm2
        if (section == null || section <= 0) return false
        const maxRatingA = getMaxProtectionRatingForSection(section, protectionType)
        return maxRatingA != null && ratingA > maxRatingA
      }
    )
    if (undersizedSections.length === 0) continue

    const sectionValues = undersizedSections.map(([, segments]) => segments[0]!.cable.sectionMm2)
    const smallestSection = Math.min(...sectionValues)
    const maxRatingA = getMaxProtectionRatingForSection(smallestSection, protectionType)!
    const protectionLabel = protection.label?.trim() || `${protectionType} ${ratingA} A`
    for (const [sectionKey] of undersizedSections) reportedSectionKeys.add(sectionKey)
    issues.push({
      id: `${SUPPLY_CONDUCTOR_PROTECTION_RULE_ID}:subgraph:${assembly.id}:feed:${protection.id}`,
      ruleId: SUPPLY_CONDUCTOR_PROTECTION_RULE_ID,
      severity: 'error',
      jurisdiction: installation.address.country || 'BE',
      rulesetVersion: '2025',
      scope: context.scope,
      offenders: [
        { kind: 'protection', id: protection.id, viewHint: 'eendraad' },
        ...undersizedSections.map(([sectionKey]) => ({
          kind: 'segment' as const,
          id: sectionKey,
          viewHint: 'eendraad' as const,
        })),
      ],
      message: i18n.t('validation.primitives.supplyConductorProtectionCoordination.message', {
        protectionLabel,
        ratingA,
        section: smallestSection,
        defaultValue: `${protectionLabel}: ${smallestSection} mm² conductor is too small for ${ratingA} A protection`,
      }),
      details: i18n.t('validation.primitives.supplyConductorProtectionCoordination.details', {
        ratingA,
        section: smallestSection,
        maxRatingA,
        defaultValue: `The drawn ${smallestSection} mm² supply conductor may be protected at no more than ${maxRatingA} A, but the shown rating is ${ratingA} A.`,
      }),
      remediation: i18n.t(
        'validation.primitives.supplyConductorProtectionCoordination.remediation',
        {
          defaultValue:
            'Increase the conductor cross-section or reduce the upstream protective-device rating.',
        }
      ),
      citations: [
        {
          code: 'AREI',
          title: 'Algemeen Reglement op de Elektrische Installaties',
          section: '§ 4.4.1.4, § 4.4.3.2',
          page: '121-122',
        },
      ],
      tags: ['supply', 'cable', 'overcurrent', 'protection'],
    })
  }
  return issues
}

registerPrimitive('supplyModePaths', supplyModePaths)
registerPrimitive('backupSupplyRcdCompliance', backupSupplyRcdCompliance)
registerPrimitive('supplyConductorProtectionCoordination', supplyConductorProtectionCoordination)
