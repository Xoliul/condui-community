import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Menu, Tag } from 'lucide-react'
import { useLocalizedNavigate } from '@/hooks/useLocalizedNavigate'
import { useAutoSave } from '@/hooks/useAutoSave'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useExportDialog } from './useCommunityExportDialog'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import ViewLayout from '@/components/ViewLayout'
import { FloatingLibraryPanel, LibraryPanel } from '@/components/library'
import ArmedPlacementController from '@/components/library/ArmedPlacementController'
import PropertiesPanel from '@/components/properties/PropertiesPanel'
import { ExportCanvasPool } from '@/components/export/ExportCanvasPool'
import { ExportProgress } from '@/components/export/ExportProgress'
import { downloadCommunityBlob, exportCommunityProject } from './communityProjectPackage'
import { ConduiLogo } from '@/components/branding/ConduiLogo'
import {
  ExportPdfIcon,
  HardwareTallyIcon,
  LibraryIcon,
  ProjectDownloadIcon,
  QuickPlacerIcon,
  RedoIcon,
  SettingsIcon,
  ShortcutsIcon,
  UndoIcon,
} from '@/components/icons/UiIcons'
import { eendraChromeHeaderBackgroundClass } from '@/lib/ui/chromeLayoutStyles'
import {
  HardwareTallyPanel,
  HardwareTallyPanelContent,
} from '@/components/tally/HardwareTallyPanel'
import ValidationIssuesPanel from '@/components/validation/ValidationIssuesPanel'
import ValidationIssuesDialog, {
  ValidationRevalidateButton,
} from '@/components/validation/ValidationIssuesDialog'
import ValidationStatusIcon, {
  ValidationStateIcon,
} from '@/components/validation/ValidationStatusIcon'
import { DockablePanelShell } from '@/components/panels/DockablePanelShell'
import { ResizableDivider } from '@/components/layout/ResizableDivider'
import { COLLAPSED_PANEL_SIGNIFIER_WIDTH_PX } from '@/constants/layoutConstants'
import { clamp } from '@/lib/geometry'
import { EditorPreferencesToolbar } from '@/components/settings/EditorPreferencesToolbar'
import { SettingsPanel } from '@/components/settings/SettingsPanel'
import { ShortcutsDialog } from '@/components/shortcuts/ShortcutsDialog'
import { useDialog } from '@/hooks/useDialog'
import { LabelStripExportDialog } from '@/components/export/LabelStripExportDialog'
import { exportLabelStripsToPdf, type LabelStripExportOptions } from '@/lib/export/labelStripExport'
import {
  exportLabelStripsToBrotherLbx,
  renderBrotherLbxPreviewSvg,
} from '@/lib/export/brotherLbxExport'
import { logger } from '@/lib/logger'
import { buildTimestampedExportFilename } from '@/lib/export/exportFilename'

