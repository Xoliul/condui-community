import { useMemo } from 'react'
import { JunctionDocumentProperties } from '@/components/junctionEditor/junctionEditorHostedFeatures'
import { useTranslation } from 'react-i18next'
import { CloudUpload, FileUp, Loader2, Minimize2, Paperclip, Trash2, X } from 'lucide-react'
import CustomDropdown from '@/components/common/CustomDropdown'
import {
  getDocumentLinkableDevices,
  type DocumentLinkableDevice,
} from '@/lib/documents/documentLinkTargets'
import {
  CABLE_SCHEDULE_DOCUMENT_ID,
  CONTROL_ADDRESSES_DOCUMENT_ID,
  canExportProjectDocument,
  canRemoveProjectDocument,
  getCategoryAfterLinking,
  getProjectDocumentSizeBytes,
  isProjectDocumentLinkedTo,
  PROJECT_DOCUMENT_CATEGORIES,
  addProjectDocumentLinks,
  toggleProjectDocumentLink,
  type ProjectDocument,
  type ProjectDocumentCategory,
  type ProjectDocumentLink,
} from '@/lib/documents/projectDocuments'
import { updateProjectDocument } from '@/stores/projectDocumentsStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import type { Selection } from '@/types/ui'
import { formatBytes } from '@/utils/formatBytes'
import { ExportToggle } from './ExportToggle'
import { FloorPlanDisplaySection } from './FloorPlanDisplaySection'
import { CableScheduleProperties } from '@/components/cableRouting/CableScheduleProperties'
import { ControlAddressTableProperties } from '@/components/controlLink/ControlAddressTable'
import { useProjectDocuments } from './useProjectDocuments'
import {
  canReduceProjectDocumentSize,
  useReduceProjectDocumentSize,
} from './useReduceProjectDocumentSize'
import { useRemoveProjectDocument } from './useRemoveProjectDocument'
import { useReplaceProjectDocumentFile } from './useReplaceProjectDocumentFile'
import {
  useSaveToTeamLibrary,
  useTeamDocumentLibraryAccess,
} from '@/components/documents/documentsHostedFeatures'

const fieldLabelClassName = 'block text-sm font-medium text-gray-700 dark:text-gray-300'
const sectionTitleClassName = 'text-sm font-semibold text-gray-900 dark:text-white'
const inputClassName =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:bg-gray-50 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:disabled:bg-gray-800'
const actionButtonClassName =
  'inline-flex min-w-0 w-full items-center justify-center gap-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'

function useDeviceLinkLabel() {
  const { t } = useTranslation()
  return (device: DocumentLinkableDevice) => {
    const symbolKey =
      device.symbol === 'fixed_appliance' ? 'fixed_appliance_generic' : device.symbol
    const type = t(`symbols.${symbolKey}`, { defaultValue: device.symbol })
    // The device's own name (its label, else brand and model) leads; its type follows.
    const own = device.label ?? device.productName
    const name = own && own !== type ? `${own} – ${type}` : type
    return device.circuitCode ? `${name} · ${device.circuitCode}` : name
  }
}

