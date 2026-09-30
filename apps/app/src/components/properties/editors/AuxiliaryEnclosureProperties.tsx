import { useTranslation } from 'react-i18next'
import { isAuxiliaryEnclosureShownOnPlan } from '@/lib/plan/auxiliaryEnclosurePlanPlacement'
import { useProjectStore } from '@/stores/projectStore'
import { DebouncedTextInput } from '@/components/forms'
import { MIN_AUXILIARY_COLUMNS } from '@/lib/panel/auxiliarySupplyEnclosures'
import type { AuxiliaryElectricalEnclosure } from '@/types/supplyAssembly'
import { PanelGridDimensionInput } from '../shared/PanelGridDimensionInput'

const inputClass =
  'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white'

export function AuxiliaryEnclosureProperties({
  enclosure,
  onUpdate,
}: {
  enclosure: AuxiliaryElectricalEnclosure
  onUpdate: (id: string, updates: Partial<AuxiliaryElectricalEnclosure>) => void
}) {
  const { t } = useTranslation()
  const shownOnPlan = useProjectStore((state) =>
    state.currentProject ? isAuxiliaryEnclosureShownOnPlan(state.currentProject, enclosure) : false
  )
  const setShownOnPlan = useProjectStore((state) => state.setAuxiliaryEnclosureShownOnPlan)
  const updateGrid = (updates: Partial<AuxiliaryElectricalEnclosure['gridView']>) =>
    onUpdate(enclosure.id, {
      gridView: { ...enclosure.gridView, ...updates },
    })

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('common.name', 'Name')}
        </label>
        <DebouncedTextInput
          value={enclosure.name}
          resetKey={enclosure.id}
          onCommit={(name) => onUpdate(enclosure.id, { name })}
          className={inputClass}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          data-testid="auxiliary-enclosure-show-on-plan"
          checked={shownOnPlan}
          onChange={(event) => setShownOnPlan(enclosure.id, event.target.checked)}
          className="rounded border-gray-400"
        />
        {t('panelCanvas.showOnPlan', 'Show on plan')}
      </label>

      <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-3">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
          {t('panelCanvas.panelLayout', 'Panel layout')}
        </h4>
        <button
          type="button"
          aria-pressed={enclosure.gridView.terminalStripTopRail ?? false}
          onClick={() =>
            updateGrid({
              terminalStripTopRail: !(enclosure.gridView.terminalStripTopRail ?? false),
            })
          }
          className={`flex w-full items-center justify-center gap-3 rounded-md border-2 px-3 py-2 text-xs font-medium transition-colors ${
            enclosure.gridView.terminalStripTopRail
              ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300'
              : 'border-gray-300 bg-white text-gray-700 hover:border-sky-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
          }`}
        >
          <img
            src="/symbols/junction/terminal_strip.svg"
            alt=""
            aria-hidden="true"
            className="h-8 w-8 opacity-90 dark:invert"
          />
          <span>{t('panelCanvas.topTerminalStripRail', 'Top clamp rail')}</span>
        </button>
        <PanelGridDimensionInput
          label={t('panelCanvas.rows', 'Rows')}
          value={enclosure.gridView.rows}
          min={1}
          max={32}
          onChange={(rows) => updateGrid({ rows })}
        />
        <PanelGridDimensionInput
          label={t('panelCanvas.columns', 'Columns')}
          value={Math.max(MIN_AUXILIARY_COLUMNS, enclosure.gridView.columns)}
          min={MIN_AUXILIARY_COLUMNS}
          max={48}
          onChange={(columns) => updateGrid({ columns })}
        />
        <button
          type="button"
          aria-pressed={enclosure.gridView.terminalStripBottomRail ?? false}
          onClick={() =>
            updateGrid({
              terminalStripBottomRail: !(enclosure.gridView.terminalStripBottomRail ?? false),
            })
          }
          className={`flex w-full items-center justify-center gap-3 rounded-md border-2 px-3 py-2 text-xs font-medium transition-colors ${
            enclosure.gridView.terminalStripBottomRail
              ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300'
              : 'border-gray-300 bg-white text-gray-700 hover:border-sky-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
          }`}
        >
          <img
            src="/symbols/junction/terminal_strip.svg"
            alt=""
            aria-hidden="true"
            className="h-8 w-8 opacity-90 dark:invert"
          />
          <span>{t('panelCanvas.bottomTerminalStripRail', 'Bottom clamp rail')}</span>
        </button>
      </div>
    </div>
  )
}