export default function CommunityLayout({ demoMode = false }: { demoMode?: boolean }) {
  const { t } = useTranslation()
  const navigate = useLocalizedNavigate()
  const dialog = useDialog()
  const project = useProjectStore((state) => state.currentProject)
  const undo = useProjectStore((state) => state.undo)
  const redo = useProjectStore((state) => state.redo)
  const canUndo = useProjectStore((state) => state.undoStack.length > 0)
  const canRedo = useProjectStore((state) => state.redoStack.length > 0)
  const saveCurrentProject = useProjectStore((state) => state.saveCurrentProject)
  const propertiesVisible = useUIStore((state) => state.panels.properties.visible)
  const propertiesWidth = useUIStore((state) => state.panels.properties.width)
  const leftDockPanel = useUIStore((state) => state.leftDockPanel)
  const leftDockCollapsed = useUIStore((state) => state.leftDockCollapsed)
  const leftDockWidth = useUIStore((state) => state.panels.library.width)
  const setLeftDockPanel = useUIStore((state) => state.setLeftDockPanel)
  const setLeftDockCollapsed = useUIStore((state) => state.setLeftDockCollapsed)
  const setPanelWidth = useUIStore((state) => state.setPanelWidth)
  const setFloatingPanelDragSeed = useUIStore((state) => state.setFloatingPanelDragSeed)
  const libraryWindowOpen = useUIStore((state) => state.libraryWindowOpen)
  const tallyWindowOpen = useUIStore((state) => state.tallyWindowOpen)
  const validationWindowOpen = useUIStore((state) => state.validationWindowOpen)
  const setLibraryWindowOpen = useUIStore((state) => state.setLibraryWindowOpen)
  const setTallyWindowOpen = useUIStore((state) => state.setTallyWindowOpen)
  const setValidationWindowOpen = useUIStore((state) => state.setValidationWindowOpen)
  const setQuickPlacerWindowOpen = useUIStore((state) => state.setQuickPlacerWindowOpen)
  const planVisibleInLayout = useUIStore((state) =>
    state.viewportLayout.panels.some((panel) => panel.canvas === 'plan')
  )
  const [leftDockResizePreviewWidth, setLeftDockResizePreviewWidth] = useState<number | null>(null)
  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window === 'undefined' ? 1 : Math.max(window.innerWidth, 1)
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { openExportDialog, isExporting, exportProgress, currentPage } = useExportDialog()

  useAutoSave({ disabled: demoMode })
  useKeyboardShortcuts()

  useEffect(() => {
    if (!menuOpen) return
    const closeMenu = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', closeMenu)
    return () => document.removeEventListener('mousedown', closeMenu)
  }, [menuOpen])

  useEffect(() => {
    const handleResize = () => setWindowWidth(Math.max(window.innerWidth, 1))
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  if (!project) return null

  const backToMain = async () => {
    setMenuOpen(false)
    if (!demoMode) await saveCurrentProject()
    navigate('/')
  }

  const downloadProject = async () => {
    setMenuOpen(false)
    await saveCurrentProject()
    const blob = await exportCommunityProject(useProjectStore.getState().currentProject!)
    downloadCommunityBlob(
      blob,
      buildTimestampedExportFilename(project.project.name, 'zip'),
    )
  }

  const openSettings = () => {
    setMenuOpen(false)
    dialog.custom({
      title: t('settings.title'),
      content: <SettingsPanel showDebug={false} />,
      size: 'md',
      showCloseButton: true,
    })
  }

  const openShortcuts = () => {
    setMenuOpen(false)
    dialog.custom({
      title: t('shortcuts.title'),
      content: <ShortcutsDialog />,
      size: 'xl',
      showCloseButton: true,
    })
  }

  const handleExportLabels = async (options: LabelStripExportOptions) => {
    dialog.close()
    if (!project) return
    try {
      const provider = (panelId: string) => useProjectStore.getState().getPanelGridModules(panelId)
      const blob =
        options.exportFormat === 'brother-lbx'
          ? await exportLabelStripsToBrotherLbx(project, options, provider)
          : await exportLabelStripsToPdf(project, options, provider)
      const safeName =
        (project.project.name || 'label-strips').replace(/[^\w\s-]/g, '').trim() || 'label-strips'
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${safeName}-labels.${options.exportFormat === 'brother-lbx' && options.brotherMode === 'single-strip' ? 'zip' : options.exportFormat === 'brother-lbx' ? 'lbx' : 'pdf'}`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
    } catch (error) {
      logger.error('Export labels failed:', error)
      dialog.info({
        title: t('labelStripExport.errorTitle', 'Label export failed'),
        message: t(
          'labelStripExport.errorMessage',
          'The label export could not be created. Please try again.'
        ),
        variant: 'error',
      })
    }
  }

  const handlePreviewLabels = async (options: LabelStripExportOptions) => {
    if (!project) throw new Error('No project available for preview')
    const provider = (panelId: string) => useProjectStore.getState().getPanelGridModules(panelId)
    return options.exportFormat === 'brother-lbx'
      ? renderBrotherLbxPreviewSvg(project, options, provider)
      : exportLabelStripsToPdf(project, options, provider)
  }
  const handleOpenPanelCanvasFromLabelExport = () => {
    dialog.close()
    useUIStore.getState().setViewMode('panel')
  }

  const openLabelStripExport = () => {
    setMenuOpen(false)
    dialog.custom({
      id: 'label-strip-export',
      title: t('labelStripExport.title'),
      titleIcon: <Tag className="h-5 w-5" aria-hidden />,
      content: (
        <LabelStripExportDialog
          onCancel={() => dialog.close()}
          onExport={handleExportLabels}
          onOpenPanelCanvas={handleOpenPanelCanvasFromLabelExport}
          onPreview={handlePreviewLabels}
          suppressCanvasWarning={demoMode}
        />
      ),
      size: 'xl',
      showCloseButton: true,
    })
  }

  const menuItemClass =
    'flex w-full items-center gap-2.5 px-5 py-2.5 text-left text-[1.09375rem] leading-snug text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'
  const menuIconClass = 'h-5 w-5 shrink-0'
  const iconButtonClass =
    'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
  const leftDockOptions = [
    {
      id: 'library' as const,
      title: t('symbols.library'),
      icon: <LibraryIcon className="h-4 w-4" />,
    },
    {
      id: 'tally' as const,
      title: t('tally.title'),
      icon: <HardwareTallyIcon className="h-4 w-4" />,
    },
    {
      id: 'validation' as const,
      title: t('validation.title', { defaultValue: 'Validation Results' }),
      icon: <ValidationStateIcon className="h-4 w-4" />,
    },
    {
      id: 'quickPlacer' as const,
      title: t('quickPlacer.title'),
      icon: <QuickPlacerIcon className="h-4 w-4" />,
    },
  ]
  const leftDockTitle =
    leftDockOptions.find((option) => option.id === leftDockPanel)?.title ?? t('symbols.library')
  const effectiveLeftDockWidth = leftDockCollapsed
    ? COLLAPSED_PANEL_SIGNIFIER_WIDTH_PX
    : (leftDockResizePreviewWidth ?? leftDockWidth)
  const effectiveRightPanelWidth = propertiesVisible
    ? propertiesWidth
    : COLLAPSED_PANEL_SIGNIFIER_WIDTH_PX

  const renderLeftDockContent = () => {
    if (leftDockPanel === 'tally') return <HardwareTallyPanelContent />
    if (leftDockPanel === 'validation') return <ValidationIssuesDialog showHeader={false} />
    if (leftDockPanel === 'quickPlacer') {
      if (!planVisibleInLayout) {
        return (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-gray-500 dark:text-gray-400">
            {t('quickPlacer.availableWhenPlanOpen')}
          </div>
        )
      }
      return <div id="left-dock-quick-placer-host" className="h-full min-h-0" />
    }
    return <LibraryPanel />
  }

  const handleUndockDockedPanel = (event: {
    pointerId: number
    pointerType: string
    clientX: number
    clientY: number
    initialLeft: number
    initialTop: number
    offsetX: number
    offsetY: number
  }) => {
    const panelToUndock = leftDockPanel
    setLeftDockPanel('library')
    setLeftDockCollapsed(true)
    setFloatingPanelDragSeed({
      panel: panelToUndock,
      ...event,
      token: Date.now(),
    })

    if (panelToUndock === 'library') setLibraryWindowOpen(true)
    else if (panelToUndock === 'tally') setTallyWindowOpen(true)
    else if (panelToUndock === 'validation') setValidationWindowOpen(true, 'undock')
    else setQuickPlacerWindowOpen(true)
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-white dark:bg-slate-950">
      <header
        className={`relative z-[220] flex shrink-0 items-center gap-2 border-b border-slate-200 px-2 py-1.5 sm:justify-between sm:px-4 sm:py-3 dark:border-gray-700 ${eendraChromeHeaderBackgroundClass}`}
      >
        <div
          ref={menuRef}
          className="relative z-50 flex min-w-0 flex-1 items-center gap-2 sm:gap-4"
        >
          <button
            type="button"
            data-testid="app-main-menu-trigger"
            onClick={() => setMenuOpen((open) => !open)}
            className={iconButtonClass}
            title={t('menu.open')}
            aria-label={t('menu.open')}
            aria-expanded={menuOpen}
            aria-haspopup="true"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          {menuOpen ? (
            <div
              className="absolute left-0 top-full z-[230] mt-1 max-h-[calc(100dvh-3.5rem)] w-[260px] overflow-y-auto overscroll-contain rounded-md border border-gray-200 bg-white py-1.5 shadow-lg dark:border-gray-700 dark:bg-gray-800"
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => void backToMain()}
                className={menuItemClass}
              >
                <ArrowLeft className={menuIconClass} aria-hidden />
                {t('menu.backToMain')}
              </button>
              <div
                className="my-1.5 border-t border-gray-200 dark:border-gray-600"
                role="separator"
              />
              <button
                type="button"
                role="menuitem"
                data-testid="app-menu-export-pdf"
                onClick={() => {
                  setMenuOpen(false)
                  openExportDialog()
                }}
                className={menuItemClass}
              >
                <ExportPdfIcon className={menuIconClass} />
                {t('menu.exportPdf')}
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="app-menu-export-labels"
                onClick={openLabelStripExport}
                className={menuItemClass}
              >
                <Tag className={menuIconClass} aria-hidden />
                {t('menu.exportLabels')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => void downloadProject()}
                className={menuItemClass}
              >
                <ProjectDownloadIcon className={menuIconClass} />
                {t('menu.exportProject')}
              </button>
              <div
                className="my-1.5 border-t border-gray-200 dark:border-gray-600"
                role="separator"
              />
              <button
                type="button"
                role="menuitem"
                onClick={openSettings}
                className={menuItemClass}
              >
                <SettingsIcon className={menuIconClass} />
                {t('menu.settings')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={openShortcuts}
                className={menuItemClass}
              >
                <ShortcutsIcon className={menuIconClass} />
                {t('menu.shortcuts')}
              </button>
            </div>
          ) : null}
          <span className="hidden select-none text-gray-400 sm:inline" aria-hidden>
            |
          </span>
          <button
            type="button"
            onClick={() => void backToMain()}
            className="inline-flex shrink-0 items-center rounded-md transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            title={t('menu.backToMain')}
          >
            <ConduiLogo className="sm:hidden" heightPx={13} />
            <ConduiLogo className="hidden sm:inline-block" heightPx={30} />
          </button>
          <span className="hidden select-none text-gray-400 sm:inline" aria-hidden>
            |
          </span>
          <h2 className="min-w-0 max-w-[24vw] truncate text-sm leading-none text-gray-700 sm:text-lg dark:text-gray-300">
            {project.project.name}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-slate-200 bg-white px-1.5 py-1 shadow-sm sm:absolute sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 dark:border-gray-700 dark:bg-gray-800">
          <span className="hidden pl-1 text-xs font-medium leading-none text-gray-600 sm:inline dark:text-gray-300">
            {t('actions.undo', 'Undo')}
          </span>
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            className={`flex items-center justify-center rounded-md p-2 transition-colors ${
              canUndo
                ? 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'
                : 'cursor-not-allowed text-gray-400 dark:text-gray-500'
            }`}
            title={t('actions.undo', 'Undo')}
            aria-label={t('actions.undo', 'Undo')}
          >
            <UndoIcon className="block h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            className={`flex items-center justify-center rounded-md p-2 transition-colors ${
              canRedo
                ? 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'
                : 'cursor-not-allowed text-gray-400 dark:text-gray-500'
            }`}
            title={t('actions.redo', 'Redo')}
            aria-label={t('actions.redo', 'Redo')}
          >
            <RedoIcon className="block h-4 w-4" />
          </button>
          <span className="hidden pr-1 text-xs font-medium leading-none text-gray-600 sm:inline dark:text-gray-300">
            {t('actions.redo', 'Redo')}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ValidationStatusIcon />
          <EditorPreferencesToolbar />
        </div>
      </header>
      <div className="relative flex-1 overflow-hidden">
        <main className="absolute inset-0 bg-slate-50 dark:bg-slate-950">
          <ViewLayout
            leftInsetPx={effectiveLeftDockWidth}
            rightInsetPx={effectiveRightPanelWidth}
            resizePreviewActive={leftDockResizePreviewWidth != null}
          />
          <ArmedPlacementController enabled />
          <ExportCanvasPool />
          {libraryWindowOpen ? <FloatingLibraryPanel /> : null}
          {tallyWindowOpen ? <HardwareTallyPanel /> : null}
          {validationWindowOpen ? <ValidationIssuesPanel /> : null}
        </main>
        <aside
          style={{ width: effectiveLeftDockWidth }}
          className={`absolute inset-y-0 left-0 z-30 overflow-hidden border-r border-gray-200 dark:border-gray-700 ${
            leftDockResizePreviewWidth == null
              ? 'transition-[width] duration-150'
              : 'transition-none'
          }`}
        >
          <DockablePanelShell
            panelId={leftDockPanel}
            title={leftDockTitle}
            mode="docked"
            dockedCollapsed={leftDockCollapsed}
            onDockedCollapseToggle={() => setLeftDockCollapsed(!leftDockCollapsed)}
            onSwitchPanel={setLeftDockPanel}
            switchOptions={leftDockOptions}
            onDockedUndockPointerDown={handleUndockDockedPanel}
            headerActions={
              leftDockPanel === 'validation' ? <ValidationRevalidateButton /> : undefined
            }
          >
            {renderLeftDockContent()}
          </DockablePanelShell>
        </aside>
        {!leftDockCollapsed ? (
          <ResizableDivider
            direction="vertical"
            perpSlopNegativePx={0}
            startRatio={clamp(0.1, leftDockWidth / windowWidth, 0.9)}
            ratio={clamp(effectiveLeftDockWidth / windowWidth, 0.1, 0.9)}
            onDragStart={() => setLeftDockResizePreviewWidth(leftDockWidth)}
            onRatioChange={(nextRatio, containerWidth) => {
              setLeftDockResizePreviewWidth(clamp(Math.round(containerWidth * nextRatio), 220, 640))
            }}
            onDragEnd={(endRatio, containerWidth) => {
              setPanelWidth('library', clamp(Math.round(containerWidth * endRatio), 220, 640))
              setLeftDockResizePreviewWidth(null)
            }}
          />
        ) : null}
        <div className="absolute inset-y-0 right-0 z-30 flex">
          <PropertiesPanel />
        </div>
      </div>
      {isExporting ? <ExportProgress progress={exportProgress} currentPage={currentPage} /> : null}
    </div>
  )
}
