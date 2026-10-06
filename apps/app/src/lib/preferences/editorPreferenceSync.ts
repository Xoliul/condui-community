import { logger } from '@/lib/logger'

/** One editor preference that follows the user across devices. */
export interface EditorPreferenceField<T = unknown> {
  key: string
  read(): T
  apply(value: T): void
  isValid(value: unknown): value is T
}

/** Where synced preferences are kept beyond this browser (an account, a self-hosted server). */
export interface EditorPreferencesRemote {
  /** Returns null when the remote never stored preferences. */
  load(): Promise<Record<string, unknown> | null>
  save(values: Record<string, unknown>): Promise<void>
}

const SAVE_DELAY_MS = 1_000

/**
 * The stored value wins for every preference it already has; preferences it lacks (never synced,
 * or added in a newer version) are taken from this browser and saved. Keys this client does not
 * know are kept untouched.
 */
export function resolveEditorPreferences(
  fields: EditorPreferenceField[],
  remote: Record<string, unknown> | null,
): { apply: Record<string, unknown>; stored: Record<string, unknown>; save: boolean } {
  const stored: Record<string, unknown> = { ...(remote ?? {}) }
  const apply: Record<string, unknown> = {}
  let save = false
  for (const field of fields) {
    const value = remote?.[field.key]
    if (field.isValid(value)) {
      apply[field.key] = value
    } else {
      stored[field.key] = field.read()
      save = true
    }
  }
  return { apply, stored, save }
}

function snapshot(fields: EditorPreferenceField[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((field) => [field.key, field.read()]))
}

/**
 * Keeps the given preferences in step with a remote copy. `subscribe` reports local changes.
 * Returns a stop function that flushes a pending save.
 */
export function startEditorPreferenceSync(
  remote: EditorPreferencesRemote,
  fields: EditorPreferenceField[],
  subscribe: (onChange: () => void) => () => void,
): () => void {
  let stopped = false
  let ready = false
  let applying = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let stored: Record<string, unknown> = {}

  const changedSinceStored = () => fields.some((field) => !Object.is(field.read(), stored[field.key]))

  const save = () => {
    stored = { ...stored, ...snapshot(fields) }
    void remote.save(stored).catch((error: unknown) => {
      logger.error('Saving editor preferences failed:', error)
    })
  }

  const flush = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    if (changedSinceStored()) save()
  }

  const pull = async () => {
    const loaded = await remote.load()
    if (stopped || saveTimer) return
    const resolved = resolveEditorPreferences(fields, loaded)
    stored = resolved.stored
    applying = true
    try {
      for (const field of fields) {
        if (field.key in resolved.apply && !Object.is(field.read(), resolved.apply[field.key])) {
          field.apply(resolved.apply[field.key])
        }
      }
    } finally {
      applying = false
    }
    if (resolved.save) save()
    ready = true
  }

  const unsubscribe = subscribe(() => {
    if (!ready || applying || !changedSinceStored()) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, SAVE_DELAY_MS)
  })

  // Pick up changes made on another device when the user returns to this tab.
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && ready) {
      void pull().catch((error: unknown) => logger.error('Loading editor preferences failed:', error))
    }
  }
  const watchesVisibility = typeof document !== 'undefined' && typeof document.addEventListener === 'function'
  if (watchesVisibility) document.addEventListener('visibilitychange', handleVisibilityChange)

  void pull().catch((error: unknown) => logger.error('Loading editor preferences failed:', error))

  return () => {
    stopped = true
    unsubscribe()
    if (watchesVisibility) document.removeEventListener('visibilitychange', handleVisibilityChange)
    if (saveTimer) flush()
  }
}