/** Linked devices of an uploaded document, with a picker to link another device. */
function DocumentLinksSection({ document }: { document: ProjectDocument }) {
  const { t } = useTranslation()
  const project = useProjectStore((s) => s.currentProject)
  const setSelection = useUIStore((s) => s.setSelection)
  const deviceLabel = useDeviceLinkLabel()
  const devices = useMemo(() => (project ? getDocumentLinkableDevices(project) : []), [project])
  const linkable = devices.filter((device) => !isProjectDocumentLinkedTo(document, device.link))
  // Identical units (same make and model) collapse into one option.
  const linkableGroups = (() => {
    const groups: {
      device: DocumentLinkableDevice
      devices: DocumentLinkableDevice[]
      count: number
    }[] = []
    const grouped = new Set<string>()
    for (const device of linkable) {
      const key = `${device.link.type}:${device.link.id}`
      if (grouped.has(key)) continue
      const identical = device.specKey
        ? linkable.filter((candidate) => candidate.specKey === device.specKey)
        : [device]
      for (const unit of identical) grouped.add(`${unit.link.type}:${unit.link.id}`)
      groups.push({ device, devices: identical, count: identical.length })
    }
    return groups
  })()
  const canLink = document.origin === 'upload'

  const setLinks = (links: ProjectDocumentLink[]) =>
    updateProjectDocument(document.id, {
      links,
      category: getCategoryAfterLinking(document, links),
    })

  if (!canLink && document.links.length === 0) return null

  return (
    <section className="space-y-2" data-testid="document-links">
      <h4 className={sectionTitleClassName}>{t('projectDocuments.linkedTo')}</h4>
      {document.links.length > 0 ? (
        <ul className="space-y-1">
          {document.links.map((link) => (
            <li key={`${link.type}:${link.id}`} className="flex items-center gap-1">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-900/30"
                onClick={() =>
                  setSelection({ type: link.type as Selection['type'], ids: [link.id] })
                }
              >
                <Paperclip className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{link.label || link.id}</span>
              </button>
              {canLink && (
                <button
                  type="button"
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                  aria-label={t('projectDocuments.unlink')}
                  title={t('projectDocuments.unlink')}
                  onClick={() => setLinks(toggleProjectDocumentLink(document, link))}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t('projectDocuments.notLinked')}
        </p>
      )}
      {canLink && (
        <CustomDropdown
          value=""
          disabled={linkable.length === 0}
          placeholder={
            linkable.length === 0
              ? t('projectDocuments.noLinkableDevices')
              : t('projectDocuments.linkToDevice')
          }
          ariaLabel={t('projectDocuments.linkToDevice')}
          options={linkableGroups.map(({ device, count }) => ({
            value: `${device.link.type}:${device.link.id}`,
            label: count > 1 ? `${deviceLabel(device)} ×${count}` : deviceLabel(device),
          }))}
          onChange={(value) => {
            const group = linkableGroups.find(
              ({ device }) => `${device.link.type}:${device.link.id}` === value
            )
            if (!group) return
            // Units of one make and model share their datasheet, so they link together.
            setLinks(
              addProjectDocumentLinks(
                document,
                group.devices.map((device) => ({ ...device.link, label: deviceLabel(device) }))
              )
            )
          }}
        />
      )}
    </section>
  )
}

/** Properties panel editor for a selected document. */
export default function DocumentProperties({ documentId }: { documentId: string }) {
  if (documentId === CABLE_SCHEDULE_DOCUMENT_ID) return <CableScheduleProperties />
  if (documentId === CONTROL_ADDRESSES_DOCUMENT_ID) return <ControlAddressTableProperties />
  if (documentId === 'builtin:junctions') return <JunctionDocumentProperties documentId={documentId} />
  return <StoredDocumentProperties documentId={documentId} />
}

function StoredDocumentProperties({ documentId }: { documentId: string }) {
  const { t, i18n } = useTranslation()
  const document = useProjectDocuments().find((candidate) => candidate.id === documentId)
  const removeDocument = useRemoveProjectDocument()
  const { input: replaceInput, pickReplacement } = useReplaceProjectDocumentFile()
  const { pendingId: reducingId, requestReduce } = useReduceProjectDocumentSize()
  const teamLibrary = useTeamDocumentLibraryAccess()
  const saveToTeamLibrary = useSaveToTeamLibrary(teamLibrary)

  if (!document) return null
  const isUpload = document.origin === 'upload'
  const isEditable = document.origin !== 'projectAsset'
  const canReduce = canReduceProjectDocumentSize(document)
  const reducing = reducingId === document.id

  return (
    <div className="space-y-5" data-testid="document-properties">
      <div className="space-y-4">
        <label className="block space-y-1">
          <span className={fieldLabelClassName}>{t('projectDocuments.name')}</span>
          <input
            className={inputClassName}
            value={document.name}
            disabled={!isEditable}
            onChange={(event) => updateProjectDocument(document.id, { name: event.target.value })}
          />
        </label>

        <div className="space-y-1">
          <span className={fieldLabelClassName}>{t('projectDocuments.category')}</span>
          <CustomDropdown
            value={document.category}
            ariaLabel={t('projectDocuments.category')}
            options={PROJECT_DOCUMENT_CATEGORIES.map((category) => ({
              value: category,
              label: t(`projectDocuments.categories.${category}`),
            }))}
            onChange={(value) =>
              updateProjectDocument(document.id, { category: value as ProjectDocumentCategory })
            }
          />
        </div>

        {canExportProjectDocument(document) && (
          <ExportToggle document={document} className="w-full justify-center" />
        )}
      </div>

      {document.sourceKind === 'floorPlan' && <FloorPlanDisplaySection documentId={document.id} />}

      <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
        <DocumentLinksSection document={document} />
      </div>

      {canRemoveProjectDocument(document) && (
        <div className="space-y-2 border-t border-gray-200 pt-4 dark:border-gray-700">
          {replaceInput}
          {(isUpload || canReduce) && (
            <div className={`grid gap-2 ${isUpload && canReduce ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {isUpload && (
                <button
                  type="button"
                  data-testid="project-document-replace"
                  title={t('projectDocuments.replaceFile')}
                  className={actionButtonClassName}
                  onClick={() => pickReplacement(document.id)}
                >
                  <FileUp className="h-4 w-4 shrink-0" />
                  <span className="truncate">{t('projectDocuments.replaceFileShort')}</span>
                </button>
              )}
              {canReduce && (
                <button
                  type="button"
                  data-testid="project-document-reduce-size"
                  disabled={reducing}
                  title={`${t('projectDocuments.reduceSize')} · ${formatBytes(getProjectDocumentSizeBytes(document), i18n.language)}`}
                  className={actionButtonClassName}
                  onClick={() => requestReduce(document)}
                >
                  {reducing ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  ) : (
                    <Minimize2 className="h-4 w-4 shrink-0" />
                  )}
                  <span className="truncate">
                    {reducing
                      ? t('projectDocuments.reducingSize')
                      : t('projectDocuments.reduceSize')}
                  </span>
                </button>
              )}
            </div>
          )}
          {saveToTeamLibrary.canSave(document) && (
            <button
              type="button"
              data-testid="project-document-save-to-team-library"
              disabled={saveToTeamLibrary.pendingId === document.id}
              className={actionButtonClassName}
              onClick={() => saveToTeamLibrary.save(document)}
            >
              {saveToTeamLibrary.pendingId === document.id ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <CloudUpload className="h-4 w-4 shrink-0" />
              )}
              <span className="truncate">
                {teamLibrary?.canManage
                  ? t('projectDocuments.teamLibrary.save')
                  : t('projectDocuments.teamLibrary.propose')}
              </span>
            </button>
          )}
          <button
            type="button"
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
            onClick={() => removeDocument(document)}
          >
            <Trash2 className="h-4 w-4 shrink-0" />
            {t('projectDocuments.remove')}
          </button>
        </div>
      )}
    </div>
  )
}
