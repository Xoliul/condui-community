export type AnalyticsConsentChoice = 'accepted' | 'declined'
export type ValidationPanelAnalyticsSource = 'menu' | 'state'

export function initializeGoogleAnalytics(): void {}
export function trackGoogleAnalyticsEvent(): void {}
export function trackGoogleAnalyticsPageView(): void {}
export function trackValidationPanelVisibility(): void {}
export function trackProjectVersionsVisibility(): void {}
export function trackSymbolPlace(): void {}
export function trackSupplyAssemblyMutation(): void {}
export function trackSupplyAssembliesPersisted(): void {}
export function trackReferralDiscountCheckout(): void {}
export function trackOrphanAutoReport(): void {}
export function trackOrphanDetectedOncePerSession(): void {}
export function summarizeProjectSupplyAssemblies(): Record<string, never> {
  return {}
}
export function getAnalyticsConsentChoice(): null { return null }
export function setAnalyticsConsentChoice(): void {}
export const ANALYTICS_CONSENT_STORAGE_KEY = 'condui-community-analytics-disabled'
