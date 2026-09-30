import { useTranslation } from 'react-i18next'
import type { PlanWireRouteStyle } from '@/types/schema'

const STYLES: PlanWireRouteStyle[] = ['spline', 'orthogonal', 'straight']

/** How plan wires are drawn: curved, at right angles, or straight between points. */
export function PlanWireStyleButtons({
  value,
  disabled = false,
  onChange,
}: {
  value: PlanWireRouteStyle
  disabled?: boolean
  onChange: (style: PlanWireRouteStyle) => void
}) {
  const { t } = useTranslation()
  const labels: Record<PlanWireRouteStyle, string> = {
    spline: t('sitplanVisibility.wireStyleSpline'),
    orthogonal: t('sitplanVisibility.wireStyleOrthogonal'),
    straight: t('sitplanVisibility.wireStyleStraight', 'Straight'),
  }
  return (
    <div className="grid grid-cols-3 gap-1">
      {STYLES.map((style) => {
        const selected = value === style
        return (
          <button
            key={style}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            data-testid={`plan-wire-style-${style}`}
            onClick={() => onChange(style)}
            className={`rounded border px-2 py-1 text-xs font-medium ${
              selected
                ? 'border-sky-500 bg-sky-100 text-sky-900 dark:bg-sky-900/60 dark:text-sky-50'
                : 'border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {labels[style]}
          </button>
        )
      })}
    </div>
  )
}
