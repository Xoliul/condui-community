
import React from 'react'
import { Group, Rect } from 'react-konva'
import type Konva from 'konva'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { planSymbolColor } from '@/lib/plan/planColors'
import { selectProjectPlanWiringVisibility } from '@/lib/projectV2/planWiring'
import { getElectricalLookupIndex } from '@/lib/projectV2/electricalLookupIndex'
import { findProjectTrunkDevice } from '@/lib/projectV2/trunkDeviceLookup'
import { useThemeColors } from '@/lib/theme/hooks'
import { usePlanPlacementViewport, type PlacementViewportExtent } from './usePlanPlacementViewport'
import type { Endpoint, Placement, Point2, TrunkDevice } from '@/types/schema'
import { PlacementSymbol } from './PlacementSymbol'
import {
  PlanPlacementLabelEntry,
  PlanPlacementLightWaterproofH,
  PlanPlacementSocketWaterproofH,
} from './PlanPlacementDragFollowers'

type PlacementRow = Placement & {
  endpointId?: string
  trunkDeviceId?: string
  enclosureId?: string
  planLabel?: string
  junctionPanelLabel?: string
}

type MultiSelectHandlers = {
  onMultiSelectDragStart: (draggedEndpointId: string) => void
  onMultiSelectDrag: (draggedEndpointId: string, newPos: Point2) => void
  onMultiSelectDragEnd: () => void
}

type SingleDragHandlers = {
  onDragStart: () => void
  onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => void
  onDragEnd: (finalPos: Point2) => void
}

function PlanPlacementOverviewSymbol({
  placement,
  color,
  size,
  interactive,
}: {
  placement: PlacementRow
  color: string
  size: number
  interactive: boolean
}) {
  const click = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!interactive || ('button' in event.evt && event.evt.button !== 0)) return
    const suppression = window as Window & { __eendraSuppressNextElementTap?: boolean }
    if (suppression.__eendraSuppressNextElementTap) {
      suppression.__eendraSuppressNextElementTap = false
      return
    }
    event.cancelBubble = true
    const state = useUIStore.getState()
    const selection = state.selection
    if (event.evt.shiftKey) {
      state.setSelection({
        type: 'placement',
        ids:
          selection.type === 'placement'
            ? [...new Set([...selection.ids, placement.id])]
            : [placement.id],
      })
    } else if (event.evt.altKey || event.evt.ctrlKey || event.evt.metaKey) {
      if (selection.type === 'placement' && selection.ids.includes(placement.id)) {
        const ids = selection.ids.filter((id) => id !== placement.id)
        if (ids.length === 0) state.clearSelection()
        else state.setSelection({ type: 'placement', ids })
      }
    } else state.setSelection({ type: 'placement', ids: [placement.id] })
  }
  return (
    <Group name={`placement-${placement.id}`} listening={interactive}>
      <Rect
        name={`endpoint-${placement.endpointId}`}
        x={placement.pos.x}
        y={placement.pos.y}
        width={size}
        height={size}
        offsetX={size / 2}
        offsetY={size / 2}
        rotation={placement.rotationDeg}
        fill={color}
        opacity={0.75}
        perfectDrawEnabled={false}
        onClick={click}
        onTap={click}
      />
    </Group>
  )
}

