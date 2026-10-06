import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, Grid2X2, List, MoreHorizontal, Plus, Server } from 'lucide-react'
import { useLocalizedNavigate } from '@/hooks/useLocalizedNavigate'
import { createEmptyProjectV2, generateId } from '@/utils/project'
import {
  deleteProject,
  getRecentProjects,
  loadProject,
  saveProject,
  type ProjectMetadata,
} from '@/lib/db'
import { loadHomeProjectLayout, type HomeProjectLayout } from '@/lib/homeProjectLayout'
import NewProjectDialog from '@/components/home/NewProjectDialog'
import DeleteConfirmDialog from '@/components/home/DeleteConfirmDialog'
import { LocalProjectBrowser } from '@/components/home/LocalProjectBrowser'
import { HomeMenuPortal } from '@/components/home/HomeMenuPortal'
import { useHomeFolderActions } from '@/hooks/useHomeFolderActions'
import { eendraChromeHeaderBackgroundClass } from '@/lib/ui/chromeLayoutStyles'
import { ConduiLogo } from '@/components/branding/ConduiLogo'
import { EditorPreferencesToolbar } from '@/components/settings/EditorPreferencesToolbar'
import { logger } from '@/lib/logger'
import { importProjectFromTrikLocal } from '@/lib/import/trik/assembleProject'
import type { Installation } from '@/types/schema'
import {
  downloadCommunityBlob,
  exportCommunityProject,
  importCommunityProject,
} from './communityProjectPackage'
import { listBrowserOnlyProjects, moveBrowserProjectsToServer } from './communityDb'
import { loadCommunityHomeLayout, saveCommunityHomeLayout } from './communityHomeLayout'
import { isServerStorageEnabled } from './communityServerStorage'
import { buildTimestampedExportFilename } from '@/lib/export/exportFilename'

const communityPrimaryButtonClass =
  'rounded-md bg-sky-600 font-semibold text-white shadow-md transition-colors duration-200 hover:bg-sky-700 hover:shadow-lg'

const communitySecondaryButtonClass =
  'rounded-md border border-slate-300 bg-white font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-gray-800 dark:text-slate-200 dark:hover:bg-gray-700'

const communitySecondaryIconButtonClass =
  `${communitySecondaryButtonClass} inline-flex items-center justify-center`

