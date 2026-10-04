import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { getEndpointMounting } from '@/lib/plan/panelPlanPlacementVisibility'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { labelClass } from '../shared/propertiesSharedUtils'

/**
 * Board or field for an endpoint that can sit either in a distribution board or in the
 * building (domotica modules, relays, meters, converters). One choice moves it between the
 * panel view and the plan, and cable routing follows.
 */
export function EndpointMountingField({ endpointId }: { endpointId: string }) {
  const { t } = useTranslation()
  const project = useProjectStore((state: ProjectState) => state.currentProject)
  const hideModuleFromPanel = useProjectStore((state: ProjectState) => state.hideModuleFromPanel)
  const unhideModuleFromPanel = useProjectStore((state: ProjectState) => state.unhideModuleFromPanel)
  const mounting = useMemo(
    () => (project ? getEndpointMounting(project, endpointId) : undefined),
    [project, endpointId]
  )
  if (!mounting) return null

  const options = [
    { value: 'panel' as const, label: t('endpoints.mounting.panel', 'Board'), title: mounting.panelName },
    { value: 'field' as const, label: t('endpoints.mounting.field', 'Field') },
  ]

  return (
    <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
      <label className={labelClass}>{t('endpoints.mounting.label', 'Location')}</label>
      <div className="grid grid-cols-2 gap-1 rounded-md bg-gray-100 p-1 dark:bg-gray-800" role="radiogroup">
        {options.map((option) => {
          const active = mounting.location === option.value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              title={option.title}
              onClick={() => {
                if (active) return
                if (option.value === 'panel') unhideModuleFromPanel(mounting.panelId, mounting.moduleRefKey)
                else hideModuleFromPanel(mounting.panelId, mounting.moduleRefKey)
              }}
              className={`truncate rounded px-2 py-1 text-sm ${
                active
                  ? 'bg-white font-medium text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'
              }`}
            >
              {option.value === 'panel' && active ? mounting.panelName : option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
