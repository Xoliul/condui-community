import { applyNodeWireInset, getNodeConnectionAnchor } from './circuitWireDerivationSupport'

import { type LayoutNode } from './layoutTree'
import type { WireSegment, Point2, TrunkDevice } from '@/types/schema'

import { supportsCircuitConverterDcConnections } from './circuitConverterGeometry'
import { getSupplyConverterDcConnectionIndex } from '@/lib/supplyAssembly/converterDcConnections'

/**
 * Supply layouts are mirrored after their wires are derived, while a selectable DC bus is
 * normalized to grow toward the outside of the final frame. Re-anchor its incoming side lead
 * from the final converter edge to the final rail endpoint so the asymmetric rail geometry
 * cannot inherit the pre-mirror attachment point.
 */
export function alignSupplyDcBusConnectionLeads(
  panelNode: LayoutNode,
  segments: WireSegment[]
): void {
  const supplyNodes = panelNode.children.filter(
    (node) => node.type === 'trunkDevice' && node.id.startsWith('supplyTrunkDevice-')
  )
  const converterNode = supplyNodes.find((node) => {
    const device = node.domainRef as TrunkDevice | undefined
    return (
      !!device &&
      supportsCircuitConverterDcConnections(device) &&
      (device.supplyPath === 'converter-branch' || device.supplyPath === 'backup')
    )
  })
  if (!converterNode) return

  for (const busNode of supplyNodes) {
    const busDevice = busNode.domainRef as TrunkDevice | undefined
    if (
      busDevice?.type !== 'dc_bus' ||
      getSupplyConverterDcConnectionIndex(busDevice) !== 0 ||
      !busNode.connectionAnchor
    ) {
      continue
    }
    const busEndpoint = `device:${busDevice.id}`
    const lead = segments.find(
      (segment) =>
        segment.domain === 'DC' &&
        segment.supplySectionKey?.includes(':converter-dc-right:') === true &&
        (segment.supplySectionKey.includes(`:${busEndpoint}<>`) ||
          segment.supplySectionKey.endsWith(`<>${busEndpoint}`))
    )
    if (!lead) continue
    const converterAnchor = getNodeConnectionAnchor(converterNode)
    const inlineDcNodes = supplyNodes.filter((node) => {
      const device = node.domainRef as TrunkDevice | undefined
      return (
        device != null &&
        device.id !== busDevice.id &&
        device.id !== converterNode.domainId &&
        device.type !== 'dc_bus' &&
        !device.supplyDcBusId &&
        getSupplyConverterDcConnectionIndex(device) === 0
      )
    })
    const inlineDcNode = inlineDcNodes.reduce(
      (selected, candidate) => {
        if (!selected) return candidate
        return converterAnchor.x >= candidate.bounds.x
          ? candidate.bounds.x < selected.bounds.x
            ? candidate
            : selected
          : candidate.bounds.x > selected.bounds.x
            ? candidate
            : selected
      },
      undefined as LayoutNode | undefined
    )
    lead.startPoint = inlineDcNode
      ? applyNodeWireInset(
          getNodeConnectionAnchor(inlineDcNode),
          busNode.connectionAnchor,
          inlineDcNode
        )
      : applyNodeWireInset(converterAnchor, busNode.connectionAnchor, converterNode)
    lead.endPoint = { ...busNode.connectionAnchor }
    lead.type = 'branch'
  }
}

/**
 * In a mirrored panel whose split feeds have no protections, the two short
 * bus rails remain in the panel frame while their supply risers are mirrored
 * with the lower assembly.  Centre each rendered rail on its own riser so the
 * busbar, wire and grid/backup marker stay one visual unit.
 */
export function alignInlineSplitBusRailsToFeedRisers(
  segments: WireSegment[],
  mirrorScope: 'panel' | 'supply'
): void {
  if (mirrorScope !== 'supply') return

  const rails = segments.filter(
    (segment) =>
      segment.type === 'mainBus' &&
      segment.showBusFeedMarker === true &&
      segment.busSectionId != null
  )
  for (const rail of rails) {
    const busY = rail.startPoint.y
    const riser = segments.find(
      (segment) =>
        segment.type === 'vertical' &&
        segment.isSupplyTrunk === true &&
        !segment.id.startsWith('bus-feed-protection-wire-') &&
        !segment.id.startsWith('bus-feed-stub-') &&
        segment.busSectionId === rail.busSectionId &&
        (segment.startPoint.y === busY || segment.endPoint.y === busY)
    )
    if (!riser) continue

    const riserPoint = riser.startPoint.y === busY ? riser.startPoint : riser.endPoint
    const railCenterX = (rail.startPoint.x + rail.endPoint.x) / 2
    const offsetX = riserPoint.x - railCenterX
    rail.startPoint = { ...rail.startPoint, x: rail.startPoint.x + offsetX }
    rail.endPoint = { ...rail.endPoint, x: rail.endPoint.x + offsetX }
  }
}

