import { useMemo } from 'react'
import { Group, Line } from 'react-konva'
import type { ProjectV2 } from '@/types/projectV2'
import type { BottomUpLayoutResult } from '@/lib/layout/bottomUpLayout'
import type { DragPreviewState } from '@/hooks/eendraad/useEendraadDragPreview'
import { buildPreviewGraph } from '@/hooks/eendraad/useEendraadPreviewGraph'
import { useUIStore } from '@/stores/uiStore'
import { BoundedCanvasPreview } from '../shared/BoundedCanvasPreview'
import { InsertionPreviewChunk } from './InsertionPreviewChunk'

/** Use real command simulation for forks; never approximate their landing with
 * a nearby decorative rectangle. Keep all unrelated reflow out of the overlay.
 */
export function SavedForkInsertionPreview({ project, layout, preview }: {
  project: ProjectV2; layout: BottomUpLayoutResult; preview: DragPreviewState
}) {
  const overrides = useUIStore((state) => state.eendraadLayoutOverrides)
  const graph = useMemo(() => buildPreviewGraph(project, preview, layout, overrides), [project, preview, layout, overrides])
  if (!graph) return null
  const added = new Set(graph.createdEndpointIds)
  const positions = graph.layout.panels.flatMap((panel) => panel.elements).filter((element) => element.type === 'endpoint' && added.has(element.endpointId ?? ''))
  const wires = graph.wireSegments.filter((wire) => added.has(wire.toElementId ?? ''))
  return <BoundedCanvasPreview><Group name="eendraad-saved-fork-preview" listening={false}>
    {wires.map((wire) => <Line key={wire.id} points={[wire.startPoint.x, wire.startPoint.y, wire.endPoint.x, wire.endPoint.y]}
      stroke="#0284c7" strokeWidth={1.5} dash={[4, 3]} listening={false} />)}
    {positions.map((element) => <InsertionPreviewChunk key={element.id} x={element.position.x - 11} y={element.position.y - 11} width={22} height={22} />)}
  </Group></BoundedCanvasPreview>
}
