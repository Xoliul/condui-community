import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getProjectDocumentSizeBytes, type ProjectDocument } from '@/lib/documents/projectDocuments'
import { formatBytes } from '@/utils/formatBytes'

export type ReduceLevel = 'balanced' | 'small'

/** The reduce-size dialog body: current size, quality choice, and the PDF caveat. */
export function ReduceSizeForm({
  document,
  onLevelChange,
}: {
  document: ProjectDocument
  onLevelChange: (level: ReduceLevel) => void
}) {
  const { t, i18n } = useTranslation()
  const [level, setLevel] = useState<ReduceLevel>('balanced')
  return (
    <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
      <p>
        {t('projectDocuments.reduceSizeCurrent', {
          size: formatBytes(getProjectDocumentSizeBytes(document), i18n.language),
        })}
      </p>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          {t('projectDocuments.reduceSizeQuality')}
        </span>
        <select
          value={level}
          onChange={(event) => {
            const next = event.target.value as ReduceLevel
            setLevel(next)
            onLevelChange(next)
          }}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          <option value="balanced">{t('projectDocuments.reduceSizeBalanced')}</option>
          <option value="small">{t('projectDocuments.reduceSizeSmallest')}</option>
        </select>
      </label>
      {document.kind === 'pdf' && <p>{t('projectDocuments.reduceSizePdfHint')}</p>}
    </div>
  )
}
