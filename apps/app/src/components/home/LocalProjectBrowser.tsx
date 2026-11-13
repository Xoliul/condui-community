import { useRef, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { GripVertical, MoreHorizontal } from 'lucide-react'
import type { ProjectMetadata } from '@/lib/db'
import {
  assignProjectsToFolder,
  groupProjectsByFolder,
  HOME_PROJECT_DRAG_MIME,
  projectLayoutKey,
  toggleFolderCollapsed,
  type HomeProjectLayout,
} from '@/lib/homeProjectLayout'
import {
  homeFolderGroupClass,
  homeListProjectsInFolderClass,
  homeListProjectsSurfaceClass,
  homeProjectCardFooterClass,
  homeProjectCardSurfaceClass,
  homeProjectListRowClass,
} from '@/lib/ui/homeLayoutStyles'
import { FolderHeaderRow } from './FolderHeaderRow'
import { HomeMenuPortal } from './HomeMenuPortal'

const localSecondaryIconButtonClass =
  'inline-flex items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-gray-800 dark:text-slate-200 dark:hover:bg-gray-700'

const localProjectCardPrimaryButtonClass =
  'rounded-md bg-slate-600 font-medium text-white shadow-md transition-colors duration-200 hover:bg-slate-700 hover:shadow-lg dark:bg-slate-600 dark:hover:bg-slate-500'

type LocalProjectBrowserProps = {
  projects: ProjectMetadata[]
  layout: HomeProjectLayout
  onLayoutChange: (
    updater: HomeProjectLayout | ((previous: HomeProjectLayout) => HomeProjectLayout),
  ) => void
  onOpen: (project: ProjectMetadata) => void
  onRename: (project: ProjectMetadata) => void
  onDownload: (project: ProjectMetadata) => void
  onDelete: (project: ProjectMetadata) => void
  onRenameFolder: (folderId: string, currentName: string) => void
  onDeleteFolder: (folderId: string, projectCount: number) => void
}

type LocalProjectActionsProps = {
  project: ProjectMetadata
  onRename: (project: ProjectMetadata) => void
  onDownload: (project: ProjectMetadata) => void
  onDelete: (project: ProjectMetadata) => void
  compact?: boolean
}

function formatProjectDate(project: ProjectMetadata): string {
  const value = project.lastOpened || project.updatedAt
  return new Date(value).toLocaleString()
}

function LocalProjectActions({
  project,
  onRename,
  onDownload,
  onDelete,
  compact = false,
}: LocalProjectActionsProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const itemClass =
    'w-full rounded-md px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800'

  return (
    <div ref={anchorRef} data-no-open>
      <button
        type="button"
        data-testid="project-card-menu"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setOpen((value) => !value)
        }}
        className={`${compact ? 'h-8 w-8' : 'h-10 w-10'} ${localSecondaryIconButtonClass}`}
        title={t('common.moreActions')}
        aria-label={t('common.moreActions')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden />
      </button>
      <HomeMenuPortal open={open} anchorRef={anchorRef} onClose={() => setOpen(false)}>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false)
            onRename(project)
          }}
          className={itemClass}
        >
          {t('project.rename', { defaultValue: 'Rename project' })}
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setOpen(false)
            onDownload(project)
          }}
          className={itemClass}
        >
          {t('menu.exportProject')}
        </button>
        <button
          type="button"
          role="menuitem"
          data-testid="project-card-delete"
          onClick={() => {
            setOpen(false)
            onDelete(project)
          }}
          className="w-full rounded-md px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
        >
          {t('common.delete')}
        </button>
      </HomeMenuPortal>
    </div>
  )
}

type LocalProjectItemProps = LocalProjectActionsProps & {
  project: ProjectMetadata
  viewMode: HomeProjectLayout['viewMode']
  onOpen: (project: ProjectMetadata) => void
  onDragStart: (event: DragEvent<HTMLElement>, project: ProjectMetadata) => void
}

