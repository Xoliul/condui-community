import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { getFloorPlanDocumentDisplay } from '@/lib/documents/floorPlanDocumentDisplay'
import { setFloorPlanDocumentDisplay } from '@/stores/projectDocumentsStore'
import { useProjectStore } from '@/stores/projectStore'

const optionClassName = (selected: boolean) =>
  `rounded-md border px-2 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
    selected
      ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
      : 'border-gray-300 bg-white text-gray-700 hover:border-sky-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200'
  }`

/**
 * How a floor plan placed on the situation plan is drawn: adapted to dark mode, and for PDF,
 * DXF and DWG plans in colour or greyscale. Scale stays with the situation plan's scale tool.
 */
export function FloorPlanDisplaySection({ documentId }: { documentId: string }) {
  const { t } = useTranslation()
  const assets = useProjectStore((s) => s.currentProject?.assets)
  const display = useMemo(
    () => (assets ? getFloorPlanDocumentDisplay(assets, documentId) : null),
    [assets, documentId]
  )
  if (!display) return null

  return (
    <div className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-700">
      <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
        {t('projectDocuments.planDisplay.title', 'Plan display')}
      </h4>
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          data-testid="floor-plan-dark-mode"
          checked={display.darkModeAware}
          onChange={(event) =>
            setFloorPlanDocumentDisplay(documentId, { darkModeAware: event.target.checked })
          }
          className="rounded border-gray-400"
        />
        {t('projectDocuments.planDisplay.darkMode', 'Adapt to dark mode')}
      </label>
      {display.vector && (
        <div className="grid grid-cols-2 gap-1" role="radiogroup">
          <button
            type="button"
            role="radio"
            aria-checked={!display.grayscale}
            data-testid="floor-plan-colour"
            disabled={!display.hasColour}
            title={
              display.hasColour
                ? undefined
                : t(
                    'projectDocuments.planDisplay.noColour',
                    'Imported in greyscale; import again to get the colours back'
                  )
            }
            onClick={() => setFloorPlanDocumentDisplay(documentId, { grayscale: false })}
            className={optionClassName(!display.grayscale && display.hasColour)}
          >
            {t('projectDocuments.planDisplay.colour', 'Colour')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={display.grayscale || !display.hasColour}
            data-testid="floor-plan-greyscale"
            onClick={() => setFloorPlanDocumentDisplay(documentId, { grayscale: true })}
            className={optionClassName(display.grayscale || !display.hasColour)}
          >
            {t('projectDocuments.planDisplay.greyscale', 'Greyscale')}
          </button>
        </div>
      )}
    </div>
  )
}
