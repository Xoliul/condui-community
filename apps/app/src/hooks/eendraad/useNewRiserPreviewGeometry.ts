import { useMemo } from 'react'
import type { ProjectV2 } from '@/types/projectV2'
import type { BottomUpLayoutResult } from '@/lib/layout/bottomUpLayout'
import { getNewRiserPreviewGeometry } from '@/lib/layout/newRiserPreview'
import { useUIStore } from '@/stores/uiStore'
import type { DragPreviewState } from './useEendraadDragPreview'
import { buildPreviewGraph } from './useEendraadPreviewGraph'

/**
 * Geometry of the cable a drop on the new-riser zone creates, from the simulated post-drop layout. Null while the
 * pointer is not on that zone or no simulation exists, so the caller can fall back to the plain insertion preview.
 */
export function useNewRiserPreviewGeometry(project: ProjectV2 | null | undefined, layout: BottomUpLayoutResult, preview: DragPreviewState | null | undefined) {
  const overrides = useUIStore((state) => state.eendraadLayoutOverrides)
  const circuitId = preview?.dropTarget?.newRiser ? preview.dropTarget.circuitId : undefined
  return useMemo(() => {
    if (!project || !preview || !circuitId) return null
    const graph = buildPreviewGraph(project, preview, layout, overrides)
    return graph ? getNewRiserPreviewGeometry(graph, circuitId) : null
  }, [project, preview, layout, overrides, circuitId])
}
