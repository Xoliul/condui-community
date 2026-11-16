/**
 * Server refusals of a new cloud project: no free cloud slot, or a slot still in
 * its cooldown. They are a final answer for that project, never a transient error.
 */
const CLOUD_PROJECT_CREATION_REFUSAL_CODES = [
  'CLOUD_PROJECT_QUOTA_EXCEEDED',
  'CLOUD_PROJECT_RECREATE_COOLDOWN',
] as const

export function isCloudProjectCreationRefusedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return CLOUD_PROJECT_CREATION_REFUSAL_CODES.some((code) => message.includes(code))
}
