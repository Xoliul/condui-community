import { useTranslation } from 'react-i18next'
import { FileText, X } from 'lucide-react'
import CustomDropdown from '@/components/common/CustomDropdown'
import {
  getDocumentLinkableDevices,
  getIdenticalLinkableDevices,
} from '@/lib/documents/documentLinkTargets'
import {
  addProjectDocumentLinks,
  isProjectDocumentLinkedTo,
  resolveDocumentLinkTarget,
  getCategoryAfterLinking,
  toggleProjectDocumentLink,
  type DocumentLinkLookup,
  type ProjectDocumentLink,
} from '@/lib/documents/projectDocuments'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { updateProjectDocument } from '@/stores/projectDocumentsStore'
import { revealProjectDocument } from './revealProjectDocument'
import { useProjectDocuments } from './useProjectDocuments'

function linkLookup(state: ProjectState): DocumentLinkLookup {
  return {
    getPlacement: state.getPlacementById,
    getEndpoint: state.getEndpointById,
    getTrunkDevice: (id) => state.getTrunkDeviceById(id)?.device,
  }
}

/** Documents attached to the selected device, shown at the end of its properties. */
export default function LinkedDocumentsSection({
  selectionType,
  selectedId,
  elementLabel,
}: {
  selectionType: string | null | undefined
  selectedId: string
  elementLabel: string
}) {
  const { t } = useTranslation()
  const documents = useProjectDocuments()
  const targetType = useProjectStore(
    (s) => resolveDocumentLinkTarget(selectionType, selectedId, linkLookup(s))?.type ?? null
  )
  const targetId = useProjectStore(
    (s) => resolveDocumentLinkTarget(selectionType, selectedId, linkLookup(s))?.id ?? null
  )

  if (!targetType || !targetId) return null
  if (documents.length === 0) return null
  const link = { type: targetType, id: targetId }
  const linked = documents.filter((document) => isProjectDocumentLinkedTo(document, link))
  const attachable = documents.filter((document) => !isProjectDocumentLinkedTo(document, link))
  /** Units of the same make and model, so one datasheet attaches to all of them. */
  const attachToIdentical = (documentId: string, target: ProjectDocumentLink) => {
    const document = documents.find((candidate) => candidate.id === documentId)
    if (!document) return
    const project = useProjectStore.getState().currentProject
    const identical = project
      ? getIdenticalLinkableDevices(getDocumentLinkableDevices(project), target)
      : []
    const links = addProjectDocumentLinks(document, [
      target,
      ...identical
        .filter((device) => device.link.type !== target.type || device.link.id !== target.id)
        .map((device) => ({
          ...device.link,
          label: device.label ?? t(`symbols.${device.symbol}`, { defaultValue: device.symbol }),
        })),
    ])
    updateProjectDocument(documentId, { links, category: getCategoryAfterLinking(document, links) })
  }
  const toggleLink = (documentId: string, target: ProjectDocumentLink) => {
    const document = documents.find((candidate) => candidate.id === documentId)
    if (document) {
      const links = toggleProjectDocumentLink(document, target)
      updateProjectDocument(documentId, {
        links,
        category: getCategoryAfterLinking(document, links),
      })
    }
  }

  return (
    <div
      className="mt-4 space-y-2 border-t border-gray-200 pt-4 dark:border-gray-700"
      data-testid="linked-documents-section"
    >
      <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
        {t('projectDocuments.section')}
      </h4>
      {linked.length > 0 && (
        <ul className="space-y-1">
          {linked.map((document) => (
            <li key={document.id} className="flex items-center gap-1">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-900/30"
                onClick={() => revealProjectDocument(document.id)}
                title={t('projectDocuments.open')}
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate">{document.name}</span>
              </button>
              <button
                type="button"
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                aria-label={t('projectDocuments.unlink')}
                title={t('projectDocuments.unlink')}
                onClick={() => toggleLink(document.id, link)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {attachable.length > 0 && (
        <CustomDropdown
          value=""
          placeholder={t('projectDocuments.attach')}
          ariaLabel={t('projectDocuments.attach')}
          options={attachable.map((document) => ({ value: document.id, label: document.name }))}
          onChange={(documentId) =>
            attachToIdentical(documentId, { ...link, label: elementLabel || undefined })
          }
        />
      )}
    </div>
  )
}
