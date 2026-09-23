/**
 * Validation engine: runs rules against a project and returns issues
 */
import type { Panel } from '@/types/schema'
import type { Issue, RulePack, Scope, CheckContext, ValidationProject } from './types'
import { DefaultQueryAPI } from './query-api'
import { getApplicableRulesetDate } from './date-resolver'
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

export interface ValidationOptions {
  packs?: RulePack[]
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
    if (base.ruleId === rcdRuleId && group.length > 1) {
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
      // Add panel as board scope
      scopes.push({ type: 'board', id: panel.id })

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
function checkPrerequisites(
  prerequisites: RulePack['rules'][0]['prerequisites'],
  scope: Scope,
  query: DefaultQueryAPI
): boolean {
  void query
  if (!prerequisites) return true

  // Check requiresScopeType
  if (prerequisites.requiresScopeType && !prerequisites.requiresScopeType.includes(scope.type)) {
    return false
  }

  // Check skipIf conditions (stub for now - would need to run checks)
  if (prerequisites.skipIf && prerequisites.skipIf.length > 0) {
    // For now, skip if any skipIf condition exists (conservative)
    // In a full implementation, we'd run the checks here
  }

  return true
}

/**
 * Run a single rule against a scope
 */
function runRule(
  rule: RulePack['rules'][0],
  scope: Scope,
  query: DefaultQueryAPI,
  project: ValidationProject,
  pack: RulePack
): Issue[] {
  const issues: Issue[] = []

  // Check prerequisites
  if (!checkPrerequisites(rule.prerequisites, scope, query)) {
    return issues
  }

  // Check if rule applies to this scope type
  if (!rule.appliesTo.includes(scope.type)) {
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
      // Unknown primitive - skip or log warning
      continue
    }

    const result = checkFn(context, checkRef.params)

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
          remediation: rule.remediation
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
  const allIssues: Issue[] = []

  // Log eendraad orphans immediately to the console (so they're visible even before opening validation UI)
  logOrphanReport(project)

  // Get jurisdiction from project
  const jurisdiction = getValidationJurisdiction(
    getProjectElectricalInstallation(project)?.address.country
  )
  if (jurisdiction !== 'BE') return allIssues

  // Get rule packs (for now, empty array - will be loaded from rules directory)
  const packs: RulePack[] = options.packs || []

  if (packs.length === 0) {
    // No packs loaded - return empty issues
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
        continue // No pack for this jurisdiction at all
      }
      // Use fallback pack
      for (const rule of fallbackPack.rules) {
        const ruleIssues = runRule(rule, scope, query, project, fallbackPack)
        allIssues.push(...ruleIssues)
      }
      continue
    }

    // Run each rule in the pack
    for (const rule of pack.rules) {
      const ruleIssues = runRule(rule, scope, query, project, pack)
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
