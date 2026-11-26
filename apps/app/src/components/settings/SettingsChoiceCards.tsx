import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Check } from 'lucide-react'

const CARD_BASE =
  'relative flex min-w-0 items-center justify-center rounded-lg border-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900'
const CARD_SELECTED = 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
const CARD_IDLE =
  'border-gray-300 bg-white text-gray-700 hover:border-sky-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'

export interface SettingsChoice<T extends string> {
  value: T
  label: string
  icon: ReactNode
  testId?: string
}

function CheckBadge() {
  return (
    <span className="absolute right-1.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full bg-sky-600 text-white">
      <Check className="h-3 w-3" aria-hidden />
    </span>
  )
}

/** Exclusive choice shown as big side-by-side cards (radio group). */
export function SettingsChoiceCards<T extends string>({
  labelId,
  value,
  options,
  onChange,
  testId,
}: {
  /** Id of the element that names the group. */
  labelId: string
  value: T
  options: ReadonlyArray<SettingsChoice<T>>
  onChange: (value: T) => void
  testId?: string
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0
    if (step === 0) return
    event.preventDefault()
    const next = (index + step + options.length) % options.length
    const nextOption = options[next]
    if (!nextOption) return
    onChange(nextOption.value)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      data-testid={testId}
      className="grid grid-cols-2 gap-2"
    >
      {options.map((option, index) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-testid={option.testId}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`${CARD_BASE} gap-2 px-3 py-2 pr-7 ${selected ? CARD_SELECTED : CARD_IDLE}`}
          >
            {selected ? <CheckBadge /> : null}
            <span className="flex shrink-0 items-center justify-center" aria-hidden="true">
              {option.icon}
            </span>
            <span className="max-w-full truncate">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/** On/off option shown as a card (toggle button). */
export function SettingsToggleCard({
  label,
  icon,
  checked,
  onChange,
  testId,
}: {
  label: string
  icon: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  testId?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={`${CARD_BASE} w-full justify-start gap-2 px-3 py-2 pr-7 text-left ${checked ? CARD_SELECTED : CARD_IDLE}`}
    >
      {checked ? <CheckBadge /> : null}
      <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0">{label}</span>
    </button>
  )
}

/** Protection symbol artwork drawn from an SVG file in the current text colour. */
export function MaskedSymbol({ src, className = 'h-8 w-8' }: { src: string; className?: string }) {
  const mask = `url(${src}) center / contain no-repeat`
  return (
    <span
      className={`inline-block bg-current ${className}`}
      style={{ mask, WebkitMask: mask }}
    />
  )
}
