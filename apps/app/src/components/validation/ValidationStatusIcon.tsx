import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import {
  getValidationDisplayKind,
  useValidationStore,
  type ValidationState,
} from '@/stores/validationStore'
import { useUIStore } from '@/stores/uiStore'
import { getValidationSignature } from '@/lib/validation/validationTrigger'
import { AlertCircle, AlertTriangle, CheckCircle2, RotateCw } from 'lucide-react'
import { queryOneWireSegments } from '@/lib/projectV2/annotations'
import { getProjectElectricalInstallation, getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { logger } from '@/lib/logger'
import { cancelActiveValidationWorker } from '@/lib/validation/validationWorkerClient'
import { getValidationJurisdiction } from '@/lib/validation/core/jurisdiction'

type IdleDeadlineLike = { didTimeout: boolean; timeRemaining: () => number }
type RequestIdleCallbackHandle = number
type WindowWithIdleCallbacks = Window & {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadlineLike) => void,
    options?: { timeout?: number }
  ) => RequestIdleCallbackHandle
  cancelIdleCallback?: (handle: RequestIdleCallbackHandle) => void
}

function requestIdle(
  cb: (deadline: IdleDeadlineLike) => void,
  timeoutMs: number
): RequestIdleCallbackHandle {
  const ric = (window as WindowWithIdleCallbacks).requestIdleCallback
  if (ric) return ric(cb, { timeout: timeoutMs })
  // Fallback: schedule soon on the macrotask queue.
  return window.setTimeout(
    () => cb({ didTimeout: true, timeRemaining: () => 0 }),
    Math.min(250, timeoutMs)
  )
}

function cancelIdle(handle: RequestIdleCallbackHandle) {
  const cic = (window as WindowWithIdleCallbacks).cancelIdleCallback
  if (cic) cic(handle)
  else clearTimeout(handle)
}

interface ValidationStateIconProps {
  className?: string
  /** When true, skip pending/result state and always show a warning. */
  disabledOutsideBelgium?: boolean
}

export function ValidationStateIcon({
  className = 'w-5 h-5',
  disabledOutsideBelgium = false,
}: ValidationStateIconProps) {
  const status = useValidationStore((state: ValidationState) => state.status)
  const isLoading = useValidationStore((state: ValidationState) => state.isLoading)
  const isDirty = useValidationStore((state: ValidationState) => state.isDirty)
  const lastValidatedSignature = useValidationStore(
    (state: ValidationState) => state.lastValidatedSignature
  )
  const currentSignature = useValidationStore((state: ValidationState) => state.currentSignature)

  if (disabledOutsideBelgium) {
    return <AlertTriangle className={`${className} text-yellow-500`} />
  }

  const displayKind = getValidationDisplayKind({
    status,
    isLoading,
    isDirty,
    lastValidatedSignature,
    currentSignature,
  })
  if (displayKind === 'pending') {
    return (
      <RotateCw
        className={`${className} animate-spin text-gray-500 dark:text-gray-400`}
      />
    )
  }
  switch (displayKind) {
    case 'error':
      return <AlertCircle className={`${className} text-red-500`} />
    case 'warning':
      return <AlertTriangle className={`${className} text-yellow-500`} />
    case 'ok':
      return <CheckCircle2 className={`${className} text-green-500`} />
  }
}

