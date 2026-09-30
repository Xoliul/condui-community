import { useMemo } from 'react'
import { Circle, Group, Label, Tag, Text } from 'react-konva'
import { screenPxToCanvasUnits } from '@/constants/canvasConstants'
import { useCanvasFontFamily } from '@/editions/community/communityHooks'
import {
  cableRouteLengthText,
  formatCableMetres,
  polylineMidpoint,
  selectedCableRouteAnchors,
} from '@/lib/cableRouting/cableRouteSelection'
import type { CableRouteEstimate, CableRouteLeg } from '@/lib/cableRouting/estimateCableRoutes'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import { PLAN_WIRE_SELECTED_STROKE, planWireStrokeWidth } from '@/lib/plan/planWiring'
import type { ThemeMode } from '@/lib/theme/types'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import type { Point2 } from '@/types/schema'
import { useCableRouteEstimation } from './useCableRouteEstimation'

type HorizontalLeg = Extract<CableRouteLeg, { kind: 'horizontal' }>

/**
 * Height information for the selected cable on the situation plan. The wire itself is drawn by
 * the plan wire layer in the selection colour; this adds where it rises or drops (↑/↓ with the
 * vertical length), riser markers for floor changes, and the cable length. View-only.
 */
export function PlanSelectedCableRoutes({
  floorId,
  zoom,
  theme,
}: {
  floorId: string
  zoom: number
  theme: ThemeMode
}) {
  const selection = useUIStore((s) => s.selection)
  // Only estimate while something that can map to a cable is selected.
  const relevant =
    Boolean(selection.wireAnchor) ||
    (selection.wireMetadata?.length ?? 0) > 0 ||
    selection.type === 'circuit' ||
    selection.type === 'endpoint'
  const estimation = useCableRouteEstimation(relevant)
  const project = useProjectStore((s) => s.currentProject)
  const fontFamily = useCanvasFontFamily()
  const selectedRoutes = useMemo(() => {
    if (!estimation) return []
    const anchors = selectedCableRouteAnchors(selection, estimation.routes)
    return estimation.routes.filter(
      (route) => anchors.has(route.anchor) || route.aliasAnchors?.some((alias) => anchors.has(alias))
    )
  }, [estimation, selection])
  const floorNames = useMemo(
    () =>
      new Map(
        (project ? selectProjectBuildingFloors(project) : []).map((floor) => [floor.id, floor.name])
      ),
    [project]
  )
  if (selectedRoutes.length === 0) return null

  const stroke = PLAN_WIRE_SELECTED_STROKE
  const width = planWireStrokeWidth(zoom) * 2
  const fontSize = screenPxToCanvasUnits(zoom, 10, 8, 13)
  const marker = screenPxToCanvasUnits(zoom, 4, 3, 7)
  const tagFill = theme === 'dark' ? '#111827' : '#ffffff'
  const textFill = theme === 'dark' ? '#e5e7eb' : '#1f2937'

  const label = (key: string, pos: Point2, text: string) => (
    <Label key={key} x={pos.x} y={pos.y} listening={false}>
      <Tag fill={tagFill} opacity={0.9} cornerRadius={fontSize * 0.25} />
      <Text
        text={text}
        fill={textFill}
        fontSize={fontSize}
        fontFamily={fontFamily}
        padding={fontSize * 0.2}
      />
    </Label>
  )

  const renderMarker = (route: CableRouteEstimate, leg: CableRouteLeg, index: number) => {
    const key = `${route.anchor}:marker:${index}`
    if (leg.kind === 'vertical' && leg.floorId === floorId) {
      const up = leg.toHeightM > leg.fromHeightM
      return (
        <Group key={key} listening={false}>
          <Circle x={leg.pos.x} y={leg.pos.y} radius={marker} fill={stroke} />
          {label(
            `${key}:label`,
            { x: leg.pos.x + marker * 1.6, y: leg.pos.y - fontSize * (up ? 1.6 : 0.2) },
            `${up ? '↑' : '↓'} ${formatCableMetres(leg.lengthM)} m`
          )}
        </Group>
      )
    }
    if (leg.kind === 'riser' && (leg.fromFloorId === floorId || leg.toFloorId === floorId)) {
      const other = leg.fromFloorId === floorId ? leg.toFloorId : leg.fromFloorId
      return (
        <Group key={key} listening={false}>
          <Circle
            x={leg.pos.x}
            y={leg.pos.y}
            radius={marker * 2.4}
            stroke={stroke}
            strokeWidth={width}
          />
          <Circle
            x={leg.pos.x}
            y={leg.pos.y}
            radius={marker * 1.3}
            stroke={stroke}
            strokeWidth={width}
          />
          {label(
            `${key}:label`,
            { x: leg.pos.x + marker * 3, y: leg.pos.y - fontSize * 0.6 },
            `↕ ${floorNames.get(other) ?? ''} · ${formatCableMetres(leg.lengthM)} m`
          )}
        </Group>
      )
    }
    return null
  }

  return (
    <Group name="plan-selected-cable-routes" listening={false}>
      {selectedRoutes.map((route) => {
        const lengthText = cableRouteLengthText(route)
        const labelLeg = route.legs
          .filter(
            (leg): leg is HorizontalLeg => leg.kind === 'horizontal' && leg.floorId === floorId
          )
          .sort((a, b) => b.highM - a.highM)[0]
        return (
          <Group key={route.anchor} listening={false}>
            {route.legs.map((leg, index) => renderMarker(route, leg, index))}
            {labelLeg &&
              lengthText &&
              label(`${route.anchor}:length`, polylineMidpoint(labelLeg.points), lengthText)}
          </Group>
        )
      })}
    </Group>
  )
}
