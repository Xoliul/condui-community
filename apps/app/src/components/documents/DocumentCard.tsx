import { memo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Library, Lock, Paperclip } from 'lucide-react'
import {
  canExportProjectDocument,
  getProjectDocumentSizeBytes,
  type ProjectDocument,
} from '@/lib/documents/projectDocuments'
import { WiringIcon } from '@/components/icons/UiIcons'
import { formatBytes } from '@/utils/formatBytes'
import { ExportToggle } from './ExportToggle'
import { PdfPageCanvas } from './PdfPageCanvas'

const THUMBNAIL_WIDTH = 150

/** Miniature of a generated table document: header band and striped rows, optionally badged. */
function SheetThumbnail({ badge }: { badge?: ReactNode }) {
  return (
    <div
      className="relative flex h-full w-[150px] flex-col gap-[3px] bg-white p-2 shadow-sm dark:bg-gray-900 dark:ring-1 dark:ring-gray-700"
      aria-hidden
    >
      <div className="mb-0.5 h-5 rounded-sm bg-sky-100 dark:bg-sky-900/60" />
      {Array.from({ length: 7 }, (_, index) => (
        <div
          key={index}
          className={`h-2 rounded-sm ${
            index % 2 === 0 ? 'bg-gray-200 dark:bg-gray-700' : 'bg-gray-100 dark:bg-gray-700/50'
          }`}
        />
      ))}
      {badge && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 text-sky-600 shadow-md ring-1 ring-gray-200 dark:bg-gray-900/90 dark:text-sky-400 dark:ring-gray-600">
            {badge}
          </div>
        </div>
      )}
    </div>
  )
}

function DocumentThumbnail({ document }: { document: ProjectDocument }) {
  const [failed, setFailed] = useState(false)
  if (document.kind === 'cableSchedule') {
    return <SheetThumbnail badge={<WiringIcon className="h-8 w-8 [&>svg]:block [&>svg]:h-full [&>svg]:w-full" />} />
  }
  if (document.kind === 'externalInfluences') return <SheetThumbnail />
  if (failed) return <FileText className="h-10 w-10 text-gray-300 dark:text-gray-600" />
  if (document.kind === 'image') {
    return (
      <img
        src={document.url}
        alt=""
        draggable={false}
        className="max-h-full max-w-full object-contain"
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <PdfPageCanvas
      document={document}
      pageNumber={1}
      width={THUMBNAIL_WIDTH}
      className="shadow-sm"
      onError={() => setFailed(true)}
    />
  )
}

export const DocumentCard = memo(function DocumentCard({
  document,
  selected,
  showSize = false,
  movable = false,
  onOpen,
  onDragStart,
  onDragEnd,
  onContextMenu,
}: {
  document: ProjectDocument
  selected: boolean
  /** Reveals the file size of documents that count toward project storage. */
  showSize?: boolean
  /** Can be dragged onto another category. */
  movable?: boolean
  onOpen: (id: string) => void
  onDragStart?: (id: string) => void
  onDragEnd?: () => void
  onContextMenu: (document: ProjectDocument, position: { x: number; y: number }) => void
}) {
  const { t, i18n } = useTranslation()
  const sizeVisible = showSize && document.origin === 'upload'
  return (
    <div
      data-testid="project-document-card"
      draggable={movable}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('application/x-condui-document', document.id)
        // Changing the page during dragstart makes Chrome cancel the drag; reveal targets next tick.
        window.setTimeout(() => onDragStart?.(document.id), 0)
      }}
      onDragEnd={() => onDragEnd?.()}
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu(document, { x: event.clientX, y: event.clientY })
      }}
      className={`group relative flex flex-col overflow-hidden rounded-lg border bg-white shadow-sm transition hover:border-sky-400 hover:shadow dark:bg-gray-700 dark:hover:border-sky-400 ${
        selected
          ? 'border-sky-500 ring-2 ring-sky-500/40 dark:border-sky-400'
          : 'border-gray-300 dark:border-gray-500'
      }`}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onOpen(document.id)}
        className="flex flex-col text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500"
      >
        <div className="relative flex aspect-[4/3] items-start justify-center overflow-hidden bg-gray-100 p-2 dark:bg-gray-800">
          <DocumentThumbnail document={document} />
          {sizeVisible && (
            <div
              className="absolute inset-0 flex items-center justify-center bg-sky-500/25"
              data-testid="project-document-size"
            >
              <span className="rounded-full bg-sky-600 px-2.5 py-1 text-sm font-semibold tabular-nums text-white shadow">
                {formatBytes(getProjectDocumentSizeBytes(document), i18n.language)}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 py-2 pl-2.5 pr-9">
          <span
            className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-100"
            title={document.name}
          >
            {document.name}
          </span>
          {(document.origin === 'projectAsset' || document.origin === 'builtIn') && (
            <span
              className="shrink-0"
              title={
                document.origin === 'builtIn'
                  ? t('projectDocuments.builtInHint', 'Always part of the project')
                  : t('projectDocuments.projectFileHint')
              }
            >
              <Lock
                className="h-3.5 w-3.5 text-gray-400"
                aria-label={
                  document.origin === 'builtIn'
                    ? t('projectDocuments.builtInHint', 'Always part of the project')
                    : t('projectDocuments.projectFileHint')
                }
              />
            </span>
          )}
          {document.teamDocumentId && (
            <Library
              className="h-3.5 w-3.5 shrink-0 text-gray-400"
              aria-label={t('projectDocuments.teamLibrary.fromLibraryNote')}
            />
          )}
          {document.links.length > 0 && (
            <Paperclip
              className="h-3.5 w-3.5 shrink-0 text-gray-400"
              aria-label={t('projectDocuments.linkedTo')}
            />
          )}
        </div>
      </button>
      {canExportProjectDocument(document) && (
        <ExportToggle document={document} className="absolute bottom-1 right-1.5" compact />
      )}
    </div>
  )
})
