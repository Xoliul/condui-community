import type { WireSegment } from '@/types/schema'
import { getLeftBiasedBusFeedStubX } from '@/lib/panel/panelBusFeedPreview'
import { getPhaseLabelTextLayout } from '@/lib/wireTextLabel'

export interface BusFeedMarkerPoint {
  x: number
  y: number
}

export interface BusFeedMarkerBounds {
  x: number
  y: number
  width: number
  height: number
}

const FEED_MARKER_LABEL_HALF_WIDTH = 30
const FEED_MARKER_RAIL_OFFSET_Y = 16
const FEED_MARKER_LABEL_WIRE_CLEARANCE = 3
// Fits the longest shipped caption ("Secours/Réseau") at the rendered 7 px font.
const FEED_MARKER_LONG_LABEL_WIDTH = 70
/** Caption baseline relative to the feed symbol centre. */
export const BUS_FEED_MARKER_LABEL_Y = 10
const BUS_FEED_MARKER_LABEL_BOTTOM = BUS_FEED_MARKER_LABEL_Y + 9
const BUS_FEED_MARKER_STUB_OFFSET_Y = 11
/** Painted caption bottom relative to the end of a vertical supply stub. */
export const BUS_FEED_MARKER_STUB_BOTTOM =
  BUS_FEED_MARKER_STUB_OFFSET_Y + BUS_FEED_MARKER_LABEL_BOTTOM

export interface BusFeedMarkerLabelLayout {
  x: number
  width: number
  align: 'center' | 'right'
}

/** Shared anchor used by the renderer and layout debug bounds. */
export function getBusFeedMarkerPosition(wireSegment: WireSegment): BusFeedMarkerPoint {
  // Detached supply-frame rails reverse their rendered endpoints when the
  // assembly is mirrored. Marker placement is visual rather than directional,
  // so calculate from the physical left/right rail edges in either layout.
  const railLeftX = Math.min(wireSegment.startPoint.x, wireSegment.endPoint.x)
  const railRightX = Math.max(wireSegment.startPoint.x, wireSegment.endPoint.x)
  const stubX = getLeftBiasedBusFeedStubX(railLeftX, railRightX)
  const distance = railRightX - railLeftX
  switch (wireSegment.busFeedMarkerSide) {
    case 'left':
      return { x: wireSegment.startPoint.x - 24, y: wireSegment.startPoint.y - 10 }
    case 'right':
      return { x: wireSegment.endPoint.x + 4, y: wireSegment.startPoint.y - 10 }
    case 'below-left':
      return {
        // Mirror the grid marker's offset from the rail edge.
        x:
          wireSegment.busFeedKind === 'backup'
            ? railLeftX * 2 - stubX
            : stubX - distance,
        y: wireSegment.startPoint.y + FEED_MARKER_RAIL_OFFSET_Y,
      }
    case 'below-right':
      return { x: stubX + distance, y: wireSegment.startPoint.y + FEED_MARKER_RAIL_OFFSET_Y }
    case 'stub-center':
      return {
        x: wireSegment.startPoint.x,
        y: wireSegment.endPoint.y + BUS_FEED_MARKER_STUB_OFFSET_Y,
      }
    case 'below':
      return {
        x: (wireSegment.startPoint.x + wireSegment.endPoint.x) / 2 - 10,
        y: wireSegment.startPoint.y + 10,
      }
    default:
      return {
        x: wireSegment.endPoint.x,
        y: wireSegment.endPoint.y + BUS_FEED_MARKER_STUB_OFFSET_Y,
      }
  }
}

/**
 * Keep a switchable-backup caption clear of its adjacent feed riser.  Its text
 * grows leftward in every locale, while ordinary grid labels stay centered.
 */
export function getBusFeedMarkerLabelLayout(wireSegment: WireSegment): BusFeedMarkerLabelLayout {
  if (wireSegment.busFeedKind === 'backup' && wireSegment.busFeedMarkerSide === 'below-left') {
    const marker = getBusFeedMarkerPosition(wireSegment)
    const railCenterX = (wireSegment.startPoint.x + wireSegment.endPoint.x) / 2
    const rightEdgeX = railCenterX - FEED_MARKER_LABEL_WIRE_CLEARANCE
    return {
      x: rightEdgeX - marker.x - FEED_MARKER_LONG_LABEL_WIDTH,
      width: FEED_MARKER_LONG_LABEL_WIDTH,
      align: 'right',
    }
  }
  return {
    x: -FEED_MARKER_LABEL_HALF_WIDTH,
    width: FEED_MARKER_LABEL_HALF_WIDTH * 2,
    align: 'center',
  }
}

/** Painted line + marker/label bounds for one actual generated feed stub or rail. */
export function getBusFeedMarkerPaintBounds(wireSegment: WireSegment): BusFeedMarkerBounds {
  const linePad = wireSegment.type === 'mainBus' ? 3 : 1
  let left = Math.min(wireSegment.startPoint.x, wireSegment.endPoint.x) - linePad
  let right = Math.max(wireSegment.startPoint.x, wireSegment.endPoint.x) + linePad
  let top = Math.min(wireSegment.startPoint.y, wireSegment.endPoint.y) - linePad
  let bottom = Math.max(wireSegment.startPoint.y, wireSegment.endPoint.y) + linePad

  if (wireSegment.showBusFeedMarker && wireSegment.busFeedKind) {
    const marker = getBusFeedMarkerPosition(wireSegment)
    const label = getBusFeedMarkerLabelLayout(wireSegment)
    // The symbol is 20×20 centered on the anchor. Its label starts just
    // beneath it, leaving clearance from the supply rail below.
    // and uses a 7 px font.
    left = Math.min(left, marker.x - 10, marker.x + label.x)
    right = Math.max(right, marker.x + 10, marker.x + label.x + label.width)
    top = Math.min(top, marker.y - 10)
    bottom = Math.max(bottom, marker.y + BUS_FEED_MARKER_LABEL_BOTTOM)
  }
  if (wireSegment.phaseLabelAnchor) {
    const phaseLabel = getPhaseLabelTextLayout(wireSegment)
    left = Math.min(left, wireSegment.phaseLabelAnchor.x + phaseLabel.x)
    right = Math.max(right, wireSegment.phaseLabelAnchor.x + phaseLabel.x + phaseLabel.width)
    top = Math.min(top, wireSegment.phaseLabelAnchor.y)
    bottom = Math.max(bottom, wireSegment.phaseLabelAnchor.y + 10)
  }

  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Bounds for an empty split rail before it becomes a generated wire segment. */
export function getSplitSupplyRailPaintBounds(
  startX: number,
  endX: number,
  y: number,
  kind: 'grid' | 'backup',
  mirrored = false
): BusFeedMarkerBounds {
  // Text remains readable after the supply frame is mirrored. Measure its
  // final side, then reflect the bounds back into packing coordinates.
  const bounds = getBusFeedMarkerPaintBounds({
    type: 'mainBus',
    startPoint: { x: mirrored ? -startX : startX, y },
    endPoint: { x: mirrored ? -endX : endX, y },
    showBusFeedMarker: true,
    busFeedKind: kind,
    busFeedMarkerSide: kind === 'backup'
      ? mirrored ? 'below-left' : 'below-right'
      : mirrored ? 'below-right' : 'below-left',
  } as WireSegment)
  return mirrored
    ? { ...bounds, x: -bounds.x - bounds.width }
    : bounds
}
