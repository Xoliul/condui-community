import { useTranslation } from 'react-i18next'
import {
  getProjectDocumentsStorageBytes,
  PROJECT_DOCUMENTS_STORAGE_LIMIT_BYTES,
  type ProjectDocument,
} from '@/lib/documents/projectDocuments'
import { formatBytes } from '@/utils/formatBytes'

/**
 * Uploaded-document storage against the project budget. Hovering it reveals each document's
 * size on its card.
 */
export function DocumentsStorageTally({
  documents,
  onHoverChange,
}: {
  documents: readonly ProjectDocument[]
  onHoverChange: (hovered: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const used = getProjectDocumentsStorageBytes(documents)
  const ratio = Math.min(1, used / PROJECT_DOCUMENTS_STORAGE_LIMIT_BYTES)
  const barClassName = ratio >= 1 ? 'bg-red-500' : ratio >= 0.9 ? 'bg-amber-500' : 'bg-sky-500'

  return (
    <div
      className="max-w-md space-y-1.5 rounded-md px-2 py-1.5 transition-colors hover:bg-sky-50 dark:hover:bg-sky-950/40"
      data-testid="project-documents-storage"
      onPointerEnter={() => onHoverChange(true)}
      onPointerLeave={() => onHoverChange(false)}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
          {t('projectDocuments.storageLabel')}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400">
          {t('projectDocuments.storageUsage', {
            used: formatBytes(used, i18n.language),
            limit: formatBytes(PROJECT_DOCUMENTS_STORAGE_LIMIT_BYTES, i18n.language),
          })}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
        role="meter"
        aria-label={t('projectDocuments.storageLabel')}
        aria-valuemin={0}
        aria-valuemax={PROJECT_DOCUMENTS_STORAGE_LIMIT_BYTES}
        aria-valuenow={used}
      >
        <div
          className={`h-full min-w-[2px] rounded-full ${barClassName}`}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  )
}
