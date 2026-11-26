import { useMemo } from 'react'
import { getBranchDropPreviewUnit, type BranchDropTargets } from '@/lib/layout/branchDropInteraction'
import { getDropZoneHintProximityForDistance } from '@/lib/layout/dropZoneHintDeclutter'
import { getSupplyTapLaneZone } from '@/lib/layout/supplyTapDropTargets'
import type { DropZoneRect } from '@/lib/layout/newLineDropZone'
import { LocalSvgCanvasOverlay, type CanvasSvgOverlayItem } from '../shared/LocalSvgCanvasOverlay'

const TAP_ZONE_PREFIX = 'supply-tap-zone-'

/** A drop inside a dashed box starts a new line (supply tap, fork, riser); rings insert into an existing one. */
function DropZoneBox({ zone, active, unit, strokeUnit }: {
  zone: DropZoneRect; active: boolean; unit: number; strokeUnit: number
}) {
  return <rect x={zone.left} y={zone.top} width={zone.right - zone.left} height={zone.bottom - zone.top}
    rx={3 * unit} fill={active ? 'rgba(2,132,199,0.12)' : 'rgba(2,132,199,0.05)'}
    stroke="#0284c7" strokeWidth={strokeUnit} strokeDasharray={`${4 * unit} ${3 * unit}`} />
}

/** Where the lead from the wire meets the box. */
const leadEnd = (zone: DropZoneRect, wire: { x: number; y: number }) => ({
  x: Math.max(zone.left, Math.min(zone.right, wire.x)), y: Math.max(zone.top, Math.min(zone.bottom, wire.y)),
})

// Tap zones are wide; they stay visible while dragging instead of fading with pointer distance.
const pointerOpacity = (item: CanvasSvgOverlayItem, distance: number | null) =>
  item.id.startsWith(TAP_ZONE_PREFIX) ? item.opacity ?? 0.45
    : item.opacity === 1 ? 1
      : (item.opacity ?? 0.12) + (1 - (item.opacity ?? 0.12)) * getDropZoneHintProximityForDistance(distance ?? Infinity)

export function BranchDropHints({ targets, activeId, zoom }: {
  targets: BranchDropTargets; activeId: string | null; zoom: number
}) {
  const items = useMemo<CanvasSvgOverlayItem[]>(() => {
    const strokeUnit = 1 / zoom
    const unit = getBranchDropPreviewUnit(zoom)
    // Where a drop starts a T: a dashed zone above the wire, clear of the wire's own drop zone.
    const tapZones = (targets.supplyTapLanes ?? []).map((lane): CanvasSvgOverlayItem => {
      const zone = getSupplyTapLaneZone(lane)
      const active = lane.slots.some((slot) => slot.id === activeId)
      return {
        id: `${TAP_ZONE_PREFIX}${lane.diagramId}-${lane.left}-${lane.y}`,
        opacity: active ? 1 : 0.45,
        bounds: { x: zone.left - strokeUnit, y: zone.top - strokeUnit,
          width: zone.right - zone.left + 2 * strokeUnit, height: zone.bottom - zone.top + 2 * strokeUnit },
        content: <DropZoneBox zone={zone} active={active} unit={unit} strokeUnit={strokeUnit} />,
      }
    })
    return [...tapZones, ...targets.intents.map((intent) => {
      const { point, wirePoint: wire, zone } = intent
      if (zone) {
        const active = intent.id === activeId
        const end = leadEnd(zone, wire)
        const left = Math.min(zone.left, wire.x) - strokeUnit, top = Math.min(zone.top, wire.y) - strokeUnit
        return {
          id: `branch-drop-${intent.id}`, pointerAnchor: point,
          opacity: active ? 1 : intent.kind === 'riser' ? 0.5 : 0.4,
          bounds: { x: left, y: top, width: Math.max(zone.right, wire.x) + strokeUnit - left, height: Math.max(zone.bottom, wire.y) + strokeUnit - top },
          content: <>
            <line x1={wire.x} y1={wire.y} x2={end.x} y2={end.y} stroke="#0284c7" strokeWidth={strokeUnit} strokeDasharray={`${3 * unit} ${3 * unit}`} />
            <DropZoneBox zone={zone} active={active} unit={unit} strokeUnit={strokeUnit} />
          </>,
        }
      }
      const radius = 4.5 * unit
      const padding = radius + 1.5 * strokeUnit
      const left = Math.min(point.x, wire.x) - padding
      const top = Math.min(point.y, wire.y) - padding
      return {
        id: `branch-drop-${intent.id}`, pointerAnchor: point,
        opacity: intent.id === activeId ? 1 : 0.12,
        bounds: { x: left, y: top, width: Math.abs(point.x - wire.x) + padding * 2,
          height: Math.abs(point.y - wire.y) + padding * 2 },
        content: intent.kind === 'multiply' && intent.id === activeId ? null : <>
          {!intent.id.includes('/body/') && (point.x !== wire.x || point.y !== wire.y) &&
            <line x1={point.x} y1={point.y} x2={wire.x} y2={wire.y}
              stroke="#0284c7" strokeWidth={strokeUnit} strokeDasharray={`${3 * unit} ${3 * unit}`} />}
          <circle cx={point.x} cy={point.y} r={radius} fill="rgba(2,132,199,0.08)"
            stroke="#0284c7" strokeWidth={strokeUnit}
            strokeDasharray={intent.kind === 'multiply' ? undefined : `${3 * unit} ${2 * unit}`} />
          {intent.kind === 'multiply' && <path
            d={`M${point.x - 2.5 * unit},${point.y}h${5 * unit}M${point.x},${point.y - 2.5 * unit}v${5 * unit}`}
            stroke="#0284c7" strokeWidth={1.2 * strokeUnit} />}
        </>,
      }
    })]
  }, [targets, activeId, zoom])
  return <LocalSvgCanvasOverlay name="branch-drop-hints" items={items} pointerOpacity={pointerOpacity} />
}
