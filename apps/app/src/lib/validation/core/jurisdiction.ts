/** Resolve the ruleset jurisdiction, defaulting projects without a country to Belgium. */
export function getValidationJurisdiction(country: string | null | undefined): string {
  return country || 'BE'
}
