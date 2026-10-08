import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ClipboardList,
  Eye,
  FileUp,
  FolderInput,
  Library,
  Lock,
  Minimize2,
  Plus,
  Trash2,
  Upload,
  CloudUpload,
} from 'lucide-react'
import CanvasFloatingControlRail from '@/components/canvas/CanvasFloatingControlRail'
import ContextMenuPortal from '@/components/canvas/ContextMenuPortal'
import { FloatingControl } from '@/components/canvas/FloatingControls'
import type { ContextMenuItem } from '@/components/common/ContextMenu'
import ViewNavigationToolbar from '@/components/canvas/ViewNavigationToolbar'
import { ZOOM_100 } from '@/constants/canvasConstants'
import { CanvasOverlayScaleProvider } from '@/contexts/CanvasOverlayScaleContext'
import { clamp } from '@/lib/geometry'
import {
  PROJECT_DOCUMENT_CATEGORIES,
  canMoveProjectDocument,
  canRemoveProjectDocument,
  getProjectDocuments,
  getProjectDocumentsStorageBytes,
  groupProjectDocuments,
  PROJECT_DOCUMENTS_STORAGE_LIMIT_BYTES,
  type ProjectDocumentCategory,
  type ProjectDocument,
} from '@/lib/documents/projectDocuments'
import { useThemeColors } from '@/lib/theme/hooks'
import { JunctionDocumentView } from '@/components/junctionEditor/junctionEditorHostedFeatures'
import { logger } from '@/lib/logger'
import { isKeyboardTypingTarget } from '@/lib/ui/keyboardTypingTarget'
import { useDialogStore } from '@/stores/dialogStore'
import { useProjectStore } from '@/stores/projectStore'
import { dismissCanvasOverlays } from '@/lib/ui/canvasOverlayDismiss'
import {
  addProjectDocumentFiles,
  useProjectDocumentsStore,
  updateProjectDocument,
  type RejectedProjectDocumentFiles,
} from '@/stores/projectDocumentsStore'
import { useDialog } from '@/hooks/useDialog'
import { formatBytes } from '@/utils/formatBytes'
import { useUIStore } from '@/stores/uiStore'
import { DocumentCard } from './DocumentCard'
import { DocumentsStorageTally } from './DocumentsStorageTally'
import { ExportToggle } from './ExportToggle'
import { CableSchedule, CableScheduleActions } from '@/components/cableRouting/CableSchedule'
import {
  ControlAddressTable,
  ControlAddressTableActions,
} from '@/components/controlLink/ControlAddressTable'
import {
  ExternalInfluencesDocumentActions,
  ExternalInfluencesDocumentView,
  TeamLibraryPicker,
  useExternalInfluencesEntry,
  useSaveToTeamLibrary,
  useTeamDocumentLibraryAccess,
} from '@/components/documents/documentsHostedFeatures'
import {
  DOCUMENT_VIEWER_MAX_ZOOM,
  DOCUMENT_VIEWER_MIN_ZOOM,
  DocumentViewer,
} from './DocumentViewer'
import { HostedFeatureBadge } from './HostedFeatureBadge'
import { useListedProjectDocuments } from './useProjectDocuments'
import { useRemoveProjectDocument } from './useRemoveProjectDocument'
import { usePendingImportStore } from '@/stores/pendingImportStore'
import { useReplaceProjectDocumentFile } from './useReplaceProjectDocumentFile'
import {
  canReduceProjectDocumentSize,
  useReduceProjectDocumentSize,
} from './useReduceProjectDocumentSize'

/** Viewer zoom uses the shared canvas zoom scale; ZOOM_100 fits the page width. */
const MIN_VIEW_ZOOM = ZOOM_100 * DOCUMENT_VIEWER_MIN_ZOOM
const MAX_VIEW_ZOOM = ZOOM_100 * DOCUMENT_VIEWER_MAX_ZOOM
const REJECTED_NOTICE_MS = 4000

const menuItemClassName =
  'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:text-gray-300 dark:hover:bg-gray-700'

