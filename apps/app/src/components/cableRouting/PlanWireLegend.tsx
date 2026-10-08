import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff } from 'lucide-react'
import { CABLE_CATEGORY_COLORS } from '@/lib/cableRouting/cableRoutePlanWires'
import { PLAN_WIRE_SELECTED_STROKE, resolvePlanWiringVisibility } from '@/lib/plan/planWiring'
import { PLAN_WIRE_CATEGORIES } from '@/lib/cableRouting/planWireCategoryVisibility'
import { selectProjectPlanWiringVisibility } from '@/lib/projectV2/planWiring'
import { useProjectStore } from '@/stores/projectStore'
import { preventCanvasToolbarMouseFocus } from '@/lib/ui/preventCanvasToolbarMouseFocus'

function Swatch({ color }: { color: string }) {
  return (
    <svg width="18" height="6" aria-hidden className="shrink-0">
      <line x1="1" y1="3" x2="17" y2="3" stroke={color} strokeWidth="2" strokeDasharray="4 3" />
    </svg>
  )
}

/** Colour key for wire mode, where every cable is shown by circuit group. */
export function PlanWireLegend({ readOnly = false }: { readOnly?: boolean }) {
  const { t } = useTranslation()
  const storedVisibility = useProjectStore((s) =>
    s.currentProject ? selectProjectPlanWiringVisibility(s.currentProject) : undefined
  )
  const visibility = useMemo(
    () => resolvePlanWiringVisibility({ version: 1, routes: [], visibility: storedVisibility }),
    [storedVisibility]
  )
  const updateVisibility = useProjectStore((s) => s.updatePlanWiringVisibility)
  const buttonClass =
    'flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 disabled:cursor-default disabled:opacity-50 dark:hover:bg-gray-700'
  const wiresVisible = visibility.wireToolWiresVisible !== false
  const MasterIcon = wiresVisible ? Eye : EyeOff
  return (
    <div
      className="absolute bottom-20 right-4 z-10 max-h-[calc(100%-6rem)] overflow-y-auto rounded-md border border-gray-200 bg-white/90 px-2.5 py-1.5 text-xs text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-800/90 dark:text-gray-200"
      data-testid="plan-wire-legend"
      data-app-scroll="true"
      onPointerDown={(event) => {
        preventCanvasToolbarMouseFocus(event)
        event.stopPropagation()
      }}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="mb-1 flex justify-end border-b border-gray-200 pb-1 dark:border-gray-700">
        <button
          type="button"
          className={buttonClass}
          aria-label={t('sitplanVisibility.wires')}
          title={t('sitplanVisibility.wires')}
          aria-pressed={wiresVisible}
          disabled={readOnly}
          onClick={() => updateVisibility({ wireToolWiresVisible: !wiresVisible })}
          data-testid="plan-wire-legend-master"
        >
          <MasterIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {PLAN_WIRE_CATEGORIES.map((category) => {
        const visible = visibility.wireToolCategoriesVisible?.[category] !== false
        const Icon = wiresVisible && visible ? Eye : EyeOff
        const label = t(`wireLegend.${category}`)
        return (
          <div key={category} className="flex items-center gap-2">
            <span
              className={`flex flex-1 items-center gap-2 ${wiresVisible && visible ? '' : 'opacity-50'}`}
            >
              <Swatch color={CABLE_CATEGORY_COLORS[category]} />
              {label}
            </span>
            <button
              type="button"
              className={buttonClass}
              aria-label={label}
              title={label}
              aria-pressed={visible}
              disabled={readOnly || !wiresVisible}
              onClick={() =>
                updateVisibility({
                  wireToolCategoriesVisible: {
                    ...visibility.wireToolCategoriesVisible,
                    [category]: !visible,
                  },
                })
              }
              data-testid={`plan-wire-legend-${category}`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )
      })}
      <div className="flex items-center gap-2 py-0.5">
        <Swatch color={PLAN_WIRE_SELECTED_STROKE} />
        {t('wireLegend.selected', 'Selected')}
      </div>
    </div>
  )
}
