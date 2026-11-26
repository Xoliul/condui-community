import { cloneValue } from '@/utils/cloneValue'
import type { Issue, ValidationProject, ValidationCoverageEntry, ValidationCoverageReport } from './core/types'
import type { ValidationProjectRun } from './core/engine'
import { buildValidationCoverageReport } from './coverage'
import { selectProjectJunctionAssets } from '@/lib/projectV2/electrical'

/**
 * Read-only, store-independent entry point for the editor's electrical rule pack.
 *
 * This deliberately does not use the editor's latest-only worker channel: checking
 * an assistant draft must not cancel validation of the user's live project (or vice
 * versa). The lazy fallback runs synchronously after loading. Clone at invocation
 * so native query helpers can normalize their private candidate without changing
 * the supplied project, including a frozen editor snapshot.
 */
export async function validateElectricalProject(
  project: ValidationProject,
  options?: {
    language?: string
    /** Headless hosts supply their edition policy explicitly instead of evaluating Vite flags. */
    collectJunctionIssues?: (
      project: ValidationProject,
      translate: (key: string, options?: Record<string, unknown>) => string
    ) => Issue[]
  }
): Promise<Issue[]> {
  return (await runElectricalProjectValidation(project, options, false)).issues
}

/** Read-only electrical validation with explicit rule/check/scope execution coverage. */
export async function validateElectricalProjectWithCoverage(
  project: ValidationProject,
  options?: {
    language?: string
    collectJunctionIssues?: (
      project: ValidationProject,
      translate: (key: string, options?: Record<string, unknown>) => string
    ) => Issue[]
  }
): Promise<ValidationProjectRun> {
  const result = await runElectricalProjectValidation(project, options, true)
  return { issues: result.issues, coverage: result.coverage! }
}

async function runElectricalProjectValidation(
  project: ValidationProject,
  options: {
    language?: string
    collectJunctionIssues?: (
      project: ValidationProject,
      translate: (key: string, options?: Record<string, unknown>) => string
    ) => Issue[]
  } | undefined,
  includeCoverage: boolean
): Promise<{ issues: Issue[]; coverage?: ValidationCoverageReport }> {
  const snapshot = cloneValue(project)
  const [
    validationEngine,
    { beAreiBook1_2025 },
    { loadRulePack },
    { default: validationI18n, prepareValidationLanguage },
    { collectJunctionValidationIssuesForEdition },
  ] = await Promise.all([
    import('./core/engine'),
    import('./rules/be/be.areibook1.2025'),
    import('./core/rulepack-loader'),
    import('./validationI18n'),
    import('@/lib/junction/junctionHostedHooks'),
  ])
  // Identical language selection to the editor worker client and previous fallback.
  // Setting language and running the synchronous validator share one JS turn.
  await prepareValidationLanguage(
    options?.language ??
      (typeof document === 'undefined' ? 'nl-BE' : document.documentElement?.lang || 'nl-BE')
  )
  const baseRun = validationEngine.validateProjectWithCoverage(snapshot, { packs: [loadRulePack(beAreiBook1_2025)] })
  const junctionIssues = (options?.collectJunctionIssues ?? collectJunctionValidationIssuesForEdition)(
    snapshot,
    validationI18n.t.bind(validationI18n)
  )
  // Preserve coverage for diagnostic callers without turning it into a catch-all notice.
  const issues = [...baseRun.issues, ...junctionIssues]
  if (!includeCoverage || !baseRun) return { issues }
  const hasJunctionAssets = selectProjectJunctionAssets(snapshot).length > 0
  const coverageEntries: ValidationCoverageEntry[] = [
    ...baseRun.coverage.entries,
    ...junctionIssues.map((issue) => ({
      ruleId: issue.ruleId,
      checkName: 'junction-edition-validation',
      scope: issue.scope,
      status: 'failed' as const,
      issueIds: [issue.id],
    })),
    {
      ruleId: 'validation.junction-edition',
      scope: { type: 'junction' as const, id: 'edition-validation' },
      status: hasJunctionAssets ? 'unavailable' : 'skipped',
      reason: hasJunctionAssets
        ? 'junction-validator-does-not-report-per-check-coverage'
        : 'no-junction-assets-in-project',
      issueIds: junctionIssues.map((issue) => issue.id),
    },
  ]
  return { issues, coverage: buildValidationCoverageReport(coverageEntries) }
}
