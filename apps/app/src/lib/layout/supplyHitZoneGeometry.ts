/**
 * Geometry shared by the detached supply frame's wire hit zones.
 *
 * The drawn wires come from deriveWires, which re-derives several positions from the positioned
 * nodes (the changeover riser, the bus feed stubs). The hit zones are built earlier from layout
 * fields, so every position that deriveWires re-derives is resolved here from the same inputs.
 * Coordinates are the canonical (right-to-left) coordinates of the hit zone builders.
 */
import type { Panel } from '@/types/schema'
import { getLeftBiasedBusFeedStubX } from '@/lib/panel/panelBusFeedPreview'
import { hasExplicitPanelBusSections } from '@/lib/panel/panelBusSections'
import type { BottomUpPanelLayout } from './bottomUpLayout'
import { LAYOUT_CONSTANTS } from './bottomUpLayoutConstants'
import type { LayoutNode } from './layoutTree'

type SupplyDevicePlacement = NonNullable<BottomUpPanelLayout['supplyDevices']>[number]

/**
 * X of the feed stub deriveWires draws from the first bus run of a role: the run is the merged
 * run of that section's bus segments, and the stub leaves it left-biased.
 */
export function resolveSupplyBusRunStubX(
  busSegmentNodes: readonly LayoutNode[],
  panel: Panel,
  role: 'normal' | 'backup'
): number | undefined {
  const sectionIds = new Set(
    (panel.busSections ?? [])
      .filter((section) => section.role === role)
      .map((section) => section.id)
  )
  if (sectionIds.size === 0) return undefined
  const spans = busSegmentNodes
    .filter(
      (node) =>
        node.id.startsWith('main-bus-segment-') &&
        node.hitZone?.busSectionId != null &&
        sectionIds.has(node.hitZone.busSectionId)
    )
    .map((node) => ({ start: node.bounds.x, end: node.bounds.x + node.bounds.width }))
    .sort((left, right) => left.start - right.start)
  const first = spans[0]
  if (!first) return undefined
  let runEnd = first.end
  for (const span of spans.slice(1)) {
    if (Math.abs(span.start - runEnd) >= 0.01) break
    runEnd = Math.max(runEnd, span.end)
  }
  return getLeftBiasedBusFeedStubX(first.start, runEnd)
}

/**
 * X of the riser the changeover's two branch wires turn at, as deriveWires draws it. It is the
 * port-1 device's position when that riser carries devices; otherwise a fixed lead beside the
 * switch, even when the layout widened its own elbow for neighbouring labels.
 */
export function resolveDrawnChangeoverElbowX(
  panelLayout: BottomUpPanelLayout,
  devices: readonly SupplyDevicePlacement[]
): number {
  const branches = panelLayout.supplyChangeoverBranches!
  const fixedElbowX =
    branches.x +
    LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE / 2 +
    LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_ELBOW_LEAD
  const usesConverterInputTap =
    branches.converterInputTap != null &&
    devices.some(({ device }) => device.supplyPath === 'backup')
  if (usesConverterInputTap) return fixedElbowX
  return (
    devices.find(
      ({ device }) =>
        device.supplyPath === 'changeover-grid' && device.changeoverGridPlacement === 'input-leg'
    )?.x ?? fixedElbowX
  )
}

/**
 * X where the changeover's grid rail ends away from the switch: the grid bus run's feed stub, else
 * (no grid bus section) beside the earth electrode, else a lead right of the main bus. The rail
 * hit zones (layoutTreeMainBus) and the drawn rail (deriveWires) both start here.
 */
export function resolveChangeoverGridRailStartX(
  gridBusStubX: number | undefined,
  groundX: number | undefined,
  mainBusX: number
): number {
  return gridBusStubX ?? groundX ?? mainBusX + 20
}

/**
 * Whether the changeover's grid rail is drawn at all: only with a grid bus section or an inline
 * changeover-grid device. An empty rail has no wire, so it gets no insertion zone either.
 */
export function isChangeoverGridRailDrawn(
  gridBusStubX: number | undefined,
  inlineGridDeviceCount: number
): boolean {
  return gridBusStubX != null || inlineGridDeviceCount > 0
}

/** Hit zone fields shared by the nodes of one supply insertion section. */
export type SupplyWireHitZone = NonNullable<LayoutNode['hitZone']>

const HIT_PAD = 10

/** Horizontal wire hit node between two x positions, padded around the wire. */
export function horizontalSupplyHitNode(
  id: string,
  x1: number,
  x2: number,
  y: number,
  hitZone: SupplyWireHitZone
): LayoutNode | null {
  const left = Math.min(x1, x2)
  const right = Math.max(x1, x2)
  if (right <= left) return null
  return {
    id,
    type: 'wire',
    bounds: {
      x: left - HIT_PAD,
      y: y - HIT_PAD,
      width: right - left + HIT_PAD * 2,
      height: HIT_PAD * 2,
    },
    hitZone,
    children: [],
  }
}

/** Vertical wire hit node between two y positions, padded around the wire. */
export function verticalSupplyHitNode(
  id: string,
  x: number,
  y1: number,
  y2: number,
  hitZone: SupplyWireHitZone
): LayoutNode | null {
  const top = Math.min(y1, y2)
  const bottom = Math.max(y1, y2)
  if (bottom <= top) return null
  return {
    id,
    type: 'wire',
    bounds: {
      x: x - HIT_PAD,
      y: top - HIT_PAD,
      width: HIT_PAD * 2,
      height: bottom - top + HIT_PAD * 2,
    },
    hitZone,
    children: [],
  }
}

/** Vertical y at which deriveWires ends the earth wire: the grid lane of a split-bus supply. */
export function resolveGroundWireTopY(
  panelLayout: BottomUpPanelLayout,
  mainBusY: number,
  hasMainBusConnections: boolean
): number {
  const detachedGridGround =
    (panelLayout.frameRole === 'supply' ||
      (panelLayout.frameRole === 'panel' &&
        panelLayout.panel.isMain === true &&
        !hasMainBusConnections)) &&
    hasExplicitPanelBusSections(panelLayout.panel)
  return detachedGridGround && panelLayout.supply ? panelLayout.supply.y : mainBusY
}
