import { useInfoBlockHeight } from './useInfoBlockHeight'
import { useDeferredValue, useMemo } from 'react'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useUIStore, type ChangeoverGridSourcePreviewRequest, type UIState } from '@/stores/uiStore'
import {
  computeChangeoverGridSourcePreview,
  type ChangeoverGridSourcePreview,
} from '@/lib/layout/changeoverGridSourcePreview'
import {
  buildChangeoverGridSourcePreviewScene,
  type ChangeoverGridSourcePreviewScene,
} from '@/lib/layout/changeoverGridSourcePreviewScene'
import type { LayoutTree } from '@/lib/layout/layoutTree'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import type { WireSegment } from '@/types/schema'
import type { Point } from '@/types/ui'

export interface ChangeoverGridSourcePreviewInputs {
  project: ProjectWithOptionalV2Electrical
  currentWires: readonly WireSegment[]
  overrides: Map<string, Point>
  infoBlockLogo: boolean
  infoBlockHeight?: number
}

type CacheEntry = ChangeoverGridSourcePreviewInputs & {
  panelId: string
  source: ChangeoverGridSourcePreviewRequest['source']
  result: ChangeoverGridSourcePreview | null
}

let lastPreview: CacheEntry | undefined

/**
 * The hover preview for one project revision, panel and source. Hovering in and out of the
 * same option reuses the last simulation; any new revision, wire set or layout override
 * recomputes it. The simulation runs on a clone and bypasses the editor layout caches, so it
 * never reaches the canvas caches, undo history, autosave or export.
 */
export function resolveChangeoverGridSourcePreview(
  request: ChangeoverGridSourcePreviewRequest | null,
  inputs: ChangeoverGridSourcePreviewInputs | null
): ChangeoverGridSourcePreview | null {
  if (!request || !inputs) return null
  if (
    lastPreview &&
    lastPreview.project === inputs.project &&
    lastPreview.currentWires === inputs.currentWires &&
    lastPreview.overrides === inputs.overrides &&
    lastPreview.infoBlockLogo === inputs.infoBlockLogo &&
    lastPreview.infoBlockHeight === inputs.infoBlockHeight &&
    lastPreview.panelId === request.panelId &&
    lastPreview.source === request.source
  ) {
    return lastPreview.result
  }
  const result = computeChangeoverGridSourcePreview(inputs.project, request.panelId, request.source, {
    currentWires: inputs.currentWires,
    overrides: inputs.overrides,
    layoutOptions: { infoBlockLogo: inputs.infoBlockLogo, infoBlockHeight: inputs.infoBlockHeight },
  })
  lastPreview = { ...inputs, ...request, result }
  return result
}

/** Test seam: forget the remembered simulation. */
export function resetChangeoverGridSourcePreviewCache(): void {
  lastPreview = undefined
}

/** The canvas scene for the alternative changeover wiring of a hovered/focused option. */
export function useChangeoverGridSourcePreview(
  currentWires: readonly WireSegment[],
  currentTree: LayoutTree | null,
  /** Matches the drawn layout's info-block variant, as the drag preview does. */
  infoBlockLogo: boolean
): ChangeoverGridSourcePreviewScene | null {
  const request = useDeferredValue(
    useUIStore((state: UIState) => state.changeoverGridSourcePreview)
  )
  const infoBlockHeight = useInfoBlockHeight(request != null)
  const project = useProjectStore((state: ProjectState) =>
    request ? state.currentProject : null
  )
  const overrides = useUIStore((state: UIState) => state.eendraadLayoutOverrides)
  return useMemo(() => {
    const preview = resolveChangeoverGridSourcePreview(
      request,
      project ? { project, currentWires, overrides, infoBlockLogo, infoBlockHeight } : null
    )
    return preview && request
      ? buildChangeoverGridSourcePreviewScene(
          preview,
          { tree: currentTree, wires: currentWires },
          request.panelId
        )
      : null
  }, [currentTree, currentWires, infoBlockHeight, infoBlockLogo, overrides, project, request])
}