export function mirrorWireSegmentHorizontally(segment: WireSegment, axisX: number): void {
  const mirrorX = (x: number) => axisX * 2 - x
  // Adjacent segments may share a zero-inset waypoint. Replace point objects so that
  // mirroring one segment cannot mirror its neighbor's endpoint a second time.
  segment.startPoint = { ...segment.startPoint, x: mirrorX(segment.startPoint.x) }
  segment.endPoint = { ...segment.endPoint, x: mirrorX(segment.endPoint.x) }
  if (segment.phaseLabelAnchor) {
    segment.phaseLabelAnchor = {
      ...segment.phaseLabelAnchor,
      x: mirrorX(segment.phaseLabelAnchor.x),
    }
  }
  if (segment.junctionPoint) {
    segment.junctionPoint = { ...segment.junctionPoint, x: mirrorX(segment.junctionPoint.x) }
  }
  if (segment.wireLabelBaseEndPoint) {
    segment.wireLabelBaseEndPoint = {
      ...segment.wireLabelBaseEndPoint,
      x: mirrorX(segment.wireLabelBaseEndPoint.x),
    }
  }
  if (segment.wireLabelEndPoint) {
    segment.wireLabelEndPoint = {
      ...segment.wireLabelEndPoint,
      x: mirrorX(segment.wireLabelEndPoint.x),
    }
  }
  if (segment.supplySeparatorX != null) {
    segment.supplySeparatorX = mirrorX(segment.supplySeparatorX)
  }
  if (segment.busFeedMarkerSide === 'left') segment.busFeedMarkerSide = 'right'
  else if (segment.busFeedMarkerSide === 'right') segment.busFeedMarkerSide = 'left'
  else if (segment.busFeedMarkerSide === 'below-left') segment.busFeedMarkerSide = 'below-right'
  else if (segment.busFeedMarkerSide === 'below-right') segment.busFeedMarkerSide = 'below-left'
}

/** Dot where a supply tap leaves the grid lane: the tap's wire that starts on the lane. */
export function markSupplyTapJunction(tapSegments: WireSegment[], laneY: number): void {
  const onLane = (point: Point2) => Math.abs(point.y - laneY) < 0.5
  const first = tapSegments.find(
    (wire) => wire.type !== 'mainBus' && onLane(wire.startPoint) !== onLane(wire.endPoint)
  )
  if (!first) return
  first.junctionPoint = { ...(onLane(first.startPoint) ? first.startPoint : first.endPoint) }
}

/**
 * Mark every true T junction among supply wires with a dot: three or more wire ends meeting
 * at a point without all being collinear, or a wire end landing on the inside of another
 * wire. Corners (two ends) and straight continuations get none.
 */
export function markSupplyTJunctions(candidates: WireSegment[]): void {
  const wires = candidates.filter((wire) => wire.type !== 'mainBus' && wire.domain !== 'DC')
  const key = (point: Point2) => `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`
  const ends = new Map<string, { point: Point2; directions: Point2[]; wires: WireSegment[] }>()
  for (const wire of wires) {
    for (const [point, other] of [
      [wire.startPoint, wire.endPoint],
      [wire.endPoint, wire.startPoint],
    ] as const) {
      const length = Math.hypot(other.x - point.x, other.y - point.y)
      if (length < 1e-6) continue
      const entry = ends.get(key(point)) ?? { point, directions: [], wires: [] }
      entry.directions.push({ x: (other.x - point.x) / length, y: (other.y - point.y) / length })
      entry.wires.push(wire)
      ends.set(key(point), entry)
    }
  }
  const marked = new Set<string>()
  const mark = (point: Point2, wire: WireSegment) => {
    if (marked.has(key(point))) return
    marked.add(key(point))
    wire.junctionPoint = { x: point.x, y: point.y }
  }
  for (const [pointKey, { point, directions, wires: atPoint }] of ends) {
    if (directions.length >= 3) {
      const bends = directions.some((a, index) =>
        directions.slice(index + 1).some((b) => Math.abs(a.x * b.y - a.y * b.x) > 1e-3)
      )
      if (bends) mark(point, atPoint[0]!)
      continue
    }
    // A wire end on the inside of another, perpendicular wire.
    for (const wire of wires) {
      if (atPoint.includes(wire)) continue
      const { startPoint: a, endPoint: b } = wire
      const horizontal = Math.abs(a.y - b.y) < 0.01
      const vertical = Math.abs(a.x - b.x) < 0.01
      const inside = horizontal
        ? Math.abs(point.y - a.y) < 0.01 &&
          point.x > Math.min(a.x, b.x) + 0.5 &&
          point.x < Math.max(a.x, b.x) - 0.5
        : vertical
          ? Math.abs(point.x - a.x) < 0.01 &&
            point.y > Math.min(a.y, b.y) + 0.5 &&
            point.y < Math.max(a.y, b.y) - 0.5
          : false
      if (inside && !marked.has(pointKey)) mark(point, atPoint[0]!)
    }
  }
}