function hasDraggedFiles(event: React.DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes('Files')
}

/**
 * Documents canvas: grouped project documents with an in-canvas viewer. Documents are selected
 * like any element, so their properties show in the shared properties panel. Every project can
 * use it; external influences tables are a hosted feature and show the access star elsewhere.
 * Unfinished feature behind `VITE_ENABLE_PROJECT_DOCUMENTS`.
 */
export default function DocumentsCanvas() {
  const { t, i18n } = useTranslation()
  const dialog = useDialog()
  const colors = useThemeColors()
  const documents = useListedProjectDocuments()
  // Non-household projects offer external influences; other than in paid projects, locked.
  const externalInfluences = useExternalInfluencesEntry()
  const openDocumentId = useProjectDocumentsStore((s) => s.openDocumentId)
  const openDocument = useProjectDocumentsStore((s) => s.openDocument)
  const selectedDocumentId = useUIStore((s) =>
    s.selection.type === 'document' ? (s.selection.ids[0] ?? null) : null
  )
  const setSelection = useUIStore((s) => s.setSelection)
  const clearSelection = useUIStore((s) => s.clearSelection)
  const rootRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const suppressNextContextMenuRef = useRef(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [rejectedNotice, setRejectedNotice] = useState<string[]>([])
  const [viewZoom, setViewZoom] = useState(ZOOM_100)
  const [fitKey, setFitKey] = useState(0)
  const fitTrigger = useUIStore((s) => s.fitToViewTrigger.documents)
  const [showSizes, setShowSizes] = useState(false)
  const [contextMenu, setContextMenu] = useState<
    | { kind: 'document'; document: ProjectDocument; position: { x: number; y: number } }
    | { kind: 'add'; position: { x: number; y: number } }
    | null
  >(null)
  const removeDocument = useRemoveProjectDocument()
  const [draggedDocumentId, setDraggedDocumentId] = useState<string | null>(null)
  const [dropCategory, setDropCategory] = useState<ProjectDocumentCategory | null>(null)
  const { input: replaceInput, pickReplacement } = useReplaceProjectDocumentFile()
  const { pendingId: reducingId, requestReduce } = useReduceProjectDocumentSize()
  const teamLibrary = useTeamDocumentLibraryAccess()
  const saveToTeamLibrary = useSaveToTeamLibrary(teamLibrary)

  const addExternalInfluences = () => {
    const documentId = externalInfluences?.add(t('projectDocuments.influences.defaultName'))
    if (!documentId) return
    openDocument(documentId)
    setSelection({ type: 'document', ids: [documentId] })
  }

  const openTeamLibrary = () => {
    if (!teamLibrary) return
    dialog.custom({
      title: t('projectDocuments.teamLibrary.title'),
      size: 'lg',
      content: <TeamLibraryPicker teamId={teamLibrary.teamId} />,
      buttons: [{ label: t('common.close'), onClick: () => {}, variant: 'primary' }],
    })
  }

  const openedDocument = documents.find((document) => document.id === openDocumentId) ?? null
  const groups = groupProjectDocuments(documents)
  const addDocumentMenuItems: ContextMenuItem[] = [
    {
      label: t('projectDocuments.uploadFiles'),
      icon: <Upload className="h-4 w-4 shrink-0" />,
      onClick: () => {
        setAddMenuOpen(false)
        fileInputRef.current?.click()
      },
    },
    ...(teamLibrary
      ? [
          {
            label: t('projectDocuments.teamLibrary.fromLibrary'),
            icon: <Library className="h-4 w-4 shrink-0" />,
            onClick: () => {
              setAddMenuOpen(false)
              openTeamLibrary()
            },
          },
        ]
      : []),
    ...(externalInfluences
      ? [
          {
            label: t('projectDocuments.externalInfluences'),
            icon: <ClipboardList className="h-4 w-4 shrink-0" />,
            disabled: externalInfluences.disabled,
            ...(externalInfluences.locked ? { badge: <HostedFeatureBadge /> } : {}),
            onClick: () => {
              setAddMenuOpen(false)
              addExternalInfluences()
            },
          },
        ]
      : []),
  ]

  useEffect(() => {
    setViewZoom(ZOOM_100)
  }, [openDocumentId])

  // F over this canvas (or the fit button) frames the open document again.
  useEffect(() => {
    if (fitTrigger === 0) return
    setViewZoom(ZOOM_100)
    setFitKey((key) => key + 1)
  }, [fitTrigger])

  useEffect(() => {
    if (rejectedNotice.length === 0) return
    const timer = window.setTimeout(() => setRejectedNotice([]), REJECTED_NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [rejectedNotice])

  const selectDocument = useCallback(
    (id: string) => setSelection({ type: 'document', ids: [id] }),
    [setSelection]
  )

  const showDocument = useCallback(
    (id: string) => {
      openDocument(id)
      selectDocument(id)
    },
    [openDocument, selectDocument]
  )

  const showOverview = () => {
    if (selectedDocumentId && selectedDocumentId === openDocumentId) clearSelection()
    openDocument(null)
  }
  const showOverviewRef = useRef(showOverview)
  showOverviewRef.current = showOverview
  const hoveredRef = useRef(false)

  // Escape or Backspace over an open document returns to the list. Capture phase on window runs
  // before the app-wide shortcuts, so they do not also clear the selection or delete anything.
  useEffect(() => {
    if (!openDocumentId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Backspace') return
      if (event.ctrlKey || event.metaKey || event.altKey || !hoveredRef.current) return
      if (isKeyboardTypingTarget(event.target) || useDialogStore.getState().dialog) return
      event.preventDefault()
      event.stopPropagation()
      showOverviewRef.current()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [openDocumentId])

  const handleFiles = useCallback(
    (fileList: FileList | File[] | null) => {
      if (!fileList || fileList.length === 0) return
      const noticeFor = (rejected: RejectedProjectDocumentFiles): string[] => {
        const notice: string[] = []
        if (rejected.unsupported.length > 0) {
          notice.push(t('projectDocuments.rejected', { count: rejected.unsupported.length }))
        }
        if (rejected.tooLarge.length > 0) {
          notice.push(t('projectDocuments.rejectedTooLarge', { count: rejected.tooLarge.length }))
        }
        if (rejected.overBudget.length > 0) {
          notice.push(
            t('projectDocuments.rejectedStorageFull', { count: rejected.overBudget.length })
          )
        }
        return notice
      }
      // Files that do not fit are offered a reduction: balanced first, then the smallest level.
      const addReduced = async (files: File[]) => {
        setRejectedNotice([t('projectDocuments.reducingSize')])
        const balanced = await addProjectDocumentFiles(files, { reduce: 'balanced' })
        const smallest =
          balanced.rejected.overBudget.length > 0
            ? await addProjectDocumentFiles(balanced.rejected.overBudget, { reduce: 'small' })
            : null
        setRejectedNotice(noticeFor(smallest?.rejected ?? balanced.rejected))
      }
      addProjectDocumentFiles(Array.from(fileList))
        .then(({ rejected }) => {
          const { overBudget, ...others } = rejected
          setRejectedNotice(noticeFor({ ...others, overBudget: [] }))
          if (overBudget.length === 0) return
          const free = Math.max(
            0,
            PROJECT_DOCUMENTS_STORAGE_LIMIT_BYTES -
              getProjectDocumentsStorageBytes(
                getProjectDocuments(useProjectStore.getState().currentProject?.assets)
              )
          )
          dialog.confirm({
            title: t('projectDocuments.overBudgetTitle'),
            message: t('projectDocuments.overBudgetMessage', {
              count: overBudget.length,
              free: formatBytes(free, i18n.language),
            }),
            variant: 'info',
            confirmLabel: t('projectDocuments.overBudgetConfirm'),
            onConfirm: () => {
              addReduced(overBudget).catch((error) => {
                logger.error('[documents] reduced upload failed:', error)
                setRejectedNotice([t('projectDocuments.uploadFailed')])
              })
            },
          })
        })
        .catch((error) => {
          logger.error('[documents] upload failed:', error)
          setRejectedNotice([t('projectDocuments.uploadFailed')])
        })
    },
    [dialog, i18n.language, t]
  )

  // Main menu Import > Document: files picked there are added once this canvas is shown.
  const pendingDocumentFiles = usePendingImportStore((state) => state.documentFiles)
  useEffect(() => {
    if (!pendingDocumentFiles) return
    const files = usePendingImportStore.getState().takeDocumentFiles()
    if (files) handleFiles(files)
  }, [pendingDocumentFiles, handleFiles])

  const moveDocument = (documentId: string, category: ProjectDocumentCategory) =>
    updateProjectDocument(documentId, { category })
  const draggedDocument = documents.find((document) => document.id === draggedDocumentId) ?? null
  // While dragging, every category is a drop target, including empty ones.
  const visibleGroups = draggedDocument
    ? PROJECT_DOCUMENT_CATEGORIES.map((category) => ({
        category,
        documents: documents.filter((document) => document.category === category),
      }))
    : groups

  const contextMenuItems: ContextMenuItem[] =
    contextMenu?.kind === 'add'
      ? addDocumentMenuItems
      : contextMenu?.kind === 'document'
        ? [
            {
              label: t('projectDocuments.open'),
              icon: <Eye className="h-4 w-4" />,
              onClick: () => showDocument(contextMenu.document.id),
            },
            {
              label: t('projectDocuments.replaceFile'),
              icon: <FileUp className="h-4 w-4" />,
              disabled: contextMenu.document.origin !== 'upload',
              onClick: () => pickReplacement(contextMenu.document.id),
            },
            ...(canReduceProjectDocumentSize(contextMenu.document)
              ? [
                  {
                    label: t('projectDocuments.reduceSize'),
                    icon: <Minimize2 className="h-4 w-4" />,
                    disabled: reducingId === contextMenu.document.id,
                    onClick: () => requestReduce(contextMenu.document),
                  },
                ]
              : []),
            ...(saveToTeamLibrary.canSave(contextMenu.document)
              ? [
                  {
                    label: teamLibrary?.canManage
                      ? t('projectDocuments.teamLibrary.save')
                      : t('projectDocuments.teamLibrary.propose'),
                    icon: <CloudUpload className="h-4 w-4" />,
                    disabled: saveToTeamLibrary.pendingId === contextMenu.document.id,
                    onClick: () => saveToTeamLibrary.save(contextMenu.document),
                  },
                ]
              : []),
            {
              label: t('projectDocuments.remove'),
              icon: <Trash2 className="h-4 w-4" />,
              variant: 'danger',
              disabled: !canRemoveProjectDocument(contextMenu.document),
              onClick: () => removeDocument(contextMenu.document),
            },
            ...(contextMenu.document.origin === 'builtIn'
              ? []
              : [{ label: '', separator: true, onClick: () => undefined }]),
            ...(contextMenu.document.origin === 'builtIn'
              ? []
              : canMoveProjectDocument(contextMenu.document)
                ? PROJECT_DOCUMENT_CATEGORIES.filter(
                    (category) => category !== contextMenu.document.category
                  ).map(
                    (category): ContextMenuItem => ({
                      label: t('projectDocuments.moveTo', {
                        category: t(`projectDocuments.categories.${category}`),
                      }),
                      icon: <FolderInput className="h-4 w-4" />,
                      onClick: () => moveDocument(contextMenu.document.id, category),
                    })
                  )
                : [
                    {
                      label: t('projectDocuments.moveLocked'),
                      icon: <Lock className="h-4 w-4" />,
                      disabled: true,
                      onClick: () => undefined,
                    },
                  ]),
          ]
        : []

  return (
    <CanvasOverlayScaleProvider containerRef={rootRef}>
      <div
        ref={rootRef}
        className="relative h-full w-full cursor-default select-none overflow-hidden"
        style={{ backgroundColor: colors.background }}
        data-testid="documents-canvas"
        onPointerEnter={() => {
          hoveredRef.current = true
        }}
        onPointerMove={() => {
          hoveredRef.current = true
        }}
        onPointerLeave={() => {
          hoveredRef.current = false
        }}
        onPointerDownCapture={(event) => {
          // Same contract as BaseCanvas: pressing the canvas closes open floating menus.
          const target = event.target as Element | null
          if (contextMenu && event.button === 2) {
            suppressNextContextMenuRef.current = true
            window.setTimeout(() => {
              suppressNextContextMenuRef.current = false
            }, 1000)
          }
          if (contextMenu && !target?.closest('[data-canvas-context-menu]')) {
            setContextMenu(null)
          }
          if (!target?.closest('[data-canvas-overlay-anchor]')) dismissCanvasOverlays()
        }}
        onContextMenuCapture={(event) => {
          const target = event.target as Element | null
          const clickedDocumentCard = target?.closest('[data-testid="project-document-card"]')
          const clickedMenu = target?.closest('[data-canvas-context-menu]')
          if (clickedMenu) {
            event.preventDefault()
            setContextMenu(null)
            suppressNextContextMenuRef.current = false
            return
          }
          if (contextMenu || suppressNextContextMenuRef.current) {
            event.preventDefault()
            suppressNextContextMenuRef.current = false
            setContextMenu(
              !clickedDocumentCard && !openedDocument
                ? { kind: 'add', position: { x: event.clientX, y: event.clientY } }
                : null
            )
            return
          }
          if (openedDocument || clickedDocumentCard) return
          event.preventDefault()
          setContextMenu({ kind: 'add', position: { x: event.clientX, y: event.clientY } })
        }}
        onDragEnter={(event) => {
          if (hasDraggedFiles(event)) setDragActive(true)
        }}
        onDragOver={(event) => {
          if (!hasDraggedFiles(event)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDragActive(false)
        }}
        onDrop={(event) => {
          if (!hasDraggedFiles(event)) return
          event.preventDefault()
          setDragActive(false)
          handleFiles(event.dataTransfer.files)
        }}
      >
        {openedDocument ? (
          <div
            className="flex h-full flex-col"
            onPointerDown={() => {
              if (selectedDocumentId !== openedDocument.id) selectDocument(openedDocument.id)
            }}
          >
            <div className="flex h-[72px] shrink-0 items-center gap-3 pl-[72px] pr-[60px]">
              <button
                type="button"
                data-testid="project-documents-back"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-100 dark:border-gray-500 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                onClick={showOverview}
              >
                <ArrowLeft className="h-4 w-4" />
                {t('projectDocuments.back')}
              </button>
              <span className="min-w-0 truncate text-sm text-gray-500 dark:text-gray-400">
                {openedDocument.name}
              </span>
              {openedDocument.kind === 'cableSchedule' && (
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <ExportToggle document={openedDocument} />
                  <CableScheduleActions />
                </div>
              )}
              {openedDocument.kind === 'controlAddresses' && (
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <ExportToggle document={openedDocument} />
                  <ControlAddressTableActions />
                </div>
              )}
              {openedDocument.kind === 'externalInfluences' && (
                <ExternalInfluencesDocumentActions
                  documentId={openedDocument.id}
                  documentName={openedDocument.name}
                />
              )}
            </div>
            <div className="min-h-0 flex-1">
              {openedDocument.kind === 'externalInfluences' ? (
                <ExternalInfluencesDocumentView documentId={openedDocument.id} />
              ) : openedDocument.kind === 'cableSchedule' ? (
                <CableSchedule />
              ) : openedDocument.kind === 'controlAddresses' ? (
                <ControlAddressTable />
              ) : openedDocument.kind === 'junctionOverview' ? (
                <JunctionDocumentView
                  zoom={viewZoom / ZOOM_100}
                  onZoomChange={(zoom) =>
                    setViewZoom(clamp(zoom * ZOOM_100, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM))
                  }
                  fitKey={fitKey}
                />
              ) : (
                <DocumentViewer
                  document={openedDocument}
                  zoom={viewZoom / ZOOM_100}
                  onZoomChange={(zoom) =>
                    setViewZoom(clamp(zoom * ZOOM_100, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM))
                  }
                  fitKey={fitKey}
                />
              )}
            </div>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
            <button
              type="button"
              className="flex h-48 w-full max-w-sm flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 transition-colors hover:border-sky-400 hover:text-sky-600 dark:border-gray-600 dark:text-gray-400 dark:hover:border-sky-500 dark:hover:text-sky-400"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-8 w-8" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                {t('projectDocuments.emptyTitle')}
              </span>
              <span className="text-xs">{t('projectDocuments.drop')}</span>
            </button>
            {teamLibrary && (
              <button
                type="button"
                data-testid="project-documents-empty-team-library"
                className="flex w-full max-w-sm items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:border-sky-400 hover:text-sky-600 dark:border-gray-600 dark:text-gray-200 dark:hover:border-sky-500 dark:hover:text-sky-400"
                onClick={openTeamLibrary}
              >
                <Library className="h-4 w-4 shrink-0" />
                {t('projectDocuments.teamLibrary.fromLibrary')}
              </button>
            )}
            {externalInfluences && (
              <button
                type="button"
                data-testid="project-documents-empty-external-influences"
                disabled={externalInfluences.disabled}
                className="flex w-full max-w-sm items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:border-sky-400 hover:text-sky-600 disabled:cursor-default disabled:hover:border-gray-300 disabled:hover:text-gray-700 dark:border-gray-600 dark:text-gray-200 dark:hover:border-sky-500 dark:hover:text-sky-400"
                onClick={addExternalInfluences}
              >
                <ClipboardList className="h-4 w-4 shrink-0" />
                {t('projectDocuments.addExternalInfluences')}
                {externalInfluences.locked ? <HostedFeatureBadge /> : null}
              </button>
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col">
            {/* Same row as the viewer's back button and title. */}
            <div className="flex h-[72px] shrink-0 items-center px-[72px]">
              <div className="w-full max-w-md">
                <DocumentsStorageTally documents={documents} onHoverChange={setShowSizes} />
              </div>
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto px-[72px] pb-6"
              data-documents-scroll="true"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget && selectedDocumentId) clearSelection()
              }}
            >
              <div className="space-y-6">
                {visibleGroups.map((group) => {
                  const acceptsDrop =
                    draggedDocument !== null && draggedDocument.category !== group.category
                  return (
                    <section
                      key={group.category}
                      data-testid={`project-documents-category-${group.category}`}
                      onDragOver={(event) => {
                        if (!acceptsDrop) return
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                        if (dropCategory !== group.category) setDropCategory(group.category)
                      }}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                          setDropCategory((current) =>
                            current === group.category ? null : current
                          )
                        }
                      }}
                      onDrop={(event) => {
                        if (!acceptsDrop || !draggedDocument) return
                        event.preventDefault()
                        moveDocument(draggedDocument.id, group.category)
                        setDraggedDocumentId(null)
                        setDropCategory(null)
                      }}
                      className={`-mx-2 rounded-lg px-2 pb-2 transition-colors ${
                        acceptsDrop
                          ? dropCategory === group.category
                            ? 'bg-sky-50 outline-dashed outline-2 outline-sky-500 dark:bg-sky-950/40'
                            : 'outline-dashed outline-1 outline-gray-300 dark:outline-gray-600'
                          : ''
                      }`}
                    >
                      <div className="mb-3 flex items-center gap-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                          {t(`projectDocuments.categories.${group.category}`)}
                        </h3>
                        <span className="rounded-full bg-gray-100 px-2 text-xs tabular-nums text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                          {group.documents.length}
                        </span>
                        <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" aria-hidden />
                      </div>
                      <div className="grid min-h-[3rem] grid-cols-[repeat(auto-fill,minmax(150px,180px))] gap-3">
                        {group.documents.map((document) => (
                          <DocumentCard
                            key={document.id}
                            document={document}
                            selected={document.id === selectedDocumentId}
                            showSize={showSizes}
                            movable={canMoveProjectDocument(document)}
                            onOpen={showDocument}
                            onDragStart={setDraggedDocumentId}
                            onDragEnd={() => {
                              setDraggedDocumentId(null)
                              setDropCategory(null)
                            }}
                            onContextMenu={(document, position) =>
                              setContextMenu({ kind: 'document', document, position })
                            }
                          />
                        ))}
                      </div>
                    </section>
                  )
                })}
                {/* Always last, so documents keep the top of the overview. */}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,180px))] gap-3">
                  <button
                    type="button"
                    data-testid="project-documents-add-tile"
                    onClick={() => fileInputRef.current?.click()}
                    className={`flex aspect-[4/3] flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-3 text-center transition-colors ${
                      dragActive
                        ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300'
                        : 'border-gray-300 text-gray-500 hover:border-sky-400 hover:text-sky-600 dark:border-gray-600 dark:text-gray-400 dark:hover:border-sky-500 dark:hover:text-sky-400'
                    }`}
                  >
                    <Plus className="h-6 w-6" />
                    <span className="text-sm font-medium">{t('projectDocuments.add')}</span>
                    <span className="text-xs">{t('projectDocuments.drop')}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {!openedDocument && (
          <CanvasFloatingControlRail
            side="left"
            verticalAlign="center"
            offsetPx={12}
            zIndex={30}
            menuOpen={addMenuOpen}
            dataCanvasOverlayAnchor="left"
            dataCanvasOverlayPosition="center-left"
          >
            <FloatingControl
              icon={<Plus className="h-6 w-6" />}
              label={t('projectDocuments.add')}
              side="left"
              open={addMenuOpen}
              onOpenChange={setAddMenuOpen}
              triggerTestId="project-documents-add"
            >
              <div className="min-w-[220px] space-y-1 rounded-md border border-gray-200 bg-white py-2 text-sm shadow-lg dark:border-gray-600 dark:bg-gray-800">
                {addDocumentMenuItems.map((item, index) => (
                  <button
                    key={item.label}
                    type="button"
                    data-testid={index === 0 ? 'project-documents-upload' : undefined}
                    className={menuItemClassName}
                    disabled={item.disabled}
                    onClick={item.onClick}
                  >
                    {item.icon}
                    {item.label}
                    {item.badge ? <span className="ml-auto pl-3">{item.badge}</span> : null}
                  </button>
                ))}
              </div>
            </FloatingControl>
          </CanvasFloatingControlRail>
        )}

        {/* Zoom and focus only for a viewed file; maximize/restore is always there. */}
        <ViewNavigationToolbar
          zoom={viewZoom}
          onZoomChange={(zoom) => setViewZoom(clamp(zoom, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM))}
          onPanChange={() => undefined}
          onFitToView={() => {
            setViewZoom(ZOOM_100)
            setFitKey((key) => key + 1)
          }}
          canvasType="documents"
          maximizeOnly={
            !openedDocument ||
            openedDocument.kind === 'externalInfluences' ||
            openedDocument.kind === 'cableSchedule' ||
            openedDocument.kind === 'controlAddresses'
          }
        />

        {replaceInput}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={(event) => {
            handleFiles(event.target.files)
            event.target.value = ''
          }}
        />

        {contextMenu && (
          <ContextMenuPortal
            position={contextMenu.position}
            onClose={() => setContextMenu(null)}
            items={contextMenuItems}
          />
        )}
        {dragActive && (openedDocument || groups.length === 0) && (
          <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-sky-500 bg-sky-50/80 text-sm font-medium text-sky-700 dark:bg-sky-950/70 dark:text-sky-300">
            {t('projectDocuments.drop')}
          </div>
        )}
        {rejectedNotice.length > 0 && (
          <div
            role="status"
            className="absolute bottom-4 left-1/2 z-40 -translate-x-1/2 whitespace-pre-line rounded-md bg-gray-900 px-3 py-2 text-sm text-white shadow-lg dark:bg-gray-700"
          >
            {rejectedNotice.join('\n')}
          </div>
        )}
      </div>
    </CanvasOverlayScaleProvider>
  )
}
