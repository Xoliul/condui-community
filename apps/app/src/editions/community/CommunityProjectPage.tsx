import { useEffect, useState } from 'react'
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

  useEffect(() => {
    if (!id) return
    let cancelled = false
    const open = async () => {
      const project = await loadProject(id)
      if (cancelled) return
      if (!project) {
        setPhase('missing')
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
      await preloadProjectRasterImages(project, { concurrency: 2 })
      if (!cancelled) setPhase('ready')
    }
    void open().catch(() => {
      if (!cancelled) setPhase('missing')
    })
    return () => {
      cancelled = true
      saveEditorState(id)
    }
  }, [id])

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
