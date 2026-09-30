import { useTranslation } from 'react-i18next'
import { ExportToggle } from '@/components/documents/ExportToggle'
import { PlanWireStyleButtons } from '@/components/cableRouting/PlanWireStyleButtons'
import { DEFAULT_CABLE_ROUTE_SETTINGS } from '@/lib/cableRouting/estimateCableRoutes'
import { cableScheduleDocument } from '@/lib/documents/projectDocuments'
import { resolvePlanWiringVisibility } from '@/lib/plan/planWiring'
import { selectProjectPlanWiringVisibility } from '@/lib/projectV2/planWiring'
import { useProjectStore } from '@/stores/projectStore'
import type { PlanCableRouteSettings } from '@/types/schema'

const HEIGHTS = ['floorHeightM', 'socketHeightM', 'switchHeightM', 'panelHeightM'] as const

const sectionTitleClassName = 'text-sm font-semibold text-gray-900 dark:text-white'
const inputClassName =
  'w-24 rounded-md border border-gray-300 bg-white px-2 py-1 text-right text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white'

/**
 * Properties of the cable schedule: whether it goes along with the PDF, how plan wires are drawn,
 * and the mounting heights its length estimates assume.
 */
export function CableScheduleProperties({ readOnly = false }: { readOnly?: boolean }) {
  const { t } = useTranslation()
  const assets = useProjectStore((s) => s.currentProject?.assets)
  const stored = useProjectStore((s) =>
    s.currentProject ? selectProjectPlanWiringVisibility(s.currentProject) : undefined
  )
  const updateVisibility = useProjectStore((s) => s.updatePlanWiringVisibility)
  const visibility = resolvePlanWiringVisibility({ version: 1, routes: [], visibility: stored })
  const settings: PlanCableRouteSettings = visibility.cableRouteSettings ?? {}
  const document = cableScheduleDocument(t('cableSchedule.title', 'Cable schedule'), assets)
  const heightLabels: Record<(typeof HEIGHTS)[number], string> = {
    floorHeightM: t('cableSchedule.settings.floorHeight', 'Floor height'),
    socketHeightM: t('cableSchedule.settings.socketHeight', 'Sockets'),
    switchHeightM: t('cableSchedule.settings.switchHeight', 'Switches'),
    panelHeightM: t('cableSchedule.settings.panelHeight', 'Boards'),
  }
  const setHeight = (key: (typeof HEIGHTS)[number], value: string) => {
    const metres = Number(value.replace(',', '.'))
    const next = { ...settings }
    if (value.trim() === '') delete next[key]
    else if (Number.isFinite(metres) && metres > 0) next[key] = metres
    else return
    updateVisibility({ cableRouteSettings: next })
  }

  return (
    <div className="space-y-5" data-testid="cable-schedule-properties">
      <ExportToggle document={document} className="w-full justify-center" />

      <div className="space-y-2 border-t border-gray-200 pt-4 dark:border-gray-700">
        <h4 className={sectionTitleClassName}>{t('sitplanVisibility.wireStyle')}</h4>
        <PlanWireStyleButtons
          value={visibility.defaultStyle}
          disabled={readOnly}
          onChange={(style) => updateVisibility({ defaultStyle: style })}
        />
        <label className="flex items-center gap-2 pt-1 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={visibility.colorCoded === true}
            disabled={readOnly}
            onChange={(event) => updateVisibility({ colorCoded: event.target.checked })}
            className="rounded border-gray-400"
          />
          {t('sitplanVisibility.wiresColorCoded', 'Colour by group')}
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={visibility.supplyVisible !== false}
            disabled={readOnly}
            onChange={(event) => updateVisibility({ supplyVisible: event.target.checked })}
            className="rounded border-gray-400"
          />
          {t('sitplanVisibility.wiresSupply', 'Supply and earthing')}
        </label>
      </div>

      <div className="space-y-2 border-t border-gray-200 pt-4 dark:border-gray-700">
        <h4 className={sectionTitleClassName}>
          {t('cableSchedule.settings.heights', 'Heights (m)')}
        </h4>
        {HEIGHTS.map((key) => (
          <label
            key={key}
            className="flex items-center justify-between gap-3 text-sm text-gray-700 dark:text-gray-300"
          >
            {heightLabels[key]}
            <input
              // Remount when the stored value changes elsewhere (undo, another panel).
              key={`${key}:${settings[key] ?? ''}`}
              type="text"
              inputMode="decimal"
              data-testid={`cable-route-${key}`}
              defaultValue={settings[key] ?? ''}
              placeholder={String(DEFAULT_CABLE_ROUTE_SETTINGS[key])}
              disabled={readOnly}
              onBlur={(event) => setHeight(key, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
              className={inputClassName}
            />
          </label>
        ))}
      </div>
    </div>
  )
}
