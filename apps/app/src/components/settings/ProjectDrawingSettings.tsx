import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/stores/projectStore'
import { useEditionFeatureAvailability } from '@/hooks/useEditionFeatureAvailability'
import { DebouncedTextInput } from '@/components/forms'
import {
  editProperties,
  beginPropertiesFieldEdit,
  endPropertiesFieldEdit,
} from '@/handlers/properties/editProperties'
import type { GeneralProjectPropertyPatch } from '@/lib/properties/generalPropertyFamilies'

export function ProjectDrawingSettings({ canEditProject }: { canEditProject: boolean }) {
  const { t } = useTranslation()
  const project = useProjectStore((state) => state.currentProject)
  const { installerBranding } = useEditionFeatureAvailability(project?.project.id)
  if (!project || !installerBranding) return null

  const update = (set: GeneralProjectPropertyPatch) => {
    if (!canEditProject || !installerBranding) return
    editProperties({ edits: [{ kind: 'project', ids: [project.project.id], set }] })
  }

  return (
    <section data-testid="project-drawing-settings">
      <h3 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-200">
        {t('infoBlock.drawingSettings')}
      </h3>
      <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="rounded"
            checked={project.project.showConduiBranding !== false}
            disabled={!canEditProject}
            onChange={(event) => update({ showConduiBranding: event.target.checked ? null : false })}
          />
          {t('infoBlock.showConduiBranding')}
        </label>
        <label className="block">
          <span className="mb-1 block">{t('infoBlock.installerHeading')}</span>
          <DebouncedTextInput
            value={project.project.installerHeading ?? ''}
            resetKey={project.project.id}
            maxLength={80}
            disabled={!canEditProject}
            placeholder={t('infoBlock.headerInstaller')}
            onFocus={(event) => beginPropertiesFieldEdit(event.currentTarget)}
            onBlur={endPropertiesFieldEdit}
            onCommit={(value) => update({ installerHeading: value.trim() || null })}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
        </label>
      </div>
    </section>
  )
}
