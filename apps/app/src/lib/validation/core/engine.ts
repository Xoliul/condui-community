/**
 * Validation engine: runs rules against a project and returns issues
 */
import type { Panel } from '@/types/schema'
import type {
  Issue,
  RulePack,
  Scope,
  CheckContext,
  ValidationProject,
  ValidationCoverageEntry,
  ValidationCoverageReport,
  ValidationCoverageStatus,
} from './types'
import { buildValidationCoverageReport } from '../coverage'
import { DefaultQueryAPI } from './query-api'
import { getApplicableRulesetDate, withScopeEntityPathIndex } from './date-resolver'
import { selectRulePack } from './ruleset-resolver'
import { getValidationJurisdiction } from './jurisdiction'
import { getPrimitive } from './primitives'
import { logOrphanReport } from '@/lib/validation/orphanDetection'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectSupplyAssemblies,
} from '@/lib/projectV2/electrical'
import i18n from '@/lib/validation/validationI18n'
import { collectTerminalStripValidationIssues } from '@/lib/terminalStrip/validation'
import { collectOneWireForkIssues } from '../oneWireForkIssues'
import { withElectricalSnapshotIndex } from '@/lib/projectV2/electricalLookupIndex'
import { isVirtualPanel } from '@/lib/supplyTaps/virtualPanel'

export interface ValidationOptions {
  packs?: RulePack[]
}

export interface ValidationProjectRun {
  issues: Issue[]
  coverage: ValidationCoverageReport
}

/**
 * Simple hash function for creating stable issue IDs
 */
function hashOffenders(offenders: Issue['offenders']): string {
  const sorted = [...offenders].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
    return a.id.localeCompare(b.id)
  })
  const str = JSON.stringify(sorted)
  // Simple hash: sum of char codes modulo a large number
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) & 0xffffffff
  }
  return Math.abs(hash).toString(36).slice(0, 8)
}

/**
 * Create a stable issue ID
 */
function createIssueId(ruleId: string, scope: Scope, offenders: Issue['offenders']): string {
  const scopeKey = `${scope.type}:${scope.id}`
  const hash = hashOffenders(offenders)
  return `${ruleId}:${scopeKey}:${hash}`
}

function offenderDedupeKey(o: Issue['offenders'][number]): string {
  return `${o.kind}:${o.id}`
}

/**
 * Merge issues that share ruleId + mergeBucket (e.g. all circuits on a panel failing the same RCD check).
 * Drops mergeBucket on the returned issues.
 */