function CommunityViewModeDropdown({
  viewMode,
  onViewModeChange,
}: {
  viewMode: HomeProjectLayout['viewMode']
  onViewModeChange: (mode: HomeProjectLayout['viewMode']) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const activeLabel =
    viewMode === 'list'
      ? t('home.viewMode.list', { defaultValue: 'List' })
      : t('home.viewMode.grid', { defaultValue: 'Grid' })
  const itemClass =
    'flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-slate-800 transition-colors hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800'

  return (
    <div ref={anchorRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`h-10 w-10 ${communitySecondaryIconButtonClass}`}
        title={activeLabel}
        aria-label={activeLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="home-view-mode-toggle"
      >
        {viewMode === 'list' ? (
          <List className="h-5 w-5" aria-hidden />
        ) : (
          <Grid2X2 className="h-5 w-5" aria-hidden />
        )}
      </button>
      <HomeMenuPortal
        open={open}
        anchorRef={anchorRef}
        onClose={() => setOpen(false)}
        className="min-w-40 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900"
      >
        <button
          type="button"
          role="menuitemradio"
          aria-checked={viewMode === 'grid'}
          onClick={() => {
            onViewModeChange('grid')
            setOpen(false)
          }}
          className={itemClass}
        >
          <Grid2X2 className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
          {t('home.viewMode.grid', { defaultValue: 'Grid' })}
        </button>
        <button
          type="button"
          role="menuitemradio"
          aria-checked={viewMode === 'list'}
          onClick={() => {
            onViewModeChange('list')
            setOpen(false)
          }}
          className={itemClass}
        >
          <List className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
          {t('home.viewMode.list', { defaultValue: 'List' })}
        </button>
      </HomeMenuPortal>
    </div>
  )
}

export default function CommunityHome() {
  const { t } = useTranslation()
  const navigate = useLocalizedNavigate()
  const importRef = useRef<HTMLInputElement>(null)
  const trikImportRef = useRef<HTMLInputElement>(null)
  const actionsAnchorRef = useRef<HTMLDivElement>(null)
  const layoutRef = useRef<HomeProjectLayout>(loadHomeProjectLayout(null))
  const [projects, setProjects] = useState<ProjectMetadata[]>([])
  const [loading, setLoading] = useState(true)
  const [layout, setLayout] = useState<HomeProjectLayout>(layoutRef.current)
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false)
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<ProjectMetadata | null>(null)
  const [isTrikImporting, setIsTrikImporting] = useState(false)
  const [serverStorage, setServerStorage] = useState(false)
  const [browserOnlyCount, setBrowserOnlyCount] = useState(0)
  const [isMovingToServer, setIsMovingToServer] = useState(false)

  const setHomeLayout = useCallback(
    (updater: HomeProjectLayout | ((previous: HomeProjectLayout) => HomeProjectLayout)) => {
      setLayout((previous) => {
        const next = typeof updater === 'function' ? updater(previous) : updater
        layoutRef.current = next
        saveCommunityHomeLayout(next)
        return next
      })
    },
    [],
  )

  const { createFolder, renameFolder, deleteFolder } = useHomeFolderActions(
    setHomeLayout,
    () => layoutRef.current,
  )

  const refresh = useCallback(async () => {
    setProjects(await getRecentProjects(100))
    setBrowserOnlyCount((await listBrowserOnlyProjects()).length)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh().catch((error) => {
      logger.error('Failed to list local projects:', error)
      setLoading(false)
    })
  }, [refresh])

  useEffect(() => {
    let cancelled = false
    void isServerStorageEnabled().then((enabled) => {
      if (!cancelled) setServerStorage(enabled)
    })
    void loadCommunityHomeLayout()
      .then((stored) => {
        if (cancelled) return
        layoutRef.current = stored
        setLayout(stored)
      })
      .catch((error) => logger.error('Failed to load the project folders:', error))
    return () => {
      cancelled = true
    }
  }, [])

  const moveProjectsToServer = async () => {
    setIsMovingToServer(true)
    try {
      await moveBrowserProjectsToServer()
    } catch (error) {
      window.alert(
        t('home.serverStorage.moveFailed', {
          defaultValue: 'Moving projects failed: {{error}}',
          error: error instanceof Error ? error.message : String(error),
        }),
      )
    } finally {
      setIsMovingToServer(false)
      await refresh()
    }
  }

  const handleCreateProject = async (
    name: string,
    installation: Installation,
    yearOfConstruction?: number,
    meterEanCode?: string,
  ) => {
    const project = createEmptyProjectV2(name, yearOfConstruction, installation, meterEanCode)
    await saveProject(project, { storageMode: 'local' })
    setIsNewProjectOpen(false)
    navigate(`/project/${project.project.id}`)
    return true
  }

  const importProject = async (file: File) => {
    const project = await importCommunityProject(file)
    project.project.id = generateId()
    const now = new Date().toISOString()
    project.project.createdAt = now
    project.project.updatedAt = now
    await saveProject(project, { storageMode: 'local' })
    navigate(`/project/${project.project.id}`)
  }

  const importTrikProject = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.trik')) {
      window.alert(
        t('project.importTrikInvalidFileMessage', {
          defaultValue: 'Select a valid .trik file.',
        }),
      )
      return
    }

    setIsTrikImporting(true)
    try {
      const project = await importProjectFromTrikLocal(file)
      project.project.id = generateId()
      const now = new Date().toISOString()
      project.project.createdAt = now
      project.project.updatedAt = now
      await saveProject(project, { storageMode: 'local' })
      navigate(`/project/${project.project.id}`)
    } catch (error) {
      logger.error('Failed to import TRiK project:', error)
      window.alert(
        t('project.importTrikFailedMessage', {
          defaultValue: 'TRiK project import failed: {{error}}',
          error: error instanceof Error ? error.message : String(error),
        }),
      )
    } finally {
      setIsTrikImporting(false)
    }
  }

  const renameProject = async (project: ProjectMetadata) => {
    const nextName = window.prompt(
      t('project.rename', { defaultValue: 'Rename project' }),
      project.name,
    )
    const trimmed = nextName?.trim()
    if (!trimmed || trimmed === project.name) return
    const document = await loadProject(project.id)
    if (!document) return
    document.project.name = trimmed
    document.project.updatedAt = new Date().toISOString()
    await saveProject(document, { storageMode: 'local', lastOpened: project.lastOpened })
    await refresh()
  }

  const downloadProject = async (project: ProjectMetadata) => {
    const document = await loadProject(project.id)
    if (!document) return
    const blob = await exportCommunityProject(document)
    downloadCommunityBlob(blob, buildTimestampedExportFilename(project.name, 'zip'))
    await refresh()
  }

  const confirmDeleteProject = async () => {
    if (!deleteConfirm) return
    await deleteProject(deleteConfirm.id)
    setDeleteConfirm(null)
    await refresh()
  }

  const footerYear = new Date().getFullYear()

  return (
    <div className="h-dvh overflow-y-auto overscroll-contain bg-gradient-to-br from-sky-50 via-slate-50 to-sky-100 dark:from-gray-900 dark:via-gray-800 dark:to-slate-900">
      <header
        className={`sticky top-0 z-50 border-b border-slate-200 dark:border-gray-700 ${eendraChromeHeaderBackgroundClass}`}
      >
        <div className="home-header-inner mx-auto max-w-7xl px-4 py-3 sm:px-6 sm:py-4 lg:px-8 lg:py-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-1 font-bold leading-none text-gray-900 dark:text-white">
                <ConduiLogo heightPx={32} />
              </h1>
              <p className="home-header-tagline mt-0.5 text-xs text-slate-600 dark:text-slate-400 sm:mt-1 sm:text-sm">
                {t('views.eendraad')} + {t('views.plan')} Designer
              </p>
            </div>
            <EditorPreferencesToolbar />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <style>{`
          @media (max-height: 500px) and (max-width: 900px) {
            .home-header-inner {
              padding-top: 0.5rem;
              padding-bottom: 0.5rem;
            }

            .home-header-tagline {
              display: none;
            }
          }
        `}</style>
        <section>
          <div className="mb-6 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-3 text-2xl font-bold text-gray-900 dark:text-white">
              <span className="sm:hidden">{t('project.recent')}</span>
              <span className="hidden sm:inline">{t('project.recentProjects')}</span>
              {serverStorage && (
                <span
                  className="inline-flex items-center gap-1.5 text-sm font-normal text-slate-500 dark:text-slate-400"
                  data-testid="home-server-storage"
                >
                  <Server className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">
                    {t('home.serverStorage.storedOnServer', { defaultValue: 'Stored on server' })}
                  </span>
                </span>
              )}
            </h2>
            <div className="flex items-center gap-3">
              <CommunityViewModeDropdown
                viewMode={layout.viewMode}
                onViewModeChange={(viewMode) =>
                  setHomeLayout((previous) => ({ ...previous, viewMode }))
                }
              />
              <button
                type="button"
                data-testid="home-new-project"
                onClick={() => setIsNewProjectOpen(true)}
                className={`flex items-center gap-2 px-5 py-2.5 text-sm ${communityPrimaryButtonClass}`}
              >
                <Plus className="h-4 w-4" aria-hidden />
                <span className="sm:hidden">{t('common.new')}</span>
                <span className="hidden sm:inline">{t('project.new')}</span>
              </button>
              <div ref={actionsAnchorRef}>
                <button
                  type="button"
                  onClick={() => setIsActionsMenuOpen((value) => !value)}
                  className={`h-10 w-10 ${communitySecondaryIconButtonClass}`}
                  title={t('common.moreActions')}
                  aria-label={t('common.moreActions')}
                  aria-haspopup="menu"
                  aria-expanded={isActionsMenuOpen}
                >
                  <MoreHorizontal className="h-5 w-5" aria-hidden />
                </button>
                <HomeMenuPortal
                  open={isActionsMenuOpen}
                  anchorRef={actionsAnchorRef}
                  onClose={() => setIsActionsMenuOpen(false)}
                  className="min-w-64 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsActionsMenuOpen(false)
                      navigate('/demo')
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm text-slate-800 transition-colors hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    {t('project.openExampleProject', { defaultValue: 'Open Example project' })}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsActionsMenuOpen(false)
                      importRef.current?.click()
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm text-slate-800 transition-colors hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    {t('project.importDownloaded')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={isTrikImporting}
                    onClick={() => {
                      setIsActionsMenuOpen(false)
                      trikImportRef.current?.click()
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm text-slate-800 transition-colors hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    {t('project.importTrikFile')}
                  </button>
                  <div className="border-t border-slate-200 dark:border-slate-700" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setIsActionsMenuOpen(false)
                      void createFolder()
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-800 transition-colors hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    <Folder className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                    {t('home.folders.newFolder')}
                  </button>
                </HomeMenuPortal>
                <input
                  ref={importRef}
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) void importProject(file).catch((error) => window.alert(String(error)))
                  }}
                />
                <input
                  ref={trikImportRef}
                  type="file"
                  accept=".trik,application/xml,text/xml"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) void importTrikProject(file)
                  }}
                />
              </div>
            </div>
          </div>

          {browserOnlyCount > 0 && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-slate-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-slate-100">
              <span>
                {t('home.serverStorage.browserOnly', {
                  defaultValue: 'Projects only in this browser: {{total}}',
                  total: browserOnlyCount,
                })}
              </span>
              <button
                type="button"
                disabled={isMovingToServer}
                onClick={() => void moveProjectsToServer()}
                className={`px-4 py-2 text-sm disabled:opacity-60 ${communityPrimaryButtonClass}`}
                data-testid="home-move-to-server"
              >
                {t('home.serverStorage.moveToServer', { defaultValue: 'Move to server' })}
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-sky-600" />
            </div>
          ) : projects.length === 0 ? (
            <div className="py-20 text-center">
              <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
                <svg
                  className="h-8 w-8 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <h3 className="mb-2 text-lg font-medium text-gray-900 dark:text-white">
                {t('project.noProjects')}
              </h3>
              <p className="mb-6 text-gray-600 dark:text-gray-400">
                {t('project.noProjectsDescription')}
              </p>
              <div className="flex flex-col items-center gap-3">
                <button
                  type="button"
                  data-testid="home-new-project"
                  onClick={() => setIsNewProjectOpen(true)}
                  className={`inline-flex items-center gap-2 px-6 py-3 text-sm font-semibold ${communitySecondaryButtonClass}`}
                >
                  <Plus className="h-5 w-5" aria-hidden />
                  {t('project.createFirst')}
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/demo')}
                  className={`inline-flex items-center gap-2 px-6 py-3 text-sm ${communityPrimaryButtonClass}`}
                >
                  {t('project.openExampleProject', { defaultValue: 'Open Example project' })}
                </button>
              </div>
            </div>
          ) : (
            <LocalProjectBrowser
              projects={projects}
              layout={layout}
              onLayoutChange={setHomeLayout}
              onOpen={(project) => navigate(`/project/${project.id}`)}
              onRename={(project) => void renameProject(project)}
              onDownload={(project) => void downloadProject(project)}
              onDelete={(project) => setDeleteConfirm(project)}
              onRenameFolder={(folderId, currentName) => void renameFolder(folderId, currentName)}
              onDeleteFolder={deleteFolder}
            />
          )}
        </section>

        <footer className="mt-16 border-t border-slate-200 pt-8 dark:border-slate-800">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('home.footerCopyright', { year: footerYear, brand: 'Condui' })}
          </p>
        </footer>
      </main>

      <NewProjectDialog
        isOpen={isNewProjectOpen}
        onClose={() => setIsNewProjectOpen(false)}
        onCreate={handleCreateProject}
      />

      <DeleteConfirmDialog
        isOpen={!!deleteConfirm}
        projectName={deleteConfirm?.name || ''}
        onConfirm={() => void confirmDeleteProject()}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  )
}
