import { useId } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useTouchPrimaryDevice } from '@/hooks/useTouchPrimaryDevice'

export function PanelGridDimensionInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  const id = useId()
  const touchPrimary = useTouchPrimaryDevice()
  const clamp = (next: number) => Math.max(min, Math.min(max, next))
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
        value={value}
        onChange={(event) => onChange(clamp(Number(event.target.value) || min))}
        className="w-20 min-w-0 rounded-md border border-gray-300 bg-white px-2 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
      />
      {touchPrimary && (
        <>
          <button
            type="button"
            className={buttonClass}
            aria-label={`${label} −1`}
            disabled={value <= min}
            onClick={() => onChange(clamp(value - 1))}
          >
            <span aria-hidden="true">−</span>
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={buttonClass}
            aria-label={`${label} +1`}
            disabled={value >= max}
            onClick={() => onChange(clamp(value + 1))}
          >
            <span aria-hidden="true">+</span>
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  )
}
