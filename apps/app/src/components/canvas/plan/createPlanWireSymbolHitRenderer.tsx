import { INTERACTIVE_OVERLAY_EXPORT_NAME } from '@/lib/export/interactiveOverlayExport'
import React from 'react'
import { Circle } from 'react-konva'
import type { Point } from '@/types/ui'
import type { Placement } from '@/types/schema'
import { screenPxToCanvasUnits } from '@/constants/canvasConstants'

interface PlanWireSymbolHitRendererOptions {
  activeTool: import('@/types/ui').PlanToolMode
  isExporting: boolean
  visiblePlacements: (import('@/types/schema').Placement & {
    endpointId?: string | undefined
    trunkDeviceId?: string | undefined
    enclosureId?: string | undefined
    planLabel?: string | undefined
    junctionPanelLabel?: string | undefined
    isEarthing?: boolean | undefined
  })[]
  planDragPositions: Map<string, import('@/types/ui').Point>
  baseSymbolSizePx: number
  planView: import('@/types/ui').ViewState
  planWireDragSourcePlacementId: string | null
  planWireHoverPlacementId: string | null
  getPlanWireTargetStatus: (targetPlacementId: string) => 'legal' | 'illegal' | null
  wiringRedrawProgress: { connected: number; total: number; openPlacementIds: Set<string> } | null
  wiringFocusPlacementIdSet: Set<string>
  applyPlanWireHoverPlacementId: React.Dispatch<React.SetStateAction<string | null>>
  applyPlanWirePreviewPoint: (point: Point | null) => void
  applyPlanWireDragSourcePlacementId: React.Dispatch<React.SetStateAction<string | null>>
}

export function createPlanWireSymbolHitRenderer({
  activeTool,
  isExporting,
  visiblePlacements,
  planDragPositions,
  baseSymbolSizePx,
  planView,
  planWireDragSourcePlacementId,
  planWireHoverPlacementId,
  getPlanWireTargetStatus,
  wiringRedrawProgress,
  wiringFocusPlacementIdSet,
  applyPlanWireHoverPlacementId,
  applyPlanWirePreviewPoint,
  applyPlanWireDragSourcePlacementId,
}: PlanWireSymbolHitRendererOptions) {
  const renderPlanWireSymbolHits = (core: boolean) =>
    activeTool === 'wiring' &&
    !isExporting &&
    visiblePlacements.map(
      (
        placement: Placement & {
          endpointId?: string
          trunkDeviceId?: string
          junctionPanelLabel?: string
          isEarthing?: boolean
        }
      ) => {
        const placementPos = planDragPositions.get(placement.id) ?? placement.pos
        const symbolHalf = (baseSymbolSizePx * (placement.scale ?? 1)) / 2
        const fullRadius = Math.max(screenPxToCanvasUnits(planView.zoom, 14, 8, 28), symbolHalf)
        const radius = core
          ? Math.min(
              fullRadius,
              Math.max(symbolHalf, screenPxToCanvasUnits(planView.zoom, 7, 4, 14))
            )
          : fullRadius
        const armed = planWireDragSourcePlacementId === placement.id
        const hovered = planWireHoverPlacementId === placement.id
        const status = hovered || armed ? getPlanWireTargetStatus(placement.id) : null
        // The working circuit's symbols get a faint ring; during a redraw, the ones still
        // waiting for a drawn wire get a dashed one.
        const waiting = !core && wiringRedrawProgress?.openPlacementIds.has(placement.id) === true
        const inFocus = !core && wiringFocusPlacementIdSet.has(placement.id)
        const stroke =
          !core && (armed || status === 'legal')
            ? '#0ea5e9'
            : !core && status === 'illegal'
              ? '#ef4444'
              : waiting
                ? '#0ea5e9'
                : inFocus
                  ? 'rgba(14,165,233,0.35)'
                  : undefined
        const ringDash =
          waiting && !armed && !status
            ? [
                screenPxToCanvasUnits(planView.zoom, 4, 2, 8),
                screenPxToCanvasUnits(planView.zoom, 3, 1.5, 6),
              ]
            : undefined
        return (
          <Circle
            key={`plan-wire-symbol-hit-${core ? 'core' : 'ring'}-${placement.id}`}
            name={`plan-wire-symbol-hit-${placement.id} ${INTERACTIVE_OVERLAY_EXPORT_NAME}`}
            x={placementPos.x}
            y={placementPos.y}
            radius={radius}
            fill="rgba(14,165,233,0.001)"
            stroke={stroke}
            dash={ringDash}
            strokeWidth={
              stroke
                ? screenPxToCanvasUnits(
                    planView.zoom,
                    inFocus && !waiting && !status && !armed ? 1.5 : 2,
                    1,
                    4
                  )
                : 0
            }
            listening
            onMouseEnter={() => {
              if (planWireDragSourcePlacementId) return
              applyPlanWireHoverPlacementId(placement.id)
              applyPlanWirePreviewPoint(placementPos)
            }}
            onMouseLeave={() => {
              if (planWireDragSourcePlacementId) return
              applyPlanWireHoverPlacementId((current) =>
                current === placement.id ? null : current
              )
            }}
            onPointerDown={(event) => {
              event.cancelBubble = true
              if (event.evt.button != null && event.evt.button !== 0) return
              if (getPlanWireTargetStatus(placement.id) !== 'legal') return
              applyPlanWireDragSourcePlacementId(placement.id)
              applyPlanWirePreviewPoint(placementPos)
            }}
            onPointerUp={(event) => {
              event.cancelBubble = true
            }}
          />
        )
      }
    )

  return { renderPlanWireSymbolHits }
}
