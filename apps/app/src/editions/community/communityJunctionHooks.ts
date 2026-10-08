/**
 * Community stand-in for `lib/junction/junctionHostedHooks.ts`. Community never writes junction
 * data: assets and occurrence links are kept exactly as loaded.
 */
export function syncJunctionAssetsForEdition(_project: unknown): boolean {
  return false
}

/** Community does not check junction connections. */
export function collectJunctionValidationIssuesForEdition(_project: unknown, _t: unknown): never[] {
  return []
}
