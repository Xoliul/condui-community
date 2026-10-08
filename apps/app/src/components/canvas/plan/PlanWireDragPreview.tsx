import { Group, Line, Path } from 'react-konva'
import {
  PLAN_WIRE_ACTIVE_OPACITY,
} from '@/lib/plan/planWiring'
import { planWireVisualMetrics } from '@/lib/plan/planWireVisualMetrics'

export type PlanWireDragPreviewModel = {
  stroke: string
  path: string | null
  points: number[] | null
  arrowHead: number[] | null
}

export function PlanWireDragPreview({ preview, zoom, pxPerMeter }: { preview: PlanWireDragPreviewModel; zoom?: number; pxPerMeter?: number | null }) {
  const metrics = planWireVisualMetrics(zoom, pxPerMeter)
  return (
    <Group name="plan-wire-drag-preview" listening={false}>
      {preview.path ? (
        <Path
          data={preview.path}
          stroke={preview.stroke}
          strokeWidth={metrics.strokeWidth}
          opacity={PLAN_WIRE_ACTIVE_OPACITY}
          dash={metrics.dash}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      ) : preview.points ? (
        <Line
          points={preview.points}
          stroke={preview.stroke}
          strokeWidth={metrics.strokeWidth}
          opacity={PLAN_WIRE_ACTIVE_OPACITY}
          dash={metrics.dash}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      ) : null}
      {preview.arrowHead && (
        <Line
          points={preview.arrowHead}
          stroke={preview.stroke}
          strokeWidth={metrics.strokeWidth}
          opacity={PLAN_WIRE_ACTIVE_OPACITY}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      )}
    </Group>
  )
}
