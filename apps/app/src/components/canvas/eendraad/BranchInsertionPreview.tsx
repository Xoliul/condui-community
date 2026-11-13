import { Group, Line } from 'react-konva'
import type { ProjectV2 } from '@/types/projectV2'
import type { DragPreviewState } from '@/hooks/eendraad/useEendraadDragPreview'
import { SavedForkInsertionPreview } from './SavedForkInsertionPreview'
import type { BottomUpLayoutResult } from '@/lib/layout/bottomUpLayout'
import type { BranchDropIntent } from '@/lib/layout/branchDropInteraction'
import { getBranchInsertionPreview } from '@/lib/layout/branchInsertionPreview'
import { BoundedCanvasPreview } from '../shared/BoundedCanvasPreview'
import { InsertionPreviewChunk } from './InsertionPreviewChunk'
import { DRAG_PREVIEW_DASH, DRAG_PREVIEW_WIRE_WIDTH } from './canvasSymbols'

export function BranchInsertionPreview({ layout, intent, project, preview }: {
  layout: BottomUpLayoutResult; intent: BranchDropIntent; project?: ProjectV2 | null; preview?: DragPreviewState | null
}) {
  if (project && preview && (intent.target.forkAfterEndpointId || intent.target.forkBranchId))
    return <SavedForkInsertionPreview project={project} layout={layout} preview={preview} />
  const geometry = getBranchInsertionPreview(layout, intent)
  if (!geometry) return null
  const { center, size, wire } = geometry
  return <BoundedCanvasPreview>
    <Group name="eendraad-branch-insertion-preview" listening={false}>
      {wire.length > 0 && <Line name="eendraad-preview-added-wire" points={wire}
        stroke="#0284c7" strokeWidth={DRAG_PREVIEW_WIRE_WIDTH} dash={DRAG_PREVIEW_DASH}
        lineCap="round" lineJoin="round" listening={false} />}
      <InsertionPreviewChunk x={center.x - size / 2} y={center.y - size / 2} width={size} height={size} />
    </Group>
  </BoundedCanvasPreview>
}
