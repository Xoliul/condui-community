import { Circle, Group, Line } from 'react-konva'
import { getNewRiserPreviewGeometry } from '@/lib/layout/newRiserPreview'
import { BoundedCanvasPreview } from '../shared/BoundedCanvasPreview'
import { InsertionPreviewChunk } from './InsertionPreviewChunk'
import { DRAG_PREVIEW_DASH, DRAG_PREVIEW_WIRE_WIDTH } from './canvasSymbols'

const NEW_CABLE_WIDTH = DRAG_PREVIEW_WIRE_WIDTH * 1.5

/** The new cable a drop on the new-riser zone creates: from the split point on the trunk, right to the new riser and up to the symbols. */
export function NewRiserInsertionPreview({ geometry }: { geometry: NonNullable<ReturnType<typeof getNewRiserPreviewGeometry>> }) {
  return <BoundedCanvasPreview><Group name="eendraad-new-riser-preview" listening={false}>
    {geometry.cable.map((points, index) => <Line key={index} name="eendraad-preview-new-riser-cable" points={points}
      stroke="#0284c7" strokeWidth={NEW_CABLE_WIDTH} dash={DRAG_PREVIEW_DASH} lineCap="round" lineJoin="round" listening={false} />)}
    {geometry.junction && <Circle name="eendraad-preview-new-riser-junction" x={geometry.junction.x} y={geometry.junction.y}
      radius={4} fill="#0284c7" listening={false} />}
    {geometry.symbols.map((point, index) => <InsertionPreviewChunk key={index} x={point.x - 11} y={point.y - 11} width={22} height={22} />)}
  </Group></BoundedCanvasPreview>
}