function LocalProjectItem({
  project,
  viewMode,
  onOpen,
  onDragStart,
  onRename,
  onDownload,
  onDelete,
}: LocalProjectItemProps) {
  const { t } = useTranslation()
  const date = formatProjectDate(project)

  if (viewMode === 'list') {
    return (
      <div
        data-project-row
        data-testid="project-list-row"
        role="button"
        tabIndex={0}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('[data-no-open]')) return
          onOpen(project)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          if ((event.target as HTMLElement).closest('[data-no-open]')) return
          event.preventDefault()
          onOpen(project)
        }}
        className={`group flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition-colors ${homeProjectListRowClass}`}
      >
        <button
          type="button"
          data-no-open
          draggable
          onDragStart={(event) => onDragStart(event, project)}
          className="shrink-0 cursor-grab rounded p-0.5 text-slate-400 opacity-0 transition-opacity hover:text-slate-600 focus:opacity-100 group-hover:opacity-100 dark:hover:text-slate-300"
          title={t('home.folders.dragHandle')}
          aria-label={t('home.folders.dragHandle')}
        >
          <GripVertical className="h-4 w-4" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
            {project.name}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{date}</p>
        </div>
        <LocalProjectActions
          project={project}
          onRename={onRename}
          onDownload={onDownload}
          onDelete={onDelete}
          compact
        />
      </div>
    )
  }

  return (
    <article
      data-project-row
      data-testid="project-card"
      className={`group overflow-hidden rounded-md border shadow-sm transition-all hover:shadow-lg ${homeProjectCardSurfaceClass}`}
    >
      <div className="p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <button
            type="button"
            data-no-open
            draggable
            onDragStart={(event) => onDragStart(event, project)}
            className="shrink-0 cursor-grab rounded p-0.5 text-slate-400 opacity-0 transition-opacity hover:text-slate-600 focus:opacity-100 group-hover:opacity-100 dark:hover:text-slate-300"
            title={t('home.folders.dragHandle')}
            aria-label={t('home.folders.dragHandle')}
          >
            <GripVertical className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" onClick={() => onOpen(project)} className="min-w-0 flex-1 text-left">
            <h3 className="truncate text-lg font-semibold text-gray-900 dark:text-white">
              {project.name}
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{date}</p>
          </button>
          <LocalProjectActions
            project={project}
            onRename={onRename}
            onDownload={onDownload}
            onDelete={onDelete}
          />
        </div>
      </div>
      <div className={`border-t px-6 py-4 ${homeProjectCardFooterClass}`}>
        <button
          type="button"
          onClick={() => onOpen(project)}
          className={`flex w-full items-center justify-center gap-2 px-4 py-2 ${localProjectCardPrimaryButtonClass}`}
        >
          {t('common.open', { defaultValue: 'Open' })}
        </button>
      </div>
    </article>
  )
}

export function LocalProjectBrowser({
  projects,
  layout,
  onLayoutChange,
  onOpen,
  onRename,
  onDownload,
  onDelete,
  onRenameFolder,
  onDeleteFolder,
}: LocalProjectBrowserProps) {
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null)
  const sections = groupProjectsByFolder(projects, layout)
  const ungroupedSection = sections[0] ?? { projects: [], folder: null }
  const folderSections = sections.slice(1)

  const handleProjectDragStart = (event: DragEvent<HTMLElement>, project: ProjectMetadata) => {
    event.dataTransfer.setData(HOME_PROJECT_DRAG_MIME, projectLayoutKey(project))
    event.dataTransfer.effectAllowed = 'move'
  }

  const dropProjectOnFolder = (folderId: string | null, event: DragEvent) => {
    event.preventDefault()
    const key = event.dataTransfer.getData(HOME_PROJECT_DRAG_MIME)
    if (!key) return
    onLayoutChange((previous) => assignProjectsToFolder(previous, [key], folderId))
    setDragOverFolderId(null)
  }

  const renderProjects = (folderProjects: ProjectMetadata[], folderId: string | null) => {
    const className =
      layout.viewMode === 'grid'
        ? folderId
          ? 'grid grid-cols-1 gap-6 p-4 md:grid-cols-2 lg:grid-cols-3'
          : 'grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3'
        : folderId
          ? homeListProjectsInFolderClass
          : homeListProjectsSurfaceClass

    return (
      <div
        className={`${className} ${
          dragOverFolderId === folderId ? 'rounded-md ring-2 ring-sky-500/60' : ''
        }`}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(HOME_PROJECT_DRAG_MIME)) return
          event.preventDefault()
          setDragOverFolderId(folderId)
        }}
        onDragLeave={() => setDragOverFolderId((current) => (current === folderId ? null : current))}
        onDrop={(event) => dropProjectOnFolder(folderId, event)}
      >
        {folderProjects.map((project) => (
          <LocalProjectItem
            key={projectLayoutKey(project)}
            project={project}
            viewMode={layout.viewMode}
            onOpen={onOpen}
            onDragStart={handleProjectDragStart}
            onRename={onRename}
            onDownload={onDownload}
            onDelete={onDelete}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4" onDragEnd={() => setDragOverFolderId(null)}>
      {ungroupedSection.projects.length > 0 || layout.folders.length === 0
        ? renderProjects(ungroupedSection.projects, null)
        : null}
      {folderSections.map((section) =>
        section.folder ? (
          <section key={section.folder.id} className={homeFolderGroupClass}>
            <FolderHeaderRow
              folder={section.folder}
              collapsed={section.folder.collapsed === true}
              projectCount={section.projects.length}
              onToggleCollapse={() =>
                onLayoutChange((previous) => toggleFolderCollapsed(previous, section.folder!.id))
              }
              onRename={() => onRenameFolder(section.folder!.id, section.folder!.name)}
              onDelete={() => onDeleteFolder(section.folder!.id, section.projects.length)}
              canDrag={false}
              onDragStart={() => undefined}
              onDragEnd={() => undefined}
            />
            {section.folder.collapsed === true
              ? null
              : renderProjects(section.projects, section.folder.id)}
          </section>
        ) : null,
      )}
    </div>
  )
}
