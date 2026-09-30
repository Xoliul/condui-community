import { useTranslation } from 'react-i18next'
import { ExportPdfIcon } from '@/components/icons/UiIcons'
import type { ProjectDocument } from '@/lib/documents/projectDocuments'
import { updateProjectDocument } from '@/stores/projectDocumentsStore'

/**
 * Toggles whether a document goes along with the PDF export. A page selection made in the
 * viewer is kept while the document is switched off, and shown as a partial (dashed) state;
 * the full-size toggle also shows the number of selected pages.
 */
export function ExportToggle({
  document,
  compact = false,
  className = '',
}: {
  document: ProjectDocument
  compact?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const active = document.includeInExport
  const partialPages = active && document.exportPages ? document.exportPages.length : null
  const label = t('projectDocuments.includeInExport')
  const stateClassName = active
    ? `${partialPages === null ? 'border-solid' : 'border-dashed'} border-sky-500 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:ring-2 hover:ring-sky-300 dark:border-sky-400 dark:bg-sky-900/40 dark:text-sky-300 dark:hover:bg-sky-900/70`
    : 'border-gray-300 bg-white text-gray-400 group-hover:border-gray-400 group-hover:text-gray-500 hover:!border-sky-500 hover:!text-sky-600 hover:bg-sky-50 hover:ring-2 hover:ring-sky-200 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'

  return (
    <button
      type="button"
      data-testid="project-document-export-toggle"
      aria-pressed={partialPages === null ? active : 'mixed'}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation()
        updateProjectDocument(document.id, { includeInExport: !active })
      }}
      className={`inline-flex items-center gap-1 rounded-md border shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
        compact ? 'p-1' : 'gap-2 px-3 py-1.5 text-sm font-medium'
      } ${stateClassName} ${className}`}
    >
      <ExportPdfIcon className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
      {compact ? null : label}
      {partialPages !== null && !compact ? (
        <span className="text-xs font-semibold tabular-nums">{partialPages}</span>
      ) : null}
    </button>
  )
}