function ValidationStatusIcon() {
  const { t } = useTranslation()
  const currentProject = useProjectStore((state: ProjectState) => state.currentProject)
  const validationWindowOpen = useUIStore((state) => state.validationWindowOpen)
  const projectRef = useRef(currentProject)
  projectRef.current = currentProject
  const validate = useValidationStore((state: ValidationState) => state.validate)
  const status = useValidationStore((state: ValidationState) => state.status)
  const isLoading = useValidationStore((state: ValidationState) => state.isLoading)
  const isDirty = useValidationStore((state: ValidationState) => state.isDirty)
  const pendingSignature = useValidationStore((state: ValidationState) => state.pendingSignature)
  const lastValidatedSignature = useValidationStore(
    (state: ValidationState) => state.lastValidatedSignature
  )
  const currentSignature = useValidationStore((state: ValidationState) => state.currentSignature)
  const setCurrentSignature = useValidationStore(
    (state: ValidationState) => state.setCurrentSignature
  )
  const errorCount = useValidationStore((state: ValidationState) => state.getErrorCount())
  const warningCount = useValidationStore((state: ValidationState) => state.getWarningCount())
  const toggleValidationWindow = useUIStore((state) => state.toggleValidationWindow)
  const validationDisabledOutsideBelgium =
    currentProject != null &&
    getValidationJurisdiction(
      getProjectElectricalInstallation(currentProject)?.address.country
    ) !== 'BE'

  // Signature generation walks the canonical electrical graph. Keep it out of the
  // input event that mutated that graph; validation itself is already idle-scheduled.
  const [signature, setSignature] = useState(() => getValidationSignature(currentProject ?? null))
  const signatureIdleHandleRef = useRef<RequestIdleCallbackHandle | null>(null)
  useEffect(() => {
    if (signatureIdleHandleRef.current !== null) {
      cancelIdle(signatureIdleHandleRef.current)
      signatureIdleHandleRef.current = null
    }
    if (!currentProject) {
      setSignature('')
      return
    }
    signatureIdleHandleRef.current = requestIdle(() => {
      signatureIdleHandleRef.current = null
      setSignature(getValidationSignature(currentProject))
    }, 500)
    return () => {
      if (signatureIdleHandleRef.current !== null) {
        cancelIdle(signatureIdleHandleRef.current)
        signatureIdleHandleRef.current = null
      }
    }
  }, [currentProject])
  const lastSignatureRef = useRef<string>('')

  const projectSizeScore = useMemo(() => {
    const p = currentProject
    if (!p) return 0
    const panels = getProjectElectricalPanels(p).length
    const wireSegments = queryOneWireSegments(p).length
    // Rough heuristic: panels dominate electrical complexity; wire segments can be large.
    return panels * 50 + wireSegments
  }, [currentProject])

  const idleDelayMs = useMemo(() => {
    // When the validation window is open, prioritize fast feedback while editing.
    if (validationWindowOpen) {
      // Small projects: ~120ms, large: up to ~450ms
      if (projectSizeScore <= 500) return 120
      if (projectSizeScore <= 2000) return 200
      if (projectSizeScore <= 6000) return 320
      return 450
    }
    // Default mode: conservative scheduling to avoid heavy churn.
    // Small projects: ~900ms, large: up to ~2200ms
    if (projectSizeScore <= 500) return 900
    if (projectSizeScore <= 2000) return 1400
    if (projectSizeScore <= 6000) return 1800
    return 2200
  }, [projectSizeScore, validationWindowOpen])

  const inactivityMs = useMemo(() => {
    // While the validation window is open, shorten "settle" time for near-live feedback.
    if (validationWindowOpen) {
      return projectSizeScore <= 2000 ? 180 : 320
    }
    // Default mode: postpone heavy validation while actively interacting.
    return projectSizeScore <= 2000 ? 1200 : 1800
  }, [projectSizeScore, validationWindowOpen])

  const lastInteractionRef = useRef<number>(Date.now())
  const lastInteractionMarkRef = useRef<number>(0)
  const idleHandleRef = useRef<RequestIdleCallbackHandle | null>(null)
  const timerRef = useRef<number | null>(null)

  const cancelScheduledValidation = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (idleHandleRef.current !== null) {
      cancelIdle(idleHandleRef.current)
      idleHandleRef.current = null
    }
  }, [])

  // A project revision is the authoritative editing signal. Pointer events alone
  // are insufficient: keyboard commands, undo, programmatic drops, and a long
  // synchronous commit can all mutate after the last pointer event. Restart the
  // quiet period from the committed revision so a waiting timer waits longer.
  // Do not abort an in-flight worker here: identity-only project updates and
  // refreshes were cancelling the only scheduled run, then never restarting it.
  useEffect(() => {
    lastInteractionRef.current = Date.now()
  }, [currentProject])

  useEffect(() => {
    const markInteraction = () => {
      const now = Date.now()
      if (now - lastInteractionMarkRef.current < 250) return
      lastInteractionMarkRef.current = now
      lastInteractionRef.current = now
    }

    // Capture common “active editing” signals (covers dragging, drawing, typing, zooming).
    const opts: AddEventListenerOptions = { capture: true, passive: true }
    window.addEventListener('pointerdown', markInteraction, opts)
    window.addEventListener('pointermove', markInteraction, opts)
    window.addEventListener('pointerup', markInteraction, opts)
    window.addEventListener('keydown', markInteraction, { capture: true })
    window.addEventListener('wheel', markInteraction, opts)

    return () => {
      window.removeEventListener('pointerdown', markInteraction, opts)
      window.removeEventListener('pointermove', markInteraction, opts)
      window.removeEventListener('pointerup', markInteraction, opts)
      window.removeEventListener('keydown', markInteraction, { capture: true })
      window.removeEventListener('wheel', markInteraction, opts)
    }
  }, [])

  useEffect(() => {
    if (!signature) return

    if (lastSignatureRef.current !== signature) {
      logger.info('[Validation] signature changed')
      lastSignatureRef.current = signature
      // The in-flight worker is for a different revision. Drop it; a new run
      // is scheduled below after the quiet period. Same-signature churn must
      // not abort, or a refresh/click can kill the only remaining run.
      cancelActiveValidationWorker()
    }

    // Light stage: mark “dirty” immediately (icon can reflect this without running validation).
    setCurrentSignature(signature)

    // If the validation store has already validated this signature, or a run
    // for it is already in flight, do not queue a duplicate. If a previous
    // attempt was aborted, pending/loading clear and this effect reschedules.
    const validationState = useValidationStore.getState()
    if (validationState.pendingSignature === signature || validationState.isLoading) {
      return
    }
    if (validationState.lastValidatedSignature === signature && !validationState.isDirty) {
      cancelScheduledValidation()
      return
    }

    cancelScheduledValidation()

    const tryScheduleHeavyValidation = () => {
      const now = Date.now()
      const msSinceInteraction = now - lastInteractionRef.current
      const waitForInactivity = Math.max(0, inactivityMs - msSinceInteraction)

      timerRef.current = window.setTimeout(() => {
        const now2 = Date.now()
        const msSinceInteraction2 = now2 - lastInteractionRef.current
        if (msSinceInteraction2 < inactivityMs) {
          tryScheduleHeavyValidation()
          return
        }

        idleHandleRef.current = requestIdle(() => {
          const project = projectRef.current
          if (project) void validate(project, signature, 'idle_signature_change')
        }, idleDelayMs)
      }, waitForInactivity)
    }

    tryScheduleHeavyValidation()

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
      if (idleHandleRef.current !== null) cancelIdle(idleHandleRef.current)
      idleHandleRef.current = null
    }
  }, [
    cancelScheduledValidation,
    signature,
    validate,
    setCurrentSignature,
    inactivityMs,
    idleDelayMs,
    isDirty,
    isLoading,
    pendingSignature,
    lastValidatedSignature,
  ])

  const handleClick = () => {
    toggleValidationWindow()
  }

  const blurTriggerButton = (event: MouseEvent<HTMLButtonElement>) => {
    // Chrome keeps button focus after click; drop it so Space keeps driving canvas shortcuts.
    event.currentTarget.blur()
  }

  const displayKind = validationDisabledOutsideBelgium
    ? 'warning'
    : getValidationDisplayKind({
        status,
        isLoading,
        isDirty,
        lastValidatedSignature,
        currentSignature,
      })

  const getIcon = () => {
    return (
      <ValidationStateIcon
        className="w-5 h-5"
        disabledOutsideBelgium={validationDisabledOutsideBelgium}
      />
    )
  }

  const getTitle = (kind: typeof displayKind) => {
    if (validationDisabledOutsideBelgium)
      return t('validation.disabledOutsideBelgium', { defaultValue: 'Validation disabled outside Belgium.' })
    if (kind === 'pending')
      return t('validation.checking', { defaultValue: 'Checking...' })
    switch (kind) {
      case 'error':
        return t('validation.errorsFound', {
          count: errorCount,
          defaultValue: `${errorCount} error(s) found`,
        })
      case 'warning':
        return t('validation.warningsFound', {
          count: warningCount,
          defaultValue: `${warningCount} warning(s) found`,
        })
      case 'ok':
        return t('validation.allClear', { defaultValue: 'All available checks passed' })
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseUp={blurTriggerButton}
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors ${
        validationWindowOpen
          ? 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300'
          : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
      }`}
      title={getTitle(displayKind)}
      disabled={isLoading}
      aria-pressed={validationWindowOpen}
    >
      {getIcon()}
      {displayKind !== 'pending' && (errorCount > 0 || warningCount > 0) && (
        <span
          className={`text-xs font-semibold ${
            validationWindowOpen
              ? 'text-sky-700 dark:text-sky-300'
              : 'text-gray-700 dark:text-gray-300'
          }`}
        >
          {errorCount > 0 ? errorCount : warningCount}
        </span>
      )}
    </button>
  )
}

export default ValidationStatusIcon
