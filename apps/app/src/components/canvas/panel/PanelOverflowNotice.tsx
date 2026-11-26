import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { useViewportUIApi } from '@/components/viewport/ViewportUIStore'
import { getPanelCanvasOverflowModuleKeys } from '@/lib/export/labelStripReadiness'
import { getCachedPanelOverflowCount } from '@/lib/panel/panelCanvasReadCache'
import { panelGridModuleRefKey } from '@/lib/panel/panelGridLayout'
import { withPanelReadContext } from '@/lib/panel/panelReadContext'
import type { GetPanelGridModulesFn } from '@/lib/panel/panelScene'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import type { Panel, PanelGridModuleRef } from '@/types/schema'

interface PanelOverflowNoticeProps {
  project: ProjectWithOptionalV2Electrical | null
  /** The boards the canvas shows. */
  panels: readonly Panel[]
  getPanelGridModules: GetPanelGridModulesFn
}

function visibleModules(getModules: GetPanelGridModulesFn, panelId: string) {
  return getModules(panelId).filter(
    (module) => !(module.ref.kind === 'trunkDevice' && module.ref.scope === 'ground')
  )
}

/** The id a module ref is selected by, with the selection type the cabinet uses for it. */
function selectionEntry(ref: PanelGridModuleRef) {
  if (ref.kind === 'protection') return { type: 'protection' as const, id: ref.id }
  if (ref.kind === 'trunkDevice') return { type: 'trunkDevice' as const, id: ref.id }
  return { type: 'endpoint' as const, id: ref.endpointId }
}

/** Warns about modules in the overflow zone; clicking it selects them and zooms to them. */
export function PanelOverflowNotice({ project, panels, getPanelGridModules }: PanelOverflowNoticeProps) {
  const { t } = useTranslation()
  const viewportUI = useViewportUIApi()
  const count = useMemo(
    () =>
      project
        ? panels.reduce(
            (total, panel) => total + getCachedPanelOverflowCount(project, panel, getPanelGridModules),
            0
          )
        : 0,
    [getPanelGridModules, panels, project]
  )
  const focusOverflowModules = useCallback(() => {
    if (!project) return
    const refs = panels.flatMap((panel) =>
      withPanelReadContext(project, () => {
        const modules = visibleModules(getPanelGridModules, panel.id)
        const keys = getPanelCanvasOverflowModuleKeys(panel, project, modules)
        return modules
          .filter((module) => keys.has(panelGridModuleRefKey(module.ref)))
          .map((module) => module.ref)
      })
    )
    const entries = refs.map(selectionEntry)
    if (entries.length === 0) return
    const state = viewportUI.getState()
    state.setSelection({ type: entries[0]!.type, ids: [...new Set(entries.map((entry) => entry.id))] })
    state.requestFitToView(['panel'])
  }, [getPanelGridModules, panels, project, viewportUI])

  if (count === 0) return null
  return (
    <div
      role="alert"
      className="pointer-events-none absolute left-1/2 top-3 z-[100] flex max-w-[min(34rem,calc(100%-7rem))] -translate-x-1/2"
    >
      <button
        type="button"
        data-testid="panel-canvas-overflow-warning"
        onClick={focusOverflowModules}
        className="pointer-events-auto flex max-w-full cursor-pointer items-center gap-2 overflow-hidden whitespace-nowrap rounded-md border border-amber-300 bg-amber-50/95 px-3 py-1.5 text-left text-amber-950 shadow-md hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/90 dark:text-amber-50 dark:hover:bg-amber-900"
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden />
        <span className="truncate text-xs font-semibold">{t('panelCanvas.overflowWarningTitle')}</span>
      </button>
    </div>
  )
}
