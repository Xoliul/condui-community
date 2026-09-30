import { useTranslation } from 'react-i18next'
import { CABLE_CATEGORY_COLORS } from '@/lib/cableRouting/cableRoutePlanWires'
import type { CableRouteCategory } from '@/lib/cableRouting/estimateCableRoutes'
import { PLAN_WIRE_SELECTED_STROKE } from '@/lib/plan/planWiring'

const ORDER: CableRouteCategory[] = [
  'lighting',
  'sockets',
  'devices',
  'feeders',
  'supply',
  'dc',
  'earthing',
  'other',
]

function Swatch({ color }: { color: string }) {
  return (
    <svg width="18" height="6" aria-hidden className="shrink-0">
      <line x1="1" y1="3" x2="17" y2="3" stroke={color} strokeWidth="2" strokeDasharray="4 3" />
    </svg>
  )
}

/** Colour key for wire mode, where every cable is shown by circuit group. */
export function PlanWireLegend() {
  const { t } = useTranslation()
  const labels: Record<CableRouteCategory, string> = {
    lighting: t('wireLegend.lighting', 'Lighting'),
    sockets: t('wireLegend.sockets', 'Sockets'),
    devices: t('wireLegend.devices', 'Fixed devices'),
    feeders: t('wireLegend.feeders', 'Between boards'),
    supply: t('wireLegend.supply', 'Supply'),
    dc: t('wireLegend.dc', 'DC'),
    earthing: t('wireLegend.earthing', 'Earthing'),
    other: t('wireLegend.other', 'Other'),
  }
  return (
    <div
      className="pointer-events-none absolute bottom-20 right-4 z-10 rounded-md border border-gray-200 bg-white/90 px-2.5 py-1.5 text-xs text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-800/90 dark:text-gray-200"
      data-testid="plan-wire-legend"
    >
      {ORDER.map((category) => (
        <div key={category} className="flex items-center gap-2 py-0.5">
          <Swatch color={CABLE_CATEGORY_COLORS[category]} />
          {labels[category]}
        </div>
      ))}
      <div className="flex items-center gap-2 py-0.5">
        <Swatch color={PLAN_WIRE_SELECTED_STROKE} />
        {t('wireLegend.selected', 'Selected')}
      </div>
    </div>
  )
}
