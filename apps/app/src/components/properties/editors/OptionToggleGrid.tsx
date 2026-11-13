import { labelClass } from '../shared/propertiesSharedUtils'

export type OptionToggleGridOption<T extends string> = {
  value: T
  /** Full, human-readable label; used for the tooltip. */
  label: string
  /** Compact label shown under the icon so neighbours never overlap. Defaults to `label`. */
  shortLabel?: string
  /** Public SVG url (e.g. an overlay symbol) shown as the button's primary glyph. */
  icon?: string
  /** Optional base symbol drawn behind `icon` (e.g. the furnace body under an HVAC overlay). */
  baseIcon?: string
  /** Text glyph used when there is no SVG (e.g. HVAC function +/-). */
  glyph?: string
}

export type OptionToggleGridProps<T extends string> = {
  label: string
  value: T
  options: Array<OptionToggleGridOption<T>>
  onChange: (value: T) => void
  columns?: number
}

export function OptionToggleGrid<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = 3,
}: OptionToggleGridProps<T>) {
  const gridColsClass =
    columns === 2
      ? 'grid-cols-2'
      : columns === 4
        ? 'grid-cols-4'
        : 'grid-cols-3'
  // Only reserve icon space when at least one option carries a symbol/glyph.
  const showIcons = options.some((opt) => opt.icon || opt.glyph)

  return (
    <div>
      <label className={labelClass}>{label}</label>
      <div className={`grid ${gridColsClass} gap-2 mt-1`}>
        {options.map((opt) => {
          const isActive = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              title={opt.label}
              onClick={() => {
                if (!isActive) onChange(opt.value)
              }}
              className={`flex flex-col items-center justify-center gap-0.5 px-1.5 py-2 rounded-md border-2 text-xs font-medium transition-colors ${
                isActive
                  ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300'
                  : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:border-sky-300'
              }`}
            >
              {showIcons && (
                <span className="relative flex h-9 w-9 items-center justify-center">
                  {opt.icon ? (
                    <>
                      {opt.baseIcon && (
                        <img
                          src={opt.baseIcon}
                          alt=""
                          aria-hidden="true"
                          className="absolute inset-0 h-9 w-9 opacity-90 dark:invert"
                        />
                      )}
                      <img
                        src={opt.icon}
                        alt=""
                        aria-hidden="true"
                        className="relative h-9 w-9 opacity-90 dark:invert"
                      />
                    </>
                  ) : opt.glyph ? (
                    <span className="text-lg font-semibold leading-none">{opt.glyph}</span>
                  ) : (
                    <span className="text-lg leading-none text-gray-300 dark:text-gray-600">–</span>
                  )}
                </span>
              )}
              <span className="w-full truncate text-center text-[11px] leading-tight">
                {opt.shortLabel ?? opt.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
