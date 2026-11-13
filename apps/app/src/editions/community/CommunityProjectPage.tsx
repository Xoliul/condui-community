import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { loadProject } from '@/lib/db'
import { preloadProjectRasterImages } from '@/lib/preloadProjectRasterImages'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import { loadLocalProjectEditorState, saveLocalProjectEditorState } from '@/lib/projectStorage/localProjectEditorState'
import { getPreferredDefaultLayout, sanitizeViewportLayoutSnapshot, viewportLayoutForPersistence } from '@/lib/viewport/viewportLayoutPersistence'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { useValidationStore } from '@/stores/validationStore'
import CommunityLayout from './CommunityLayout'
import CommunityStorageConflictDialog from './CommunityStorageConflictDialog'
import { getKnownServerRevision, trackServerRevision } from './communityServerStorage'
import { isServerProjectClean, useServerProjectWatch } from './useServerProjectWatch'

function saveEditorState(projectId: string): void {
  const ui = useUIStore.getState()
  saveLocalProjectEditorState(projectId, {
    activeFloorId: ui.activeFloorId,
    activePanelId: ui.activePanelId,
    panelCanvasMode: ui.panelCanvasMode,
    planFloorOverlayVisibleByBaseFloorId: useProjectStore.getState().planFloorOverlayVisibleByBaseFloorId,
    viewportLayout: viewportLayoutForPersistence(ui.viewportLayout),
    canvasViews: {
      eendraad: { zoom: ui.eendraadView.zoom, pan: { ...ui.eendraadView.pan } },
      plan: { zoom: ui.planView.zoom, pan: { ...ui.planView.pan } },
      panel: { zoom: ui.panelView.zoom, pan: { ...ui.panelView.pan } },
    },
  })
}

export default function CommunityProjectPage() {
  const { id } = useParams<{ id: string }>()
  const { t } = useTranslation()
  const [phase, setPhase] = useState<'opening' | 'ready' | 'missing'>('opening')
  const currentProject = useProjectStore((state) => state.currentProject)
  // Bumped when the server holds a newer version (MCP or another device); re-runs the open below.
  const [reloadCount, setReloadCount] = useState(0)
  const [showReloaded, setShowReloaded] = useState(false)
  const requestReload = useCallback(() => setReloadCount((count) => count + 1), [])
  useServerProjectWatch(id, phase === 'ready', requestReload)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    let noticeTimer: number | undefined
    const reloading = reloadCount > 0
    const open = async () => {
      const knownRevision = getKnownServerRevision(id)
      const project = await loadProject(id)
      if (cancelled) return
      if (!project) {
        if (!reloading) setPhase('missing')
        return
      }
      // Edits made while the newer version loaded win; their next save reports the conflict.
      if (reloading && !isServerProjectClean(id)) {
        if (knownRevision !== undefined) trackServerRevision(id, knownRevision)
        return
      }
      const projectStore = useProjectStore.getState()
      const ui = useUIStore.getState()
      projectStore.setCurrentProjectStorageMode('local')
      projectStore.setProject(project)
      useValidationStore.getState().markProjectOpened()
      const saved = loadLocalProjectEditorState(id)
      if (saved?.canvasViews?.eendraad) ui.setEendraadView(saved.canvasViews.eendraad)
      if (saved?.canvasViews?.plan) ui.setPlanView(saved.canvasViews.plan)
      if (saved?.canvasViews?.panel) ui.setPanelView(saved.canvasViews.panel)
      const floorId = saved?.activeFloorId ?? project.project.lastActiveFloorId ?? null
      ui.setActiveFloor(selectProjectBuildingFloors(project).some((floor) => floor.id === floorId) ? floorId : null)
      ui.setActivePanelId(saved?.activePanelId ?? project.project.lastActivePanelId ?? null)
      ui.setPanelCanvasMode(saved?.panelCanvasMode ?? { kind: 'all' })
      projectStore.setPlanFloorOverlayVisibleByBaseFloorId(saved?.planFloorOverlayVisibleByBaseFloorId ?? {})
      ui.setViewportLayout(
        sanitizeViewportLayoutSnapshot(saved?.viewportLayout) ??
          sanitizeViewportLayoutSnapshot(project.project.lastViewportLayout) ??
          getPreferredDefaultLayout(),
      )
      if (reloading) {
        setShowReloaded(true)
        noticeTimer = window.setTimeout(() => setShowReloaded(false), 3000)
      }
      await preloadProjectRasterImages(project, { concurrency: 2 })
      if (!cancelled) setPhase('ready')
    }
    void open().catch(() => {
      if (!cancelled && !reloading) setPhase('missing')
    })
    return () => {
      cancelled = true
      window.clearTimeout(noticeTimer)
      saveEditorState(id)
    }
  }, [id, reloadCount])

  useEffect(() => {
    if (!id || !currentProject || currentProject.project.id !== id) return
    const timer = window.setTimeout(() => saveEditorState(id), 250)
    return () => window.clearTimeout(timer)
  }, [currentProject, id])

  if (phase === 'ready' && id) {
    return (
      <>
        <CommunityLayout />
        <CommunityStorageConflictDialog projectId={id} />
        {showReloaded && (
          <div
            role="status"
            className="pointer-events-none fixed bottom-4 left-1/2 z-[90] -translate-x-1/2 rounded-md bg-gray-900/90 px-3 py-1.5 text-sm text-white shadow-lg dark:bg-gray-700/95"
          >
            {t('project.serverReloaded', 'Updated with changes saved elsewhere')}
          </div>
        )}
      </>
    )
  }
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 p-6 dark:bg-slate-950">
      <p className="text-slate-700 dark:text-slate-200">
        {phase === 'opening'
          ? t('project.openingTitle', 'Opening project…')
          : t('project.notFound', 'Project not found.')}
      </p>
    </main>
  )
}
