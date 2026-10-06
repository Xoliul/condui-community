import { useDeferredValue, useMemo } from 'react'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useUIStore, type UIState } from '@/stores/uiStore'
import type { BottomUpLayoutResult } from '@/lib/layout/bottomUpLayout'
import {
  getCachedEendraadLayout,
  getEendraadRenderProjectRevision,
} from '@/lib/layout/eendraadDerivedLayout'
import { useInfoBlockLogoVisible } from './useInfoBlockLogoVisible'

/**
 * Calculate the eendraad layout from the current project and layout overrides.
 *
 * Runs synchronously on purpose. The result is required to render every drop /
 * delete / move, so it sits on the interaction-critical path. Offloading it to a
 * Web Worker (previously attempted, see eendraadLayoutWorkerClient) regressed the
 * common case: the whole project is structured-cloned to the worker and the
 * result cloned back on every edit, and the canvas had to blank while the async
 * result was pending — a visible flash plus 200-300 ms of latency per edit. A
 * worker cannot make an interaction feel responsive when its output is needed to
 * paint that same interaction. If a project ever grows large enough to jank here,
 * memoize / incrementalize the layout or debounce overrides rather than moving
 * this computation off-thread.
 */
export function useEendraadLayout(enabled = true): BottomUpLayoutResult | null {
  const currentProject = useProjectStore((state: ProjectState) =>
    enabled && state.currentProject ? getEendraadRenderProjectRevision(state.currentProject) : null
  )
  const renderProject = useDeferredValue(currentProject)
  const eendraadLayoutOverrides = useUIStore((state: UIState) => state.eendraadLayoutOverrides)
  const infoBlockLogo = useInfoBlockLogoVisible(enabled)

  return useMemo(() => {
    if (!enabled || !renderProject) return null
    return getCachedEendraadLayout(renderProject, eendraadLayoutOverrides, { infoBlockLogo })
  }, [enabled, renderProject, eendraadLayoutOverrides, infoBlockLogo])
}
