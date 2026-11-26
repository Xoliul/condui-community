import { clamp } from '@/lib/geometry'
import type { WheelBehavior, WheelInputDevice } from '@/types/ui'

export const WHEEL_GESTURE_RESET_MS = 120
/** Wheel events further apart than this are discrete mouse notches and zoom a full step. */
export const WHEEL_DISCRETE_GAP_MS = 80
export const WHEEL_ZOOM_STEP = 1.1
const WHEEL_LINE_PX = 16
/** Consecutive scroll events needed before suggesting a wheel behavior. */
export const WHEEL_DEVICE_EVIDENCE_EVENTS = 3
/** Keep evidence within one short burst so separate touchpad gestures do not accumulate. */
export const WHEEL_DEVICE_EVIDENCE_MAX_GAP_MS = 600

export type WheelAction =
  | { kind: 'zoom'; factor: number }
  | { kind: 'pan'; dx: number; dy: number }
  | { kind: 'none' }

export type WheelInput = {
  deltaMode: number
  deltaX: number
  deltaY: number
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  /** Time since the previous wheel event on this canvas. */
  msSincePreviousWheel: number
  /** Height used for page-mode deltas (deltaMode 2). */
  pageHeightPx: number
}

export type WheelBehaviorEvidenceState = {
  behavior: WheelBehavior
  evidenceInput: WheelInputDevice | null
  eventCount: number
}

export type WheelBehaviorEvidenceUpdate = {
  state: WheelBehaviorEvidenceState
  clearDismissal: boolean
  suggestedBehavior: WheelBehavior | null
}

export function wheelDeltaToPixels(delta: number, deltaMode: number, pageHeightPx: number): number {
  if (deltaMode === 1) return delta * WHEEL_LINE_PX
  if (deltaMode === 2) return delta * pageHeightPx
  return delta
}

/** Proportional zoom for pinch and continuous streams; one event never exceeds a full step. */
export function getProportionalWheelZoomFactor(deltaYPx: number): number {
  return 1 - clamp(deltaYPx, -10, 10) * 0.01
}

function getWheelZoomFactor(deltaYPx: number, discrete: boolean): number {
  if (deltaYPx === 0) return 1
  if (discrete) return deltaYPx > 0 ? 1 / WHEEL_ZOOM_STEP : WHEEL_ZOOM_STEP
  return getProportionalWheelZoomFactor(deltaYPx)
}

/**
 * Maps one wheel event to a canvas action. The result depends only on the chosen behavior and
 * the event itself, never on guessing the device, so speed can no longer flip pan into zoom.
 */
export function resolveWheelAction(input: WheelInput, behavior: WheelBehavior): WheelAction {
  const dx = wheelDeltaToPixels(input.deltaX, input.deltaMode, input.pageHeightPx)
  const dy = wheelDeltaToPixels(input.deltaY, input.deltaMode, input.pageHeightPx)

  // Pinch (browsers set ctrlKey) and Ctrl/Cmd + wheel always zoom.
  if (input.ctrlKey || input.metaKey) {
    if (dy === 0) return { kind: 'none' }
    const discrete = input.deltaMode !== 0 || Math.abs(dy) >= 50
    return { kind: 'zoom', factor: getWheelZoomFactor(dy, discrete) }
  }

  if (behavior === 'pan') {
    if (dx === 0 && dy === 0) return { kind: 'none' }
    // Shift + mouse wheel scrolls sideways where the browser does not already swap axes.
    if (input.shiftKey && dx === 0) return { kind: 'pan', dx: -dy, dy: 0 }
    return { kind: 'pan', dx: -dx, dy: -dy }
  }

  if (input.shiftKey) {
    const sideways = dx !== 0 ? dx : dy
    return sideways === 0 ? { kind: 'none' } : { kind: 'pan', dx: -sideways, dy: 0 }
  }
  // Tilt wheels and mostly-sideways swipes pan horizontally.
  if (Math.abs(dx) > Math.abs(dy)) return { kind: 'pan', dx: -dx, dy: 0 }
  if (dy === 0) return { kind: 'none' }
  const discrete = input.deltaMode !== 0 || input.msSincePreviousWheel > WHEEL_DISCRETE_GAP_MS
  return { kind: 'zoom', factor: getWheelZoomFactor(dy, discrete) }
}

/**
 * A mouse wheel moves on one axis per event; a two-finger scroll almost always drifts
 * diagonally. Counts as trackpad evidence only without modifiers.
 */
export function isDiagonalPixelScroll(
  input: Pick<WheelInput, 'deltaMode' | 'deltaX' | 'deltaY' | 'ctrlKey' | 'metaKey' | 'shiftKey'>
): boolean {
  if (input.deltaMode !== 0 || input.ctrlKey || input.metaKey || input.shiftKey) return false
  return input.deltaX !== 0 && input.deltaY !== 0
}

/** Line-mode or spaced vertical pixel events are evidence of a mouse wheel. */
export function isDiscreteMouseWheel(
  input: Pick<
    WheelInput,
    'deltaMode' | 'deltaX' | 'deltaY' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'msSincePreviousWheel'
  >
): boolean {
  if (input.ctrlKey || input.metaKey || input.shiftKey || input.deltaX !== 0 || input.deltaY === 0) {
    return false
  }
  return input.deltaMode !== 0 || input.msSincePreviousWheel > WHEEL_DISCRETE_GAP_MS
}

/** Tracks repeated evidence that the selected scroll behavior does not match the input device. */
export function updateWheelBehaviorEvidence(
  state: WheelBehaviorEvidenceState,
  behavior: WheelBehavior,
  input: WheelInput,
  dismissedInput: WheelInputDevice | null
): WheelBehaviorEvidenceUpdate {
  const sameBehavior = state.behavior === behavior
  const previousInput = sameBehavior ? state.evidenceInput : null
  const previousCount = sameBehavior ? state.eventCount : 0
  const trackpadEvidence = isDiagonalPixelScroll(input)
  const mouseEvidence = isDiscreteMouseWheel(input)
  const detectedInput: WheelInputDevice | null = trackpadEvidence
    ? 'trackpad'
    : mouseEvidence
      ? 'mouse'
      : null
  const continuesEvidence =
    detectedInput !== null &&
    detectedInput === previousInput &&
    input.msSincePreviousWheel <= WHEEL_DEVICE_EVIDENCE_MAX_GAP_MS
  const evidenceInput = detectedInput
  const eventCount = detectedInput ? (continuesEvidence ? previousCount + 1 : 1) : 0
  const confirmedInput = eventCount >= WHEEL_DEVICE_EVIDENCE_EVENTS ? evidenceInput : null
  const clearDismissal = Boolean(
    confirmedInput && dismissedInput && confirmedInput !== dismissedInput
  )
  const expectedInput = behavior === 'zoom' ? 'trackpad' : 'mouse'
  const shouldSuggest = confirmedInput === expectedInput && dismissedInput !== expectedInput
  const suggestedBehavior = shouldSuggest ? (behavior === 'zoom' ? 'pan' : 'zoom') : null

  return {
    state: { behavior, evidenceInput, eventCount },
    clearDismissal,
    suggestedBehavior,
  }
}
