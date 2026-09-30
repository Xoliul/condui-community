import type { Issue, ValidationProject } from './core/types'

/**
 * Read-only, store-independent entry point for the editor's electrical rule pack.
 *
 * This deliberately does not use the editor's latest-only worker channel: checking
 * an assistant draft must not cancel validation of the user's live project (or vice
 * versa). The lazy fallback runs synchronously after loading. Clone at invocation
 * so native query helpers can normalize their private candidate without changing
 * the supplied project, including a frozen editor snapshot.
 */
export async function validateElectricalProject(project: ValidationProject): Promise<Issue[]> {
  const snapshot = structuredClone(project)
  const [{ validateProject }, { beAreiBook1_2025 }, { loadRulePack }, { setValidationLanguage }] =
    await Promise.all([
      import('./core/engine'),
      import('./rules/be/be.areibook1.2025'),
      import('./core/rulepack-loader'),
      import('./validationI18n'),
    ])
  // Identical language selection to the editor worker client and previous fallback.
  // Setting language and running the synchronous validator share one JS turn.
  setValidationLanguage(
    typeof document === 'undefined' ? 'nl-BE' : document.documentElement?.lang || 'nl-BE'
  )
  return validateProject(snapshot, { packs: [loadRulePack(beAreiBook1_2025)] })
}
