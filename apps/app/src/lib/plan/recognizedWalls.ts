import { nanoid } from 'nanoid'
import type { Door, FloorPlan, Point2, Wall, Window } from '@/types/schema'
import type { VisionPlanReviewPage } from '@/lib/vision/visionReviewApi'
import { getWallNormalSide, resolveDoorDirectionForHinge } from './doorSwingFromPointer'

function validPoint(point: Point2 | undefined): point is Point2 {
  return (
    !!point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= 1 &&
    point.y >= 0 &&
    point.y <= 1
  )
}

export function recognizedWallsToFloorPlan(
  page: VisionPlanReviewPage,
  floorId: string,
  imageSize: { width: number; height: number },
  imageOffset: Point2 = { x: 0, y: 0 },
  existing?: FloorPlan
): FloorPlan {
  if (page.width <= 0 || page.height <= 0 || imageSize.width <= 0 || imageSize.height <= 0) {
    throw new Error('The recognized plan has invalid dimensions.')
  }
  const walls: Wall[] = [...(existing?.walls ?? [])]
  const sourceWallIds: Array<string | undefined> = []
  const samePoint = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y) <= 1
  const toCanvas = (point: Point2): Point2 => ({
    x: imageOffset.x + point.x * imageSize.width,
    y: imageOffset.y + point.y * imageSize.height,
  })
  for (const [index, item] of page.walls.entries()) {
    if (!validPoint(item.start) || !validPoint(item.end)) continue
    const start = toCanvas(item.start)
    const end = toCanvas(item.end)
    if (samePoint(start, end)) continue
    const matching = walls.find(
        (wall) =>
          wall.points.length === 2 &&
          ((samePoint(wall.points[0]!, start) && samePoint(wall.points[1]!, end)) ||
            (samePoint(wall.points[0]!, end) && samePoint(wall.points[1]!, start)))
      )
    if (matching) {
      sourceWallIds[index] = matching.id
      continue
    }
    const thicknessScale = imageSize.width / page.width
    const wall: Wall = {
      id: nanoid(),
      floorId,
      points: [start, end],
      thickness:
        item.thicknessPx && Number.isFinite(item.thicknessPx)
          ? Math.max(2, item.thicknessPx * thicknessScale)
          : undefined,
    }
    walls.push(wall)
    sourceWallIds[index] = wall.id
  }
  const locateOpening = (item: { start?: Point2; end?: Point2; supportWallIndex?: number }) => {
    if (!validPoint(item.start) || !validPoint(item.end) ||
        !Number.isInteger(item.supportWallIndex)) return null
    const wallId = sourceWallIds[item.supportWallIndex!]
    const wall = walls.find((candidate) => candidate.id === wallId)
    if (!wall || wall.points.length !== 2) return null
    const a = wall.points[0]!, b = wall.points[1]!
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length < 2) return null
    const start = toCanvas(item.start), end = toCanvas(item.end)
    const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
    const tangent = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
    const along = Math.max(0, Math.min(length,
      (center.x - a.x) * tangent.x + (center.y - a.y) * tangent.y))
    const width = Math.max(2, Math.min(length,
      Math.abs((end.x - start.x) * tangent.x + (end.y - start.y) * tangent.y)))
    return { wallId: wall.id, position: along / length, segmentIndex: 0,
      centerAlongSegment: along, width, center, tangent, start, end }
  }
  const doors: Door[] = [...(existing?.doors ?? [])]
  for (const item of page.doors ?? []) {
    const placement = locateOpening(item)
    if (!placement) continue
    const { center, tangent, start: _start, end: _end, ...geometry } = placement
    if (doors.some((door) => door.wallId === geometry.wallId &&
        Math.abs((door.centerAlongSegment ?? 0) - geometry.centerAlongSegment) <= 1 &&
        Math.abs(door.width - geometry.width) <= 1)) continue
    const hinge = item.hinge && validPoint(item.hinge) ? toCanvas(item.hinge) : null
    const swing: Door['swing'] = hinge
      ? (hinge.x - center.x) * tangent.x + (hinge.y - center.y) * tangent.y <= 0
        ? 'left' : 'right'
      : 'none'
    const leafTip = item.leafTip && validPoint(item.leafTip) ? toCanvas(item.leafTip) : null
    const direction = leafTip && swing !== 'none'
      ? resolveDoorDirectionForHinge(swing, tangent,
          getWallNormalSide(center, tangent, leafTip), null)
      : undefined
    doors.push({ id: nanoid(), floorId, ...geometry, swing, direction })
  }
  const windows: Window[] = [...(existing?.windows ?? [])]
  for (const item of page.windows) {
    const placement = locateOpening(item)
    if (!placement) continue
    const { center: _center, tangent: _tangent, start: _start, end: _end, ...geometry } = placement
    if (windows.some((window) => window.wallId === geometry.wallId &&
        Math.abs((window.centerAlongSegment ?? 0) - geometry.centerAlongSegment) <= 1 &&
        Math.abs(window.width - geometry.width) <= 1)) continue
    windows.push({ id: nanoid(), floorId, ...geometry })
  }
  return {
    walls,
    doors,
    windows,
    stairs: existing?.stairs ?? [],
    graphicElements: existing?.graphicElements ?? [],
    masterWallThickness: existing?.masterWallThickness ?? 20,
  }
}
