/* eslint-disable react/prop-types -- TypeScript prop contracts are the source of truth. */

import React from 'react'
import type Konva from 'konva'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
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
}) {
  const endpoint = usePlacementEndpoint(placement)
  const trunkDevice = usePlacementTrunkDevice(placement)

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
  return placements.map((placement) => (
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
    />
  ))
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
    endpoint?.label ?? trunkDevice?.label ?? placement.junctionPanelLabel ?? placement.planLabel
  if (!labelText) return null
  return (
    <PlanPlacementLabelEntry
      placementId={placement.id}
      labelText={labelText}
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
  return placements.map((placement) => (
    <PlanPlacementLabelEntryWithSource
      key={`label-${placement.id}`}
      placement={placement}
      staticLabelPosition={labelPositions.get(placement.id)}
      labelFontSize={labelFontSize}
    />
  ))
})