function mergeIssuesByMergeBucket(issues: Issue[]): Issue[] {
  type BucketKey = string
  const bucketGroups = new Map<BucketKey, Issue[]>()
  const passthrough: Issue[] = []

  for (const issue of issues) {
    if (!issue.mergeBucket) {
      passthrough.push(issue)
      continue
    }
    const key = `${issue.ruleId}\0${issue.mergeBucket}`
    const arr = bucketGroups.get(key)
    if (arr) {
      arr.push(issue)
    } else {
      bucketGroups.set(key, [issue])
    }
  }

  const merged: Issue[] = [...passthrough]

  for (const group of bucketGroups.values()) {
    if (group.length === 1) {
      const only = group[0]!
      const { mergeBucket: _m, ...rest } = only
      merged.push(rest)
      continue
    }

    group.sort((a, b) => {
      const aScope = `${a.scope.type}:${a.scope.id}`
      const bScope = `${b.scope.type}:${b.scope.id}`
      return aScope.localeCompare(bScope)
    })

    const base = group[0]!
    const offenderSeen = new Set<string>()
    const offenders: Issue['offenders'] = []
    for (const issue of group) {
      for (const o of issue.offenders) {
        const k = offenderDedupeKey(o)
        if (offenderSeen.has(k)) continue
        offenderSeen.add(k)
        offenders.push(o)
      }
    }

    const primaryScope = group
      .map((i) => i.scope)
      .sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`))[0]!

    const { mergeBucket: _mb, ...baseRest } = base
    const combined: Issue = {
      ...baseRest,
      scope: primaryScope,
      offenders,
      id: createIssueId(base.ruleId, primaryScope, offenders),
    }

    const rcdRuleId = 'be.areibook1.2025.rcd-required-by-circuit-type'
    const unknownRcdSensitivity = base.mergeBucket?.endsWith(':unknown-sensitivity') &&
      (base.ruleId === rcdRuleId || base.ruleId === 'be.areibook1.2025.bathroom-rcd-30ma')
    if (unknownRcdSensitivity) {
      // Keep the missing-specification correction when several circuits share
      // one unknown device; the generic rule text incorrectly asks for hardware.
      combined.message = i18n.t('validation.primitives.circuitHasRcdProtection.sensitivityMissing.groupMessage')
    } else if (base.ruleId === rcdRuleId && group.length > 1) {
      const msgKey = `validation.rules.${rcdRuleId}.message`
      const detailsKey = `validation.rules.${rcdRuleId}.details`
      const remediationKey = `validation.rules.${rcdRuleId}.remediation`
      combined.message = i18n.t(msgKey, { defaultValue: combined.message })
      combined.details = i18n.t(detailsKey, { defaultValue: combined.details ?? '' })
      if (combined.remediation != null) {
        combined.remediation = i18n.t(remediationKey, { defaultValue: combined.remediation })
      }
    }

    merged.push(combined)
  }

  return merged
}

/**
 * Enumerate all validation scopes in the project
 */
function enumerateScopes(project: ValidationProject): Scope[] {
  const scopes: Scope[] = []

  for (const assembly of selectProjectSupplyAssemblies(project)) {
    scopes.push({ type: 'subgraph', id: assembly.id })
  }

  const collectScopes = (panels: Panel[]) => {
    for (const panel of panels) {
      // Add panel as board scope; a virtual board (supply taps) is not a board of its own.
      if (!isVirtualPanel(panel)) scopes.push({ type: 'board', id: panel.id })

      // Add protections as device scopes
      for (const protection of panel.protections) {
        scopes.push({ type: 'device', id: protection.id })

        // Add circuits under protection
        if (protection.circuits) {
          for (const circuit of protection.circuits) {
            scopes.push({ type: 'circuit', id: circuit.id })

            // Add endpoints as device scopes
            for (const endpoint of circuit.endpoints) {
              scopes.push({ type: 'device', id: endpoint.id })

              // Add placements as placement scopes
              for (const placement of endpoint.placements) {
                scopes.push({ type: 'placement', id: placement.id })
              }
            }
          }
        }
      }

      // Add circuits at panel level
      for (const circuit of panel.circuits) {
        scopes.push({ type: 'circuit', id: circuit.id })

        // Add endpoints as device scopes
        for (const endpoint of circuit.endpoints) {
          scopes.push({ type: 'device', id: endpoint.id })

          // Add placements as placement scopes
          for (const placement of endpoint.placements) {
            scopes.push({ type: 'placement', id: placement.id })
          }
        }
      }

      // Recurse into sub-panels
      collectScopes(panel.subPanels)
    }
  }

  collectScopes(getProjectElectricalPanels(project))
  return scopes
}

/**
 * Check if prerequisites are met
 */
function getScopeEntity(scope: Scope, query: DefaultQueryAPI, project: ValidationProject): unknown {
  switch (scope.type) {
    case 'board': return query.getPanelById(scope.id)
    case 'circuit': return query.getCircuitById(scope.id)
    case 'device': return query.getEndpointById(scope.id) ?? query.getProtectionById(scope.id) ?? query.getTrunkDeviceById(scope.id)
    case 'placement': return query.getPlacementById(scope.id)
    case 'segment': return query.getCircuits().flatMap((circuit) => query.getCableSegments(circuit.id)).find((segment) => segment.id === scope.id)
    case 'subgraph': return selectProjectSupplyAssemblies(project).find((assembly) => assembly.id === scope.id)
    case 'junction': return undefined
  }
}

function hasRequiredProperty(scope: Scope, propertyPath: string, query: DefaultQueryAPI, project: ValidationProject): boolean {
  let value: unknown = getScopeEntity(scope, query, project)
  for (const key of propertyPath.split('.')) {
    if (typeof value !== 'object' || value === null || !(key in value)) return false
    value = (value as Record<string, unknown>)[key]
  }
  return value != null
}

interface PrerequisiteFailure {
  status: 'skipped' | 'unavailable' | 'missing-information'
  reason: string
  missingFacts?: string[]
  checkName?: string
}

function checkPrerequisites(
  rule: RulePack['rules'][0],
  scope: Scope,
  query: DefaultQueryAPI,
  project: ValidationProject
): PrerequisiteFailure | undefined {
  const prerequisites = rule.prerequisites
  if (!prerequisites) return undefined
  if (prerequisites.requiresScopeType && !prerequisites.requiresScopeType.includes(scope.type)) {
    return { status: 'skipped', reason: 'required-scope-type-mismatch' }
  }
  for (const propertyPath of prerequisites.requiresProperty ?? []) {
    if (!hasRequiredProperty(scope, propertyPath, query, project)) {
      return {
        status: 'missing-information',
        reason: 'required-property-absent',
        missingFacts: [propertyPath],
      }
    }
  }
  for (const condition of prerequisites.skipIf ?? []) {
    const checkFn = getPrimitive(condition.check)
    if (!checkFn) {
      return { status: 'unavailable', reason: 'unknown-skip-condition-primitive', checkName: condition.check }
    }
    const result = checkFn({ scope, query, project }, condition.params)
    if (Array.isArray(result)) {
      return {
        status: 'unavailable',
        reason: 'skip-condition-returned-issues-without-boolean-outcome',
        checkName: condition.check,
      }
    }
    if (
      result.coverage &&
      result.coverage.status !== 'passed' &&
      result.coverage.status !== 'failed'
    ) {
      return {
        status: result.coverage.status ?? 'missing-information',
        reason: result.coverage.reason ?? 'prerequisite-could-not-be-evaluated',
        missingFacts: result.coverage.missingFacts,
        checkName: condition.check,
      }
    }
    if (result.passed) {
      return { status: 'skipped', reason: 'skip-condition-matched', checkName: condition.check }
    }
  }
  return undefined
}

/**
 * Run a single rule against a scope
 */
function runRule(
  rule: RulePack['rules'][0],
  scope: Scope,
  query: DefaultQueryAPI,
  project: ValidationProject,
  pack: RulePack,
  coverageEntries?: ValidationCoverageEntry[],
  packSelection: 'effective-date' | 'jurisdiction-fallback' = 'effective-date'
): Issue[] {
  const issues: Issue[] = []
  const rulePack = { id: pack.id, version: pack.version, selection: packSelection }

  // Check prerequisites
  if (!rule.appliesTo.includes(scope.type)) return issues
  const prerequisiteFailure = checkPrerequisites(rule, scope, query, project)
  if (prerequisiteFailure) {
    coverageEntries?.push({
      ruleId: rule.id,
      ...(prerequisiteFailure.checkName ? { checkName: prerequisiteFailure.checkName } : {}),
      rulePack,
      scope,
      status: prerequisiteFailure.status,
      reason: prerequisiteFailure.reason,
      ...(prerequisiteFailure.missingFacts ? { missingFacts: prerequisiteFailure.missingFacts } : {}),
      issueIds: [],
    })
    return issues
  }

  // Create check context
  const context: CheckContext = {
    scope,
    query,
    project,
  }

  // Run all checks
  for (const checkRef of rule.checks) {
    const checkFn = getPrimitive(checkRef.name)
    if (!checkFn) {
      coverageEntries?.push({
        ruleId: rule.id,
        checkName: checkRef.name,
        rulePack,
        scope,
        status: 'unavailable',
        reason: 'unknown-primitive',
        issueIds: [],
      })
      continue
    }

    const result = checkFn(context, checkRef.params)
    const issueStart = issues.length

    // Handle CheckResult
    if ('passed' in result) {
      if (!result.passed) {
        const offenders = result.offenders || [
          {
            kind:
              scope.type === 'circuit' ? 'circuit' : scope.type === 'board' ? 'board' : 'device',
            id: scope.id,
            viewHint: 'eendraad',
          },
        ]

        // Translate messages using i18n keys
        const translateMessage = (keyOrText: string, fallback: string): string => {
          // If it's already a translation key (starts with validation.), translate it
          if (keyOrText.startsWith('validation.')) {
            return i18n.t(keyOrText, { defaultValue: fallback })
          }
          // If it's already translated text (from primitives), use it as-is
          return keyOrText || fallback
        }

        const issue: Issue = {
          id: createIssueId(rule.id, scope, offenders),
          ruleId: rule.id,
          severity: rule.severity,
          jurisdiction: pack.jurisdiction,
          rulesetVersion: pack.version,
          scope,
          offenders,
          message: result.message
            ? translateMessage(result.message, result.message)
            : translateMessage(rule.message, rule.message),
          details: result.details
            ? translateMessage(result.details, result.details)
            : rule.details
              ? translateMessage(rule.details, rule.details)
              : undefined,
          remediation: result.remediation != null
            ? translateMessage(result.remediation, result.remediation)
            : rule.remediation
              ? translateMessage(rule.remediation, rule.remediation)
              : undefined,
          citations: rule.citations.map((citation) => ({
            ...citation,
            title: translateMessage(`validation.citations.${citation.code}.title`, citation.title),
          })),
          tags: rule.tags,
          ...(result.mergeBucket ? { mergeBucket: result.mergeBucket } : {}),
        }
        issues.push(issue)
      }
    } else {
      // Handle Issue[]
      issues.push(...result)
    }
    const issueIds = issues.slice(issueStart).map((issue) => issue.id)
    const checkStatus: ValidationCoverageStatus = Array.isArray(result)
      ? result.length > 0 ? 'failed' : 'unavailable'
      : result.passed
        ? result.coverage?.status ?? 'unavailable'
        : 'failed'
    coverageEntries?.push({
      ruleId: rule.id,
      checkName: checkRef.name,
      rulePack,
      scope,
      status: checkStatus,
      ...(Array.isArray(result)
        ? result.length > 0 ? {} : { reason: 'primitive-does-not-report-check-outcome' }
        : result.coverage
          ? result.coverage.reason ? { reason: result.coverage.reason } : {}
          : result.passed ? { reason: 'primitive-does-not-report-evidence-completeness' } : {}),
      ...(Array.isArray(result) || !result.coverage?.missingFacts ? {} : { missingFacts: result.coverage.missingFacts }),
      issueIds,
    })
  }

  return issues
}

/**
 * Validate a project against rule packs
 */
export function validateProject(
  project: ValidationProject,
  options: ValidationOptions = {}
): Issue[] {
  return withElectricalSnapshotIndex(getProjectElectricalPanels(project), () =>
    withScopeEntityPathIndex(project, () => validateProjectSnapshot(project, options))
  )
}

/** Run the existing validator and retain explicit coverage for each rule/check/scope. */
export function validateProjectWithCoverage(
  project: ValidationProject,
  options: ValidationOptions = {}
): ValidationProjectRun {
  const coverageEntries: ValidationCoverageEntry[] = []
  // Worker inputs are plain structured clones. Share lookups only for this
  // synchronous read pass, without freezing or retaining the caller's document.
  const issues = withElectricalSnapshotIndex(getProjectElectricalPanels(project), () =>
    withScopeEntityPathIndex(project, () => validateProjectSnapshot(project, options, coverageEntries))
  )
  const reboundEntries = coverageEntries.map((entry) => {
    if (entry.issueIds.length === 0) return entry
    const directIds = entry.issueIds.filter((id) => issues.some((issue) => issue.id === id))
    if (directIds.length > 0) return { ...entry, issueIds: directIds }
    // A merge replaces the original issue id. Bind only to the group containing
    // this entity; the same rule may have other groups with different causes.
    const matchingRuleIssues = issues
      .filter((issue) => issue.ruleId === entry.ruleId &&
        ((issue.scope.type === entry.scope.type && issue.scope.id === entry.scope.id) ||
          issue.offenders.some((offender) => offender.id === entry.scope.id)))
      .map((issue) => issue.id)
    return { ...entry, issueIds: matchingRuleIssues }
  })
  return { issues, coverage: buildValidationCoverageReport(reboundEntries) }
}

function validateProjectSnapshot(
  project: ValidationProject,
  options: ValidationOptions,
  coverageEntries?: ValidationCoverageEntry[]
): Issue[] {
  const terminalStripIssues = collectTerminalStripValidationIssues(project, (key, options) =>
    i18n.t(key, options)
  )
  const forkIssues = collectOneWireForkIssues(project, (key) => i18n.t(key))
  const allIssues: Issue[] = [...terminalStripIssues, ...forkIssues]
  for (const issue of terminalStripIssues) {
    coverageEntries?.push({
      ruleId: issue.ruleId,
      checkName: 'terminal-strip-validation',
      scope: issue.scope,
      status: 'failed',
      issueIds: [issue.id],
    })
  }

  // Log eendraad orphans immediately to the console (so they're visible even before opening validation UI)
  logOrphanReport(project)

  // Get jurisdiction from project
  const jurisdiction = getValidationJurisdiction(
    getProjectElectricalInstallation(project)?.address.country
  )
  if (jurisdiction !== 'BE') {
    const scopes = enumerateScopes(project)
    for (const pack of options.packs ?? []) {
      for (const scope of scopes) {
        for (const rule of pack.rules) {
          if (!rule.appliesTo.includes(scope.type)) continue
        coverageEntries?.push({
            ruleId: rule.id,
            rulePack: { id: pack.id, version: pack.version, selection: 'unsupported-jurisdiction' },
            scope,
            status: 'unavailable',
            reason: `unsupported-jurisdiction:${jurisdiction}`,
            issueIds: [],
          })
        }
      }
    }
    return allIssues
  }

  // Get rule packs (for now, empty array - will be loaded from rules directory)
  const packs: RulePack[] = options.packs || []

  if (packs.length === 0) {
    // Terminal circuit isolation is independent of jurisdiction-specific rule packs.
    for (const scope of enumerateScopes(project)) {
      coverageEntries?.push({
        ruleId: 'validation.rulepack',
        scope,
        status: 'unavailable',
        reason: 'no-rule-pack-loaded',
        issueIds: [],
      })
    }
    return allIssues
  }

  // Create query API
  const query = new DefaultQueryAPI(project)

  // Enumerate all validation scopes
  const scopes = enumerateScopes(project)

  // For each scope, resolve date, select pack, and run rules
  for (const scope of scopes) {
    const effectiveDate = getApplicableRulesetDate(project, scope)
    // If no date, use a default (current year) so validation can still run
    const dateToUse = effectiveDate ?? new Date().getFullYear()

    const pack = selectRulePack(packs, jurisdiction, dateToUse)
    if (!pack) {
      // If no pack found, try to use the first pack for this jurisdiction as fallback
      const fallbackPack = packs.find((p) => p.jurisdiction === jurisdiction)
      if (!fallbackPack) {
        coverageEntries?.push({
          ruleId: 'validation.rulepack',
          scope,
          status: 'unavailable',
          reason: 'no-rule-pack-for-jurisdiction',
          issueIds: [],
        })
        continue
      }
      // Use fallback pack
      for (const rule of fallbackPack.rules) {
        const ruleIssues = runRule(rule, scope, query, project, fallbackPack, coverageEntries, 'jurisdiction-fallback')
        allIssues.push(...ruleIssues)
      }
      continue
    }

    // Run each rule in the pack
    for (const rule of pack.rules) {
      const ruleIssues = runRule(rule, scope, query, project, pack, coverageEntries)
      allIssues.push(...ruleIssues)
    }
  }

  // Sort issues deterministically: by ruleId, then scopeKey, then offender id
  allIssues.sort((a, b) => {
    if (a.ruleId !== b.ruleId) return a.ruleId.localeCompare(b.ruleId)
    const aScopeKey = `${a.scope.type}:${a.scope.id}`
    const bScopeKey = `${b.scope.type}:${b.scope.id}`
    if (aScopeKey !== bScopeKey) return aScopeKey.localeCompare(bScopeKey)
    if (a.offenders.length !== b.offenders.length) {
      return a.offenders.length - b.offenders.length
    }
    const aOffenderIds = a.offenders
      .map((o) => o.id)
      .sort()
      .join(',')
    const bOffenderIds = b.offenders
      .map((o) => o.id)
      .sort()
      .join(',')
    return aOffenderIds.localeCompare(bOffenderIds)
  })

  const dedupedIssues: Issue[] = []
  const seenIssueIds = new Set<string>()
  for (const issue of allIssues) {
    if (seenIssueIds.has(issue.id)) continue
    seenIssueIds.add(issue.id)
    dedupedIssues.push(issue)
  }

  const mergedIssues = mergeIssuesByMergeBucket(dedupedIssues)

  mergedIssues.sort((a, b) => {
    if (a.ruleId !== b.ruleId) return a.ruleId.localeCompare(b.ruleId)
    const aScopeKey = `${a.scope.type}:${a.scope.id}`
    const bScopeKey = `${b.scope.type}:${b.scope.id}`
    if (aScopeKey !== bScopeKey) return aScopeKey.localeCompare(bScopeKey)
    if (a.offenders.length !== b.offenders.length) {
      return a.offenders.length - b.offenders.length
    }
    const aOffenderIds = a.offenders
      .map((o) => o.id)
      .sort()
      .join(',')
    const bOffenderIds = b.offenders
      .map((o) => o.id)
      .sort()
      .join(',')
    return aOffenderIds.localeCompare(bOffenderIds)
  })

  return mergedIssues
}
