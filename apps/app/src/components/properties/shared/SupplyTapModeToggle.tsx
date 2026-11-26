import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { editProperties } from '@/handlers/properties/editProperties'
import { getSupplyTapToggleState } from '@/lib/supplyTaps/convertSupplyTap'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'

type Mode = 'inline' | 'tap'

const optionClass = (selected: boolean, readOnly: boolean) =>
  `min-w-0 flex-1 rounded-md border-2 px-2 py-1.5 text-center text-xs font-medium leading-tight transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
    selected
      ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300'
      : 'border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300'
  } ${readOnly ? 'cursor-not-allowed opacity-50' : selected ? '' : 'hover:border-sky-300'}`

/**
 * Switch for a grid-side supply protection or meter, or a bare supply tap: in the supply wire
 * (in line) or branching off it (tap). Hidden for everything that cannot switch.
 */
export function SupplyTapModeToggle({
  entityId,
  readOnly = false,
}: {
  entityId: string
  readOnly?: boolean
}) {
  const { t } = useTranslation()
  const project = useProjectStore((state: ProjectState) => state.currentProject)
  const state = useMemo(
    () => (project ? getSupplyTapToggleState(project, entityId) : null),
    [project, entityId]
  )
  if (!state) return null
  const choose = (mode: Mode) => {
    if (readOnly || mode === state.mode) return
    editProperties({ actions: [{ kind: 'supplyTapMode', entityId, mode }] })
  }
  return (
    <div
      role="radiogroup"
      aria-label={t('panels.supplyTapMode', 'Placement')}
      className="mb-3 flex gap-2"
      data-testid="supply-tap-mode"
    >
      {(['inline', 'tap'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={state.mode === mode}
          aria-disabled={readOnly || undefined}
          data-testid={`supply-tap-mode-${mode}`}
          className={optionClass(state.mode === mode, readOnly)}
          onClick={() => choose(mode)}
        >
          {mode === 'inline'
            ? t('panels.supplyTapInline', 'In line')
            : t('panels.supplyTapBranch', 'Tap')}
        </button>
      ))}
    </div>
  )
}