function placementBounds(placements: PlacementRow[], radius: number) {
  if (placements.length === 0) return null
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const placement of placements) {
    const padding = radius * Math.max(1, placement.scale)
    minX = Math.min(minX, placement.pos.x - padding)
    minY = Math.min(minY, placement.pos.y - padding)
    maxX = Math.max(maxX, placement.pos.x + padding)
    maxY = Math.max(maxY, placement.pos.y + padding)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

const structuralSignatureCache = new WeakMap<object, string>()

function structuralSignature(value: object): string {
  const cached = structuralSignatureCache.get(value)
  if (cached !== undefined) return cached
  const signature = JSON.stringify(value)
  structuralSignatureCache.set(value, signature)
  return signature
}

function sameDomainValue<T extends object | null>(previous: T, next: T): boolean {
  return (
    previous === next ||
    (previous !== null &&
      next !== null &&
      structuralSignature(previous) === structuralSignature(next))
  )
}

function usePlacementEndpoint(placement: PlacementRow): Endpoint | null {
  const endpointId = placement.endpointId
  return useStoreWithEqualityFn(
    useProjectStore,
    (state: ProjectState) => (endpointId ? (state.getEndpointById(endpointId) ?? null) : null),
    sameDomainValue
  )
}

function usePlacementTrunkDevice(placement: PlacementRow): TrunkDevice | null {
  const trunkDeviceId = placement.trunkDeviceId
  return useStoreWithEqualityFn(
    useProjectStore,
    (state: ProjectState) =>
      trunkDeviceId ? (state.getTrunkDeviceById(trunkDeviceId)?.device ?? null) : null,
    sameDomainValue
  )
}

const PlanPlacementSymbolEntry = React.memo(function PlanPlacementSymbolEntry({
  placement,
  baseSymbolSizePx,
  currentZoom,
  isDrawingToolActive,
  canDrag,
  snapPosition,
  isQuickPlacerCurrent,
  multiSelectHandlers,
  singleDragHandlers,
  fontFamily,
  simplified,
  proxyColor,
}: {
  placement: PlacementRow
  baseSymbolSizePx: number
  currentZoom: number
  isDrawingToolActive: boolean
  canDrag: boolean
  snapPosition: (position: Point2) => Point2
  isQuickPlacerCurrent: boolean
  multiSelectHandlers: MultiSelectHandlers
  singleDragHandlers: SingleDragHandlers
  fontFamily: string
  simplified: boolean
  proxyColor: string
}) {
  const endpoint = usePlacementEndpoint(placement)
  const trunkDevice = usePlacementTrunkDevice(placement)
  const colorOverride = useProjectStore((state) =>
    planSymbolColor(
      endpoint?.symbol,
      state.currentProject ? selectProjectPlanWiringVisibility(state.currentProject) : undefined
    )
  )

  if (
    simplified &&
    endpoint?.symbol &&
    endpoint.symbol !== 'panel_distribution' &&
    !placement.trunkDeviceId &&
    !placement.enclosureId &&
    !placement.junctionPanelLabel
  ) {
    return (
      <PlanPlacementOverviewSymbol
        placement={placement}
        color={colorOverride ?? proxyColor}
        size={baseSymbolSizePx * placement.scale}
        interactive={!isDrawingToolActive}
      />
    )
  }

  return (
    <>
      <PlacementSymbol
        placement={placement}
        sourceEndpoint={endpoint}
        sourceTrunkDevice={trunkDevice}
        baseSymbolSizePx={baseSymbolSizePx}
        currentZoom={currentZoom}
        isDrawingToolActive={isDrawingToolActive}
        canDrag={canDrag}
        snapPosition={snapPosition}
        isQuickPlacerCurrent={isQuickPlacerCurrent}
        {...multiSelectHandlers}
        {...singleDragHandlers}
      />
      {endpoint && (
        <PlanPlacementSocketWaterproofH
          placement={placement}
          endpoint={endpoint}
          baseSymbolSizePx={baseSymbolSizePx}
          fontFamily={fontFamily}
        />
      )}
      {endpoint && (
        <PlanPlacementLightWaterproofH
          placement={placement}
          endpoint={endpoint}
          baseSymbolSizePx={baseSymbolSizePx}
          fontFamily={fontFamily}
        />
      )}
    </>
  )
})

export const PlanPlacementSymbolsLayer = React.memo(function PlanPlacementSymbolsLayer({
  placements,
  baseSymbolSizePx,
  currentZoom,
  isDrawingToolActive,
  canDrag,
  snapPosition,
  quickPlacerPlacementId,
  multiSelectHandlers,
  getSingleDragHandlers,
  fontFamily,
}: {
  placements: PlacementRow[]
  baseSymbolSizePx: number
  currentZoom: number
  isDrawingToolActive: boolean
  canDrag: boolean
  snapPosition: (position: Point2) => Point2
  quickPlacerPlacementId?: string
  multiSelectHandlers: MultiSelectHandlers
  getSingleDragHandlers: (placement: PlacementRow) => SingleDragHandlers
  fontFamily: string
}) {
  const electrical = useProjectStore((state) => state.currentProject?.disciplines.electrical)
  const extents = React.useMemo(() => {
    const index = electrical ? getElectricalLookupIndex(electrical.panels) : null
    return new Map(
      placements.map((placement) => {
        const endpoint = placement.endpointId ? index?.endpointsById.get(placement.endpointId)?.endpoint : null
        // Multi-socket bodies and panel/overlay artwork can extend well beyond a
        // nominal symbol square. Keep a conservative envelope in canvas units.
        const radius =
          baseSymbolSizePx *
          Math.max(1, placement.scale) *
          Math.max(4, (endpoint?.socketProps?.socketCount ?? 1) * 2)
        return [placement.id, { pos: placement.pos, radius }] as const
      })
    )
  }, [placements, baseSymbolSizePx, electrical])
  const { mountGroup, visiblePlacements, fullDetail, isSelected, zoom: viewportZoom } =
    usePlanPlacementViewport(placements, currentZoom, extents)
  const colors = useThemeColors()
  const bounds = React.useMemo(
    () => placementBounds(placements, baseSymbolSizePx),
    [placements, baseSymbolSizePx]
  )
  return (
    <Group ref={mountGroup} name="plan-placement-symbol-details">
      {placements.length > 500 && bounds && (
        <Rect
          name="plan-placement-logical-bounds"
          {...bounds}
          fillEnabled={false}
          strokeEnabled={false}
          listening={false}
        />
      )}
      {visiblePlacements.map((placement) => (
        <PlanPlacementSymbolEntry
          key={placement.id}
          placement={placement}
          baseSymbolSizePx={baseSymbolSizePx}
          currentZoom={currentZoom}
          isDrawingToolActive={isDrawingToolActive}
          canDrag={canDrag}
          snapPosition={snapPosition}
          isQuickPlacerCurrent={quickPlacerPlacementId === placement.id}
          multiSelectHandlers={multiSelectHandlers}
          singleDragHandlers={getSingleDragHandlers(placement)}
          fontFamily={fontFamily}
          simplified={
            placements.length > 500 &&
            !fullDetail &&
            !isSelected(placement) &&
            quickPlacerPlacementId !== placement.id &&
            baseSymbolSizePx * placement.scale * viewportZoom < 12
          }
          proxyColor={colors.symbolColor}
        />
      ))}
    </Group>
  )
})

const PlanPlacementLabelEntryWithSource = React.memo(function PlanPlacementLabelEntryWithSource({
  placement,
  staticLabelPosition,
  labelFontSize,
}: {
  placement: PlacementRow
  staticLabelPosition?: Point2
  labelFontSize: number
}) {
  const endpoint = usePlacementEndpoint(placement)
  const trunkDevice = usePlacementTrunkDevice(placement)
  const labelText =
    endpoint?.label ?? placement.junctionPanelLabel ?? placement.planLabel ?? trunkDevice?.label
  if (!labelText) return null
  return (
    <PlanPlacementLabelEntry
      placementId={placement.id}
      labelText={labelText}
      symbol={
        placement.junctionPanelLabel
          ? 'junction_panel'
          : placement.enclosureId
            ? 'panel_distribution'
            : (endpoint?.symbol ?? trunkDevice?.symbol)
      }
      staticLabelPosition={staticLabelPosition}
      labelFontSize={labelFontSize}
    />
  )
})

export const PlanPlacementLabelsLayer = React.memo(function PlanPlacementLabelsLayer({
  placements,
  labelPositions,
  labelFontSize,
}: {
  placements: PlacementRow[]
  labelPositions: Map<string, Point2>
  labelFontSize: number
}) {
  const electrical = useProjectStore((state) => state.currentProject?.disciplines.electrical)
  const extents = React.useMemo(() => {
    const project = electrical ? { disciplines: { electrical } } : null
    const index = electrical ? getElectricalLookupIndex(electrical.panels) : null
    return new Map<string, PlacementViewportExtent>(
      placements.map((placement) => {
        const endpoint = placement.endpointId ? index?.endpointsById.get(placement.endpointId)?.endpoint : null
        const trunk = placement.trunkDeviceId && project
          ? findProjectTrunkDevice(project, placement.trunkDeviceId)?.device
          : null
        const text =
          endpoint?.label ??
          placement.junctionPanelLabel ??
          placement.planLabel ??
          trunk?.label ??
          ''
        // Two em per UTF-16 unit is deliberately wider than our supported fonts;
        // use the label anchor, including large manual offsets, rather than the symbol center.
        const radius = Math.max(text.length + 1, text.split('\n').length) * labelFontSize * 2
        return [placement.id, { pos: labelPositions.get(placement.id) ?? placement.pos, radius }]
      })
    )
  }, [placements, labelPositions, labelFontSize, electrical])
  const { mountGroup, visiblePlacements, fullDetail, isSelected, zoom: viewportZoom } =
    usePlanPlacementViewport(placements, undefined, extents)
  const logicalBounds = React.useMemo(() => {
    if (extents.size === 0) return null
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const { pos, radius } of extents.values()) {
      minX = Math.min(minX, pos.x - radius)
      minY = Math.min(minY, pos.y - radius)
      maxX = Math.max(maxX, pos.x + radius)
      maxY = Math.max(maxY, pos.y + radius)
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }, [extents])
  const visible =
    fullDetail || placements.length <= 500 || labelFontSize * viewportZoom >= 4
      ? visiblePlacements
      : visiblePlacements.filter(isSelected)
  return (
    <Group ref={mountGroup} name="plan-placement-label-details">
      {placements.length > 500 && logicalBounds && (
        <Rect
          name="plan-placement-logical-bounds"
          {...logicalBounds}
          fillEnabled={false}
          strokeEnabled={false}
          listening={false}
        />
      )}
      {visible.map((placement) => (
        <PlanPlacementLabelEntryWithSource
          key={`label-${placement.id}`}
          placement={placement}
          staticLabelPosition={labelPositions.get(placement.id)}
          labelFontSize={labelFontSize}
        />
      ))}
    </Group>
  )
})
