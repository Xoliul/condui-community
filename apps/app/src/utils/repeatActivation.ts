/** Matches Konva's default dblClickWindow. */
export const REPEAT_ACTIVATION_WINDOW_MS = 400

/**
 * - `single`: an ordinary click/tap.
 * - `double`: the second quick activation of the same key.
 * - `absorbed`: a further quick activation after a double; callers must leave the
 *   double-click result untouched instead of treating it as a new single click.
 */
export type ActivationKind = 'single' | 'double' | 'absorbed'

let lastActivation: { key: string; time: number; afterDouble: boolean } | null = null

/**
 * Track click/tap activations by a stable key.
 * Unlike Konva's dblclick, this survives the target node being re-mounted between clicks.
 */
export function registerActivation(key: string, now: number = performance.now()): ActivationKind {
  const isQuickRepeat =
    lastActivation !== null &&
    lastActivation.key === key &&
    now - lastActivation.time <= REPEAT_ACTIVATION_WINDOW_MS
  const kind: ActivationKind = !isQuickRepeat
    ? 'single'
    : lastActivation!.afterDouble
      ? 'absorbed'
      : 'double'
  // Each absorbed click extends the window, so a burst of clicks keeps the double result.
  lastActivation = { key, time: now, afterDouble: kind !== 'single' }
  return kind
}

export function resetActivationTracking(): void {
  lastActivation = null
}
