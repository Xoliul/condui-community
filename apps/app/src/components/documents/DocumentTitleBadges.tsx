import { useTranslation } from 'react-i18next'
import { Eye, Library } from 'lucide-react'
import { useProjectDocuments } from './useProjectDocuments'

/** Small status icons next to the "Document" properties title, explained on hover. */
export default function DocumentTitleBadges({ documentId }: { documentId: string }) {
  const { t } = useTranslation()
  const document = useProjectDocuments().find((candidate) => candidate.id === documentId)
  if (!document || (!document.visibleToViewers && !document.teamDocumentId)) return null
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-sky-600 dark:text-sky-400">
      {document.visibleToViewers && (
        <span
          className="inline-flex rounded p-0.5"
          title={t('projectDocuments.visibleToViewersHint')}
          aria-label={t('projectDocuments.visibleToViewersHint')}
          data-testid="document-visible-to-viewers"
        >
          <Eye className="h-4 w-4" aria-hidden />
        </span>
      )}
      {document.teamDocumentId && (
        <span
          className="inline-flex rounded p-0.5 text-gray-400"
          title={t('projectDocuments.teamLibrary.fromLibraryNote')}
          aria-label={t('projectDocuments.teamLibrary.fromLibraryNote')}
          data-testid="document-from-team-library"
        >
          <Library className="h-4 w-4" aria-hidden />
        </span>
      )}
    </span>
  )
}
