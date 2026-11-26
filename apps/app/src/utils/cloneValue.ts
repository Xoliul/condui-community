import { current, isDraft, type Draft } from 'immer'

/**
 * Plain copy of a value that may be an Immer draft. Project commands run inside `produce`, so
 * anything read from the project there is a draft proxy.
 */
export function plainSnapshot<T>(value: T): T {
  // isDraft does not narrow T; current() of a draft of T is a plain T.
  return isDraft(value) ? (current(value as Draft<T>) as T) : value
}

function resolveDrafts(value: unknown, seen: Map<object, unknown>): unknown {
  if (isDraft(value)) return current(value)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)
  if (Array.isArray(value)) {
    const copy: unknown[] = []
    seen.set(value, copy)
    for (const item of value) copy.push(resolveDrafts(item, seen))
    return copy
  }
  if (value instanceof Map) {
    const copy = new Map()
    seen.set(value, copy)
    for (const [key, item] of value) copy.set(resolveDrafts(key, seen), resolveDrafts(item, seen))
    return copy
  }
  if (value instanceof Set) {
    const copy = new Set()
    seen.set(value, copy)
    for (const item of value) copy.add(resolveDrafts(item, seen))
    return copy
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return value
  const copy: Record<string, unknown> = {}
  seen.set(value, copy)
  for (const [key, item] of Object.entries(value)) copy[key] = resolveDrafts(item, seen)
  return copy
}

/**
 * Deep copy that also accepts Immer drafts, alone or nested in plain objects, arrays, maps and
 * sets. Use it instead of `structuredClone`, which throws `DataCloneError` on a draft: code
 * reachable from a project command silently fails when it clones project data that way.
 */
export function cloneValue<T>(value: T): T {
  // Older or embedded browser runtimes may not expose structuredClone. The
  // project data copied here is also supported by the draft-aware fallback.
  if (typeof structuredClone !== 'function') {
    return resolveDrafts(value, new Map()) as T
  }

  try {
    return structuredClone(value)
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'DataCloneError') throw error
    return structuredClone(resolveDrafts(value, new Map())) as T
  }
}
