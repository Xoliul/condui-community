import { useMemo } from 'react'
import { Group, Line, Rect, Circle } from 'react-konva'
import type { Endpoint, Placement } from '@/types/schema'
import type { Point } from '@/types/ui'
import { useSettingsStore } from '@/stores/settingsStore'
import { usePlanDragVisualStore } from '@/stores/planDragVisualStore'
import { useCanvasFontFamily } from '@/editions/community/communityHooks'
import { getLabelBoxSize } from '@/utils/plan/labelPositioning'

type PlanDebugPlacement = Placement & {
  endpointId?: string
  junctionPanelLabel?: string
  planLabel?: string
  isEarthing?: boolean
}

interface PlanDebugOverlayProps {
  placements: PlanDebugPlacement[]
  visiblePlacements: PlanDebugPlacement[]
  labelPositions: Map<string, { x: number; y: number }>
  baseSymbolSizePx: number
  planLabelFontSize: number
  getEndpointById: (id: string) => Endpoint | null | undefined
  getPlacementWorldBoundsMemo: (
    pos: Point,
    rotationDeg: number,
    scale: number,
    socketCount: number,
    symbolType?: string,
  ) => { left: number; right: number; top: number; bottom: number }
}

interface DebugItem {
  id: string
  center: Point
  bounds: { left: number; right: number; top: number; bottom: number }
  labelPos: { x: number; y: number } | null
  labelBox: { x: number; y: number; width: number; height: number } | null
  orientationEnd: Point | null
}

export function PlanDebugOverlay({
  placements,
  visiblePlacements,
  labelPositions,
  baseSymbolSizePx,
  planLabelFontSize,
  getEndpointById,
  getPlacementWorldBoundsMemo,
}: PlanDebugOverlayProps) {
  const tempDragPositions = usePlanDragVisualStore((s) => s.positions)
  const tempLabelPositions = usePlanDragVisualStore((s) => s.labels)
  const tempRotations = usePlanDragVisualStore((s) => s.rotations)

  const enabled = useSettingsStore((s) => s.planPlacementDebug)
  const fontFamily = useCanvasFontFamily()

  const debugItems = useMemo<DebugItem[]>(() => {
    if (!enabled) return []

    const placementMap = new Map<string, PlanDebugPlacement>()
    placements.forEach((p) => placementMap.set(p.id, p))

    const items: DebugItem[] = []

    visiblePlacements.forEach((row) => {
      const placement = placementMap.get(row.id)
      if (!placement || !placement.pos) return

      const posOverride = tempDragPositions.get(placement.id)
      const center = posOverride ?? placement.pos

      const placementRow = placement as PlanDebugPlacement
      const endpoint = placementRow.endpointId != null ? getEndpointById(placementRow.endpointId) : null

      const socketCount =
        endpoint && endpoint.socketProps && typeof endpoint.socketProps.socketCount === 'number'
          ? endpoint.socketProps.socketCount
          : 1

      const rotationDeg = tempRotations.get(placement.id) ?? placement.rotationDeg
      const bounds = getPlacementWorldBoundsMemo(
        center,
        rotationDeg,
        placement.scale,
        socketCount,
        endpoint?.symbol ??
          (placementRow.isEarthing
            ? 'earthing'
            : placementRow.junctionPanelLabel != null
              ? 'junction_panel'
              : undefined),
      )

      const labelPos =
        tempLabelPositions.get(placement.id) ??
        labelPositions.get(placement.id) ??
        null

      let labelBox: DebugItem['labelBox'] = null
      if (labelPos) {
        const labelText: string | undefined =
          endpoint?.label ?? placementRow.junctionPanelLabel ?? placementRow.planLabel
        if (labelText) {
          const { width, height } = getLabelBoxSize(labelText, planLabelFontSize, fontFamily)
          labelBox = {
            x: labelPos.x - width / 2,
            y: labelPos.y - height / 2,
            width,
            height,
          }
        }
      }

      let orientationEnd: Point | null = null
      if (endpoint && (endpoint.type === 'socket' || endpoint.symbol === 'panel_distribution')) {
        const len = baseSymbolSizePx * placement.scale * 0.9
        const rad = (rotationDeg * Math.PI) / 180
        orientationEnd = {
          x: center.x + Math.cos(rad) * len,
          y: center.y + Math.sin(rad) * len,
        }
      }

      items.push({
        id: placement.id,
        center,
        bounds,
        labelPos,
        labelBox,
        orientationEnd,
      })
    })

    return items
  }, [
    enabled,
    placements,
    visiblePlacements,
    labelPositions,
    tempLabelPositions,
    tempDragPositions,
    tempRotations,
    baseSymbolSizePx,
    planLabelFontSize,
    fontFamily,
    getEndpointById,
    getPlacementWorldBoundsMemo,
  ])

  if (process.env.NODE_ENV === 'production' || !enabled || debugItems.length === 0) {
    return null
  }

  return (
    <Group listening={false}>
      {debugItems.map((item) => {
        const { id, center, bounds, labelPos, labelBox, orientationEnd } = item
        const width = bounds.right - bounds.left
        const height = bounds.bottom - bounds.top

        return (
          <Group key={id} listening={false}>
            {/* Placement selection/hover bounds */}
            <Rect
              x={bounds.left}
              y={bounds.top}
              width={width}
              height={height}
              stroke="#22c55e"
              strokeWidth={1}
              dash={[4, 3]}
              listening={false}
            />

            {/* Placement center */}
            <Circle
              x={center.x}
              y={center.y}
              radius={3}
              fill="#0ea5e9"
              listening={false}
            />

            {/* Orientation helper */}
            {orientationEnd && (
              <Line
                points={[center.x, center.y, orientationEnd.x, orientationEnd.y]}
                stroke="#f97316"
                strokeWidth={1.5}
                dash={[6, 4]}
                listening={false}
              />
            )}

            {/* Label debug: origin + leader + label box estimate */}
            {labelPos && (
              <>
                <Circle
                  x={labelPos.x}
                  y={labelPos.y}
                  radius={2.5}
                  fill="#db2777"
                  listening={false}
                />
                <Line
                  points={[center.x, center.y, labelPos.x, labelPos.y]}
                  stroke="#db2777"
                  strokeWidth={1}
                  dash={[4, 2]}
                  listening={false}
                />
                {labelBox && (
                  <Rect
                    x={labelBox.x}
                    y={labelBox.y}
                    width={labelBox.width}
                    height={labelBox.height}
                    stroke="#db2777"
                    strokeWidth={1}
                    dash={[3, 2]}
                    listening={false}
                  />
                )}
              </>
            )}
          </Group>
        )
      })}
    </Group>
  )
}

