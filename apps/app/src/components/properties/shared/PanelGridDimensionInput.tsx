import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useTouchPrimaryDevice } from '@/hooks/useTouchPrimaryDevice'

export function PanelGridDimensionInput({
  label,
  value,
  min,
  max,
  resetKey,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  /** Identifies the board whose dimension is being edited. */
  resetKey?: unknown
  onChange: (value: number) => void
}) {
  const id = useId()
  const touchPrimary = useTouchPrimaryDevice()
  const clamp = (next: number) => Math.max(min, Math.min(max, next))
  const [draft, setDraft] = useState(String(value))
  const draftRef = useRef(draft)
  const identityRef = useRef(resetKey)
  const currentRef = useRef({ value, min, max, onChange })
  useLayoutEffect(() => {
    currentRef.current = { value, min, max, onChange }
  }, [value, min, max, onChange])

  const setDraftValue = useCallback((next: string) => {
    draftRef.current = next
    setDraft(next)
  }, [])

  const commitDraft = useCallback(() => {
    const raw = draftRef.current.trim()
    const parsed = raw === '' ? Number.NaN : Number(raw)
    if (!Number.isInteger(parsed)) {
      setDraftValue(String(currentRef.current.value))
      return
    }

    const { min: currentMin, max: currentMax, onChange: commit } = currentRef.current
    const next = Math.max(currentMin, Math.min(currentMax, parsed))
    setDraftValue(String(next))
    if (next !== currentRef.current.value) commit(next)
  }, [setDraftValue])

  const cancelDraft = useCallback(() => {
    setDraftValue(String(currentRef.current.value))
  }, [setDraftValue])

  useEffect(() => {
    if (!Object.is(identityRef.current, resetKey) || draftRef.current !== String(value)) {
      setDraftValue(String(value))
    }
    identityRef.current = resetKey
  }, [resetKey, setDraftValue, value])

  const updateDraft = (next: string) => {
    setDraftValue(next)
  }

  const commitButtonChange = (next: number) => {
    const clamped = clamp(next)
    setDraftValue(String(clamped))
    if (clamped !== value) onChange(clamped)
  }

  const buttonClass =
    'flex h-11 w-11 flex-shrink-0 items-center justify-center gap-0.5 rounded-md border border-gray-300 bg-white text-sky-700 disabled:opacity-40 dark:border-gray-600 dark:bg-gray-700 dark:text-sky-300'

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="w-16 flex-shrink-0 text-sm text-gray-700 dark:text-gray-300">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={1}
        value={draft}
        onChange={(event) => {
          updateDraft(event.target.value)
          // Typing waits for Enter/blur so "12" never applies as "1"; the native spinner and
          // arrow keys step one value at a time and carry no inputType, so apply those at once.
          if (!(event.nativeEvent as InputEvent).inputType) commitDraft()
        }}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            cancelDraft()
            event.currentTarget.blur()
          }
        }}
        className="w-20 min-w-0 rounded-md border border-gray-300 bg-white px-2 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
      />
      {touchPrimary && (
        <>
          <button
            type="button"
            className={buttonClass}
            aria-label={`${label} −1`}
            disabled={value <= min}
            onClick={() => commitButtonChange(value - 1)}
          >
            <span aria-hidden="true">−</span>
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={buttonClass}
            aria-label={`${label} +1`}
            disabled={value >= max}
            onClick={() => commitButtonChange(value + 1)}
          >
            <span aria-hidden="true">+</span>
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  )
}
