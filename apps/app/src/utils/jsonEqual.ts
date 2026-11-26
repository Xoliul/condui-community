/**
 * Structural equality with JSON semantics: object key order is ignored,
 * properties whose value is `undefined` are treated as absent, and an
 * `undefined` array item equals `null`. Arrays stay ordered. Exits early on the
 * first difference, so it is cheaper than comparing two `JSON.stringify` results.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
      if (!jsonEqual(a[i] ?? null, b[i] ?? null)) return false
    }
    return true
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return Number.isNaN(a) && Number.isNaN(b)
  }
  const objectA = a as Record<string, unknown>
  const objectB = b as Record<string, unknown>
  let definedInA = 0
  for (const key of Object.keys(objectA)) {
    const valueA = objectA[key]
    if (valueA === undefined) continue
    definedInA += 1
    if (!(key in objectB) || objectB[key] === undefined) return false
    if (!jsonEqual(valueA, objectB[key])) return false
  }
  let definedInB = 0
  for (const key of Object.keys(objectB)) {
    if (objectB[key] !== undefined) definedInB += 1
  }
  return definedInA === definedInB
}
