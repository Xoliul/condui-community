import type {
  SupplyMetadataCalloutGroupItem,
  SupplyMetadataCalloutGroupPlacement,
  SupplyMetadataCalloutRect,
} from '@/lib/supplyMetadataCallout'
import { getSupplyMetadataCalloutLeaderPoints } from '@/lib/supplyMetadataCallout'
import { layoutRectsOverlap, type OneWireLayoutRect } from './oneWireBlockLayout'

type Leader = [number, number, number, number]
type SupplyMetadataLayoutItem = SupplyMetadataCalloutGroupItem & {
  symbolWidth?: number
  symbolHeight?: number
}

/** Pack detached supply cards against the same measured ink used by the frame. */
export function placeSupplyMetadataCards(
  items: SupplyMetadataLayoutItem[],
  obstacles: OneWireLayoutRect[]
): Map<string, SupplyMetadataCalloutGroupPlacement> {
  const placed = new Map<string, SupplyMetadataCalloutGroupPlacement>()
  const occupied = [...obstacles]
  const leaders: Leader[] = []
  const gap = 8
  // Spatial order, independent of serialization order, keeps leaders local.
  const ordered = [...items].sort(
    (a, b) =>
      b.symbolPosition.y - a.symbolPosition.y ||
      a.symbolPosition.x - b.symbolPosition.x ||
      a.id.localeCompare(b.id)
  )
  for (const item of ordered) {
    const { x, y } = item.symbolPosition
    const preferredLeft =
      item.placement === 'upper-left'
        ? x - item.width - 28
        : item.placement === 'top-right'
          ? x + 28
          : x - item.width / 2
    const preferredTop = y - item.height - 28
    const xs = new Set([x - item.width / 2, x - item.width - 28, x + 28])
    const ys = new Set([y - item.height - 28, y - item.height / 2, y + 28])
    for (const rect of occupied) {
      xs.add(rect.x - item.width - gap)
      xs.add(rect.x + rect.width + gap)
      ys.add(rect.y - item.height - gap)
      ys.add(rect.y + rect.height + gap)
    }
    let best:
      {
        rect: OneWireLayoutRect
        leader: Leader
        preferenceDistance: number
        crossings: number
        score: number
      }
      | undefined
    for (const left of xs) {
      for (const top of ys) {
        const rect = { x: left, y: top, width: item.width, height: item.height }
        if (occupied.some((obstacle) => layoutRectsOverlap(rect, obstacle, gap))) continue
        const relativeLeader = getSupplyMetadataCalloutLeaderPoints({
          placement: { x: left - x, y: top - y },
          width: item.width,
          height: item.height,
          symbolWidth: item.symbolWidth ?? 30,
          symbolHeight: item.symbolHeight ?? 30,
          placementKind: 'top',
          adaptiveAnchors: true,
        })
        const leader: Leader = [
          relativeLeader[0] + x,
          relativeLeader[1] + y,
          relativeLeader[2] + x,
          relativeLeader[3] + y,
        ]
        const crossings =
          occupied.filter(
            (obstacle) =>
              !(
                x >= obstacle.x &&
                x <= obstacle.x + obstacle.width &&
                y >= obstacle.y &&
                y <= obstacle.y + obstacle.height
              ) && segmentHitsRect(leader, obstacle)
          ).length +
          leaders.filter(
            (previous) => segmentsCross(leader, previous) || segmentHitsRect(previous, rect)
          ).length
        const score =
          (leader[0] - leader[2]) ** 2 +
          (leader[1] - leader[3]) ** 2 +
          0.15 * ((left + item.width / 2 - x) ** 2 + (top + item.height / 2 - y) ** 2) +
          (top >= y ? 1 : 0)
        const preferenceDistance = item.placement
          ? (left - preferredLeft) ** 2 + (top - preferredTop) ** 2
          : 0
        if (
          !best ||
          preferenceDistance < best.preferenceDistance ||
          (preferenceDistance === best.preferenceDistance && crossings < best.crossings) ||
          (preferenceDistance === best.preferenceDistance &&
            crossings === best.crossings &&
            score < best.score)
        ) {
          best = { rect, leader, preferenceDistance, crossings, score }
        }
      }
    }
    // Obstacle-edge candidates always include free space outside the drawing.
    if (!best) throw new Error(`Unable to place supply metadata: ${item.id}`)
    const rect: SupplyMetadataCalloutRect = {
      left: best.rect.x,
      top: best.rect.y,
      right: best.rect.x + item.width,
      bottom: best.rect.y + item.height,
    }
    placed.set(item.id, { ...item, x: rect.left - x, y: rect.top - y, rect })
    occupied.push(best.rect)
    leaders.push(best.leader)
  }
  return placed
}

function segmentsCross(a: Leader, b: Leader): boolean {
  const side = (line: Leader, x: number, y: number) =>
    (line[2] - line[0]) * (y - line[1]) - (line[3] - line[1]) * (x - line[0])
  return (
    side(a, b[0]!, b[1]!) * side(a, b[2]!, b[3]!) < 0 &&
    side(b, a[0]!, a[1]!) * side(b, a[2]!, a[3]!) < 0
  )
}

function segmentHitsRect(line: Leader, rect: OneWireLayoutRect): boolean {
  let enter = 0
  let exit = 1
  for (const [start, delta, minimum, maximum] of [
    [line[0], line[2] - line[0], rect.x, rect.x + rect.width],
    [line[1], line[3] - line[1], rect.y, rect.y + rect.height],
  ] as Array<[number, number, number, number]>) {
    if (delta === 0) {
      if (start < minimum || start > maximum) return false
    } else {
      const a = (minimum - start) / delta
      const b = (maximum - start) / delta
      enter = Math.max(enter, Math.min(a, b))
      exit = Math.min(exit, Math.max(a, b))
      if (enter > exit) return false
    }
  }
  return true
}
